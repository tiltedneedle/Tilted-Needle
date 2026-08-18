-- Account-level, period-scoped analytics: the home for everything a monthly
-- client report prints that this schema could not previously express.
--
-- WHY IT DID NOT FIT ANYWHERE. Every metrics table here is keyed on an
-- INSTANT (captured_at) and hangs off a POST. A client report is neither: it
-- is a date-range aggregate of an ACCOUNT. "Instagram, 30 June to 30 July"
-- had no representation at all, and roughly 35 fields the two live reports
-- print -- followers, reach, profile visits, demographics, traffic sources,
-- search queries -- had no column anywhere.
--
-- MOST OF THIS IS TYPED, NOT IMPORTED, AND THAT IS PERMANENT. Meta provides
-- no account-level export for Instagram, and OAuth is banned here by
-- constraint. YouTube's export carries views, likes and new subscribers;
-- TikTok's carries its period scalars and follower counts; everything else
-- reaches the system because a person read it off a screen and typed it. The
-- column list is therefore also a manifest: a field with no column cannot
-- appear in a generated report, which is the point of writing it down.
--
-- NULL MEANS "no source this cycle". 0 MEANS ZERO. The live reports print
-- "Bio link taps 0" and "Estimated Creator Rewards: $0.00" because a zero is
-- information a client asked for. A NULL renders as a gap or a caveat
-- sentence. No code may coalesce one into the other.

begin;

-- ---------------------------------------------------------------------------
-- Period metrics
-- ---------------------------------------------------------------------------

create table account_metrics (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  account_id    uuid not null references accounts on delete cascade,

  -- INCLUSIVE both ends, in the workspace's operating timezone (never
  -- current_date, which is UTC). Not a month column: the live Entree report
  -- measures 30 June - 30 July and prints that range in two section headers,
  -- while Ameerh's measures a calendar month and prints no range at all. A
  -- month column would have to lie about one of them. The month is a LABEL,
  -- and labels live on client_reports.
  period_start  date not null,
  period_end    date not null,

  -- draft = written but invisible to the report generator and to client
  -- users. A period is assembled from several files PLUS a screen of typed
  -- numbers, so holding it in React state until one commit would lose an
  -- hour's work to a stray refresh.
  status        text not null default 'draft'
                check (status in ('draft', 'confirmed')),

  -- ---- LEVEL metrics: a reading AT period_end. Never summed across days,
  -- never accumulated. --------------------------------------------------
  followers            bigint,   -- Instagram, TikTok. NOT subscribers.
  subscribers          bigint,   -- YouTube. The reports keep these two words
                                 -- apart and so does this table.

  -- ---- FLOW metrics: totals earned INSIDE the period. -----------------
  views                bigint,   -- This platform's own count, on its own
                                 -- terms. platforms.view_semantics records
                                 -- that a Short counts a view immediately and
                                 -- long-form YouTube at 30 seconds, which is
                                 -- why nothing in the app sums views across
                                 -- rows. The report's combined figure is a
                                 -- deliberate, footnoted exception.
  reach                bigint,   -- De-duplicated accounts reached. A distinct
                                 -- fact from views, never a substitute.
  impressions          bigint,
  profile_views        bigint,   -- IG "profile visits" / TikTok "profile views".
  interactions         bigint,   -- Instagram's OWN pre-aggregated figure. It
                                 -- is not likes+comments+shares and must not
                                 -- be derived from them.
  likes                bigint,
  comments             bigint,
  shares               bigint,
  saves                bigint,

  net_followers        integer,  -- Signed; may legitimately be negative.
  follows              integer,  -- Gross, positive.
  unfollows            integer,  -- Gross, stored POSITIVE; the report prints
                                 -- the minus sign.
  net_subscribers      integer,

  bio_link_taps            integer,
  business_address_taps    integer,

  -- The only money in either report. Minor units so no float touches it, and
  -- the currency is required alongside because the source prints "$" and
  -- never states a code.
  creator_rewards_minor    bigint,
  creator_rewards_currency text
    check (creator_rewards_currency is null or creator_rewards_currency ~ '^[A-Z]{3}$'),

  -- Free text, because the platforms state these as prose and disagree on
  -- clock convention -- Instagram "18:00-21:00", TikTok "around 12am".
  -- Normalising would invent precision the source does not have.
  follower_active_hours text,
  viewer_active_hours   text,   -- TikTok prints both; viewers are a different
                                -- population from followers.
  -- Neither platform says which zone those are in. Recording the assumption
  -- is the difference between a figure a client can act on and one they
  -- cannot.
  active_times_timezone text,

  -- The report's own missing-data idiom, as a field: Entree prints "Location
  -- and full age-range breakdowns were not exported for this cycle."
  caveat_note   text,

  -- PER-FIELD provenance, because one period legitimately mixes sources:
  -- YouTube subscribers read from a file, Instagram followers typed off a
  -- screen. A row-level `source` column -- which is what post_analytics has
  -- -- cannot express that, and the report needs to say which numbers a
  -- machine read and which a person transcribed.
  --
  --   { "views":     { "source": "export", "file": "Table data.csv", ... },
  --     "followers": { "source": "manual", "evidence": "...", "at": "..." } }
  --
  -- source is one of: export | manual | screenshot | derived.
  field_sources jsonb not null default '{}'::jsonb
    check (jsonb_typeof(field_sources) = 'object'),

  confirmed_by  uuid references profiles on delete set null,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Re-importing a period SUPERSEDES it rather than adding a second answer.
  -- post_analytics has no such constraint and a repeated file writes a whole
  -- duplicate set; here that would leave the report with two candidates for
  -- "July followers" and no rule for choosing.
  unique (account_id, period_start, period_end),
  constraint account_metrics_period_ordered check (period_end >= period_start),
  -- Catches a mis-typed year, which is otherwise indistinguishable from a
  -- valid import.
  constraint account_metrics_period_sane    check (period_end - period_start <= 366),
  constraint account_metrics_confirmed_has_actor
    check (status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null)),
  constraint account_metrics_rewards_need_currency
    check (creator_rewards_minor is null or creator_rewards_currency is not null)
);

