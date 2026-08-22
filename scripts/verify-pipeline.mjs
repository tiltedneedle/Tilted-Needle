// Prove the content-intelligence pipeline works end to end, from live data.
//   npm run verify:pipeline
//
// WHY THIS EXISTS RATHER THAN A CHECKLIST IN A DOC
//
// Every step of docs/PRD-content-intelligence.md was built, tested and
// deployed separately, and each was reported as done at the time. That is
// exactly the situation in which a system quietly stops working: the parts
// pass their own tests while the SEAMS between them rot. A commit message in
// this project once claimed a fix the file never received, and a worker kind
// was enqueued hourly by a host that was not allowed to claim it -- neither
// showed up in any unit test, because neither is a unit.
//
// So this walks the actual chain, in order, against the real database:
//
//   raw posts -> transcripts -> features -> descriptors
//        \-> comments -> themes -> merged themes
//                              \-> inference -> findings -> ideas
//
// Every check either quotes a live count or fails. It asserts REACHABILITY
// (each stage has real output and is wired to the next), never a quality
// threshold -- coverage grows on its own schedule and a low number is a fact
// about the corpus, not a broken pipeline.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

let fileEnv = {};
try {
  fileEnv = Object.fromEntries(
    readFileSync("./.env.local", "utf8").split("\n").filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(),
                   l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
  );
} catch { /* CI supplies the environment directly */ }
const env = { ...fileEnv, ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
  console.log("SKIPPED: no database credentials. This verifies the LIVE pipeline "
    + "and has nothing to check without them.");
  process.exit(0);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

let pass = 0, fail = 0;
const check = (step, name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  [${step}] ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

async function count(table, build = (q) => q) {
  const { count: n, error } = await build(
    db.from(table).select("*", { count: "exact", head: true }),
  );
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
}

/* ---- Step 1-5: the corpus the later steps stand on ---------------------- */
const items = await count("content_items");
const posts = await count("platform_posts");
check("corpus", "content items and platform posts exist", items > 0 && posts > 0,
  `${items} items, ${posts} posts`);

/* ---- Step 6: transcripts, including the ASR lane ------------------------ */
const transcripts = await count("video_transcripts");
const fromAudio = await count("video_transcripts", (q) => q.eq("source", "asr"));
check("6 ASR", "transcripts exist and some came from AUDIO", transcripts > 0 && fromAudio > 0,
  `${transcripts} transcripts, ${fromAudio} transcribed from audio by the ASR lane`);

/* The gate is the reason the ASR lane is allowed to exist. Every stored ASR
   transcript is fed back through it here -- a hallucination that reached the
   corpus is the one failure this whole design is built to prevent. */
{
  const { gateAsrResult } = await import("../src/lib/analysis/asrGate.ts");
  const { data } = await db.from("video_transcripts").select("full_text").eq("source", "asr");
  const bad = (data ?? []).filter((t) => !gateAsrResult(t.full_text).speech);
  check("6 gate", "no stored ASR transcript is a Whisper silence artefact",
    bad.length === 0,
    bad.length ? `${bad.length} would fail the gate` : `${(data ?? []).length} re-checked, all pass`);
}

/* enrichment_state is what makes "missing" distinguishable from "unknown". */
const verdicts = await count("enrichment_state");
check("6 verdicts", "verdicts are recorded, so a gap is never mistaken for an answer",
  verdicts > 0, `${verdicts} verdicts`);

/* ---- Step 7: comments, across every platform ---------------------------- */
const comments = await count("post_comments");
check("7 comments", "comments are stored", comments > 0, `${comments} comments`);

/* ---- Step 8: Tier 1 features ------------------------------------------- */
const features = await count("video_features");
const featuresWithWords = await count("video_features", (q) => q.eq("transcript_present", true));
check("8 features", "features are computed, and know which rows were OBSERVED",
  features > 0 && featuresWithWords > 0,
  `${features} rows, ${featuresWithWords} with a transcript (the rest are unobserved, not negative)`);

/* The registry is the fixed family. If it were empty or unversioned, the
   multiple-comparisons correction downstream would be meaningless. */
{
  const { HYPOTHESES, REGISTRY_VERSION, canaries } = await import("../src/lib/analysis/hypotheses.ts");
  check("8 registry", "the hypothesis family is fixed, versioned, and has canaries",
    HYPOTHESES.length > 0 && REGISTRY_VERSION >= 1 && canaries().length >= 2,
    `v${REGISTRY_VERSION}, ${HYPOTHESES.length} hypotheses, ${canaries().length} canaries`);
}

/* ---- Step 9-10: the confidence engine, and what it wrote ---------------- */
const runs = await count("analysis_runs");
const effects = await count("workspace_effects");
check("9 engine", "the engine has run and recorded reproducible runs",
  runs > 0 && effects > 0, `${runs} runs, ${effects} pooled effects`);

{
  // A run must record the family size it corrected against -- inferring it
  // later would silently change what a past p-value meant.
  const { data: last } = await db.from("analysis_runs")
    .select("m_tested, q, permutations, seed, sigma_pooled, scored_posts")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  check("9 audit", "the latest run is reproducible from what it stored",
    Boolean(last && last.m_tested > 0 && last.seed && Number(last.sigma_pooled) > 0),
    last ? `m=${last.m_tested}, q=${last.q}, B=${last.permutations}, sigma=${Number(last.sigma_pooled).toFixed(3)}, n=${last.scored_posts}` : "no run");

  // platform_reversal must be COMPUTED, not defaulted. A column that is
  // always false records a check nobody ran.
  const { data: eff } = await db.from("workspace_effects")
    .select("platform_reversal, is_mixed, tau2")
    .order("id", { ascending: false }).limit(40);
  const reversals = (eff ?? []).filter((e) => e.platform_reversal).length;
  check("9 simpson", "the platform-reversal check produces real values, not a constant",
    reversals > 0 && reversals < (eff ?? []).length,
    `${reversals} of ${(eff ?? []).length} recent effects flagged — a constant either way would be a check nobody ran`);
}

/* ---- Step 11: the findings lifecycle ------------------------------------ */
const gateState = await count("client_analysis_state");
check("11 gate", "the data gate has memory, so clients are not re-tested weekly",
  gateState > 0, `${gateState} clients with a recorded last-run size`);

{
  const { isDue } = await import("../src/lib/analysis/findings.ts");
  const { data: st } = await db.from("client_analysis_state")
    .select("client_id, scored_posts_at_run, last_run_at").limit(1).maybeSingle();
  if (st) {
    const decision = isDue(
      { clientId: st.client_id, scoredPostsAtRun: st.scored_posts_at_run, lastRunAt: st.last_run_at },
      st.scored_posts_at_run,
    );
    check("11 hold", "a client whose library has not grown is HELD, not re-tested",
      decision.due === false, decision.reason.slice(0, 90));
  } else {
    check("11 hold", "a client whose library has not grown is HELD", false, "no state rows");
  }
}

/* ---- Step 12: retrieval and merged themes ------------------------------- */
const embeddings = await count("embeddings");
const merged = await count("merged_themes");
check("12 vectors", "embeddings exist and themes are merged across posts",
  embeddings > 0 && merged > 0, `${embeddings} embeddings, ${merged} client-level themes`);

{
  // The merge must not invent a count: every merged theme's count has to equal
  // its own verified id set.
  const { data: m } = await db.from("merged_themes")
    .select("label, comment_count, comment_ids").order("comment_count", { ascending: false }).limit(20);
  const liars = (m ?? []).filter((t) => (t.comment_ids ?? []).length !== t.comment_count);
  check("12 counting", "a merged count equals its verified id set, never more",
    liars.length === 0,
    liars.length ? `${liars.length} disagree` : `top theme "${m?.[0]?.label}" = ${m?.[0]?.comment_count} verified comments`);
}

/* ---- Step 13: Tier 2 descriptors ---------------------------------------- */
const descriptors = await count("video_descriptors");
check("13 descriptors", "descriptors are bought and stored", descriptors > 0,
  `${descriptors} descriptors`);

{
  /* Topic-stripped BY CONSTRUCTION: the embedded text must not carry subject
     matter, or clustering rediscovers topics instead of the styles a team can
     change before the next shoot.

     Checked as a CLOSED VOCABULARY rather than by word overlap. A first
     version compared topic words against the text and flagged three rows --
     all false, because the enum `creator_experience` contains "creator" and
     "experience", and a video about "a manager's experience" naturally shares
     those letters. Word overlap cannot tell a leaked topic from a coincidence
     with a fixed label.

     The real guarantee is stronger and exactly testable: the rendered string
     is assembled only from the schema's enums and computed pace/length words,
     so every token in it must come from a known set. Anything else IS a leak,
     whatever it happens to resemble. */
  const { data: d } = await db.from("video_descriptors")
    .select("topic, hook_descriptor_text").not("hook_descriptor_text", "is", null).limit(50);
  const ALLOWED = new Set([
    // hook.openingMove
    "question", "claim", "command", "story_start", "result_first", "greeting", "scene_setting",
    // hook.subjectFrame
    "viewer_problem", "creator_experience", "third_party", "product", "abstract_topic",
    // hook.addressee
    "viewer_direct", "audience_general", "nobody",
    // the computed half, plus the connective words in the template
    "opening", "framing", "addressing", "fast", "slow", "measured", "unknown",
    "delivery", "pace", "dense", "sparse",
  ]);
  const leaked = (d ?? []).filter((x) =>
    (x.hook_descriptor_text ?? "")
      .toLowerCase().split(/[\s,]+/).filter(Boolean)
      .some((tok) => !ALLOWED.has(tok)),
  );
  check("13 topic-free", "the embedded hook text is built only from the closed vocabulary",
    leaked.length === 0,
    leaked.length
      ? `${leaked.length} carry an unexpected token, e.g. "${leaked[0].hook_descriptor_text}"`
      : `${(d ?? []).length} checked, every token from the schema's enums`);
}

/* ---- Step 14: ideas, with verified provenance --------------------------- */
const ideas = await count("idea_suggestions");
check("14 ideas", "ideas exist and carry an evidence basis", ideas > 0, `${ideas} suggestions`);

{
  const { data: sug } = await db.from("idea_suggestions").select("evidence_basis, evidence_refs");
  const untyped = (sug ?? []).filter((s) => !["measured", "craft"].includes(s.evidence_basis));
  const uncited = (sug ?? []).filter((s) => !(s.evidence_refs ?? []).length);
  check("14 provenance", "every stored idea is typed and cited",
    untyped.length === 0 && uncited.length === 0,
    `${(sug ?? []).length} ideas, ${untyped.length} untyped, ${uncited.length} uncited`);

  // The feedback loop must be writable, not just present.
  const outcomes = await count("idea_outcomes");
  check("14 loop", "outcomes can be recorded (the adoption signal is collectable)",
    outcomes > 0, `${outcomes} recorded disposition(s)`);
}

/* ---- The seams: is anything enqueued that nothing can claim? ------------- */
{
  const { handlers } = await import("../worker/jobs/index.mjs");
  const kinds = Object.keys(handlers);
  const { data: queued } = await db.from("ingest_jobs")
    .select("kind").in("status", ["pending", "running"]).limit(1000);
  const orphanKinds = [...new Set((queued ?? []).map((j) => j.kind))].filter((k) => !kinds.includes(k));
  check("seam", "nothing is queued that no handler can claim",
    orphanKinds.length === 0,
    orphanKinds.length ? `orphaned: ${orphanKinds.join(", ")}` : `${kinds.length} handlers cover every queued kind`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
