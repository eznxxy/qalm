"use client";

/**
 * Plan detail (docs/backlog-slice3-plans-runs.md card 3.3). A plan is a thin
 * container over runs, so this screen is the plan's own fields plus a rollup and
 * a read-only list of its runs.
 *
 * The Runs table is the runs list's table, minus the Plan column (docs/DESIGN.md
 * §4.3): the columns come from @/components/runs/runTable, so a column added or
 * re-ordered on the runs screen cannot leave this copy behind. Sorting stays
 * off — it would be client-side over one page of rows, while the runs list sorts
 * on the server through ?sort=.
 *
 * Runs are fetched from the runs list with `plan_id=<id>` as the contract
 * prescribes (docs/api-plans.md § GET /plans/:id — runs are not embedded).
 *
 * Nothing here writes: create/edit/delete live on the plans list, where the
 * role-gated controls and the delete confirmation already are.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { Plan, Run } from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { formatDateOnly } from "@/lib/dates";
import { DataTable, StatusBar, TableSkeleton } from "@/components/ui";
import {
  RUN_TABLE_NO_PLAN_CLASS,
  runTableColumns,
} from "@/components/runs/runTable";
import "./plan-detail.css";

/** One page of runs is enough for a plan in the MVP; the cap is the API's max. */
const RUNS_LIMIT = 100;

type PlanState =
  | { kind: "loading" }
  | { kind: "ready"; plan: Plan }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type RunsState =
  | { kind: "loading" }
  | { kind: "ready"; rows: Run[]; total: number }
  | { kind: "error"; message: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message || fallback : fallback;
}

export default function PlanDetailPage() {
  const router = useRouter();
  const routeParams = useParams();
  const rawId = routeParams.id;
  const planId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");
  const searchParams = useSearchParams();
  const urlProject = searchParams.get("project");

  const [planState, setPlanState] = useState<PlanState>({ kind: "loading" });
  const [planRetry, setPlanRetry] = useState(0);

  useEffect(() => {
    if (!planId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setPlanState({ kind: "loading" });
      try {
        const plan = await api.getPlan(planId);
        if (active) setPlanState({ kind: "ready", plan });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        if (err instanceof ApiError && err.status === 404) {
          setPlanState({ kind: "not-found" });
        } else {
          setPlanState({
            kind: "error",
            message: errorMessage(
              err,
              "Couldn't load the plan. Check your connection and retry."
            ),
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [planId, planRetry]);

  const plan = planState.kind === "ready" ? planState.plan : null;
  const runPlanId = plan?.id ?? "";
  const runProjectId = plan?.project_id ?? "";

  const [runsState, setRunsState] = useState<RunsState>({ kind: "loading" });
  const [runsRetry, setRunsRetry] = useState(0);

  useEffect(() => {
    if (!runPlanId || !runProjectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setRunsState({ kind: "loading" });
      try {
        const result = await api.listRuns(runProjectId, {
          plan_id: runPlanId,
          limit: RUNS_LIMIT,
          sort: "-created_at",
        });
        if (!active) return;
        setRunsState({
          kind: "ready",
          rows: result.data,
          total: result.meta?.total ?? result.data.length,
        });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setRunsState({
          kind: "error",
          message: errorMessage(
            err,
            "Couldn't load this plan's runs. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [runPlanId, runProjectId, runsRetry]);

  const projectId = runProjectId || (urlProject ?? "");
  const runsHref = projectId
    ? `/runs?project=${encodeURIComponent(projectId)}`
    : "/runs";
  const plansHref = projectId
    ? `/plans?project=${encodeURIComponent(projectId)}`
    : "/plans";

  if (planState.kind === "loading") {
    return (
      <div className="page plan-detail-page" aria-busy="true">
        <p className="pd-back">
          <Link href={plansHref}>← Test plans</Link>
        </p>
        <p className="pd-subtitle">Loading plan…</p>
        <TableSkeleton rows={5} columns={6} label="Loading plan runs" />
      </div>
    );
  }

  if (planState.kind === "not-found") {
    return (
      <div className="page plan-detail-page">
        <div className="panel panel-error" role="alert">
          <h1>Plan not found</h1>
          <p>This plan does not exist, or it was deleted.</p>
          <p>
            <Link href={plansHref}>Back to test plans</Link>
          </p>
        </div>
      </div>
    );
  }

  if (planState.kind === "error") {
    return (
      <div className="page plan-detail-page">
        <div className="panel panel-error" role="alert">
          <h1>Couldn&apos;t load the plan</h1>
          <p>{planState.message}</p>
          <p>
            <button type="button" onClick={() => setPlanRetry((n) => n + 1)}>
              Retry
            </button>
          </p>
        </div>
      </div>
    );
  }

  const thePlan = planState.plan;
  const rows = runsState.kind === "ready" ? runsState.rows : [];
  const runTotal = runsState.kind === "ready" ? runsState.total : 0;

  // Same columns as the runs list; no Plan column (every row is this plan),
  // and no sort control (see the file header).
  const columns = runTableColumns({
    onOpenRun: (run) =>
      router.push(
        projectId
          ? `/runs/${run.id}?project=${encodeURIComponent(projectId)}`
          : `/runs/${run.id}`
      ),
  });

  return (
    <div className="page plan-detail-page">
      <p className="pd-back">
        <Link href={plansHref}>← Test plans</Link>
      </p>

      <div className="pd-heading">
        <h1 className="pd-title">{thePlan.name}</h1>
        {thePlan.due_date && (
          <p className="pd-due">
            Due <time dateTime={thePlan.due_date}>{formatDateOnly(thePlan.due_date)}</time>
          </p>
        )}
      </div>

      {thePlan.description && (
        <p className="pd-description">{thePlan.description}</p>
      )}

      <div className="pd-summary">
        {thePlan.counts.total > 0 ? (
          <StatusBar counts={thePlan.counts} label={thePlan.name} />
        ) : null}
        <p className="pd-headline">
          {thePlan.counts.percent_complete}% complete · {thePlan.counts.total}{" "}
          item{thePlan.counts.total === 1 ? "" : "s"} · {thePlan.run_count} run
          {thePlan.run_count === 1 ? "" : "s"}
        </p>
      </div>

      <section className="pd-section" aria-labelledby="pd-runs-heading">
        <h2 id="pd-runs-heading">Runs</h2>
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          className={RUN_TABLE_NO_PLAN_CLASS}
          caption={`Runs in ${thePlan.name}`}
          ariaLabel="Plan runs"
          loading={runsState.kind === "loading"}
          error={runsState.kind === "error" ? runsState.message : null}
          onRetry={() => setRunsRetry((n) => n + 1)}
          emptyTitle="No runs in this plan yet."
          emptyBody="Create a run and pick this plan, and it will show up here."
          emptyAction={
            <Link href={runsHref} className="button-link">
              Go to runs
            </Link>
          }
          rowHeight="default"
        />
        {runTotal > rows.length && (
          <p className="pd-hint">
            Showing the newest {rows.length} of {runTotal} runs.{" "}
            <Link href={runsHref}>See all runs</Link>.
          </p>
        )}
      </section>
    </div>
  );
}