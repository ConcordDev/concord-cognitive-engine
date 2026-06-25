// server/tests/haptic-encode.test.js
//
// Haptic encoding (#44) — derives a controller rumble pattern from REAL combat
// impact quantities (the same momentum + poise-feel functions the combat path
// uses). Deterministic math → exact oracles. Offline.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { waveformFromImpact, waveformFor } from "../lib/haptic-encode.js";
import { momentumFor } from "../lib/combat-impact.js";
import registerHapticMacros from "../domains/haptic.js";

describe("Haptic encoding (#44)", () => {
  it("heavier momentum yields stronger rumble (real monotonic mapping)", () => {
    const light = waveformFromImpact({ severity: "rocked", momentum: 80 });
    const heavy = waveformFromImpact({ severity: "rocked", momentum: 250 });
    assert.ok(heavy.peak > light.peak, "more momentum → higher peak");
    assert.ok(heavy.strongMagnitude <= 1 && heavy.weakMagnitude >= 0, "magnitudes are valid Gamepad inputs");
  });

  it("a harder severity lasts longer (uses the real feel timings)", () => {
    const flinch = waveformFromImpact({ severity: "flinch", momentum: 100 });
    const knockdown = waveformFromImpact({ severity: "knockdown", momentum: 100 });
    assert.ok(knockdown.durationMs > flinch.durationMs, "knockdown rumbles longer");
    assert.ok(knockdown.peak >= 0.8, "knockdown saturates");
  });

  it("the ADSR envelope rises from 0, peaks, and decays back to 0", () => {
    const w = waveformFromImpact({ severity: "rocked", momentum: 200 });
    assert.equal(w.envelope[0].amp, 0, "starts at rest");
    assert.equal(w.envelope[w.envelope.length - 1].amp, 0, "ends at rest");
    const maxAmp = Math.max(...w.envelope.map((p) => p.amp));
    assert.equal(maxAmp, w.peak, "envelope reaches the peak");
  });

  it("waveformFor derives momentum from real strike kinematics", () => {
    const expected = momentumFor({ kind: "hammer", tier: 3 });
    const w = waveformFor({ severity: "rocked", kind: "hammer", tier: 3 });
    assert.equal(w.momentum, Math.round(expected * 1000) / 1000, "momentum matches the combat model");
    assert.ok(w.peak > 0);
  });

  it("haptic.encode macro round-trips both input shapes", async () => {
    const macros = new Map();
    registerHapticMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
    const a = await macros.get("haptic.encode")({}, { severity: "rocked", momentum: 150 });
    assert.equal(a.ok, true);
    assert.ok(a.pattern.durationMs > 0);
    const b = await macros.get("haptic.encode")({}, { kind: "sword", tier: 2, severity: "flinch" });
    assert.equal(b.ok, true);
    assert.ok(b.pattern.peak >= 0.2, "flinch floor felt");
  });
});
