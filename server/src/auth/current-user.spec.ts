import { AuthGuard, parseCookies, readRefreshCookie, Roles } from './current-user';
import type { Request } from 'express';

describe('parseCookies', () => {
  it('parses simple cookie headers', () => {
    expect(parseCookies('a=1; b=two')).toEqual({ a: '1', b: 'two' });
  });

  it('returns values containing equals signs intact', () => {
    expect(parseCookies('token=abc==; x=1')).toEqual({ token: 'abc==', x: '1' });
  });

  it('skips malformed segments without throwing', () => {
    expect(parseCookies('nonsense; =novalue; ok=yes')).toEqual({ ok: 'yes' });
    expect(parseCookies('')).toEqual({});
    expect(parseCookies(undefined)).toEqual({});
  });

  it('decodes percent-encoding and survives malformed sequences', () => {
    expect(parseCookies('enc=a%20b')).toEqual({ enc: 'a b' });
    expect(parseCookies('bad=100%')).toEqual({ bad: '100%' });
  });
});

describe('readRefreshCookie', () => {
  it('reads the qalm_refresh cookie', () => {
    const request = { headers: { cookie: 'other=x; qalm_refresh=tok123' } } as unknown as Request;
    expect(readRefreshCookie(request)).toBe('tok123');
  });

  it('returns null when absent', () => {
    const request = { headers: {} } as unknown as Request;
    expect(readRefreshCookie(request)).toBeNull();
  });
});

describe('Roles decorator', () => {
  it('attaches the role list as metadata', () => {
    const decorator = Roles('admin', 'lead');
    class Dummy {}
    decorator(Dummy);
    const metadata = Reflect.getMetadata('qalm_roles', Dummy);
    expect(metadata).toEqual(['admin', 'lead']);
  });
});

describe('AuthGuard (unit)', () => {
  it('is instantiable with its dependencies', () => {
    // Full behavior (401 paths, deactivation, roles) is covered by the
    // integration suite against the real DB; here we pin the wiring.
    const reflector = { getAllAndOverride: () => undefined };
    const tokens = { verifyAccessToken: () => null };
    const db = { query: (): Promise<{ rows: unknown[] }> => Promise.resolve({ rows: [] }) };
    const guard = new AuthGuard(reflector as never, tokens as never, db as never);
    expect(guard).toBeInstanceOf(AuthGuard);
  });
});
