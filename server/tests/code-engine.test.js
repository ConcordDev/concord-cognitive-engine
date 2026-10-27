import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for Self-Expanding Code Engine
 *
 * Tests the core pipeline: ingest → extract → score → store → compress → generate
 */

// Mock database with appropriate returns for COUNT queries and lookups
function makeMockDb() {
  return {
    exec: () => {},
    prepare: (sql) => ({
      run: (...args) => ({ changes: 1 }),
      get: (...args) => {
        if (sql.includes("COUNT")) return { count: 0 };
        return null;
      },
      all: (...args) => [],
    }),
  };
}

describe("code-engine", () => {
  let engine;
  let db;

  beforeEach(async () => {
    db = makeMockDb();
    const mod = await import("../lib/code-engine.js");
    engine = mod.createCodeEngine(db);
  });

  describe("createCodeEngine", () => {
    it("returns an engine object with required methods", () => {
      assert.ok(engine);
      assert.equal(typeof engine.ingestRepository, "function");
      assert.equal(typeof engine.extractPatterns, "function");
      assert.equal(typeof engine.scorePattern, "function");
      assert.equal(typeof engine.searchPatterns, "function");
      assert.equal(typeof engine.compressToMega, "function");
      assert.equal(typeof engine.generateLens, "function");
      assert.equal(typeof engine.recordError, "function");
      assert.equal(typeof engine.getStats, "function");
    });
  });

  describe("scorePattern", () => {
    it("scores a pattern with CRETI dimensions", () => {
      const pattern = {
        name: "singleton",
        category: "architectural",
        description: "Singleton pattern implementation",
        language: "javascript",
      };
      const scored = engine.scorePattern(pattern);
      // Engine returns short keys: c, r, e, t, i
      assert.ok(scored.c >= 0 && scored.c <= 1, `c=${scored.c}`);
      assert.ok(scored.r >= 0 && scored.r <= 1, `r=${scored.r}`);
      assert.ok(scored.e >= 0 && scored.e <= 1, `e=${scored.e}`);
      assert.ok(scored.t >= 0 && scored.t <= 1, `t=${scored.t}`);
      assert.ok(scored.i >= 0 && scored.i <= 1, `i=${scored.i}`);
    });

    it("gives scores for security patterns", () => {
      const secPattern = {
        name: "input-sanitization",
        category: "security",
        description: "Input sanitization with validation",
        language: "javascript",
      };
      const scored = engine.scorePattern(secPattern);
      assert.equal(typeof scored.c, "number");
      assert.equal(typeof scored.r, "number");
      assert.equal(typeof scored.e, "number");
      assert.equal(typeof scored.t, "number");
      assert.equal(typeof scored.i, "number");
    });
  });

  describe("getStats", () => {
    it("returns statistics object with nested structure", () => {
      const stats = engine.getStats();
      assert.ok(stats);
      // repositories is an object with { total, ingested, pending, failed }
      assert.ok(stats.repositories);
      assert.equal(typeof stats.repositories.total, "number");
      // patterns is an object with { total, byCategory }
      assert.ok(stats.patterns);
      assert.equal(typeof stats.patterns.total, "number");
      // megas is a number
      assert.equal(typeof stats.megas, "number");
    });
  });

  describe("searchPatterns", () => {
    it("returns result object with patterns array", () => {
      const results = engine.searchPatterns({ category: "security" });
      assert.ok(results);
      // Returns { patterns: [], total, limit, offset } or similar structure
      if (Array.isArray(results)) {
        assert.ok(true);
      } else {
        assert.ok(results.patterns || results.items || results.results);
      }
    });

    it("accepts language filter", () => {
      const results = engine.searchPatterns({ language: "javascript" });
      assert.ok(results);
    });
  });

  describe("ingestRepository", () => {
    it("validates URL is required", () => {
      // ingestRepository throws synchronously for validation errors
      assert.throws(
        () => engine.ingestRepository(""),
        (err) => err.message.toLowerCase().includes("url") || err.message.toLowerCase().includes("required")
      );
    });

    it("validates URL format", () => {
      assert.throws(
        () => engine.ingestRepository("not-a-url"),
        (err) => err.message.toLowerCase().includes("url") || err.message.toLowerCase().includes("parse") || err.message.toLowerCase().includes("invalid")
      );
    });
  });

  describe("compressToMega", () => {
    it("validates topic is required", () => {
      assert.throws(
        () => engine.compressToMega(""),
        (err) => err.message.toLowerCase().includes("topic") || err.message.toLowerCase().includes("required")
      );
    });
  });

  describe("generateLens", () => {
    it("validates request is required", () => {
      assert.throws(
        () => engine.generateLens(""),
        (err) => err.message.toLowerCase().includes("request") || err.message.toLowerCase().includes("required")
      );
    });

    it("does not invent a test count or a deploy time", async () => {
      const writes = [];
      const pattern = {
        id: "pat1",
        name: "router middleware",
        description: "http router",
        category: "web",
        subcategory: "middleware",
        language: "javascript",
      };
      const capturing = {
        exec: () => {},
        prepare: (sql) => ({
          run: (row) => { writes.push(row); return { changes: 1 }; },
          get: () => null,
          all: () => (sql.includes("FROM code_patterns") && !sql.includes("COUNT") ? [pattern] : []),
        }),
      };
      const { createCodeEngine } = await import("../lib/code-engine.js");
      const local = createCodeEngine(capturing);
      const generation = local.generateLens("router middleware for http");
      assert.equal(generation, null);
      const completed = writes.filter((row) => row && row.status === "completed");
      assert.equal(completed.length, 1);
      assert.equal(completed[0].test_count, null);
      assert.equal(completed[0].deploy_time, null);
      assert.equal(completed[0].lens_name, "router-middleware-for-http-lens");
    });
  });

  describe("recordError", () => {
    it("validates errorType is required", () => {
      assert.throws(
        () => engine.recordError(null, {}),
        (err) => err.message.toLowerCase().includes("errortype") || err.message.toLowerCase().includes("required")
      );
    });

    it("throws NotFoundError for non-existent lens", () => {
      assert.throws(
        () => engine.recordError("nonexistent", { errorType: "runtime" }),
        (err) => err.code === "NOT_FOUND" || err.name === "NotFoundError"
      );
    });
  });

  describe("pattern categories", () => {
    it("supports expected categories", () => {
      const categories = engine.PATTERN_CATEGORIES;
      assert.ok(Array.isArray(categories));
      assert.ok(categories.length >= 4);
    });
  });
});
