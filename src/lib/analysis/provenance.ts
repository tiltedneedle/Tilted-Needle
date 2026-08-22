/**
 * Mechanical citation checking for generated ideas. In code, before anything
 * reaches a screen.
 *
 * PROVENANCE IS A VALIDATOR, NOT A PROMPT. Telling the model to cite its
 * sources produces citations; it does not produce TRUE citations. The checks
 * that matter run after the response, in code the model cannot see or argue
 * with:
 *
 *   1. Every cited id exists in the candidate set the prompt supplied.
 *      Catches invented provenance.
 *   2. Every quoted figure matches the supplied row for that id, to three
 *      decimal places. Catches invented numbers -- and the subtler failure of
 *      DECEPTIVE GROUNDING, where every claim is sourced from a real row but
 *      about the wrong entity: evidence about Y presented as evidence about
 *      queried X. Models are specifically weak at precise value extraction
 *      from context, which is exactly the operation an idea generator performs
 *      on an evidence table.
 *   3. An idea with no surviving citation is DROPPED, never shown with a
 *      caveat, because the number of people who read the caveat is the number
 *      who did not need it.
 *
 * What is removed is counted (droppedUncited, droppedBadFigure,
 * droppedUnknownId) and stored on the generation, mirroring
 * tallyThemes().problems[] -- the system's standing pattern that the model
 * proposes and the code disposes.
 */

export type EvidenceRow = {
  /** 'finding' rows come from client_findings; 'video' rows from the client's
   *  own library. */
  type: "finding" | "video";
  id: string;
  /** The one number this row stakes: a finding's multiplier, a video's index. */
  figure: number;
  /** acting | holds for findings -- 'none' rows are never candidates. */
  state?: string;
};

export type CitedIdea<T = unknown> = {
  body: T;
  citations: { id: string; figure: number }[];
};

export type ValidatedIdeas<T> = {
  kept: (CitedIdea<T> & { evidenceBasis: "measured" | "craft" })[];
  dropped: {
    droppedUncited: number;
    droppedBadFigure: number;
    droppedUnknownId: number;
  };
};

/** Figures match to three decimal places: tight enough that a number about a
 *  different row cannot slip through as rounding, loose enough that honest
 *  formatting (1.30 for 1.3) does. */
export function figuresMatch(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0005;
}

export function validateIdeas<T>(
  ideas: CitedIdea<T>[],
  candidates: EvidenceRow[],
): ValidatedIdeas<T> {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const dropped = { droppedUncited: 0, droppedBadFigure: 0, droppedUnknownId: 0 };
  const kept: ValidatedIdeas<T>["kept"] = [];

  for (const idea of ideas) {
    const citations = idea.citations ?? [];
    if (citations.length === 0) {
      dropped.droppedUncited++;
      continue;
    }

    let bad = false;
    for (const c of citations) {
      const row = byId.get(c.id);
      if (!row) {
        // An id the prompt never supplied: invented provenance. The whole
        // idea goes, not just the citation -- an idea willing to invent one
        // source cannot be trusted on the others.
        dropped.droppedUnknownId++;
        bad = true;
        break;
      }
      if (!figuresMatch(c.figure, row.figure)) {
        /* The deceptive-grounding case. The id is real, so a per-id check
           passes; the figure belongs to a DIFFERENT row, which is how
           evidence about Y gets presented as evidence about X. Only the
           figure-to-id binding catches it. */
        dropped.droppedBadFigure++;
        bad = true;
        break;
      }
    }
    if (bad) continue;

    /* 'measured' is earned, not asserted: every citation survived AND at
       least one cites a finding in an acting/holds state. Ideas grounded only
       in the client's own videos are still useful but they are craft
       observations, and the label is a schema field so no prose can soften
       it. */
    const citesFinding = citations.some((c) => {
      const row = byId.get(c.id);
      return row?.type === "finding" && (row.state === "acting" || row.state === "holds");
    });
    kept.push({ ...idea, evidenceBasis: citesFinding ? "measured" : "craft" });
  }

  return { kept, dropped };
}

/**
 * The candidate set for one client, and the gates that shape it.
 *
 * - Findings enter only in acting/holds states. A 'none' state is the absence
 *   of evidence, and an idea citing it would be laundering "we measured
 *   nothing" into "we measured".
 * - Script generation additionally requires >= 3 transcribed top-quartile
 *   videos: below that, few-shot voice matching degrades into generic
 *   short-form voice, which is precisely the failure being avoided. Below the
 *   gate the generator produces structure only, and says so.
 */
export const MIN_SCRIPT_EXEMPLARS = 3;

export function scriptGateOpen(transcribedTopQuartile: number): boolean {
  return transcribedTopQuartile >= MIN_SCRIPT_EXEMPLARS;
}
