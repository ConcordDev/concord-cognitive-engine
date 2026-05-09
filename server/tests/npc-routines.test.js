/**
 * Tier-2 contract tests for Phase 4a — NPC Daily Lives.
 *
 * Pinned:
 *   - composeScheduleForNpc determinism (same npc + day + preocc → same blocks)
 *   - archetype routing (warrior, scholar, mystic, default)
 *   - preoccupation overrides (war, rebuild, expand, isolation, personal_loss)
 *   - persistScheduleForNpc idempotent (overwrite on repeat)
 *   - currentBlockIdx + currentDaySeed
 *   - advanceRoutine block transition + nudge + arrival
 *   - regenerateSchedulesForFaction
 *   - heartbeat kill-switch + bounded
 *
 * Run: node --test tests/npc-routines.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  composeScheduleForNpc,
  persistScheduleForNpc,
  advanceRoutine,
  getActiveRoutine,
  regenerateSchedulesForFaction,
  currentDaySeed,
  currentBlockIdx,
  _internal,
} from "../lib/npc-routines.js";
import { runNpcRoutineCycle } from "../emergent/npc-routine-cycle.js";

// ── Fake DB ─────────────────────────────────────────────────────────────────

function makeFakeDb() {
  const tables = {
    npc_schedules: new Map(),
    npc_routine_state: new Map(),
    world_npcs: new Map(),
    world_visits: new Map(),
    npc_preoccupations: new Map(),
  };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return {
      run: (...a) => runStmt(s, a),
      get: (...a) => getStmt(s, a),
      all: (...a) => allStmt(s, a),
    };
  }
  function transaction(fn) { return (...args) => fn(...args); }

  function runStmt(sql, args) {
    if (sql.startsWith("DELETE FROM npc_schedules")) {
      const [npcId, daySeed] = args;
      let n = 0;
      for (const [id, r] of tables.npc_schedules) {
        if (r.npc_id === npcId && r.day_seed === daySeed) {
          tables.npc_schedules.delete(id); n++;
        }
      }
      return { changes: n };
    }
    if (sql.startsWith("INSERT INTO npc_schedules")) {
      const [id, npcId, blockIdx, activity, locKind, tx, tz, daySeed, sig] = args;
      tables.npc_schedules.set(id, {
        id, npc_id: npcId, block_idx: blockIdx, activity_kind: activity,
        location_kind: locKind, target_x: tx, target_z: tz,
        day_seed: daySeed, preoccupation_signature: sig,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO npc_routine_state")) {
      const [npcId, blockIdx, activity, locKind, tx, tz, started, expectedEnd] = args;
      tables.npc_routine_state.set(npcId, {
        npc_id: npcId, current_block: blockIdx, activity_kind: activity,
        location_kind: locKind, target_x: tx, target_z: tz,
        started_at: started, arrived_at: null, expected_end_at: expectedEnd,
        last_signal_at: null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE world_npcs SET current_location")) {
      const [json, id] = args;
      const n = tables.world_npcs.get(id);
      if (n) { n.current_location = json; return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE npc_routine_state SET arrived_at")) {
      const [npcId] = args;
      const r = tables.npc_routine_state.get(npcId);
      if (r && r.arrived_at == null) { r.arrived_at = Math.floor(Date.now() / 1000); return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE npc_routine_state SET last_signal_at")) {
      const [npcId] = args;
      const r = tables.npc_routine_state.get(npcId);
      if (r) { r.last_signal_at = Math.floor(Date.now() / 1000); return { changes: 1 }; }
      return { changes: 0 };
    }
    return { changes: 0 };
  }

  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM npc_schedules WHERE npc_id = ? AND day_seed = ? AND block_idx")) {
      const [npcId, daySeed, blockIdx] = args;
      for (const r of tables.npc_schedules.values()) {
        if (r.npc_id === npcId && r.day_seed === daySeed && r.block_idx === blockIdx) return r;
      }
      return null;
    }
    if (sql.startsWith("SELECT * FROM npc_routine_state WHERE npc_id = ?")) {
      return tables.npc_routine_state.get(args[0]) || null;
    }
    if (sql.startsWith("SELECT 1 FROM npc_schedules WHERE npc_id = ? AND day_seed = ?")) {
      const [npcId, daySeed] = args;
      for (const r of tables.npc_schedules.values()) {
        if (r.npc_id === npcId && r.day_seed === daySeed) return { 1: 1 };
      }
      return null;
    }
    if (sql.startsWith("SELECT last_signal_at FROM npc_routine_state WHERE npc_id = ?")) {
      const r = tables.npc_routine_state.get(args[0]);
      return r ? { last_signal_at: r.last_signal_at } : null;
    }
    if (sql.startsWith("SELECT pp.kind, pp.narrative")) {
      const [factionId] = args;
      for (const p of tables.npc_preoccupations.values()) {
        const n = tables.world_npcs.get(p.npc_id);
        if (n?.faction === factionId && p.kind === "faction_phase" && p.fades_at == null) return p;
      }
      return null;
    }
    return null;
  }

  function allStmt(sql, args) {
    if (sql.startsWith("SELECT id, archetype, faction, current_location, spawn_location, world_id FROM world_npcs WHERE faction = ?")) {
      const [factionId] = args;
      return Array.from(tables.world_npcs.values()).filter(n => n.faction === factionId && !n.is_dead);
    }
    if (sql.startsWith("SELECT id, archetype, faction, current_location, spawn_location, world_id FROM world_npcs WHERE world_id = ?")) {
      const [worldId, _limit] = args;
      return Array.from(tables.world_npcs.values()).filter(n => n.world_id === worldId && !n.is_dead);
    }
    if (sql.startsWith("SELECT DISTINCT world_id FROM world_visits")) {
      return Array.from(tables.world_visits.values())
        .filter(v => v.departed_at == null)
        .map(v => ({ world_id: v.world_id }));
    }
    if (sql.startsWith("SELECT DISTINCT world_id FROM world_npcs")) {
      const seen = new Set();
      for (const n of tables.world_npcs.values()) { if (!n.is_dead) seen.add(n.world_id); }
      return Array.from(seen).map(w => ({ world_id: w }));
    }
    return [];
  }

  return { prepare, transaction, _tables: tables };
}

function makeNpc(opts = {}) {
  return {
    id: opts.id || "npc:k1",
    archetype: opts.archetype || "warrior",
    faction: opts.faction || "pinewood",
    spawn_location: opts.spawn_location || JSON.stringify({ x: 100, z: 50 }),
    current_location: opts.current_location || JSON.stringify({ x: 100, z: 50 }),
    world_id: opts.world_id || "concordia-hub",
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("composeScheduleForNpc — determinism + archetype routing", () => {
  it("returns 8 blocks", () => {
    const npc = makeNpc();
    const slots = composeScheduleForNpc(npc, 12345, null);
    assert.equal(slots.length, 8);
    for (let i = 0; i < 8; i++) assert.equal(slots[i].block_idx, i);
  });

  it("same npc + day + preoccupation = same schedule (determinism)", () => {
    const npc = makeNpc({ id: "npc:det" });
    const a = composeScheduleForNpc(npc, 100, null);
    const b = composeScheduleForNpc(npc, 100, null);
    assert.deepEqual(a, b);
  });

  it("warrior archetype trains at dawn", () => {
    const npc = makeNpc({ archetype: "warrior" });
    const slots = composeScheduleForNpc(npc, 1, null);
    assert.equal(slots[2].activity_kind, "train"); // 06:00-09:00
  });

  it("scholar archetype crafts at workplace", () => {
    const npc = makeNpc({ archetype: "scholar" });
    const slots = composeScheduleForNpc(npc, 1, null);
    assert.equal(slots[3].activity_kind, "craft");
    assert.equal(slots[3].location_kind, "workplace");
  });

  it("trader archetype walks the market mid-day", () => {
    const npc = makeNpc({ archetype: "trader" });
    const slots = composeScheduleForNpc(npc, 1, null);
    assert.equal(slots[3].activity_kind, "trade");
    assert.equal(slots[4].activity_kind, "trade");
  });

  it("unknown archetype falls back to default", () => {
    const npc = makeNpc({ archetype: "totally_unknown" });
    const slots = composeScheduleForNpc(npc, 1, null);
    assert.equal(slots[3].activity_kind, "craft");
  });
});

describe("preoccupation overrides", () => {
  it("war preoccupation adds training", () => {
    const npc = makeNpc({ archetype: "scholar" });
    const slots = composeScheduleForNpc(npc, 1, {
      kind: "faction_phase",
      narrative: "We are at war. Half my kin are wounded; the rest are sharpening blades.",
    });
    assert.equal(slots[1].activity_kind, "train");
    assert.equal(slots[6].activity_kind, "train");
  });

  it("rebuild preoccupation adds rest", () => {
    const npc = makeNpc();
    const slots = composeScheduleForNpc(npc, 1, {
      kind: "faction_phase",
      narrative: "We lost the last skirmish. I'm rationing my own training to feed the rebuild.",
    });
    assert.equal(slots[4].activity_kind, "rest");
    assert.equal(slots[5].activity_kind, "rest");
  });

  it("expand preoccupation sends NPCs wandering wilds", () => {
    const npc = makeNpc();
    const slots = composeScheduleForNpc(npc, 1, {
      kind: "faction_phase",
      narrative: "My faction is pushing east; we expect new territory before the next moon.",
    });
    assert.equal(slots[3].activity_kind, "wander");
    assert.equal(slots[3].location_kind, "wilds");
  });

  it("personal_loss adds temple visit", () => {
    const npc = makeNpc();
    const slots = composeScheduleForNpc(npc, 1, {
      kind: "personal_loss",
      narrative: "any narrative",
    });
    assert.equal(slots[6].activity_kind, "commune");
    assert.equal(slots[6].location_kind, "temple");
  });
});

describe("persistScheduleForNpc — idempotent overwrite", () => {
  it("writes 8 rows", () => {
    const db = makeFakeDb();
    const npc = makeNpc();
    db._tables.world_npcs.set(npc.id, npc);
    const w = persistScheduleForNpc(db, npc, 1, null);
    assert.equal(w, 8);
    assert.equal(db._tables.npc_schedules.size, 8);
  });

  it("re-running overwrites existing day's rows", () => {
    const db = makeFakeDb();
    const npc = makeNpc();
    db._tables.world_npcs.set(npc.id, npc);
    persistScheduleForNpc(db, npc, 1, null);
    persistScheduleForNpc(db, npc, 1, { kind: "faction_phase", narrative: "war" });
    // Still 8 rows (overwrite, not append).
    assert.equal(db._tables.npc_schedules.size, 8);
    // Block 1 should now be 'train' (war override).
    const b1 = Array.from(db._tables.npc_schedules.values()).find(r => r.block_idx === 1);
    assert.equal(b1.activity_kind, "train");
  });
});

describe("currentDaySeed + currentBlockIdx", () => {
  it("currentDaySeed is integer days since epoch", () => {
    const seed = currentDaySeed(86400000 * 100);
    assert.equal(seed, 100);
  });
  it("currentBlockIdx is 0-7 for 3-hour blocks", () => {
    assert.equal(currentBlockIdx(0), 0);
    assert.equal(currentBlockIdx(86400000 - 1), 7);
    assert.equal(currentBlockIdx(3 * 3600 * 1000), 1);
    assert.equal(currentBlockIdx(12 * 3600 * 1000), 4);
  });
});

describe("advanceRoutine — block transition + nudge + arrival", () => {
  it("creates routine state on first advance + nudges toward target", async () => {
    const db = makeFakeDb();
    const npc = makeNpc({ id: "npc:adv1", current_location: JSON.stringify({ x: 0, z: 0 }) });
    db._tables.world_npcs.set(npc.id, npc);
    persistScheduleForNpc(db, npc, 100, null);

    const r = await advanceRoutine(db, npc, { daySeed: 100, blockIdx: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.transitioned, true);
    const state = getActiveRoutine(db, "npc:adv1");
    assert.equal(state.current_block, 3);
    // Position should have moved (nudge step is 6m); target is at spawn ± 35.
    const pos = JSON.parse(db._tables.world_npcs.get("npc:adv1").current_location);
    assert.notEqual(pos.x, 0);
  });

  it("arrives when within ARRIVAL_RADIUS_M of target", async () => {
    const db = makeFakeDb();
    const npc = makeNpc({ id: "npc:close" });
    db._tables.world_npcs.set(npc.id, npc);
    persistScheduleForNpc(db, npc, 200, null);

    // Find the block-3 target and place NPC right next to it.
    const block3 = Array.from(db._tables.npc_schedules.values())
      .find(r => r.npc_id === "npc:close" && r.block_idx === 3 && r.day_seed === 200);
    npc.current_location = JSON.stringify({ x: block3.target_x, z: block3.target_z });
    db._tables.world_npcs.get(npc.id).current_location = npc.current_location;

    const r = await advanceRoutine(db, npc, { daySeed: 200, blockIdx: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.arrived, true);
    const state = getActiveRoutine(db, "npc:close");
    assert.notEqual(state.arrived_at, null);
  });

  it("returns no_schedule when today's schedule is missing", async () => {
    const db = makeFakeDb();
    const npc = makeNpc({ id: "npc:nosched" });
    db._tables.world_npcs.set(npc.id, npc);
    const r = await advanceRoutine(db, npc, { daySeed: 999, blockIdx: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_schedule");
  });

  it("does not transition mid-block (state.current_block matches)", async () => {
    const db = makeFakeDb();
    const npc = makeNpc({ id: "npc:samebk" });
    db._tables.world_npcs.set(npc.id, npc);
    persistScheduleForNpc(db, npc, 300, null);
    await advanceRoutine(db, npc, { daySeed: 300, blockIdx: 3 });
    const r2 = await advanceRoutine(db, npc, { daySeed: 300, blockIdx: 3 });
    assert.equal(r2.transitioned, false);
  });
});

describe("regenerateSchedulesForFaction", () => {
  it("regenerates schedules for every NPC in faction", () => {
    const db = makeFakeDb();
    const a = makeNpc({ id: "npc:a", faction: "pinewood" });
    const b = makeNpc({ id: "npc:b", faction: "pinewood" });
    const c = makeNpc({ id: "npc:c", faction: "ember" });
    db._tables.world_npcs.set(a.id, a);
    db._tables.world_npcs.set(b.id, b);
    db._tables.world_npcs.set(c.id, c);

    const r = regenerateSchedulesForFaction(db, "pinewood", { kind: "faction_phase", narrative: "war" });
    assert.equal(r.ok, true);
    assert.equal(r.regenerated, 2);
    // C's faction was untouched.
    const cSched = Array.from(db._tables.npc_schedules.values()).filter(s => s.npc_id === "npc:c");
    assert.equal(cSched.length, 0);
  });
});

describe("npc-routine-cycle heartbeat", () => {
  it("returns ok:false reason 'no_db' with no DB", async () => {
    const r = await runNpcRoutineCycle({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("respects CONCORD_NPC_ROUTINES=0", async () => {
    const prev = process.env.CONCORD_NPC_ROUTINES;
    process.env.CONCORD_NPC_ROUTINES = "0";
    try {
      const r = await runNpcRoutineCycle({ db: makeFakeDb() });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_NPC_ROUTINES;
      else process.env.CONCORD_NPC_ROUTINES = prev;
    }
  });

  it("schedules + advances NPCs in active worlds", async () => {
    const db = makeFakeDb();
    db._tables.world_visits.set("v1", { user_id: "user:a", world_id: "w:1", departed_at: null });
    const npc = makeNpc({ id: "npc:cycle", world_id: "w:1" });
    db._tables.world_npcs.set(npc.id, npc);

    const r = await runNpcRoutineCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.advanced >= 1);
    assert.ok(r.scheduled >= 1);
  });
});

describe("internals", () => {
  it("ACTIVITY_SIGNALS covers all activity kinds", () => {
    const expected = ["sleep", "train", "craft", "gather", "trade", "commune", "socialize", "patrol", "wander", "rest"];
    for (const k of expected) {
      assert.ok(_internal.ACTIVITY_SIGNALS[k] !== undefined, `missing ${k}`);
    }
  });
  it("ARCHETYPE_ROUTINES has 8 blocks each", () => {
    for (const [arch, rt] of Object.entries(_internal.ARCHETYPE_ROUTINES)) {
      assert.equal(rt.length, 8, `${arch} has ${rt.length} blocks`);
    }
  });
});
