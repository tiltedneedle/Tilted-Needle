-- Retire the per-platform transcription item-pools.
--
-- transcription_budget replaced them the same day they were added, and the
-- reason is worth keeping: they counted ITEMS, and an item is not a unit of
-- anything here. A TikTok transcript costs $0.001 and an Instagram one
-- $0.005, so "400 tiktok / 300 instagram" was a budget whose real value
-- depended entirely on which platform happened to come up.
--
-- The columns are ZEROED rather than dropped. Dropping them would rewrite
-- history -- used_transcription still records what the old pools actually
-- spent -- and a zero limit is already the correct behaviour for a pool
-- nothing claims from any more: scrapeBudget.status defaults it to 0, and
-- claim() grants nothing against a zero limit.
update scrape_budgets set limit_transcription = 0 where limit_transcription > 0;

comment on column scrape_budgets.limit_transcription is
  'RETIRED. Superseded by transcription_budget, which counts micro-dollars '
  'across all platforms instead of items per platform. Kept at zero so the '
  'historical used_transcription figures remain readable.';
