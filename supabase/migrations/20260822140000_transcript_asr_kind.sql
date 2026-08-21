-- Allow 'transcript_asr' as an ingest job kind.
--
-- WHY A SECOND TRANSCRIPT KIND RATHER THAN A FLAG
--
-- Kinds in this queue are split BY IP REPUTATION, not by tidiness -- that is
-- the stated rule in worker/index.mjs, and it is why the Oracle host runs with
-- `--kinds=comments,analyse,vision_extract,weekly_read` and deliberately omits
-- transcripts. YouTube refuses that datacenter address outright, so a worker
-- there can do the safe work unattended while caption fetching waits for a
-- host with an address worth using.
--
-- Reading a video's AUDIO turns out to sit on the other side of that line.
-- Measured from the Oracle box before this was built: Instagram hands over an
-- audio stream to the same address that YouTube refuses -- 8 formats, 1
-- audio-only, no cookies, no proxy. So ASR is safe work on cheap infrastructure
-- and captions are not, which is exactly the distinction the kind column
-- already encodes.
--
-- Sharing one 'transcript' kind would force the worse of both worlds. Enabling
-- it on the Oracle host lets it claim YouTube jobs it cannot do, and the first
-- one earns a bot challenge, which throws `blocked` and cools the WHOLE kind
-- for two hours -- stalling 146 Instagram items that were never in any
-- difficulty. Leaving it disabled leaves those 146 needing a desktop to be
-- awake. A separate kind lets each run where it actually works.
--
-- The handler is deliberately the SAME function. transcript() already routes an
-- item with no caption-bearing platform to the audio lane, so registering it
-- under both names adds a routing rule and no duplicated logic.

alter table ingest_jobs drop constraint if exists ingest_jobs_kind_valid;

alter table ingest_jobs add constraint ingest_jobs_kind_valid
  check (kind in (
    'comments', 'transcript', 'replay', 'analyse', 'weekly_read',
    'vision_extract', 'ig_caption', 'transcript_asr'
  ));

-- Document the fourth source value the ASR lane writes. The column has no
-- CHECK constraint -- deliberately, since sources accrete -- so the comment is
-- the only place the vocabulary is recorded.
comment on column video_transcripts.source is
  '''public'' = the platform''s own caption track; ''manual'' = pasted by a '
  'human; ''import'' = came in with a client''s export; ''asr'' = read from the '
  'audio because the platform publishes no captions. An ''asr'' row has passed '
  'gateAsrResult, which rejects the phrases Whisper invents from silence.';
