"use client";

/**
 * Milestones card (docs/DESIGN.md §4.8, docs/api-milestones.md).
 *
 * The five nearest milestones, sorted like the milestones screen (due date
 * ascending, undated last), each with its countdown, status bar and
 * `% complete`. Everything is derived by the API; this card only reads.
 *
 * Writers create in place: the header's "New milestone" opens the list screen's
 * create dialog and, on success, both cards refresh through `onChanged` (a new
 * milestone changes the runs card's Milestone column). PRD project-overview
 * acceptance criterion 19.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Milestone } from "@/lib/api-types";
import { api } from "@/lib/endpoints";
import { ApiError } from "@/lib/api-error";
import { isSessionDead } from "@/components/require-auth";
import { formatDateOnly, formatDaysLeft } from "@/lib/dates";
import { StatusBar } from "@/components/ui";
import { NewMilestoneDialog } from "@/components/milestones/NewMilestoneDialog";
import {
  CardActionLink,
  CardError,
  CardNewButton,
  CardSkeleton,
  OverviewCard,
} from "./OverviewCard";
import "./MilestonesCard.css";

const CARD_LIMIT = 5;
const LOAD_ERROR =
  "Couldn't load milestones. Check your connection and retry.";
const READ_ONLY_REASON = "Only Admins and Leads can create milestones.";

type State =
  | { kind: "loading" }
  | { kind: "ready"; rows: Milestone[] }
  | { kind: "error"; message: string };

export interface MilestonesCardProps {
  projectId: string;
  canCreate: boolean;
  /** Bumped by the page after a create so this card refetches. */
  refreshToken: number;
  /** Ask the page to refresh both cards after a create here. */
  onChanged: () => void;
}

export function MilestonesCard({
  projectId,
  canCreate,
  refreshToken,
  onChanged,
}: MilestonesCardProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  // A project switch must not leave this project's dialog open on the next one.
  const [renderedProjectId, setRenderedProjectId] = useState(projectId);
  if (renderedProjectId !== projectId) {
    setRenderedProjectId(projectId);
    setCreating(false);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      // A refresh keeps the rows on screen (and marks the card busy) instead of
      // flashing a skeleton after every save.
      setState((current) =>
        current.kind === "ready" ? current : { kind: "loading" }
      );
      setRefreshing(true);
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
      } finally {
        if (active) setRefreshing(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, retry, refreshToken]);

  return (
    <OverviewCard
      title="Milestones"
      className="ov-ms-card"
      busy={refreshing}
      action={
        <div className="ov-card-actions">
          {canCreate && (
            <CardNewButton
              label="New milestone"
              onClick={() => setCreating(true)}
            />
          )}
          <CardActionLink
            href={`/milestones?project=${encodeURIComponent(projectId)}`}
          >
            View all milestones
          </CardActionLink>
        </div>
      }
    >
      {state.kind === "loading" && <CardSkeleton rows={3} />}

      {state.kind === "error" && (
        <CardError message={state.message} onRetry={() => setRetry((n) => n + 1)} />
      )}

      {state.kind === "ready" && state.rows.length === 0 && (
        <div className="ov-empty">
          <p>No milestones yet. Create one to track a release.</p>
          {!canCreate && (
            <p className="muted ov-card-readonly" title={READ_ONLY_REASON}>
              {READ_ONLY_REASON}
            </p>
          )}
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

      {creating && (
        <NewMilestoneDialog
          projectId={projectId}
          onCreated={() => {
            setCreating(false);
            onChanged();
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </OverviewCard>
  );
}