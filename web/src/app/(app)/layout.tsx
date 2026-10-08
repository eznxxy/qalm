"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { RequireAuth } from "@/components/require-auth";
import { MustChangePasswordBanner } from "@/components/must-change-password-banner";

/**
 * (app) route-group layout: everything authenticated renders inside the
 * DESIGN.md §3 shell. RequireAuth wraps the shell's CHILDREN (not the shell)
 * so the chrome is stable while the session restores — the shell's own
 * render reads the user only after the gate has authenticated.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>
        <MustChangePasswordBanner />
        {children}
      </AppShell>
    </RequireAuth>
  );
}
