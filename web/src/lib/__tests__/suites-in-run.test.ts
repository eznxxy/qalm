import type { SuiteNode } from "@/lib/api-types";
import { suitesInRun } from "@/lib/suites";

/**
 * The run detail Section filter (docs/DESIGN.md §4.4): `Run.suite_ids` is the
 * distinct set of suites the run's items came from, so the dropdown offers
 * those and nothing else. These tests pin the tree order, the real depth and
 * the two empty cases.
 */

function suite(
  id: string,
  name: string,
  depth: number,
  children: SuiteNode[] = []
): SuiteNode {
  return {
    id,
    project_id: "p-1",
    parent_id: null,
    name,
    description: null,
    depth,
    position: 0,
    case_count: 0,
    created_by: "u-1",
    created_at: "2026-10-26T08:00:00Z",
    updated_at: "2026-10-26T08:00:00Z",
    children,
  };
}

// Payments (root)
//   Checkout
//     Cards
//   Refunds
// Search (root)
// Auth (root)
//   Login
const tree: SuiteNode[] = [
  suite("payments", "Payments", 1, [
    suite("checkout", "Checkout", 2, [suite("cards", "Cards", 3)]),
    suite("refunds", "Refunds", 2),
  ]),
  suite("search", "Search", 1),
  suite("auth", "Auth", 1, [suite("login", "Login", 2)]),
];

describe("suitesInRun", () => {
  it("keeps only the suites the run has items from", () => {
    const options = suitesInRun(tree, ["refunds", "login"]);

    expect(options.map((entry) => entry.node.name)).toEqual(["Refunds", "Login"]);
  });

  it("returns them in tree order, not in id-list order", () => {
    // The aggregate's order is unspecified, so the tree has to decide.
    const options = suitesInRun(tree, ["login", "search", "cards"]);

    expect(options.map((entry) => entry.node.id)).toEqual([
      "cards",
      "search",
      "login",
    ]);
  });

  it("keeps the real depth, so the indentation still shows nesting", () => {
    // Payments itself has no items, but Cards sits at depth 3 and stays there.
    const options = suitesInRun(tree, ["cards"]);

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      level: 3,
      parentId: "checkout",
    });
  });

  it("drops ids that are not in the tree (a suite deleted since the run)", () => {
    const options = suitesInRun(tree, ["refunds", "gone"]);

    expect(options.map((entry) => entry.node.id)).toEqual(["refunds"]);
  });

  it("ignores duplicates in the id list", () => {
    const options = suitesInRun(tree, ["search", "search"]);

    expect(options.map((entry) => entry.node.id)).toEqual(["search"]);
  });

  it("returns nothing for a run with no items", () => {
    expect(suitesInRun(tree, [])).toEqual([]);
  });

  it("returns nothing when the tree has not loaded yet", () => {
    expect(suitesInRun([], ["refunds"])).toEqual([]);
  });
});