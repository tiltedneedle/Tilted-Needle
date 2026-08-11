/** Clockify-style HH:MM:SS. Hours are not capped at 24. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Compact form for summaries: "7h 30m", "45m", "36s". */
export function formatDurationShort(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  // Sub-minute totals show seconds; "0m" reads as a bug.
  if (!m) return `${s}s`;
  return `${m}m`;
}

/**
 * Compact counts for dense tiles: 1234 -> "1.2k", 10235865 -> "10.2M".
 *
 * Exact figures stay on the detail views and in the CSV exports. A video tile
 * carries three metrics per platform, and at four significant digits each the
 * row stops being scannable -- which is the only thing a tile is for.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const [value, suffix] = abs < 1_000_000 ? [n / 1000, "k"] : [n / 1_000_000, "M"];
  // Three digits before the decimal is already wide enough; drop the fraction.
  const text = Math.abs(value) >= 100 ? String(Math.round(value)) : value.toFixed(1);
  return `${text.replace(/\.0$/, "")}${suffix}`;
}

export function entrySeconds(
  entry: { started_at: string; ended_at: string | null; duration_seconds: number | null },
  now = Date.now(),
): number {
  if (entry.duration_seconds != null) return entry.duration_seconds;
  return Math.floor((now - new Date(entry.started_at).getTime()) / 1000);
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Local YYYY-MM-DD. Never use toISOString here -- it shifts across midnight. */
export function dayKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDayHeading(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400e3));
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

/** Monday-based week start, matching the timesheet grid. */
export function startOfWeek(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
}

export function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

/**
 * Video lengths, which are M:SS -- NOT the timesheet's H:MM.
 *
 * These exist because parseDuration was doing this job and getting it wrong
 * in three different ways. It is a TIMESHEET parser: "1:30" means an hour and
 * a half, which is correct for a work block and 60x too large for a video.
 * The content forms fed it "0:38" from a placeholder promising exactly that
 * shape, and stored a 38-second clip as 38 minutes. The edit form was worse
 * still: it seeded the field as M:SS from stored seconds, so merely opening
 * it and pressing save multiplied the length by 60 -- silently, repeatably,
 * on every video anyone touched.
 *
 * The other two formats its own error message advertised, "38s" and "1m30s",
 * were rejected outright, because parseDuration has no seconds unit at all.
 *
 * Length is not decorative here: YouTube Shorts detection turns on a
 * threshold in seconds, and the client evidence report medians it. A wrong
 * length does not look wrong, it just quietly changes those answers.
 */
export function parseVideoLength(input: string): number | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;

  // Seconds are bounded to 0-59 so "1:75" is refused rather than accepted as
  // some third interpretation of a value that cannot mean anything.
  const hms = t.match(/^(\d{1,3}):([0-5]?\d):([0-5]?\d)$/);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];

  const ms = t.match(/^(\d{1,4}):([0-5]?\d)$/);
  if (ms) return +ms[1] * 60 + +ms[2];

  const unit = t.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/);
  if (unit && (unit[1] || unit[2] || unit[3]))
    return +(unit[1] ?? 0) * 3600 + +(unit[2] ?? 0) * 60 + +(unit[3] ?? 0);

  // A bare number is SECONDS for a video. parseDuration reads it as hours,
  // which is right for a timesheet and absurd for a clip.
  if (/^\d+$/.test(t)) return +t;

  return null;
}

/** Inverse of parseVideoLength: 38 -> "0:38", 3725 -> "1:02:05". */
export function formatVideoLength(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * Accepts "1:30", "1.5", "90m", "1h30m" -> seconds.
 *
 * TIMESHEET durations: "1:30" is an hour and a half. For video lengths use
 * parseVideoLength, where the same string means ninety seconds.
 */
export function parseDuration(input: string): number | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  if (/^\d{1,3}:\d{1,2}(:\d{1,2})?$/.test(t)) {
    const [h, m, s = "0"] = t.split(":");
    return +h * 3600 + +m * 60 + +s;
  }
  const hm = t.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+)m)?$/);
  if (hm && (hm[1] || hm[2])) return Math.round((+(hm[1] ?? 0)) * 3600 + (+(hm[2] ?? 0)) * 60);
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 3600);
  return null;
}
