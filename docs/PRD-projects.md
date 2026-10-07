# PRD — Projects (MVP)

Status: Draft — awaiting human approval
Owner: Daedalus
Task: qalm-1 (auth + projects slice)
API contract: `docs/api-projects.md` (shared conventions in `docs/api-conventions.md`)

## Problem
A project is the top-level container in Qalm: suites, cases, plans, runs,
milestones, and reports all belong to one. Nothing else in the MVP can be
built without it.

## Goals
- Admins create, edit, and archive projects.
- Every authenticated user sees active projects and can open one.
- A short unique **key** per project (e.g. `PAY`) for stable references
  (test cases become `PAY-123` in later slices — cheap now, painful to add later).
- Search projects by name; list is paginated.

## Non-goals (MVP)
- Per-project membership or project-level roles — global roles apply
  everywhere (revisit after MVP with the Lead/Tester assignment story).
- Hard delete of projects — archive/restore only (data-safety rule: deletion
  needs explicit human approval, so the MVP simply doesn't offer it).
- Project templates, categories, custom fields (out of MVP per AGENTS.md),
  per-project integrations, import/export (later slice).

## Data model (product level)
| Field | Rules |
|---|---|
| `name` | Required, 1–100 chars, unique (case-insensitive). |
| `key` | Required, 2–10 chars, uppercase letter first, then `A–Z 0–9`, unique (case-insensitive). UI suggests a key from the name; Admin can edit it at create/edit time. |
| `description` | Optional, ≤ 500 chars. |
| `status` | `active` or `archived`. Archived projects are hidden from non-Admins entirely and excluded from default listings. |

## User stories
- As an Admin, I can create a project with a name, key, and description; the
  key is auto-suggested and I can override it.
- As any authenticated user, I can see the list of active projects, search by
  name, and open one (its detail screen hosts suites/runs in later slices).
- As an Admin, I can edit a project's name, key, and description.
- As an Admin, I can archive a project — it disappears from the default list
  and from non-Admin users entirely; existing data is kept.
- As an Admin, I can view archived projects (with a filter) and restore one.

## Acceptance criteria
1. Admin creates a project; it appears in the list for all roles.
2. Duplicate `name` (case-insensitive) → 409; duplicate `key` → 409;
   lowercase key input is normalized to uppercase.
3. Non-Admin cannot create, edit, archive, or restore (403).
4. Archived project: absent from default list for everyone; visible to Admin
   via `status=archived` filter; `GET /projects/:id` on it returns 404 for
   non-Admins and 200 for Admins.
5. Restored project reappears in the default list.
6. Viewer sees the list and can open a project, but every write returns 403.

## Open questions (for the human)
1. Is Admin-only project creation right for MVP, or should Leads create
   projects too?
2. Confirm archive-only (no hard delete) for MVP.
