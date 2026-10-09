"use client";

/**
 * Placeholder route for screens that are designed (DESIGN.md §3 sidebar) but
 * not built yet. §6: an empty state is one sentence stating what belongs
 * here — no fake screens, no mock content.
 *
 * useParams (not the async params prop) keeps this synchronous and testable
 * in jsdom, the same pattern as the project detail screen.
 */
import { useParams } from "next/navigation";

const SECTION_TITLES: Record<string, string> = {
  overview: "Overview",
  cases: "Test cases",
  runs: "Test runs",
  plans: "Test plans",
  milestones: "Milestones",
  reports: "Reports",
  settings: "Settings",
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
