"use client";

/**
 * SuiteTree — the project's suite tree for the two-pane cases screen
 * (docs/DESIGN.md §4.2, §5 "Tree", §8 accessibility floor).
 *
 * - ARIA treeview: roving tabindex, Up/Down/Home/End move focus,
 *   Right expands (or enters the first child), Left collapses (or returns to
 *   the parent), Enter/Space selects. Selection and expansion are controlled
 *   by the caller so the URL stays the source of truth.
 * - Counts are right-aligned and always include the subtree, per
 *   docs/api-suites.md (`case_count`).
 * - Drag and drop reorders among siblings and moves a suite into another
 *   suite or to the top level. Every drop also has a keyboard alternative:
 *   the "Move to…" button opens a destination picker (DESIGN §8).
 * - §6 states: skeleton rows while loading, a readable error with Retry, and
 *   an empty state that says what belongs here and how to add it.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { SuiteNode } from "@/lib/api-types";
import {
  dropRequest,
  findSuiteById,
  type SuiteMoveRequest,
} from "@/lib/suites";
import "./SuiteTree.css";

export interface SuiteTreeProps {
  nodes: readonly SuiteNode[];
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  /** Called after a drop; omit to disable dragging. */
  onMove?: (request: SuiteMoveRequest) => void;
  /** Opens the keyboard-friendly destination picker. */
  onRequestMove?: (id: string) => void;
  /** Omit to hide the create controls (Tester/Viewer). */
  onAddSuite?: (parentId: string | null) => void;
  /** Rename the selected suite (Admin/Lead only). */
  onRenameSuite?: (suite: SuiteNode) => void;
  /** Delete the selected suite; disabled when it is not empty. */
  onDeleteSuite?: (suite: SuiteNode) => void;
  /** Pseudo-row above the tree for the unscoped case list. */
  onSelectAll?: () => void;
  allSelected?: boolean;
  totalCount?: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

interface VisibleRow {
  node: SuiteNode;
  parentId: string | null;
}

/** Depth-first walk that only descends into expanded nodes. */
function visibleRows(
  nodes: readonly SuiteNode[],
  expandedIds: ReadonlySet<string>
): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (list: readonly SuiteNode[], parentId: string | null): void => {
    for (const node of list) {
      out.push({ node, parentId });
      if (expandedIds.has(node.id) && node.children.length > 0) {
        walk(node.children, node.id);
      }
    }
  };
  walk(nodes, null);
  return out;
}

type DropIntent = "before" | "inside" | "after";

