"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { ApiError } from "@/lib/api-error";

/** Self-service name and password change (PATCH /auth/me). */
export default function ChangePasswordPage() {
  const { user, setUser } = useSession();
  const router = useRouter();

  // Name is prefilled once: RequireAuth only renders this form after the
  // session is authenticated, so `user` is already loaded at mount.
  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): string | null {
    const changingPassword = newPassword !== "" || confirm !== "";
    if (changingPassword && !currentPassword) {
      return "Current password is required to change your password.";
    }
    if (changingPassword && newPassword.length < 8) {
      return "New password must be at least 8 characters.";
    }
    if (changingPassword && !(/[a-zA-Z]/.test(newPassword) && /\d/.test(newPassword))) {
      return "New password must contain at least one letter and one digit.";
    }
    if (changingPassword && newPassword !== confirm) {
      return "New passwords do not match.";
    }
    if (!changingPassword && name.trim() === (user?.name ?? "")) {
      return "Nothing to update — enter a new name or a new password.";
    }
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    const changingPassword = newPassword !== "";
    const body: { name?: string; current_password?: string; new_password?: string } = {};
    if (name.trim() !== (user?.name ?? "")) body.name = name.trim();
    if (changingPassword) {
      body.current_password = currentPassword;
      body.new_password = newPassword;
    }

    setSubmitting(true);
    try {
      const { api } = await import("@/lib/endpoints");
      const updated = await api.patchMe(body);
      setUser(updated);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setNotice(
        updated.must_change_password
          ? "Saved — but your password is still temporary."
          : "Saved."
      );
      if (updated.must_change_password === false) {
        // Temporary-password flag cleared; back to the app.
        router.push("/");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(
          err.details?.length
            ? err.details.map((d) => `${d.field ? `${d.field}: ` : ""}${d.issue}`).join(" · ")
            : err.message
        );
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Could not save your changes. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <h1>Account settings</h1>
      {user?.must_change_password && (
        <p className="muted">
          Your password is temporary — set your own password below.
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate className="auth-card">
        <div className="field">
          <label htmlFor="name">Display name</label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <fieldset className="fieldset">
          <legend>Change password</legend>
          <div className="field">
            <label htmlFor="current">Current password</label>
            <input
              id="current"
              name="current_password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new">New password</label>
            <input
              id="new"
              name="new_password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="form-notice" role="status">
            {notice}
          </p>
        )}

        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </form>
    </main>
  );
}

