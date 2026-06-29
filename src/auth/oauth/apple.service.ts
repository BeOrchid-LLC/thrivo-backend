import { db } from "../../../db";
import { newId } from "../../lib/ids";
import { env } from "../../env";
import { UnauthorizedError } from "../../lib/errors";
import { accountRepo, authIdentityRepo } from "../../repositories";
import {
  issueSession,
  principalOf,
  type IssuedTokens,
  type SessionContext,
} from "../session.service";
import { resolveUser } from "../../services/identity.service";
import { verifyAppleIdentityToken } from "./apple.client";

const PROVIDER = "apple";

/** Apple is usable only when the audience (client/bundle id) is configured. */
export function isAppleConfigured(): boolean {
  return Boolean(env.APPLE_CLIENT_ID);
}

/**
 * Complete native Sign in with Apple: verify the identity token, then resolve the
 * account. Apple only returns an email on the *first* authorization, so after that
 * we resolve the existing identity via the linked account (provider + subject).
 * A first-time sign-in without an email cannot be provisioned and is rejected.
 *
 * The display name is supplied by the client only on first authorization (Apple
 * never re-sends it); it seeds the identity name when we create it.
 */
export async function completeAppleSignIn(
  identityToken: string,
  name: string | undefined,
  ctx: SessionContext = {}
): Promise<IssuedTokens> {
  const claims = await verifyAppleIdentityToken(identityToken);

  return db.transaction(async (tx) => {
    const linked = await accountRepo.findByProvider(PROVIDER, claims.sub, tx);
    if (linked) {
      const identity = await authIdentityRepo.findById(linked.userId, tx);
      if (!identity) throw new UnauthorizedError("Linked Apple account is no longer valid");
      await resolveUser(principalOf(identity), tx);
      return issueSession(principalOf(identity), ctx, tx);
    }

    if (!claims.email) {
      // No prior link and Apple withheld the email — nothing to provision against.
      throw new UnauthorizedError("Apple sign-in did not provide an email to create an account");
    }

    const identity = await authIdentityRepo.upsertByEmail(
      {
        email: claims.email,
        name: name?.trim() || claims.email.split("@")[0] || "Thrivo user",
        emailVerified: claims.emailVerified,
        image: null,
      },
      tx
    );

    await accountRepo.create(
      { id: newId(), providerId: PROVIDER, accountId: claims.sub, userId: identity.id, idToken: identityToken },
      tx
    );

    await resolveUser(principalOf(identity), tx);
    return issueSession(principalOf(identity), ctx, tx);
  });
}
