import 'reflect-metadata';
import {
  AddRunItemsDto,
  AssignRunItemsDto,
  CreateRunDto,
  ListRunItemsQuery,
  ListRunsQuery,
  UpdateRunDto,
  UpdateRunItemDto,
} from './dto';
import { GlobalValidationPipe } from '../pipes/global-validation.pipe';

/**
 * DTO-level validation for the runs contract, docs/api-runs.md § Validation.
 * Cross-row rules (selection materialisation, capacity, the Tester write guard,
 * reordering) live in RunsService; field shapes and query parsing live here.
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
  name: 'Release 2.4 smoke',
  ...overrides,
});

describe('runs DTOs', () => {
  describe('CreateRunDto', () => {
    it('accepts a name-only payload (an empty run is allowed)', async () => {
      expect(await issuesFor(CreateRunDto, validCreate())).toEqual([]);
    });

    it('requires a name and trims it, rejecting blank and over-long titles', async () => {
      expect(await fieldsOf(CreateRunDto, {})).toContain('name');
      const dto = await transform(CreateRunDto, validCreate({ name: '  Smoke  ' }));
      expect(dto.name).toBe('Smoke');
      expect(await fieldsOf(CreateRunDto, validCreate({ name: '   ' }))).toContain('name');
      expect(await fieldsOf(CreateRunDto, validCreate({ name: 'x'.repeat(121) }))).toContain('name');
    });

    it('accepts an optional description up to 1,000 chars and an explicit null', async () => {
      expect(await issuesFor(CreateRunDto, validCreate({ description: 'Smoke pass.' }))).toEqual([]);
      expect(await issuesFor(CreateRunDto, validCreate({ description: null }))).toEqual([]);
      expect(
        await fieldsOf(CreateRunDto, validCreate({ description: 'x'.repeat(1_001) })),
      ).toContain('description');
    });

    it('accepts a plan_id UUID or null, rejecting anything else', async () => {
      expect(await issuesFor(CreateRunDto, validCreate({ plan_id: UUID }))).toEqual([]);
      expect(await issuesFor(CreateRunDto, validCreate({ plan_id: null }))).toEqual([]);
      expect(await fieldsOf(CreateRunDto, validCreate({ plan_id: 'nope' }))).toContain('plan_id');
    });

    it('accepts a YYYY-MM-DD due_date or null, rejecting other shapes', async () => {
      expect(await issuesFor(CreateRunDto, validCreate({ due_date: '2026-11-14' }))).toEqual([]);
      expect(await issuesFor(CreateRunDto, validCreate({ due_date: null }))).toEqual([]);
      expect(await fieldsOf(CreateRunDto, validCreate({ due_date: '14/11/2026' }))).toContain(
        'due_date',
      );
    });

    it('accepts a YYYY-MM-DD start_date or null, rejecting other shapes', async () => {
      expect(await issuesFor(CreateRunDto, validCreate({ start_date: '2026-11-01' }))).toEqual([]);
      expect(await issuesFor(CreateRunDto, validCreate({ start_date: null }))).toEqual([]);
      expect(await fieldsOf(CreateRunDto, validCreate({ start_date: '2026-11-01T00:00:00Z' })))
        .toContain('start_date');
    });

    it('validates the nested selection and defaults include_descendants', async () => {
      const dto = await transform(CreateRunDto, validCreate({
        selection: { case_ids: [UUID], suite_id: OTHER_UUID },
      }));
      expect(dto.selection).toEqual({ case_ids: [UUID], suite_id: OTHER_UUID });
      expect(await issuesFor(CreateRunDto, validCreate({ selection: {} }))).toEqual([]);
      expect(
        await fieldsOf(CreateRunDto, validCreate({ selection: { case_ids: ['nope'] } })),
      ).toContain('selection.case_ids');
      expect(
        await fieldsOf(CreateRunDto, validCreate({ selection: { suite_id: 'nope' } })),
      ).toContain('selection.suite_id');
    });

    it('parses include_descendants as a boolean and rejects anything else', async () => {
      expect(
        (await transform(CreateRunDto, validCreate({ selection: { include_descendants: 'false' } })))
          .selection?.include_descendants,
      ).toBe(false);
      expect(
        (
          await transform(
            CreateRunDto,
            validCreate({ selection: { include_descendants: true } }),
          )
        ).selection?.include_descendants,
      ).toBe(true);
      expect(
        await fieldsOf(CreateRunDto, validCreate({ selection: { include_descendants: '1' } })),
      ).toContain('selection.include_descendants');
    });

    it('rejects an unknown top-level field', async () => {
      expect(await fieldsOf(CreateRunDto, validCreate({ status: 'completed' }))).toContain('status');
    });
  });

  describe('UpdateRunDto', () => {
    it('accepts an empty body (the service turns it into a 400)', async () => {
      expect(await issuesFor(UpdateRunDto, {})).toEqual([]);
    });

    it('rejects an explicit null name but accepts a trimmed one', async () => {
      expect(await fieldsOf(UpdateRunDto, { name: null })).toContain('name');
      const dto = await transform(UpdateRunDto, { name: '  Final  ' });
      expect(dto.name).toBe('Final');
    });

    it('accepts null for description, plan_id, start_date and due_date (clears/detaches)', async () => {
      expect(await issuesFor(UpdateRunDto, { description: null })).toEqual([]);
      expect(await issuesFor(UpdateRunDto, { plan_id: null })).toEqual([]);
      expect(await issuesFor(UpdateRunDto, { start_date: null })).toEqual([]);
      expect(await issuesFor(UpdateRunDto, { due_date: null })).toEqual([]);
    });

    it('rejects a malformed start_date', async () => {
      expect(await fieldsOf(UpdateRunDto, { start_date: '01-11-2026' })).toContain('start_date');
    });
  });

  describe('ListRunsQuery', () => {
    const query = (value: unknown): Promise<Array<{ field: string; issue: string }>> =>
      issuesFor(ListRunsQuery, value);

    it('accepts an empty query', async () => {
      expect(await query({})).toEqual([]);
    });

    it('accepts plan_id as a UUID or the literal none, rejecting other values', async () => {
      expect(await query({ plan_id: UUID })).toEqual([]);
      expect(await query({ plan_id: 'none' })).toEqual([]);
      expect(await fieldsOf(ListRunsQuery, { plan_id: 'not-a-uuid' })).toContain('plan_id');
    });

    it('only accepts open or completed for status', async () => {
      expect(await query({ status: 'open' })).toEqual([]);
      expect(await query({ status: 'completed' })).toEqual([]);
      expect(await fieldsOf(ListRunsQuery, { status: 'archived' })).toContain('status');
    });

    it('validates the sort whitelist including the descending prefix', async () => {
      for (const sort of ['created_at', 'updated_at', 'due_date', 'name', '-name']) {
        expect(await fieldsOf(ListRunsQuery, { sort })).toEqual([]);
      }
      expect(await fieldsOf(ListRunsQuery, { sort: 'status' })).toContain('sort');
      expect(await fieldsOf(ListRunsQuery, { sort: '--name' })).toContain('sort');
    });

    it('coerces page/limit, caps limit at 100 and rejects unknown params', async () => {
      const dto = await transform(ListRunsQuery, { page: '2', limit: '50' });
      expect(dto.page).toBe(2);
      expect(dto.limit).toBe(50);
      expect(await fieldsOf(ListRunsQuery, { page: '0' })).toContain('page');
      expect(await fieldsOf(ListRunsQuery, { limit: '101' })).toContain('limit');
      expect(await fieldsOf(ListRunsQuery, { plan: UUID })).toContain('plan');
    });
  });

  describe('ListRunItemsQuery', () => {
    it('wraps a single and repeated status into an array, untested included', async () => {
      const single = await transform(ListRunItemsQuery, { status: 'failed' });
      expect(single.status).toEqual(['failed']);
      const repeated = await transform(ListRunItemsQuery, { status: ['untested', 'failed'] });
      expect(repeated.status).toEqual(['untested', 'failed']);
      expect(await fieldsOf(ListRunItemsQuery, { status: 'exploded' })).toContain('status');
    });

    it('accepts assignee_id as a UUID or none, and a suite_id UUID', async () => {
      expect(await issuesFor(ListRunItemsQuery, { assignee_id: UUID })).toEqual([]);
      expect(await issuesFor(ListRunItemsQuery, { assignee_id: 'none' })).toEqual([]);
      expect(await issuesFor(ListRunItemsQuery, { suite_id: UUID })).toEqual([]);
      expect(await fieldsOf(ListRunItemsQuery, { assignee_id: 'nope' })).toContain('assignee_id');
      expect(await fieldsOf(ListRunItemsQuery, { suite_id: 'nope' })).toContain('suite_id');
    });

    it('validates the item sort whitelist', async () => {
      for (const sort of ['position', 'case_display_id', 'status', 'updated_at', '-status']) {
        expect(await fieldsOf(ListRunItemsQuery, { sort })).toEqual([]);
      }
      expect(await fieldsOf(ListRunItemsQuery, { sort: 'name' })).toContain('sort');
    });
  });

  describe('AddRunItemsDto', () => {
    it('requires at least one UUID case id and caps at 200', async () => {
      expect(await fieldsOf(AddRunItemsDto, {})).toContain('case_ids');
      expect(await fieldsOf(AddRunItemsDto, { case_ids: [] })).toContain('case_ids');
      expect(await fieldsOf(AddRunItemsDto, { case_ids: [UUID, 'nope'] })).toContain('case_ids');
      const tooMany = Array.from({ length: 201 }, () => UUID);
      expect(await fieldsOf(AddRunItemsDto, { case_ids: tooMany })).toContain('case_ids');
      expect(await issuesFor(AddRunItemsDto, { case_ids: [UUID, OTHER_UUID] })).toEqual([]);
    });
  });

  describe('UpdateRunItemDto', () => {
    it('accepts an empty body (the service turns it into a 400)', async () => {
      expect(await issuesFor(UpdateRunItemDto, {})).toEqual([]);
    });

    it('accepts a UUID or null assignee and an integer position ≥ 1', async () => {
      expect(await issuesFor(UpdateRunItemDto, { assignee_id: UUID })).toEqual([]);
      expect(await issuesFor(UpdateRunItemDto, { assignee_id: null })).toEqual([]);
      expect(await fieldsOf(UpdateRunItemDto, { assignee_id: 'nope' })).toContain('assignee_id');
      const dto = await transform(UpdateRunItemDto, { position: '3' });
      expect(dto.position).toBe(3);
      expect(await fieldsOf(UpdateRunItemDto, { position: 0 })).toContain('position');
      expect(await fieldsOf(UpdateRunItemDto, { position: 1.5 })).toContain('position');
    });
  });

  describe('AssignRunItemsDto', () => {
    it('accepts a UUID or null assignee and an optional UUID item list', async () => {
      expect(await issuesFor(AssignRunItemsDto, { assignee_id: UUID })).toEqual([]);
      expect(await issuesFor(AssignRunItemsDto, { assignee_id: null })).toEqual([]);
      expect(
        await issuesFor(AssignRunItemsDto, { assignee_id: UUID, item_ids: [OTHER_UUID] }),
      ).toEqual([]);
      expect(await fieldsOf(AssignRunItemsDto, { assignee_id: 'nope' })).toContain('assignee_id');
    });

    it('rejects an empty or malformed item_ids list when one is supplied', async () => {
      expect(await fieldsOf(AssignRunItemsDto, { assignee_id: UUID, item_ids: [] })).toContain(
        'item_ids',
      );
      expect(
        await fieldsOf(AssignRunItemsDto, { assignee_id: UUID, item_ids: ['nope'] }),
      ).toContain('item_ids');
    });
  });
});