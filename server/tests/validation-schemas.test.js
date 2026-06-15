/**
 * Tests for Zod validation schemas and validate() middleware.
 * Ensures critical endpoints reject malformed input before reaching business logic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import logger from '../logger.js';

// Zod is an optional dependency — dynamically import like server.js does
let z;
try {
  const mod = await import("zod");
  z = mod.z || mod.default?.z || mod;
} catch (_e) { logger.debug('validation-schemas.test', 'zod not installed', { error: _e?.message }); }

if (!z || typeof z.object !== "function") {
  // Skip all tests if zod is not available
  import("node:test").then(({ describe }) => {
    describe("Validation Schemas", { skip: "zod not installed" }, () => {});
  });
}

// ---- Reconstruct schemas (same as server.js) ----
// We replicate them here to test in isolation without booting the full server.

const schemas = {};

schemas.dtuCreate = z.object({
  title: z.string().min(1).max(500),
  content: z.string().max(100000).optional(),
  tier: z.enum(["regular", "mega", "hyper"]).optional().default("regular"),
  tags: z.array(z.string().max(50)).max(40).optional().default([]),
  creti: z.string().max(50000).optional(),
  source: z.string().max(100).optional()
});

schemas.dtuUpdate = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  content: z.string().max(100000).optional(),
  tier: z.enum(["regular", "mega", "hyper"]).optional(),
  tags: z.array(z.string().max(50)).max(40).optional(),
  creti: z.string().max(50000).optional()
});

schemas.userRegister = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
  password: z.string().min(12).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth is required (YYYY-MM-DD)")
});

schemas.userLogin = z.object({
  username: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string()
}).refine(d => d.username || d.email, { message: "Username or email required" });

schemas.apiKeyCreate = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).optional().default(["read"])
});

schemas.pagination = z.object({
  limit: z.coerce.number().min(1).max(1000).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
  q: z.string().max(500).optional()
});

schemas.chat = z.object({
  message: z.string().min(1).max(50000),
  mode: z.string().max(50).optional(),
  context: z.record(z.unknown()).optional(),
  stream: z.union([z.boolean(), z.string()]).optional(),
  sessionId: z.string().max(100).optional(),
  personaId: z.string().max(100).optional()
});

schemas.forgeManual = z.object({
  title: z.string().min(1).max(500),
  content: z.string().max(100000).optional(),
  tier: z.enum(["regular", "mega", "hyper"]).optional(),
  tags: z.array(z.string().max(50)).max(40).optional(),
  creti: z.string().max(50000).optional(),
  source: z.string().max(100).optional(),
  template: z.string().max(100).optional()
});

schemas.forgeAuto = z.object({
  prompt: z.string().min(1).max(50000).optional(),
  title: z.string().max(500).optional(),
  content: z.string().max(100000).optional(),
  tier: z.enum(["regular", "mega", "hyper"]).optional(),
  tags: z.array(z.string().max(50)).max(40).optional(),
  source: z.string().max(200).optional()
});

schemas.dtuComment = z.object({
  text: z.string().min(1).max(5000),
  author: z.string().max(100).optional()
});

schemas.dtuVote = z.object({
  direction: z.enum(["up", "down"]).optional(),
  value: z.number().min(-1).max(1).optional()
});

schemas.councilDebate = z.object({
  topic: z.string().min(1).max(5000),
  rounds: z.number().min(1).max(20).optional(),
  participants: z.array(z.string().max(100)).max(10).optional()
});

schemas.marketplaceSubmit = z.object({
  dtuId: z.string().min(1).max(200),
  price: z.number().min(0).max(999999).optional(),
  license: z.string().max(100).optional(),
  description: z.string().max(5000).optional()
});

schemas.marketplaceInstall = z.object({
  listingId: z.string().min(1).max(200)
});

schemas.schemaCreate = z.object({
  name: z.string().min(1).max(200),
  fields: z.array(z.object({
    name: z.string().min(1).max(100),
    type: z.string().min(1).max(50),
    required: z.boolean().optional()
  })).max(100).optional(),
  description: z.string().max(2000).optional()
});

schemas.dtuRestore = z.object({
  version: z.number().int().min(0)
});

// ---- Validate middleware reconstruction ----

function validate(schemaName, source = "body") {
  return (req, res, next) => {
    if (!schemas[schemaName]) return next();
    const data = source === "query" ? req.query : req.body;
    const result = schemas[schemaName].safeParse(data);
    if (!result.success) {
      return res.status(400).json({
        ok: false,
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: result.error.errors.map(e => ({
          path: e.path.join("."),
          message: e.message,
          code: e.code
        }))
      });
    }
    req.validated = result.data;
    next();
  };
}

// ---- Helpers ----

function makeReq(body, query) {
  return { body, query: query || {} };
}

function makeRes() {
  const res = { _statusCode: null, _body: null };
  res.status = (code) => { res._statusCode = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// ================================================================
//  SCHEMA TESTS
// ================================================================

describe("Validation Schemas", () => {

  // ---- DTU Create ----
  describe("dtuCreate", () => {
    it("accepts valid DTU", () => {
      const r = schemas.dtuCreate.safeParse({ title: "Hello World" });
      assert.ok(r.success);
      assert.equal(r.data.title, "Hello World");
      assert.equal(r.data.tier, "regular");
      assert.deepEqual(r.data.tags, []);
    });

    it("rejects empty title", () => {
      const r = schemas.dtuCreate.safeParse({ title: "" });
      assert.ok(!r.success);
    });

    it("rejects title over 500 chars", () => {
      const r = schemas.dtuCreate.safeParse({ title: "x".repeat(501) });
      assert.ok(!r.success);
    });

    it("rejects invalid tier", () => {
      const r = schemas.dtuCreate.safeParse({ title: "ok", tier: "ultra" });
      assert.ok(!r.success);
    });

    it("rejects too many tags", () => {
      const tags = Array.from({ length: 41 }, (_, i) => `tag${i}`);
      const r = schemas.dtuCreate.safeParse({ title: "ok", tags });
      assert.ok(!r.success);
    });

    it("rejects tag over 50 chars", () => {
      const r = schemas.dtuCreate.safeParse({ title: "ok", tags: ["x".repeat(51)] });
      assert.ok(!r.success);
    });

    it("accepts all valid tiers", () => {
      for (const tier of ["regular", "mega", "hyper"]) {
        const r = schemas.dtuCreate.safeParse({ title: "ok", tier });
        assert.ok(r.success, `tier "${tier}" should be valid`);
      }
    });

    it("accepts content up to 100000 chars", () => {
      const r = schemas.dtuCreate.safeParse({ title: "ok", content: "x".repeat(100000) });
      assert.ok(r.success);
    });

    it("rejects content over 100000 chars", () => {
      const r = schemas.dtuCreate.safeParse({ title: "ok", content: "x".repeat(100001) });
      assert.ok(!r.success);
    });
  });

  // ---- DTU Update ----
  describe("dtuUpdate", () => {
    it("accepts valid UUID id", () => {
      const r = schemas.dtuUpdate.safeParse({ id: "550e8400-e29b-41d4-a716-446655440000" });
      assert.ok(r.success);
    });

    it("rejects non-UUID id", () => {
      const r = schemas.dtuUpdate.safeParse({ id: "not-a-uuid" });
      assert.ok(!r.success);
    });

    it("accepts partial update fields", () => {
      const r = schemas.dtuUpdate.safeParse({ id: "550e8400-e29b-41d4-a716-446655440000", title: "New" });
      assert.ok(r.success);
    });
  });

  // ---- Chat ----
  describe("chat", () => {
    it("accepts valid chat message", () => {
      const r = schemas.chat.safeParse({ message: "Hello, Concord!" });
      assert.ok(r.success);
    });

    it("rejects empty message", () => {
      const r = schemas.chat.safeParse({ message: "" });
      assert.ok(!r.success);
    });

    it("rejects missing message", () => {
      const r = schemas.chat.safeParse({});
      assert.ok(!r.success);
    });

    it("rejects message over 50000 chars", () => {
      const r = schemas.chat.safeParse({ message: "x".repeat(50001) });
      assert.ok(!r.success);
    });

    it("accepts optional mode", () => {
      const r = schemas.chat.safeParse({ message: "hi", mode: "reasoning" });
      assert.ok(r.success);
    });

    it("accepts stream as boolean or string", () => {
      assert.ok(schemas.chat.safeParse({ message: "hi", stream: true }).success);
      assert.ok(schemas.chat.safeParse({ message: "hi", stream: "1" }).success);
    });

    it("accepts context as record", () => {
      const r = schemas.chat.safeParse({ message: "hi", context: { lens: "chat", depth: 3 } });
      assert.ok(r.success);
    });
  });

  // ---- Forge Manual ----
  describe("forgeManual", () => {
    it("accepts valid forge input", () => {
      const r = schemas.forgeManual.safeParse({ title: "My DTU" });
      assert.ok(r.success);
    });

    it("rejects missing title", () => {
      const r = schemas.forgeManual.safeParse({});
      assert.ok(!r.success);
    });
  });

  // ---- Forge Auto ----
  describe("forgeAuto", () => {
    it("accepts prompt-only input", () => {
      const r = schemas.forgeAuto.safeParse({ prompt: "Generate a DTU about quantum computing" });
      assert.ok(r.success);
    });

    it("accepts empty object (all optional)", () => {
      const r = schemas.forgeAuto.safeParse({});
      assert.ok(r.success);
    });

    it("rejects prompt over 50000 chars", () => {
      const r = schemas.forgeAuto.safeParse({ prompt: "x".repeat(50001) });
      assert.ok(!r.success);
    });
  });

  // ---- DTU Comment ----
  describe("dtuComment", () => {
    it("accepts valid comment", () => {
      const r = schemas.dtuComment.safeParse({ text: "Great DTU!" });
      assert.ok(r.success);
    });

    it("rejects empty text", () => {
      const r = schemas.dtuComment.safeParse({ text: "" });
      assert.ok(!r.success);
    });

    it("rejects text over 5000 chars", () => {
      const r = schemas.dtuComment.safeParse({ text: "x".repeat(5001) });
      assert.ok(!r.success);
    });
  });

  // ---- DTU Vote ----
  describe("dtuVote", () => {
    it("accepts upvote", () => {
      const r = schemas.dtuVote.safeParse({ direction: "up" });
      assert.ok(r.success);
    });

    it("accepts downvote", () => {
      const r = schemas.dtuVote.safeParse({ direction: "down" });
      assert.ok(r.success);
    });

    it("rejects invalid direction", () => {
      const r = schemas.dtuVote.safeParse({ direction: "sideways" });
      assert.ok(!r.success);
    });

    it("accepts empty body (both fields optional)", () => {
      const r = schemas.dtuVote.safeParse({});
      assert.ok(r.success);
    });
  });

  // ---- Council Debate ----
  describe("councilDebate", () => {
    it("accepts valid debate", () => {
      const r = schemas.councilDebate.safeParse({ topic: "Should DTUs self-organize?" });
      assert.ok(r.success);
    });

    it("rejects empty topic", () => {
      const r = schemas.councilDebate.safeParse({ topic: "" });
      assert.ok(!r.success);
    });

    it("rejects rounds > 20", () => {
      const r = schemas.councilDebate.safeParse({ topic: "ok", rounds: 21 });
      assert.ok(!r.success);
    });

    it("rejects too many participants", () => {
      const participants = Array.from({ length: 11 }, (_, i) => `agent_${i}`);
      const r = schemas.councilDebate.safeParse({ topic: "ok", participants });
      assert.ok(!r.success);
    });
  });

  // ---- Marketplace Submit ----
  describe("marketplaceSubmit", () => {
    it("accepts valid submission", () => {
      const r = schemas.marketplaceSubmit.safeParse({ dtuId: "dtu_123" });
      assert.ok(r.success);
    });

    it("rejects missing dtuId", () => {
      const r = schemas.marketplaceSubmit.safeParse({});
      assert.ok(!r.success);
    });

    it("rejects negative price", () => {
      const r = schemas.marketplaceSubmit.safeParse({ dtuId: "dtu_123", price: -1 });
      assert.ok(!r.success);
    });

    it("rejects excessively large price", () => {
      const r = schemas.marketplaceSubmit.safeParse({ dtuId: "dtu_123", price: 1000000 });
      assert.ok(!r.success);
    });
  });

  // ---- Marketplace Install ----
  describe("marketplaceInstall", () => {
    it("accepts valid install", () => {
      const r = schemas.marketplaceInstall.safeParse({ listingId: "listing_abc" });
      assert.ok(r.success);
    });

    it("rejects missing listingId", () => {
      const r = schemas.marketplaceInstall.safeParse({});
      assert.ok(!r.success);
    });
  });

  // ---- Schema Create ----
  describe("schemaCreate", () => {
    it("accepts valid schema with fields", () => {
      const r = schemas.schemaCreate.safeParse({
        name: "MySchema",
        fields: [{ name: "title", type: "string" }]
      });
      assert.ok(r.success);
    });

    it("accepts name-only (fields optional)", () => {
      const r = schemas.schemaCreate.safeParse({ name: "SimpleSchema" });
      assert.ok(r.success);
    });

    it("rejects empty name", () => {
      const r = schemas.schemaCreate.safeParse({ name: "" });
      assert.ok(!r.success);
    });

    it("rejects too many fields (>100)", () => {
      const fields = Array.from({ length: 101 }, (_, i) => ({ name: `f${i}`, type: "string" }));
      const r = schemas.schemaCreate.safeParse({ name: "big", fields });
      assert.ok(!r.success);
    });
  });

  // ---- DTU Restore ----
  describe("dtuRestore", () => {
    it("accepts valid version number", () => {
      const r = schemas.dtuRestore.safeParse({ version: 3 });
      assert.ok(r.success);
    });

    it("accepts version 0", () => {
      const r = schemas.dtuRestore.safeParse({ version: 0 });
      assert.ok(r.success);
    });

    it("rejects negative version", () => {
      const r = schemas.dtuRestore.safeParse({ version: -1 });
      assert.ok(!r.success);
    });

    it("rejects non-integer version", () => {
      const r = schemas.dtuRestore.safeParse({ version: 1.5 });
      assert.ok(!r.success);
    });
  });

  // ---- User Register ----
  describe("userRegister", () => {
    it("accepts valid registration", () => {
      const r = schemas.userRegister.safeParse({
        username: "testuser",
        email: "test@example.com",
        password: "securePass123!",
        dateOfBirth: "1990-01-01"
      });
      assert.ok(r.success);
    });

    it("rejects registration missing dateOfBirth (18+ gate)", () => {
      const r = schemas.userRegister.safeParse({
        username: "testuser",
        email: "test@example.com",
        password: "securePass123!"
      });
      assert.ok(!r.success);
    });

    it("rejects username with special chars", () => {
      const r = schemas.userRegister.safeParse({
        username: "user@name",
        email: "test@example.com",
        password: "securePass123!"
      });
      assert.ok(!r.success);
    });

    it("rejects short password (<12)", () => {
      const r = schemas.userRegister.safeParse({
        username: "testuser",
        email: "test@example.com",
        password: "short"
      });
      assert.ok(!r.success);
    });

    it("rejects invalid email", () => {
      const r = schemas.userRegister.safeParse({
        username: "testuser",
        email: "not-an-email",
        password: "securePass123!"
      });
      assert.ok(!r.success);
    });
  });

  // ---- Pagination ----
  describe("pagination", () => {
    it("accepts defaults", () => {
      const r = schemas.pagination.safeParse({});
      assert.ok(r.success);
      assert.equal(r.data.limit, 50);
      assert.equal(r.data.offset, 0);
    });

    it("coerces string limit to number", () => {
      const r = schemas.pagination.safeParse({ limit: "25" });
      assert.ok(r.success);
      assert.equal(r.data.limit, 25);
    });

    it("rejects limit > 1000", () => {
      const r = schemas.pagination.safeParse({ limit: 1001 });
      assert.ok(!r.success);
    });

    it("rejects negative offset", () => {
      const r = schemas.pagination.safeParse({ offset: -1 });
      assert.ok(!r.success);
    });
  });
});

// ================================================================
//  MIDDLEWARE TESTS
// ================================================================

describe("validate() middleware", () => {
  it("passes valid body and sets req.validated", () => {
    const req = makeReq({ message: "Hello" });
    const res = makeRes();
    let nextCalled = false;
    validate("chat")(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.equal(req.validated.message, "Hello");
  });

  it("rejects invalid body with 400", () => {
    const req = makeReq({});
    const res = makeRes();
    let nextCalled = false;
    validate("chat")(req, res, () => { nextCalled = true; });
    assert.ok(!nextCalled, "next() should NOT be called on validation failure");
    assert.equal(res._statusCode, 400);
    assert.equal(res._body.ok, false);
    assert.equal(res._body.code, "VALIDATION_ERROR");
    assert.ok(Array.isArray(res._body.details));
  });

  it("error details include path and message", () => {
    const req = makeReq({});
    const res = makeRes();
    validate("chat")(req, res, () => {});
    const detail = res._body.details[0];
    assert.ok(detail.path !== undefined);
    assert.ok(detail.message !== undefined);
    assert.ok(detail.code !== undefined);
  });

  it("skips validation for unknown schema name", () => {
    const req = makeReq({});
    const res = makeRes();
    let nextCalled = false;
    validate("nonexistentSchema")(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled, "should call next() if schema doesn't exist");
  });

  it("validates query params when source=query", () => {
    const req = { body: {}, query: { limit: "25" } };
    const res = makeRes();
    let nextCalled = false;

    // Custom middleware for query validation
    function validateQuery(schemaName) {
      return (r, rs, next) => {
        if (!schemas[schemaName]) return next();
        const result = schemas[schemaName].safeParse(r.query);
        if (!result.success) {
          return rs.status(400).json({ ok: false, error: "Validation failed" });
        }
        r.validatedQuery = result.data;
        next();
      };
    }

    validateQuery("pagination")(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.equal(req.validatedQuery.limit, 25);
    assert.equal(req.validatedQuery.offset, 0);
  });
});
