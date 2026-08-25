import type { Context } from "hono";
import { updateGlobalSettingsPayloadSchema } from "../../contracts/src/settings";
import { respondOk } from "../lib/response";
import { getClientIp } from "../lib/request-ip";
import { getValidatedInput } from "../middleware/validate";
import { getGlobalSettings } from "../services/settings.service";
import * as adminAuditLogRepo from "../repositories/admin-audit-log.repository";
import type { AppEnv } from "../types/http";
import { settingsRepo } from "../repositories";
import { db } from "../../db";

function actor(c: Context<AppEnv>) {
  const admin = c.get("adminUser")!;
  return {
    actorAdminEmail: admin.email,
    requestId: c.get("requestId") ?? null,
    ip: getClientIp(c),
  };
}

export async function getAdminSettings(c: Context<AppEnv>) {
  return respondOk(c, { settings: await getGlobalSettings() });
}

export async function patchAdminSettings(c: Context<AppEnv>) {
  const patch = updateGlobalSettingsPayloadSchema.parse(getValidatedInput(c, "json"));
  const a = actor(c);
  const settings = await db.transaction(async (tx) => {
    const before =
      (await settingsRepo.getGlobalSettings(tx)) ?? (await settingsRepo.upsertGlobalDefaults(tx));
    const updated = await settingsRepo.updateGlobalSettings(patch, tx);
    await adminAuditLogRepo.append(
      {
        ...a,
        action: "settings.global_update",
        targetType: "global_settings",
        targetId: "default",
        before: patchKeys(before, patch),
        after: patchKeys(updated, patch),
      },
      tx
    );
    return updated;
  });
  return respondOk(c, { settings }, "Settings updated");
}

function patchKeys(source: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(patch).map((key) => [key, source[key]]));
}
