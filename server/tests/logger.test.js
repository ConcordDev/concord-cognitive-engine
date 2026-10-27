/**
 * Comprehensive tests for server/logger.js
 * Covers: log(), query(), getBuffer(), convenience methods (error/warn/info/debug), LEVELS
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

// We need to isolate module state between tests. Since logBuffer is module-level,
// we re-import dynamically or manipulate through the API.

// Direct import for type-checking the shape
import logger, { log, query, getBuffer, LEVELS } from "../logger.js";

describe("logger", () => {
  let originalError, originalWarn, originalLog;

  beforeEach(() => {
    // Suppress console output during tests
    originalError = console.error;
    originalWarn = console.warn;
    originalLog = console.log;
    console.error = mock.fn();
    console.warn = mock.fn();
    console.log = mock.fn();

    // Drain the buffer for isolation (pop everything)
    const buf = getBuffer();
    buf.length = 0;
  });

  afterEach(() => {
    console.error = originalError;
    console.warn = originalWarn;
    console.log = originalLog;
  });

  // ── LEVELS constant ──────────────────────────────────────────
  describe("LEVELS", () => {
    it("exports the correct numeric levels", () => {
      assert.deepStrictEqual(LEVELS, { error: 0, warn: 1, info: 2, debug: 3 });
    });
  });

  // ── log() ────────────────────────────────────────────────────
  describe("log()", () => {
    it("adds entry to the buffer with correct fields", () => {
      log("info", "server", "Boot complete", { lens: "music" });
      const buf = getBuffer();
      assert.equal(buf.length, 1);
      const e = buf[0];
      assert.equal(e.level, "info");
      assert.equal(e.source, "server");
      assert.equal(e.message, "Boot complete");
      assert.equal(e.lens, "music");
      assert.ok(e.timestamp);
    });

    it("sets lens to null when meta has no lens", () => {
      log("debug", "test", "msg");
      const buf = getBuffer();
      assert.equal(buf[0].lens, null);
    });

    it("defaults meta to empty object", () => {
      log("info", "test", "msg");
      const buf = getBuffer();
      assert.deepStrictEqual(buf[0].meta, {});
    });

    it("routes error level to console.error", () => {
      log("error", "src", "fail");
      assert.equal(console.error.mock.calls.length, 1);
      assert.ok(console.error.mock.calls[0].arguments[0].includes("[ERROR]"));
    });

    it("routes warn level to console.warn", () => {
      log("warn", "src", "caution");
      assert.equal(console.warn.mock.calls.length, 1);
      assert.ok(console.warn.mock.calls[0].arguments[0].includes("[WARN]"));
    });

    it("routes info level to console.log", () => {
      log("info", "src", "hello");
      assert.equal(console.log.mock.calls.length, 1);
      assert.ok(console.log.mock.calls[0].arguments[0].includes("[INFO]"));
    });

    it("routes debug level to console.log", () => {
      log("debug", "src", "trace");
      assert.equal(console.log.mock.calls.length, 1);
      assert.ok(console.log.mock.calls[0].arguments[0].includes("[DEBUG]"));
    });

    it("trims buffer when exceeding LOG_BUFFER_MAX (10000)", () => {
      const buf = getBuffer();
      // Fill to exactly 10000
      for (let i = 0; i < 10000; i++) {
        buf.push({ timestamp: new Date().toISOString(), level: "info", source: "fill", message: `m${i}`, meta: {}, lens: null });
      }
      assert.equal(buf.length, 10000);
      // Adding one more via log() should shift
      log("info", "test", "overflow");
      assert.equal(buf.length, 10000);
      assert.equal(buf[buf.length - 1].message, "overflow");
    });
  });

  // ── Convenience methods ──────────────────────────────────────
  describe("convenience methods", () => {
    it("logger.error calls log with error level", () => {
      logger.error("src", "err msg", { key: 1 });
      const e = getBuffer()[0];
      assert.equal(e.level, "error");
      assert.equal(e.source, "src");
      assert.equal(e.message, "err msg");
    });

    it("logger.warn calls log with warn level", () => {
      logger.warn("src", "warn msg", { key: 2 });
      const e = getBuffer()[0];
      assert.equal(e.level, "warn");
    });

    it("logger.info calls log with info level", () => {
      logger.info("src", "info msg", { key: 3 });
      const e = getBuffer()[0];
      assert.equal(e.level, "info");
    });

    it("logger.debug calls log with debug level", () => {
      logger.debug("src", "debug msg");
      const e = getBuffer()[0];
      assert.equal(e.level, "debug");
    });
  });

  // ── getBuffer() ──────────────────────────────────────────────
  describe("getBuffer()", () => {
    it("returns the underlying array reference", () => {
      const buf = getBuffer();
      assert.ok(Array.isArray(buf));
      log("info", "test", "x");
      assert.equal(buf.length, 1);
    });
  });

  // ── query() ──────────────────────────────────────────────────
  describe("query()", () => {
    beforeEach(() => {
      // Seed some entries
      log("error", "brain", "crash", { lens: "music" });
      log("warn", "server", "slow", { lens: "music" });
      log("info", "conscious", "chat", { lens: "code" });
      log("debug", "utility", "trace", { lens: "code" });
    });

    it("returns all entries when no filters given", () => {
      const results = query();
      assert.equal(results.length, 4);
    });

    it("filters by level (shows entries at or below that level)", () => {
      const results = query({ level: "warn" });
      // error(0) and warn(1) only
      assert.equal(results.length, 2);
      assert.ok(results.every(e => LEVELS[e.level] <= LEVELS.warn));
    });

    it("filters by level=error returns only errors", () => {
      const results = query({ level: "error" });
      assert.equal(results.length, 1);
      assert.equal(results[0].level, "error");
    });

    it("filters by level=debug returns everything", () => {
      const results = query({ level: "debug" });
      assert.equal(results.length, 4);
    });

    it("handles unknown level gracefully (defaults maxLevel to 3)", () => {
      const results = query({ level: "unknown_level" });
      // LEVELS["unknown_level"] is undefined, ?? 3 means maxLevel=3 = all
      assert.equal(results.length, 4);
    });

    it("filters by source", () => {
      const results = query({ source: "brain" });
      assert.equal(results.length, 1);
      assert.equal(results[0].source, "brain");
    });

    it("filters by lens", () => {
      const results = query({ lens: "music" });
      assert.equal(results.length, 2);
      assert.ok(results.every(e => e.lens === "music"));
    });

    it("filters by since (ISO date)", () => {
      const future = new Date(Date.now() + 60000).toISOString();
      const results = query({ since: future });
      assert.equal(results.length, 0);

      const past = new Date(Date.now() - 60000).toISOString();
      const results2 = query({ since: past });
      assert.equal(results2.length, 4);
    });

    it("filters by search (case-insensitive substring)", () => {
      const results = query({ search: "CRASH" });
      assert.equal(results.length, 1);
      assert.equal(results[0].message, "crash");
    });

    it("applies limit (defaults to 100, takes last N)", () => {
      const results = query({ limit: 2 });
      assert.equal(results.length, 2);
      // Takes last 2 entries
      assert.equal(results[0].source, "conscious");
      assert.equal(results[1].source, "utility");
    });

    it("combines multiple filters", () => {
      const results = query({ level: "info", lens: "code" });
      // level<=2 AND lens=code → info+debug with code lens, but level filter cuts debug(3)
      // Actually level "info" means maxLevel=2, so only error(0), warn(1), info(2)
      // Among those with lens "code": only the "info" entry
      assert.equal(results.length, 1);
      assert.equal(results[0].source, "conscious");
    });

    it("returns empty array for no matches", () => {
      const results = query({ source: "nonexistent" });
      assert.deepStrictEqual(results, []);
    });
  });

  // ── default export ───────────────────────────────────────────
  describe("default export", () => {
    it("exposes all expected methods", () => {
      assert.equal(typeof logger.log, "function");
      assert.equal(typeof logger.query, "function");
      assert.equal(typeof logger.getBuffer, "function");
      assert.equal(typeof logger.error, "function");
      assert.equal(typeof logger.warn, "function");
      assert.equal(typeof logger.info, "function");
      assert.equal(typeof logger.debug, "function");
    });
  });

  describe("lens action failed meta tail", () => {
    it("prints domain, action, error and 3 stack frames from scrubbed meta", () => {
      const stack = ["TypeError: boom", "at a (a.js:1)", "at b (b.js:2)", "at c (c.js:3)", "at d (d.js:4)"].join("\n");
      log("error", "lens-run", "lens action failed", { domain: "chem", action: "parse-smiles", error: "boom", stack, token: "sk-secret" });
      const line = console.error.mock.calls[0].arguments[0];
      assert.ok(line.includes('"domain":"chem"'));
      assert.ok(line.includes('"action":"parse-smiles"'));
      assert.ok(line.includes('"error":"boom"'));
      assert.ok(line.includes("at c (c.js:3)"));
      assert.ok(!line.includes("at d (d.js:4)"));
      assert.ok(!line.includes("sk-secret"));
    });

    it("caps the tail and leaves other error lines bare", () => {
      log("error", "lens-run", "lens action failed", { domain: "x", action: "y", error: "e".repeat(5000) });
      assert.ok(console.error.mock.calls[0].arguments[0].length < 700);
      log("error", "src", "other failure", { error: "hidden" });
      assert.ok(!console.error.mock.calls[1].arguments[0].includes("hidden"));
    });
  });
});
