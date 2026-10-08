/**
 * PriorityIcon — rendering + a11y unit tests (card t_328401f8).
 *
 * Spec: docs/DESIGN.md §2.2 — Critical double chevron up (in --failed),
 * High chevron up, Medium dash, Low chevron down, ink-700 otherwise.
 */

import { render } from "@testing-library/react";
import {
  PRIORITY_LABELS,
  PriorityIcon,
  type PriorityName,
} from "../PriorityIcon";

const ALL: PriorityName[] = ["critical", "high", "medium", "low"];

describe("PriorityIcon", () => {
  it("renders all four priorities, one glyph each on the shared grid", () => {
    render(
      <div>
        {ALL.map((p) => (
          <PriorityIcon key={p} priority={p} />
        ))}
      </div>
    );
    // svg has an implicit role only when named; these are deliberately
    // nameless (aria-hidden) — assert on the elements themselves.
    const icons = Array.from(document.querySelectorAll("svg.pi-icon"));
    expect(icons).toHaveLength(4);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("viewBox", "0 0 16 16");
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(icon).toHaveAttribute("focusable", "false");
    }
  });

  it("critical is the double chevron (two paths); the others are single glyphs", () => {
    const { container } = render(
      <div>
        {ALL.map((p) => (
          <PriorityIcon key={p} priority={p} />
        ))}
      </div>
    );
    const byClass = (name: string) =>
      container.querySelector(`svg.pi-${name}`) as SVGSVGElement;
    expect(byClass("critical").querySelectorAll("path")).toHaveLength(2);
    expect(byClass("high").querySelectorAll("path")).toHaveLength(1);
    expect(byClass("medium").querySelectorAll("path")).toHaveLength(1);
    expect(byClass("low").querySelectorAll("path")).toHaveLength(1);
  });

  it("high points up and low points down (chevron direction is the meaning)", () => {
    const { container } = render(
      <div>
        <PriorityIcon priority="high" />
        <PriorityIcon priority="low" />
      </div>
    );
    const [high, low] = Array.from(container.querySelectorAll("svg path"));
    // Up chevron starts at the lower vertex (y=11); down chevron at the
    // upper one (y=5) — pin the direction so a refactor can't flip it.
    expect(high.getAttribute("d")).toMatch(/^m3\.2 11/);
    expect(low.getAttribute("d")).toMatch(/^m3\.2 5/);
  });

  it("carries the pi-critical hook — the stylesheet maps it to --failed", () => {
    const critical = render(<PriorityIcon priority="critical" />).container.querySelector(
      "svg"
    ) as SVGSVGElement;
    expect(critical).toHaveClass("pi-icon");
    expect(critical).toHaveClass("pi-critical");
    const ink = render(<PriorityIcon priority="medium" />).container.querySelector(
      "svg"
    ) as SVGSVGElement;
    expect(ink).toHaveClass("pi-icon");
    expect(ink).toHaveClass("pi-medium");
    expect(ink).not.toHaveClass("pi-critical");
  });

  it("hidden renders the glyph for sighted-only suppression (aria-hidden already set)", () => {
    const icon = render(<PriorityIcon priority="high" hidden />).container
      .querySelector("svg") as SVGSVGElement;
    expect(icon).toHaveClass("pi-hidden");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});

describe("PRIORITY_LABELS", () => {
  it("maps the four priorities to sentence-case words", () => {
    expect(Object.keys(PRIORITY_LABELS).sort()).toEqual([...ALL].sort());
    expect(PRIORITY_LABELS.critical).toBe("Critical");
    expect(PRIORITY_LABELS.low).toBe("Low");
  });
});
