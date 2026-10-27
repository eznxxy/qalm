"use client";

/**
 * Test Runs card (docs/DESIGN.md §4.8, docs/api-runs.md).
 *
 * The five newest runs in this project, newest first, with plan, milestone,
 * run status and progress. The run resource carries `plan_id` but no plan name,
 * so names come from the project's plans list; if that fetch fails every plan
 * cell falls back to `—` rather than failing the card.
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
import {
  CardActionLink,
  CardCreateShortcut,
  CardError,
  CardSkeleton,
  OverviewCard,
} from "./OverviewCard";
import "./RunsCard.css";

const CARD_LIMIT = 5;
const LOAD_ERROR = "Couldn't load runs. Check your connection and retry.";

type State =
  | { kind: "loading" }
  | { kind: "ready"; rows: Run[]; planNames: Record<string, string> }
  | { kind: "error"; message: string };

export interface RunsCardProps {
  projectId: string;
  canCreate: boolean;
}

export function RunsCard({ projectId, canCreate }: RunsCardProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setState({ kind: "loading" });
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
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, retry]);

  return (
    <OverviewCard
      title="Test runs"
      className="ov-runs-card"
      action={
        <CardActionLink href={`/runs?project=${encodeURIComponent(projectId)}`}>
          View all runs
        </CardActionLink>
      }
    >
      {state.kind === "loading" && <CardSkeleton rows={3} />}

      {state.kind === "error" && (
        <CardError message={state.message} onRetry={() => setRetry((n) => n + 1)} />
      )}

      {state.kind === "ready" && state.rows.length === 0 && (
        <div className="ov-empty">
          <p>No runs yet. Create a run to start recording results.</p>
          <CardCreateShortcut
            href={`/runs?project=${encodeURIComponent(projectId)}&new=1`}
            label="New run"
            reason="Only Admins and Leads can create runs."
            canWrite={canCreate}
          />
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
    </OverviewCard>
  );
}