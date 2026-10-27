"use client";

/**
 * Placeholder route for screens that are designed (DESIGN.md §3 sidebar) but
 * not built yet. §6: an empty state is one sentence stating what belongs
 * here — no fake screens, no mock content.
 *
 * Sections that shipped (cases, runs, plans) are deliberately absent: their
 * sidebar links point at the real routes, so a /wip/cases URL is a dead link
 * rather than a second home for the screen. A retired section therefore falls
 * through to the raw-slug line below.
 *
 * useParams (not the async params prop) keeps this synchronous and testable
 * in jsdom, the same pattern as the project detail screen.
 */
import { useParams } from "next/navigation";

const SECTION_TITLES: Record<string, string> = {
  overview: "Overview",
  milestones: "Milestones",
  reports: "Reports",
};

export default function NotBuiltPage() {
  const { slug } = useParams<{ slug: string }>();
  const title = SECTION_TITLES[slug] ?? slug;

  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="empty-state">This screen is not built yet.</p>
    </div>
  );
}
