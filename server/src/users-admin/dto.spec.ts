import {
  AdminUpdateUserDto,
  CreateUserDto,
  ListUsersQuery,
} from './dto';
import { GlobalValidationPipe } from '../pipes/global-validation.pipe';

/**
 * DTO-level validation for the admin user-management bodies/queries:
 * field shapes, the role whitelist, password policy, pagination bounds and
 * unknown-property rejection (the global pipe whitelists). Cross-field rules
 * (last-admin invariant, must_change_password semantics) live in
 * AdminUsersService and are covered there.
 */
const pipe = new GlobalValidationPipe();

async function validateDto(dtoClass: new () => object, body: unknown): Promise<string[]> {
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

const VALID_CREATE = {
  email: 'grace@example.com',
  name: 'Grace Hopper',
  role: 'tester',
  password: 'temporal1',
};

describe('users-admin DTOs', () => {
  describe('CreateUserDto', () => {
    it('accepts a contract-style payload', async () => {
      expect(await validateDto(CreateUserDto, { ...VALID_CREATE })).toEqual([]);
    });

    it('rejects an invalid email, blank name and unknown role', async () => {
      expect(
        await validateDto(CreateUserDto, { ...VALID_CREATE, email: 'nope' }),
      ).toContain('email');
      expect(
        await validateDto(CreateUserDto, { ...VALID_CREATE, name: '   ' }),
      ).toContain('name');
      expect(
        await validateDto(CreateUserDto, { ...VALID_CREATE, role: 'superuser' }),
      ).toContain('role');
    });

    it('rejects a weak initial password with the policy message', async () => {
      const fields = await validateDto(CreateUserDto, {
        ...VALID_CREATE,
        password: 'short',
      });
      expect(fields).toContain('password');
    });

    it('rejects mass-assignment of must_change_password (Admin cannot set it)', async () => {
      const fields = await validateDto(CreateUserDto, {
        ...VALID_CREATE,
        must_change_password: false,
      });
      expect(fields).toContain('must_change_password');
    });
  });

  describe('AdminUpdateUserDto', () => {
    it('accepts any subset of the four admin-writable fields', async () => {
      expect(await validateDto(AdminUpdateUserDto, {})).toEqual([]);
      expect(
        await validateDto(AdminUpdateUserDto, { name: 'Grace Brewster Hopper' }),
      ).toEqual([]);
      expect(await validateDto(AdminUpdateUserDto, { role: 'lead' })).toEqual([]);
      expect(await validateDto(AdminUpdateUserDto, { is_active: false })).toEqual([]);
      expect(await validateDto(AdminUpdateUserDto, { password: 'resetpw1' })).toEqual([]);
      expect(
        await validateDto(AdminUpdateUserDto, {
          name: 'X',
          role: 'viewer',
          is_active: true,
          password: 'resetpw1',
        }),
      ).toEqual([]);
    });

    it('rejects an unknown role and a weak reset password', async () => {
      expect(await validateDto(AdminUpdateUserDto, { role: 'Admin' })).toContain('role');
      expect(
        await validateDto(AdminUpdateUserDto, { password: 'nodigitshere' }),
      ).toContain('password');
    });

    it('rejects non-boolean is_active and unknown properties', async () => {
      expect(await validateDto(AdminUpdateUserDto, { is_active: 'yes' })).toContain(
        'is_active',
      );
      expect(await validateDto(AdminUpdateUserDto, { email: 'x@y.z' })).toContain('email');
    });

    it('accepts an empty object at the pipe (the service no-ops it as a 200)', async () => {
      const fields = await validateDto(AdminUpdateUserDto, {});
      expect(fields).toEqual([]);
    });

    it('rejects explicit null for all four fields with a 400 naming the field', async () => {
      expect(await validateDto(AdminUpdateUserDto, { name: null })).toContain('name');
      expect(await validateDto(AdminUpdateUserDto, { role: null })).toContain('role');
      expect(await validateDto(AdminUpdateUserDto, { is_active: null })).toContain(
        'is_active',
      );
      expect(await validateDto(AdminUpdateUserDto, { password: null })).toContain(
        'password',
      );
    });
  });

  describe('ListUsersQuery', () => {
    it('accepts an empty query and applies the documented defaults later', async () => {
      expect(await validateDto(ListUsersQuery, {})).toEqual([]);
    });

    it('accepts query/role/page/limit', async () => {
      expect(
        await validateDto(ListUsersQuery, {
          query: 'grace',
          role: 'tester',
          page: '2',
          limit: '10',
        }),
      ).toEqual([]);
    });

    it('rejects unknown roles and out-of-bounds pagination', async () => {
      expect(await validateDto(ListUsersQuery, { role: 'root' })).toContain('role');
      expect(await validateDto(ListUsersQuery, { page: '0' })).toContain('page');
      expect(await validateDto(ListUsersQuery, { limit: '101' })).toContain('limit');
      expect(await validateDto(ListUsersQuery, { limit: 'abc' })).toContain('limit');
    });
  });
});