export function SuiteTree({
  nodes,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  onMove,
  onRequestMove,
  onAddSuite,
  onRenameSuite,
  onDeleteSuite,
  onSelectAll,
  allSelected = false,
  totalCount,
  loading = false,
  error = null,
  onRetry,
}: SuiteTreeProps) {
  const rows = useMemo(
    () => visibleRows(nodes, expandedIds),
    [nodes, expandedIds]
  );
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    intent: DropIntent;
  } | null>(null);

  // Keep the roving tab stop on a row that still exists (collapse, reload,
  // or a deep link that lands after the first paint).
  const visibleIds = useMemo(() => rows.map((row) => row.node.id), [rows]);
  const activeFocusId =
    focusId && visibleIds.includes(focusId)
      ? focusId
      : selectedId && visibleIds.includes(selectedId)
        ? selectedId
        : (visibleIds[0] ?? null);
  if (focusId !== null && activeFocusId !== focusId) {
    setFocusId(activeFocusId);
  }

  // A deep-linked selection can sit inside a collapsed branch: reveal it.
  useEffect(() => {
    if (!selectedId) return;
    let parent = findSuiteById(nodes, selectedId)?.parent_id ?? null;
    while (parent !== null) {
      if (!expandedIds.has(parent)) onToggle(parent);
      parent = findSuiteById(nodes, parent)?.parent_id ?? null;
    }
  }, [selectedId, nodes, expandedIds, onToggle]);

  function focusRow(id: string): void {
    setFocusId(id);
    itemRefs.current.get(id)?.focus();
  }

  function onKeyDown(
    event: ReactKeyboardEvent<HTMLLIElement>,
    row: VisibleRow,
    index: number
  ): void {
    const { node } = row;
    const key = event.key;
    if (key === "ArrowDown") {
      event.preventDefault();
      if (index + 1 < rows.length) focusRow(rows[index + 1]!.node.id);
    } else if (key === "ArrowUp") {
      event.preventDefault();
      if (index > 0) focusRow(rows[index - 1]!.node.id);
    } else if (key === "Home") {
      event.preventDefault();
      if (rows.length > 0) focusRow(rows[0]!.node.id);
    } else if (key === "End") {
      event.preventDefault();
      if (rows.length > 0) focusRow(rows[rows.length - 1]!.node.id);
    } else if (key === "ArrowRight") {
      event.preventDefault();
      if (node.children.length === 0) return;
      if (!expandedIds.has(node.id)) onToggle(node.id);
      else focusRow(node.children[0]!.id);
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      if (node.children.length > 0 && expandedIds.has(node.id)) {
        onToggle(node.id);
      } else if (row.parentId) {
        focusRow(row.parentId);
      }
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      onSelect(node.id);
    }
  }

  function intentFor(
    event: DragEvent<HTMLLIElement>,
    node: SuiteNode
  ): DropIntent {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    if (node.depth >= 3) {
      // Depth-3 suites cannot take children; top/bottom edges reorder.
      return ratio < 0.5 ? "before" : "after";
    }
    if (ratio < 0.25) return "before";
    if (ratio > 0.75) return "after";
    return "inside";
  }

  function onDragOver(
    event: DragEvent<HTMLLIElement>,
    node: SuiteNode
  ): void {
    if (!onMove || !dragId) return;
    if (dragId === node.id) return;
    const intent = intentFor(event, node);
    // Reject self/descendant drops and moves that would exceed depth 3.
    if (!dropRequest(nodes, dragId, node.id, intent)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget((current) =>
      current?.id === node.id && current.intent === intent
        ? current
        : { id: node.id, intent }
    );
  }

  function onDrop(event: DragEvent<HTMLLIElement>, node: SuiteNode): void {
    if (!onMove || !dragId) return;
    event.preventDefault();
    const intent = dropTarget?.id === node.id ? dropTarget.intent : "inside";
    const request = dropRequest(nodes, dragId, node.id, intent);
    setDragId(null);
    setDropTarget(null);
    if (request) onMove(request);
  }

  function clearDrag(): void {
    setDragId(null);
    setDropTarget(null);
  }

  const selected = findSuiteById(nodes, selectedId);

  return (
    <section className="suite-pane" aria-label="Test suites">
      <div className="suite-pane-header">
        <h2>Suites</h2>
        {onAddSuite && !loading && !error && (
          <button
            type="button"
            className="suite-pane-add"
            onClick={() => onAddSuite(null)}
          >
            + Add suite
          </button>
        )}
      </div>

      {loading && (
        <div className="suite-tree-state" role="status" aria-live="polite">
          <span className="suite-skeleton" />
          <span className="suite-skeleton" />
          <span className="suite-skeleton" />
          <span className="sr-only">Loading suites…</span>
        </div>
      )}

      {!loading && error && (
        <div className="suite-tree-state" role="alert">
          <p>{error}</p>
          {onRetry && (
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}

      {!loading && !error && nodes.length === 0 && (
        <div className="suite-tree-state suite-tree-empty">
          <p>No suites yet. Add a suite to start organising cases.</p>
          {onAddSuite && (
            <button type="button" onClick={() => onAddSuite(null)}>
              Add suite
            </button>
          )}
        </div>
      )}

      {!loading && !error && nodes.length > 0 && onSelectAll && (
        <button
          type="button"
          className={
            allSelected ? "suite-all is-selected" : "suite-all"
          }
          aria-pressed={allSelected}
          onClick={onSelectAll}
        >
          <span className="suite-name">All suites</span>
          {typeof totalCount === "number" && (
            <span className="suite-count t-nums">{totalCount}</span>
          )}
        </button>
      )}

      {!loading && !error && rows.length > 0 && (
        <ul className="suite-tree" role="tree" aria-label="Test suites">
          {rows.map((row, index) => {
            const { node } = row;
            const hasChildren = node.children.length > 0;
            const expanded = hasChildren && expandedIds.has(node.id);
            const isSelected = node.id === selectedId;
            const isDrop = dropTarget?.id === node.id;
            const classes = [
              "suite-tree-item",
              isSelected ? "is-selected" : "",
              dragId === node.id ? "is-dragging" : "",
              isDrop ? `drop-${dropTarget.intent}` : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li
                key={node.id}
                ref={(element) => {
                  if (element) itemRefs.current.set(node.id, element);
                  else itemRefs.current.delete(node.id);
                }}
                role="treeitem"
                aria-level={node.depth}
                aria-selected={isSelected}
                aria-expanded={hasChildren ? expanded : undefined}
                tabIndex={activeFocusId === node.id ? 0 : -1}
                className={classes}
                style={{ "--suite-indent": node.depth - 1 } as CSSProperties}
                draggable={Boolean(onMove)}
                onClick={() => {
                  setFocusId(node.id);
                  onSelect(node.id);
                }}
                onFocus={() => setFocusId(node.id)}
                onKeyDown={(event) => onKeyDown(event, row, index)}
                onDragStart={(event) => {
                  setDragId(node.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", node.id);
                }}
                onDragEnd={clearDrag}
                onDragOver={(event) => onDragOver(event, node)}
                onDragLeave={() =>
                  setDropTarget((current) =>
                    current?.id === node.id ? null : current
                  )
                }
                onDrop={(event) => onDrop(event, node)}
              >
                <span className="suite-item-main">
                  {hasChildren ? (
                    <button
                      type="button"
                      className="suite-toggle"
                      tabIndex={-1}
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggle(node.id);
                      }}
                    >
                      <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                    </button>
                  ) : (
                    <span className="suite-toggle suite-toggle-leaf" aria-hidden="true" />
                  )}
                  <span className="suite-name">{node.name}</span>
                  <span className="suite-count t-nums">{node.case_count}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {(onAddSuite || onRequestMove || onRenameSuite || onDeleteSuite) &&
        !loading &&
        !error && (
          <div className="suite-pane-footer">
            {onAddSuite && (
              <button
                type="button"
                onClick={() => onAddSuite(selected ? selected.id : null)}
                disabled={!selected || selected.depth >= 3}
                title={
                  selected && selected.depth >= 3
                    ? "Suites are limited to 3 levels"
                    : "Add a child suite under the selected suite"
                }
              >
                + Add child
              </button>
            )}
            {onRenameSuite && (
              <button
                type="button"
                onClick={() => selected && onRenameSuite(selected)}
                disabled={!selected}
              >
                Rename
              </button>
            )}
            {onRequestMove && (
              <button
                type="button"
                onClick={() => selected && onRequestMove(selected.id)}
                disabled={!selected}
              >
                Move to…
              </button>
            )}
            {onDeleteSuite && (
              <button
                type="button"
                onClick={() => selected && onDeleteSuite(selected)}
                disabled={
                  !selected ||
                  selected.case_count > 0 ||
                  selected.children.length > 0
                }
                title={
                  !selected
                    ? "Select a suite to delete"
                    : selected.case_count > 0
                      ? "Move or delete its cases first"
                      : selected.children.length > 0
                        ? "Delete or move its child suites first"
                        : "Delete the selected suite"
                }
              >
                Delete
              </button>
            )}
          </div>
        )}
    </section>
  );
}
