import {
  CHART_MARGIN,
  PLOT_WIDTH,
  bucketX,
  labelIndices,
  niceScale,
  roundedTopRect,
} from "../chart-scale";

describe("niceScale", () => {
  it("keeps a quiet 0–4 frame for an empty plot", () => {
    expect(niceScale(0)).toEqual({ max: 4, ticks: [0, 2, 4] });
  });

  it("rounds a busy axis up to a readable step", () => {
    expect(niceScale(47)).toEqual({ max: 60, ticks: [0, 20, 40, 60] });
  });
});

describe("labelIndices", () => {
  it("labels at most seven days, always including first and last", () => {
    const thirty = labelIndices(30);
    expect(thirty.size).toBe(7);
    expect(thirty.has(0)).toBe(true);
    expect(thirty.has(29)).toBe(true);
  });

  it("labels a single-day window once", () => {
    expect([...labelIndices(1)]).toEqual([0]);
  });
});

describe("bucketX", () => {
  it("centres each day slot and moves right", () => {
    expect(bucketX(0, 7)).toBeGreaterThan(CHART_MARGIN.left);
    expect(bucketX(0, 7)).toBeLessThan(bucketX(1, 7));
    expect(bucketX(6, 7)).toBeLessThan(CHART_MARGIN.left + PLOT_WIDTH);
  });
});

describe("roundedTopRect", () => {
  it("clamps the radius to half the width and to the segment height", () => {
    expect(roundedTopRect(10, 10, 10, 4, 99)).toBe(
      "M 10 14 Q 10 10 14 10 H 16 Q 20 10 20 14 V 14 H 10 Z"
    );
    expect(roundedTopRect(10, 10, 20, 30, 99)).toBe(
      "M 10 20 Q 10 10 20 10 H 20 Q 30 10 30 20 V 40 H 10 Z"
    );
  });
});