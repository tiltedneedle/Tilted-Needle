-- ONE transcription budget for every platform, denominated in MONEY.
--
-- WHY NOT THE PER-PLATFORM POOLS IT REPLACES. scrape_budgets counts ITEMS,
-- and for transcription an item is not a unit of anything: measured on
-- 2026-09-04 a TikTok transcript costs $0.001 and an Instagram one $0.005 --
-- five times as much, and Instagram is billed even when it returns no
-- transcript. A single pool of "500 transcriptions" would mean anywhere
-- between $0.50 and $2.50 depending on which platforms happened to come up.
-- A budget whose value depends on the mix is not a budget.
--
-- So this counts MICRO-DOLLARS. Every fetch debits its own measured price,
-- one pool serves all platforms, and the number in the column is the number
-- on the invoice.
--
-- SIZED FROM REAL INFLOW, measured the same day:
--   videos posted per month   Mar 5, Apr 11, May 28, Jun 87, Jul 236, Aug 164
--                             6-month mean 88, recent trend ~180
--   untranscribed backlog     334 videos = $1.30 at measured prices
--   ongoing at 180/month      ~$0.71 in the observed platform mix
--
-- The allowance is $1.50/month. That clears the entire backlog in the first
-- cycle AND covers ongoing inflow with roughly double the headroom -- while
-- staying inside what the two Apify accounts genuinely have spare once their
-- own baselines are paid ($1.81 and $4.02 by projection, and the Instagram
-- auto-refresh cut earlier this session frees more).
--
-- Deliberately tight, as asked: running out before the cycle ends is a normal
-- outcome, not a fault. Work waits in the queue and resumes on reset, which
-- is why an exhausted pool BLOCKS the job kind rather than failing the job.
--
-- Anchored to the 28th, matching tilted_Needle -- the account that funds
-- YouTube and Instagram and therefore the large majority of transcription
-- spend. TikTok bills the other account, but its share is ~7% of the total
-- and splitting the pool to mirror that would reintroduce exactly the
-- per-platform fragmentation this table exists to remove.

create table if not exists transcription_budget (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references workspaces on delete cascade,
  period_start  date not null,
  period_end    date not null,
  cycle_anchor_day integer not null default 28,
  -- Micro-dollars. Integer so the ledger cannot drift the way a float would
  -- across thousands of small debits.
  limit_micros  bigint not null default 1500000,
  used_micros   bigint not null default 0,
  created_at    timestamptz not null default now(),
  check (period_end > period_start),
  check (cycle_anchor_day between 1 and 28),
  unique (workspace_id, period_start)
);

create extension if not exists btree_gist;

alter table transcription_budget
  drop constraint if exists transcription_budget_no_overlap;
alter table transcription_budget
  add constraint transcription_budget_no_overlap
  exclude using gist (
    workspace_id with =,
    daterange(period_start, period_end, '[)') with &&
  );

alter table transcription_budget enable row level security;

create policy transcription_budget_select on transcription_budget
  for select to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

comment on table transcription_budget is
  'One money-denominated transcription allowance for all platforms. Counts '
  'micro-dollars because a TikTok transcript ($0.001) and an Instagram one '
  '($0.005) are not the same unit.';

-- Claim in micro-dollars. Returns the amount GRANTED, which is zero when the
-- pool cannot cover the whole request: a half-funded transcript is not a
-- thing, so this never grants a partial amount the way the item pools do.
create or replace function claim_transcription_budget(
  p_workspace_id uuid,
  p_micros       bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date;
  v_end   date;
  v_anchor integer := 28;
  v_used  bigint;
  v_limit bigint;
begin
  if p_micros <= 0 then
    return 0;
  end if;

  select period_start, period_end into v_start, v_end
  from transcription_budget
  where workspace_id = p_workspace_id
    and current_date >= period_start
    and current_date < period_end
  order by period_start desc
  limit 1;

  if v_start is null then
    select cycle_anchor_day into v_anchor
    from transcription_budget
    where workspace_id = p_workspace_id
    order by period_start desc
    limit 1;
    v_anchor := coalesce(v_anchor, 28);

    v_start := make_date(
      extract(year from current_date)::int,
      extract(month from current_date)::int,
      v_anchor);
    if current_date < v_start then
      v_start := (v_start - interval '1 month')::date;
    end if;
    v_end := (v_start + interval '1 month')::date;

    insert into transcription_budget (workspace_id, period_start, period_end, cycle_anchor_day)
    values (p_workspace_id, v_start, v_end, v_anchor)
    on conflict do nothing;
  end if;

  select used_micros, limit_micros into v_used, v_limit
  from transcription_budget
  where workspace_id = p_workspace_id and period_start = v_start
  for update;

  if v_used is null or v_used + p_micros > v_limit then
    return 0;
  end if;

  update transcription_budget
  set used_micros = used_micros + p_micros
  where workspace_id = p_workspace_id and period_start = v_start;

  return p_micros;
end;
$$;

-- Hand budget back when a fetch bought nothing. Floored at zero.
create or replace function refund_transcription_budget(
  p_workspace_id uuid,
  p_micros       bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_micros <= 0 then
    return;
  end if;
  update transcription_budget
  set used_micros = greatest(0, used_micros - p_micros)
  where workspace_id = p_workspace_id
    and current_date >= period_start
    and current_date < period_end;
end;
$$;
