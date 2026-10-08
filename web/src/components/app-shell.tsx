"use client";

/**
 * App shell — DESIGN.md §3: 48px top bar (Qalm mark, project switcher,
 * search, help + account affordances) over a 232px project-scoped sidebar
 * (collapses to 56px at 1280 via CSS). The active nav item gets the
 * --brand-tint background and 2px --brand bar. Content renders full-width.
 *
 * Rendered by the (app) route-group layout; auth screens ((auth) group)
 * stay outside the shell per the card. Session gating stays in RequireAuth,
 * which the layout renders INSIDE the shell so the chrome is stable while
 * the session restores.
 *
 * Project scope lives in the ?project= query parameter (shareable; the
 * sidebar nav links carry it). Screens not built yet route to /wip/[slug]
 * (§6: one-sentence empty state, no fake screens).
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Project, Role } from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { isSessionDead } from "@/components/require-auth";
import { useSession } from "@/lib/session";
import {
  SIDEBAR_AUTO_COLLAPSE_QUERY,
  SIDEBAR_COLLAPSE_KEY,
  useSidebarCollapse,
} from "@/lib/use-sidebar-collapse";
import { HelpDialog } from "@/components/help-dialog";
import {
  isTypingTarget,
  useGlobalShortcuts,
  type ShortcutDefinition,
} from "@/lib/keymap";

/** §7 go-to sequences: `g` then the section's initial (g then c/r/p). */
const GOTO_ROUTES: Record<string, string> = {
  c: "/wip/cases",
  r: "/wip/runs",
  p: "/wip/plans",
};

/** How long the armed `g` chord waits for its second key. */
const GOTO_CHORD_WINDOW_MS = 1000;

/**
 * Runs before first paint so a stored (or breakpoint-default) collapsed rail
 * never flashes wide: applies the .sidebar-collapsed class to <html>, which
 * the CSS keys off. Mirrors applyStoredSidebarPreference() from the hook —
 * kept as a literal because inline scripts cannot import.
 */
const SIDEBAR_PRERENDER_SCRIPT = `(function(){try{var k=${JSON.stringify(
  SIDEBAR_COLLAPSE_KEY
)};var raw=null;try{raw=window.localStorage.getItem(k)}catch(e){}var collapsed=raw==="1"||(raw!=="0"&&window.matchMedia(${JSON.stringify(
  SIDEBAR_AUTO_COLLAPSE_QUERY
)}).matches);document.documentElement.classList.toggle("sidebar-collapsed",collapsed)}catch(e){}})();`;

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  lead: "Lead",
  tester: "Tester",
  viewer: "Viewer",
};

/**
 * Sidebar items (§3). The second group renders below a separator. An
 * admin-only Users item keeps the existing user-management screen reachable
 * — §3's list has no Users entry, so its final home (likely inside a future
 * Settings screen) is a decision for Daedalus; flagged in the handoff.
 */
function navGroups(isAdmin: boolean): ReadonlyArray<ReadonlyArray<{ href: string; label: string; icon: ReactNode }>> {
  const secondary: { href: string; label: string; icon: ReactNode }[] = [];
  if (isAdmin) {
    secondary.push({ href: "/users", label: "Users", icon: <NavIcon icon="users" /> });
  }
  secondary.push({ href: "/settings", label: "Settings", icon: <NavIcon icon="settings" /> });
  return [
    [
      // Screens without a real page yet route to the §6 one-sentence
      // placeholder at /wip/[slug]; the sidebar always points somewhere real.
      { href: "/wip/overview", label: "Overview", icon: <NavIcon icon="overview" /> },
      { href: "/wip/cases", label: "Test cases", icon: <NavIcon icon="cases" /> },
      { href: "/wip/runs", label: "Test runs", icon: <NavIcon icon="runs" /> },
      { href: "/wip/plans", label: "Test plans", icon: <NavIcon icon="plans" /> },
      { href: "/wip/milestones", label: "Milestones", icon: <NavIcon icon="milestones" /> },
      { href: "/wip/reports", label: "Reports", icon: <NavIcon icon="reports" /> },
    ],
    secondary,
  ];
}

/** api-conventions.md hard cap on list limits — one fetch covers the switcher. */
const PROJECT_SWITCHER_LIMIT = 200;

