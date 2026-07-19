// tests/depth/atlas-signal-classify-behavior.test.js — REAL behavioral tests
// for the Wave 4 gap-closure build of `cortex.classify`
// (docs/lens-specs/atlas-capability-map.md §1d): the ONE write path into the
// Atlas Signal Cortex taxonomy store (server/lib/atlas-signal-cortex.js).
//
// Covers: a valid submission round-trip (exact 5-property classification),
// server-side validation rejection for the two genuinely-required fields
// (frequency, origin), and that a submitted signal is retrievable via the
// existing GET macros (`taxonomy`, `spectrum`, `unknown`) with no separate
// write path needed.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";
import { _resetCortexState } from "../../lib/atlas-signal-cortex.js";

describe("cortex.classify — manual signal submission (Wave 4 gap-closure)", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("cortex")); });
  // The cortex taxonomy is a module-level in-memory Map (not user-scoped
  // STATE), so reset it between tests for exact-count assertions — the same
  // isolation pattern server/tests/atlas-signal-cortex-comprehensive.test.js
  // already uses.
  beforeEach(() => { _resetCortexState(); });

  it("valid submission round-trip: classifies across all 5 properties", async () => {
    const r = await runMacro("cortex", "classify", {
      frequency: 900,
      modulation: "OFDM",
      bandwidth: 20,
      power: 30,
      origin: { lat: 40.7128, lng: -74.006 },
      description: "rooftop cell tower",
    }, ctx);

    assert.equal(r.ok, true);
    assert.ok(r.signal?.id);
    // Identity: 900 MHz falls in the COMMUNICATION frequency band [700,2700].
    assert.equal(r.signal.category, "COMMUNICATION");
    assert.equal(r.signal.frequency, 900);
    assert.equal(r.signal.modulation, "OFDM");
    assert.equal(r.signal.bandwidth, 20);
    // Location.
    assert.deepEqual(r.signal.location.origin, { lat: 40.7128, lng: -74.006 });
    // Purpose: COMMUNICATION category defaults to COMMUNICATION purpose.
    assert.equal(r.signal.purpose, "COMMUNICATION");
    // Measurement.
    assert.equal(r.signal.measurement.power, 30);
    // Adjustability: COMMUNICATION category, not a safety frequency → RESPOND_ALLOWED.
    assert.equal(r.signal.adjustability, "RESPOND_ALLOWED");
  });

  it("a signal in a protected safety band is always ADJUST_FORBIDDEN regardless of category", async () => {
    // 121.5 MHz is the aviation emergency guard frequency (SAFETY_FREQUENCIES.emergency).
    const r = await runMacro("cortex", "classify", {
      frequency: 121.5, origin: { lat: 1, lng: 1 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.signal.adjustability, "ADJUST_FORBIDDEN");
  });

  it("rejects a submission with no frequency", async () => {
    const r = await runMacro("cortex", "classify", { origin: { lat: 1, lng: 1 } }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.error, /frequency/);
  });

  it("rejects a zero/negative frequency", async () => {
    const r1 = await runMacro("cortex", "classify", { frequency: 0, origin: { lat: 1, lng: 1 } }, ctx);
    assert.equal(r1.ok, false);
    assert.match(r1.error, /frequency \(MHz, > 0\) is required/);
    const r2 = await runMacro("cortex", "classify", { frequency: -5, origin: { lat: 1, lng: 1 } }, ctx);
    assert.equal(r2.ok, false);
    assert.match(r2.error, /frequency \(MHz, > 0\) is required/);
  });

  it("rejects a non-numeric frequency", async () => {
    const r = await runMacro("cortex", "classify", { frequency: "not-a-number", origin: { lat: 1, lng: 1 } }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.error, /frequency \(MHz, > 0\) is required/);
  });

  it("rejects a submission with no origin", async () => {
    const r = await runMacro("cortex", "classify", { frequency: 900 }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.error, /origin/);
  });

  it("rejects an origin with out-of-range coordinates", async () => {
    const r1 = await runMacro("cortex", "classify", { frequency: 900, origin: { lat: 200, lng: 1 } }, ctx);
    assert.equal(r1.ok, false);
    assert.match(r1.error, /origin\.lat and origin\.lng \(valid coordinates\) are required/);
    const r2 = await runMacro("cortex", "classify", { frequency: 900, origin: { lat: 1, lng: -200 } }, ctx);
    assert.equal(r2.ok, false);
    assert.match(r2.error, /origin\.lat and origin\.lng \(valid coordinates\) are required/);
  });

  it("rejects an origin missing lat or lng", async () => {
    const r1 = await runMacro("cortex", "classify", { frequency: 900, origin: { lng: 1 } }, ctx);
    assert.equal(r1.ok, false);
    assert.match(r1.error, /origin\.lat and origin\.lng \(valid coordinates\) are required/);
    const r2 = await runMacro("cortex", "classify", { frequency: 900, origin: { lat: 1 } }, ctx);
    assert.equal(r2.ok, false);
    assert.match(r2.error, /origin\.lat and origin\.lng \(valid coordinates\) are required/);
  });

  it("does not write to the taxonomy store on a rejected submission", async () => {
    await runMacro("cortex", "classify", { frequency: 0, origin: { lat: 1, lng: 1 } }, ctx);
    const t = await runMacro("cortex", "taxonomy", { category: "all", limit: 50 }, ctx);
    assert.equal(t.totalClassified, 0);
  });

  it("a valid submission is retrievable via cortex.taxonomy", async () => {
    await runMacro("cortex", "classify", { frequency: 900, origin: { lat: 1, lng: 1 } }, ctx);
    const t = await runMacro("cortex", "taxonomy", { category: "all", limit: 50 }, ctx);
    assert.equal(t.ok, true);
    assert.equal(t.totalClassified, 1);
    assert.equal(t.signals.length, 1);
    assert.equal(t.signals[0].frequency, 900);
    assert.equal(t.signals[0].category, "COMMUNICATION");
  });

  it("a valid submission is retrievable via cortex.taxonomy filtered by category", async () => {
    await runMacro("cortex", "classify", { frequency: 900, origin: { lat: 1, lng: 1 } }, ctx); // COMMUNICATION
    await runMacro("cortex", "classify", { frequency: 55, origin: { lat: 1, lng: 1 } }, ctx);   // INFRASTRUCTURE (50-60 band)
    const comms = await runMacro("cortex", "taxonomy", { category: "COMMUNICATION", limit: 50 }, ctx);
    assert.equal(comms.count, 1);
    assert.equal(comms.signals[0].category, "COMMUNICATION");
  });

  it("a valid submission is retrievable via cortex.spectrum band bucket", async () => {
    await runMacro("cortex", "classify", { frequency: 900, origin: { lat: 1, lng: 1 } }, ctx);
    const s = await runMacro("cortex", "spectrum", {}, ctx);
    assert.equal(s.ok, true);
    assert.equal(s.totalSignals, 1);
    // spectrum bucket: freq < 3000 → "LF/MF" band (see getSpectralOccupancy).
    assert.equal(s.bands["LF/MF"], 1);
  });

  it("a signal outside every known category+keyword pattern lands in cortex.unknown", async () => {
    // No frequency-range or keyword match at all → UNKNOWN category → unknown queue.
    await runMacro("cortex", "classify", { frequency: 999999999, origin: { lat: 1, lng: 1 } }, ctx);
    const u = await runMacro("cortex", "unknown", { limit: 50 }, ctx);
    assert.equal(u.ok, true);
    assert.equal(u.total, 1);
    assert.equal(u.signals[0].category, "UNKNOWN");
    // And it still shows up in the general taxonomy.
    const t = await runMacro("cortex", "taxonomy", { category: "all", limit: 50 }, ctx);
    assert.equal(t.totalClassified, 1);
  });

  it("optional enrichment fields (keywords/description) steer identity + purpose classification", async () => {
    // No frequency-band match, but a keyword match for INFRASTRUCTURE.
    const r = await runMacro("cortex", "classify", {
      frequency: 999999999, keywords: ["power", "grid"], origin: { lat: 1, lng: 1 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.signal.category, "INFRASTRUCTURE");
    assert.equal(r.signal.purpose, "UTILITY");
  });
});
