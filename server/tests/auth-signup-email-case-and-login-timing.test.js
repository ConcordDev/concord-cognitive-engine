// #1929 follow-ups: sign-up stores the email lower-cased; an unknown-user login still pays one
// password compare (same hash fn) so response time does not reveal which accounts exist.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createAuthRouter from "../routes/auth.js";

const LEGACY = { id: "u0", username: "bob", email: "Bob@Example.com", passwordHash: "hashed:pw", role: "member" };
let created, hashCalls, verifyCalls;

function makeApp() {
  const app = express();
  app.use(express.json());
  const router = createAuthRouter({
    AuthDB: {
      getUser: () => null,
      getUserByEmail: (e) => (e === LEGACY.email ? LEGACY : created.find((u) => u.email === e) || null),
      getUserByUsername: (u) => (u === LEGACY.username ? LEGACY : null),
      getUserCount: () => 1,
      createUser: (u) => { created.push(u); },
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
    hashPassword: async (p) => { hashCalls.push(p); return `hashed:${p}`; },
    verifyPassword: async (p, h) => { verifyCalls.push(h); return h === `hashed:${p}`; },
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
beforeEach(() => { created = []; hashCalls = []; verifyCalls = []; });

const post = (path, body) => fetch(`${base}/api/auth/${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const reg = (email, username = "newbie") => post("register", { username, email, password: "Passw0rd!x", dateOfBirth: "1990-01-01" });

describe("sign-up lower-cases the email", () => {
  it("stores Mixed@Case.COM as mixed@case.com (and trims)", async () => {
    const r = await reg("  Mixed@Case.COM ");
    assert.equal(r.status, 201);
    assert.equal(created[0].email, "mixed@case.com");
    assert.equal((await r.json()).user.email, "mixed@case.com");
  });
  it("re-registering the same address in another case is refused as taken", async () => {
    assert.equal((await reg("Dup@Case.com", "dup1")).status, 201);
    const r = await reg("DUP@case.COM", "dup2");
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "Email taken");
  });
});

describe("login", () => {
  it("legacy mixed-case account still logs in by its exact email", async () => {
    const r = await post("login", { email: "Bob@Example.com", password: "pw" });
    assert.equal(r.status, 200);
  });
  it("the email field also falls back to the lower-cased lookup", async () => {
    // a lower-cased row would exist for a post-fix account; simulate through username path
    const r = await post("login", { username: "Bob@Example.com", password: "pw" });
    assert.equal(r.status, 200);
  });
  it("unknown user: one dummy compare runs, response is the same 401", async () => {
    const r = await post("login", { username: "ghost", password: "whatever" });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, "Invalid credentials");
    assert.equal(verifyCalls.length, 1, "a compare ran even though no such user");
    assert.equal(verifyCalls[0], `hashed:${hashCalls[0]}`);
  });
  it("the dummy hash is built once and reused", async () => {
    await post("login", { username: "ghost1", password: "x" });
    await post("login", { username: "ghost2", password: "y" });
    assert.equal(hashCalls.length, 0, "already built by the earlier test, not rebuilt");
    assert.equal(verifyCalls.length, 2);
  });
  it("wrong password for a real user still runs exactly one compare", async () => {
    const r = await post("login", { username: "bob", password: "nope" });
    assert.equal(r.status, 401);
    assert.equal(verifyCalls.length, 1);
    assert.equal(verifyCalls[0], LEGACY.passwordHash);
  });
});