/** Minimal 16px stroke glyphs (§8: decorative — the text label carries meaning). */
function NavIcon({ icon }: { icon: "overview" | "cases" | "runs" | "plans" | "milestones" | "reports" | "settings" | "users" }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    focusable: false as const,
  };
  switch (icon) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
      );
    case "cases":
      return (
        <svg {...common}>
          <path d="M4 1.5h5.5L13 5v9.5H4z" />
          <path d="M9.5 1.5V5H13" />
        </svg>
      );
    case "runs":
      return (
        <svg {...common}>
          <path d="M4.5 2.5l8 5.5-8 5.5z" />
        </svg>
      );
    case "plans":
      return (
        <svg {...common}>
          <rect x="2" y="3" width="12" height="11" rx="1" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
      );
    case "milestones":
      return (
        <svg {...common}>
          <path d="M4 14.5v-13" />
          <path d="M4 2.5h8l-2 3 2 3H4" />
        </svg>
      );
    case "reports":
      return (
        <svg {...common}>
          <path d="M2 14h12" />
          <path d="M4.5 14V8M8 14V3.5M11.5 14V6" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M2 4.5h12M2 11.5h12" />
          <circle cx="6" cy="4.5" r="1.75" fill="var(--bg-raised)" />
          <circle cx="10" cy="11.5" r="1.75" fill="var(--bg-raised)" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="8" cy="5" r="2.5" />
          <path d="M3 13.5c0-2.6 2.2-4.2 5-4.2s5 1.6 5 4.2" />
        </svg>
      );
  }
}

