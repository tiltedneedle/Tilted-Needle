-- Correct the recorded meaning of platform_posts.has_captions.
--
-- The previous migration introduced it as a pre-check: skip the transcript
-- fetch for any video YouTube says has no captions, and save a blockable
-- request. Testing that against the live library disproved it.
--
-- All 11 YouTube videos report contentDetails.caption = "false", yet the
-- first one probed carries a full English track of kind "asr". The API field
-- reflects MANUALLY UPLOADED caption tracks only; auto-generated ones are not
-- counted. Had the queue gated on it, every video in the workspace would have
-- been skipped and the transcript corpus would have stayed empty -- while
-- every test still passed, because the flag was faithfully stored.
--
-- The column keeps its value, with a different job: it distinguishes a
-- human-written transcript from a machine-generated one. That is a QUALITY
-- signal worth having -- ASR mangles names, brands and accents, which is
-- exactly the vocabulary a marketing corpus is searched for -- but it is not
-- an availability signal and must never gate the queue.

comment on column platform_posts.has_captions is
  'TRUE = a manually uploaded caption track exists (human-written, high quality). '
  'FALSE = none uploaded, but auto-generated captions usually still exist and ARE '
  'fetchable -- verified against the live library. NULL = not yet checked. '
  'Never use FALSE to skip a transcript fetch: it reflects uploaded tracks only.';

comment on column platform_posts.posted_at_ts is
  'Full publication instant. posted_at keeps the date-only form that filtering '
  'depends on. Captured at discovery because the hour cannot be recovered later.';

comment on column content_items.topic_labels is
  'YouTube topicDetails.topicCategories, reduced to bare labels. A cross-check on '
  'model-derived topics from a source that is not the model.';
