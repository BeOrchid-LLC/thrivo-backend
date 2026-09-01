import { createClerkClient } from "@clerk/backend";
import { Webhook } from "svix";
import { z } from "zod";
import { env } from "../env";
import { adminAccountRepo, adminAuditLogRepo, webhookEventRepo } from "../repositories";
import { db } from "../../db";
import { logger } from "../lib/logger";
import { ForbiddenError } from "../lib/errors";
import type { AdminRole } from "../admin/otp.service";
import { adminPermissionsSchema } from "../../contracts/src/admin-management";
import { invalidateAdminSnapshot } from "../admin/snapshot.service";

interface ClerkEmailAddress {
  email_address: string;
  verification?: { status: string } | null;
}

interface ClerkAdminUserCreatedData {
  id: string;
  email_addresses: ClerkEmailAddress[];
  first_name: string | null;
  last_name: string | null;
  public_metadata?: { role?: string } | null;
}

interface ClerkAdminUserUpdatedData {
  id: string;
  email_addresses: ClerkEmailAddress[];
  first_name: string | null;
  last_name: string | null;
  public_metadata?: { role?: string; permissions?: unknown } | null;
}

interface ClerkAdminUserDeletedData {
  id: string;
  deleted: boolean;
}

interface ClerkAdminWebhookEvent {
  type: string;
  data: unknown;
  timestamp?: number;
}

const clerkAdminSessionCreatedDataSchema = z
  .object({
    id: z.string().min(1),
    user_id: z.string().min(1),
    created_at: z.number().int().positive().optional(),
  })
  .passthrough();

/** Verify the svix signature using the Admin Clerk webhook secret. Throws ForbiddenError on bad sig. */
export function parseAdminClerkWebhook(
  body: string,
  headers: Record<string, string>
): ClerkAdminWebhookEvent {
  const wh = new Webhook(env.CLERK_ADMIN_WEBHOOK_SECRET);
  try {
    return wh.verify(body, headers) as ClerkAdminWebhookEvent;
  } catch {
    throw new ForbiddenError("Invalid admin webhook signature");
  }
}

function primaryEmail(addresses: ClerkEmailAddress[]): string {
  const verified = addresses.find((a) => a.verification?.status === "verified");
  const addr = verified ?? addresses[0];
  if (!addr) throw new Error("Clerk admin user has no email address");
  return addr.email_address;
}

function fullName(first: string | null, last: string | null): string | null {
  const parts = [first, last].filter(Boolean).join(" ");
  return parts || null;
}

const clerk = createClerkClient({ secretKey: env.CLERK_ADMIN_SECRET_KEY });

function resolveRole(raw: string | undefined): AdminRole {
  if (raw === "super-admin" || raw === "admin" || raw === "support" || raw === "read-only") {
    return raw;
  }
  return "admin";
}

/**
 * user.created from the Admin Clerk app: find or create an admin_users row and
 * link the Clerk Admin ID. If a row already exists for the email (pre-Clerk admin
 * created via invite), link it and activate it. Role is sourced from
 * public_metadata.role set in the Clerk dashboard; defaults to "admin".
 */
