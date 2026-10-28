import 'reflect-metadata';
import { GlobalValidationPipe } from '../pipes/global-validation.pipe';
import { ReportSummaryQuery, TrendQuery } from './reports.dto';

/**
 * Query validation for docs/api-project-overview.md § Endpoint: `days` is an
 * integer in 1–90 (default 14), and a bad value is a 400 that names the field.
 * docs/api-reports.md § GET .../reports/summary adds the `none` filters and
 * paging on the same days window.
 */
const pipe = new GlobalValidationPipe();

async function issuesFor(
  dtoClass: new () => object,
  body: unknown,
): Promise<Array<{ field: string; issue: string }>> {
  try {
    await pipe.transform(body, { type: 'query', metatype: dtoClass });
    return [];
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.() as
      | { details?: Array<{ field: string; issue: string }> }
      | undefined;
    return response?.details ?? [];
  }
}

const parse = async <T extends object>(dtoClass: new () => T, body: unknown): Promise<T> =>
  (await pipe.transform(body, { type: 'query', metatype: dtoClass })) as T;

const summaryIssues = (body: unknown) => issuesFor(ReportSummaryQuery, body);

const parseSummary = (body: unknown): Promise<ReportSummaryQuery> =>
  parse(ReportSummaryQuery, body);

describe('TrendQuery', () => {
  it('defaults to no days so the service applies 14', async () => {
    expect(await parse(TrendQuery, {})).toEqual({});
  });

  it('accepts and coerces the four presets and the wider report range', async () => {
    for (const days of ['1', '7', '14', '30', '90']) {
      expect((await parse(TrendQuery, { days })).days).toBe(Number(days));
    }
  });

  it('rejects a missing, fractional, non-numeric, repeated or out-of-range window', async () => {
    for (const days of ['0', '91', '1.5', 'abc', '', ['7', '14']]) {
      const fields = (await issuesFor(TrendQuery, { days })).map((detail) => detail.field);
      expect(fields).toContain('days');
    }
  });
});

describe('ReportSummaryQuery', () => {
  it('leaves defaults to the service so 30/1/25 are applied there', async () => {
    expect(await parseSummary({})).toEqual({});
  });

  it('accepts uuid and none filters, both statuses, and page/limit bounds', async () => {
    const parsed = await parseSummary({
      plan_id: '018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f',
      milestone_id: 'none',
      status: 'open',
      page: '2',
      limit: '100',
    });
    expect(parsed).toMatchObject({
      plan_id: '018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f',
      milestone_id: 'none',
      status: 'open',
      page: 2,
      limit: 100,
    });
  });

  it('rejects days, filters, status and paging outside the contract', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ days: '0' }, 'days'],
      [{ days: '91' }, 'days'],
      [{ days: '1.5' }, 'days'],
      [{ days: 'abc' }, 'days'],
      [{ days: ['7', '14'] }, 'days'],
      [{ plan_id: 'not-a-uuid' }, 'plan_id'],
      [{ milestone_id: 'not-a-uuid' }, 'milestone_id'],
      [{ status: 'archived' }, 'status'],
      [{ page: '0' }, 'page'],
      [{ limit: '101' }, 'limit'],
    ];
    for (const [body, field] of cases) {
      expect((await summaryIssues(body)).map((d) => d.field)).toContain(field);
    }
  });
});