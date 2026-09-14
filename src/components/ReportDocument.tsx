import type { ClientReport, ReportPlatformSection } from "@/lib/buildClientReport";
import { summaryFindings } from "@/lib/clientReport";
import { monthLongLabel, type GrowthSeries, type PlatformGrowth } from "@/lib/reportGrowth";
import { audienceLead, type ReportAudience } from "@/lib/reportAudience";
import { templateClass } from "@/lib/reportTemplates";
import ReportThumb from "@/components/ReportThumb";

/**
 * The client report as a document, in the grammar the agency already uses.
 *
 * THE DOCUMENT IS BUILT FROM WHAT EXISTS, never padded out to a fixed shape.
 * A platform with nothing to say gets no page; a figure nobody recorded gets
 * no tile; a block with no rows is not drawn. There is no "not recorded"
 * anywhere on these pages, because a client receiving a sheet that announces
 * our own missing data is worse than not receiving that sheet at all -- it
 * reads as an unfinished job rather than a shorter month.
 *
 * That is a different standard from the screen the report is prepared on,
 * where absences must be loud so they can be fixed. The blockers panel and the
 * unmeasurable-video list live there, marked no-print, and never travel.
 *
 * Everything that IS printed is measured. Nothing is estimated, interpolated
 * or defaulted to zero.
 */

const N = (n: number | null | undefined) =>
  n == null ? null : n.toLocaleString("en-GB");

/** Wide letter-spacing as real spaces, the way the source documents set it. */
const spaced = (s: string) => s.toUpperCase().split("").join(" ");

/**
 * A solid field that survives the print dialog.
 *
 * Chrome ships with "Background graphics" UNTICKED and most people never touch
 * it, so every background-color in a document is silently dropped on the
 * default print path. For the two templates with a dark cover that is not a
 * cosmetic loss -- their cover text is light, so the ground vanishing leaves
 * white text on white paper: a blank first sheet with the client's name
 * nowhere on it.
 *
 * An <img> is REPLACED CONTENT and is printed regardless of that setting. An
 * inline SVG data URI costs no request, no file, and no build step, and the
 * colour is read from the template's own token at render time by the caller.
 *
 * Templates with a light cover pass null and get nothing.
 */
function Plate({ fill }: { fill: string | null }) {
  if (!fill) return null;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' fill='${fill}'/></svg>`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
      alt=""
      aria-hidden="true"
      className="report-plate"
    />
  );
}

/** The ground each template wants behind its cover, or null for a light one. */
const COVER_PLATE: Record<string, string | null> = {
  editorial: null,
  minimal: null,
  bold: "#0a0a0b",
  luxury: "#14110e",
};

function Footer({ client, page, period }: { client: string; page: number; period: string }) {
  return (
    <div className="report-footer">
      <span>{client}</span>
      <span>{page}</span>
      <span>Social media performance report · {period}</span>
    </div>
  );
}

/**
 * A figure, or nothing at all.
 *
 * Returning null for a missing value is the whole rule in miniature: a tile
 * reading "not recorded" tells the client about our data pipeline, which is
 * not what they are paying to read about.
 */
function Figure({
  value,
  label,
  delta,
  size = 34,
}: {
  value: number | null | undefined;
  label: string;
  delta?: number | null;
  size?: number;
}) {
  if (value == null) return null;
  return (
    <div>
      <div className="report-figure-value" style={{ fontSize: size }}>
        {N(value)}
      </div>
      <div className="report-figure-label">{label}</div>
      {/* Commentary on the figure above, never a figure in its own right. */}
      {delta != null && (
        <div
          className="report-figure-delta"
          style={{ color: delta >= 0 ? "var(--success)" : "var(--danger)" }}
        >
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}% vs previous period
        </div>
      )}
    </div>
  );
}

/**
 * Six months of one series, as bars.
 *
 * INLINE SVG ON PURPOSE. The bars elsewhere in this document are borders,
 * because Chrome's print dialog ships with "background graphics" off and a
 * CSS background silently vanishes from the PDF. SVG shapes are painted
 * content, not backgrounds; they print. It also means no client-side chart
 * library and nothing to hydrate -- the page is static markup.
 *
 * A NULL MONTH IS DRAWN AS UNMEASURED, not as an empty bar. "Views gained"
 * has readings only from the month the system started taking them, and a
 * flat zero there would tell the client their videos did nothing that month.
 * A short dash on the baseline says "no reading" and the note below the
 * chart says why.
 *
 * The latest month is solid; earlier months are lighter. The eye goes to the
 * period this report is about, and the rest is the shape it arrived on.
 */
