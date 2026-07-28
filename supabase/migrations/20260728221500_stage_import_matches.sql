-- Applies suggest_content_match to every row in a batch in one statement,
-- rather than one round trip per imported entry -- the same "batch it,
-- don't loop it" lesson as the earlier time_entry_billing view (a real
-- N+1 that made invoicing take 11.7 seconds until it was fixed).

create function stage_import_matches(p_batch_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update import_rows r
  set suggested_content_item_id = m.content_item_id,
      match_confidence = m.score
  from import_rows r2
  cross join lateral suggest_content_match(r2.workspace_id, r2.description) m
  where r.id = r2.id
    and r.batch_id = p_batch_id;
$$;
