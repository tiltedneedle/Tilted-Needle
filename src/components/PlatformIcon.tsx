/**
 * A recognisable mark per platform, replacing the coloured dot.
 *
 * These are hand-authored inline SVGs rather than a brand-icon package, for
 * two reasons that are both hard constraints here:
 *
 *   - The app renders under a policy that forbids external requests, so a CDN
 *     sprite sheet or a remote logo URL is not an option. lucide-react is
 *     already a dependency but deliberately ships NO brand logos, so there was
 *     nothing to reach for.
 *   - Each is a simple geometric construction -- a rounded rectangle and a
 *     triangle, a rounded square with a circle in it -- drawn to be identifiable
 *     at 14-16px, not a pixel copy of anyone's trademarked artwork.
 *
 * `currentColor` throughout, so a caller can tint the mark (the brand colour by
 * default, or muted inside a chip) without a second copy of the path existing
 * anywhere.
 *
 * This is also the registry YouTube Shorts extends when it becomes its own
 * platform: Shorts needs to read as YouTube-but-vertical at a glance, which is
 * why it reuses the play triangle inside a portrait frame rather than getting
 * an unrelated mark.
 */
import { PLATFORM_COLORS } from "@/lib/types";

type Props = {
  platform: string;
  size?: number;
  className?: string;
  /** Override the brand colour, e.g. to inherit a muted chip's colour. */
  color?: string;
};

export default function PlatformIcon({ platform, size = 16, className, color }: Props) {
  const tint = color ?? PLATFORM_COLORS[platform] ?? "var(--muted)";
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    className: `shrink-0 ${className ?? ""}`,
    style: { color: tint },
    "aria-hidden": true as const,
    focusable: "false" as const,
  };

  switch (platform) {
    case "youtube":
      return (
        <svg {...common} fill="currentColor">
          <path d="M23 12s0-3.9-.5-5.8a3 3 0 0 0-2.1-2.1C18.5 3.5 12 3.5 12 3.5s-6.5 0-8.4.6A3 3 0 0 0 1.5 6.2C1 8.1 1 12 1 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 8.4.6 8.4.6s6.5 0 8.4-.6a3 3 0 0 0 2.1-2.1C23 15.9 23 12 23 12Z" />
          {/* The play triangle is punched out, so the mark stays legible on
              both the light and dark surfaces this sits on. */}
          <path d="M9.9 15.5V8.5L15.9 12l-6 3.5Z" fill="var(--panel)" />
        </svg>
      );

    case "youtube_shorts":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.8}>
          {/* Portrait frame: the whole point of Shorts is the aspect ratio,
              so that is what distinguishes it from the YouTube mark. */}
          <rect x="6.5" y="2.5" width="11" height="19" rx="4.5" />
          <path d="M10.6 15.2V8.8L15.4 12l-4.8 3.2Z" fill="currentColor" stroke="none" />
        </svg>
      );

    case "instagram":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.8}>
          <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.4" />
          <circle cx="12" cy="12" r="4.1" />
          <circle cx="17.4" cy="6.6" r="1.15" fill="currentColor" stroke="none" />
        </svg>
      );

    case "tiktok":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.8}>
          {/* A quaver: stem, note head, and the flag reaching up-right. */}
          <path
            d="M13.6 3v11.2a3.9 3.9 0 1 1-3.9-3.9c.36 0 .71.05 1.04.15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M13.6 3c.55 2.5 2.5 4.4 5 4.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    default:
      // An unknown platform still gets a mark rather than a blank gap, so a
      // new slug never silently renders as nothing.
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.8}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10.4 15.2V8.8L15.2 12l-4.8 3.2Z" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
