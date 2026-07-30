// server/tests/write-through-store-survival.test.js
//
// Pins the two independent boot bugs that between them kept the DTU
// write-through store detached for its entire existence (found 2026-07-28).
//
// Symptom that exposed them: with the artifact store working (snapshot key
// absent, 19.3MB -> 9.4MB), `dtus` was STILL in the snapshot at 8.17 MB —
// 87% of what remained — and a live probe showed
// `STATE.dtus.rehydrateFromSQLite === undefined` even though the store's own
// boot logs reported `migrated:2003, hydrate loaded:2289`.
//
// ─── BUG A — _ensureMap destroyed the store, every boot ─────────────────────
// Boot order is:
//     ~11817  loadStateFromDisk() -> _hydrateState -> put(STATE.dtus, ...)
//     ~11864  DTU store attaches:  STATE.dtus = dtuStore
//     ~12016  [...].forEach(_ensureMap)          <-- AFTER the attach
// and `_ensureMap` was `if (!(STATE[key] instanceof Map)) STATE[key] = new Map()`.
// `createDTUStore` returns a plain OBJECT with Map-shaped methods, so the
// instanceof test failed and the freshly-hydrated store was replaced with an
// EMPTY Map. `_serializeState`'s omission check then saw no store and wrote
// all 8.17 MB of DTUs into every snapshot.
//
// STATE.lensArtifacts was immune only because LensArtifactStore extends Map —
// a choice made for domains/astronomy.js:817's identical guard, which turns
// out to have dodged this one too.
//
// ─── BUG B — put() cleared unconditionally ──────────────────────────────────
// `_hydrateState`'s `put(map, arr)` did `map.clear()` before checking whether
// the snapshot actually carried the collection. For a store-owned collection
// the key is legitimately absent, so it wiped the just-hydrated store and
// restored nothing — the same missing key that made the clear wrong also
// skipped the repopulate loop.
//
// The two mask each other, which is why fixing either ALONE looks broken:
//   A alone  -> store survives, so the snapshot omits `dtus`, so B empties it
//               (measured: STATE.dtus went to 0 while dtu_store held 2,290 rows)
//   B alone  -> store is still destroyed by A, so nothing changes
// They must land together.
//
// Run: node --test server/tests/write-through-store-survival.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDTUStore } from "../lib/dtu-store.js";
import { LensArtifactStore } from "../lib/lens-artifact-store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, "../server.js"), "utf8");

// Rebuild the shipped predicate from source so this tracks the real code.
const isMapLike = (() => {
  const m = SRC.match(/const _isMapLike = \(v\) =>([\s\S]*?);\n/);
  assert.ok(m, "_isMapLike not found in server.js — bug A's fix is gone");
  // eslint-disable-next-line no-new-func
  return new Function("v", `return (${m[1].trim()});`);
})();

