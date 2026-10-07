import { BootstrapDto, LoginDto, UpdateMeDto } from './dto';
import { GlobalValidationPipe } from '../pipes/global-validation.pipe';

/**
 * DTO-level validation: password policy, field shapes, unknown-property
 * rejection (the global pipe whitelists). Cross-field rules (PATCH /auth/me
 * needing both password fields) live in AuthService and are covered there.
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

describe('auth DTOs', () => {
  describe('BootstrapDto / LoginDto password policy', () => {
    it('accepts a contract-style payload', async () => {
      const fields = await validateDto(BootstrapDto, {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 's3cretpass',
      });
      expect(fields).toEqual([]);
    });

    it('rejects weak passwords with the policy message', async () => {
      const fields = await validateDto(BootstrapDto, {
        name: 'Ada',
        email: 'ada@example.com',
        password: 'short1',
      });
      expect(fields).toContain('password');
    });

    it('rejects passwords without digits or without letters', async () => {
      expect(await validateDto(BootstrapDto, { name: 'A', email: 'a@b.co', password: 'nodigitshere' })).toContain('password');
      expect(await validateDto(BootstrapDto, { name: 'A', email: 'a@b.co', password: '12345678' })).toContain('password');
    });

    it('rejects invalid emails and blank names', async () => {
      const fields = await validateDto(BootstrapDto, {
        name: '   ',
        email: 'not-an-email',
        password: 's3cretpass',
      });
      expect(fields).toContain('email');
      expect(fields).toContain('name');
    });

    it('rejects unknown properties (whitelist)', async () => {
      const fields = await validateDto(BootstrapDto, {
        name: 'Ada',
        email: 'ada@example.com',
        password: 's3cretpass',
        role: 'admin',
      });
      expect(fields).toContain('role');
    });

    it('LoginDto only needs email + password', async () => {
      const ok = await validateDto(LoginDto, { email: 'ada@example.com', password: 'whatever' });
      expect(ok).toEqual([]);
    });
  });

  describe('UpdateMeDto', () => {
    it('accepts a name-only change', async () => {
      const fields = await validateDto(UpdateMeDto, { name: 'New Name' });
      expect(fields).toEqual([]);
    });

    it('accepts a full password change payload', async () => {
      const fields = await validateDto(UpdateMeDto, {
        current_password: 's3cretpass',
        new_password: 'n3wsecretpw',
      });
      expect(fields).toEqual([]);
    });

    it('rejects a weak new password', async () => {
      const fields = await validateDto(UpdateMeDto, {
        current_password: 's3cretpass',
        new_password: 'short',
      });
      expect(fields).toContain('new_password');
    });
  });
});
