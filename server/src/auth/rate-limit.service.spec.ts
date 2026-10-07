import { RATE_LIMIT_MAX_FAILURES, RATE_LIMIT_WINDOW_MS, RateLimitService, rateLimitKey } from './rate-limit.service';

describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(() => {
    service = new RateLimitService();
  });

  it('allows up to 9 failures and blocks the 10th attempt within the window', () => {
    const key = rateLimitKey('ada@example.com', '10.0.0.1');
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES - 1; i++) {
      service.registerFailure(key);
      expect(service.check(key).allowed).toBe(true);
    }
    service.registerFailure(key);
    const decision = service.check(key);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(RATE_LIMIT_WINDOW_MS / 1000);
  });

  it('a successful login clears the counter', () => {
    const key = rateLimitKey('grace@example.com', '10.0.0.2');
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES; i++) {
      service.registerFailure(key);
    }
    expect(service.check(key).allowed).toBe(false);
    service.clear(key);
    expect(service.check(key).allowed).toBe(true);
  });

  it('failures outside the window no longer count (fake clock)', () => {
    const key = rateLimitKey('linus@example.com', '10.0.0.3');
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES; i++) {
      service.registerFailure(key, t0);
    }
    expect(service.check(key, t0 + RATE_LIMIT_WINDOW_MS - 1000).allowed).toBe(false);
    expect(service.check(key, t0 + RATE_LIMIT_WINDOW_MS + 1).allowed).toBe(true);
  });

  it('retryAfter reflects the oldest failure leaving the window', () => {
    const key = rateLimitKey('edsger@example.com', '10.0.0.4');
    const t0 = 5_000_000;
    service.registerFailure(key, t0);
    for (let i = 1; i < RATE_LIMIT_MAX_FAILURES; i++) {
      service.registerFailure(key, t0 + i * 1000);
    }
    const at = t0 + RATE_LIMIT_MAX_FAILURES * 1000 - 500;
    const decision = service.check(key, at);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(Math.ceil((t0 + RATE_LIMIT_WINDOW_MS - at) / 1000));
  });

  it('keys are per email+IP pair', () => {
    const a = rateLimitKey('ada@example.com', '10.0.0.1');
    const b = rateLimitKey('ada@example.com', '10.0.0.2');
    const c = rateLimitKey('Ada@Example.COM', '10.0.0.1');
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES; i++) {
      service.registerFailure(a);
    }
    expect(service.check(a).allowed).toBe(false);
    expect(service.check(b).allowed).toBe(true);
    // Case-insensitive on email (contract: no bypass via case).
    expect(service.check(c).allowed).toBe(false);
  });

  it('rateLimitKey lowercases and trims the email', () => {
    expect(rateLimitKey('  Ada@Example.COM ', 'ip')).toBe('ada@example.com|ip');
  });
});
