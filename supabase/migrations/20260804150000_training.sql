-- ---------------------------------------------------------------------------
-- Employee training: modules of videos, watched strictly in order
--
-- A module is a course; its videos are YouTube embeds (the same free,
-- official embed surface the content dashboards already use -- no storage
-- bill, and an unlisted YouTube upload keeps internal material off search).
-- An employee only sees a module once a manager assigns it to them, works
-- through its videos in order, and marks each complete to unlock the next.
-- Managers see everyone's progress.
--
-- The watch-in-order rule is enforced in the server action, not in RLS: a
-- policy cannot cheaply express "every earlier video in this module has a
-- completion row". What RLS does guarantee is the part that matters as a
-- boundary: you can only ever complete YOUR OWN videos, only in modules you
-- were actually assigned, and you cannot un-complete anything (delete is
-- manager-only, for progress resets). Skipping ahead via a hand-crafted API
-- call therefore only mis-states the caller's own progress, which the
-- manager can see and reset -- it never touches anyone else's record.
-- ---------------------------------------------------------------------------

create table training_modules (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  title        text not null,
  description  text,
  sort_order   integer not null default 100,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now()
);

create index on training_modules (workspace_id) where not is_archived;

create table training_videos (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  module_id    uuid not null references training_modules on delete cascade,
  title        text not null,
  -- The raw YouTube URL as pasted; the embed URL is derived at render time
  -- by the same lib the content dashboards use (videoEmbed.ts).
  youtube_url  text not null,
  sort_order   integer not null default 100,
  created_at   timestamptz not null default now()
);

create index on training_videos (module_id, sort_order);

create table training_assignments (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  module_id    uuid not null references training_modules on delete cascade,
  user_id      uuid not null references profiles on delete cascade,
  assigned_by  uuid references profiles on delete set null,
  created_at   timestamptz not null default now(),
  unique (module_id, user_id)
);

create index on training_assignments (user_id);
create index on training_assignments (module_id);

create table training_completions (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  video_id     uuid not null references training_videos on delete cascade,
  user_id      uuid not null references profiles on delete cascade,
  completed_at timestamptz not null default now(),
  unique (video_id, user_id)
);

create index on training_completions (user_id);
create index on training_completions (video_id);

alter table training_modules     enable row level security;
alter table training_videos      enable row level security;
alter table training_assignments enable row level security;
alter table training_completions enable row level security;

-- A member sees a module -- and its videos -- only once assigned to it.
create policy training_modules_select on training_modules for select to authenticated
  using (
    can_manage_workspace(workspace_id)
    or exists (
      select 1 from training_assignments a
      where a.module_id = training_modules.id and a.user_id = auth.uid()
    )
  );
create policy training_modules_write on training_modules
  for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy training_videos_select on training_videos for select to authenticated
  using (
    can_manage_workspace(workspace_id)
    or exists (
      select 1 from training_assignments a
      where a.module_id = training_videos.module_id and a.user_id = auth.uid()
    )
  );
create policy training_videos_write on training_videos
  for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

create policy training_assignments_select on training_assignments for select to authenticated
  using (can_manage_workspace(workspace_id) or user_id = auth.uid());
create policy training_assignments_write on training_assignments
  for all to authenticated
  using (can_manage_workspace(workspace_id))
  with check (can_manage_workspace(workspace_id));

-- Completions: managers read all (the progress page); a member reads and
-- writes only their own, and only inside a module they hold an assignment
-- for. No member delete -- a course does not go backwards; resets are a
-- manager action.
create policy training_completions_select on training_completions for select to authenticated
  using (can_manage_workspace(workspace_id) or user_id = auth.uid());
create policy training_completions_insert on training_completions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from training_videos v
      join training_assignments a on a.module_id = v.module_id
      where v.id = training_completions.video_id
        and a.user_id = auth.uid()
    )
  );
create policy training_completions_delete on training_completions for delete to authenticated
  using (can_manage_workspace(workspace_id));
