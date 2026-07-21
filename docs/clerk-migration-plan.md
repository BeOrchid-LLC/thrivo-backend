# Clerk Auth Migration — Full System Plan

Replaces the hand-rolled auth system (magic-link, OTP, Google OAuth, Apple Sign In) with Clerk across the entire Thrivo fleet. Motivated by BeOrchid's need for a shared user identity across all products.

**Status as of 2026-07-20:**
- Phase 0: Manual Clerk setup → ⏳ TODO (see `docs/clerk-phase2-prereqs.md`)
- Phase 1: Backend (thrivo-backend) → ✅ **Done** (commit `0715aba` on staging)
- Phase 2: Mobile (thrivo-mobile) → ⏳ TODO
- Phase 3: Admin (thrivo-admin) → 🔲 Deferred (separate auth, not migrating now)

---

## Architecture Decisions (Already Settled)

| Decision | Choice | Reason |
|---|---|---|
| Clerk tenant model | Single application, all BeOrchid products | Multi-app creates separate user pools — wrong for shared identity |
| Backend integration | `@clerk/backend verifyToken()` in `src/auth/index.ts` | No `@clerk/hono` package; ADR-0019 seam means one function swap |
| Mobile integration | `@clerk/clerk-expo` with custom UI | App has polished branded screens; Clerk headless hooks give full control |
| JWT claims | `email`, `email_verified`, `name` in session token template | Avoids per-request Clerk API calls |
| User provisioning | Webhook `user.created` + inline `resolveUser()` fallback | Idempotent; handles webhook race condition |
| Welcome email | Our webhook handler | Keeps existing Resend templates and branding |
| Biometric unlock | `expo-secure-store` with `requireAuthentication: true` as Clerk token cache | OS-level security replaces navigation-layer biometric gate |
| Admin auth | Not migrating | Admin uses separate httpOnly cookie + own JWT issuer; out of scope |

---

## Phase 0: Clerk Tenant Setup (Manual)

**Who:** You, in the Clerk dashboard. No code changes.

See `docs/clerk-phase2-prereqs.md` for the full checklist.

Key steps:
1. Create Clerk application
2. Enable Email OTP + Google OAuth + Apple Sign In
3. Update default session JWT template with `email`, `email_verified`, `name` claims
4. Register webhook endpoint at `https://api.thrivo.fit/api/v1/webhooks/clerk`
5. Copy `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET` into Coolify

---

## Phase 1: Backend (Done ✅)

**Repo:** thrivo-backend · **Commit:** `0715aba` on staging

### What changed

**Core swap (ADR-0019 seam):**
- `src/auth/index.ts` — `verifyRequest()` now calls `@clerk/backend verifyToken()`. JWT claims map to `AuthPrincipal`. Domain code (identity service, middleware, all controllers) unchanged.
- `src/middleware/auth.ts` — Added inline `resolveUser()` fallback for webhook race: valid Clerk JWT + no domain user → provision on demand.

**Webhook handler:**
- `src/services/clerk-webhook.service.ts` (new) — handles `user.created/updated/deleted` with svix signature verification.
- `POST /api/v1/webhooks/clerk` — mounted in the existing webhooks router (alongside RevenueCat).

**Dead code removed:**
- All hand-rolled auth: magic-link, OTP, Google OAuth, Apple Sign In services, session service, token issuance, auth router/controller.
- Dead repositories: `account`, `auth-identity`, `session`, `verification` repos emptied, removed from barrel.
- `src/lib/crypto.ts` (new) — `randomToken` + `sha256Hex` extracted from deleted `auth/crypto.ts`; still needed by admin token service.

**Database:**
- Migration `0034_clerk_drop_auth_tables.sql` — drops `auth_user`, `session`, `account`, `verification`.
- `users.auth_subject_id` stays — now holds Clerk `user_xxxx` IDs instead of hand-rolled IDs.

**Env vars:**
- Added: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`
- Removed: `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `APP_AUTH_REDIRECT_URL`, `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET`
- Kept: `AUTH_SECRET` (still used by admin auth JWT signing)

### Known gaps (from Phase 1)

- `admin-user.repository.ts → hardDeleteUser()` — no longer calls Clerk API to delete the Clerk user when an admin hard-deletes a domain user. Flagged as a follow-up task.

---

## Phase 2: Mobile (thrivo-mobile)

**Prereq:** Phase 0 complete (Clerk tenant configured, keys collected).

### 2a. Install dependencies

```bash
cd thrivo-mobile
npx expo install @clerk/clerk-expo @clerk/types
```

### 2b. Add env var

`thrivo-mobile/src/config/env.ts`:

```typescript
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
```

Remove (now managed by Clerk):
```typescript
// EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
// EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
// EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
```

### 2c. Wrap app in ClerkProvider

`thrivo-mobile/app/_layout.tsx`:

