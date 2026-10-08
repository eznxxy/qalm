/**
 * Contract-stub API for local verification of the web app WITHOUT the real
 * NestJS server (card t_450d02f0 DoD: the API ships in t_a630e612 and is not
 * merged yet). Implements docs/api-auth.md + docs/api-conventions.md
 * faithfully: envelopes, snake_case, error shape, refresh-cookie rotation
 * WITH replay revocation (presenting a rotated-out token 401s and revokes
 * ALL of that user's remaining refresh tokens), citext-style email
 * normalization (emails are lowercased/trimmed at write; login and the
 * duplicate-email check compare normalized, like the real DB's CITEXT
 * column), uniform 401, rate limiting, last-admin rule.
 *
 * Self-check for these two behaviors: node scripts/verify-stub-fidelity.mjs
 *
 * It is a TEST DOUBLE, not production code: plaintext in-memory passwords,
 * opaque unsigned tokens. Never point it at real users. Zero dependencies.
 *
 * Usage: node scripts/contract-stub-api.mjs [port]   (default 3101)
 */
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.argv[2] ?? 3101);
const BASE = `/api/v1`;
const ACCESS_TTL_S = 900; // 15 min per contract
const REFRESH_TTL_S = 30 * 24 * 3600;
const PASSWORD_RE = /^.{8,}$/;

/** email -> {id,email,name,role,is_active,must_change_password,created_at,updated_at,password} */
const users = new Map();
/** refresh token -> { userId, expiresAt } */
const refreshTokens = new Map();
/** rotated-out refresh token -> userId (tombstones; replay of one revokes the user's remaining tokens) */
const rotatedOutRefresh = new Map();
/** "email|ip" -> [timestamps] of failed logins */
const loginFails = new Map();

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function passwordValid(pw) {
  return typeof pw === "string" && PASSWORD_RE.test(pw) && /[a-zA-Z]/.test(pw) && /\d/.test(pw);
}

function publicUser(u) {
  const rest = { ...u };
  delete rest.password;
  return rest;
}

/** citext-like: the real users.email column is CITEXT (case-insensitive). */
function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/** Delete every refresh token of the user (replay defense / forced logout). */
function revokeAllUserRefreshTokens(userId) {
  for (const [tok, entry] of refreshTokens) {
    if (entry.userId === userId) refreshTokens.delete(tok);
  }
}

function issueTokens(user) {
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL_S;
  const access = `stub.${user.id}.${user.role}.${exp}`;
  const refresh = crypto.randomBytes(32).toString("hex");
  refreshTokens.set(refresh, { userId: user.id, expiresAt: Date.now() + REFRESH_TTL_S * 1000 });
  return { access, refresh };
}

function refreshCookie(token, maxAge = REFRESH_TTL_S) {
  return `qalm_refresh=${token}; HttpOnly; Path=${BASE}/auth; SameSite=Lax; Max-Age=${maxAge}`;
}

function sessionData(user, tokens) {
  return {
    user: publicUser(user),
    access_token: tokens.access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
  };
}

