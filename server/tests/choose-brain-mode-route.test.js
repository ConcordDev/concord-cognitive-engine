// server/tests/choose-brain-mode-route.test.js
//
// Task #28 of the Private Mode / High Power Mode plan: POST
// /api/auth/choose-brain-mode, modeled directly on the existing
// choose-universe handler. Hermetic — mounts the REAL createAuthRouter
// on a throwaway express app with a real in-memory better-sqlite3 db
// (not a full server.js boot), same pattern as
// tests/auth-password-reset.test.js.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import Database from "better-sqlite3";
import createAuthRouter from "../routes/auth.js";
import { up as upMig397 } from "../migrations/397_brain_mode.js";

let server;
let baseUrl;
let db;
let currentUserId = "u1";

function makeApp() {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT,
    email TEXT,
    role TEXT,
    declared_regional TEXT,
    declared_national TEXT,
    primary_lens TEXT,
    location_declared_at TEXT
  )`);
  upMig397(db);
  db.prepare(`INSERT INTO users (id, username, email, role) VALUES (?, ?, ?, ?)`)
    .run("u1", "testuser", "test@example.com", "user");

  const app = express();
  app.use(express.json());
  // Fake auth middleware — sets req.user directly, same effect as the
  // real JWT middleware upstream in server.js, without pulling that in.
  app.use((req, _res, next) => {
    req.user = currentUserId ? { id: currentUserId, username: "testuser", email: "test@example.com", role: "user", scopes: [] } : null;
    next();
  });

  const router = createAuthRouter({
    AuthDB: { getUser: () => null, getUserByEmail: () => null, getUserByUsername: () => null, getUserCount: () => 0, createUser: () => {} },
    AuditDB: { append: () => {} },
    db,
    jwt: {},
    authRateLimiter: (_req, _res, next) => next(),
    _TOKEN_BLACKLIST: { revokeAllForUser: () => {}, isRevoked: () => false },
    _REFRESH_FAMILIES: new Map(),
    REFRESH_TOKEN_COOKIE: "concord_refresh",
    NODE_ENV: "test",
    validate: () => (_req, _res, next) => next(),
    hashPassword: (p) => `hashed:${p}`,
    verifyPassword: (p, h) => h === `hashed:${p}`,
    createToken: () => "tok",
    createRefreshToken: () => "rtok",
    verifyToken: () => null,
    setAuthCookie: () => {},
    setRefreshCookie: () => {},
    clearAuthCookie: () => {},
    auditLog: () => {},
    generateApiKey: () => "k",
    hashApiKey: () => "hk",
    requireRole: () => (_req, _res, next) => next(),
    generateCsrfToken: () => "csrf",
    uid: (p) => `${p}_x`,
    structuredLog: () => {},
    saveAuthData: () => {},
    invalidateViewerLocation: () => {},
    setLockerKey: () => {},
    clearLockerKey: () => {},
  });
  app.use("/api/auth", router);
  return app;
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let chunks = "";
      res.on("data", (c) => { chunks += c; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks); } catch { /* non-JSON error page */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let chunks = "";
      res.on("data", (c) => { chunks += c; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks); } catch { /* non-JSON error page */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    }).on("error", reject);
  });
}

before(async () => {
  const app = makeApp();
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
});

describe("POST /api/auth/choose-brain-mode", () => {
  it("rejects an unauthenticated request", async () => {
    currentUserId = null;
    const r = await post("/api/auth/choose-brain-mode", { brainMode: "high_power" });
    assert.equal(r.status, 401);
    currentUserId = "u1";
  });

  it("rejects an invalid brainMode value", async () => {
    const r = await post("/api/auth/choose-brain-mode", { brainMode: "turbo" });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid_brain_mode");
    assert.deepEqual(r.body.allowed, ["private", "high_power"]);
  });

  it("rejects a missing brainMode", async () => {
    const r = await post("/api/auth/choose-brain-mode", {});
    assert.equal(r.status, 400);
  });

  it("sets brain_mode to high_power and stamps brain_mode_set_at", async () => {
    const r = await post("/api/auth/choose-brain-mode", { brainMode: "high_power" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.brainMode, "high_power");
    assert.ok(Number.isFinite(r.body.brainModeSetAt));

    const row = db.prepare("SELECT brain_mode, brain_mode_set_at FROM users WHERE id = ?").get("u1");
    assert.equal(row.brain_mode, "high_power");
    assert.ok(row.brain_mode_set_at);
  });

  it("can be switched back to private", async () => {
    const r = await post("/api/auth/choose-brain-mode", { brainMode: "private" });
    assert.equal(r.status, 200);
    assert.equal(r.body.brainMode, "private");
    const row = db.prepare("SELECT brain_mode FROM users WHERE id = ?").get("u1");
    assert.equal(row.brain_mode, "private");
  });
});

describe("GET /api/auth/me — brainMode + needsBrainModeChoice surfacing", () => {
  before(() => {
    // The previous describe block already exercised choose-brain-mode
    // against this same shared in-memory db/user — reset to the
    // never-chosen state so this block's first assertion is meaningful.
    db.prepare("UPDATE users SET brain_mode = 'private', brain_mode_set_at = NULL WHERE id = ?").run("u1");
  });

  it("a never-chosen account reports brainMode: 'private' and needsBrainModeChoice: true", async () => {
    const r = await get("/api/auth/me");
    assert.equal(r.status, 200);
    assert.equal(r.body.user.brainMode, "private");
    assert.equal(r.body.user.needsBrainModeChoice, true);
  });

  it("after an explicit choice, needsBrainModeChoice flips to false", async () => {
    await post("/api/auth/choose-brain-mode", { brainMode: "high_power" });
    const r = await get("/api/auth/me");
    assert.equal(r.body.user.brainMode, "high_power");
    assert.equal(r.body.user.needsBrainModeChoice, false);
  });

  it("surfaces highPowerAllowed: true when CONCORD_HIGH_POWER_ALLOWLIST is unset", async () => {
    delete process.env.CONCORD_HIGH_POWER_ALLOWLIST;
    const r = await get("/api/auth/me");
    assert.equal(r.body.user.highPowerAllowed, true);
  });
});

describe("choose-brain-mode — CONCORD_HIGH_POWER_ALLOWLIST rollout gate", () => {
  const ORIGINAL_ALLOWLIST = process.env.CONCORD_HIGH_POWER_ALLOWLIST;
  before(() => {
    // A prior describe block in this same file already left user 'u1' at
    // brain_mode='high_power' — reset to a known 'private' baseline so
    // this block's own write/no-write assertions are meaningful.
    db.prepare("UPDATE users SET brain_mode = 'private', brain_mode_set_at = NULL WHERE id = ?").run("u1");
  });
  after(() => {
    if (ORIGINAL_ALLOWLIST === undefined) delete process.env.CONCORD_HIGH_POWER_ALLOWLIST;
    else process.env.CONCORD_HIGH_POWER_ALLOWLIST = ORIGINAL_ALLOWLIST;
  });

  it("rejects 'high_power' with 403 when the allowlist is a hard lockout (empty string)", async () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "";
    const r = await post("/api/auth/choose-brain-mode", { brainMode: "high_power" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "high_power_not_available");
    // Must not have been written — re-fetch and confirm unchanged.
    const row = db.prepare("SELECT brain_mode FROM users WHERE id = ?").get("u1");
    assert.notEqual(row.brain_mode, "high_power");
  });

  it("'private' is NEVER gated — always succeeds even under a hard lockout", async () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "";
    const r = await post("/api/auth/choose-brain-mode", { brainMode: "private" });
    assert.equal(r.status, 200);
    assert.equal(r.body.brainMode, "private");
  });

  it("rejects 'high_power' with 403 when the caller's id is not on a restrictive list", async () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "someone_else,another_user";
    const r = await post("/api/auth/choose-brain-mode", { brainMode: "high_power" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "high_power_not_available");
  });

  it("succeeds when the caller's id IS on the allowlist", async () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "u1,someone_else";
    const r = await post("/api/auth/choose-brain-mode", { brainMode: "high_power" });
    assert.equal(r.status, 200);
    assert.equal(r.body.brainMode, "high_power");
  });

  it("succeeds when the allowlist is '*' (explicit open)", async () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "*";
    const r = await post("/api/auth/choose-brain-mode", { brainMode: "high_power" });
    assert.equal(r.status, 200);
    assert.equal(r.body.brainMode, "high_power");
  });

  it("GET /api/auth/me's highPowerAllowed reflects a restrictive allowlist honestly", async () => {
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "someone_else";
    const r = await get("/api/auth/me");
    assert.equal(r.body.user.highPowerAllowed, false);
  });
});
