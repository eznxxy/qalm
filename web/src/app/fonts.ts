import { IBM_Plex_Sans } from "next/font/google";

/**
 * App typeface — DESIGN.md §2.4: one family, IBM Plex Sans (400, 500, 600).
 *
 * next/font downloads the font files at build time and self-hosts them, so
 * no runtime request goes to Google. The `variable` option exposes the
 * loaded family (plus next/font's metric-adjusted fallback face) as
 * --font-plex-sans; globals.css composes the visible stack from it as
 * `var(--font-plex-sans), system-ui, -apple-system, "Segoe UI", sans-serif`
 * — exactly the spec fallback stack.
 */
export const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  style: "normal",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plex-sans",
});
