-- Retire OAuth entirely (PRD-video-intelligence §0).
--
-- The agency does not and will not hold owner credentials for client
-- channels, so the connect flow is not "unfinished" -- it is impossible, and
-- leaving its machinery in place would be a lie in the schema plus a dormant
-- credential surface nobody is watching.
--
-- The owner-only metrics OAuth existed to fetch are NOT abandoned: they now
-- arrive through a client-supplied Studio/Insights export (PRD §2), which is
-- the path post_analytics.source = 'manual' was designed for from the start.
-- post_analytics itself is untouched and becomes more important, not less.

-- 1. The connection table and its Vault plumbing.
--    Any refresh tokens still referenced here should be revoked at the
--    provider as well; dropping the rows only removes our copy.
drop table if exists oauth_connections;
drop function if exists vault_store_refresh_token(text, text);

-- 2. The platform-level flag that only ever gated the connect button.
alter table platforms drop column if exists oauth_configured;

-- 3. auth_model described how a platform authenticates an OWNER. With that
--    route gone the only distinction we act on is whether public metrics can
--    be read at all, which supports_public_read already answers. Values are
--    collapsed rather than dropped so the column keeps a truthful meaning
--    for anything still selecting it.
update platforms set auth_model = 'none' where auth_model in ('oauth', 'oauth_review');
alter table platforms alter column auth_model set default 'none';
alter table platforms add constraint platforms_auth_model_no_oauth
  check (auth_model = 'none');

-- 4. Make the retired source value unrepresentable. A future contributor
--    cannot quietly reintroduce an OAuth ingest path without first removing
--    this constraint, which is a decision rather than an accident.
--    'manual' = typed by hand, 'import' = parsed from a client export,
--    'vision' = extracted from a screenshot and human-confirmed (PRD §2.1).
update post_analytics set source = 'manual' where source = 'oauth';
alter table post_analytics add constraint post_analytics_source_no_oauth
  check (source in ('manual', 'import', 'vision'));

-- 5. accounts.connection_mode kept 'oauth' as a possible value for the same
--    dead reason. Collapse to the two that remain real.
update accounts set connection_mode = 'manual' where connection_mode = 'oauth';
alter table accounts add constraint accounts_connection_mode_valid
  check (connection_mode in ('manual', 'api'));
