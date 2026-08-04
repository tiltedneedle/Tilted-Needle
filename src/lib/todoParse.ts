/**
 * Parser for the team's daily assignment brief -- the shorthand message a
 * manager pastes into the To-dos import box. Pure and dependency-free so it
 * can be tested directly under Node's native loader (same reasoning as
 * discoveryThrottle.ts / videoEmbed.ts).
 *
 * Deterministic rather than an LLM call: the format is rigid (a date line,
 * then person-name lines each followed by that person's task lines), and
 * every name it must recognise -- members, clients, aliases -- is already in
 * the workspace. Grounding a paid API in the same lists would add a key, a
 * bill, and a failure mode without adding understanding. An OCR/LLM step can
 * later feed this same function text from a screenshot.
 *
 * Nothing here writes anywhere. The output is a proposal the manager reviews
 * in a preview table -- person and client fixable per row -- before anything
 * is created. Unknown shorthand degrades to a flagged row, never a guess
 * committed silently.
 */

export type ParseMember = { userId: string; name: string };
export type ParseClient = { id: string; name: string };

export type ParsedTask = {
  /** The person block this line sat under; null when a line appeared before any. */
  userId: string | null;
  personName: string | null;
  clientId: string | null;
  clientName: string | null;
  description: string;
  /** Trailing "?" in the brief -- kept visible, not dropped. */
  tentative: boolean;
  /** The original line, so the preview can always show what was meant. */
  raw: string;
};

export type ParseResult = {
  /** ISO date if a date line was found, else null (caller supplies a default). */
  date: string | null;
  tasks: ParsedTask[];
  warnings: string[];
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "MONDAY 3rd August" / "3 August" / "August 3" -> ISO, using the given year. */
export function parseDateLine(line: string, year: number): string | null {
  const t = line.toLowerCase().replace(/,/g, " ");
  const m =
    t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/) ??
    (() => {
      const rev = t.match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
      return rev ? ([rev[0], rev[2], rev[1]] as RegExpMatchArray) : null;
    })();
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.findIndex((name) => name.startsWith(m[2]));
  if (month === -1 || day < 1 || day > 31) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

const STOPWORDS = new Set(["the", "a", "an", "and", "of", "for", "on", "in", "with"]);

/** Initials of a client name's significant words: "The Jet Business" -> tjb. */
function initialsOf(name: string): string {
  return norm(name)
    .split(" ")
    .filter((w) => w.length > 2 || w === "of")
    .map((w) => w[0])
    .join("");
}

type AliasIndex = Map<string, ParseClient>;

/**
 * Every way the team abbreviates a client, derived from the client list
 * itself: full name, each leading word, a parenthesised alias if the name
 * carries one ("Euro Eyes London (LEC)"), initials, plus any explicit extras.
 */
export function buildAliasIndex(
  clients: ParseClient[],
  extras: Record<string, string> = {},
): AliasIndex {
  const index: AliasIndex = new Map();
  const put = (alias: string, c: ParseClient) => {
    const key = norm(alias);
    // First writer wins: a full name must never be shadowed by another
    // client's derived initials.
    if (key && !index.has(key)) index.set(key, c);
  };
  for (const c of clients) put(c.name, c);
  for (const c of clients) {
    const paren = c.name.match(/\(([^)]+)\)/);
    if (paren) put(paren[1], c);
  }
  // First *significant* word: "The Jet Business" must alias to "jet", never
  // to "the" -- a stopword alias would tag a client on any line containing it.
  for (const c of clients) {
    const first = norm(c.name).split(" ").find((w) => !STOPWORDS.has(w));
    if (first) put(first, c);
  }
  for (const c of clients) put(initialsOf(c.name), c);
  for (const [alias, clientName] of Object.entries(extras)) {
    const c = clients.find((x) => norm(x.name) === norm(clientName));
    if (c) index.set(norm(alias), c);
  }
  return index;
}

