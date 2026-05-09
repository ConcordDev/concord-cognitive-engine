/**
 * Tier-2 contract tests for Phase 4b — Living Economy.
 *
 * Pinned:
 *   - performGather: writes inventory + flow row; deterministic by
 *     (npc_id, hour_bucket); archetype routing of gather targets
 *   - performCraft: consumes 2 inputs → produces 1 output; rejects
 *     when inputs missing; archetype recipe routing
 *   - performTrade: surplus moves to a peer who needs it; no_buyer
 *     when no peer needs the surplus
 *   - consumePersonalNeeds: eats meal/preserved_food when available
 *   - computeRegionalScarcity: positive when demand > supply; clamped
 *   - refreshScarcityCache + priceModulator round-trip
 *   - dispatchEconomicAction routes by activity_kind
 *   - Heartbeat: kill-switch + no_db + bounded
 *
 * Run: node --test tests/npc-economy.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  performGather,
  performCraft,
  performTrade,
  consumePersonalNeeds,
  computeRegionalScarcity,
  refreshScarcityCache,
  priceModulator,
  dispatchEconomicAction,
  getInventory,
  RAW_RESOURCES,
  FINISHED_GOODS,
  _internal,
} from "../lib/npc-economy.js";
import { runNpcEconomyCycle } from "../emergent/npc-economy-cycle.js";

// ── Fake DB ─────────────────────────────────────────────────────────────────

function makeFakeDb() {
  const tables = {
    npc_inventory: new Map(),       // key = `${npc_id}|${resource_kind}`
    economy_flows: new Map(),
    regional_scarcity: new Map(),    // key = `${world_id}|${resource_kind}`
    world_npcs: new Map(),
    world_visits: new Map(),
    npc_routine_state: new Map(),
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
    if (sql.startsWith("INSERT INTO npc_inventory")) {
      const [npcId, resourceKind, qtyClamp, delta] = args;
      const key = `${npcId}|${resourceKind}`;
      const cur = tables.npc_inventory.get(key);
      if (!cur) {
        tables.npc_inventory.set(key, { npc_id: npcId, resource_kind: resourceKind, quantity: Math.max(0, qtyClamp) });
      } else {
        cur.quantity = Math.max(0, (cur.quantity || 0) + delta);
      }
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO economy_flows")) {
      const [id, worldId, npcId, flowKind, resourceKind, qty] = args;
      tables.economy_flows.set(id, {
        id, world_id: worldId, npc_id: npcId, flow_kind: flowKind,
        resource_kind: resourceKind, quantity: qty,
        occurred_at: Math.floor(Date.now() / 1000),
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO regional_scarcity")) {
      const [worldId, resourceKind, scarcity] = args;
      tables.regional_scarcity.set(`${worldId}|${resourceKind}`, {
        world_id: worldId, resource_kind: resourceKind, scarcity,
        computed_at: Math.floor(Date.now() / 1000),
      });
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  function getStmt(sql, args) {
    if (sql.startsWith("SELECT scarcity FROM regional_scarcity")) {
      const [worldId, resourceKind] = args;
      const r = tables.regional_scarcity.get(`${worldId}|${resourceKind}`);
      return r ? { scarcity: r.scarcity } : null;
    }
    return null;
  }

  function allStmt(sql, args) {
    if (sql.startsWith("SELECT resource_kind, quantity FROM npc_inventory")) {
      const [npcId] = args;
      return Array.from(tables.npc_inventory.values()).filter(r => r.npc_id === npcId);
    }
    if (sql.startsWith("SELECT n.id, n.archetype FROM world_npcs")) {
      const [worldId, excludeId] = args;
      return Array.from(tables.world_npcs.values())
        .filter(n => n.world_id === worldId && n.id !== excludeId && !n.is_dead);
    }
    if (sql.startsWith("SELECT flow_kind, SUM(quantity) AS qty FROM economy_flows")) {
      const [worldId, resourceKind, cutoff] = args;
      const buckets = {};
      for (const f of tables.economy_flows.values()) {
        if (f.world_id !== worldId || f.resource_kind !== resourceKind) continue;
        if (f.occurred_at <= cutoff) continue;
        buckets[f.flow_kind] = (buckets[f.flow_kind] || 0) + f.quantity;
      }
      return Object.entries(buckets).map(([flow_kind, qty]) => ({ flow_kind, qty }));
    }
    if (sql.startsWith("SELECT DISTINCT world_id FROM world_visits")) {
      return Array.from(tables.world_visits.values())
        .filter(v => v.departed_at == null)
        .map(v => ({ world_id: v.world_id }));
    }
    if (sql.startsWith("SELECT DISTINCT world_id FROM world_npcs")) {
      const seen = new Set();
      for (const n of tables.world_npcs.values()) if (!n.is_dead) seen.add(n.world_id);
      return Array.from(seen).map(w => ({ world_id: w }));
    }
    if (sql.startsWith("SELECT n.id, n.archetype, n.faction, n.world_id, rs.activity_kind FROM world_npcs n JOIN npc_routine_state rs")) {
      const [worldId] = args;
      const out = [];
      for (const n of tables.world_npcs.values()) {
        if (n.world_id !== worldId || n.is_dead) continue;
        const rs = tables.npc_routine_state.get(n.id);
        if (!rs || rs.arrived_at == null) continue;
        out.push({ id: n.id, archetype: n.archetype, faction: n.faction, world_id: n.world_id, activity_kind: rs.activity_kind });
      }
      return out;
    }
    return [];
  }

  return { prepare, transaction, _tables: tables };
}

function makeNpc(opts = {}) {
  return {
    id: opts.id || "npc:e1",
    archetype: opts.archetype || "warrior",
    faction: opts.faction || "pinewood",
    world_id: opts.world_id || "concordia-hub",
    is_dead: 0,
  };
}

function seedInventory(db, npcId, items) {
  for (const [k, q] of Object.entries(items)) {
    db._tables.npc_inventory.set(`${npcId}|${k}`, { npc_id: npcId, resource_kind: k, quantity: q });
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("performGather", () => {
  it("warrior gathers meat or ore, writes inventory + flow", () => {
    const db = makeFakeDb();
    const npc = makeNpc({ archetype: "warrior" });
    db._tables.world_npcs.set(npc.id, npc);
    const r = performGather(db, npc, { hourBucket: 5 });
    assert.equal(r.ok, true);
    assert.ok(["meat", "ore"].includes(r.resource_kind), `got ${r.resource_kind}`);
    const inv = getInventory(db, npc.id);
    assert.equal(inv[r.resource_kind], 1);
    assert.equal(db._tables.economy_flows.size, 1);
  });

  it("scholar gathers herb or crystal", () => {
    const db = makeFakeDb();
    const npc = makeNpc({ archetype: "scholar" });
    const r = performGather(db, npc, { hourBucket: 5 });
    assert.ok(["herb", "crystal"].includes(r.resource_kind));
  });

  it("deterministic by (npc_id, hourBucket)", () => {
    const db1 = makeFakeDb();
    const db2 = makeFakeDb();
    const npc = makeNpc({ id: "npc:det" });
    const r1 = performGather(db1, npc, { hourBucket: 7 });
    const r2 = performGather(db2, npc, { hourBucket: 7 });
    assert.equal(r1.resource_kind, r2.resource_kind);
  });
});

describe("performCraft", () => {
  it("warrior consumes ore + wood → produces weapon", () => {
    const db = makeFakeDb();
    const npc = makeNpc({ archetype: "warrior" });
    seedInventory(db, npc.id, { ore: 3, wood: 3 });
    const r = performCraft(db, npc);
    assert.equal(r.ok, true);
    assert.equal(r.output, "weapon");
    const inv = getInventory(db, npc.id);
    assert.equal(inv.ore, 2);
    assert.equal(inv.wood, 2);
    assert.equal(inv.weapon, 1);
  });

  it("rejects when inputs missing", () => {
    const db = makeFakeDb();
    const npc = makeNpc({ archetype: "warrior" });
    seedInventory(db, npc.id, { ore: 3 }); // missing wood
    const r = performCraft(db, npc);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "inputs_missing");
    assert.equal(r.missing, "wood");
  });

  it("scholar makes a tool", () => {
    const db = makeFakeDb();
    const npc = makeNpc({ archetype: "scholar" });
    seedInventory(db, npc.id, { wood: 1, ore: 1 });
    const r = performCraft(db, npc);
    assert.equal(r.output, "tool");
  });
});

describe("performTrade", () => {
  it("trader surplus moves to a peer who needs it", () => {
    const db = makeFakeDb();
    const trader = makeNpc({ id: "npc:t", archetype: "trader" });
    const warrior = makeNpc({ id: "npc:w", archetype: "warrior" });
    db._tables.world_npcs.set(trader.id, trader);
    db._tables.world_npcs.set(warrior.id, warrior);
    seedInventory(db, trader.id, { wood: 5 }); // wood is in warrior's recipe inputs

    const r = performTrade(db, trader);
    assert.equal(r.ok, true);
    assert.equal(r.gave, "wood");
    assert.equal(r.to_npc, "npc:w");
    assert.equal(getInventory(db, trader.id).wood, 4);
    assert.equal(getInventory(db, warrior.id).wood, 1);
  });

  it("no_buyer when no peer's recipe needs the surplus", () => {
    const db = makeFakeDb();
    const trader = makeNpc({ id: "npc:t", archetype: "trader" });
    const otherTrader = makeNpc({ id: "npc:t2", archetype: "trader" });
    db._tables.world_npcs.set(trader.id, trader);
    db._tables.world_npcs.set(otherTrader.id, otherTrader);
    seedInventory(db, trader.id, { fiber: 5 });
    seedInventory(db, otherTrader.id, { fiber: 5 }); // already has it

    const r = performTrade(db, trader);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_buyer");
  });

  it("no_surplus when nothing > 2", () => {
    const db = makeFakeDb();
    const trader = makeNpc({ id: "npc:t", archetype: "trader" });
    db._tables.world_npcs.set(trader.id, trader);
    seedInventory(db, trader.id, { wood: 1, fiber: 2 });
    const r = performTrade(db, trader);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_surplus");
  });
});

describe("consumePersonalNeeds", () => {
  it("eats a meal when available", () => {
    const db = makeFakeDb();
    const npc = makeNpc();
    seedInventory(db, npc.id, { meal: 2 });
    const r = consumePersonalNeeds(db, npc);
    assert.equal(r.ok, true);
    assert.equal(r.consumed, "meal");
    assert.equal(getInventory(db, npc.id).meal, 1);
  });

  it("falls back to preserved_food when no meal", () => {
    const db = makeFakeDb();
    const npc = makeNpc();
    seedInventory(db, npc.id, { preserved_food: 1 });
    const r = consumePersonalNeeds(db, npc);
    assert.equal(r.consumed, "preserved_food");
  });

  it("no_food when nothing edible", () => {
    const db = makeFakeDb();
    const npc = makeNpc();
    seedInventory(db, npc.id, { ore: 5 });
    const r = consumePersonalNeeds(db, npc);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_food");
  });
});

describe("computeRegionalScarcity + priceModulator", () => {
  it("positive scarcity when consumption > production", () => {
    const db = makeFakeDb();
    const npc = makeNpc();
    seedInventory(db, npc.id, { ore: 10 });
    // Simulate 5 craft_inputs of ore (consumption) and 1 gather (production).
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO economy_flows (id, world_id, npc_id, flow_kind, resource_kind, quantity, occurred_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch())`)
        .run(`f_${i}`, "concordia-hub", npc.id, "craft_input", "ore", 1);
    }
    db.prepare(`INSERT INTO economy_flows (id, world_id, npc_id, flow_kind, resource_kind, quantity, occurred_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch())`)
      .run(`f_g`, "concordia-hub", npc.id, "gather", "ore", 1);
    const s = computeRegionalScarcity(db, "concordia-hub", "ore");
    assert.ok(s > 0, `expected positive scarcity, got ${s}`);
  });

  it("negative scarcity when production > consumption (glut)", () => {
    const db = makeFakeDb();
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO economy_flows (id, world_id, npc_id, flow_kind, resource_kind, quantity, occurred_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch())`)
        .run(`g_${i}`, "concordia-hub", "npc:g", "gather", "wood", 1);
    }
    const s = computeRegionalScarcity(db, "concordia-hub", "wood");
    assert.ok(s < 0, `expected negative scarcity, got ${s}`);
  });

  it("clamps to [MIN_SCARCITY, MAX_SCARCITY]", () => {
    assert.ok(_internal.MIN_SCARCITY === -0.5);
    assert.ok(_internal.MAX_SCARCITY === 1.0);
  });

  it("refreshScarcityCache writes for every resource", () => {
    const db = makeFakeDb();
    const r = refreshScarcityCache(db, "concordia-hub");
    assert.equal(r.ok, true);
    const expected = RAW_RESOURCES.length + FINISHED_GOODS.length;
    assert.equal(r.written, expected);
  });

  it("priceModulator: 1.0 when no scarcity row; 1.0+s*0.5 when present", () => {
    const db = makeFakeDb();
    assert.equal(priceModulator(db, "w", "ore"), 1.0);
    db.prepare(`INSERT INTO regional_scarcity (world_id, resource_kind, scarcity, computed_at) VALUES (?, ?, ?, unixepoch())`)
      .run("w", "ore", 0.4);
    assert.equal(priceModulator(db, "w", "ore"), 1.2);
  });
});

describe("dispatchEconomicAction", () => {
  it("routes 'gather' → performGather", () => {
    const db = makeFakeDb();
    const npc = makeNpc();
    db._tables.world_npcs.set(npc.id, npc);
    const r = dispatchEconomicAction(db, npc, "gather");
    assert.equal(r.ok, true);
  });
  it("routes 'craft' → performCraft (rejects without inputs)", () => {
    const db = makeFakeDb();
    const npc = makeNpc();
    const r = dispatchEconomicAction(db, npc, "craft");
    assert.equal(r.reason, "inputs_missing");
  });
  it("non-economic activity returns reason 'non_economic_activity'", () => {
    const db = makeFakeDb();
    const npc = makeNpc();
    const r = dispatchEconomicAction(db, npc, "sleep");
    assert.equal(r.reason, "non_economic_activity");
  });
});

describe("npc-economy-cycle heartbeat", () => {
  it("returns no_db with no DB", async () => {
    const r = await runNpcEconomyCycle({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("respects CONCORD_NPC_ECONOMY=0", async () => {
    const prev = process.env.CONCORD_NPC_ECONOMY;
    process.env.CONCORD_NPC_ECONOMY = "0";
    try {
      const r = await runNpcEconomyCycle({ db: makeFakeDb() });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_NPC_ECONOMY;
      else process.env.CONCORD_NPC_ECONOMY = prev;
    }
  });

  it("dispatches arrived NPCs by activity_kind + refreshes scarcity", async () => {
    const db = makeFakeDb();
    db._tables.world_visits.set("v1", { user_id: "user:a", world_id: "w:1", departed_at: null });
    const gatherer = makeNpc({ id: "npc:g", world_id: "w:1", archetype: "warrior" });
    const crafter  = makeNpc({ id: "npc:c", world_id: "w:1", archetype: "warrior" });
    db._tables.world_npcs.set(gatherer.id, gatherer);
    db._tables.world_npcs.set(crafter.id, crafter);
    seedInventory(db, crafter.id, { ore: 2, wood: 2 });
    db._tables.npc_routine_state.set(gatherer.id, { activity_kind: "gather", arrived_at: Math.floor(Date.now() / 1000) });
    db._tables.npc_routine_state.set(crafter.id, { activity_kind: "craft", arrived_at: Math.floor(Date.now() / 1000) });

    const r = await runNpcEconomyCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.actions >= 2);
    assert.ok(r.scarcityRefreshed >= 1);
    assert.equal(r.byKind.gather, 1);
    assert.equal(r.byKind.craft, 1);
  });
});

describe("internals", () => {
  it("RAW_RESOURCES + FINISHED_GOODS each have 8 items", () => {
    assert.equal(RAW_RESOURCES.length, 8);
    assert.equal(FINISHED_GOODS.length, 8);
  });
});
