"use client";

/**
 * Drawer — the shared right-side surface (docs/DESIGN.md §5 "Drawer":
 * 480px, closes with Esc, does not block the table behind it). Used by the
 * case detail and case editor so both share focus behaviour, width and
 * reduced-motion handling.
 *
 * Non-modal by design: no scrim, no focus trap (the table stays operable).
 * Opening moves focus to the panel (its labelled heading is announced);
 * closing returns focus to whatever opened it.
 */
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import "./Drawer.css";

export interface DrawerProps {
  /** Accessible name, rendered as the heading. */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Optional class for screen-specific body layout. */
  className?: string;
}

export function Drawer({ title, onClose, children, className }: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Mount-only: an inline onClose from the caller changes every render and
  // must not re-run focus handling.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <aside
      ref={panelRef}
      className={["drawer", className].filter(Boolean).join(" ")}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <header className="drawer-header">
        <h2 id={titleId} className="drawer-title">
          {title}
        </h2>
        <button
          type="button"
          className="drawer-close"
          aria-label="Close"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}
