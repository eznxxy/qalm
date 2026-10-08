#!/usr/bin/env node
/**
 * t_243fd900 contract-stub fidelity self-check (runnable vs a live stub):
 *   1. Replay revocation — present a rotated-out refresh token: the replay is
 *      401 AND every other refresh token of that user is revoked (next
 *      refresh with a previously-live token must 401).
 *   2. Email normalization (CITEXT parity) — POST /users with a case-variant
 *      of an existing email must 409 CONFLICT; login is case-insensitive;
 *      stored email is lowercased.
 *
 * Usage: node scripts/verify-stub-fidelity.mjs [port]   (default 3101)
 * Expects the stub running: node scripts/contract-stub-api.mjs [port]
 * Exits 0 iff every assertion holds. No dependencies.
 */
import http from "node:http";

const PORT = Number(process.argv[2] ?? 3101);
const BASE = `http://localhost:${PORT}/api/v1`;

function req(method, path, { body, cookie, auth } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { "Content-Type": "application/json" };
    if (cookie) headers.Cookie = `qalm_refresh=${cookie}`;
    if (auth) headers.Authorization = `Bearer ${auth}`;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request(`${BASE}${path}`, { method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({
        status: res.statusCode,
        json: (() => { try { return JSON.parse(data); } catch { return null; } })(),
        setCookie: res.headers["set-cookie"]?.[0] ?? null,
      }));
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let failed = 0;
function ok(cond, name, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failed++;
}
const refreshFrom = (r) => r.setCookie?.match(/qalm_refresh=([^;]*)/)?.[1] ?? null;

// ---- setup: bootstrap admin, login user with two live refresh tokens ----
const boot = await req("POST", "/auth/bootstrap", {
  body: { name: "Ada", email: "Ada@Example.COM", password: "s3cretpass" },
});
if (boot.status !== 201) {
  console.error(`setup: bootstrap expected 201, got ${boot.status} — is the stub fresh? ${boot.json?.error?.message ?? ""}`);
  process.exit(2);
}
ok(boot.json.data.user.email === "ada@example.com", "bootstrap normalizes stored email", `stored=${boot.json.data.user.email}`);
const bootRefresh = refreshFrom(boot);

const grace = await req("POST", "/users", {
  body: { email: "grace@example.com", name: "Grace", role: "tester", password: "temporal1" },
  auth: boot.json.data.access_token,
});
if (grace.status !== 201) {
  console.error(`setup: create grace expected 201, got ${grace.status} ${grace.body}`);
  process.exit(2);
}

const login1 = await req("POST", "/auth/login", { body: { email: "Grace@Example.com", password: "temporal1" } });
ok(login1.status === 200, "login is case-insensitive (mixed-case email)", `status=${login1.status}`);
const T1 = refreshFrom(login1);
const rot1 = await req("POST", "/auth/refresh", { cookie: T1 });
ok(rot1.status === 200, "refresh T1 rotates to T2", `status=${rot1.status}`);
const T2 = refreshFrom(rot1);
const login2 = await req("POST", "/auth/login", { body: { email: "grace@example.com", password: "temporal1" } });
const T3 = refreshFrom(login2);
ok(T3 !== null && T3 !== T2, "second login issues distinct token T3", `T3=${T3 === null ? "none" : "ok"}`);

// ---- behavior 1: replay of rotated-out token revokes the user's tokens ----
const replay = await req("POST", "/auth/refresh", { cookie: T1 });
ok(replay.status === 401, "replay of rotated-out token 401s", `status=${replay.status}`);

const otherAfterReplay = await req("POST", "/auth/refresh", { cookie: T3 });
ok(otherAfterReplay.status === 401, "replay revokes user's OTHER refresh token (contract)", `status=${otherAfterReplay.status}`);

const adaAfterReplay = await req("POST", "/auth/refresh", { cookie: bootRefresh });
ok(adaAfterReplay.status === 200, "other USERS unaffected (ada token still refreshes)", `status=${adaAfterReplay.status}`);

// ---- behavior 2: CITEXT-parity duplicate check + normalized login ----
const dup = await req("POST", "/users", {
  body: { email: "GRACE@example.com", name: "Grace Dup", role: "viewer", password: "temporal2" },
  auth: adaAfterReplay.json.data.access_token,
});
ok(dup.status === 409, "case-variant duplicate email 409 CONFLICT", `status=${dup.status}`);
const loginAda = await req("POST", "/auth/login", { body: { email: "  ADA@example.com  ", password: "s3cretpass" } });
ok(loginAda.status === 200, "login trims + lowercases email", `status=${loginAda.status}`);
const me = await req("GET", "/auth/me", { auth: loginAda.json.data.access_token });
ok(me.json?.data?.email === "ada@example.com", "stored email stays normalized", `email=${me.json?.data?.email}`);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll fidelity checks passed.");
process.exit(failed ? 1 : 0);
