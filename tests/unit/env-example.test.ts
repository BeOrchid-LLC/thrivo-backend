import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractSchemaKeys, findMissingKeys } from "../../scripts/check-env-example";

const ROOT = path.join(__dirname, "..", "..");
const ENV_TS = path.join(ROOT, "src", "env.ts");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");

describe("check-env-example (I25)", () => {
  it("finds zero missing keys between the real env.ts and .env.example", () => {
    const envTsSource = readFileSync(ENV_TS, "utf8");
    const envExampleSource = readFileSync(ENV_EXAMPLE, "utf8");
    expect(findMissingKeys(envTsSource, envExampleSource)).toEqual([]);
  });

  it("flags a planted schema key missing from .env.example", () => {
    const envTsSource = `export const envSchema = z.object({\n    SOME_NEW_VAR: z.string(),\n  });\n`;
    const envExampleSource = "OTHER_VAR=\n";
    expect(findMissingKeys(envTsSource, envExampleSource)).toEqual(["SOME_NEW_VAR"]);
  });

  it("does not flag a key present but commented out in .env.example", () => {
    const envTsSource = `export const envSchema = z.object({\n    STRIPE_SECRET_KEY: z.string(),\n  });\n`;
    const envExampleSource = "# STRIPE_SECRET_KEY=              # A5 — billing fallback\n";
    expect(findMissingKeys(envTsSource, envExampleSource)).toEqual([]);
  });

  it("sanity check: real env.ts still yields a non-trivial key list (guards against a bad scan silently matching zero keys)", () => {
    const envTsSource = readFileSync(ENV_TS, "utf8");
    expect(extractSchemaKeys(envTsSource).length).toBeGreaterThan(20);
  });
});
