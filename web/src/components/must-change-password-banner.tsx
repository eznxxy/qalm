"use client";

import { ReactNode } from "react";
import { useSession } from "@/lib/session";

/**
 * must_change_password=true → banner + forced link to the change-password
 * page, per the task scope. Advisory only: the API still accepts normal
 * calls, so we nudge (banner) rather than hard-block.
 */
export function MustChangePasswordBanner() {
  const { user } = useSession();
  if (!user?.must_change_password) return null;
  return (
    <div className="banner banner-warning" role="alert">
      <span>
        Your password is temporary. Please set your own password now.
      </span>
      <a href="/change-password" className="banner-link">
        Change password
      </a>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <MustChangePasswordBanner />
      {children}
    </>
  );
}
