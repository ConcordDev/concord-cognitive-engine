// Clears the wiring-gate BASELINE_BACKLOG: each previously-dormant resolver is
// now wired to a live call site. This pins the two with genuinely-new logic —
// the cross-world-scheme propose pass and the foundation-emergency resolver —
// plus the graceful no-op when their substrate is absent.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upMig166 } from "../migrations/166_cross_world_economy.js";
import { up as upMig167 } from "../migrations/167_cross_world_relationships.js";
import { setRelation } from "../lib/cross-world-relationships.js";
import { setKillSwitchMode } from "../lib/cross-world-economy.js";
import { runCrossWorldSchemeCycle } from "../emergent/cross-world-scheme-cycle.js";

import { initializeEmergency, triggerEmergency, resolveEmergency, getActiveEmergencies } from "../lib/foundation-emergency.js";

describe("cross-world scheme propose pass (proposeCrossWorldScheme wired)", () => {
  it("opens an intrigue scheme along a RIVAL cross-world tie", async () => {
    const db = new Database(":memory:");
    upMig166(db);
    upMig167(db);
    setKillSwitchMode(db, "live");
    // A rival resonance between an NPC in tunya and one in fantasy.
    setRelation(db, "tunya", "iyatte", "fantasy", "thorne_blackroot", { kind: "rival", resonanceStrength: 80 });

    const before = db.prepare(`SELECT COUNT(*) AS n FROM cross_world_schemes`).get().n;
    const res = await runCrossWorldSchemeCycle({ db });
    assert.equal(res.ok, true);
    assert.ok(res.proposed >= 1, `propose pass opened a scheme (proposed=${res.proposed})`);
    const rows = db.prepare(`SELECT kind FROM cross_world_schemes`).all();
    assert.ok(rows.length > before, "a cross-world scheme row now exists");
    assert.equal(rows[0].kind, "blackmail", "intrigue, not assassination");
    db.close();
  });

  it("no-ops gracefully when there are no rival ties", async () => {
    const db = new Database(":memory:");
    upMig166(db);
    upMig167(db);
    setKillSwitchMode(db, "live");
    setRelation(db, "tunya", "a", "fantasy", "b", { kind: "correspondent", resonanceStrength: 90 });
    const res = await runCrossWorldSchemeCycle({ db });
    assert.equal(res.ok, true);
    assert.equal(res.proposed, 0, "correspondents are not plotted against");
    db.close();
  });
});

describe("foundation emergency resolver (resolveEmergency wired)", () => {
  it("triggers then resolves an emergency", () => {
    const STATE = {};
    initializeEmergency(STATE);
    const t = triggerEmergency({ severity: 5, situation: "flood" }, STATE);
    const id = t.emergencyId || t.id || t.emergency?.id;
    assert.ok(id, "emergency created with an id");
    assert.ok(getActiveEmergencies().length >= 1);
    const r = resolveEmergency(id);
    assert.equal(r.ok, true);
    assert.ok(!getActiveEmergencies().some((e) => (e.id || e.emergencyId) === id), "no longer active");
  });
});
