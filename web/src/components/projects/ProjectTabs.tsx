"use client";

/**
 * Project tab strip (docs/DESIGN.md §4.8, docs/PRD-project-overview.md
 * "Tab strip").
 *
 * Tabs are real routes, not panels: each tab opens the screen that already owns
 * that data filtered to this project. The active tab is decided by the route,
 * never by local state, so reloading a project always lands on Overview.
 *
 * Every tab is a real link to a real route — Reports included — so the strip
 * has no dead controls left to explain. There is no Todo tab — Qalm has no
 * todo resource.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import "./ProjectTabs.css";

export interface ProjectTabsProps {
  projectId: string;
}

type TabKey = "overview" | "milestones" | "runs" | "cases" | "reports";

export function ProjectTabs({ projectId }: ProjectTabsProps) {
  const pathname = usePathname();
  const projectQuery = `project=${encodeURIComponent(projectId)}`;
  const active: TabKey = pathname.startsWith("/milestones")
    ? "milestones"
    : pathname.startsWith("/runs")
      ? "runs"
      : pathname.startsWith("/cases")
        ? "cases"
        : pathname.startsWith("/reports")
          ? "reports"
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
    { key: "reports", label: "Reports", href: `/reports?${projectQuery}` },
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
      </ul>
    </nav>
  );
}