describe("BUG A — _ensureMap must not destroy a write-through store", () => {
  it("accepts the DTU store (a plain object with Map methods)", () => {
    // The exact value that failed `instanceof Map` and got replaced.
    assert.equal(isMapLike(createDTUStore(null, new Map(), {})), true);
  });

  it("accepts the artifact store and a plain Map", () => {
    assert.equal(isMapLike(new LensArtifactStore(null)), true);
    assert.equal(isMapLike(new Map()), true);
  });

  it("STILL replaces genuinely broken values — the guard's real purpose", () => {
    // This line exists to repair hydration edge cases. Widening it must not
    // turn it into a no-op, or a corrupt STATE key silently stays corrupt.
    for (const bad of [null, undefined, {}, [], "map", 42, { get() {} }]) {
      assert.equal(isMapLike(bad), false, `${JSON.stringify(bad)} should be replaced`);
    }
  });

  it("the guard is capability-based, not instanceof-based, in the shipped code", () => {
    assert.match(SRC, /const _ensureMap = \(key\) => \{ if \(!_isMapLike\(STATE\[key\]\)\) STATE\[key\] = new Map\(\); \};/);
    assert.ok(
      !/const _ensureMap = \(key\) => \{ if \(!\(STATE\[key\] instanceof Map\)\)/.test(SRC),
      "the bare instanceof form is back — it destroys the DTU store on every boot",
    );
  });
});

describe("BUG B — put() must not clear when the snapshot omits the key", () => {
  // Reproduce the shipped helper's semantics against a stand-in store.
  const put = (map, arr) => {
    if (!Array.isArray(arr)) return;
    map.clear();
    for (const x of arr) if (x && x.id) map.set(x.id, x);
  };

  it("leaves a store-owned collection alone when the key is absent", () => {
    // The real scenario: the store hydrated from SQLite, and the snapshot
    // legitimately has no `dtus` key because SQLite owns it.
    const hydrated = new Map([["d1", { id: "d1" }], ["d2", { id: "d2" }]]);
    put(hydrated, undefined);
    assert.equal(hydrated.size, 2, "an absent key wiped the hydrated store");
  });

  it("still replaces wholesale when the snapshot DOES carry the collection", () => {
    // Unchanged behaviour for the normal case — this is what stops the fix
    // from being "just skip restoring".
    const m = new Map([["old", { id: "old" }]]);
    put(m, [{ id: "new1" }, { id: "new2" }]);
    assert.deepEqual([...m.keys()], ["new1", "new2"]);
  });

  it("an empty array still clears — that is a real instruction, not an absence", () => {
    const m = new Map([["old", { id: "old" }]]);
    put(m, []);
    assert.equal(m.size, 0, "an explicit empty array must clear");
  });

  it("the shipped helper checks BEFORE clearing", () => {
    const at = SRC.indexOf("const put = (map, arr) => {");
    assert.ok(at > 0, "put() helper not found");
    const body = SRC.slice(at, at + 200);
    const guardAt = body.indexOf("if (!Array.isArray(arr)) return;");
    const clearAt = body.indexOf("map.clear()");
    assert.ok(guardAt > 0, "the absent-key guard is gone — store-owned collections get wiped");
    assert.ok(guardAt < clearAt, "the guard must precede the clear, or it does nothing");
  });
});

describe("BUG C — cascade-recovery must not 'rebuild' a live store", () => {
  const CASCADE = readFileSync(path.join(HERE, "../lib/cascade-recovery.js"), "utf8");

  it("uses a capability check for Map, not bare instanceof", () => {
    // Found by TRACING, after reasoning about it wrongly three times: an
    // env-gated setter trap on STATE.dtus printed
    //   at buildMissingFeatures (lib/cascade-recovery.js:362)
    //   at fullRecoverySequence (lib/cascade-recovery.js:481)
    // It treated the hydrated DTU store as a "missing Map" and replaced it with
    // an empty one — while logging `created missing Map`, which is why the
    // "Built 2 missing features/structures" line read as normal.
    assert.match(CASCADE, /const present = Ctor === Map \? isMapLike\(STATE\[key\]\) : STATE\[key\] instanceof Ctor;/);
    assert.ok(
      !/if \(!\(STATE\[key\] instanceof Ctor\)\) \{/.test(CASCADE),
      "the bare instanceof form is back — it destroys the DTU store on every boot",
    );
  });

  it("non-Map constructors keep exact instanceof semantics", () => {
    // The fix must stay narrow: only Map gets the capability treatment.
    assert.match(CASCADE, /: STATE\[key\] instanceof Ctor;/);
  });
});

describe("the three fixes are paired — none works alone", () => {
  it("all three are present in the shipped source", () => {
    // Recorded because fixing any ONE alone looks broken:
    //   A alone -> store survives _ensureMap, snapshot omits dtus, B empties it
    //   B alone -> A still destroys the store, nothing changes
    //   A+B     -> C still destroys it (measured: size 0 with 2,290 rows in SQLite)
    const CASCADE = readFileSync(path.join(HERE, "../lib/cascade-recovery.js"), "utf8");
    assert.match(SRC, /_isMapLike\(STATE\[key\]\)/, "bug A fix missing");
    assert.match(SRC, /const put = \(map, arr\) => \{\s*\n\s*if \(!Array\.isArray\(arr\)\) return;/, "bug B fix missing");
    assert.match(CASCADE, /Ctor === Map \? isMapLike\(STATE\[key\]\)/, "bug C fix missing");
  });
});
