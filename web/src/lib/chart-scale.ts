/**
 * Shared plot geometry for the reports charts (docs/DESIGN.md §4.8 and §4.9).
 *
 * The overview's results trend and the reports failures chart draw the same
 * frame, so the numbers live here once rather than drifting between cards.
 * Helpers are pure and take the window length explicitly; the cards decide
 * what to plot.
 */

export const CHART_WIDTH = 680;
export const CHART_HEIGHT = 250;
export const CHART_MARGIN = { top: 16, right: 48, bottom: 32, left: 38 };
export const PLOT_WIDTH = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
export const PLOT_HEIGHT = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
export const BASE_Y = CHART_MARGIN.top + PLOT_HEIGHT;

/**
 * A count axis with integer ticks and at most five gridlines, always anchored
 * at 0. An empty window keeps a quiet 0–4 frame so the plot is never a bare
 * line.
 */
export function niceScale(maxValue: number): { max: number; ticks: number[] } {
  if (maxValue <= 4) return { max: 4, ticks: [0, 2, 4] };
  const rough = maxValue / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / magnitude;
  const step =
    (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude;
  const max = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + 1e-9; value += step) ticks.push(value);
  return { max, ticks };
}

/** Indices that get an x-axis label: at most 7, always first and last. */
export function labelIndices(days: number): Set<number> {
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

export function bucketX(index: number, days: number): number {
  return CHART_MARGIN.left + (PLOT_WIDTH / days) * (index + 0.5);
}

/** One day's slice of the plot; a one-day window owns all of it. */
export function slotWidth(days: number): number {
  return PLOT_WIDTH / Math.max(days, 1);
}

/**
 * A column is a little over half its slot but keeps a readable floor and a
 * ceiling (a one-day window may pass a taller cap than the seven-plus ones).
 */
export function barWidthFor(days: number, maxBar = 46): number {
  return Math.max(5, Math.min(maxBar, slotWidth(days) * 0.56));
}

/** Shoulder radius for a column's top segment: softer as the column widens. */
export function barRadius(barWidth: number): number {
  return barWidth >= 34 ? 4 : barWidth >= 12 ? 3 : 2;
}

/** A count's y position on the share count axis, anchored at `BASE_Y` for 0. */
export function valueY(value: number, yMax: number): number {
  return BASE_Y - (value / yMax) * PLOT_HEIGHT;
}

/** A column's top segment gets rounded shoulders; the stack stays crisp. */
export function roundedTopRect(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return [
    `M ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `H ${x + width - r}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `V ${y + height}`,
    `H ${x}`,
    "Z",
  ].join(" ");
}