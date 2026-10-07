#!/usr/bin/env node
'use strict';

/**
 * Writes server/.env.test — throwaway credentials for the integration test
 * scratch database (DATABASE_URL points at a database created just for this
 * run; see README "Integration tests"). Secrets are generated locally and
 * never printed to stdout, never committed (.env.* is gitignored).
 *
 * Env:
 *   QALM_TEST_DATABASE_URL  full postgres:// URL of the scratch DB (required)
 *   QALM_TEST_FILE          output path (default: <server>/.env.test)
 *
 * Usage: node scripts/gen-env-test.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const target = process.env.QALM_TEST_FILE || path.join(__dirname, '..', '.env.test');
const databaseUrl = process.env.QALM_TEST_DATABASE_URL;

if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
  process.stderr.write(
    'QALM_TEST_DATABASE_URL must be set to the scratch postgres:// URL\n' +
      '(the DB itself is created by the operator/test runner, not by this script).\n',
  );
  process.exit(2);
}

const jwtSecret = crypto.randomBytes(48).toString('base64');
const contents = [
  `JWT_SECRET=${jwtSecret}`,
  `DATABASE_URL=${databaseUrl}`,
  // supertest binds lazily and never listens on this port; it must simply be
  // a VALID config value (the boot validator requires 1..65535).
  'PORT=3999',
  // Integration tests run over plain HTTP on loopback; relax Secure like dev.
  'REFRESH_COOKIE_SECURE=true',
  '',
].join('\n');

fs.writeFileSync(target, contents, { mode: 0o600 });
process.stdout.write(`wrote ${path.basename(target)}\n`);
