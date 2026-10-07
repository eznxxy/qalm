# Qalm — Test Management Web App

Qalm is a web app for managing software testing, similar to TestRail.
Users organize test cases, plan test runs, record results, and view reports.

## Product scope (MVP)
- Auth and roles: Admin, Lead, Tester, Viewer
- Projects
- Test suites and sections; test cases (title, preconditions, steps, expected
  result, priority, type, tags)
- Test plans and test runs: select cases, assign testers, record results
  (Passed, Failed, Blocked, Retest, Skipped) with comments and attachments
- Milestones
- Dashboards and reports: pass rate, progress per run, failures over time
- Import/export (CSV)
Out of scope for MVP: integrations (Jira, CI), custom fields, SSO.

## Stack
- Web: Next.js + TypeScript, in /web
- API: NestJS + TypeScript, in /server
- Database: PostgreSQL, migrations in /server/migrations
- Tests: Jest (unit), Playwright (end-to-end)
- Docs and decisions: /docs

## Team and ownership
- Athena: orchestrator. Plans, creates and assigns kanban tasks, tracks status.
  Writes no feature code.
- Daedalus: lead engineer. Owns /docs, architecture, API contracts, reviews.
- Hephaestus: backend engineer. Owns /server and the database.
- Iris: frontend engineer. Owns /web.
- Argus: QA verifier. Runs the app and the tests. Reports; never edits source.
Nobody edits files outside their ownership. Ask the owner through a kanban comment.

## Workflow (kanban board: qalm)
1. Athena receives the goal from the human and creates a task for Daedalus.
2. Daedalus writes docs/PRD-<feature>.md and docs/api-<feature>.md (the contract),
   then STOPS and asks the human to approve.
3. After approval, Daedalus breaks the work into tasks and assigns them to
   Hephaestus (backend) and Iris (frontend).
4. Hephaestus and Iris implement against the contract, comment on the task,
   and mark it done with a handoff note.
5. Athena creates a QA task for Argus once both are done.
6. Argus tests. Failures go back to the owner as a new task with repro steps.
7. Athena reports the result to the human.

## Handoff format (required on every completed task)
Goal / Files changed / Assumptions / How to run and verify / Open risks

## Definition of done
- Matches the API contract in docs/
- Unit tests written and passing
- Verification steps were actually run
- No secrets in code or logs
- Committed on a branch named feature/<task-id>-<short-name>

## Rules
- Contracts first: no implementation before docs/api-<feature>.md exists.
- Ask the human before: deleting data, force-pushing, changing a schema on
  shared data, deploying, adding paid services, anything involving secrets.
- Never weaken or delete a failing test to make it pass.
- Never mark something verified that you did not run.
- Small commits with clear messages. Do not commit .env files.

## Commands (update as the project grows)
- Install: npm install
- Dev: npm run dev (web), npm run start:dev (server)
- Test: npm test, npx playwright test
