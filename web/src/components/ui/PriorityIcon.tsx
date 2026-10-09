"use client";

/**
 * PriorityIcon — priority chevrons (docs/DESIGN.md §2.2, last paragraph).
 *
 * Shape and weight, not new colours: Critical (double chevron up), High
 * (chevron up), Medium (dash), Low (chevron down). Colour is --ink-700,
 * except Critical which uses --failed — priority is the ONLY non-status
 * use of a status colour, because criticality and failure share the
 * "stop and look" semantics (the spec's explicit exception to §1.1).
 *
 * Icons are aria-hidden; callers pair the icon with the visible priority
 * word (e.g. `<PriorityIcon priority="high" /> High`), so meaning never
 * rides on a glyph alone (§8). Same 16×16 grid and 1.6 stroke as the
 * StatusBadge icons so the two read as one icon family.
 */

import type { ReactElement } from "react";
import "../../styles/tokens.css";
import "./PriorityIcon.css";

/** The four priorities (§2.2). */
export type PriorityName = "critical" | "high" | "medium" | "low";

/** Sentence-case label per priority. */
export const PRIORITY_LABELS: Record<PriorityName, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export interface PriorityIconProps {
  /** The priority to render. */
  priority: PriorityName;
  /**
   * Hides the glyph from assistive tech AND visually (`pi-hidden`):
   * for sorting cells or filter chips that already carry the word.
   * Keep the icon visible next to the word in tables — it is the shape
   * that makes priority scannable (§1.3).
   */
  hidden?: boolean;
}

/** Glyph geometry per priority, on the shared 16×16 grid. */
const GLYPHS: Record<PriorityName, ReactElement> = {
  critical: (
    <>
      <path d="m3.2 8.8 4.8-5 4.8 5" />
      <path d="m3.2 13.2 4.8-5 4.8 5" />
    </>
  ),
  high: <path d="m3.2 11 4.8-5 4.8 5" />,
  medium: <path d="M4.2 8.6h7.6" />,
  low: <path d="m3.2 5 4.8 5 4.8-5" />,
};

export function PriorityIcon({
  priority,
  hidden = false,
}: PriorityIconProps): ReactElement {
  const classes = ["pi-icon", `pi-${priority}`];
  if (hidden) classes.push("pi-hidden");
  return (
    <svg
      className={classes.join(" ")}
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      {GLYPHS[priority]}
    </svg>
  );
}
