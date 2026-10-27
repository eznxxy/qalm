"use client";

/**
 * Milestones card (docs/DESIGN.md §4.8, docs/api-milestones.md).
 *
 * The five nearest milestones, sorted like the milestones screen (due date
 * ascending, undated last), each with its countdown, status bar and
 * `% complete`. Everything is derived by the API; this card only reads.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Milestone } from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { formatDateOnly, formatDaysLeft } from "@/lib/dates";
import { StatusBar } from "@/components/ui";
import {
  CardActionLink,
  CardCreateShortcut,
  CardError,
  CardSkeleton,
  OverviewCard,
} from "./OverviewCard";
import "./MilestonesCard.css";

const CARD_LIMIT = 5;
const LOAD_ERROR =
  "Couldn't load milestones. Check your connection and retry.";

type State =
  | { kind: "loading" }
  | { kind: "ready"; rows: Milestone[] }
  | { kind: "error"; message: string };

export interface MilestonesCardProps {
  projectId: string;
  canCreate: boolean;
}

export function MilestonesCard({ projectId, canCreate }: MilestonesCardProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setState({ kind: "loading" });
      try {
        const page = await api.listMilestones(projectId, {
          sort: "due_date",
          page: 1,
          limit: CARD_LIMIT,
        });
        if (active) setState({ kind: "ready", rows: page.data });
      } catch (err) {
        if (!active || isSessionDead(err)) return;
        setState({
          kind: "error",
          message: err instanceof ApiError ? err.message || LOAD_ERROR : LOAD_ERROR,
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, retry]);

  return (
    <OverviewCard
      title="Milestones"
      className="ov-ms-card"
      action={
        <CardActionLink
          href={`/milestones?project=${encodeURIComponent(projectId)}`}
        >
          View all milestones
        </CardActionLink>
      }
    >
      {state.kind === "loading" && <CardSkeleton rows={3} />}

      {state.kind === "error" && (
        <CardError message={state.message} onRetry={() => setRetry((n) => n + 1)} />
      )}

      {state.kind === "ready" && state.rows.length === 0 && (
        <div className="ov-empty">
          <p>No milestones yet. Create one to track a release.</p>
          <CardCreateShortcut
            href={`/milestones?project=${encodeURIComponent(projectId)}&new=1`}
            label="New milestone"
            reason="Only Admins and Leads can create milestones."
            canWrite={canCreate}
          />
        </div>
      )}

      {state.kind === "ready" && state.rows.length > 0 && (
        <ul className="ov-ms-list">
          {state.rows.map((milestone) => {
            const daysLeft = formatDaysLeft(milestone.due_date);
            return (
              <li key={milestone.id}>
                <Link
                  className="ov-ms-row"
                  href={`/milestones/${encodeURIComponent(milestone.id)}?project=${encodeURIComponent(projectId)}`}
                >
                  <span className="ov-ms-name">{milestone.name}</span>
                  <span className="ov-ms-meta">
                    {milestone.due_date ? (
                      <>
                        <time dateTime={milestone.due_date}>
                          {formatDateOnly(milestone.due_date)}
                        </time>
                        {daysLeft ? ` · ${daysLeft}` : null}
                      </>
                    ) : (
                      "No due date"
                    )}
                  </span>
                  {milestone.counts.total > 0 ? (
                    <span className="ov-ms-progress">
                      <StatusBar counts={milestone.counts} />
                      <span className="ov-ms-percent">
                        {milestone.counts.percent_complete}%
                      </span>
                    </span>
                  ) : (
                    <span className="ov-ms-progress muted">No runs</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewCard>
  );
}