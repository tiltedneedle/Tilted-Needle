# PRD — Content page: eleven changes

**Summary.** This document specifies eleven changes to the Tilted Needle content-performance tracker: two paint/layout bug fixes (dropdowns painted under stat cards; sort controls vanishing when a client is selected), four contained UI additions (platform icons, per-video thumbnails, add/remove client on Guidelines, per-account sync toggle on the Data page), three data-model changes (YouTube Shorts as its own platform, active-clients-only enforcement across every read path, a manual approval queue that separates agency work from client self-posts), and two structural features (per-role employee performance tables driven by a new role filter, and cross-platform video merge with in-place bulk actions). Together they close the gap between what the app *shows* and what the agency *did*: today a synced video the client posted themselves counts toward every headline number, one real video posted to three platforms appears as three unrelated rows, and the numbers on `/home`, `/reports` and the public API include clients the team stopped working with. Several of these changes will move numbers that people have been reading. Where that happens it is called out explicitly rather than buried.

---

## Constraints that shape every decision

These are non-negotiable and none of the eleven changes may violate them.

1. **No OAuth, ever.** Enforced by a schema constraint. Every platform read is public-read or a metered vendor call. Nothing in this document proposes a connected-account flow.
2. **Apify spends the client's real money.** `src/lib/providers/instagram.ts` is metered; `capability.isMetered` (`src/lib/providers/types.ts:44`) exists because a fact buried in prose is a fact the UI cannot read. Any change that increases fetch volume must say so.
3. **Views are never summed across platforms.** `ContentOverview.tsx:32-35` (`peakViews` = max, not sum), `PlatformReach.tsx` header comment, `reports.ts` (buildEmployeeReport sums likes and comments, never views). Likes and comments **are** summable. Every new table, CSV, merge summary and role board in this document obeys this.
4. **RLS is the only tenant boundary, and it is row-level.** It cannot scope a column. Nothing here may rely on RLS to hide a field, and any bulk update must carry an explicit `.eq("workspace_id", ws)` rather than trusting RLS (see `actions.ts:570-580`, `updateContentItem`, which does not and should not be copied).
5. **PostgREST silently caps unbounded selects at 1000 rows.** `src/lib/selectAll.ts` exists for this and its header records `content_assignments` already crossing that line on the live workspace. Every unbounded read added by this work uses `selectAll`, or an exact `{ head: true, count: "exact" }` count.
6. **Native `<select>` is gone app-wide.** `src/components/ui/Select.tsx:6-23` documents why (the OS draws the option list; no CSS reaches inside). Every new dropdown uses `Select.tsx` or `FilterBar`'s `MultiSelect`.
7. **Next.js 16.2.12 App Router.** `revalidateTag(tag, "max")` two-arg form is required (`actions.ts:31` already uses it). **A function prop passed from a Server Component to a Client Component crashes at runtime and the build does not catch it** on session-gated pages — `/content` is session-gated (`content/page.tsx:63`, plus the allow-list in `src/app/(app)/layout.tsx:16-26,44-51`). Every new component prop in this document is plain serialisable data.
8. **Business timezone is Asia/Dubai, fixed UTC+4.** Any date bucketing added here uses it.

---

## 1. Merge one video across platforms + multi-select bulk actions

### What the user asked for
> "Merge the same video on two or three different platforms and assign roles collectively; plus multi-select videos for bulk actions. Don't incorporate this feature like not a separate page or section."

### Current behaviour
- The sync creates **one `content_items` row per discovered post per account**. Free path: `src/lib/syncRunner.ts:174-226` filters `unseen` and, for each, inserts a fresh `content_items` row (189-202) then hangs exactly one `platform_posts` row off it (205-221). Metered path does the same at `syncRunner.ts:545-581`. Nothing looks for an existing item. One real video on IG + TikTok + YouTube becomes three content_items.
- **The data model already supports the merged shape.** `platform_posts.content_item_id not null references content_items on delete cascade`, `unique (content_item_id, account_id)` — `supabase/migrations/20260727140000_phase2_content_layer.sql:93-112`. One item legitimately holds N posts, one per account. Everything keyed off `platform_post_id` (`post_snapshots` :116-131, `post_analytics`, `post_comments`, `video_replay_map`) travels with the post for free.
- **There is no selection affordance.** `ContentOverview.tsx` (272 lines) has no checkbox, no selection state. `VideoTile.tsx:359-373` props are exactly `{video, href, workspaceId, roles, members, canManage}`.
- **No merge action exists** anywhere in `src/`, `supabase/migrations/` or `worker/`.
- **`content_assignments` has no UPDATE policy.** RLS enabled at `20260727140000:244`; only `assignments_select` / `_insert` / `_delete` exist (`20260727140000:291-296`), redefined but still only those three at `20260728140000_phase5_client_portal.sql:176-186`. **Credits cannot be repointed through PostgREST at all.**
- `content_delete` requires `can_manage_workspace` (`20260727140000:264-265`), but `content_update` and `posts_update` only require a non-client member (`20260728140000:110-113,130-133`). A member can half-merge and then be unable to finish.
- The only bulk-shaped action in `actions.ts` is `bulkApproveHighConfidence` (`2062-2094`), which operates on `import_rows`.

### The design

**A. `merge_content_items` — one SECURITY DEFINER transaction.** Not gold-plating: credits physically cannot be repointed client-side, and a multi-step merge that dies after repointing posts strands hours and credits on a row about to be deleted. Copy the shape of `commit_import_batch` (`20260728230000_fix_commit_security_definer.sql:17-36`) — `security definer`, `set search_path = public`, explicit `can_manage_workspace` guard at the top.

```
merge_content_items(
  p_survivor uuid, p_losers uuid[],
  p_title text default null, p_produced_at date default null,
  p_client_id uuid default null, p_allow_client_change boolean default false
) returns uuid   -- the content_merges.id
```

Refusals, raised **before any write**: survivor in losers or losers empty; `array_length(p_losers,1) > 4` (a cross-posted video lives on 2–5 platforms; a 20-row merge is always a mistake); mixed `workspace_id`; not a manager; **any two of the set holding a post on the same `account_id`** (name the account, refuse — see edge cases); distinct non-null `client_id` without `p_allow_client_change` + `p_client_id`.

Write order — **the order is load-bearing**:
1. Snapshot every loser `content_items` row into `journal`.
2. `update time_entries set content_item_id = p_survivor` — **first**, because `time_entries.content_item_id` is `on delete set null` (`20260727140000:166-169`).
3. `update import_rows set suggested_content_item_id / resolved_content_item_id = p_survivor` — also `on delete set null` (`20260728220000:42-44`), and `commit_import_batch` reads it (`20260728230000:61-64`).
4. Transcripts: `unique (content_item_id)` (`20260808160000:38`) permits one. Keep the survivor's; else the best loser's, preferring `source='manual'` over `'public'` (the migration itself notes ASR "mangles names, brands and accents", `20260808160000:28-30`), tiebreak on `length(full_text)`. **Every transcript not kept is serialised whole into `journal`.**
5. Credits: `insert into content_assignments (…) select … from loser rows on conflict (content_item_id,user_id,role_id) do update set source='manual' where content_assignments.source='derived' and excluded.source='manual'`, then delete the loser rows (journalled). Insert+delete, never UPDATE.
6. `update platform_posts set content_item_id = p_survivor` — carries snapshots, analytics, comments, replay maps untouched.
7. `ai_analyses`: **archive into `journal`, then delete. Do not repoint.**
8. `ingest_jobs`: delete losers' rows where `status in ('pending','running')` and `kind in ('comments','transcript','analyse')` (the content_item kinds — `worker/enqueue.mjs:241-250`). Leave terminal rows as history.
9. Apply metadata survivorship (table below) to the survivor.
10. `delete from content_items where id = any(p_losers)`.
11. Insert the `content_merges` row.

**B. Reversibility via a journal, not a tombstone.** `undo_content_merge(p_merge_id)` re-inserts the loser `content_items` rows **with their original uuids** and reverses the recorded movements. It raises if already undone, if the survivor is gone, or if any journalled `platform_posts.id` is missing. It explicitly does **not** revert edits made to the survivor after the merge, and the UI says so.

**C. Metadata survivorship**

| Column | Rule |
|---|---|
| `title` | **Explicit user pick** (radio over distinct titles, survivor pre-selected). The sync writes each platform's own caption (`syncRunner.ts:193`), so there is no defensible automatic winner. |
| `produced_at` | **Earliest non-null**, not the survivor's. Cross-posting later does not change when it was produced, and taking the survivor's can push it out of a `from`/`to` range (`dashboards.ts:454-459`). |
| `client_id` | Survivor's, unless clients differ → refuse (see edge cases). |
| `length_seconds` | Survivor's, but a **>2s spread across the set raises a warning requiring a checkbox** — differing durations are the strongest signal these are not the same video. |
| `notes` | Survivor's kept; any loser note that is *not* the auto string `Discovered automatically from …` (`syncRunner.ts:199,554`) is appended with a provenance line. |
| `subject`, `hook`, `music_used`, `description` | Survivor wins when non-null; otherwise backfill from the oldest loser with a value. Never overwrite non-null. |
| `topic_labels` | Non-null wins; union + dedupe if both. |

Everything discarded is in `journal`.

**D. Bulk actions, in place.** No new page, no new route, no new section.
- A `Select` text button in the row that already exists — `ContentOverview.tsx:225-248`, the `SectionHeading` children slot beside `Export CSV` and the sort buttons. Flips a local `selecting` boolean.
- New **optional** props on `VideoTile` (`VideoTile.tsx:359-373`): `selectable?: boolean; selected?: boolean; onToggleSelect?: (id: string, shiftKey: boolean) => void`. They must be optional: `src/app/(app)/clients/[id]/[accountId]/page.tsx:111` is a **Server Component** rendering `VideoTile` directly. Checkbox renders in a 28px left gutter only when `selectable`.
- Action bar: a `sticky bottom-0` strip **inside** the videos `<section>`, present only while `selected.size > 0`. Reads `N selected · M not currently visible`, offers `Show selected only`. Confirmations expand the strip upward into a panel — there is no dialog component in `src/components/ui/` (EmptyState, Select, Skeleton, ThemeToggle, Toast), and `confirm()` (`ImportManager.tsx:218`) cannot carry a metadata diff.
- **Selection clears on filter change.** Filters are URL state and a soft nav re-renders `ContentOverview` at the same element position, so React preserves its state. Compute `sig = videos.map(v=>v.id).join(",")` and clear during render when it changes, using the sanctioned pattern at `LoadMoreList.tsx:38-43`.
- **Selection survives sort change** (which collapses `LoadMoreList` back to 10 rows — `LoadMoreList.tsx:36-47` + `ContentOverview.tsx:254` `resetKey={sort}`) but the bar must state how many are off-screen.

