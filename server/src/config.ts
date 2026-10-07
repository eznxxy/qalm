/**
 * Boot-time environment configuration, validated before anything else runs.
 * Fail loudly: a missing/invalid variable kills the process at startup, never
 * at the first request that needs it.
 *
 * Conventions: docs/api-conventions.md § Security requirements, api-auth.md
 * § Implementation notes.
 */
import * as dotenv from 'dotenv';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  /** Refresh cookies are Secure unless this dev-relax flag is exactly "true". */
  refreshCookieSecure: boolean;
}

export class ConfigError extends Error {
  constructor(readonly details: string[]) {
    super(`Invalid environment configuration: ${details.join('; ')}`);
    this.name = 'ConfigError';
  }
}

/** Strict URL check — a malformed DATABASE_URL must not boot the server. */
function validateDatabaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError([
      `DATABASE_URL "${redact(raw)}" is not a valid URL`,
    ]);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new ConfigError([
      `DATABASE_URL must use postgres:// or postgresql:// (got "${parsed.protocol}")`,
    ]);
  }
  return raw;
}

/** Never leak credentials into error output or logs. */
export function redact(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = '***';
    if (url.username) url.username = '***';
    return url.toString();
  } catch {
    return '***';
  }
}

/**
 * Validates raw env values and returns the typed config.
 * Throws ConfigError listing every problem at once (fail-fast at boot).
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const problems: string[] = [];

  const portRaw = env['PORT'] ?? '3001';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be an integer between 1 and 65535 (got "${portRaw}")`);
  }

  const databaseUrl = env['DATABASE_URL'] ?? '';
  let validDbUrl: string | null = null;
  if (!databaseUrl) {
    problems.push('DATABASE_URL is required');
  } else {
    try {
      validDbUrl = validateDatabaseUrl(databaseUrl);
    } catch (error) {
      if (error instanceof ConfigError) problems.push(...error.details);
      else throw error;
    }
  }

  const jwtSecret = env['JWT_SECRET'] ?? '';
  if (!jwtSecret) {
    problems.push('JWT_SECRET is required');
  } else {
    const bytes = Buffer.byteLength(jwtSecret, 'utf8');
    if (bytes < 32) {
      problems.push(`JWT_SECRET must be at least 32 bytes (got ${bytes})`);
    }
  }

  const secureRaw = env['REFRESH_COOKIE_SECURE'] ?? '';
  if (secureRaw !== '' && secureRaw !== 'true') {
    problems.push('REFRESH_COOKIE_SECURE must be empty or exactly "true"');
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  // Guards for the type checker; unreachable when problems is empty.
  if (!validDbUrl) throw new ConfigError(['DATABASE_URL is required']);
  if (!jwtSecret) throw new ConfigError(['JWT_SECRET is required']);

  return {
    port,
    databaseUrl: validDbUrl,
    jwtSecret,
    refreshCookieSecure: secureRaw === 'true',
  };
}

/** Loads .env from the server directory when present, then validates. */
export function loadConfigFromFile(envFile?: string): AppConfig {
  if (envFile === undefined) {
    envFile = `${__dirname}/../.env`;
  }
  const result = dotenv.config({ path: envFile });
  // A missing .env is fine (pure environment deployment); anything else fails.
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw result.error;
  }
  return loadConfig(process.env);
}
