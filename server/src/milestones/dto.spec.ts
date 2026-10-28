import 'reflect-metadata';
import { GlobalValidationPipe } from '../pipes/global-validation.pipe';
import {
  AttachMilestoneRunsDto,
  CreateMilestoneDto,
  ListMilestonesQuery,
  UpdateMilestoneDto,
} from './dto';

/**
 * DTO-level validation for the milestones contract,
 * docs/api-milestones.md § Validation. Cross-row rules (duplicate name,
 * archived project, run eligibility) live in MilestonesService; field shapes and
 * query parsing live here.
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

describe('milestones DTOs', () => {
  describe('CreateMilestoneDto', () => {
    it('accepts a name-only payload (runs attach later)', async () => {
      expect(await issuesFor(CreateMilestoneDto, { name: 'Release 2.4' })).toEqual([]);
    });

    it('requires a name and trims it, rejecting blank and over-long names', async () => {
      expect(await fieldsOf(CreateMilestoneDto, {})).toContain('name');
      expect(await fieldsOf(CreateMilestoneDto, { name: '   ' })).toContain('name');
      expect(await fieldsOf(CreateMilestoneDto, { name: 'x'.repeat(121) })).toContain('name');
      expect(await issuesFor(CreateMilestoneDto, { name: 'x'.repeat(120) })).toEqual([]);
      const dto = await transform(CreateMilestoneDto, { name: '  Release 2.4  ' });
      expect(dto.name).toBe('Release 2.4');
    });

    it('accepts an optional description up to 1,000 chars and an explicit null', async () => {
      expect(await issuesFor(CreateMilestoneDto, { name: 'M', description: 'Ship it.' })).toEqual(
        [],
      );
      expect(await issuesFor(CreateMilestoneDto, { name: 'M', description: null })).toEqual([]);
      expect(
        await fieldsOf(CreateMilestoneDto, { name: 'M', description: 'x'.repeat(1_001) }),
      ).toContain('description');
    });

    it('accepts a YYYY-MM-DD due_date or null, rejecting other shapes', async () => {
      expect(await issuesFor(CreateMilestoneDto, { name: 'M', due_date: '2026-11-14' })).toEqual(
        [],
      );
      expect(await issuesFor(CreateMilestoneDto, { name: 'M', due_date: null })).toEqual([]);
      expect(await fieldsOf(CreateMilestoneDto, { name: 'M', due_date: '14/11/2026' })).toContain(
        'due_date',
      );
    });

    it('rejects embedded runs: create is fields only', async () => {
      expect(
        await fieldsOf(CreateMilestoneDto, { name: 'M', run_ids: [UUID] }),
      ).toContain('run_ids');
    });
  });

  describe('UpdateMilestoneDto', () => {
    it('accepts an empty body (the service turns it into a 400)', async () => {
      expect(await issuesFor(UpdateMilestoneDto, {})).toEqual([]);
    });

    it('rejects an explicit null name but accepts a trimmed one', async () => {
      expect(await fieldsOf(UpdateMilestoneDto, { name: null })).toContain('name');
      const dto = await transform(UpdateMilestoneDto, { name: '  Final  ' });
      expect(dto.name).toBe('Final');
    });

    it('accepts null for description and due_date (clears them)', async () => {
      expect(await issuesFor(UpdateMilestoneDto, { description: null })).toEqual([]);
      expect(await issuesFor(UpdateMilestoneDto, { due_date: null })).toEqual([]);
    });

    it('rejects a malformed due_date', async () => {
      expect(await fieldsOf(UpdateMilestoneDto, { due_date: '2026-11-14T00:00:00Z' })).toContain(
        'due_date',
      );
    });
  });

  describe('ListMilestonesQuery', () => {
    const query = (value: unknown): Promise<Array<{ field: string; issue: string }>> =>
      issuesFor(ListMilestonesQuery, value);

    it('accepts an empty query', async () => {
      expect(await query({})).toEqual([]);
    });

    it('validates the status filter', async () => {
      expect(await query({ status: 'open' })).toEqual([]);
      expect(await query({ status: 'completed' })).toEqual([]);
      expect(await fieldsOf(ListMilestonesQuery, { status: 'closed' })).toContain('status');
    });

    it('validates the sort whitelist including the descending prefix', async () => {
      for (const sort of ['due_date', 'created_at', 'updated_at', 'name', '-name', '-due_date']) {
        expect(await issuesFor(ListMilestonesQuery, { sort })).toEqual([]);
      }
      expect(await fieldsOf(ListMilestonesQuery, { sort: 'status' })).toContain('sort');
      expect(await fieldsOf(ListMilestonesQuery, { sort: '--name' })).toContain('sort');
    });

    it('parses string paging and enforces the shared bounds', async () => {
      const dto = await transform(ListMilestonesQuery, { page: '2', limit: '50' });
      expect(dto.page).toBe(2);
      expect(dto.limit).toBe(50);
      expect(await fieldsOf(ListMilestonesQuery, { page: 0 })).toContain('page');
      expect(await fieldsOf(ListMilestonesQuery, { limit: 101 })).toContain('limit');
    });

    it('trims the name substring and bounds it to 1–200 chars', async () => {
      const dto = await transform(ListMilestonesQuery, { query: '  release  ' });
      expect(dto.query).toBe('release');
      expect(await fieldsOf(ListMilestonesQuery, { query: '   ' })).toContain('query');
      expect(await fieldsOf(ListMilestonesQuery, { query: 'x'.repeat(201) })).toContain('query');
    });
  });

  describe('AttachMilestoneRunsDto', () => {
    it('accepts 1–50 UUIDs', async () => {
      expect(await issuesFor(AttachMilestoneRunsDto, { run_ids: [UUID] })).toEqual([]);
      const many = Array.from(
        { length: 50 },
        (_, index) => `018f2c55-1a2b-7c3d-9e4f-5a6b7c8d9e${String(index).padStart(2, '0')}`,
      );
      expect(await issuesFor(AttachMilestoneRunsDto, { run_ids: many })).toEqual([]);
    });

    it('rejects a missing, empty, non-array or over-long list on run_ids', async () => {
      expect(await fieldsOf(AttachMilestoneRunsDto, {})).toContain('run_ids');
      expect(await fieldsOf(AttachMilestoneRunsDto, { run_ids: [] })).toContain('run_ids');
      expect(await fieldsOf(AttachMilestoneRunsDto, { run_ids: UUID })).toContain('run_ids');
      const many = Array.from({ length: 51 }, () => UUID);
      expect(await fieldsOf(AttachMilestoneRunsDto, { run_ids: many })).toContain('run_ids');
    });

    it('rejects a non-UUID id but leaves duplicates to the service (indexed 400)', async () => {
      expect(await fieldsOf(AttachMilestoneRunsDto, { run_ids: [UUID, 'nope'] })).toContain(
        'run_ids',
      );
      expect(await issuesFor(AttachMilestoneRunsDto, { run_ids: [UUID, OTHER_UUID] })).toEqual([]);
    });
  });
});