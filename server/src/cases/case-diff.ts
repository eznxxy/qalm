import { CasePriority, CaseType } from './cases.constants';
import { CaseChange } from './cases.types';

/**
 * Pure diffing for PATCH /cases/:id, docs/api-cases.md § PATCH:
 * one `updated` history entry lists the changed fields with from → to values,
 * steps are summarised by count (`{ from: 2, to: 3 }`), and a suite change is
 * a separate `moved` entry. Kept free of SQL so the audit rules are
 * unit-testable; the endpoint itself is covered by test/cases.e2e-spec.ts.
 */
export interface CaseStepValue {
  text: string;
  expected_result: string | null;
}

export interface CaseSnapshot {
  title: string;
  preconditions: string | null;
  priority: CasePriority;
  type: CaseType;
  tags: string[];
  estimate_minutes: number | null;
  suite_id: string | null;
  steps: CaseStepValue[];
}

export interface CasePatch {
  title?: string;
  preconditions?: string | null;
  priority?: CasePriority;
  type?: CaseType;
  tags?: string[];
  estimate_minutes?: number | null;
  suite_id?: string;
  steps?: CaseStepValue[];
}

export interface CaseDiff {
  /** Field-level changes for the `updated` history row (never steps). */
  updated: Record<string, CaseChange>;
  /** Steps summarised as `{ from: <count>, to: <count> }`. */
  steps: CaseChange | null;
  /** Suite change for the `moved` history row. */
  moved: CaseChange | null;
  /** False when the patch changes nothing — no writes, no audit rows. */
  changed: boolean;
}

export function sameTags(before: string[], after: string[]): boolean {
  return before.length === after.length && before.every((tag, index) => tag === after[index]);
}

export function sameSteps(before: CaseStepValue[], after: CaseStepValue[]): boolean {
  return (
    before.length === after.length &&
    before.every(
      (step, index) =>
        step.text === after[index]?.text &&
        step.expected_result === after[index]?.expected_result,
    )
  );
}

export function diffCase(before: CaseSnapshot, patch: CasePatch): CaseDiff {
  const updated: Record<string, CaseChange> = {};
  if (patch.title !== undefined && patch.title !== before.title) {
    updated['title'] = { from: before.title, to: patch.title };
  }
  if (patch.preconditions !== undefined && patch.preconditions !== before.preconditions) {
    updated['preconditions'] = { from: before.preconditions, to: patch.preconditions };
  }
  if (patch.priority !== undefined && patch.priority !== before.priority) {
    updated['priority'] = { from: before.priority, to: patch.priority };
  }
  if (patch.type !== undefined && patch.type !== before.type) {
    updated['type'] = { from: before.type, to: patch.type };
  }
  if (patch.tags !== undefined && !sameTags(patch.tags, before.tags)) {
    updated['tags'] = { from: before.tags, to: patch.tags };
  }
  if (patch.estimate_minutes !== undefined && patch.estimate_minutes !== before.estimate_minutes) {
    updated['estimate_minutes'] = { from: before.estimate_minutes, to: patch.estimate_minutes };
  }

  let steps: CaseChange | null = null;
  if (patch.steps !== undefined && !sameSteps(patch.steps, before.steps)) {
    steps = { from: before.steps.length, to: patch.steps.length };
  }

  let moved: CaseChange | null = null;
  if (patch.suite_id !== undefined && patch.suite_id !== before.suite_id) {
    moved = { from: before.suite_id, to: patch.suite_id };
  }

  return {
    updated,
    steps,
    moved,
    changed: Object.keys(updated).length > 0 || steps !== null || moved !== null,
  };
}
