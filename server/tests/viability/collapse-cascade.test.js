// Wave 5 #22 — collapse-cascade. Pins the pure cascade (over-extended factions
// fall when their dependency support collapses; diversified healthy ones
// resist; only alliance/tribute edges transmit) + the gated faction-cycle drag
// (off == today; on = an ally's fall drags a brittle dependent toward collapse).
//
// Run: node --test tests/viability/collapse-cascade.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../../migrate.js";
import {
  buildDependencyGraph,
  cascadeCollapse,
  factionFragility,
} from "../../lib/viability/collapse-cascade.js";
import { ensureFactionState, setRelation } from "../../lib/embodied/faction-strategy.js";
import { runFactionStrategyCycle } from "../../emergent/faction-strategy-cycle.js";

const FACTIONS = [
  { faction_id: "A", momentum: -0.7 }, // already collapsing (seed)
  { faction_id: "B", momentum: -0.4 }, // brittle, sole patron = A
  { faction_id: "C", momentum: 0.6 },  // healthy, two allies (B + D)
  { faction_id: "D", momentum: 0.6 },  // healthy, ally = C
];
const REL_ALLIANCE = [
  { faction_a: "A", faction_b: "B", kind: "alliance" },
  { faction_a: "B", faction_b: "C", kind: "alliance" },
  { faction_a: "C", faction_b: "D", kind: "alliance" },
];

describe("collapse-cascade (pure)", () => {
  it("fragility is the complement of viability (1 at the boundary, 0 at the top)", () => {
    assert.ok(Math.abs(factionFragility(-0.6) - 1) < 1e-9);
    assert.ok(Math.abs(factionFragility(1) - 0) < 1e-9);
  });

  it("only alliance/tribute edges transmit collapse — war edges don't", () => {
    const adj = buildDependencyGraph([
      { faction_a: "A", faction_b: "B", kind: "alliance" },
      { faction_a: "A", faction_b: "X", kind: "war" },
      { faction_a: "B", faction_b: "Y", kind: "tribute" },
    ]);
    assert.deepEqual(new Set(adj.A), new Set(["B"]));   // war edge to X dropped
    assert.ok(adj.B.includes("Y"));                      // tribute transmits
    assert.equal(adj.X, undefined);
  });

  it("a sole-patron brittle faction cascades; a diversified healthy one resists", () => {
    const r = cascadeCollapse(FACTIONS, REL_ALLIANCE);
    assert.deepEqual(r.seeds, ["A"]);
    assert.ok(r.cascaded.includes("B"), "brittle sole-patron B falls");
    assert.ok(!r.cascaded.includes("C"), "diversified healthy C resists");
    assert.ok(!r.cascaded.includes("D"), "D resists");
    assert.equal(r.systemicRiskClusterSize, 4); // A-B-C-D one allied bloc
  });

  it("an enemy's collapse does not drag you down", () => {
    const r = cascadeCollapse(
      [{ faction_id: "A", momentum: -0.9 }, { faction_id: "E", momentum: -0.3 }],
      [{ faction_a: "A", faction_b: "E", kind: "war" }],
    );
    assert.deepEqual(r.cascaded, []); // E only at WAR with the collapsing A
  });
});

describe("faction-cycle collapse drag (gated)", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    const future = Math.floor(Date.now() / 1000) + 99999;
    ensureFactionState(db, "A", { stance: "rebuild", momentum: -0.9 });           // pending now, stays a seed
    ensureFactionState(db, "B", { stance: "consolidate", momentum: -0.4, nextMoveAt: future });
    ensureFactionState(db, "C", { stance: "consolidate", momentum: 0.6, nextMoveAt: future });
    ensureFactionState(db, "D", { stance: "consolidate", momentum: 0.6, nextMoveAt: future });
    setRelation(db, "A", "B", { score: 0.7, kind: "alliance" });
    setRelation(db, "B", "C", { score: 0.7, kind: "alliance" });
    setRelation(db, "C", "D", { score: 0.7, kind: "alliance" });
  });
  afterEach(() => { delete process.env.CONCORD_COLLAPSE_CASCADE; try { db.close(); } catch { /* noop */ } });

  const momentumOf = (id) => db.prepare("SELECT momentum FROM faction_strategy_state WHERE faction_id = ?").get(id).momentum;

  it("OFF (default): the cascade does not run — B's momentum is untouched", async () => {
    const r = await runFactionStrategyCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.cascade, undefined);
    assert.ok(Math.abs(momentumOf("B") - (-0.4)) < 1e-9, "B unchanged off");
  });

  it("ON: a collapsing patron drags the brittle dependent down; the healthy bloc resists", async () => {
    process.env.CONCORD_COLLAPSE_CASCADE = "1";
    const r = await runFactionStrategyCycle({ db });
    assert.ok(r.cascade && r.cascade.cascaded >= 1);
    assert.ok(momentumOf("B") < -0.4 - 0.1, `B dragged down (now ${momentumOf("B")})`);
    assert.ok(Math.abs(momentumOf("D") - 0.6) < 1e-9, "healthy D resists");
  });
});
