/**
 * Canonical routes: the store / compression / rights / integrity systems are
 * created after the routes register (initExtensions → app.locals.*), so
 * server.js hands them in as lazyDelegate()s. Absent => structured 503
 * "<name>_unavailable" (never a TypeError 500); present => normal 200.
 *
 * Run: node --test server/tests/canonical-routes-lazy-deps.test.js
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import express from "express";
import registerCanonicalRoutes, { lazyDelegate } from "../routes/canonical.js";
import { initCanonicalRegistry, createCanonicalStore } from "../lib/canonical-registry.js";
import { initIntegrityTable, createIntegritySystem } from "../lib/dtu-integrity.js";
import { createCompressionPipeline } from "../lib/dtu-compression.js";
import { initRightsTable, createRightsManager } from "../lib/dtu-rights.js";

process.env.CONCORD_DTU_SIGNING_KEY = "canonical-lazy-deps-test-only-key";

function build() {
  const app = express();
  app.use(express.json());
  const deps = {
    STATE: {},
    integritySystem: lazyDelegate("dtu_integrity", () => app.locals.dtuIntegrity),
    canonicalStore: lazyDelegate("canonical_store", () => app.locals.canonicalStore),
    compressionPipeline: lazyDelegate("dtu_compression", () => app.locals.dtuCompression),
    rightsManager: lazyDelegate("dtu_rights", () => app.locals.dtuRights),
  };
  registerCanonicalRoutes(app, deps);
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } finally { server.close(); }
}

describe("canonical routes with no subsystems wired", () => {
  const app = build();
  const cases = [
    ["store", "get", "/api/canonical/stats", null, "canonical_store_unavailable"],
    ["store", "post", "/api/canonical/register", { content: "x" }, "canonical_store_unavailable"],
    ["store", "get", "/api/canonical/lookup/abc", null, "canonical_store_unavailable"],
    ["store", "get", "/api/canonical/duplicates", null, "canonical_store_unavailable"],
    ["compression", "post", "/api/canonical/compress", { content: "hello" }, "dtu_compression_unavailable"],
    ["compression", "get", "/api/canonical/compression-stats", null, "dtu_compression_unavailable"],
    ["rights", "get", "/api/canonical/d1/rights", null, "dtu_rights_unavailable"],
    ["rights", "put", "/api/canonical/d1/rights", { creatorId: "u" }, "dtu_rights_unavailable"],
    ["rights", "post", "/api/canonical/d1/rights/check", { userId: "u", action: "read" }, "dtu_rights_unavailable"],
    ["rights", "get", "/api/canonical/d1/rights/commercial", null, "dtu_rights_unavailable"],
    ["rights", "get", "/api/canonical/licenses", null, "dtu_rights_unavailable"],
    ["integrity", "get", "/api/canonical/integrity/d1", null, "dtu_integrity_unavailable"],
  ];
  for (const [group, method, path, body, code] of cases) {
    it(`${group}: ${method.toUpperCase()} ${path} -> 503 ${code}`, async () => {
      const r = await call(app, method, path, body);
      assert.equal(r.status, 503);
      assert.deepEqual(r.json, { ok: false, error: code });
    });
  }
});

describe("canonical routes with subsystems wired", () => {
  let app;
  before(() => {
    const db = new Database(":memory:");
    initCanonicalRegistry(db); initIntegrityTable(db); initRightsTable(db);
    app = build();
    app.locals.canonicalStore = createCanonicalStore(db, null, {});
    app.locals.dtuIntegrity = createIntegritySystem(db, {});
    app.locals.dtuCompression = createCompressionPipeline({});
    app.locals.dtuRights = createRightsManager(db, {});
  });

  it("store group works (register -> lookup -> stats -> duplicates)", async () => {
    const reg = await call(app, "post", "/api/canonical/register", { content: "same bytes" });
    assert.equal(reg.status, 200);
    assert.equal(reg.json.ok, true);
    assert.ok(reg.json.compression, "compression applied via the wired pipeline");
    assert.equal((await call(app, "get", `/api/canonical/lookup/${reg.json.contentHash}`)).status, 200);
    assert.equal((await call(app, "get", "/api/canonical/stats")).json.ok, true);
    assert.equal((await call(app, "get", "/api/canonical/duplicates")).status, 200);
  });

  it("compression group works", async () => {
    assert.equal((await call(app, "post", "/api/canonical/compress", { content: "hello hello hello" })).status, 200);
    assert.equal((await call(app, "get", "/api/canonical/compression-stats")).json.ok, true);
  });

  it("rights group works", async () => {
    const lic = await call(app, "get", "/api/canonical/licenses");
    assert.equal(lic.status, 200);
    assert.ok(lic.json.licenses);
    assert.equal((await call(app, "get", "/api/canonical/d1/rights")).status, 200);
  });

  it("integrity group works", async () => {
    const r = await call(app, "get", "/api/canonical/integrity/d1");
    assert.equal(r.status, 200);
  });
});

describe("register without a compression pipeline still registers", () => {
  it("skips compression instead of failing", async () => {
    const db = new Database(":memory:");
    initCanonicalRegistry(db);
    const app = build();
    app.locals.canonicalStore = createCanonicalStore(db, null, {});
    const r = await call(app, "post", "/api/canonical/register", { content: "no pipeline" });
    assert.equal(r.status, 200);
    assert.equal(r.json.compression, null);
  });
});

describe("server.js wiring", () => {
  it("passes all four lazy delegates into registerCanonicalRoutes", () => {
    const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
    const line = src.split("\n").find((l) => l.includes("registerCanonicalRoutes(app,"));
    for (const k of ["integritySystem", "canonicalStore", "compressionPipeline", "rightsManager"]) {
      assert.ok(line.includes(k), `${k} wired`);
    }
  });
});
