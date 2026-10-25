import type { Metadata } from "next";
import "@/styles/tokens.css";
import "./globals.css";
import { plexSans } from "./fonts";
import { SessionProvider } from "@/lib/session";

export const metadata: Metadata = {
  title: "Qalm",
  description: "Qalm — test management",
};

/**
 * Root layout is intentionally chrome-less: the app shell (DESIGN.md §3)
 * lives in the (app) route-group layout so the auth screens in (auth) —
 * login/bootstrap — render outside it, with their 40px controls.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the shell's pre-paint script adds
    // `sidebar-collapsed` to <html> before React hydrates (no rail flash), so
    // the server/client class attribute differs by design. Attributes only —
    // children still hydrate normally.
    <html lang="en" className={plexSans.variable} suppressHydrationWarning>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
