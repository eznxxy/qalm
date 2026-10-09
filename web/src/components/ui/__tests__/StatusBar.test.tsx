/**
 * StatusBar — rendering + a11y unit tests (card t_328401f8).
 *
 * Spec: docs/DESIGN.md §5 "Status bar" — segmented bar, 8px tables /
 * 16px dashboards, segment order Passed, Retest, Blocked, Failed,
 * Skipped, Untested, hover counts, role="img" + aria-label spelling out
 * the numbers.
 */

import { render, screen } from "@testing-library/react";
import {
  formatCounts,
  nonzeroStatuses,
  STATUS_ORDER,
  StatusBar,
  type StatusBarValue,
} from "../StatusBar";

/** Segment classes in DOM order, e.g. ["stb-passed", "stb-failed"]. */
function segmentClasses(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".stb-segment")).map((el) => {
    const classes = Array.from(el.classList).filter((c) => c !== "stb-segment");
    expect(classes).toHaveLength(1);
    return classes[0];
  });
}

describe("StatusBar", () => {
  it("renders one segment per nonzero status in the fixed §5 order", () => {
    const counts: StatusBarValue = {
      untested: 13,
      failed: 4,
      passed: 31,
      blocked: 2,
    };
    const { container } = render(<StatusBar counts={counts} />);
    // Passed, Retest, Blocked, Failed, Skipped, Untested — never sorted.
    expect(segmentClasses(container)).toEqual([
      "stb-passed",
      "stb-blocked",
      "stb-failed",
      "stb-untested",
    ]);
  });

  it("STATUS_ORDER is exactly the §5 segment order", () => {
    expect(STATUS_ORDER).toEqual([
      "passed",
      "retest",
      "blocked",
      "failed",
      "skipped",
      "untested",
    ]);
  });

  it("aria-label spells the numbers out, matching the §5 example verbatim", () => {
    const counts: StatusBarValue = {
      passed: 31,
      failed: 4,
      blocked: 2,
      untested: 13,
    };
    render(<StatusBar counts={counts} />);
    const bar = screen.getByRole("img");
    expect(bar).toHaveAttribute(
      "aria-label",
      "31 passed, 4 failed, 2 blocked, 13 untested"
    );
  });

  it("the accessible label exists in prose order and drops zero counts", () => {
    // Zero-count statuses are omitted so the label stays scannable.
    render(<StatusBar counts={{ passed: 5, retest: 1, untested: 4 }} />);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "5 passed, 1 retest, 4 untested"
    );
  });

  it("hover title shows the same counts the screen reader gets", () => {
    render(<StatusBar counts={{ passed: 3, failed: 2 }} />);
    const bar = screen.getByRole("img", { hidden: false });
    expect(bar).toHaveAttribute("title", "3 passed, 2 failed");
  });

  it("prepends the optional label so multiple bars are distinguishable", () => {
    render(
      <StatusBar label="Release 2.4 smoke" counts={{ passed: 2, failed: 1 }} />
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Release 2.4 smoke: 2 passed, 1 failed"
    );
  });

  it("is 8px (stb-small) by default and 16px (stb-large) for dashboards", () => {
    const { container, rerender } = render(<StatusBar counts={{ passed: 1 }} />);
    expect(container.firstElementChild).toHaveClass("stb-small");
    rerender(<StatusBar counts={{ passed: 1 }} size="large" />);
    expect(container.firstElementChild).toHaveClass("stb-large");
    expect(container.firstElementChild).not.toHaveClass("stb-small");
  });

  it("segment widths are proportional to counts", () => {
    const { container } = render(
      <StatusBar counts={{ passed: 75, failed: 25 }} />
    );
    const [passed, failed] = Array.from(
      container.querySelectorAll(".stb-segment")
    );
    expect(passed).toHaveAttribute("style", expect.stringContaining("75%"));
    expect(failed).toHaveAttribute("style", expect.stringContaining("25%"));
  });

  it("renders nothing when every count is zero — no fake data", () => {
    const { container } = render(<StatusBar counts={{}} />);
    expect(container.querySelector(".stb-root")).toBeNull();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders nothing for all-zero counts too", () => {
    const { container } = render(
      <StatusBar
        counts={{
          passed: 0,
          retest: 0,
          blocked: 0,
          failed: 0,
          skipped: 0,
          untested: 0,
        }}
      />
    );
    expect(container.querySelector(".stb-root")).toBeNull();
  });

  it("keeps nonzero segments visible at the 2px minimum (1 of 200)", () => {
    const { container } = render(
      <StatusBar counts={{ failed: 1, passed: 199 }} />
    );
    const [, failed] = Array.from(container.querySelectorAll(".stb-segment"));
    expect(failed).toHaveClass("stb-failed");
    // Sub-1% width comes out of the percentage; the stylesheet's min-width
    // floor is what keeps the sliver on screen.
    expect(failed).toHaveAttribute("style", expect.stringContaining("0.5%"));
  });
});

describe("nonzeroStatuses / formatCounts helpers", () => {
  it("nonzeroStatuses filters to present statuses in segment order", () => {
    expect(
      nonzeroStatuses({ skipped: 2, passed: 1, retest: 0 })
    ).toEqual(["passed", "skipped"]);
    expect(nonzeroStatuses({})).toEqual([]);
  });

  it("formatCounts joins lowercase labels with comma+space", () => {
    expect(formatCounts({ passed: 31, failed: 4 })).toBe(
      "31 passed, 4 failed"
    );
    expect(formatCounts({})).toBe("");
  });
});
