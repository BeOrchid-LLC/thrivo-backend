import { describe, expect, it } from "vitest";
import {
  cmToIn,
  cupsToMl,
  inToCm,
  kgToLb,
  lbToKg,
  mlToCups,
  round,
  roundMacroG,
  toNumeric1,
} from "../../src/lib/units";

describe("units", () => {
  it("round-trips kg <-> lb", () => {
    expect(round(kgToLb(lbToKg(150)), 4)).toBe(150);
  });

  it("converts cm <-> in", () => {
    expect(round(inToCm(10), 1)).toBe(25.4);
    expect(round(cmToIn(25.4), 1)).toBe(10);
  });

  it("converts cups <-> ml", () => {
    expect(cupsToMl(1)).toBe(240);
    expect(mlToCups(240)).toBe(1);
  });

  it("rounds without the 1.005 float error", () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(roundMacroG(12.34)).toBe(12.3);
  });

  it("coerces to numeric(5,1)-safe strings", () => {
    expect(toNumeric1(72)).toBe("72.0");
    expect(toNumeric1(72.349)).toBe("72.3");
  });
});
