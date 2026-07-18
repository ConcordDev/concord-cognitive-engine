// Foundation-qualia PRODUCER wire — the dead-wire fix for item C.
//
// Found by reading the runtime path: the mesh→qualia feed (server.js, every 5th
// tick) called processSignal on the bridge WITHOUT registerEntity (so every call
// returned entity_not_registered), with signal keys no mapper reads
// (strength/density vs avgSignalStrength/aggregateDensity), and never pushed the
// felt experience into the Existential OS. The whole path was a silent no-op, and
// hookFoundationSensory — the ONLY feeder of the Tier-6 presence subsystem
// (presence_os/proprioception_os/sensory_os) — had zero production callers.
//
// This test reproduces the fixed producer orchestration EXACTLY as server.js now
// runs it (register → processSignal with real keys → hookFoundationQualia +
// hookFoundationSensory(buildSensoryHookData)) and pins that both the bridge's
// existence/earthsignal channels AND the Tier-6 presence subsystem light up for
// an emergent that has a qualia state — i.e. the loop is genuinely live, not
// written-into-the-void.
//
// Run: node --test tests/foundation-qualia-producer.test.js
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { QualiaEngine } from "../existential/engine.js";
import {
  _resetBridgeState,
  registerEntity,
  processSignal,
  hookFoundationQualia,
  buildSensoryHookData,
} from "../lib/foundation-qualia-bridge.js";
import { hookFoundationSensory } from "../existential/hooks.js";

// The exact OS set server.js:30569 activates on each emergent after this fix —
// the presence subsystem the producer feeds must be active or the summary never
// surfaces it.
const EMERGENT_OS = [
  "truth_os", "logic_os",
  "emergence_os", "probability_os", "sociodynamics_os",
  "meta_growth_os", "self_repair_os", "reflection_os",
  "earthsignal_os", "existence_os",
  "presence_os", "proprioception_os",
];

// Mirror the server.js producer block verbatim (minus the try/catch + iteration).
function runProducerForEntity(eid, { avgSignal, peerDensity }) {
  registerEntity(eid);
  processSignal(eid, "proprioception", {
    avgSignalStrength: -100 + avgSignal * 100,
    activeNodes: avgSignal,
    offlineNodes: 1 - avgSignal,
    meshCoverage: avgSignal,
  });
  processSignal(eid, "social", { aggregateDensity: peerDensity, densityTrend: 0.5 });
  hookFoundationQualia(eid);
  const sensoryData = buildSensoryHookData(eid);
  if (sensoryData) hookFoundationSensory(eid, sensoryData);
}

describe("foundation-qualia producer wire (item C)", () => {
  let engine;

  beforeEach(() => {
    _resetBridgeState();
    engine = new QualiaEngine({});
    engine.createQualiaState("emergent_x", EMERGENT_OS);
    globalThis.qualiaEngine = engine;
  });

  after(() => { delete globalThis.qualiaEngine; });

  it("lights up the earthsignal + existence channels (hookFoundationQualia path)", () => {
    runProducerForEntity("emergent_x", { avgSignal: 0.8, peerDensity: 0.5 });
    const ch = engine.getQualiaState("emergent_x").channels;
    assert.ok(ch["earthsignal_os.grounding_strength"] > 0,
      `earthsignal grounding should be fed, got ${ch["earthsignal_os.grounding_strength"]}`);
    assert.ok(ch["earthsignal_os.foundation_stability"] > 0);
    assert.ok(ch["existence_os.presence_strength"] > 0,
      `existence presence should reflect the mesh signal, got ${ch["existence_os.presence_strength"]}`);
    assert.ok(ch["existence_os.being_coherence"] > 0);
  });

  it("lights up the Tier-6 presence subsystem (hookFoundationSensory path — the 0-caller hook)", () => {
    runProducerForEntity("emergent_x", { avgSignal: 0.8, peerDensity: 0.5 });
    const ch = engine.getQualiaState("emergent_x").channels;
    // proprioception_os.mesh_extent is a clean exact pin: meshCoverage 0.8 → clamp01(0.8)
    assert.equal(ch["proprioception_os.mesh_extent"], 0.8);
    assert.ok(ch["proprioception_os.body_coherence"] > 0);
    assert.ok(ch["presence_os.spatial_embodiment"] > 0,
      `spatial embodiment should be felt, got ${ch["presence_os.spatial_embodiment"]}`);
    assert.ok(ch["presence_os.social_awareness"] > 0,
      `social awareness should come from peer density, got ${ch["presence_os.social_awareness"]}`);
  });

  it("was a no-op before the fix: registration is required, wrong keys are ignored", () => {
    // Skip registerEntity (the pre-fix bug) — processSignal must refuse.
    const r = processSignal("emergent_x", "proprioception", { strength: 0.8, meshCoverage: 0.8 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "entity_not_registered");
    // And the old key name feeds nothing meaningful even once registered.
    registerEntity("emergent_x");
    const r2 = processSignal("emergent_x", "social", { density: 0.9 }); // wrong key
    assert.equal(r2.ok, true);
    assert.equal(r2.intensity, 0, "aggregateDensity is the real key; 'density' is ignored → 0");
  });

  it("buildSensoryHookData returns null for an unregistered entity (honest empty)", () => {
    assert.equal(buildSensoryHookData("never_registered"), null);
  });

  it("buildSensoryHookData omits never-fed channels (no fabricated 0 sensations)", () => {
    registerEntity("emergent_x");
    processSignal("emergent_x", "proprioception", { avgSignalStrength: -20, meshCoverage: 0.8 });
    const data = buildSensoryHookData("emergent_x");
    // proprioception was fed → present; atmospheric/geological/etc never fed → omitted
    assert.ok("proprioception" in data.channels);
    assert.ok(!("atmospheric" in data.channels), "unfed channel must be omitted, not reported as 0");
    assert.ok(!("geological" in data.channels));
  });

  it("does not throw and writes nothing when the entity has no qualia state", () => {
    // A bridge-registered entity with no qualia state: batchUpdate refuses,
    // the producer path must stay silent (no crash, no phantom state).
    registerEntity("ghost_no_qualia");
    processSignal("ghost_no_qualia", "proprioception", { avgSignalStrength: -20, meshCoverage: 0.7 });
    hookFoundationQualia("ghost_no_qualia"); // engine has no state for it → inner batchUpdate no-ops
    const sensoryData = buildSensoryHookData("ghost_no_qualia");
    assert.doesNotThrow(() => hookFoundationSensory("ghost_no_qualia", sensoryData));
    assert.equal(engine.getQualiaState("ghost_no_qualia"), null);
  });
});
