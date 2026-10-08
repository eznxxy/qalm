import {
  CreateProjectDto,
  ListProjectsQuery,
  normalizeProjectKey,
  UpdateProjectDto,
} from './dto';
import { GlobalValidationPipe } from '../pipes/global-validation.pipe';

/**
 * DTO-level validation for the projects contract, docs/api-projects.md
 * § Validation. Cross-cutting rules (uniqueness) live in the store/service;
 * field shapes live here.
 */
const pipe = new GlobalValidationPipe();

async function validateDto(
  dtoClass: new () => object,
  body: unknown,
): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype: dtoClass });
    return [];
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.() as
      | { details?: Array<{ field: string; issue: string }> }
      | undefined;
    return (response?.details ?? []).map((detail) => detail.field);
  }
}

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

describe('projects DTOs', () => {
  describe('key normalization', () => {
    it('uppercases and trims the key before validation', () => {
      expect(normalizeProjectKey('  pay  ')).toBe('PAY');
    });

    it('accepts a lowercase key and stores it uppercase (create)', async () => {
      const instance = (await pipe.transform(
        {
          name: 'Payments',
          key: 'pay',
          description: 'Checkout and billing flows',
        },
        { type: 'body', metatype: CreateProjectDto },
      )) as CreateProjectDto;
      expect(instance.key).toBe('PAY');
    });

    it('accepts a mixed-case key (PATCH) and normalizes it', async () => {
      const instance = (await pipe.transform(
        { key: 'pay2' },
        { type: 'body', metatype: UpdateProjectDto },
      )) as UpdateProjectDto;
      expect(instance.key).toBe('PAY2');
    });

    it('rejects a key starting with a digit even after normalization', async () => {
      const fields = await validateDto(CreateProjectDto, { name: 'X', key: '1abc' });
      expect(fields).toContain('key');
    });

    it('rejects keys with symbols or interior whitespace', async () => {
      expect(await validateDto(CreateProjectDto, { name: 'X', key: 'AB-CD' })).toContain('key');
      expect(await validateDto(CreateProjectDto, { name: 'X', key: 'AB CD' })).toContain('key');
    });

    it('rejects a 1-char key and an 11-char key', async () => {
      expect(await validateDto(CreateProjectDto, { name: 'X', key: 'A' })).toContain('key');
      expect(await validateDto(CreateProjectDto, { name: 'X', key: 'ABCDEFGHIJK' })).toContain(
        'key',
      );
    });

    it('keeps the (normalized) input visible in the issue text', async () => {
      const details = await issuesFor(CreateProjectDto, { name: 'X', key: '9pay' });
      const keyIssue = details.find((d) => d.field === 'key');
      // The DTO normalizes before validating, so the echoed value is the
      // uppercased input — still recognizable, not a bare generic message.
      expect(keyIssue?.issue).toContain('9PAY');
    });
  });

  describe('CreateProjectDto', () => {
    it('accepts the contract payload', async () => {
      const fields = await validateDto(CreateProjectDto, {
        name: 'Payments',
        key: 'PAY',
      });
      expect(fields).toEqual([]);
    });

    it('rejects a missing/blank/too-long name', async () => {
      expect(await validateDto(CreateProjectDto, { key: 'PAY' })).toContain('name');
      expect(await validateDto(CreateProjectDto, { name: '   ', key: 'PAY' })).toContain('name');
      expect(
        await validateDto(CreateProjectDto, { name: 'x'.repeat(101), key: 'PAY' }),
      ).toContain('name');
    });

    it('trims the name before the length check', async () => {
      const instance = (await pipe.transform(
        { name: '  Payments  ', key: 'PAY' },
        { type: 'body', metatype: CreateProjectDto },
      )) as CreateProjectDto;
      expect(instance.name).toBe('Payments');
    });

    it('rejects a description over 500 chars', async () => {
      const fields = await validateDto(CreateProjectDto, {
        name: 'Payments',
        key: 'PAY',
        description: 'd'.repeat(501),
      });
      expect(fields).toContain('description');
    });

    it('accepts a description of exactly 500 chars', async () => {
      const fields = await validateDto(CreateProjectDto, {
        name: 'Payments',
        key: 'PAY',
        description: 'd'.repeat(500),
      });
      expect(fields).toEqual([]);
    });

    it('rejects unknown properties (no mass assignment of status/created_by)', async () => {
      const fields = await validateDto(CreateProjectDto, {
        name: 'Payments',
        key: 'PAY',
        status: 'archived',
      });
      expect(fields).toContain('status');
    });

    it('rejects non-string types (no implicit conversion)', async () => {
      const fields = await validateDto(CreateProjectDto, {
        name: 42,
        key: 'PAY',
      });
      expect(fields).toContain('name');
    });
  });

  describe('UpdateProjectDto', () => {
    it('accepts an empty object at the pipe (the service rejects it as a 400 no-op guard)', async () => {
      const fields = await validateDto(UpdateProjectDto, {});
      expect(fields).toEqual([]);
    });

    it('rejects explicit null name/key with 400 naming the field (NOT NULL columns)', async () => {
      expect(await validateDto(UpdateProjectDto, { name: null })).toContain('name');
      expect(await validateDto(UpdateProjectDto, { key: null })).toContain('key');
      const nameIssues = await issuesFor(UpdateProjectDto, { name: null });
      expect(nameIssues.length).toBeGreaterThan(0);
      expect(nameIssues.every((d) => d.field === 'name')).toBe(true);
      const keyIssues = await issuesFor(UpdateProjectDto, { key: null });
      expect(keyIssues.length).toBeGreaterThan(0);
      expect(keyIssues.every((d) => d.field === 'key')).toBe(true);
    });

    it('accepts explicit null description (PATCH clears the field)', async () => {
      const fields = await validateDto(UpdateProjectDto, { description: null });
      expect(fields).toEqual([]);
    });

    it('accepts any subset of name/key/description', async () => {
      expect(await validateDto(UpdateProjectDto, { name: 'New' })).toEqual([]);
      expect(await validateDto(UpdateProjectDto, { key: 'NEWKEY1' })).toEqual([]);
      expect(
        await validateDto(UpdateProjectDto, { description: 'updated' }),
      ).toEqual([]);
    });

    it('rejects status — PATCH must not change it (whitelist)', async () => {
      const fields = await validateDto(UpdateProjectDto, { status: 'active' });
      expect(fields).toContain('status');
    });

    it('rejects created_by — ownership is not client-settable', async () => {
      const fields = await validateDto(UpdateProjectDto, {
        created_by: '018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e',
      });
      expect(fields).toContain('created_by');
    });
  });

  describe('ListProjectsQuery', () => {
    it('accepts an empty query (defaults)', async () => {
      const instance = (await pipe.transform(
        {},
        { type: 'query', metatype: ListProjectsQuery },
      )) as ListProjectsQuery;
      expect(instance.page).toBeUndefined();
      expect(instance.limit).toBeUndefined();
    });

    it('coerces string page/limit from the querystring to numbers', async () => {
      const instance = (await pipe.transform(
        { page: '2', limit: '10' },
        { type: 'query', metatype: ListProjectsQuery },
      )) as ListProjectsQuery;
      expect(instance.page).toBe(2);
      expect(instance.limit).toBe(10);
    });

    it('rejects page 0, limit 0, and limit 101', async () => {
      expect(await validateDto(ListProjectsQuery, { page: '0' })).toContain('page');
      expect(await validateDto(ListProjectsQuery, { limit: '0' })).toContain('limit');
      expect(await validateDto(ListProjectsQuery, { limit: '101' })).toContain('limit');
    });

    it('accepts limit 100 and page 1', async () => {
      expect(await validateDto(ListProjectsQuery, { page: '1', limit: '100' })).toEqual([]);
    });

    it('rejects a status outside active|archived (case-sensitive)', async () => {
      expect(await validateDto(ListProjectsQuery, { status: 'ACTIVE' })).toContain('status');
      expect(await validateDto(ListProjectsQuery, { status: 'Archived' })).toContain('status');
      expect(await validateDto(ListProjectsQuery, { status: 'deleted' })).toContain('status');
      expect(await validateDto(ListProjectsQuery, { status: 'archived' })).toEqual([]);
    });

    it('accepts a search substring', async () => {
      expect(await validateDto(ListProjectsQuery, { query: 'pay' })).toEqual([]);
    });
  });
});
