"use client";

/**
 * Failures over time (docs/DESIGN.md §4.9, docs/api-reports.md § Fields).
 * Plot only the three attention statuses: Failed, Blocked, Retest. Passed and
 * skipped are deliberately absent — the tile and the trend carry them.
 * Colour never carries meaning alone: every status is named in the legend and
 * in the table, and the plot is one role="img" summary.
 *
 * Two empty states: a window with no results at all links out to Test runs,
 * while a window whose results simply were not failures keeps the axes and
 * legend and only says so. `projectId` exists for that first link.
 */
import { useState } from "react";
import Link from "next/link";
import type { TrendBucket } from "@/lib/api-types";
import { formatDateOnly, formatDayMonth } from "@/lib/dates";
import {
  BASE_Y,
  CHART_HEIGHT,
  CHART_MARGIN,
  CHART_WIDTH,
  PLOT_HEIGHT,
  PLOT_WIDTH,
  bucketX,
  labelIndices,
  niceScale,
  roundedTopRect,
} from "@/lib/chart-scale";
import "./FailuresChart.css";

export const FAILURE_STATUSES = ["failed", "blocked", "retest"] as const;
type FailureStatus = (typeof FAILURE_STATUSES)[number];

export interface FailuresChartProps {
  projectId: string;
  buckets: readonly TrendBucket[];
  days: number;
  loading?: boolean;
}

const COPY: Record<FailureStatus, string> = {
  failed: "Failed",
  blocked: "Blocked",
  retest: "Retest",
};

function failureTotal(bucket: TrendBucket): number {
  return FAILURE_STATUSES.reduce((sum, status) => sum + bucket.status_counts[status], 0);
}

function summary(buckets: readonly TrendBucket[], days: number): string {
  const totals = FAILURE_STATUSES.reduce(
    (acc, status) => {
      acc[status] = buckets.reduce((sum, b) => sum + b.status_counts[status], 0);
      return acc;
    },
    { failed: 0, blocked: 0, retest: 0 } as Record<FailureStatus, number>
  );
  const window = days === 1 ? "today" : `in the last ${days} days`;
  return `Failures ${window}: ${totals.failed} failed, ${totals.blocked} blocked, ${totals.retest} retested. Use View as table for daily detail.`;
}

export function FailuresChart({ projectId, buckets, days, loading = false }: FailuresChartProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const max = Math.max(0, ...buckets.map(failureTotal));
  const { max: yMax, ticks } = niceScale(max);
  const slot = PLOT_WIDTH / Math.max(days, 1);
  const barWidth = Math.max(5, Math.min(46, slot * 0.56));
  const radius = barWidth >= 34 ? 4 : barWidth >= 12 ? 3 : 2;
  const labels = labelIndices(Math.max(days, 1));
  const yFor = (value: number) => BASE_Y - (value / yMax) * PLOT_HEIGHT;
  const empty = max === 0;
  const windowTitle = days === 1 ? "today" : `last ${days} days`;
  const windowPhrase = days === 1 ? "today" : `in the last ${days} days`;
  const noResults = buckets.every((bucket) => bucket.total === 0);

  return (
    <section className="rep-card rep-failures" aria-labelledby="rep-failures-title">
      <div className="rep-card-head">
        <h2 id="rep-failures-title">Failures over time, {windowTitle}</h2>
        <button
          type="button"
          className="rep-toggle"
          aria-expanded={view === "table"}
          onClick={() => setView(view === "chart" ? "table" : "chart")}
        >
          {view === "chart" ? "View as table" : "View as chart"}
        </button>
      </div>

      {view === "table" ? (
        <div className="rep-table-wrap">
          <table className="rep-failures-table">
            <caption className="sr-only">
              Failed, blocked and retested results per day
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {FAILURE_STATUSES.map((status) => (
                  <th key={status} scope="col" className="rep-num">
                    {COPY[status]}
                  </th>
                ))}
                <th scope="col" className="rep-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.date}>
                  <th scope="row">{formatDateOnly(bucket.date)}</th>
                  {FAILURE_STATUSES.map((status) => (
                    <td key={status} className="rep-num">{bucket.status_counts[status]}</td>
                  ))}
                  <td className="rep-num">{failureTotal(bucket)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rep-plot" aria-busy={loading || undefined}>
          <svg
            className="rep-svg"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            role="img"
            aria-label={summary(buckets, days)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  className="rep-grid"
                  x1={CHART_MARGIN.left}
                  x2={CHART_MARGIN.left + PLOT_WIDTH}
                  y1={yFor(tick)}
                  y2={yFor(tick)}
                />
                <text className="rep-axis" x={CHART_MARGIN.left - 6} y={yFor(tick) + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}
            <line className="rep-axis-line" x1={CHART_MARGIN.left} x2={CHART_MARGIN.left + PLOT_WIDTH} y1={BASE_Y} y2={BASE_Y} />
            {buckets.map((bucket, index) => {
              const x = bucketX(index, Math.max(days, 1)) - barWidth / 2;
              const present = FAILURE_STATUSES.filter(
                (status) => bucket.status_counts[status] > 0
              );
              const top = present[present.length - 1];
              let cursor = BASE_Y;
              return (
                <g key={bucket.date} className="rep-col">
                  <title>{`${formatDateOnly(bucket.date)} · ${failureTotal(bucket)} failures`}</title>
                  {present.map((status) => {
                    const value = bucket.status_counts[status];
                    const height = (value / yMax) * PLOT_HEIGHT;
                    const y = cursor - height;
                    cursor = y;
                    return (
                      <g key={status}>
                        {status === top ? (
                          <path className={`rep-bar rep-bar-${status}`} d={roundedTopRect(x, y, barWidth, height, radius)} />
                        ) : (
                          <rect className={`rep-bar rep-bar-${status}`} x={x} y={y} width={barWidth} height={height} />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {buckets.map((bucket, index) =>
              labels.has(index) ? (
                <text
                  key={`label-${bucket.date}`}
                  className="rep-axis"
                  x={bucketX(index, Math.max(days, 1))}
                  y={BASE_Y + 18}
                  textAnchor="middle"
                >
                  {formatDayMonth(bucket.date)}
                </text>
              ) : null
            )}
          </svg>
          {empty && (
            <p className="rep-empty">
              {noResults
                ? `No results recorded ${windowPhrase}.`
                : `No failed, blocked or retested results ${windowPhrase}.`}
              {noResults && (
                <>
                  {" "}
                  <Link href={`/runs?project=${encodeURIComponent(projectId)}`}>
                    Go to Test runs
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
      )}

      <ul className="rep-legend">
        {FAILURE_STATUSES.map((status) => (
          <li key={status}>
            <span className={`rep-swatch rep-swatch-${status}`} aria-hidden="true" />
            {COPY[status]}
          </li>
        ))}
      </ul>
      <p className="rep-note">UTC days</p>
    </section>
  );
}