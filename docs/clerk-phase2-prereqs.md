# Clerk Phase 2 Prerequisites

Before starting Phase 2 (mobile SDK integration), the following manual steps must be completed in the Clerk dashboard. None of these require code changes.

---

## Clerk Application Architecture

BeOrchid uses **two separate Clerk applications** with distinct purposes:

| Clerk Application | Purpose | Auth methods | Used by |
|---|---|---|---|
| **BeOrchid Consumer** | End-user identity across all BeOrchid products | OTP + Google + Apple (no password) | thrivo-mobile, thrivo-public, and future consumer apps |
| **BeOrchid Admin** | Internal dashboard access across all BeOrchid products | Email + password only | thrivo-admin and all future admin/dashboard apps |

Consumer users and admin users are **separate user pools** — an admin account cannot be used to access the mobile app and vice versa. This is intentional: consumer auth is passwordless by design, and admin auth requires stable credentials with password management.

On the backend, `thrivo-backend` verifies tokens from both instances using route-based middleware: `/api/v1/admin/*` routes verify against the BeOrchid Admin Clerk instance; all other routes verify against BeOrchid Consumer.

---

## Part A — BeOrchid Consumer Clerk Application

### A1. Create the Application

1. Sign in at [clerk.com](https://clerk.com) and open the BeOrchid organisation (or create it).
2. Create a new **Application** — name it `BeOrchid Consumer`.
3. Note the **Application ID** for reference.

> This application serves all future BeOrchid consumer products. A `user_xxxx` ID created here is portable across every consumer app in this Clerk tenant. Do **not** create a separate Clerk application per consumer product.

---

### A2. Configure Sign-In Methods

In the Clerk dashboard → **User & Authentication → Email, Phone, Username**:

- ✅ Enable **Email address** (required)
- ✅ Set email verification strategy to **Email verification code** (6-digit OTP)
- ❌ Disable email+password (all BeOrchid consumer products are passwordless)

In **Social Connections**:

- ✅ Enable **Google** — requires a Google Cloud OAuth client (Web application type). Redirect URI: `https://your-clerk-domain.clerk.accounts.dev/v1/oauth_callback`
- ✅ Enable **Apple** — requires an Apple Services ID + private key (mandatory for App Store per review guideline 4.8)

---

### A3. Configure the JWT Template

The backend's `verifyRequest()` reads `email`, `email_verified`, and `name` directly from the session JWT. Without this, those fields will be missing and every auth request will fail with a null principal.

In the Clerk dashboard → **Sessions → Customize session token** (or JWT Templates if the Sessions menu isn't available):

Add these claims to the default session token:

```json
{
  "email": "{{user.primary_email_address}}",
  "email_verified": "{{user.primary_email_address.verification.status == 'verified'}}",
  "name": "{{user.full_name}}"
}
```

---

### A4. Register the Consumer Webhook Endpoint

In the Clerk dashboard → **Webhooks**:

1. Click **Add Endpoint**
2. URL: `https://api.thrivo.fit/api/v1/webhooks/clerk`
3. Subscribe to:
   - `user.created`
   - `user.updated`
   - `user.deleted`
4. Copy the **Signing Secret** (starts with `whsec_`)

---

### A5. Collect Consumer API Keys

From the Clerk dashboard → **API Keys**:

| Variable | Where to find it |
|---|---|
| `CLERK_PUBLISHABLE_KEY` | "Publishable key" (starts with `pk_test_` or `pk_live_`) |
| `CLERK_SECRET_KEY` | "Secret keys" → reveal (starts with `sk_test_` or `sk_live_`) |
| `CLERK_WEBHOOK_SECRET` | Webhooks → your endpoint → Signing Secret (starts with `whsec_`) |

Update in **Coolify** (thrivo-backend service → Environment Variables):
- Remove: `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `APP_AUTH_REDIRECT_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`
- Add: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`

---

### A6. Mobile SDK Keys

The mobile app needs the publishable key only (never the secret key):

In `thrivo-mobile/.env` (and in EAS Secrets for builds):
```
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Remove from `thrivo-mobile/.env`:
```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=
```

---

## Part B — BeOrchid Admin Clerk Application

### B1. Create the Application

1. In the same BeOrchid Clerk organisation, create a second **Application** — name it `BeOrchid Admin`.
2. Note the **Application ID** for reference.

> This application is the single auth source for every admin/dashboard app in the BeOrchid ecosystem, now and in the future. Do **not** create a separate Clerk application per product's admin dashboard.

---

### B2. Configure Sign-In Methods

In the Clerk dashboard → **User & Authentication → Email, Phone, Username**:

- ✅ Enable **Email address**
- ✅ Enable **Password** — set minimum length to 12 characters
- ✅ Set email verification strategy to **Email verification link** (more appropriate for internal tooling than OTP)
- ❌ Disable magic link / email code as a standalone sign-in method (password is required)

In **Social Connections**:

- ❌ Disable Google
- ❌ Disable Apple

Admin users must sign in with email+password only. No social providers.

---

### B3. Configure Restrictions (Allowlist)

In the Clerk dashboard → **User & Authentication → Restrictions**:

- ✅ Enable **Allowlist** — only pre-approved email addresses can sign up or sign in
- Add every known admin email address to the allowlist before inviting anyone

This prevents arbitrary sign-ups on the admin Clerk application even if someone obtains the publishable key.

---

### B4. Configure the JWT Template

Same claims as the consumer application — the backend reads the same fields regardless of which Clerk instance issued the token:

In **Sessions → Customize session token**:

```json
{
  "email": "{{user.primary_email_address}}",
  "email_verified": "{{user.primary_email_address.verification.status == 'verified'}}",
  "name": "{{user.full_name}}",
  "role": "{{user.public_metadata.role}}"
}
```

> The `role` claim is included here (sourced from `public_metadata`) so admin route middleware can gate on role without an extra Clerk API call. Set `role: "admin"` (or a more specific role) on each user's public metadata after creating their account.

---

### B5. Register the Admin Webhook Endpoint

In the Clerk dashboard → **Webhooks**:

1. Click **Add Endpoint**
2. URL: `https://api.thrivo.fit/api/v1/webhooks/clerk-admin`
3. Subscribe to:
   - `user.created`
   - `user.updated`
   - `user.deleted`
4. Copy the **Signing Secret** (starts with `whsec_`)

> This is a separate webhook path from the consumer webhook. The backend handles admin user sync (e.g., creating an `AdminUser` record) differently from consumer user sync.

---

### B6. Collect Admin API Keys

From the Clerk dashboard → **API Keys** (within the BeOrchid Admin application):

| Variable | Where to find it |
|---|---|
| `CLERK_ADMIN_PUBLISHABLE_KEY` | "Publishable key" |
| `CLERK_ADMIN_SECRET_KEY` | "Secret keys" → reveal |
| `CLERK_ADMIN_WEBHOOK_SECRET` | Webhooks → your endpoint → Signing Secret |

Add to **Coolify** (thrivo-backend service → Environment Variables):
- `CLERK_ADMIN_SECRET_KEY`
- `CLERK_ADMIN_PUBLISHABLE_KEY`
- `CLERK_ADMIN_WEBHOOK_SECRET`

Add to **Coolify** (thrivo-admin service → Environment Variables):
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = value of `CLERK_ADMIN_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY` = value of `CLERK_ADMIN_SECRET_KEY`

> thrivo-admin uses standard Clerk Next.js env var names. The `CLERK_ADMIN_*` prefix is only used on the thrivo-backend side to distinguish the two instances.

---

## Part C — Staging User Migration (Optional)

If any test users exist in the staging database with old `auth_subject_id` values (hand-rolled IDs, not Clerk `user_xxxx` IDs), run the migration script to port them:

```bash
# From thrivo-backend/
tsx scripts/migrate-users-to-clerk.ts
```

> This script does not exist yet — it needs to be written as part of Phase 2 if staging users need preserving. For a clean staging environment this step can be skipped.

---

## Checklist Before Phase 2

**BeOrchid Consumer (A)**
- [ ] `BeOrchid Consumer` Clerk application created
- [ ] Email (OTP), Google, and Apple sign-in methods enabled; password disabled
- [ ] Default session JWT template updated with `email`, `email_verified`, `name` claims
- [ ] Consumer webhook endpoint registered at `/api/v1/webhooks/clerk`, subscribed to `user.created/updated/deleted`
- [ ] `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET` set in Coolify (thrivo-backend)
- [ ] `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` added to `thrivo-mobile/.env` and EAS Secrets
- [ ] Backend deployed to staging and `/health` returns 200
- [ ] Consumer webhook test delivery confirmed (200 response)

**BeOrchid Admin (B)**
- [ ] `BeOrchid Admin` Clerk application created
- [ ] Email+password enabled; social connections disabled
- [ ] Allowlist enabled and admin email addresses added
- [ ] Default session JWT template updated with `email`, `email_verified`, `name`, `role` claims
- [ ] Admin webhook endpoint registered at `/api/v1/webhooks/clerk-admin`, subscribed to `user.created/updated/deleted`
- [ ] `CLERK_ADMIN_SECRET_KEY`, `CLERK_ADMIN_PUBLISHABLE_KEY`, `CLERK_ADMIN_WEBHOOK_SECRET` set in Coolify (thrivo-backend)
- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` set in Coolify (thrivo-admin)
- [ ] Admin webhook test delivery confirmed (200 response)
