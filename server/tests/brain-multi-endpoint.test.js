// Phase D — multi-endpoint round-robin + inflight tracking.
//
// Pins: (1) singular BRAIN_<NAME>_URL still works (legacy), (2) plural
// BRAIN_<NAME>_URLS produces a multi-endpoint list, (3) pickBrainEndpoint
// rotates across equal-load endpoints, (4) inflight counter influences
// pick selection, (5) repeated failures starve a wedged endpoint.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Set env BEFORE the module loads — config values are captured at import.
process.env.BRAIN_UTILITY_URLS = "http://u-a:11434,http://u-b:11434,http://u-c:11434";
delete process.env.BRAIN_SUBCONSCIOUS_URLS; // exercise the legacy singular path
process.env.BRAIN_SUBCONSCIOUS_URL = "http://s-only:11434";

const {
  BRAIN_CONFIG,
  pickBrainEndpoint,
  noteEndpointStart,
  noteEndpointFinish,
  _resetEndpointStats,
} = await import("../lib/brain-config.js");

describe("Phase D — brain multi-endpoint config", () => {
  beforeEach(() => {
    _resetEndpointStats();
  });

  it("plural BRAIN_*_URLS produces a multi-endpoint list", () => {
    const urls = BRAIN_CONFIG.utility.urls;
    assert.deepEqual(urls, ["http://u-a:11434", "http://u-b:11434", "http://u-c:11434"]);
    // Singular `url` is the first endpoint — backwards compat for older callers.
    assert.equal(BRAIN_CONFIG.utility.url, "http://u-a:11434");
  });

  it("singular BRAIN_*_URL is still respected when no plural is set", () => {
    assert.deepEqual(BRAIN_CONFIG.subconscious.urls, ["http://s-only:11434"]);
    assert.equal(BRAIN_CONFIG.subconscious.url, "http://s-only:11434");
  });

  it("pickBrainEndpoint rotates across equal-load endpoints", () => {
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      seen.add(pickBrainEndpoint("utility"));
    }
    assert.ok(seen.size >= 2, `expected at least 2 distinct endpoints over 3 picks, got ${seen.size}`);
  });

  it("pickBrainEndpoint prefers the less-loaded endpoint", () => {
    noteEndpointStart("http://u-a:11434"); // u-a is busy with one inflight
    noteEndpointStart("http://u-a:11434"); // u-a now at 2 inflight
    const pick = pickBrainEndpoint("utility");
    assert.notEqual(pick, "http://u-a:11434", "should avoid the loaded endpoint");
  });

  it("repeated failures starve a wedged endpoint", () => {
    // Mark u-a failed 3 consecutive times.
    for (let i = 0; i < 3; i++) {
      noteEndpointStart("http://u-a:11434");
      noteEndpointFinish("http://u-a:11434", { ok: false });
    }
    // Now make u-b and u-c more loaded but healthy.
    noteEndpointStart("http://u-b:11434");
    noteEndpointStart("http://u-c:11434");
    const pick = pickBrainEndpoint("utility");
    // u-a has 0 inflight + 3 failures → penalty 1000, much worse than 1 inflight.
    assert.notEqual(pick, "http://u-a:11434", "wedged endpoint should be starved");
  });

  it("a successful call clears the failure counter", () => {
    for (let i = 0; i < 3; i++) {
      noteEndpointStart("http://u-a:11434");
      noteEndpointFinish("http://u-a:11434", { ok: false });
    }
    noteEndpointStart("http://u-a:11434");
    noteEndpointFinish("http://u-a:11434", { ok: true });
    // After clearing, u-a should be eligible again with no inflight.
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      seen.add(pickBrainEndpoint("utility"));
    }
    assert.ok(seen.has("http://u-a:11434"), "recovered endpoint must be reachable by picker again");
  });
});
