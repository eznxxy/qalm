"use client";

/**
 * Runs table — the column definitions for a list of runs (docs/DESIGN.md §4.3).
 *
 * Two screens show runs: the project-scoped runs list, and a plan detail page's
 * Runs section (backlog card 3.3). They started out as two hand-written tables
 * and drifted apart, so the columns live here and both callers supply their own
 * row action. The only intended difference is the Plan column: it is noise on a
 * plan's own page, so the caller omits it by omitting `planNames`.
 *
 * Widths are a fixed layout keyed off the root classes below (runTable.css),
 * because with `table-layout: auto` the table hands every spare pixel to the
 * widest columns and a short run name floats in a half-empty cell.
 *
 * Two data gaps, surfaced rather than papered over:
 * - The run resource carries only `plan_id`, so the plan cell is filled from a
 *   caller-built `planId → name` map (falling back to "—").
 * - `assignee_ids` are ids and the API offers no per-project name lookup for
 *   non-Admins, so the assignee cell shows a count.
 */
import type { Run } from "@/lib/api-types";
import { formatDateOnly } from "@/lib/dates";
import { StatusBar, type DataTableColumn } from "@/components/ui";
import "./runTable.css";

/** Root class for the table with the Plan column (the runs list). */
export const RUN_TABLE_CLASS = "run-table run-table--with-plan";

/** Root class for the table without the Plan column (a plan's runs section). */
export const RUN_TABLE_NO_PLAN_CLASS = "run-table run-table--no-plan";

/** `assignee_ids` cannot be resolved to names here (see the file header). */
function assigneeLabel(ids: readonly string[]): string {
  if (ids.length === 0) return "—";
  return `${ids.length} assignee${ids.length === 1 ? "" : "s"}`;
}

export interface RunTableColumnsOptions {
  /** Opens the run detail screen; the name cell is the only row action. */
  onOpenRun: (run: Run) => void;
  /** Plan id → name. Omit to leave the Plan column out. */
  planNames?: ReadonlyMap<string, string>;
  /**
   * Server-side sorting only: the caller owns ?sort= and must pass
   * `sort`/`onSortChange` to DataTable, or the headers lie.
   */
  sortable?: boolean;
}

type SortableProps = Pick<DataTableColumn<Run>, "sortable" | "sortValue">;

export function runTableColumns({
  onOpenRun,
  planNames,
  sortable = false,
}: RunTableColumnsOptions): DataTableColumn<Run>[] {
  const sortProps = (
    value: (row: Run) => string | number | null
  ): SortableProps => (sortable ? { sortable: true, sortValue: value } : {});

  const columns: DataTableColumn<Run>[] = [
    {
      key: "name",
      header: "Name",
      className: "run-col-name",
      ...sortProps((row) => row.name),
      render: (row) => (
        <button
          type="button"
          className="run-title-link"
          aria-label={`Open run ${row.name}`}
          onClick={() => onOpenRun(row)}
        >
          {row.name}
        </button>
      ),
    },
  ];

  if (planNames) {
    columns.push({
      key: "plan",
      header: "Plan",
      className: "run-col-plan",
      render: (row) => (row.plan_id ? (planNames.get(row.plan_id) ?? "—") : "—"),
    });
  }

  columns.push(
    {
      key: "status_bar",
      header: "Status",
      className: "run-col-status",
      render: (row) =>
        row.counts.total > 0 ? (
          <StatusBar counts={row.counts} label={row.name} />
        ) : (
          <span className="muted">No items</span>
        ),
    },
    {
      key: "percent_complete",
      header: "% complete",
      align: "number",
      className: "run-col-percent",
      render: (row) => `${row.counts.percent_complete}%`,
    },
    {
      key: "assignees",
      header: "Assignees",
      className: "run-col-assignees",
      render: (row) => assigneeLabel(row.assignee_ids),
    },
    {
      key: "start_date",
      header: "Start date",
      className: "run-col-start",
      ...sortProps((row) => row.start_date),
      render: (row) =>
        row.start_date ? (
          <time dateTime={row.start_date}>
            {formatDateOnly(row.start_date)}
          </time>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: "due_date",
      header: "Due date",
      className: "run-col-due",
      ...sortProps((row) => row.due_date),
      render: (row) =>
        row.due_date ? (
          <time dateTime={row.due_date}>{formatDateOnly(row.due_date)}</time>
        ) : (
          <span className="muted">—</span>
        ),
    }
  );

  return columns;
}