"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { RequireAuth, isSessionDead } from "@/components/require-auth";
import { DataTable, StatusBadge, type DataTableColumn } from "@/components/ui";
import { useSession } from "@/lib/session";
import { ROLES, Role, User } from "@/lib/api-types";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  lead: "Lead",
  tester: "Tester",
  viewer: "Viewer",
};

const PAGE_SIZE = 25;

/** Random initial password: >= 8 chars, guaranteed letter + digit. */
function generatePassword(length = 12): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  if (!/[a-zA-Z]/.test(out)) out = `a${out.slice(1)}`;
  if (!/\d/.test(out)) out = `${out.slice(0, -1)}7`;
  return out;
}

function conflictMessage(err: ApiError, fallback: string): string {
  return err.message || fallback;
}

/** One-time display of an initial password the Admin must share out-of-band. */
function OneTimeSecretPanel({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="panel panel-info" role="status" aria-live="polite">
      <h2>Share this password now</h2>
      <p>
        Initial password for <strong>{email}</strong>. It is shown only once —
        copy it and share it out-of-band (never by ticket or email thread).
      </p>
      <div className="secret-row">
        <code className="secret-value">{password}</code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: (user: User, password: string) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("tester");
  const [password, setPassword] = useState(() => generatePassword());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await api.createUser({
        email: email.trim(),
        name: name.trim(),
        role,
        password,
      });
      onCreated(user, password);
      setEmail("");
      setName("");
      setRole("tester");
      setPassword(generatePassword());
    } catch (err) {
      if (isSessionDead(err)) return;
      if (err instanceof ApiError && err.status === 409) {
        setError(conflictMessage(err, "A user with this email already exists."));
      } else if (err instanceof ApiError) {
        setError(
          err.details?.length
            ? err.details.map((d) => `${d.field ? `${d.field}: ` : ""}${d.issue}`).join(" · ")
            : err.message
        );
      } else {
        setError("Could not create the user. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="panel">
      <h2>Create user</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="new-email">Email</label>
          <input
            id="new-email"
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-name">Name</label>
          <input
            id="new-name"
            type="text"
            autoComplete="off"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-role">Role</label>
          <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-password">Initial password</label>
          <div className="secret-row">
            <input
              id="new-password"
              type="text"
              autoComplete="off"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="new-password-hint"
            />
            <button type="button" onClick={() => setPassword(generatePassword())}>
              Generate
            </button>
          </div>
          <p id="new-password-hint" className="muted">
            The user must change this at first login. Share it out-of-band.
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={submitting}>
        {submitting ? "Creating…" : "Create user"}
      </button>
    </form>
  );
}

function EditUserPanel({
  user,
  onSaved,
  onClose,
}: {
  user: User;
  onSaved: (user: User, oneTimePassword?: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * PATCH the user. Returns the updated user on success; returns null on
   * any failure (validation/conflict/network error — error state is set for
   * display — or a dead session, which the auth layer owns and redirects).
   * Callers decide what "success" means for them; nothing is fired from here.
   */
  async function patch(body: Record<string, unknown>): Promise<User | null> {
    setSubmitting(true);
    setError(null);
    try {
      return await api.updateUser(user.id, body);
    } catch (err) {
      if (isSessionDead(err)) return null;
      if (err instanceof ApiError && err.status === 409) {
        setError(
          conflictMessage(
            err,
            "Not allowed: this would leave the workspace without an active admin."
          )
        );
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Could not save changes. Please try again.");
      }
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {};
    if (name.trim() !== user.name) body.name = name.trim();
    if (role !== user.role) body.role = role;
    if (isActive !== user.is_active) body.is_active = isActive;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    const updated = await patch(body);
    if (updated) onSaved(updated);
  }

  async function handleResetPassword() {
    const newPassword = generatePassword();
    // The one-time panel may only appear when the PATCH actually succeeded —
    // a generated password that was never applied must never be shared.
    const updated = await patch({ password: newPassword });
    if (updated) onSaved(updated, newPassword);
  }

  return (
    <form onSubmit={handleSave} noValidate className="panel" aria-label={`Edit ${user.email}`}>
      <h2>
        Edit {user.email}
        {!user.is_active && <StatusBadge status="skipped"> deactivated</StatusBadge>}
      </h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`name-${user.id}`}>Name</label>
          <input
            id={`name-${user.id}`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`role-${user.id}`}>Role</label>
          <select
            id={`role-${user.id}`}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="field field-checkbox">
          <input
            id={`active-${user.id}`}
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <label htmlFor={`active-${user.id}`}>Active (deactivated users cannot log in)</label>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={handleResetPassword}
        >
          Reset password
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </form>
  );
}

/** Column defs for the users DataTable (t_10da9c7a rendering-layer swap).
 * Sort stays off for parity — the previous table had no sorting; enabling
 * it is a separate product decision (see the card's decisions list). */
function buildUserColumns(
  RowActions: (props: { user: User }) => ReactNode
): DataTableColumn<User>[] {
  return [
    {
      key: "email",
      header: "Email",
      render: (u) => u.email,
    },
    {
      key: "name",
      header: "Name",
      render: (u) => u.name,
    },
    {
      key: "role",
      header: "Role",
      render: (u) => ROLE_LABELS[u.role],
    },
    {
      key: "status",
      header: "Status",
      render: (u) => (
        <>
          {u.is_active ? (
            <StatusBadge status="passed">Active</StatusBadge>
          ) : (
            <StatusBadge status="skipped">Deactivated</StatusBadge>
          )}
          {u.must_change_password && (
            <StatusBadge status="retest" title="Must change password at next login">
              temp password
            </StatusBadge>
          )}
        </>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (u) => <RowActions user={u} />,
    },
  ];
}

function UsersAdminPage() {
  const { user } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [meta, setMeta] = useState<{ page: number; total_pages: number; total: number } | null>(
    null
  );
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [oneTime, setOneTime] = useState<{ email: string; password: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The Edit action of one row (setEditing/setOneTime are page-scoped). */
  function ListRowActions({ user: rowUser }: { user: User }) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(rowUser);
          setOneTime(null);
        }}
      >
        Edit
      </button>
    );
  }

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const result = await api.listUsers({
        query: query || undefined,
        role: roleFilter || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setUsers(result.data);
      setMeta(
        result.meta
          ? { page: result.meta.page, total_pages: result.meta.total_pages, total: result.meta.total }
          : null
      );
    } catch (err) {
      if (isSessionDead(err)) return;
      if (err instanceof ApiError && err.status === 403) {
        setListError("You need the Admin role to manage users.");
      } else {
        setListError("Could not load users. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [query, roleFilter, page]);

  useEffect(() => {
    // Non-admins never call the API (the page shows Forbidden instead), so
    // no pointless 403 round-trip is made. The await keeps the state updates
    // asynchronous and `active` prevents updates after unmount.
    if (user?.role !== "admin") return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load, user]);

  function onQueryChange(value: string) {
    setQueryInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setQuery(value.trim());
    }, 300);
  }

  if (user && user.role !== "admin") {
    return (
      <main className="page">
        <div className="panel panel-error" role="alert">
          <h1>Forbidden</h1>
          <p>User management is available to Admins only.</p>
          <p>
            <Link href="/projects">Back to projects</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Users</h1>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="user-search">Search</label>
          <input
            id="user-search"
            type="search"
            placeholder="Search by email or name"
            value={queryInput}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="role-filter">Role</label>
          <select
            id="role-filter"
            value={roleFilter}
            onChange={(e) => {
              setPage(1);
              setRoleFilter(e.target.value as Role | "");
            }}
          >
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {listError && (
        <p className="form-error" role="alert">
          {listError}
        </p>
      )}

      <DataTable
        columns={buildUserColumns(ListRowActions)}
        rows={users}
        getRowId={(u) => u.id}
        caption={`Users${meta ? `, page ${meta.page} of ${meta.total_pages}` : ""}`}
        ariaLabel="Users"
        loading={loading}
        error={listError}
        onRetry={() => void load()}
        emptyTitle="No users match."
        sort={null}
        selectable={false}
        rowHeight="default"
        rowClassName={(u) => (u.is_active ? undefined : "row-muted")}
      />

      {meta && meta.total_pages > 1 && (
        <nav className="pagination" aria-label="User list pages">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="t-nums">
            Page {meta.page} of {meta.total_pages} ({meta.total} users)
          </span>
          <button
            type="button"
            disabled={page >= meta.total_pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </nav>
      )}

      {oneTime && (
        <OneTimeSecretPanel
          email={oneTime.email}
          password={oneTime.password}
          onClose={() => setOneTime(null)}
        />
      )}

      <CreateUserForm
        onCreated={(created, password) => {
          setOneTime({ email: created.email, password });
          void load();
        }}
      />

      {editing && (
        <EditUserPanel
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated, oneTimePassword) => {
            setEditing(null);
            if (oneTimePassword) {
              setOneTime({ email: updated.email, password: oneTimePassword });
            }
            void load();
          }}
        />
      )}
    </main>
  );
}

export default function UsersPage() {
  return (
    <RequireAuth>
      <UsersAdminPage />
    </RequireAuth>
  );
}
