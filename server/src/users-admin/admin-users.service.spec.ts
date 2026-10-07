import { Test } from '@nestjs/testing';
import { DbService } from '../db/db.service';
import { PasswordService } from '../auth/password.service';
import { RefreshTokenStore } from '../auth/refresh-token.store';
import { AdminUserRow, UsersStore } from './users.store';
import { AdminUsersService } from './admin-users.service';
import { CreateUserDto } from './dto';

/**
 * Decision-logic tests for AdminUsersService + UsersStore over an in-memory
 * fake of the users table. SQL semantics (lower() email uniqueness, ILIKE
 * substring on email/name, ORDER BY email, LIMIT/OFFSET, the last-admin
 * count predicate) are mirrored here; the real SQL path is covered
 * end-to-end by the integration suite (test/users.e2e-spec.ts).
 * PasswordService is stubbed (fast, deterministic); RefreshTokenStore is a
 * spy so the tests can assert exactly when sessions are revoked.
 */
interface FakeUser extends AdminUserRow {
  emailLower: string;
  passwordHash: string;
}

function makeRow(params: {
  id: string;
  email: string;
  name?: string;
  role: AdminUserRow['role'];
  isActive?: boolean;
  mustChangePassword?: boolean;
}): FakeUser {
  const now = new Date('2026-10-08T00:00:00.000Z');
  return {
    id: params.id,
    email: params.email,
    name: params.name ?? 'Fixture User',
    role: params.role,
    is_active: params.isActive ?? true,
    must_change_password: params.mustChangePassword ?? false,
    created_at: now,
    updated_at: now,
    emailLower: params.email.toLowerCase(),
    passwordHash: 'hash:' + params.email,
  };
}

const ADMIN_ID = 'u-admin';

function adminUserRow(overrides: Partial<FakeUser> = {}): FakeUser {
  return { ...makeRow({ id: ADMIN_ID, email: 'admin@example.com', role: 'admin' }), ...overrides };
}

