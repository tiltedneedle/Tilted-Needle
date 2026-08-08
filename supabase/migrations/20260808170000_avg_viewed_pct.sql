-- Average percentage viewed: the single most useful owner-only number, and
-- the half of the click-versus-stay reading that no public API serves
-- (PRD-video-intelligence §5.8).
--
-- post_analytics already carried retention_30s and retention_60s -- two fixed
-- points on a curve -- plus retention_curve for the full shape where an export
-- provides it. Neither is what a Studio export actually leads with. "Average
-- percentage viewed" is one number, present in every export, and it answers
-- "did it hold them" directly. Paired with ctr it separates the two failure
-- modes that look identical from outside: nobody clicked, versus everybody
-- clicked and left.

alter table post_analytics
  add column if not exists avg_viewed_pct numeric;

comment on column post_analytics.avg_viewed_pct is
  'Average percentage viewed, 0..1. From a client-supplied export -- never '
  'derivable from public data. With ctr, distinguishes a packaging failure '
  '(low CTR, high retention) from an over-promise (high CTR, low retention).';

-- Both halves of that diagnosis are only meaningful in range.
alter table post_analytics
  add constraint post_analytics_avg_viewed_pct_range
  check (avg_viewed_pct is null or (avg_viewed_pct >= 0 and avg_viewed_pct <= 1));

alter table post_analytics
  add constraint post_analytics_ctr_range
  check (ctr is null or (ctr >= 0 and ctr <= 1));
