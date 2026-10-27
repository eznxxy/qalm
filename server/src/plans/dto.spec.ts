import 'reflect-metadata';
import { CreatePlanDto } from './dto';
import { GlobalValidationPipe } from '../pipes/global-validation.pipe';

/**
 * DTO-level validation for the plan create contract, docs/api-plans.md §
 * Validation. The rule that matters here is the embedded `runs` array: a plan
 * needs 1–20 runs, and a bad run is named with its index (`runs[1].name`), the
 * same spelling the cases endpoints use for nested steps.
 */
const pipe = new GlobalValidationPipe();

async function issuesFor(body: unknown): Promise<Array<{ field: string; issue: string }>> {
  try {
    await pipe.transform(body, { type: 'body', metatype: CreatePlanDto });
    return [];
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.() as
      | { details?: Array<{ field: string; issue: string }> }
      | undefined;
    return response?.details ?? [];
  }
}

const fieldsOf = async (body: unknown): Promise<string[]> =>
  (await issuesFor(body)).map((detail) => detail.field);

const transform = async (body: unknown): Promise<CreatePlanDto> =>
  (await pipe.transform(body, { type: 'body', metatype: CreatePlanDto })) as CreatePlanDto;

const validCreate = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Release 2.4',
  runs: [{ name: 'Smoke' }],
  ...overrides,
});

describe('plans DTOs', () => {
  describe('CreatePlanDto', () => {
    it('accepts a plan with one or more runs and trims every name', async () => {
      expect(await issuesFor(validCreate())).toEqual([]);

      const dto = await transform(
        validCreate({
          name: '  Release 2.4  ',
          description: '  sweep  ',
          runs: [{ name: '  Smoke  ', description: '   ' }, { name: 'Full' }],
        }),
      );
      expect(dto.name).toBe('Release 2.4');
      expect(dto.description).toBe('sweep');
      expect(dto.runs?.map((run) => run.name)).toEqual(['Smoke', 'Full']);
      expect(dto.runs?.[0]?.description).toBe('');
    });

    it('leaves the 1–20 rule to the service now that runs may be omitted', async () => {
      // `runs` is optional at the shape level (3.10): a plan may be created
      // entirely from `run_ids`. The combined floor/cap needs both arrays, so
      // PlansService enforces it; the DTO accepts either array alone.
      expect(await issuesFor({ name: 'Release 2.4' })).toEqual([]);
      expect(await issuesFor(validCreate({ runs: [] }))).toEqual([]);
      expect(
        await issuesFor({ name: 'Release 2.4', run_ids: ['018f4b21-6c7d-7e8f-9a0b-1c2d3e4f5a6b'] }),
      ).toEqual([]);
    });

    it('caps runs and run_ids at 20 each and validates every id', async () => {
      const runs = Array.from({ length: 21 }, (_, index) => ({ name: `Run ${index}` }));
      expect(await fieldsOf(validCreate({ runs }))).toContain('runs');

      const runIds = Array.from(
        { length: 21 },
        (_, index) => `018f4b21-6c7d-7e8f-9a0b-1c2d3e4f5a${String(index).padStart(2, '0')}`,
      );
      expect(await fieldsOf({ name: 'Release 2.4', run_ids: runIds })).toContain('run_ids');
      // A malformed element is named by its array, the way `case_ids` is —
      // cross-row failures (unknown / already planned) get `run_ids[i]`.
      expect(
        await fieldsOf({ name: 'Release 2.4', run_ids: ['not-a-uuid'] }),
      ).toContain('run_ids');
    });

    it('names the indexed run field for an invalid run', async () => {
      const fields = await fieldsOf(
        validCreate({ runs: [{ name: 'Fine' }, { name: '   ' }] }),
      );
      expect(fields).toContain('runs[1].name');

      const longName = await fieldsOf(
        validCreate({ runs: [{ name: 'x'.repeat(121) }] }),
      );
      expect(longName).toContain('runs[0].name');
    });

    it('validates the embedded dates as YYYY-MM-DD', async () => {
      const fields = await fieldsOf(
        validCreate({ runs: [{ name: 'Run', start_date: '2026/11/02' }] }),
      );
      expect(fields).toContain('runs[0].start_date');

      expect(
        await issuesFor(
          validCreate({ runs: [{ name: 'Run', start_date: '2026-11-02', due_date: null }] }),
        ),
      ).toEqual([]);
    });

    it('rejects run fields the embedded DTO does not own (plan_id, selection)', async () => {
      const withPlan = await fieldsOf(
        validCreate({ runs: [{ name: 'Run', plan_id: '018f2c55-1a2b-7c3d-9e4f-5a6b7c8d9e0f' }] }),
      );
      expect(withPlan).toContain('runs[0].plan_id');

      const withSelection = await fieldsOf(
        validCreate({ runs: [{ name: 'Run', selection: { case_ids: [] } }] }),
      );
      expect(withSelection).toContain('runs[0].selection');
    });
  });
});