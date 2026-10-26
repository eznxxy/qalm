"use client";

/**
 * Small modal for choosing a destination (a suite for a suite move, or a
 * target suite for a case move). It exists so drag-and-drop always has a
 * keyboard-accessible alternative (DESIGN.md §8 "Move to…").
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Combobox, DisabledHint } from "@/components/ui";
import { isTypingTarget } from "@/lib/keymap";

export interface MoveDialogOption {
  value: string;
  label: string;
  /** 1-based depth for the searchable picker's indented browse view. */
  depth?: number;
  /** Ancestor names for the searchable picker's muted trail while filtered. */
  path?: readonly string[];
}

export interface MoveDialogProps {
  title: string;
  description: ReactNode;
  label: string;
  options: ReadonlyArray<MoveDialogOption>;
  initialValue: string;
  confirmLabel: string;
  busy?: boolean;
  /**
   * Render the destination as the searchable `ui/Combobox` (used for the case
   * move, where a project's suite tree can be long) instead of the native
   * select. Options must then carry their `depth`/`path`.
   */
  searchable?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/** True when the key's target is an expanded combobox (its list is open). */
function isExpandedCombobox(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.getAttribute("role") === "combobox" &&
    target.getAttribute("aria-expanded") === "true"
  );
}

export function MoveDialog({
  title,
  description,
  label,
  options,
  initialValue,
  confirmLabel,
  busy = false,
  searchable = false,
  onConfirm,
  onCancel,
}: MoveDialogProps) {
  const [value, setValue] = useState(initialValue);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current
      ?.querySelector<HTMLElement>("input, select, button")
      ?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // An open destination list owns the first Escape — the combobox keeps
        // focus and reports expansion on the input — so only a second Escape
        // dismisses the dialog.
        if (isExpandedCombobox(event.target)) return;
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "select, button:not(:disabled), input:not(:disabled)"
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      // Shield the shell's global shortcuts while the modal is open, but never
      // swallow keys bound for a form field — the destination picker is a text
      // input, and those keystrokes belong to it.
      if (!isTypingTarget(event.target)) event.stopPropagation();
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus();
    };
  }, [onCancel]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!value) return;
    onConfirm(value);
  }

  return (
    <div className="dialog-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="dialog move-dialog"
      >
        <form onSubmit={handleSubmit}>
          <h2 id={titleId}>{title}</h2>
          <div id={bodyId}>{description}</div>
          <div className="field">
            <label htmlFor="move-dialog-target">{label}</label>
            {searchable ? (
              <Combobox
                id="move-dialog-target"
                value={value}
                options={options.map((option) => ({
                  id: option.value,
                  label: option.label,
                  depth: option.depth,
                  path: option.path,
                }))}
                onChange={setValue}
                placeholder="Search suites…"
                emptyMessage="No suites match."
                disabled={busy}
                openOnFocus={false}
              />
            ) : (
              <select
                id="move-dialog-target"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={busy}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="button-row dialog-actions">
            <DisabledHint
              hint={
                busy
                  ? "Moving — please wait"
                  : !value
                    ? "Choose a destination first"
                    : null
              }
            >
              <button type="submit" className="primary" disabled={busy || !value}>
                {busy ? "Moving…" : confirmLabel}
              </button>
            </DisabledHint>
            <DisabledHint hint={busy ? "Can't cancel while moving" : null}>
              <button type="button" disabled={busy} onClick={onCancel}>
                Cancel
              </button>
            </DisabledHint>
          </div>
        </form>
      </div>
    </div>
  );
}
