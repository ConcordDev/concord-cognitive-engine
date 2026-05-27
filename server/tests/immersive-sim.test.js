// Contract test for the immersive-sim Phase II Wave 27 substrate.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  PROP_VERBS, getVerbsForProp, hasVerb, listAllPropKinds, resolveVerbInvocation,
} from "../lib/prop-verb-registry.js";
import {
  probabilityOfRecognition, rollRecognition,
} from "../lib/disguise-system.js";
import registerImmersiveSimMacros from "../domains/immersive-sim.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, input = {}) {
  const fn = ACTIONS.get(`immersive_sim.${name}`);
  assert.ok(fn, `immersive_sim.${name} not registered`);
  return fn({}, input);
}

before(() => { registerImmersiveSimMacros(register); });

describe("prop-verb-registry", () => {
  it("each registered prop has at least 2 verbs", () => {
    for (const propKind of listAllPropKinds()) {
      const verbs = getVerbsForProp(propKind);
      assert.ok(verbs.length >= 2, `${propKind} should have ≥2 verbs`);
    }
  });

  it("hasVerb correctly checks", () => {
    assert.equal(hasVerb("barrel", "explode"), true);
    assert.equal(hasVerb("barrel", "sing"), false);
    assert.equal(hasVerb("unknown_prop", "anything"), false);
  });

  it("resolveVerbInvocation returns signal + cooldown for known verbs", () => {
    const r = resolveVerbInvocation("lamp", "break");
    assert.equal(r.ok, true);
    assert.equal(r.signal?.kind, "sight_os.illumination");
    assert.ok(r.cooldownMs > 0);
  });

  it("resolveVerbInvocation rejects unknown verb + lists available", () => {
    const r = resolveVerbInvocation("lamp", "spin");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_verb");
    assert.ok(r.availableVerbs.includes("ignite"));
  });

  it("PROP_VERBS includes all 9 prop kinds", () => {
    const expected = ["lever", "barrel", "statue", "lamp", "door", "brazier", "crate", "rope", "fountain"];
    for (const k of expected) {
      assert.ok(PROP_VERBS[k], `${k} should be in registry`);
    }
  });

  it("barrel explode emits a thermal signal cascade", () => {
    const r = resolveVerbInvocation("barrel", "explode");
    assert.equal(r.signal.kind, "thermal_os.ambient_temp");
    assert.ok(r.signal.value > 0);
  });

  it("fountain poison emits negative air_quality", () => {
    const r = resolveVerbInvocation("fountain", "poison");
    assert.equal(r.signal.kind, "chemical_os.air_quality");
    assert.ok(r.signal.value < 0);
  });
});

describe("disguise-system", () => {
  it("low familiarity + dark + far = low recognition probability", () => {
    const p = probabilityOfRecognition({
      familiarity: 0, illuminationLux: 1000, distanceM: 25, disguiseQuality: 0.8, sameFaction: false,
    });
    assert.ok(p < 0.25, `expected low p, got ${p}`);
  });

  it("high familiarity + bright + close + same faction = high recognition probability", () => {
    const p = probabilityOfRecognition({
      familiarity: 90, illuminationLux: 20000, distanceM: 1, disguiseQuality: 0.1, sameFaction: true,
    });
    assert.ok(p > 0.6, `expected high p, got ${p}`);
  });

  it("disguise quality directly reduces recognition", () => {
    const low = probabilityOfRecognition({ familiarity: 50, distanceM: 10, disguiseQuality: 0.0 });
    const high = probabilityOfRecognition({ familiarity: 50, distanceM: 10, disguiseQuality: 1.0 });
    assert.ok(high < low);
  });

  it("rollRecognition with rollOverride is deterministic", () => {
    const r = rollRecognition({ familiarity: 100, distanceM: 1, disguiseQuality: 0, rollOverride: 0.01 });
    assert.equal(r.recognised, true);
    const r2 = rollRecognition({ familiarity: 0, distanceM: 50, disguiseQuality: 1, rollOverride: 0.99 });
    assert.equal(r2.recognised, false);
  });
});

describe("immersive_sim domain macros", () => {
  it("prop_verbs + invoke_verb + recognition_probability + roll_recognition wired", async () => {
    const verbs = await call("prop_verbs", { propKind: "barrel" });
    assert.equal(verbs.verbs.length, 3);
    const inv = await call("invoke_verb", { propKind: "barrel", verb: "explode" });
    assert.equal(inv.ok, true);
    const probability = await call("recognition_probability", { familiarity: 0, distanceM: 30, disguiseQuality: 0.9 });
    assert.ok(probability.probability >= 0 && probability.probability <= 1);
    const roll = await call("roll_recognition", { familiarity: 0, distanceM: 30, rollOverride: 0.999 });
    assert.equal(roll.recognised, false);
  });

  it("all_prop_kinds + has_verb + registries macros work", async () => {
    const kinds = await call("all_prop_kinds", {});
    assert.ok(kinds.propKinds.length >= 9);
    const h = await call("has_verb", { propKind: "lamp", verb: "break" });
    assert.equal(h.has, true);
    const reg = await call("registries", {});
    assert.ok(reg.propRegistry.barrel);
    assert.ok(reg.disguiseConstants.DISGUISE_BASE_RECOGNITION);
  });
});
