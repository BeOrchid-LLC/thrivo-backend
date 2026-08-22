/**
 * Provider-neutral authenticated principal. This is what the app sees — never a
 * provider-specific type. `subjectId` is the stable external identity id our
 * domain `users.auth_subject_id` links to. Swapping providers means re-mapping
 * into this shape inside `src/auth/`, nothing more (ADR-0019; the seam that let
 * BetterAuth be swapped out for the hand-rolled `jose` provider in ADR-0026).
 */
export type AuthPrincipal = {
  subjectId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  /** Clerk fva claim: minutes since first-factor and second-factor verification. */
  factorVerificationAge?: readonly [number, number] | null;
  reverificationId?: string;
};

/**
 * Principal for the BeOrchid Admin Clerk application. Extends AuthPrincipal with
 * a `role` claim sourced from `public_metadata.role` in the Admin Clerk JWT template.
 */
export type AdminClerkPrincipal = AuthPrincipal & { role?: string };
