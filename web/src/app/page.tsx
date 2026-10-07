"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

/** Authenticated landing page: currently a session summary. */
export default function HomePage() {
  const { user, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated" || !user) {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        Loading…
      </div>
    );
  }

  return (
    <main className="page">
      <h1>Welcome, {user.name}</h1>
      <p className="muted">
        Signed in as {user.email} ({user.role}). Projects, test runs and reports
        arrive in later slices — this page is the authenticated entry point.
      </p>
    </main>
  );
}
