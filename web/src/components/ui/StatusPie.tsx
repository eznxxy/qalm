"use client";

/**
 * StatusPie — the pie/donut rollup used on the run detail header (review
 * feedback, card 3.7). Same data as StatusBar, different shape: the reader gets
 * one slice per status plus a legend that lists **all six** statuses with their
 * counts, so a run with zeros still shows the full vocabulary of outcomes.
 *
 * - Slice order is FIXED (STATUS_ORDER: Passed, Retest, Blocked, Failed,
 *   Skipped, Untested) — never sorted by size; position is memory.
 * - Slices use the status SOLIDS (--passed …) from tokens.css; tints stay
 *   reserved for badge backgrounds (§2.2).
 * - The centre states completion ("33% done"), matching the run headline it
 *   replaced. `done` = items with any result = total − untested, the same rule
 *   as `percent_complete` on the run resource (docs/api-runs.md § Resource).
 * - The legend is real text, so the counts are readable and selectable; the SVG
 *   itself is decorative (`aria-hidden`) and the group carries a name.
 * - Zero-count statuses render no slice (an empty arc would read as data) but
 *   do keep their legend row, greyed.
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

/** Circumference of the r=15.9155 circle in a 42×42 viewBox is exactly 100. */
const RADIUS = 15.9155;
const VIEWBOX = 42;

/** `done` ÷ total as a whole percent; 0 for a run with no items. */
export function percentComplete(counts: StatusBarValue): number {
  const total = STATUS_ORDER.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  if (total === 0) return 0;
  const done = total - (counts.untested ?? 0);
  return Math.round((done / total) * 100);
}

export function StatusPie({ counts, label }: StatusPieProps): ReactElement {
  const total = STATUS_ORDER.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const percent = percentComplete(counts);

  // Walk the ring once: each nonzero status takes dash = its share of 100.
  // Offsets are prefix sums, so the ring closes without mutating anything
  // during render (react-hooks/immutability).
  const present = STATUS_ORDER.map((status) => ({
    status,
    count: counts[status] ?? 0,
  }))
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      status: entry.status,
      share: total === 0 ? 0 : (entry.count / total) * 100,
    }));
  const slices = present.map((slice, index) => ({
    ...slice,
    offset: present
      .slice(0, index)
      .reduce((sum, earlier) => sum + earlier.share, 0),
  }));

  return (
    <div
      className="stp-root"
      role="group"
      aria-label={label ? `${label} results by status` : "Results by status"}
    >
      <div className="stp-figure">
        <svg
          className="stp-chart"
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          aria-hidden="true"
          focusable="false"
        >
          <circle
            className="stp-track"
            cx={VIEWBOX / 2}
            cy={VIEWBOX / 2}
            r={RADIUS}
          />
          {slices.map(({ status, share, offset: start }) => (
            <circle
              key={status}
              className={`stp-slice stp-${status}`}
              cx={VIEWBOX / 2}
              cy={VIEWBOX / 2}
              r={RADIUS}
              // The dash length is the share; the gap keeps the ring honest
              // when a single status owns 100%.
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={-start}
            />
          ))}
        </svg>
        <span className="stp-centre">
          <span className="stp-percent t-nums">{percent}%</span>
          <span className="stp-percent-label">done</span>
        </span>
      </div>

      <ul className="stp-legend">
        {STATUS_ORDER.map((status) => {
          const count = counts[status] ?? 0;
          return (
            <li
              key={status}
              className={count === 0 ? "stp-legend-row is-zero" : "stp-legend-row"}
            >
              <span
                className={`stp-dot stp-${status}`}
                aria-hidden="true"
              />
              <span className="stp-legend-label">{STATUS_LABELS[status]}</span>
              <span className="stp-legend-count t-nums">{count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}