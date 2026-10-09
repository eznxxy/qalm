"use client";

/**
 * StatusBar — the segmented status bar, the app's "one memorable thing"
 * (docs/DESIGN.md §1.6, §5 "Status bar").
 *
 * - Segmented horizontal bar of the six statuses in FIXED order:
 *   Passed, Retest, Blocked, Failed, Skipped, Untested (§5).
 * - 8px high in tables (`size="small"`, default), 16px on dashboards
 *   (`size="large"`).
 * - Segments are the status SOLIDS (the bar sits on --surface; tints are
 *   reserved for badge backgrounds). Widths are proportional to counts;
 *   zero-count statuses render no segment.
 * - Hover shows the counts (native title tooltip — the same numbers the
 *   screen reader gets; no JS, no focus trap on a non-interactive element).
 * - `role="img"` + `aria-label` spelling the numbers out, e.g.
 *   "31 passed, 4 failed, 2 blocked, 13 untested" — zero-count statuses
 *   are omitted so the label stays scannable (matches the §4.4 mock).
 *   Nonzero segments keep a 2px minimum width so 1-of-200 stays findable.
 *
 * The component is read-only presentation: it renders counts it is given
 * and owns no data fetching (no status-write flows exist yet — runs and
 * results land in a later slice).
 */

import type { ReactElement } from "react";
import "../../styles/tokens.css";
import "./StatusBar.css";
import { STATUS_LABELS, type StatusName } from "./StatusBadge";

/** Segment order per DESIGN.md §5 — never sort or reorder for looks. */
export const STATUS_ORDER: readonly StatusName[] = [
  "passed",
  "retest",
  "blocked",
  "failed",
  "skipped",
  "untested",
];

/** Counts per status. Omitted/zero statuses render no segment. */
export interface StatusBarValue {
  passed?: number;
  retest?: number;
  blocked?: number;
  failed?: number;
  skipped?: number;
  untested?: number;
}

/**
 * Order the aria-label SPELLS the numbers in: the §5 example ("31 passed,
 * 4 failed, 2 blocked, 13 untested") reads severity-first — result, then
 * attention states, then not-done. Audio is not bound by the visual
 * segment adjacency that dictates STATUS_ORDER, and the run-detail
 * headline (§4.4) uses the same prose order.
 */
const SPEAK_ORDER: readonly StatusName[] = [
  "passed",
  "failed",
  "blocked",
  "retest",
  "skipped",
  "untested",
];

export interface StatusBarProps {
  /** Results per status. All zero (or empty) renders nothing. */
  counts: StatusBarValue;
  /** 8px ("small", tables — default) or 16px ("large", dashboards). */
  size?: "small" | "large";
  /**
   * What the bar describes, e.g. the run name. Prepended to the aria-label
   * ("Release 2.4 smoke: 31 passed, …") so several bars on one page
   * (plans, dashboards) stay distinguishable for screen readers.
   */
  label?: string;
}

/** Nonzero entries of `counts` in STATUS_ORDER. */
export function nonzeroStatuses(counts: StatusBarValue): StatusName[] {
  return STATUS_ORDER.filter((status) => (counts[status] ?? 0) > 0);
}

/** "31 passed, 4 failed, 2 blocked, 13 untested" — SPEAK_ORDER, nonzero only. */
export function formatCounts(counts: StatusBarValue): string {
  return SPEAK_ORDER.filter((status) => (counts[status] ?? 0) > 0)
    .map((status) => `${counts[status]} ${STATUS_LABELS[status].toLowerCase()}`)
    .join(", ");
}

export function StatusBar({
  counts,
  size = "small",
  label,
}: StatusBarProps): ReactElement | null {
  const present = nonzeroStatuses(counts);
  if (present.length === 0) {
    // Nothing to segment — an empty bar would read as data that isn't there.
    return null;
  }
  const total = present.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const spoken = formatCounts(counts);
  const ariaLabel = label ? `${label}: ${spoken}` : spoken;

  return (
    <span
      className={`stb-root ${size === "large" ? "stb-large" : "stb-small"}`}
      role="img"
      aria-label={ariaLabel}
      title={spoken}
    >
      {present.map((status) => (
        <span
          key={status}
          className={`stb-segment stb-${status}`}
          style={{ width: `${((counts[status] ?? 0) / total) * 100}%` }}
        />
      ))}
    </span>
  );
}
