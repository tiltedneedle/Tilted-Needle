// Tests for the daily-brief parser, run against the EXACT message the
// feature was requested with -- if the parser can't read the real sheet,
// passing on synthetic ones is worthless.
//   npm run test:todo-parse
import { parseBrief, parseDateLine, buildAliasIndex } from "../src/lib/todoParse.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (ok) pass++; else fail++;
};

// The real workspace roster and client list, as the page passes them in.
const members = [
  { userId: "u-scheyr", name: "Scheyr" },
  { userId: "u-hassan", name: "Hassan Warsi" },
  { userId: "u-ghufran", name: "Ghufran" },
  { userId: "u-usama", name: "Usama" },
  { userId: "u-ahmed", name: "Malik Ahmed Sher Awan" },
  { userId: "u-dua", name: "Dua" },
  { userId: "u-milad", name: "Milad" },
];
const clients = [
  { id: "c-ameerh", name: "Ameerh Naran" },
  { id: "c-alex", name: "Alex Evagora" },
  { id: "c-eed", name: "EuroEyes Deutschland" },
  { id: "c-lec", name: "Euro Eyes London (LEC)" },
  { id: "c-tjb", name: "The Jet Business" },
  { id: "c-tn", name: "Tilted Needle" },
  { id: "c-entree", name: "Entree Bakery and Cafe" },
];
const aliasExtras = { EEH: "EuroEyes Deutschland" };

const BRIEF = `
MONDAY 3rd August

Scheyr
Ameerh revs x2
Alex DITL vo?
New Ameerh video?
RY: What gross tonnage actually means

Hassan
Ameerh rev
EEH: Misconception on Laser Correction
TN Throwing Paint on Lambo BTS
RY: The difference between a yacht, superyacht and megayacht
TN: Lauryna gets advice from Steve VO

Ghufran
RY: Possible Not Possible w/ Mohammed - rev
RY: Shark Tank Story
TJB rev: Real buyer or time waster
LEC: Contact lens vs laser eye surgery

Usama
Ameerh mykonos vlog

Ahmed Sher
EEH: Advanced Technology - VISUMAX 800
LEC: Patient Testimony Westfield Clinic
EEH: Why Some People Get Lenses Instead of Lasers

Dua
DRD: 21/07 Sales vlog at aviation event
DRD: 31.07.26 L D2D 2
DRD: 31.07.26 L D2D 3
`;

const res = parseBrief(BRIEF, { members, clients, aliasExtras, year: 2026 });

check("date line resolves to 2026-08-03", res.date === "2026-08-03", res.date);

// 20 written task lines, one of which (revs x2) doubles -> 21 tasks.
check("every task line parsed", res.tasks.length === 21, `got ${res.tasks.length}`);

const byPerson = new Map();
for (const t of res.tasks) {
  byPerson.set(t.personName, (byPerson.get(t.personName) ?? 0) + 1);
}
check("Scheyr has 5 tasks (x2 expanded)", byPerson.get("Scheyr") === 5, `got ${byPerson.get("Scheyr")}`);
check("Hassan matched to full name", byPerson.get("Hassan Warsi") === 5);
check("Ahmed Sher matched inside 'Malik Ahmed Sher Awan'", byPerson.get("Malik Ahmed Sher Awan") === 3);
check("Dua has 3 tasks", byPerson.get("Dua") === 3);
check("no task fell outside a person block", res.tasks.every((t) => t.userId !== null));

const scheyr = res.tasks.filter((t) => t.personName === "Scheyr");
check("x2 produced two numbered revisions",
  scheyr[0].description === "revisions (1 of 2)" && scheyr[1].description === "revisions (2 of 2)",
  scheyr.map((t) => t.description).slice(0, 2).join(" | "));
check("x2 tasks carry the client", scheyr[0].clientName === "Ameerh Naran");
check("'Alex DITL vo?' is tentative, client Alex, shorthand expanded",
  scheyr[2].tentative === true && scheyr[2].clientName === "Alex Evagora" &&
  scheyr[2].description === "day in the life voiceover",
  scheyr[2].description);
check("'New Ameerh video?' tags the client from mid-line",
  scheyr[3].clientName === "Ameerh Naran" && scheyr[3].tentative === true);

const hassan = res.tasks.filter((t) => t.personName === "Hassan Warsi");
check("EEH alias (seeded) hits EuroEyes Deutschland", hassan[1].clientName === "EuroEyes Deutschland");
check("TN without colon still resolves", hassan[2].clientName === "Tilted Needle");
check("BTS expands", hassan[2].description.includes("behind the scenes"), hassan[2].description);
check("trailing VO expands", hassan[4].description.endsWith("voiceover"), hassan[4].description);

const ghufran = res.tasks.filter((t) => t.personName === "Ghufran");
check("TJB initials derive from 'The Jet Business'", ghufran[2].clientName === "The Jet Business");
check("LEC parenthesised alias resolves", ghufran[3].clientName === "Euro Eyes London (LEC)");
check("'- rev' inside a title expands", ghufran[0].description.includes("revision"), ghufran[0].description);

check("unknown aliases (RY, DRD) stay unassigned rather than guessed",
  res.tasks.filter((t) => t.clientId === null).every((t) => /^(RY|DRD):/.test(t.raw)) &&
  res.tasks.filter((t) => t.clientId === null).length === 7);
check("each unknown-client line produced a warning",
  res.warnings.filter((w) => w.startsWith("No client recognised")).length === 7);

// Date-line variants.
check("date without weekday parses", parseDateLine("3rd August", 2026) === "2026-08-03");
check("'August 3' order parses", parseDateLine("August 3", 2026) === "2026-08-03");
check("a non-date line does not parse", parseDateLine("Scheyr", 2026) === null);

// Alias index safety: one client's initials must never shadow another's name.
const idx = buildAliasIndex(clients, aliasExtras);
check("full names beat derived aliases", idx.get("tilted needle").id === "c-tn");
check("missing extras target is ignored gracefully",
  buildAliasIndex(clients, { XX: "No Such Client" }).get("xx") === undefined);

// A brief with no date line warns and returns null date.
const noDate = parseBrief("Scheyr\nAmeerh rev", { members, clients, year: 2026 });
check("no date -> null + warning", noDate.date === null &&
  noDate.warnings.some((w) => w.startsWith("No date line")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
