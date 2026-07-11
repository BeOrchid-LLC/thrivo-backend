import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDir, findViolations } from "../../scripts/check-schema-timestamps";

const SCHEMA_DIR = path.join(__dirname, "..", "..", "db", "schema");

describe("check-schema-timestamps (I10 / ADR-0023)", () => {
  it("finds zero violations across the real db/schema/ files", () => {
    expect(checkDir(SCHEMA_DIR)).toEqual([]);
  });

  it("flags a planted timezone-naive timestamp column", () => {
    const source = `export const t = pgTable("t", {\n  bad: timestamp("bad_col").notNull(),\n});\n`;
    const violations = findViolations("planted.ts", source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].snippet).toContain('"bad_col"');
  });

  it("does not flag a compliant withTimezone column, including multi-line calls", () => {
    const source = `export const t = pgTable("t", {\n  good: timestamp("good_col", {\n    withTimezone: true,\n  }).notNull(),\n});\n`;
    expect(findViolations("compliant.ts", source)).toHaveLength(0);
  });

  it("flags one violation per bad column when multiple are present", () => {
    const source = [
      'a: timestamp("a"),',
      'b: timestamp("b", { withTimezone: true }),',
      'c: timestamp("c"),',
    ].join("\n");
    const violations = findViolations("mixed.ts", source);
    expect(violations.map((v) => v.snippet)).toEqual([
      expect.stringContaining('"a"'),
      expect.stringContaining('"c"'),
    ]);
  });

  it("sanity check: every schema file still parses as readable UTF-8 (guards against a bad scan silently matching zero files)", () => {
    const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files)
      expect(() => readFileSync(path.join(SCHEMA_DIR, f), "utf8")).not.toThrow();
  });
});
