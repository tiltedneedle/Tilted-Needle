# Tilted Needle — Product Requirements Document

**Module:** Time Tracking & YouTube Performance Attribution
**Status:** Draft v0.1 — pending client review
**Last updated:** 2026-07-27

---

## 1. Summary

An internal operations app that merges two things most agencies keep separate:

1. **A full Clockify-equivalent time tracker** — who worked on what, for how long, at what cost.
2. **A YouTube performance layer** — how the videos that work produced actually performed.

Joining these is the point. Clockify alone tells you effort. YouTube alone tells you outcome. Together they answer the questions an agency actually gets asked:

- Which editor's videos retain viewers best, per hour spent?
- What did we actually cost this client per 1,000 views delivered?
- Is our highest-paid scriptwriter producing above-baseline hooks?

A standalone Clockify clone is a commodity. **The join is the product.**

---

## 2. Goals & Non-Goals

### Goals
- Replace the existing Excel tracker without losing any column the team relies on.
- Rank the 5 production roles fairly, accounting for channel size, video age, and sample size.
- Give clients a self-serve view of what was delivered for them.
- Track cost and billing accurately enough to invoice from.

### Non-Goals (v1)
- Competitor//public-channel scraping outside client channels.
- Automated video editing, publishing, or YouTube content management.
- Replacing the client's own YouTube Studio workflow.

### Explicit anti-goal
Do **not** present public-metric rankings as causal explanations of performance. See §4.

---

## 3. Users & Roles

| Role | Sees | Can do |
|---|---|---|
| **Owner / Admin** | Everything in the org | Billing, rates, members, integrations, delete |
| **Manager** | All projects + team reports | Approve timesheets, assign roles, set budgets |
| **Member** (the 5 production roles) | Own entries; assigned videos | Track time, submit timesheets, view own rank |
| **Client** | Only their own channels & reports | Read-only dashboards, export |

Multi-tenant with row-level isolation. A user may belong to multiple organizations with a different role in each.

---

## 4. The Attribution Constraint (read before designing dashboards)

The brief asks to "check why a video is boosting" *without* connecting client accounts. **These two requirements are in direct conflict**, and the PRD resolves it explicitly rather than papering over it.

### What each data source provides

| Metric | Data API v3 (key only) | Analytics API (owner OAuth) |
|---|---|---|
| Views, likes, comments | ✅ | ✅ |
| Title, tags, duration, publish time | ✅ | ✅ |
| Impressions & **CTR** | ❌ | ✅ |
| **Audience retention curve** | ❌ | ✅ |
| Average view duration / watch time | ❌ | ✅ |
| Traffic sources, demographics | ❌ | ✅ |
| Subscribers gained, revenue | ❌ | ✅ |

### Why this decides the whole ranking design

Performance decomposes roughly as:

```
Views  ≈  Impressions × CTR × (retention-driven algorithmic amplification)
                        ↑                    ↑
                  thumbnail + title      hook + script + edit
                  (idea guy)             (script guy, editor)
```

**CTR isolates the idea/thumbnail work. Retention isolates the script and edit.** Both are owner-only.

With public data alone, every one of the 5 people on a video receives the *identical* signal — the view count. You can rank people by the outcome of videos they touched, but you **cannot attribute** that outcome to their specific contribution. A brilliant editor on a bad-thumbnail video scores badly, and a mediocre editor riding a great thumbnail scores well.

### Decision: hybrid, degrading gracefully

- **Baseline (always):** Data API v3 for every tracked channel. No client cooperation needed.
- **Enhanced (per client):** one-time read-only OAuth (`yt-analytics.readonly`) unlocks CTR and retention for that channel.
- The UI must **visibly label** which mode each channel is in. Enhanced-mode scores and baseline-mode scores are never mixed in a single ranking table without a marker.

**Product consequence:** true per-role attribution is a feature of *connected* channels. For unconnected channels the app reports outcome, not contribution. This must be stated plainly to the client — it is the difference between a defensible internal metric and a number that quietly misjudges people's work.

---

## 5. Performance Scoring Model

Designing this properly matters, because these numbers will affect how people are evaluated. A naive "average views per person" is actively unfair for four reasons: channel size dominates, older videos accumulate more views, view distributions are extremely heavy-tailed, and one lucky video beats fifty solid ones.

### Step 1 — Fix the measurement window

Never compare lifetime views across videos of different ages. Snapshot every video and evaluate at a fixed maturity, default **V₇ = views at 7 days** (configurable; V₂₈ for slower niches).

This requires storing a **time series**, not a current value — see §7 ingestion.

### Step 2 — Normalize against the channel's own baseline

```
baseline_c = median(V₇) over the channel's previous 10 videos
PerfIndex  = V₇(video) / baseline_c
```

