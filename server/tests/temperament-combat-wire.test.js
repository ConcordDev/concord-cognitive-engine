// Wires the Temperament engine (P2–P5) into live gameplay. Pins the integration
// layer (lib/temperament-combat.js) + the P5 capture-cycle heartbeat against a
// real in-memory DB with the actual migrations (317 combat_state, 318 captures).
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up317 } from "../migrations/317_combat_restraint.js";
import { up as up318 } from "../migrations/318_npc_captures.js";
import {
  resolveHitTemperament, applyNpcDeescalation, resolvePlayerArrest, checkSpareBeforeHit, rungOf,
} from "../lib/temperament-combat.js";
import { runCaptureCycle } from "../emergent/capture-cycle.js";
import { getCombatState, setCombatState } from "../lib/combat-restraint.js";
import { getCapture } from "../lib/capture-transport.js";

function freshDb() {
  const db = new Database(":memory:");
  // Minimal world_npcs slice (317 ALTERs it; needs the base table first).
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, state TEXT DEFAULT '{}', is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE player_wanted (user_id TEXT, world_id TEXT, wanted_level INTEGER DEFAULT 0);
  `);
  up317(db);
  up318(db);
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype) VALUES ('n1','w1','guard')`).run();
  return db;
}

describe("temperament-combat (TEMPERAMENT on)", () => {
  beforeEach(() => { process.env.CONCORD_TEMPERAMENT = "1"; });
  afterEach(() => { delete process.env.CONCORD_TEMPERAMENT; });

  it("a sustained beating breaks morale → surrender → opens a capture", () => {
    const db = freshDb();
    let last = null;
    for (let i = 0; i < 40 && !(last && last.surrendered); i++) {
      last = resolveHitTemperament(db, { worldId: "w1", npc: { id: "n1", archetype: "guard" }, userId: "u1", damage: 25 });
    }
    assert.ok(last && last.surrendered, "morale eventually breaks");
    assert.equal(getCombatState(db, "n1").combatState, "surrendered");
    assert.ok(last.capture && last.capture.captureId, "a capture opened on surrender");
  });

  it("refuses lethal force on an already-surrendered NPC (spare gate)", () => {
    const db = freshDb();
    setCombatState(db, "n1", { combatState: "surrendered", morale: 0, surrenderedAt: Math.floor(Date.now() / 1000) });
    const spare = checkSpareBeforeHit(db, "n1");
    assert.equal(spare.spare, true);
    assert.equal(spare.reason, "hors_de_combat");
  });

  it("P2 de-escalation steps the intent rung down + persists", () => {
    const db = freshDb();
    assert.equal(rungOf(db, { id: "n1" }), "hostile"); // default for an engaged NPC
    const r = applyNpcDeescalation(db, { worldId: "w1", npc: { id: "n1", archetype: "guard" }, verb: "yield" });
    assert.equal(r.ok, true);
    assert.ok(r.deescalated, "yield dropped the rung");
    assert.equal(r.calmed, true, "hostile → warning leaves the engaged (hostile) state");
    assert.equal(rungOf(db, { id: "n1" }), r.rung, "rung persisted to state JSON");
    // comply stands the NPC fully down → neutral.
    const c = applyNpcDeescalation(db, { worldId: "w1", npc: { id: "n1" }, verb: "comply" });
    assert.equal(c.rung, "neutral");
    // unknown verb rejected.
    assert.equal(applyNpcDeescalation(db, { worldId: "w1", npc: { id: "n1" }, verb: "nope" }).reason, "unknown_verb");
  });

  it("P3 arrest: clean target → no offer; wanted target resolves comply/resist", () => {
    const db = freshDb();
    assert.equal(resolvePlayerArrest(db, { worldId: "w1", userId: "clean" }).offered, false);
    db.prepare(`INSERT INTO player_wanted (user_id, world_id, wanted_level) VALUES ('wanted','w1',2)`).run();
    const comply = resolvePlayerArrest(db, { worldId: "w1", userId: "wanted", verb: "yield" });
    assert.equal(comply.offered, true);
    assert.equal(comply.standDown, true);
    const resist = resolvePlayerArrest(db, { worldId: "w1", userId: "wanted", verb: "resist" });
    assert.equal(resist.standDown, false);
    assert.equal(resist.escalateTo, "hostile");
  });

  it("P5 capture-cycle hauls an active capture toward transported", async () => {
    const db = freshDb();
    setCombatState(db, "n1", { combatState: "surrendered", morale: 0, surrenderedAt: Math.floor(Date.now() / 1000) });
    // open a capture via the surrender path
    resolveHitTemperament(db, { worldId: "w1", npc: { id: "n1", archetype: "guard" }, userId: "u1", damage: 1 });
    const before = db.prepare(`SELECT id, stage FROM npc_captures WHERE npc_id='n1'`).get();
    assert.ok(before, "capture exists");
    await runCaptureCycle({ db });
    const after = getCapture(db, before.id);
    // either advanced a stage or escaped (random) — both are valid cycle outcomes
    assert.ok(["carried", "loaded", "transported", "escaped"].includes(after.stage), `stage advanced (${after.stage})`);
  });
});

describe("temperament-combat (TEMPERAMENT off → no-op)", () => {
  // TEMPERAMENT defaults ON now, so the off path must set the kill-switch explicitly.
  beforeEach(() => { process.env.CONCORD_TEMPERAMENT = "0"; });
  afterEach(() => { delete process.env.CONCORD_TEMPERAMENT; });
  it("resolveHitTemperament returns null + spare gate is inert", async () => {
    const db = freshDb();
    assert.equal(resolveHitTemperament(db, { worldId: "w1", npc: { id: "n1" }, userId: "u1", damage: 99 }), null);
    assert.equal(checkSpareBeforeHit(db, "n1").spare, false);
    assert.equal(applyNpcDeescalation(db, { worldId: "w1", npc: { id: "n1" }, verb: "yield" }).reason, "disabled");
    assert.equal((await runCaptureCycle({ db })).reason, "disabled");
  });
});
