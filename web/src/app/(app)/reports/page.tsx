"use client";

/**
 * Project reports (docs/DESIGN.md §4.9, docs/PRD-reports.md). One aggregate
 * request per URL state; the URL is the source of truth for window, filters
 * and page.
 *
 * Two clocks, never blurred: the tiles and the failures card describe results
 * recorded in the window; the progress table describes where each run stands
 * now, with window activity beside it.
 *
 * Read-only for every role. An archived project renders for an Admin and is a
 * 404 for everyone else (the server's rule), so there is no separate banner.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Milestone, Plan, Project, ReportSummary } from "@/lib/api-types";
import { ApiError } from "@/lib/api-error";
import { api } from "@/lib/endpoints";
import { isSessionDead } from "@/components/require-auth";
import {
  formatPassRate,
  trendWindowLabel,
  TREND_WINDOWS,
  type TrendWindow,
} from "@/lib/trend-window";
import {
  DEFAULT_REPORT_DAYS,
  parseReportParams,
  patchReportParams,
  type ReportUrlPatch,
} from "@/lib/report-url";
import { FailuresChart } from "@/components/reports/FailuresChart";
import { ProgressTable } from "@/components/reports/ProgressTable";
import "./reports.css";

const PAGE_SIZE = 25;

/** One request, one message: the screen never guesses why a read failed. */
const REPORT_ERROR =
  "Couldn't load this report. Check your connection and retry.";

/** "today" / "last 30 days" — the window sub-line under both trend tiles. */
function windowSubline(days: number): string {
  return days === 1 ? "today" : `last ${days} days`;
}

type ProjectState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; project: Project }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type ReportState =
  | { kind: "loading" }
  | { kind: "ready"; summary: ReportSummary }
  | { kind: "error"; message: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message || fallback : fallback;
}

