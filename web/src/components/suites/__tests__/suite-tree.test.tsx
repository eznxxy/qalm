import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import type { SuiteNode } from "@/lib/api-types";
import { SuiteTree } from "@/components/suites/SuiteTree";

/**
 * SuiteTree — ARIA treeview behaviour (card 3.1): keyboard navigation,
 * counts, expand/collapse and the non-empty delete guard. Drag/drop maths is
 * covered by dropRequest's own unit tests, so this file checks the wiring:
 * a drop emits the coordinates the API expects.
 */

function suite(overrides: Partial<SuiteNode> & { id: string; name: string }): SuiteNode {
  return {
    project_id: "p-1",
    parent_id: null,
    description: null,
    depth: 1,
    position: 1,
    case_count: 0,
    created_by: "u-1",
    created_at: "2026-10-25T09:00:00Z",
    updated_at: "2026-10-25T09:00:00Z",
    children: [],
    ...overrides,
  };
}

const CHECKOUT = suite({
  id: "s-1",
  name: "Checkout",
  case_count: 7,
  children: [
    suite({
      id: "s-2",
      parent_id: "s-1",
      name: "Payments",
      depth: 2,
      case_count: 4,
      children: [
        suite({
          id: "s-3",
          parent_id: "s-2",
          name: "Cards",
          depth: 3,
          case_count: 2,
        }),
      ],
    }),
  ],
});

const ACCOUNT = suite({
  id: "s-4",
  name: "Account",
  position: 2,
  case_count: 0,
});

function treeProps(
  overrides: Partial<React.ComponentProps<typeof SuiteTree>> = {}
): React.ComponentProps<typeof SuiteTree> {
  return {
    nodes: [CHECKOUT, ACCOUNT],
    selectedId: null,
    expandedIds: new Set(["s-1", "s-2"]),
    onSelect: jest.fn(),
    onToggle: jest.fn(),
    ...overrides,
  };
}

/** Tree items are named by their contents ("Collapse Checkout Checkout 7"). */
function item(name: string): HTMLElement {
  return screen.getByRole("treeitem", { name: new RegExp(name) });
}

