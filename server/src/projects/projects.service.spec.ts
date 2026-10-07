import { Test } from '@nestjs/testing';
import { AuthUser, UserRole } from '../auth/current-user';
import { DbService } from '../db/db.service';
import { ListProjectsQuery } from './dto';
import { ProjectsService } from './projects.service';
import { ProjectRow, ProjectsStore } from './projects.store';

/**
 * Decision-logic tests for ProjectsService + ProjectsStore over an in-memory
 * fake of the projects table. SQL semantics (lower() uniqueness via the
 * migration-2 indexes, ILIKE substring, ORDER BY name, LIMIT/OFFSET) are
 * mirrored here; the real SQL path is covered end-to-end by the integration
 * suite (test/projects.e2e-spec.ts).
 */
interface FakeProject extends ProjectRow {
  nameLower: string;
  keyLower: string;
}

function makeRow(params: {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  status?: 'active' | 'archived';
  createdBy: string;
}): FakeProject {
  const now = new Date('2026-10-08T00:00:00.000Z');
  const name = params.name;
  const key = params.key;
  return {
    id: params.id,
    key,
    name,
    description: params.description ?? null,
    status: params.status ?? 'active',
    created_by: params.createdBy,
    created_at: now,
    updated_at: now,
    nameLower: name.toLowerCase(),
    keyLower: key.toLowerCase(),
  };
}

const USERS: Record<UserRole, AuthUser> = {
  admin: {
    id: 'u-admin',
    email: 'admin@example.com',
    name: 'Admin',
    role: 'admin',
    isActive: true,
    mustChangePassword: false,
  },
  lead: {
    id: 'u-lead',
    email: 'lead@example.com',
    name: 'Lead',
    role: 'lead',
    isActive: true,
    mustChangePassword: false,
  },
  tester: {
    id: 'u-tester',
    email: 'tester@example.com',
    name: 'Tester',
    role: 'tester',
    isActive: true,
    mustChangePassword: false,
  },
  viewer: {
    id: 'u-viewer',
    email: 'viewer@example.com',
    name: 'Viewer',
    role: 'viewer',
    isActive: true,
    mustChangePassword: false,
  },
};

