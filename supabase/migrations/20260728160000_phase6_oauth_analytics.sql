-- Phase 6: OAuth connections and owner-only analytics.
--
-- PRD section 4 is explicit about the constraint this phase exists to
-- resolve: public metrics (Phase 2) can say a post boosted, never why. CTR
-- and retention isolate the idea/thumbnail work from the script/edit work,
-- and both require the account owner's consent. This migration adds the
-- connection itself and a place for that richer data to live -- it does not
-- pretend the constraint goes away.
--
-- Refresh tokens are the crown jewels: a leak exposes a client's analytics.
-- They are stored in Supabase Vault, never in a plain column, and the
-- decrypted view is readable only by the service role -- no RLS policy here
-- can expose it to a browser client even by mistake.

create table oauth_connections (
  id               uuid primary key default uuid_generate_v4(),
  workspace_id     uuid not null references workspaces on delete cascade,
  account_id       uuid not null references accounts on delete cascade,
  provider         text not null,
  -- Points at a row in vault.secrets holding the refresh token. The token
  -- itself never appears in this table or in any RLS-governed view.
  vault_secret_id  uuid,
  scopes           text[] not null default '{}',
  status           text not null default 'active', -- active | revoked | error
  last_error       text,
  connected_by     uuid references profiles on delete set null,
  connected_at     timestamptz not null default now(),
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  unique (account_id)
);

create index on oauth_connections (workspace_id);

-- Owner-only metrics: impressions, CTR, retention, watch time. Kept as a
-- separate table from post_snapshots (public metrics) rather than extra
-- columns on it, because the two have entirely different availability and
-- trust boundaries -- one is guessable from a public API, the other requires
-- a human to click "allow."
create table post_analytics (
  id                 uuid primary key default uuid_generate_v4(),
  workspace_id       uuid not null references workspaces on delete cascade,
  platform_post_id   uuid not null references platform_posts on delete cascade,
  captured_at        timestamptz not null default now(),
  impressions        bigint,
  ctr                numeric,          -- 0..1
  avg_watch_seconds  numeric,
  retention_30s      numeric,          -- 0..1, viewers remaining at 30s
  retention_60s      numeric,
  retention_curve    jsonb,            -- [{t: seconds, pct: 0..1}, ...]
  traffic_sources    jsonb,
  subscribers_gained integer,
  -- 'oauth' once a real sync exists; 'manual' lets a client's own Studio
  -- export unlock scoring today, without waiting on Phase 6 credentials.
  source             text not null default 'manual'
);

create index on post_analytics (platform_post_id, captured_at desc);

alter table platforms
  add column oauth_configured boolean not null default false;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table oauth_connections enable row level security;
alter table post_analytics    enable row level security;

-- Connections carry no plaintext secret, but the account list and status are
-- still operationally sensitive -- manager-only, same as the rest of Phase 6.
create policy oauth_connections_all on oauth_connections for all to authenticated
  using (can_manage_workspace(workspace_id) and not is_client_user(workspace_id))
  with check (can_manage_workspace(workspace_id) and not is_client_user(workspace_id));

-- Analytics inherit the content item's client scoping, exactly like
-- post_snapshots -- a client with a connected account should see their own
-- richer numbers, not everyone's.
create policy post_analytics_select on post_analytics for select to authenticated
  using (
    exists (
      select 1
      from platform_posts pp
      join content_items ci on ci.id = pp.content_item_id
      where pp.id = post_analytics.platform_post_id
        and can_read_client(ci.workspace_id, ci.client_id)
    )
  );

create policy post_analytics_insert on post_analytics for insert to authenticated
  with check (is_workspace_member(workspace_id) and not is_client_user(workspace_id));

create policy post_analytics_delete on post_analytics for delete to authenticated
  using (can_manage_workspace(workspace_id));
