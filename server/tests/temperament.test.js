// Contract test for Wave 7 / Layer 3b — individual temperament.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  birthTemperament,
  copingStyle,
  plasticityAtAge,
  applyDevelopmentalTuning,
  driftFromFeltPeak,
} from "../lib/ecosystem/temperament.js";
import { DRIVE_KINDS } from "../lib/ecosystem/drives.js";

function allInRange(vec) {
  return DRIVE_KINDS.every((k) => vec[k] >= 0 && vec[k] <= 1 && Number.isFinite(vec[k]));
}

test("Wave 7 — individual temperament (Layer 3b)", async (t) => {
  await t.test("birth is deterministic on seed and total", () => {
    const a = birthTemperament({ speciesId: "deer", seed: "w|deer|alpha" });
    const b = birthTemperament({ speciesId: "deer", seed: "w|deer|alpha" });
    assert.deepEqual(a, b, "same seed → same vector (idempotent across restart)");
    assert.ok(allInRange(a), "all 7 drives in [0,1]");
    // unknown species still total
    assert.ok(allInRange(birthTemperament({ speciesId: "nonsense-xyz", seed: "s" })));
    assert.ok(allInRange(birthTemperament({})), "no args → total");
  });

  await t.test("two children of the same parents are different but correlated", () => {
    const mom = birthTemperament({ speciesId: "wolf", seed: "mom" });
    const dad = birthTemperament({ speciesId: "wolf", seed: "dad" });
    const kid1 = birthTemperament({ speciesId: "wolf", parents: [mom, dad], seed: "kid1" });
    const kid2 = birthTemperament({ speciesId: "wolf", parents: [mom, dad], seed: "kid2" });
    assert.notDeepEqual(kid1, kid2, "different seeds → different children (variation)");
    // each child should sit near the parent mean on most axes (correlation)
    let nearMean = 0;
    for (const k of DRIVE_KINDS) {
      const mean = (mom[k] + dad[k]) / 2;
      if (Math.abs(kid1[k] - mean) < 0.35) nearMean++;
    }
    assert.ok(nearMean >= 4, "child correlates with parent mean on most axes");
  });

  await t.test("identical parents (high stability) breed nearly true", () => {
    const p = birthTemperament({ speciesId: "rabbit", seed: "p" });
    const kid = birthTemperament({ speciesId: "rabbit", parents: [p, p], seed: "k" });
    let close = 0;
    for (const k of DRIVE_KINDS) if (Math.abs(kid[k] - p[k]) < 0.06) close++;
    assert.ok(close >= 5, "high-stability blend stays close to the parent vector");
  });

  await t.test("plasticity decays with age", () => {
    assert.ok(plasticityAtAge(0) > plasticityAtAge(0.5));
    assert.ok(plasticityAtAge(0.5) > plasticityAtAge(1));
    assert.ok(plasticityAtAge(0) <= 1 && plasticityAtAge(1) >= 0);
  });

  await t.test("an infant shifts more than an adult under the same experience", () => {
    const base = birthTemperament({ speciesId: "deer", seed: "x" });
    const delta = { FEAR: 0.5 };
    const infant = applyDevelopmentalTuning(base, 0.0, delta);
    const adult = applyDevelopmentalTuning(base, 1.0, delta);
    const infantShift = infant.FEAR - base.FEAR;
    const adultShift = adult.FEAR - base.FEAR;
    assert.ok(infantShift > adultShift, "developmental window is age-weighted");
    assert.ok(adultShift >= 0 && adultShift < 0.1, "adult barely moves");
  });

  await t.test("a run of FEAR peaks drifts resting FEAR up (the plasticity mechanism)", () => {
    let t0 = birthTemperament({ speciesId: "wolf", seed: "brave" });
    const startFear = t0.FEAR;
    for (let i = 0; i < 30; i++) {
      t0 = driftFromFeltPeak(t0, { dominantDrive: "FEAR", intensity: 0.9 }, 0.3);
    }
    assert.ok(t0.FEAR > startFear, "a hard year of FEAR peaks raises resting FEAR");
    // a single peak must NOT rewrite the character
    const one = driftFromFeltPeak(birthTemperament({ speciesId: "wolf", seed: "brave" }),
      { dominantDrive: "FEAR", intensity: 1.0 }, 0.3);
    assert.ok(one.FEAR - startFear < 0.05, "one event nudges, doesn't rewrite");
  });

  await t.test("copingStyle maps a FEAR-dominant vector to shy/reactive", () => {
    const shy = { SEEKING: 0.2, RAGE: 0.1, FEAR: 0.9, CARE: 0.3, PANIC: 0.7, PLAY: 0.1, LUST: 0.2 };
    const bold = { SEEKING: 0.9, RAGE: 0.7, FEAR: 0.1, CARE: 0.3, PANIC: 0.1, PLAY: 0.6, LUST: 0.3 };
    const cs = copingStyle(shy);
    const cb = copingStyle(bold);
    assert.ok(cs.boldShy < 0 && cs.proactiveReactive < 0, "FEAR-dominant → shy + reactive");
    assert.ok(cb.boldShy > 0 && cb.proactiveReactive > 0, "SEEKING/RAGE-dominant → bold + proactive");
    // totality
    assert.ok(copingStyle(null).boldShy >= -1 && copingStyle({}).boldShy <= 1);
  });
});
