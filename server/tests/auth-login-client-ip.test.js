/**
 * INC-20261010-15 — login rate limits must key on the visitor IP, not the
 * loopback proxy.
 *
 * Mounts the real auth router behind installTrustedClientIp. Limits are the
 * production values (20/IP, 10/account, authRateLimiter 5/IP+identity).
 * Nothing here raises a cap or sets CONCORD_RATE_LIMIT_BYPASS.
 *
 * Run: node --test tests/auth-login-client-ip.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import express from "express";
import createAuthRouter from "../routes/auth.js";
import { installTrustedClientIp, getSharedClientIpFallbackTotal } from "../lib/trusted-client-ip.js";
import { getBuffer } from "../logger.js";

const { default: rateLimit, ipKeyGenerator } = await import("express-rate-limit");

const LOGIN_MAX_PER_IP = 20;
const LOGIN_MAX_PER_ACCOUNT = 10;

function nonLoopbackIPv4() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const info of entries || []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return null;
}

function makeApp() {
  const app = express();
  installTrustedClientIp(app);
  app.use(express.json());
  // Same compound key as server.js authRateLimiter. Identity stays in the
  // key so this suite can fill the IP-only bucket with distinct usernames
  // without tripping the 5-attempt identity cap first.
  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { ok: false, error: "Too many authentication attempts. Please try again later.", retryAfter: 900 },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const identity = req.body?.username || req.body?.email || "";
      const ip = ipKeyGenerator(req.ip);
      return `${ip}:${identity}`;
    },
    skipSuccessfulRequests: true,
    validate: { trustProxy: false, xForwardedForHeader: false },
  });
  const router = createAuthRouter({
    AuthDB: {
      getUser: () => null,
      getUserByEmail: () => null,
      getUserByUsername: () => null,
      getUserCount: () => 0,
      createUser: () => {},
    },
    AuditDB: { append: () => {} },
    db: null,
    jwt: {},
    authRateLimiter,
    _TOKEN_BLACKLIST: { revokeAllForUser: () => {}, isRevoked: () => false, revoke: () => {} },
    _REFRESH_FAMILIES: new Map(),
    REFRESH_TOKEN_COOKIE: "concord_refresh",
    NODE_ENV: "test",
    validate: () => (_req, _res, next) => next(),
    hashPassword: async (p) => `hashed:${p}`,
    verifyPassword: async () => false,
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

let server;
let loopbackBase;
let peerBase;
let peerIp;

before(async () => {
  peerIp = nonLoopbackIPv4();
  const app = makeApp();
  await new Promise((resolve) => {
    server = app.listen(0, "0.0.0.0", resolve);
  });
  const port = server.address().port;
  loopbackBase = `http://127.0.0.1:${port}`;
  if (peerIp) peerBase = `http://${peerIp}:${port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

let seq = 0;
function username(prefix) {
  seq += 1;
  return `${prefix}-${seq}`;
}

async function login(base, { xff, cf, username: user, email }) {
  const headers = { "content-type": "application/json" };
  if (xff) headers["x-forwarded-for"] = xff;
  if (cf) headers["cf-connecting-ip"] = cf;
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username: user, email, password: "not-the-password" }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

/**
 * Fill one IP bucket with distinct accounts so authRateLimiter's
 * per-identity cap (5) does not fire. Returns how many attempts were
 * allowed (401) before the IP bucket 429'd.
 */
async function exhaustIp(base, headersFor, label) {
  let allowed = 0;
  let limited = null;
  for (let i = 0; i < LOGIN_MAX_PER_IP + 3; i++) {
    const res = await login(base, { ...headersFor(i), username: username(label) });
    if (res.status === 429) {
      limited = res;
      break;
    }
    assert.equal(res.status, 401, `expected 401 before the IP cap, got ${res.status} ${JSON.stringify(res.body)}`);
    allowed += 1;
  }
  assert.ok(limited, "IP bucket never returned 429");
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /Too many login attempts/);
  assert.equal(allowed, LOGIN_MAX_PER_IP);
  return limited;
}

