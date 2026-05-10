/**
 * EVENT_SHAPES registry tests.
 *
 * Pins the contract on the top-20 highest-traffic socket events emitted
 * via realtimeEmit (server.js:6208). The registry itself lives at
 * lib/event-shapes.js. The dev-mode validator is wired at
 * server.js:realtimeEmit so any shape violation in development logs a
 * structured warn (NODE_ENV !== "production").
 *
 * Run: node --test tests/event-shapes.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EVENT_SHAPES,
  validateEvent,
  shouldValidateEventShapes,
} from "../lib/event-shapes.js";

describe("EVENT_SHAPES — registry shape", () => {
  it("is frozen", () => {
    assert.ok(Object.isFrozen(EVENT_SHAPES));
  });

  it("every entry declares both required and optional arrays", () => {
    for (const [event, shape] of Object.entries(EVENT_SHAPES)) {
      assert.ok(Array.isArray(shape.required), `${event}: required must be an array`);
      assert.ok(Array.isArray(shape.optional), `${event}: optional must be an array`);
    }
  });

  it("every entry has at least one required field", () => {
    for (const [event, shape] of Object.entries(EVENT_SHAPES)) {
      assert.ok(shape.required.length >= 1, `${event}: should have ≥1 required field`);
    }
  });

  it("required and optional are disjoint", () => {
    for (const [event, shape] of Object.entries(EVENT_SHAPES)) {
      const both = shape.required.filter((k) => shape.optional.includes(k));
      assert.equal(both.length, 0, `${event}: ${JSON.stringify(both)} appear in both required and optional`);
    }
  });

  it("covers the top-traffic categories (combat, social, world, evo, quest, etc.)", () => {
    const events = Object.keys(EVENT_SHAPES);
    for (const prefix of ["combat:", "world:", "quest:", "social:", "evo:", "marketplace:"]) {
      assert.ok(
        events.some((e) => e.startsWith(prefix)),
        `registry must cover at least one ${prefix}* event`,
      );
    }
  });
});

describe("validateEvent — known events", () => {
  it("passes a complete combat:hit payload", () => {
    const r = validateEvent("combat:hit", {
      attackerId: "u1", victimId: "u2", damage: 25, isCrit: false,
    });
    assert.equal(r.ok, true);
  });

  it("flags missing required field on combat:hit", () => {
    const r = validateEvent("combat:hit", {
      attackerId: "u1", victimId: "u2",
      // missing 'damage'
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["damage"]);
  });

  it("flags unknown field on combat:hit", () => {
    const r = validateEvent("combat:hit", {
      attackerId: "u1", victimId: "u2", damage: 10,
      bogusField: "leak",
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.unknown, ["bogusField"]);
  });

  it("ignores reserved fields (ts, _seq, _rid, _evt) — they're auto-attached", () => {
    const r = validateEvent("combat:hit", {
      attackerId: "u1", victimId: "u2", damage: 10,
      ts: "2026-05-06T00:00:00Z", _seq: 42, _rid: "req_123", _evt: "combat:hit",
    });
    assert.equal(r.ok, true);
  });
});

describe("validateEvent — unknown events", () => {
  it("returns unregistered=true for an event not in the registry", () => {
    const r = validateEvent("totally:not:a:real:event", { foo: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.unregistered, true);
    // missing/unknown are NOT set when unregistered
    assert.equal(r.missing, undefined);
  });
});

describe("validateEvent — null/non-object payloads", () => {
  it("treats null payload as missing all required fields", () => {
    const r = validateEvent("combat:hit", null);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["attackerId", "victimId", "damage"]);
  });

  it("treats array payload as missing all required fields", () => {
    const r = validateEvent("combat:hit", []);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["attackerId", "victimId", "damage"]);
  });
});

describe("shouldValidateEventShapes — env gating", () => {
  it("returns true in development / test (NODE_ENV unset or 'test')", () => {
    const orig = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try { assert.equal(shouldValidateEventShapes(), true); }
    finally { if (orig !== undefined) process.env.NODE_ENV = orig; }
  });

  it("returns false in production", () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try { assert.equal(shouldValidateEventShapes(), false); }
    finally {
      if (orig !== undefined) process.env.NODE_ENV = orig;
      else delete process.env.NODE_ENV;
    }
  });
});

describe("Phase 2.1 — the 7 events promoted from cartograph drift", () => {
  // Each event was previously emitted by a heartbeat/route without an
  // EVENT_SHAPES entry. validateEvent returned `unregistered: true` so
  // dev-mode warnings never fired for them. Locking these shapes in
  // means a payload-field rename anywhere in the emitter chain trips
  // a structured warn during dev/test.

  it("quest:lattice-born — minimal", () => {
    assert.equal(validateEvent("quest:lattice-born", {
      questId: "q1", hostNpcId: "npc1", title: "The drift in the meadow",
    }).ok, true);
  });

  it("quest:lattice-born — with optional drift fields", () => {
    assert.equal(validateEvent("quest:lattice-born", {
      questId: "q1", hostNpcId: "npc1", title: "The drift in the meadow",
      driftType: "memetic_drift", driftSeverity: "high",
    }).ok, true);
  });

  it("beat:offered — minimal", () => {
    assert.equal(validateEvent("beat:offered", {
      id: "b1", userId: "u1", predictionId: "p1", prose: "Sovereign approaches the archive.",
    }).ok, true);
  });

  it("combat:polish — detail is free-form object", () => {
    assert.equal(validateEvent("combat:polish", {
      id: "ev1", worldId: "concordia-hub", actorKind: "user", actorId: "u1",
      eventKind: "stagger", detail: { magnitude: 0.7, structuralStress: 12 },
    }).ok, true);
  });

  it("world:region-spawned — anchor is required", () => {
    assert.equal(validateEvent("world:region-spawned", {
      regionId: "r1", worldId: "concordia-hub", regionKind: "haunted_glade",
      anchor: { x: 12, z: -5 }, radius: 1000, narrative: "A glade where memory fails.",
    }).ok, true);
  });

  it("world:season-transition — year + season fields", () => {
    assert.equal(validateEvent("world:season-transition", {
      worldId: "concordia-hub", seasonIdx: 2, seasonName: "verdant_high", year: 1,
      narrative: "The high green begins.",
    }).ok, true);
  });

  it("skill:tier-witnessed — fires from combat path", () => {
    assert.equal(validateEvent("skill:tier-witnessed", {
      userId: "u1", npcId: "npc1", worldId: "concordia-hub",
      skillId: "skill_dtu_42", skillName: "Frostpierce v2", revisionNum: 2,
      element: "ice", damage: 35, position: { x: 1, z: 2 },
    }).ok, true);
  });

  it("world:invariant-warning — surfaces detector findings", () => {
    assert.equal(validateEvent("world:invariant-warning", {
      id: "f1", message: "Royalty cap breached", severity: "critical",
      location: "server/economy/royalty-cascade.js:180",
      generatedAt: "2026-05-09T12:00:00Z",
    }).ok, true);
  });

  it("world:invariant-warning — location and generatedAt are optional", () => {
    assert.equal(validateEvent("world:invariant-warning", {
      id: "f1", message: "Royalty cap breached", severity: "critical",
    }).ok, true);
  });
});

describe("Round-trip: every registered event accepts a minimal valid payload", () => {
  // For each registered event, build a payload with only the required
  // fields populated as `"x"` strings or `1` numbers. The validator must
  // accept it. This catches typos in the registry itself.
  for (const [event, shape] of Object.entries(EVENT_SHAPES)) {
    it(`${event} accepts minimal required-only payload`, () => {
      const payload = {};
      for (const k of shape.required) payload[k] = typeof payload[k] === "number" ? 1 : "x";
      const r = validateEvent(event, payload);
      assert.equal(r.ok, true, `${event}: minimal payload should validate, got ${JSON.stringify(r)}`);
    });
  }
});
