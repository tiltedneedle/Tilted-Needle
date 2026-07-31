/**
 * The editor kit's vocabulary.
 *
 * These are the things an editor reaches for on every single video for a
 * client -- the CTA wording, the outro sting, the logo, the arrow graphics --
 * which until now lived in Drive folders and DMs and had to be asked for.
 *
 * The list is deliberately longer than what any one client uses. A kind with
 * nothing in it costs a line in a dropdown; a missing kind means someone
 * files their SFX pack under "other" and the next editor never finds it.
 *
 * `kind` is a free-text column in the database rather than an enum, so adding
 * an entry here is the whole change -- no migration, and rows using a kind
 * that was later renamed still render (see kindLabel's fallback).
 */
export type AssetKind = {
  slug: string;
  label: string;
  /** Grouping for the kit's layout -- the order these appear on the page. */
  group: "Brand" | "On-screen" | "Sound" | "Footage" | "Reference";
};

export const ASSET_KINDS: AssetKind[] = [
  { slug: "logo", label: "Logo", group: "Brand" },
  { slug: "font", label: "Font", group: "Brand" },
  { slug: "colour", label: "Colour", group: "Brand" },
  { slug: "watermark", label: "Watermark", group: "Brand" },

  { slug: "cta", label: "CTA", group: "On-screen" },
  { slug: "outro", label: "Outro", group: "On-screen" },
  { slug: "hook", label: "Hook", group: "On-screen" },
  { slug: "lower_third", label: "Lower third", group: "On-screen" },
  { slug: "arrow", label: "Arrows & pointers", group: "On-screen" },
  { slug: "subtitle", label: "Subtitle style", group: "On-screen" },
  { slug: "endcard", label: "End card", group: "On-screen" },
  { slug: "thumbnail", label: "Thumbnail", group: "On-screen" },

  { slug: "sfx", label: "SFX", group: "Sound" },
  { slug: "music", label: "Music", group: "Sound" },
  { slug: "transition", label: "Transition", group: "Sound" },

  { slug: "broll", label: "B-roll", group: "Footage" },

  { slug: "template", label: "Template", group: "Reference" },
  { slug: "other", label: "Other", group: "Reference" },
];

export const ASSET_GROUPS: AssetKind["group"][] = [
  "Brand",
  "On-screen",
  "Sound",
  "Footage",
  "Reference",
];

const BY_SLUG = new Map(ASSET_KINDS.map((k) => [k.slug, k]));

/** Unknown slugs render as themselves rather than disappearing. */
export function kindLabel(slug: string): string {
  return BY_SLUG.get(slug)?.label ?? slug.replace(/_/g, " ");
}

export function kindGroup(slug: string): AssetKind["group"] {
  return BY_SLUG.get(slug)?.group ?? "Reference";
}

/** A stable accent per group, so the kit reads as sections at a glance. */
export const GROUP_COLOR: Record<AssetKind["group"], string> = {
  Brand: "#d9563a",
  "On-screen": "#4a6fd8",
  Sound: "#7c5cd6",
  Footage: "#2e8f62",
  Reference: "#5c6b82",
};
