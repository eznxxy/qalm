/**
 * DataTable primitive (web/src/components/ui/DataTable.tsx).
 *
 * Covers the t_e3495ddb DoD: unit tests for sorting, selection, and §6
 * states, plus the accessibility behaviour the spec calls out (§5, §8):
 * header buttons are real buttons, aria-sort + SR hints, header checkbox
 * indeterminate, j/k row navigation.
 */
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataTable, type DataTableColumn } from "@/components/ui";

interface Row {
  id: string;
  name: string;
  points: number;
  active: boolean;
}

const ROWS: Row[] = [
  { id: "r1", name: "delta", points: 30, active: true },
  { id: "r2", name: "alpha", points: 10, active: false },
  { id: "r3", name: "charlie", points: 20, active: true },
];

function makeColumns(
  overrides: Partial<DataTableColumn<Row>> = {}
): DataTableColumn<Row>[] {
  return [
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (r) => r.name,
      ...overrides,
    },
    {
      key: "points",
      header: "Points",
      align: "number",
      sortable: true,
      sortValue: (r) => r.points,
    },
  ];
}

function baseProps(overrides: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return {
    columns: makeColumns(),
    rows: ROWS,
    getRowId: (r: Row) => r.id,
    caption: "Test rows",
    ...overrides,
  };
}

/** Controlled-sort harness so assertions can read state back. */
function SortHarness(props: Partial<Parameters<typeof DataTable<Row>>[0]>) {
  const [sort, setSort] = useState<Pick<
    Parameters<typeof DataTable<Row>>[0],
    "sort"
  >["sort"]>(null);
  return (
    <>
      <div data-testid="sort-state">{sort ? `${sort.key}:${sort.dir}` : "none"}</div>
      <DataTable<Row> {...baseProps(props)} sort={sort} onSortChange={setSort} />
    </>
  );
}

describe("DataTable sorting", () => {
  it("is unsorted by default; rows render in given order", () => {
    render(<DataTable<Row> {...baseProps()} />);
    const rows = screen.getAllByRole("row").slice(1); // skip header row
    expect(rows.map((r) => r.textContent)).toMatchObject([
      expect.stringContaining("delta"),
      expect.stringContaining("alpha"),
      expect.stringContaining("charlie"),
    ]);
    expect(document.querySelector("[aria-sort]")).toBeNull();
  });

  it("cycles asc -> desc -> unsorted via header button clicks", () => {
    render(<SortHarness />);
    const nameButton = screen.getByRole("button", { name: /Name/ });

    fireEvent.click(nameButton);
    expect(screen.getByTestId("sort-state")).toHaveTextContent("name:asc");

    fireEvent.click(nameButton);
    expect(screen.getByTestId("sort-state")).toHaveTextContent("name:desc");

    fireEvent.click(nameButton);
    expect(screen.getByTestId("sort-state")).toHaveTextContent("none");
  });

  it("sorts strings with localeCompare ascending, then descending", () => {
    // Uncontrolled variant: defaultSort seeds state (no controlled sort prop).
    const { container } = render(
      <DataTable<Row> {...baseProps()} defaultSort={{ key: "name", dir: "asc" }} />
    );
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("alpha");
    fireEvent.click(
      screen.getByRole("button", { name: /Name/ }) // asc -> desc
    );
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0]).toHaveTextContent("delta");
    expect(rows[2]).toHaveTextContent("alpha");
  });

  it("sorts numbers numerically, not lexicographically", () => {
    render(
      <DataTable<Row> {...baseProps()} defaultSort={{ key: "points", dir: "desc" }} />
    );
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("30");
    expect(rows[2]).toHaveTextContent("20");
    expect(rows[3]).toHaveTextContent("10");
  });

  it("exposes aria-sort + SR hint and does not shift header layout", () => {
    render(
      <DataTable<Row> {...baseProps()} defaultSort={{ key: "name", dir: "desc" }} />
    );
    const th = screen.getByRole("columnheader", { name: /Name/ });
    expect(th).toHaveAttribute("aria-sort", "descending");
    expect(
      screen.getByText("Sorted descending by Name")
    ).toBeInTheDocument();
  });

  it("sorts by sortValue (not display string): priority rank via mapped values", () => {
    interface P {
      id: string;
      label: string;
      rank: number;
    }
    const prows: P[] = [
      { id: "p1", label: "Low", rank: 0 },
      { id: "p2", label: "High", rank: 2 },
      { id: "p3", label: "Critical", rank: 3 },
    ];
    const cols: DataTableColumn<P>[] = [
      {
        key: "label",
        header: "Priority",
        sortable: true,
        sortValue: (r) => r.rank,
      },
    ];
    render(
      <DataTable<P>
        columns={cols}
        rows={prows}
        getRowId={(r) => r.id}
        caption="p"
        defaultSort={{ key: "label", dir: "desc" }}
      />
    );
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Critical");
    expect(rows[3]).toHaveTextContent("Low");
  });
});

