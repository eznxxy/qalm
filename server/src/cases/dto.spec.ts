import 'reflect-metadata';
import {
  BulkMoveCasesDto,
  CreateCaseDto,
  ListCaseHistoryQuery,
  ListCasesQuery,
  UpdateCaseDto,
} from './dto';
import { GlobalValidationPipe } from '../pipes/global-validation.pipe';

/**
 * DTO-level validation for the cases contract, docs/api-cases.md § Validation.
 * Cross-row rules (numbering, suite membership, history) live in the service;
 * field shapes and query parsing live here.
 */
const pipe = new GlobalValidationPipe();

async function issuesFor(
  dtoClass: new () => object,
  body: unknown,
): Promise<Array<{ field: string; issue: string }>> {
  try {
    await pipe.transform(body, { type: 'body', metatype: dtoClass });
    return [];
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.() as
      | { details?: Array<{ field: string; issue: string }> }
      | undefined;
    return response?.details ?? [];
  }
}

const fieldsOf = async (dtoClass: new () => object, body: unknown): Promise<string[]> =>
  (await issuesFor(dtoClass, body)).map((detail) => detail.field);

const transform = async <T extends object>(
  dtoClass: new () => T,
  body: unknown,
): Promise<T> =>
  (await pipe.transform(body, { type: 'body', metatype: dtoClass })) as T;

const UUID = '018f2c55-1a2b-7c3d-9e4f-5a6b7c8d9e0f';
const OTHER_UUID = '018f2c56-1a2b-7c3d-9e4f-5a6b7c8d9e0f';

const validCreate = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  suite_id: UUID,
  title: 'Pay with saved card',
  priority: 'high',
  type: 'functional',
  ...overrides,
});

