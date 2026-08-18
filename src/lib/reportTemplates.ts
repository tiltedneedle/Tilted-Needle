/**
 * The report designs a client can be sent in.
 *
 * All four render the SAME component tree and the same data. Only a root class
 * differs, and every visual decision lives in CSS under that class. That
 * constraint is deliberate: four parallel React components would drift the
 * moment a section was added, and one of them would quietly stop showing a
 * figure the others show. A template may restyle anything; it may not decide
 * what the report says.
 *
 * Chosen per CLIENT rather than per workspace, because the clients are not
 * alike -- a private-jet broker and a bakery want a different document and the
 * agency sends both in the same month.
 *
 * THERE WERE FIVE AND THERE ARE FOUR. "Minimal" and "Editorial" were not two
 * designs: both hung on a full-height hairline spine, both refused fills for
 * rules, both spent one accent about three times a sheet, both sat on the same
 * grid. The only difference a client would notice was Georgia against
 * Helvetica, which is a choice inside a design rather than a separate one.
 * Offered side by side they would have read as a mistake.
 *
 * The freed slot went to Digest, which differs in SHAPE rather than in
 * styling. Three variations on a nine-page document plus one genuinely short
 * one is a real choice; four variations on a nine-page document is a swatch
 * book.
 */

export type ReportTemplate = "editorial" | "bold" | "luxury" | "digest";

export const REPORT_TEMPLATES: {
  id: ReportTemplate;
  name: string;
  /** What it looks like and who it flatters, in one line, for the picker. */
  blurb: string;
}[] = [
  {
    id: "editorial",
    name: "Editorial",
    blurb: "Broadsheet restraint — serif headlines, wide margins, rules doing the work. Closest to the reports you send now.",
  },
  {
    id: "bold",
    name: "Bold",
    blurb: "Agency deck — oversized numerals, strong section dividers, high contrast. Reads as energetic and confident.",
  },
  {
    id: "luxury",
    name: "Luxury",
    blurb: "Ink and champagne, wide tracking, ceremonial cover. For the jeweller and the jet broker.",
  },
  {
    id: "digest",
    name: "Digest",
    blurb: "Two sheets, tabular, no ceremony. For a client who wants the numbers and not nine pages.",
  },
];

const IDS = new Set(REPORT_TEMPLATES.map((t) => t.id));

/**
 * A stored value that no CSS implements would render a blank document, so an
 * unknown one falls back rather than being trusted. The database CHECK makes
 * this nearly unreachable; "nearly" is why it exists.
 */
export function asTemplate(value: unknown): ReportTemplate {
  return typeof value === "string" && IDS.has(value as ReportTemplate)
    ? (value as ReportTemplate)
    : "editorial";
}

/** The root class the stylesheet hangs off. */
export function templateClass(t: ReportTemplate): string {
  return `tpl-${t}`;
}
