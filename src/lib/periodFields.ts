/**
 * What a person is asked to type for one account for one period, and the
 * checks that run on it before anyone confirms.
 *
 * MOST OF THIS IS TYPED AND ALWAYS WILL BE. Instagram publishes no
 * account-level export -- Meta withholds it, and OAuth is banned here by
 * schema constraint -- so followers, reach, profile visits and every
 * demographic reach the system because somebody read them off a screen. This
 * file is therefore the manifest: a field with no entry here cannot appear in
 * a generated report, which is the point of writing it down.
 *
 * The checks below are all WARNINGS, never blocks. Each one exists because of
 * a specific discrepancy in a report already sent to a paying client, and in
 * every case the right response was a person looking again -- not the software
 * quietly correcting the numbers, which would be fabricating one of them.
 */

export type MetricKind = "level" | "flow";

export type PeriodField = {
  key: string;
  label: string;
  /**
   * level = a reading AT period end, never summed across days.
   * flow  = a total earned INSIDE the period.
   *
   * The live reports already make this distinction and get it right --
   * "FOLLOWERS 8,371" beside "NET FOLLOWERS THIS PERIOD +618". Encoding it
   * once stops a future importer summing a follower series into nonsense.
   */
  kind: MetricKind;
  /** Which platforms ask for it. Empty means all. */
  platforms?: string[];
  /** Shown under the input when the name alone is ambiguous. */
  hint?: string;
};

/**
 * Ordered as the form asks for them: the numbers every platform has, then the
 * audience block, then the platform-specific tail. Grouping by how a person
 * reads them off the source screen matters more than grouping by type --
 * whoever fills this in is copying from one dashboard, top to bottom.
 */
export const PERIOD_FIELDS: PeriodField[] = [
  { key: "views", label: "Views", kind: "flow", hint: "This platform's own count, on its own terms" },
  { key: "likes", label: "Likes", kind: "flow" },
  { key: "comments", label: "Comments", kind: "flow" },
  { key: "shares", label: "Shares", kind: "flow" },
  { key: "saves", label: "Saves", kind: "flow", platforms: ["instagram", "tiktok"] },
  {
    key: "interactions",
    label: "Interactions",
    kind: "flow",
    platforms: ["instagram"],
    hint: "Instagram's own combined figure — not likes + comments + shares, and never derived from them",
  },
  { key: "reach", label: "Accounts reached", kind: "flow", platforms: ["instagram"], hint: "Unique accounts, not impressions" },
  { key: "impressions", label: "Impressions", kind: "flow" },
  { key: "profile_views", label: "Profile visits", kind: "flow" },

  {
    key: "followers",
    label: "Followers (total)",
    kind: "level",
    platforms: ["instagram", "tiktok"],
    hint: "The number showing at the end of the period, not the change",
  },
  {
    key: "subscribers",
    label: "Subscribers (total)",
    kind: "level",
    platforms: ["youtube", "youtube_shorts"],
  },
  { key: "net_followers", label: "Net new followers", kind: "flow", platforms: ["instagram", "tiktok"], hint: "May be negative" },
  { key: "net_subscribers", label: "Net new subscribers", kind: "flow", platforms: ["youtube", "youtube_shorts"] },
  { key: "follows", label: "Follows", kind: "flow", platforms: ["instagram"], hint: "Gross" },
  { key: "unfollows", label: "Unfollows", kind: "flow", platforms: ["instagram"], hint: "Gross, entered positive — the report prints the minus sign" },

  { key: "bio_link_taps", label: "Bio link taps", kind: "flow", platforms: ["instagram"] },
  { key: "business_address_taps", label: "Business address taps", kind: "flow", platforms: ["instagram"] },
];

/** The fields this platform's form actually shows. */
export function fieldsFor(platform: string): PeriodField[] {
  return PERIOD_FIELDS.filter((f) => !f.platforms || f.platforms.includes(platform));
}

/* ---- Entry -------------------------------------------------------------- */

/**
 * Read a typed figure, tolerating what people actually paste.
 *
 * Returns `{ value, note }` rather than a bare number, because an expansion a
 * person did not intend is the failure worth catching: "11.4K" is a legitimate
 * thing to copy off TikTok, and turning it silently into 11400 is right only
 * if they are told. The note is shown beside the field.
 *
 * A blank string is null -- "no source this cycle" -- and is NOT zero. The
 * live report prints "Bio link taps 0" because a zero is information the
 * client asked for; a blank is the absence of information. Nothing downstream
 * may coalesce them.
 */
export function readEntry(raw: string): { value: number | null; note?: string } {
  const t = raw.trim();
  if (t === "") return { value: null };

  const m = /^(-?[\d,.\s]+)\s*([kKmM])?$/.exec(t);
  if (!m) return { value: null, note: `"${t}" is not a number.` };

  const digits = m[1].replace(/[,\s]/g, "");
  const n = Number(digits);
  if (!Number.isFinite(n)) return { value: null, note: `"${t}" is not a number.` };

  const suffix = m[2]?.toLowerCase();
  if (!suffix) return { value: n };

  const scaled = Math.round(n * (suffix === "k" ? 1_000 : 1_000_000));
  return {
    value: scaled,
    note: `Shown as "${t}" — stored as ${scaled.toLocaleString("en-GB")}.`,
  };
}

/* ---- Checks -------------------------------------------------------------- */

export type PeriodWarning = { field: string; message: string };

export type PeriodValues = Record<string, number | null | undefined>;

/**
 * Everything worth a second look before confirming. Never blocking.
 *
 * Each check is here because of a real discrepancy in a real report. The
 * correct response to every one of them was a person checking the source, so
 * the software says what it noticed and gets out of the way.
 */
