-- Record a competitor's SCALE, so an unreachable one can be told apart from a
-- comparable one.
--
-- rel_index already made the NUMBERS comparable: a rival's post is scored
-- against that rival's own median, so "1.7x their norm" means the same thing
-- as "1.7x yours" regardless of follower counts. What it does not do -- and
-- what a first pass got wrong -- is say whether the TACTICS transfer.
--
-- Proven on real data: MrBeast sampled at a 110,000,000 median. His best post
-- was 1.70x his own norm, which is a perfectly valid figure, and it reached
-- the idea prompt as "Last To Leave Grocery Store, Wins $250,000" -- next to
-- an instruction asking for ideas shootable by a small team within a week.
-- The arithmetic was right and the suggestion was useless, because a channel
-- four orders of magnitude away is not a competitor, it is a different sport.
--
-- median_views is the competitor's own baseline, which the scan already
-- computes to derive rel_index and previously discarded. Stored, it lets the
-- app compare that median against the CLIENT's median and refuse to treat a
-- 9000x-larger account as a peer.
alter table competitors
  add column if not exists median_views bigint,
  add column if not exists sample_size integer;

comment on column competitors.median_views is
  'This competitor''s own median views over the sample. Used to compare their '
  'SCALE against the client''s -- rel_index makes numbers comparable, this '
  'makes relevance checkable.';