export default function ReportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const url = useMemo(
    () => parseReportParams(new URLSearchParams(searchKey)),
    [searchKey]
  );
  const urlProject = searchParams.get("project");

  // ---- project ----
  const [projectState, setProjectState] = useState<ProjectState>({
    kind: "loading",
  });
  const [projectRetry, setProjectRetry] = useState(0);

  useEffect(() => {
    if (!urlProject) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setProjectState({ kind: "loading" });
      try {
        const project = await api.getProject(urlProject);
        if (active) setProjectState({ kind: "ready", project });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        if (err instanceof ApiError && err.status === 404) {
          setProjectState({ kind: "not-found" });
        } else {
          setProjectState({
            kind: "error",
            message: errorMessage(
              err,
              "Couldn't load the project. Check your connection and retry."
            ),
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [urlProject, projectRetry]);

  // No ?project= (direct link): resolve the first visible project and put it in
  // the URL so the shell's project-scoped nav agrees with this screen.
  useEffect(() => {
    if (urlProject) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setProjectState({ kind: "loading" });
      try {
        const result = await api.listProjects({ page: 1, limit: 1 });
        if (!active) return;
        const first = result.data[0];
        if (!first) {
          setProjectState({ kind: "none" });
          return;
        }
        setProjectState({ kind: "ready", project: first });
        const params = new URLSearchParams(searchKey);
        params.set("project", first.id);
        router.replace(`/reports?${params.toString()}`, { scroll: false });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setProjectState({
          kind: "error",
          message: errorMessage(
            err,
            "Couldn't load projects. Check your connection and retry."
          ),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [urlProject, projectRetry, searchKey, router]);

  const project = projectState.kind === "ready" ? projectState.project : null;
  const projectId = project?.id ?? "";

  // ---- filter options ----
  // Best effort: the report is the point, and a failed option list only narrows
  // the selects to "All" / "No plan" / "No milestone". The 100 cap is an MVP
  // bound — a project with more plans or milestones than that is out of scope,
  // and the summary request is paginated on its own, so the report itself is
  // unaffected.
  const [plans, setPlans] = useState<Plan[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  // Which project the two lists came from. A switch to another project must
  // not offer the previous project's plans/milestones, not even for a frame.
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      try {
        const [planPage, milestonePage] = await Promise.all([
          api.listPlans(projectId, { page: 1, limit: 100 }),
          api.listMilestones(projectId, { page: 1, limit: 100 }),
        ]);
        if (!active) return;
        setPlans(planPage.data);
        setMilestones(milestonePage.data);
        setOptionsFor(projectId);
      } catch (err) {
        // A session death is already handled by RequireAuth.
        if (isSessionDead(err)) return;
        if (active) {
          setPlans([]);
          setMilestones([]);
          setOptionsFor(projectId);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  // ---- the one request ----
  const [report, setReport] = useState<ReportState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      // A filter/window change on a screen that already has a summary keeps
      // the old numbers visible (and marks them busy) instead of blanking the
      // page back to skeletons. The first load has nothing to keep, and a
      // different project is a different report.
      setReport((previous) =>
        previous.kind === "ready" &&
        previous.summary.project_id === projectId
          ? previous
          : { kind: "loading" }
      );
      setRefreshing(true);
      try {
        const result = await api.getReportSummary(projectId, {
          days: url.days,
          plan_id: url.planId ?? undefined,
          milestone_id: url.milestoneId ?? undefined,
          status: url.status ?? undefined,
          page: url.page,
          limit: PAGE_SIZE,
        });
        if (!active) return;
        setReport({ kind: "ready", summary: result });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setReport({ kind: "error", message: REPORT_ERROR });
      } finally {
        if (active) setRefreshing(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [
    projectId,
    url.days,
    url.planId,
    url.milestoneId,
    url.status,
    url.page,
    retry,
  ]);

  const pushParams = useCallback(
    (patch: ReportUrlPatch) => {
      const params = patchReportParams(new URLSearchParams(searchKey), patch);
      if (projectId && !params.get("project")) params.set("project", projectId);
      const qs = params.toString();
      router.replace(qs ? `/reports?${qs}` : "/reports", { scroll: false });
    },
    [searchKey, router, projectId]
  );

  // A value outside the presets (`?days=3`) parses as the default but stays in
  // the address bar, where the preset that resolves to it already reads as
  // pressed. Comparing the raw parameter lets that click still rewrite the URL.
  const canonicalDays =
    url.days === DEFAULT_REPORT_DAYS ? null : String(url.days);
  const daysParamCanonical = searchParams.get("days") === canonicalDays;

  const selectWindow = useCallback(
    (days: TrendWindow) => {
      // `patchReportParams` clears ?page= on every window change. Re-clicking
      // the preset that is already pressed would therefore send the user back
      // to page 1 without changing the window, so it is a no-op instead —
      // unless the address bar holds a non-canonical value that needs repair.
      if (url.days === days && daysParamCanonical) return;
      pushParams({ days });
    },
    [url.days, daysParamCanonical, pushParams]
  );

  const resetFilters = useCallback(() => {
    pushParams({ planId: null, milestoneId: null, status: null });
  }, [pushParams]);

  const filtersActive = Boolean(url.planId || url.milestoneId || url.status);

  // ---- project-level states ----
  if (projectState.kind === "loading") {
    return <ReportsSkeleton />;
  }

  if (projectState.kind === "none") {
    return (
      <div className="page rep-page">
        <h1>Reports</h1>
        <div className="panel">
          <p>
            <strong>No projects yet.</strong> Create a project to see its
            reports.
          </p>
          <p>
            <Link href="/projects" className="button-link">
              Go to projects
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (projectState.kind === "not-found") {
    return (
      <div className="page rep-page">
        <div className="panel panel-error" role="alert">
          <h1>Project not found</h1>
          <p>
            This project does not exist, or it is archived — archived projects
            are only visible to Admins.
          </p>
          <p>
            <Link href="/projects">Back to projects</Link>
          </p>
        </div>
      </div>
    );
  }

  if (projectState.kind === "error") {
    return (
      <div className="page rep-page">
        <div className="panel panel-error" role="alert">
          <h1>Couldn&apos;t load the project</h1>
          <p>{projectState.message}</p>
          <p>
            <button
              type="button"
              onClick={() => setProjectRetry((n) => n + 1)}
            >
              Retry
            </button>
          </p>
        </div>
      </div>
    );
  }

  // The payload names its project, so a retained summary from the previous
  // project cannot be shown under this one — not even for the first frame.
  const summary =
    report.kind === "ready" && report.summary.project_id === projectId
      ? report.summary
      : null;
  const planOptions = optionsFor === projectId ? plans : [];
  const milestoneOptions = optionsFor === projectId ? milestones : [];
  // The table's empty state and the Runs tile describe the summary they are
  // showing, not the URL: during a filter change the previous summary is still
  // on screen, and the URL has already moved on.
  const summaryFiltered = Boolean(
    summary?.filters.plan_id ||
      summary?.filters.milestone_id ||
      summary?.filters.status
  );

  return (
    <div className="page rep-page">
      <p className="rep-breadcrumb">
        <Link href={`/projects/${projectId}`}>← {project?.name}</Link>
      </p>
      <h1>Reports</h1>

      <div className="rep-filters">
        <div role="group" aria-label="Report window" className="rep-range">
          {TREND_WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={url.days === days}
              aria-label={trendWindowLabel(days)}
              onClick={() => selectWindow(days)}
            >
              {days}d
            </button>
          ))}
        </div>

        <select
          aria-label="Plan"
          value={url.planId ?? ""}
          onChange={(event) =>
            pushParams({ planId: event.target.value || null })
          }
        >
          <option value="">All plans</option>
          {planOptions.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
          {/* A deep link to a plan the list does not have (deleted, or beyond
              the cap) still renders: the select must never lie about the
              filter that is actually applied, and the URL is not rewritten. */}
          {url.planId &&
            url.planId !== "none" &&
            !planOptions.some((plan) => plan.id === url.planId) && (
              <option value={url.planId}>{url.planId}</option>
            )}
          <option value="none">No plan</option>
        </select>

        <select
          aria-label="Milestone"
          value={url.milestoneId ?? ""}
          onChange={(event) =>
            pushParams({ milestoneId: event.target.value || null })
          }
        >
          <option value="">All milestones</option>
          {milestoneOptions.map((milestone) => (
            <option key={milestone.id} value={milestone.id}>
              {milestone.name}
            </option>
          ))}
          {url.milestoneId &&
            url.milestoneId !== "none" &&
            !milestoneOptions.some(
              (milestone) => milestone.id === url.milestoneId
            ) && <option value={url.milestoneId}>{url.milestoneId}</option>}
          <option value="none">No milestone</option>
        </select>

        <select
          aria-label="Status"
          value={url.status ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            pushParams({
              status:
                value === "open" || value === "completed" ? value : null,
            });
          }}
        >
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
        </select>

        {filtersActive && (
          <button type="button" onClick={resetFilters}>
            Reset filters
          </button>
        )}
      </div>

      {report.kind === "error" ? (
        // One request means one error panel — never one per card.
        <div className="panel panel-error" role="alert">
          <p>{report.message}</p>
          <p>
            <button type="button" onClick={() => setRetry((n) => n + 1)}>
              Retry
            </button>
          </p>
        </div>
      ) : report.kind === "loading" || !summary ? (
        <ReportBodySkeleton />
      ) : (
        <>
          {/* While a window/filter/page change is in flight the previous
              summary stays on screen, so every label and every bar-scale
              decision reads the summary — the URL only says what to fetch. */}
          <div className="rep-tiles" aria-busy={refreshing || undefined}>
            <div className="rep-tile" role="group" aria-label="Pass rate">
              <p className="rep-tile-label">Pass rate</p>
              <p className="rep-tile-value">
                {formatPassRate(summary.trend.totals.pass_rate)}
              </p>
              <p className="rep-tile-sub">
                {summary.trend.totals.pass_rate === null
                  ? "No verdicts in this window"
                  : windowSubline(summary.days)}
              </p>
            </div>

            <div
              className="rep-tile"
              role="group"
              aria-label="Results recorded"
            >
              <p className="rep-tile-label">Results recorded</p>
              <p className="rep-tile-value">{summary.trend.totals.total}</p>
              <p className="rep-tile-sub">{windowSubline(summary.days)}</p>
            </div>

            <div className="rep-tile" role="group" aria-label="Runs">
              <p className="rep-tile-label">Runs</p>
              <p className="rep-tile-value">{summary.progress.meta.total}</p>
              <p className="rep-tile-sub">
                {summaryFiltered ? "matching filters" : "in this project"}
              </p>
            </div>

            <div
              className="rep-tile"
              role="group"
              aria-label="Items complete"
            >
              <p className="rep-tile-label">Items complete</p>
              <p className="rep-tile-value">
                {summary.progress.items.percent_complete}%
              </p>
              <p className="rep-tile-sub">
                {summary.progress.items.with_results} of{" "}
                {summary.progress.items.total} items
              </p>
            </div>
          </div>

          <FailuresChart
            projectId={projectId}
            buckets={summary.trend.buckets}
            days={summary.days}
            loading={refreshing}
          />

          <ProgressTable
            projectId={projectId}
            progress={summary.progress}
            page={summary.progress.meta.page}
            onPageChange={(page) => pushParams({ page })}
            filtered={summaryFiltered}
            onClearFilters={resetFilters}
            loading={false}
            // The page-level panel owns the failure: every card shares the one
            // request, so a card-level error would only repeat it.
            error={null}
          />
        </>
      )}
    </div>
  );
}

/** Skeleton tiles and cards — the heading renders immediately. */
function ReportBodySkeleton() {
  return (
    <>
      <div className="rep-tiles" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="rep-tile">
            <span className="rep-skeleton rep-skeleton-tile" aria-hidden="true" />
          </div>
        ))}
      </div>
      <div className="rep-card" aria-busy="true">
        <span
          className="rep-skeleton rep-skeleton-chart"
          aria-hidden="true"
        />
      </div>
      <div className="rep-card" aria-busy="true">
        <span className="rep-skeleton" aria-hidden="true" />
      </div>
    </>
  );
}

function ReportsSkeleton() {
  return (
    <div className="page rep-page" aria-busy="true">
      <h1>Reports</h1>
      <ReportBodySkeleton />
    </div>
  );
}