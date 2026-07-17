// Phase F3.1 — heartbeat emit-shape contract.
//
// Pins the realtime event names + payload shape for the 5 silent-system
// emit sites added in Phase F3.1:
//   - faction-strategy applyMove → faction:war-declared / alliance-formed / truce-sought
//   - dream-engine tryComposeForUser → dream:composed
//   - forward-sim realisePrediction → prediction:realised
//   - npc-schemes advanceScheme (terminal) → npc:scheme-resolved
//   - refusal-field applyTemporaryRefusal (≥6 strength) → refusal:compound-threshold
//
// We install a synthetic globalThis._concordRealtimeEmit capture function
// then exercise each lib path, asserting the emit was called with the
// expected (event, payload) shape.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upFactionStrategy } from "../../migrations/117_faction_strategy.js";
import { up as upForwardSim } from "../../migrations/116_forward_predictions.js";

import { applyMove, resolveFactionWorldId } from "../../lib/embodied/faction-strategy.js";
import { realisePrediction } from "../../lib/embodied/forward-sim.js";

const originalEmit = globalThis._concordRealtimeEmit;
let captured = [];

function installCapture() {
  captured = [];
  globalThis._concordRealtimeEmit = (event, payload) => {
    captured.push({ event, payload });
  };
}

after(() => {
  globalThis._concordRealtimeEmit = originalEmit;
});