A video at 2.0 did twice its channel's typical numbers. This makes a 50k-view video on a small channel and a 5M-view video on a large one directly comparable.

### Step 3 — Log-transform

View distributions are log-normal; one viral outlier would otherwise dominate every average.

```
s = ln(PerfIndex)          // 0 = exactly at baseline, positive = over
```

### Step 4 — Recency weighting

```
w_time = 0.5 ^ (age_days / 90)     // 90-day half-life
```

### Step 5 — Shrinkage toward the role mean (the important part)

Someone with two videos should not top the leaderboard on luck. Empirical-Bayes shrinkage pulls small samples toward the average for their role:

```
personRaw  = Σ(w_time · s) / Σ(w_time)
n          = effective video count for that person+role
k          = 5                                  // tunable prior strength
Score      = (n / (n + k)) · personRaw  +  (k / (n + k)) · roleMean
```

With n=1 the score is ~83% role-average. At n=20 it is ~80% their own record. Confidence rises only as evidence does.

### Step 6 — Role-specific signal (connected channels only)

| Role | Primary signal | Rationale |
|---|---|---|
| Idea guy | CTR vs. channel baseline | Concept and title drive the click |
| Thumbnail/Videographer | CTR + first-frame retention | Visual draw |
| Script guy | Retention at 30s / 60s | The hook is the script's job |
| Editor | Retention curve AUC, avg view duration | Sustained watch is the edit |
| QC | Dislike ratio, comment sentiment, re-upload rate | Defect prevention |

Each computed as its own `PerfIndex` against the channel baseline, then run through Steps 3–5 identically.

### Step 7 — Present as tiers, not decimals

Surface percentile bands within role (Top 10% / Above / At / Below baseline) plus a confidence indicator driven by `n`. **Do not display a precise-looking number derived from three videos.**

### Guardrails
- Minimum 3 videos before a person is ranked publicly at all.
- Show sample size beside every score, always.
- Never rank across different roles — editors compete only with editors.

---

## 6. Functional Scope

Client selected the **full Clockify surface**. Documented in full here; sequenced in §9.

### 6.1 Time Tracking (Core)
- Live timer (start/stop/resume), manual entry, bulk edit, duplicate
- Timesheet grid (weekly), calendar view, drag-to-create
- Projects → tasks → subtasks; clients; tags; descriptions
- Billable/non-billable flag per entry
- Idle detection, Pomodoro, reminders
- Required-fields enforcement, time rounding rules
- Favourites and recent entries

### 6.2 Billing & Rates
- Hourly billable rates: workspace → member → project → task precedence
- Cost rates (internal) for margin reporting
- Project budgets and time estimates, with alert thresholds
- Expenses (fixed + per-unit), receipt attachments
- Invoices from tracked time and expenses; tax, discount, statuses
- Currency per client

### 6.3 Team Management
- Approvals: timesheet submission → manager review → lock
- Time off: policies, accrual, balances, holidays, requests
- Scheduling: capacity planning, assignments, milestones
- User groups, granular per-resource permissions
- Invitations, deactivation, seat management

### 6.4 Reporting
- Summary, detailed, weekly reports
- Group by project/client/user/tag/task/date
- Saved reports, scheduled email delivery, shared public links
- Export: CSV, XLSX, PDF
- Custom fields on entries/projects, reportable

### 6.5 Advanced (later phases)
- Kiosk mode, GPS, screenshots, activity tracking
- SSO/SAML, SCIM
- Audit log, webhooks, public API
- QuickBooks/Xero export

### 6.6 YouTube Module
- Channel registration per client; OAuth connect flow with clear status
- Video catalogue with automatic sync
- **Role assignment: the 5 entities per video** (extensible — roles are data, not enum)
- Metric snapshots and time-series charts
- Per-person dashboard: assigned videos, aggregate views/likes, rank, trend
- Per-client dashboard: total delivered views, videos shipped, spend, cost-per-1k-views
- Boost detection: flag videos exceeding baseline by configurable threshold
- Excel importer for historical backfill *(blocked — see §11)*

### 6.7 The Join (differentiator)
- Link time entries to specific videos
- **Hours per video**, by role
- **Cost per video** (cost rates × hours) → **cost per 1,000 views**
- ROI leaderboard: performance per hour invested, not just performance
- Client profitability: billed vs. cost vs. delivered reach

---

## 7. Data & Ingestion

### Snapshot cadence
Fixed-window scoring requires history. Tapering schedule keeps quota low:

| Video age | Frequency |
|---|---|
| 0–48 h | Hourly |
| 2–30 days | Daily |
| > 30 days | Weekly |

