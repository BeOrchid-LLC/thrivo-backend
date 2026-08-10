import { Webhook } from "svix";
import { env } from "../env";
import { userRepo } from "../repositories";
import { resolveUser } from "./identity.service";
import { sendWelcomeEmail } from "../auth/emails";
import { logger } from "../lib/logger";
import { ForbiddenError } from "../lib/errors";
import type { AuthPrincipal } from "../auth";
import { db } from "../../db";

// Minimal shapes for the Clerk webhook payloads we handle. Clerk sends far more
// fields; we only destructure what we need so the rest is safely ignored.
interface ClerkEmailAddress {
  id: string;
  email_address: string;
  verification?: { status: string } | null;
}

interface ClerkUserCreatedData {
  id: string;
  primary_email_address_id: string | null;
  email_addresses: ClerkEmailAddress[];
  first_name: string | null;
  last_name: string | null;
}

interface ClerkUserUpdatedData {
  id: string;
  primary_email_address_id: string | null;
  email_addresses: ClerkEmailAddress[];
  first_name: string | null;
  last_name: string | null;
}

interface ClerkUserDeletedData {
  id: string;
  deleted: boolean;
}

interface ClerkWebhookEvent {
  type: string;
  data: unknown;
}

/** Verify the svix signature and parse the Clerk webhook payload. Throws ForbiddenError on bad sig. */
export function parseClerkWebhook(
  body: string,
  headers: Record<string, string>
): ClerkWebhookEvent {
  const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);
  try {
    return wh.verify(body, headers) as ClerkWebhookEvent;
  } catch {
    throw new ForbiddenError("Invalid webhook signature");
  }
}

/** Resolve Clerk's declared primary address and preserve its real verification state. */
function primaryEmail(
  primaryEmailAddressId: string | null,
  addresses: ClerkEmailAddress[]
): { email: string; verified: boolean } {
  const addr = primaryEmailAddressId
    ? addresses.find((candidate) => candidate.id === primaryEmailAddressId)
    : addresses[0];
  if (!addr) throw new Error("Clerk user has no email address");
  return { email: addr.email_address, verified: addr.verification?.status === "verified" };
}

function fullName(first: string | null, last: string | null): string | undefined {
  const parts = [first, last].filter(Boolean).join(" ");
  return parts || undefined;
}

export async function handleClerkUserCreated(data: ClerkUserCreatedData): Promise<void> {
  const primary = primaryEmail(data.primary_email_address_id, data.email_addresses);
  const name = fullName(data.first_name, data.last_name);

  const principal: AuthPrincipal = {
    subjectId: data.id,
    email: primary.email,
    emailVerified: primary.verified,
    name,
  };

  await db.transaction(async (tx) => {
    const { user, created } = await resolveUser(principal, tx);
    if (created && primary.verified) await sendWelcomeEmail(user.email, user.id, tx);
  });
}

export async function handleClerkUserUpdated(data: ClerkUserUpdatedData): Promise<void> {
  const existing = await userRepo.findByAuthSubjectId(data.id);
  if (!existing) {
    // User doesn't exist in our domain yet — provision it.
    await handleClerkUserCreated(data);
    return;
  }

  const primary = primaryEmail(data.primary_email_address_id, data.email_addresses);
  const name = fullName(data.first_name, data.last_name);

  await db.transaction(async (tx) => {
    const updated = await userRepo.updateProfile(
      existing.id,
      { email: primary.email, emailVerified: primary.verified, ...(name ? { name } : {}) },
      tx
    );
    if (updated && !existing.emailVerified && primary.verified) {
      await sendWelcomeEmail(updated.email, updated.id, tx);
    }
  });
}

export async function handleClerkUserDeleted(data: ClerkUserDeletedData): Promise<void> {
  if (!data.deleted) return;
  const existing = await userRepo.findByAuthSubjectId(data.id);
  if (!existing) {
    logger.info(
      { clerkUserId: data.id },
      "clerk-webhook: user.deleted for unknown subject — no-op"
    );
    return;
  }
  await userRepo.softDeleteUser(existing.id);
}

export async function handleClerkWebhookEvent(event: ClerkWebhookEvent): Promise<string> {
  switch (event.type) {
    case "user.created":
      await handleClerkUserCreated(event.data as ClerkUserCreatedData);
      return "created";

    case "user.updated":
      await handleClerkUserUpdated(event.data as ClerkUserUpdatedData);
      return "updated";

    case "user.deleted":
      await handleClerkUserDeleted(event.data as ClerkUserDeletedData);
      return "deleted";

    default:
      logger.debug({ type: event.type }, "clerk-webhook: unhandled event type");
      return "ignored";
  }
}
