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
    <html lang="en" className={plexSans.variable}>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
