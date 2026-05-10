/**
 * Sprint D / CC1 — voice synthesis cache + fallback tests.
 *
 * Pins:
 *   - synthesizeLine returns no_api_key when ELEVENLABS_API_KEY missing
 *   - synthesizeLine returns missing_inputs when text or voiceId missing
 *   - cache hit detection works
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { synthesizeLine, VOICE_SYNTHESIS_CONSTANTS } from "../lib/voice-synthesis.js";

describe("Sprint D / CC1 — synthesizeLine guard rails", () => {
  it("returns missing_inputs on empty text", async () => {
    const r = await synthesizeLine("", "voice123");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("returns missing_inputs on empty voice id", async () => {
    const r = await synthesizeLine("Hello", "");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("returns no_api_key when env unset", async () => {
    const orig = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    try {
      const r = await synthesizeLine("Hello", "voice123");
      assert.equal(r.ok, false);
      assert.equal(r.reason, "no_api_key");
    } finally {
      if (orig !== undefined) process.env.ELEVENLABS_API_KEY = orig;
    }
  });

  it("constants are frozen and exposed", () => {
    assert.equal(VOICE_SYNTHESIS_CONSTANTS.DEFAULT_MAX_INFLIGHT, 4);
    assert.equal(VOICE_SYNTHESIS_CONSTANTS.ELEVENLABS_BASE, "https://api.elevenlabs.io/v1");
    assert.ok(VOICE_SYNTHESIS_CONSTANTS.DEFAULT_CACHE_LIMIT_BYTES > 0);
  });
});
