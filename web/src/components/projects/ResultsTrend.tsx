"use client";

/**
 * Results trend card (docs/DESIGN.md §4.8, docs/api-project-overview.md).
 *
 * One plot, two series: stacked daily columns of recorded results by status
 * (left axis, counts) and the daily pass rate (right axis, 0–100%). The same
 * buckets power the "View as table" view. The window is a 1/7/14/30 preset and
 * lives in the URL; this component fetches only its own card when it changes,
 * keeping the previous plot visible and `aria-busy` while the new one loads.
 *
 * Colours are the §2.2 status solids only; every status is also named in the
 * legend and in the table, so nothing depends on colour. The plot is a single
 * `role="img"` summary; per-day detail is the table's job (§8).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  type ProjectTrend,
  type TrendBucket,
  TREND_STATUSES,
  type TrendStatus,
} from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { formatDateOnly, formatDayMonth } from "@/lib/dates";
import {
  formatPassRate,
  trendEmptyCopy,
  trendTitle,
  trendWindowLabel,
  type TrendWindow,
} from "@/lib/trend-window";
import { STATUS_LABELS } from "@/components/ui";
import { CardError, CardSkeleton, OverviewCard } from "./OverviewCard";
import "./ResultsTrend.css";

const TREND_ERROR =
  "Couldn't load the trend. Check your connection and retry.";

/** Legend/table order; deliberately Passed, Failed, Blocked, Retest, Skipped. */
const TREND_STATUS_ORDER: readonly TrendStatus[] = TREND_STATUSES;

const STATUS_FILLS: Record<TrendStatus, string> = {
  passed: "var(--passed)",
  failed: "var(--failed)",
  blocked: "var(--blocked)",
  retest: "var(--retest)",
  skipped: "var(--skipped)",
};

export interface ResultsTrendProps {
  projectId: string;
  days: TrendWindow;
  onDaysChange: (days: TrendWindow) => void;
}

interface Point {
  x: number;
  y: number;
}

const WIDTH = 680;
const HEIGHT = 260;
const MARGIN = { top: 12, right: 44, bottom: 34, left: 34 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const BASE_Y = MARGIN.top + PLOT_HEIGHT;

/** A count axis whose top tick is a round number and leaves headroom. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const rough = value / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / magnitude;
  const step =
    (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude;
  return Math.ceil(value / step) * step;
}

/** Indices that get an x-axis label: at most 7, always first and last. */
function labelIndices(days: number): Set<number> {
  const count = Math.min(days, 7);
  const indices = new Set<number>();
  if (count === 1) {
    indices.add(0);
    return indices;
  }
  for (let i = 0; i < count; i += 1) {
    indices.add(Math.round((i * (days - 1)) / (count - 1)));
  }
  return indices;
}

function bucketX(index: number, days: number): number {
  return MARGIN.left + (PLOT_WIDTH / days) * (index + 0.5);
}

function rateY(rate: number): number {
  return MARGIN.top + PLOT_HEIGHT * (1 - rate / 100);
}

function segmentPoints(buckets: TrendBucket[], days: number): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] = [];
  buckets.forEach((bucket, index) => {
    if (bucket.pass_rate === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: bucketX(index, days), y: rateY(bucket.pass_rate) });
  });
  if (current.length) segments.push(current);
  return segments;
}

function chartSummary(trend: ProjectTrend, days: TrendWindow): string {
  const windowCopy =
    days === 1 ? "today" : `in the last ${days} days`;
  const totals = trend.totals;
  const rate =
    totals.pass_rate === null
      ? "no pass rate"
      : `${formatPassRate(totals.pass_rate)} pass rate`;
  const statuses = TREND_STATUS_ORDER.map(
    (status) => `${STATUS_LABELS[status]} ${totals.status_counts[status]}`
  ).join(", ");
  return `Results recorded ${windowCopy}: ${totals.total} results, ${rate}. ${statuses}. Use View as table for daily detail.`;
}

