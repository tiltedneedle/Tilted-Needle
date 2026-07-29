-- ---------------------------------------------------------------------------
-- Metered scraping: budget ledger and age-tiered scheduling
--
-- Instagram is the one platform that costs real money per read. Apify's free
-- tier allows $5/month of platform credit, and the official Instagram actor
-- bills $2.70 per 1,000 results on that tier -- about 1,850 post-reads a
-- month. We target 1,800 to keep a margin, because overrunning does not bill
-- us, it BLOCKS us: a free-plan account that hits the ceiling stops returning
-- data until the next cycle. Silent mid-month death is the failure we are
-- designing against.
--
-- The arithmetic that shapes everything below: ~100 videos published a month,
-- each kept in the refresh pool until it is 90 days old, means ~300 videos in
-- the pool at steady state. Refreshing all of them daily would cost 9,000
-- reads a month. So the interval has to widen as a video ages -- which is
-- also just correct, since a post's view count moves fast in its first days
-- and barely at all by month three.
--
-- Budget split, per month:
--     1,400  automatic refreshes
--       200  discovery (finding newly published posts)
--       200  manual "scrape now" presses
--     -----
--     1,800  total, against a hard ceiling of ~1,850
--
-- The three pools are enforced separately on purpose. If automatic refreshes
-- could eat the manual reserve, the button a person actually presses would be
-- the first thing to stop working, and it would stop without warning.
-- ---------------------------------------------------------------------------

-- Age-tiered refresh schedule. Held as data rather than code so the cadence
-- can be retuned against real spend without a deploy.
create table if not exists scrape_schedule (
  id            uuid primary key default uuid_generate_v4(),
  platform_slug text not null references platforms (slug) on delete cascade,
  -- Half-open age band in days: [min_age_days, max_age_days)
  min_age_days  integer not null,
  max_age_days  integer,          -- null = no upper bound
  interval_days numeric not null check (interval_days > 0),
  unique (platform_slug, min_age_days)
);

comment on table scrape_schedule is
  'How often to re-read a post, by how old it is. Wider bands as posts age.';

-- Instagram's cadence, costed at ~12.9 reads per video across its 90-day life:
--   days 0-3    daily        3.0 reads   the launch spike, where it moves most
--   days 4-14   every 3d     3.7 reads
--   days 15-45  every 10d    3.0 reads
--   days 46-90  every 14d    3.2 reads
-- 100 new videos a month x 12.9 = ~1,290 automatic reads/month, inside 1,400.
insert into scrape_schedule (platform_slug, min_age_days, max_age_days, interval_days)
values
  ('instagram',  0,   4,    1),
  ('instagram',  4,   15,   3),
  ('instagram',  15,  46,   10),
  ('instagram',  46,  91,   14)
on conflict (platform_slug, min_age_days) do update
  set max_age_days = excluded.max_age_days,
      interval_days = excluded.interval_days;

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create table if not exists scrape_budgets (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  platform_slug text not null references platforms (slug),
  -- The billing window this row counts. Anchored to the provider's own reset
  -- date, not to the calendar month -- Apify resets on the signup anniversary,
  -- and counting against the wrong window would let us overrun near the join.
  period_start  date not null,
  period_end    date not null,
  limit_auto      integer not null default 1400,
  limit_discovery integer not null default 200,
  limit_manual    integer not null default 200,
  used_auto       integer not null default 0,
  used_discovery  integer not null default 0,
  used_manual     integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (workspace_id, platform_slug, period_start),
  check (period_end > period_start)
);

create index if not exists scrape_budgets_current_idx
  on scrape_budgets (workspace_id, platform_slug, period_end desc);

alter table scrape_budgets enable row level security;

-- Readable by staff so the remaining-scrapes counter can render. Writes come
-- from the service-role sync only: a budget a user could edit is not a budget.
drop policy if exists scrape_budgets_select on scrape_budgets;
create policy scrape_budgets_select on scrape_budgets
  for select using (
    exists (
      select 1 from memberships m
      where m.workspace_id = scrape_budgets.workspace_id
        and m.user_id = auth.uid()
        and m.is_active
        and m.role <> 'client'
    )
  );

-- ---------------------------------------------------------------------------
-- Per-post scheduling state
-- ---------------------------------------------------------------------------

alter table platform_posts
  add column if not exists last_scraped_at timestamptz,
  -- Set once a post ages out of the pool. Its recorded metrics stay exactly
  -- as they are -- retiring a post stops future reads, it never deletes
  -- history. The dashboards keep showing its final numbers forever.
  add column if not exists scrape_retired_at timestamptz;

