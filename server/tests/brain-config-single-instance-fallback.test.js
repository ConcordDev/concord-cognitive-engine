// Single-instance Ollama fallback (bare-metal "no brains connected" fix).
//
// Someone running one plain `ollama serve` with every model pulled into it
// (rather than the five-brain multi-port topology) previously got a
// Docker-hostname URL for subconscious/utility/repair no matter what — only
// conscious/vision honored OLLAMA_HOST/OLLAMA_URL. Pins the fix: when no
// BRAIN_<NAME>_URL is set, ALL FIVE brains fall back to OLLAMA_URL /
// OLLAMA_HOST before the unreachable Docker-hostname default, and an
// explicit BRAIN_<NAME>_URL still wins over the single-instance fallback.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Env must be set BEFORE the module loads — config values are captured at
// import time (matches the established pattern in brain-multi-endpoint.test.js).
for (const k of [
  "BRAIN_CONSCIOUS_URL", "BRAIN_CONSCIOUS_URLS",
  "BRAIN_SUBCONSCIOUS_URL", "BRAIN_SUBCONSCIOUS_URLS",
  "BRAIN_UTILITY_URL", "BRAIN_UTILITY_URLS",
  "BRAIN_REPAIR_URL", "BRAIN_REPAIR_URLS",
  "BRAIN_VISION_URL", "BRAIN_VISION_URLS", "BRAIN_MULTIMODAL_URL",
  "OLLAMA_URL", "OLLAMA_HOST",
]) delete process.env[k];
process.env.OLLAMA_HOST = "http://localhost:11434";

const { BRAIN_CONFIG } = await import("../lib/brain-config.js");

describe("brain-config.js — single-instance Ollama fallback", () => {
  it("all five brains resolve to the single-instance URL, not a Docker hostname", () => {
    for (const name of ["conscious", "subconscious", "utility", "repair", "multimodal"]) {
      assert.equal(
        BRAIN_CONFIG[name].url,
        "http://localhost:11434",
        `${name} should fall back to OLLAMA_HOST, got ${BRAIN_CONFIG[name].url}`,
      );
      assert.ok(
        !BRAIN_CONFIG[name].url.includes("ollama-"),
        `${name} still resolved to an unreachable Docker hostname: ${BRAIN_CONFIG[name].url}`,
      );
    }
  });
});
