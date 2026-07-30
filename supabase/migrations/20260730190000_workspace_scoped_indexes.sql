-- ---------------------------------------------------------------------------
-- Missing workspace_id indexes on the two busiest tables
--
-- post_snapshots and content_assignments are both filtered by
-- .eq("workspace_id", ws) directly in hot paths (loadContentOverview,
-- computeRankings -- which runs on the Content dashboard, the People
-- dashboard, and every single video page -- and the channel dashboard), and
-- RLS additionally evaluates is_workspace_member(workspace_id) on every row
-- of every query against them regardless. Neither table had an index with
-- workspace_id as a leading column: post_snapshots only had
-- (platform_post_id, captured_at desc), content_assignments only
-- (content_item_id) and (user_id) separately. Every one of those workspace-
-- scoped reads was a full sequential scan.
--
-- post_snapshots is the one that matters most long-term: it's an
-- append-only time series (one row per metric check per post) that only
-- grows, unlike every other table here. content_assignments just crossed
-- 1000 rows on the live workspace and is read on nearly every page.
-- ---------------------------------------------------------------------------

create index if not exists post_snapshots_workspace_captured_idx
  on post_snapshots (workspace_id, captured_at desc);

create index if not exists content_assignments_workspace_idx
  on content_assignments (workspace_id);
