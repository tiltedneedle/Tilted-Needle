/**
 * Shapes and windows for the two leaderboard cards.
 *
 * Deliberately free of imports so a CLIENT component can read LEADER_WINDOWS
 * without dragging the server-only builder into the browser bundle -- which is
 * exactly what happened when they lived in one file: a value import of
 * LEADER_WINDOWS pulled cachedContentData, and Turbopack refused the build.
 *
 * The builder lives in buildLeaderboards.ts.
 *
 * Two rankings rather than one, because they answer different questions and
 * conflating them is how a "top performer" list becomes a verdict on a person.
 * Credits are VOLUME: how many videos someone worked on. Views are REACH: how
 * far that work travelled. Someone can lead one and not the other, and that
 * gap is usually the interesting thing on the card.
 */

export type LeaderWindow = "7d" | "30d" | "90d" | "all";

export const LEADER_WINDOWS: { key: LeaderWindow; label: string; days: number | null }[] = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "all", label: "All", days: null },
];

export type LeaderRow = {
  userId: string;
  name: string;
  videos: number;
  views: number;
};

export type Leaderboards = Record<LeaderWindow, { credits: LeaderRow[]; views: LeaderRow[] }>;
