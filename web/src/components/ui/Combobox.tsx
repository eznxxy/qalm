"use client";

/**
 * Combobox — a searchable single-select (DESIGN.md §5 "form field", §2.5
 * "popover"). The field doubles as the search box: click it, Tab into it, or
 * press ArrowDown/ArrowUp to open the list, then type to filter by name.
 *
 * Options carry an optional 1-based `depth` so a hierarchy (the suite tree)
 * reads as an indented list; indentation stops at level 3, the suite cap in
 * docs/api-suites.md. While a query is active the list flattens instead and
 * shows each option's optional ancestor `path`, because an indent with no
 * visible parent is just blank space. The control follows the ARIA combobox pattern — roles
 * combobox/listbox/option, `aria-activedescendant`, Home/End, Enter and
 * Escape — and keeps DOM focus on the input while the list is open, so the
 * host's per-field validation still runs when focus really leaves the control.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import "./Combobox.css";

export interface ComboboxOption {
  id: string;
  /** Text shown in the field, and the string the query is matched against. */
  label: string;
  /** 1-based hierarchy depth; rows indent one step per level (1–3). */
  depth?: number;
  /**
   * Ancestor names, root first. Shown as a muted trail after the label while
   * searching: once the list is filtered the indent can no longer say where a
   * match lives, so an orphaned `Cards` indented 40px just reads as blank
   * space. The trail moves that information into the row instead.
   */
  path?: readonly string[];
}

export interface ComboboxProps {
  /** Owns the input's DOM id; the list and option ids derive from it. */
  id: string;
  value: string;
  options: readonly ComboboxOption[];
  onChange: (id: string) => void;
  /** Fires when focus leaves the control — the host's per-field touch hook. */
  onBlur?: () => void;
  placeholder?: string;
  /** Row shown when the query matches nothing. */
  emptyMessage?: string;
  /** Paints the border like the other invalid inputs (aria-invalid=true). */
  invalid?: boolean;
  /** Locks the field and suppresses the list (e.g. while a move is in flight). */
  disabled?: boolean;
  /**
   * Whether focusing the field opens the list (default true — the case
   * editor's contract). Set false where the host focuses the field on mount
   * (a dialog) so the popover does not spring open over the dialog's own
   * actions; a click or ArrowDown still opens it.
   */
  openOnFocus?: boolean;
  describedBy?: string;
}

/** Name match, so the indent glyph never has to be typed. */
function matchOptions(
  options: readonly ComboboxOption[],
  query: string
): ComboboxOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...options];
  return options.filter((option) =>
    option.label.toLowerCase().includes(needle)
  );
}

/** Index of the current value, or the first row when nothing matches it. */
function selectedIndex(
  options: readonly ComboboxOption[],
  id: string
): number {
  const index = options.findIndex((option) => option.id === id);
  return index >= 0 ? index : options.length > 0 ? 0 : -1;
}

export function Combobox({
  id,
  value,
  options,
  onChange,
  onBlur,
  placeholder,
  emptyMessage = "No matches.",
  invalid = false,
  disabled = false,
  openOnFocus = true,
  describedBy,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const listId = `${id}-listbox`;
  const optionId = (index: number): string => `${id}-option-${index}`;
  const selected = options.find((option) => option.id === value) ?? null;
  const filtered = useMemo(() => matchOptions(options, query), [options, query]);
  // While the query is empty the list is a browse view of the hierarchy, so
  // rows keep their indent. Once it is filtered, a lone match indented for
  // ancestors that are no longer on screen reads as blank space, so matches go
  // flush left and the ancestor `path` carries the hierarchy instead.
  const searching = query.trim() !== "";

  /**
   * Opening clears the edit buffer so the box always shows what you type —
   * typing never appends to the previously selected label.
   */
  function openList(): void {
    if (disabled || open) return;
    setQuery("");
    setActiveIndex(selectedIndex(options, value));
    setOpen(true);
  }

  function closeList(): void {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }

  function choose(option: ComboboxOption): void {
    onChange(option.id);
    closeList();
    inputRef.current?.focus();
  }

  function onInputChange(next: string): void {
    setQuery(next);
    setOpen(true);
    setActiveIndex(matchOptions(options, next).length > 0 ? 0 : -1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          openList();
          return;
        }
        if (filtered.length === 0) return;
        setActiveIndex((index) => (index + 1) % filtered.length);
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          openList();
          return;
        }
        if (filtered.length === 0) return;
        setActiveIndex((index) => (index <= 0 ? filtered.length - 1 : index - 1));
        return;
      case "Home":
        if (!open) return;
        event.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        if (!open) return;
        event.preventDefault();
        setActiveIndex(filtered.length - 1);
        return;
      case "Enter": {
        // Closed: keep the form's own Enter behaviour (implicit submit).
        if (!open) return;
        event.preventDefault();
        const option =
          filtered[activeIndex] ??
          (filtered.length === 1 ? filtered[0] : undefined);
        if (option) choose(option);
        return;
      }
      case "Tab":
        closeList();
        return;
      default:
        return;
    }
  }

  // A click outside closes the list; option rows live inside the wrapper, so
  // choosing one never trips this.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!wrapRef.current?.contains(event.target as Node)) closeList();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Escape closes the list and nothing else — the first Esc dismisses the
  // popup, the second closes the surrounding drawer. React's own
  // stopPropagation is not enough to shield the drawer: its Esc handler is a
  // bubble-phase `document` listener (ui/Drawer.tsx), and a delegated React
  // handler does not reliably run before a sibling listener on the same node.
  // Taking the key in the capture phase beats every bubble-phase listener.
  useEffect(() => {
    if (!open) return;
    function onKeyDownCapture(event: globalThis.KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeList();
    }
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () =>
      document.removeEventListener("keydown", onKeyDownCapture, true);
  }, [open]);

  // Keep the highlight in view as the keyboard walks a long list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`
    );
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  const activeOptionId =
    open && activeIndex >= 0 && filtered[activeIndex]
      ? optionId(activeIndex)
      : undefined;

  return (
    <div className="combobox" data-open={open} data-disabled={disabled} ref={wrapRef}>
      <div className="combobox-field">
        <input
          ref={inputRef}
          id={id}
          className="combobox-input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
          value={open ? query : (selected?.label ?? "")}
          disabled={disabled}
          onChange={(event) => onInputChange(event.target.value)}
          onFocus={openOnFocus ? openList : undefined}
          onClick={openList}
          onBlur={() => {
            closeList();
            onBlur?.();
          }}
          onKeyDown={onKeyDown}
        />
        <span className="combobox-chevron" aria-hidden="true">
          ▾
        </span>
      </div>

      {open && (
        <ul
          className="combobox-list"
          id={listId}
          role="listbox"
          ref={listRef}
          data-searching={searching}
        >
          {filtered.length === 0 ? (
            <li className="combobox-empty" role="presentation">
              {emptyMessage}
            </li>
          ) : (
            filtered.map((option, index) => (
              <li
                key={option.id}
                id={optionId(index)}
                data-index={index}
                role="option"
                aria-selected={option.id === value}
                data-depth={
                  searching ? 1 : Math.min(Math.max(option.depth ?? 1, 1), 3)
                }
                data-active={index === activeIndex}
                // Hold focus on the input so blur/validation only runs when
                // focus truly leaves the control.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span className="combobox-option-label">{option.label}</span>
                {searching && option.path && option.path.length > 0 && (
                  <span className="combobox-option-path" aria-hidden="true">
                    {option.path.join(" › ")}
                  </span>
                )}
                <span className="combobox-check" aria-hidden="true">
                  ✓
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}