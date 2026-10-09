/**
 * StatusBadge — rendering + a11y unit tests (card t_328401f8).
 *
 * The badge spec is docs/DESIGN.md §2.2 as AMENDED by Daedalus's decision
 * t_5fa1c284: ink-900 text + status-solid icon on tints; untested icon is
 * ink-700; failed keeps solid text. Colours resolve only via token names,
 * so these tests assert names, geometry classes and the icon shapes.
 */

import { render, screen } from "@testing-library/react";
import {
  isStatusName,
  STATUS_LABELS,
  StatusBadge,
  type StatusName,
} from "../StatusBadge";

const ALL: StatusName[] = [
  "passed",
  "failed",
  "blocked",
  "retest",
  "skipped",
  "untested",
];

describe("StatusBadge", () => {
  it("renders all six statuses with their sentence-case labels", () => {
    render(
      <>
        {ALL.map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
      </>
    );
    for (const status of ALL) {
      expect(screen.getByText(STATUS_LABELS[status])).toBeInTheDocument();
    }
  });

  it("each badge keeps a visible text label — status is never colour-only (§1.3)", () => {
    render(
      <>
        {ALL.map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
      </>
    );
    // §2.2 amendment: text is always present; the icon is supplementary.
    expect(screen.getByText("Passed")).toBeVisible();
    expect(screen.getByText("Untested")).toBeVisible();
  });

  it("renders the §2.2 icon shape for each status", () => {
    const { container } = render(
      <div>
        {ALL.map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
      </div>
    );
    const icons = Array.from(container.querySelectorAll("svg"));
    expect(icons).toHaveLength(6);

    const [passed, failed, blocked, retest, skipped, untested] = icons;
    // Passed/failed: ring + cross/check path inside the circle.
    expect(passed.querySelector("circle")).not.toBeNull();
    expect(passed.querySelector("path")).not.toBeNull();
    expect(failed.querySelector("circle")).not.toBeNull();
    // Blocked: the only rectangle — minus in square.
    expect(blocked.querySelector("rect")).not.toBeNull();
    expect(blocked.querySelector("circle")).toBeNull();
    // Retest: circular arrow — an open circle path + arrowhead, no <circle>.
    expect(retest.querySelector("circle")).toBeNull();
    expect(retest.querySelectorAll("path")).toHaveLength(2);
    // Skipped: forward chevrons — two open paths, no circle.
    expect(skipped.querySelector("circle")).toBeNull();
    expect(skipped.querySelectorAll("path")).toHaveLength(2);
    // Untested: empty ring — circle only, nothing inside.
    expect(untested.querySelector("circle")).not.toBeNull();
    expect(untested.querySelector("path")).toBeNull();
  });

  it("icons are aria-hidden and non-focusable — the label carries meaning", () => {
    const { container } = render(<StatusBadge status="passed" />);
    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("focusable", "false");
  });

  it("failed keeps solid text; every other status renders the default ink text", () => {
    render(
      <>
        <StatusBadge status="failed" />
        <StatusBadge status="passed" />
        <StatusBadge status="retest" />
      </>
    );
    // The amended spec: failed = tint + SOLID text (4.53:1); the CSS maps
    // .sb-failed to var(--failed) while all others inherit ink-900 text.
    // These class hooks are what the stylesheet keys on.
    expect(screen.getByText("Failed").closest(".sb-badge")).toHaveClass(
      "sb-failed"
    );
    expect(screen.getByText("Passed").closest(".sb-badge")).toHaveClass(
      "sb-passed"
    );
    expect(screen.getByText("Passed").closest(".sb-badge")).not.toHaveClass(
      "sb-failed"
    );
    expect(screen.getByText("Retest").closest(".sb-badge")).toHaveClass(
      "sb-retest"
    );
  });

  it("uses one shared markup everywhere: .sb-badge + per-status class", () => {
    render(<StatusBadge status="blocked" />);
    const badge = screen.getByText("Blocked").closest(".sb-badge");
    expect(badge).toHaveClass("sb-badge");
    expect(badge).toHaveClass("sb-blocked");
  });

  it("supports a custom label override for non-test-status uses", () => {
    render(<StatusBadge status="skipped">Forwarded</StatusBadge>);
    expect(screen.getByText("Forwarded")).toBeInTheDocument();
    expect(screen.queryByText("Skipped")).not.toBeInTheDocument();
  });

  it("attaches an instance explanation via title (supplementary, never the name)", () => {
    render(<StatusBadge status="untested" title="Queued for Release 2.4 smoke" />);
    const badge = screen.getByText("Untested").closest(".sb-badge");
    expect(badge).toHaveAttribute("title", "Queued for Release 2.4 smoke");
  });
});

describe("STATUS_LABELS / isStatusName", () => {
  it("maps all six statuses to sentence-case labels", () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...ALL].sort());
    for (const status of ALL) {
      expect(STATUS_LABELS[status]).toMatch(/^[A-Z]/);
    }
  });

  it("isStatusName narrows only the six real statuses", () => {
    for (const status of ALL) {
      expect(isStatusName(status)).toBe(true);
    }
    expect(isStatusName("archived")).toBe(false);
    expect(isStatusName("ACTIVE")).toBe(false);
    expect(isStatusName("")).toBe(false);
    expect(isStatusName(null)).toBe(false);
  });
});
