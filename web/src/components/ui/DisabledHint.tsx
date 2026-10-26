"use client";

/**
 * DisabledHint — makes a disabled control's explanation reachable on hover
 * (docs/DESIGN.md §8 accessibility floor).
 *
 * A `disabled` <button>/<input> stops firing pointer events in some browsers,
 * so a native `title` on the control itself never surfaces. The hint therefore
 * lives on this wrapper and the disabled child is made pointer-transparent
 * (DisabledHint.css), so the wrapper receives the hover instead.
 *
 * Without a hint the children render untouched — callers pass the hint only
 * while the child is actually disabled (or explain a transient busy state).
 */
import type { ReactNode } from "react";
import "./DisabledHint.css";

export interface DisabledHintProps {
  /** Tooltip text; omit/empty renders children with no wrapper. */
  hint?: string | null;
  children: ReactNode;
}

export function DisabledHint({ hint, children }: DisabledHintProps) {
  if (!hint) return <>{children}</>;
  return (
    <span className="disabled-hint" title={hint}>
      {children}
    </span>
  );
}