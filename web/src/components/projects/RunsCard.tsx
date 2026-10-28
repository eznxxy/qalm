"use client";

/**
 * Test Runs card (docs/DESIGN.md §4.8, docs/api-runs.md).
 *
 * The five newest runs in this project, newest first, with plan, milestone,
 * run status and progress. The run resource carries `plan_id` but no plan name,
 * so names come from the project's plans list; if that fetch fails every plan
 * cell falls back to `—` rather than failing the card.
 *
 * Writers create in place: the header's "New run" opens the runs screen's
 * create dialog and, on success, both cards refresh through `onChanged` (a new
 * run changes a milestone's counts). PRD project-overview acceptance
 * criterion 19.
 *
 * There is deliberately no "By" column: the run resource has no author name
 * and `GET /users` is Admin-only (PRD decision 8).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  RUN_STATUS_LABELS,
  type Run,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { formatDateOnly } from "@/lib/dates";
import { StatusBar } from "@/components/ui";
import { NewRunDialog } from "@/components/runs/NewRunDialog";
import {
  CardActionLink,
  CardError,
  CardNewButton,
  CardSkeleton,
  OverviewCard,
} from "./OverviewCard";
import "./RunsCard.css";

const CARD_LIMIT = 5;
const LOAD_ERROR = "Couldn't load runs. Check your connection and retry.";
const READ_ONLY_REASON = "Only Admins and Leads can create runs.";

type State =
  | { kind: "loading" }
  | { kind: "ready"; rows: Run[]; planNames: Record<string, string> }
  | { kind: "error"; message: string };

export interface RunsCardProps {
  projectId: string;
  canCreate: boolean;
  /** Bumped by the page after a create so this card refetches. */
  refreshToken: number;
  /** Ask the page to refresh both cards after a create here. */
  onChanged: () => void;
}

export function RunsCard({
  projectId,
  canCreate,
  refreshToken,
  onChanged,
}: RunsCardProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  // A project switch must not leave this project's dialog open on the next one.
  const [renderedProjectId, setRenderedProjectId] = useState(projectId);
  if (renderedProjectId !== projectId) {
    setRenderedProjectId(projectId);
    setCreating(false);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      // A refresh keeps the rows on screen (and marks the card busy) instead of
      // flashing a skeleton after every save.
      setState((current) =>
        current.kind === "ready" ? current : { kind: "loading" }
      );
      setRefreshing(true);
      try {
        const [runsPage, plansPage] = await Promise.all([
          api.listRuns(projectId, {
            sort: "-created_at",
            page: 1,
            limit: CARD_LIMIT,
          }),
          // Plan names are decorative here: a failure falls back to "—".
          api.listPlans(projectId, { page: 1, limit: 100 }).catch(() => null),
        ]);
        if (!active) return;
        const planNames: Record<string, string> = {};
        for (const plan of plansPage?.data ?? []) planNames[plan.id] = plan.name;
        setState({ kind: "ready", rows: runsPage.data, planNames });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setState({
          kind: "error",
          message: err instanceof ApiError ? err.message || LOAD_ERROR : LOAD_ERROR,
        });
      } finally {
        if (active) setRefreshing(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, retry, refreshToken]);

  return (
    <OverviewCard
      title="Test runs"
      className="ov-runs-card"
      busy={refreshing}
      action={
        <div className="ov-card-actions">
          {canCreate && (
            <CardNewButton label="New run" onClick={() => setCreating(true)} />
          )}
          <CardActionLink href={`/runs?project=${encodeURIComponent(projectId)}`}>
            View all runs
          </CardActionLink>
        </div>
      }
    >
      {state.kind === "loading" && <CardSkeleton rows={3} />}

      {state.kind === "error" && (
        <CardError message={state.message} onRetry={() => setRetry((n) => n + 1)} />
      )}

      {state.kind === "ready" && state.rows.length === 0 && (
        <div className="ov-empty">
          <p>No runs yet. Create a run to start recording results.</p>
          {!canCreate && (
            <p className="muted ov-card-readonly" title={READ_ONLY_REASON}>
              {READ_ONLY_REASON}
            </p>
          )}
        </div>
      )}

      {state.kind === "ready" && state.rows.length > 0 && (
        <ul className="ov-runs-list">
          {state.rows.map((run) => {
            const recorded = run.counts.total - run.counts.untested;
            const planName = run.plan_id ? state.planNames[run.plan_id] : null;
            return (
              <li key={run.id}>
                <Link
                  className="ov-run-row"
                  href={`/runs/${encodeURIComponent(run.id)}?project=${encodeURIComponent(projectId)}`}
                >
                  <span className="ov-run-head">
                    <span className="ov-run-name">{run.name}</span>
                    <span
                      className={`ov-run-status ov-run-status-${run.status}`}
                    >
                      {RUN_STATUS_LABELS[run.status]}
                    </span>
                  </span>
                  <span className="ov-run-meta">
                    <span>Plan: {planName ?? "—"}</span>
                    <span>Milestone: {run.milestone_name ?? "—"}</span>
                    <span>
                      Due:{" "}
                      {run.due_date ? (
                        <time dateTime={run.due_date}>
                          {formatDateOnly(run.due_date)}
                        </time>
                      ) : (
                        "—"
                      )}
                    </span>
                  </span>
                  <span className="ov-run-progress">
                    <span className="ov-run-count">
                      {recorded} of {run.counts.total}
                    </span>
                    <StatusBar counts={run.counts} />
                    <span className="ov-run-percent">
                      {run.counts.percent_complete}% complete
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <NewRunDialog
          projectId={projectId}
          onCreated={() => {
            setCreating(false);
            onChanged();
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </OverviewCard>
  );
}