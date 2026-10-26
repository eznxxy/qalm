import { fireEvent, render } from "@testing-library/react";
import { CaseFilters } from "@/components/cases/CaseFilters";

/**
 * CaseFilters (DESIGN §5 "Filter bar"): the Priority / Type / Tags menus are an
 * accordion — opening one closes the others, so only one summary shows the
 * active (accent) state at a time.
 */

function renderBar() {
  const { container } = render(
    <CaseFilters
      query=""
      priorities={[]}
      types={[]}
      tags={[]}
      availableTags={[]}
      resultCount={0}
      onChange={() => {}}
    />
  );
  const menus = Array.from(
    container.querySelectorAll<HTMLDetailsElement>("details.filter-menu")
  );
  return { menus };
}

function summaryOf(menu: HTMLDetailsElement): HTMLElement {
  const summary = menu.querySelector("summary");
  if (!summary) throw new Error("menu has no summary");
  return summary;
}

describe("CaseFilters filter menus", () => {
  it("renders the three filter menus, all closed", () => {
    const { menus } = renderBar();
    expect(menus.map((menu) => summaryText(menu))).toEqual([
      "Priority",
      "Type",
      "Tags",
    ]);
    expect(menus.every((menu) => !menu.open)).toBe(true);
  });

  it("keeps only one menu open at a time", () => {
    const { menus } = renderBar();
    const [priority, type, tags] = menus as [
      HTMLDetailsElement,
      HTMLDetailsElement,
      HTMLDetailsElement,
    ];

    fireEvent.click(summaryOf(priority));
    expect(priority.open).toBe(true);
    expect(type.open).toBe(false);

    // Opening a second menu closes the first.
    fireEvent.click(summaryOf(type));
    expect(type.open).toBe(true);
    expect(priority.open).toBe(false);

    // ...and a third closes the second.
    fireEvent.click(summaryOf(tags));
    expect(tags.open).toBe(true);
    expect(type.open).toBe(false);
    expect(priority.open).toBe(false);

    // Clicking the open menu's own summary collapses it.
    fireEvent.click(summaryOf(tags));
    expect(tags.open).toBe(false);
    expect(menus.every((menu) => !menu.open)).toBe(true);
  });
});

function summaryText(menu: HTMLDetailsElement): string {
  const summary = menu.querySelector("summary");
  return (summary?.textContent ?? "").trim();
}