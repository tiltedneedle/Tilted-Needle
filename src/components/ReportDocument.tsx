import type { ClientReport, ReportPlatformSection } from "@/lib/buildClientReport";

/**
 * The client report as a document, in the grammar the agency already uses.
 *
 * Reproduced from the two real reports rather than invented: wide-tracked
 * small caps over a rule for section markers, a headline sentence carrying the
 * finding with the figures supporting it, large numerals over small-cap
 * labels, findings numbered 01/02/03, and a footer on every sheet. Those
 * choices are the reason a page reads as this agency's report and not as a
 * dashboard screenshot.
 *
 * One page per section, because that is how the originals paginate and
 * because a platform's figures split across a sheet boundary is the specific
 * ugliness the print rules exist to prevent.
 *
 * Every number here is either measured or absent. Nothing is estimated, and a
 * missing figure prints as a stated gap rather than a zero -- a zero is a
 * claim, and one nobody has evidence for.
 */

const N = (n: number | null | undefined) =>
  n == null ? null : n.toLocaleString("en-GB");

/** Wide letter-spacing done as real spaces, as the source documents set it. */
const spaced = (s: string) => s.toUpperCase().split("").join(" ");

function Footer({ client, page, period }: { client: string; page: number; period: string }) {
  return (
    <div className="report-footer">
      <span>{client}</span>
      <span>{page}</span>
      <span>Social media performance report · {period}</span>
    </div>
  );
}

