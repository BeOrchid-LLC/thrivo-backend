# Clerk Phase 2 Prerequisites

Before starting Phase 2 (mobile SDK integration), the following manual steps must be completed in the Clerk dashboard. None of these require code changes.

---

## 1. Create the Clerk Application

1. Sign in at [clerk.com](https://clerk.com) and open the BeOrchid organisation (or create it).
2. Create a new **Application** — name it `Thrivo` (or `BeOrchid` if you want a single tenant for all future apps).
3. Note the **Application ID** for reference.

> **Multi-app intent:** This single Clerk application will serve all future BeOrchid products. Users created here get a `user_xxxx` ID that is portable across every app in the same Clerk tenant. Do **not** create separate Clerk applications per product.

---

## 2. Configure Sign-In Methods

In the Clerk dashboard → **User & Authentication → Email, Phone, Username**:

- ✅ Enable **Email address** (required)
- ✅ Set email verification strategy to **Email verification code** (6-digit OTP)
- ❌ Disable email+password (Thrivo is passwordless-only for end users)

In **Social Connections**:

- ✅ Enable **Google** — requires a Google Cloud OAuth client (Web application type). Redirect URI: `https://your-clerk-domain.clerk.accounts.dev/v1/oauth_callback`
- ✅ Enable **Apple** — requires an Apple Services ID + private key (mandatory for App Store per review guideline 4.8)

---

## 3. Configure the JWT Template

This is critical. The backend's `verifyRequest()` reads `email`, `email_verified`, and `name` directly from the session JWT. Without this template, those fields will be missing and every auth request will fail with a null principal.

In the Clerk dashboard → **JWT Templates**:

1. Click **New template** → choose **Blank**
2. Name it `thrivo-session` (or any name — it's the default session template that matters)
3. Set the template to the **default session token** (Edit the existing default, not a custom named one)
4. Add these claims to the default session token:

```json
{
  "email": "{{user.primary_email_address}}",
  "email_verified": "{{user.primary_email_address.verification.status == 'verified'}}",
  "name": "{{user.full_name}}"
}
```

> **Alternative path:** Under **Sessions → Customize session token**, add the same claims. Clerk's dashboard UI for this changed in 2024 — find "Session token" under the Sessions menu, not JWT Templates.

---

## 4. Register the Webhook Endpoint

In the Clerk dashboard → **Webhooks**:

1. Click **Add Endpoint**
2. URL: `https://api.thrivo.fit/api/v1/webhooks/clerk`
3. Subscribe to these events:
   - `user.created`
   - `user.updated`
   - `user.deleted`
4. After saving, copy the **Signing Secret** (starts with `whsec_`)

---

## 5. Collect API Keys

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

## 6. Mobile SDK Keys

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

## 7. Staging User Migration (Optional)

If any test users exist in the staging database with old `auth_subject_id` values (hand-rolled IDs, not Clerk `user_xxxx` IDs), run the migration script to port them:

```bash
# From thrivo-backend/
tsx scripts/migrate-users-to-clerk.ts
```

> This script does not exist yet — it needs to be written as part of Phase 2 if staging users need preserving. For a clean staging environment this step can be skipped.

---

## Checklist Before Phase 2

- [ ] Clerk application created
- [ ] Email (OTP), Google, and Apple sign-in methods enabled
- [ ] Default session JWT template updated with `email`, `email_verified`, `name` claims
- [ ] Webhook endpoint registered, subscribed to `user.created/updated/deleted`
- [ ] `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET` set in Coolify
- [ ] Backend deployed to staging and `/health` returns 200
- [ ] Webhook test delivery from Clerk dashboard → endpoint → Send test → confirm 200 response
- [ ] `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` added to `thrivo-mobile/.env` and EAS Secrets