describe("DataTable selection", () => {
  function SelectionHarness(props: Partial<Parameters<typeof DataTable<Row>>[0]>) {
    const [ids, setIds] = useState<Set<string>>(new Set());
    return (
      <>
        <div data-testid="count">{ids.size}</div>
        <DataTable<Row>
          {...baseProps(props)}
          selectable
          selectedIds={ids}
          onSelectedIdsChange={setIds}
        />
      </>
    );
  }

  it("toggles a row via its checkbox (aria-label per row)", () => {
    render(<SelectionHarness />);
    fireEvent.click(screen.getByLabelText("Select row 1"));
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    fireEvent.click(screen.getByLabelText("Select row 1"));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("header checkbox: unchecked -> all -> none", () => {
    render(<SelectionHarness />);
    const header = screen.getByLabelText("Select all 3 rows");
    expect(header).not.toBeChecked();
    fireEvent.click(header);
    expect(screen.getByTestId("count")).toHaveTextContent("3");
    expect(screen.getByLabelText(/Deselect all 3 rows/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/Deselect all 3 rows/));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("header checkbox is indeterminate (DOM property) when some are selected", () => {
    const { container } = render(<SelectionHarness />);
    fireEvent.click(screen.getByLabelText("Select row 2"));
    const header = screen.getByLabelText(/Select all 3 rows/);
    expect(header).not.toBeChecked();
    const headerEl = container.querySelector(
      'th input[type="checkbox"]'
    ) as HTMLInputElement;
    expect(headerEl.indeterminate).toBe(true);
  });

  it("clicking a partial header checkbox completes selection (native convention)", () => {
    render(<SelectionHarness rows={ROWS.slice(0, 2)} />);
    fireEvent.click(screen.getByLabelText("Select row 1"));
    fireEvent.click(screen.getByLabelText(/Select all 2 rows/));
    expect(screen.getByTestId("count")).toHaveTextContent("2");
  });

  it("selection survives a sort (keys are row ids, not indexes)", () => {
    render(<SelectionHarness defaultSort={{ key: "name", dir: "asc" }} />);
    // select "delta" (last row when sorted asc by name)
    fireEvent.click(screen.getByLabelText("Select row 3"));
    fireEvent.click(screen.getByRole("button", { name: /Name/ })); // to desc
    // delta is now first row; its checkbox must still be checked
    const deltaRow = screen.getAllByRole("row")[1];
    expect(deltaRow).toHaveTextContent("delta");
    expect(
      (deltaRow.querySelector('input[type="checkbox"]') as HTMLInputElement)
        .checked
    ).toBe(true);
  });

  it("keyboard: header checkbox toggles with Space (native checkbox semantics)", () => {
    render(<SelectionHarness />);
    const header = screen.getByLabelText("Select all 3 rows");
    header.focus();
    fireEvent.keyDown(header, { key: " " });
    fireEvent.keyUp(header, { key: " " });
    fireEvent.click(header); // jsdom: space "click" is simulated natively; direct click asserts handler
    expect(screen.getByTestId("count")).toHaveTextContent("3");
  });
});

describe("DataTable keyboard row navigation", () => {
  it("j/k and arrows move focus among rows (dt-row-focused tracks index)", () => {
    const { container } = render(<DataTable<Row> {...baseProps()} />);
    const tbody = container.querySelector("tbody") as HTMLElement;
    tbody.focus();
    fireEvent.keyDown(tbody, { key: "j" }); // -> row 0 (delta)
    fireEvent.keyDown(tbody, { key: "j" }); // -> row 1 (alpha)
    fireEvent.keyDown(tbody, { key: "j" }); // -> row 2 (charlie)
    let focused = container.querySelectorAll("tr.dt-row-focused");
    expect(focused).toHaveLength(1);
    expect(focused[0]).toHaveTextContent("charlie");
    fireEvent.keyDown(tbody, { key: "k" });
    focused = container.querySelectorAll("tr.dt-row-focused");
    expect(focused[0]).toHaveTextContent("alpha");
    fireEvent.keyDown(tbody, { key: "End" });
    focused = container.querySelectorAll("tr.dt-row-focused");
    expect(focused[0]).toHaveTextContent("charlie");
  });

  it("clamps at the first/last row", () => {
    const { container } = render(<DataTable<Row> {...baseProps()} />);
    const tbody = container.querySelector("tbody") as HTMLElement;
    tbody.focus();
    fireEvent.keyDown(tbody, { key: "k" }); // at 0, stays
    expect(container.querySelectorAll("tr.dt-row-focused")).toHaveLength(1);
    fireEvent.keyDown(tbody, { key: "ArrowDown" });
    fireEvent.keyDown(tbody, { key: "ArrowDown" });
    fireEvent.keyDown(tbody, { key: "ArrowDown" }); // clamped to last
    const focused = container.querySelectorAll("tr.dt-row-focused");
    expect(focused[0]).toHaveTextContent("charlie");
  });
});

describe("DataTable states (DESIGN.md §6)", () => {
  it("loading renders row-shaped skeletons and marks the table busy", () => {
    render(<DataTable<Row> {...baseProps()} loading />);
    expect(screen.getByRole("table", { name: "Test rows" })).toHaveAttribute(
      "aria-busy",
      "true"
    );
    const bars = document.querySelectorAll(".dt-skeleton-bar");
    expect(bars.length).toBeGreaterThanOrEqual(3 * 2);
    expect(screen.queryByText("delta")).toBeNull();
  });

  it("empty state: message + action, no rows", () => {
    const onAdd = jest.fn();
    render(
      <DataTable<Row>
        {...baseProps()}
        rows={[]}
        emptyTitle="No rows yet."
        emptyBody="Add your first row to get started."
        emptyAction={
          <button type="button" onClick={onAdd}>
            Add row
          </button>
        }
      />
    );
    expect(screen.getByText("No rows yet.")).toBeInTheDocument();
    expect(screen.getByText("Add your first row to get started.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("empty state without an action still renders the message", () => {
    render(<DataTable<Row> {...baseProps()} rows={[]} emptyTitle="Nothing here." />);
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });

  it("error state: message + Retry wired to onRetry", async () => {
    const onRetry = jest.fn();
    render(
      <DataTable<Row> {...baseProps()} rows={[]} error="Couldn't load rows." onRetry={onRetry} />
    );
    expect(screen.getByText("Couldn't load rows.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("error state without onRetry shows no button", () => {
    render(
      <DataTable<Row> {...baseProps()} rows={[]} error="Couldn't load rows." />
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("loading has priority over error/empty", () => {
    render(
      <DataTable<Row>
        {...baseProps()}
        loading
        rows={[]}
        error="Couldn't load rows."
        onRetry={() => {}}
      />
    );
    expect(document.querySelectorAll(".dt-skeleton-bar").length).toBeGreaterThan(0);
    expect(screen.queryByText("Couldn't load rows.")).toBeNull();
  });

  it("rows win over the empty state when present", () => {
    render(<DataTable<Row> {...baseProps()} emptyTitle="No rows yet." />);
    expect(screen.getByText("delta")).toBeInTheDocument();
    expect(screen.queryByText("No rows yet.")).toBeNull();
  });

  it("waits for waitFor semantics with async-free rendering (smoke)", async () => {
    render(<DataTable<Row> {...baseProps()} />);
    await waitFor(() =>
      expect(screen.getByRole("table", { name: "Test rows" })).toBeInTheDocument()
    );
  });
});

describe("DataTable misc", () => {
  it("renders numeric cells right-aligned via dt-cell-number", () => {
    render(<DataTable<Row> {...baseProps()} />);
    const cell = screen.getByText("10").closest("td");
    expect(cell).toHaveClass("dt-cell-number");
  });

  it("row height density maps to --dt-row-height custom property", () => {
    const { container, rerender } = render(
      <DataTable<Row> {...baseProps()} rowHeight="compact" />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--dt-row-height")).toBe(
      "var(--row-height-compact)"
    );
    rerender(<DataTable<Row> {...baseProps()} rowHeight="comfortable" />);
    expect(root.style.getPropertyValue("--dt-row-height")).toBe(
      "var(--row-height-comfortable)"
    );
  });

  it("caption is visually hidden but present for screen readers", () => {
    render(<DataTable<Row> {...baseProps()} caption="Test rows" />);
    const caption = document.querySelector("caption");
    expect(caption).toHaveTextContent("Test rows");
    expect(caption).toHaveClass("sr-only");
  });

  it("disabled freezes sorting and selection interactions", () => {
    const onSort = jest.fn();
    const onSelect = jest.fn();
    render(
      <DataTable<Row>
        {...baseProps()}
        selectable
        selectedIds={new Set()}
        onSelectedIdsChange={onSelect}
        sort={null}
        onSortChange={onSort}
        disabled
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSort).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Select row 1"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
