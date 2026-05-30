/**
 * Living Society — Phase 12: emergent ideology (the recruitment attractor).
 *
 *   - a faction holds a persisted position vector on its world's axes;
 *   - ideological distance ranks candidates → recruit along SHARED position
 *     (the attractor), not at random;
 *   - an NPC's personal position derives from faction + archetype;
 *   - hypocrisy (professed vs revealed strategy) is detected + alerted;
 *   - an echo-chamber (near-identical faction positions) is detected.
 *
 * Run: node --test tests/ideology.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up290 } from "../migrations/290_ideology.js";
import {
  setFactionIdeology, positionFor, ideologicalDistance, npcPosition,
  recruitAlongPosition, detectFactionGoodhart, detectEchoChamber, axesForWorld,
} from "../lib/ideology.js";

const W = "concordia-hub";
function mkDb() {
  const db = new Database(":memory:");
  up290(db);
  db.exec(`CREATE TABLE faction_strategy_log (id TEXT PRIMARY KEY, faction_id TEXT, move TEXT, occurred_at INTEGER DEFAULT (unixepoch()));`);
  return db;
}

describe("Phase 12 — position vectors", () => {
  it("persists + reads a faction position on the world's axes", () => {
    const db = mkDb();
    setFactionIdeology(db, W, "wardens", { order_freedom: 0.8, tradition_progress: 0.4, collective_individual: -0.2 });
    const p = positionFor(db, W, "wardens");
    assert.equal(p.order_freedom, 0.8);
    assert.ok(axesForWorld(W).includes("order_freedom"));
  });

  it("ideological distance is 0 for identical, larger for opposed", () => {
    const a = { order_freedom: 0.8, tradition_progress: 0.0, collective_individual: 0.0 };
    const b = { order_freedom: -0.8, tradition_progress: 0.0, collective_individual: 0.0 };
    assert.equal(ideologicalDistance(a, a, W), 0);
    assert.ok(ideologicalDistance(a, b, W) > 1);
  });

  it("an NPC position derives from faction + archetype nudge", () => {
    const db = mkDb();
    setFactionIdeology(db, W, "wardens", { order_freedom: 0.5 });
    const guard = npcPosition(db, W, { faction: "wardens", archetype: "guard" });
    const trader = npcPosition(db, W, { faction: "wardens", archetype: "trader" });
    assert.ok(guard.order_freedom > trader.order_freedom, "a guard leans more order than a trader");
  });
});

describe("Phase 12 — the recruitment attractor", () => {
  it("ranks candidates by ideological proximity (recruit the closest)", () => {
    const db = mkDb();
    setFactionIdeology(db, W, "freedom_cell", { order_freedom: -0.8 });
    setFactionIdeology(db, W, "order_guild", { order_freedom: 0.8 });
    const founderPos = { order_freedom: -0.8, tradition_progress: 0, collective_individual: 0 };
    const ranked = recruitAlongPosition(db, W, founderPos, [
      { id: "aligned", faction: "freedom_cell", archetype: "scholar" },
      { id: "opposed", faction: "order_guild", archetype: "guard" },
    ]);
    assert.equal(ranked[0].id, "aligned", "the ideologically-aligned candidate ranks first");
    assert.ok(ranked[0].distance < ranked[1].distance);
  });
});

describe("Phase 12 — political weather", () => {
  it("detects a hypocrisy gap (professed peace vs revealed war)", () => {
    const db = mkDb();
    // professes maximal freedom / peace
    setFactionIdeology(db, W, "peace_party", { order_freedom: -0.9, tradition_progress: 0, collective_individual: 0 });
    // but its moves reveal war + fortify (order-heavy)
    for (const m of ["DECLARE_WAR", "FORTIFY", "DECLARE_WAR"]) db.prepare(`INSERT INTO faction_strategy_log (id, faction_id, move) VALUES (?, 'peace_party', ?)`).run(`l_${m}_${Math.random()}`, m);
    const r = detectFactionGoodhart(db, W, "peace_party", { threshold: 0.5 });
    assert.equal(r.hypocrisy, true);
    assert.ok(db.prepare(`SELECT 1 FROM ideology_alerts WHERE kind='goodhart_hypocrisy' AND subject_id='peace_party'`).get());
  });

  it("detects an echo-chamber of near-identical positions", () => {
    const db = mkDb();
    for (const f of ["a", "b", "c"]) setFactionIdeology(db, W, f, { order_freedom: 0.5, tradition_progress: 0.5, collective_individual: 0.5 });
    const r = detectEchoChamber(db, W, { threshold: 0.25 });
    assert.equal(r.echoChamber, true);
  });
});
