-- Teach claim_scrape_budget about the transcription pool and the cycle anchor.
--
-- Without this the migration before it is decorative: limit_transcription
-- exists, nothing can spend it, and cycle_anchor_day is ignored because the
-- function still hard-codes date_trunc('month'). A column the writer does not
-- read is the same failure as maxItems in a validator that ignores it.
--
-- The anchored window is computed from the anchor day, not from the calendar:
-- with anchor 11 and today the 4th, the current cycle runs 11 Aug -> 11 Sep,
-- because the period containing today STARTED last month. Getting that
-- backwards would hand out a second allowance on the 1st and then a third on
-- the 11th.

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

  select b.period_start, b.period_end into v_period_start, v_period_end
  from scrape_budgets b
  where b.workspace_id = p_workspace_id
    and b.platform_slug = p_platform_slug
    and current_date >= b.period_start
    and current_date < b.period_end
  limit 1;

  if v_period_start is null then
    -- Carry the anchor forward from this platform's most recent row, so a new
    -- period inherits the cycle rather than silently reverting to calendar
    -- months the first time a row rolls over.
    select cycle_anchor_day into v_anchor
    from scrape_budgets
    where workspace_id = p_workspace_id and platform_slug = p_platform_slug
    order by period_start desc
    limit 1;

    if v_anchor is null then
      v_period_start := date_trunc('month', current_date)::date;
      v_period_end   := (date_trunc('month', current_date) + interval '1 month')::date;
    else
      -- The anchored period CONTAINING today. If today is before the anchor
      -- day, the cycle began last month.
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
    on conflict (workspace_id, platform_slug, period_start) do nothing;
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
