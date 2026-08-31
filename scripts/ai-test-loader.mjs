// Test-only ESM resolver hook for `node --test`. src/domain/ai/**/*.ts (like the rest of this
// repository) writes extensionless relative imports (e.g. "./contextPreparation") — valid under
// TypeScript/Metro resolution, but Node's own strict ESM resolver requires an explicit extension.
// This hook retries a failed relative-import resolution with a ".ts" suffix appended, so the
// existing source files can be exercised directly by Node's built-in test runner without a
// bundler, ts-node, or any new npm dependency. Registered via `--import` in the "test:ai" script
// (package.json) — never loaded by the app itself.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ai-test-resolve-hook.mjs", pathToFileURL(`${import.meta.dirname}/`));
