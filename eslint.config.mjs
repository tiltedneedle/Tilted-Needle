import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Session worktrees are OTHER checkouts of this repo, at other commits.
    // Linting them reports errors that were already fixed on main (or not yet
    // made there), against files no edit here can touch -- six phantom errors
    // appeared this way the first time a worktree existed during a lint run.
    ".claude/**",
  ]),
]);

export default eslintConfig;
