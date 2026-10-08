import type { Metadata } from "next";
// Design tokens (DESIGN.md §2) — must come before globals.css so the
// theme-alias layer there resolves against them. Light theme is the MVP
// default; dark values flip under [data-theme="dark"] (§2.3, phase 2).
import "./globals.css";
import "@/styles/tokens.css";
import { SessionProvider } from "@/lib/session";
import { AppNav } from "@/components/app-nav";
import { MustChangePasswordBanner } from "@/components/must-change-password-banner";

export const metadata: Metadata = {
  title: "Qalm",
  description: "Qalm — test management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <AppNav />
          <MustChangePasswordBanner />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
