// Integration test for Wave 7 / A6 — felt-per wired into the dream + forgetting path.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { gatherFragments, composeDeterministic } from "../lib/embodied/dream-engine.js";
import { retentionScore } from "../emergent/forgetting-engine.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE damage_events (
      id TEXT, world_id TEXT, attacker_id TEXT, attacker_type TEXT, target_id TEXT,
      target_type TEXT, element TEXT, final_damage REAL, kill INTEGER, occurred_at INTEGER
    );
  `);
  return db;
}

test("A6 wire — felt-per in dream + forgetting", async (t) => {
  await t.test("gatherFragments stamps feltPer on each fragment + computes peak/end", () => {
    const db = setupDb();
    const now = Math.floor(Date.now() / 1000);
    // a brutal hit taken (high-arousal negative) + a couple of light hits dealt
    db.prepare(`INSERT INTO damage_events VALUES ('e1','w','mob','npc','me','player','fire',90,0,?)`).run(now - 100);
    db.prepare(`INSERT INTO damage_events VALUES ('e2','w','me','player','mob','npc','physical',12,0,?)`).run(now - 50);
    const { fragments, summary } = gatherFragments(db, "me", { now });
    assert.ok(fragments.length >= 2);
    assert.ok(fragments.every((f) => f.feltPer && Number.isFinite(f.feltPer.intensity)), "every fragment is appraised");
    assert.ok(summary.peak, "a peak was selected");
    // the heavy hit-taken should be the peak (most intense)
    assert.ok(summary.peak.feltPer.valence < 0, "the peak felt is the painful hit");
  });

  await t.test("composeDeterministic surfaces the peak as a diary line + stamps machine.feltPer", () => {
    const db = setupDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO damage_events VALUES ('e1','w','mob','npc','me','player','fire',95,0,?)`).run(now - 100);
    const gathered = gatherFragments(db, "me", { now });
    const dream = composeDeterministic(gathered, "me");
    assert.ok(dream.machine.feltPer, "the surviving felt-per rides on machine.feltPer");
    assert.match(dream.human, /ache|cut deeper/i, "the painful peak reads as a diary line");
  });

  await t.test("retentionScore: a felt-peak DTU outlives a dull one (duration neglect)", () => {
    const base = { id: "d1", tier: "regular", createdAt: new Date().toISOString(), tags: [] };
    const dull = retentionScore({ ...base, machine: { feltPer: { intensity: 0.02, valence: 0.0 } } }, { dtus: new Map() });
    const peak = retentionScore({ ...base, id: "d2", machine: { feltPer: { intensity: 0.9, valence: -0.9 } } }, { dtus: new Map() });
    assert.ok(peak > dull, `the trauma (${peak.toFixed(3)}) is retained over the dull memory (${dull.toFixed(3)})`);
  });

  await t.test("no feltPer → retention unchanged (back-compat)", () => {
    const base = { id: "d3", tier: "regular", createdAt: new Date().toISOString(), tags: [] };
    const a = retentionScore({ ...base }, { dtus: new Map() });
    const b = retentionScore({ ...base, machine: {} }, { dtus: new Map() });
    assert.equal(a, b, "absent felt-per adds zero — existing DTUs score identically");
  });
});