describe("SuiteTree", () => {
  it("renders a treeview with levels, expansion state and subtree counts", () => {
    render(<SuiteTree {...treeProps()} />);

    const tree = screen.getByRole("tree", { name: "Test suites" });
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(4);

    const checkout = item("Checkout");
    expect(checkout).toHaveAttribute("aria-level", "1");
    expect(checkout).toHaveAttribute("aria-expanded", "true");
    expect(within(checkout).getByText("7")).toBeInTheDocument();

    expect(item("Cards")).toHaveAttribute("aria-level", "3");
    expect(item("Cards")).not.toHaveAttribute("aria-expanded");
  });

  it("hides collapsed children", () => {
    render(<SuiteTree {...treeProps({ expandedIds: new Set(["s-1"]) })} />);

    expect(screen.queryByRole("treeitem", { name: /Cards/ })).toBeNull();
    expect(item("Payments")).toHaveAttribute("aria-expanded", "false");
  });

  it("moves focus with the arrow keys and selects with Enter", () => {
    const onSelect = jest.fn();
    render(<SuiteTree {...treeProps({ onSelect })} />);

    act(() => item("Checkout").focus());
    fireEvent.keyDown(item("Checkout"), { key: "ArrowDown" });
    expect(item("Payments")).toHaveFocus();

    fireEvent.keyDown(item("Payments"), { key: "End" });
    expect(item("Account")).toHaveFocus();

    fireEvent.keyDown(item("Account"), { key: "Home" });
    expect(item("Checkout")).toHaveFocus();

    fireEvent.keyDown(item("Checkout"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("s-1");
  });

  it("expands a collapsed suite with ArrowRight", () => {
    const onToggle = jest.fn();
    render(<SuiteTree {...treeProps({ onToggle, expandedIds: new Set() })} />);

    act(() => item("Checkout").focus());
    fireEvent.keyDown(item("Checkout"), { key: "ArrowRight" });
    expect(onToggle).toHaveBeenCalledWith("s-1");
  });

  it("enters the first child with ArrowRight and returns with ArrowLeft", () => {
    render(<SuiteTree {...treeProps({ expandedIds: new Set(["s-1"]) })} />);

    act(() => item("Checkout").focus());
    fireEvent.keyDown(item("Checkout"), { key: "ArrowRight" });
    expect(item("Payments")).toHaveFocus();

    fireEvent.keyDown(item("Payments"), { key: "ArrowLeft" });
    expect(item("Checkout")).toHaveFocus();
  });

  it("selects on click and toggles via the expander button", () => {
    const onSelect = jest.fn();
    const onToggle = jest.fn();
    render(<SuiteTree {...treeProps({ onSelect, onToggle })} />);

    fireEvent.click(item("Payments"));
    expect(onSelect).toHaveBeenCalledWith("s-2");

    fireEvent.click(screen.getByRole("button", { name: "Collapse Checkout" }));
    expect(onToggle).toHaveBeenCalledWith("s-1");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("marks the selected suite and keeps one roving tab stop", () => {
    render(<SuiteTree {...treeProps({ selectedId: "s-2" })} />);

    expect(item("Payments")).toHaveAttribute("aria-selected", "true");
    expect(item("Payments")).toHaveAttribute("tabindex", "0");
    expect(item("Checkout")).toHaveAttribute("tabindex", "-1");
  });

  it("offers the unscoped 'All suites' row with the project total", () => {
    const onSelectAll = jest.fn();
    render(
      <SuiteTree
        {...treeProps({ onSelectAll, totalCount: 11, allSelected: true })}
      />
    );

    const all = screen.getByRole("button", { name: /All suites/ });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(within(all).getByText("11")).toBeInTheDocument();
    fireEvent.click(all);
    expect(onSelectAll).toHaveBeenCalled();
  });

  it("emits a drop request for a keyboard-accessible move", () => {
    const onMove = jest.fn();
    render(<SuiteTree {...treeProps({ onMove })} />);

    const dataTransfer = { setData: jest.fn(), effectAllowed: "" };
    fireEvent.dragStart(item("Account"), { dataTransfer });
    // jsdom reports a zero-size rect, so every drop lands "inside".
    fireEvent.dragOver(item("Checkout"), { dataTransfer, clientY: 0 });
    fireEvent.drop(item("Checkout"), { dataTransfer, clientY: 0 });

    expect(onMove).toHaveBeenCalledWith({
      id: "s-4",
      parentId: "s-1",
      position: 2,
    });
  });

  it("disables delete for a suite that still has cases or children", () => {
    const onDeleteSuite = jest.fn();
    render(<SuiteTree {...treeProps({ selectedId: "s-1", onDeleteSuite })} />);

    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toBeDisabled();
    expect(del).toHaveAttribute("title", "Move or delete its cases first");
  });

  it("enables delete for an empty leaf", () => {
    const onDeleteSuite = jest.fn();
    render(<SuiteTree {...treeProps({ selectedId: "s-4", onDeleteSuite })} />);

    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toBeEnabled();
    fireEvent.click(del);
    expect(onDeleteSuite).toHaveBeenCalledWith(ACCOUNT);
  });

  it("disables 'Add child' at the depth cap", () => {
    render(
      <SuiteTree
        {...treeProps({ selectedId: "s-3", onAddSuite: jest.fn() })}
      />
    );

    const addChild = screen.getByRole("button", { name: "+ Add child" });
    expect(addChild).toBeDisabled();
    expect(addChild).toHaveAttribute("title", "Suites are limited to 3 levels");
  });

  it("disables 'Move to…' without a selection", () => {
    render(
      <SuiteTree
        {...treeProps({ selectedId: null, onRequestMove: jest.fn() })}
      />
    );

    expect(screen.getByRole("button", { name: "Move to…" })).toBeDisabled();
  });

  it("shows the loading state", () => {
    render(<SuiteTree {...treeProps({ loading: true })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading suites…");
  });

  it("shows the error state with a working Retry", () => {
    const onRetry = jest.fn();
    render(
      <SuiteTree {...treeProps({ error: "Couldn't load suites.", onRetry })} />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load suites.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows the empty state with the way forward", () => {
    render(<SuiteTree {...treeProps({ nodes: [], onAddSuite: jest.fn() })} />);

    expect(
      screen.getByText("No suites yet. Add a suite to start organising cases.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add suite" })).toBeInTheDocument();
  });

  it("hides write controls from read-only roles", () => {
    render(<SuiteTree {...treeProps({ selectedId: "s-4" })} />);

    expect(screen.queryByRole("button", { name: "+ Add suite" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add child" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move to…" })).toBeNull();
  });
});

