"use client";

/**
 * §7 shortcuts help dialog (card t_6ce021c1), opened by `?` and listed in
 * itself. A read-only dialog: one action (Close), no form, so the focus trap
 * is the single Close button and Esc — the same focus discipline as
 * ConfirmDialog minus the alertdialog semantics (nothing is being decided).
 *
 * The shell unmounts the dialog when closed, so the previous-focus restore in
 * the unmount effect returns focus to the `?` affordance in the top bar.
 */
import { useEffect, useRef } from "react";

export interface HelpDialogProps {
  onClose: () => void;
}

/** Rendered in a <dl> — shortcut keys as <kbd>, descriptions as <dd>. */
const SHORTCUT_SECTIONS: ReadonlyArray<{
  heading: string;
  entries: ReadonlyArray<{ keys: string[]; description: string }>;
}> = [
  {
    heading: "Navigation",
    entries: [
      { keys: ["g", "c"], description: "Go to Test cases" },
      { keys: ["g", "r"], description: "Go to Test runs" },
      { keys: ["g", "p"], description: "Go to Test plans" },
    ],
  },
  {
    heading: "General",
    entries: [
      { keys: ["/"], description: "Focus search" },
      { keys: ["n"], description: "New (context-aware: new project on Projects)" },
      { keys: ["?"], description: "Shortcuts help" },
      { keys: ["Esc"], description: "Close dialogs and the account menu" },
    ],
  },
  {
    heading: "Coming later",
    entries: [
      { keys: ["P", "F", "B", "R", "S"], description: "Set result status (result form — later slice)" },
      { keys: ["j", "k"], description: "Move between rows (run detail — later slice)" },
      { keys: ["Ctrl", "Enter"], description: "Save the open form (result form — later slice)" },
    ],
  },
];

export function HelpDialog({ onClose }: HelpDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        className="dialog help-dialog"
      >
        <h2 id="help-dialog-title">Keyboard shortcuts</h2>

        {SHORTCUT_SECTIONS.map((section) => (
          <section key={section.heading}>
            <h3>{section.heading}</h3>
            <dl className="help-shortcuts">
              {section.entries.map((entry) => (
                <div className="help-shortcut-row" key={entry.description}>
                  <dt>
                    {entry.keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dt>
                  <dd>{entry.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <div className="button-row dialog-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
