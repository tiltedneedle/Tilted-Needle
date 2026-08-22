-- Let staff record what happened to an idea.
--
-- idea_outcomes shipped with RLS enabled and only a SELECT policy, which made
-- it write-only-by-service-role -- but outcomes are recorded by a STRATEGIST
-- clicking adopt or decline, through the user-scoped client every server
-- action here uses. Without an insert policy the feedback loop's table
-- existed and nothing could ever reach it.
--
-- Insert only. An outcome is an event, not a state: changing your mind later
-- is a NEW outcome row, and the history of reversals is itself signal. No
-- update or delete policy, deliberately.

create policy idea_outcomes_insert on idea_outcomes for insert to authenticated
  with check (exists (
    select 1 from idea_suggestions s
    where s.id = idea_outcomes.suggestion_id
      and can_manage_workspace(s.workspace_id)
      and not is_client_user(s.workspace_id)
  ));
