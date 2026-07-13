/**
 * Light/dark color pairs for email HTML. Both are now exact, pulled from Figma:
 * dark from the OTP frame (277:472), light from the magic-link frame (269:4).
 * The two frames agree on the shared tokens (accent, icon tint), which is what
 * you'd expect from a real design system rather than per-template guesses.
 */
export const emailTokens = {
  light: {
    pageBg: "#f0f2f5",
    cardBg: "#ffffff",
    cardBorder: "#e8ecf0",
    headingText: "#1a1a2e",
    bodyText: "#1a1a2e",
    mutedText: "#737373",
    // De-emphasized body/caption text (ring caption, info-row notes) — the
    // heading color at 50% opacity, distinct from the solid `mutedText` used
    // only in the footer. Confirmed by the weekly-review frame (269:134): the
    // ring's "You logged" line, the "Last week" paragraph, and both info-row
    // notes + their icons all use rgba(26,26,46,0.5), not #737373.
    // Confirmed exact by the weekly-review dark frame (277:352): the ring's
    // caption/paragraph muted text there is rgba(244,246,249,0.5)/rgba(237,240,247,0.5)
    // — near-identical to rgba(255,255,255,0.5), so no separate dark value needed.
    softMutedText: "rgba(26,26,46,0.5)",
    accent: "#09823c",
    // Link-style text (magic-link's fallback link only) — distinct from `accent`
    // in light mode, confirmed to collapse onto `dark.accent` in dark mode
    // (magic-link's dark "having trouble" link is #08c759). NOT the same concept
    // as `emailBrand.brightGreen` below, even though they share a light-mode
    // value — see that constant's comment for why weekly-review's eyebrow/ring
    // don't follow this same swap.
    linkGreen: "#27ae60",
    accentText: "#ffffff",
    iconTint: "#e8f7ee",
    // The progress ring's own track color — confirmed distinct from `iconTint`
    // (weekly-review frame 277:352): a pale green in light, translucent white in
    // dark, rather than iconTint's solid dark-green-on-dark-bg treatment.
    ringTrack: "#eaf3de",
    border: "#e8ecf0",
    inputBg: "#f0f2f5",
    // The weekly-review card's bottom CTA section: a fixed dark navy panel that
    // contrasts against the white top zone. Only needed in light mode — see
    // dark's value below.
    ctaPanelBg: "#1a1a2e",
    // Text inside that panel needs to be white for contrast against the fixed
    // dark bg — NOT `headingText`/`bodyText` (`#1a1a2e`), which would be
    // invisible on a `#1a1a2e` panel.
    ctaPanelText: "#ffffff",
  },
  dark: {
    pageBg: "#0c1019",
    cardBg: "#141826",
    cardBorder: "rgba(255,255,255,0.16)",
    headingText: "#f4f6f9",
    bodyText: "#f4f6f9",
    mutedText: "rgba(255,255,255,0.5)",
    softMutedText: "rgba(255,255,255,0.5)",
    accent: "#08c759",
    // Same literal value as `accent` — dark mode doesn't distinguish the two
    // greens the way light mode does (see the light-side comment).
    linkGreen: "#08c759",
    accentText: "#0c1019",
    iconTint: "#172f2f",
    ringTrack: "rgba(255,255,255,0.08)",
    border: "rgba(255,255,255,0.07)",
    inputBg: "#1c2236",
    // Confirmed by the weekly-review dark frame (277:352): the CTA panel doesn't
    // stand out from the surrounding card in dark mode at all — the wrapping
    // element has no background override, so it just inherits `cardBg`. The
    // light/dark contrast trick is a light-mode-only device.
    ctaPanelBg: "#141826",
    // Same reasoning — in dark mode this text is just normal `headingText`,
    // not a special white-for-contrast override.
    ctaPanelText: "#f4f6f9",
  },
} as const;

export const emailFonts = {
  body: "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
} as const;

/**
 * Fixed brand colors that do NOT swap between light/dark modes.
 * - `green`: confirmed by the magic-link dark frame (277:414) — the CTA button
 *   stays `#09823c` even though the icon badge/"having trouble" link switch to
 *   the brighter `dark.accent` (`#08c759`) right next to it.
 * - `brightGreen`: confirmed FIXED by the weekly-review dark frame (277:352) —
 *   both the eyebrow text/icon and the progress-ring arc stay `#27ae60` in dark
 *   mode, not `dark.accent`/`dark.linkGreen` (`#08c759`). This directly
 *   conflicts with magic-link's OWN dark frame, where the visually similar
 *   "having trouble" link DOES swap to `#08c759` (modeled as `linkGreen`
 *   above). Both are independently confirmed via direct Figma pulls — rather
 *   than force one "correct" unified token, this models them as the two
 *   different things the evidence says they are. Worth flagging to the
 *   designer as a likely inconsistency between the two frames.
 * - `ctaPanelCaption`: the weekly-review CTA panel's "Takes less than 2
 *   minutes" caption. Light frame confirms `#f4f6f9`; the dark frame's pull
 *   showed `#bab4b4`, which matches no declared variable and every other
 *   value around it — almost certainly a one-off Figma slip on that single
 *   text node. Kept fixed at the light value rather than propagating a color
 *   nothing else in the design system uses.
 */
export const emailBrand = {
  green: "#09823c",
  brightGreen: "#27ae60",
  ctaPanelCaption: "#f4f6f9",
} as const;
