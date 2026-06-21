import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, bearer, magicLink } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { db } from "../../db";
import { env } from "../env";
import * as authSchema from "../../db/schema/auth";
import { sendAuthMagicLink, sendAuthOtp } from "./emails";

// A provider is configured only when its full credential pair is present, so dev
// and CI boot without OAuth secrets (ADR-0017 external lead time).
const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}
if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
  socialProviders.apple = {
    clientId: env.APPLE_CLIENT_ID,
    clientSecret: env.APPLE_CLIENT_SECRET,
  };
}

/**
 * The configured BetterAuth instance. This file (and `index.ts`) are the ONLY
 * place `better-auth` is imported — everything else depends on the neutral
 * `AuthPrincipal` + `verifyRequest` from `./index`, so swapping providers is a
 * change here, not across the codebase (ADR-0019).
 */
export const auth = betterAuth({
  baseURL: env.AUTH_BASE_URL,
  basePath: "/api/v1/auth",
  secret: env.BETTER_AUTH_SECRET,
  // Origins accepted as a post-flow `callbackURL`. `baseURL` is trusted implicitly;
  // this adds the web/admin origins and the mobile app scheme (deep-link return).
  trustedOrigins: env.AUTH_TRUSTED_ORIGINS,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  // Auth identity is provider-owned; our domain `users` table links by
  // `auth_subject_id`. The auth identity table is named `auth_user` to avoid
  // confusion with the domain `users` table.
  user: { modelName: "auth_user" },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  socialProviders,
  account: {
    // ADR-0017: one account per verified email; auto-link only verified providers.
    accountLinking: { enabled: true, trustedProviders: ["google", "apple"] },
  },
  plugins: [
    // Enables the Expo client: handles the native app scheme (thrivo://) as an
    // OAuth callback target and the bearer-token handoff back to the mobile app.
    expo(),
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      sendVerificationOTP: ({ email, otp, type }) => sendAuthOtp(email, otp, type),
    }),
    magicLink({
      expiresIn: 900,
      sendMagicLink: ({ email, url, token, metadata }) =>
        sendAuthMagicLink(email, url, token, metadata),
    }),
    bearer(), // mobile bearer tokens alongside the web cookie
  ],
});
