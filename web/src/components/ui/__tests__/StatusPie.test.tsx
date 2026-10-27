/**
 * StatusPie — rendering + a11y unit tests (card 3.7, review feedback).
 *
 * Spec: the run detail header shows a pie/donut of the run's statuses with a
 * legend covering **all six** statuses (zeros included), the fixed §5 order,
 * and completion in the middle (`done` = total − untested).
 */

import { render, screen } from "@testing-library/react";
import { STATUS_ORDER, type StatusBarValue } from "../StatusBar";
import { percentComplete, StatusPie } from "../StatusPie";

/** Slice classes in DOM order, e.g. ["stp-passed", "stp-untested"]. */
function sliceClasses(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".stp-slice")).map((el) => {
    const classes = Array.from(el.classList).filter((c) => c !== "stp-slice");
    expect(classes).toHaveLength(1);
    return classes[0];
  });
}

function legendRows(container: HTMLElement): [string, string][] {
  return Array.from(container.querySelectorAll(".stp-legend-row")).map((row) => [
    row.querySelector(".stp-legend-label")?.textContent ?? "",
    row.querySelector(".stp-legend-count")?.textContent ?? "",
  ]);
}

describe("StatusPie", () => {
  it("renders one slice per nonzero status in the fixed §5 order", () => {
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

  it("lists every status in the legend, zeros included", () => {
    const counts: StatusBarValue = { passed: 1, untested: 2 };
    const { container } = render(<StatusPie counts={counts} />);
    expect(legendRows(container)).toEqual([
      ["Passed", "1"],
      ["Retest", "0"],
      ["Blocked", "0"],
      ["Failed", "0"],
      ["Skipped", "0"],
      ["Untested", "2"],
    ]);
    expect(legendRows(container).map(([label]) => label)).toEqual(
      STATUS_ORDER.map((status) => label(status))
    );
  });

  it("greys the zero rows so the eye lands on the statuses that exist", () => {
    const { container } = render(
      <StatusPie counts={{ passed: 1, untested: 2 }} />
    );
    const zero = container.querySelectorAll(".stp-legend-row.is-zero");
    expect(zero).toHaveLength(4);
  });

  it("puts completion in the middle: done = total − untested", () => {
    const { container } = render(
      <StatusPie counts={{ passed: 1, untested: 2 }} />
    );
    expect(container.querySelector(".stp-percent")?.textContent).toBe("33%");
    // 3 of 4 done rounds to 75, matching the run resource's percent_complete.
    expect(percentComplete({ passed: 2, failed: 1, untested: 1 })).toBe(75);
    expect(percentComplete({ untested: 2 })).toBe(0);
    expect(percentComplete({ passed: 2 })).toBe(100);
    expect(percentComplete({})).toBe(0);
  });

  it("draws a full ring when one status owns the run", () => {
    const { container } = render(<StatusPie counts={{ passed: 5 }} />);
    const slice = container.querySelector(".stp-slice");
    expect(slice?.getAttribute("stroke-dasharray")).toBe("100 0");
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
    expect(screen.getByText("Untested")).toBeInTheDocument();
  });

  it("renders an empty ring for a run with no items", () => {
    const { container } = render(<StatusPie counts={{}} />);
    expect(container.querySelectorAll(".stp-slice")).toHaveLength(0);
    expect(container.querySelector(".stp-track")).toBeInTheDocument();
    expect(container.querySelector(".stp-percent")?.textContent).toBe("0%");
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