Actions offered: Assign role (member × role, one multi-row upsert), Remove role credit, Set client (**manager**, states that it changes portal visibility), Set produced_at, Export selected CSV, **Merge…** (**manager**, 2 ≤ N ≤ 5).

**E. Server actions** in `src/app/actions.ts` beside `deleteContentItem` (`582-589`): `mergePreview`, `mergeContentItems`, `undoContentMerge`, `assignRoleBulk`, `unassignRoleBulk`, `updateContentItemsBulk`. Each maps PG `23505` to a human string the way `addPlatformPost` (`609-611`) and `assignRole` (`684-686`) do, writes `logAudit` (`src/lib/audit.ts:13-33`) with `entityType: "content_items"` and actions `content.merge` / `content.merge_undone` / `content.bulk_update`, and ends with `revalidatePath("/content")` + `revalidateTeam()` (`actions.ts:28-32`). `updateContentItemsBulk` allowlists `client_id, produced_at, subject, hook, music_used, notes` and carries an explicit `.eq("workspace_id", ws)`.

**F. Durable undo.** Toasts auto-dismiss after 4s (`ui/Toast.tsx:38-40`), so undo cannot live only there. The durable affordance is a line on the survivor's `ContentDetail`: `Merged from 3 items on 12 Aug · Undo`, fed by a `content_merges` lookup in the single-video branch (`content/page.tsx:510-593`).

### Schema / migration

```sql
create table content_merges (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces on delete cascade,
  actor_id     uuid references profiles on delete set null,
  survivor_id  uuid not null references content_items on delete cascade,
  loser_ids    uuid[] not null,
  journal      jsonb not null,
  undone_at    timestamptz,
  created_at   timestamptz not null default now()
);
alter table content_merges enable row level security;
-- select: can_manage_workspace(workspace_id)
-- insert: workspace member and not is_client_user
-- NO update policy, NO delete policy: undone_at is stamped only inside the RPC.
```
Plus `merge_content_items` and `undo_content_merge`, both `language plpgsql security definer set search_path = public`; `revoke all … from public, anon; grant execute … to authenticated`.

### Edge cases and deliberate refusals
- **We refuse a `merged_into` tombstone column.** Thirteen production readers of `content_items` would each need `.is("merged_into", null)` forever — `content/page.tsx:111`, `content/page.tsx:512`, `home/page.tsx:125`, `import/page.tsx:42`, `portal/page.tsx:20`, `track/page.tsx:49`, `api/v1/content/route.ts:22`, `dashboards.ts:195`, `homeData.ts:56`, `homeData.ts:226`, `pipelineStatus.ts:21`, `worker/jobs/comments.mjs:197,203`, `worker/jobs/weeklyRead.mjs:41` — and one miss renders a permanent zero-post ghost video. RLS cannot cover it: the worker and `cachedRankings` use the service client.
- **We refuse to auto-resolve an account collision.** Dropping a `platform_posts` row cascades its entire `post_snapshots` series plus comments, analytics and replay map. That history cannot be re-fetched for past dates. Refuse and name the account; the user removes the duplicate deliberately via `deletePlatformPost`.
- **We refuse to repoint `ai_analyses`.** `input_digest` is described at `20260808160000:105-108` as the single most effective cost control available. A repointed digest hashes a post set the survivor never had, so it reads as a valid cache hit and suppresses an analysis that should be paid for.
- **We refuse to repoint pending `ingest_jobs`.** `ingest_jobs_one_outstanding` is `unique (kind, subject_id) where status in ('pending','running')` (`20260808160000:156-158`).
- **We refuse bulk delete.** Deleting content_items cascades to `platform_posts` → `post_snapshots`, with no journal behind it.
- **We refuse "select all filtered."** `Select all visible` only.
- **We refuse a combined views figure on the merged survivor.** A merged row holding IG + TikTok + YouTube is exactly the shape that invites it. `exportVideos` (`ContentOverview.tsx:36-77`) correctly emits three CSV rows for the survivor.
- **Not in scope, but stated:** without a dedupe guard in `syncRunner.ts:186-226` and `:545-581`, merging is a permanent recurring chore. The manual-entry guard already exists (`lookupContentUrl`, `actions.ts:393-490`) and never reached the sync path. Separate review.

### Acceptance criteria
- [ ] Merging three sync-created duplicates leaves one content_item with three platform_posts, one per account; `count(*)` on `post_snapshots` for those posts is unchanged before and after.
- [ ] `sum(duration_seconds)` of time_entries on the survivor after == pre-merge sum across the whole set; no row in the workspace has a `content_item_id` that went from non-null to null.
- [ ] Every loser `content_assignments` row exists on the survivor, deduped by `user_id+role_id`; where `manual` collided with `derived`, the survivor row is `manual`.
- [ ] A merge where two items share an `account_id` raises, names the account, and leaves row counts on content_items / platform_posts / post_snapshots / content_assignments / time_entries byte-identical.
- [ ] A merge across two `client_id`s raises unless `p_allow_client_change` and `p_client_id`; when supplied, survivor's `client_id == p_client_id` and `audit_log` records `content.merge`.
- [ ] Two transcripts → exactly one `video_transcripts` row on the survivor (the `manual` one when present); the discarded `full_text` and `segments` are verbatim in `content_merges.journal`.
- [ ] Losers' `ai_analyses` rows absent from the table, present in `journal`; survivor's untouched.
- [ ] No `pending`/`running` `ingest_jobs` row of kind `comments`/`transcript`/`analyse` references a deleted content_item.
- [ ] No `import_rows` pointer was set to NULL.
- [ ] `undo_content_merge` restores losers **at their original uuids**; a bookmarked `/content?video=<loserId>` resolves again; every conservation assertion holds in reverse.
- [ ] `undo_content_merge` raises on second call, on missing survivor, on missing journalled post id — and leaves `undone_at` unset each time.
- [ ] A non-manager member calling `merge_content_items` gets `insufficient privileges` and writes nothing.
- [ ] 5+ losers raises before any write.
- [ ] Select rows → change a filter → selection empty, bar gone. Select rows → change sort → bar reads `N selected · M not currently visible`, and `Show selected only` reveals exactly those rows.
- [ ] `/clients/<id>/<accountId>` renders with no runtime error after `VideoTile` gains the props (it passes none). `/content` with one client selected renders.
- [ ] 30-video role assignment issues **one** insert and **one** `revalidateTeam()`; re-running is a no-op reporting success, not "Already assigned."
- [ ] `updateContentItemsBulk` rejects any key outside the allowlist and its query carries `workspace_id`.
- [ ] `grep '<select' <diff>` returns nothing.
- [ ] `scripts/rls-test.mjs` passes; `scripts/select-audit.mjs` validates every new select string.
- [ ] A direct PostgREST update of `content_merges.undone_at` by a manager is refused.

---

## 2. Role filter + per-role employee performance tables

### What the user asked for
> "Role filter in Content + per-role employee performance tables (the ones removed with the People section), collapsed to headings by default, click to expand; scoped by client, by date, by selected role; selected employees highlighted."

### Current behaviour
- **There is no role filter.** `ContentFilterState` (`src/lib/contentFilters.ts:17-27`) is `{clientIds, personIds, platform, status, q, from, to, videoId}`. `parseFilters` (`49-79`) parses nothing named role. The searchParams type at `content/page.tsx:43-51` enumerates only client/video/platform/period/person/status/q, and an unlisted param is simply never read.
- **Roles are already loaded on the page.** `content/page.tsx:133` calls `loadRoles(supabase, ws)` → `dashboards.ts:545-552`, returning `{id, slug, name}` ordered by `sort_order`. Currently passed only as `workspaceRoles` to `ClientDetail`/`ContentOverview` for the credit circles.
- **Role credits are already in memory, fully paged.** `rankings.assignments` carries `{id, content_item_id, user_id, userName, roleSlug, roleName}` (`src/lib/performanceData.ts:256-263`, from a `selectAll` read at `80-88`). **No new query and no migration are needed.**
- Roles are workspace rows, not an enum: `20260727140000_phase2_content_layer.sql:137-145`, `unique (workspace_id, slug)`, seeded at `171-182` and again in `create_workspace` at `205-211` — `idea, script, videographer, editor, qc`. `dashboards.ts:541-543` explicitly warns not to assume the seeded five.
- **The old per-role boards were deleted.** Commit `37e75fd` removed `src/components/PeopleOverview.tsx` (311 lines), which rendered "Ranking by role" as a `grid sm:grid-cols-2` of cards, **always expanded**, each row showing rank, name, tier label, `x.xx×` multiplier and `n=<sample>`. **Those boards ranked by the boost multiplier, which the product has since removed** (`f0ada5c`, "Performance is what the videos did, not a multiplier"). The old ranking metric no longer exists to rebuild against.
- `personStats` (`src/lib/reports.ts:62-112`) is pure and already role-aware in one direction only: it derives its video set from the assignments handed to it (`70-76`), but **pools a person's metrics across all their in-view credits regardless of role**. `roleCounts` (`92-96,106-108`) is a video count per role — there are no per-role metrics in the shape.
- `PersonStats.roles` and `roleCounts[].role` carry the role **display name** (`reports.ts:92-96` keys on `a.roleName`); `AssignmentLite` (`50-54`) has no `roleSlug`.
- The `scoredByContent` parameter of `personStats` (`reports.ts:66`) is accepted and **never read** — dead leftover from `avgBoost`. Callers still pass it (`content/page.tsx:425`, `reports/page.tsx:428`).
- `PeopleInView` (`src/components/PeopleInView.tsx`) is a Server Component card grid, rendered at `content/page.tsx:468`, and only populated when `f.personIds.length > 0` (`419-431`).
- **There is no collapsible component.** `grep '<details' src/` finds exactly two raw uses: `clients/page.tsx:95` and `training/page.tsx:147`.
- **Selecting one client returns early** at `content/page.tsx:364-405` and renders `ClientDetail`, which has no people tables at all.