describe('AdminUsersService + UsersStore (unit, in-memory users table)', () => {
  let service: AdminUsersService;
  let table: FakeUser[];
  let nextId: number;
  let revokedActive: string[];
  const hashedPasswords: string[] = [];

  const unescapeLike = (pattern: string): string =>
    pattern.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1');

  /** Applies the WHERE clauses of a listing/count query to the fake table. */
  const filtered = (text: string, values: unknown[]): FakeUser[] => {
    const t = text.replace(/\s+/g, ' ');
    let rows = [...table];
    for (const match of t.matchAll(/\(email ILIKE \$(\d+) OR name ILIKE \$(\d+)\)/g)) {
      const needle = unescapeLike(String(values[Number(match[1]) - 1])).toLowerCase();
      rows = rows.filter(
        (row) =>
          row.emailLower.includes(needle) || row.name.toLowerCase().includes(needle),
      );
    }
    for (const match of t.matchAll(/role = \$(\d+)/g)) {
      const value = values[Number(match[1]) - 1];
      rows = rows.filter((row) => row.role === value);
    }
    for (const match of t.matchAll(/is_active = \$(\d+)/g)) {
      const value = values[Number(match[1]) - 1];
      rows = rows.filter((row) => row.is_active === value);
    }
    return rows;
  };

  /** The store selects only the API columns; password_hash never leaves it. */
  const toApiRow = (row: FakeUser): AdminUserRow => {
    const rest: Record<string, unknown> = { ...row };
    delete rest['passwordHash'];
    return rest as unknown as AdminUserRow;
  };

  const respond = (text: string, values: unknown[]): { rows: unknown[] } => {
    const t = text.replace(/\s+/g, ' ').trim();

    if (t.startsWith('INSERT INTO users')) {
      const [email, , role, passwordHash, mustChangePassword] = values as [
        string,
        string,
        AdminUserRow['role'],
        string,
        boolean,
      ];
      const emailLower = String(email).toLowerCase();
      if (table.some((row) => row.emailLower === emailLower)) {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "users_email_key"'),
          { code: '23505' },
        );
      }
      const created = makeRow({
        id: `u-${nextId++}`,
        email: emailLower,
        name: String(values[1]),
        role,
        mustChangePassword: Boolean(mustChangePassword),
      });
      created.passwordHash = passwordHash;
      table.push(created);
      return { rows: [created] };
    }

    if (t.includes('FROM users WHERE id = $1') && !t.includes('<>')) {
      return { rows: table.filter((row) => row.id === values[0]) };
    }
    if (t.includes('SELECT id FROM users WHERE lower(email) = lower($1)')) {
      const target = String(values[0]).toLowerCase();
      return { rows: table.filter((row) => row.emailLower === target).map(({ id }) => ({ id })) };
    }
    if (t.includes("WHERE role = 'admin' AND is_active = true AND id <> $1::uuid")) {
      const exclude = values[0];
      return {
        rows: table.filter(
          (row) => row.role === 'admin' && row.is_active && row.id !== exclude,
        ).map(() => ({ count: '1' })).slice(0, 1),
      };
    }
    if (t.startsWith('SELECT count(*) AS count FROM users')) {
      const count = filtered(t, values).length;
      return { rows: [{ count: String(count) }] };
    }
    if (t.includes('ORDER BY email ASC')) {
      const limit = Number(values[values.length - 2]);
      const offset = Number(values[values.length - 1]);
      const page = filtered(t, values)
        .sort((a, b) => (a.emailLower < b.emailLower ? -1 : a.emailLower > b.emailLower ? 1 : 0))
        .slice(offset, offset + limit)
        .map(toApiRow);
      return { rows: page };
    }
    if (t.startsWith('UPDATE users SET')) {
      const row = table.find((item) => item.id === values[0]);
      if (!row) return { rows: [] };
      for (const match of t.matchAll(/(\w+) = \$(\d+)/g)) {
        const column = match[1];
        const value = values[Number(match[2]) - 1];
        if (column === 'name') row.name = String(value);
        else if (column === 'role') row.role = value as AdminUserRow['role'];
        else if (column === 'is_active') row.is_active = Boolean(value);
        else if (column === 'password_hash') row.passwordHash = String(value);
        else if (column === 'must_change_password') row.must_change_password = Boolean(value);
      }
      row.updated_at = new Date('2026-10-08T00:00:01.000Z');
      return { rows: [toApiRow(row)] };
    }

    throw new Error(`Fake DbService: unhandled SQL: ${text}`);
  };

  beforeEach(async () => {
    table = [adminUserRow()];
    nextId = 1;
    revokedActive = [];
    hashedPasswords.length = 0;

    const db = {
      query: (text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> =>
        Promise.resolve(respond(text, values)),
    } as unknown as DbService;
    const passwords = {
      hash: (plain: string): Promise<string> => {
        const hash = `bcrypt(${plain})`;
        hashedPasswords.push(hash);
        return Promise.resolve(hash);
      },
      verify: (): Promise<boolean> => Promise.resolve(true),
    };
    const refreshTokens = {
      revokeActiveForUser: (userId: string): Promise<void> => {
        revokedActive.push(userId);
        return Promise.resolve();
      },
    } as unknown as RefreshTokenStore;

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: db },
        { provide: PasswordService, useValue: passwords },
        { provide: RefreshTokenStore, useValue: refreshTokens },
        UsersStore,
        AdminUsersService,
      ],
    }).compile();
    service = moduleRef.get(AdminUsersService);
  });

  const createDto = (overrides: Partial<CreateUserDto> = {}): CreateUserDto => ({
    email: 'grace@example.com',
    name: 'Grace Hopper',
    role: 'tester',
    password: 'temporal1',
    ...overrides,
  });

  describe('create', () => {
    it('creates the user with must_change_password=true and a hashed password', async () => {
      const created = await service.create(createDto());
      expect(created).toMatchObject({
        email: 'grace@example.com',
        name: 'Grace Hopper',
        role: 'tester',
        is_active: true,
        must_change_password: true,
      });
      expect(created).not.toHaveProperty('password_hash');
      expect(created.created_at).toBe('2026-10-08T00:00:00.000Z');
      expect(hashedPasswords).toEqual(['bcrypt(temporal1)']);
    });

    it('stores the email lowercase', async () => {
      const created = await service.create(
        createDto({ email: 'Grace@Example.COM' }),
      );
      expect(created.email).toBe('grace@example.com');
    });

    it('409 naming email on a case-insensitive duplicate', async () => {
      await service.create(createDto({ email: 'grace@example.com' }));
      await expect(
        service.create(createDto({ email: 'GRACE@example.com', role: 'viewer' })),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'email', issue: 'already in use' }],
      });
    });

    it('the store maps a racing unique violation to the same 409', async () => {
      await expect(
        service.create(createDto({ email: 'ADMIN@example.com' })),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'email', issue: 'already in use' }],
      });
    });
  });

  describe('findOne', () => {
    it('returns the user without password material', async () => {
      const created = await service.create(createDto());
      const found = await service.findOne(created.id);
      expect(found.email).toBe('grace@example.com');
      expect(found).not.toHaveProperty('password_hash');
    });

    it('404 for an unknown id', async () => {
      await expect(service.findOne('u-missing')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('update', () => {
    it('changes name and/or role and bumps updated_at', async () => {
      const target = await service.create(createDto());
      const updated = await service.update(target.id, {
        name: 'Grace Brewster Hopper',
        role: 'lead',
      });
      expect(updated).toMatchObject({
        name: 'Grace Brewster Hopper',
        role: 'lead',
      });
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(
        new Date(updated.created_at).getTime(),
      );
    });

    it('deactivates a user', async () => {
      const target = await service.create(createDto());
      const updated = await service.update(target.id, { is_active: false });
      expect(updated.is_active).toBe(false);
    });

    it('empty PATCH is a 200 no-op that revokes nothing', async () => {
      const target = await service.create(createDto());
      const updated = await service.update(target.id, {});
      expect(updated.email).toBe('grace@example.com');
      expect(revokedActive).toEqual([]);
    });

    it('password reset hashes, sets must_change_password=true and revokes active refresh tokens', async () => {
      const target = await service.create(createDto());
      const updated = await service.update(target.id, { password: 'resetpw1' });
      expect(updated.must_change_password).toBe(true);
      expect(hashedPasswords).toContain('bcrypt(resetpw1)');
      expect(revokedActive).toEqual([target.id]);
    });

    it('a mixed PATCH that does not touch the password revokes nothing', async () => {
      const target = await service.create(createDto());
      await service.update(target.id, { name: 'Grace B. Hopper', role: 'viewer' });
      expect(revokedActive).toEqual([]);
    });

    it('404 for an unknown id', async () => {
      await expect(
        service.update('u-missing', { name: 'Nobody' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    describe('last-active-Admin invariant (409)', () => {
      it('blocks demoting the only active admin', async () => {
        await expect(
          service.update(ADMIN_ID, { role: 'lead' }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
      });

      it('blocks deactivating the only active admin', async () => {
        await expect(
          service.update(ADMIN_ID, { is_active: false }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
      });

      it('allows demotion once a second active admin exists', async () => {
        table.push(adminUserRow({
          id: 'u-admin2',
          email: 'admin2@example.com',
          role: 'admin',
        }));
        const updated = await service.update(ADMIN_ID, { role: 'lead' });
        expect(updated.role).toBe('lead');
      });

      it('a deactivated admin no longer counts for the invariant', async () => {
        table.push(adminUserRow({
          id: 'u-admin2',
          email: 'admin2@example.com',
          role: 'admin',
          is_active: false,
        }));
        await expect(
          service.update(ADMIN_ID, { is_active: false }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
      });

      it('re-activating or promoting someone never trips the rule', async () => {
        const target = await service.create(createDto({ role: 'lead' }));
        const promoted = await service.update(target.id, { role: 'admin' });
        expect(promoted.role).toBe('admin');
        const viewer = await service.create(createDto({ email: 'vie@example.com', role: 'viewer' }));
        table.find((row) => row.id === viewer.id)!.is_active = false;
        const reactivated = await service.update(viewer.id, { is_active: true });
        expect(reactivated.is_active).toBe(true);
      });

      it('demote+deactivate in one call on the last admin is blocked', async () => {
        await expect(
          service.update(ADMIN_ID, { role: 'tester', is_active: false }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
      });

      it('changing only the admin name or password is never blocked', async () => {
        const renamed = await service.update(ADMIN_ID, { name: 'Ada K. Lovelace' });
        expect(renamed.name).toBe('Ada K. Lovelace');
        const reset = await service.update(ADMIN_ID, { password: 'resetpw9' });
        expect(reset.must_change_password).toBe(true);
      });
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await service.create(createDto({ email: 'grace@example.com', name: 'Grace Hopper' }));
      await service.create(
        createDto({ email: 'ada@example.com', name: 'Ada Lovelace', role: 'lead' }),
      );
      await service.create(
        createDto({ email: 'linus@example.com', name: 'Linus T', role: 'viewer' }),
      );
      const deactivated = await service.create(
        createDto({ email: 'zed@example.com', name: 'Zed Zed', role: 'tester' }),
      );
      table.find((row) => row.id === deactivated.id)!.is_active = false;
    });

    it('lists everyone sorted by email ascending with pagination meta', async () => {
      const page1 = await service.list({ page: 1, limit: 2 });
      expect(page1.data.map((user) => user.email)).toEqual([
        'ada@example.com',
        'admin@example.com',
      ]);
      expect(page1.meta).toEqual({ page: 1, limit: 2, total: 5, total_pages: 3 });

      const page3 = await service.list({ page: 3, limit: 2 });
      expect(page3.data.map((user) => user.email)).toEqual(['zed@example.com']);
    });

    it('substring search matches email OR name, case-insensitively', async () => {
      const byEmail = await service.list({ query: 'ADA' });
      expect(byEmail.data.map((user) => user.email)).toEqual(['ada@example.com']);

      const byName = await service.list({ query: 'lovelace' });
      expect(byName.data.map((user) => user.email)).toEqual(['ada@example.com']);
    });

    it('LIKE wildcards in the search term are literal', async () => {
      await service.create(createDto({ email: 'a_b@example.com', name: 'Underscore' }));
      const result = await service.list({ query: 'a_b' });
      expect(result.data.map((user) => user.email)).toEqual(['a_b@example.com']);
      expect(result.meta.total).toBe(1);
    });

    it('filters by role', async () => {
      const leads = await service.list({ role: 'lead' });
      expect(leads.data.map((user) => user.email)).toEqual(['ada@example.com']);
      expect(leads.meta.total).toBe(1);
    });

    it('combines search and role filter; meta counts the filtered view', async () => {
      const combined = await service.list({ query: 'example.com', role: 'tester' });
      expect(combined.data.map((user) => user.email).sort()).toEqual([
        'grace@example.com',
        'zed@example.com',
      ]);
      expect(combined.meta.total).toBe(2);

      const none = await service.list({ query: 'nobody', role: 'admin' });
      expect(none.data).toEqual([]);
      expect(none.meta).toEqual({ page: 1, limit: 25, total: 0, total_pages: 1 });
    });

    it('defaults to page 1 / limit 25', async () => {
      const result = await service.list({});
      expect(result.data).toHaveLength(5);
      expect(result.meta).toEqual({ page: 1, limit: 25, total: 5, total_pages: 1 });
    });
  });
});
