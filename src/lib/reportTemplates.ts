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
 */

export type ReportTemplate = "editorial" | "bold" | "minimal" | "luxury";

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
    id: "minimal",
    name: "Minimal",
    blurb: "Swiss grid, one accent, nothing decorative. The numbers are the design.",
  },
  {
    id: "luxury",
    name: "Luxury",
    blurb: "Ink and champagne, wide tracking, ceremonial cover. For the jeweller and the jet broker.",
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
