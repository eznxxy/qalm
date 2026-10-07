"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import { ApiError } from "@/lib/api-error";

/**
 * Client-side auth gate. SessionContext already restores the session on
 * mount; this component redirects unauthenticated users to /login and shows
 * a loading state while status === "loading". Public pages (/login) are
 * excluded by the caller (root layout).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${next}`);
    }
  }, [status, router, pathname]);

  if (status !== "authenticated") {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        {status === "loading" ? "Loading…" : "Redirecting to login…"}
      </div>
    );
  }
  return <>{children}</>;
}

/** True for contract errors that mean "this session is no longer usable". */
export function isSessionDead(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHENTICATED");
}
