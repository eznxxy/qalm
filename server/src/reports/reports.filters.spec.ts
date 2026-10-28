import { resolveReportFilters, toReportFiltersDto } from './reports.filters';

const PLAN = '018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f';
const MILESTONE = '018f4c40-8d5f-7a80-9c13-8d9e0f123456';

describe('resolveReportFilters', () => {
  it('turns an absent filter into no filter at all', () => {
    expect(resolveReportFilters({})).toEqual({
      planId: null, planNone: false, milestoneId: null, milestoneNone: false, status: null,
    });
  });

  it('keeps a uuid on its typed column and matches none separately', () => {
    expect(resolveReportFilters({ plan_id: PLAN, milestone_id: 'none', status: 'completed' }))
      .toEqual({ planId: PLAN, planNone: false, milestoneId: null, milestoneNone: true, status: 'completed' });
  });

  it('never passes the literal none into a uuid field', () => {
    expect(resolveReportFilters({ plan_id: 'none', milestone_id: 'none' })).toEqual({
      planId: null, planNone: true, milestoneId: null, milestoneNone: true, status: null,
    });
  });
});

describe('toReportFiltersDto', () => {
  it('echoes raw values so the client can label "No plan"', () => {
    expect(toReportFiltersDto({ plan_id: 'none', status: 'open' }))
      .toEqual({ plan_id: 'none', milestone_id: null, status: 'open' });
  });
});