function MonthBars({ series }: { series: GrowthSeries }) {
  const W = 228, H = 82, TOP = 16, BOTTOM = 15, GAP = 8;
  const n = series.points.length;
  const bw = (W - GAP * (n - 1)) / n;
  const plotH = H - TOP - BOTTOM;
  const values = series.points.map((p) => p.value).filter((v): v is number => v != null);
  const max = values.length ? Math.max(...values, 1) : 1;
  const last = series.points[n - 1];
  const compact = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 10_000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${series.title}, last ${n} months`}>
      {/* baseline: a stroke, which prints */}
      <line x1={0} y1={H - BOTTOM + 0.5} x2={W} y2={H - BOTTOM + 0.5} style={{ stroke: "var(--report-rule)", strokeWidth: 1 }} />
      {series.points.map((pt, i) => {
        const x = i * (bw + GAP);
        const isLast = i === n - 1;
        if (pt.value == null) {
          return (
            <g key={pt.month}>
              <line x1={x + bw * 0.3} y1={H - BOTTOM - 3} x2={x + bw * 0.7} y2={H - BOTTOM - 3}
                style={{ stroke: "var(--report-muted)", strokeWidth: 1.2, strokeDasharray: "2 2" }} />
              <text x={x + bw / 2} y={H - 4} textAnchor="middle" fontSize={9} style={{ fill: "var(--report-muted)" }}>{pt.label}</text>
            </g>
          );
        }
        const h = max > 0 ? Math.max(pt.value > 0 ? 2 : 0, (pt.value / max) * plotH) : 0;
        return (
          <g key={pt.month}>
            {pt.partial ? (
              // Outlined, not filled: measured for part of the month only.
              <rect x={x + 0.5} y={H - BOTTOM - h + 0.5} width={bw - 1} height={Math.max(0, h - 1)}
                style={{ fill: "none", stroke: "var(--report-accent)", strokeWidth: 1, strokeDasharray: "3 2", opacity: 0.8 }} />
            ) : (
              <rect x={x} y={H - BOTTOM - h} width={bw} height={h}
                style={{ fill: "var(--report-accent)", opacity: isLast ? 1 : 0.38 }} />
            )}
            {(isLast || pt.value === max) && (
              <text x={x + bw / 2} y={H - BOTTOM - h - 5} textAnchor="middle" fontSize={9.5}
                style={{ fill: "var(--report-ink)", fontWeight: 600 }}>{compact(pt.value)}</text>
            )}
            <text x={x + bw / 2} y={H - 4} textAnchor="middle" fontSize={9}
              style={{ fill: isLast ? "var(--report-ink)" : "var(--report-muted)", fontWeight: isLast ? 600 : 400 }}>{pt.label}</text>
          </g>
        );
      })}
      {last?.value == null && values.length === 0 && (
        <text x={W / 2} y={TOP + plotH / 2} textAnchor="middle" fontSize={9.5} style={{ fill: "var(--report-muted)" }}>not measured</text>
      )}
    </svg>
  );
}

/**
 * The growth sheet: every platform, three series, six months.
 *
 * Drawn only when something was measured. A client should never receive a
 * page whose content is a note about our own missing data, so a platform
 * with nothing in any series is left off, and a report with nothing in any
 * platform gets no sheet at all.
 */
function GrowthPage({ growth, report, page }: { growth: PlatformGrowth[]; report: ClientReport; page: number }) {
  const drawable = growth.filter((g) => g.series.some((s) => s.points.some((p) => p.value != null)));
  if (drawable.length === 0) return null;

  /* One sentence the numbers support. The views series is the one clients
     ask about, so it leads when it can; publishing cadence otherwise. */
  const lead = (() => {
    const v = drawable
      .map((g) => ({ g, s: g.series.find((x) => x.key === "viewsGained")! }))
      .filter((x) => x.s.deltaPct != null)
      .sort((a, b) => Math.abs(b.s.deltaPct!) - Math.abs(a.s.deltaPct!))[0];
    if (v) {
      const prev = monthLongLabel(v.s.points[v.s.points.length - 2].month);
      const d = v.s.deltaPct!;
      return `${v.g.platformLabel}'s tracked videos gained ${Math.abs(d)}% ${d >= 0 ? "more" : "fewer"} views than in ${prev}.`;
    }
    /* Cadence next: complete for every month, so always comparable. Stated
       for the client as a whole, not as the single steepest platform -- "100%
       fewer videos on YouTube" was true of a channel that went from three to
       none, and the wrong headline for a month in which every channel
       slowed. Only when the channels disagree does one get named. */
    const cadence = drawable
      .map((g) => {
        const pts = g.series.find((x) => x.key === "published")!.points;
        return { g, cur: pts[pts.length - 1].value ?? 0, prev: pts[pts.length - 2]?.value ?? 0, month: pts[pts.length - 2]?.month };
      })
      .filter((x) => x.cur + x.prev > 0);
    if (cadence.length) {
      const prev = monthLongLabel(cadence[0].month!);
      const up = cadence.filter((x) => x.cur > x.prev), down = cadence.filter((x) => x.cur < x.prev);
      const n = cadence.length;
      if (down.length === n && n > 1) return `Publishing slowed on every channel compared with ${prev}.`;
      if (up.length === n && n > 1) return `Publishing rose on every channel compared with ${prev}.`;
      const lead = [...up].sort((a, b) => (b.cur - b.prev) - (a.cur - a.prev))[0];
      if (lead) return `${lead.g.platformLabel} published ${lead.cur - lead.prev} more video${lead.cur - lead.prev === 1 ? "" : "s"} than in ${prev}.`;
      const steady = cadence.every((x) => x.cur === x.prev);
      if (steady) return `Publishing held steady against ${prev}.`;
    }
    return "The last six months, at a glance.";
  })();

  return (
    <section className="report-page">
      <div className="report-eyebrow">{spaced("Growth · trailing six months")}</div>
      <h2 className="report-headline">{lead}</h2>

      {drawable.map((g) => (
        <div key={g.platform} className="report-growth-row">
          <div className="report-growth-platform">{g.platformLabel}</div>
          <div className="report-growth-charts">
            {g.series.map((s) => (
              <div key={s.key} className="report-growth-chart">
                <div className="report-growth-title">
                  <span>{s.title}</span>
                  {s.deltaPct != null && (
                    <span className="report-growth-delta" style={{ color: s.deltaPct >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {s.deltaPct >= 0 ? "+" : ""}{s.deltaPct}% vs {s.points[s.points.length - 2].label}
                    </span>
                  )}
                </div>
                <MonthBars series={s} />
                <div className="report-growth-note">{s.note}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="report-growth-foot">
        Each platform is drawn on its own scale and never added to another: platforms count a view on different terms.
        The solid bar is {report.periodLabel.split(" ")[0]}; lighter bars are the months before it. An outlined bar was measured for part of the month only; a dash means the month was not measured.
      </p>

      <Footer client={report.clientName} page={page} period={report.periodLabel} />
    </section>
  );
}

/**
 * What the audience said: signals, themes, sentiment.
 *
 * Every count on this page is a count of VERIFIED comment ids, and the
 * denominator is distinct ids -- a comment carrying two themes is counted
 * once. That is the discipline the app's own reports page uses, and a
 * client's document must not be looser than the dashboard. The scope note
 * says whether the themes are this month's or, when the month is too thin
 * to support a list, all time.
 */
function AudiencePage({ audience, report, page }: { audience: ReportAudience; report: ClientReport; page: number }) {
  const sentimentRows = (["positive", "neutral", "negative"] as const)
    .map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: audience.sentiment[k] }))
    .filter((r) => r.value > 0);
  const sentimentTotal = sentimentRows.reduce((a, r) => a + r.value, 0);

  return (
    <section className="report-page">
      <div className="report-eyebrow">{spaced("Audience · what the comments say")}</div>
      <h2 className="report-headline">{audienceLead(audience)}</h2>

      {audience.signals && (
        <div className="report-figures">
          <Figure value={audience.signals.analysed} label="Comments analysed" size={30} />
          <Figure value={audience.signals.questions} label="Questions asked" size={30} />
          <Figure value={audience.signals.intent} label="Intent to buy" size={30} />
          {/* Only when it is a finding: 3 confused comments in 2,061 is noise. */}
          {audience.signals.confusion >= 10 && audience.signals.confusion / audience.signals.analysed >= 0.02 && (
            <Figure value={audience.signals.confusion} label="Confused" size={30} />
          )}
        </div>
      )}

      {audience.themes.length > 0 && (
        <>
          <div className="report-eyebrow" style={{ marginTop: 22 }}>{spaced("What they talked about")}</div>
          <p className="report-audience-scope">{audience.scopeNote} {audience.distinctComments.toLocaleString("en-GB")} distinct comments carry a theme; one comment can carry more than one.</p>
          <div className="report-audience-themes">
            {audience.themes.map((t) => {
              const max = audience.themes[0].comments;
              return (
                <div key={t.label} className="report-bar-row report-audience-row">
                  <div className="report-bar-label">
                    {t.label}
                    {t.sentiment && (
                      <span className={`report-audience-tone report-audience-tone--${t.sentiment}`}>{t.sentiment}</span>
                    )}
                  </div>
                  <div className="report-bar-track">
                    <div className="report-bar-fill" style={{ width: `${(t.comments / max) * 100}%` }} />
                  </div>
                  <div className="report-bar-value">
                    {t.comments.toLocaleString("en-GB")}
                    <span className="report-bar-suffix"> across {t.posts} video{t.posts === 1 ? "" : "s"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {sentimentRows.length > 0 && (
        <>
          <div className="report-eyebrow" style={{ marginTop: 22 }}>{spaced("How it read")}</div>
          {/* A share of themed comments by tone. Sums honestly: one client,
              one unit, distinct within each bucket. */}
          <BarList rows={sentimentRows.map((r) => ({ label: r.label, value: r.value, suffix: ` · ${Math.round((r.value / sentimentTotal) * 100)}%` }))} />
        </>
      )}

      <p className="report-growth-foot">
        Themes are grouped by meaning, not by wording, so "how much is it" and "pricing?" count together. Counts are
        comments the system verified, never a figure a model asserted. Instagram comments are the platform's first page per video.
      </p>

      <Footer client={report.clientName} page={page} period={report.periodLabel} />
    </section>
  );
}

/**
 * A proportional bar beside an exact number.
 *
 * The bar is for reading the shape of a distribution at a glance; the number
 * is what gets quoted. Scaled against the largest row rather than against 100,
 * so a set that legitimately sums to 60% still fills the width and stays
 * legible.
 */
function BarList({ rows }: { rows: { label: string; value: number; suffix?: string }[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div>
      {/* LABEL, BAR, VALUE -- three columns.
          The label used to sit inside the track, and once the fill became a
          solid ink border it was dark text on a dark bar: "Instagram",
          "TikTok" and "YouTube" were all illegible, and only the shortest bar
          left its label readable. Outside the track it is always legible, and
          it matches how the reference reports set a distribution. */}
      {rows.map((r) => (
        <div key={r.label} className="report-bar-row">
          <div className="report-bar-label">{r.label}</div>
          <div className="report-bar-track">
            <div className="report-bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <div className="report-bar-value">
            {r.value.toLocaleString("en-GB")}
            {r.suffix ?? ""}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * How much this sheet is actually carrying.
 *
 * Written onto the page as a data attribute so CSS can lay a thin sheet out
 * differently rather than leaving the full-data design with holes in it. This
 * is the case that matters: most clients have video data and no demographics
 * at all, so a sparse sheet is the DEFAULT and the dense one is the exception.
 * Designing the full page first and hoping it degrades is how a report ends up
 * with a third of its area blank and a client wondering what is missing.
 *
 *   "sparse"  -- one block. Nothing but the top videos, or nothing but a row
 *                of figures. The block gets the whole sheet and is set larger.
 *   "medium"  -- two blocks.
 *   "full"    -- figures, distributions and videos.
 */
function density(s: ReportPlatformSection): "sparse" | "medium" | "full" {
  /**
   * Counted by VOLUME, not by how many kinds of block are present.
   *
   * It used to count blocks -- figures, distributions, videos -- so a section
   * with eight videos and nothing else scored 1 and was called "sparse". That
   * put the most generous type sizing on the fullest sheet, and Entree and The
   * Jet Business both blew past the A4 column: 1050 and 1047 against 1016.
   * Meanwhile a genuinely thin sheet and a packed one were styled identically.
   *
   * The rows are what fill a page, so the rows are what decide -- and the
   * thresholds are MEASURED against the A4 column rather than guessed. Eight
   * rows land at 941-994px under medium sizing and four land at 977-1008px
   * under sparse, against a column of 1016. Both fill the sheet without
   * crossing it, which is the whole target: a page that is 60% full reads as
   * something missing, and one at 103% spills a row onto a blank sheet.
   */
  const rows = s.top.length + s.breakdowns.length;
  if (rows >= 10) return "full";
  if (rows >= 5) return "medium";
  return "sparse";
}

/** Does this platform have anything at all worth a sheet? */
export function sectionHasContent(s: ReportPlatformSection): boolean {
  const m = s.metrics;
  const anyFigure =
    m != null &&
    [m.views, m.likes, m.followers, m.subscribers, m.netFollowers, m.netSubscribers, m.reach, m.profileViews]
      .some((v) => v != null);
  // Measurement counts. A platform we tracked all month has plenty to say
  // even when nobody transcribed the account dashboard.
  const anyMeasured = s.measured.viewsGained != null || s.measured.published > 0;
  return anyFigure || anyMeasured || s.top.length > 0 || s.breakdowns.length > 0;
}

const BREAKDOWN_TITLES: Record<string, string> = {
  follower_age: "Followers by age",
  follower_gender: "Followers by gender",
  follower_location: "Top locations",
  follower_active_days: "Most active days",
  viewer_age: "Viewers by age",
  viewer_gender: "Viewers by gender",
  viewer_location: "Viewer locations",
  views_by_format: "Views by content type",
  interactions_by_format: "Interactions by content type",
  interaction_share_by_format: "Interaction share by format",
  traffic_source: "Where the views came from",
  search_query: "Top search queries",
  subscription_source: "Where subscribers came from",
};

function PlatformPage({
  section: s,
  report,
  page,
}: {
  section: ReportPlatformSection;
  report: ClientReport;
  page: number;
}) {
  const isYouTube = s.platform.startsWith("youtube");
  const m = s.metrics;

  // Grouped in the order a reader wants them: how far it went, then who saw it.
  const kinds = [...new Set(s.breakdowns.map((b) => b.kind))];

  /**
   * Row padding computed to FILL the sheet, not chosen from a bucket.
   *
   * Density buckets set the type size well but could never land the page near
   * full: the same three sizes had to serve two rows and ten, so a sheet came
   * out at 68% or at 103% and nothing in between. The rows are the elastic
   * part, so they absorb the difference.
   *
   * The arithmetic is the A4 column (about 1016px at 96dpi) less the fixed
   * furniture -- eyebrow, headline, figure row, footer -- divided by however
   * many rows this sheet carries. The budget is tuned to the TALLEST template
   * rather than the average: Bold and Luxury set larger type, so a figure that
   * lands Editorial at 995 puts Bold at 1048 and spills it. Clamped at both
   * ends -- below 6px the rows collide, above 24px four videos look marooned
   * rather than generous. The ceiling matters more than it looks: the one
   * sheet in the workspace still spilling had SEVEN rows and had hit the cap,
   * so the formula was not what put it over -- the clamp was.
   *
   * 652 rather than 668 because a full sweep of every client found one sheet
   * still 9px over: Tilted Needle Team on Bold, eight rows and a figure row.
   * The budget is set by the worst combination in the workspace, not the
   * typical one -- a single spilled row costs a whole extra sheet.
   */
  // When most of the list shares a caveat it belongs to the list, not to each
  // line of it.
  const sinceCount = s.top.filter((t) => t.basis === "since-publication").length;
  const sinceIsNorm = s.top.length > 0 && sinceCount >= Math.ceil(s.top.length / 2);

  const rowCount = s.top.length + [...new Set(s.breakdowns.map((b) => b.kind))].length;
  // A sheet carrying reported figures spends about 60px more on furniture --
  // the tile row and its labels -- so it has that much less to give the rows.
  // Ameerh has both eight videos and a full figure row, and was the only
  // combination still spilling.
  const budget = 652 - (s.metrics ? 58 : 0);
  const rankPad = rowCount
    ? Math.max(6, Math.min(24, Math.round((budget / rowCount - 38) / 2)))
    : 9;

  return (
    <section
      className="report-page"
      data-density={density(s)}
      style={{ ["--rank-pad" as string]: `${rankPad}px` }}
    >
      <div className="report-eyebrow">
        {spaced(s.platformLabel)} &nbsp;·&nbsp; {spaced(report.periodLabel)}
      </div>

      {/* Two different absences, and conflating them misleads. "No figures
          were recorded" above three videos with view counts reads as a
          contradiction: what is missing is the ACCOUNT-level data, which only
          a person can enter. The video data is measured and present. */}
      <h2 className="report-headline">
        {m
          ? s.narrative
          : `${s.publishedCount} ${s.publishedCount === 1 ? "video" : "videos"} published on ${s.platformLabel} this period.`}
      </h2>

      {/* Figures render themselves away when absent, so this row shows exactly
          what is known and never a gap where a tile should be.

          REPORTED WINS, MEASURED FILLS IN. A figure transcribed from the
          platform's own dashboard is the platform's whole account; ours covers
          the videos we track. Where both exist the reported one is printed;
          where only ours does, it is printed and labelled, because a floor
          stated as a floor is worth far more than a blank page. */}
      <div className="report-figures">
        <Figure
          value={m?.views ?? s.measured.viewsGained}
          label={m?.views != null ? "Views" : "Views · tracked videos"}
          delta={s.viewsDeltaPct}
        />
        <Figure value={m?.likes ?? s.measured.likes} label="Likes" />
        <Figure value={m?.comments} label="Comments" />
        <Figure value={s.measured.published || null} label="Videos published" />
        {isYouTube ? (
          <>
            <Figure value={m?.subscribers} label="Subscribers" />
            <Figure value={m?.netSubscribers} label="New subscribers" />
          </>
        ) : (
          <>
            <Figure value={m?.followers} label="Followers" />
            <Figure value={m?.netFollowers} label="Net new followers" />
          </>
        )}
        <Figure value={m?.reach} label="Accounts reached" />
        <Figure value={m?.profileViews} label="Profile visits" />
      </div>

      {kinds.map((kind) => {
        const rows = s.breakdowns
          .filter((b) => b.kind === kind && b.value != null)
          .sort((a, b) => a.rank - b.rank)
          .map((b) => ({
            label: b.annotation ? `${b.label} (${b.annotation})` : b.label,
            value: b.value as number,
            suffix: b.unit === "percent" ? "%" : "",
          }));
        if (rows.length === 0) return null;
        return (
          <div key={kind} style={{ marginTop: 22 }}>
            <div className="report-eyebrow">
              {spaced(BREAKDOWN_TITLES[kind] ?? kind.replace(/_/g, " "))}
            </div>
            <BarList rows={rows} />
          </div>
        );
      })}

      {s.top.length > 0 && (
        <>
          <div className="report-eyebrow" style={{ marginTop: 26 }}>
            {spaced(`Top ${s.top.length === 1 ? "video" : `${s.top.length} videos`}`)}
          </div>
          {/* SAID ONCE WHEN IT IS THE NORM, per row when it is the exception.
              Three of four rows carrying "SINCE PUBLICATION" is not four
              caveats, it is one fact about the section -- and repeating it
              down the column made a legitimate note read as an error stamped
              on every line. */}
          {sinceIsNorm && (
            <p className="report-note">
              These are totals since each video was published rather than views
              earned inside the period — measurement for this account began part
              way through.
            </p>
          )}
          {/* A ROW, not a stacked card.
              The figures used to sit UNDER the caption with their own labels,
              which cost about 100px a video -- eight of them ran the sheet
              1212px against an A4 column of roughly 1016px, so the section
              spilled and left a following sheet 95% white with one orphaned
              row on it. Laid out as a row the same eight fit, read like the
              table they are, and let the eye run down a column of view counts
              instead of hunting for each one. */}
          {s.top.map((t, i) => (
            <div key={t.postId} className="report-rank">
              <div className="report-rank-number">{String(i + 1).padStart(2, "0")}</div>
              {/* The poster frame, where the platform gave us one.
                  A ranked list of captions is a spreadsheet; the client
                  recognises their own work by the picture. TikTok, YouTube and
                  Shorts are at 100% coverage, Instagram at 13% -- so the cell
                  holds its width either way and simply stays empty rather than
                  letting one missing image shift a whole column. */}
              <div className="report-rank-thumb">
                {/* A client component, because this one is a server component
                    and an <img> here had no way to notice its own failure.
                    Signed TikTok and Instagram URLs expire and start
                    answering 403, and the bare tag turned that into a
                    broken-image glyph in the client's PDF. */}
                <ReportThumb src={t.thumbnailUrl ?? null} />
              </div>
              <div className="report-rank-title">
                {/* Verbatim, including typos, curly quotes and emoji: the
                    caption is the client's own writing. */}
                <span className="report-quote">{t.title ? `“${t.title}”` : "Untitled"}</span>
                {t.basis === "since-publication" && !sinceIsNorm && (
                  <span className="report-rank-note">since publication</span>
                )}
              </div>
              <div className="report-rank-metric">
                <span className="report-rank-value">{N(t.views)}</span>
                <span className="report-rank-unit">views</span>
              </div>
              <div className="report-rank-metric">
                <span className="report-rank-value report-rank-value--soft">{N(t.likes)}</span>
                <span className="report-rank-unit">likes</span>
              </div>
            </div>
          ))}
        </>
      )}

      <Footer client={report.clientName} page={page} period={report.periodLabel} />
    </section>
  );
}

export default function ReportDocument({ report }: { report: ClientReport }) {
  // Only platforms with something to show. A sheet whose entire content is an
  // apology for missing data is worse than a shorter report.
  const sections = report.sections.filter(sectionHasContent);
  const platforms = sections.map((s) => s.platformLabel);
  const withViews = sections.filter((s) => s.metrics?.views != null);

  // The summary needs at least two channels to be summarising anything; with
  // one it would restate the page that follows it.
  const showSummary = withViews.length > 1;

  const findings = summaryFindings(
    sections.map((s) => ({
      platformLabel: s.platformLabel,
      views: s.metrics?.views ?? s.measured.viewsGained,
      likes: s.metrics?.likes ?? s.measured.likes,
      published: s.measured.published,
      reported: s.metrics?.views != null,
      deltaPct: s.viewsDeltaPct,
      topGain: s.top[0]?.gained ?? null,
      topTitle: s.top[0]?.title ?? null,
    })),
    3,
  );

  let page = 1;

  return (
    // The ONLY thing a template changes. Same tree, same data, same figures
    // -- a design may restyle anything and may decide nothing.
    <div className={`report ${templateClass(report.template)}`}>
      <section className="report-page">
        <div className="report-cover-inner">
          <Plate fill={COVER_PLATE[report.template] ?? null} />
          {/* WRAPPED, and the wrapper is what carries the stacking.
              z-index only orders POSITIONED elements: the cover text was
              position:static, so an absolutely-positioned plate at z-index 0
              painted straight over it and the first sheet rendered as a solid
              black rectangle with the client's name nowhere on it. A single
              positioned wrapper is not something a later CSS edit can quietly
              stop applying, which a `> *:not(.report-plate)` rule already did
              once. */}
          <div className="report-cover-body">
            <div className="report-cover-title">{spaced("Social media performance report")}</div>
            <div className="report-cover-client">{report.clientName}</div>
            {platforms.length > 0 && (
              <div className="report-cover-platforms">
                {platforms.map((p) => spaced(p)).join("  ·  ")}
              </div>
            )}
            <div className="report-cover-period">{spaced(report.periodLabel)}</div>
          </div>
        </div>
      </section>

      {showSummary && (
        <section className="report-page">
          <div className="report-eyebrow">{spaced("Executive summary")}</div>
          <h2 className="report-headline">
            {report.periodLabel} across {platforms.length} channels.
          </h2>

          <div className="report-figures">
            <Figure value={report.combined.views} label="Combined views" />
            <Figure value={report.combined.likes} label="Combined likes" />
          </div>

          {/* The caveat sits with the figure, on the page: this is the one
              number here that sums things measured on different scales. */}
          <p
            style={{
              fontSize: 10.5,
              lineHeight: 1.5,
              color: "var(--report-muted)",
              marginBottom: 24,
              maxWidth: "62ch",
            }}
          >
            {report.combined.caveat}
          </p>

          <div className="report-eyebrow">{spaced("By channel")}</div>
          <BarList
            rows={withViews
              .map((s) => ({ label: s.platformLabel, value: s.metrics!.views as number }))
              .sort((a, b) => b.value - a.value)}
          />

          {/* COMPARISONS, not a restatement.
              These were the platform pages' own sentences repeated, so the
              first page a client read was three paragraphs they were about to
              read again -- and it offered nothing that needed every platform
              in view at once, which is the only thing a summary is for. Every
              line below is a comparison or a share, and no platform page can
              make any of them. */}
          {findings.length > 0 && (
            <>
              <div className="report-eyebrow" style={{ marginTop: 26 }}>
                {spaced("Top-line findings")}
              </div>
              {findings.map((f, i) => (
                <div key={f.lead} className="report-finding">
                  <div className="report-finding-number">{String(i + 1).padStart(2, "0")}</div>
                  <div>
                    <div className="report-finding-lead">{f.lead}</div>
                    <div className="report-finding-body">{f.body}</div>
                  </div>
                </div>
              ))}
            </>
          )}

          <Footer client={report.clientName} page={++page} period={report.periodLabel} />
        </section>
      )}

      {/* Growth before the platform pages: the trajectory first, then the
          month's detail. Renders nothing when nothing was measured. */}
      {report.growth.some((g) => g.series.some((x) => x.points.some((p) => p.value != null))) && (
        <GrowthPage growth={report.growth} report={report} page={++page} />
      )}

      {report.audience && <AudiencePage audience={report.audience} report={report} page={++page} />}

      {sections.map((s) => (
        <PlatformPage key={s.platform} section={s} report={report} page={++page} />
      ))}

      {/* Method, last, and only the notes that actually apply. A caveat about
          a figure the report does not contain is noise. */}
      <section className="report-page">
        <div className="report-eyebrow">{spaced("About these figures")}</div>
        <h2 className="report-headline">Where each number came from.</h2>

        {/* THE PAGE'S OWN CONTENT, rather than four paragraphs of boilerplate
            on a 43%-full sheet. A client asking "where did this come from"
            wants it per channel, not as prose -- and stating plainly which
            figures were read off the platform and which this system measured
            is the difference between a report you can interrogate and one you
            have to take on trust. */}
        {sections.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <div className="report-eyebrow">{spaced("By channel")}</div>
            {sections.map((sec) => (
              <div key={sec.platform} className="report-bar-row" style={{ gridTemplateColumns: "132px minmax(0,1fr)" }}>
                <div className="report-bar-label">{sec.platformLabel}</div>
                <div className="report-finding-body" style={{ fontSize: 10.5 }}>
                  {sec.metrics?.views != null
                    ? "Audience figures transcribed from the platform's own dashboard."
                    : "Measured by this system across the videos it tracks."}
                  {sec.top.length > 0
                    ? ` ${sec.top.length} video${sec.top.length === 1 ? "" : "s"} ranked.`
                    : ""}
                  {sec.measured.published > 0
                    ? ` ${sec.measured.published} published this period.`
                    : ""}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="report-finding-body" style={{ maxWidth: "68ch" }}>
          <p style={{ marginBottom: 12 }}>
            Period: {report.period.start} to {report.period.end}, inclusive.
          </p>
          {sections.some((s) => s.metrics?.views == null && s.measured.viewsGained != null) && (
            <p style={{ marginBottom: 12 }}>
              Figures marked <em>tracked videos</em>{" "}
              are measured by this system across the videos it follows for you, rather than
              transcribed from the platform&apos;s own dashboard.
              They cover posted video only, so they are a floor rather than an account total.
            </p>
          )}
          {sections.some((s) => s.top.length > 0) && (
            <>
              <p style={{ marginBottom: 12 }}>
                Videos are ranked by the views they gained inside the period rather than by their
                lifetime totals — a video published earlier can still be the month&apos;s strongest
                performer, and a large historic count does not mean a video is working now.
              </p>
              {/* Only stated when such a row is actually present. A caveat
                  about a figure the report does not contain is noise. */}
              {sections.some((s) => s.top.some((t) => t.basis === "since-publication")) && (
                <p style={{ marginBottom: 12 }}>
                  {/* The space is explicit. JSX drops the whitespace around a
                      line break next to an element, so this printed as
                      "since publicationare the video's total". */}
                  Figures marked <em>since publication</em>{" "}
                  are the video&apos;s total to date rather than what it earned inside this period. They appear where measurement began after
                  the period closed, and they run past its end.
                </p>
              )}
              <p style={{ marginBottom: 12 }}>{report.likesCaveat}</p>
            </>
          )}
          {sections.some((s) => s.metrics) && (
            <p>
              Audience figures — followers, reach and profile visits — are taken from each
              platform&apos;s own dashboard, because no public interface publishes them.
            </p>
          )}
        </div>
        <Footer client={report.clientName} page={++page} period={report.periodLabel} />
      </section>
    </div>
  );
}
