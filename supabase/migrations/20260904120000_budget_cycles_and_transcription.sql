-- Align budget cycles to the Apify accounts that actually pay, and give
-- transcription its own pool.
--
-- ============================ THE CYCLE BUG ============================
-- Budget periods were calendar months (date_trunc('month')). The Apify
-- accounts that fund them are not:
--
--   tilted_Needle        (APIFY_TOKEN)        resets the 28th
--   palatial_lemongrass  (APIFY_TIKTOK_TOKEN) resets the 11th
--
-- So on 1 September the app handed itself a fresh allowance while
-- palatial_lemongrass still had ten days of its cycle to run on already-spent
-- credit. The app's ledger said "full month available"; Apify's said "$0.74
-- of $5 gone, ten days left". A budget that resets on a different day from
-- the money it is tracking is not a budget, it is a coincidence.
--
-- cycle_anchor_day pins each platform's period to the day its funding account
-- resets. Nullable, and null keeps the old calendar-month behaviour, so any
-- platform not funded by Apify is unaffected.
--
-- ====================== MEASURED COSTS, NOT GUESSES ====================
-- Read from Apify's own run history on 2026-09-04, because the store API
-- reports pricePerUnitUsd as undefined for both actors in use:
--
--   apify/instagram-scraper    100 runs  $0.5103  -> $0.0051 per RUN
--   clockworks/tiktok-scraper   10 runs  $0.4503  -> $0.0450 per RUN
--
-- Cost is per RUN, not per item, and a run carries many items -- TikTok's 200
-- discovery items came from ~10 runs, so roughly $0.00225 an item. The pools
-- below count ITEMS, so they are a proxy for spend rather than a measure of
-- it. That is why the real guard is Apify's own $5 hard cap and the meter now
-- shown on the Data sync page, not these numbers.
--
-- ========================== THE NEW ALLOCATION =========================
-- Reasoning per platform, against the ~$4.02 and ~$1.81 genuinely spare
-- (projection, not balance -- see lib/apifyUsage):
--
--   TIKTOK, funded by palatial_lemongrass:
--     discovery 200 -> 800. It was EXHAUSTED at 200/200, and discovery is the
--       only way a new TikTok video enters the system at all -- yt-dlp's
--       TikTok extractors are broken upstream. 800 items ~= $1.80.
--     auto 1400 -> 300. Re-reading a known post is the cheapest thing to give
--       up and the least urgent; it buys the headroom the other pools need.
--     transcription 400 ~= $0.40 at the measured $0.001 per transcript.
--     Total new ceiling ~$2.20 against $4.02 spare, leaving real buffer.
--
--   INSTAGRAM, funded by tilted_Needle (only $1.81 genuinely spare):
--     auto 1400 -> 400. This is a REDUCTION in spend and the point of the
--       exercise: automatic churn was crowding out the manual reads someone
--       actually waits on.
--     manual 200 -> 600. What a person presses "refresh" for should not be
--       rationed by what the scheduler already spent.
--     transcription 300 ~= $0.30.
--
--   YOUTUBE: free to read, so auto/discovery/manual stay generous. Its
--     transcription pool exists only as a fallback for when the desktop
--     yt-dlp route is unavailable.
--
-- ==================== WHY TRANSCRIPTION IS ITS OWN POOL ================
-- Sharing a pool with discovery means a busy discovery month silently stops
-- transcribing, and the symptom is a corpus that quietly stops growing while
-- every dashboard still looks healthy. Transcription is the input the whole
-- analysis layer reads; it gets a ring-fenced allowance so it cannot be
-- starved by work that merely looks more urgent.

alter table scrape_budgets
  add column if not exists limit_transcription integer not null default 0,
  add column if not exists used_transcription  integer not null default 0,
  add column if not exists cycle_anchor_day    integer;

alter table scrape_budgets
  drop constraint if exists scrape_budgets_anchor_valid;
alter table scrape_budgets
  add constraint scrape_budgets_anchor_valid
  check (cycle_anchor_day is null or cycle_anchor_day between 1 and 28);

comment on column scrape_budgets.cycle_anchor_day is
  'Day of month this platform''s budget resets, matching the Apify account '
  'that funds it. NULL = calendar month. Capped at 28 so every month has the '
  'day -- anchoring to the 31st would skip February entirely.';

comment on column scrape_budgets.limit_transcription is
  'Ring-fenced transcript fetches. Separate from discovery so a busy '
  'discovery month cannot silently stop the corpus growing.';
