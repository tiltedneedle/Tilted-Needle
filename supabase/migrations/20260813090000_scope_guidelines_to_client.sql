-- Stop a portal client reading and writing every other client's guidelines.
--
-- client_guideline_sections and client_assets were gated on
-- is_workspace_member(workspace_id) alone. A client user IS a workspace member
-- -- that is how the portal works -- so the check passed for all of them, on
-- every row in the workspace, for select AND insert AND update. One agency
-- client could read a competitor's brand rules and edit them.
--
-- Phase 5 built can_read_client(ws, target_client) for exactly this shape:
-- staff see every client, a client user sees only their own, and the staff
-- path short-circuits before the client lookup. These two tables were added
-- later and never adopted it. Nothing here is a new idea; it is the existing
-- rule applied where it was missed.
--
-- Writes go further and exclude client users entirely rather than scoping them
-- to their own rows. Guidelines are what the agency tells the client, not a
-- shared document -- a client editing their own brief and nobody noticing is a
-- quieter failure than one being unable to. Delete already required
-- can_manage_workspace and is left alone.

begin;

-- --- client_guideline_sections --------------------------------------------

drop policy if exists guideline_sections_select on client_guideline_sections;
drop policy if exists guideline_sections_insert on client_guideline_sections;
drop policy if exists guideline_sections_update on client_guideline_sections;

create policy guideline_sections_select on client_guideline_sections for select to authenticated
  using (can_read_client(workspace_id, client_id));

create policy guideline_sections_insert on client_guideline_sections for insert to authenticated
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

-- USING chooses which rows are visible to update; WITH CHECK constrains what
-- they may become. Both are required: without the second, a member could move
-- a row to another client on the way past.
create policy guideline_sections_update on client_guideline_sections for update to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id))
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

-- --- client_assets ---------------------------------------------------------

drop policy if exists client_assets_select on client_assets;
drop policy if exists client_assets_insert on client_assets;
drop policy if exists client_assets_update on client_assets;

create policy client_assets_select on client_assets for select to authenticated
  using (can_read_client(workspace_id, client_id));

create policy client_assets_insert on client_assets for insert to authenticated
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

create policy client_assets_update on client_assets for update to authenticated
  using (is_workspace_member(workspace_id) and not is_client_user(workspace_id))
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

commit;