### The design

**A. Role filter — parse.** Add `roleSlugs: string[]` to `ContentFilterState` and `roleSlugs: parseIdList(sp.role)` to the returned literal in `parseFilters`. Reusing `parseIdList` (`contentFilters.ts:40-43`) buys dedupe + sort, which is what preserves the order-independence guarantee for free. Add `role?: string` to the searchParams type at `content/page.tsx:43-51`.

**B. Role filter — semantics. This is a display filter over the tables, not a population filter over the videos.** When `role` is set, only those roles' tables render; the video list, the KPI stats and the client rollup are unchanged. Consequently `role` is **not** passed into `loadContentOverview`'s `ContentFilters` and is **not** added to the `narrowed` gate (`content/page.tsx:87-94`).

> **The two area reports disagree here.** The filter-architecture report specifies `roleSlugs` as a *population* filter applied in `dashboards.ts:466-474` (and therefore added to `narrowed`); the performance-tables report specifies `role` as a *display* filter never passed to the loader. We take the display-filter reading because it matches the user's own words ("when a role is selected, only that role's table shows") and because narrowing the video population by role would silently change the Videos/Posts/Time stat tiles when someone was only trying to look at editors. **If this is ever changed to a population filter, `role` MUST be added to `narrowed`** — omitting a dimension there has already shipped a real bug (`content/page.tsx:76-86`).

**C. Role filter — UI.** A fifth `FilterDef` in `content/page.tsx:189-247`:
```ts
{ key:"role", label:"Filter by role", allLabel:"All roles", multi:true,
  values:f.roleSlugs,
  options: workspaceRoles.map(r => ({ value:r.slug, label:r.name })) }
```
Value is the **slug**, not the id, so a shared link survives across workspaces. No `clears:["video"]` — role does not narrow the population. **Raise `primaryCount` from 3 to 4** (`content/page.tsx:198`), otherwise role lands behind "More filters", which auto-opens only when a hidden filter already has a value (`FilterBar.tsx:108`) — on a fresh load the new filter would be invisible and read as missing.

**D. Per-role metrics — no new query.** Call the existing pure `personStats` **once per role** with the assignment list pre-filtered:
```ts
personStats(members, overview.videos,
            rankings.assignments.filter(a => a.roleSlug === slug),
            rankings.scoredByContent, seconds)
```
Because `personStats` derives its video set from the assignments it is handed, pre-filtering by role makes every returned platform figure role-scoped.

**E. New pure builder** in `src/lib/reports.ts`, after `buildEmployeeReport` (line 247):
```ts
export function buildRoleTables(
  rolesInOrder: {slug:string; name:string}[],
  members: {userId:string; name:string}[],
  videos: VideoSummary[],
  assignments: AssignmentLite[],
  seconds: Map<string, number>,
): { roleSlug:string; roleName:string; rows: PersonStats[] }[]
```
Data only — no JSX, no functions. **Widen `AssignmentLite` (`reports.ts:50-54`) to carry `roleSlug`.** `rankings.assignments` already has both fields, so this is free; without it, filtering the URL's `qc` against `roleName` `"Quality Control"` silently matches nothing.

**F. New client component `src/components/RoleTables.tsx`.** One card per role; heading always visible; **body mounted only when expanded**; `useState` for open state; `aria-expanded` on the heading button (the pattern at `FilterBar.tsx:254-275`). Props are plain data: `tables`, `highlightUserIds: string[]`, a metric label. **Never a function prop.**

**G. The metric — this is where numbers can go wrong.** A single scalar "Views" column requires pooling across platforms, which is forbidden. `buildPlatformReport` is the only builder with a scalar views column and it is legitimate precisely because the row *is* a platform (`reports.ts:377-378, 398`). `Report`/`ReportCell.sort` (`reports.ts:127`) and `ReportTable`'s comparator (`ReportTable.tsx:24-32`) each want one scalar per column, so reusing that machinery structurally pushes toward the forbidden number. **Therefore: rank by videos, likes or comments (all summable), and render views as per-platform chips** the way `PeopleInView.tsx:77-98` already does. A views ranking is offered **only when `f.platform` is set** — the platform filter already reduces every metric to one platform at `dashboards.ts:338`.

**H. Hours.** **Per-role tracked time does not exist and cannot be derived.** `time_entries` has no `role_id` (`20260727120000_phase0_foundation.sql:181-205` + `20260727140000:166-167`). If an Hours column appears in a role table it is the person's total tracked seconds on the in-view videos and will repeat identically across every role table they appear in. **Either omit it or label it "not role-scoped."** If kept, `secondsByUserOnVideos` must be called with `userIds = null` (`reportData.ts:37-47`) instead of the current selected-people-only call at `content/page.tsx:429` — one extra paged read.

**I. Where they render.** In the overview branch after `content/page.tsx:468`, **and** in the solo-client branch (`364-405`) — otherwise "when a client is selected, tables show only that client's statistics" fails in exactly the case it describes. If change **6** takes the structural option and deletes that branch, this is automatic.

**J. Highlighting.** `personIds` is currently a **population** filter (`dashboards.ts:466-474`): selecting a person narrows the videos, so the tables would describe only their videos. v1 keeps that behaviour, highlights the selected people's rows, and states on screen that the tables describe the filtered set. See "Decisions the user must make."

**K. Cleanup.** Drop the dead `scoredByContent` parameter from `personStats` and its two call sites, or leave a one-line comment saying it is unused. Do not add a third caller that passes it.

### Schema / migration
**None.** `content_assignments` and `roles` already carry everything.

### Edge cases and deliberate refusals
- **We refuse to resurrect the multiplier boards.** The metric they ranked by was deliberately removed (`f0ada5c`); `/performance` is now two pure redirect shims (`performance/page.tsx:7-17`, `performance/[userId]/page.tsx:4-11`) and stays that way. No new `/performance` page.
- **We refuse a pooled cross-platform Views column** in a role table.
- Unknown role slugs in the URL are ignored (matching how `platform` is handled at `contentFilters.ts:74`) — `contentFilters.ts` is dependency-free so it cannot validate against the workspace's roles.
- `/reports` uses the same `parseFilters` + `loadContentOverview` (`reports/page.tsx:108-118`) and its own `FilterBar` (`172-202`). Since role is display-only, `/reports` is unaffected; if that ever changes, it must be threaded there too.

### Acceptance criteria
- [ ] `?role=editor` renders exactly one role card; `?role=editor,qc` renders two, in `sort_order`.
- [ ] Role options come from the `roles` table, not a hardcoded five (verified by renaming a role in the DB and reloading).
- [ ] `?role=qc` matches the QC role (slug-vs-display-name regression check).
- [ ] Setting a client, a date range, or a platform changes the numbers inside the role tables accordingly.
- [ ] Selecting a person highlights their row in every table they appear in.
- [ ] Cards are collapsed on load; the body is not in the DOM until expanded.
- [ ] No role table renders a single "Views" column unless `?platform=` is set; otherwise views appear as per-platform chips.
- [ ] Selecting exactly one client still shows the role tables (currently the branch that renders no people UI at all).
- [ ] `scripts/content-filters-test.mjs` extended: `role=` added to **all five** permutation URLs including the duplicates/empty-segments variant, plus an assertion that `roleSlugs` comes out sorted and deduped. The suite fails if `roleSlugs` is parsed with insertion order preserved.
- [ ] `scripts/reports-test.mjs` extended with a `buildRoleTables` fixture where one person holds two roles on one video, asserting they appear once in each table and the video is counted once per table.
- [ ] `grep '<select' <diff>` returns nothing.

---

## 3. Client Guidelines: add / remove client

### What the user asked for
> "Client Guidelines: add/remove client option."

### Current behaviour
- `/guidelines` (`src/app/(app)/guidelines/page.tsx`) renders a read-only grid: `loadGuidelineClients` (`src/lib/guidelines.ts:42-…`) reads `clients` (`id, name, image_url, guideline_doc_url, is_archived`), splits into `active` / `past` (`guidelines/page.tsx:22-23`) and renders `Grid` → `Card`, each card a `<Link href={/guidelines/${c.id}}>`. **There is no create control and no archive control on this page.**
- Both actions already exist: `createClientRecord(workspaceId, name)` (`actions.ts:208-219`) and `setArchived("clients", id, archived)` (`actions.ts:2116-2130`). `ClientActiveToggle` (`src/components/ClientActiveToggle.tsx`) already wraps `setArchived` as a one-click Active/Inactive pill and already handles `e.preventDefault()` because it renders inside a card that is itself a Link.

### The design
- Add an **"Add client"** control in the `PageHeader` children slot of `guidelines/page.tsx`. New client component `src/components/NewGuidelineClient.tsx`: a name input + button calling `createClientRecord`, then `router.refresh()`. Manager-gated via a `canManage` prop computed on the server (`canManage(session.active.role)` from `src/lib/types.ts:232-236`).
- Add `<ClientActiveToggle clientId={c.id} isActive={!c.isArchived} />` to each `Card` in `guidelines/page.tsx` — reuse, not a new component. `loadGuidelineClients` already returns `isArchived`.
- **"Remove" means archive, not delete.** `createClientRecord` currently only calls `revalidatePath("/clients")`; add `revalidatePath("/guidelines")` to it, and confirm `setArchived`'s `revalidatePath("/", "layout")` covers the grid (it does).

### Schema / migration
**None.**