### Quota
Data API v3: 10,000 units/day. `videos.list` = 1 unit and accepts **50 IDs per call**. 3,000 tracked videos refreshed daily ≈ 60 units. Quota is not a practical constraint for public metrics; batch aggressively regardless.

### Reliability
- Ingestion is idempotent and resumable; store `last_synced_at` per video.
- Deleted/privated videos are soft-flagged, never hard-deleted (history must survive).
- OAuth refresh-token failures must alert, not silently degrade to stale data.

### Schema sketch

```
organizations, memberships, user_groups
clients, projects, tasks, tags
time_entries, time_entry_tags
rates, budgets, expenses, invoices, invoice_lines
approvals, time_off_policies, time_off_requests
custom_fields, custom_field_values, audit_log

channels           (client_id, yt_channel_id, connection_mode)
oauth_connections  (channel_id, encrypted refresh token, scopes, status)
videos             (channel_id, yt_video_id, published_at, ...)
video_snapshots    (video_id, captured_at, views, likes, comments)     -- public
video_analytics    (video_id, date, impressions, ctr, avd, retention)  -- OAuth only
video_assignments  (video_id, user_id, role_id)                        -- the 5 entities
roles              (name, signal_config)
scores             (user_id, role_id, period, score, n, percentile)
time_entries.video_id                                                  -- the join
```

Every tenant-scoped table carries `org_id`.

---

## 8. Security

The repository is **public** and the Supabase publishable key ships in the browser bundle. Row Level Security is therefore the *only* thing standing between tenants.

- **RLS enabled on every table, no exceptions.** A single table without it exposes all tenants.
- Policies keyed on `org_id` via the authenticated user's membership.
- Client-role users restricted to their own `client_id` subtree.
- **The service_role key must never reach the browser** — server-side routes only.
- **YouTube OAuth refresh tokens are the crown jewels.** Encrypted at rest (Supabase Vault), never returned to any client, never logged. A leak here exposes client analytics.
- Audit log for rate changes, role assignments, approvals, and score recomputation.
- Rotate the credentials already exposed during setup before any real data lands.

---

## 9. Proposed Phasing

Full Clockify + full YouTube attribution + full multi-tenancy is a multi-quarter build. Sequenced so something is usable early:

| Phase | Contents | Why here |
|---|---|---|
| **0 — Foundation** | Auth, orgs, memberships, RLS baseline, schema | Everything depends on tenancy being right |
| **1 — Core tracking** | Timer, entries, projects/tasks/clients/tags, timesheet, basic reports | Replaces the Excel sheet; earliest real value |
| **2 — YouTube ingest** | Channels, video sync, snapshots, public metrics, video↔time join | Unlocks the differentiator |
| **3 — Scoring** | Baselines, PerfIndex, shrinkage, role dashboards, boost detection | Needs Phase 2 history to be meaningful |
| **4 — Billing** | Rates, budgets, expenses, invoicing, cost-per-1k-views | Revenue-facing |
| **5 — Client portal** | Client role, scoped dashboards, exports, shared links | External exposure — after RLS is battle-tested |
| **6 — OAuth analytics** | Analytics API, CTR/retention, per-role attribution | Gated on client cooperation |
| **7 — Team ops** | Approvals, PTO, scheduling, permissions | Scales with headcount |
| **8 — Advanced** | Kiosk, GPS, SSO, audit, public API, integrations | Enterprise surface |

**Phase 3 has a cold-start problem:** scoring needs ~10 videos of history per channel for a stable baseline. Either backfill from the Excel sheet or accept that meaningful ranks appear a few weeks after launch. Flag this to the client early — it is the most likely source of "why doesn't this work yet" friction.

---

## 10. Success Metrics

- Excel tracker retired within 30 days of Phase 1.
- ≥90% of tracked videos have all 5 roles assigned.
- Time-entry capture within 5% of actual (spot-audited).
- ≥3 client channels OAuth-connected by end of Phase 6.
- Every client dashboard answers "what did we deliver for you" without manual prep.

---

## 11. Open Questions

**Blocking:**
1. **The Excel sheet has not been provided.** It is the authoritative source for required fields and for historical backfill. Everything in §6.6 is provisional until reviewed.
2. Will clients realistically grant read-only OAuth? Determines whether §5 Step 6 ever ships.
3. Requirements message was truncated mid-sentence — the final requirement is unknown.

**Needs decision:**
4. Scoring window — V₇ or V₂₈? Depends on typical view velocity per niche.
5. Shorts vs. long-form: separate baselines? (Strongly recommended — the view scales are incomparable.)
6. Are the 5 roles fixed, or should roles be configurable per org?
7. Can one person hold multiple roles on one video? (Assumed yes.)
8. Existing Clockify data to migrate, or greenfield?
9. Are scores visible to the people being scored, or managers only? Affects UI and morale considerably.
