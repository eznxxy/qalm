'use strict';

/**
 * Dev helper: creates server/.env from scratch (only if it does not exist)
 * with a cryptographically random JWT_SECRET and the local dev DATABASE_URL.
 * The generated secret never appears in shell output or logs.
 *
 * Usage: node scripts/gen-env.js [--force]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envPath) && !process.argv.includes('--force')) {
  process.stdout.write('.env already exists; leaving it untouched.\n');
  process.exit(0);
}

const contents = [
  `JWT_SECRET=${crypto.randomBytes(48).toString('base64')}`,
  'DATABASE_URL=postgres://qalm:qalm@localhost:5432/qalm',
  'PORT=3001',
  'REFRESH_COOKIE_SECURE=',
  '',
].join('\n');

fs.writeFileSync(envPath, contents, { mode: 0o600 });
process.stdout.write(`Wrote ${envPath} (600 permissions, gitignored).\n`);
