"use client";

/**
 * Project tab strip (docs/DESIGN.md §4.8, docs/PRD-project-overview.md
 * "Tab strip").
 *
 * Tabs are real routes, not panels: each tab opens the screen that already owns
 * that data filtered to this project. The active tab is decided by the route,
 * never by local state, so reloading a project always lands on Overview.
 *
 * Reports is deliberately a focusable `<span>`, not a dead link: it has
 * `aria-disabled`, no `href`, and its explanation is both a `title` (hover) and
 * an `aria-describedby` target (focus). There is no Todo tab — Qalm has no
 * todo resource.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import "./ProjectTabs.css";

export interface ProjectTabsProps {
  projectId: string;
}

type TabKey = "overview" | "milestones" | "runs" | "cases";

export function ProjectTabs({ projectId }: ProjectTabsProps) {
  const pathname = usePathname();
  const projectQuery = `project=${encodeURIComponent(projectId)}`;
  const active: TabKey = pathname.startsWith("/milestones")
    ? "milestones"
    : pathname.startsWith("/runs")
      ? "runs"
      : pathname.startsWith("/cases")
        ? "cases"
        : "overview";

  const tabs: Array<{ key: TabKey; label: string; href: string }> = [
    {
      key: "overview",
      label: "Overview",
      href: `/projects/${encodeURIComponent(projectId)}`,
    },
    { key: "milestones", label: "Milestones", href: `/milestones?${projectQuery}` },
    { key: "runs", label: "Test runs", href: `/runs?${projectQuery}` },
    { key: "cases", label: "Test cases", href: `/cases?${projectQuery}` },
  ];

  return (
    <nav className="project-tabs" aria-label="Project sections">
      <ul>
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={active === tab.key ? "page" : undefined}
            >
              {tab.label}
            </Link>
          </li>
        ))}
        <li>
          <span
            className="project-tab-disabled"
            aria-disabled="true"
            tabIndex={0}
            aria-describedby="project-tab-reports-hint"
            title="Reports arrive in a later slice"
          >
            Reports
          </span>
        </li>
      </ul>
      <span id="project-tab-reports-hint" className="sr-only">
        Reports arrive in a later slice
      </span>
    </nav>
  );
}