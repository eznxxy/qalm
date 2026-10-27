/**
 * StatusPie — rendering + a11y unit tests (card 3.7, review feedback).
 *
 * Spec: a full pie (no hole, no centre number) with a two-column legend that
 * carries the numbers — "1 Passed" over "33% set to Passed" — every status
 * listed, zeros included, in the fixed §5 order.
 */

import { render, screen } from "@testing-library/react";
import { STATUS_ORDER, type StatusBarValue } from "../StatusBar";
import { StatusPie } from "../StatusPie";

/** Wedge classes in DOM order, e.g. ["stp-passed", "stp-untested"]. */
function sliceClasses(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".stp-slice")).map((el) => {
    const classes = Array.from(el.classList).filter((c) => c !== "stp-slice");
    expect(classes).toHaveLength(1);
    return classes[0];
  });
}

/** [title, subtitle] per legend row, e.g. ["1 Passed", "33% set to Passed"]. */
function legendRows(container: HTMLElement): [string, string][] {
  return Array.from(container.querySelectorAll(".stp-legend-row")).map((row) => [
    row.querySelector(".stp-legend-title")?.textContent ?? "",
    row.querySelector(".stp-legend-sub")?.textContent ?? "",
  ]);
}

describe("StatusPie", () => {
  it("renders one wedge per nonzero status in the fixed §5 order", () => {
    const counts: StatusBarValue = {
      untested: 2,
      failed: 1,
      passed: 3,
    };
    const { container } = render(<StatusPie counts={counts} />);
    expect(sliceClasses(container)).toEqual([
      "stp-passed",
      "stp-failed",
      "stp-untested",
    ]);
  });

  it("carries the numbers in the legend: count in the title, share below", () => {
    const { container } = render(<StatusPie counts={{ passed: 1, untested: 2 }} />);
    expect(legendRows(container)).toEqual([
      ["1 Passed", "33% set to Passed"],
      ["0 Retest", "0% set to Retest"],
      ["0 Blocked", "0% set to Blocked"],
      ["0 Failed", "0% set to Failed"],
      ["0 Skipped", "0% set to Skipped"],
      ["2 Untested", "67% set to Untested"],
    ]);
    expect(legendRows(container).map(([title]) => title.split(" ")[1])).toEqual(
      STATUS_ORDER.map((status) => label(status))
    );
  });

  it("keeps the status dot on a zero row — the dot is the colour key", () => {
    const { container } = render(
      <StatusPie counts={{ passed: 1, untested: 2 }} />
    );
    const dots = Array.from(container.querySelectorAll(".stp-dot")).map((el) =>
      Array.from(el.classList).find((c) => c !== "stp-dot")
    );
    // Four zeros still render their own colour, so every row is identifiable.
    expect(dots).toEqual([
      "stp-passed",
      "stp-retest",
      "stp-blocked",
      "stp-failed",
      "stp-skipped",
      "stp-untested",
    ]);
  });

  it("draws wedges from the centre, starting at 12 o'clock", () => {
    const { container } = render(
      <StatusPie counts={{ passed: 1, failed: 1 }} />
    );
    const [first, second] = Array.from(container.querySelectorAll(".stp-slice"));
    // Half the circle: straight down from 12 o'clock to 6 o'clock, no large arc.
    expect(first.getAttribute("d")).toBe(
      "M 21 21 L 21.000 1.000 A 20 20 0 0 1 21.000 41.000 Z"
    );
    expect(second.getAttribute("d")).toBe(
      "M 21 21 L 21.000 41.000 A 20 20 0 0 1 21.000 1.000 Z"
    );
  });

  it("draws a full circle when one status owns the run", () => {
    const { container } = render(<StatusPie counts={{ passed: 5 }} />);
    const slice = container.querySelector(".stp-slice") as SVGElement;
    expect(slice.tagName.toLowerCase()).toBe("circle");
    expect(slice.getAttribute("class")).toContain("stp-passed");
    expect(container.querySelector("path")).toBeNull();
  });

  it("puts the passed share and the untested footer beside the pie", () => {
    const { container } = render(
      <StatusPie counts={{ passed: 1, failed: 1, untested: 2 }} />
    );
    const stat = container.querySelector(".stp-stat") as HTMLElement;
    expect(stat).toBeInTheDocument();
    expect(stat.querySelector(".stp-stat-percent")?.textContent).toBe("25%");
    expect(stat.querySelector(".stp-stat-label")?.textContent).toBe("passed");
    expect(stat.querySelector(".stp-stat-sub")?.textContent).toBe(
      "2 / 4 untested (50%)."
    );
    // It sits between the pie and the breakdown, not below them.
    const root = container.querySelector(".stp-root") as HTMLElement;
    expect(
      Array.from(root.children).map((el) => el.getAttribute("class"))
    ).toEqual(["stp-chart", "stp-stat", "stp-legend"]);
  });

  it("reads 0% passed and 0 / 0 untested for a run with no items", () => {
    const { container } = render(<StatusPie counts={{}} />);
    expect(container.querySelector(".stp-stat-percent")?.textContent).toBe("0%");
    expect(container.querySelector(".stp-stat-sub")?.textContent).toBe(
      "0 / 0 untested (0%)."
    );
  });

  it("names the group after the run and stays decorative for the SVG", () => {
    const { container } = render(
      <StatusPie counts={{ passed: 2, untested: 1 }} label="Release 2.4 smoke" />
    );
    expect(
      screen.getByRole("group", { name: "Release 2.4 smoke results by status" })
    ).toBeInTheDocument();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    );
    // The legend is the accessible view of the numbers.
    expect(screen.getByText("1 Untested")).toBeInTheDocument();
    expect(screen.getByText("33% set to Untested")).toBeInTheDocument();
  });

  it("leaves an empty disc for a run with no items", () => {
    const { container } = render(<StatusPie counts={{}} />);
    expect(container.querySelectorAll(".stp-slice")).toHaveLength(0);
    expect(container.querySelector(".stp-track")).toBeInTheDocument();
    expect(legendRows(container).map(([, sub]) => sub)).toEqual(
      STATUS_ORDER.map((status) => `0% set to ${label(status)}`)
    );
  });
});

/** Local mirror of STATUS_LABELS so the expectation above stays declarative. */
function label(status: (typeof STATUS_ORDER)[number]): string {
  return {
    passed: "Passed",
    retest: "Retest",
    blocked: "Blocked",
    failed: "Failed",
    skipped: "Skipped",
    untested: "Untested",
  }[status];
}