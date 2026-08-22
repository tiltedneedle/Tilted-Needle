// An idea may only cite evidence that exists, about the thing it claims.
//   npm run test:provenance
//
// Telling a model to cite its sources produces citations, not true ones. The
// checks that matter run in code, after the response:
//
//   invented id       -> the idea is dropped (invented provenance)
//   real id, wrong    -> the idea is dropped (deceptive grounding: evidence
//   figure               about Y presented as evidence about X, which per-id
//                        checks cannot see)
//   no citations      -> dropped, never shown with a caveat
//
// And "measured" is a label the idea EARNS by citing an acting/holds finding,
// not a word the model writes.
import {
  validateIdeas, figuresMatch, scriptGateOpen, MIN_SCRIPT_EXEMPLARS,
} from "../src/lib/analysis/provenance.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
};

const CANDIDATES = [
  { type: "finding", id: "f1", figure: 1.31, state: "acting" },
  { type: "finding", id: "f2", figure: 0.84, state: "holds" },
  { type: "finding", id: "f3", figure: 1.05, state: "none" },
  { type: "video", id: "v1", figure: 4.2 },
  { type: "video", id: "v2", figure: 1.9 },
];

const idea = (citations, body = { title: "an idea" }) => ({ body, citations });

/* ---- The three drops ----------------------------------------------------- */
{
  const r = validateIdeas([idea([])], CANDIDATES);
  check("an uncited idea is dropped, not caveated",
    r.kept.length === 0 && r.dropped.droppedUncited === 1);

  const r2 = validateIdeas([idea([{ id: "f9", figure: 1.31 }])], CANDIDATES);
  check("an invented id drops the whole idea",
    r2.kept.length === 0 && r2.dropped.droppedUnknownId === 1,
    "an idea willing to invent one source cannot be trusted on the others");

  const r3 = validateIdeas([idea([{ id: "f1", figure: 0.84 }])], CANDIDATES);
  check("a real id with another row's figure is caught",
    r3.kept.length === 0 && r3.dropped.droppedBadFigure === 1,
    "deceptive grounding: f2's figure presented as f1's -- every id real, the binding false");
}

/* ---- What survives ------------------------------------------------------- */
{
  const r = validateIdeas([
    idea([{ id: "f1", figure: 1.31 }]),
    idea([{ id: "v1", figure: 4.2 }]),
    idea([{ id: "f2", figure: 0.84 }, { id: "v2", figure: 1.9 }]),
  ], CANDIDATES);
  check("correctly cited ideas survive", r.kept.length === 3);
  check("citing an acting finding earns 'measured'",
    r.kept[0].evidenceBasis === "measured");
  check("citing only the client's own videos is 'craft'",
    r.kept[1].evidenceBasis === "craft",
    "useful, but not a measured claim -- and the label is a schema field");
  check("a holds finding also earns 'measured'",
    r.kept[2].evidenceBasis === "measured");
}

/* ---- The none-state gate ------------------------------------------------- */
{
  const r = validateIdeas([idea([{ id: "f3", figure: 1.05 }])], CANDIDATES);
  check("a 'none' finding can be cited but never earns 'measured'",
    r.kept.length === 1 && r.kept[0].evidenceBasis === "craft",
    "citing 'we measured nothing' must not read as 'we measured'");
}

/* ---- Figure matching ----------------------------------------------------- */
{
  check("honest rounding passes", figuresMatch(1.31, 1.310) && figuresMatch(0.8400, 0.84));
  check("three decimal places is the line",
    figuresMatch(1.3104, 1.3101) && !figuresMatch(1.31, 1.32));
  // 1.312 differs from 1.31 at the third decimal; 1.3096 would NOT be a miss,
  // because it rounds to the same 1.310 -- the first version of this fixture
  // used it and failed against correct behaviour.
  const r = validateIdeas([idea([{ id: "f1", figure: 1.312 }])], CANDIDATES);
  check("a near-miss outside tolerance is still a drop", r.kept.length === 0);
}

/* ---- One bad citation poisons the idea, not the batch -------------------- */
{
  const r = validateIdeas([
    idea([{ id: "f1", figure: 1.31 }, { id: "f9", figure: 2 }]),
    idea([{ id: "f2", figure: 0.84 }]),
  ], CANDIDATES);
  check("an idea with one bad citation among good ones is dropped",
    r.kept.length === 1 && r.dropped.droppedUnknownId === 1);
  check("its neighbours are unaffected", r.kept[0].citations[0].id === "f2");
}

/* ---- The counters mirror tallyThemes ------------------------------------- */
{
  const r = validateIdeas([
    idea([]),
    idea([{ id: "bad", figure: 1 }]),
    idea([{ id: "f1", figure: 9.99 }]),
    idea([{ id: "f1", figure: 1.31 }]),
  ], CANDIDATES);
  check("every drop is counted by cause",
    r.dropped.droppedUncited === 1 && r.dropped.droppedUnknownId === 1
    && r.dropped.droppedBadFigure === 1 && r.kept.length === 1,
    JSON.stringify(r.dropped));
}

/* ---- The script gate ----------------------------------------------------- */
{
  check(`script generation needs >= ${MIN_SCRIPT_EXEMPLARS} transcribed top-quartile videos`,
    !scriptGateOpen(2) && scriptGateOpen(3),
    "below it, few-shot voice matching degrades into generic short-form voice");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
