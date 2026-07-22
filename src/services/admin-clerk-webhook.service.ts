import { Webhook } from "svix";
import { env } from "../env";
import { adminAccountRepo } from "../repositories";
import { logger } from "../lib/logger";
import { ForbiddenError } from "../lib/errors";
import type { AdminRole } from "../admin/otp.service";

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
}

interface ClerkAdminUserDeletedData {
  id: string;
  deleted: boolean;
}

interface ClerkAdminWebhookEvent {
  type: string;
  data: unknown;
}

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
    if (existing.status !== "active") {
      await adminAccountRepo.update(existing.id, { status: "active" });
    }
    logger.info(
      { adminId: existing.id, clerkAdminId: data.id },
      "admin-clerk-webhook: linked existing admin row to Clerk Admin ID"
    );
    return;
  }

  // No pre-existing row — provision a new active admin.
  const row = await adminAccountRepo.upsertActiveNoPassword({ email, name, role });
  await adminAccountRepo.linkClerkAdminId(row.id, data.id);
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
  await adminAccountRepo.update(existing.id, { ...(name ? { name } : {}) });

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
  logger.info(
    { adminId: existing.id, clerkAdminId: data.id },
    "admin-clerk-webhook: admin account disabled"
  );
}

export async function handleAdminClerkWebhookEvent(event: ClerkAdminWebhookEvent): Promise<string> {
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

    default:
      logger.debug({ type: event.type }, "admin-clerk-webhook: unhandled event type");
      return "ignored";
  }
}
