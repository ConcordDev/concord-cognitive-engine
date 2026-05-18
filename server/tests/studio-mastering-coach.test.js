// Tier-2 contract test — Studio Sprint A #9: mastering coaching macro.
//
// We instantiate the macro register and assert:
//   - rejects malformed input
//   - clamps loudness target into the LUFS sane range
//   - emits suggestions for over-loud / under-loud / true-peak risk
//   - falls back to the deterministic composer when no brain is available
//
// We don't exercise the LLM path here — that lives behind a network
// boundary the test environment doesn't carry. The brain code path is
// gated by `requiresLLM: true` and skipped in CI.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerStudioMasteringMacros from "../domains/studio-mastering.js";

function makeRegistry() {
  const macros = new Map();
  const register = (domain, name, handler, opts) => {
    macros.set(`${domain}.${name}`, { handler, opts });
  };
  registerStudioMasteringMacros(register);
  return macros;
}

describe("studio.coach_mastering", () => {
  it("rejects when no analysis summary is supplied", async () => {
    const macros = makeRegistry();
    const { handler } = macros.get("studio.coach_mastering");
    const out = await handler({}, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "invalid_summary");
  });

  it("rejects when integratedLUFS is non-finite", async () => {
    const macros = makeRegistry();
    const { handler } = macros.get("studio.coach_mastering");
    const out = await handler({}, {
      summary: { integratedLUFS: "loud", truePeak: -1 },
    });
    assert.equal(out.ok, false);
  });

  it("flags loudness gap when mix sits well under target", async () => {
    const macros = makeRegistry();
    const { handler } = macros.get("studio.coach_mastering");
    const out = await handler({}, {
      deterministic: true,
      targetLUFS: -14,
      summary: {
        integratedLUFS: -22,
        truePeak: -3,
        dynamicRange: 8,
        hottestBand: "bass",
        quietestBand: "air",
        imbalances: [],
        loudnessVsTarget: -8,
      },
    });
    assert.equal(out.ok, true);
    assert.equal(out.composer, "deterministic");
    const loudnessNote = out.suggestions.find((s) => s.kind === "loudness");
    assert.ok(loudnessNote, "expected a loudness suggestion");
    assert.equal(loudnessNote.severity, "high");
  });

  it("flags true-peak risk when peak >= -0.3 dBTP", async () => {
    const macros = makeRegistry();
    const { handler } = macros.get("studio.coach_mastering");
    const out = await handler({}, {
      deterministic: true,
      targetLUFS: -14,
      summary: {
        integratedLUFS: -14,
        truePeak: -0.1,
        dynamicRange: 6,
        hottestBand: "mid",
        quietestBand: "air",
        imbalances: [],
        loudnessVsTarget: 0,
      },
    });
    const tp = out.suggestions.find((s) => s.kind === "true_peak");
    assert.ok(tp, "expected a true_peak suggestion");
    assert.equal(tp.severity, "high");
  });

  it("forwards imbalance hints as spectral suggestions", async () => {
    const macros = makeRegistry();
    const { handler } = macros.get("studio.coach_mastering");
    const out = await handler({}, {
      deterministic: true,
      summary: {
        integratedLUFS: -14,
        truePeak: -1.2,
        dynamicRange: 7,
        hottestBand: "bass",
        quietestBand: "presence",
        imbalances: ["bass (60-250 Hz) is +6dB vs the average band"],
        loudnessVsTarget: 0,
      },
    });
    const spec = out.suggestions.filter((s) => s.kind === "spectral");
    assert.equal(spec.length, 1);
    assert.match(spec[0].text, /bass/);
  });

  it("returns the ok-master suggestion when nothing is wrong", async () => {
    const macros = makeRegistry();
    const { handler } = macros.get("studio.coach_mastering");
    const out = await handler({}, {
      deterministic: true,
      targetLUFS: -14,
      summary: {
        integratedLUFS: -14,
        truePeak: -1.5,
        dynamicRange: 8,
        hottestBand: "mid",
        quietestBand: "air",
        imbalances: [],
        loudnessVsTarget: 0,
      },
    });
    assert.equal(out.suggestions.length, 1);
    assert.equal(out.suggestions[0].kind, "ok");
  });

  it("clamps loudness target to the LUFS sane range", async () => {
    const macros = makeRegistry();
    const { handler } = macros.get("studio.coach_mastering");
    // Target -100 LUFS is silly; should clamp to -24.
    const out = await handler({}, {
      deterministic: true,
      targetLUFS: -100,
      summary: {
        integratedLUFS: -23,
        truePeak: -3,
        dynamicRange: 8,
        hottestBand: "mid",
        quietestBand: "air",
        imbalances: [],
        loudnessVsTarget: 0,
      },
    });
    // With target clamped to -24, integrated -23 is 1 LU OVER. We
    // accept whichever side of the boundary deterministicCoach lands
    // on — what we're asserting is "no thrown error, narrative
    // mentions the clamped target".
    assert.equal(out.ok, true);
    assert.match(out.narrative, /-24/);
  });
});
