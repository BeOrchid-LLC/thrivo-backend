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
    accent: "#09823c",
    accentText: "#ffffff",
    iconTint: "#e8f7ee",
    border: "#e8ecf0",
    inputBg: "#f0f2f5",
  },
  dark: {
    pageBg: "#0c1019",
    cardBg: "#141826",
    cardBorder: "rgba(255,255,255,0.16)",
    headingText: "#f4f6f9",
    bodyText: "#f4f6f9",
    mutedText: "rgba(255,255,255,0.5)",
    accent: "#08c759",
    accentText: "#0c1019",
    iconTint: "#172f2f",
    border: "rgba(255,255,255,0.07)",
    inputBg: "#1c2236",
  },
} as const;

export const emailFonts = {
  body: "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
} as const;

/**
 * Fixed brand color that does NOT swap between light/dark — confirmed by the
 * magic-link dark frame (277:414), where the CTA button stays `#09823c` even
 * though the icon badge/"having trouble" link switch to the brighter
 * `dark.accent` (`#08c759`) right next to it.
 */
export const emailBrand = {
  green: "#09823c",
} as const;
