"use client";

/**
 * DataTable — the shared data-table primitive (docs/DESIGN.md §5 "Data
 * table", §2.5 row heights, §6 states, §8 accessibility floor).
 *
 * - Real <table> with a sticky header; header cells 13/18 w600 ink-700,
 *   sentence case (the caller's header strings are used verbatim).
 * - Sortable columns: the header control is a real <button>, so it is
 *   keyboard operable for free; state is exposed via aria-sort on the <th>
 *   plus "Sorted ascending by X" / "Sorted descending by X" hints for
 *   screen readers, and a fixed-width glyph (▲/▼/↕) so the header never
 *   shifts layout.
 * - Row heights: 36 default, 32 compact, 44 comfortable (§2.5) via
 *   `rowHeight`; hover --canvas; selected row --brand-tint (§5).
 * - Optional row selection with a header checkbox (indeterminate via the
 *   aria-indeterminate attribute AND the DOM property) — Space toggles it
 *   when focused, like any checkbox.
 * - Numeric columns get .dt-cell-number (right-aligned, tabular-nums).
 * - Below 768px the table scrolls horizontally inside .dt-root, never the
 *   page body (§3).
 * - All §6 states: loading (row-shaped skeletons, no spinners), empty
 *   (message + action), error (message + Retry).
 *
 * Virtualisation: deliberately not implemented — see the handoff note on
 * card t_e3495ddb. Both current consumers paginate server-side at 25 rows,
 * far below the 200-row threshold in §5. The component sorts a shallow
 * copy (never the caller's array) so it stays O(n log n) per sort with no
 * windowing complexity until a real need appears.
 *
 * This is a controlled-ish component: when `sort`/`onSortChange` are both
 * given, sorting state is fully controlled; otherwise the primitive keeps
 * its own state seeded from `defaultSort`.
 *
 * Styling: DataTable.css (imported once here) consumes the design tokens
 * from src/styles/tokens.css — no colour values are hard-coded.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import "./DataTable.css";
// Design tokens (§2). Card t_62938355 owns the real tokens.css and imports
// it app-wide in layout.tsx; the primitive also imports it directly so it
// stays self-sufficient (demo pages, tests, future embedding) even where
// the global import is absent.
import "../../styles/tokens.css";

/** Direction of an active sort. */
export type SortDir = "asc" | "desc";

export interface DataTableSort {
  /** Column key of the active sort. */
  key: string;
  dir: SortDir;
}

export interface DataTableColumn<T> {
  /** Stable key; also the sort identity. */
  key: string;
  /** Sentence-case header text, rendered verbatim. */
  header: string;
  /** Enable the sort control for this column. */
  sortable?: boolean;
  /**
   * Extract the sort key from a row. Required for sortable columns.
   * Strings compare with localeCompare, numbers numerically, booleans
   * false<true; null/undefined sort last in both directions.
   */
  sortValue?: (row: T) => string | number | boolean | null | undefined;
  /** "number" right-aligns the cell with tabular figures. */
  align?: "left" | "number";
  /** Extra class for every body cell in this column (cell-scoped styling). */
  className?: string;
  /** Cell content. Defaults to String(row[colKey]) — provide render for JSX. */
  render?: (row: T) => ReactNode;
  /** Screen-reader-only hint appended to the header button label. */
  description?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  /** Stable row identity for keys and selection. */
  getRowId: (row: T) => string;
  /** Caption announced to screen readers; visually hidden. */
  caption: string;
  /** Accessible name for the table element itself. */
  ariaLabel?: string;

  /** §6 loading: renders row-shaped skeletons instead of body rows. */
  loading?: boolean;
  /** §6 error: message + Retry (retryLabel defaults to "Retry"). */
  error?: string | null;
  retryLabel?: string;
  onRetry?: () => void;
  /** §6 empty: what belongs here + how to add it (DESIGN.md §5). */
  emptyTitle?: ReactNode;
  emptyBody?: ReactNode;
  /** The single primary action of the empty state. */
  emptyAction?: ReactNode;

  /** Row height token: 36 (default) / 32 compact / 44 comfortable (§2.5). */
  rowHeight?: "default" | "compact" | "comfortable";

  /** Show the selection column (header checkbox + per-row checkboxes). */
  selectable?: boolean;
  /** Controlled selection: ids of selected rows. */
  selectedIds?: ReadonlySet<string>;
  /** Called with the new id set after any selection change. */
  onSelectedIdsChange?: (ids: Set<string>) => void;

  /** Controlled sort state. */
  sort?: DataTableSort | null;
  /** Initial sort for the uncontrolled variant. */
  defaultSort?: DataTableSort | null;
  /** Sort changes (both controlled and uncontrolled variants). */
  onSortChange?: (sort: DataTableSort | null) => void;

  /** Disable all interactions (e.g. while a bulk action is in flight). */
  disabled?: boolean;
  /**
   * Extra class on every body <tr> (e.g. "row-muted" for deactivated
   * rows). Row-scoped, so it composes with .dt-row-selected — the muted
   * colours apply to text, selection stays visible.
   */
  rowClassName?: (row: T) => string | undefined;
  className?: string;
}