create index on account_metrics (workspace_id);
-- The prior-period lookup, which runs once per account per report.
create index on account_metrics (account_id, period_end desc);
create index on account_metrics (workspace_id, status) where status = 'draft';

-- ---------------------------------------------------------------------------
-- Ranked distributions
-- ---------------------------------------------------------------------------

-- A child table rather than a jsonb column, for three reasons all drawn from
-- the live reports:
--
--  1. RANK IS NOT DERIVABLE FROM VALUE. The TikTok search-query block lists
--     five queries all at 0.2%. Their order is the export's own and carries
--     real information; sorting by value would scramble it.
--  2. The generator compares a label ACROSS periods -- "35-44 overtook 25-34
--     for the first time", "consistent with June's 99.6% share". That is a
--     join on (kind, label), which is a query here and an array scan in jsonb.
--  3. A kind with NO ROWS means "not exported this cycle", which is exactly
--     the state Entree prints a caveat for -- and it does not collide with a
--     real zero, which is a row whose value is 0. TikTok's "Sound 0.0%" is
--     printed, not suppressed.
create table account_breakdowns (
  id                 uuid primary key default uuid_generate_v4(),
  workspace_id       uuid not null references workspaces on delete cascade,
  account_metric_id  uuid not null references account_metrics on delete cascade,

  kind text not null check (kind in (
    'follower_age', 'follower_gender', 'follower_location', 'follower_active_days',
    'viewer_age',   'viewer_gender',   'viewer_location',   'viewer_active_days',
    'views_by_format', 'interactions_by_format', 'interaction_share_by_format',
    'traffic_source', 'search_query', 'subscription_source'
  )),

  -- The platform's OWN words, never normalised. Instagram says "Women"/"Men";
  -- TikTok says "Female"/"Male". Both appear in the same report, and each
  -- client sees their platform's vocabulary -- harmonising them would make
  -- the report differ from every screen the client can check it against.
  label   text not null,
  -- Preserved from the source's ordering, not recomputed from value.
  rank    integer not null,
  -- Null is legitimate: a ranked list with no numbers (most-active days) is
  -- ordering only.
  value   numeric,
  unit    text not null check (unit in ('percent', 'count')),
  -- Authored annotation, kept apart from the exported label. The live report
  -- prints a Georgian query with a transliteration its author added --
  -- "ანტრე ბათონი (Antre Batoni)". The query is data, the transliteration is
  -- writing, and merging them would make hand-written text look exported.
  annotation text,

  created_at timestamptz not null default now(),

  unique (account_metric_id, kind, label),
  -- 0..100, not 0..1. Every one of these is printed as a percentage and never
  -- used in arithmetic, so storing a fraction would mean converting back at
  -- every read site and nowhere else.
  constraint account_breakdowns_percent_range
    check (unit <> 'percent' or value is null or (value >= 0 and value <= 100))
);

