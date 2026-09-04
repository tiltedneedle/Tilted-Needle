/**
 * The cached view of Apify usage, for page renders only.
 *
 * Split from apifyUsage.ts because that module is imported by the worker,
 * which runs outside Next: importing next/cache there fails outright with
 * ERR_MODULE_NOT_FOUND. The reader stays runtime-agnostic; only this wrapper
 * knows about Next.
 */
import { unstable_cache } from "next/cache";
import { readApifyUsage } from "@/lib/apifyUsage";

/* ---- Cached, because this is a live call on a page render ----------------
   /data is opened repeatedly while someone watches a sync, and each open
   would otherwise make two HTTP calls per account against a provider that
   rate-limits. Five minutes is far finer than the thing being measured -- a
   monthly budget moves in cents per day -- and the cache is keyed by version
   so a shape change cannot serve a stale payload the way content-raw-v1 did.

   `unstable_cache` and not `revalidate` on the page: this is one widget on a
   page whose other reads must stay live. */

export const cachedApifyUsage = unstable_cache(
  async () => readApifyUsage(),
  ["apify-usage-v1"],
  { revalidate: 300, tags: ["apify-usage"] },
);
