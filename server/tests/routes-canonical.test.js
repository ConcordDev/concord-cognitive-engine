import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  initCanonicalRegistry,
  createCanonicalStore,
} from "../lib/canonical-registry.js";
import {
  initIntegrityTable,
  createIntegritySystem,
} from "../lib/dtu-integrity.js";
import { createCompressionPipeline } from "../lib/dtu-compression.js";
import {
  initRightsTable,
  createRightsManager,
} from "../lib/dtu-rights.js";
import registerCanonicalRoutes from "../routes/canonical.js";

// H2: the platform signing key is no longer hardcoded in dtu-integrity.js —
// it comes from CONCORD_DTU_SIGNING_KEY. Configure a test-only key so the
// integrity routes exercise the signed path. (Env is read at call time, so
// setting it here, after the imports, is effective.)
process.env.CONCORD_DTU_SIGNING_KEY = "routes-canonical-test-only-key";

/**
 * Lightweight mock Express app for route testing.
 */
function createMockApp() {
  const routes = {};
  const methods = ["get", "post", "put", "delete", "patch"];

  const app = {};
  for (const method of methods) {
    app[method] = (path, ...handlers) => {
      if (!routes[method]) routes[method] = {};
      routes[method][path] = handlers;
    };
  }

  app.call = async (method, path, { body, params, query, user } = {}) => {
    const handlers = routes[method]?.[path];
    if (!handlers) throw new Error(`No route: ${method.toUpperCase()} ${path}`);

    let statusCode = 200;
    let responseBody = null;
    const sentHeaders = {};

    const req = {
      body: body || {},
      params: params || {},
      query: query || {},
      user: user || null,
      headers: {},
      ip: "127.0.0.1",
    };

    const res = {
      status(code) { statusCode = code; return res; },
      json(data) { responseBody = data; return res; },
      set(key, val) { sentHeaders[key] = val; return res; },
      send(data) { responseBody = data; return res; },
    };

    for (const handler of handlers) {
      let nextCalled = false;

      await new Promise((resolve, reject) => {
        const next = (err) => {
          nextCalled = true;
          if (err) reject(err);
          else resolve();
        };

        try {
          const result = handler(req, res, next);
          if (result && typeof result.then === "function") {
            result.then(() => { if (!nextCalled) resolve(); }).catch(reject);
          } else if (!nextCalled) {
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      });

      if (responseBody !== null) break;
    }

    return { status: statusCode, body: responseBody, headers: sentHeaders };
  };

  return app;
}

describe("routes/canonical", () => {
  let app;
  let db;
  let STATE;
  let canonicalStore;
  let integritySystem;
  let compressionPipeline;
  let rightsManager;

  beforeEach(() => {
    db = new Database(":memory:");
    initCanonicalRegistry(db);
    initIntegrityTable(db);
    initRightsTable(db);

    STATE = {
      dtus: new Map(),
    };

    canonicalStore = createCanonicalStore(db, null);
    integritySystem = createIntegritySystem(db, { dtuStore: STATE.dtus });
    compressionPipeline = createCompressionPipeline();
    rightsManager = createRightsManager(db);

    app = createMockApp();
    registerCanonicalRoutes(app, {
      canonicalStore,
      integritySystem,
      compressionPipeline,
      rightsManager,
      STATE,
    });
  });

  // ── Register content ───────────────────────────────────────────────

  describe("POST /api/canonical/register", () => {
    it("registers new content and returns canonical ID", async () => {
      const res = await app.call("post", "/api/canonical/register", {
        body: {
          content: "Hello, canonical world!",
          dtuId: "dtu_test1",
          contentType: "text/plain",
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.isNew, true);
      assert.ok(res.body.contentHash);
      assert.equal(res.body.canonicalDtuId, "dtu_test1");
      assert.equal(res.body.referenceCount, 1);
      // Compression info included for new content
      assert.ok(res.body.compression);
    });

    it("returns existing canonical for duplicate content", async () => {
      await app.call("post", "/api/canonical/register", {
        body: { content: "duplicate content", dtuId: "dtu_first" },
      });

      const res = await app.call("post", "/api/canonical/register", {
        body: { content: "duplicate content", dtuId: "dtu_second" },
      });

      assert.equal(res.body.isNew, false);
      assert.equal(res.body.canonicalDtuId, "dtu_first");
      assert.equal(res.body.referenceCount, 2);
    });

    it("returns 400 for missing content", async () => {
      const res = await app.call("post", "/api/canonical/register", {
        body: {},
      });

      assert.equal(res.status, 400);
      assert.equal(res.body.ok, false);
      assert.ok(res.body.error.includes("Missing content"));
    });

    it("handles object content", async () => {
      const res = await app.call("post", "/api/canonical/register", {
        body: {
          content: { key: "value", nested: { a: 1 } },
          contentType: "application/json",
        },
      });

      assert.equal(res.body.ok, true);
      assert.equal(res.body.isNew, true);
    });
  });

  // ── Lookup by hash ─────────────────────────────────────────────────

  describe("GET /api/canonical/lookup/:hash", () => {
    it("finds a registered content hash", async () => {
      const reg = await app.call("post", "/api/canonical/register", {
        body: { content: "lookup test", dtuId: "dtu_look" },
      });

      const res = await app.call("get", "/api/canonical/lookup/:hash", {
        params: { hash: reg.body.contentHash },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.canonical.canonicalDtuId, "dtu_look");
    });

    it("returns 404 for unknown hash", async () => {
      const res = await app.call("get", "/api/canonical/lookup/:hash", {
        params: { hash: "0".repeat(64) },
      });

      assert.equal(res.status, 404);
      assert.equal(res.body.ok, false);
    });
  });

  // ── Verify DTU integrity ───────────────────────────────────────────

  describe("POST /api/canonical/verify", () => {
    it("verifies a valid DTU", async () => {
      const dtu = {
        id: "dtu_verify",
        content: "Verify me",
        summary: "Test",
        tier: "regular",
        scope: "global",
        createdAt: new Date().toISOString(),
      };
      STATE.dtus.set("dtu_verify", dtu);
      integritySystem.generateIntegrity(dtu);

      const res = await app.call("post", "/api/canonical/verify", {
        body: { dtuId: "dtu_verify" },
      });

      assert.equal(res.body.ok, true);
      assert.equal(res.body.isValid, true);
    });

    it("returns 400 for missing dtuId", async () => {
      const res = await app.call("post", "/api/canonical/verify", {
        body: {},
      });

      assert.equal(res.status, 400);
    });

    it("returns 404 for non-existent DTU", async () => {
      const res = await app.call("post", "/api/canonical/verify", {
        body: { dtuId: "dtu_ghost" },
      });

      assert.equal(res.status, 404);
    });
  });

  // ── Rights management endpoints ────────────────────────────────────

  describe("PUT /api/canonical/:id/rights", () => {
    it("assigns rights to a DTU", async () => {
      const res = await app.call("put", "/api/canonical/:id/rights", {
        params: { id: "dtu_rights1" },
        body: {
          creatorId: "creator1",
          license: "standard",
        },
      });

      assert.equal(res.body.ok, true);
      assert.ok(res.body.rights);
      assert.equal(res.body.rights.creatorId, "creator1");
    });

    it("returns 400 for missing creatorId", async () => {
      const res = await app.call("put", "/api/canonical/:id/rights", {
        params: { id: "dtu_r2" },
        body: {},
      });

      assert.equal(res.status, 400);
    });
  });

  describe("POST /api/canonical/:id/rights/check", () => {
    it("checks permission for a user", async () => {
      await app.call("put", "/api/canonical/:id/rights", {
        params: { id: "dtu_check" },
        body: { creatorId: "creator1" },
      });

      const res = await app.call("post", "/api/canonical/:id/rights/check", {
        params: { id: "dtu_check" },
        body: { userId: "creator1", action: "read" },
      });

      assert.equal(res.body.ok, true);
      assert.equal(res.body.allowed, true);
    });

    it("returns 400 for missing userId or action", async () => {
      const res = await app.call("post", "/api/canonical/:id/rights/check", {
        params: { id: "dtu_ch" },
        body: { userId: "u1" },
      });

      assert.equal(res.status, 400);
    });
  });

  describe("POST /api/canonical/:id/rights/transfer", () => {
    it("transfers ownership", async () => {
      await app.call("put", "/api/canonical/:id/rights", {
        params: { id: "dtu_xfer" },
        body: { creatorId: "creator1", ownerId: "owner_a" },
      });

      const res = await app.call("post", "/api/canonical/:id/rights/transfer", {
        params: { id: "dtu_xfer" },
        body: { fromUserId: "owner_a", toUserId: "owner_b" },
      });

      assert.equal(res.body.ok, true);
      assert.equal(res.body.newOwner, "owner_b");
    });

    it("returns 400 for missing fields", async () => {
      const res = await app.call("post", "/api/canonical/:id/rights/transfer", {
        params: { id: "dtu_t" },
        body: { fromUserId: "a" },
      });

      assert.equal(res.status, 400);
    });
  });

  describe("POST /api/canonical/:id/rights/revoke", () => {
    it("revokes a user's access", async () => {
      await app.call("put", "/api/canonical/:id/rights", {
        params: { id: "dtu_revoke" },
        body: { creatorId: "creator1" },
      });

      const res = await app.call("post", "/api/canonical/:id/rights/revoke", {
        params: { id: "dtu_revoke" },
        body: { userId: "bad_user" },
      });

      assert.equal(res.body.ok, true);
    });

    it("returns 400 for missing userId", async () => {
      const res = await app.call("post", "/api/canonical/:id/rights/revoke", {
        params: { id: "dtu_r" },
        body: {},
      });

      assert.equal(res.status, 400);
    });
  });

  describe("GET /api/canonical/:id/rights/commercial", () => {
    it("checks commercial rights", async () => {
      await app.call("put", "/api/canonical/:id/rights", {
        params: { id: "dtu_com" },
        body: { creatorId: "c1", commercialAllowed: true },
      });

      const res = await app.call("get", "/api/canonical/:id/rights/commercial", {
        params: { id: "dtu_com" },
      });

      assert.equal(res.body.ok, true);
      assert.equal(res.body.allowed, true);
    });
  });

  // ── Stats endpoint ─────────────────────────────────────────────────

  describe("GET /api/canonical/stats", () => {
    it("returns dedup, integrity, and compression stats", async () => {
      // Register some content first
      await app.call("post", "/api/canonical/register", {
        body: { content: "Stats test content A", dtuId: "dtu_sa" },
      });
      await app.call("post", "/api/canonical/register", {
        body: { content: "Stats test content B", dtuId: "dtu_sb" },
      });

      const res = await app.call("get", "/api/canonical/stats");

      assert.equal(res.body.ok, true);
      assert.ok(res.body.dedup);
      assert.ok(res.body.integrity);
      assert.ok(res.body.compression);
      assert.equal(res.body.dedup.totalCanonicals, 2);
    });
  });

  // ── Integrity generate ─────────────────────────────────────────────

  describe("POST /api/canonical/integrity/generate", () => {
    it("generates integrity for a DTU", async () => {
      const dtu = {
        id: "dtu_intgen",
        content: "Generate integrity",
        tier: "regular",
        scope: "global",
        createdAt: new Date().toISOString(),
      };
      STATE.dtus.set("dtu_intgen", dtu);

      const res = await app.call("post", "/api/canonical/integrity/generate", {
        body: { dtuId: "dtu_intgen" },
      });

      assert.equal(res.body.ok, true);
      assert.ok(res.body.envelope);
      assert.ok(res.body.envelope.contentHash);
    });

    it("returns 400 for missing dtuId", async () => {
      const res = await app.call("post", "/api/canonical/integrity/generate", {
        body: {},
      });
      assert.equal(res.status, 400);
    });

    it("returns 404 for non-existent DTU", async () => {
      const res = await app.call("post", "/api/canonical/integrity/generate", {
        body: { dtuId: "dtu_nope" },
      });
      assert.equal(res.status, 404);
    });
  });

  // ── Batch verify ───────────────────────────────────────────────────

  describe("POST /api/canonical/integrity/batch-verify", () => {
    it("returns 400 for missing dtuIds array", async () => {
      const res = await app.call("post", "/api/canonical/integrity/batch-verify", {
        body: {},
      });
      assert.equal(res.status, 400);
    });

    it("returns 400 for empty dtuIds array", async () => {
      const res = await app.call("post", "/api/canonical/integrity/batch-verify", {
        body: { dtuIds: [] },
      });
      assert.equal(res.status, 400);
    });
  });

  // ── Compression endpoint ───────────────────────────────────────────

  describe("POST /api/canonical/compress", () => {
    it("compresses content", async () => {
      const res = await app.call("post", "/api/canonical/compress", {
        body: {
          content: "Compress this content ".repeat(100),
          contentType: "text/plain",
        },
      });

      assert.equal(res.body.ok, true);
      assert.ok(res.body.algorithm);
      assert.ok(res.body.originalSize > 0);
      assert.ok(res.body.compressedSize > 0);
      assert.ok(res.body.compressedBase64);
    });

    it("returns 400 for missing content", async () => {
      const res = await app.call("post", "/api/canonical/compress", {
        body: {},
      });
      assert.equal(res.status, 400);
    });
  });

  // ── Derivative rights ──────────────────────────────────────────────

  describe("POST /api/canonical/:id/rights/derivative", () => {
    it("grants derivative rights", async () => {
      await app.call("put", "/api/canonical/:id/rights", {
        params: { id: "dtu_deriv" },
        body: { creatorId: "c1" },
      });

      const res = await app.call("post", "/api/canonical/:id/rights/derivative", {
        params: { id: "dtu_deriv" },
        body: { maxDerivatives: 10 },
      });

      assert.equal(res.body.ok, true);
    });
  });
});