export async function handleAdminClerkUserCreated(data: ClerkAdminUserCreatedData): Promise<void> {
  const email = primaryEmail(data.email_addresses).toLowerCase();
  const name = fullName(data.first_name, data.last_name);
  const role = resolveRole(data.public_metadata?.role);

  const existing = await adminAccountRepo.findByEmail(email);

  if (existing) {
    await adminAccountRepo.linkClerkAdminId(existing.id, data.id);
    if (existing.status === "revoked") {
      logger.warn(
        { adminId: existing.id, clerkAdminId: data.id },
        "admin-clerk-webhook: ignored signup for revoked invitation"
      );
      return;
    }
    // The database invitation determines the account's access. Re-apply it to
    // Clerk so a dashboard default or stale invitation metadata cannot widen
    // the account during first sign-in.
    await clerk.users.updateUserMetadata(data.id, {
      publicMetadata: { role: existing.role, permissions: existing.permissions },
    });
    if (existing.status !== "active") {
      await adminAccountRepo.update(existing.id, { status: "active" });
      if (existing.status === "invited") {
        await adminAuditLogRepo.append({
          actorAdminEmail: "clerk-webhook",
          action: "admin.accept_invite",
          targetType: "admin",
          targetId: existing.id,
          before: { status: existing.status },
          after: { status: "active", clerkAdminId: data.id },
          requestId: null,
          ip: null,
        });
      }
    }
    logger.info(
      { adminId: existing.id, clerkAdminId: data.id },
      "admin-clerk-webhook: linked existing admin row to Clerk Admin ID"
    );
    await invalidateAdminSnapshot(existing.email);
    return;
  }

  // No pre-existing row — provision a new active admin.
  const row = await adminAccountRepo.upsertActiveNoPassword({ email, name, role });
  await adminAccountRepo.linkClerkAdminId(row.id, data.id);
  await clerk.users.updateUserMetadata(data.id, {
    publicMetadata: { role: row.role, permissions: row.permissions },
  });
  logger.info(
    { adminId: row.id, clerkAdminId: data.id, role },
    "admin-clerk-webhook: provisioned new admin from Clerk"
  );
}

/** user.updated: sync email and name. Role changes go through the Clerk dashboard
 * and are reflected in the JWT; the DB row is kept in sync for the admin management UI. */
export async function handleAdminClerkUserUpdated(data: ClerkAdminUserUpdatedData): Promise<void> {
  const existing = await adminAccountRepo.findByClerkAdminId(data.id);
  if (!existing) {
    // Not yet linked — treat as a late-arriving created event.
    await handleAdminClerkUserCreated(data as ClerkAdminUserCreatedData);
    return;
  }

  const email = primaryEmail(data.email_addresses).toLowerCase();
  const name = fullName(data.first_name, data.last_name);
  const metadataRole = data.public_metadata?.role;
  const nextRole = metadataRole ? resolveRole(metadataRole) : undefined;
  const permissionsResult = data.public_metadata?.permissions
    ? adminPermissionsSchema.safeParse(data.public_metadata.permissions)
    : null;
  const nextPermissions = permissionsResult?.success ? permissionsResult.data : undefined;
  const roleChanged = nextRole !== undefined && nextRole !== existing.role;

  if (roleChanged && existing.role === "super-admin" && existing.status === "active") {
    const remaining = await adminAccountRepo.countActiveSuperAdmins(existing.id);
    if (remaining === 0 && nextRole !== "super-admin") {
      await clerk.users.updateUserMetadata(data.id, {
        publicMetadata: { role: "super-admin", permissions: existing.permissions },
      });
      logger.error(
        { adminId: existing.id, clerkAdminId: data.id },
        "admin-clerk-webhook: rejected demotion of the last active super-admin"
      );
      return;
    }
  }

  const patch = {
    ...(name ? { name } : {}),
    ...(nextRole !== undefined ? { role: nextRole } : {}),
    ...(nextPermissions !== undefined ? { permissions: nextPermissions } : {}),
  };
  if (Object.keys(patch).length > 0) {
    await db.transaction(async (tx) => {
      const updated = await adminAccountRepo.update(existing.id, patch, tx);
      if (roleChanged || nextPermissions !== undefined) {
        await adminAuditLogRepo.append(
          {
            actorAdminEmail: "clerk-webhook",
            action: "admin.identity_sync",
            targetType: "admin",
            targetId: existing.id,
            before: {
              role: existing.role,
              permissions: existing.permissions,
            },
            after: {
              role: updated.role,
              permissions: updated.permissions,
            },
            requestId: null,
            ip: null,
          },
          tx
        );
      }
    });
    await invalidateAdminSnapshot(existing.email);
  }

  // Email change: update only if it actually changed (citext handles case).
  if (email !== existing.email.toLowerCase()) {
    logger.warn(
      { adminId: existing.id, oldEmail: existing.email, newEmail: email },
      "admin-clerk-webhook: admin email changed — update admin_users manually if needed"
    );
  }
}

