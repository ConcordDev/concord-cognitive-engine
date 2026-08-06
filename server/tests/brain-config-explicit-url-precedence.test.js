// Companion to brain-config-single-instance-fallback.test.js: a real
// multi-instance deployment that sets explicit BRAIN_<NAME>_URL vars must
// be completely unaffected by the OLLAMA_HOST/OLLAMA_URL single-instance
// fallback added alongside it — explicit per-brain URLs always win.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

for (const k of [
  "BRAIN_CONSCIOUS_URL", "BRAIN_CONSCIOUS_URLS",
  "BRAIN_SUBCONSCIOUS_URL", "BRAIN_SUBCONSCIOUS_URLS",
  "BRAIN_UTILITY_URL", "BRAIN_UTILITY_URLS",
  "BRAIN_REPAIR_URL", "BRAIN_REPAIR_URLS",
  "BRAIN_VISION_URL", "BRAIN_VISION_URLS", "BRAIN_MULTIMODAL_URL",
  "OLLAMA_URL", "OLLAMA_HOST",
]) delete process.env[k];

// A single-instance fallback IS set, but every brain also has its own
// explicit multi-port URL — the explicit ones must win.
process.env.OLLAMA_HOST = "http://localhost:11434";
process.env.BRAIN_CONSCIOUS_URL = "http://localhost:11434";
process.env.BRAIN_SUBCONSCIOUS_URL = "http://localhost:11435";
process.env.BRAIN_UTILITY_URL = "http://localhost:11436";
process.env.BRAIN_REPAIR_URL = "http://localhost:11437";
process.env.BRAIN_VISION_URL = "http://localhost:11438";

const { BRAIN_CONFIG } = await import("../lib/brain-config.js");

describe("brain-config.js — explicit BRAIN_*_URL still wins over the single-instance fallback", () => {
  it("each brain resolves to its own distinct explicit port, not the shared fallback", () => {
    assert.equal(BRAIN_CONFIG.conscious.url, "http://localhost:11434");
    assert.equal(BRAIN_CONFIG.subconscious.url, "http://localhost:11435");
    assert.equal(BRAIN_CONFIG.utility.url, "http://localhost:11436");
    assert.equal(BRAIN_CONFIG.repair.url, "http://localhost:11437");
    assert.equal(BRAIN_CONFIG.multimodal.url, "http://localhost:11438");
  });
});
