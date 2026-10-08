"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

/**
 * The projects list is the default landing page after login
 * (docs/PRD-projects.md) — this route forwards to it immediately.
 */
export default function HomePage() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    else if (status === "authenticated") router.replace("/projects");
  }, [status, router]);

  return (
    <div className="auth-loading" role="status" aria-live="polite">
      Loading…
    </div>
  );
}
