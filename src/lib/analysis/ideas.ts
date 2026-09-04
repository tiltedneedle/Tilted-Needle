/**
 * Idea generation, in one place so the CLI and the worker cannot drift.
 *
 * This used to live entirely inside scripts/generate-ideas.mjs. The moment a
 * button needed to queue the same work, that script became the wrong home:
 * two copies of a routine carrying a budget check, a cache check and a
 * validator is two copies that will disagree, and the one that disagrees
 * quietly is the one that spends money.
 *
 * THE SHAPE OF THE GUARANTEE (unchanged). The model is handed a table of
 * candidates -- this client's acting/holds findings and its top videos, each
 * with an id and one figure -- and asked for ideas that cite them. Citations
 * are then checked IN CODE: an invented id, a figure belonging to a different
 * row, or no citation at all drops the idea before storage. "Measured" is
 * earned by citing a real finding; everything else is labelled craft. The
 * model proposes, the code disposes.
 */
import { configFromEnv, callModel, digestOf, budgetState, llmMonthlyTokenLimit } from "@/lib/llm";
import { validateIdeas } from "@/lib/analysis/provenance";
import { relativeIndex, topByRelative, scaleVerdict } from "@/lib/analysis/competitors";

export const IDEAS_PROMPT_VERSION = 2;

export type IdeaRunOptions = {
  clientId: string;
  /** How many to ask for. Clamped: the model is asked, not trusted. */
  count?: number;
  /** How many top-scoring videos to ground in. */
  pool?: number;
  /** Skip the input-digest cache check. */
  force?: boolean;
  /**
   * Build the evidence table and stop. Nothing is called, nothing is stored,
   * nothing is charged.
   *
   * This lives HERE rather than in the CLI because that is where it broke.
   * The old script implemented --dry-run itself; moving the logic into this
   * function left the flag parsed and unused, so `--dry-run` quietly ran a
   * full paid generation and stored ten ideas. A flag whose whole promise is
   * "this spends nothing" must be honoured by the thing that does the
   * spending.
   */
  dryRun?: boolean;
  /** How many competitor breakouts to put in front of the model. */
  rivalPool?: number;
  model?: string;
};

