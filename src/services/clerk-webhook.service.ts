import { Webhook } from "svix";
import { env } from "../env";
import { userRepo } from "../repositories";
import { resolveUser } from "./identity.service";
import { sendWelcomeEmail } from "../auth/emails";
import { logger } from "../lib/logger";
import { ForbiddenError } from "../lib/errors";
import type { AuthPrincipal } from "../auth";

// Minimal shapes for the Clerk webhook payloads we handle. Clerk sends far more
// fields; we only destructure what we need so the rest is safely ignored.
interface ClerkEmailAddress {
  email_address: string;
  verification?: { status: string } | null;
}

interface ClerkUserCreatedData {
  id: string;
  email_addresses: ClerkEmailAddress[];
  first_name: string | null;
  last_name: string | null;
}

interface ClerkUserUpdatedData {
  id: string;
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

/** Primary email from Clerk's email_addresses array (first verified, else first). */
function primaryEmail(addresses: ClerkEmailAddress[]): string {
  const verified = addresses.find((a) => a.verification?.status === "verified");
  const addr = verified ?? addresses[0];
  if (!addr) throw new Error("Clerk user has no email address");
  return addr.email_address;
}

function fullName(first: string | null, last: string | null): string | undefined {
  const parts = [first, last].filter(Boolean).join(" ");
  return parts || undefined;
}

export async function handleClerkUserCreated(data: ClerkUserCreatedData): Promise<void> {
  const email = primaryEmail(data.email_addresses);
  const name = fullName(data.first_name, data.last_name);

  const principal: AuthPrincipal = {
    subjectId: data.id,
    email,
    emailVerified: true,
    name,
  };

  const { user, created } = await resolveUser(principal);

  if (created) {
    // Fire-and-forget: email failure must never break webhook delivery.
    sendWelcomeEmail(user.email, user.id).catch((err) =>
      logger.warn({ err, userId: user.id }, "clerk-webhook: welcome email failed")
    );
  }
}

export async function handleClerkUserUpdated(data: ClerkUserUpdatedData): Promise<void> {
  const existing = await userRepo.findByAuthSubjectId(data.id);
  if (!existing) {
    // User doesn't exist in our domain yet — provision it.
    await handleClerkUserCreated(data);
    return;
  }

  const email = primaryEmail(data.email_addresses);
  const name = fullName(data.first_name, data.last_name);

  await userRepo.updateProfile(existing.id, { email, ...(name ? { name } : {}) });
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
