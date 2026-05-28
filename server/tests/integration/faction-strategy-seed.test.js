/**
 * T1.1 — Faction strategy cold-start seed.
 *
 * The Layer-11 faction-strategy cycle only advances faction_strategy_state rows
 * that already exist, and nothing seeded them — so the EVE-style "factions war
 * while you sleep" layer was fully built (cycle + sockets + EmergentEventFeed)
 * but dark on a fresh boot: zero rows -> zero moves -> no wars, ever.
 *
 * seedFactionStrategyState (now called by content-seeder after the kingdom
 * pass) seeds a strategy row + initial relations from authored
 * rival_factions/allied_factions. This test proves: (1) seeding is non-empty
 * and idempotent, (2) the cycle then advances factions and logs moves with
 * zero player activity, (3) a war surfaces through the real emit path the
 * EmergentEventFeed consumes.
 *
 * Run: node --test tests/integration/faction-strategy-seed.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up117 } from "../../migrations/117_faction_strategy.js";
import {
  seedFactionStrategyState,
  ensureFactionState,
  getRelation,
  setRelation,
} from "../../lib/embodied/faction-strategy.js";
import { runFactionStrategyCycle } from "../../emergent/faction-strategy-cycle.js";

function setupDb() {
  const db = new Database(":memory:");
  up117(db);
  // faction-strategy-cycle reads getAuthoredFaction(...).leader for coping
  // trait; absent rows just return null (no bias) — fine for this test.
  db.exec(`CREATE TABLE IF NOT EXISTS npc_stress (npc_id TEXT PRIMARY KEY, stress INTEGER, coping_trait TEXT, coping_until INTEGER, last_break_at INTEGER, last_decay_at INTEGER, updated_at INTEGER);`);
  return db;
}

// Two mutual rivals (both expansionist) + one allied pair — the shape that
// makes wars and alliances emerge.
const FACTIONS = [
  { id: "sandrun", stance: "expand", rival_factions: ["medici"], allied_factions: ["fluxom"] },
  { id: "medici", stance: "expand", rival_factions: ["sandrun"] },
  { id: "fluxom", stance: "consolidate", allied_factions: ["sandrun"] },
];

describe("T1.1 — faction strategy seeding lights up the cycle", () => {
  let captured;
  beforeEach(() => { captured = []; globalThis._concordRealtimeEmit = (event, payload) => captured.push({ event, payload }); });
  afterEach(() => { delete globalThis._concordRealtimeEmit; });

  it("seeds a strategy row per faction + relations from authored rivalries", () => {
    const db = setupDb();
    const r = seedFactionStrategyState(db, FACTIONS);
    assert.equal(r.seeded, 3, "every authored faction gets a strategy row");
    assert.ok(r.relations >= 2, `should seed rival + ally relations, got ${r.relations}`);

    const rivalRel = getRelation(db, "sandrun", "medici");
    assert.equal(rivalRel.kind, "tension");
    assert.ok(rivalRel.score >= -0.3, "rival tension stays inside the war-collision window (>= -0.3)");

    const allyRel = getRelation(db, "sandrun", "fluxom");
    assert.ok(allyRel.score > 0.3, "ally relation enables PROPOSE_ALLIANCE");
  });

  it("is idempotent — re-seeding does not duplicate rows or clobber gameplay relations", () => {
    const db = setupDb();
    seedFactionStrategyState(db, FACTIONS);
    // simulate a gameplay-shaped relation
    setRelation(db, "sandrun", "medici", { score: -0.9, kind: "war" });
    const second = seedFactionStrategyState(db, FACTIONS);
    assert.equal(second.seeded, 0, "no new strategy rows on re-seed");
    assert.equal(getRelation(db, "sandrun", "medici").kind, "war", "gameplay relation preserved");
  });

  it("the cycle advances seeded factions and a war surfaces via the emit path (zero gameplay)", async () => {
    const db = setupDb();
    seedFactionStrategyState(db, FACTIONS);
    // ensureFactionState seeds next_move_at = now, so the first pass is due.
    // Run several passes; force readiness each time (cycle sets a 6h cooldown).
    let wars = 0, totalAdvanced = 0;
    for (let i = 0; i < 12; i++) {
      db.prepare(`UPDATE faction_strategy_state SET next_move_at = unixepoch() - 10`).run();
      const out = await runFactionStrategyCycle({ db });
      assert.equal(out.ok, true);
      totalAdvanced += out.advanced || 0;
    }
    assert.ok(totalAdvanced >= 1, "the cycle must advance seeded factions");

    const log = db.prepare(`SELECT COUNT(*) AS c FROM faction_strategy_log`).get();
    assert.ok(log.c >= 1, "moves are logged");

    wars = captured.filter(e => e.event === "faction:war-declared").length;
    assert.ok(wars >= 1, `at least one war/raid should surface over 12 passes, got ${wars}`);
    const war = captured.find(e => e.event === "faction:war-declared");
    assert.ok(war.payload.factionId && "summary" in war.payload, "war payload carries the surfacing fields");
  });

  it("does zero work + zero error when no factions are seeded (minimal build)", async () => {
    const db = setupDb();
    const out = await runFactionStrategyCycle({ db });
    assert.deepEqual({ ok: out.ok, advanced: out.advanced }, { ok: true, advanced: 0 });
  });
});
