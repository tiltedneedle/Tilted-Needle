/**
 * What to show when a video has no caption.
 *
 * 41 of 286 live videos are titled "Untitled", and it is not a bug we can fix
 * upstream: the platforms genuinely returned an empty caption, and none of
 * those rows carry a description either. There is no text to recover.
 *
 * So this is a DISPLAY concern, deliberately, and nothing here writes to the
 * database. Stamping a generated title onto the row would fabricate a caption
 * the creator never wrote, and would destroy the one true fact we have -- that
 * this video has no caption yet -- so that a later real title could never be
 * told apart from a synthesised one.
 *
 * The rule the label has to satisfy: make a row identifiable in a list where
 * forty of its neighbours say the same word. Client, date and platform are all
 * already on the row, so repeating them adds nothing. The post's own id is the
 * only unique thing we hold, and it is also what appears in the post's URL --
 * so it is the one label that lets somebody match a row to the real post.
 */

/** Titles the platforms hand back when there was nothing to hand back. */
const EMPTY_TITLES = new Set(["untitled", "untitled video", "no caption", "-", "—"]);

export function isPlaceholderTitle(title: string | null | undefined): boolean {
  const t = String(title ?? "").trim();
  if (!t) return true;
  return EMPTY_TITLES.has(t.toLowerCase());
}

/**
 * Shortened post id.
 *
 * Instagram shortcodes are 11 characters and readable; TikTok ids are 19-digit
 * snowflakes where the leading digits are a timestamp shared by everything
 * posted the same week. Taking the TAIL of a long numeric id keeps the part
 * that actually differs between two posts.
 */
export function shortCode(code: string | null | undefined): string | null {
  const c = String(code ?? "").trim();
  if (!c) return null;
  if (c.length <= 12) return c;
  return /^\d+$/.test(c) ? c.slice(-7) : c.slice(0, 11);
}

export type VideoLabel = {
  /** What to render. */
  text: string;
  /** True when this is a stand-in, so callers can style it as a gap. */
  isPlaceholder: boolean;
};

export function videoLabel(video: {
  title?: string | null;
  postCode?: string | null;
}): VideoLabel {
  if (!isPlaceholderTitle(video.title)) {
    return { text: String(video.title).trim(), isPlaceholder: false };
  }
  const code = shortCode(video.postCode);
  // "No caption" rather than "Untitled": it says WHY the row is blank, which
  // makes it read as a fact about the post rather than a name someone chose.
  return { text: code ? `No caption · ${code}` : "No caption", isPlaceholder: true };
}
