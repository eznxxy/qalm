"use client";

/**
 * StatusPie — the rollup on the run detail header (review feedback, card 3.7;
 * layout reworked to the reviewer's reference).
 *
 * - A **full pie**: one wedge per status, no hole, no number in the middle.
 * - The legend carries the numbers instead: two columns of three, each row a
 *   count + status ("110 Passed") over a muted share ("46% set to Passed"), so
 *   the reader gets both the absolute and the relative size in one glance.
 * - Wedge order is FIXED (STATUS_ORDER: Passed, Retest, Blocked, Failed,
 *   Skipped, Untested) — never sorted by size; position is memory.
 * - Wedges use the status SOLIDS (--passed …) from tokens.css; tints stay
 *   reserved for badge backgrounds (§2.2).
 * - Zero-count statuses render no wedge (an empty arc would read as data) but
 *   keep their legend row with "0" and "0%", exactly like the reference.
 * - The SVG is decorative (`aria-hidden`); the group is named "<run> results
 *   by status" and the legend, being real text, is the accessible view.
 */

import type { ReactElement } from "react";
import "../../styles/tokens.css";
import "./StatusPie.css";
import { STATUS_LABELS } from "./StatusBadge";
import { STATUS_ORDER, type StatusBarValue } from "./StatusBar";

export interface StatusPieProps {
  /** Results per status; missing keys count as zero. */
  counts: StatusBarValue;
  /** What the pie describes, e.g. the run name. Names the legend for AT. */
  label?: string;
}

/** The pie is drawn in a 42×42 box with a 20 unit radius. */
const VIEWBOX = 42;
const RADIUS = 20;
const CENTRE = VIEWBOX / 2;

/** A point on the circle; 0° is 12 o'clock, angles run clockwise. */
function pointAt(fraction: number): string {
  const radians = (fraction * 360 - 90) * (Math.PI / 180);
  const x = CENTRE + RADIUS * Math.cos(radians);
  const y = CENTRE + RADIUS * Math.sin(radians);
  return `${x.toFixed(3)} ${y.toFixed(3)}`;
}

/** Centre → start → arc → close: one wedge of the full pie. */
function wedgePath(start: number, end: number): string {
  const largeArc = end - start > 0.5 ? 1 : 0;
  return `M ${CENTRE} ${CENTRE} L ${pointAt(start)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${pointAt(end)} Z`;
}

/** count ÷ total as a whole percent; 0 for a run with no items. */
function sharePercent(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 100);
}

export function StatusPie({ counts, label }: StatusPieProps): ReactElement {
  const total = STATUS_ORDER.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  // Wedge angles are prefix sums of the counts, so they cannot drift away from
  // the whole (and nothing is reassigned during render —
  // react-hooks/immutability).
  const present = STATUS_ORDER.map((status) => ({
    status,
    count: counts[status] ?? 0,
  })).filter((entry) => entry.count > 0);
  const wedges = present.map((entry, index) => {
    const before = present
      .slice(0, index)
      .reduce((sum, earlier) => sum + earlier.count, 0);
    return {
      status: entry.status,
      start: before / total,
      end: (before + entry.count) / total,
    };
  });

  return (
    <div
      className="stp-root"
      role="group"
      aria-label={label ? `${label} results by status` : "Results by status"}
    >
      <svg
        className="stp-chart"
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        aria-hidden="true"
        focusable="false"
      >
        {/* Backing disc: what is left when every status is zero. */}
        <circle className="stp-track" cx={CENTRE} cy={CENTRE} r={RADIUS} />
        {wedges.map(({ status, start, end }) =>
          // A lone status owns the whole circle, where an arc would collapse.
          end - start > 0.9999 ? (
            <circle
              key={status}
              className={`stp-slice stp-${status}`}
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS}
            />
          ) : (
            <path
              key={status}
              className={`stp-slice stp-${status}`}
              d={wedgePath(start, end)}
            />
          )
        )}
      </svg>

      <ul className="stp-legend">
        {STATUS_ORDER.map((status) => {
          const count = counts[status] ?? 0;
          const share = sharePercent(count, total);
          const name = STATUS_LABELS[status];
          return (
            <li className="stp-legend-row" key={status}>
              <span className={`stp-dot stp-${status}`} aria-hidden="true" />
              <span className="stp-legend-text">
                <span className="stp-legend-title">
                  {count} {name}
                </span>
                <span className="stp-legend-sub">
                  {share}% set to {name}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}