const ROW_HEIGHT_VAR: Record<
  NonNullable<DataTableProps<unknown>["rowHeight"]>,
  string
> = {
  default: "var(--row-height)",
  compact: "var(--row-height-compact)",
  comfortable: "var(--row-height-comfortable)",
};

const STATUS_ROW_MIN_ROWS = 3;

function compareSortValues(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined
): number {
  // null/undefined sort last regardless of direction (handled by caller).
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return a === b ? 0 : a ? 1 : -1;
  return String(a).localeCompare(String(b));
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  ariaLabel,
  loading = false,
  error = null,
  retryLabel = "Retry",
  onRetry,
  emptyTitle = "No rows to show.",
  emptyBody,
  emptyAction,
  rowHeight = "default",
  selectable = false,
  selectedIds,
  onSelectedIdsChange,
  sort,
  defaultSort = null,
  onSortChange,
  disabled = false,
  rowClassName,
  className,
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = useState<DataTableSort | null>(
    defaultSort
  );
  const activeSort = sort !== undefined ? sort : internalSort;
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const [rowFocus, setRowFocus] = useState<number | null>(null);

  const selected = useMemo(
    () => selectedIds ?? new Set<string>(),
    [selectedIds]
  );
  const rowIds = useMemo(() => rows.map(getRowId), [rows, getRowId]);
  const selectedCount = useMemo(
    () => rowIds.filter((id) => selected.has(id)).length,
    [rowIds, selected]
  );
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectedCount > 0 && !allSelected;

  // The indeterminate state is presentation-only (CSS cannot express it and
  // it is not a boolean attribute), so it is set via the DOM property.
  useEffect(() => {
    const el = headerCheckboxRef.current;
    if (el) el.indeterminate = someSelected;
  }, [someSelected]);

  function applySort(next: DataTableSort | null) {
    if (onSortChange) onSortChange(next);
    else setInternalSort(next);
  }

  function toggleSort(col: DataTableColumn<T>) {
    if (disabled || loading) return;
    if (!activeSort || activeSort.key !== col.key) {
      applySort({ key: col.key, dir: "asc" });
    } else if (activeSort.dir === "asc") {
      applySort({ key: col.key, dir: "desc" });
    } else {
      applySort(null);
    }
    setRowFocus(null);
  }

  function emitSelection(next: Set<string>) {
    onSelectedIdsChange?.(next);
  }

  function toggleRow(id: string) {
    if (disabled || loading) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emitSelection(next);
  }

  function toggleAll() {
    if (disabled || loading) return;
    // From indeterminate, the header checkbox selects all (like native
    // checkbox groups); from all-selected it clears.
    const next = new Set(selected);
    if (allSelected) rowIds.forEach((id) => next.delete(id));
    else rowIds.forEach((id) => next.add(id));
    emitSelection(next);
  }

  const sortedRows = useMemo(() => {
    if (!activeSort) return rows;
    const col = columns.find((c) => c.key === activeSort.key);
    if (!col?.sortValue) return rows;
    const dir = activeSort.dir === "desc" ? -1 : 1;
    const keyOf = col.sortValue;
    return [...rows].sort(
      (a, b) =>
        compareSortValues(keyOf(a), keyOf(b)) * dir ||
        // Stable tiebreaker so equal keys never flip between renders.
        getRowId(a).localeCompare(getRowId(b))
    );
  }, [rows, activeSort, columns, getRowId]);

  function moveRowFocus(next: number) {
    const clamped = Math.max(0, Math.min(sortedRows.length - 1, next));
    setRowFocus(clamped);
    const tbody = tbodyRef.current;
    const tr = tbody?.children[clamped];
    if (tr instanceof HTMLElement && typeof tr.scrollIntoView === "function") {
      tr.scrollIntoView({ block: "nearest" });
    }
  }

  function onTbodyKeyDown(e: ReactKeyboardEvent<HTMLTableSectionElement>) {
    // Row navigation only when the tbody itself has focus (not controls
    // inside cells, which keep their own keyboard behaviour).
    if (e.target !== e.currentTarget || sortedRows.length === 0) return;
    const step =
      e.key === "j" || e.key === "ArrowDown"
        ? 1
        : e.key === "k" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (step !== 0) {
      e.preventDefault();
      moveRowFocus(rowFocus === null ? 0 : rowFocus + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveRowFocus(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveRowFocus(sortedRows.length - 1);
    }
  }

  const columnCount = columns.length + (selectable ? 1 : 0);
  const rootClassName = [
    "dt-root",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const showEmpty = !loading && !error && rows.length === 0;

  const skeletonRows =
    loading &&
    Array.from({ length: STATUS_ROW_MIN_ROWS }, (_, i) => (
      <tr key={`skeleton-${i}`} className="dt-skeleton-row" aria-hidden="true">
        {selectable && (
          <td>
            <span className="dt-skeleton-bar" style={{ maxWidth: 16 }} />
          </td>
        )}
        {columns.map((c) => (
          <td key={c.key}>
            <span className="dt-skeleton-bar" style={{ maxWidth: `${55 + ((i * 13 + c.key.length * 7) % 35)}%` }} />
          </td>
        ))}
      </tr>
    ));

  const rootStyle: CSSProperties & Record<string, string | number> = {
    "--dt-row-height": ROW_HEIGHT_VAR[rowHeight],
  };

  return (
    <div className={rootClassName} style={rootStyle as CSSProperties}>
      <table
        className="dt-table"
        aria-label={ariaLabel}
        aria-busy={loading || undefined}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="dt-select-all">
                <span className="dt-checkbox">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={disabled || loading || rows.length === 0}
                    aria-label={
                      allSelected
                        ? `Deselect all ${rows.length} rows`
                        : `Select all ${rows.length} rows`
                    }
                  />
                </span>
              </th>
            )}
            {columns.map((col) => {
              const isActive = activeSort?.key === col.key;
              const ariaSort = isActive
                ? activeSort.dir === "asc"
                  ? "ascending"
                  : "descending"
                : undefined;
              const cellClassName = [
                col.align === "number" ? "dt-head-number" : "",
                col.className ?? "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cellClassName || undefined}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className="dt-sort-button"
                      onClick={() => toggleSort(col)}
                      disabled={disabled || loading || !col.sortValue}
                    >
                      <span className="dt-sort-label">
                        {col.header}
                        {col.description && (
                          <span className="sr-only"> — {col.description}</span>
                        )}
                      </span>
                      <span
                        className="dt-sort-indicator"
                        aria-hidden="true"
                      >
                        {isActive ? (activeSort.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                      {isActive && (
                        <span className="sr-only">
                          {activeSort.dir === "asc"
                            ? `Sorted ascending by ${col.header}`
                            : `Sorted descending by ${col.header}`}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span className="dt-header-label">{col.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody
          ref={tbodyRef}
          tabIndex={sortedRows.length > 0 ? 0 : undefined}
          onKeyDown={onTbodyKeyDown}
          className={rowFocus !== null ? "dt-row-focus-active" : undefined}
        >
          {skeletonRows && (
            <tbody className="dt-skeleton-tbody" role="status" aria-label="Loading">
              {skeletonRows}
            </tbody>
          )}
          {!loading && error && (
            <tr role="alert">
              <td colSpan={columnCount}>
                <div className="dt-status">
                  <div>
                    <p>{error}</p>
                    {onRetry && (
                      <button type="button" onClick={onRetry}>
                        {retryLabel}
                      </button>
                    )}
                  </div>
                </div>
              </td>
            </tr>
          )}
          {showEmpty && (
            <tr>
              <td colSpan={columnCount}>
                <div className="dt-status">
                  <div>
                    <p>
                      <strong>{emptyTitle}</strong>
                    </p>
                    {emptyBody && <p>{emptyBody}</p>}
                    {emptyAction}
                  </div>
                </div>
              </td>
            </tr>
          )}
          {!loading &&
            sortedRows.map((row, index) => {
              const id = getRowId(row);
              const isSelected = selected.has(id);
              const rowClassNameList = [
                "dt-row",
                isSelected ? "dt-row-selected" : "",
                rowClassName?.(row) ?? "",
                rowFocus === index ? "dt-row-focused" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <tr key={id} className={rowClassNameList}>
                  {selectable && (
                    <td>
                      <span className="dt-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                          disabled={disabled}
                          aria-label={`Select row ${index + 1}`}
                        />
                      </span>
                    </td>
                  )}
                  {columns.map((col) => {
                    const cellClassName = [
                      col.align === "number" ? "dt-cell-number" : "",
                      col.className ?? "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <td key={col.key} className={cellClassName || undefined}>
                        {col.render ? col.render(row) : String(row[col.key as keyof T] ?? "")}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * TableSkeleton — §5/§6: "Row-shaped skeletons for tables. No spinners over
 * a table." Standalone skeleton table for screens that render their own
 * <table> (or before data + columns exist). Uses the same row height token
 * and bar styling as DataTable's internal loading state.
 */
export function TableSkeleton({
  rows = 5,
  columns = 4,
  rowHeight = "default",
  label = "Loading",
  className,
}: {
  rows?: number;
  columns?: number;
  rowHeight?: "default" | "compact" | "comfortable";
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={["dt-root", "dt-skeleton-table", className].filter(Boolean).join(" ")}
      style={{ "--dt-row-height": ROW_HEIGHT_VAR[rowHeight] } as CSSProperties}
      role="status"
      aria-live="polite"
    >
      <table className="dt-table" aria-label={label}>
        <caption className="sr-only">{label}</caption>
        <thead aria-hidden="true">
          <tr>
            {Array.from({ length: columns }, (_, i) => (
              <th key={i}>
                <span className="dt-sort-button" style={{ cursor: "default" }}>
                  <span className="dt-skeleton-bar" style={{ maxWidth: "60%" }} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r} className="dt-skeleton-row">
              {Array.from({ length: columns }, (_, c) => (
                <td key={c}>
                  <span
                    className="dt-skeleton-bar"
                    style={{ maxWidth: `${55 + ((r * 13 + c * 29) % 35)}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
