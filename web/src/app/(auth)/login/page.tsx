import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

/**
 * (auth) route group: rendered outside the app shell. LoginForm reads
 * useSearchParams (?next redirect target), so it prerenders behind this
 * Suspense boundary (Next 16 / cacheComponents) and shows the app's loading
 * state until the URL data streams in.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-loading" role="status" aria-live="polite">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
