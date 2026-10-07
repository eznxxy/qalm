"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/session";
import { ApiError } from "@/lib/api-error";

/**
 * Login page with the first-time bootstrap gate.
 * - Login failures show ONE generic message (no user enumeration; 429 keeps
 *   its server-provided cool-down message because that is not an enumeration
 *   leak).
 * - Bootstrap (first Admin) is offered on the same page; 409 CONFLICT here
 *   means users already exist and IS shown, since no dedicated endpoint
 *   exists to probe bootstrap availability.
 */
export function LoginForm() {
  const { login, bootstrap, status, user } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";

  const [mode, setMode] = useState<"login" | "bootstrap">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && user) {
      router.replace(nextPath.startsWith("/") ? nextPath : "/");
    }
  }, [status, user, router, nextPath]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (mode === "bootstrap" && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await bootstrap({ name: name.trim(), email: email.trim(), password });
      }
      router.replace(nextPath.startsWith("/") ? nextPath : "/");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError(
            "Users already exist — first-time setup is no longer available. Log in instead."
          );
        } else if (err.status === 429) {
          setError(
            err.retryAfterSeconds !== undefined
              ? `Too many attempts. Try again in ${err.retryAfterSeconds} seconds.`
              : "Too many attempts. Please wait a few minutes and try again."
          );
        } else if (err.status === 400 && err.details?.length) {
          // Validation errors are safe to surface field-by-field (no enumeration).
          setError(
            err.details
              .map((d) => `${d.field ? `${d.field}: ` : ""}${d.issue}`)
              .join(" · ")
          );
        } else {
          // 401 and anything else: generic only — never reveal which failed.
          setError("Invalid email or password.");
        }
      } else {
        setError("Invalid email or password.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>{mode === "login" ? "Log in to Qalm" : "Set up Qalm"}</h1>

        {mode === "bootstrap" && (
          <p className="muted">
            First run: create the initial administrator account. This is only
            possible while no users exist.
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {mode === "bootstrap" && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {mode === "bootstrap" && (
            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className="primary">
            {submitting
              ? "Please wait…"
              : mode === "login"
                ? "Log in"
                : "Create admin account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login" ? (
            <>
              First time here?{" "}
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  setMode("bootstrap");
                  setError(null);
                }}
              >
                Set up the first admin account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Log in
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
