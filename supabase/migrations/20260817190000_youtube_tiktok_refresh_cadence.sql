-- YouTube and TikTok get a refresh cadence. Until now they had none at all.
--
-- THE BUG THIS FIXES
--
-- scrape_schedule only ever had rows for Instagram. findDuePosts() opens with:
--
--     if (bands.length === 0) return { due: [], retire: [] };
--
-- so for youtube and tiktok it returned an empty due-set on every single run.
-- Those posts were never re-read on a schedule. The data says so plainly:
--
--     instagram   145 posts   145 ever re-scraped
--     tiktok      144 posts     2 ever re-scraped
--     youtube      80 posts     3 ever re-scraped
--
-- They still accumulated snapshots (829 and 142) because DISCOVERY writes one
-- per post it lists -- but discovery sits behind a 10-day per-account cooldown
-- and only covers an account's recent uploads. So the numbers on an older
-- video were frozen from whenever discovery last happened to see it, and
-- nothing in the UI said so.
--
-- WHY TWICE A DAY IS AFFORDABLE HERE, WHERE IT WOULD NOT BE FOR INSTAGRAM
--
-- Refreshing a KNOWN post is free on both platforms:
--   - TikTok: capability.isMetered is false and only discoveryMetered is true.
--     Apify bills per row RETURNED BY A DISCOVERY RUN. Reading a known video's
--     numbers afterwards costs nothing, which is the whole shape of that
--     integration.
--   - YouTube: videos.list costs 1 quota unit against a 10,000/day free
--     allowance. 80 posts twice a day is 160 units -- 1.6% of quota.
--
-- Instagram is deliberately NOT given this cadence: its only route is the
-- metered Apify read, where every refresh costs real money. Its existing
-- 1/3/10/14-day taper stays exactly as it is.
--
-- CADENCE, AND WHY IT TAPERS RATHER THAN STAYING FLAT
--
-- 0.5 days = twice a day, as asked, for the first six months. That covers the
-- entire window in which a video's numbers actually move.
--
-- After six months it drops to daily rather than stopping. A three-year-old
-- video whose views change by single digits does not need 730 reads a year,
-- and every read is a row in post_snapshots -- but tracking never RETIRES,
-- because an evergreen video that suddenly moves is exactly the signal this
-- product exists to catch. Retirement is what the absence of a band means, and
-- neither platform gets one.
--
-- Storage, so the trade is explicit: ~224 youtube+tiktok posts at twice a day
-- is ~163k rows/year, roughly 50 MB against Supabase's 500 MB free ceiling.
--
-- WHAT THIS DOES NOT CHANGE
--
-- Hitting "sync" five times in a row still does NOT write five times the
-- history. findDuePosts gates every read on `sinceDays >= interval`, so runs
-- two through five find nothing due and write nothing. The schedule controls
-- write volume; the button does not.

insert into scrape_schedule (platform_slug, min_age_days, max_age_days, interval_days)
values
  -- Twice a day while a video is live enough for its numbers to move.
  ('youtube',       0, 180, 0.5),
  ('tiktok',        0, 180, 0.5),
  ('youtube_shorts', 0, 180, 0.5),
  -- Then daily, forever. No upper bound means never retired.
  ('youtube',       180, null, 1),
  ('tiktok',        180, null, 1),
  ('youtube_shorts', 180, null, 1)
on conflict (platform_slug, min_age_days) do update
  set max_age_days  = excluded.max_age_days,
      interval_days = excluded.interval_days;
