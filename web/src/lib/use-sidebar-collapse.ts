"use client";

/**
 * Sidebar collapse state for the §3 shell (card t_df4894c3).
 *
 * Breakpoints (DESIGN.md §3): 1280+ full layout, below 1280 (1024 explicitly)
 * the rail auto-collapses to a 56px icon rail. An explicit user toggle wins
 * over the breakpoint and persists across sessions in localStorage under one
 * shared key.
 *
 * Paint order: the shell renders a tiny inline script that applies the stored
 * choice (or the breakpoint default) to <html> before first paint, so a
 * collapsed rail never flashes wide; CSS keys off that class. This hook
 * then owns the React side — the toggle and the live matchMedia listener —
 * and writes the preference.
 */

import { useCallback, useEffect, useState } from "react";

export const SIDEBAR_COLLAPSE_KEY = "qalm.sidebar.collapsed";
/** §3: the 232px rail only fits at 1280 and above; below, collapse. */
export const SIDEBAR_AUTO_COLLAPSE_QUERY = "(max-width: 1279px)";

function readStoredPreference(): boolean | null {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // Private mode / storage disabled: fall through to breakpoint default.
  }
  return null;
}

function setDocumentCollapsed(collapsed: boolean): void {
  document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
}

export function useSidebarCollapse(): { collapsed: boolean; toggle: () => void } {
  // SSR renders the expanded rail; the class (visual truth) is corrected
  // before paint by the inline script, so there is no flash. React state
  // catches up here — effective collapse is the stored preference when the
  // user has made one, otherwise the live breakpoint — so the toggle
  // button's label/aria-expanded always describe the real rail.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(SIDEBAR_AUTO_COLLAPSE_QUERY);
    const sync = () => {
      const effective = readStoredPreference() ?? query.matches;
      setDocumentCollapsed(effective);
      setCollapsed(effective);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const toggle = useCallback(() => {
    // The <html> class is the live truth (the pre-paint script and the
    // media listener both write it); read it so a stale `collapsed` state
    // can never desync the preference from the rail.
    const next = !document.documentElement.classList.contains("sidebar-collapsed");
    setDocumentCollapsed(next);
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable: the class still applies for this session.
    }
  }, []);

  return { collapsed, toggle };
}
