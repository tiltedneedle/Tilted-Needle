-- Stop an admin or manager promoting themselves to owner.
--
-- memberships_update was USING (can_manage_workspace(workspace_id)) with no
-- WITH CHECK and no restriction on the role column. So any manager could
-- update any membership row to any role -- including setting their own to
-- 'owner', or demoting the real owner to 'member'.
--
-- The rules that prevent this were written, but only in the Server Action
-- (guardedMembershipTarget): "nobody touches the owner's row, and nobody is
-- promoted TO owner -- ownership transfer is deliberate enough to stay a
-- database operation, not a dropdown". That is the right policy and the wrong
-- place for it. This repo is public and the publishable key ships in the
-- browser bundle, so a manager can call PostgREST directly and never reach the
-- Server Action at all. A rule enforced only in application code is a rule the
-- database does not have.
--
-- Deliberately NOT restricting the whole row: rates and weekly capacity are
-- legitimate manager edits on someone else's membership, and blocking those
-- would break the team admin page. Only two things change:
--
--   USING      role <> 'owner'  -- the owner's row cannot be selected to update
--   WITH CHECK role <> 'owner'  -- and no update may produce an owner
--
-- Ownership transfer stays what the comment already said it was: a deliberate
-- database operation, not something reachable from the UI or the API.

begin;

drop policy if exists memberships_update on memberships;

create policy memberships_update on memberships for update to authenticated
  using (can_manage_workspace(workspace_id) and role <> 'owner')
  with check (can_manage_workspace(workspace_id) and role <> 'owner');

commit;