```tsx
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import * as SecureStore from "expo-secure-store";
import { env } from "@/config/env";

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key, { requireAuthentication: true });
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value, { requireAuthentication: true });
  },
  async clearToken(key: string) {
    return SecureStore.deleteItemAsync(key);
  },
};

// Wrap root layout:
<ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache}>
  {/* rest of layout */}
</ClerkProvider>
```

The `requireAuthentication: true` option in secure-store is the biometric gate — replaces the existing navigation-layer biometric unlock. The OS prompts biometric before any token read.

### 2d. Rewire auth screens

All existing screens keep their UI. Only the hook implementations change.

**WelcomeScreen** (`src/features/auth/screens/WelcomeScreen.tsx`):
- "Sign in with Google" → `useOAuth({ strategy: "oauth_google" }).startOAuthFlow()`
- "Sign in with Apple" → `useOAuth({ strategy: "oauth_apple" }).startOAuthFlow()`
- Email button → unchanged (still navigates to email screen)

**OtpRequestScreen** (new user path):
```tsx
const { signUp } = useSignUp();

async function handleSubmit(firstName: string, email: string) {
  await signUp.create({ emailAddress: email, firstName });
  await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
  router.push("/(auth)/otp");
}
```

**SignInScreen** (returning user path):
```tsx
const { signIn } = useSignIn();

async function handleSubmit(email: string) {
  await signIn.create({ identifier: email });
  await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId: signIn.supportedFirstFactors[0].emailAddressId });
  router.push("/(auth)/otp");
}
```

**OtpVerifyScreen**:
```tsx
const { signIn, setActive: setSignInActive } = useSignIn();
const { signUp, setActive: setSignUpActive } = useSignUp();

async function handleVerify(code: string) {
  if (signIn.status === "needs_first_factor") {
    const result = await signIn.attemptFirstFactor({ strategy: "email_code", code });
    if (result.status === "complete") {
      await setSignInActive({ session: result.createdSessionId });
    }
  } else {
    const result = await signUp.attemptEmailAddressVerification({ code });
    if (result.status === "complete") {
      await setSignUpActive({ session: result.createdSessionId });
    }
  }
  // Load domain profile after sign-in
  const user = await getMe();
  queryClient.setQueryData(queryKeys.me(), user);
  setSession({ userId: user.id, accountStatus: user.accountStatus, isOnboarded: user.isOnboarded, isOnboardingSkipped: user.isOnboardingSkipped });
}
```

### 2e. Rewire API client token injection

`src/api/auth-token.ts` — replace the `setTokenGetter` injection with a Clerk-backed getter:

```typescript
import { useAuth } from "@clerk/clerk-expo";

// In a hook or provider that has access to the Clerk context:
export function useWireClerkToken() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);
}
```

Alternatively (simpler): call `getToken()` directly inside `callApi` by exposing it through the seam. Clerk handles expiry and refresh automatically — remove the manual 401→refresh→retry logic from `src/api/client.ts`.

### 2f. Simplify session store

`src/stores/session.store.ts`:

- Remove `token` field — Clerk owns it
- Remove `status: AuthStatus` field — derive from Clerk instead:

```typescript
// In a component/hook:
const { isLoaded, isSignedIn } = useAuth();
const status = !isLoaded ? "loading" : isSignedIn ? "authenticated" : "unauthenticated";
```

- Keep: `userId`, `accountStatus`, `isOnboarded`, `isOnboardingSkipped` (domain state from `GET /users/me`)

### 2g. Replace useSessionInit

`src/hooks/useSessionInit.ts` — replace the manual token-read + `/auth/session` poll:

```typescript
export function useSessionInit() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { setSession, clearSession } = useSessionActions();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { clearSession(); return; }

    // Load domain profile when Clerk session is active
    getMe().then((user) => {
      queryClient.setQueryData(queryKeys.me(), user);
      setSession({ userId: user.id, accountStatus: user.accountStatus, isOnboarded: user.isOnboarded, isOnboardingSkipped: user.isOnboardingSkipped });
    });
  }, [isLoaded, isSignedIn, userId]);
}
```

### 2h. Logout

```typescript
const { signOut } = useAuth();

async function handleLogout() {
  await signOut();
  clearSession();
  queryClient.clear();
  analytics.reset();
}
```

No refresh-token POST to `/auth/logout` needed — Clerk manages session revocation.

### 2i. Remove dead mobile auth code

