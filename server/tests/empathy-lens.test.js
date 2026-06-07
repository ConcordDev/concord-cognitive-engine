// Contract test for Wave 7 / B7-extension — lens-filtered reconstruction + deception.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLens,
  reconstructOther,
  deceptionLands,
  driftLensFromDeception,
  lensVariance,
} from "../lib/empathy-lens.js";

// an honest other in real distress
const HONEST = { expressed: { v: -0.7, a: 0.8, dominantDrive: "FEAR" } };
// a con: displays warmth, hides a hostile intent, betrayed by a subtle tell
const CON = {
  expressed: { v: 0.7, a: 0.4, dominantDrive: "CARE" },
  hidden: { v: -0.5, a: 0.6, dominantDrive: "RAGE" },
  tell: { kind: "deception", strength: 0.3 },
};

test("B7-ext — lens-filtered reconstruction + deception", async (t) => {
  await t.test("two different lenses reconstruct the SAME signals differently (the lossiness is selfhood)", () => {
    // a content reader vs a fearful reader — egocentric projection colors each read
    const contentLens = buildLens({ affect: { v: 0.8, a: 0.2 }, temperament: { CARE: 0.8, SEEKING: 0.3 } });
    const fearfulLens = buildLens({ affect: { v: -0.8, a: 0.9 }, temperament: { FEAR: 0.8, PANIC: 0.7 } });
    const a = reconstructOther(contentLens, HONEST);
    const b = reconstructOther(fearfulLens, HONEST);
    assert.notEqual(a.valence.toFixed(3), b.valence.toFixed(3), "the read carries the reader");
    assert.ok(a.valence > b.valence, "the content reader renders it less bleak; the fearful reader darker");
  });

  await t.test("a perfect mirror would erase the interpreter (projection is load-bearing)", () => {
    // an agent with zero self-affect projects nothing → reads the raw signal (a mirror)
    const mirror = buildLens({ affect: { v: 0, a: 0 }, temperament: { SEEKING: 0.9 } });
    const r = reconstructOther(mirror, HONEST);
    assert.ok(Math.abs(r.valence - (-0.7)) < 0.25, "near-mirror read ≈ the raw signal");
  });

  await t.test("a naive lens falls for the con; a con-spotting lens sees through it", () => {
    const naive = buildLens({ temperament: { CARE: 0.7 } }); // no deception sensitivity
    const conSpotter = buildLens({ feltHistory: [
      { lesson: "deception", intensity: 0.9 }, { lesson: "deception", intensity: 0.9 },
      { lesson: "deception", intensity: 0.9 }, { lesson: "deception", intensity: 0.9 },
    ] }); // earned a deception lens from peaks
    const naiveRead = reconstructOther(naive, CON);
    const spotterRead = reconstructOther(conSpotter, CON);
    assert.equal(naiveRead.sawTell, false, "the naive lens reads the displayed warmth");
    assert.equal(naiveRead.dominantDrive, "CARE");
    assert.equal(spotterRead.sawTell, true, "the con-spotter catches the tell");
    assert.equal(spotterRead.dominantDrive, "RAGE", "...and reads the hidden hostility");
  });

  await t.test("deceptionLands: succeeds iff the target's lens lacks the relevant peak", () => {
    const naive = buildLens({ temperament: { CARE: 0.7 } });
    const spotter = buildLens({ sensitivities: { deception: 0.8 } });
    assert.equal(deceptionLands(CON, naive).lands, true);
    assert.equal(deceptionLands(CON, spotter).lands, false);
    assert.equal(deceptionLands(HONEST, naive).lands, false, "an honest read is not a deception");
  });

  await t.test("only CAUGHT deception trains the mark (asymmetric arms race)", () => {
    let lens = buildLens({ temperament: { CARE: 0.7 } });
    assert.equal(deceptionLands(CON, lens).lands, true, "first con lands");
    // the mark CATCHES it (e.g. consequence later reveals it) → the lens drifts
    for (let i = 0; i < 4; i++) lens = driftLensFromDeception(lens, "deception", 0.9);
    assert.equal(deceptionLands(CON, lens).lands, false, "having been caught-out, the mark now reads the same con");
  });

  await t.test("lensVariance is bounded — identical=0, divergent population > 0", () => {
    const L = buildLens({ temperament: { CARE: 0.7 } });
    assert.equal(lensVariance([L, L, L]), 0, "a uniform world has zero spread (gullible/dead)");
    const varied = [
      buildLens({ temperament: { CARE: 0.9 }, sensitivities: { deception: 0.1 } }),
      buildLens({ temperament: { SEEKING: 0.9 }, sensitivities: { deception: 0.8 } }),
      buildLens({ temperament: { FEAR: 0.9 }, sensitivities: { betrayal: 0.6 } }),
    ];
    assert.ok(lensVariance(varied) > 0, "a population of histories has real spread");
    assert.ok(lensVariance(varied) <= 1);
  });

  await t.test("totality on garbage", () => {
    assert.doesNotThrow(() => reconstructOther(null, null));
    assert.doesNotThrow(() => buildLens(null));
    assert.equal(lensVariance([]), 0);
    assert.equal(deceptionLands(null, null).lands, false);
  });
});
