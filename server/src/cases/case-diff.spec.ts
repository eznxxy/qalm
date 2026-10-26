import { CasePatch, CaseSnapshot, diffCase, sameSteps } from './case-diff';

/**
 * Audit-diff rules for docs/api-cases.md § PATCH: field-level from → to,
 * steps summarised by count, suite moves as their own entry, and no writes
 * when nothing actually changed.
 */
const BEFORE: CaseSnapshot = {
  title: 'Pay with saved card',
  preconditions: 'Customer has a saved card',
  priority: 'medium',
  type: 'functional',
  tags: ['payments'],
  estimate_minutes: 15,
  suite_id: 'suite-a',
  steps: [
    { text: 'Open checkout', expected_result: 'Cart total is shown' },
    { text: 'Pay', expected_result: 'Order confirmed' },
  ],
};

const patch = (overrides: CasePatch): CasePatch => ({ ...overrides });

describe('diffCase', () => {
  it('reports nothing when the patch matches the current values', () => {
    const diff = diffCase(BEFORE, {
      title: BEFORE.title,
      preconditions: BEFORE.preconditions,
      priority: BEFORE.priority,
      type: BEFORE.type,
      tags: [...BEFORE.tags],
      estimate_minutes: BEFORE.estimate_minutes,
      suite_id: BEFORE.suite_id!,
      steps: BEFORE.steps.map((step) => ({ ...step })),
    });
    expect(diff.changed).toBe(false);
    expect(diff.updated).toEqual({});
    expect(diff.steps).toBeNull();
    expect(diff.moved).toBeNull();
  });

  it('reports only the fields that changed, with from → to values', () => {
    const diff = diffCase(
      BEFORE,
      patch({ title: 'Pay with card', priority: 'high', estimate_minutes: null }),
    );
    expect(diff.updated).toEqual({
      title: { from: 'Pay with saved card', to: 'Pay with card' },
      priority: { from: 'medium', to: 'high' },
      estimate_minutes: { from: 15, to: null },
    });
    expect(diff.changed).toBe(true);
  });

  it('treats a tags reorder or removal as a change', () => {
    const reordered = diffCase({ ...BEFORE, tags: ['smoke', 'payments'] }, patch({ tags: ['payments', 'smoke'] }));
    expect(reordered.updated['tags']).toEqual({
      from: ['smoke', 'payments'],
      to: ['payments', 'smoke'],
    });
    const cleared = diffCase(BEFORE, patch({ tags: [] }));
    expect(cleared.updated['tags']).toEqual({ from: ['payments'], to: [] });
  });

  it('summarises step changes by count instead of copying the array', () => {
    const added = diffCase(BEFORE, patch({ steps: [...BEFORE.steps, { text: 'Done', expected_result: null }] }));
    expect(added.steps).toEqual({ from: 2, to: 3 });
    expect(added.updated).toEqual({});

    const rewritten = diffCase(BEFORE, patch({ steps: [{ text: 'Open checkout', expected_result: 'Cart' }, BEFORE.steps[1]!] }));
    expect(rewritten.steps).toEqual({ from: 2, to: 2 });
    expect(rewritten.changed).toBe(true);
  });

  it('keeps a suite move out of the field diff', () => {
    const diff = diffCase(BEFORE, patch({ suite_id: 'suite-b' }));
    expect(diff.moved).toEqual({ from: 'suite-a', to: 'suite-b' });
    expect(diff.updated).toEqual({});
    expect(diff.changed).toBe(true);
  });

  it('reports a combined move plus edit as two independent entries', () => {
    const diff = diffCase(BEFORE, patch({ suite_id: 'suite-b', title: 'Pay' }));
    expect(diff.updated).toEqual({ title: { from: 'Pay with saved card', to: 'Pay' } });
    expect(diff.moved).toEqual({ from: 'suite-a', to: 'suite-b' });
  });

  it('treats clearing preconditions and whitespace-equivalent text correctly', () => {
    expect(diffCase(BEFORE, patch({ preconditions: null })).updated['preconditions']).toEqual({
      from: 'Customer has a saved card',
      to: null,
    });
    // Normalisation happens before diffing: equal strings are not a change.
    expect(diffCase(BEFORE, patch({ title: 'Pay with saved card' })).changed).toBe(false);
  });
});

describe('sameSteps', () => {
  it('compares order, text and expected results', () => {
    const a = [
      { text: 'one', expected_result: 'x' },
      { text: 'two', expected_result: null },
    ];
    expect(sameSteps(a, a.map((step) => ({ ...step })))).toBe(true);
    expect(sameSteps(a, [a[1]!, a[0]!])).toBe(false);
    expect(sameSteps(a, [{ ...a[0]!, expected_result: 'y' }, a[1]!])).toBe(false);
    expect(sameSteps(a, [a[0]!])).toBe(false);
  });
});
