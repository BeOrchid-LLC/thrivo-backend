# Email icon rendering plan

## Goal

Make the icons in transactional email templates render consistently in Gmail, Outlook, Apple Mail, and mobile clients.

This plan covers the email asset and rendering path only. It does not change the worker logging work included in this session.

## Findings

The current templates in `src/lib/email/templates/base.ts` emit inline `<svg>` elements. Their paths use `fill="currentColor"`, so rendering depends on both inline SVG support and inherited CSS being preserved by the recipient's email client. The Resend integration sends the generated HTML through unchanged; the failure is therefore primarily client compatibility, not an SVG transformation in the backend.

The existing tests verify that SVG markup is generated, but do not render a received message in real email clients. Passing those tests cannot establish inbox compatibility.

## Recommended design

Use PNG assets embedded as CID inline images.

1. Export each email icon as a transparent PNG at 2x its displayed dimensions.
2. Add an email-icon asset registry mapping an icon name to its image content and stable content ID.
3. Extend the single-email Resend payload to accept inline image attachments.
4. Replace the SVG output in the shared email helpers with explicit `<img>` tags:
   - fixed `width` and `height`;
   - `display:block`;
   - `border:0`;
   - meaningful `alt` text only when the icon conveys information not present in nearby text.
5. Keep the surrounding table layout and text labels so the message remains understandable when images are blocked.

Example markup:

```html
<img src="cid:email-check" width="32" height="32" alt="" style="display:block;border:0;">
```

The `cid:email-check` value must match the attachment's `content_id`. Use the existing `/emails` endpoint rather than the batch endpoint because inline attachments are not supported by the batch API.

## Alternatives rejected

- Public HTTPS PNGs are simpler, but clients may block remote images until the recipient opts in.
- Keeping inline SVG preserves the current implementation but cannot provide reliable Outlook/Gmail coverage.
- Base64/data-URI SVGs do not solve sanitization or unsupported-format behavior.
- CSS-drawn shapes or Unicode characters are acceptable only as a deliberate fallback for very simple icons, not as the primary visual system.

## Implementation phases and done gates

### Phase 1: Assets and backend contract

- Create the PNG asset set and stable content IDs.
- Add attachment types and CID serialization to the Resend integration.
- Ensure no secrets, recipient data, or message bodies are logged while building the payload.

Done when unit tests prove that each selected icon produces one matching CID reference and attachment.

### Phase 2: Template migration

- Update `emailIconBadge`, `emailIconRow`, `emailProgressRing`, and button/icon helpers.
- Remove dependence on `currentColor` for email icons.
- Preserve text, spacing, and accessible fallback behavior.

Done when all email templates generate `<img>` references and no production template depends on inline SVG.

### Phase 3: Compatibility verification

- Send representative sign-in, verification, and notification emails to Gmail web/mobile, Outlook on Windows/OWA, and Apple Mail.
- Verify both normal image display and the blocked-image state.
- Inspect the received message source to confirm CID references and attachments match.

Done when icons display at the intended size in the target clients and the blocked-image state remains legible.

### Phase 4: Rollout and rollback

- Release behind the existing email delivery path without changing template copy or recipient behavior.
- Monitor delivery failures and template rendering reports.
- Keep the previous template renderer available for a short rollback window.

Done when production sends are stable across one normal release window and rollback has been exercised or is demonstrably ready.

## Risks and safeguards

- **Images remain blocked:** use nearby text and correct `alt` behavior; do not rely on icons alone.
- **CID mismatch:** generate the HTML reference and attachment metadata from the same registry entry and test them together.
- **Payload growth:** keep icons small, reuse the same content ID per message, and avoid embedding unnecessary duplicate assets.
- **Layout regressions:** set explicit dimensions and verify the table cells at narrow mobile widths.
- **Provider/API drift:** keep attachment serialization isolated in the Resend integration and cover its request shape with tests.

## Non-goals

- Redesigning the email visual language.
- Fixing email-client CSS support generally.
- Changing worker behavior or delivery retry semantics.
- Adding a browser-only SVG renderer to the test suite in place of real-client verification.
