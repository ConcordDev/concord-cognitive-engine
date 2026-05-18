// server/tests/smoking-gun-sprint-7.test.js
//
// Sprint 7 — I3 entities + I5 cognitiveDigitalTwins were both
// excluded from _serializeState/_hydrateState despite calling
// saveStateDebounced. Tests verify the serialize/hydrate round-trip
// preserves both Maps as in-memory shapes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Replicate the serialize/hydrate shape from server.js for the
// two newly-added fields. This is integration-style without
// requiring the full server boot.

function capArr(m, max) {
  const arr = m && typeof m.values === "function" ? Array.from(m.values()) : [];
  return arr.length > max ? arr.slice(-max) : arr;
}

function serialize(STATE) {
  return {
    entities: capArr(STATE.entities, 5000),
    cognitiveDigitalTwins: Array.from(STATE.cognitiveDigitalTwins?.entries() || []).slice(-10000),
  };
}

function hydrate(STATE, obj) {
  if (Array.isArray(obj.entities)) {
    if (!STATE.entities) STATE.entities = new Map();
    STATE.entities.clear();
    for (const e of obj.entities) if (e && e.id) STATE.entities.set(e.id, e);
  }
  if (Array.isArray(obj.cognitiveDigitalTwins)) {
    if (!STATE.cognitiveDigitalTwins) STATE.cognitiveDigitalTwins = new Map();
    STATE.cognitiveDigitalTwins.clear();
    for (const entry of obj.cognitiveDigitalTwins) {
      if (Array.isArray(entry) && entry.length === 2 && entry[0]) {
        STATE.cognitiveDigitalTwins.set(entry[0], entry[1]);
      }
    }
  }
}

describe("I3 — entities snapshot round-trip", () => {
  it("preserves agent shape across serialize → hydrate", () => {
    const STATE = { entities: new Map() };
    STATE.entities.set("agent:1", {
      id: "agent:1",
      ownerId: "u_owner",
      type: "personal_agent",
      species: "agent",
      displayName: "Alpha",
      domain: "general",
      role: "concierge",
      watchedLenses: ["chat", "docs"],
      proactiveActions: true,
      priorities: ["respond_fast"],
      createdAt: "2026-05-18T12:00:00.000Z",
    });
    const blob = serialize(STATE);
    const restored = {};
    hydrate(restored, blob);
    const got = restored.entities.get("agent:1");
    assert.equal(got.ownerId, "u_owner");
    assert.deepEqual(got.watchedLenses, ["chat", "docs"]);
    assert.equal(got.displayName, "Alpha");
  });

  it("caps entities at 5000 most recent on serialize", () => {
    const STATE = { entities: new Map() };
    for (let i = 0; i < 5050; i++) {
      STATE.entities.set(`agent:${i}`, { id: `agent:${i}`, type: "x", createdAt: String(i) });
    }
    const blob = serialize(STATE);
    assert.equal(blob.entities.length, 5000);
    // The slice(-5000) keeps the LAST 5000, so agent:0..49 dropped, agent:50..5049 kept
    assert.equal(blob.entities[0].id, "agent:50");
    assert.equal(blob.entities[4999].id, "agent:5049");
  });

  it("skips malformed entries on hydrate", () => {
    const STATE = {};
    hydrate(STATE, { entities: [null, undefined, {}, { id: "valid", x: 1 }] });
    assert.equal(STATE.entities.size, 1);
    assert.ok(STATE.entities.has("valid"));
  });
});

describe("I5 — cognitiveDigitalTwins snapshot round-trip", () => {
  it("preserves twin shape across serialize → hydrate via [k,v] tuples", () => {
    const STATE = { cognitiveDigitalTwins: new Map() };
    STATE.cognitiveDigitalTwins.set("u_twin_a", {
      userId: "u_twin_a",
      processingSpeed: { docs: { avgTimeMs: 1200, qualityScore: 0.85, count: 5 } },
      cognitiveLoad: { threshold: 3, currentLoad: 1, history: [{ at: 1, load: 2 }] },
      decisionPatterns: { quickDecisions: 10 },
    });
    const blob = serialize(STATE);
    const restored = {};
    hydrate(restored, blob);
    const got = restored.cognitiveDigitalTwins.get("u_twin_a");
    assert.equal(got.userId, "u_twin_a");
    assert.equal(got.processingSpeed.docs.qualityScore, 0.85);
    assert.equal(got.cognitiveLoad.currentLoad, 1);
  });

  it("caps twins at 10000 most recent on serialize", () => {
    const STATE = { cognitiveDigitalTwins: new Map() };
    for (let i = 0; i < 10100; i++) {
      STATE.cognitiveDigitalTwins.set(`u${i}`, { userId: `u${i}`, x: i });
    }
    const blob = serialize(STATE);
    assert.equal(blob.cognitiveDigitalTwins.length, 10000);
  });

  it("skips entries with no userId on hydrate", () => {
    const STATE = {};
    hydrate(STATE, { cognitiveDigitalTwins: [
      ["valid_u", { x: 1 }],
      ["", { x: 2 }],
      [null, { x: 3 }],
      "not_an_array",
    ] });
    assert.equal(STATE.cognitiveDigitalTwins.size, 1);
    assert.ok(STATE.cognitiveDigitalTwins.has("valid_u"));
  });
});
