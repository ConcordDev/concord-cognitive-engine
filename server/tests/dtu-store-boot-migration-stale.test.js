// migrateMemoryToSQLite must not let a stale pre-attach memory copy replace
// a newer (or equally new) dtu_store row. That overwrite reverted ownership
// stamps every boot, so the ownership pass re-internalized the same rows on
// every restart.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initDTUStore, createDTUStore } from "../lib/dtu-store.js";

const quiet = { log: () => {} };
const T0 = "2026-10-27T10:00:00.000Z";
const T1 = "2026-10-27T12:00:00.000Z";

function seededDb(rows) {
  const db = new Database(":memory:");
  assert.ok(initDTUStore(db), "schema");
  const writer = createDTUStore(db, new Map(), quiet);
  for (const r of rows) writer.set(r.id, r);
  return db;
}
const stored = (db, id) => { const r = db.prepare("SELECT data FROM dtu_store WHERE id = ?").get(id); return r ? JSON.parse(r.data) : null; };

describe("migrateMemoryToSQLite stale-copy guard", () => {
  let db;
  beforeEach(() => {
    db = seededDb([
      { id: "stamped", title: "s", ownerId: "system", visibility: "internal", updatedAt: T1 },
      { id: "same", title: "same-disk", ownerId: "system", visibility: "internal", updatedAt: T1 },
      { id: "older", title: "older-disk", ownerId: "user_a", visibility: "public", updatedAt: T0 },
    ]);
  });

  it("skips copies that are older, equal, or have no/unparsable updatedAt; keeps the stored row", () => {
    const mem = new Map([
      ["stamped", { id: "stamped", title: "s", updatedAt: T0 }],
      ["same", { id: "same", title: "same-mem", updatedAt: T1 }],
      ["nots", { id: "nots" }],
    ]);
    // a row whose memory copy has no timestamp but that exists on disk
    createDTUStore(db, new Map(), quiet).set("nots", { id: "nots", title: "disk", ownerId: "system", updatedAt: T0 });
    mem.set("bad", { id: "bad", updatedAt: "not-a-date" });
    createDTUStore(db, new Map(), quiet).set("bad", { id: "bad", title: "disk-bad", updatedAt: T0 });

    const r = createDTUStore(db, mem, quiet).migrateMemoryToSQLite();
    assert.equal(r.migrated, 0);
    assert.equal(r.skippedStale, 4);
    assert.deepEqual(r.staleSample.sort(), ["bad", "nots", "same", "stamped"]);
    assert.equal(stored(db, "stamped").ownerId, "system", "ownership stamp survives");
    assert.equal(stored(db, "same").title, "same-disk");
    assert.equal(stored(db, "nots").title, "disk");
    assert.equal(stored(db, "bad").title, "disk-bad");
  });

  it("still writes strictly newer copies and rows missing from the store", () => {
    const mem = new Map([
      ["older", { id: "older", title: "newer-mem", ownerId: "user_a", visibility: "public", updatedAt: T1 }],
      ["fresh", { id: "fresh", title: "only in memory" }],
    ]);
    const r = createDTUStore(db, mem, quiet).migrateMemoryToSQLite();
    assert.equal(r.migrated, 2);
    assert.equal(r.skippedStale, 0);
    assert.equal(stored(db, "older").title, "newer-mem");
    assert.equal(stored(db, "fresh").title, "only in memory");
  });

  it("after migrate + rehydrate, the cache holds the stored (stamped) row, not the stale copy", () => {
    const mem = new Map([["stamped", { id: "stamped", title: "s", updatedAt: T0 }]]);
    const store = createDTUStore(db, mem, quiet);
    store.migrateMemoryToSQLite();
    store.rehydrateFromSQLite();
    assert.equal(store.get("stamped").ownerId, "system");
    assert.equal(store.get("stamped").visibility, "internal");
  });

  it("is still idempotent", () => {
    const store = createDTUStore(db, new Map([["fresh", { id: "fresh" }]]), quiet);
    assert.equal(store.migrateMemoryToSQLite().migrated, 1);
    assert.equal(store.migrateMemoryToSQLite().skipped, true);
  });
});

it("server.js logs the boot migration result (skippedStale + sample) as dtu_store_boot_migration", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.ok(src.includes('structuredLog("info", "dtu_store_boot_migration", migResult);'));
});
