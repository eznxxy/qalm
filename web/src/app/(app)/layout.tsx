"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { RequireAuth } from "@/components/require-auth";
import { MustChangePasswordBanner } from "@/components/must-change-password-banner";

/**
 * (app) route-group layout: everything authenticated renders inside the
 * DESIGN.md §3 shell. RequireAuth wraps the shell's CHILDREN (not the shell)
 * so the chrome prerenders and is stable while the session restores — no
 * layout shift when the page content arrives.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <RequireAuth>
        <MustChangePasswordBanner />
        {children}
      </RequireAuth>
    </AppShell>
  );
}
