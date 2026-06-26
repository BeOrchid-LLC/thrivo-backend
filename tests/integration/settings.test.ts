import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { settingsRepo, userRepo } from "../../src/repositories";
import { canSendPushNotification } from "../../src/services/settings.service";
import { authed, createSession } from "../helpers/auth";
import { closeDb, resetDb } from "../helpers/db";

const run = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!run)("integration: settings", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("returns default settings for the authenticated user", async () => {
    const app = buildApp();
    const session = await createSession();

    const res = await app.request("/api/v1/users/me/settings", { headers: authed(session) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { unitSystem: string; userId: string } };
    const user = await userRepo.findActiveByEmail(session.email);
    expect(body.data.userId).toBe(user?.id);
    expect(body.data.unitSystem).toBe("metric");
  });

  it("updates only the caller's settings", async () => {
    const app = buildApp();
    const a = await createSession();
    const b = await createSession();

    const res = await app.request("/api/v1/users/me/settings", {
      method: "PATCH",
      headers: { ...authed(a), "Content-Type": "application/json" },
      body: JSON.stringify({ unitSystem: "imperial", pushNotificationsEnabled: false }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { unitSystem: string } }).data.unitSystem).toBe(
      "imperial"
    );

    const other = await app.request("/api/v1/users/me/settings", { headers: authed(b) });
    expect(((await other.json()) as { data: { unitSystem: string } }).data.unitSystem).toBe("metric");
  });

  it("blocks notifications when global settings are disabled first", async () => {
    const session = await createSession();
    const user = await userRepo.findActiveByEmail(session.email);
    expect(user).not.toBeNull();

    await settingsRepo.updateUserSettings(user!.id, { pushNotificationsEnabled: true });
    await settingsRepo.updateGlobalSettings({ pushNotificationsEnabled: false });

    await expect(canSendPushNotification(user!.id, "daily_food_log")).resolves.toBe(false);
  });
});
