import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

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
