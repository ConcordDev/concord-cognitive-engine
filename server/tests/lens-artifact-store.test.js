// server/tests/lens-artifact-store.test.js
//
// Pins the write-through artifact store (2026-07-28).
//
// Context: `STATE.lensArtifacts` held 11,517 artifacts / 9.86 MB with no cap
// and no durable store — the largest key in the ~19 MB state snapshot, and
// persisted ONLY by that snapshot. This store gives artifacts row-level
// durability and lets the snapshot drop them.
//
// The `instanceof Map` suite is the load-bearing one. `lib/dtu-store.js` — the
// pattern this otherwise mirrors — returns a plain object, and doing that here
// would have been a silent data-loss bug: domains/astronomy.js:817 reads
//   if (!(STATE.lensArtifacts instanceof Map)) STATE.lensArtifacts = new Map();
// so an object-literal store gets REPLACED with an empty Map on the first
// co-observe call, dropping every artifact and detaching write-through for the
// rest of the process's life.
//
// Run: node --test server/tests/lens-artifact-store.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LensArtifactStore, createLensArtifactStore } from "../lib/lens-artifact-store.js";
import { up as createTable } from "../migrations/398_lens_artifact_store.js";

let Database;
before(async () => { Database = (await import("better-sqlite3")).default; });

function freshDb() {
  const db = new Database(":memory:");
  createTable(db);
  return db;
}
const artifact = (id, over = {}) => ({
  id, domain: "code", type: "snippet", ownerId: "u1",
  title: `art ${id}`, data: { body: "x" }, ...over,
});

describe("LensArtifactStore — IS a real Map (the data-loss guard)", () => {
  it("passes instanceof Map", () => {
    const s = new LensArtifactStore(freshDb());
    assert.ok(s instanceof Map, "MUST be instanceof Map or astronomy.js:817 replaces it with an empty Map");
  });

  it("survives the exact astronomy.js:817 guard without being replaced", () => {
    // Reproduce the real call site rather than trusting the instanceof check
    // alone, since that line is what would destroy the store.
    const STATE = { lensArtifacts: new LensArtifactStore(freshDb()) };
    STATE.lensArtifacts.set("a1", artifact("a1"));
    if (!(STATE.lensArtifacts instanceof Map)) STATE.lensArtifacts = new Map();
    assert.equal(STATE.lensArtifacts.size, 1, "the guard wiped the store");
    assert.ok(STATE.lensArtifacts instanceof LensArtifactStore, "store was swapped for a plain Map");
  });

  it("inherits the full read surface unchanged", () => {
    const s = new LensArtifactStore(freshDb());
    s.set("a1", artifact("a1"));
    s.set("a2", artifact("a2"));
    assert.equal(s.size, 2);
    assert.equal(s.has("a1"), true);
    assert.equal(s.get("a2").title, "art a2");
    assert.deepEqual([...s.keys()].sort(), ["a1", "a2"]);
    assert.equal([...s.values()].length, 2);
    assert.equal([...s.entries()].length, 2);
    assert.equal([...s].length, 2, "spread/Symbol.iterator must work");
    let seen = 0; s.forEach(() => seen++);
    assert.equal(seen, 2, "forEach must work");
    // Array.from(...values()) is the real pattern repair-cortex.js:4186 uses.
    assert.equal(Array.from(s.values()).filter((a) => a.domain === "code").length, 2);
  });
});

