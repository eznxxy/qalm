import type { Metadata } from "next";
import "./globals.css";
// Design tokens (§2) app-wide. This is the STUB file — card t_62938355
// (step 1) owns its final form and the theme flip; importing it here only
// makes the token NAMES resolve on every screen (the §8 focus ring uses
// --brand, which previously existed solely inside the DataTable primitive).
import "../styles/tokens.css";
import { plexSans } from "./fonts";
import { SessionProvider } from "@/lib/session";
import { AppNav } from "@/components/app-nav";
import { MustChangePasswordBanner } from "@/components/must-change-password-banner";

export const metadata: Metadata = {
  title: "Qalm",
  description: "Qalm — test management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plexSans.variable}>
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