function bucketTitle(bucket: TrendBucket): string {
  const counts = TREND_STATUS_ORDER.map(
    (status) => `${STATUS_LABELS[status]} ${bucket.status_counts[status]}`
  ).join(", ");
  return `${formatDateOnly(bucket.date)} · ${bucket.total} results · ${formatPassRate(
    bucket.pass_rate
  )} pass rate · ${counts}`;
}

function TrendChart({
  trend,
  days,
  projectId,
}: {
  trend: ProjectTrend;
  days: TrendWindow;
  projectId: string;
}) {
  const buckets = trend.buckets;
  const maxCount = buckets.reduce((max, bucket) => Math.max(max, bucket.total), 0);
  const yMax = niceMax(maxCount);
  const yTicks = [0, yMax / 2, yMax];
  const slot = PLOT_WIDTH / days;
  const barWidth = Math.min(48, Math.max(4, slot * 0.6));
  const labels = labelIndices(days);
  const segments = segmentPoints(buckets, days);
  const pointCount = segments.reduce((sum, segment) => sum + segment.length, 0);

  return (
    <div className="ov-trend-plot">
      <svg
        className="ov-trend-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={chartSummary(trend, days)}
      >
        {/* horizontal grid + left count axis */}
        {yTicks.map((tick) => {
          const y = BASE_Y - (tick / yMax) * PLOT_HEIGHT;
          return (
            <g key={`grid-${tick}`}>
              <line
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={y}
                y2={y}
                className="ov-trend-grid"
              />
              <text x={MARGIN.left - 6} y={y + 4} textAnchor="end" className="ov-trend-axis">
                {Math.round(tick)}
              </text>
            </g>
          );
        })}

        {/* right pass-rate axis */}
        {[0, 50, 100].map((rate) => (
          <text
            key={`rate-${rate}`}
            x={WIDTH - MARGIN.right + 6}
            y={rateY(rate) + 4}
            textAnchor="start"
            className="ov-trend-axis"
          >
            {rate}%
          </text>
        ))}

        {/* axes */}
        <line
          x1={MARGIN.left}
          x2={MARGIN.left}
          y1={MARGIN.top}
          y2={BASE_Y}
          className="ov-trend-axis-line"
        />
        <line
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={BASE_Y}
          y2={BASE_Y}
          className="ov-trend-axis-line"
        />

        {/* stacked daily columns */}
        {buckets.map((bucket, index) => {
          const x = bucketX(index, days) - barWidth / 2;
          let stackY = BASE_Y;
          return (
            <g key={bucket.date}>
              <title>{bucketTitle(bucket)}</title>
              {TREND_STATUS_ORDER.map((status) => {
                const count = bucket.status_counts[status];
                if (count === 0) return null;
                const height = (count / yMax) * PLOT_HEIGHT;
                const y = stackY - height;
                stackY = y;
                return (
                  <rect
                    key={status}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    fill={STATUS_FILLS[status]}
                  />
                );
              })}
            </g>
          );
        })}

        {/* pass-rate line, broken on days with no verdicts */}
        {segments.map((segment, index) =>
          segment.length > 1 ? (
            <polyline
              key={`line-${index}`}
              points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
              className="ov-trend-line"
            />
          ) : null
        )}
        {pointCount > 0 &&
          segments.map((segment, index) =>
            segment.map((point, pointIndex) => (
              <circle
                key={`point-${index}-${pointIndex}`}
                cx={point.x}
                cy={point.y}
                r={2.6}
                className="ov-trend-point"
              />
            ))
          )}

        {/* x-axis dates (at most 7 labels) */}
        {buckets.map((bucket, index) =>
          labels.has(index) ? (
            <text
              key={`label-${bucket.date}`}
              x={bucketX(index, days)}
              y={HEIGHT - 12}
              textAnchor="middle"
              className="ov-trend-axis"
            >
              {formatDayMonth(bucket.date)}
            </text>
          ) : null
        )}
      </svg>

      {trend.totals.total === 0 && (
        <div className="ov-trend-empty">
          <p>{trendEmptyCopy(days)}</p>
          <Link href={`/runs?project=${encodeURIComponent(projectId)}`}>
            Go to Test runs
          </Link>
        </div>
      )}
    </div>
  );
}