-- The working index for "which posts are due?": only live, un-retired posts
-- with a platform id worth re-reading.
create index if not exists platform_posts_due_idx
  on platform_posts (workspace_id, last_scraped_at nulls first)
  where scrape_retired_at is null and external_id is not null;

comment on column platform_posts.last_scraped_at is
  'When metrics were last fetched. Drives the age-tiered refresh interval.';
comment on column platform_posts.scrape_retired_at is
  'Aged out of the refresh pool. Existing metrics are retained permanently.';

-- ---------------------------------------------------------------------------
-- Atomic spend
-- ---------------------------------------------------------------------------

-- Claims budget before any money is spent, and refuses rather than overruns.
--
-- security definer because the caller may be a browser session pressing
-- "scrape now", which has no write access to the ledger and must not be given
-- any. Authorisation is re-checked inside against membership, exactly as
-- commit_import_batch does.
--
-- The single UPDATE ... WHERE used + n <= limit is what makes this safe under
-- concurrency: two simultaneous presses cannot both read "199 used" and both
-- proceed, because the second one's WHERE clause fails against the row the
-- first already wrote.
create or replace function claim_scrape_budget(
  p_workspace_id  uuid,
  p_platform_slug text,
  p_pool          text,      -- 'auto' | 'discovery' | 'manual'
  p_count         integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start date;
  v_period_end   date;
  v_granted      integer := 0;
  v_used         integer;
  v_limit        integer;
begin
  if p_count <= 0 then
    return 0;
  end if;
  if p_pool not in ('auto', 'discovery', 'manual') then
    raise exception 'Unknown budget pool: %', p_pool;
  end if;

  -- A browser caller must be a manager of this workspace. The scheduled sync
  -- runs as the service role, which bypasses RLS and has no auth.uid().
  if auth.uid() is not null and not exists (
    select 1 from memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.is_active
      and m.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Not authorised to spend scrape budget for this workspace';
  end if;

  -- Current window, defaulting to a calendar month when none is configured.
  select b.period_start, b.period_end into v_period_start, v_period_end
  from scrape_budgets b
  where b.workspace_id = p_workspace_id
    and b.platform_slug = p_platform_slug
    and current_date >= b.period_start
    and current_date < b.period_end
  limit 1;

  if v_period_start is null then
    v_period_start := date_trunc('month', current_date)::date;
    v_period_end   := (date_trunc('month', current_date) + interval '1 month')::date;
    insert into scrape_budgets (workspace_id, platform_slug, period_start, period_end)
    values (p_workspace_id, p_platform_slug, v_period_start, v_period_end)
    on conflict (workspace_id, platform_slug, period_start) do nothing;
  end if;

  -- Read the pool under a row lock, then write. FOR UPDATE is what makes this
  -- safe when two people press "scrape now" at once: the second transaction
  -- blocks until the first commits, so it cannot read a stale "used" and
  -- spend the same budget twice.
  select
    case p_pool when 'auto' then used_auto
                when 'discovery' then used_discovery
                else used_manual end,
    case p_pool when 'auto' then limit_auto
                when 'discovery' then limit_discovery
                else limit_manual end
    into v_used, v_limit
  from scrape_budgets
  where workspace_id = p_workspace_id
    and platform_slug = p_platform_slug
    and period_start = v_period_start
  for update;

  if v_used is null then
    return 0;  -- the row vanished under us; spend nothing
  end if;

  -- Grant up to what is left, never more. A partial grant is deliberate: it
  -- lets a run of 40 posts do the 12 it can afford rather than abandoning all
  -- of them at the ceiling.
  v_granted := greatest(0, least(p_count, v_limit - v_used));

  if v_granted > 0 then
    update scrape_budgets
       set used_auto      = used_auto      + case when p_pool = 'auto'      then v_granted else 0 end,
           used_discovery = used_discovery + case when p_pool = 'discovery' then v_granted else 0 end,
           used_manual    = used_manual    + case when p_pool = 'manual'    then v_granted else 0 end
     where workspace_id = p_workspace_id
       and platform_slug = p_platform_slug
       and period_start = v_period_start;
  end if;

  return v_granted;
end;
$$;

revoke all on function claim_scrape_budget(uuid, text, text, integer) from public;
grant execute on function claim_scrape_budget(uuid, text, text, integer) to authenticated;

comment on function claim_scrape_budget is
  'Atomically reserves scrape budget. Returns how many reads were granted, which may be fewer than requested and may be zero.';
