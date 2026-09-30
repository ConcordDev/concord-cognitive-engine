/**
 * DTU Store Test Suite
 *
 * Tests the write-through DTU store with:
 *   - initDTUStore() table creation
 *   - createDTUStore() Map-compatible API
 *   - Memory-first reads with SQLite fallback
 *   - Write-through persistence
 *   - Migration and rehydration
 *   - Tier and scope queries
 *   - Metrics and iteration
 *   - Memory-only fallback when db is null
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { initDTUStore, createDTUStore } from "../lib/dtu-store.js";

// ── Mock SQLite DB ──────────────────────────────────────────────────────────

function createMockDB() {
  const tables = {};
  const rows = {};  // table -> array of row objects

  rows.dtu_store = [];

  const db = {
    _execCalls: [],
    _prepareCalls: [],
    exec(sql) {
      db._execCalls.push(sql);
    },
    prepare(sql) {
      db._prepareCalls.push(sql);
      return {
        run(...params) {
          if (sql.includes("INSERT OR REPLACE INTO dtu_store")) {
            const [id, title, tier, scope, tags, source, created_at, updated_at, data] = params;
            // Remove existing with same id
            rows.dtu_store = rows.dtu_store.filter(r => r.id !== id);
            rows.dtu_store.push({ id, title, tier, scope, tags, source, created_at, updated_at, data });
            return { changes: 1 };
          }
          if (sql.includes("DELETE FROM dtu_store WHERE id")) {
            const before = rows.dtu_store.length;
            rows.dtu_store = rows.dtu_store.filter(r => r.id !== params[0]);
            return { changes: before - rows.dtu_store.length };
          }
          return { changes: 0 };
        },
        get(...params) {
          if (sql.includes("SELECT data FROM dtu_store WHERE id")) {
            const row = rows.dtu_store.find(r => r.id === params[0]);
            return row ? { data: row.data } : undefined;
          }
          if (sql.includes("SELECT COUNT")) {
            return { count: rows.dtu_store.length };
          }
          if (sql.includes("SELECT 1 FROM dtu_store WHERE id")) {
            const exists = rows.dtu_store.some(r => r.id === params[0]);
            return exists ? { 1: 1 } : undefined;
          }
          return undefined;
        },
        all(...params) {
          if (sql.includes("SELECT data FROM dtu_store WHERE tier")) {
            return rows.dtu_store
              .filter(r => r.tier === params[0])
              .map(r => ({ data: r.data }));
          }
          if (sql.includes("SELECT data FROM dtu_store WHERE scope")) {
            return rows.dtu_store
              .filter(r => r.scope === params[0])
              .map(r => ({ data: r.data }));
          }
          if (sql === "SELECT data FROM dtu_store" || sql.includes("SELECT data FROM dtu_store")) {
            return rows.dtu_store.map(r => ({ data: r.data }));
          }
          return [];
        },
      };
    },
    transaction(fn) {
      return (...args) => fn(...args);
    },
  };

  return { db, rows };
}

// ── initDTUStore ────────────────────────────────────────────────────────────

describe("initDTUStore", () => {
  it("returns false when db is null", () => {
    assert.equal(initDTUStore(null), false);
  });

  it("returns false when db is undefined", () => {
    assert.equal(initDTUStore(undefined), false);
  });

  it("creates tables and returns true on success", () => {
    const { db } = createMockDB();
    const result = initDTUStore(db);
    assert.equal(result, true);
    // First exec is the CREATE TABLE + base indexes.
    assert.ok(db._execCalls.length >= 1);
    assert.ok(db._execCalls[0].includes("CREATE TABLE IF NOT EXISTS dtu_store"));
    assert.ok(db._execCalls[0].includes("idx_dtu_tier"));
    assert.ok(db._execCalls[0].includes("idx_dtu_scope"));
    assert.ok(db._execCalls[0].includes("idx_dtu_source"));
    assert.ok(db._execCalls[0].includes("idx_dtu_updated"));
    // Migration 442 (Concurrency Refactor Phase 3): visibility columns + list
    // indexes are ensured here too (guarded per-column) so a fresh install that
    // hasn't run the migration still gets them.
    const all = db._execCalls.join("\n");
    assert.ok(all.includes("ADD COLUMN owner_user_id"));
    assert.ok(all.includes("ADD COLUMN visibility"));
    assert.ok(all.includes("idx_dtu_store_owner"));
    assert.ok(all.includes("idx_dtu_store_list"));
  });

  it("returns false on exec error", () => {
    const db = {
      exec() { throw new Error("SQLite error"); },
    };
    const result = initDTUStore(db);
    assert.equal(result, false);
  });
});

// ── createDTUStore — basic Map API ──────────────────────────────────────────

describe("createDTUStore", () => {
  let db, rows, memoryMap, store;

  beforeEach(() => {
    const mock = createMockDB();
    db = mock.db;
    rows = mock.rows;
    memoryMap = new Map();
    store = createDTUStore(db, memoryMap);
  });

  describe("set()", () => {
    it("writes to both SQLite and memory", () => {
      const dtu = { id: "dtu-1", title: "Test", tier: "regular", scope: "global", tags: ["a"], source: "sys" };
      store.set("dtu-1", dtu);

      assert.equal(memoryMap.has("dtu-1"), true);
      assert.equal(rows.dtu_store.length, 1);
      assert.equal(rows.dtu_store[0].id, "dtu-1");
      assert.equal(rows.dtu_store[0].title, "Test");
      assert.equal(rows.dtu_store[0].tier, "regular");
    });

    it("defaults missing fields in SQLite persistence", () => {
      const dtu = { id: "dtu-2" };
      store.set("dtu-2", dtu);

      assert.equal(rows.dtu_store[0].title, "");
      assert.equal(rows.dtu_store[0].tier, "regular");
      assert.equal(rows.dtu_store[0].scope, "global");
      assert.equal(rows.dtu_store[0].source, "system");
    });

    it("serializes DTU as JSON data column", () => {
      const dtu = { id: "dtu-3", title: "Data Test", custom: { nested: true } };
      store.set("dtu-3", dtu);

      const parsed = JSON.parse(rows.dtu_store[0].data);
      assert.deepEqual(parsed, dtu);
    });

    it("returns the memory map (Map-compatible return)", () => {
      const dtu = { id: "dtu-4" };
      const result = store.set("dtu-4", dtu);
      assert.equal(result, memoryMap);
    });
  });

  describe("get()", () => {
    it("returns from memory (hot path)", () => {
      const dtu = { id: "dtu-1", title: "Memory" };
      memoryMap.set("dtu-1", dtu);

      const result = store.get("dtu-1");
      assert.deepEqual(result, dtu);
    });

    it("falls back to SQLite (cold path) and warms cache", () => {
      const dtu = { id: "dtu-cold", title: "Cold" };
      rows.dtu_store.push({
        id: "dtu-cold",
        title: "Cold",
        tier: "regular",
        scope: "global",
        tags: "[]",
        source: "sys",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
        data: JSON.stringify(dtu),
      });

      const result = store.get("dtu-cold");
      assert.deepEqual(result, dtu);
      // Verify cache is now warm
      assert.equal(memoryMap.has("dtu-cold"), true);
    });

    it("returns undefined when not found in either store", () => {
      const result = store.get("nonexistent");
      assert.equal(result, undefined);
    });
  });

  describe("has()", () => {
    it("returns true from memory", () => {
      memoryMap.set("mem-1", { id: "mem-1" });
      assert.equal(store.has("mem-1"), true);
    });

    it("returns true from SQLite when not in memory", () => {
      rows.dtu_store.push({ id: "sql-1", data: "{}" });
      assert.equal(store.has("sql-1"), true);
    });

    it("returns false when not found", () => {
      assert.equal(store.has("ghost"), false);
    });
  });

  describe("delete()", () => {
    it("deletes from both memory and SQLite", () => {
      const dtu = { id: "del-1" };
      store.set("del-1", dtu);
      assert.equal(memoryMap.has("del-1"), true);
      assert.equal(rows.dtu_store.length, 1);

      const result = store.delete("del-1");
      assert.equal(result, true);
      assert.equal(memoryMap.has("del-1"), false);
      assert.equal(rows.dtu_store.length, 0);
    });

    it("returns false when key does not exist in memory", () => {
      const result = store.delete("nonexistent");
      assert.equal(result, false);
    });
  });

  describe("size", () => {
    it("returns count from SQLite (authoritative)", () => {
      store.set("a", { id: "a" });
      store.set("b", { id: "b" });
      assert.equal(store.size, 2);
    });

    it("returns 0 for empty store", () => {
      assert.equal(store.size, 0);
    });
  });

  describe("iteration methods", () => {
    beforeEach(() => {
      memoryMap.set("x", { id: "x" });
      memoryMap.set("y", { id: "y" });
    });

    it("values() iterates over memory map", () => {
      const vals = Array.from(store.values());
      assert.equal(vals.length, 2);
      assert.deepEqual(vals[0], { id: "x" });
    });

    it("entries() iterates over memory map", () => {
      const entries = Array.from(store.entries());
      assert.equal(entries.length, 2);
      assert.deepEqual(entries[0], ["x", { id: "x" }]);
    });

    it("keys() iterates over memory map", () => {
      const keys = Array.from(store.keys());
      assert.deepEqual(keys, ["x", "y"]);
    });

    it("forEach() delegates to memory map", () => {
      const collected = [];
      store.forEach((val, key) => collected.push(key));
      assert.deepEqual(collected, ["x", "y"]);
    });

    it("Symbol.iterator works for spread/for-of", () => {
      const pairs = [...store];
      assert.equal(pairs.length, 2);
      assert.deepEqual(pairs[0], ["x", { id: "x" }]);
    });
  });

  describe("clear()", () => {
    it("clears both memory and SQLite", () => {
      store.set("c1", { id: "c1" });
      store.set("c2", { id: "c2" });
      assert.equal(memoryMap.size, 2);

      store.clear();
      assert.equal(memoryMap.size, 0);
      // Verify exec was called for DELETE
      assert.ok(db._execCalls.some(s => s.includes("DELETE FROM dtu_store")));
    });
  });

  describe("migrateMemoryToSQLite()", () => {
    it("migrates all memory entries to SQLite", () => {
      memoryMap.set("m1", { id: "m1", title: "M1" });
      memoryMap.set("m2", { id: "m2", title: "M2" });

      const result = store.migrateMemoryToSQLite();
      assert.equal(result.migrated, 2);
      assert.equal(result.errors, 0);
      assert.equal(rows.dtu_store.length, 2);
    });

    it("skips on second call (idempotent)", () => {
      memoryMap.set("m1", { id: "m1" });
      store.migrateMemoryToSQLite();
      const result = store.migrateMemoryToSQLite();
      assert.equal(result.skipped, true);
      assert.equal(result.migrated, 0);
    });
  });

  describe("rehydrateFromSQLite()", () => {
    it("loads all SQLite rows into memory", () => {
      rows.dtu_store.push(
        { id: "r1", data: JSON.stringify({ id: "r1", title: "Rehydrated 1" }) },
        { id: "r2", data: JSON.stringify({ id: "r2", title: "Rehydrated 2" }) },
      );

      const result = store.rehydrateFromSQLite();
      assert.equal(result.loaded, 2);
      assert.equal(result.errors, 0);
      assert.equal(memoryMap.size, 2);
      assert.equal(memoryMap.get("r1").title, "Rehydrated 1");
    });

    it("handles corrupt JSON rows gracefully", () => {
      rows.dtu_store.push(
        { id: "good", data: JSON.stringify({ id: "good" }) },
        { id: "bad", data: "{{invalid json" },
      );

      const result = store.rehydrateFromSQLite();
      assert.equal(result.loaded, 1);
      assert.equal(result.errors, 1);
    });

    it("skips rows without id field", () => {
      rows.dtu_store.push(
        { id: "noid", data: JSON.stringify({ title: "no id field" }) },
      );

      const result = store.rehydrateFromSQLite();
      assert.equal(result.loaded, 0);
    });
  });

  describe("getByTier()", () => {
    it("returns DTUs matching tier from SQLite", () => {
      store.set("t1", { id: "t1", tier: "mega", title: "Mega 1" });
      store.set("t2", { id: "t2", tier: "regular", title: "Regular 1" });
      store.set("t3", { id: "t3", tier: "mega", title: "Mega 2" });

      const megas = store.getByTier("mega");
      assert.equal(megas.length, 2);
      assert.ok(megas.every(d => d.tier === "mega"));
    });

    it("returns empty array for unmatched tier", () => {
      const result = store.getByTier("hyper");
      assert.deepEqual(result, []);
    });
  });

  describe("getByScope()", () => {
    it("returns DTUs matching scope from SQLite", () => {
      store.set("s1", { id: "s1", scope: "regional", title: "R1" });
      store.set("s2", { id: "s2", scope: "global", title: "G1" });

      const regionals = store.getByScope("regional");
      assert.equal(regionals.length, 1);
      assert.equal(regionals[0].scope, "regional");
    });
  });

  describe("getMetrics()", () => {
    it("returns metric snapshot", () => {
      store.set("m1", { id: "m1" });
      store.set("m2", { id: "m2" });

      const metrics = store.getMetrics();
      assert.equal(metrics.memoryCount, 2);
      assert.equal(metrics.sqliteCount, 2);
      assert.equal(metrics.hasSQLite, true);
      assert.equal(metrics.migrated, false);
    });

    it("reports migrated=true after migration", () => {
      store.migrateMemoryToSQLite();
      assert.equal(store.getMetrics().migrated, true);
    });
  });
});

// ── Memory-only mode (no db) ────────────────────────────────────────────────

describe("createDTUStore — memory-only (db=null)", () => {
  let memoryMap, store;

  beforeEach(() => {
    memoryMap = new Map();
    store = createDTUStore(null, memoryMap);
  });

  it("set() and get() work purely in memory", () => {
    store.set("mem-1", { id: "mem-1", title: "In-Memory" });
    const result = store.get("mem-1");
    assert.equal(result.title, "In-Memory");
  });

  it("has() checks only memory", () => {
    store.set("mem-2", { id: "mem-2" });
    assert.equal(store.has("mem-2"), true);
    assert.equal(store.has("nope"), false);
  });

  it("delete() works in memory", () => {
    store.set("mem-3", { id: "mem-3" });
    store.delete("mem-3");
    assert.equal(store.has("mem-3"), false);
  });

  it("size uses memory count", () => {
    store.set("a", { id: "a" });
    store.set("b", { id: "b" });
    assert.equal(store.size, 2);
  });

  it("clear() clears memory", () => {
    store.set("c", { id: "c" });
    store.clear();
    assert.equal(store.size, 0);
  });

  it("migrateMemoryToSQLite() returns noDb indicator", () => {
    const result = store.migrateMemoryToSQLite();
    assert.equal(result.noDb, true);
  });

  it("rehydrateFromSQLite() returns noDb indicator", () => {
    const result = store.rehydrateFromSQLite();
    assert.equal(result.noDb, true);
  });

  it("getByTier() falls back to memory filter", () => {
    store.set("t1", { id: "t1", tier: "mega" });
    store.set("t2", { id: "t2", tier: "regular" });
    const megas = store.getByTier("mega");
    assert.equal(megas.length, 1);
    assert.equal(megas[0].tier, "mega");
  });

  it("getByScope() falls back to memory filter", () => {
    store.set("s1", { id: "s1", scope: "regional" });
    store.set("s2", { id: "s2", scope: "global" });
    const regionals = store.getByScope("regional");
    assert.equal(regionals.length, 1);
  });

  it("getMetrics() reports hasSQLite=false", () => {
    const metrics = store.getMetrics();
    assert.equal(metrics.hasSQLite, false);
    assert.equal(metrics.sqliteCount, 0);
  });
});

// ── Logging ─────────────────────────────────────────────────────────────────

describe("createDTUStore — logging", () => {
  it("calls log function on rehydrate", () => {
    const logs = [];
    const { db, rows } = createMockDB();
    rows.dtu_store.push({ id: "r1", data: JSON.stringify({ id: "r1" }) });
    const store = createDTUStore(db, new Map(), {
      log: (level, event, data) => logs.push({ level, event, data }),
    });

    store.rehydrateFromSQLite();
    assert.ok(logs.some(l => l.event === "dtu_store_rehydrated"));
  });

  it("calls log function on migration complete", () => {
    const logs = [];
    const { db } = createMockDB();
    const memoryMap = new Map();
    memoryMap.set("x", { id: "x" });
    const store = createDTUStore(db, memoryMap, {
      log: (level, event, data) => logs.push({ level, event, data }),
    });

    store.migrateMemoryToSQLite();
    assert.ok(logs.some(l => l.event === "dtu_store_migration_complete"));
  });
});
