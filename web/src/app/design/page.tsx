"use client";

/**
 * Design-system demo — /design.
 *
 * Started as the DataTable demo (card t_e3495ddb); card t_328401f8 adds the
 * status components: StatusBadge (all six §2.2 statuses), StatusBar at both
 * sizes (8px table / 16px dashboard) and PriorityIcon. The design-system
 * step-1 token card (t_62938355) owns the app-wide theme flip; until it
 * merges the primitives are self-sufficient (they import the token stub).
 * This page exists so primitives can be verified visually and via keyboard
 * before real screens adopt them; it shrinks as screens take over.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DataTable,
  PRIORITY_LABELS,
  PriorityIcon,
  STATUS_ORDER,
  StatusBadge,
  StatusBar,
  TableSkeleton,
  type DataTableSort,
  type PriorityName,
  type StatusName,
} from "@/components/ui";

interface DemoCase {
  id: string;
  key: string;
  title: string;
  status: StatusName;
  priority: PriorityName;
  automated: boolean;
  estMinutes: number;
}

const DEMO_CASES: DemoCase[] = [
  { id: "c1", key: "C1001", title: "Pay with saved card", status: "passed", priority: "high", automated: true, estMinutes: 5 },
  { id: "c2", key: "C1002", title: "Card declined message", status: "failed", priority: "high", automated: false, estMinutes: 8 },
  { id: "c3", key: "C1003", title: "Expired card renewal prompt", status: "retest", priority: "medium", automated: true, estMinutes: 3 },
  { id: "c4", key: "C1004", title: "3-D Secure challenge", status: "blocked", priority: "critical", automated: false, estMinutes: 12 },
  { id: "c5", key: "C1005", title: "Wallet payment (Apple Pay)", status: "passed", priority: "medium", automated: true, estMinutes: 6 },
  { id: "c6", key: "C1006", title: "Gift card partial redemption", status: "skipped", priority: "low", automated: false, estMinutes: 9 },
  { id: "c7", key: "C1007", title: "Currency conversion display", status: "untested", priority: "low", automated: true, estMinutes: 4 },
  { id: "c8", key: "C1008", title: "Retry after gateway timeout", status: "failed", priority: "high", automated: false, estMinutes: 10 },
];

const PRIORITY_ORDER: Record<PriorityName, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
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
        key: "status",
        header: "Status",
        sortable: true,
        sortValue: (row: DemoCase) => STATUS_ORDER.indexOf(row.status),
        render: (row: DemoCase) => <StatusBadge status={row.status} />,
      },
      {
        key: "priority",
        header: "Priority",
        sortable: true,
        sortValue: (row: DemoCase) => PRIORITY_ORDER[row.priority],
        render: (row: DemoCase) => (
          <>
            <PriorityIcon priority={row.priority} />{" "}
            {PRIORITY_LABELS[row.priority]}
          </>
        ),
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
      <h1>Design system demo</h1>
      <p className="muted project-meta">
        Demo page for the shared primitives (cards t_e3495ddb, t_328401f8):
        the DataTable and the status components below it. Keyboard: Tab to a
        column header and press Enter/Space to sort, Tab into the table body
        and use j/k or arrow keys to move between rows.
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

      <h2>Status components (card t_328401f8)</h2>

      <p>
        {STATUS_ORDER.map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
      </p>

      <p>
        <StatusBar
          label="Release 2.4 smoke (table, 8px)"
          counts={{ passed: 31, retest: 2, blocked: 2, failed: 4, untested: 13 }}
        />
      </p>
      <p>
        <StatusBar
          size="large"
          label="Release 2.4 smoke (dashboard, 16px)"
          counts={{ passed: 31, retest: 2, blocked: 2, failed: 4, untested: 13 }}
        />
      </p>

      <p>
        {(Object.keys(PRIORITY_LABELS) as PriorityName[]).map((priority) => (
          <span key={priority} style={{ marginRight: "12px" }}>
            <PriorityIcon priority={priority} /> {PRIORITY_LABELS[priority]}
          </span>
        ))}
      </p>

      <p>
        <Link href="/projects">Back to projects</Link>
      </p>
    </main>
  );
}
