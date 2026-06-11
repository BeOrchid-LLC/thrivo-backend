/**
 * Provider-neutral authenticated principal. This is what the app sees — never a
 * BetterAuth type. `subjectId` is the stable external identity id our domain
 * `users.auth_subject_id` links to. Swapping providers means re-mapping into
 * this shape inside `src/auth/`, nothing more (ADR-0019).
 */
export type AuthPrincipal = {
  subjectId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
};
