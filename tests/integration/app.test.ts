import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { NotFoundError } from "../../src/lib/errors";
import { REQUEST_ID_HEADER } from "../../src/middleware/request-id";

// App-level wiring through the real middleware pipeline (request-id → logger →
// error boundary). No DB/Redis needed: /health does no I/O and the error routes
// throw before touching anything, so this runs in the default unit pass.
function testApp() {
  const app = buildApp();
  // Routes mounted only for the test exercise the shared onError boundary.
  app.get("/__app-error", () => {
    throw new NotFoundError("nope");
  });
  app.get("/__boom", () => {
    throw new Error("kaboom");
  });
  return app;
}

describe("app pipeline", () => {
  it("serves liveness with build + uptime and echoes a minted request id", async () => {
    const res = await testApp().request("/health");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      version: string;
      uptimeSeconds: number;
      timestamp: string;
    };
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof body.timestamp).toBe("string");
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  it("carries an inbound request id onto the response", async () => {
    const res = await testApp().request("/health", {
      headers: { [REQUEST_ID_HEADER]: "test-req-12345678" },
    });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("test-req-12345678");
  });

  it("maps an AppError to its status + stable code", async () => {
    const res = await testApp().request("/__app-error");
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("nope");
  });

  it("maps an unknown error to a 500 carrying the request id", async () => {
    const res = await testApp().request("/__boom", {
      headers: { [REQUEST_ID_HEADER]: "trace-me-87654321" },
    });
    expect(res.status).toBe(500);

    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.requestId).toBe("trace-me-87654321");
  });
});