create index on account_breakdowns (account_metric_id, kind, rank);
create index on account_breakdowns (workspace_id);

-- ---------------------------------------------------------------------------
-- The report itself
-- ---------------------------------------------------------------------------

create table client_reports (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  client_id     uuid not null references clients on delete cascade,
  period_start  date not null,
  period_end    date not null,

  -- What the cover prints, derived from the dates then editable: the same
  -- window is "JULY 2026" on both covers, but only one body prints
  -- "30 JUNE - 30 JULY".
  period_label  text not null,
  window_label  text,

  -- Which page grammar. The two live reports have genuinely different page
  -- structures, not one structure with optional sections.
  template      text not null check (template in ('channel_growth', 'platform_narrative')),

  -- Human-written prose, keyed by slot. Anything the generator cannot fill
  -- honestly lives here and nowhere else; an unfilled required slot blocks
  -- export rather than rendering empty.
  editorial     jsonb not null default '{}'::jsonb
                check (jsonb_typeof(editorial) = 'object'),

  status        text not null default 'draft'
                check (status in ('draft', 'ready', 'sent')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (client_id, period_start, period_end),
  constraint client_reports_period_ordered check (period_end >= period_start)
);

create index on client_reports (workspace_id, client_id, period_end desc);

-- ---------------------------------------------------------------------------
-- RLS. Mirrors post_analytics: read is client-scoped so a portal user sees
-- their own numbers and nobody else's; writes are staff-only.
-- ---------------------------------------------------------------------------

alter table account_metrics    enable row level security;
alter table account_breakdowns enable row level security;
alter table client_reports     enable row level security;

-- accounts.client_id is nullable. can_read_client returns false for a client
-- user when the target is null and true for any staff member, so an
-- unassigned account is staff-only without a special case.
--
-- The status clause is not decoration: without it a client user could read a
-- DRAFT period, and a draft is by definition a number nobody has stood behind
-- yet.
create policy account_metrics_select on account_metrics for select to authenticated
  using (
    (status = 'confirmed' or not is_client_user(workspace_id))
    and exists (
      select 1 from accounts a
      where a.id = account_metrics.account_id
        and can_read_client(a.workspace_id, a.client_id)
    )
  );

create policy account_metrics_insert on account_metrics for insert to authenticated
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

-- UPDATE has no counterpart on post_analytics, because this table supersedes
-- in place rather than accumulating rows.
create policy account_metrics_update on account_metrics for update to authenticated
  using      (is_workspace_member(workspace_id) and not is_client_user(workspace_id))
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

create policy account_metrics_delete on account_metrics for delete to authenticated
  using (can_manage_workspace(workspace_id));

-- Breakdowns inherit their parent's visibility, scoped THROUGH the parent
-- rather than re-deriving from accounts, so the two can never disagree.
create policy account_breakdowns_select on account_breakdowns for select to authenticated
  using (
    exists (
      select 1 from account_metrics m
      where m.id = account_breakdowns.account_metric_id
        and (m.status = 'confirmed' or not is_client_user(m.workspace_id))
        and exists (
          select 1 from accounts a
          where a.id = m.account_id and can_read_client(a.workspace_id, a.client_id)
        )
    )
  );

create policy account_breakdowns_write on account_breakdowns for all to authenticated
  using      (is_workspace_member(workspace_id) and not is_client_user(workspace_id))
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

-- A client may read their own report only once it has left draft.
create policy client_reports_select on client_reports for select to authenticated
  using (
    (status <> 'draft' or not is_client_user(workspace_id))
    and can_read_client(workspace_id, client_id)
  );
create policy client_reports_write on client_reports for all to authenticated
  using      (is_workspace_member(workspace_id) and not is_client_user(workspace_id))
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

commit;