### Edge cases and deliberate refusals
- **We refuse a hard delete of clients.** `content_items.client_id` is `on delete set null` (`20260727140000:75-91`) — deleting a client silently orphans every video it owned, and `accounts.client_id`, `projects`, `invoices` and `expenses` all reference it. Archive is the existing, reversible mechanism used everywhere else.
- Archiving here is the **same** flag that change **7** acts on: marking a client inactive from the Guidelines grid removes their videos from `/content` and from every filtered read. The toggle's tooltip must say so, or someone will tidy up the guidelines wall and wonder why the numbers dropped.
- A duplicate client name is allowed (no unique constraint exists); do not add one — the roster genuinely contains near-duplicates like "Frankie Mardell - Trilogy Jewellers".

### Acceptance criteria
- [ ] A manager can create a client from `/guidelines` and it appears in the active grid without a manual reload.
- [ ] A non-manager sees neither control; the RLS refusal path is never reached from the UI.
- [ ] Toggling a client to Inactive moves its card to "Past clients" and its videos disappear from `/content` on the next load.
- [ ] Toggling back to Active restores both, with no data loss.
- [ ] The toggle button click does not navigate into the guideline detail page.

---

## 4. Icons in "Total reach by platform"

### What the user asked for
> "Icons in the 'Total reach by platform' table (currently coloured dots)."

### Current behaviour
- `src/components/PlatformReach.tsx` renders `<span className="size-2.5 shrink-0 rounded-full" style={{background: PLATFORM_COLORS[t.platform] ?? "var(--muted)"}} />` per row. `PlatformChips` (same file) does the same at `size-1.5`.
- `PLATFORM_COLORS` (`src/lib/types.ts:183-188`) covers instagram / tiktok / youtube / facebook; `PLATFORM_LABEL` (`191-196`) the same four.
- **There is no brand-icon library.** `lucide-react` is the only icon dependency; it has `Youtube`, `Instagram` and `Facebook` glyphs but **no TikTok glyph**. No `react-icons`, no `simple-icons`.
- The section heading is set at `content/page.tsx:470-473`, note: "Each platform counts a view differently — never summed."

### The design
- New `src/components/PlatformIcon.tsx`: a data-driven registry `Record<slug, {node: ReactNode; color: string}>` keyed by platform slug, exporting `<PlatformIcon slug={} size={} />`. TikTok, YouTube, Instagram and the new `youtube_shorts` (change 8) are **inline SVG paths in this one file** — no new dependency, no external fetch. Facebook uses `lucide-react`'s glyph.
- **Fallback is the current coloured dot.** An unknown slug (a platform added to the registry table later) must render the dot, not a broken box. This is what makes the change safe: `platforms` is an insert-not-a-migration registry (`20260727140000:9-12`).
- Swap the dot for `<PlatformIcon>` in `PlatformReach` (both the row and `PlatformChips`). Icons are tinted with `PLATFORM_COLORS`, so the existing colour coding is preserved, not replaced.

### Schema / migration
**None.**

### Edge cases and deliberate refusals
- **The bars stay non-comparable.** `PlatformReach`'s header comment is explicit: bars are scaled within each row, never against a shared axis. Adding recognisable brand icons makes the rows *look* more like a comparable league table, so the "never summed" note must stay on the heading and the per-row bar scaling must not be touched.
- **We refuse a totals row.** There is no legitimate total of the views column.
- Brand marks are used as identification, at small size, in their own colours — the ordinary permitted use. If legal review objects, the fallback dot is one prop away.

### Acceptance criteria
- [ ] Each row in "Total reach by platform" shows the platform's mark, tinted with its existing colour.
- [ ] A platform slug with no registry entry renders the old coloured dot and no console error.
- [ ] Dark and light themes both legible (icons inherit `currentColor` where the mark is monochrome).
- [ ] `PlatformChips` in report tables uses the same component; no second icon implementation exists.
- [ ] The "never summed" note is still present and no totals row was added.

---

## 5. Small thumbnail per video in Content

### What the user asked for
> "Small thumbnail per video in the Content section, for visual comparison."

### Current behaviour
- `VideoTile` (`VideoTile.tsx:382-410`) is a single flex row: title block left, metrics and credits right. There is no image.
- **No thumbnail is stored anywhere.** `platform_posts` (`20260727140000:93-112`) has no thumbnail column; neither does `content_items` (`75-91`, plus `description` / `topic_labels` from `20260808140000:29-37`). `grep thumbnail supabase/migrations/` returns nothing.
- **`DiscoveredPost` (`src/lib/providers/types.ts:56-88`) has no thumbnail field.** The `thumbnailUrl` that does exist (`types.ts:109`) belongs to `AccountCandidate` — a *channel* avatar shown while searching for an account.
- Only `providers/tiktok.ts:249` currently reads a `thumbnail_url` from a response, and that is the oEmbed **account** path.
- `next.config.ts` sets no `images.remotePatterns`, so `next/image` would refuse every remote host. `ClientImage.tsx:40-44` already documents this and uses a plain `<img>` deliberately.

### The design

**A. Store the URL, do not proxy or cache the image.**
```sql
alter table platform_posts add column if not exists thumbnail_url text;
comment on column platform_posts.thumbnail_url is
  'Poster frame URL as reported by the platform at discovery. Nullable and
   allowed to rot: these are CDN URLs, some signed and short-lived. The tile
   falls back to a placeholder, so a dead URL is a cosmetic loss only.';
```
On `platform_posts`, not `content_items`, because after change **1** one content_item legitimately holds several posts and each platform has its own poster frame.

**B. Provider plumbing.** Add `thumbnailUrl?: string | null` to `DiscoveredPost` (`providers/types.ts:56-88`) — optional, so a provider that cannot see it leaves it undefined rather than guessing. Populate it in `providers/youtube.ts` (`snippet.thumbnails.medium.url` is already in the shape the discover call parses, `youtube.ts:167-172`) and in `providers/instagram.ts` (`toDiscovered`, `174-200`). TikTok's discovery path is optional and self-hosted — leave it null there.

**C. Persist it** at both insert sites: `syncRunner.ts:205-221` (free) and `syncRunner.ts:560-581` (metered).

**D. Read it.** Add `thumbnailUrl: string | null` to `VideoSummary` (`dashboards.ts:33-99`), populated in the per-content_item bucketing at `dashboards.ts:340-370` — pick the first non-null across the item's posts, in platform `sort_order`.

**E. Render it.** A 44×26 (16:9) `<img loading="lazy" decoding="async">` in a new left gutter of `VideoTile`, before the title block. Plain `<img>`, matching `ClientImage`'s reasoning, with a neutral `bg-[var(--bg-subtle)]` box as the placeholder so a missing or dead URL is a normal state rather than a broken image. `referrerPolicy="no-referrer"` (some CDNs 403 on a referring origin).

**F. Backfill is optional and explicitly not free.** Existing rows have no thumbnail. YouTube thumbnails can be reconstructed from the external id (`https://i.ytimg.com/vi/{id}/mqdefault.jpg`) with **no API call at all** — do that in a one-off script. **Instagram cannot be backfilled without spending Apify credit**, so it is not backfilled; those rows show the placeholder until their next discovery run.

### Edge cases and deliberate refusals
- **We refuse `next/image`.** It requires every host allow-listed in `next.config.ts` before anything renders; new CDN hosts appear without warning.
- **We refuse to download or re-host thumbnails.** There is no storage bucket wired up (`20260731120000` header, on `clients.image_url`), and hosting other platforms' media is a different decision.
- Instagram CDN URLs are signed and expire. That is why the column comment says the value is allowed to rot and why the placeholder must look deliberate.
- Adding an image to a 229-row list is a layout-density change: the tile row is deliberately one line (`VideoTile.tsx:379-382`). Keep the thumbnail height ≤ the existing two-line block so no row gets taller.

### Acceptance criteria
- [ ] A YouTube video synced after the change shows its poster frame in `/content`.
- [ ] A video with no thumbnail shows a neutral box, not a broken-image glyph, and logs no console error.
- [ ] Row height in `/content` is unchanged (measure before/after on a 20-row list).
- [ ] `scripts/select-audit.mjs` passes with `thumbnail_url` added to the platform_posts select strings.
- [ ] No Apify call was added: `providers/instagram.ts` reads the thumbnail out of the response it **already** makes, and the diff adds no new `fetch`.
- [ ] The YouTube backfill script makes zero API calls (verify by running with the API key unset).

---

## 6. BUG — sort controls vanish when a client is selected

### What the user asked for
> "Selecting a client makes the video sort controls (newest / reach / growing) disappear; they must persist and sort the filtered set."

### Current behaviour — root cause confirmed
- `content/page.tsx:61-62`:
  ```ts
  const soloClientId =
    f.clientIds.length === 1 && f.personIds.length === 0 ? f.clientIds[0] : null;
  ```
- `content/page.tsx:364` branches on it and **returns** `<ClientDetail>` (`388-404`), so `<ContentOverview>` — the only component that owns the sort controls — is never reached. `ContentOverview` is rendered in exactly one place: `content/page.tsx:480-487`.
- The sorts live only in `ContentOverview.tsx`: `SORTS` at `14-21` (`recent/views/boost/growth/time` → Newest/Reach/Boost/Growing/Time spent), buttons at `225-248`, state at `94-95`.
- `ClientDetail.tsx` has no sort UI and no sort state. Ordering is hardcoded: split into `published`/`inProgress` at `31-32`, each rendered by `LoadMoreList` (`117-130`, `139-151`) in whatever order the array arrived — `produced_at DESC` from `dashboards.ts:196-199`.
- The asymmetry the user noticed is exactly this conditional: **two** clients selected → `soloClientId` is null → sorts come back. One client **and** one person → sorts come back.
- Sort is **client state, not URL state** (`ContentOverview.tsx:94-95`). No `?sort=` param exists anywhere. This contradicts the page's own stated contract at `content/page.tsx:38` ("Filters are query params, so any view of this page is a shareable URL") and means sort resets on refresh and on any shared link.

### The design

