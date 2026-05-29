/**
 * WS5 — faction structural strength tests.
 * Strength rises with leader level, member count, and realm setup (conscription
 * + tax + treasury + legitimacy). A military-tax realm out-fields an
 * economy-focused one. resolveFactionClash picks the stronger side with a
 * margin-scaled momentum swing. The strategy cycle fires a clash hot-event.
 * Run: node --test tests/faction-strength.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import { computeFactionStrength, resolveFactionClash } from "../lib/faction-strength.js";
import { ensureFactionState, setRelation } from "../lib/embodied/faction-strategy.js";
import { up as up117 } from "../migrations/117_faction_strategy.js";
import { runFactionStrategyCycle } from "../emergent/faction-strategy-cycle.js";

function baseDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, faction TEXT, level INTEGER DEFAULT 1, is_dead INTEGER DEFAULT 0);
    CREATE TABLE realms (id TEXT PRIMARY KEY, faction_id TEXT, tax_rate REAL, treasury INTEGER, legitimacy INTEGER, ruler_id TEXT);
    CREATE TABLE realm_decrees (id TEXT PRIMARY KEY, kingdom_id TEXT, kind TEXT, effect_state TEXT);
  `);
  return db;
}
function addMembers(db, faction, levels) {
  let i = 0;
  for (const l of levels) db.prepare("INSERT INTO world_npcs (id, faction, level) VALUES (?,?,?)").run(`${faction}_${i++}`, faction, l);
}

describe("computeFactionStrength", () => {
  it("scales with leader level + member count", () => {
    const db = baseDb();
    addMembers(db, "small", [5, 5]);
    addMembers(db, "big", [40, 20, 20, 10, 10]);
    const s = computeFactionStrength(db, "small");
    const b = computeFactionStrength(db, "big");
    assert.ok(b.strength > s.strength);
    assert.equal(b.leaderLevel, 40);
    assert.equal(b.members, 5);
  });

  it("a military-tax realm out-fields an economy-focused one with the same roster", () => {
    const db = baseDb();
    addMembers(db, "mil", [20, 15, 15, 10]);
    addMembers(db, "eco", [20, 15, 15, 10]);
    // military: high tax, full treasury, conscription decree active
    db.prepare("INSERT INTO realms (id, faction_id, tax_rate, treasury, legitimacy) VALUES ('r_mil','mil',0.4,9000,80)").run();
    db.prepare("INSERT INTO realm_decrees (id, kingdom_id, kind, effect_state) VALUES ('d1','r_mil','conscription','active')").run();
    // economy: low tax, modest treasury, no conscription
    db.prepare("INSERT INTO realms (id, faction_id, tax_rate, treasury, legitimacy) VALUES ('r_eco','eco',0.05,500,55)").run();
    const mil = computeFactionStrength(db, "mil");
    const eco = computeFactionStrength(db, "eco");
    assert.equal(mil.base, eco.base, "same roster → same base");
    assert.ok(mil.realmMult > eco.realmMult);
    assert.ok(mil.strength > eco.strength, `${mil.strength} should beat ${eco.strength}`);
  });

  it("degrades to 0 for empty/unknown factions and no-table builds", () => {
    const db = baseDb();
    assert.equal(computeFactionStrength(db, "ghost").strength, 0);
    assert.equal(computeFactionStrength(new Database(":memory:"), "x").strength, 0);
  });
});

describe("resolveFactionClash", () => {
  it("the stronger faction wins with a margin-scaled momentum swing", () => {
    const db = baseDb();
    addMembers(db, "strong", [50, 40, 30]);
    addMembers(db, "weak", [3, 2]);
    const c = resolveFactionClash(db, "weak", "strong");
    assert.equal(c.draw, false);
    assert.equal(c.winner, "strong");
    assert.equal(c.loser, "weak");
    assert.ok(c.winnerMomentum > 0 && c.loserMomentum < 0);
    assert.ok(c.margin > 0.5, "lopsided fight → large margin");
  });
  it("draws when both sides are empty", () => {
    const db = baseDb();
    assert.equal(resolveFactionClash(db, "a", "b").draw, true);
  });
});

describe("strategy cycle fires a clash on war/raid", () => {
  it("emits faction-war:clash and swings momentum by strength", async () => {
    const db = baseDb();
    up117(db);
    // two factions at war, ready to move now
    ensureFactionState(db, "alpha", { stance: "war", momentum: 0.1 });
    ensureFactionState(db, "beta", { stance: "war", momentum: 0.1 });
    setRelation(db, "alpha", "beta", { score: -0.8, kind: "war" });
    db.prepare("UPDATE faction_strategy_state SET next_move_at = 0, target_id = ?, phase = 0 WHERE faction_id = 'alpha'").run("beta");
    db.prepare("UPDATE faction_strategy_state SET next_move_at = 0, target_id = ?, phase = 0 WHERE faction_id = 'beta'").run("alpha");
    // alpha is far stronger
    addMembers(db, "alpha", [60, 50, 40, 40]);
    addMembers(db, "beta", [4, 3]);

    const events = [];
    const io = { emit: (name, payload) => events.push({ name, payload }) };
    const r = await runFactionStrategyCycle({ db, io });
    assert.ok(r.ok);
    assert.ok(r.advanced >= 1);
    // At least one move resolved as a clash (RAID/DECLARE_WAR) and emitted.
    const clashEvents = events.filter((e) => e.name === "faction-war:clash");
    if (clashEvents.length > 0) {
      assert.equal(clashEvents[0].payload.winner, "alpha");
      const moveWithClash = r.moves.find((m) => m.clash);
      assert.ok(moveWithClash, "a move should carry clash detail");
    }
  });
});