export function checkPeriod(platform: string, v: PeriodValues): PeriodWarning[] {
  const out: PeriodWarning[] = [];
  const num = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);

  /**
   * follows - unfollows should equal net followers, and in the live Entree
   * report it does not: 828, 195 and +618, where 828 - 195 is 633.
   *
   * All three are stored verbatim and the gap is shown. Reconciling silently
   * would mean inventing one of the three numbers, and there is no way to know
   * which of them Instagram got wrong.
   */
  const follows = num("follows");
  const unfollows = num("unfollows");
  const net = num("net_followers");
  if (follows != null && unfollows != null && net != null) {
    const implied = follows - unfollows;
    if (implied !== net) {
      out.push({
        field: "net_followers",
        message: `Follows minus unfollows is ${implied.toLocaleString("en-GB")}, but net followers says ${net.toLocaleString("en-GB")} — a gap of ${Math.abs(implied - net).toLocaleString("en-GB")}. All three are kept as entered; check the source if that looks wrong.`,
      });
    }
  }

  /**
   * Unique accounts reached cannot exceed the impressions made on them. When
   * it does, the two figures have almost always been swapped.
   */
  const reach = num("reach");
  const views = num("views");
  if (reach != null && views != null && reach > views) {
    out.push({
      field: "reach",
      message: `Accounts reached (${reach.toLocaleString("en-GB")}) is higher than views (${views.toLocaleString("en-GB")}). Unique accounts cannot exceed the views of them — the two may be swapped.`,
    });
  }

  /**
   * A follower count that moved by more than a third in a month is possible
   * and is usually a digit. Flagged against the entered net change rather than
   * a prior period, so it works on the very first period a client ever gets.
   */
  const followers = num("followers") ?? num("subscribers");
  const netChange = num("net_followers") ?? num("net_subscribers");
  if (followers != null && netChange != null && followers > 0) {
    if (Math.abs(netChange) > followers) {
      out.push({
        field: "net_followers",
        message: `The net change (${netChange.toLocaleString("en-GB")}) is larger than the total (${followers.toLocaleString("en-GB")}). One of these is probably the other's field.`,
      });
    }
  }

  // Negative values that cannot be negative. Net change legitimately can be.
  for (const f of fieldsFor(platform)) {
    const n = num(f.key);
    if (n != null && n < 0 && !f.key.startsWith("net_")) {
      out.push({ field: f.key, message: `${f.label} cannot be negative.` });
    }
  }

  return out;
}

/**
 * Do these percentages add up?
 *
 * Called per breakdown kind. Real cases that are FINE and should still be
 * visible: Instagram's age buckets total 99.3%, TikTok's viewer gender 99%.
 * Both are rounding, both are worth seeing, neither should block anything.
 */
export function checkBreakdown(
  kind: string,
  rows: { label: string; value: number | null }[],
  tolerance = 1,
): PeriodWarning | null {
  const values = rows.map((r) => r.value).filter((n): n is number => n != null);
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) <= tolerance) return null;
  return {
    field: kind,
    message: `These add up to ${sum.toFixed(1)}%, not 100%. Rounding explains a point or so; more than that usually means a row is missing.`,
  };
}

/* ---- Breakdowns ---------------------------------------------------------- */

export type BreakdownSpec = {
  kind: string;
  label: string;
  unit: "percent" | "count";
  /** Suggested rows, so the form is a fill-in rather than a blank page. */
  suggest?: string[];
  hint?: string;
};

/**
 * Which ranked lists each platform's report can carry.
 *
 * Per platform, because offering Instagram a "traffic source" list it does not
 * publish would invite someone to invent one. The suggested labels come from
 * the real reports and from each platform's own vocabulary -- Instagram says
 * "Women"/"Men" where TikTok says "Female"/"Male", and both are reproduced as
 * the platform states them so the report matches the screen a client can check
 * it against.
 */
export const BREAKDOWNS: Record<string, BreakdownSpec[]> = {
  instagram: [
    { kind: "follower_age", label: "Followers by age", unit: "percent",
      suggest: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"] },
    { kind: "follower_gender", label: "Followers by gender", unit: "percent",
      suggest: ["Women", "Men"] },
    { kind: "follower_location", label: "Top locations", unit: "percent",
      hint: "In the order Instagram lists them" },
    { kind: "follower_active_days", label: "Most active days", unit: "percent",
      hint: "Leave the values blank if you only have the order" },
    { kind: "views_by_format", label: "Views by content type", unit: "count",
      suggest: ["Reels", "Stories", "Posts"] },
    { kind: "interactions_by_format", label: "Interactions by content type", unit: "count",
      suggest: ["Reels", "Stories", "Posts", "Live videos"] },
  ],
  tiktok: [
    { kind: "follower_gender", label: "Followers by gender", unit: "percent",
      suggest: ["Female", "Male"] },
    { kind: "viewer_gender", label: "Viewers by gender", unit: "percent",
      suggest: ["Female", "Male"] },
    { kind: "traffic_source", label: "Where the views came from", unit: "percent",
      suggest: ["For You", "Personal profile", "Search", "Following", "Sound"] },
    { kind: "search_query", label: "Top search queries", unit: "percent",
      hint: "Keep TikTok's own order — several can share a value and the order still means something" },
    { kind: "follower_location", label: "Top locations", unit: "percent" },
  ],
  youtube: [
    { kind: "traffic_source", label: "Where the views came from", unit: "percent" },
    { kind: "subscription_source", label: "Where subscribers came from", unit: "percent" },
  ],
  youtube_shorts: [
    { kind: "traffic_source", label: "Where the views came from", unit: "percent" },
  ],
};

export function breakdownsFor(platform: string): BreakdownSpec[] {
  return BREAKDOWNS[platform] ?? [];
}