describe("trusted client IP on POST /api/auth/login", () => {
  it("two forwarded client IPs do not share the per-IP bucket", async () => {
    const ipA = "2001:db8::10";
    const ipB = "2001:db8::11";
    await exhaustIp(loopbackBase, () => ({ xff: ipA }), "a");
    const other = await login(loopbackBase, { xff: ipB, username: username("b") });
    assert.equal(other.status, 401, `IP B was locked by IP A's bucket: ${JSON.stringify(other.body)}`);
    const again = await login(loopbackBase, { xff: ipA, username: username("a2") });
    assert.equal(again.status, 429);
    assert.match(again.body.error, /Too many login attempts/);
  });

  it("a second loopback hop (client, 127.0.0.1) still keys on the visitor", async () => {
    const ipA = "2001:db8::20";
    const ipB = "2001:db8::21";
    await exhaustIp(loopbackBase, () => ({ xff: `${ipA}, 127.0.0.1` }), "hop");
    const other = await login(loopbackBase, { xff: `${ipB}, 127.0.0.1`, username: username("hopb") });
    assert.equal(other.status, 401, JSON.stringify(other.body));
  });

  it("CF-Connecting-IP wins over a spoofed X-Forwarded-For from the loopback proxy", async () => {
    const victim = "2001:db8::30";
    const other = "2001:db8::31";
    await exhaustIp(
      loopbackBase,
      (i) => ({ cf: victim, xff: `198.51.100.${(i % 200) + 1}, 127.0.0.1` }),
      "cf",
    );
    const spoofReset = await login(loopbackBase, {
      cf: victim,
      xff: "203.0.113.200",
      username: username("cf-spoof"),
    });
    assert.equal(spoofReset.status, 429, "a fresh X-Forwarded-For must not reset the CF bucket");
    assert.match(spoofReset.body.error, /Too many login attempts/);
    const separate = await login(loopbackBase, { cf: other, username: username("cf-other") });
    assert.equal(separate.status, 401, JSON.stringify(separate.body));
  });

  it("a spoofed X-Forwarded-For from a non-loopback peer cannot evade or reset the peer bucket", async () => {
    assert.ok(peerIp, "this host has no non-loopback IPv4; cannot prove the untrusted-peer path");
    const spoof = "203.0.113.77";
    await exhaustIp(peerBase, () => ({ xff: spoof, cf: "203.0.113.78" }), "spoof");
    const reset = await login(peerBase, {
      xff: "203.0.113.250",
      cf: "2001:db8::99",
      username: username("spoof-reset"),
    });
    assert.equal(reset.status, 429, `spoofed headers reset the limit: ${JSON.stringify(reset.body)}`);
    assert.match(reset.body.error, /Too many login attempts/);
    // The attacker's headers must not have filled the victim's trusted bucket.
    const victim = await login(loopbackBase, { xff: spoof, username: username("victim") });
    assert.equal(victim.status, 401, `spoof poisoned ${spoof}: ${JSON.stringify(victim.body)}`);
  });

  it("the per-account limit still trips across distinct client IPs", async () => {
    const account = username("acct");
    let allowed = 0;
    let limited = null;
    for (let i = 0; i < LOGIN_MAX_PER_ACCOUNT + 3; i++) {
      const ip = `198.51.100.${i + 1}`;
      const res = await login(loopbackBase, { xff: ip, username: account });
      if (res.status === 429) {
        limited = res;
        break;
      }
      assert.equal(res.status, 401, JSON.stringify(res.body));
      allowed += 1;
    }
    assert.ok(limited, "per-account limit never tripped");
    assert.equal(allowed, LOGIN_MAX_PER_ACCOUNT);
    assert.match(limited.body.error, /this account/);
    const still = await login(loopbackBase, { xff: "198.51.100.50", username: account });
    assert.equal(still.status, 429);
    assert.match(still.body.error, /this account/);
    const otherAccount = await login(loopbackBase, { xff: "198.51.100.50", username: username("other-acct") });
    assert.equal(otherAccount.status, 401, JSON.stringify(otherAccount.body));
  });

  it("a loopback request with no forwarded client IP uses the shared bucket and logs it", async () => {
    const before = getSharedClientIpFallbackTotal();
    const res = await login(loopbackBase, { username: username("shared") });
    assert.equal(res.status, 401);
    assert.equal(getSharedClientIpFallbackTotal(), before + 1);
    const logged = getBuffer().some((entry) => entry.message === "client_ip_shared_bucket" && entry.level === "warn");
    assert.equal(logged, true);
  });
});

describe("server.js wires the trusted client IP before rate limiters", () => {
  it("installs the middleware and does not pass TRUST_PROXY through as a hop string", () => {
    const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
    assert.match(src, /installTrustedClientIp\(app\)/);
    assert.doesNotMatch(src, /app\.set\(\s*"trust proxy"\s*,\s*process\.env\.TRUST_PROXY/);
  });
});
