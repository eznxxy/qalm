import 'reflect-metadata';
import { CreateSuiteDto, ReorderSuitesDto, UpdateSuiteDto } from './dto';
import { GlobalValidationPipe } from '../pipes/global-validation.pipe';

/**
 * DTO-level validation for the suites contract, docs/api-suites.md
 * § Validation. Cross-row rules (siblings, depth, ordering) live in the
 * service; field shapes live here.
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

describe('suites DTOs', () => {
  describe('CreateSuiteDto', () => {
    it('requires a name and trims it', async () => {
      expect(await fieldsOf(CreateSuiteDto, {})).toContain('name');
      const instance = (await pipe.transform(
        { name: '  Checkout  ' },
        { type: 'body', metatype: CreateSuiteDto },
      )) as CreateSuiteDto;
      expect(instance.name).toBe('Checkout');
    });

    it('rejects a whitespace-only or over-long name', async () => {
      expect(await fieldsOf(CreateSuiteDto, { name: '   ' })).toContain('name');
      expect(await fieldsOf(CreateSuiteDto, { name: 'x'.repeat(101) })).toContain('name');
    });

    it('caps the description at 500 chars and accepts null', async () => {
      expect(await fieldsOf(CreateSuiteDto, { name: 'X', description: 'x'.repeat(501) })).toContain(
        'description',
      );
      expect(await fieldsOf(CreateSuiteDto, { name: 'X', description: null })).toEqual([]);
    });

    it('accepts an absent or null parent_id and rejects a malformed uuid', async () => {
      expect(await fieldsOf(CreateSuiteDto, { name: 'X' })).toEqual([]);
      expect(await fieldsOf(CreateSuiteDto, { name: 'X', parent_id: null })).toEqual([]);
      expect(await fieldsOf(CreateSuiteDto, { name: 'X', parent_id: 'not-a-uuid' })).toContain(
        'parent_id',
      );
    });

    it('coerces a string position and rejects 0', async () => {
      const instance = (await pipe.transform(
        { name: 'X', position: '2' },
        { type: 'body', metatype: CreateSuiteDto },
      )) as CreateSuiteDto;
      expect(instance.position).toBe(2);
      expect(await fieldsOf(CreateSuiteDto, { name: 'X', position: 0 })).toContain('position');
    });

    it('rejects unknown fields', async () => {
      expect(await fieldsOf(CreateSuiteDto, { name: 'X', depth: 2 })).toContain('depth');
    });
  });

  describe('UpdateSuiteDto', () => {
    it('accepts an empty body (the service turns it into a 400)', async () => {
      expect(await issuesFor(UpdateSuiteDto, {})).toEqual([]);
    });

    it('rejects an explicit null name but accepts null description and parent_id', async () => {
      expect(await fieldsOf(UpdateSuiteDto, { name: null })).toContain('name');
      expect(await fieldsOf(UpdateSuiteDto, { description: null })).toEqual([]);
      expect(await fieldsOf(UpdateSuiteDto, { parent_id: null })).toEqual([]);
    });

    it('trims the name', async () => {
      const instance = (await pipe.transform(
        { name: '  Renamed ' },
        { type: 'body', metatype: UpdateSuiteDto },
      )) as UpdateSuiteDto;
      expect(instance.name).toBe('Renamed');
    });
  });

  describe('ReorderSuitesDto', () => {
    it('requires a non-empty items array', async () => {
      expect(await fieldsOf(ReorderSuitesDto, {})).toContain('items');
      expect(await fieldsOf(ReorderSuitesDto, { items: [] })).toContain('items');
    });

    it('validates each item id, parent_id and position', async () => {
      const issues = await issuesFor(ReorderSuitesDto, {
        items: [
          { id: 'not-a-uuid', parent_id: '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f', position: 0 },
        ],
      });
      const fields = issues.map((detail) => detail.field);
      expect(fields).toContain('items[0].id');
      expect(fields).toContain('items[0].position');
    });

    it('accepts a root item (parent_id null)', async () => {
      expect(
        await issuesFor(ReorderSuitesDto, {
          items: [{ id: '018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f', parent_id: null, position: 1 }],
        }),
      ).toEqual([]);
    });
  });
});