function Figure({
  value,
  label,
  delta,
}: {
  value: number | null;
  label: string;
  delta?: number | null;
}) {
  return (
    <div>
      <div className="report-figure-value">
        {N(value) ?? <span style={{ fontSize: 15, color: "var(--report-muted)" }}>not recorded</span>}
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
 * The bar is for scanning the shape of a distribution; the number is what gets
 * quoted back. Scaled against the largest row rather than 100, so a set that
 * legitimately sums to 60% still fills the space and stays readable.
 */
function BarList({ rows }: { rows: { label: string; value: number; suffix?: string }[] }) {
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

  return (
    <section className="report-page">
      <div className="report-eyebrow">
        {spaced("Channel growth")} &nbsp;·&nbsp; {spaced(s.platformLabel)} &nbsp;·&nbsp;{" "}
        {spaced(report.periodLabel)}
      </div>

      {/* Two different absences, and conflating them misleads.
          "No figures were recorded" on a page that then lists three real
          videos reads as a contradiction: what is missing is the ACCOUNT-level
          data (followers, reach), which only a person can enter. The video
          data is measured and present. Say which is which. */}
      <h2 className="report-headline">
        {m
          ? s.narrative
          : s.top.length > 0
            ? `${s.platformLabel} published ${s.candidateCount} ${s.candidateCount === 1 ? "video" : "videos"} in this period. Audience figures have not been recorded.`
            : s.narrative}
      </h2>

      {m ? (
        <div className="report-figures">
          <Figure value={m.views} label="Views" delta={s.viewsDeltaPct} />
          <Figure value={m.likes} label="Likes" />
          {isYouTube ? (
            <>
              <Figure value={m.subscribers} label="Subscribers" />
              <Figure value={m.netSubscribers} label="New subscribers this period" />
            </>
          ) : (
            <>
              <Figure value={m.followers} label="Followers" />
              <Figure value={m.netFollowers} label="Net new followers this period" />
            </>
          )}
          {m.reach != null && <Figure value={m.reach} label="Accounts reached" />}
          {m.profileViews != null && <Figure value={m.profileViews} label="Profile visits" />}
        </div>
      ) : (
        /* Named precisely, with the fix. A blank here would read as a design
           choice rather than as missing evidence. */
        <p
          style={{
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "var(--report-muted)",
            marginBottom: 20,
          }}
        >
          Audience figures for @{s.handle} have not been recorded for this period. Followers,
          reach and profile visits come from the platform&apos;s own dashboard — enter and confirm
          them on Data sync and this section fills in.
        </p>
      )}

      {s.top.length > 0 && (
        <>
          <div className="report-eyebrow" style={{ marginTop: 26 }}>
            {spaced(`Top ${s.top.length === 1 ? "video" : `${s.top.length} videos`}`)}
          </div>
          {s.top.map((t, i) => (
            <div key={t.postId} className="report-rank">
              <div className="report-rank-number">{String(i + 1).padStart(2, "0")}</div>
              <div>
                {/* Verbatim, including typos, curly quotes and emoji. The
                    caption is the client's own writing. */}
                <div className="report-quote">
                  {t.title ? `“${t.title}”` : "Untitled"}
                </div>
                <div className="report-figures" style={{ gap: "0 32px", marginBottom: 0 }}>
                  <div>
                    <div className="report-figure-value" style={{ fontSize: 22 }}>
                      {N(t.views)}
                    </div>
                    <div className="report-figure-label">Views</div>
                  </div>
                  <div>
                    <div className="report-figure-value" style={{ fontSize: 22 }}>
                      {N(t.likes)}
                    </div>
                    <div className="report-figure-label">Likes</div>
                  </div>
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
  const entered = report.sections.filter((s) => s.metrics);
  const platforms = report.sections.map((s) => s.platformLabel);

  // Findings are generated from what moved, and only from what was measured.
  // The originals open with three; fewer is honest when fewer are supported.
  const findings = report.sections
    .filter((s) => s.metrics?.views != null)
    .sort((a, b) => (b.metrics?.views ?? 0) - (a.metrics?.views ?? 0))
    .slice(0, 3);

  let page = 1;

  return (
    <div className="report">
      {/* Cover */}
      <section className="report-page">
        <div className="report-cover-inner">
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

      {/* Executive summary. Only rendered when something was actually
          measured -- a summary of nothing is the emptiest page a client can
          receive. */}
      {entered.length > 0 && (
        <section className="report-page">
          <div className="report-eyebrow">{spaced("Executive summary")}</div>
          <h2 className="report-headline">
            {report.periodLabel} across {platforms.length}{" "}
            {platforms.length === 1 ? "channel" : "channels"}.
          </h2>

          <div className="report-figures">
            <Figure value={report.combined.views} label="Combined views" />
            <Figure value={report.combined.likes} label="Combined likes" />
          </div>

          {/* The caveat sits with the figure, on the page, because this is the
              one number on the document that is a sum of things measured on
              different scales. */}
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
            rows={entered
              .filter((s) => s.metrics?.views != null)
              .map((s) => ({ label: s.platformLabel, value: s.metrics!.views as number }))
              .sort((a, b) => b.value - a.value)}
          />

          {findings.length > 0 && (
            <>
              <div className="report-eyebrow" style={{ marginTop: 26 }}>
                {spaced("Top-line findings")}
              </div>
              {findings.map((s, i) => (
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
            </>
          )}

          <Footer client={report.clientName} page={++page} period={report.periodLabel} />
        </section>
      )}

      {report.sections.map((s) => (
        <PlatformPage key={s.platform} section={s} report={report} page={++page} />
      ))}

      {/* Method, last. Every claim on the preceding pages should be traceable
          from here, including the two places where our dates differ. */}
      <section className="report-page">
        <div className="report-eyebrow">{spaced("About these figures")}</div>
        <h2 className="report-headline">Where each number came from.</h2>
        <div className="report-finding-body" style={{ maxWidth: "68ch" }}>
          <p style={{ marginBottom: 12 }}>
            Period: {report.period.start} to {report.period.end}, inclusive.
          </p>
          <p style={{ marginBottom: 12 }}>
            Videos are ranked by the views they gained inside the period, not by their lifetime
            totals — a video published months ago can still be the month&apos;s best performer, and
            one with a large historic count is not necessarily doing anything now.
          </p>
          <p style={{ marginBottom: 12 }}>{report.likesCaveat}</p>
          <p>
            Audience figures — followers, reach and profile visits — are transcribed from each
            platform&apos;s own dashboard, because no public interface publishes them. Where a
            figure is absent it is stated as such and never shown as zero.
          </p>
        </div>
        <Footer client={report.clientName} page={++page} period={report.periodLabel} />
      </section>
    </div>
  );
}
