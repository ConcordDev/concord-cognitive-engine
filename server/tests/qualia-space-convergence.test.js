// Contract test for Wave 7 / Track A7 — quality-space + multi-mode convergence binding.
// These measure STRUCTURE (the correlate), never a phenomenal-consciousness claim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { qualeOf, similarity, REFERENCE_QUALIA } from "../lib/qualia-space.js";
import { bindQuale } from "../lib/qualia-bind.js";

const RELIEF  = { valence: 0.7, arousal: 0.4, dominantDrive: "SEEKING" };
const TRIUMPH = { valence: 0.9, arousal: 0.8, dominantDrive: "RAGE" };
const DREAD   = { valence: -0.7, arousal: 0.9, dominantDrive: "FEAR" };

test("Track A7 — quality-space + convergence binding", async (t) => {
  await t.test("qualeOf places relief nearer triumph than dread (the geometry is the content)", () => {
    const relief = qualeOf(RELIEF);
    const simTriumph = similarity(relief, TRIUMPH);
    const simDread = similarity(relief, DREAD);
    assert.ok(simTriumph > simDread,
      `relief~triumph (${simTriumph.toFixed(2)}) > relief~dread (${simDread.toFixed(2)})`);
    assert.ok(relief.label, "a quale gets a nearest-reference label");
    assert.ok(relief.nearest.length >= 1);
  });

  await t.test("similarity is 1 at identity, decays with distance", () => {
    assert.ok(similarity(RELIEF, RELIEF) > 0.99);
    assert.ok(similarity(RELIEF, DREAD) < similarity(RELIEF, TRIUMPH));
  });

  await t.test("bindQuale: more converging modes → higher pinning (each mode constitutive)", () => {
    const aSignal = 0.5;
    const allModes = { memory: RELIEF, attention: RELIEF, selfModel: RELIEF, behavior: RELIEF };
    const full = bindQuale(RELIEF, { aSignal, modes: allModes });
    // remove one mode → coverage drops → convergence drops
    const fewer = bindQuale(RELIEF, { aSignal, modes: { memory: RELIEF, attention: RELIEF, selfModel: RELIEF } });
    assert.ok(full.convergence > fewer.convergence, "dropping a mode lowers the pinning score");
    assert.equal(full.bound, true, "four converging modes bind a determinate quale");
    assert.equal(full.present, 4);
  });

  await t.test("a disagreeing mode lowers agreement", () => {
    const aSignal = 0.5;
    const mixed = bindQuale(RELIEF, { aSignal, modes: { memory: RELIEF, attention: DREAD, selfModel: RELIEF, behavior: RELIEF } });
    const aligned = bindQuale(RELIEF, { aSignal, modes: { memory: RELIEF, attention: RELIEF, selfModel: RELIEF, behavior: RELIEF } });
    assert.ok(mixed.convergence < aligned.convergence, "an incoherent mode reduces convergence");
  });

  await t.test("the A-signal gates: an unlit state binds no quale even at high magnitude", () => {
    const highMagnitude = { valence: -0.95, arousal: 0.95, dominantDrive: "FEAR" };
    const unlit = bindQuale(highMagnitude, { aSignal: 0.01, modes: { memory: highMagnitude, attention: highMagnitude, selfModel: highMagnitude, behavior: highMagnitude } });
    assert.equal(unlit.bound, false);
    assert.equal(unlit.reason, "unlit", "access (B8) gates phenomenal construction — Block's A/P in code");
  });

  await t.test("disabled env → no-op; never throws on garbage", () => {
    const prev = process.env.CONCORD_QUALIA_SPACE;
    process.env.CONCORD_QUALIA_SPACE = "0";
    assert.equal(bindQuale(RELIEF, { aSignal: 0.9, modes: {} }).enabled, false);
    assert.equal(qualeOf(RELIEF).enabled, false);
    if (prev === undefined) delete process.env.CONCORD_QUALIA_SPACE; else process.env.CONCORD_QUALIA_SPACE = prev;
    assert.doesNotThrow(() => bindQuale(null, null));
    assert.doesNotThrow(() => qualeOf(undefined));
    assert.ok(REFERENCE_QUALIA.length >= 6);
  });
});
