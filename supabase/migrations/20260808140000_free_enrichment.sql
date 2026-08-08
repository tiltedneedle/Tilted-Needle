-- Persist what the sync already fetches and throws away
-- (PRD-video-intelligence §3.2).
--
-- Every column here is filled from a call the pipeline ALREADY makes.
-- videos.list costs one quota unit whether you ask it for one part or four,
-- so widening the existing request is free -- and two of these materially
-- change later phases:
--
--   has_captions  is a pre-check. Transcripts come from an undocumented,
--                 IP-blockable endpoint, so the cheapest possible request is
--                 the one we never send: a video YouTube says has no captions
--                 is never queued (PRD §9).
--
--   posted_at_ts  cannot be recovered later. The API returns a full ISO
--                 timestamp and the pipeline currently slices it to a date,
--                 discarding the hour forever. Time-of-day analysis (§5.4) is
--                 impossible without it, and no backfill can restore what was
--                 never stored.

alter table platform_posts
  -- NULL = not yet checked. False = YouTube says there is no caption track,
  -- so a transcript fetch would be wasted. True = worth queueing.
  add column if not exists has_captions boolean,
  -- Full publication instant, kept beside the existing date column rather
  -- than replacing it: posted_at is a date across every platform and a great
  -- deal of filtering depends on it staying one.
  add column if not exists posted_at_ts timestamptz;

alter table content_items
  -- The video description. Free corpus text, and where chapter timestamps
  -- live when a creator writes them.
  add column if not exists description text,
  -- YouTube's own topic labels (topicDetails.topicCategories), stored as the
  -- final path segment of each Wikipedia URL. A free cross-check on
  -- model-derived topics, from a source that is not the model.
  add column if not exists topic_labels text[];

-- Finding the next batch of posts to check captions for is a hot path for
-- the ingest worker, and it is always the same question: which YouTube posts
-- have we not looked at yet.
create index if not exists platform_posts_captions_unchecked
  on platform_posts (workspace_id)
  where has_captions is null;
