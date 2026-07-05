// Verification-audit fix — pinning test for a real production bug in
// server/routes/cdn.js's GET /info handler (duplicate-handler-race
// investigation, cdn.js unit).
//
// Two GET /info handlers were registered on the same router. Express only
// ever dispatches the FIRST-registered handler for a given (method, path)
// pair, so the live one was:
//   const providerInfo = await cdnManager.getProviderInfo().catch(() => ({}));
// but every getProviderInfo() implementation in lib/cdn-manager.js is
// SYNCHRONOUS (returns a plain object, not a Promise) — so `.catch` is not
// a function on the returned object, and the handler threw a TypeError on
// EVERY real request, 500ing the endpoint the frontend uses to resolve
// media URLs. The second (dead-by-registration-order) duplicate had the
// correct synchronous call plus a `signer` info block the live one lacked;
// the two were merged into a single correct handler.
//
// This test boots a real (non-mocked) local-provider CDN manager + URL
// signer — the same objects createCDNRouter is constructed with in
// production — so a regression back to the broken `await x.catch()` shape
// fails this test with a 500, not just a unit-level assertion.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createCDNRouter from "../routes/cdn.js";
import { createCDNManager } from "../lib/cdn-manager.js";
import { createURLSigner } from "../lib/cdn-url-signer.js";

function startApp() {
  const cdnManager = createCDNManager({ provider: "local" });
  const urlSigner = createURLSigner({ secret: "test-secret-for-cdn-info-route" });
  const app = express();
  app.use(express.json());
  app.use("/api/cdn", createCDNRouter({ cdnManager, urlSigner, STATE: null }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

describe("GET /api/cdn/info — real CDN manager, no fabricated await-on-sync-fn crash", () => {
  let app;
  beforeEach(async () => { app = await startApp(); });
  afterEach(async () => { await app.close(); });

  it("returns 200 (not 500) — getProviderInfo() is synchronous, must not be awaited with .catch()", async () => {
    const res = await fetch(`${app.url}/api/cdn/info`);
    assert.equal(res.status, 200, "the live handler must not throw TypeError: getProviderInfo(...).catch is not a function");
  });

  it("returns the merged cdn + signer info shape (the surviving duplicate's extra fields)", async () => {
    const res = await fetch(`${app.url}/api/cdn/info`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.cdn.provider, "local");
    assert.equal(typeof body.cdn.configured, "boolean");
    assert.ok("baseUrl" in body.cdn);
    assert.ok(body.signer, "signer info block must be present (merged from the other duplicate)");
    assert.equal(typeof body.signer.algorithm, "string");
    assert.equal(typeof body.signer.defaultExpiry, "number");
    assert.equal(typeof body.signer.maxExpiry, "number");
  });

  it("is registered exactly once (no duplicate GET /info dead handler left behind)", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../routes/cdn.js", import.meta.url), "utf8"));
    const matches = src.match(/router\.get\(\s*["']\/info["']/g) || [];
    assert.equal(matches.length, 1, "expected exactly one GET /info registration");
  });
});
