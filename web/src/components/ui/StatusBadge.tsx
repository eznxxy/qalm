"use client";

/**
 * StatusBadge — the one component for rendering test status everywhere
 * (docs/DESIGN.md §2.2 amended badge spec, §5 "Status badge").
 *
 * Per Daedalus's contrast amendment (decision t_5fa1c284, commit 6e0dd78):
 * - Background: the status tint.
 * - Text: --ink-900, weight 500, on every status — except Failed, which
 *   keeps its solid #C23A3A text (4.53:1 on the tint, passes AA) because
 *   failed is the one state that must read instantly.
 * - Icon: the status solid, except Untested which uses --ink-700 (the
 *   untested solid is 2.24:1 on its tint; --ink-700 is 8.60:1). Icons are
 *   ≥ 3:1 on every tint and purely supplementary — the visible text label
 *   always carries the status, so status is never colour-only (§1.3).
 * - Geometry: 4px radius, 22px high, same markup everywhere.
 * - Icon shape per status (§1.3 "never colour alone"): check in circle
 *   (Passed), x in circle (Failed), minus in square (Blocked), circular
 *   arrow (Retest), forward arrow (Skipped), empty ring (Untested).
 *
 * Icons are inline SVGs with aria-hidden and focusable=false: the badge's
 * own text label is the accessible content, so screen readers read
 * "Passed" once, not "icon: check circle, Passed".
 *
 * A11y note on `title`: there is deliberately no title/tooltip on the
 * badge itself — the status word is the content. Consumers that need an
 * explanation of a specific instance (e.g. "temp password until first
 * login") pass `title` for that sentence; the component never hides the
 * status text behind hover.
 */

import type { ReactElement, SVGProps } from "react";
import "../../styles/tokens.css";
import "./StatusBadge.css";

/** The six test statuses of the qalm domain (§2.2). */
export type StatusName =
  | "passed"
  | "failed"
  | "blocked"
  | "retest"
  | "skipped"
  | "untested";

/** Sentence-case badge label per status. */
export const STATUS_LABELS: Record<StatusName, string> = {
  passed: "Passed",
  failed: "Failed",
  blocked: "Blocked",
  retest: "Retest",
  skipped: "Skipped",
  untested: "Untested",
};

/** True when `value` is one of the six StatusName values. */
export function isStatusName(value: unknown): value is StatusName {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(STATUS_LABELS, value)
  );
}

/**
 * Icon shapes per §2.2. All are 12×12 within a 16×16 viewBox on the 22px
 * badge, use `currentColor` (the badge sets the colour per status) and are
 * aria-hidden — meaning never rides on an icon alone (§8).
 */
function StatusIcon({ status }: { status: StatusName }): ReactElement {
  const stroke: SVGProps<SVGSVGElement> = {
    "aria-hidden": true,
    focusable: false,
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  switch (status) {
    case "passed":
      // Check in circle
      return (
        <svg {...stroke}>
          <circle cx="8" cy="8" r="6.4" />
          <path d="m5.2 8.2 1.9 1.9 3.7-4" />
        </svg>
      );
    case "failed":
      // X in circle
      return (
        <svg {...stroke}>
          <circle cx="8" cy="8" r="6.4" />
          <path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" />
        </svg>
      );
    case "blocked":
      // Minus in square
      return (
        <svg {...stroke}>
          <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2.4" />
          <path d="M4.8 8h6.4" />
        </svg>
      );
    case "retest":
      // Circular arrow (re-run), arrowhead into the gap
      return (
        <svg {...stroke}>
          <path d="M13.3 8A5.3 5.3 0 1 1 8 2.7c2.2 0 4.1 1.3 4.9 3.2" />
          <path d="m12.9 2.9.1 3.1h-3.1" />
        </svg>
      );
    case "skipped":
      // Forward arrow (skip to end)
      return (
        <svg {...stroke}>
          <path d="m3 3 5 5-5 5" />
          <path d="m8.5 3 5 5-5 5" />
        </svg>
      );
    case "untested":
      // Empty ring
      return (
        <svg {...stroke}>
          <circle cx="8" cy="8" r="6.4" />
        </svg>
      );
  }
}

export interface StatusBadgeProps {
  /** The status to render. */
  status: StatusName;
  /**
   * Override the label text. Defaults to the sentence-case status word.
   * Keep it a status synonym — never an action or a sentence.
   */
  children?: string;
  /**
   * Explains this instance on hover/focus for sighted users (e.g. why a
   * case shows "Retest"). The status text itself is always visible, so
   * this is supplementary, not the accessible name.
   */
  title?: string;
}

/**
 * The status badge: tint background, ink-900 text (solid text for failed),
 * status-solid icon (ink-700 for untested). One markup everywhere (§5).
 */
export function StatusBadge({
  status,
  children,
  title,
}: StatusBadgeProps): ReactElement {
  const label = children ?? STATUS_LABELS[status];
  return (
    <span className={`sb-badge sb-${status}`} title={title}>
      <StatusIcon status={status} />
      {label}
    </span>
  );
}