After the above wiring is confirmed working:
- `src/features/auth/api/auth.api.ts` — delete (all auth flows now go through Clerk)
- `src/lib/auth-refresh.ts` — delete (Clerk handles refresh)
- `src/lib/secure-store.ts` — review/simplify (Clerk's token cache replaces manual token storage; may still be needed for non-auth keys)
- `src/api/auth-token.ts` — simplify (remove manual refresh seam, keep `setUnauthenticatedHandler` for domain-state cleanup)

### 2j. EAS build

`@clerk/clerk-expo` includes native modules — OTA update is not sufficient.

```bash
# Dev build (for testing on physical device)
eas build --profile development --platform android
eas build --profile development --platform ios

# After testing, preview build for internal distribution
eas build --profile preview --platform all
```

### 2k. Verification

- Email sign-up: enter name + email → receive 6-digit code → verify → lands on onboarding
- Email sign-in: enter email → receive code → verify → lands on dashboard
- Google OAuth: tap button → consent → redirect back → authenticated
- Apple Sign In (iOS device only): tap → Face ID/Touch ID → authenticated
- Logout: clears session, redirects to welcome
- Token refresh: Clerk auto-refreshes — next API call after expiry still returns 200
- Cold start: kill app → reopen → Clerk restores session → biometric prompt → dashboard
- Biometric: if device has Face ID/fingerprint, token read triggers system prompt

---

## Phase 3: Admin (thrivo-admin) — Deferred

The admin app uses a completely separate auth system:
- Login: email+password or email OTP
- Session: httpOnly cookie (no bearer token)
- JWT: own issuer (`thrivo-admin`) and audience (`thrivo-admin-panel`) with `AUTH_SECRET`
- Endpoints: `/api/v1/admin/auth/*` — entirely separate from `/api/v1/auth/*`

**No changes planned.** Admin auth is unaffected by the Clerk migration. It could be migrated to Clerk Organizations in a future phase, but that's a separate decision.

---

## Phase 4: User Migration Script (if needed)

If staging has users whose `auth_subject_id` still holds hand-rolled IDs (not Clerk `user_xxxx` IDs), a migration script is needed. Write it at `thrivo-backend/scripts/migrate-users-to-clerk.ts`:

```typescript
// Pseudocode:
const users = await db.select().from(usersTable).where(
  sql`auth_subject_id IS NOT NULL AND auth_subject_id NOT LIKE 'user_%'`
);

for (const u of users) {
  // Check if already exists in Clerk by email
  const existing = await clerkClient.users.getUserList({ emailAddress: [u.email] });
  let clerkUser = existing.data[0];

  if (!clerkUser) {
    clerkUser = await clerkClient.users.createUser({
      emailAddress: [u.email],
      firstName: u.name?.split(" ")[0],
      lastName: u.name?.split(" ").slice(1).join(" ") || undefined,
      skipPasswordChecks: true,
    });
  }

  await db.update(usersTable)
    .set({ authSubjectId: clerkUser.id })
    .where(eq(usersTable.id, u.id));
}
```

For a clean staging environment (no real users), skip this script entirely.

---

## Resuming on Another Machine

```bash
# Clone (if not already)
git clone <thrivo-backend-url> && cd thrivo-backend
git checkout staging
npm install

# Create .env from .env.example, then fill in:
# - CLERK_SECRET_KEY (from Clerk dashboard)
# - CLERK_PUBLISHABLE_KEY (from Clerk dashboard)
# - CLERK_WEBHOOK_SECRET (from Clerk dashboard → Webhooks → your endpoint)
# - DATABASE_URL, REDIS_URL, AUTH_SECRET (from Coolify / existing secrets)

# Apply migrations (includes 0034 that drops auth tables)
npm run db:migrate

# Start dev server
npm run dev

# Verify Clerk JWT works (swap <token> with a real Clerk session token):
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/v1/users/me
```

For Phase 2 (mobile):
```bash
cd thrivo-mobile
git checkout staging
npm install

# Create .env from .env.example, then add:
# EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...

# Build dev client (required — native modules)
eas build --profile development --platform android

# Start Metro
npx expo start
```

---

## Key Files Reference

| File | Purpose |
|---|---|
| `thrivo-backend/src/auth/index.ts` | ADR-0019 seam — `verifyRequest()` calls Clerk `verifyToken()` |
| `thrivo-backend/src/auth/types.ts` | `AuthPrincipal` type — provider-neutral, unchanged |
| `thrivo-backend/src/services/identity.service.ts` | `resolveUser()` — maps Clerk userId to domain user, unchanged |
| `thrivo-backend/src/services/clerk-webhook.service.ts` | Webhook event handlers (user.created/updated/deleted) |
| `thrivo-backend/src/middleware/auth.ts` | Global auth middleware with inline resolveUser() fallback |
| `thrivo-backend/db/migrations/0034_clerk_drop_auth_tables.sql` | Drops the 4 dead auth tables |
| `thrivo-mobile/src/features/auth/` | All auth screens, hooks, API — Phase 2 target |
| `thrivo-mobile/src/stores/session.store.ts` | Zustand store — Phase 2 simplifies this |
| `thrivo-mobile/src/hooks/useSessionInit.ts` | Session restore — Phase 2 replaces with Clerk state |
| `thrivo-mobile/src/api/client.ts` | API client — Phase 2 swaps token getter to Clerk |
| `thrivo-backend/docs/clerk-phase2-prereqs.md` | Manual Clerk dashboard checklist before Phase 2 |
