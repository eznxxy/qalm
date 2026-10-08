import * as jwt from 'jsonwebtoken';
import { AppConfig } from '../config';
import { TokensService, hashRefreshToken, safeEqual, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from './tokens.service';

const CONFIG: AppConfig = {
  port: 0,
  databaseUrl: 'postgres://test@localhost/test',
  jwtSecret: 'unit-test-secret-that-is-definitely-32b',
  refreshCookieSecure: false,
  corsOrigins: [],
};

function makeService(): TokensService {
  return new TokensService(CONFIG);
}

/** Signs a token with arbitrary options, outside TokensService. */
function sign(payload: Record<string, unknown>, options: jwt.SignOptions): string {
  return jwt.sign(payload, CONFIG.jwtSecret, options);
}

describe('TokensService — access tokens', () => {
  it('signs HS256 with sub, role, iss and 15-min expiry', () => {
    const token = makeService().signAccessToken({ id: 'u-123', role: 'admin' });
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0] ?? '', 'base64').toString('utf8')) as Record<string, unknown>;
    expect(header['alg']).toBe('HS256');
    const payload = makeService().verifyAccessToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('u-123');
    expect(payload?.role).toBe('admin');
    expect(payload?.iss).toBe('qalm');
    expect((payload?.exp ?? 0) - (payload?.iat ?? 0)).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });

  it('rejects a token signed with a different secret', () => {
    const other = new TokensService({ ...CONFIG, jwtSecret: 'another-secret-that-is-long-enough!' });
    const token = other.signAccessToken({ id: 'u-1', role: 'viewer' });
    expect(makeService().verifyAccessToken(token)).toBeNull();
  });

  it('rejects garbage and empty strings', () => {
    expect(makeService().verifyAccessToken('not-a-jwt')).toBeNull();
    expect(makeService().verifyAccessToken('')).toBeNull();
  });

  it('rejects a token with a valid signature but wrong issuer', () => {
    const forged = sign({ sub: 'u-1', role: 'admin' }, { algorithm: 'HS256', expiresIn: 900, issuer: 'not-qalm' });
    expect(makeService().verifyAccessToken(forged)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = sign({ sub: 'u-1', role: 'admin' }, { algorithm: 'HS256', expiresIn: -10, issuer: 'qalm' });
    expect(makeService().verifyAccessToken(expired)).toBeNull();
  });

  it('pins HS256: an unsigned token is rejected', () => {
    const unsigned = jwt.sign({ sub: 'u-1', role: 'admin' }, CONFIG.jwtSecret, { algorithm: 'none' });
    expect(makeService().verifyAccessToken(unsigned)).toBeNull();
  });

  it('rejects payloads without string sub/role', () => {
    const weird = sign({ sub: 42, role: 'admin' }, { algorithm: 'HS256', expiresIn: 900, issuer: 'qalm' });
    expect(makeService().verifyAccessToken(weird)).toBeNull();
  });
});

describe('TokensService — refresh tokens', () => {
  it('generates 64 random bytes (128 hex chars) and hashes them with SHA-256', () => {
    const { raw, hash } = makeService().generateRefreshToken();
    expect(raw).toMatch(/^[0-9a-f]{128}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(raw)).toBe(hash);
  });

  it('is random: two generations never collide', () => {
    const a = makeService().generateRefreshToken();
    const b = makeService().generateRefreshToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it('contract constants: cookie name, path, 30-day TTL', () => {
    expect(REFRESH_COOKIE_NAME).toBe('qalm_refresh');
    expect(REFRESH_COOKIE_PATH).toBe('/api/v1/auth');
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});

describe('safeEqual', () => {
  it('matches equal strings and differs on unequal ones', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
