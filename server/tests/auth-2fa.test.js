// FIX-settings-005 — the 2FA route behaviour suite.
//
// Drives the real auth router over HTTP with a stubbed AuthDB and an
// in-memory stand-in for the two migration-511 tables (the router's
// 2FA paths use a fixed set of prepared statements; the fake answers
// exactly those). Covers: enrolment is not enforcement until confirmed,
// the challenged login issues NO session, a wrong code is refused, the
// right code issues, a TOTP code cannot be replayed, a recovery code
// works exactly once, setup refuses while enabled, and disable needs
// password + a current code.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createAuthRouter from "../routes/auth.js";
import { base32Decode, hotp, totp, hashRecoveryCode } from "../lib/totp.js";

const USER = { id: "u1", username: "alice", email: "alice@example.com", passwordHash: "hashed:pw", role: "member" };

// ── in-memory stand-in for user_totp / user_totp_recovery ────────────
function makeFakeDb() {
  const totpRows = new Map();
  const recovery = [];
  let nextId = 1;
  const norm = (sql) => sql.replace(/\s+/g, " ").trim();
  return {
    _totpRows: totpRows,
    _recovery: recovery,
    prepare(sql) {
      const q = norm(sql);
      return {
        get(...args) {
          if (q.startsWith("SELECT user_id, secret_enc, enabled, last_step, confirmed_at FROM user_totp")) {
            return totpRows.get(args[0]) || undefined;
          }
          if (q.startsWith("SELECT id FROM user_totp_recovery")) {
            const [userId, hash] = args;
            return recovery.find((r) => r.user_id === userId && r.code_hash === hash && r.used_at == null);
          }
          if (q.startsWith("SELECT COUNT(*) AS n FROM user_totp_recovery")) {
            return { n: recovery.filter((r) => r.user_id === args[0] && r.used_at == null).length };
          }
          throw new Error(`fake db: unhandled get: ${q}`);
        },
        run(...args) {
          // Most specific first: "INSERT INTO user_totp_recovery" also
          // starts with "INSERT INTO user_totp".
          if (q.startsWith("INSERT INTO user_totp_recovery")) {
            const [userId, hash, createdAt] = args;
            recovery.push({ id: nextId++, user_id: userId, code_hash: hash, used_at: null, created_at: createdAt });
            return { changes: 1 };
          }
          if (q.startsWith("INSERT INTO user_totp")) {
            const [userId, secretEnc, createdAt] = args;
            totpRows.set(userId, { user_id: userId, secret_enc: secretEnc, enabled: 0, last_step: -1, created_at: createdAt, confirmed_at: null });
            return { changes: 1 };
          }
          if (q.startsWith("UPDATE user_totp SET last_step")) {
            const [step, userId] = args;
            const row = totpRows.get(userId);
            if (row) row.last_step = step;
            return { changes: row ? 1 : 0 };
          }
          if (q.startsWith("UPDATE user_totp SET enabled = 1")) {
            const [confirmedAt, step, userId] = args;
            const row = totpRows.get(userId);
            if (row) { row.enabled = 1; row.confirmed_at = confirmedAt; row.last_step = step; }
            return { changes: row ? 1 : 0 };
          }
          if (q.startsWith("UPDATE user_totp_recovery SET used_at")) {
            const [usedAt, id] = args;
            const rec = recovery.find((r) => r.id === id);
            if (rec) rec.used_at = usedAt;
            return { changes: rec ? 1 : 0 };
          }
          if (q.startsWith("DELETE FROM user_totp_recovery")) {
            for (let i = recovery.length - 1; i >= 0; i--) if (recovery[i].user_id === args[0]) recovery.splice(i, 1);
            return { changes: 1 };
          }
          if (q.startsWith("DELETE FROM user_totp")) {
            totpRows.delete(args[0]);
            return { changes: 1 };
          }
          throw new Error(`fake db: unhandled run: ${q}`);
        },
        all() { throw new Error(`fake db: unhandled all: ${q}`); },
      };
    },
  };
}

const db = makeFakeDb();