describe('ProjectsService + ProjectsStore (unit, in-memory projects table)', () => {
  let service: ProjectsService;
  let store: ProjectsStore;
  let table: FakeProject[];
  let nextId: number;

  const unescapeLike = (pattern: string): string =>
    pattern.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1');

  /** Applies the WHERE clauses of a listing/count query to the fake table. */
  const filtered = (text: string, values: unknown[]): FakeProject[] => {
    const t = text.replace(/\s+/g, ' ');
    let rows = [...table];
    for (const match of t.matchAll(/status = \$(\d+)/g)) {
      const value = values[Number(match[1]) - 1];
      rows = rows.filter((row) => row.status === value);
    }
    for (const match of t.matchAll(/name ILIKE \$(\d+)/g)) {
      const needle = unescapeLike(String(values[Number(match[1]) - 1])).toLowerCase();
      rows = rows.filter((row) => row.nameLower.includes(needle));
    }
    return rows;
  };

  const uniqueError = (field: 'name' | 'key', value: string): Error => {
    const constraint = `projects_${field}_lower_unique`;
    return Object.assign(
      new Error(`duplicate key value violates unique constraint "${constraint}"`),
      {
        code: '23505',
        constraint,
        detail: `Key (lower(${field}))=(${value}) already exists.`,
      },
    );
  };

  const respond = (text: string, values: unknown[]): { rows: unknown[] } => {
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('INSERT INTO projects')) {
      const [key, name, description, createdBy] = values as [
        string,
        string,
        string | null,
        string,
      ];
      if (table.some((row) => row.nameLower === name.toLowerCase())) {
        throw uniqueError('name', name);
      }
      if (table.some((row) => row.keyLower === key.toLowerCase())) {
        throw uniqueError('key', key);
      }
      const created = makeRow({
        id: `p-${nextId++}`,
        key,
        name,
        description,
        createdBy,
      });
      table.push(created);
      return { rows: [created] };
    }

    if (t.includes('FROM projects WHERE id = $1')) {
      return { rows: table.filter((row) => row.id === values[0]) };
    }
    if (t.includes('SELECT id FROM projects WHERE lower(name) = lower($1)')) {
      const target = String(values[0]).toLowerCase();
      return { rows: table.filter((row) => row.nameLower === target).map(({ id }) => ({ id })) };
    }
    if (t.includes('SELECT id FROM projects WHERE lower(key) = lower($1)')) {
      const target = String(values[0]).toLowerCase();
      return { rows: table.filter((row) => row.keyLower === target).map(({ id }) => ({ id })) };
    }
    if (t.includes('SELECT count(*) AS count FROM projects')) {
      return { rows: [{ count: String(filtered(t, values).length) }] };
    }
    if (t.includes('ORDER BY name ASC')) {
      const limit = Number(values[values.length - 2]);
      const offset = Number(values[values.length - 1]);
      const page = filtered(t, values)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(offset, offset + limit);
      return { rows: page };
    }
    if (t.startsWith('UPDATE projects SET')) {
      const row = table.find((item) => item.id === values[0]);
      if (!row) return { rows: [] };
      // archive/restore write a literal status (not a bind param).
      if (t.includes("status = 'archived'")) row.status = 'archived';
      if (t.includes("status = 'active'")) row.status = 'active';
      for (const match of t.matchAll(/(\w+) = \$(\d+)/g)) {
        const column = match[1];
        const value = values[Number(match[2]) - 1];
        if (column === 'name') {
          const next = String(value);
          if (table.some((o) => o.id !== row.id && o.nameLower === next.toLowerCase())) {
            throw uniqueError('name', next);
          }
          row.name = next;
          row.nameLower = next.toLowerCase();
        } else if (column === 'key') {
          const next = String(value);
          if (table.some((o) => o.id !== row.id && o.keyLower === next.toLowerCase())) {
            throw uniqueError('key', next);
          }
          row.key = next;
          row.keyLower = next.toLowerCase();
        } else if (column === 'description') {
          row.description = typeof value === 'string' ? value : value === null ? null : '';
        } else if (column === 'status') {
          row.status = value === 'archived' ? 'archived' : 'active';
        }
      }
      row.updated_at = new Date();
      return { rows: [row] };
    }

    throw new Error(`Fake DbService: unhandled SQL: ${text}`);
  };

  beforeEach(async () => {
    table = [];
    nextId = 1;
    const db = {
      query: (text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> =>
        Promise.resolve(respond(text, values)),
    } as unknown as DbService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: db },
        ProjectsStore,
        ProjectsService,
      ],
    }).compile();
    service = moduleRef.get(ProjectsService);
    store = moduleRef.get(ProjectsStore);
  });

  describe('create', () => {
    it('stores created_by = caller and defaults status to active', async () => {
      const created = await service.create(USERS.lead, { name: 'Payments', key: 'PAY' });
      expect(created).toMatchObject({
        name: 'Payments',
        key: 'PAY',
        status: 'active',
        created_by: 'u-lead',
      });
      expect(typeof created.id).toBe('string');
      expect(created.created_at).toBe('2026-10-08T00:00:00.000Z');
    });

    it('409 naming name on a case-insensitive duplicate', async () => {
      await service.create(USERS.admin, { name: 'Payments', key: 'PAY' });
      await expect(
        service.create(USERS.lead, { name: 'payments', key: 'XYZ' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'name', issue: 'already in use' }],
      });
    });

    it('409 naming key on a case-insensitive duplicate', async () => {
      await service.create(USERS.admin, { name: 'Payments', key: 'PAY' });
      await expect(
        service.create(USERS.lead, { name: 'Billing', key: 'pay' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'key', issue: 'already in use' }],
      });
    });

    it('store maps a raw unique violation on the race path (index name read)', async () => {
      // Bypass the service pre-check to exercise the DB-error translation.
      await store.insert({ key: 'PAY', name: 'Payments', description: null, created_by: 'u-admin' });
      await expect(
        store.insert({ key: 'OTH', name: 'PAYMENTS', description: null, created_by: 'u-admin' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'name' }],
      });
      await expect(
        store.insert({ key: 'pay', name: 'Billing', description: null, created_by: 'u-admin' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'key' }],
      });
    });
  });

  describe('findVisible (archived invisibility)', () => {
    it('returns an active project to every role', async () => {
      const created = await service.create(USERS.admin, { name: 'Payments', key: 'PAY' });
      for (const role of ['admin', 'lead', 'tester', 'viewer'] as UserRole[]) {
        await expect(service.findVisible(created.id, USERS[role])).resolves.toMatchObject({
          id: created.id,
        });
      }
    });

    it('returns 404 for an unknown id', async () => {
      await expect(
        service.findVisible('00000000-0000-0000-0000-000000000000', USERS.admin),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('returns an archived project to Admin but 404 to Lead/Tester/Viewer', async () => {
      const created = await service.create(USERS.admin, { name: 'Payments', key: 'PAY' });
      await service.archive(created.id);
      await expect(service.findVisible(created.id, USERS.admin)).resolves.toMatchObject({
        status: 'archived',
      });
      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        await expect(service.findVisible(created.id, USERS[role])).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      }
    });
  });

  describe('update', () => {
    it('edits name/key/description and never touches status', async () => {
      const created = await service.create(USERS.admin, { name: 'Payments', key: 'PAY' });
      await service.archive(created.id);
      const updated = await service.update(created.id, {
        name: 'Payments v2',
        key: 'PAY2',
        description: 'updated',
      });
      expect(updated).toMatchObject({
        name: 'Payments v2',
        key: 'PAY2',
        description: 'updated',
        status: 'archived',
      });
    });

    it('409 naming name on a rename clash with another project', async () => {
      await service.create(USERS.admin, { name: 'Payments', key: 'PAY' });
      const billing = await service.create(USERS.admin, { name: 'Billing', key: 'BILL' });
      await expect(
        service.update(billing.id, { name: 'PAYMENTS' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', details: [{ field: 'name' }] });
    });

    it('409 naming key on a rekey clash with another project', async () => {
      await service.create(USERS.admin, { name: 'Payments', key: 'PAY' });
      const billing = await service.create(USERS.admin, { name: 'Billing', key: 'BILL' });
      await expect(
        service.update(billing.id, { key: 'pay' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', details: [{ field: 'key' }] });
    });

    it('a no-op rename to its own name/key is fine', async () => {
      const created = await service.create(USERS.admin, { name: 'Payments', key: 'PAY' });
      await expect(
        service.update(created.id, { name: 'PAYMENTS', key: 'pay' }),
      ).resolves.toMatchObject({ id: created.id, name: 'PAYMENTS', key: 'pay' });
    });

    it('404 for an unknown id', async () => {
      await expect(
        service.update('00000000-0000-0000-0000-000000000000', { name: 'X' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('archive / restore idempotency', () => {
    it('archive is idempotent (archived → archived → 200 shape)', async () => {
      const created = await service.create(USERS.admin, { name: 'Payments', key: 'PAY' });
      await expect(service.archive(created.id)).resolves.toMatchObject({ status: 'archived' });
      await expect(service.archive(created.id)).resolves.toMatchObject({ status: 'archived' });
    });

    it('restore is idempotent (active → active → 200 shape)', async () => {
      const created = await service.create(USERS.admin, { name: 'Payments', key: 'PAY' });
      await service.archive(created.id);
      await expect(service.restore(created.id)).resolves.toMatchObject({ status: 'active' });
      await expect(service.restore(created.id)).resolves.toMatchObject({ status: 'active' });
    });

    it('404 for an unknown id on both', async () => {
      const missing = '00000000-0000-0000-0000-000000000000';
      await expect(service.archive(missing)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(service.restore(missing)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('list (role visibility + filters)', () => {
    const q = (overrides: Partial<ListProjectsQuery>): ListProjectsQuery => overrides;

    beforeEach(async () => {
      await service.create(USERS.admin, { name: 'Alpha', key: 'ALPHA' });
      const beta = await service.create(USERS.admin, { name: 'Beta', key: 'BETA' });
      await service.create(USERS.admin, { name: 'Gamma', key: 'GAMMA' });
      await service.archive(beta.id);
    });

    it('403 for every non-admin role requesting status=archived (lead included)', async () => {
      for (const role of ['lead', 'tester', 'viewer'] as UserRole[]) {
        await expect(
          service.list(USERS[role], q({ status: 'archived' })),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
    });

    it('default listing excludes archived for everyone (admin sees active only)', async () => {
      const admin = await service.list(USERS.admin, q({}));
      const viewer = await service.list(USERS.viewer, q({}));
      expect(admin.data.map((p) => p.name)).toEqual(['Alpha', 'Gamma']);
      expect(viewer.data.map((p) => p.name)).toEqual(['Alpha', 'Gamma']);
      expect(admin.meta.total).toBe(2);
    });

    it('admin with status=archived sees only archived rows (total matches)', async () => {
      const res = await service.list(USERS.admin, q({ status: 'archived' }));
      expect(res.data.map((p) => p.name)).toEqual(['Beta']);
      expect(res.meta).toEqual({ page: 1, limit: 25, total: 1, total_pages: 1 });
    });

    it('non-admin active listing still excludes archived rows', async () => {
      const res = await service.list(USERS.lead, q({ status: 'active' }));
      expect(res.data.map((p) => p.name)).toEqual(['Alpha', 'Gamma']);
    });

    it('query is a case-insensitive substring on name', async () => {
      const res = await service.list(USERS.viewer, q({ query: 'amm' }));
      expect(res.data.map((p) => p.name)).toEqual(['Gamma']);
    });

    it('sorts by name ascending and paginates with meta', async () => {
      const page1 = await service.list(USERS.admin, q({ page: 1, limit: 1 }));
      expect(page1.data.map((p) => p.name)).toEqual(['Alpha']);
      expect(page1.meta).toEqual({ page: 1, limit: 1, total: 2, total_pages: 2 });
      const page2 = await service.list(USERS.admin, q({ page: 2, limit: 1 }));
      expect(page2.data.map((p) => p.name)).toEqual(['Gamma']);
      expect(page2.meta).toMatchObject({ page: 2, limit: 1, total_pages: 2 });
    });

    it('treats LIKE wildcards in the query as literals', async () => {
      await service.create(USERS.admin, { name: '100% Done', key: 'HUNDRED' });
      const literal = await service.list(USERS.admin, q({ query: '0% D' }));
      expect(literal.data.map((p) => p.name)).toEqual(['100% Done']);
      const wildcard = await service.list(USERS.admin, q({ query: '%' }));
      expect(wildcard.data.map((p) => p.name)).toEqual(['100% Done']);
    });
  });
});
