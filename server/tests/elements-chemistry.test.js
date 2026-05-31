// WS-CHEMISTRY — the combinable element verbs. Pins: matrix reads the reaction
// table; apply writes the element's env signals into the grid (so the existing
// signal-propagation chemistry composes them); ignite/douse run the material
// check; unknown elements + missing actor are rejected.
//
// Run: node --test tests/elements-chemistry.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as mig112 from "../migrations/112_embodied_signals.js";
import * as mig113 from "../migrations/113_embodied_signal_log_unification.js";
import registerElementMacros from "../domains/elements.js";

function registry() {
  const m = new Map();
  registerElementMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
  return m;
}

let db;
beforeEach(() => {
  db = new Database(":memory:");
  try { mig112.up(db); mig113.up(db); } catch { /* table */ }
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("WS-CHEMISTRY element verbs", () => {
  it("matrix returns the reaction table + a pair lookup", async () => {
    const reg = registry();
    const all = await reg.get("elements.matrix")({}, {});
    assert.equal(all.ok, true);
    assert.ok(Array.isArray(all.elements) && all.elements.includes("fire"));
    const pair = await reg.get("elements.matrix")({}, { a: "fire", b: "water" });
    assert.equal(pair.ok, true);
    assert.ok(pair.pair.result);
  });

  it("apply writes env signals into the grid (composable chemistry)", async () => {
    const reg = registry();
    const out = await reg.get("elements.apply")({ db, actor: { userId: "u1" } },
      { worldId: "tunya", x: 10, z: 20, element: "fire", magnitude: 60 });
    assert.equal(out.ok, true);
    assert.ok(out.signalsWritten >= 1, "fire writes at least a thermal signal");
    // the signal landed in the embodied grid
    const rows = db.prepare(`SELECT COUNT(*) c FROM embodied_signal_log WHERE world_id='tunya' AND source='player_element'`).get();
    assert.ok(rows.c >= 1);
  });

  it("ignite reports whether the target material catches", async () => {
    const reg = registry();
    const out = await reg.get("elements.ignite")({ db, actor: { userId: "u1" } },
      { worldId: "tunya", x: 0, z: 0, targetMaterial: "wood" });
    assert.equal(out.ok, true);
    assert.equal(out.caught, true); // fire ignites wood
  });

  it("rejects unknown element + missing actor", async () => {
    const reg = registry();
    assert.equal((await reg.get("elements.apply")({ db, actor: { userId: "u" } }, { worldId: "w", element: "banana" })).reason, "unknown_element");
    assert.equal((await reg.get("elements.apply")({ db }, { worldId: "w", element: "fire" })).reason, "no_user");
  });
});
