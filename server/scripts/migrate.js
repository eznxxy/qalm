'use strict';

/**
 * Migration runner: thin wrapper around node-pg-migrate with wait-for-db and
 * strict direction handling.
 *
 * Usage:
 *   node scripts/migrate.js up     # apply all pending migrations
 *   node scripts/migrate.js down   # revert the last applied migration
 *
 * DATABASE_URL supplies the connection (see .env.example); PGHOST overrides the
 * host when the runner itself runs inside a container network.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

require('dotenv').config({ path: `${__dirname}/../.env` });

const { spawnSync } = require('child_process');
const path = require('path');

const direction = process.argv[2];
if (direction !== 'up' && direction !== 'down') {
  process.stderr.write('Usage: node scripts/migrate.js <up|down>\n');
  process.exit(2);
}

const waitScript = path.join(__dirname, 'wait-for-db.js');
const wait = spawnSync(process.execPath, [waitScript], { stdio: 'inherit' });
if (wait.status !== 0) {
  process.exit(wait.status === null ? 1 : wait.status);
}

const nodePgMigrateCli = require.resolve('node-pg-migrate/bin/node-pg-migrate');
const args = [
  nodePgMigrateCli,
  direction,
  '--database-url', process.env.DATABASE_URL || '',
  '--migrations-dir', path.join(__dirname, '..', 'migrations'),
  '--schema', 'public',
  '--verbose',
];

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