function send(res, status, body, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:3000",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "Retry-After",
    ...extraHeaders,
  };
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { ...headers, "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sendError(res, status, code, message, details) {
  const body = { error: { code, message } };
  if (details) body.error.details = details;
  send(res, status, body);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function bearerUser(req) {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer stub\.(.+)\.(\w+)\.(\d+)$/.exec(header);
  if (!match) return null;
  const [, userId, , expStr] = match;
  if (Number(expStr) * 1000 < Date.now()) return null;
  const user = users.get(userId);
  if (!user || !user.is_active) return null; // deactivated users rejected immediately
  return user;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readJson(req, res) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    sendError(res, 400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    return null;
  }
}

function rateLimited(email, ip) {
  const key = `${email}|${ip}`;
  const windowStart = Date.now() - 15 * 60 * 1000;
  const fails = (loginFails.get(key) ?? []).filter((t) => t > windowStart);
  loginFails.set(key, fails);
  return fails.length >= 10;
}

function recordFail(email, ip) {
  const key = `${email}|${ip}`;
  const fails = loginFails.get(key) ?? [];
  fails.push(Date.now());
  loginFails.set(key, fails);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;
  const ip = req.socket.remoteAddress ?? "127.0.0.1";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "http://localhost:3000",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return;
  }

  if (!path.startsWith(`${BASE}/`)) {
    return sendError(res, 404, "NOT_FOUND", "Unknown route.");
  }
  const route = path.slice(BASE.length); // e.g. /auth/login, /users/:id

  // ---------- POST /auth/bootstrap ----------
  if (route === "/auth/bootstrap" && method === "POST") {
    const body = await readJson(req, res);
    if (!body) return;
    const { name, email, password } = body;
    if (users.size > 0) {
      return sendError(res, 409, "CONFLICT", "A user already exists; bootstrap is closed.");
    }
    const details = [];
    if (typeof name !== "string" || !name.trim()) details.push({ field: "name", issue: "is required" });
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email ?? ""))
      details.push({ field: "email", issue: "must be a valid email address" });
    if (!passwordValid(password))
      details.push({ field: "password", issue: "must be at least 8 characters with a letter and a digit" });
    if (details.length) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid request body.", details);
    }
    const ts = now();
    const user = {
      id: uuid(),
      email: normalizeEmail(email),
      name: name.trim(),
      role: "admin",
      is_active: true,
      must_change_password: false,
      created_at: ts,
      updated_at: ts,
      password,
    };
    users.set(user.id, user);
    const tokens = issueTokens(user);
    return send(res, 201, { data: sessionData(user, tokens) }, {
      "Set-Cookie": refreshCookie(tokens.refresh),
    });
  }

  // ---------- POST /auth/login ----------
  if (route === "/auth/login" && method === "POST") {
    const body = await readJson(req, res);
    if (!body) return;
    const { email, password } = body;
    if (rateLimited(String(email ?? ""), ip)) {
      return send(res, 429, { error: { code: "RATE_LIMITED", message: "Too many failed attempts." } }, {
        "Retry-After": "60",
      });
    }
    const user = [...users.values()].find((u) => u.email === normalizeEmail(email));
    const ok = user && user.password === password && user.is_active;
    if (!ok) {
      recordFail(String(email ?? ""), ip);
      // byte-identical 401 regardless of which part failed
      return sendError(res, 401, "UNAUTHENTICATED", "Invalid credentials.");
    }
    const tokens = issueTokens(user);
    return send(res, 200, { data: sessionData(user, tokens) }, {
      "Set-Cookie": refreshCookie(tokens.refresh),
    });
  }

  // ---------- POST /auth/refresh ----------
  if (route === "/auth/refresh" && method === "POST") {
    const cookie = parseCookies(req).qalm_refresh;
    if (cookie && rotatedOutRefresh.has(cookie)) {
      // Replay of a rotated-out token → 401 + revoke ALL of the user's
      // remaining refresh tokens (docs/api-auth.md replay defense).
      revokeAllUserRefreshTokens(rotatedOutRefresh.get(cookie));
      return sendError(res, 401, "UNAUTHENTICATED", "Refresh token reused; all sessions revoked.");
    }
    const entry = cookie ? refreshTokens.get(cookie) : undefined;
    if (!entry || entry.expiresAt < Date.now()) {
      return sendError(res, 401, "UNAUTHENTICATED", "Refresh token missing, expired, or reused.");
    }
    const user = users.get(entry.userId);
    if (!user || !user.is_active) {
      refreshTokens.delete(cookie);
      return sendError(res, 401, "UNAUTHENTICATED", "Session no longer valid.");
    }
    rotatedOutRefresh.set(cookie, user.id); // tombstone before rotation
    refreshTokens.delete(cookie); // rotate
    const tokens = issueTokens(user);
    return send(res, 200, {
      data: {
        access_token: tokens.access,
        token_type: "Bearer",
        expires_in: ACCESS_TTL_S,
      },
    }, { "Set-Cookie": refreshCookie(tokens.refresh) });
  }

  // ---------- POST /auth/logout ----------
  if (route === "/auth/logout" && method === "POST") {
    const cookie = parseCookies(req).qalm_refresh;
    if (cookie) refreshTokens.delete(cookie);
    return send(res, 204, undefined, { "Set-Cookie": refreshCookie("", 0) });
  }

  // ---------- GET/PATCH /auth/me ----------
  if (route === "/auth/me") {
    const user = bearerUser(req);
    if (!user) return sendError(res, 401, "UNAUTHENTICATED", "Missing, invalid, or expired token.");
    if (method === "GET") {
      return send(res, 200, { data: publicUser(user) });
    }
    if (method === "PATCH") {
      const body = await readJson(req, res);
      if (!body) return;
      const details = [];
      const wantsPasswordChange = body.current_password !== undefined || body.new_password !== undefined;
      if (wantsPasswordChange) {
        if (typeof body.current_password !== "string" || typeof body.new_password !== "string") {
          details.push({ field: "new_password", issue: "password change requires current_password and new_password" });
        } else if (body.current_password !== user.password) {
          return sendError(res, 400, "VALIDATION_ERROR", "Current password is incorrect.", [
            { field: "current_password", issue: "is incorrect" },
          ]);
        } else if (!passwordValid(body.new_password)) {
          details.push({ field: "new_password", issue: "must be at least 8 characters with a letter and a digit" });
        }
      }
      if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
        details.push({ field: "name", issue: "must be a non-empty string" });
      }
      if (details.length) {
        return sendError(res, 400, "VALIDATION_ERROR", "Invalid request body.", details);
      }
      if (body.name !== undefined) user.name = body.name.trim();
      if (wantsPasswordChange) {
        user.password = body.new_password;
        user.must_change_password = false;
      }
      user.updated_at = now();
      return send(res, 200, { data: publicUser(user) });
    }
  }

  // ---------- /users ----------
  if (route === "/users" && method === "GET") {
    const user = bearerUser(req);
    if (!user) return sendError(res, 401, "UNAUTHENTICATED", "Missing, invalid, or expired token.");
    if (user.role !== "admin") return sendError(res, 403, "FORBIDDEN", "Admin role required.");
    const q = (url.searchParams.get("query") ?? "").toLowerCase();
    const role = url.searchParams.get("role");
    const pageNum = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 25)));
    let list = [...users.values()].sort((a, b) => a.email.localeCompare(b.email));
    if (q) list = list.filter((u) => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));
    if (role) list = list.filter((u) => u.role === role);
    const total = list.length;
    const total_pages = Math.max(1, Math.ceil(total / limit));
    const pageItems = list.slice((pageNum - 1) * limit, pageNum * limit);
    return send(res, 200, {
      data: pageItems.map(publicUser),
      meta: { page: pageNum, limit, total, total_pages },
    });
  }

  if (route === "/users" && method === "POST") {
    const user = bearerUser(req);
    if (!user) return sendError(res, 401, "UNAUTHENTICATED", "Missing, invalid, or expired token.");
    if (user.role !== "admin") return sendError(res, 403, "FORBIDDEN", "Admin role required.");
    const body = await readJson(req, res);
    if (!body) return;
    const { email, name, role, password } = body;
    if ([...users.values()].some((u) => u.email === normalizeEmail(email))) {
      return sendError(res, 409, "CONFLICT", "A user with this email already exists.", [
        { field: "email", issue: "already exists" },
      ]);
    }
    const details = [];
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email))
      details.push({ field: "email", issue: "must be a valid email address" });
    if (typeof name !== "string" || !name.trim()) details.push({ field: "name", issue: "is required" });
    if (!["admin", "lead", "tester", "viewer"].includes(role))
      details.push({ field: "role", issue: "must be one of admin, lead, tester, viewer" });
    if (!passwordValid(password))
      details.push({ field: "password", issue: "must be at least 8 characters with a letter and a digit" });
    if (details.length) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid request body.", details);
    }
    const ts = now();
    const created = {
      id: uuid(),
      email: normalizeEmail(email),
      name: name.trim(),
      role,
      is_active: true,
      must_change_password: true,
      created_at: ts,
      updated_at: ts,
      password,
    };
    users.set(created.id, created);
    return send(res, 201, { data: publicUser(created) });
  }

  // ---------- /users/:id ----------
  const userMatch = /^\/users\/([\w-]+)$/.exec(route);
  if (userMatch) {
    const actor = bearerUser(req);
    if (!actor) return sendError(res, 401, "UNAUTHENTICATED", "Missing, invalid, or expired token.");
    if (actor.role !== "admin") return sendError(res, 403, "FORBIDDEN", "Admin role required.");
    const target = users.get(userMatch[1]);
    if (!target) return sendError(res, 404, "NOT_FOUND", "User not found.");
    if (method === "GET") {
      return send(res, 200, { data: publicUser(target) });
    }
    if (method === "PATCH") {
      const body = await readJson(req, res);
      if (!body) return;
      if (body.role !== undefined && !["admin", "lead", "tester", "viewer"].includes(body.role)) {
        return sendError(res, 400, "VALIDATION_ERROR", "Invalid request body.", [
          { field: "role", issue: "must be one of admin, lead, tester, viewer" },
        ]);
      }
      if (body.password !== undefined && !passwordValid(body.password)) {
        return sendError(res, 400, "VALIDATION_ERROR", "Invalid request body.", [
          { field: "password", issue: "must be at least 8 characters with a letter and a digit" },
        ]);
      }
      const nextRole = body.role ?? target.role;
      const nextActive = body.is_active ?? target.is_active;
      if (
        target.role === "admin" &&
        target.is_active &&
        (nextRole !== "admin" || !nextActive) &&
        ![...users.values()].some(
          (u) => u.id !== target.id && u.role === "admin" && u.is_active
        )
      ) {
        return sendError(res, 409, "CONFLICT", "Cannot remove the last active admin.");
      }
      if (body.name !== undefined) target.name = String(body.name).trim();
      if (body.role !== undefined) target.role = body.role;
      if (body.is_active !== undefined) target.is_active = Boolean(body.is_active);
      if (body.password !== undefined) {
        target.password = body.password;
        target.must_change_password = true;
      }
      target.updated_at = now();
      return send(res, 200, { data: publicUser(target) });
    }
  }

  return sendError(res, 404, "NOT_FOUND", "Unknown route.");
});

server.listen(PORT, () => {
  console.log(`[contract-stub-api] listening on http://localhost:${PORT}${BASE} (stub, in-memory)`);
});
