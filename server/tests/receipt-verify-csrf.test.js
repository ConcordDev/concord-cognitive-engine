// INC-48: POST /api/receipts/verify is a public, write-free signature check.
// csrfMiddleware skipped it in dev (NODE_ENV !== production) and rejected it
// in production with CSRF_FAILED, because the auth and write-auth gates had
// an exact-path exemption and this one did not.
//
// This file runs the real middleware with NODE_ENV=production and
// CONCORD_ENFORCE_CSRF=true. AUTH_MODE is jwt: production forbids public,
// and AUTH_MODE=public returns before the token check, which is how a
// dev-mode suite can miss the bug even with the env flag set.
//
// Run: node --test --import=./tests/preload/no-egress.mjs tests/receipt-verify-csrf.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCsrfMiddleware, RECEIPT_VERIFY_PATH } from "../middleware/csrf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.join(__dirname, "../server.js");
const CSRF_JS = path.join(__dirname, "../middleware/csrf.js");

const ENV_KEYS = ["NODE_ENV", "CONCORD_ENFORCE_CSRF", "CONCORD_DISABLE_CSRF"];
const saved = {};

function productionMiddleware(auditLog = () => {}) {
  return createCsrfMiddleware({
    nodeEnv: process.env.NODE_ENV,
    authMode: "jwt",
    auditLog,
    jwtSecret: "receipt-verify-csrf-test-secret-not-a-deploy-key",
  }).csrfMiddleware;
}

function invoke(middleware, opts = {}) {
  const { method = "POST", path: reqPath, headers = {}, authMethod } = opts;
  const cookies = Object.prototype.hasOwnProperty.call(opts, "cookies") ? opts.cookies : {};
  const req = { method, path: reqPath, headers, cookies, ip: "203.0.113.8" };
  if (authMethod) req.authMethod = authMethod;
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  let nexted = false;
  middleware(req, res, () => { nexted = true; });
  return { nexted, statusCode: res.statusCode, body: res.body };
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.NODE_ENV = "production";
  process.env.CONCORD_ENFORCE_CSRF = "true";
  delete process.env.CONCORD_DISABLE_CSRF;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("CSRF production gate for POST /api/receipts/verify", () => {
  it("lets an anonymous POST through and still checks lookalike paths", () => {
    const audited = [];
    const mw = productionMiddleware((category, action, details) => {
      audited.push({ category, action, details });
    });

    const anon = invoke(mw, {
      path: RECEIPT_VERIFY_PATH,
      headers: { "content-type": "application/json" },
      cookies: {},
    });
    assert.equal(anon.nexted, true);
    assert.equal(anon.statusCode, null);
    assert.equal(audited.length, 0);

    const noCookieJar = invoke(mw, {
      path: RECEIPT_VERIFY_PATH,
      headers: { "content-type": "application/json" },
      cookies: undefined,
    });
    assert.equal(noCookieJar.nexted, true);

    // Same-origin fetch on /verify sends cookies and no X-CSRF-Token.
    const signedInBrowser = invoke(mw, {
      path: RECEIPT_VERIFY_PATH,
      headers: { "content-type": "application/json" },
      cookies: { concord_auth: "session", csrf_token: "present-but-not-sent" },
      authMethod: "cookie",
    });
    assert.equal(signedInBrowser.nexted, true);
    assert.equal(signedInBrowser.statusCode, null);

    for (const lookalike of ["/api/receipts/verify/x", "/api/receipts/other", "/api/receipts/verify-extra", "/api/receipts/verify/"]) {
      const blocked = invoke(mw, {
        path: lookalike,
        headers: { "content-type": "application/json" },
        cookies: {},
      });
      assert.equal(blocked.nexted, false, lookalike);
      assert.equal(blocked.statusCode, 403, lookalike);
      assert.equal(blocked.body.code, "CSRF_FAILED", lookalike);
      assert.equal(blocked.body.ok, false);
    }

    assert.ok(audited.length >= 4);
    assert.ok(audited.every((row) => row.category === "security" && row.action === "csrf_failed"));
    assert.ok(audited.some((row) => row.details.path === "/api/receipts/verify/x"));
    assert.ok(audited.some((row) => row.details.path === "/api/receipts/other"));
  });

  it("does not exempt other methods on the verify path", () => {
    const mw = productionMiddleware();
    const put = invoke(mw, { method: "PUT", path: RECEIPT_VERIFY_PATH });
    assert.equal(put.nexted, false);
    assert.equal(put.statusCode, 403);
    assert.equal(put.body.code, "CSRF_FAILED");
  });

  it("still requires a matching token on a path that is not exempt", () => {
    const mw = productionMiddleware();
    const token = "ab".repeat(16);
    const missing = invoke(mw, { path: "/api/receipts/other" });
    assert.equal(missing.body.code, "CSRF_FAILED");

    const mismatch = invoke(mw, {
      path: "/api/receipts/other",
      headers: { "x-csrf-token": token },
      cookies: { csrf_token: "cd".repeat(16) },
    });
    assert.equal(mismatch.nexted, false);
    assert.equal(mismatch.body.code, "CSRF_FAILED");

    const match = invoke(mw, {
      path: "/api/receipts/other",
      headers: { "x-csrf-token": token },
      cookies: { csrf_token: token },
    });
    assert.equal(match.nexted, true);
    assert.equal(match.statusCode, null);
  });

  it("keeps the proof-comment exemption exact and leaves the prefix list alone", () => {
    const mw = productionMiddleware();
    const comment = invoke(mw, { path: "/api/public-share/proof/pl_abc/comment" });
    assert.equal(comment.nexted, true);

    const extra = invoke(mw, { path: "/api/public-share/proof/pl_abc/comment/x" });
    assert.equal(extra.body?.code, "CSRF_FAILED");

    const stripe = invoke(mw, { path: "/api/stripe/webhook" });
    assert.equal(stripe.nexted, true);

    const src = fs.readFileSync(CSRF_JS, "utf8");
    assert.match(src, /req\.path === RECEIPT_VERIFY_PATH/);
    assert.doesNotMatch(src, /csrfExempt = \[[^\]]*\/api\/receipts/);
    const server = fs.readFileSync(SERVER_JS, "utf8");
    assert.match(server, /createCsrfMiddleware\(\{[\s\S]*?nodeEnv:\s*NODE_ENV[\s\S]*?authMode:\s*AUTH_MODE/);
    assert.match(server, /req\.path === "\/api\/receipts\/verify"/);
  });
});