function isActiveNav(pathname: string, href: string): boolean {
  // "/" never matches a nav item (it forwards to /projects), so startsWith
  // on the item href cannot produce false positives ("/cases" vs "/cases-x"
  // is excluded by requiring the segment boundary).
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  return initials || "?";
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AppShellInner>{children}</AppShellInner>
    </Suspense>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  const { collapsed, toggle } = useSidebarCollapse();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ---- project scope: ?project=<id> in the URL is the source of truth ----
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsState, setProjectsState] = useState<"loading" | "ready" | "error">("loading");
  const urlProject = searchParams.get("project");
  // Adjust-during-render sync (React docs pattern): back/forward updates the
  // requested scope without an effect round-trip.
  const [renderedProject, setRenderedProject] = useState(urlProject);
  if (renderedProject !== urlProject) {
    setRenderedProject(urlProject);
  }

  useEffect(() => {
    let active = true;
    api
      .listProjects({ page: 1, limit: PROJECT_SWITCHER_LIMIT })
      .then((result) => {
        if (!active) return;
        setProjects(result.data);
        setProjectsState("ready");
      })
      .catch((err) => {
        if (active && !isSessionDead(err)) setProjectsState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedProjectId =
    projects.find((p) => p.id === renderedProject)?.id ?? projects[0]?.id ?? "";

  function onProjectChange(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("project", id);
    else params.delete("project");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  /** Nav links carry the current project scope (§3 project-scoped sidebar). */
  function scopedHref(href: string): string {
    return selectedProjectId ? `${href}?project=${encodeURIComponent(selectedProjectId)}` : href;
  }

  // ---- top-bar search: visual affordance wired to the projects search ----
  const [searchInput, setSearchInput] = useState("");
  function onSearchSubmit() {
    const q = searchInput.trim();
    router.push(q ? `/projects?query=${encodeURIComponent(q)}` : "/projects");
  }

  // ---- §7 shortcuts (card t_6ce021c1) ----
  const [helpOpen, setHelpOpen] = useState(false);

  // `g` chord state: "g" arms the sequence; the next key completes it if it
  // maps to a §7 route, otherwise the arm expires.
  const [gotoArmed, setGotoArmed] = useState(false);
  useEffect(() => {
    if (!gotoArmed) return;
    const timer = setTimeout(() => setGotoArmed(false), GOTO_CHORD_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [gotoArmed]);

  // `n` is context-aware: today that means the projects screen's create
  // form, announced by the heading "Create project". When that form is not
  // on screen, land on Projects; built screens wire their own `n` later.
  function openCreateForm() {
    const heading = Array.from(document.querySelectorAll("h1, h2")).find(
      (h) => h.textContent === "Create project"
    );
    if (!heading) {
      router.push(scopedHref("/projects"));
      return;
    }
    const focusable = heading.querySelector<HTMLElement>(
      "button, [href], input, select, textarea"
    );
    (focusable ?? (heading as HTMLElement)).focus();
  }

  const shortcuts: ShortcutDefinition[] = [
    {
      key: "/",
      handler: () => document.getElementById("topbar-search-input")?.focus(),
      allowInInputs: true,
    },
    { key: "n", handler: openCreateForm },
    { key: "?", handler: () => setHelpOpen(true) },
    ...Object.entries(GOTO_ROUTES).map(
      ([suffix, route]): ShortcutDefinition => ({
        key: suffix,
        // Only completes while the `g` chord is armed; the arm is consumed.
        handler: () => {
          if (!gotoArmed) return;
          setGotoArmed(false);
          router.push(scopedHref(route));
        },
      })
    ),
  ];
  useGlobalShortcuts(shortcuts);

  // The `g` chord opener holds state the definitions above read, so it is
  // wired separately. Typing targets never arm it; repeat/modifier `g`
  // (Ctrl+G browser find, held key) is ignored.
  useEffect(() => {
    function onGotoKeyDown(event: KeyboardEvent) {
      if (event.key !== "g" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.defaultPrevented || event.repeat) return;
      event.preventDefault();
      setGotoArmed(true);
    }
    window.addEventListener("keydown", onGotoKeyDown);
    return () => window.removeEventListener("keydown", onGotoKeyDown);
  }, []);

  // ---- account menu ----
  const [menuOpen, setMenuOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (avatarRef.current && !avatarRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // The gate in the (app) layout owns session state; while it restores, the
  // shell chrome still renders (stable frame, no layout shift when content
  // arrives). The account affordances degrade gracefully until `user` lands.
  const isAdmin = user?.role === "admin";

  async function handleLogout() {
    if (!user) return;
    await logout();
    router.replace("/login");
  }

  const switcherStatus =
    projectsState === "loading"
      ? "Loading projects…"
      : projectsState === "error"
        ? "Projects unavailable"
        : projects.length === 0
          ? "No projects yet"
          : undefined;

  return (
    <div className="shell">
      {/* Pre-paint collapse (see SIDEBAR_PRERENDER_SCRIPT): before the CSS
       * loads the class is already on <html>, so at ≤1279px (or when the
       * user collapsed it) no 232px frame flashes before the rail. */}
      <script dangerouslySetInnerHTML={{ __html: SIDEBAR_PRERENDER_SCRIPT }} />

      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <header className="topbar">
        <Link
          href={selectedProjectId ? scopedHref("/projects") : "/projects"}
          className="topbar-brand"
        >
          <span className="topbar-mark" aria-hidden="true">
            Q
          </span>
          Qalm
        </Link>

        <div className="topbar-switcher">
          <label htmlFor="project-switcher" className="sr-only">
            Project
          </label>
          <select
            id="project-switcher"
            value={selectedProjectId}
            onChange={(e) => onProjectChange(e.target.value)}
            /* Disabled only while a status placeholder is showing (loading /
             * error / no projects); enabled once real options are listed.
             * (t_df4894c3: was `!switcherStatus` — the 2a inversion that
             * disabled the switcher exactly when it became usable.) */
            disabled={Boolean(switcherStatus)}
          >
            {switcherStatus ? (
              <option value="">{switcherStatus}</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
        </div>

        <span className="topbar-spacer" />

        <form
          className="topbar-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit();
          }}
        >
          <label htmlFor="topbar-search-input" className="sr-only">
            Search cases and runs
          </label>
          <input
            id="topbar-search-input"
            type="search"
            placeholder="Search cases, runs…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            /* §7: '/' from anywhere lands here. Marked out of the shell's
             * keymap scope so typing in it (a form field) can't re-fire the
             * other shortcuts while the caret is in the box. */
            data-shortcut-scope="shell"
          />
        </form>

        <button
          type="button"
          className="topbar-icon-link"
          aria-label="Keyboard shortcuts help"
          aria-haspopup="dialog"
          aria-expanded={helpOpen}
          title="Keyboard shortcuts (?)"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>

        <div className="topbar-avatar" ref={avatarRef}>
          <button
            type="button"
            className="avatar-button"
            aria-label={user ? `Account menu for ${user.name}` : "Account menu"}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {user ? initialsOf(user.name) : "…"}
          </button>
          {menuOpen && user && (
            <div className="avatar-menu" role="group" aria-label="Account">
              <p className="avatar-menu-id" role="status">
                Signed in as {user.name} ({ROLE_LABELS[user.role]})
              </p>
              {user.must_change_password && (
                <p className="avatar-menu-id">
                  Your password is temporary — set your own from account settings.
                </p>
              )}
              <Link href="/change-password" onClick={() => setMenuOpen(false)}>
                Account settings
              </Link>
              <button type="button" onClick={() => void handleLogout()}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="shell-body">
        <nav className="sidebar" aria-label="Main navigation">
          <button
            type="button"
            className="sidebar-toggle"
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggle}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M9.5 3.5L6 8l3.5 4.5" />
            </svg>
            <span className="sidebar-label">Collapse sidebar</span>
          </button>

          <ul className="sidebar-list" role="list">
            {navGroups(isAdmin).map((group, groupIndex) => (
              <Fragment key={groupIndex}>
                {groupIndex > 0 && <li className="sidebar-separator" role="presentation" />}
                {group.map((item) => {
                  const active = isActiveNav(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={scopedHref(item.href)}
                        className={active ? "sidebar-link is-active" : "sidebar-link"}
                        aria-current={active ? "page" : undefined}
                        title={item.label}
                      >
                        {item.icon}
                        <span className="sidebar-label">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </Fragment>
            ))}
          </ul>
        </nav>

        <div className="shell-content" id="content">
          {children}
        </div>
      </div>

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
