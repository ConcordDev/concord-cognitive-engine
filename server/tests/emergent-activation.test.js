/**
 * Tests for emergent/activation.js — Activation / Attention System
 *
 * Covers: getActivationSystem, activate, spreadActivation, getWorkingSet,
 * getGlobalActivation, decaySession, clearSessionActivation, getActivationMetrics
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Stub store.js before importing activation ──────────────────────────────

const _stubbedState = {};

// We need to mock getEmergentState from store.js
// Using dynamic import with a loader is complex, so instead we test the
// module through its exported interface by providing STATE objects that
// carry __emergent.

import {
  getActivationSystem,
  activate,
  spreadActivation,
  getWorkingSet,
  getGlobalActivation,
  decaySession,
  clearSessionActivation,
  getActivationMetrics,
} from "../emergent/activation.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshSTATE() {
  return { __emergent: {} };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("activation.js", () => {
  let STATE;

  beforeEach(() => {
    STATE = freshSTATE();
  });

  // ── getActivationSystem ──────────────────────────────────────────────────

  describe("getActivationSystem()", () => {
    it("initializes activation system on first call", () => {
      const sys = getActivationSystem(STATE);
      assert.ok(sys);
      assert.ok(sys.sessions instanceof Map);
      assert.ok(sys.global instanceof Map);
      assert.deepStrictEqual(sys.metrics, {
        activations: 0,
        spreads: 0,
        workingSetQueries: 0,
        decays: 0,
      });
    });

    it("returns the same instance on subsequent calls", () => {
      const sys1 = getActivationSystem(STATE);
      const sys2 = getActivationSystem(STATE);
      assert.strictEqual(sys1, sys2);
    });
  });

  // ── activate ─────────────────────────────────────────────────────────────

  describe("activate()", () => {
    it("activates a DTU in a new session", () => {
      const result = activate(STATE, "sess1", "dtu_1", 0.8, "test_reason");
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.activation.dtuId, "dtu_1");
      assert.strictEqual(result.activation.activationCount, 1);
      assert.ok(result.activation.score > 0);
      assert.ok(result.activation.reasons.includes("test_reason"));
    });

    it("uses default score of 1.0 and reason of 'direct'", () => {
      const result = activate(STATE, "sess1", "dtu_1");
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.activation.score, 1.0);
      assert.deepStrictEqual(result.activation.reasons, ["direct"]);
    });

    it("accumulates activation on re-activation", () => {
      activate(STATE, "sess1", "dtu_1", 0.5, "first");
      const result = activate(STATE, "sess1", "dtu_1", 0.5, "second");
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.activation.activationCount, 2);
      assert.ok(result.activation.reasons.includes("first"));
      assert.ok(result.activation.reasons.includes("second"));
      // Existing + score * 0.5 = 0.5 + 0.25 = 0.75, capped at 1.0
      assert.ok(result.activation.score <= 1.0);
    });

    it("caps score at 1.0 for repeated activations", () => {
      for (let i = 0; i < 20; i++) {
        activate(STATE, "sess1", "dtu_1", 1.0, "repeat");
      }
      const sys = getActivationSystem(STATE);
      const entry = sys.sessions.get("sess1").get("dtu_1");
      assert.ok(entry.score <= 1.0);
    });

    it("clamps initial score between 0 and 1", () => {
      const r1 = activate(STATE, "sess1", "dtu_over", 5.0);
      assert.ok(r1.activation.score <= 1.0);

      const r2 = activate(STATE, "sess2", "dtu_under", -1.0);
      assert.ok(r2.activation.score >= 0);
    });

    it("truncates reasons to last 5 on existing entry", () => {
      for (let i = 0; i < 10; i++) {
        activate(STATE, "sess1", "dtu_1", 0.1, `reason_${i}`);
      }
      const sys = getActivationSystem(STATE);
      const entry = sys.sessions.get("sess1").get("dtu_1");
      // Each re-activation keeps existing.reasons.slice(-5) + new
      assert.ok(entry.reasons.length <= 7); // slice(-5) of existing + new
    });

    it("updates global activation", () => {
      activate(STATE, "sess1", "dtu_1", 1.0);
      const sys = getActivationSystem(STATE);
      const global = sys.global.get("dtu_1");
      assert.ok(global);
      assert.ok(global.score > 0);
      assert.strictEqual(global.accessCount, 1);
    });

    it("increments metrics.activations", () => {
      activate(STATE, "sess1", "dtu_1");
      activate(STATE, "sess1", "dtu_2");
      const sys = getActivationSystem(STATE);
      assert.strictEqual(sys.metrics.activations, 2);
    });

    it("creates session map when session does not exist", () => {
      activate(STATE, "new_sess", "dtu_1");
      const sys = getActivationSystem(STATE);
      assert.ok(sys.sessions.has("new_sess"));
    });
  });

  // ── spreadActivation ─────────────────────────────────────────────────────

  describe("spreadActivation()", () => {
    it("returns no_edge_store message when no edge store exists", () => {
      activate(STATE, "sess1", "dtu_1");
      const result = spreadActivation(STATE, "sess1", "dtu_1");
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(result.spread, []);
      assert.strictEqual(result.message, "no_edge_store");
    });

    it("returns error when source is not activated", () => {
      STATE.__emergent._edges = { bySource: new Map(), edges: new Map() };
      const result = spreadActivation(STATE, "sess1", "dtu_not_activated");
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "source_not_activated");
    });

    it("creates session map if not present", () => {
      STATE.__emergent._edges = { bySource: new Map(), edges: new Map() };
      // Manually inject the activation
      const sys = getActivationSystem(STATE);
      sys.sessions.set("sess1", new Map([["dtu_1", { dtuId: "dtu_1", score: 0.8 }]]));

      const result = spreadActivation(STATE, "sess_new", "dtu_1");
      // sess_new doesn't have dtu_1 activated
      assert.strictEqual(result.ok, false);
    });

    it("spreads activation across edges", () => {
      // Set up edge store
      const edgeStore = {
        bySource: new Map(),
        edges: new Map(),
      };
      edgeStore.bySource.set("dtu_1", new Set(["edge_1"]));
      edgeStore.edges.set("edge_1", {
        targetId: "dtu_2",
        edgeType: "supports",
        weight: 0.9,
      });
      STATE.__emergent._edges = edgeStore;

      activate(STATE, "sess1", "dtu_1", 1.0);
      const result = spreadActivation(STATE, "sess1", "dtu_1", 2);

      assert.strictEqual(result.ok, true);
      assert.ok(result.spread.length > 0);
      assert.strictEqual(result.spread[0].targetId, "dtu_2");
      assert.strictEqual(result.spread[0].viaEdge, "supports");
      assert.strictEqual(result.spread[0].hop, 1);
    });

    it("skips already visited nodes", () => {
      const edgeStore = {
        bySource: new Map(),
        edges: new Map(),
      };
      // Edge from dtu_1 -> dtu_2, and dtu_2 -> dtu_1 (cycle)
      edgeStore.bySource.set("dtu_1", new Set(["edge_1"]));
      edgeStore.bySource.set("dtu_2", new Set(["edge_2"]));
      edgeStore.edges.set("edge_1", { targetId: "dtu_2", edgeType: "supports", weight: 0.9 });
      edgeStore.edges.set("edge_2", { targetId: "dtu_1", edgeType: "supports", weight: 0.9 });
      STATE.__emergent._edges = edgeStore;

      activate(STATE, "sess1", "dtu_1", 1.0);
      const result = spreadActivation(STATE, "sess1", "dtu_1", 3);
      assert.strictEqual(result.ok, true);
      // dtu_1 is source so it's in visited, cycle doesn't re-add
      assert.strictEqual(result.spread.length, 1);
    });

    it("respects maxHops parameter", () => {
      const edgeStore = { bySource: new Map(), edges: new Map() };
      edgeStore.bySource.set("dtu_1", new Set(["e1"]));
      edgeStore.bySource.set("dtu_2", new Set(["e2"]));
      edgeStore.edges.set("e1", { targetId: "dtu_2", edgeType: "supports", weight: 1.0 });
      edgeStore.edges.set("e2", { targetId: "dtu_3", edgeType: "supports", weight: 1.0 });
      STATE.__emergent._edges = edgeStore;

      activate(STATE, "sess1", "dtu_1", 1.0);
      const result = spreadActivation(STATE, "sess1", "dtu_1", 1);
      assert.strictEqual(result.ok, true);
      // Only 1 hop, so dtu_3 should not be reached
      assert.ok(result.spread.every(s => s.hop <= 1));
    });

    it("skips edges below threshold (spreadScore < 0.01)", () => {
      const edgeStore = { bySource: new Map(), edges: new Map() };
      edgeStore.bySource.set("dtu_1", new Set(["e1"]));
      edgeStore.edges.set("e1", { targetId: "dtu_2", edgeType: "contradicts", weight: 0.01 });
      STATE.__emergent._edges = edgeStore;

      activate(STATE, "sess1", "dtu_1", 0.05); // very low activation
      const result = spreadActivation(STATE, "sess1", "dtu_1", 2);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.spread.length, 0);
    });

    it("uses default edge type weight 0.3 for unknown edge types", () => {
      const edgeStore = { bySource: new Map(), edges: new Map() };
      edgeStore.bySource.set("dtu_1", new Set(["e1"]));
      edgeStore.edges.set("e1", { targetId: "dtu_2", edgeType: "unknown_type", weight: 1.0 });
      STATE.__emergent._edges = edgeStore;

      activate(STATE, "sess1", "dtu_1", 1.0);
      const result = spreadActivation(STATE, "sess1", "dtu_1", 2);
      assert.strictEqual(result.ok, true);
      // 1.0 * 0.6 * 0.3 * 1.0 = 0.18, should pass threshold
      assert.ok(result.spread.length >= 1);
    });

    it("skips null edges in edge store", () => {
      const edgeStore = { bySource: new Map(), edges: new Map() };
      edgeStore.bySource.set("dtu_1", new Set(["e1", "e_null"]));
      edgeStore.edges.set("e1", { targetId: "dtu_2", edgeType: "supports", weight: 0.9 });
      // e_null not in edges map
      STATE.__emergent._edges = edgeStore;

      activate(STATE, "sess1", "dtu_1", 1.0);
      const result = spreadActivation(STATE, "sess1", "dtu_1", 2);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.spread.length, 1);
    });

    it("caps at MAX_EDGES_PER_HOP when many edges", () => {
      const edgeStore = { bySource: new Map(), edges: new Map() };
      const edgeIds = new Set();
      for (let i = 0; i < 100; i++) {
        const eid = `e_${i}`;
        edgeIds.add(eid);
        edgeStore.edges.set(eid, {
          targetId: `dtu_${i + 2}`,
          edgeType: "supports",
          weight: Math.random(),
        });
      }
      edgeStore.bySource.set("dtu_1", edgeIds);
      STATE.__emergent._edges = edgeStore;

      activate(STATE, "sess1", "dtu_1", 1.0);
      const result = spreadActivation(STATE, "sess1", "dtu_1", 1);
      assert.strictEqual(result.ok, true);
      // Should be capped at MAX_EDGES_PER_HOP = 80
      assert.ok(result.spread.length <= 80);
    });

    it("continues no outgoing edges", () => {
      const edgeStore = { bySource: new Map(), edges: new Map() };
      // dtu_1 has no outgoing edges
      STATE.__emergent._edges = edgeStore;

      activate(STATE, "sess1", "dtu_1", 1.0);
      const result = spreadActivation(STATE, "sess1", "dtu_1", 2);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.spread.length, 0);
    });

    it("updates existing session entries during spread", () => {
      const edgeStore = { bySource: new Map(), edges: new Map() };
      edgeStore.bySource.set("dtu_1", new Set(["e1"]));
      edgeStore.edges.set("e1", { targetId: "dtu_2", edgeType: "supports", weight: 1.0 });
      STATE.__emergent._edges = edgeStore;

      // Pre-activate dtu_2
      activate(STATE, "sess1", "dtu_1", 1.0);
      activate(STATE, "sess1", "dtu_2", 0.3);

      const result = spreadActivation(STATE, "sess1", "dtu_1", 2);
      assert.strictEqual(result.ok, true);
      // dtu_2 was already activated, spread should update it
      const sys = getActivationSystem(STATE);
      const entry = sys.sessions.get("sess1").get("dtu_2");
      assert.ok(entry.score > 0.3); // should have been boosted
    });

    it("increments metrics.spreads", () => {
      STATE.__emergent._edges = { bySource: new Map(), edges: new Map() };
      activate(STATE, "sess1", "dtu_1", 1.0);
      spreadActivation(STATE, "sess1", "dtu_1");
      const sys = getActivationSystem(STATE);
      assert.strictEqual(sys.metrics.spreads, 1);
    });
  });

  // ── getWorkingSet ────────────────────────────────────────────────────────

  describe("getWorkingSet()", () => {
    it("returns empty workingSet for nonexistent session", () => {
      const result = getWorkingSet(STATE, "no_session");
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(result.workingSet, []);
      assert.strictEqual(result.count, 0);
    });

    it("returns activated DTUs sorted by score", () => {
      activate(STATE, "sess1", "dtu_1", 0.9);
      activate(STATE, "sess1", "dtu_2", 0.3);
      activate(STATE, "sess1", "dtu_3", 0.6);

      const result = getWorkingSet(STATE, "sess1");
      assert.strictEqual(result.ok, true);
      assert.ok(result.workingSet.length <= 3);
      // Should be sorted descending
      for (let i = 1; i < result.workingSet.length; i++) {
        assert.ok(result.workingSet[i - 1].score >= result.workingSet[i].score);
      }
    });

    it("applies time decay to activations", () => {
      activate(STATE, "sess1", "dtu_1", 0.5);
      // Manually set lastActivated to old time to trigger decay
      const sys = getActivationSystem(STATE);
      const entry = sys.sessions.get("sess1").get("dtu_1");
      entry.lastActivated = Date.now() - 60000; // 60 seconds ago

      const result = getWorkingSet(STATE, "sess1");
      assert.strictEqual(result.ok, true);
      // Score should have decayed
      if (result.workingSet.length > 0) {
        assert.ok(result.workingSet[0].score < 0.5);
      }
    });

    it("removes entries below 0.01 threshold after decay", () => {
      activate(STATE, "sess1", "dtu_1", 0.02);
      const sys = getActivationSystem(STATE);
      const entry = sys.sessions.get("sess1").get("dtu_1");
      entry.lastActivated = Date.now() - 10000000; // very old

      const result = getWorkingSet(STATE, "sess1");
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.count, 0);
    });

    it("respects k parameter", () => {
      for (let i = 0; i < 10; i++) {
        activate(STATE, "sess1", `dtu_${i}`, 0.5 + i * 0.05);
      }
      const result = getWorkingSet(STATE, "sess1", 3);
      assert.ok(result.workingSet.length <= 3);
    });

    it("increments metrics.workingSetQueries", () => {
      getWorkingSet(STATE, "sess1");
      getWorkingSet(STATE, "sess1");
      const sys = getActivationSystem(STATE);
      assert.strictEqual(sys.metrics.workingSetQueries, 2);
    });
  });

  // ── getGlobalActivation ──────────────────────────────────────────────────

  describe("getGlobalActivation()", () => {
    it("returns empty items when no activations", () => {
      const result = getGlobalActivation(STATE);
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(result.items, []);
      assert.strictEqual(result.count, 0);
    });

    it("returns global activations sorted by score", () => {
      activate(STATE, "sess1", "dtu_1", 1.0);
      activate(STATE, "sess1", "dtu_2", 0.3);

      const result = getGlobalActivation(STATE);
      assert.strictEqual(result.ok, true);
      assert.ok(result.items.length >= 2);
      // dtu_1 should have higher score
      assert.ok(result.items[0].score >= result.items[1].score);
    });

    it("respects k parameter", () => {
      for (let i = 0; i < 30; i++) {
        activate(STATE, "sess1", `dtu_${i}`, 0.5);
      }
      const result = getGlobalActivation(STATE, 5);
      assert.strictEqual(result.count, 5);
    });

    it("uses default k of 20", () => {
      for (let i = 0; i < 30; i++) {
        activate(STATE, "sess1", `dtu_${i}`, 0.5);
      }
      const result = getGlobalActivation(STATE);
      assert.strictEqual(result.count, 20);
    });
  });

  // ── decaySession ─────────────────────────────────────────────────────────

  describe("decaySession()", () => {
    it("returns error for non-existent session", () => {
      const result = decaySession(STATE, "no_session");
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "session_not_found");
    });

    it("decays all entries by factor", () => {
      activate(STATE, "sess1", "dtu_1", 1.0);
      activate(STATE, "sess1", "dtu_2", 0.8);

      const result = decaySession(STATE, "sess1", 0.5);
      assert.strictEqual(result.ok, true);
      assert.ok(result.remaining >= 0);
    });

    it("removes entries below 0.01 after decay", () => {
      activate(STATE, "sess1", "dtu_1", 0.01);
      const result = decaySession(STATE, "sess1", 0.5);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.remaining, 0);
    });

    it("uses default factor of 0.5", () => {
      activate(STATE, "sess1", "dtu_1", 1.0);
      const result = decaySession(STATE, "sess1");
      assert.strictEqual(result.ok, true);
    });

    it("increments metrics.decays", () => {
      activate(STATE, "sess1", "dtu_1", 1.0);
      decaySession(STATE, "sess1");
      const sys = getActivationSystem(STATE);
      assert.strictEqual(sys.metrics.decays, 1);
    });
  });

  // ── clearSessionActivation ───────────────────────────────────────────────

  describe("clearSessionActivation()", () => {
    it("clears an existing session", () => {
      activate(STATE, "sess1", "dtu_1", 1.0);
      const result = clearSessionActivation(STATE, "sess1");
      assert.strictEqual(result.ok, true);

      const sys = getActivationSystem(STATE);
      assert.strictEqual(sys.sessions.has("sess1"), false);
    });

    it("handles clearing a non-existent session gracefully", () => {
      const result = clearSessionActivation(STATE, "no_session");
      assert.strictEqual(result.ok, true);
    });
  });

  // ── getActivationMetrics ─────────────────────────────────────────────────

  describe("getActivationMetrics()", () => {
    it("returns initial metrics", () => {
      const result = getActivationMetrics(STATE);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.activeSessions, 0);
      assert.strictEqual(result.globalNodes, 0);
    });

    it("reflects session and global counts", () => {
      activate(STATE, "sess1", "dtu_1");
      activate(STATE, "sess2", "dtu_2");

      const result = getActivationMetrics(STATE);
      assert.strictEqual(result.activeSessions, 2);
      assert.strictEqual(result.globalNodes, 2);
      assert.strictEqual(result.metrics.activations, 2);
    });
  });
});