describe('cases DTOs', () => {
  describe('CreateCaseDto', () => {
    it('accepts the documented create payload', async () => {
      expect(await issuesFor(CreateCaseDto, validCreate())).toEqual([]);
    });

    it('requires suite_id, title, priority and type', async () => {
      const fields = await fieldsOf(CreateCaseDto, {});
      expect(fields).toEqual(expect.arrayContaining(['suite_id', 'title', 'priority', 'type']));
    });

    it('trims the title and rejects whitespace-only or over-long titles', async () => {
      const dto = await transform(CreateCaseDto, validCreate({ title: '  Pay  ' }));
      expect(dto.title).toBe('Pay');
      expect(await fieldsOf(CreateCaseDto, validCreate({ title: '   ' }))).toContain('title');
      expect(await fieldsOf(CreateCaseDto, validCreate({ title: 'x'.repeat(201) }))).toContain(
        'title',
      );
    });

    it('rejects an unknown top-level field', async () => {
      expect(await fieldsOf(CreateCaseDto, validCreate({ case_number: 12 }))).toContain(
        'case_number',
      );
    });

    it('accepts 0 or 50 steps and rejects 51', async () => {
      const step = { text: 'Do it', expected_result: 'Done' };
      expect(await fieldsOf(CreateCaseDto, validCreate({ steps: [] }))).toEqual([]);
      expect(
        await fieldsOf(CreateCaseDto, validCreate({ steps: Array.from({ length: 50 }, () => step) })),
      ).toEqual([]);
      expect(
        await fieldsOf(CreateCaseDto, validCreate({ steps: Array.from({ length: 51 }, () => step) })),
      ).toContain('steps');
    });

    it('names the offending step index and field (steps[1].text)', async () => {
      const issues = await issuesFor(
        CreateCaseDto,
        validCreate({ steps: [{ text: 'Open checkout' }, { text: '   ' }] }),
      );
      expect(issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'steps[1].text' })]),
      );
    });

    it('validates each step text and expected_result length', async () => {
      expect(
        await fieldsOf(
          CreateCaseDto,
          validCreate({ steps: [{ text: 'x'.repeat(501), expected_result: null }] }),
        ),
      ).toContain('steps[0].text');
      expect(
        await fieldsOf(
          CreateCaseDto,
          validCreate({ steps: [{ text: 'ok', expected_result: 'y'.repeat(501) }] }),
        ),
      ).toContain('steps[0].expected_result');
    });

    it('accepts a position on a step but does not require it', async () => {
      expect(
        await fieldsOf(
          CreateCaseDto,
          validCreate({ steps: [{ position: 9, text: 'Order is derived', expected_result: null }] }),
        ),
      ).toEqual([]);
      expect(await fieldsOf(CreateCaseDto, validCreate({ steps: null }))).toContain('steps');
    });

    it('lowercases and trims tags and rejects empty, long, over-20 and null input', async () => {
      const dto = await transform(CreateCaseDto, validCreate({ tags: [' Smoke ', 'PAYMENTS'] }));
      expect(dto.tags).toEqual(['smoke', 'payments']);
      // `each: true` constraints name the array property, not the bad index.
      expect(await fieldsOf(CreateCaseDto, validCreate({ tags: ['ok', ''] }))).toContain('tags');
      expect(
        await fieldsOf(CreateCaseDto, validCreate({ tags: ['ok', 'x'.repeat(31)] })),
      ).toContain('tags');
      expect(
        await fieldsOf(CreateCaseDto, validCreate({ tags: Array.from({ length: 21 }, () => 'a') })),
      ).toContain('tags');
      expect(await fieldsOf(CreateCaseDto, validCreate({ tags: null }))).toContain('tags');
    });

    it('accepts preconditions ≤2000 chars and null; rejects longer values', async () => {
      expect(await issuesFor(CreateCaseDto, validCreate({ preconditions: null }))).toEqual([]);
      expect(
        await fieldsOf(CreateCaseDto, validCreate({ preconditions: 'x'.repeat(2001) })),
      ).toContain('preconditions');
    });

    it('coerces estimate_minutes and enforces 0..10080; null clears it', async () => {
      const dto = await transform(CreateCaseDto, validCreate({ estimate_minutes: '90' }));
      expect(dto.estimate_minutes).toBe(90);
      expect(await issuesFor(CreateCaseDto, validCreate({ estimate_minutes: null }))).toEqual([]);
      for (const bad of [-1, 10_081, 1.5]) {
        expect(await fieldsOf(CreateCaseDto, validCreate({ estimate_minutes: bad }))).toContain(
          'estimate_minutes',
        );
      }
    });

    it('only accepts the fixed priority and type values', async () => {
      expect(await fieldsOf(CreateCaseDto, validCreate({ priority: 'HIGH' }))).toContain(
        'priority',
      );
      expect(await fieldsOf(CreateCaseDto, validCreate({ type: 'manual' }))).toContain('type');
      for (const priority of ['critical', 'high', 'medium', 'low']) {
        expect(await fieldsOf(CreateCaseDto, validCreate({ priority }))).toEqual([]);
      }
      for (const type of ['functional', 'regression', 'smoke', 'exploratory', 'other']) {
        expect(await fieldsOf(CreateCaseDto, validCreate({ type }))).toEqual([]);
      }
    });
  });

  describe('UpdateCaseDto', () => {
    it('accepts an empty body (the service turns it into a 400)', async () => {
      expect(await issuesFor(UpdateCaseDto, {})).toEqual([]);
    });

    it('rejects explicit nulls for title, tags, steps and suite_id', async () => {
      expect(await fieldsOf(UpdateCaseDto, { title: null })).toContain('title');
      expect(await fieldsOf(UpdateCaseDto, { tags: null })).toContain('tags');
      expect(await fieldsOf(UpdateCaseDto, { steps: null })).toContain('steps');
      expect(await fieldsOf(UpdateCaseDto, { suite_id: null })).toContain('suite_id');
    });

    it('accepts null for preconditions and estimate_minutes (clears them)', async () => {
      expect(await issuesFor(UpdateCaseDto, { preconditions: null })).toEqual([]);
      expect(await issuesFor(UpdateCaseDto, { estimate_minutes: null })).toEqual([]);
    });

    it('accepts a wholesale step replacement and a tag clear', async () => {
      const issues = await issuesFor(UpdateCaseDto, {
        steps: [{ text: 'Open checkout', expected_result: null }],
        tags: [],
      });
      expect(issues).toEqual([]);
    });
  });

  describe('ListCasesQuery', () => {
    const query = (value: unknown): Promise<Array<{ field: string; issue: string }>> =>
      issuesFor(ListCasesQuery, value);

    it('accepts an empty query', async () => {
      expect(await query({})).toEqual([]);
    });

    it('wraps single and repeated priority/type values into arrays', async () => {
      const single = await transform(ListCasesQuery, { priority: 'high', type: 'smoke' });
      expect(single.priority).toEqual(['high']);
      expect(single.type).toEqual(['smoke']);
      const repeated = await transform(ListCasesQuery, {
        priority: ['high', 'medium'],
        type: ['smoke', 'regression'],
      });
      expect(repeated.priority).toEqual(['high', 'medium']);
      expect(repeated.type).toEqual(['smoke', 'regression']);
    });

    it('rejects unknown enum values on the repeatable params', async () => {
      expect(await fieldsOf(ListCasesQuery, { priority: ['high', 'urgent'] })).toContain(
        'priority',
      );
      expect(await fieldsOf(ListCasesQuery, { type: 'manual' })).toContain('type');
    });

    it('normalises tag filters to a lowercase array (AND is a SQL concern)', async () => {
      const single = await transform(ListCasesQuery, { tag: ' Smoke ' });
      expect(single.tag).toEqual(['smoke']);
      const repeated = await transform(ListCasesQuery, { tag: ['Payments', 'smoke'] });
      expect(repeated.tag).toEqual(['payments', 'smoke']);
    });

    it('parses include_descendants as a boolean and rejects anything else', async () => {
      expect((await transform(ListCasesQuery, { include_descendants: 'false' })).include_descendants).toBe(
        false,
      );
      expect((await transform(ListCasesQuery, { include_descendants: 'true' })).include_descendants).toBe(
        true,
      );
      expect(await fieldsOf(ListCasesQuery, { include_descendants: '1' })).toContain(
        'include_descendants',
      );
    });

    it('validates the sort whitelist including the descending prefix', async () => {
      for (const sort of ['case_number', 'updated_at', 'title', '-updated_at', '-title']) {
        expect(await fieldsOf(ListCasesQuery, { sort })).toEqual([]);
      }
      expect(await fieldsOf(ListCasesQuery, { sort: 'priority' })).toContain('sort');
      expect(await fieldsOf(ListCasesQuery, { sort: '--title' })).toContain('sort');
    });

    it('coerces page/limit, caps limit at 100 and rejects unknown params', async () => {
      const dto = await transform(ListCasesQuery, { page: '2', limit: '50' });
      expect(dto.page).toBe(2);
      expect(dto.limit).toBe(50);
      expect(await fieldsOf(ListCasesQuery, { page: '0' })).toContain('page');
      expect(await fieldsOf(ListCasesQuery, { limit: '101' })).toContain('limit');
      expect(await fieldsOf(ListCasesQuery, { page_size: '10' })).toContain('page_size');
      expect(await fieldsOf(ListCasesQuery, { suite_id: 'not-a-uuid' })).toContain('suite_id');
    });
  });

  describe('BulkMoveCasesDto', () => {
    it('requires at least one uuid case id and a uuid suite id', async () => {
      expect(await fieldsOf(BulkMoveCasesDto, {})).toEqual(
        expect.arrayContaining(['case_ids', 'suite_id']),
      );
      expect(await fieldsOf(BulkMoveCasesDto, { case_ids: [], suite_id: UUID })).toContain(
        'case_ids',
      );
      expect(
        await fieldsOf(BulkMoveCasesDto, { case_ids: [UUID, 'nope'], suite_id: UUID }),
      ).toContain('case_ids');
    });

    it('caps a bulk move at 200 ids', async () => {
      const tooMany = Array.from({ length: 201 }, (_, index) =>
        `018f2c55-1a2b-7c3d-9e4f-5a6b7c8d9e${String(index).padStart(2, '0')}`,
      );
      expect(await fieldsOf(BulkMoveCasesDto, { case_ids: tooMany, suite_id: UUID })).toContain(
        'case_ids',
      );
    });

    it('accepts a valid bulk move', async () => {
      expect(
        await issuesFor(BulkMoveCasesDto, { case_ids: [UUID, OTHER_UUID], suite_id: UUID }),
      ).toEqual([]);
    });
  });

  describe('ListCaseHistoryQuery', () => {
    it('accepts pagination and rejects bad values', async () => {
      expect(await issuesFor(ListCaseHistoryQuery, {})).toEqual([]);
      expect((await transform(ListCaseHistoryQuery, { page: '3', limit: '10' })).page).toBe(3);
      expect(await fieldsOf(ListCaseHistoryQuery, { limit: '0' })).toContain('limit');
      expect(await fieldsOf(ListCaseHistoryQuery, { limit: '101' })).toContain('limit');
    });
  });
});