describe("LensArtifactStore — write-through", () => {
  it("set() persists a row", () => {
    const db = freshDb();
    const s = new LensArtifactStore(db);
    s.set("a1", artifact("a1"));
    const row = db.prepare("SELECT * FROM lens_artifact_store WHERE id = ?").get("a1");
    assert.ok(row, "no row written");
    assert.equal(row.domain, "code");
    assert.equal(row.owner_id, "u1");
    assert.equal(JSON.parse(row.data).title, "art a1");
  });

  it("set() on an existing id updates rather than duplicating", () => {
    const db = freshDb();
    const s = new LensArtifactStore(db);
    s.set("a1", artifact("a1"));
    s.set("a1", artifact("a1", { title: "renamed" }));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM lens_artifact_store").get().n, 1);
    assert.equal(
      JSON.parse(db.prepare("SELECT data FROM lens_artifact_store WHERE id=?").get("a1").data).title,
      "renamed",
    );
  });

  it("delete() removes the row and reports prior existence", () => {
    const db = freshDb();
    const s = new LensArtifactStore(db);
    s.set("a1", artifact("a1"));
    assert.equal(s.delete("a1"), true);
    assert.equal(s.delete("a1"), false, "must preserve Map#delete's boolean contract");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM lens_artifact_store").get().n, 0);
  });

  it("clear() empties both memory and table", () => {
    const db = freshDb();
    const s = new LensArtifactStore(db);
    s.set("a1", artifact("a1")); s.set("a2", artifact("a2"));
    s.clear();
    assert.equal(s.size, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM lens_artifact_store").get().n, 0);
  });
});

describe("LensArtifactStore — durability round-trip", () => {
  it("a NEW store over the same db recovers every artifact", () => {
    // This is the property that lets the state snapshot stop carrying
    // artifacts at all: a fresh process must be able to rebuild them.
    const db = freshDb();
    const first = new LensArtifactStore(db);
    for (let i = 0; i < 25; i++) first.set(`a${i}`, artifact(`a${i}`));

    const second = new LensArtifactStore(db);
    assert.equal(second.size, 0, "a fresh store starts empty");
    const r = second.rehydrateFromSQLite();
    assert.equal(r.loaded, 25);
    assert.equal(r.errors, 0);
    assert.equal(second.size, 25);
    assert.equal(second.get("a7").title, "art a7");
  });

  it("hydrate does not write the rows it just read back", () => {
    // Without the _hydrating guard this re-persists every row on every boot —
    // N pointless writes and a needless WAL churn at the worst moment.
    const db = freshDb();
    const s = new LensArtifactStore(db);
    s.set("a1", artifact("a1"));
    const before = db.prepare("SELECT updated_at FROM lens_artifact_store WHERE id=?").get("a1").updated_at;
    const s2 = new LensArtifactStore(db);
    s2.rehydrateFromSQLite();
    const after = db.prepare("SELECT updated_at FROM lens_artifact_store WHERE id=?").get("a1").updated_at;
    assert.equal(after, before, "hydrate wrote rows back");
  });

  it("migrateMemoryToSQLite lifts snapshot-only artifacts into the table, idempotently", () => {
    const db = freshDb();
    const legacy = new Map([["a1", artifact("a1")], ["a2", artifact("a2")]]);
    const s = createLensArtifactStore(db, legacy);
    assert.equal(s.size, 2, "seeding must not lose entries");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM lens_artifact_store").get().n, 0,
      "seeding is memory-only; migration is an explicit separate step");

    assert.equal(s.migrateMemoryToSQLite().migrated, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM lens_artifact_store").get().n, 2);
    s.migrateMemoryToSQLite();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM lens_artifact_store").get().n, 2, "not idempotent");
  });

  it("migrate-then-hydrate yields the UNION, like the dtu_store boot pairing", () => {
    const db = freshDb();
    new LensArtifactStore(db).set("onlyInDb", artifact("onlyInDb"));
    const s = createLensArtifactStore(db, new Map([["onlyInMemory", artifact("onlyInMemory")]]));
    s.migrateMemoryToSQLite();
    s.rehydrateFromSQLite();
    assert.deepEqual([...s.keys()].sort(), ["onlyInDb", "onlyInMemory"]);
  });
});

describe("server.js wiring — the paired snapshot contract", () => {
  // These are source assertions because the properties are structural: they
  // concern WHICH code runs and in what order at boot, which a unit test over
  // the store alone cannot observe.
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js"), "utf8",
  );

  it("the snapshot omits artifacts ONLY when the store is active", () => {
    // Unconditional omission would lose every artifact on a build whose
    // migrations have not reached 398, where nothing else persists them.
    assert.match(SRC, /const artifactStoreActive = typeof STATE\.lensArtifacts\?\.rehydrateFromSQLite === "function"/);
    assert.match(SRC, /\.\.\.\(artifactStoreActive \? \{\} : \{ lensArtifacts: toArr\(STATE\.lensArtifacts\) \}\)/);
  });

  it("boot migrates BEFORE it hydrates (union, not overwrite)", () => {
    const migrateAt = SRC.indexOf("lens_artifact_store_boot_migration");
    const hydrateAt = SRC.indexOf("lens_artifact_store_boot_hydrate");
    assert.ok(migrateAt > 0 && hydrateAt > 0, "boot wiring not found");
    assert.ok(
      migrateAt < hydrateAt,
      "hydrate before migrate would drop artifacts that exist only in an older snapshot",
    );
  });

  it("attach is gated on the table existing, and never fatal", () => {
    assert.match(SRC, /name='lens_artifact_store'/);
    assert.match(SRC, /lens_artifact_store_init_failed/);
  });

  it("🔴 restore's clear() is INSIDE the presence check", () => {
    // The data-loss shape this guards: with the store active the snapshot has
    // no `lensArtifacts` key, so an unconditional `STATE.lensArtifacts.clear()`
    // would wipe memory AND — because the store's clear() writes through —
    // TRUNCATE lens_artifact_store, while the repopulate loop is skipped by the
    // very same missing key. Correct snapshot, every artifact destroyed.
    const at = SRC.indexOf("if (Array.isArray(obj.lensArtifacts)) {");
    assert.ok(at > 0, "the guarded restore block is gone — clear() may be unconditional again");
    const block = SRC.slice(at, at + 260);
    assert.match(block, /STATE\.lensArtifacts\.clear\(\)/,
      "clear() should still happen for snapshots that DO carry artifacts");
    // And prove there is no bare clear() immediately preceding the guard.
    const before = SRC.slice(Math.max(0, at - 200), at);
    assert.doesNotMatch(before, /^\s*STATE\.lensArtifacts\.clear\(\);\s*$/m,
      "an unconditional clear() still precedes the presence check");
  });
});

