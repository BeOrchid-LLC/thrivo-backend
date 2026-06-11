import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requestId, REQUEST_ID_HEADER } from "../../src/middleware/request-id";
import type { AppEnv } from "../../src/types/http";

function appWithRequestId() {
  const app = new Hono<AppEnv>();
  app.use(requestId);
  app.get("/", (c) => c.json({ requestId: c.var.requestId }));
  return app;
}

describe("request-id middleware", () => {
  it("mints a UUIDv7 when no inbound header is present", async () => {
    const res = await appWithRequestId().request("/");
    const body = (await res.json()) as { requestId: string };

    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    // The minted id is echoed back to the caller.
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(body.requestId);
  });

  it("carries a valid inbound id through unchanged", async () => {
    const inbound = "edge-req-0001abcd";
    const res = await appWithRequestId().request("/", {
      headers: { [REQUEST_ID_HEADER]: inbound },
    });
    const body = (await res.json()) as { requestId: string };

    expect(body.requestId).toBe(inbound);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(inbound);
  });

  it("rejects an out-of-charset inbound id and mints instead", async () => {
    const hostile = "contains spaces & $ymbols!"; // header-legal but off-charset
    const res = await appWithRequestId().request("/", {
      headers: { [REQUEST_ID_HEADER]: hostile },
    });
    const body = (await res.json()) as { requestId: string };

    expect(body.requestId).not.toBe(hostile);
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