export type IdeaRunResult = {
  status: "stored" | "cached" | "nothing_to_ground" | "none_survived"
    | "budget_exhausted" | "dry_run";
  /** Only on a dry run: the exact table the model would have been given. */
  table?: string;
  clientName?: string;
  requested?: number;
  proposed?: number;
  kept?: number;
  poolSize?: number;
  candidates?: number;
  /** Competitor breakouts offered as evidence, after the 1.5x floor. */
  rivalCount?: number;
  /** Rivals excluded for being outside SCALE_BAND of the client. */
  rivalsOutOfScale?: number;
  dropped?: Record<string, number>;
  note?: string;
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

/** Paged AND ordered: .range() with no ORDER BY has no stable row order. */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function selectAll(db: any, table: string, columns: string, apply: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function schemaFor(count: number) {
  return {
    type: "object",
    required: ["ideas"],
    properties: {
      ideas: {
        type: "array",
        minItems: 1,
        // Slack above `count`: a model returning one extra should be trimmed,
        // not sent round the retry loop for it. Enforced for real now --
        // validate() ignored maxItems until this was fixed.
        maxItems: count + 2,
        items: {
          type: "object",
          required: ["title", "premise", "openingLine", "citations"],
          properties: {
            title: { type: "string", maxLength: 90 },
            premise: { type: "string", maxLength: 300 },
            openingLine: { type: "string", maxLength: 200 },
            citations: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "figure"],
                properties: { id: { type: "string" }, figure: { type: "number" } },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Generate and store ideas for one client.
 *
 * `db` must be a service-role client: it reads across tables the caller's
 * session may not see, and writes the ledger row. The CALLER is responsible
 * for having established that the requester may act on this client — this
 * function trusts clientId.
 */
export async function generateIdeasForClient(
  db: any,
  opts: IdeaRunOptions,
): Promise<IdeaRunResult> {
  const count = clamp(opts.count ?? 10, 1, 20);
  const pool = clamp(opts.pool ?? 100, 1, 200);
  /* Small on purpose. Competitor rows are a PROMPT, not a corpus: a handful
     of genuine breakouts is inspiration, thirty of them crowds out the
     client's own evidence and the model starts writing somebody else's
     channel. */
  const rivalPool = clamp(opts.rivalPool ?? 8, 0, 25);
  const MODEL = opts.model || process.env.IDEAS_MODEL || "gpt-4o-mini";

  const { data: client, error: clientErr } = await db
    .from("clients").select("id, name, workspace_id")
    .eq("id", opts.clientId).is("deleted_at", null).maybeSingle();
  if (clientErr) throw new Error(`clients: ${clientErr.message}`);
  if (!client) throw new Error("client not found or deleted");

  const findings = await selectAll(db, "client_findings",
    "id, hypothesis_id, state, multiplier, n_with, n_without",
    (q) => q.eq("client_id", client.id).eq("status", "active")
      .in("state", ["acting", "holds"]).order("id"));

  const items = await selectAll(db, "content_items", "id, title, hook, hook_type",
    (q) => q.eq("client_id", client.id).eq("review_state", "approved").order("id"));

  const { computeRankings } = await import("@/lib/performanceData");
  const rankings = await computeRankings(db, client.workspace_id);
  const scored = items
    .map((i: any) => ({
      ...i,
      index: (rankings.scoredByContent.get(i.id) ?? [])
        .reduce((m: number, p: any) => Math.max(m, p.index), 0),
    }))
    .filter((i: any) => i.index > 0)
    .sort((a: any, b: any) => b.index - a.index);

  /* The top `pool` scored videos, not a quartile capped at 8. A quartile
     shrinks as a library grows -- exactly backwards -- and the cap meant
     "our top 100" was in practice "our top 8". */
  const top = scored.slice(0, pool);

  const transcripts = top.length
    ? await selectAll(db, "video_transcripts", "content_item_id, full_text",
        (q) => q.in("content_item_id", top.map((v: any) => v.id)).order("content_item_id"))
    : [];
  const transcribed = new Map(transcripts.map((t: any) => [t.content_item_id, t.full_text]));

  /* COMPETITOR BREAKOUTS, indexed against their OWN median before they are
     allowed near the prompt.

     Raw view counts across accounts are follower counts wearing a
     performance label -- a rival with ten times the audience wins every
     comparison regardless of what they made. Each competitor is therefore
     scored against themselves, exactly as perfIndex scores a client, and only
     the ratio reaches the model. A row reading "6.0x their own normal" is a
     claim about the video; "1,000,000 views" is a claim about their
     follower count.

     Only posts that genuinely broke out are offered. An average post from a
     rival teaches nothing that the client's own average post does not. */
  const rivals = rivalPool > 0
    ? await selectAll(db, "competitors", "id, handle, platform_slug, median_views",
        (q) => q.eq("client_id", client.id).eq("is_archived", false).order("id"))
    : [];

  /* THE CLIENT'S OWN MEDIAN VIEWS, so a rival can be checked for being in the
     same league at all.

     VIEWS, not perfIndex. A first pass took the median of `index` -- which is
     a RATIO against the account's own baseline, hovering near 1.0 by
     construction -- and was about to divide a competitor's raw view median by
     it. That is a units error: 110,000,000 / 1.02 is not a scale ratio, it is
     nonsense that happens to be a number. Both sides of this comparison have
     to be raw views.

     Per video we take the BEST platform's views rather than a sum, for the
     reason the whole product repeats: a view means something different on
     each platform and adding them is not a quantity. Best-platform is the
     same choice bestIndex already makes. */
  const clientMedianViews = await (async () => {
    const ids = scored.map((v: any) => v.id);
    if (!ids.length) return null;
    const posts = await selectAll(db, "platform_posts",
      "id, content_item_id, metrics:post_current_metrics(views)",
      (q) => q.in("content_item_id", ids).order("id"));
    const bestByItem = new Map<string, number>();
    for (const p of posts as any[]) {
      const m = Array.isArray(p.metrics) ? p.metrics[0] : p.metrics;
      const v = m?.views;
      if (typeof v !== "number" || v <= 0) continue;
      bestByItem.set(p.content_item_id, Math.max(bestByItem.get(p.content_item_id) ?? 0, v));
    }
    const vals = [...bestByItem.values()].sort((a, b) => a - b);
    if (!vals.length) return null;
    const m = vals.length >> 1;
    return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
  })();

  /* SCALE GATE. rel_index makes a rival's NUMBERS comparable; it says nothing
     about whether their TACTICS transfer, and those are different questions.
     A channel whose median is 9,000x the client's is not a competitor, it is
     a different sport -- its breakout was "Last To Leave Grocery Store, Wins
     $250,000", offered beside a rule asking for something a small team could
     shoot in a week.

     Out-of-band rivals are EXCLUDED from the prompt, not silently dropped
     from the product: they stay listed on the client page, labelled with how
     far out they are, because the user put them there deliberately and a list
     that quietly discards entries is worse than one that explains itself. */
  const inBand = rivals.filter((r: any) =>
    scaleVerdict(r.median_views, clientMedianViews).comparable);
  const outOfBand = rivals.length - inBand.length;

  let rivalCandidates: any[] = [];
  if (inBand.length) {
    const rivalPosts = await selectAll(db, "competitor_posts",
      "id, competitor_id, title, caption, views, url",
      (q) => q.in("competitor_id", inBand.map((r: any) => r.id)).order("id"));

    const byRival = new Map<string, any[]>();
    for (const p of rivalPosts as any[]) {
      if (!byRival.has(p.competitor_id)) byRival.set(p.competitor_id, []);
      byRival.get(p.competitor_id)!.push(p);
    }

    const scoredRivalPosts: any[] = [];
    for (const r of inBand as any[]) {
      const { scored: rs } = relativeIndex(byRival.get(r.id) ?? []);
      for (const p of rs) {
        // BREAKOUTS ONLY. 1.5x their own median is the floor for "this did
        // unusually well for them"; below it the post is just their Tuesday.
        if (p.relIndex != null && p.relIndex >= 1.5) {
          scoredRivalPosts.push({ ...p, handle: r.handle, platform: r.platform_slug });
        }
      }
    }

    rivalCandidates = topByRelative(scoredRivalPosts, rivalPool).map((p: any) => ({
      type: "rival",
      id: p.id,
      figure: Number(p.relIndex.toFixed(3)),
      label: (p.title || p.caption || "Untitled").slice(0, 90),
      handle: p.handle,
      platform: p.platform,
    }));
  }

  const candidates = [
    ...findings.map((f: any) => ({
      type: "finding", id: f.id, figure: Number(Number(f.multiplier).toFixed(3)),
      state: f.state, label: f.hypothesis_id,
    })),
    ...top.map((v: any) => ({
      type: "video", id: v.id, figure: Number(v.index.toFixed(3)),
      label: v.title, hookType: v.hook_type,
      hook: (v.hook ?? transcribed.get(v.id) ?? "").slice(0, 140),
    })),
    ...rivalCandidates,
  ];

  if (!candidates.length) {
    return {
      status: "nothing_to_ground", clientName: client.name, candidates: 0, poolSize: 0,
      note: "no findings and no scored videos to ground ideas in",
    };
  }

  /* EVERY ROW SAYS WHOSE VIDEO IT IS, and that is not presentation.
     A rival row rendered through the VIDEO branch reads "[id] VIDEO "..."
     scored 3.125x baseline" -- indistinguishable from the client's own work,
     against the client's own baseline, which is the exact contamination the
     separate tables exist to prevent. It reached the model that way once,
     because a formatting edit silently failed to apply and nothing downstream
     could tell the two apart. The type is now branched explicitly. */
  const table = candidates.map((c: any) => {
    if (c.type === "finding") {
      return `[${c.id}] FINDING ${c.label}: ${c.figure}x (${c.state})`;
    }
    if (c.type === "rival") {
      return `[${c.id}] RIVAL @${c.handle} (${c.platform}) "${c.label}" `
        + `did ${c.figure}x THEIR OWN median`;
    }
    return `[${c.id}] VIDEO "${c.label}" scored ${c.figure}x baseline`
      + (c.hookType ? ` [hook: ${c.hookType}]` : "")
      + (c.hook ? ` -- opens: "${c.hook}"` : "");
  }).join("\n");

  const system = [
    "You propose short-form video ideas for a marketing client, grounded in the",
    "evidence table provided. Rules:",
    "- Every idea MUST cite at least one row: {\"id\": \"<row id>\", \"figure\": <that row's exact number>}.",
    "- Copy figures exactly as printed. Never adjust, round further, or invent.",
    "- Cite a row only when the idea genuinely builds on it.",
    "- Ideas should be shootable by a small team within a week.",
    "- Do not repeat an idea already in the table; propose the NEXT one.",
    "- RIVAL rows are somebody else's video, shown as a multiple of THEIR own",
    "  median. Treat them as evidence a FORMAT travels, never as a target to",
    "  copy, and never imply the client should expect that competitor's reach.",
    "Respond with JSON only: {\"ideas\": [{\"title\", \"premise\", \"openingLine\", \"citations\": [{\"id\", \"figure\"}]}]}",
  ].join("\n");

  const user = `CLIENT: ${client.name}\n\nEVIDENCE TABLE:\n${table}\n\n`
    + `Propose exactly ${count} DISTINCT ideas, each citing at least one row above.`;

  /* `user` carries the whole evidence table, RIVAL ROWS INCLUDED, so adding
     or removing a competitor changes the digest and the cache correctly
     misses. That falls out of digesting the prompt rather than a hand-built
     key -- a key listing only clientId and count would have gone on serving
     yesterday's ideas after the list changed. */
  // Before the digest, the budget check and the call -- a dry run must not
  // even read the ledger, let alone spend against it.
  if (opts.dryRun) {
    return {
      status: "dry_run", clientName: client.name, requested: count,
      poolSize: top.length, candidates: candidates.length,
      rivalCount: rivalCandidates.length, table,
      note: "nothing called, nothing stored, nothing charged",
    };
  }

  const digest = digestOf({ user, PROMPT_VERSION: IDEAS_PROMPT_VERSION, MODEL, COUNT: count });

  // Cache PRE-check. Computing the digest only to store it afterwards
  // honoured the letter of "identical inputs are never paid for twice" and
  // none of its point.
  if (!opts.force) {
    const { data: seen } = await db.from("ai_analyses")
      .select("id, created_at").eq("workspace_id", client.workspace_id)
      .eq("kind", "idea_generation").eq("input_digest", digest).limit(1);
    if (seen?.length) {
      return {
        status: "cached", clientName: client.name, poolSize: top.length,
        candidates: candidates.length,
        note: `identical evidence already generated on ${String(seen[0].created_at).slice(0, 10)}`,
      };
    }
  }

  // The monthly ceiling llm.ts calls the hard stop against a surprise bill.
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const spendRows = await selectAll(db, "ai_analyses", "input_tokens, output_tokens",
    (q) => q.eq("workspace_id", client.workspace_id)
      .gte("created_at", since.toISOString()).order("id"));
  const spent = spendRows.reduce(
    (n: number, r: any) => n + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0);
  if (budgetState(spent, llmMonthlyTokenLimit()).exhausted) {
    return {
      status: "budget_exhausted", clientName: client.name,
      note: `${spent.toLocaleString()} of ${llmMonthlyTokenLimit().toLocaleString()} tokens used this month`,
    };
  }

  const result = await callModel<{ ideas: any[] }>({
    cfg: configFromEnv(),
    model: MODEL,
    system,
    user,
    schema: schemaFor(count),
    maxTokens: Math.min(4000, 260 * count),
    temperature: 0.7,
  });

  const proposed = result.data.ideas.slice(0, count);
  const { kept, dropped } = validateIdeas(
    proposed.map((i: any) => ({ body: i, citations: i.citations })),
    candidates as any,
  );

  /* THE LEDGER ROW IS UNCONDITIONAL. It used to sit inside `if (kept.length)`,
     so a run the validator rejected entirely spent real tokens nothing
     recorded -- and the budget check above sums exactly this table. Spend is
     spend whether or not anything survived it. */
  const { error: ledgerErr } = await db.from("ai_analyses").insert({
    workspace_id: client.workspace_id,
    subject_type: "client",
    subject_id: client.id,
    kind: "idea_generation",
    prompt_version: IDEAS_PROMPT_VERSION,
    model: MODEL,
    input_digest: digest,
    output: {
      requested: count, proposed: result.data.ideas.length,
      kept: kept.length, dropped, poolSize: top.length,
      rivalPoolSize: rivalCandidates.length, rivalsOutOfScale: outOfBand,
    },
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
  });

  if (!kept.length) {
    return {
      status: "none_survived", clientName: client.name,
      requested: count, proposed: result.data.ideas.length, kept: 0,
      poolSize: top.length, candidates: candidates.length, dropped,
      note: ledgerErr ? `spend NOT ledgered: ${ledgerErr.message}` : "spend ledgered, nothing stored",
    };
  }

  const { data: run } = await db.from("analysis_runs")
    .select("id").eq("workspace_id", client.workspace_id)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();

  const { error } = await db.from("idea_suggestions").insert(kept.map((k: any) => ({
    workspace_id: client.workspace_id,
    client_id: client.id,
    run_id: run?.id ?? null,
    prompt_version: IDEAS_PROMPT_VERSION,
    model: MODEL,
    kind: "idea",
    body: k.body,
    evidence_refs: k.citations,
    evidence_basis: k.evidenceBasis,
    dropped_counts: dropped,
  })));
  if (error) throw new Error(`storing ideas: ${error.message}`);

  return {
    status: "stored", clientName: client.name,
    requested: count, proposed: result.data.ideas.length, kept: kept.length,
    poolSize: top.length, candidates: candidates.length,
    rivalCount: rivalCandidates.length, rivalsOutOfScale: outOfBand, dropped,
    note: ledgerErr ? `WARNING: spend not ledgered: ${ledgerErr.message}` : undefined,
  };
}
