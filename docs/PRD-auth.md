# PRD — Auth & Roles (MVP)

Status: Draft — awaiting human approval
Owner: Daedalus
Task: qalm-1 (auth + projects slice)
API contract: `docs/api-auth.md` (shared conventions in `docs/api-conventions.md`)

## Problem
Qalm must know who is using it and what they are allowed to do. Every other
feature (projects, cases, runs) hangs off authenticated users with roles.

## Goals
- Email + password login. No self-registration: Admins create accounts.
- Four global roles, one per user: **Admin, Lead, Tester, Viewer**.
- Token-based sessions: short-lived access token, rotating refresh token.
- Admin user management (create, edit, deactivate) without any email
  infrastructure — Admin sets the initial password and shares it out-of-band.
- Self-service name and password change.
- A fresh install can be bootstrapped by creating the first Admin.

## Non-goals (MVP)
- SSO / SAML / OAuth, 2FA.
- Invitation, verification, or password-reset emails (Admin resets passwords).
- Per-project roles or memberships — roles are global (revisit after MVP).
- Fine-grained permissions; exactly the four roles, fixed meaning.
- Audit log UI.

## Roles (product meaning)
| Role | Can do |
|---|---|
| Admin | Everything: manage users and roles, create/edit/archive projects. |
| Lead | Manage test suites, cases, plans, runs, milestones in all projects; execute runs. |
| Tester | Record results in runs they are assigned to; read all projects/suites/cases. |
| Viewer | Read-only across everything. |

The precise per-endpoint authority is the API contract, not this table.

## User stories
- As an operator of a fresh install, I can create the first Admin account
  (bootstrap) — and only that once.
- As a user, I can log in with email + password and stay logged in until the
  refresh token expires (30 days) without re-entering my password.
- As a user, I can see my own name and role, and change my password
  (current password required) and display name.
- As an Admin, I can create a user with an email, name, role, and initial
  password; that user is flagged to change the password at first login.
- As an Admin, I can change a user's role or display name, reset their
  password, and deactivate them.
- As an Admin, I cannot deactivate or demote the last active Admin (the
  system always keeps at least one active Admin).
- As an Admin, I can list and search users.

## Session policy (product level)
- Access token: 15 minutes. Refresh token: 30 days, rotated on every use;
  reusing an already-used refresh token revokes that user's sessions
  (replay defense).
- Deactivating a user takes effect immediately: a deactivated user's access
  tokens are rejected and refresh fails.
- Login is rate-limited: 10 failed attempts per email+IP per 15 minutes →
  HTTP 429 for a cool-down period.
- Login errors never reveal whether the email exists (no user enumeration).

## Acceptance criteria
1. With zero users, `POST /auth/bootstrap` creates the first Admin and
   returns tokens; any later bootstrap call fails with 409.
2. Valid login returns access token + user + refresh cookie; wrong password
   and unknown email return the **same** 401 response.
3. A deactivated user cannot log in, and their existing tokens are rejected.
4. An expired access token returns 401; a valid refresh returns a new access
   token and a rotated refresh cookie; presenting the old refresh again
   returns 401 and invalidates the user's sessions.
5. Viewer gets 403 on any write endpoint; Lead gets 403 on user management.
6. Demoting or deactivating the last active Admin returns 409.
7. Changing password with a wrong current password returns 400.
8. Failed logins beyond the rate limit return 429 with a `Retry-After` header.

## Open questions (for the human)
1. Is the 15 min / 30 days session policy acceptable for MVP?
2. Self-registration stays off for MVP — confirm.
