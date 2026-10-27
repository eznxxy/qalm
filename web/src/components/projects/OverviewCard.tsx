"use client";

/**
 * Shared shell for the overview's cards (docs/DESIGN.md §4.8 "States").
 *
 * Each card owns its data and therefore its own skeleton, error and Retry —
 * one slow or failing panel never blocks another. This file holds only the
 * frame plus those two states so the trend, milestones and runs cards agree on
 * their headings, links and spacing.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import "./OverviewCard.css";

export interface OverviewCardProps {
  title: string;
  /** Optional header link, e.g. "View all runs". */
  action?: ReactNode;
  /** `aria-busy` on the card, used while a range change is in flight. */
  busy?: boolean;
  className?: string;
  children: ReactNode;
}

export function OverviewCard({
  title,
  action,
  busy,
  className,
  children,
}: OverviewCardProps) {
  return (
    <section
      className={`ov-card${className ? ` ${className}` : ""}`}
      aria-busy={busy || undefined}
    >
      <header className="ov-card-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** The card-level failure state; Retry refetches only this card. */
export function CardError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="ov-card-state" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/** Row-shaped placeholder; the chart passes `chart` for its axis skeleton. */
export function CardSkeleton({ rows = 3, chart = false }: { rows?: number; chart?: boolean }) {
  if (chart) {
    return (
      <div className="ov-chart-skeleton" aria-hidden="true">
        <span className="ov-chart-skeleton-axis" />
        <span className="ov-chart-skeleton-bars" />
      </div>
    );
  }
  return (
    <div className="ov-row-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

/** The shared "View all" header link; always project-filtered. */
export function CardActionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link className="ov-card-action" href={href}>
      {children}
    </Link>
  );
}

/**
 * Writers get the create shortcut; everyone else sees the sentence plus the
 * reason on hover (DESIGN §4.7's rule for unwritable controls).
 */
export function CardCreateShortcut({
  href,
  label,
  reason,
  canWrite,
}: {
  href: string;
  label: string;
  reason: string;
  canWrite: boolean;
}) {
  if (canWrite) {
    return (
      <Link className="button-link ov-card-create" href={href}>
        {label}
      </Link>
    );
  }
  return (
    <p className="muted ov-card-readonly" title={reason}>
      {reason}
    </p>
  );
}