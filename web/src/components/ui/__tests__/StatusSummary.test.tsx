/**
 * StatusSummary — rendering tests (card 3.7, review feedback).
 *
 * Spec: the overall figure on its own card beside the pie — the passed share as
 * the big number, "passed" under it, then "untested / total (share)." muted
 * below. Both shares round the same way the pie legend does.
 */

import { render, screen } from "@testing-library/react";
import { StatusSummary } from "../StatusSummary";

describe("StatusSummary", () => {
  it("leads with the passed share and keeps the label under it", () => {
    const { container } = render(
      <StatusSummary counts={{ passed: 110, failed: 7, untested: 91 }} />
    );
    expect(container.querySelector(".sts-percent")?.textContent).toBe("53%");
    expect(container.querySelector(".sts-label")?.textContent).toBe("passed");
    expect(container.querySelector(".sts-headline")).toHaveTextContent(
      "53%passed"
    );
  });

  it("puts untested over the run total with its own share", () => {
    render(<StatusSummary counts={{ passed: 1, failed: 1, untested: 2 }} />);
    expect(screen.getByText("2 / 4 untested (50%).")).toBeInTheDocument();
  });

  it("uses the same rounding as the legend, so the two can never disagree", () => {
    // 1 of 3 is 33% in the footer and in the "33% set to Passed" row.
    const { container } = render(
      <StatusSummary counts={{ passed: 1, failed: 1, untested: 1 }} />
    );
    expect(container.querySelector(".sts-percent")?.textContent).toBe("33%");
    expect(container.querySelector(".sts-sub")?.textContent).toBe(
      "1 / 3 untested (33%)."
    );
  });

  it("reads 0% passed and 0 / 0 untested for a run with no items", () => {
    const { container } = render(<StatusSummary counts={{}} />);
    expect(container.querySelector(".sts-percent")?.textContent).toBe("0%");
    expect(container.querySelector(".sts-sub")?.textContent).toBe(
      "0 / 0 untested (0%)."
    );
  });

  it("counts every status in the denominator, not just passed and untested", () => {
    const { container } = render(
      <StatusSummary
        counts={{ passed: 1, failed: 1, blocked: 1, retest: 1, skipped: 0 }}
      />
    );
    expect(container.querySelector(".sts-percent")?.textContent).toBe("25%");
    expect(container.querySelector(".sts-sub")?.textContent).toBe(
      "0 / 4 untested (0%)."
    );
  });
});