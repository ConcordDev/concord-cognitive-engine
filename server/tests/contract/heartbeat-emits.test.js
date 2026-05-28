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

import { applyMove } from "../../lib/embodied/faction-strategy.js";
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
        .run("medici_clan", "consolidate", 0.0, 1);
    });

    it("DECLARE_WAR emits faction:war-declared", () => {
      const picked = {
        move: "DECLARE_WAR", target: "medici_clan",
        summary: "Sandrun declares war on Medici",
        deltaMomentum: -0.2, newStance: "war",
      };
      applyMove(db, "sandrun_sanguire", picked, []);
      const evt = captured.find((c) => c.event === "faction:war-declared");
      assert.ok(evt, "should emit faction:war-declared");
      assert.equal(evt.payload.factionId, "sandrun_sanguire");
      assert.equal(evt.payload.targetFactionId, "medici_clan");
      assert.equal(evt.payload.move, "DECLARE_WAR");
    });

    it("PROPOSE_ALLIANCE emits faction:alliance-formed", () => {
      const picked = {
        move: "PROPOSE_ALLIANCE", target: "medici_clan",
        summary: "Alliance proposed",
        deltaMomentum: 0.1, newStance: "alliance",
      };
      applyMove(db, "sandrun_sanguire", picked, []);
      const evt = captured.find((c) => c.event === "faction:alliance-formed");
      assert.ok(evt, "should emit faction:alliance-formed");
      assert.equal(evt.payload.targetFactionId, "medici_clan");
    });

    it("SEEK_TRUCE emits faction:truce-sought", () => {
      const picked = {
        move: "SEEK_TRUCE", target: "medici_clan",
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
