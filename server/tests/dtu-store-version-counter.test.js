// server/tests/dtu-store-version-counter.test.js
//
// Pins lib/dtu-store.js#getVersion() — the counter that lets
// server.js#buildCognitiveSnapshot() skip rebuilding its ~60s cognitive-worker
// snapshot when nothing has changed.
//
// Background: buildCognitiveSnapshot() rebuilds a full copy of every DTU's
// core/human/machine/meta payload into a fresh array on every heartbeat tick
// (default 60s) whenever the cognitive worker is ready and any of
// autogen/dream/evolution/synth is enabled — which is every one of them, by
// default. This is architecturally identical to the state-snapshot bug fixed
// alongside this: an unconditional full-corpus deep copy on a timer. It was
// NOT gated by CONCORD_DISABLE_HEARTBEAT, so it ran in both arms of the
// bisect that measured "no difference" between heartbeats on/off — meaning
// this loop had never actually been isolated as a leak candidate until now.
//
// getVersion() is bumped centrally inside the store's own set()/delete()
// (and migrate/rehydrate), rather than relying on the loosely-coupled global
// saveStateDebounced() mutation funnel — deliberately, because a spot-check
// found at least one STATE.shadowDtus.set() call site with no nearby
// saveStateDebounced() call, and trusting that funnel for a correctness-
// sensitive cache (staleness in a generative pipeline is a real bug, not
// just wasted cycles) would have been the wrong tradeoff.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initDTUStore, createDTUStore } from "../lib/dtu-store.js";

let db;
beforeEach(() => { db = new Database(":memory:"); initDTUStore(db); });
afterEach(() => { try { db.close(); } catch { /* already closed */ } });

function mkDtu(id, extra = {}) {
  return { id, title: `DTU ${id}`, tier: "regular", scope: "global", source: "test", ...extra };
}

describe("dtu-store getVersion() — the signal buildCognitiveSnapshot's cache trusts", () => {
  it("starts at 0 on a fresh store", () => {
    const store = createDTUStore(db, new Map(), { log: () => {} });
    assert.equal(store.getVersion(), 0);
  });

  it("bumps on set() for a new DTU", () => {
    const store = createDTUStore(db, new Map(), { log: () => {} });
    const before = store.getVersion();
    store.set("d1", mkDtu("d1"));
    assert.equal(store.getVersion(), before + 1);
  });

  it("bumps on set() for an OVERWRITE of an existing DTU (mutation, not just insertion)", () => {
    const store = createDTUStore(db, new Map(), { log: () => {} });
    store.set("d1", mkDtu("d1", { title: "before" }));
    const before = store.getVersion();
    store.set("d1", mkDtu("d1", { title: "after" }));
    assert.equal(store.getVersion(), before + 1, "an overwrite is still a real mutation the cache must see");
  });

  it("bumps on delete() of an existing DTU", () => {
    const store = createDTUStore(db, new Map(), { log: () => {} });
    store.set("d1", mkDtu("d1"));
    const before = store.getVersion();
    store.delete("d1");
    assert.equal(store.getVersion(), before + 1);
  });

  it("does NOT bump on delete() of something that was never there", () => {
    const store = createDTUStore(db, new Map(), { log: () => {} });
    const before = store.getVersion();
    const result = store.delete("never-existed");
    assert.equal(result, false);
    assert.equal(store.getVersion(), before, "a no-op delete must not falsely invalidate the cache");
  });

  it("does NOT bump on a pure read (get/has/values)", () => {
    const store = createDTUStore(db, new Map(), { log: () => {} });
    store.set("d1", mkDtu("d1"));
    const before = store.getVersion();
    store.get("d1");
    store.has("d1");
    void [...store.values()];
    assert.equal(store.getVersion(), before);
  });

  it("bumps on migrateMemoryToSQLite() when it actually migrates something", () => {
    const seeded = new Map([["d1", mkDtu("d1")]]);
    const store = createDTUStore(db, seeded, { log: () => {} });
    const before = store.getVersion();
    const res = store.migrateMemoryToSQLite();
    assert.equal(res.migrated, 1);
    assert.equal(store.getVersion(), before + 1);
  });

  it("bumps on rehydrateFromSQLite() when it actually loads something", () => {
    const first = createDTUStore(db, new Map(), { log: () => {} });
    first.set("d1", mkDtu("d1"));

    const second = createDTUStore(db, new Map(), { log: () => {} });
    const before = second.getVersion();
    const res = second.rehydrateFromSQLite();
    assert.equal(res.loaded, 1);
    assert.equal(second.getVersion(), before + 1);
  });

  it("does not bump on a no-op rehydrate against an empty SQLite table", () => {
    const store = createDTUStore(db, new Map(), { log: () => {} });
    const before = store.getVersion();
    const res = store.rehydrateFromSQLite();
    assert.equal(res.loaded, 0);
    assert.equal(store.getVersion(), before);
  });
});

describe("the cache-guard shape server.js relies on", () => {
  // Mirrors the exact guard buildCognitiveSnapshot() uses, without pulling in
  // the 81k-line server.js — proves the CONTRACT the cache depends on: the
  // guard must distinguish the store (has getVersion) from a plain Map
  // (doesn't), matching the same capability-check pattern already used for
  // the write-through-store-vs-plain-Map decision in the state-snapshot fix.
  const hasVersion = (dtus) => typeof dtus?.getVersion === "function";

  it("is true for the write-through store", () => {
    const store = createDTUStore(db, new Map(), { log: () => {} });
    assert.equal(hasVersion(store), true);
  });

  it("is false for a plain Map (minimal build with no SQLite) — must always rebuild", () => {
    assert.equal(hasVersion(new Map()), false);
  });

  it("simulated cache: two consecutive builds with no mutation between them are identical by reference", () => {
    const store = createDTUStore(db, new Map(), { log: () => {} });
    store.set("d1", mkDtu("d1"));

    // Minimal re-implementation of buildCognitiveSnapshot's cache logic,
    // exercised against the real store — this is what proves the cache
    // actually avoids the rebuild, not just that getVersion() ticks correctly.
    let cache = null;
    let cacheVersion = -1;
    function buildEntries() {
      const v = store.getVersion();
      if (v === cacheVersion && cache) return cache;
      const entries = [...store.values()].map((d) => [d.id, { id: d.id, title: d.title }]);
      cache = entries;
      cacheVersion = v;
      return entries;
    }

    const first = buildEntries();
    const second = buildEntries();
    assert.equal(first, second, "no mutation occurred — must be the SAME array reference, not a rebuild");

    store.set("d2", mkDtu("d2"));
    const third = buildEntries();
    assert.notEqual(third, second, "a real mutation occurred — must rebuild");
    assert.equal(third.length, 2);
  });
});
