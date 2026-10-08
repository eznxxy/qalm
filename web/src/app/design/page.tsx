"use client";

/**
 * DataTable demo — /design (temporary, part of card t_e3495ddb).
 *
 * The design-system step-1 token card (t_62938355) owns the app-wide theme
 * flip; until it merges there is no integration point in existing screens
 * (explicitly ordered: do NOT refactor them yet). This page exercises the
 * primitive's sorting, selection, states, row-height densities and
 * below-768px horizontal scroll so it can be verified visually and via
 * keyboard before any screen adopts it. It is removed or repurposed when a
 * real screen ships on DataTable.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, TableSkeleton, type DataTableSort } from "@/components/ui";

interface DemoCase {
  id: string;
  key: string;
  title: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  automated: boolean;
  estMinutes: number;
}

const DEMO_CASES: DemoCase[] = [
  { id: "c1", key: "C1001", title: "Pay with saved card", priority: "High", automated: true, estMinutes: 5 },
  { id: "c2", key: "C1002", title: "Card declined message", priority: "High", automated: false, estMinutes: 8 },
  { id: "c3", key: "C1003", title: "Expired card renewal prompt", priority: "Medium", automated: true, estMinutes: 3 },
  { id: "c4", key: "C1004", title: "3-D Secure challenge", priority: "Critical", automated: false, estMinutes: 12 },
  { id: "c5", key: "C1005", title: "Wallet payment (Apple Pay)", priority: "Medium", automated: true, estMinutes: 6 },
  { id: "c6", key: "C1006", title: "Gift card partial redemption", priority: "Low", automated: false, estMinutes: 9 },
  { id: "c7", key: "C1007", title: "Currency conversion display", priority: "Low", automated: true, estMinutes: 4 },
  { id: "c8", key: "C1008", title: "Retry after gateway timeout", priority: "High", automated: false, estMinutes: 10 },
];

const PRIORITY_ORDER: Record<DemoCase["priority"], number> = {
  Low: 0,
  Medium: 1,
  High: 2,
  Critical: 3,
};

type Density = "default" | "compact" | "comfortable";
type Mode = "data" | "loading" | "empty" | "error";

const DENSITIES: { id: Density; label: string }[] = [
  { id: "compact", label: "Compact (32)" },
  { id: "default", label: "Default (36)" },
  { id: "comfortable", label: "Comfortable (44)" },
];

const MODES: { id: Mode; label: string }[] = [
  { id: "data", label: "Data" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
  { id: "error", label: "Error" },
];

export default function DesignDemoPage() {
  const [density, setDensity] = useState<Density>("default");
  const [mode, setMode] = useState<Mode>("data");
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(["c2"]));

  // sortValue is stable module-level-ish per render; keep identity stable.
  const columns = useMemo(
    () => [
      {
        key: "key",
        header: "Case ID",
        sortable: true,
        sortValue: (row: DemoCase) => row.key,
        description: "Case identifier, C-prefixed",
      },
      {
        key: "title",
        header: "Title",
        sortable: true,
        sortValue: (row: DemoCase) => row.title,
      },
      {
        key: "priority",
        header: "Priority",
        sortable: true,
        sortValue: (row: DemoCase) => PRIORITY_ORDER[row.priority],
      },
      {
        key: "automated",
        header: "Automated",
        sortable: true,
        sortValue: (row: DemoCase) => (row.automated ? 1 : 0),
        render: (row: DemoCase) => (row.automated ? "Yes" : "No"),
      },
      {
        key: "estMinutes",
        header: "Estimate (min)",
        align: "number" as const,
        sortable: true,
        sortValue: (row: DemoCase) => row.estMinutes,
      },
    ],
    []
  );

  const rows: DemoCase[] = mode === "data" ? DEMO_CASES : [];

  return (
    <main className="page">
      <h1>Design: data table</h1>
      <p className="muted project-meta">
        Demo page for the DataTable primitive (card t_e3495ddb). Keyboard:
        Tab to a column header and press Enter/Space to sort, Tab into the
        table body and use j/k or arrow keys to move between rows.
      </p>

      <div className="toolbar" role="group" aria-label="Demo settings">
        <div className="field">
          <label htmlFor="demo-density">Row height</label>
          <select
            id="demo-density"
            value={density}
            onChange={(e) => setDensity(e.target.value as Density)}
          >
            {DENSITIES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="demo-mode">State</label>
          <select
            id="demo-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
          >
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field field-checkbox">
          <input
            id="demo-selectable"
            type="checkbox"
            checked
            readOnly
          />
          <label htmlFor="demo-selectable">Selection on (always, in this demo)</label>
        </div>
      </div>

      {mode === "loading" ? (
        <TableSkeleton rows={5} columns={5} rowHeight={density} label="Loading cases" />
      ) : (
        <DataTable<DemoCase>
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          caption="Demo test cases, all states"
          ariaLabel="Demo data table"
          rowHeight={density}
          selectable
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          sort={sort}
          onSortChange={setSort}
          error={
            mode === "error" ? "Couldn't load cases. Check your connection and retry." : null
          }
          onRetry={mode === "error" ? () => setMode("data") : undefined}
          emptyTitle="No cases in this section."
          emptyBody="Add a case or import a CSV."
          emptyAction={
            <button type="button" className="primary" onClick={() => setMode("data")}>
              Add a case
            </button>
          }
        />
      )}

      <p className="muted" role="status">
        {selectedIds.size} selected
      </p>

      <p>
        <Link href="/projects">Back to projects</Link>
      </p>
    </main>
  );
}
