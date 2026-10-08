import type { Metadata } from "next";
import "./globals.css";
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
