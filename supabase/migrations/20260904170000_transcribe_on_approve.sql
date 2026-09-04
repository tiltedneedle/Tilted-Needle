-- Approving a video queues its transcription. Automatically, in the database.
--
-- WHY A TRIGGER AND NOT THREE CODE EDITS. A video reaches 'approved' from at
-- least three places today -- typed in by hand, pasted as a link, and bulk
-- approved from the review queue -- and the sync will add more. Patching each
-- call site means the next path silently skips transcription, and the symptom
-- is invisible: a corpus that quietly stops keeping up while every screen
-- still looks healthy. The state change is the event, so the state change is
-- what fires.
--
-- This is what makes the lane genuinely autonomous. There is no "run
-- transcription" button because there is nothing for it to do: by the time
-- anyone looks, the transcript is either stored or queued behind a budget
-- that resets on a known date.
--
-- IT ONLY EVER ENQUEUES. No fetching, no spending, no HTTP from a trigger --
-- it writes one row and returns. The worker still checks the budget, still
-- checks for an existing transcript, and still decides whether the video is
-- reachable at all.

create or replace function queue_transcript_on_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the transition INTO approved. An update that leaves an
  -- already-approved row approved must not re-queue it on every edit.
  if new.review_state is distinct from 'approved' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.review_state is not distinct from 'approved' then
    return new;
  end if;

  -- Already has words: nothing to buy.
  if exists (
    select 1 from video_transcripts t where t.content_item_id = new.id
  ) then
    return new;
  end if;

  -- Already queued, running, or settled. `unavailable` is included on
  -- purpose: it means the worker already established this video has no
  -- transcript available, and re-queueing would pay to be told again.
  if exists (
    select 1 from ingest_jobs j
    where j.kind = 'transcript_apify'
      and j.subject_id = new.id
      and j.status in ('pending', 'running', 'unavailable')
  ) then
    return new;
  end if;

  insert into ingest_jobs (workspace_id, kind, subject_id, priority)
  values (new.workspace_id, 'transcript_apify', new.id, 50);

  return new;
end;
$$;

drop trigger if exists trg_queue_transcript_on_approve on content_items;

create trigger trg_queue_transcript_on_approve
after insert or update of review_state on content_items
for each row
execute function queue_transcript_on_approve();

comment on function queue_transcript_on_approve is
  'Queues transcript_apify when a video becomes approved. A trigger rather '
  'than call-site code because approval happens from several paths and a '
  'missed one fails silently.';
