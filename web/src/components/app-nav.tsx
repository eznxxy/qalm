"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/api-types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  lead: "Lead",
  tester: "Tester",
  viewer: "Viewer",
};

/**
 * Role-aware chrome per the docs/api-auth.md role matrix:
 * only Admin sees user management; Lead/Tester/Viewer never do.
 * Gating is cosmetic defense-in-depth — the API enforces the matrix.
 */
export function AppNav() {
  const { user, logout } = useSession();
  const router = useRouter();

  if (!user) return null;

  const isAdmin = user.role === "admin";

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <nav aria-label="Main navigation" className="app-nav">
      <span className="app-nav-brand">Qalm</span>
      <Link href="/projects">Projects</Link>
      {isAdmin && <Link href="/users">Users</Link>}
      <Link href="/design">Design: table</Link>
      <span className="app-nav-spacer" />
      <span className="app-nav-user">
        {user.name} · {ROLE_LABELS[user.role]}
      </span>
      {user.must_change_password && (
        <Link href="/change-password" className="banner-link">
          Change password
        </Link>
      )}
      <button type="button" onClick={handleLogout}>
        Log out
      </button>
    </nav>
  );
}
