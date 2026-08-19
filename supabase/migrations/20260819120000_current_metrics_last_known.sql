-- post_current_metrics: carry the last KNOWN value, not the last row.
--
-- The view was `distinct on (platform_post_id) ... order by captured_at desc`,
-- which takes the most recent ROW and every column from it. So a snapshot that
-- recorded some columns and not others -- a provider returning likes but no
-- view count, a partial refresh -- replaced good numbers with nulls for every
-- column it happened to miss.
--
-- Three live posts read views = NULL today while carrying 13,464, 566 and
-- 2,310 views in a snapshot a day or two earlier. Nothing was lost; the view
-- simply stopped looking once it found the newest row. Those posts show a gap
-- on /content, contribute nothing to any reach total, and cannot be ranked in
-- a client report.
--
-- Now each column independently takes its most recent NON-NULL reading, so a
-- gap in one metric can no longer blank the others.
--
-- captured_at becomes "when we last looked at this post", which is the honest
-- reading once the values may come from different snapshots. Anything needing
-- the instant a SPECIFIC figure was taken has to read post_snapshots, which is
-- the table that can answer it.
--
-- A null here now means the metric has never been recorded at all, which is a
-- fact worth being able to state -- and is what the app already assumes it
-- means everywhere it checks.

begin;

create or replace view post_current_metrics
with (security_invoker = on) as
select
  s.platform_post_id,
  max(s.captured_at) as captured_at,
  -- Most recent non-null, per column. FILTER drops the nulls before ordering,
  -- so [1] is the newest reading that actually said something.
  (array_agg(s.views             order by s.captured_at desc)
     filter (where s.views is not null))[1]             as views,
  (array_agg(s.likes             order by s.captured_at desc)
     filter (where s.likes is not null))[1]             as likes,
  (array_agg(s.comments          order by s.captured_at desc)
     filter (where s.comments is not null))[1]          as comments,
  (array_agg(s.shares            order by s.captured_at desc)
     filter (where s.shares is not null))[1]            as shares,
  (array_agg(s.saves             order by s.captured_at desc)
     filter (where s.saves is not null))[1]             as saves,
  (array_agg(s.reach             order by s.captured_at desc)
     filter (where s.reach is not null))[1]             as reach,
  (array_agg(s.avg_watch_seconds order by s.captured_at desc)
     filter (where s.avg_watch_seconds is not null))[1] as avg_watch_seconds
from post_snapshots s
group by s.platform_post_id;

comment on view post_current_metrics is
  'Latest KNOWN value per metric per post. Each column takes its most recent non-null snapshot independently, so a partial reading cannot blank a figure that was measured earlier. captured_at is when the post was last looked at, not when any one figure was taken -- read post_snapshots for that.';

commit;
