"use client";

/**
 * CaseFilters — the filter bar above the cases table (DESIGN §4.2, §5
 * "Filter bar"): search, Priority / Type / Tags menus, active chips with
 * individual remove controls, and "Clear all".
 *
 * Filter state lives in the URL (the caller owns it); this component only
 * emits patches. Search is debounced so typing does not fire a request per
 * keystroke.
 *
 * The Priority / Type / Tags menus are an accordion: opening one closes the
 * others, so the bar never shows two "active" (accent-bordered) summaries at
 * once. They are React-controlled rather than native `<details>` toggles —
 * `preventDefault` on the summary click stops the native toggle and the `open`
 * prop (a single `openMenu` in state) is the sole source of truth.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  CASE_TYPE_LABELS,
  PRIORITY_LABELS,
  type CaseType,
  type Priority,
} from "@/lib/api-types";
import { CASE_TYPES, PRIORITIES } from "@/lib/api-types";
import { DisabledHint } from "@/components/ui";
import "./CaseFilters.css";

const SEARCH_DEBOUNCE_MS = 300;

/** The three filter menus; at most one may be open at a time. */
type FilterMenuId = "priority" | "type" | "tags";

export interface CaseFiltersPatch {
  query?: string;
  priorities?: Priority[];
  types?: CaseType[];
  tags?: string[];
}

export interface CaseFiltersProps {
  query: string;
  priorities: readonly Priority[];
  types: readonly CaseType[];
  tags: readonly string[];
  /** Tags seen in the current result page, offered as quick filters. */
  availableTags: readonly string[];
  resultCount: number | null;
  onChange: (patch: CaseFiltersPatch) => void;
}

