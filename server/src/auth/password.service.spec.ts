import { PasswordService, passwordMeetsPolicy, PASSWORD_POLICY_MESSAGE, TIMING_PAD_HASH } from './password.service';

describe('passwordMeetsPolicy', () => {
  it('accepts 8+ chars with letter and digit', () => {
    expect(passwordMeetsPolicy('s3cretpass')).toBe(true);
    expect(passwordMeetsPolicy('a1b2c3d4')).toBe(true);
    expect(passwordMeetsPolicy('temporal1')).toBe(true);
  });

  it('rejects passwords shorter than 8 chars', () => {
    expect(passwordMeetsPolicy('a1b2c3d')).toBe(false);
  });

  it('rejects passwords without a digit', () => {
    expect(passwordMeetsPolicy('abcdefgh')).toBe(false);
  });

  it('rejects passwords without a letter', () => {
    expect(passwordMeetsPolicy('12345678')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(passwordMeetsPolicy(undefined as unknown as string)).toBe(false);
    expect(passwordMeetsPolicy(null as unknown as string)).toBe(false);
  });

  it('documents the message used in validation details', () => {
    expect(PASSWORD_POLICY_MESSAGE).toContain('8 characters');
  });
});

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  it('hashes and verifies at cost >= 12', async () => {
    const hash = await service.hash('s3cretpass');
    expect(hash.startsWith('$2')).toBe(true);
    const cost = Number(hash.split('$')[2]);
    expect(cost).toBeGreaterThanOrEqual(12);
    expect(await service.verify('s3cretpass', hash)).toBe(true);
    expect(await service.verify('wrong-pass1', hash)).toBe(false);
  });

  it('produces a different hash each time (salted)', async () => {
    const a = await service.hash('s3cretpass');
    const b = await service.hash('s3cretpass');
    expect(a).not.toBe(b);
  });

  it('timingDummy does real bcrypt work against the pad hash', async () => {
    expect(TIMING_PAD_HASH.startsWith('$2')).toBe(true);
    const started = Date.now();
    expect(await service.timingDummy()).toBe(false);
    // A real bcrypt compare at cost 12 is nowhere near instant.
    expect(Date.now() - started).toBeGreaterThan(10);
  });
});
