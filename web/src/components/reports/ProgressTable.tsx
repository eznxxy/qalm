"use client";

/**
 * Progress per run (docs/DESIGN.md §4.9, docs/PRD-reports.md § Progress per
 * run). The table shows each run's **current** state; only the Activity cell
 * follows the window. Order is the server's (open first, due date, name) and
 * is deliberately not sortable: the contract fixes it.
 *
 * Pagination lives here because it is table-scoped: the tiles and the items
 * rollup cover every filtered run and do not change with the page.
 *
 * §4.9 uses an em dash (—, U+2014) for every missing value on this screen —
 * plan, milestone, due date and pass rate — so the four placeholders are
 * visually identical. This is deliberately not the runs table's ASCII `-`.
 */
import Link from "next/link";
import type { ProgressRun, ReportProgress } from "@/lib/api-types";
import { formatDateOnly, formatRelativeTime } from "@/lib/dates";
import { formatPassRate } from "@/lib/trend-window";
import {
  DataTable,
  DisabledHint,
  StatusBar,
  type DataTableColumn,
} from "@/components/ui";
import "./ProgressTable.css";

export interface ProgressTableProps {
  projectId: string;
  progress: ReportProgress;
  page: number;
  onPageChange: (page: number) => void;
  /** True when plan/milestone/status narrow the set. */
  filtered: boolean;
  onClearFilters: () => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

/** "38 in window · 2 h ago" / "No results in window" / "No results yet". */
export function activityText(run: ProgressRun, now?: Date): string {
  if (run.last_result_at === null) return "No results yet";
  if (run.results_in_window === 0) return "No results in window";
  const relative = formatRelativeTime(run.last_result_at, { now });
  return `${run.results_in_window} in window · ${relative}`;
}

function columns(projectId: string): ReadonlyArray<DataTableColumn<ProgressRun>> {
  return [
    {
      key: "run",
      header: "Run",
      render: (run) => (
        <Link href={`/runs/${run.id}?project=${encodeURIComponent(projectId)}`}>
          {run.name}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (run) => (
        <span className={`rep-run-state rep-run-state-${run.status}`}>
          {run.status === "completed" ? "Completed" : "Open"}
        </span>
      ),
    },
    { key: "plan", header: "Plan", render: (run) => run.plan_name ?? "—" },
    {
      key: "milestone",
      header: "Milestone",
      render: (run) => run.milestone_name ?? "—",
    },
    {
      key: "due",
      header: "Due",
      render: (run) => (run.due_date ? formatDateOnly(run.due_date) : "—"),
    },
    {
      key: "progress",
      header: "Progress",
      render: (run) => (
        <span className="rep-progress">
          <span className="rep-progress-count">
            {run.counts.total - run.counts.untested} of {run.counts.total}
          </span>
          <StatusBar counts={run.counts} label={run.name} />
          <span className="rep-progress-percent">
            {run.counts.percent_complete}% complete
          </span>
        </span>
      ),
    },
    {
      key: "rate",
      header: "Pass rate",
      align: "number",
      render: (run) => formatPassRate(run.pass_rate),
    },
    {
      key: "activity",
      header: "Activity",
      render: (run) => <span className="rep-activity">{activityText(run)}</span>,
    },
  ];
}

export function ProgressTable({
  projectId,
  progress,
  page,
  onPageChange,
  filtered,
  onClearFilters,
  loading = false,
  error = null,
  onRetry,
}: ProgressTableProps) {
  const { data, meta } = progress;
  const pastEnd = !loading && !error && data.length === 0 && meta.total > 0;

  const emptyTitle = loading
    ? null
    : pastEnd
      ? "No runs on this page."
      : filtered
        ? "No runs match these filters."
        : "No runs in this project yet.";

  const emptyAction = loading ? null : pastEnd ? (
    <button type="button" onClick={() => onPageChange(1)}>
      Go to page 1
    </button>
  ) : filtered ? (
    <button type="button" onClick={onClearFilters}>
      Clear filters
    </button>
  ) : (
    <Link href={`/runs?project=${encodeURIComponent(projectId)}`}>
      Go to Test runs
    </Link>
  );

  return (
    <section
      className="rep-card rep-progress-card"
      aria-labelledby="rep-progress-title"
    >
      <div className="rep-card-head">
        <h2 id="rep-progress-title">Progress per run</h2>
        <span className="rep-count">
          {meta.total} matching {meta.total === 1 ? "run" : "runs"}
        </span>
      </div>

      <DataTable
        className="rep-progress-table"
        columns={columns(projectId)}
        rows={data}
        getRowId={(run) => run.id}
        caption="Progress of runs matching the report filters"
        loading={loading}
        error={error}
        onRetry={onRetry}
        emptyTitle={emptyTitle ?? undefined}
        emptyAction={emptyAction ?? undefined}
      />

      {meta.total_pages > 1 && (
        // Reuses the runs page's shipped format ("Page p of n (x runs)") so the
        // two list screens read the same; the PRD's "Page p of n" is a substring.
        <nav className="pagination" aria-label="Report pages">
          <DisabledHint
            hint={page <= 1 ? "You are on the first page" : "Go to the previous page"}
          >
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >
              Previous
            </button>
          </DisabledHint>
          <span>
            Page {meta.page} of {meta.total_pages} ({meta.total} runs)
          </span>
          <DisabledHint
            hint={
              page >= meta.total_pages ? "You are on the last page" : "Go to the next page"
            }
          >
            <button
              type="button"
              disabled={page >= meta.total_pages}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </button>
          </DisabledHint>
        </nav>
      )}
    </section>
  );
}