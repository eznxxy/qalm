'use strict';

/**
 * Waits until PostgreSQL accepts TCP connections, then exits 0.
 *
 * Used ahead of node-pg-migrate in the npm migration scripts so
 * `docker compose up` followed immediately by `npm run migration:run` is
 * race-free. Target host/port come from DATABASE_URL; PGHOST overrides the
 * host (used when the server itself runs inside a container).
 *
 * Exit codes: 0 = database accepting connections, 1 = timed out.
 */

const net = require('net');

const TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 500;

function readTarget() {
  const raw = process.env.DATABASE_URL || 'postgres://qalm:qalm@localhost:5432/qalm';
  const url = new URL(raw);
  return {
    host: process.env.PGHOST || url.hostname || 'localhost',
    port: Number(url.port || 5432),
    redacted: `${url.protocol}//***@${url.hostname}:${url.port || 5432}`,
  };
}

function probe(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners('error');
      socket.removeAllListeners('connect');
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function main() {
  const target = readTarget();
  const deadline = Date.now() + TIMEOUT_MS;
  process.stdout.write(`Waiting for postgres at ${target.redacted} ...\n`);
  while (Date.now() < deadline) {
    if (await probe(target.host, target.port)) {
      process.stdout.write('Postgres is accepting connections.\n');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  process.stderr.write(
    `Timed out after ${TIMEOUT_MS / 1000}s waiting for postgres at ${target.host}:${target.port}.\n` +
      'Start it with: docker compose up -d\n',
  );
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`wait-for-db failed: ${error && error.message}\n`);
  process.exit(1);
});