/** user.deleted: disable the admin account. The row is kept for audit purposes. */
export async function handleAdminClerkUserDeleted(data: ClerkAdminUserDeletedData): Promise<void> {
  if (!data.deleted) return;
  const existing = await adminAccountRepo.findByClerkAdminId(data.id);
  if (!existing) {
    logger.info(
      { clerkAdminId: data.id },
      "admin-clerk-webhook: user.deleted for unknown admin — no-op"
    );
    return;
  }
  await adminAccountRepo.update(existing.id, { status: "disabled" });
  await invalidateAdminSnapshot(existing.email);
  logger.info(
    { adminId: existing.id, clerkAdminId: data.id },
    "admin-clerk-webhook: admin account disabled"
  );
}

async function handleAdminClerkSessionCreated(
  data: unknown,
  eventId: string | undefined,
  eventTimestamp: number | undefined
): Promise<string> {
  if (!eventId) {
    logger.warn("admin-clerk-webhook: session.created missing Svix event ID");
    return "ignored";
  }

  const session = clerkAdminSessionCreatedDataSchema.parse(data);
  let ledger = await webhookEventRepo.recordReceived({
    provider: "clerk_admin",
    eventId,
    payload: {
      type: "session.created",
      data: { id: session.id, user_id: session.user_id },
      timestamp: eventTimestamp ?? null,
    },
  });
  if (!ledger) {
    const existing = await webhookEventRepo.findByProviderEvent("clerk_admin", eventId);
    if (existing?.status === "processed") return "duplicate";
    ledger = existing;
  }
  if (!ledger) return "duplicate";

  let account = await adminAccountRepo.findByClerkAdminId(session.user_id);
  if (!account) {
    // Clerk can deliver session.created before user.created. Resolve the user
    // once through the Admin Clerk API so a pre-existing invited/admin row can
    // still receive accurate login telemetry when the events arrive out of order.
    const clerkUser = await clerk.users.getUser(session.user_id).catch(() => null);
    const email =
      clerkUser?.primaryEmailAddress?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress;
    if (email) {
      account = await adminAccountRepo.findByEmail(email);
      if (account) await adminAccountRepo.linkClerkAdminId(account.id, session.user_id);
    }
  }
  if (!account || account.status !== "active") {
    await webhookEventRepo.markProcessed(ledger.id, "processed");
    logger.info(
      { clerkAdminId: session.user_id, eventId },
      "admin-clerk-webhook: session.created for unknown or inactive admin"
    );
    return "ignored";
  }

  const candidate = session.created_at ?? eventTimestamp;
  const parsedLoginAt = candidate === undefined ? null : new Date(candidate);
  const loginAt =
    parsedLoginAt && !Number.isNaN(parsedLoginAt.getTime()) ? parsedLoginAt : ledger.receivedAt;
  await db.transaction(async (tx) => {
    await adminAccountRepo.setLastLogin(account.id, loginAt, tx);
    await adminAuditLogRepo.append(
      {
        actorAdminEmail: account.email,
        action: "admin.login",
        targetType: "admin",
        targetId: account.id,
        requestId: null,
        ip: null,
      },
      tx
    );
    await webhookEventRepo.markProcessed(ledger!.id, "processed", tx);
  });
  return "processed";
}

export async function handleAdminClerkWebhookEvent(
  event: ClerkAdminWebhookEvent,
  eventId?: string
): Promise<string> {
  switch (event.type) {
    case "user.created":
      await handleAdminClerkUserCreated(event.data as ClerkAdminUserCreatedData);
      return "created";

    case "user.updated":
      await handleAdminClerkUserUpdated(event.data as ClerkAdminUserUpdatedData);
      return "updated";

    case "user.deleted":
      await handleAdminClerkUserDeleted(event.data as ClerkAdminUserDeletedData);
      return "deleted";

    case "session.created":
      return handleAdminClerkSessionCreated(event.data, eventId, event.timestamp);

    default:
      logger.debug({ type: event.type }, "admin-clerk-webhook: unhandled event type");
      return "ignored";
  }
}
