-- memberships.user_id and time_entries.user_id both reference auth.users, which
-- PostgREST cannot traverse to public.profiles. Without a direct constraint an
-- embed like `profile:profiles(full_name)` fails with "Could not find a
-- relationship", so the Team page and team-scoped reports render no names.
--
-- profiles.id is itself a FK to auth.users(id), so these are consistent by
-- construction: any row valid under the auth.users FK has a matching profile
-- created by the on_auth_user_created trigger.

alter table memberships
  add constraint memberships_user_profile_fkey
  foreign key (user_id) references profiles (id) on delete cascade;

alter table time_entries
  add constraint time_entries_user_profile_fkey
  foreign key (user_id) references profiles (id) on delete cascade;
