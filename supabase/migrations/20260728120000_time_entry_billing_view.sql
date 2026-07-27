-- Resolved rates for every time entry, in one query.
--
-- Calling resolve_billable_rate() per entry meant one round trip per row --
-- invoicing a month of tracked time took over ten seconds. The precedence is
-- identical; only the number of queries changes.
--
-- security_invoker so the view is filtered by the caller's RLS. Without it
-- this would expose every workspace's rates, including cost rates.

create view time_entry_billing
with (security_invoker = on) as
select
  te.id           as time_entry_id,
  te.workspace_id,
  te.user_id,
  te.project_id,
  te.duration_seconds,
  te.is_billable,
  te.invoice_id,
  coalesce(
    t.billable_rate,        -- task
    pm.billable_rate,       -- project member
    p.billable_rate,        -- project
    m.billable_rate,        -- workspace member
    w.default_billable_rate -- workspace default
  ) as billable_rate,
  -- Internal cost, for margin reporting. RLS on the underlying memberships
  -- row is what keeps this away from non-managers.
  m.cost_rate
from time_entries te
join workspaces w on w.id = te.workspace_id
left join tasks t on t.id = te.task_id
left join projects p on p.id = te.project_id
left join project_members pm
  on pm.project_id = te.project_id and pm.user_id = te.user_id
left join memberships m
  on m.workspace_id = te.workspace_id and m.user_id = te.user_id;
