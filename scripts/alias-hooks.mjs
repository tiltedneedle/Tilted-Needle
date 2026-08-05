// Node resolution hook: maps the app's "@/x" bundler alias onto src/x so
// real modules (dashboards, performanceData, scoring) run under
// --experimental-strip-types without a bundler.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = join(SRC, specifier.slice(2));
    for (const candidate of [base, base + ".ts", base + ".tsx", join(base, "index.ts")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
