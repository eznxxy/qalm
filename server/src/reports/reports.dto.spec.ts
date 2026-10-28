import 'reflect-metadata';
import { GlobalValidationPipe } from '../pipes/global-validation.pipe';
import { TrendQuery } from './reports.dto';

/**
 * Query validation for docs/api-project-overview.md § Endpoint: `days` is an
 * integer in 1–90 (default 14), and a bad value is a 400 that names the field.
 */
const pipe = new GlobalValidationPipe();

async function issuesFor(body: unknown): Promise<Array<{ field: string; issue: string }>> {
  try {
    await pipe.transform(body, { type: 'query', metatype: TrendQuery });
    return [];
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.() as
      | { details?: Array<{ field: string; issue: string }> }
      | undefined;
    return response?.details ?? [];
  }
}

const parse = async (body: unknown): Promise<TrendQuery> =>
  (await pipe.transform(body, { type: 'query', metatype: TrendQuery })) as TrendQuery;

describe('TrendQuery', () => {
  it('defaults to no days so the service applies 14', async () => {
    expect(await parse({})).toEqual({});
  });

  it('accepts and coerces the four presets and the wider report range', async () => {
    for (const days of ['1', '7', '14', '30', '90']) {
      expect((await parse({ days })).days).toBe(Number(days));
    }
  });

  it('rejects a missing, fractional, non-numeric, repeated or out-of-range window', async () => {
    for (const days of ['0', '91', '1.5', 'abc', '', ['7', '14']]) {
      const fields = (await issuesFor({ days })).map((detail) => detail.field);
      expect(fields).toContain('days');
    }
  });
});