export function CaseFilters({
  query,
  priorities,
  types,
  tags,
  availableTags,
  resultCount,
  onChange,
}: CaseFiltersProps) {
  const [search, setSearch] = useState(query);
  const [tagInput, setTagInput] = useState("");
  const [openMenu, setOpenMenu] = useState<FilterMenuId | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Back/forward keeps the visible input honest (adjust during render).
  const [renderedQuery, setRenderedQuery] = useState(query);
  if (renderedQuery !== query) {
    setRenderedQuery(query);
    setSearch(query);
  }

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    []
  );

  const activeCount =
    priorities.length + types.length + tags.length + (query ? 1 : 0);

  function onSearchChange(value: string): void {
    setSearch(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(
      () => onChange({ query: value.trim() }),
      SEARCH_DEBOUNCE_MS
    );
  }

  function togglePriority(priority: Priority): void {
    onChange({
      priorities: priorities.includes(priority)
        ? priorities.filter((item) => item !== priority)
        : [...priorities, priority],
    });
  }

  function toggleType(type: CaseType): void {
    onChange({
      types: types.includes(type)
        ? types.filter((item) => item !== type)
        : [...types, type],
    });
  }

  function toggleTag(tag: string): void {
    onChange({
      tags: tags.includes(tag)
        ? tags.filter((item) => item !== tag)
        : [...tags, tag],
    });
  }

  function addTag(): void {
    const additions = tagInput
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    if (additions.length === 0) return;
    onChange({ tags: Array.from(new Set([...tags, ...additions])) });
    setTagInput("");
  }

  function onTagKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag();
    }
  }

  function clearAll(): void {
    if (debounce.current) clearTimeout(debounce.current);
    setSearch("");
    setTagInput("");
    onChange({ query: "", priorities: [], types: [], tags: [] });
  }

  /**
   * Accordion: open the clicked menu and close whatever was open. We drive
   * `<details>` ourselves (`open` + `preventDefault`) so exactly one summary
   * carries the active border at any moment.
   */
  function toggleMenu(id: FilterMenuId): void {
    setOpenMenu((current) => (current === id ? null : id));
  }

  /** Click handler for a menu's <summary>; stops the native details toggle. */
  function onMenuSummaryClick(
    id: FilterMenuId,
    event: MouseEvent<HTMLElement>
  ): void {
    event.preventDefault();
    toggleMenu(id);
  }

  const knownTags = Array.from(
    new Set([...availableTags, ...tags])
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div className="filter-bar" aria-label="Case filters" role="group">
      <div className="filter-search">
        <label htmlFor="case-search" className="sr-only">
          Search cases
        </label>
        <input
          id="case-search"
          type="search"
          placeholder="Search cases"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <details className="filter-menu" open={openMenu === "priority"}>
        <summary onClick={(event) => onMenuSummaryClick("priority", event)}>
          Priority
          {priorities.length > 0 && (
            <span className="filter-menu-count t-nums">{priorities.length}</span>
          )}
        </summary>
        <div className="filter-menu-body">
          {PRIORITIES.map((priority) => (
            <label className="filter-check" key={priority}>
              <input
                type="checkbox"
                checked={priorities.includes(priority)}
                onChange={() => togglePriority(priority)}
              />
              {PRIORITY_LABELS[priority]}
            </label>
          ))}
          {priorities.length > 0 && (
            <button
              type="button"
              className="filter-menu-clear"
              onClick={() => onChange({ priorities: [] })}
            >
              Clear priority
            </button>
          )}
        </div>
      </details>

      <details className="filter-menu" open={openMenu === "type"}>
        <summary onClick={(event) => onMenuSummaryClick("type", event)}>
          Type
          {types.length > 0 && (
            <span className="filter-menu-count t-nums">{types.length}</span>
          )}
        </summary>
        <div className="filter-menu-body">
          {CASE_TYPES.map((type) => (
            <label className="filter-check" key={type}>
              <input
                type="checkbox"
                checked={types.includes(type)}
                onChange={() => toggleType(type)}
              />
              {CASE_TYPE_LABELS[type]}
            </label>
          ))}
          {types.length > 0 && (
            <button
              type="button"
              className="filter-menu-clear"
              onClick={() => onChange({ types: [] })}
            >
              Clear type
            </button>
          )}
        </div>
      </details>

      <details className="filter-menu" open={openMenu === "tags"}>
        <summary onClick={(event) => onMenuSummaryClick("tags", event)}>
          Tags
          {tags.length > 0 && (
            <span className="filter-menu-count t-nums">{tags.length}</span>
          )}
        </summary>
        <div className="filter-menu-body filter-menu-tags">
          {knownTags.length > 0 ? (
            knownTags.map((tag) => (
              <label className="filter-check" key={tag}>
                <input
                  type="checkbox"
                  checked={tags.includes(tag)}
                  onChange={() => toggleTag(tag)}
                />
                {tag}
              </label>
            ))
          ) : (
            <p className="filter-menu-hint">
              No tags in this result page yet.
            </p>
          )}
          <div className="filter-tag-add">
            <label htmlFor="case-tag-filter" className="sr-only">
              Add tag filter
            </label>
            <input
              id="case-tag-filter"
              value={tagInput}
              placeholder="Add a tag"
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={onTagKeyDown}
            />
            <DisabledHint
              hint={
                tagInput.trim()
                  ? "Add this tag as a filter"
                  : "Type a tag first, then Add"
              }
            >
              <button
                type="button"
                onClick={addTag}
                disabled={!tagInput.trim()}
              >
                Add
              </button>
            </DisabledHint>
          </div>
          {tags.length > 0 && (
            <button
              type="button"
              className="filter-menu-clear"
              onClick={() => onChange({ tags: [] })}
            >
              Clear tags
            </button>
          )}
        </div>
      </details>

      {activeCount > 0 && (
        <div className="filter-chips" aria-label="Active filters">
          {query && (
            <Chip label={`Search: ${query}`} onRemove={() => onChange({ query: "" })} />
          )}
          {priorities.map((priority) => (
            <Chip
              key={priority}
              label={`Priority: ${PRIORITY_LABELS[priority]}`}
              onRemove={() => togglePriority(priority)}
            />
          ))}
          {types.map((type) => (
            <Chip
              key={type}
              label={`Type: ${CASE_TYPE_LABELS[type]}`}
              onRemove={() => toggleType(type)}
            />
          ))}
          {tags.map((tag) => (
            <Chip
              key={tag}
              label={`Tag: ${tag}`}
              onRemove={() => toggleTag(tag)}
            />
          ))}
          <button type="button" className="linklike" onClick={clearAll}>
            Clear all
          </button>
        </div>
      )}

      <span className="filter-count t-nums" aria-live="polite">
        {resultCount === null
          ? "—"
          : `${resultCount} case${resultCount === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="filter-chip">
      {label}
      <button
        type="button"
        className="filter-chip-remove"
        aria-label={`Remove filter ${label}`}
        onClick={onRemove}
      >
        <span aria-hidden="true">×</span>
      </button>
    </span>
  );
}
