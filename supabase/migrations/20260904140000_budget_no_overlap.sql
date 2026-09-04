-- Make the "current period" lookup deterministic, and stop overlaps existing.
--
-- claim_scrape_budget selected the live row with `limit 1` and no ORDER BY.
-- With one row per period that was fine; the moment cycle_anchor_day moved a
-- platform off calendar months it was not. Instagram briefly had TWO rows
-- covering the same day -- a legacy 1 Sep -> 1 Oct row and the new anchored
-- 28 Aug -> 28 Sep one -- and which of them a claim spent from was arbitrary.
-- Budget that is deducted from an unpredictable row is not a budget.
--
-- Two guards, because either alone is weaker than it looks:
--   1. ORDER BY period_start DESC picks the newest window deterministically,
--      so even if an overlap appears the behaviour is defined.
--   2. An EXCLUSION CONSTRAINT stops overlaps existing at all. This is the
--      real fix; the ordering is what keeps a claim sane in the moment
--      before someone notices.

create extension if not exists btree_gist;

alter table scrape_budgets
  drop constraint if exists scrape_budgets_no_overlap;

alter table scrape_budgets
  add constraint scrape_budgets_no_overlap
  exclude using gist (
    workspace_id with =,
    platform_slug with =,
    daterange(period_start, period_end, '[)') with &&
  );

create or replace function claim_scrape_budget(
  p_workspace_id  uuid,
  p_platform_slug text,
  p_pool          text,
  p_count         integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start date;
  v_period_end   date;
  v_anchor       integer;
  v_granted      integer := 0;
  v_used         integer;
  v_limit        integer;
begin
  if p_count <= 0 then
    return 0;
  end if;
  if p_pool not in ('auto', 'discovery', 'manual', 'transcription') then
    raise exception 'Unknown budget pool: %', p_pool;
  end if;

  if auth.uid() is not null and not exists (
    select 1 from memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.is_active
      and m.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Not authorised to spend scrape budget for this workspace';
  end if;

  -- Newest window first. The exclusion constraint should make this a
  -- single-row question, but a deterministic answer costs nothing.
  select b.period_start, b.period_end into v_period_start, v_period_end
  from scrape_budgets b
  where b.workspace_id = p_workspace_id
    and b.platform_slug = p_platform_slug
    and current_date >= b.period_start
    and current_date < b.period_end
  order by b.period_start desc
  limit 1;

  if v_period_start is null then
    select cycle_anchor_day into v_anchor
    from scrape_budgets
    where workspace_id = p_workspace_id and platform_slug = p_platform_slug
    order by period_start desc
    limit 1;

    if v_anchor is null then
      v_period_start := date_trunc('month', current_date)::date;
      v_period_end   := (date_trunc('month', current_date) + interval '1 month')::date;
    else
      v_period_start := make_date(
        extract(year from current_date)::int,
        extract(month from current_date)::int,
        v_anchor);
      if current_date < v_period_start then
        v_period_start := (v_period_start - interval '1 month')::date;
      end if;
      v_period_end := (v_period_start + interval '1 month')::date;
    end if;

    insert into scrape_budgets (
      workspace_id, platform_slug, period_start, period_end, cycle_anchor_day)
    values (
      p_workspace_id, p_platform_slug, v_period_start, v_period_end, v_anchor)
    on conflict do nothing;
  end if;

  select
    case p_pool when 'auto' then used_auto
                when 'discovery' then used_discovery
                when 'transcription' then used_transcription
                else used_manual end,
    case p_pool when 'auto' then limit_auto
                when 'discovery' then limit_discovery
                when 'transcription' then limit_transcription
                else limit_manual end
    into v_used, v_limit
  from scrape_budgets
  where workspace_id = p_workspace_id
    and platform_slug = p_platform_slug
    and period_start = v_period_start
  for update;

  if v_used is null then
    return 0;
  end if;

  v_granted := least(p_count, greatest(0, v_limit - v_used));
  if v_granted <= 0 then
    return 0;
  end if;

  update scrape_budgets
  set used_auto          = used_auto          + case when p_pool = 'auto' then v_granted else 0 end,
      used_discovery     = used_discovery     + case when p_pool = 'discovery' then v_granted else 0 end,
      used_manual        = used_manual        + case when p_pool = 'manual' then v_granted else 0 end,
      used_transcription = used_transcription + case when p_pool = 'transcription' then v_granted else 0 end
  where workspace_id = p_workspace_id
    and platform_slug = p_platform_slug
    and period_start = v_period_start;

  return v_granted;
end;
$$;
