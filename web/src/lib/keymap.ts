/**
 * Minimal keymap primitives for the §7 shortcuts (card t_6ce021c1).
 *
 * Global shortcuts are declarative: a map from key to handler, evaluated by
 * `resolveShortcut` and dispatched by the `useGlobalShortcuts` hook. Later
 * screens (result form, run detail) register their own maps instead of
 * re-implementing key handling.
 *
 * Rules encoded here (§8 keyboard floor):
 * - No shortcut fires while the user types in a form field (input / textarea /
 *   select / contentEditable) unless the map opts in with `allowInInputs`.
 * - Plain-letter keys must not fire with modifiers held — Ctrl/Cmd+R is the
 *   browser's reload, Alt+letter may be a dead key or an IME chord.
 */

import { useEffect, useRef } from "react";

export type ShortcutHandler = (event: KeyboardEvent) => void;

export interface ShortcutDefinition {
  /** `KeyboardEvent.key` for single-key shortcuts ("?", "/", "g", "Escape"). */
  key: string;
  handler: ShortcutHandler;
  /** Fire even when a form field has focus (default false). */
  allowInInputs?: boolean;
  /** Require Ctrl on Windows/Linux or Cmd on macOS. */
  mod?: boolean;
}

/** Elements in which typed characters belong to the field, not shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** True when the modifier set is exactly none / exactly mod per the definition. */
function modifiersMatch(event: KeyboardEvent, def: ShortcutDefinition): boolean {
  const mod = event.ctrlKey || event.metaKey;
  if (def.mod !== mod) return false;
  // Shift only participates in sequences that arrive as shifted keys
  // ("?" is shift+/) — the map authors declare the key they receive.
  return !event.altKey;
}

/**
 * Returns the handler whose definition matches the event, or null when the
 * event must not trigger a shortcut (typing target without opt-in, mismatched
 * modifiers, or no definition for the key).
 */
export function resolveShortcut(
  event: KeyboardEvent,
  definitions: readonly ShortcutDefinition[]
): ShortcutHandler | null {
  if (event.altKey) return null;
  if (isTypingTarget(event.target) && !definitions.some((d) => d.allowInInputs)) {
    return null;
  }
  for (const def of definitions) {
    if (def.key !== event.key) continue;
    if (!modifiersMatch(event, def)) continue;
    if (isTypingTarget(event.target) && !def.allowInInputs) continue;
    return def.handler;
  }
  return null;
}

/**
 * Attaches a window-level keydown listener for the given map. The map is
 * read through a ref so handlers can be closures over fresh state without
 * re-subscribing on every render.
 */
export function useGlobalShortcuts(definitions: readonly ShortcutDefinition[]): void {
  const defsRef = useRef(definitions);
  defsRef.current = definitions;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const handler = resolveShortcut(event, defsRef.current);
      if (!handler) return;
      event.preventDefault();
      handler(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