**Structural fix — delete the branch.** Remove `content/page.tsx:364-405` and always render `<ContentOverview>`. Move `ClientDetail`'s two distinctive pieces into the overview, shown only when exactly one client is selected: the per-platform hours-per-1k-views strip (`ClientDetail.tsx:94-108`) and the "Most viewed" stat. One sort implementation, one component, and the bug becomes unrepeatable. This also automatically satisfies change **2**'s requirement that role tables appear when one client is selected.

**Promote sort to the URL** as `?sort=`, with a whitelist parse mirroring the status whitelist at `contentFilters.ts:71-73` (unknown value degrades to `recent`, never throws). Pass it down as a plain string. This makes a sorted view shareable and survives refresh, which is what "they should stay on the videos all time" asks for. **Add `sort` to `preserveOnClear` on `/content`** (`FilterBar.tsx:279-294`) — sort is not a filter, and "Clear all" must not silently reorder the list.

**If the local option is taken instead** (extract `SORTS` + `peakViews` + the `rows` memo into `src/lib/videoSort.ts` and a `<VideoSortBar>` mounted in `ClientDetail`), then: sort within **each** of the published / in-progress sections, and pass `resetKey={sort}` to **both** `LoadMoreList` call sites (`ClientDetail.tsx:117, 139`), which currently pass none.

### Schema / migration
**None.**

### Edge cases and deliberate refusals
- **We refuse to duplicate the sort implementation.** The "Reach" sort uses `peakViews` — max across platforms, deliberately not a sum (`ContentOverview.tsx:32-35`). A second implementation that summed views would violate the hardest data rule in the product while looking correct.
- **We refuse a callback prop from the server page.** Both components are already `"use client"`; sort state stays inside them or travels as a plain string via the URL. A function prop crashes at runtime here and the build stays green.
- Deleting the solo-client branch removes `ClientDetail`'s client-facing framing ("Videos delivered", "Time invested", hours-per-1k). If that view has an external audience, the overview's stat strip is not a drop-in substitute — see "Decisions the user must make."
- If sort is promoted to the URL, decide whether the **client-table** sort (`CLIENT_SORTS`, `ContentOverview.tsx:23-30`) gets the same treatment. Recommendation: no, v1 covers the video sort only, which is what was reported.

