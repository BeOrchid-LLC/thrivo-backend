/**
 * R6 (I25) CI guard: every top-level key in `src/env.ts`'s `envSchema` must
 * also appear in `.env.example`, so a new env var never ships undocumented
 * (the standing env-example rule — new var and `.env.example` change land
 * together).
 *
 * Pure `findMissingKeys` is exported so the unit test can plant a violation
 * without touching the real files; `run()` is what CI actually invokes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_TS = path.join(ROOT, "src", "env.ts");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");

/** Extract every top-level `KEY: z...` schema key from envSchema's object literal source. */
export function extractSchemaKeys(source: string): string[] {
  const keyRegex = /^\s{4}([A-Z][A-Z0-9_]*):\s/gm;
  const keys: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = keyRegex.exec(source))) {
    keys.push(match[1]);
  }
  return keys;
}

/** Extract every `KEY=` (commented or not) from a .env.example source. */
export function extractExampleKeys(source: string): string[] {
  const keyRegex = /^#?\s*([A-Z][A-Z0-9_]*)=/gm;
  const keys: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = keyRegex.exec(source))) {
    keys.push(match[1]);
  }
  return keys;
}

/** Keys defined in envSchema but missing from .env.example (commented-out counts as present). */
export function findMissingKeys(envTsSource: string, envExampleSource: string): string[] {
  const schemaKeys = new Set(extractSchemaKeys(envTsSource));
  const exampleKeys = new Set(extractExampleKeys(envExampleSource));
  return [...schemaKeys].filter((k) => !exampleKeys.has(k));
}

function run(): void {
  const envTsSource = readFileSync(ENV_TS, "utf8");
  const envExampleSource = readFileSync(ENV_EXAMPLE, "utf8");
  const missing = findMissingKeys(envTsSource, envExampleSource);
  if (missing.length > 0) {
    console.error("env.ts defines keys missing from .env.example:\n");
    for (const key of missing) {
      console.error(`  - ${key}`);
    }
    console.error("\nAdd each one to .env.example (the standing env-example rule).");
    process.exit(1);
  }
  console.log("OK — .env.example is a superset of every env.ts key.");
}

const isMain = (() => {
  try {
    return (
      process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
})();

if (isMain) run();