function makeApp() {
  const app = express();
  app.use(express.json());
  // Test-only stand-in for the session middleware: an x-test-user
  // header marks the request authenticated as the fixture user.
  app.use((req, _res, next) => {
    if (req.headers["x-test-user"] === USER.id) req.user = { id: USER.id, username: USER.username, email: USER.email, role: USER.role };
    next();
  });
  const router = createAuthRouter({
    AuthDB: {
      getUser: (id) => (id === USER.id ? USER : null),
      getUserByEmail: (e) => (e === USER.email ? USER : null),
      getUserByUsername: (u) => (u === USER.username ? USER : null),
      getUserCount: () => 1,
      createUser: () => {},
      updateUserLogin: () => {},
    },
    AuditDB: { append: () => {} },
    db,
    jwt: { decode: () => null },
    authRateLimiter: (_q, _s, next) => next(),
    _TOKEN_BLACKLIST: { revokeAllForUser: () => {}, isRevoked: () => false, revoke: () => {} },
    _REFRESH_FAMILIES: new Map(),
    REFRESH_TOKEN_COOKIE: "concord_refresh",
    NODE_ENV: "test",
    resolveCookieSecure: () => false,
    validate: () => (_q, _s, next) => next(),
    hashPassword: async (p) => `hashed:${p}`,
    verifyPassword: async (p, h) => h === `hashed:${p}`,
    createToken: () => "tok",
    createRefreshToken: () => "rtok",
    verifyToken: () => null,
    setAuthCookie: () => {},
    setRefreshCookie: () => {},
    clearAuthCookie: () => {},
    auditLog: () => {},
    generateApiKey: () => "k",
    hashApiKey: () => "hk",
    requireRole: () => (_q, _s, next) => next(),
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

let server, base;
before(async () => {
  await new Promise((r) => { server = makeApp().listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

async function call(path, { body, auth = false } = {}) {
  const res = await fetch(`${base}/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(auth ? { "x-test-user": USER.id } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const login = () => call("/login", { body: { username: USER.username, password: "pw" } });
const codeFor = (secret) => totp(base32Decode(secret));
// The NEXT step's code: enrolment confirmation consumes the current
// step, and the replay guard rightly refuses that same code at
// sign-in — the next step is what a real authenticator shows seconds
// later, and it verifies inside the ±1 window.
const nextCodeFor = (secret) => hotp(base32Decode(secret), Math.floor(Date.now() / 1000 / 30) + 1);

describe("FIX-settings-005 — two-factor authentication", () => {
  let secret;
  let recoveryCodes;
  let spentCode;

  it("setup mints a pending secret; a pending enrolment does NOT gate login", async () => {
    const setup = await call("/2fa/setup", { body: {}, auth: true });
    assert.equal(setup.status, 200);
    assert.ok(setup.data.secret);
    assert.ok(setup.data.otpauthUri.startsWith("otpauth://totp/"));
    secret = setup.data.secret;

    const status = await call("/2fa/status", { auth: true });
    assert.equal(status.data.enabled, false);
    assert.equal(status.data.pending, true);

    const res = await login();
    assert.equal(res.status, 200);
    assert.equal(res.data.token, "tok");
    assert.equal(res.data.twoFactorRequired, undefined);
  });

  it("enable refuses a wrong code, then confirms with the right one and issues recovery codes once", async () => {
    const wrong = await call("/2fa/enable", { body: { code: "000000" }, auth: true });
    assert.equal(wrong.status, 401);

    const ok = await call("/2fa/enable", { body: { code: codeFor(secret) }, auth: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.recoveryCodes.length, 10);
    recoveryCodes = ok.data.recoveryCodes;
    // At rest, only the hashes exist.
    assert.equal(db._recovery.length, 10);
    assert.ok(db._recovery.every((r) => r.code_hash === hashRecoveryCode(recoveryCodes[db._recovery.indexOf(r)])));

    const status = await call("/2fa/status", { auth: true });
    assert.equal(status.data.enabled, true);
    assert.equal(status.data.recoveryCodesRemaining, 10);
  });

  it("setup refuses while already enabled", async () => {
    const again = await call("/2fa/setup", { body: {}, auth: true });
    assert.equal(again.status, 409);
  });

  it("login now returns a challenge and NO session; a wrong code is refused", async () => {
    const res = await login();
    assert.equal(res.status, 200);
    assert.equal(res.data.twoFactorRequired, true);
    assert.ok(res.data.challengeId);
    assert.equal(res.data.token, undefined);

    const bad = await call("/login/verify-2fa", { body: { challengeId: res.data.challengeId, code: "000000" } });
    assert.equal(bad.status, 401);
    assert.equal(bad.data.token, undefined);
  });

  it("the right code completes sign-in — and the same code cannot be replayed", async () => {
    const first = await login();
    spentCode = nextCodeFor(secret);
    const ok = await call("/login/verify-2fa", { body: { challengeId: first.data.challengeId, code: spentCode } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.token, "tok");

    const second = await login();
    const replay = await call("/login/verify-2fa", { body: { challengeId: second.data.challengeId, code: spentCode } });
    assert.equal(replay.status, 401);
  });

  it("a recovery code completes sign-in exactly once", async () => {
    const first = await login();
    const ok = await call("/login/verify-2fa", { body: { challengeId: first.data.challengeId, code: recoveryCodes[0] } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.token, "tok");

    const second = await login();
    const reuse = await call("/login/verify-2fa", { body: { challengeId: second.data.challengeId, code: recoveryCodes[0] } });
    assert.equal(reuse.status, 401);

    const status = await call("/2fa/status", { auth: true });
    assert.equal(status.data.recoveryCodesRemaining, 9);
  });

  it("an unknown or expired challenge is refused with the expiry message", async () => {
    const res = await call("/login/verify-2fa", { body: { challengeId: "deadbeef".repeat(8), code: "123456" } });
    assert.equal(res.status, 401);
    assert.match(res.data.error, /expired/);
  });

  it("disable needs password + a current code; after it, login is ungated again", async () => {
    const wrongPw = await call("/2fa/disable", { body: { password: "nope", code: recoveryCodes[1] }, auth: true });
    assert.equal(wrongPw.status, 401);

    // A recovery code is a valid current factor for turning 2FA off.
    const ok = await call("/2fa/disable", { body: { password: "pw", code: recoveryCodes[1] }, auth: true });
    assert.equal(ok.status, 200);
    assert.equal(db._totpRows.size, 0);
    assert.equal(db._recovery.length, 0);

    const res = await login();
    assert.equal(res.data.token, "tok");
    assert.equal(res.data.twoFactorRequired, undefined);
  });

  it("the enrolment endpoints refuse anonymous callers", async () => {
    assert.equal((await call("/2fa/status", {})).status, 401);
    assert.equal((await call("/2fa/setup", { body: {} })).status, 401);
    assert.equal((await call("/2fa/enable", { body: { code: "123456" } })).status, 401);
  });
});