/** A line is a person header iff the whole line names a member. */
function matchMember(line: string, members: ParseMember[]): ParseMember | null {
  const tokens = norm(line).split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return null;
  for (const m of members) {
    const nameTokens = norm(m.name).split(" ");
    if (tokens.every((t) => nameTokens.includes(t))) return m;
  }
  return null;
}

/** Expands the sheet's standing shorthand without touching anything else. */
function expandShorthand(desc: string): string {
  return desc
    .replace(/\brevs\b/gi, "revisions")
    .replace(/\brev\b/gi, "revision")
    .replace(/\bvo\b/gi, "voiceover")
    .replace(/\bbts\b/gi, "behind the scenes")
    .replace(/\bditl\b/gi, "day in the life")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBrief(
  text: string,
  opts: {
    members: ParseMember[];
    clients: ParseClient[];
    aliasExtras?: Record<string, string>;
    year?: number;
  },
): ParseResult {
  const year = opts.year ?? new Date().getFullYear();
  const aliases = buildAliasIndex(opts.clients, opts.aliasExtras);
  const warnings: string[] = [];
  const tasks: ParsedTask[] = [];

  let date: string | null = null;
  let current: ParseMember | null = null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const raw of lines) {
    if (!date && !current) {
      const d = parseDateLine(raw, year);
      if (d) {
        date = d;
        continue;
      }
    }

    const member = matchMember(raw, opts.members);
    if (member) {
      current = member;
      continue;
    }

    // A task line. Client first: a leading "ALIAS:" wins, then a leading
    // alias without the colon, then any single token that is an alias.
    let clientHit: ParseClient | null = null;
    let rest = raw;

    const colon = raw.match(/^([^:]{1,40}):\s*(.+)$/);
    if (colon) {
      const c = aliases.get(norm(colon[1]));
      if (c) {
        clientHit = c;
        rest = colon[2];
      }
    }
    if (!clientHit) {
      const tokens = raw.split(/\s+/);
      // Longest leading phrase first, so "The Jet Business rev" beats "The".
      for (let n = Math.min(4, tokens.length - 1); n >= 1 && !clientHit; n--) {
        const c = aliases.get(norm(tokens.slice(0, n).join(" ")));
        if (c) {
          clientHit = c;
          rest = tokens.slice(n).join(" ");
        }
      }
      // Fallback: an alias anywhere in the line tags the client but keeps
      // the full wording ("New Ameerh video?"). Short or common words are
      // excluded -- a mid-title "the" or "l" must never look like a client.
      if (!clientHit) {
        for (const token of tokens) {
          const key = norm(token);
          if (key.length < 4 || STOPWORDS.has(key)) continue;
          const c = aliases.get(key);
          if (c) {
            clientHit = c;
            break;
          }
        }
      }
    }

    const tentative = /\?\s*$/.test(rest);
    let desc = expandShorthand(rest.replace(/\?\s*$/, "").trim());

    // "x2" -> two identical tasks; the sheet means two separate deliverables.
    let count = 1;
    const xN = desc.match(/\bx\s?(\d)\b/i);
    if (xN) {
      count = Math.min(5, Math.max(1, Number(xN[1])));
      desc = desc.replace(/\bx\s?\d\b/i, "").replace(/\s+/g, " ").trim();
    }
    if (!desc) desc = expandShorthand(raw);

    if (!current) warnings.push(`Line before any person heading: "${raw}"`);
    if (!clientHit) warnings.push(`No client recognised in: "${raw}"`);

    for (let i = 0; i < count; i++) {
      tasks.push({
        userId: current?.userId ?? null,
        personName: current?.name ?? null,
        clientId: clientHit?.id ?? null,
        clientName: clientHit?.name ?? null,
        description: count > 1 ? `${desc} (${i + 1} of ${count})` : desc,
        tentative,
        raw,
      });
    }
  }

  if (!date) warnings.push("No date line found — the sheet date below will be used.");
  return { date, tasks, warnings };
}