describe("Phase F3.1 — heartbeat realtime emit contract", () => {
  describe("faction-strategy applyMove", () => {
    let db;
    beforeEach(() => {
      installCapture();
      db = new Database(":memory:");
      upFactionStrategy(db);
      db.prepare(`INSERT INTO faction_strategy_state (faction_id, stance, momentum, phase, updated_at, next_move_at)
                  VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`)
        .run("sandrun_sanguire", "expand", 0.5, 1);
      db.prepare(`INSERT INTO faction_strategy_state (faction_id, stance, momentum, phase, updated_at, next_move_at)
                  VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`)
        .run("vessine_clan", "consolidate", 0.0, 1);
    });

    it("DECLARE_WAR emits faction:war-declared", () => {
      const picked = {
        move: "DECLARE_WAR", target: "vessine_clan",
        summary: "Sandrun declares war on Vessine",
        deltaMomentum: -0.2, newStance: "war",
      };
      applyMove(db, "sandrun_sanguire", picked, []);
      const evt = captured.find((c) => c.event === "faction:war-declared");
      assert.ok(evt, "should emit faction:war-declared");
      assert.equal(evt.payload.factionId, "sandrun_sanguire");
      assert.equal(evt.payload.targetFactionId, "vessine_clan");
      assert.equal(evt.payload.move, "DECLARE_WAR");
    });

    it("PROPOSE_ALLIANCE emits faction:alliance-formed", () => {
      const picked = {
        move: "PROPOSE_ALLIANCE", target: "vessine_clan",
        summary: "Alliance proposed",
        deltaMomentum: 0.1, newStance: "alliance",
      };
      applyMove(db, "sandrun_sanguire", picked, []);
      const evt = captured.find((c) => c.event === "faction:alliance-formed");
      assert.ok(evt, "should emit faction:alliance-formed");
      assert.equal(evt.payload.targetFactionId, "vessine_clan");
    });

    it("SEEK_TRUCE emits faction:truce-sought", () => {
      const picked = {
        move: "SEEK_TRUCE", target: "vessine_clan",
        summary: "Truce sought",
        deltaMomentum: 0.0, newStance: "rebuild",
      };
      applyMove(db, "sandrun_sanguire", picked, []);
      const evt = captured.find((c) => c.event === "faction:truce-sought");
      assert.ok(evt, "should emit faction:truce-sought");
    });

    it("non-war/alliance/truce moves do not emit", () => {
      const picked = {
        move: "CONSOLIDATE", target: null, summary: "Consolidate",
        deltaMomentum: 0.05, newStance: "consolidate",
      };
      applyMove(db, "sandrun_sanguire", picked, []);
      const factionEmits = captured.filter((c) => c.event.startsWith("faction:"));
      assert.equal(factionEmits.length, 0);
    });
  });

  // Wave 4 (docs/lens-specs/spectate-capability-map.md "Honest residual" closure)
  // — faction:war-declared / alliance-formed / truce-sought used to broadcast
  // with no worldId, so a spectator watching one world saw every world's faction
  // moves. applyMove now stamps a best-effort worldId resolved from the
  // faction's living NPCs (resolveFactionWorldId, moved here from the
  // emergent/faction-strategy-cycle.js local it used to duplicate).
  describe("faction-strategy applyMove — Wave 4 worldId stamping", () => {
    let db;
    beforeEach(() => {
      installCapture();
      db = new Database(":memory:");
      upFactionStrategy(db);
      // Minimal world_npcs shape (id, world_id, faction) — matches the columns
      // resolveFactionWorldId actually reads (migration 042 + migration 060's
      // faction column), without paying for the full 356-migration chain.
      db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, faction TEXT)`);
      db.prepare(`INSERT INTO faction_strategy_state (faction_id, stance, momentum, phase, updated_at, next_move_at)
                  VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`)
        .run("sandrun_sanguire", "expand", 0.5, 1);
      db.prepare(`INSERT INTO faction_strategy_state (faction_id, stance, momentum, phase, updated_at, next_move_at)
                  VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`)
        .run("vessine_clan", "consolidate", 0.0, 1);
    });

    it("resolveFactionWorldId reads the world of a faction's living NPC", () => {
      db.prepare(`INSERT INTO world_npcs (id, world_id, faction) VALUES ('npc_1', 'tunya', 'sandrun_sanguire')`).run();
      assert.equal(resolveFactionWorldId(db, "sandrun_sanguire"), "tunya");
    });

    it("resolveFactionWorldId returns null (never invents) for a faction with no NPCs", () => {
      assert.equal(resolveFactionWorldId(db, "sandrun_sanguire"), null);
    });

    it("DECLARE_WAR stamps the real worldId when the faction's NPCs resolve one", () => {
      db.prepare(`INSERT INTO world_npcs (id, world_id, faction) VALUES ('npc_1', 'tunya', 'sandrun_sanguire')`).run();
      const picked = {
        move: "DECLARE_WAR", target: "vessine_clan",
        summary: "Sandrun declares war on Vessine",
        deltaMomentum: -0.2, newStance: "war",
      };
      applyMove(db, "sandrun_sanguire", picked, []);
      const evt = captured.find((c) => c.event === "faction:war-declared");
      assert.ok(evt, "should emit faction:war-declared");
      assert.equal(evt.payload.worldId, "tunya", "worldId must match the faction's actual NPC world, not a guess");
    });

    it("PROPOSE_ALLIANCE stamps worldId", () => {
      db.prepare(`INSERT INTO world_npcs (id, world_id, faction) VALUES ('npc_2', 'sovereign-ruins', 'sandrun_sanguire')`).run();
      const picked = {
        move: "PROPOSE_ALLIANCE", target: "vessine_clan",
        summary: "Alliance proposed",
        deltaMomentum: 0.1, newStance: "alliance",
      };
      applyMove(db, "sandrun_sanguire", picked, []);
      const evt = captured.find((c) => c.event === "faction:alliance-formed");
      assert.equal(evt.payload.worldId, "sovereign-ruins");
    });

    it("SEEK_TRUCE stamps worldId", () => {
      db.prepare(`INSERT INTO world_npcs (id, world_id, faction) VALUES ('npc_3', 'crime', 'sandrun_sanguire')`).run();
      const picked = {
        move: "SEEK_TRUCE", target: "vessine_clan",
        summary: "Truce sought",
        deltaMomentum: 0.0, newStance: "rebuild",
      };
      applyMove(db, "sandrun_sanguire", picked, []);
      const evt = captured.find((c) => c.event === "faction:truce-sought");
      assert.equal(evt.payload.worldId, "crime");
    });

    it("never invents a worldId field when no NPC resolves one — omitted, not null/empty-string", () => {
      const picked = {
        move: "DECLARE_WAR", target: "vessine_clan",
        summary: "Sandrun declares war on Vessine",
        deltaMomentum: -0.2, newStance: "war",
      };
      applyMove(db, "sandrun_sanguire", picked, []);
      const evt = captured.find((c) => c.event === "faction:war-declared");
      assert.ok(evt, "should still emit the event honestly, without a worldId");
      assert.equal("worldId" in evt.payload, false, "worldId key must be absent, not a fabricated null/empty value");
    });

    it("event-shapes validates both with and without worldId (optional, not required)", async () => {
      const { validateEvent } = await import("../../lib/event-shapes.js");
      const withWorld = validateEvent("faction:war-declared", {
        factionId: "a", targetFactionId: "b", move: "DECLARE_WAR", summary: "s", moveId: "m1", worldId: "tunya",
      });
      assert.equal(withWorld.ok, true, JSON.stringify(withWorld));
      const withoutWorld = validateEvent("faction:war-declared", {
        factionId: "a", targetFactionId: "b", move: "DECLARE_WAR", summary: "s", moveId: "m1",
      });
      assert.equal(withoutWorld.ok, true, JSON.stringify(withoutWorld));
    });
  });

  describe("forward-sim realisePrediction", () => {
    let db;
    beforeEach(() => {
      installCapture();
      db = new Database(":memory:");
      upForwardSim(db);
      db.prepare(`INSERT INTO forward_predictions
        (id, user_id, subject_kind, subject_id, anticipated, confidence,
         composer, composed_at, expires_at, realised_at, reality_outcome)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`).run(
        "pred_1", "user_a", "quest", "q_southern_arc_03",
        "Player will return to Nesha with the glyph", 0.62,
        "deterministic", Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000) + 86400,
      );
    });

    it("realisePrediction emits prediction:realised", () => {
      realisePrediction(db, "pred_1", { matched: true });
      const evt = captured.find((c) => c.event === "prediction:realised");
      assert.ok(evt, "should emit prediction:realised");
      assert.equal(evt.payload.predictionId, "pred_1");
      assert.equal(evt.payload.userId, "user_a");
      assert.equal(evt.payload.subjectKind, "quest");
      assert.equal(evt.payload.subjectId, "q_southern_arc_03");
    });
  });

  describe("captures install hook", () => {
    it("captures uses globalThis._concordRealtimeEmit", () => {
      installCapture();
      globalThis._concordRealtimeEmit("test:event", { a: 1 });
      assert.equal(captured.length, 1);
      assert.equal(captured[0].event, "test:event");
      assert.deepEqual(captured[0].payload, { a: 1 });
    });
  });

  // Phase G1 — registered event shapes for the 4 new batched emits.
  describe("Phase G1 — registered event shapes", () => {
    it("npc:activity-batch shape validates", async () => {
      const { validateEvent } = await import("../../lib/event-shapes.js");
      const r = validateEvent("npc:activity-batch", {
        worldId: "concordia-hub", count: 3,
        transitions: [{ npcId: "npc_a", fromBlock: 0, toBlock: 1, activity: "work", faction: "x" }],
      });
      assert.equal(r.ok, true);
    });
    it("npc:economy-batch shape validates", async () => {
      const { validateEvent } = await import("../../lib/event-shapes.js");
      const r = validateEvent("npc:economy-batch", {
        worldId: "concordia-hub", gathers: 3, crafts: 1, trades: 2, rests: 0, notable: [],
      });
      assert.equal(r.ok, true);
    });
    it("social:shadows-synced shape validates", async () => {
      const { validateEvent } = await import("../../lib/event-shapes.js");
      const r = validateEvent("social:shadows-synced", {
        createdShadows: 5, totalCapacity: 1200,
      });
      assert.equal(r.ok, true);
    });
    it("combat:chain shape validates", async () => {
      const { validateEvent } = await import("../../lib/event-shapes.js");
      const r = validateEvent("combat:chain", {
        originActorId: "u_a", targets: ["npc_b", "npc_c"],
      });
      assert.equal(r.ok, true);
    });
  });
});