describe("LensArtifactStore — degrades honestly, never throws", () => {
  it("works with no database at all (memory-only build)", () => {
    const s = new LensArtifactStore(null);
    s.set("a1", artifact("a1"));
    assert.equal(s.get("a1").title, "art a1");
    assert.equal(s.delete("a1"), true);
    assert.doesNotThrow(() => s.clear());
    assert.deepEqual(s.rehydrateFromSQLite(), { loaded: 0, errors: 0, noDb: true });
  });

  it("a failing write does NOT break the in-memory write", () => {
    // A transient storage fault must not turn every artifact mutation into a
    // user-visible error; memory is written first for exactly this reason.
    const db = freshDb();
    const s = new LensArtifactStore(db);
    s.set("a1", artifact("a1"));
    db.prepare("DROP TABLE lens_artifact_store").run();
    assert.doesNotThrow(() => s.set("a2", artifact("a2")));
    assert.equal(s.get("a2").title, "art a2", "memory write was lost on storage failure");
    assert.ok(s.stats().writeErrors > 0, "the failure must be counted, not swallowed silently");
  });

  it("stats() reports memory and row counts for diagnostics", () => {
    const db = freshDb();
    const s = new LensArtifactStore(db);
    s.set("a1", artifact("a1"));
    const st = s.stats();
    assert.equal(st.memory, 1);
    assert.equal(st.rows, 1);
    assert.equal(st.backed, true);
  });
});
