// Test for Wave 7 / A6 — felt character preserved through MEGA/HYPER compression.
// Tests rollUpFeltPeaks directly (the full compressToDMega path needs the entire
// royalty schema; the rollup logic is what A6 adds and is what we pin here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rollUpFeltPeaks } from "../economy/dtu-pipeline.js";

const child = (feltPer) => ({ content: JSON.stringify({ machine: { feltPer } }) });

test("A6 — felt-peak rollup through consolidation", async (t) => {
  await t.test("the strongest child felt-peak survives compression (not the dull middle)", () => {
    const out = rollUpFeltPeaks([
      child({ intensity: 0.1, valence: 0.1, dominantDrive: "PLAY" }),    // dull
      child({ intensity: 0.9, valence: -0.85, dominantDrive: "FEAR" }),  // the trauma (peak)
      child({ intensity: 0.3, valence: 0.2, dominantDrive: "SEEKING" }),
    ]);
    assert.ok(out.feltPer, "the consolidated parent carries a felt signature");
    assert.equal(out.feltPer.dominantDrive, "FEAR", "compression keeps the trauma");
    assert.ok(out.feltPeakScore > 0.5, "the felt-peak score rolls up");
  });

  await t.test("children with no felt signature → nothing added (back-compat)", () => {
    assert.deepEqual(rollUpFeltPeaks([{ content: "{}" }, { content: "{}" }]), {});
    assert.deepEqual(rollUpFeltPeaks([]), {});
  });

  await t.test("reads feltPer from content.machine, content.feltPer, or metadata.feltPer", () => {
    const a = rollUpFeltPeaks([{ content: JSON.stringify({ feltPer: { intensity: 0.7, valence: 0.6, dominantDrive: "CARE" } }) }]);
    assert.equal(a.feltPer.dominantDrive, "CARE");
    const b = rollUpFeltPeaks([{ metadata: { feltPer: { intensity: 0.8, valence: -0.5, dominantDrive: "RAGE" } } }]);
    assert.equal(b.feltPer.dominantDrive, "RAGE");
  });

  await t.test("totality: garbage / unparseable content never throws", () => {
    assert.doesNotThrow(() => rollUpFeltPeaks([{ content: "not json" }, null, undefined]));
    assert.deepEqual(rollUpFeltPeaks(null), {});
  });
});
