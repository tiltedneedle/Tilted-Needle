-- ---------------------------------------------------------------------------
-- Client guidelines and the per-client editor kit
--
-- The brand rules for each client currently live in a pile of Google Docs that
-- only some of the team can open, and the reusable bits an editor needs on
-- every single video -- the CTA wording, the outro sting, the logo, the arrow
-- graphics, the SFX pack -- are scattered across Drive folders and DMs. Both
-- belong next to the client they describe, in the tool the work already
-- happens in.
--
-- Two tables rather than one, because they answer different questions and are
-- edited at different rhythms:
--
--   client_guideline_sections -- prose. "How should this client sound?"
--   client_assets             -- things you drop into a timeline. "What do I
--                                paste at the end of the video?"
--
-- Sections are rows, not columns, on purpose. A fixed column per section would
-- mean a migration every time someone wants to add "Sponsorship rules" for one
-- client, and no two clients in this roster need the same set: a laser eye
-- clinic carries medical-claim restrictions that a bakery does not.
-- ---------------------------------------------------------------------------

-- Clients gain a face and a pointer back to the source of truth. image_url is
-- a path or URL rather than a stored blob -- there is no storage bucket wired
-- up yet, and the guideline page falls back to a coloured monogram whenever it
-- is null, so an empty column is a complete, presentable state.
alter table clients
  add column if not exists image_url text,
  add column if not exists guideline_doc_url text;

comment on column clients.image_url is
  'Client photo or logo shown on the guidelines grid. Null renders a monogram fallback, so this is optional by design.';
comment on column clients.guideline_doc_url is
  'Link to the client''s source guideline document. The in-app sections are the working copy; this is where they came from.';

create table if not exists client_guideline_sections (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  client_id    uuid not null references clients on delete cascade,
  title        text not null,
  body         text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references profiles on delete set null
);

-- Every read is "this client's sections, in order".
create index if not exists client_guideline_sections_client_idx
  on client_guideline_sections (client_id, sort_order);

create table if not exists client_assets (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  client_id    uuid not null references clients on delete cascade,
  -- Free text rather than an enum: the kinds below are what the editors named
  -- when asked, but a new client will want something nobody has thought of,
  -- and widening an enum needs a migration where this needs a dropdown entry.
  -- Known kinds: cta, outro, hook, logo, lower_third, arrow, sfx, music,
  -- transition, subtitle, font, colour, broll, endcard, watermark, template,
  -- thumbnail, other.
  kind         text not null default 'other',
  label        text not null,
  -- An asset is either words or a file, and often both: a CTA has copy to read
  -- out AND a graphic to overlay. Keeping both columns avoids modelling the
  -- same concept twice.
  body         text,
  url          text,
  notes        text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references profiles on delete set null
);

create index if not exists client_assets_client_idx
  on client_assets (client_id, kind, sort_order);

alter table client_guideline_sections enable row level security;
alter table client_assets enable row level security;

-- Guidelines are reference material the whole team reads constantly and edits
-- occasionally. Members can write: an editor who spots that the CTA changed
-- should fix it in the moment rather than wait for a manager, which is the
-- behaviour that keeps the page trustworthy. Deletion stays with managers,
-- matching content_items -- losing a client's brand rules to a stray click is
-- not a recoverable mistake.
create policy guideline_sections_select on client_guideline_sections for select to authenticated
  using (is_workspace_member(workspace_id));
create policy guideline_sections_insert on client_guideline_sections for insert to authenticated
  with check (is_workspace_member(workspace_id));
create policy guideline_sections_update on client_guideline_sections for update to authenticated
  using (is_workspace_member(workspace_id));
create policy guideline_sections_delete on client_guideline_sections for delete to authenticated
  using (can_manage_workspace(workspace_id));

create policy client_assets_select on client_assets for select to authenticated
  using (is_workspace_member(workspace_id));
create policy client_assets_insert on client_assets for insert to authenticated
  with check (is_workspace_member(workspace_id));
create policy client_assets_update on client_assets for update to authenticated
  using (is_workspace_member(workspace_id));
create policy client_assets_delete on client_assets for delete to authenticated
  using (can_manage_workspace(workspace_id));
