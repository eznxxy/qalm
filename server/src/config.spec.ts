import { ConfigError, loadConfig } from './config';

const VALID_ENV = {
  PORT: '3001',
  DATABASE_URL: 'postgres://qalm:qalm@localhost:5432/qalm',
  JWT_SECRET: 'x'.repeat(32),
  REFRESH_COOKIE_SECURE: '',
};

function envWith(overrides: Partial<Record<string, string>>): NodeJS.ProcessEnv {
  const env: Record<string, string> = { ...VALID_ENV };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

describe('loadConfig', () => {
  it('accepts a fully valid environment', () => {
    const config = loadConfig(envWith({}));
    expect(config).toEqual({
      port: 3001,
      databaseUrl: 'postgres://qalm:qalm@localhost:5432/qalm',
      jwtSecret: 'x'.repeat(32),
      refreshCookieSecure: false,
      corsOrigins: [],
    });
  });

  it('defaults PORT to 3001 (fixed dev port assumed by the web app)', () => {
    const config = loadConfig(envWith({ PORT: undefined }));
    expect(config.port).toBe(3001);
  });

  it('rejects a JWT_SECRET shorter than 32 bytes', () => {
    expect(() => loadConfig(envWith({ JWT_SECRET: 'x'.repeat(31) }))).toThrow(ConfigError);
  });

  it('accepts a 32-byte multibyte JWT_SECRET (bytes, not chars)', () => {
    // 16 two-byte chars = 32 bytes.
    const secret = 'Ω'.repeat(16);
    expect(Buffer.byteLength(secret, 'utf8')).toBe(32);
    expect(() => loadConfig(envWith({ JWT_SECRET: secret }))).not.toThrow();
  });

  it('rejects a missing JWT_SECRET', () => {
    expect(() => loadConfig(envWith({ JWT_SECRET: undefined }))).toThrow(/JWT_SECRET is required/);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadConfig(envWith({ DATABASE_URL: undefined }))).toThrow(
      /DATABASE_URL is required/,
    );
  });

  it('rejects a non-postgres DATABASE_URL scheme', () => {
    expect(() =>
      loadConfig(envWith({ DATABASE_URL: 'mysql://qalm:qalm@localhost:5432/qalm' })),
    ).toThrow(/postgres/);
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => loadConfig(envWith({ DATABASE_URL: 'not-a-url' }))).toThrow(ConfigError);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig(envWith({ PORT: 'http' }))).toThrow(ConfigError);
  });

  it('rejects out-of-range PORT values', () => {
    expect(() => loadConfig(envWith({ PORT: '0' }))).toThrow(ConfigError);
    expect(() => loadConfig(envWith({ PORT: '70000' }))).toThrow(ConfigError);
  });

  it('treats REFRESH_COOKIE_SECURE=true as the dev relax flag', () => {
    const config = loadConfig(envWith({ REFRESH_COOKIE_SECURE: 'true' }));
    expect(config.refreshCookieSecure).toBe(true);
  });

  it('rejects any REFRESH_COOKIE_SECURE value other than exactly "true"', () => {
    expect(() => loadConfig(envWith({ REFRESH_COOKIE_SECURE: 'TRUE' }))).toThrow(ConfigError);
    expect(() => loadConfig(envWith({ REFRESH_COOKIE_SECURE: '1' }))).toThrow(ConfigError);
  });

  it('reports every problem at once instead of failing one by one', () => {
    expect(() => loadConfig(envWith({ JWT_SECRET: undefined, DATABASE_URL: undefined }))).toThrow(
      /DATABASE_URL is required; JWT_SECRET is required/,
    );
  });

  it('defaults CORS_DEV_ORIGINS to an empty allowlist (CORS disabled)', () => {
    expect(loadConfig(envWith({})).corsOrigins).toEqual([]);
  });

  it('parses CORS_DEV_ORIGINS as a comma-separated exact-origin allowlist', () => {
    const config = loadConfig(
      envWith({ CORS_DEV_ORIGINS: 'http://localhost:3000, https://app.example.com' }),
    );
    expect(config.corsOrigins).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('deduplicates and trims CORS_DEV_ORIGINS entries', () => {
    const config = loadConfig(
      envWith({ CORS_DEV_ORIGINS: ' http://localhost:3000 ,http://localhost:3000,' }),
    );
    expect(config.corsOrigins).toEqual(['http://localhost:3000']);
  });

  it('rejects CORS_DEV_ORIGINS entries that are not bare http(s) origins', () => {
    expect(() => loadConfig(envWith({ CORS_DEV_ORIGINS: '*' }))).toThrow(ConfigError);
    expect(() => loadConfig(envWith({ CORS_DEV_ORIGINS: 'not-a-url' }))).toThrow(
      /CORS_DEV_ORIGINS entry "not-a-url" is not a valid URL/,
    );
    expect(() => loadConfig(envWith({ CORS_DEV_ORIGINS: 'ftp://files.example.com' }))).toThrow(
      /must use http:\/\/ or https:\/\//,
    );
    expect(() =>
      loadConfig(envWith({ CORS_DEV_ORIGINS: 'http://localhost:3000/app' })),
    ).toThrow(/must be a bare origin/);
  });
});
