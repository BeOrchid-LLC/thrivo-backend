import { describe, expect, it, vi } from "vitest";
import { respondOk } from "../../src/lib/response";
import type { Context } from "hono";
import type { AppEnv } from "../../src/types/http";

function mockContext() {
  const jsonSpy = vi.fn();
  return { c: { json: jsonSpy } as unknown as Context<AppEnv>, jsonSpy };
}

describe("respondOk", () => {
  it("returns the v0.5.0 success envelope with defaults", () => {
    const { c, jsonSpy } = mockContext();
    respondOk(c, { id: 1 });
    expect(jsonSpy).toHaveBeenCalledWith(
      { success: true, data: { id: 1 }, responseCode: 200, message: "Success" },
      200
    );
  });

  it("stamps custom message and status into the body and HTTP response", () => {
    const { c, jsonSpy } = mockContext();
    respondOk(c, null, "OTP sent", 202);
    expect(jsonSpy).toHaveBeenCalledWith(
      { success: true, data: null, responseCode: 202, message: "OTP sent" },
      202
    );
  });
});
