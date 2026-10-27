"use client";

/**
 * StatusSummary — the headline card beside the run detail pie (review
 * feedback, card 3.7: the reviewer's reference puts the overall figure on its
 * own surface, not inside the breakdown).
 *
 * Two numbers, stacked and centred:
 *   - the passed share as the card's one big figure, with "passed" under it;
 *   - "91 / 239 untested (38%)." as a muted footer — the absolute count, the
 *     run size and the relative share in one line.
 *
 * Both shares come from `sharePercent`, the same rounding the pie's legend
 * uses, so the footer can never disagree with the `Untested` row.
 */

import type { ReactElement } from "react";
import "../../styles/tokens.css";
import "./StatusSummary.css";
import { type StatusBarValue } from "./StatusBar";
import { sharePercent, statusTotal } from "./StatusPie";

export interface StatusSummaryProps {
  /** Results per status; missing keys count as zero. */
  counts: StatusBarValue;
}

export function StatusSummary({ counts }: StatusSummaryProps): ReactElement {
  const total = statusTotal(counts);
  const passed = counts.passed ?? 0;
  const untested = counts.untested ?? 0;

  return (
    <div className="sts-root">
      <p className="sts-headline">
        <span className="sts-percent t-nums">{sharePercent(passed, total)}%</span>
        <span className="sts-label">passed</span>
      </p>
      <p className="sts-sub t-nums">
        {untested} / {total} untested ({sharePercent(untested, total)}%).
      </p>
    </div>
  );
}