"use client";

/**
 * Runs table — the column definitions for a list of runs (docs/DESIGN.md §4.3).
 *
 * Three screens show runs: the project-scoped runs list, a plan detail page's
 * Runs section (backlog card 3.3), and a milestone's Runs section (card 3.1).
 * They started out as hand-written tables and drifted apart, so the columns
 * live here and every caller supplies its own row action. The intended
 * differences are the Plan and Milestone columns: Plan is noise on a plan's own
 * page and Milestone is noise on a milestone's own page, so a caller drops one
 * by omitting its inputs (docs/DESIGN.md §4.3/§4.5).
 *
 * Widths are a fixed layout keyed off the root classes below (runTable.css),
 * because with `table-layout: auto` the table hands every spare pixel to the
 * widest columns and a short run name floats in a half-empty cell.
 *
 * Two data gaps, surfaced rather than papered over:
 * - The run resource carries only `plan_id`, so the plan cell is filled from a
 *   caller-built `planId → name` map (falling back to "—"), and the caller's
 *   `onOpenPlan` turns that cell into the way into a plan's detail screen.
 *   `milestone_name` is joined by the API, so the milestone cell needs no map.
 * - `assignee_ids` are ids and the API offers no per-project name lookup for
 *   non-Admins, so the assignee cell shows a count.
 */
import type { Run } from "@/lib/api-types";
import { formatDateOnly } from "@/lib/dates";
import { StatusBar, type DataTableColumn } from "@/components/ui";
import "./runTable.css";

/** Root class for the full table: Plan and Milestone (the runs list). */
export const RUN_TABLE_CLASS = "run-table run-table--with-plan";

/** Root class for the table without the Plan column (a plan's runs section). */
export const RUN_TABLE_NO_PLAN_CLASS = "run-table run-table--no-plan";

/**
 * Root class for a milestone's runs section: the runs table without the
 * Milestone column (every row would repeat the page title), with room for the
 * per-row Remove action.
 */
export const RUN_TABLE_MILESTONE_CLASS = "run-table run-table--milestone-runs";

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
   * Opens the plan detail screen from the Plan cell. The plans list is gone
   * (card 3.6: plans are created from the runs screen), so this cell is the
   * only way into a plan without its id — omit only where the column is absent.
   */
  onOpenPlan?: (planId: string) => void;
  /**
   * Opens the milestone detail screen from the Milestone cell. Pass along with
   * `showMilestone` to include the column.
   */
  onOpenMilestone?: (milestoneId: string) => void;
  /** Include the Milestone column (`milestone_name` is already on the run). */
  showMilestone?: boolean;
  /**
   * Adds an Actions column with one text button per row — a milestone's
   * "Remove from milestone" is the only such action today. Pair it with
   * `RUN_TABLE_MILESTONE_CLASS`, which makes room for the column.
   */
  rowAction?: {
    label: string;
    ariaLabel: (run: Run) => string;
    onClick: (run: Run) => void;
    /** Renders the button in the danger colour (destructive-ish detach). */
    danger?: boolean;
  };
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
  onOpenPlan,
  onOpenMilestone,
  showMilestone = false,
  rowAction,
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
      render: (row) => {
        const planId = row.plan_id;
        const name = planId ? planNames.get(planId) : undefined;
        if (!planId || !name) return "—";
        if (!onOpenPlan) return name;
        return (
          <button
            type="button"
            className="run-title-link"
            aria-label={`Open plan ${name}`}
            onClick={() => onOpenPlan(planId)}
          >
            {name}
          </button>
        );
      },
    });
  }

  if (showMilestone) {
    columns.push({
      key: "milestone",
      header: "Milestone",
      className: "run-col-milestone",
      render: (row) => {
        const id = row.milestone_id;
        const name = row.milestone_name;
        if (!id || !name) return <span className="muted">—</span>;
        if (!onOpenMilestone) return name;
        return (
          <button
            type="button"
            className="run-title-link"
            aria-label={`Open milestone ${name}`}
            onClick={() => onOpenMilestone(id)}
          >
            {name}
          </button>
        );
      },
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

  if (rowAction) {
    columns.push({
      key: "actions",
      header: "Actions",
      className: "run-col-actions",
      render: (row) => (
        <button
          type="button"
          className={`run-row-action${
            rowAction.danger ? " run-row-action-danger" : ""
          }`}
          aria-label={rowAction.ariaLabel(row)}
          onClick={() => rowAction.onClick(row)}
        >
          {rowAction.label}
        </button>
      ),
    });
  }

  return columns;
}