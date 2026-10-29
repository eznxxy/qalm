import { render, screen, within } from "@testing-library/react";
import { ProjectTabs } from "../ProjectTabs";

/**
 * The strip's active tab is decided by the route, not by local state
 * (docs/DESIGN.md §4.8). Each route owns one tab, and every tab links to the
 * screen that already lists that data scoped to this project.
 */

const mockNav = { pathname: "/projects/p-1" };

jest.mock("next/navigation", () => ({
  usePathname: () => mockNav.pathname,
}));

const TAB_ROUTES = [
  ["Overview", "/projects/p-1"],
  ["Milestones", "/milestones?project=p-1"],
  ["Test runs", "/runs?project=p-1"],
  ["Test cases", "/cases?project=p-1"],
  ["Reports", "/reports?project=p-1"],
] as const;

function activeLabels(): string[] {
  return within(screen.getByRole("navigation", { name: "Project sections" }))
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent ?? "");
}

beforeEach(() => {
  mockNav.pathname = "/projects/p-1";
});

describe("ProjectTabs", () => {
  it("links every tab at its own route, scoped to the project", () => {
    render(<ProjectTabs projectId="p-1" />);

    for (const [label, href] of TAB_ROUTES) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href
      );
    }
  });

  it("marks Overview active on the project page", () => {
    render(<ProjectTabs projectId="p-1" />);
    expect(activeLabels()).toEqual(["Overview"]);
  });

  it.each([
    ["/milestones", "Milestones"],
    ["/runs", "Test runs"],
    ["/cases", "Test cases"],
    ["/reports", "Reports"],
  ])("marks %s as %s and nothing else", (pathname, label) => {
    mockNav.pathname = pathname;
    render(<ProjectTabs projectId="p-1" />);
    expect(activeLabels()).toEqual([label]);
  });

  it("keeps the Reports tab active on a report deep link", () => {
    // The pathname is the route, not the query: /reports?project=p-1&days=7
    // still resolves to the reports tab.
    mockNav.pathname = "/reports";
    render(<ProjectTabs projectId="p-1" />);
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});
