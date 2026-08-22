-- A finding is not a fact about this week. It is a claim with a lifecycle.
--
-- THE PROBLEM THESE TABLES EXIST TO SOLVE
--
-- Without them, every report recomputes from scratch and shows whatever this
-- week's numbers say. That sounds stateless and safe, and it is neither,
-- because the READER is not stateless: a marketer accumulates memory across
-- weeks and watches findings appear, vanish, and contradict themselves.
--
-- Measured under a pure null with BH applied per report exactly as designed,
-- the probability that a given client is shown at least one false finding:
--
--     after 1 run    0.105
--     after 13 runs  0.293
--     after 52 runs  0.471   -- and it carries one in a mean of 6.7 weeks
--
-- Across 13 clients over a year that is 0.9998. "Set the family to whatever
-- the reader sees at once" does not survive a weekly cadence. Correcting
-- within a run does nothing about looking 52 times.
--
-- Two things follow, and both are recorded here rather than inferred later.
--
-- 1. A RUN IS A REPRODUCIBLE OBJECT. m_tested, q, permutations and the seed
--    are stored, not recomputed -- so a finding from March stays checkable in
--    November even after the registry has grown. Inferring the family size
--    afterwards would silently change what a past p-value meant.
--
-- 2. A FINDING IS RETRACTED, NOT DELETED. When a hypothesis loses significance
--    the row survives with a reason and the run that killed it, so the report
--    can say "we told you longer videos helped in June; with 15 more videos it
--    no longer holds." That is the honest handling of repeated looks, and it
--    reads as a feature rather than a hedge. Deleting the row would let the
--    system quietly un-say things.

create table analysis_runs (
  id                   uuid primary key default uuid_generate_v4(),
  workspace_id         uuid not null references workspaces on delete cascade,
  -- Which hypothesis list ran. A finding must stay resolvable after the
  -- registry gains entries.
  registry_version     integer not null,
  outcome              text not null default 'perf_index',
  -- The BH family size, RECORDED rather than inferred. m is the number of
  -- hypotheses that actually ran, which depends on how many clients had both
  -- sides populated that day -- irrecoverable later.
  m_tested             integer not null,
  q                    numeric not null,
  permutations         integer not null,
  -- Derived from the input digest, so the same corpus reproduces the same
  -- p-values. A jittering p-value silently busts the analysis cache and
  -- re-buys every narration.
  seed                 text not null,
  -- Measured, never assumed. Every power figure depends on it and the design
  -- originally guessed 0.8-1.2; it is 1.685.
  sigma_pooled         numeric not null,
  scored_posts         integer not null,
  clients_contributing integer not null,
  started_at           timestamptz not null default now(),
  finished_at          timestamptz
);

create index analysis_runs_ws on analysis_runs (workspace_id, started_at desc);

create table workspace_effects (
  id                uuid primary key default uuid_generate_v4(),
  run_id            uuid not null references analysis_runs on delete cascade,
  hypothesis_id     text not null,
  k_clients         integer not null,
  mu                numeric not null,        -- log scale
  se                numeric not null,
  tau2              numeric not null,
  i2                numeric not null,
  p_perm            numeric not null,
  significant       boolean not null,
  -- More than 20% of contributing clients disagree in sign with mu. A pooled
  -- 1.3x at tau=0.35 spans real client effects of 0.83x-2.04x and HURTS 22% of
  -- clients who follow it; at tau=0.70, 0.53x-3.19x and 35%. When this is
  -- true the pooled mean is the wrong estimand and there is no headline.
  is_mixed          boolean not null,
  -- The effect reverses direction between platforms. A finding that exists
  -- only in pooled data is Simpson's paradox waiting to be printed.
  platform_reversal boolean not null default false,
  unique (run_id, hypothesis_id)
);

create table client_findings (
  id               uuid primary key default uuid_generate_v4(),
  workspace_id     uuid not null references workspaces on delete cascade,
  client_id        uuid not null references clients on delete cascade,
  hypothesis_id    text not null,

  -- A lifecycle, not a snapshot. A finding is shown until it is retracted.
  --   active     -- currently supported
  --   retracted  -- lost significance; the report SAYS SO rather than going quiet
  --   superseded -- the client's own posterior moved into the no-difference
  --                 band, so a new row with state='holds' replaces it
  --   stale      -- not recomputed in 180 days; hidden, kept for audit
  status           text not null default 'active'
    check (status in ('active', 'retracted', 'superseded', 'stale')),
  state            text not null check (state in ('acting', 'holds', 'none')),

  first_seen_run   uuid not null references analysis_runs,
  last_seen_run    uuid not null references analysis_runs,
  retracted_run    uuid references analysis_runs,
  retracted_reason text,

  -- The printed number, plus everything needed to audit how it got there.
  y_raw            numeric not null,   -- this client's unshrunk log effect
  v                numeric not null,   -- its sampling variance
  shrink_b         numeric not null,   -- how much of the pooled mean was used
  theta            numeric not null,   -- shrunk log effect
  multiplier       numeric not null,   -- exp(theta) -- what a marketer reads
  n_with           integer not null,
  n_without        integer not null,
  -- Rank correlation between the feature and posting order. AUDIT ONLY, never
  -- acted on: the proposed |rho|>0.3 time-confound guard was measured against
  -- the real algorithm and the effect is approximately zero -- lag-1
  -- autocorrelation of ln(index) is +0.0086, and the rolling baseline ADAPTS
  -- to trend, making it the mitigation rather than the source.
  order_rho        numeric,

  created_at       timestamptz not null default now(),
  unique (client_id, hypothesis_id, first_seen_run)
);

create index client_findings_live on client_findings (workspace_id, client_id, status);

-- THE DATA GATE, and it is the single most important column here.
--
-- Re-running is what makes repeated looks expensive, so a client is re-tested
-- when its evidence has actually CHANGED, not when a week has passed. The old
-- rule was a pure time gate: WEEKLY_READ_DAYS = 7, no data check at all, so a
-- library gaining about one scored video a week was re-tested 52 times a year
-- on almost the same data.
--
-- Growth of >=20% in scored posts, or 90 days, gives ~6 runs a year instead of
-- 52. That cuts P(>=1 false finding per client per year) from 0.471 toward
-- ~0.15, and LLM spend by roughly 8x, for no loss -- a re-test on data that has
-- not moved cannot learn anything, it can only roll the dice again.
create table client_analysis_state (
  client_id            uuid primary key references clients on delete cascade,
  workspace_id         uuid not null references workspaces on delete cascade,
  last_run_id          uuid references analysis_runs on delete set null,
  -- What the corpus looked like when we last tested, so growth is measurable.
  scored_posts_at_run  integer not null default 0,
  last_run_at          timestamptz
);

alter table analysis_runs enable row level security;
alter table workspace_effects enable row level security;
alter table client_findings enable row level security;
alter table client_analysis_state enable row level security;

create policy analysis_runs_select on analysis_runs for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));
create policy client_findings_select on client_findings for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));
create policy client_analysis_state_select on client_analysis_state for select to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));
-- workspace_effects has no workspace_id of its own; it is reachable only
-- through its run, so the policy follows the run.
create policy workspace_effects_select on workspace_effects for select to authenticated
  using (exists (
    select 1 from analysis_runs r
    where r.id = workspace_effects.run_id
      and can_manage_workspace(r.workspace_id)
      and not is_client_user(r.workspace_id)
  ));

comment on table client_findings is
  'Findings have a lifecycle. A claim that loses support is RETRACTED with a '
  'reason and narrated to the reader, never silently deleted -- the reader '
  'accumulates memory across weeks even though the report does not.';
