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

export interface MoveDialogOption {
  value: string;
  label: string;
}

export interface MoveDialogProps {
  title: string;
  description: ReactNode;
  label: string;
  options: ReadonlyArray<MoveDialogOption>;
  initialValue: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function MoveDialog({
  title,
  description,
  label,
  options,
  initialValue,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: MoveDialogProps) {
  const [value, setValue] = useState(initialValue);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("select, button")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "Tab") {
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
        return;
      }
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
          </div>
          <div className="button-row dialog-actions">
            <button type="submit" className="primary" disabled={busy || !value}>
              {busy ? "Moving…" : confirmLabel}
            </button>
            <button type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
