// server/tests/state-snapshot-dtu-omission.test.js
//
// Pins the safety property behind omitting `dtus` from the state snapshot
// (server.js#_serializeState) as a memory fix.
//
// Background: _serializeState was called from ~291 debounced sites plus a
// 2-min and a 5-min timer, each producing a ~28 MB JSON string. Measured
// 2026-07-26, the serialized size was FLAT (28,055 -> 28,164 KB over 50 min)
// while the heap floor climbed 201 -> 355 MB — so nothing was accumulating;
// the cost was repeatedly minting 28 MB strings plus their live intermediate
// object graph. DTUs are the bulk of that payload and are ALREADY durably
// persisted by the write-through store, so serializing them again was double
// persistence.
//
// The risk this file exists to guard: dropping `dtus` from the snapshot is
// only safe because the store can restore them from SQLite at boot. If that
// round-trip ever breaks, a restart silently loses every DTU. These tests
// exercise the real store against a real SQLite DB — no mocks — because a
// mocked round-trip would prove nothing about the property that matters.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initDTUStore, createDTUStore } from "../lib/dtu-store.js";

let db;

function mkDtu(id, extra = {}) {
  return { id, title: `DTU ${id}`, tier: "regular", scope: "global", source: "test", ...extra };
}

beforeEach(() => {
  db = new Database(":memory:");
  // Creates the `dtu_store` table. Required before createDTUStore — without
  // it every persistToSQLite() fails inside its own try/catch and set()
  // silently keeps the DTU in memory only. server.js does this at :5833
  // (`_DTU_STORE_READY = initDTUStore(db)`) and only builds the store when it
  // returns true, which is what makes omitting `dtus` from the snapshot safe.
  initDTUStore(db);
});
afterEach(() => { try { db.close(); } catch { /* already closed */ } });

describe("state snapshot may omit dtus — the boot round-trip that makes it safe", () => {
  it("a fresh store with an EMPTY memory map restores every DTU from SQLite", () => {
    // Boot 1: DTUs written through the store.
    const first = createDTUStore(db, new Map(), { log: () => {} });
    first.set("d1", mkDtu("d1"));
    first.set("d2", mkDtu("d2"));
    first.set("d3", mkDtu("d3"));

    // Boot 2 — this is the scenario the fix creates: the snapshot no longer
    // carries `dtus`, so _hydrateState leaves the raw Map EMPTY.
    const emptyAfterRestart = new Map();
    const second = createDTUStore(db, emptyAfterRestart, { log: () => {} });
    assert.equal(emptyAfterRestart.size, 0, "precondition: cache starts empty");

    const res = second.rehydrateFromSQLite();

    assert.equal(res.loaded, 3, "all three DTUs restored from SQLite");
    assert.equal(res.errors, 0);
    // values() reads the memory cache with no SQLite fallback, so this is the
    // assertion that actually matters — an un-hydrated cache would break every
    // caller that iterates STATE.dtus.
    assert.equal([...second.values()].length, 3);
    assert.equal(second.get("d2").title, "DTU d2");
  });

  it("migrate-then-hydrate yields the UNION, and is idempotent", () => {
    // Snapshot-only DTU (as if loaded from an older snapshot that still had
    // `dtus`) plus a SQLite-only DTU written by a previous boot.
    const prior = createDTUStore(db, new Map(), { log: () => {} });
    prior.set("sqlite-only", mkDtu("sqlite-only"));

    const fromSnapshot = new Map([["snapshot-only", mkDtu("snapshot-only")]]);
    const store = createDTUStore(db, fromSnapshot, { log: () => {} });

    // Boot order in server.js: migrate first (snapshot -> SQLite), then
    // hydrate (SQLite -> memory). Neither direction may drop anything.
    store.migrateMemoryToSQLite();
    store.rehydrateFromSQLite();

    const ids = [...store.values()].map((d) => d.id).sort();
    assert.deepEqual(ids, ["snapshot-only", "sqlite-only"], "union, not replacement");

    // Running the pair again must not duplicate or drop.
    store.migrateMemoryToSQLite();
    store.rehydrateFromSQLite();
    assert.deepEqual([...store.values()].map((d) => d.id).sort(), ["snapshot-only", "sqlite-only"]);
  });

  it("a DTU mutated after boot survives the next restart", () => {
    const first = createDTUStore(db, new Map(), { log: () => {} });
    first.set("d1", mkDtu("d1", { title: "before" }));
    first.set("d1", mkDtu("d1", { title: "after" }));

    const second = createDTUStore(db, new Map(), { log: () => {} });
    second.rehydrateFromSQLite();
    assert.equal(second.get("d1").title, "after", "latest write wins across restart");
  });

  it("a deleted DTU does not come back on restart", () => {
    const first = createDTUStore(db, new Map(), { log: () => {} });
    first.set("d1", mkDtu("d1"));
    first.set("d2", mkDtu("d2"));
    first.delete("d1");

    const second = createDTUStore(db, new Map(), { log: () => {} });
    second.rehydrateFromSQLite();
    assert.deepEqual([...second.values()].map((d) => d.id), ["d2"]);
  });
});

describe("the guard that decides whether omitting dtus is safe", () => {
  // _serializeState omits `dtus` only when STATE.dtus is the write-through
  // store, detected by capability rather than a boot flag. If STATE.dtus is
  // still a plain Map — no SQLite, minimal build — the DTUs have NO other
  // durable home and MUST stay in the snapshot.
  const guard = (dtus) => typeof dtus?.rehydrateFromSQLite === "function";

  it("is TRUE for the write-through store (safe to omit — SQLite owns durability)", () => {
    const store = createDTUStore(db, new Map(), { log: () => {} });
    assert.equal(guard(store), true);
  });

  it("is FALSE for a plain Map (must keep serializing or a restart loses everything)", () => {
    assert.equal(guard(new Map()), false);
  });

  it("is FALSE for null/undefined rather than throwing", () => {
    assert.equal(guard(null), false);
    assert.equal(guard(undefined), false);
  });

  it("a store built with no db still reports the capability, and degrades honestly", () => {
    // createDTUStore(null, ...) has no SQLite to persist to. The guard is
    // shape-based, so this is the one case where it would answer "safe to
    // omit" without a real durable home — assert the honest failure so the
    // behaviour is documented rather than discovered in production.
    const noDbStore = createDTUStore(null, new Map(), { log: () => {} });
    assert.equal(guard(noDbStore), true, "shape-based guard cannot see the missing db");
    assert.equal(noDbStore.rehydrateFromSQLite().noDb, true, "but rehydrate reports noDb honestly");
    // server.js only builds the store under `if (_DTU_STORE_READY && db)`, so
    // this combination cannot arise there. This test pins that dependency.
  });
});
