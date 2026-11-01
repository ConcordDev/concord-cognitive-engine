// The login box says "Username or Email" and posts the text as `username`.
// An email typed there used to 401 because only the username lookup ran.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createAuthRouter from "../routes/auth.js";

const USER = { id: "u1", username: "alice", email: "alice@example.com", passwordHash: "hashed:pw", role: "member" };

function makeApp() {
  const app = express();
  app.use(express.json());
  const router = createAuthRouter({
    AuthDB: {
      getUser: () => null,
      getUserByEmail: (e) => (e === USER.email ? USER : null),
      getUserByUsername: (u) => (u === USER.username ? USER : null),
      getUserCount: () => 1,
      createUser: () => {},
      updateUserLogin: () => {},
    },
    AuditDB: { append: () => {} },
    db: null,
    jwt: { decode: () => null },
    authRateLimiter: (_q, _s, next) => next(),
    _TOKEN_BLACKLIST: { revokeAllForUser: () => {}, isRevoked: () => false, revoke: () => {} },
    _REFRESH_FAMILIES: new Map(),
    REFRESH_TOKEN_COOKIE: "concord_refresh",
    NODE_ENV: "test",
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

const login = (body) =>
  fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("login accepts an email in the username field", () => {
  it("username still works", async () => {
    assert.equal((await login({ username: "alice", password: "pw" })).status, 200);
  });
  it("an email sent as `username` logs in", async () => {
    assert.equal((await login({ username: "alice@example.com", password: "pw" })).status, 200);
  });
  it("a differently-cased email logs in", async () => {
    assert.equal((await login({ username: "Alice@Example.com", password: "pw" })).status, 200);
  });
  it("the explicit `email` field still works", async () => {
    assert.equal((await login({ email: "alice@example.com", password: "pw" })).status, 200);
  });
  it("wrong password and unknown email stay a uniform 401", async () => {
    assert.equal((await login({ username: "alice@example.com", password: "bad" })).status, 401);
    const r = await login({ username: "nobody@example.com", password: "pw" });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, "Invalid credentials");
  });
});
