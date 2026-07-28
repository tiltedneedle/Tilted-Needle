/**
 * Pure parsing logic split out from clockify.ts specifically so it is
 * testable outside Next.js's bundler: clockify.ts imports "server-only",
 * which throws unconditionally when required directly by plain Node (the
 * bundler is what strips it for server contexts) -- exactly the kind of
 * thing scoring.ts and billing.ts already keep separate from I/O for the
 * same reason.
 */

/** Clockify durations are ISO 8601 ("PT1H30M"), not seconds. */
export function parseIsoDuration(iso: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}
