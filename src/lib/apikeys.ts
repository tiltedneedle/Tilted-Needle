import { randomBytes, createHash } from "node:crypto";

/** tn_live_<40 hex chars>. The prefix is what a user sees again after creation. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = randomBytes(24).toString("hex");
  const key = `tn_live_${raw}`;
  const prefix = key.slice(0, 14);
  const hash = createHash("sha256").update(key).digest("hex");
  return { key, prefix, hash };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
