-- YouTube Shorts as its own platform, not a flag on a YouTube post.
--
-- The reason is view_semantics, and it is the whole argument. A long-form
-- YouTube view is counted after roughly 30 seconds of watching. A Shorts view
-- is counted on impression, as the clip starts. Those are different events
-- wearing the same word, and the entire per-platform model exists to stop
-- exactly that kind of pooling. A boolean on platform_posts would put both
-- units in one bucket and force every rollup to special-case it forever.
--
-- maturity_window_days is 7 rather than YouTube's 28 because Shorts resolve
-- fast: judging one at 28 days measures a tail that has long stopped moving,
-- and would make Shorts look worse than they were by comparing a settled
-- number against long-form still climbing.
--
-- auth_model 'none' matches the YouTube row: this reads the same public API
-- with the same key. No OAuth is introduced, and the schema constraint that
-- forbids it is untouched.
--
-- Existing data is NOT reclassified, because there is none to reclassify --
-- Shorts have been discarded at discovery since the feature was written, so
-- no YouTube post in this database is secretly a Short. Introducing the
-- platform therefore moves no number anyone has been reading.
insert into platforms
  (slug, display_name, auth_model, supports_public_read, view_semantics,
   available_metrics, scoring_config, maturity_window_days, sort_order, is_enabled)
values
  ('youtube_shorts', 'YouTube Shorts', 'none', true, 'immediate',
   '["views","likes","comments"]'::jsonb,
   -- Mirrors the YouTube row's shape. Shorts expose no impressions or
   -- avg_watch_seconds publicly, so roles that would be scored on those fall
   -- back to views rather than being silently scored on something else.
   '{"idea":"views","script":"views","editor":"views","qc":"comment_sentiment"}'::jsonb,
   7, 35, true)
on conflict (slug) do nothing;

comment on table platforms is
  'Platform registry. view_semantics is load-bearing: youtube counts a view '
  'at ~30s, youtube_shorts counts one on impression, tiktok immediately. '
  'Never compare or sum view counts across rows of this table.';
