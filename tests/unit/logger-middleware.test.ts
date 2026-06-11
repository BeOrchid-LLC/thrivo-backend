import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../src/types/http";

// Hoisted spies so the module mock (hoisted above imports) can close over them.
const { info, warn, error, child } = vi.hoisted(() => {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const child = vi.fn(() => ({ info, warn, error }));
  return { info, warn, error, child };
});

vi.mock("../../src/lib/logger", () => ({ logger: { child } }));

import { requestId } from "../../src/middleware/request-id";
import { requestLogger } from "../../src/middleware/logger";

function app() {
  const a = new Hono<AppEnv>();
  a.use(requestId);
  a.use(requestLogger);
  a.get("/ok", (c) => c.json({ ok: true }));
  a.get("/missing", (c) => c.json({ error: true }, 404));
  a.get("/boom", (c) => c.json({ error: true }, 500));
  return a;
}

describe("request-logger middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binds a child logger to the correlation id and logs once on finish", async () => {
    await app().request("/ok");

    expect(child).toHaveBeenCalledWith({ requestId: expect.any(String) });
    expect(info).toHaveBeenCalledTimes(1);
    const [fields, msg] = info.mock.calls[0];
    expect(msg).toBe("request");
    expect(fields).toMatchObject({ method: "GET", path: "/ok", status: 200 });
    expect(fields.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("logs 4xx at warn and 5xx at error", async () => {
    await app().request("/missing");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ status: 404 });

    vi.clearAllMocks();
    await app().request("/boom");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatchObject({ status: 500 });
  });
});