function TrendTable({ trend, days }: { trend: ProjectTrend; days: TrendWindow }) {
  return (
    <div className="ov-trend-table-wrap">
      <table className="ov-trend-table">
        <caption className="sr-only">{trendTitle(days)} — daily results</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {TREND_STATUS_ORDER.map((status) => (
              <th key={status} scope="col" className="ov-num">
                {STATUS_LABELS[status]}
              </th>
            ))}
            <th scope="col" className="ov-num">
              Total
            </th>
            <th scope="col" className="ov-num">
              Pass rate
            </th>
          </tr>
        </thead>
        <tbody>
          {trend.buckets.map((bucket) => (
            <tr key={bucket.date}>
              <th scope="row">
                <time dateTime={bucket.date}>{formatDateOnly(bucket.date)}</time>
              </th>
              {TREND_STATUS_ORDER.map((status) => (
                <td key={status} className="ov-num">
                  {bucket.status_counts[status]}
                </td>
              ))}
              <td className="ov-num">{bucket.total}</td>
              <td className="ov-num">{formatPassRate(bucket.pass_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultsTrend({ projectId, days, onDaysChange }: ResultsTrendProps) {
  const [data, setData] = useState<ProjectTrend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [retry, setRetry] = useState(0);
  const [tableView, setTableView] = useState(false);
  const hasData = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setError(null);
      if (hasData.current) {
        setUpdating(true);
      } else {
        setLoading(true);
      }
      try {
        const trend = await api.getProjectTrend(projectId, days);
        if (!active) return;
        hasData.current = true;
        setData(trend);
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setError(
          err instanceof ApiError ? err.message || TREND_ERROR : TREND_ERROR
        );
      } finally {
        if (active) {
          setLoading(false);
          setUpdating(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, days, retry]);

  const title = trendTitle(days);

  return (
    <OverviewCard
      title={title}
      busy={updating}
      className="ov-trend-card"
      action={
        <div className="ov-trend-actions">
          {updating && (
            <span
              className="ov-trend-updating"
              role="status"
              aria-live="polite"
            >
              Updating…
            </span>
          )}
          <div className="ov-range" role="group" aria-labelledby="trend-window-label">
            <span id="trend-window-label" className="sr-only">
              Trend window
            </span>
            {[1, 7, 14, 30].map((preset) => {
              const value = preset as TrendWindow;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={days === value}
                  onClick={() => onDaysChange(value)}
                >
                  <span aria-hidden="true">{preset}d</span>
                  <span className="sr-only">{trendWindowLabel(value)}</span>
                </button>
              );
            })}
          </div>
        </div>
      }
    >
      {loading && <CardSkeleton chart />}

      {!loading && error && (
        <CardError message={error} onRetry={() => setRetry((n) => n + 1)} />
      )}

      {!loading && !error && data && (
        <>
          <div className="ov-trend-body">
            {tableView ? (
              <TrendTable trend={data} days={days} />
            ) : (
              <TrendChart trend={data} days={days} projectId={projectId} />
            )}
          </div>

          <div className="ov-trend-footer">
            <ul className="ov-trend-legend" aria-label="Legend">
              {TREND_STATUS_ORDER.map((status) => (
                <li key={status}>
                  <span
                    className={`ov-legend-swatch ov-legend-${status}`}
                    aria-hidden="true"
                  />
                  {STATUS_LABELS[status]}
                </li>
              ))}
              <li>
                <span className="ov-legend-line" aria-hidden="true" />
                Pass rate
              </li>
            </ul>
            <button
              type="button"
              className="ov-trend-toggle"
              aria-expanded={tableView}
              onClick={() => setTableView((open) => !open)}
            >
              {tableView ? "View as chart" : "View as table"}
            </button>
          </div>

          <p className="ov-trend-note muted">
            <span>UTC days</span>
            <span>Pass rate excludes skipped</span>
          </p>
        </>
      )}
    </OverviewCard>
  );
}