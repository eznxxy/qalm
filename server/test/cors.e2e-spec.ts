import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DbService } from '../src/db/db.service';
import { loadTestEnv } from './helpers';

const DEV_ORIGIN = 'http://localhost:3000';
const FOREIGN_ORIGIN = 'http://evil.example.com';

/** Minimal supertest binding (mirrors test/helpers.ts createTestApp). */
interface CorsTestApp {
  req: ReturnType<typeof request>;
  close(): Promise<void>;
}

/**
 * Boots the real AppModule with CORS_DEV_ORIGINS forced to `origins`
 * (undefined = unset) so each case exercises the production wiring
 * (configureApp) under a known allowlist. Restores process.env afterwards.
 */
async function bootWithOrigins(origins: string | undefined): Promise<CorsTestApp> {
  loadTestEnv();
  process.env['PORT'] = process.env['PORT'] ?? '3999';
  const previous = process.env['CORS_DEV_ORIGINS'];
  if (origins === undefined) {
    delete process.env['CORS_DEV_ORIGINS'];
  } else {
    process.env['CORS_DEV_ORIGINS'] = origins;
  }
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    const db = app.get(DbService);
    const tables = await db.query<{ to_regclass: string | null }>(
      "SELECT to_regclass('public.users') AS to_regclass",
    );
    if (tables.rows[0]?.to_regclass === null) {
      await app.close();
      throw new Error('Scratch database has no users table. Apply migrations first.');
    }

    const bound = request(app.getHttpServer() as Parameters<typeof request>[0]);
    return {
      req: bound,
      async close() {
        await app.close();
      },
    };
  } finally {
    if (previous === undefined) {
      delete process.env['CORS_DEV_ORIGINS'];
    } else {
      process.env['CORS_DEV_ORIGINS'] = previous;
    }
  }
}

/** First value of a response header (supertest types headers loosely). */
function headerValue(res: request.Response, name: string): string | undefined {
  const value: unknown = res.headers[name.toLowerCase()];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

function allowOrigin(res: request.Response): string | undefined {
  return headerValue(res, 'access-control-allow-origin');
}

function allowCredentials(res: request.Response): string | undefined {
  return headerValue(res, 'access-control-allow-credentials');
}

/**
 * Integration: dev CORS wiring (CORS_DEV_ORIGINS allowlist + credentials)
 * through the production configureApp path. Uses the public health endpoint
 * so no auth fixtures are needed — CORS headers are orthogonal to auth.
 */
describe('Dev CORS (integration)', () => {
  let test: CorsTestApp | null = null;

  afterEach(async () => {
    if (test) {
      await test.close();
      test = null;
    }
  });

  it('answers preflight with an exact-origin echo + credentials when allowlisted', async () => {
    test = await bootWithOrigins(DEV_ORIGIN);
    const res = await test.req
      .options('/api/v1/health')
      .set('Origin', DEV_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(204);
    expect(allowOrigin(res)).toBe(DEV_ORIGIN);
    expect(allowCredentials(res)).toBe('true');
  });

  it('echoes the allowlisted origin on a real GET (credentials ride along)', async () => {
    test = await bootWithOrigins(DEV_ORIGIN);
    const res = await test.req.get('/api/v1/health').set('Origin', DEV_ORIGIN);

    expect(res.status).toBe(200);
    expect(allowOrigin(res)).toBe(DEV_ORIGIN);
    expect(allowCredentials(res)).toBe('true');
  });

  it('sends no ACAO headers for an origin outside the allowlist', async () => {
    test = await bootWithOrigins(DEV_ORIGIN);
    const preflight = await test.req
      .options('/api/v1/health')
      .set('Origin', FOREIGN_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(allowOrigin(preflight)).toBeUndefined();

    const get = await test.req.get('/api/v1/health').set('Origin', FOREIGN_ORIGIN);
    expect(get.status).toBe(200);
    expect(allowOrigin(get)).toBeUndefined();
  });

  it('sends no ACAO headers at all when CORS_DEV_ORIGINS is unset', async () => {
    test = await bootWithOrigins(undefined);
    const preflight = await test.req
      .options('/api/v1/health')
      .set('Origin', DEV_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(allowOrigin(preflight)).toBeUndefined();

    const get = await test.req.get('/api/v1/health').set('Origin', DEV_ORIGIN);
    expect(get.status).toBe(200);
    expect(allowOrigin(get)).toBeUndefined();
  });

  it('rejects a wildcard allowlist at boot (credentials forbid "*")', async () => {
    await expect(bootWithOrigins('*')).rejects.toThrow(/CORS_DEV_ORIGINS/);
  });
});
