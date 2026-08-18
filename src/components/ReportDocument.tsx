import type { ClientReport, ReportPlatformSection } from "@/lib/buildClientReport";
import { templateClass } from "@/lib/reportTemplates";

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
      {rows.map((r) => (
        <div key={r.label} className="report-bar-row">
          <div className="report-bar-track">
            <div className="report-bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            <div className="report-bar-label">{r.label}</div>
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
  const blocks =
    (s.metrics ? 1 : 0) + (s.breakdowns.length > 0 ? 1 : 0) + (s.top.length > 0 ? 1 : 0);
  return blocks >= 3 ? "full" : blocks === 2 ? "medium" : "sparse";
}

/** Does this platform have anything at all worth a sheet? */
export function sectionHasContent(s: ReportPlatformSection): boolean {
  const m = s.metrics;
  const anyFigure =
    m != null &&
    [m.views, m.likes, m.followers, m.subscribers, m.netFollowers, m.netSubscribers, m.reach, m.profileViews]
      .some((v) => v != null);
  return anyFigure || s.top.length > 0 || s.breakdowns.length > 0;
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

  return (
    <section className="report-page" data-density={density(s)}>
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
          : `${s.candidateCount} ${s.candidateCount === 1 ? "video" : "videos"} published on ${s.platformLabel} this period.`}
      </h2>

      {/* Figures render themselves away when absent, so this row shows exactly
          what is known and never a gap where a tile should be. */}
      <div className="report-figures">
        <Figure value={m?.views} label="Views" delta={s.viewsDeltaPct} />
        <Figure value={m?.likes} label="Likes" />
        <Figure value={m?.comments} label="Comments" />
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
          {s.top.map((t, i) => (
            <div key={t.postId} className="report-rank">
              <div className="report-rank-number">{String(i + 1).padStart(2, "0")}</div>
              <div>
                {/* Verbatim, including typos, curly quotes and emoji: the
                    caption is the client's own writing. */}
                <div className="report-quote">{t.title ? `“${t.title}”` : "Untitled"}</div>
                {t.basis === "since-publication" && (
                  <div style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--report-muted)", marginBottom: 5 }}>
                    since publication
                  </div>
                )}
                <div className="report-figures" style={{ gap: "0 32px", marginBottom: 0 }}>
                  <Figure value={t.views} label="Views" size={22} />
                  <Figure value={t.likes} label="Likes" size={22} />
                </div>
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

  let page = 1;

  return (
    // The ONLY thing a template changes. Same tree, same data, same figures
    // -- a design may restyle anything and may decide nothing.
    <div className={`report ${templateClass(report.template)}`}>
      <section className="report-page">
        <div className="report-cover-inner">
          <Plate fill={COVER_PLATE[report.template] ?? null} />
          <div className="report-cover-title">{spaced("Social media performance report")}</div>
          <div className="report-cover-client">{report.clientName}</div>
          {platforms.length > 0 && (
            <div className="report-cover-platforms">
              {platforms.map((p) => spaced(p)).join("  ·  ")}
            </div>
          )}
          <div className="report-cover-period">{spaced(report.periodLabel)}</div>
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

          <div className="report-eyebrow" style={{ marginTop: 26 }}>
            {spaced("Top-line findings")}
          </div>
          {withViews
            .slice()
            .sort((a, b) => (b.metrics?.views ?? 0) - (a.metrics?.views ?? 0))
            .slice(0, 3)
            .map((s, i) => (
              <div key={s.platform} className="report-finding">
                <div className="report-finding-number">{String(i + 1).padStart(2, "0")}</div>
                <div>
                  <div className="report-finding-lead">
                    {s.platformLabel} delivered {N(s.metrics?.views)} views
                    {s.viewsDeltaPct != null
                      ? `, ${s.viewsDeltaPct >= 0 ? "up" : "down"} ${Math.abs(s.viewsDeltaPct).toFixed(1)}% on the previous period.`
                      : "."}
                  </div>
                  <div className="report-finding-body">{s.narrative}</div>
                </div>
              </div>
            ))}

          <Footer client={report.clientName} page={++page} period={report.periodLabel} />
        </section>
      )}

      {sections.map((s) => (
        <PlatformPage key={s.platform} section={s} report={report} page={++page} />
      ))}

      {/* Method, last, and only the notes that actually apply. A caveat about
          a figure the report does not contain is noise. */}
      <section className="report-page">
        <div className="report-eyebrow">{spaced("About these figures")}</div>
        <h2 className="report-headline">Where each number came from.</h2>
        <div className="report-finding-body" style={{ maxWidth: "68ch" }}>
          <p style={{ marginBottom: 12 }}>
            Period: {report.period.start} to {report.period.end}, inclusive.
          </p>
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
                  Figures marked <em>since publication</em> are the video&apos;s total to date rather
                  than what it earned inside this period. They appear where measurement began after
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
