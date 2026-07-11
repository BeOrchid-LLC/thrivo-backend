/**
 * R4-1 (I10 / ADR-0023) CI guard: every `timestamp(` column definition under
 * `db/schema/` must carry `withTimezone: true`. A timezone-naive timestamp on
 * an auth/session table is exactly the bug this phase fixed (I10) — this stops
 * it recurring the next time a schema file is hand-edited or regenerated.
 *
 * Pure `findViolations` is exported so the unit test can plant a violation
 * without touching real schema files; `run()` is what CI actually invokes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "schema");

export interface Violation {
  file: string;
  line: number;
  snippet: string;
}

/** Slice the balanced-paren call starting at the `(` right after `timestamp`. */
function extractCall(source: string, openParenIdx: number): string {
  let depth = 0;
  for (let i = openParenIdx; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(openParenIdx, i + 1);
    }
  }
  return source.slice(openParenIdx);
}

/** Scan one schema file's source for `timestamp(...)` calls missing `withTimezone: true`. */
export function findViolations(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const callRegex = /\btimestamp\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(source))) {
    const openParenIdx = match.index + match[0].length - 1;
    const call = extractCall(source, openParenIdx);
    if (!/withTimezone\s*:\s*true/.test(call)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push({ file, line, snippet: call.replace(/\s+/g, " ").trim() });
    }
  }
  return violations;
}

export function checkDir(dir: string): Violation[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  return files.flatMap((f) => findViolations(f, readFileSync(path.join(dir, f), "utf8")));
}

function run(): void {
  const violations = checkDir(SCHEMA_DIR);
  if (violations.length > 0) {
    console.error("Timezone-naive timestamp column(s) found in db/schema/ (ADR-0023):\n");
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} — ${v.snippet}`);
    }
    console.error(
      '\nEvery timestamp column must be declared as timestamp("col", { withTimezone: true }).'
    );
    process.exit(1);
  }
  console.log("OK — every db/schema/ timestamp column is timezone-aware.");
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
