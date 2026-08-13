-- Open and close the scrape-budget window on the workspace's day, not UTC's.
--
-- claim_scrape_budget resolved its monthly window with current_date, which is
-- UTC on Supabase. In Dubai that rolled the month over four hours early and in
-- Karachi five: for those hours on the 1st, spend was charged to the month
-- that had just ended -- a window whose limits were already consumed -- so a
-- discovery run at 02:00 on the 1st could be refused against last month's
-- exhausted pool while this month's sat untouched.
--
-- Identical to the original except for the date source, which is now
-- operating_today(workspace). Reproduced in full rather than patched, because
-- a function this concurrency-sensitive should be readable in one piece: the
-- FOR UPDATE row lock below is what stops two simultaneous "sync now" clicks
-- spending the same budget twice.

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
  v_today        date := operating_today(p_workspace_id);
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
    and v_today >= b.period_start
    and v_today < b.period_end
  limit 1;

  if v_period_start is null then
    v_period_start := date_trunc('month', v_today)::date;
    v_period_end   := (date_trunc('month', v_today) + interval '1 month')::date;
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
