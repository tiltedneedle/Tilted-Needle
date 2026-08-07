# Tilted Needle — PRD v0.5: The Unified Performance Section

**Module:** One dynamic Content section absorbing People, multi-select
order-independent filtering, real time ranges, and a Reports system.
**Status:** Approved direction from direct client feedback, 2026-08-06.
**Supersedes:** PRD v0.4 §1's two-dashboard split. That split was itself
"per direct client feedback"; live usage has now shown the People page
"isn't working properly and isn't much helpful" as a separate destination.
The question managers actually ask is combinational — *"show me Ameerh
Naran and EuroEyes, filtered to Usama and Veliko"* — and a split surface
cannot answer it. v0.4's underlying rules (per-platform separation, the
attribution constraint, scoring math) are unchanged; only the surface and
the filter model are redesigned.

---

## 1. What changes, in one paragraph

Content (`/content`) becomes the single performance surface. Its client
and person filters become **multi-select**; its period filter becomes a
**real time-range control** (presets + any custom span); selecting people
surfaces **inline per-person performance metrics** right on the page, the
same way selecting a client already surfaces a client summary. The
People dashboard retires: its roster/employment admin moves under Manage
as **Team admin**, its per-person analytics fold into Content's person
filter, and the baseline-tier vocabulary ("Top / Above / At / Below
baseline") is **removed from the product** — plain multipliers and reach
numbers only. Reports (`/reports`) grows from a time-entries export into
a **report builder**: any dimension (employee / client / platform /
project) × any duration × a formatted, exportable table.

---

## 2. The filter system (the heart of the redesign)

### 2.1 Model: a declarative set, never a sequence

A filter state is a **set of constraints**, not a series of steps. The
page renders `f(population, constraints)` — so the order in which
constraints were added *cannot* matter. This is what "the sequence and
order of filter selecting doesn't disturb the system" means structurally:

- **State lives in the URL only.** Every filter is a query param; the page
  is a pure function of the URL. Any view is shareable and reload-safe.
  (Already true today; multi-select extends it.)
- **Within one dimension: OR.** `client=A,B` = videos for A *or* B.
- **Across dimensions: AND.** `client=A,B & person=X,Y` = videos for
  (A or B) *and* credited to (X or Y).
- **Option lists never shrink.** Every dropdown lists the *unfiltered*
  population (existing house rule), so no selection order can make
  another option unreachable.
- **Empty intersections are honest.** Zero matches renders the zeroed
  summary strips plus "No videos match these filters", never a blank or
  an error. Removing any one chip must always be enough to widen out.

### 2.2 URL schema

```
/content?client=<id>,<id>&person=<id>,<id>&platform=<slug>
        &from=2026-08-01&to=2026-08-14&status=published&q=...
```

- Comma-joined ids for multi-select dimensions (`client`, `person`).
- `from`/`to` (inclusive, Dubai dates) replace the old `period=30|90|365`.
  Old `period=` links keep working via a translation shim (30 → last 30
  days) so nothing bookmarked breaks.
- `video=<id>` (single video drill-down) is unchanged, and every
  population filter still **clears** it rather than stacking beneath it —
  the conflict rule already shipped stays the law.

### 2.3 The controls

- **Client and Person become chip multi-selects**: a dropdown that stays
  open for multiple picks, selected values rendered as coral chips with
  an × each, and a count badge on the control ("Clients · 2"). The
  existing "Filtered by" chip row remains the single source of truth for
  what is applied, one × per value.
- **Time control**: one dropdown with presets — **Today, Last 7 days,
  Last 2 weeks, This month, Last month, This week, All time** — plus
  **Custom…**, which reveals two date inputs (From / To). Dubai
  semantics, same convention as the To-dos sheet. The active range is
  always spelled out in the chip row ("1–14 Aug").
- Platform / status / search are unchanged (single-select is correct for
  them; a video is not on "two statuses").

### 2.4 What the range means

The range filters **videos by `produced_at`** (the existing period
semantic), and additionally **windows the growth metrics**: "still
growing" totals and per-video gains are computed from snapshot deltas
*inside the selected range*, so "last 2 weeks" answers "what moved in
the last 2 weeks", not "what was made recently and what moved ever".
Videos with no `produced_at` appear only under All time (unchanged).

---

## 3. Inline people performance (the People merge)

When one or more people are selected, a **People in view** strip renders
between the KPI row and the video list — the person-shaped mirror of the
existing client summary:

For each selected person (a card per person, 2–3 across):

| Metric | Definition |
|---|---|
| Videos in view | count of currently-filtered videos they are credited on |
| Reach on them | per-platform views on those videos (chips, never summed) |
| Avg boost | mean boost index across their scored posts in view, as `1.24×` |
| Roles held | the role chips they hold across the filtered videos |
| Hours | tracked time on the filtered videos (when any exists) |

Rules:

- **Multipliers only, no tiers.** The "Top performer / Above baseline /
  Below baseline" labels and their color coding are removed everywhere in
  this section (and from the credit chips' tooltips). The number IS the
  information; the editorial layer around it is what the client rejected.
  The scoring *math* is untouched — only its costume goes.
- Metrics are computed **on the current intersection**: filter to EuroEyes
  and Usama's card describes Usama-on-EuroEyes, not Usama globally. That
  is the whole point of the merge.
- With clients *and* people selected, both strips render — client summary
  first (whose work), people strip second (who made it), then the videos.
- The strip links each person to `?person=<id>` alone (their full-view
  numbers) — the old person drill-down page's job, done by the same
  surface.

### 3.1 What happens to `/team`

- **Roster & employment admin** (seats, workspace roles, capacity,
  groups, add-by-email, activate/deactivate) → moves to **Manage → Team
  admin** (`/team-admin`). It is workspace administration, not analytics,
  and always was.
- **Per-person analytics** → Content's person filter (above).
- `/team` and `/team?person=X` become **redirects** into the new shapes,
  so every existing cross-link and bookmark keeps working.
- Role leaderboards: the only v0.4 People feature without a Content
  equivalent. They move into **Reports** (Employee report, sorted by
  multiplier) rather than surviving as a page — a leaderboard is a
  report, not a dashboard.

---

## 4. Home stays client-shaped

Per direct feedback ("dashboard should only display according to current
client wise"): every number on the manager Home computes over **active
clients only**. Archived/inactive clients' accounts, videos, and
snapshots drop out of the KPI counts, reach momentum, and movers list —
today they can leak in through the snapshots table. The movers list
additionally shows each video's client name, so the command center reads
client-first at a glance. (Interpretation on record: if the intent was
instead a client *switcher* on Home, that is a small follow-up — flag it.)

---

## 5. Reports: the builder

`/reports` becomes three canned, duration-scoped, formatted reports —
one per question shape — sharing one control row:

**Controls:** Report (Employee / Client / Platform) · the same time-range
control as §2.3 · optional dimension narrowing (specific employees /
clients) · Export CSV.

1. **Employee report** — one row per person: videos credited (in range),
   per-platform reach chips, avg boost ×, hours tracked, per-role video
   counts. Sortable by any column; this is where leaderboards now live.
2. **Client report** — one row per client: videos delivered, per-platform
   reach + engagement, gains in range, hours invested, hours/1k views.
3. **Platform report** — one row per platform: posts, reach, engagement,
   gains in range, top video (direct label).

Formatting rules: `.card` tables in the house style — 56px rows, eyebrow
headers, tabular numbers, totals row pinned at bottom **except no
cross-platform view totals, ever** (per-platform chips in the totals row
instead). Every report's CSV export mirrors exactly what is on screen,
one row per entity **per platform** (the flattening rule the existing
content export already follows). The existing time-entries report
remains as a fourth tab, unchanged.

---

## 6. Non-goals & removals

- **Removed:** baseline-tier labels and colors, everywhere the merge
  touches; the standalone People analytics page; single-select-only
  filtering; the fixed 30/90/365 period list.
- **Not building:** saved filter presets, scheduled/emailed reports, PDF
  export, cross-platform totals (forbidden), per-member dashboard
  customization. Each is a deliberate cut for flow-minimalism; none
  blocks a later phase.
- **Unchanged:** scoring math, RLS model, member/client role guards
  (members still never see other people's analytics — the person filter
  is manager-surface), To-dos, Training, all other sections.

---

## 7. UI standard (million-dollar, minimal)

The existing design system carries all of it — no new colors, no new
motion vocabulary: token-driven chips (coral selected state), the
established stagger/rise entrances on strip cards, count-up on strip
headline numbers, sparkline/bar primitives from Home where a strip card
earns one, `prefers-reduced-motion` flattening everything. Filter
changes animate **content, never controls** — the bar itself must feel
nailed down. Mobile: chips wrap, strips become single-column, the range
picker stacks; nothing horizontal-scrolls except tables in their own
scroll containers.

---

## 8. Implementation prompts (staged, dependency-ordered)

> Each prompt is self-contained and ends with the same verification bar:
> `tsc` clean · lint 0 errors · build passes · all unit suites · RLS
> suite untouched or extended · filters proven order-independent by test.

**Prompt 1 — Filter engine.** Extend `FilterBar` with `multi: true`
filter defs (chip dropdown, count badge, per-chip clears) and a
`range` control (presets Today / Last 7 days / Last 2 weeks / This week /
This month / Last month / All time / Custom with From–To date inputs,
Dubai semantics). URL: comma-joined ids, `from`/`to` params. Keep the
existing `clears` semantics (population filters clear `video`). Add a
pure `parseFilters(searchParams)` helper with unit tests asserting
**order-independence**: every permutation of the same params yields the
same parsed state, and unknown/malformed values degrade to "unset",
never throw.

**Prompt 2 — Data layer.** `loadContentOverview` accepts
`clientIds: string[]`, `personIds: string[]`, `range: {from, to} | null`.
Within-dimension OR, across-dimension AND, exactly as PRD §2.1. Gains
and "still growing" compute from snapshot deltas inside the range.
Legacy `period=` translates in the page. Extend the display-calc test
suite to recompute one multi-client + multi-person + custom-range view
independently and diff it against the loader.

**Prompt 3 — People-in-view strip + tier removal.** Build the per-person
metric cards per PRD §3 (computed on the current intersection), render
between KPIs and the video list, entrance-staggered. Remove tier labels/
colors (`TIER_LABELS`, tier color maps) from this surface and the credit
chip tooltips; keep plain multipliers. Delete dead tier code only where
nothing else imports it.

**Prompt 4 — Retire the People page.** Move `TeamManager` to
`/team-admin` under Manage (manager-only via the existing allow-list
default). `/team` → redirect to `/content`; `/team?person=X` → redirect
to `/content?person=X`. Update sidebar (remove People from Dashboards;
add Team admin under Manage) and every cross-link that targeted `/team`.
Nothing 404s; run the select audit after.

**Prompt 5 — Reports builder.** The three reports of PRD §5 with the
shared control row (reuse the Prompt-1 range control), house-style
tables, per-platform totals row, CSV mirroring the screen. Leaderboard
sort default on the Employee report. Time-entries report remains as-is.

**Prompt 6 — Home client-scoping + QA.** Scope every Home aggregate to
active clients; add client names to movers. Then the full QA pass: filter
permutation matrix (≥12 orderings), empty-intersection rendering, legacy
`period=` links, URL share/reload fidelity, both themes, mobile widths,
reduced motion, and the standing verification bar.

---

## 9. Open questions (answers change scope, not direction)

1. Home: "current client wise" is implemented as *active-clients-only
   scoping* — if a per-client switcher on Home was meant instead, say so
   and it is a small change.
2. Should members get a read-only Employee report of **themselves** in
   Reports (their own numbers, nobody else's)? Today `/reports` is
   manager-only via the layout allow-list, so members see none of it.
   Cheap either way.
3. RY / DRD remain unmapped in the To-dos importer — unrelated to this
   PRD but still the oldest open item on the list.

---

## 10. Built differently from the spec, and why

Three places where following §5 literally would have produced a worse
system. All shipped as described here.

1. **"Hours per 1k views" is not built.** It needs one pooled view count
   across platforms — the exact operation the whole model refuses. It is
   **hours per video** instead: same efficiency question, honestly
   answerable.
2. **The Platform report has no totals row.** Every column there would be
   a cross-platform sum. The rows already are the totals.
3. **The Client report has a "No active client" row.** Content belonging
   to an archived client (or to no client) would otherwise vanish from
   the client rows while still being counted in the Employee report's
   totals — 178 against 202 on live data. Named, the two reports
   reconcile and the gap becomes a finding rather than a discrepancy.

Home's scoping (§9.1) excludes archived clients' content from the video
count, the momentum charts, and the movers list. `/reports` deliberately
does **not**: reports are where history is analysed, and the client
filter is right there.
