/**
 * Tier-2 contract test for the Goddess Arc registry — author-time
 * validation + phase selection + cross-instance import round-trip.
 *
 * Every arc the user authors via `/api/world/arc-author` flows through
 * `validateGoddessArc` before it lands in the registry. When an arc is
 * federated to a peer instance and re-imported, both ends must come to
 * the same conclusion about which phase is active for a given world
 * signal — otherwise narrative tone drifts apart instance-to-instance.
 *
 * Run: node --test tests/goddess-arc-federation.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  validateGoddessArc,
  addGoddessArc,
  getGoddessArc,
  getArcForNPC,
  removeGoddessArc,
  selectPhase,
  GODDESS_ARC_METRICS,
  GODDESS_ARC_TONES,
} from "../lib/goddess-arcs.js";

const sampleArc = () => ({
  id: "arc_winter_patron",
  name: "Patron of the Long Winter",
  patron_npc_id: "npc_winter_patron",
  // Order matters: most specific first so wrathful overrides default warm.
  phases: [
    {
      id: "wrathful_compound_refusal",
      tone: "wrathful",
      conditions: { refusal_field_strength: { gte: 6 } },
      dialogue: [
        "The world has refused too much.",
        "I do not speak through compound silence.",
      ],
      cinematic: { soundscape: "low_drone", camera: "tight_high" },
    },
    {
      id: "mournful_cold",
      tone: "mournful",
      conditions: { ecosystem_score: { lte: 30 } },
      dialogue: ["The frost remembers what you forgot."],
    },
    {
      id: "warm_default",
      tone: "warm",
      // No conditions → catch-all default phase.
      dialogue: ["The fire holds; sit a while."],
    },
  ],
});

describe("validateGoddessArc — author-time validation", () => {
  it("accepts a well-formed arc", () => {
    const r = validateGoddessArc(sampleArc());
    assert.equal(r.ok, true);
  });

  it("rejects missing id", () => {
    const arc = sampleArc();
    delete arc.id;
    assert.equal(validateGoddessArc(arc).ok, false);
  });

  it("rejects missing patron_npc_id", () => {
    const arc = sampleArc();
    delete arc.patron_npc_id;
    const r = validateGoddessArc(arc);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_patron_npc_id");
  });

  it("rejects empty phases", () => {
    const arc = sampleArc();
    arc.phases = [];
    assert.equal(validateGoddessArc(arc).ok, false);
  });

  it("rejects unknown metric in conditions", () => {
    const arc = sampleArc();
    arc.phases[0].conditions = { vibe: { gte: 9 } };
    const r = validateGoddessArc(arc);
    assert.equal(r.ok, false);
    assert.match(r.reason, /vibe_invalid_metric/);
  });

  it("rejects unknown comparator in conditions", () => {
    const arc = sampleArc();
    arc.phases[0].conditions = { ecosystem_score: { approximately: 50 } };
    const r = validateGoddessArc(arc);
    assert.equal(r.ok, false);
    assert.match(r.reason, /approximately_invalid_comparator/);
  });

  it("rejects unknown tone (so authored content can't introduce a tone the renderer doesn't know)", () => {
    const arc = sampleArc();
    arc.phases[0].tone = "smug";
    const r = validateGoddessArc(arc);
    assert.equal(r.ok, false);
    assert.match(r.reason, /tone_unknown/);
  });

  it("rejects empty-string dialogue lines", () => {
    const arc = sampleArc();
    arc.phases[0].dialogue = ["", "valid"];
    const r = validateGoddessArc(arc);
    assert.equal(r.ok, false);
  });

  it("exposes the metric / tone / comparator allowlists for UI use", () => {
    assert.ok(GODDESS_ARC_METRICS.includes("ecosystem_score"));
    assert.ok(GODDESS_ARC_METRICS.includes("refusal_field_strength"));
    assert.ok(GODDESS_ARC_TONES.includes("warm"));
    assert.ok(GODDESS_ARC_TONES.includes("wrathful"));
  });
});

describe("addGoddessArc + getArcForNPC — registry round-trip", () => {
  beforeEach(() => {
    removeGoddessArc("arc_winter_patron");
  });

  it("registers an arc and looks it up by NPC id", () => {
    const r = addGoddessArc(sampleArc());
    assert.equal(r.ok, true);
    const found = getArcForNPC("npc_winter_patron");
    assert.ok(found);
    assert.equal(found.id, "arc_winter_patron");
  });

  it("rejects a malformed arc and leaves the registry untouched", () => {
    const broken = sampleArc();
    delete broken.phases;
    const r = addGoddessArc(broken);
    assert.equal(r.ok, false);
    assert.equal(getGoddessArc("arc_winter_patron"), null);
  });
});

describe("selectPhase — phase resolution against live world signals", () => {
  it("picks the wrathful compound-refusal phase when refusal_field_strength >= 6", () => {
    const phase = selectPhase(sampleArc(), {
      ecosystem_score: 75,
      refusal_field_strength: 7,
    });
    assert.ok(phase);
    assert.equal(phase.id, "wrathful_compound_refusal");
    assert.equal(phase.tone, "wrathful");
  });

  it("picks the mournful cold phase when ecosystem_score is low and refusal isn't compound", () => {
    const phase = selectPhase(sampleArc(), {
      ecosystem_score: 20,
      refusal_field_strength: 1,
    });
    assert.ok(phase);
    assert.equal(phase.id, "mournful_cold");
  });

  it("falls back to the catch-all warm phase when no condition matches", () => {
    const phase = selectPhase(sampleArc(), {
      ecosystem_score: 80,
      refusal_field_strength: 0,
    });
    assert.ok(phase);
    assert.equal(phase.id, "warm_default");
  });

  it("returns null when given a non-arc", () => {
    assert.equal(selectPhase(null, {}), null);
    assert.equal(selectPhase({ phases: null }, {}), null);
  });
});

describe("federation round-trip — exporting and re-importing an arc gives the same selectPhase", () => {
  it("a JSON-serialised arc that's re-imported on a peer instance produces identical phase selection", () => {
    // Author on instance A.
    removeGoddessArc("arc_winter_patron");
    const original = sampleArc();
    const r1 = addGoddessArc(original);
    assert.equal(r1.ok, true);

    const phaseLocal = selectPhase(original, {
      ecosystem_score: 25,
      refusal_field_strength: 2,
    });
    assert.equal(phaseLocal.id, "mournful_cold");

    // Export → wire → re-import on instance B (simulated by JSON round-trip + addGoddessArc).
    const serialised = JSON.stringify(original);
    const remote = JSON.parse(serialised);

    // The remote instance must reach the same validation conclusion.
    const v = validateGoddessArc(remote);
    assert.equal(v.ok, true);

    // And produce the same phase selection for the same signals.
    const phaseRemote = selectPhase(remote, {
      ecosystem_score: 25,
      refusal_field_strength: 2,
    });
    assert.equal(phaseRemote.id, phaseLocal.id);
    assert.equal(phaseRemote.tone, phaseLocal.tone);
    assert.deepEqual(phaseRemote.dialogue, phaseLocal.dialogue);
  });

  it("imported arc still gates compound-refusal correctly (the load-bearing tone selection)", () => {
    const arc = JSON.parse(JSON.stringify(sampleArc()));
    // Per CLAUDE.md: refusal_field_strength >= 6 → compound-refusal phase
    // overrides ecosystem-driven tone. The federation surface must
    // preserve this — otherwise a peer instance would render warm
    // dialogue while the world is in compound-refusal locally.
    const phase = selectPhase(arc, {
      ecosystem_score: 90,           // would normally pick warm
      refusal_field_strength: 6,     // but compound-refusal wins
    });
    assert.equal(phase.tone, "wrathful");
  });

  it("rejects a malformed arc on import (federation can't sneak invalid arcs past validation)", () => {
    const arc = sampleArc();
    arc.phases.push({ id: "bad", dialogue: ["leak"], tone: "smug" }); // invalid tone
    const wireFormat = JSON.stringify(arc);
    const remote = JSON.parse(wireFormat);
    const v = validateGoddessArc(remote);
    assert.equal(v.ok, false);
  });
});
