"use client";

/**
 * Milestones table — the columns for the project's milestones list
 * (docs/DESIGN.md §4.5, backlog card 3.1).
 *
 * The list is the "what is coming up" screen: name, run count, derived status,
 * `% complete` with the status bar, due date, days left and the write actions.
 * `status` and `counts` are derived by the API, so this table renders them and
 * never computes a milestone's completion itself (docs/api-milestones.md).
 *
 * Days left is the one number the web owns: it comes from `due_date` through
 * @/lib/dates, because a plain calendar date must never be parsed as an instant
 * (DESIGN §9).
 */
import type { Milestone } from "@/lib/api-types";
import { MILESTONE_STATUS_LABELS } from "@/lib/api-types";
import { formatDateOnly, formatDaysLeft } from "@/lib/dates";
import { StatusBar, type DataTableColumn } from "@/components/ui";
import "./milestoneTable.css";

/** Root class for the milestones list table. */
export const MILESTONE_TABLE_CLASS = "milestone-table";

type SortableProps = Pick<DataTableColumn<Milestone>, "sortable" | "sortValue">;

export interface MilestoneTableColumnsOptions {
  /** Opens the milestone detail screen; the name cell is the row action. */
  onOpenMilestone: (milestone: Milestone) => void;
  /** Writes are Admin/Lead; the caller hides both actions when false. */
  canWrite?: boolean;
  onEdit?: (milestone: Milestone) => void;
  onDelete?: (milestone: Milestone) => void;
  /**
   * Server-side sorting only: the caller owns ?sort= and must pass
   * `sort`/`onSortChange` to DataTable, or the headers lie.
   */
  sortable?: boolean;
}

export function milestoneTableColumns({
  onOpenMilestone,
  canWrite = false,
  onEdit,
  onDelete,
  sortable = false,
}: MilestoneTableColumnsOptions): DataTableColumn<Milestone>[] {
  const sortProps = (
    value: (row: Milestone) => string | number | null
  ): SortableProps => (sortable ? { sortable: true, sortValue: value } : {});

  const showActions = canWrite && (onEdit || onDelete);

  const columns: DataTableColumn<Milestone>[] = [
    {
      key: "name",
      header: "Name",
      className: "ms-col-name",
      ...sortProps((row) => row.name),
      render: (row) => (
        <button
          type="button"
          className="ms-title-link"
          aria-label={`Open milestone ${row.name}`}
          onClick={() => onOpenMilestone(row)}
        >
          {row.name}
        </button>
      ),
    },
    {
      key: "runs",
      header: "Runs",
      align: "number",
      className: "ms-col-runs",
      render: (row) => row.run_count,
    },
    {
      key: "status",
      header: "Status",
      className: "ms-col-status",
      render: (row) => (
        <span className={`ms-status ms-status-${row.status}`}>
          {MILESTONE_STATUS_LABELS[row.status]}
        </span>
      ),
    },
    {
      key: "percent_complete",
      header: "% complete",
      className: "ms-col-percent",
      render: (row) =>
        row.counts.total > 0 ? (
          <span className="ms-progress">
            <StatusBar counts={row.counts} label={row.name} />
            <span className="ms-progress-value">
              {row.counts.percent_complete}%
            </span>
          </span>
        ) : (
          <span className="muted">No runs</span>
        ),
    },
    {
      key: "due_date",
      header: "Due date",
      className: "ms-col-due",
      ...sortProps((row) => row.due_date),
      render: (row) =>
        row.due_date ? (
          <time dateTime={row.due_date}>{formatDateOnly(row.due_date)}</time>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: "days_left",
      header: "Days left",
      className: "ms-col-days",
      render: (row) => {
        const label = formatDaysLeft(row.due_date);
        return label ? (
          <span className={label.endsWith("late") ? "ms-days-late" : undefined}>
            {label}
          </span>
        ) : (
          <span className="muted">—</span>
        );
      },
    },
  ];

  if (showActions) {
    columns.push({
      key: "actions",
      header: "Actions",
      className: "ms-col-actions",
      render: (row) => (
        <span className="ms-row-actions">
          {onEdit && (
            <button
              type="button"
              className="ms-action"
              aria-label={`Edit ${row.name}`}
              onClick={() => onEdit(row)}
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="ms-action ms-action-danger"
              aria-label={`Delete ${row.name}`}
              onClick={() => onDelete(row)}
            >
              Delete
            </button>
          )}
        </span>
      ),
    });
  }

  return columns;
}