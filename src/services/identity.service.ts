import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { userRepo } from "../repositories";
import type { User } from "../repositories/user.repository";
import type { AuthPrincipal } from "../auth";

export type ResolvedUser = { user: User; created: boolean };

/**
 * Map a verified auth identity to our domain `users` profile — the single place
 * provider identity becomes a domain principal, keeping everything downstream
 * provider-agnostic (ADR-0019).
 *
 * 1. Linked already → return that profile.
 * 2. A profile exists for this email (e.g. created by a prior auth method) →
 *    link it to this subject and return it. Provider-side account linking
 *    (ADR-0017) only fires for verified emails, so this stays one-account-per-email.
 * 3. Otherwise create a fresh profile bound to the subject.
 *
 * `created` tells the caller whether branch 3 fired, so a welcome email can be
 * sent exactly once, after the enclosing transaction commits — never from
 * inside this function, since every caller wraps it in one (see auth/emails.ts
 * callers) and an email side effect has no place inside a DB transaction.
 */
export async function resolveUser(
  principal: AuthPrincipal,
  tx: Executor = db
): Promise<ResolvedUser> {
  const linked = await userRepo.findByAuthSubjectId(principal.subjectId, tx);
  if (linked) return { user: linked, created: false };

  const byEmail = await userRepo.findActiveByEmail(principal.email, tx);
  if (byEmail) {
    const user = (await userRepo.linkAuthSubject(byEmail.id, principal.subjectId, tx)) ?? byEmail;
    return { user, created: false };
  }

  const user = await userRepo.createUser(
    {
      email: principal.email,
      name: principal.name ?? principal.email.split("@")[0] ?? "Thrivo user",
      authSubjectId: principal.subjectId,
    },
    tx
  );
  return { user, created: true };
}