### Acceptance criteria
- [ ] Select exactly one client → the Newest / Reach / Boost / Growing / Time spent buttons are present.
- [ ] Pressing Reach reorders **only the filtered set** (that client's videos), and the Videos (n) count is unchanged.
- [ ] Select two clients, one client + one person, one person alone, no filters — sorts present in all four.
- [ ] `?sort=views` in a pasted URL loads with Reach active; `?sort=bogus` loads with Newest active and throws nothing.
- [ ] Refreshing the page keeps the chosen sort.
- [ ] "Clear all" clears client/person/platform/dates/search but leaves `sort` intact.
- [ ] Sort, expand the list past 10 rows, re-sort → the list collapses back to the first page rather than showing a stale count against a new order.
- [ ] The client-facing figures previously only in `ClientDetail` are still reachable when one client is selected.

---

## 7. Content videos for ACTIVE clients only

### What the user asked for
> "All Content videos only for ACTIVE clients; archived out of the system when client goes inactive."

### Current behaviour — partly done already
- **`/content` already does this.** `dashboards.ts:503-524` builds `archivedClientIds` from the client rows and filters `videos` to `!v.clientId || !archivedClientIds.has(v.clientId)`, with a comment recording that only the client *table* excluded them before. Content with **no** client is deliberately kept.
- **The sync already skips them.** `syncRunner.ts:376-404` filters accounts whose client is archived, in code rather than by an inner join so that client-less accounts keep syncing.
- **Everything else does not filter.** Specifically:
  - `src/lib/performanceData.ts:56-265` `computeRankings` reads **every** `platform_post` (`61-69`) and **every** `content_assignment` (`80-88`) workspace-wide. Archived clients' work is in the role means and in every person's score. This is a pre-existing bug.
  - `src/lib/cachedRankings.ts:69-74` caches that result under key `rankings-v1`, tag `rankings`, computed with the **service client** — RLS does not help.
  - `src/app/(app)/home/page.tsx:125,159` counts content_items and already subtracts an `archivedItemIds` set; `home/page.tsx:212-224,583-595` read `rankings.people`, which is unfiltered.
  - `src/lib/homeData.ts:45-63` `loadArchivedClientItemIds` exists and feeds `excludeItemIds` into `loadPlatformMomentum` (`80-148`) and `loadWeekMovers` (`164-247`).
  - `src/app/api/v1/content/route.ts:21-27` filters neither rule and runs with `createAdminClient()`.
  - `worker/jobs/weeklyRead.mjs:40-44` selects every content_item for a client.
  - `src/lib/channelDashboard.ts:65-71,95-119`.
- `ClientActiveToggle` writes `clients.is_archived` via `setArchived` (`actions.ts:2116-2130`) and revalidates `/` layout.

### The design
**One exclusion set, computed once, threaded everywhere.** Generalise `loadArchivedClientItemIds` (`homeData.ts:45-63`) into `loadExcludedItemIds(supabase, ws)` returning a `Set<string>` of content_item ids excluded by *any* rule — archived client today, non-approved after change **9**. Both rules travel together through the existing `excludeItemIds` parameter, so no loader can pick up one rule without the other.

Then:
1. **`computeRankings` must filter both `scoredByContent` and the returned `assignments` array.** Filtering only the former silently leaves `personStats` counting archived clients' videos. This is the highest-value fix in this change.
2. **Bump the cache key `rankings-v1` → `rankings-v2`** in `cachedRankings.ts:69-74`, or the first request after deploy serves a pre-filter entry. Maps/Sets need the existing freeze/thaw treatment (`cachedRankings.ts:42-67`).
3. `api/v1/content/route.ts` — filter. This is where a wrong number becomes someone else's spreadsheet.
4. `worker/jobs/weeklyRead.mjs` — filter, or the LLM writes prose describing archived clients' work as current.
5. `channelDashboard.ts` — report **both** "on this channel" and "our current work", never one unlabelled number.
6. **Do not filter:** `content/page.tsx:110-115` (the video dropdown — you must be able to navigate to a video to act on it), `content/page.tsx:510-593` (`loadVideoView` — a deep link must still render), `track/page.tsx:48-53` and `import/page.tsx:41-45` (time is booked before status changes; hiding videos strands hours), `pipelineStatus.ts:21-23,84-95` (operational — the operator needs the true denominator), `/accounts` and `/clients` (inventory).

**"Archived out of the system" means excluded from every performance read, not deleted.** Nothing is removed. Reactivating a client restores everything derived, because every loader recomputes the set per call.

### Schema / migration
**None** for this change. It is entirely a read-path change.

### Edge cases and deliberate refusals
- **Reactivation does not restore snapshots that were never taken**, because `runSync` skipped the account. Three silent consequences, all of which must be visible in the UI rather than fixed:
  - `gainForPost` unwindowed (`dashboards.ts:304-311`) takes the delta between the last two readings, so six months of accumulation reports as one gain. Survivable only because the accompanying `days` field is displayed — keep it displayed.
  - `loadPlatformMomentum` (`homeData.ts:127-140`) buckets each delta into the single Dubai day the later reading landed on. **Six months of views will appear as one enormous bar, indistinguishable from a viral day.** This is a real misleading number. Mitigation: when a delta spans more than N days, mark the bar as a resumption rather than plotting it as a day's gain.
  - `readLifecycle` uses `observedUntil = accounts.last_synced_at` (`dashboards.ts:376`) to separate "known flat" from "not observed"; on reactivation this jumps forward and retroactively reclassifies the gap as observed flatness.
- Content with a **null** `client_id` is never excluded. It belongs to no archived client.
- **`content/page.tsx:110-115` is an unbounded select with no `selectAll`** — silently capped at 1000 rows, latent at today's volume. Fix it while in the file.
- A client-portal user's visibility is governed by `can_read_client` (`20260728140000:101-104`), not by these filters. Archiving does not revoke portal access; that is a separate decision.

### Acceptance criteria
- [ ] Archive a client → their videos leave `/content`, the client rollup, `platformTotals`, and the Videos/Posts/Time stat tiles.
- [ ] Archive a client → **every employee's score changes** (rankings recomputed without their work). Verify `roleMeans` shifted.
- [ ] `GET /api/v1/content` no longer returns archived clients' items.
- [ ] The Home headline content count equals the count of videos actually listed on `/content`.
- [ ] A deep link `/content?video=<id>` for an archived client's video still renders its full history.
- [ ] `/track` and `/import` still offer that video in their pickers.
- [ ] `/data` pipeline coverage still counts it (operational denominator unchanged).
- [ ] Un-archive → everything above returns with no data loss.
- [ ] After reactivation, a six-month gap does not render as a single normal-looking daily momentum bar.
- [ ] `cachedRankings` key is `rankings-v2`; the first request after deploy serves filtered data.

---

## 8. YouTube Shorts as a separate platform

### What the user asked for
> "YouTube Shorts as a separate platform, fetched only when added to a client."

### Current behaviour
- **Shorts are currently discarded at discovery.** `src/lib/providers/youtube.ts:423`: `if (await isYoutubeShort(p.externalId, p.lengthSeconds)) continue;`. `isYoutubeShort` (`youtube.ts:84-100`) returns false immediately when `lengthSeconds > 180` (YouTube's own ceiling) and otherwise probes `https://www.youtube.com/shorts/{id}` — a redirect means not a Short. It "fails open" so long-form work is never silently dropped. `DataPanel.tsx:85` states this to the user: *"Long-form only: Shorts are filtered out at discovery."*
- **So there are no Shorts in the database today.** That makes this a clean introduction rather than a reclassification.
- `platforms` is a registry table, not an enum (`20260727140000:9-32`): `slug` PK, `display_name`, `auth_model`, `supports_public_read`, `view_semantics`, `available_metrics`, `scoring_config`, `maturity_window_days`, `sort_order`, `is_enabled`. Four rows seeded at `34-53`. `accounts.platform_slug references platforms(slug)` (`:63`).
- YouTube's row: `supports_public_read = true`, `view_semantics = '30s'`, `maturity_window_days = 28`, `sort_order = 30`.
- `PROVIDERS` is keyed by slug (`src/lib/providers/index.ts`); `DataPanel` and `runSync` both dispatch on `account.platform_slug`.

### The design

**A. A new platform row, not a flag on the post.**
```sql
insert into platforms
  (slug, display_name, auth_model, supports_public_read, view_semantics,
   available_metrics, scoring_config, maturity_window_days, sort_order)
values
  ('youtube_shorts', 'YouTube Shorts', 'oauth', true, 'immediate',
   '["views","likes","comments"]'::jsonb,
   '{"idea":"views","script":"views","editor":"views","qc":"comment_sentiment"}'::jsonb,
   7, 35)
on conflict (slug) do nothing;
```
`view_semantics` is `'immediate'`, **not** YouTube's `'30s'` — a Shorts view is counted on impression, not after 30 seconds. This is precisely why it must be a separate row: pooling Shorts views with long-form YouTube views would be the exact category error the whole per-platform model exists to prevent. `maturity_window_days` is 7, not 28, because Shorts peak fast.

**B. "Fetched only when added to a client" = a separate `accounts` row.** A Shorts feed is not a separate channel — it is the same channel's uploads. So the mechanism is: a client gets a `accounts` row with `platform_slug = 'youtube_shorts'` and the **same handle** as their YouTube account. `runSync` then dispatches that account to the YouTube provider in *shorts mode*.

**C. Provider change.** Add a mode to the YouTube provider's `discover` rather than a second provider file: `PROVIDERS['youtube_shorts']` reuses `providers/youtube.ts` with `shortsOnly: true`, which **inverts** the filter at `youtube.ts:423` (`if (!(await isYoutubeShort(...))) continue;`). Everything else — `uploadsPlaylist`, `fetchVideoDetails`, `fetchMetrics` — is unchanged and already keyed on the video id, not on the account.

**D. If no `youtube_shorts` account exists for a client, nothing changes.** The YouTube account keeps filtering Shorts out exactly as today. That is the literal reading of "fetched only when added to a client."

**E. UI.** `DataPanel.tsx:85`'s note must be updated per platform: YouTube keeps "Long-form only", `youtube_shorts` gets "Shorts only". `PLATFORM_COLORS` / `PLATFORM_LABEL` (`types.ts:183-196`) gain `youtube_shorts`; `PlatformIcon` (change 4) gains the mark.

### Edge cases and deliberate refusals
- **Quota is doubled for any client with both accounts.** `uploadsPlaylist` + `playlistItems` + `videos.list` run twice over the same channel, and the `/shorts/{id}` probe runs once per candidate on both. YouTube's quota is free but finite and resets daily. Mitigation: cache the uploads listing per channel per run so the second account reuses it. **This is a real cost increase and must be measured before rollout.**
- **A video must never appear on both.** `isYoutubeShort` is authoritative and the two modes are exact complements, so a given external id lands on exactly one account — enforced in practice by `platform_posts unique (content_item_id, account_id)` only *after* change **1**'s merge. Add an assertion in the sync test.
- **Scoring baselines start empty.** A brand-new platform has no history, so `computeRankings`' per-role-per-platform means for `youtube_shorts` are computed over a tiny sample until enough posts accumulate. Scores on this platform will be noisy for the first weeks. Say so in the UI rather than hiding it.
- **We refuse to reclassify existing YouTube posts as Shorts.** There are none — they were filtered at discovery — so there is nothing to reclassify, and inventing a backfill would move numbers people have been reading for no gain.
- **We refuse a `is_short` boolean on `platform_posts`.** It would put two different view semantics in one platform bucket, and every rollup would then have to special-case it.

### Acceptance criteria
- [ ] `select * from platforms where slug='youtube_shorts'` returns one row with `view_semantics='immediate'` and `maturity_window_days=7`.
- [ ] With no `youtube_shorts` account, a YouTube sync still imports zero Shorts (behaviour identical to today).
- [ ] Adding a `youtube_shorts` account with the same handle imports **only** Shorts; a long-form video from the same channel does not appear under it.
- [ ] No external id appears under both accounts (assert in `scripts/sync-idempotency-test.mjs`).
- [ ] "Total reach by platform" lists YouTube and YouTube Shorts as **separate rows**, never a combined YouTube figure.
- [ ] `exportVideos` emits separate rows per platform for a video cross-posted to both.
- [ ] Quota consumed by a sync of one channel with both accounts is measured and recorded in the PR description.
- [ ] `/data` shows the correct per-account note ("Long-form only" vs "Shorts only").

---

## 9. Manual approval queue

### What the user asked for
> "Manual approval queue: every video approved or rejected; a section above the videos showing approved/unapproved counts and the new post-sync arrivals; rejected go to an archive. Distinguishes agency-made from client-self-posted."

### Current behaviour
- **No approval concept exists on content.** `content_items` (`20260727140000:75-91` + `20260808140000:29-37`) has no review column. `/approvals` already exists and is **timesheet** approvals (`src/app/(app)/approvals/page.tsx`, `timesheet_submissions`) — the name is taken; do not reuse it.
- Every content_item on the live workspace was created by the sync: a service-role read reports **255 content_items** (not 207), of which 29 belong to the 5 archived clients, 0 have a null `client_id`, and **255 of 255** carry notes beginning `Discovered automatically`. Also live: 255 platform_posts, 1066 post_snapshots, **47 content_assignments**, 0 time_entries linked to content.
- Manual creation paths: `createContentItem` (`actions.ts:339-362`), `createContentFromUrl` (`actions.ts:500-568`).
- The sync re-discovers by `external_id` (`syncRunner.ts:154-174`), not by approval.

### The design

**A. Two orthogonal columns, never one.** Provenance ("is this agency work?") is a column on the row. Commercial status ("do we still work with them?") stays **derived** from `clients.is_archived` (change 7). Collapsing them into one status column is the stranding bug: an archived-and-unapproved video would have no state to restore on reactivation.

**B. Three states, not a boolean.**
```sql
alter table content_items
  add column review_state text not null default 'approved'
    check (review_state in ('pending','approved','rejected')),
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references profiles on delete set null;

alter table content_items alter column review_state set default 'pending';
```
The two-step default is deliberate: **step 1 stamps all 255 existing rows atomically inside the same DDL transaction** — no 255-row UPDATE to get wrong, no window where a row is missed. **Step 2 makes every future insert pending.**

A boolean cannot distinguish "nobody has looked yet" from "a human looked and said no", and without a terminal `rejected` the sync returns the same client-self-posted video to the queue forever. `worker/enqueue.mjs:66-71` already records this lesson: *"A permanent no is a no."*

**C. Existing rows become `approved`, with `reviewed_at` and `reviewed_by` left NULL.** That NULL is the only marker separating "grandfathered by migration" from "a person approved this"; `where review_state='approved' and reviewed_at is null` is the audit query that later finds every row nobody actually looked at.

> **Backfilling to `pending` instead would be an outage, not a conservative choice.** At the instant it lands, every filtered read drops 255 of 255 videos. Worse, `computeRankings` (`performanceData.ts:197-211`) computes `roleMeans` over an empty set, so **every employee's `overall` becomes null**, and `cachedRankings` freezes that into a service-client `unstable_cache` entry shared across all users. The 47 existing `content_assignments` settle it independently: a credit is a human assertion that "we made this", and defaulting to pending suspends 47 judgments already recorded. Over-approving is recoverable through the same queue; under-approving is not, because nothing in the database records which of the 255 were genuinely agency work.

**D. Insert paths.** Both sync sites (`syncRunner.ts:189-202`, `545-559`) pass **no** `review_state` at all and let the column default apply, so a future third insert path inherits the conservative default. `createContentItem` and `createContentFromUrl` insert `review_state:'approved'` with `reviewed_by` = the actor: a person hand-typing a video *is* the approval act.

**E. The queue UI — a section above the videos on `/content`, not a page.** A new `src/components/ReviewStrip.tsx` (client component, plain data props) rendered above `ContentOverview`:
- counts: `N approved · M awaiting review · K rejected`
- **new since last sync**: `count(*) where review_state='pending' and created_at > accounts.last_synced_at - interval` — the "new post-sync arrivals" the user asked for
- expanding it lists pending items with Approve / Reject per row, plus multi-select Approve-all (reusing change **1**'s selection machinery when that lands)
- **rejected go to an archive**: a collapsed "Rejected (K)" list in the same strip, from which a row can be restored to `approved`. Nothing is deleted.

**F. Actions**: `setContentReviewState(ids: string[], state: 'approved'|'rejected')` in `actions.ts` — one multi-row update with an explicit `.eq("workspace_id", ws)`, stamping `reviewed_at = now()` and `reviewed_by`, writing `logAudit` with `content.review`, ending with `revalidatePath("/content")` + `revalidateTeam()`.

**G. Read paths.** Fold the approval rule into the **same** `loadExcludedItemIds` set built for change **7**, so the two rules can never diverge. Same must-filter / must-not-filter split as change 7, with one addition: `content/page.tsx:110-115` (the video dropdown) **must offer pending videos**, or a manager cannot navigate to one to approve it.

**H. Does an unapproved video still get metrics synced? Split by cost and by recoverability.**
- **`post_snapshots`: keep syncing.** Cheap on YouTube, and it is **the only non-reconstructable data in the system** — no provider returns historical view counts, and a post whose first snapshot lands after the maturity window is unscoreable forever. `gainForPost` (`dashboards.ts:300-326`) reports a gapped series as a smaller number with no error. Every consequence of syncing an unapproved video is a number in a table we can filter; the consequence of *not* syncing it is data that can never exist.
- **`comments` / `transcript` / `analyse`: gate on approved + non-archived.** `worker/enqueue.mjs` `planComments` (`104-153`), `planTranscript` (`157-188`), `planAnalyse` (`192-238`) all build their subject set from `platform_posts` — add the join to `content_items.review_state='approved'` and a non-archived client in all three. All three are re-runnable later, none is a time series, and all three spend metered money or LLM tokens against `LLM_MONTHLY_TOKEN_LIMIT`. **This is where the money actually is.**
- **Metered discovery (`syncRunner.ts:507-560`): unchanged.** Discovery is how a video is found; gating it on approval is circular.

**I. The portal is the one split.** `portal/page.tsx:17-28` shows a client their own content. Hiding their self-posted video is confusing and faintly insulting since they posted it; showing it in `totalsByPlatform` (`portal/page.tsx:54-59`) reports agency performance including their own posts. **Decision: show the row, exclude it from the totals, label the section.** The portal is the one surface where the row and the statistic legitimately disagree, because the client owns the row and the agency owns the claim.

### Edge cases and deliberate refusals
- **We refuse a fourth state for archived clients.** Archive is derived on every read (`dashboards.ts:514-516`); a denormalised copy would need maintaining on every archive/unarchive and would drift, and un-archiving would then have to restore per-row state it never had.
- **We refuse to reuse `/approvals`** — that route is timesheets.
- **We refuse to delete rejected content.** Rejecting is a claim about provenance, not a reason to destroy metrics history.
- The migration must not assert a row count. A migration written against "207" would fail or leave 48 rows uncovered.
- Approval is **not** a security boundary. RLS is row-level; a pending video is still readable by anyone with row access.

### Acceptance criteria
- [ ] After the migration, `select count(*) from content_items where review_state='approved'` equals the total row count, and `count(*) where reviewed_at is null` equals the same number.
- [ ] `select column_default from information_schema.columns where table_name='content_items' and column_name='review_state'` returns `'pending'`.
- [ ] A newly synced video arrives as `pending`; a video created via `createContentFromUrl` arrives as `approved` with `reviewed_by` set.
- [ ] The strip above the videos shows approved / pending / rejected counts that sum to the workspace total (minus archived clients).
- [ ] "New since last sync" is non-zero immediately after a sync that discovered something, and zero after everything is reviewed.
- [ ] Rejecting a video removes it from `/content`, from `computeRankings`, from `/home` counts, from `GET /api/v1/content`, and from `weeklyRead` evidence — and it appears in the Rejected archive.
- [ ] Restoring it from the archive returns it everywhere.
- [ ] A pending video still appears in the `?video=` dropdown and its deep link still renders.
- [ ] A pending video still accrues `post_snapshots` (verify a second snapshot lands).
- [ ] A pending video is **not** enqueued for comments, transcript or analyse (verify `ingest_jobs` has no new rows for it).
- [ ] The client portal shows a client-self-posted video as a row, and its views are absent from the portal's platform totals.
- [ ] The same video approved then re-discovered by the sync is not returned to the queue.

---

## 10. Data sync page: allow unselecting a page (account)

### What the user asked for
> "Data sync page: allow UNSELECTING a page (account) — more control over what syncs."

### Current behaviour
- `accounts.sync_enabled` already exists and already governs everything: `runSync` filters `.eq("sync_enabled", true)` (`src/lib/syncRunner.ts:362`).
- **Nothing in the app can change it.** `grep sync_enabled src/` returns only reads: `DataPanel.tsx:192` renders a `sync off` pill, `AccountsManager.tsx:209` renders a `Sync paused` badge. There is **no** `setSyncEnabled` action — `actions.ts` has `updateAccountClient`, `createAccount`, `updateSyncWindow`, `setArchived`, and nothing that writes `sync_enabled`.
- `AccountsManager`'s toggle (`AccountsManager.tsx:55-59, 244`) writes `is_archived`, which is a different and heavier statement.
- `/data` already loads `sync_enabled` per account (`data/page.tsx:31-36`) into `PanelAccount.syncEnabled` (`data/page.tsx:71`), and the "Accounts syncing" hero stat already counts `accounts.filter(a => a.syncEnabled)` (`data/page.tsx:132-136`).

### The design
- New action `setAccountSyncEnabled(accountId: string, enabled: boolean)` in `actions.ts`, modelled on `updateSyncWindow` (`2309-2322`) — update, `.select("id, workspace_id").single()` (RLS refuses it for a non-manager, and reaching the next line proves authorisation), `logAudit` with `entityType:'accounts'` / `account.sync_toggled`, then `revalidatePath("/data")`, `revalidatePath("/accounts")`, `revalidateTeam()`.
- **Unlike `updateSyncWindow`, it does not trigger a sync.** Turning an account *off* must never spend a fetch.
- In `DataPanel.tsx`, replace the passive `sync off` pill (`:192`) with a toggle in the account row, styled like `ClientActiveToggle` (a pill, not a checkbox), manager-gated. Label it in the user's terms: **Syncing / Paused**.
- The hero stat "Accounts syncing … of N connected" (`data/page.tsx:132-136`) already reflects the flag, so it updates for free.

### Schema / migration
**None** — `sync_enabled` exists.

### Edge cases and deliberate refusals
- **Paused ≠ archived.** Archiving an account (`AccountsManager`) hides it from `/data` entirely (`data/page.tsx:35` filters `is_archived=false`) and drops it from every inventory list. Pausing keeps the row, keeps its history, and keeps it visible on `/data` so the pause is *findable*. The two controls must be labelled so they cannot be confused.
- **Pausing does not delete history.** Existing `platform_posts` and `post_snapshots` stay, and existing content keeps appearing in `/content`. What stops is new readings — and, exactly like change 7's reactivation case, **a paused-then-resumed account produces one enormous momentum bar** in `homeData.ts:127-140` when the gap closes. The same mitigation applies.
- **We refuse a "sync everything except X" bulk control** in v1. Per-account is what was asked for, and a bulk pause is one click away from silently freezing the whole pipeline.
- Manual "Sync now" for a paused account: `syncNow` (`actions.ts:2140`) calls `runSync` with an explicit `accountId`, which still filters `.eq("sync_enabled", true)` — so a paused account cannot be manually synced either. That is the right behaviour; the UI must disable the per-account refresh button when paused rather than firing a call that silently does nothing.

### Acceptance criteria
- [ ] A manager can pause an account from `/data`; the pill flips without a page reload and the "Accounts syncing" stat decrements.
- [ ] `select sync_enabled from accounts where id=…` is false.
- [ ] The next cron run does not touch that account (verify no new `sync_runs` row and no new snapshots).
- [ ] Pausing spends zero fetches — for a metered account, the Instagram budget `used_*` figures are unchanged.
- [ ] The per-account "Sync now" button is disabled while paused, rather than silently no-opping.
- [ ] Resuming restores normal sync on the next run.
- [ ] A non-manager cannot toggle it (RLS refusal surfaces as a toast, not a silent no-op).
- [ ] `audit_log` records the toggle.

---

## 11. BUG — dropdown panels painted under the stat cards

### What the user asked for
> "Open dropdown panels are painted UNDER the stat cards. Fix for ALL dropdowns."

### Current behaviour
- There are **five hand-rolled dropdown panels**, each with its own absolute positioning and its own z value:
  - `src/components/ui/Select.tsx:105` — `animate-pop absolute left-0 top-full z-30`
  - `src/components/FilterBar.tsx:421` (`MultiSelect`) — `animate-pop absolute left-0 top-full z-30`
  - `src/components/ProjectPicker.tsx:77` — `absolute left-0 top-full z-30`
  - `src/components/VideoTile.tsx:253` (role-credit menu) — `absolute right-0 top-full z-20`
  - `src/components/Sidebar.tsx:195` — `absolute … z-20`
- On `/content` the order is: `FilterBar` (a `.card`, `FilterBar.tsx:172`) → `StatGrid` (`content/page.tsx:437`) whose children are `Stat` (`src/components/Stat.tsx:29-33`, `className="animate-rise relative … card"`) inside `.stagger`.
- `.animate-rise` is `animation: fade-rise var(--dur-base) var(--ease) both` (`globals.css:187-189`), and `.stagger > *` adds up to 350ms of `animation-delay` (`globals.css:274-282`). With `animation-fill-mode: both`, the **backwards fill applies `transform: translateY(8px)` during the delay**, which creates a stacking context on each stat card; and every soft navigation from `FilterBar.setMany` → `router.push` (`FilterBar.tsx:111-120`) re-runs it.
- There is **no app-wide z-scale and no `isolation` anywhere** — `grep isolate src/app/globals.css` returns nothing.
- A **second, distinct clipping bug** exists and z-index cannot fix it: `ContentOverview.tsx:253-256` passes `className="card divide-y … overflow-hidden"` to `LoadMoreList`, so `VideoTile`'s role menu (`VideoTile.tsx:253`) is **clipped by the list container**, not painted under it. Likewise `PlatformReach`'s root is `card divide-y overflow-hidden`.

> **Honest caveat:** the precise stacking-context culprit differs per page and per moment (mid-animation vs settled), which is exactly why patching individual z values has not held. The fix below removes the entire class of bug regardless of which ancestor is responsible, and the acceptance criteria require verifying it on each page rather than reasoning about it.

### The design

**A. One shared panel primitive: `src/components/ui/Popover.tsx`.** It renders its panel through `createPortal(…, document.body)` with `position: fixed`, positioned from the trigger's `getBoundingClientRect()`, flipping above the trigger when there is not enough room below. A portalled fixed panel is a child of `<body>`, so **no ancestor's stacking context and no ancestor's `overflow: hidden` can reach it** — which fixes both the paint-order bug and the `overflow-hidden` clipping bug with one mechanism.

It keeps the behaviour the existing panels already have: close on outside `pointerdown`, close on `Escape`, `role="listbox"`, `aria-expanded` on the trigger. It must also reposition on scroll and resize (a fixed panel does not follow its trigger otherwise) and close on route change.

**B. A z-scale, documented once** in `globals.css`:
```
--z-dropdown: 800;   /* portalled popovers */
--z-sticky:   700;   /* TimerBar, mobile header */
--z-modal:    900;   /* mobile sidebar drawer */
--z-toast:   1000;   /* ui/Toast — already z-[60] */
```
Every ad-hoc `z-20` / `z-30` in the five components above is replaced by a token. Toast (`ui/Toast.tsx:46`) must stay above dropdowns.

**C. Migrate all five call sites** to `Popover`. `Select.tsx` and `FilterBar`'s `MultiSelect` keep their exact public interfaces so no call site changes.

**D. `prefers-reduced-motion`** already neutralises the animations (`globals.css:284-292`) — the fix must not depend on the animation, and the portal approach does not.

### Schema / migration
**None.**

### Edge cases and deliberate refusals
- **We refuse to raise z-index on the panels and call it done.** It has not held, it does nothing for the `overflow-hidden` clipping, and it leaves the next developer to rediscover the same trap.
- **We refuse to remove `overflow-hidden` from the list cards.** It is what gives the divided card its rounded corners; removing it is a visual regression.
- A portalled panel must inherit the theme. The app themes via CSS custom properties on `:root` (`globals.css`), so a `body`-level portal inherits correctly — but verify in **both** themes, and verify with the theme toggle flipped while a panel is open.
- Panels inside a scrollable container must reposition or close on scroll, otherwise they detach and float over unrelated content.
- Keyboard focus must not escape to the document when the panel opens; the trigger keeps focus and Escape returns to it.

### Acceptance criteria
- [ ] On `/content`, open the client multi-select — the panel paints **over** the stat cards, in both themes.
- [ ] Same, within 350ms of a filter change (i.e. while the stagger animation is running).
- [ ] On `/content`, open a video's role-credit menu on the **last** row of the list — the panel is not clipped by the list card.
- [ ] Same on `/reports`, `/data`, `/track`, `/import`, `/team-admin` — every page with both a dropdown and stat cards.
- [ ] Scroll the page with a panel open: the panel follows its trigger or closes; it never floats detached.
- [ ] A toast fired while a panel is open paints above the panel.
- [ ] The mobile sidebar drawer paints above everything except toasts.
- [ ] Escape closes the panel and returns focus to the trigger; outside click closes it.
- [ ] `grep -rn "z-20\|z-30" src/components/` returns no dropdown panels (only the documented sticky/modal cases, via tokens).
- [ ] `prefers-reduced-motion: reduce` — panels still paint on top.

---

## Build order

Each task is fully resolved and **tested against its own acceptance criteria** before the next begins.

| # | Task | Why here |
|---|---|---|
| 1 | **11 — dropdown paint/clipping** | Zero schema, zero data risk, and it is in the way of testing every dropdown the later tasks add (role filter, bulk toolbar, sync toggle). Fix the substrate first. |
| 2 | **6 — sort controls vanish** | Pure structure on `/content`. It decides whether the `soloClientId` branch survives, which changes **2**, **5** and **1**'s render targets — so it must be settled before anything else touches that page. |
| 3 | **4 — platform icons** | Smallest possible change, no data movement, and it establishes the `PlatformIcon` registry that **8** extends. |
| 4 | **5 — video thumbnails** | One nullable column and provider plumbing. Independent of everything else; lands a visible win early and exercises the `select-audit` loop before the risky migrations. |
| 5 | **3 — Guidelines add/remove client** | Pure reuse of two existing actions. Isolated to one page, and it is the control the user will need to *drive* change 7's archive behaviour. |
| 6 | **10 — per-account sync toggle** | One new action on an existing column. Independent, and it gives an off-switch for the sync before **8** and **9** start changing what the sync produces. |
| 7 | **2 — role filter + per-role tables** | Depends on **6** (where the tables render) and on **11** (the role filter is another dropdown). No schema. Reuses `personStats` unchanged, so the blast radius is a new component and one filter param. |
| 8 | **8 — YouTube Shorts** | First change that alters what enters the database. One `platforms` insert plus a provider mode. Must land before **7**'s read-path audit and **9**'s queue so the new platform is covered by both. Measure quota before merging. |
| 9 | **7 — active clients only** | Read-path only, but it touches `computeRankings`, the cache key, the public API and the worker, and it **moves every employee's score**. Do it as its own step so the number movement is attributable to exactly one change. It also builds `loadExcludedItemIds`, which **9** extends. |
| 10 | **9 — approval queue** | Schema + a 255-row default backfill + the same read-path set as **7**. Strictly after **7** so the exclusion plumbing already exists and the two rules are threaded together rather than separately. |
| 11 | **1 — merge + bulk actions** | Highest risk in the document: a SECURITY DEFINER transaction, an irreversible-without-journal delete, and eight tables to move rows between. Last, on top of a page whose branch structure (**6**), selection surface (**2**) and approval state (**9**) have all stopped moving. |

---

## Decisions the user must make

1. **Change 6 — does `ClientDetail` survive?** Deleting the solo-client branch makes the sort bug unrepeatable and gives change 2 its role tables for free, but it removes the client-facing framing ("Videos delivered", "Time invested", hours-per-1k-views per platform, `ClientDetail.tsx:94-108`). If that view is ever shown to a client, we keep the branch and mount a shared sort bar instead — which permanently doubles the sort surface. *Which is it?*

2. **Change 2 — does the role filter narrow the videos, or only the tables?** This PRD specifies tables-only, and the two area reports disagree on it. Tables-only is safer (the stat tiles don't move when you look at editors) but means selecting "editor" does not shrink the video list, which some people will expect.

3. **Change 2 — highlight or scope for the person filter?** Highlighting selected employees while the tables describe *everyone's* work requires computing the tables over a population **not** narrowed by `personIds` — which means either loading `/content`'s five paged whole-table reads twice (`dashboards.ts:192-233`, uncached), or exporting the currently-private `deriveContent` (`dashboards.ts:136`) so the page can build tables from the wide set and the list from the narrow one. The cheap alternative is to accept the narrowing and label it on screen. *Highlight-within-everyone, or highlight-within-the-filtered-set?*

4. **Change 9 — the portal split.** We propose: a client-self-posted video shows as a **row** in their portal but is **excluded from the portal's platform totals**, with the section labelled. This is the one place in the product where a row and a statistic deliberately disagree. Confirm, or choose hide-entirely.

5. **Change 1 — bulk action set for v1.** Everything technically available is: assign/unassign role, set client, set produced_at, set subject/hook/music/notes. We propose shipping **assign role + set client + set produced_at + merge**, and refusing bulk delete outright. Adding more multiplies the confirm-step surface.

6. **Change 8 — is doubled YouTube quota acceptable?** A client with both a YouTube and a YouTube Shorts account costs roughly twice the discovery quota for that channel unless the uploads listing is cached across accounts within a run. Free but finite, resets daily. Confirm before rollout, or accept the caching work as part of the task.

7. **Change 5 — Instagram thumbnail backfill.** YouTube backfills for free from the video id. Instagram cannot: it requires a metered Apify discovery run per account. We propose **not** backfilling Instagram. Confirm.

8. **Verify against the live database, not only the migrations, before change 1 and change 9 ship.** Two claims in this document come from migration files alone: that no UPDATE policy was ever added out-of-band to `content_assignments`, and that no `post_scores` table exists (it is referenced at `worker/jobs/weeklyRead.mjs:71-75` and created by no migration; the call is swallowed by `.then(r => r, () => ({data:null}))`). This repo's history shows the schema has been corrected production-first before.
---

## Decisions — RESOLVED 2026-08-12

These supersede the open questions above. Recorded here because each one changes what gets
built, and a decision that lives only in a chat log is a decision that gets re-litigated.

**1. The solo-client view is INTERNAL ONLY — merge it away.**
`ClientDetail`'s client-facing framing is not shown to clients, so the solo-client branch on
`/content` is removed rather than kept in step. Selecting a client now stays on the normal
Content page, which makes change 6 structural rather than a patch: the sort controls cannot
vanish because there is no longer a second branch to vanish into. The per-role tables from
change 2 gain a home for free. Any framing worth keeping from `ClientDetail.tsx:94-108`
moves onto the main page as tiles.

**2. The role filter NARROWS THE VIDEOS as well as driving the tables.**
The user chose narrowing over tables-only. Consequence, accepted knowingly: the stat tiles
(`content/page.tsx:437`) recount on every role change, so "207 videos" becomes "videos with
an editor credited". That is a headline number moving under the reader, so the tiles MUST be
labelled with the active role while a role filter is set — an unlabelled tile that silently
means something different is the failure mode this decision creates, and labelling is the
mitigation. Clearing the role restores the full counts.

**3. Tables rank against EVERYONE; the filtered people are highlighted.**
"Who does best" is a question about standing in the team, so a highlighted row at position 7
of 12 is the honest answer and a filtered table of one is not. This requires the tables to be
computed over a population NOT narrowed by `personIds`, while the video list IS narrowed —
so `deriveContent` (`dashboards.ts:136`, currently private) is exported and the page builds
tables from the wide set and the list from the narrow one. Read cost is noted in change 2.

Interaction with decision 2, which must not be got wrong: the role filter narrows BOTH the
videos and the tables (a role table is per-role by definition). The person filter narrows
ONLY the videos, never the table population. Two filters, two different behaviours, and the
distinction is deliberate.

**4. Rejected client-self-posted videos are HIDDEN ENTIRELY from the client portal.**
No row, no statistic. The portal shows agency work only. This drops the proposed
row-visible/stat-excluded split, which means the portal never displays a row and a total that
disagree. Accepted risk: a client who knows they posted a video may notice it absent and ask.
That is a conversation, not a wrong number.

### Remaining calls, made without asking (say so if any is wrong)

- **Change 5 — no Instagram thumbnail backfill.** YouTube backfills free from the video id;
  Instagram would cost a metered Apify run per account to fill in a decorative image. New
  Instagram posts get a thumbnail going forward, from discovery data already being fetched.
- **Change 8 — cache the uploads listing across accounts within a sync run.** Rather than
  accept doubled YouTube quota for a channel that has both a YouTube and a Shorts account,
  the discovery response is reused within the run. Quota is free but finite and resets daily;
  paying twice for the same listing is avoidable waste, and the caching is small.
- **Change 1 — v1 bulk actions are: assign role, set client, set produced_at, and merge.**
  Bulk delete is refused outright. Every additional bulk field multiplies the confirm-step
  surface, and these four cover the stated need ("assigning a role or anything related to a
  video details").
