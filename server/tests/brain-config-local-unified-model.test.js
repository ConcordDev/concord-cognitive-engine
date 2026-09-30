// BRAIN_LOCAL_UNIFIED_MODEL — single-Ollama "hot-swap" collapse.
//
// The A40 deploy runs one Ollama instance per brain, each with a resident
// model, so per-brain differentiated models are free. A single-Ollama box
// (one `ollama serve`, OLLAMA_MAX_LOADED_MODELS=1) pointing 4 brain slots at
// 4 different models makes Ollama evict + reload a model from disk on nearly
// every cross-brain call. BRAIN_LOCAL_UNIFIED_MODEL forces every LOCAL
// (http/https) brain slot onto one model so Ollama never swaps; cloud slots
// (cloudflare://) and explicit per-slot BRAIN_<NAME>_MODEL still win.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

for (const k of [
  "BRAIN_CONSCIOUS_URL", "BRAIN_CONSCIOUS_URLS", "BRAIN_CONSCIOUS_MODEL",
  "BRAIN_SUBCONSCIOUS_URL", "BRAIN_SUBCONSCIOUS_URLS", "BRAIN_SUBCONSCIOUS_MODEL",
  "BRAIN_UTILITY_URL", "BRAIN_UTILITY_URLS", "BRAIN_UTILITY_MODEL",
  "BRAIN_REPAIR_URL", "BRAIN_REPAIR_URLS", "BRAIN_REPAIR_MODEL",
  "BRAIN_VISION_URL", "BRAIN_VISION_URLS", "BRAIN_MULTIMODAL_URL", "BRAIN_VISION_MODEL",
  "BRAIN_VISION_PROVIDER",
  "OLLAMA_URL", "OLLAMA_HOST",
]) delete process.env[k];

process.env.OLLAMA_HOST = "http://127.0.0.1:11434";
process.env.BRAIN_LOCAL_UNIFIED_MODEL = "concord-core-v6:latest";
process.env.BRAIN_UTILITY_MODEL = "qwen3.5:2b"; // explicit per-slot — must still win
process.env.BRAIN_VISION_PROVIDER = "cloudflare";
process.env.BRAIN_VISION_URL = "cloudflare://workers-ai";

const { BRAIN_CONFIG, resolveBrainModel } = await import("../lib/brain-config.js");

describe("brain-config.js — BRAIN_LOCAL_UNIFIED_MODEL", () => {
  it("collapses every local brain slot onto the unified model", () => {
    assert.equal(BRAIN_CONFIG.conscious.model, "concord-core-v6:latest");
    assert.equal(BRAIN_CONFIG.subconscious.model, "concord-core-v6:latest");
    assert.equal(BRAIN_CONFIG.repair.model, "concord-core-v6:latest");
  });

  it("an explicit per-slot BRAIN_<NAME>_MODEL still wins", () => {
    assert.equal(BRAIN_CONFIG.utility.model, "qwen3.5:2b");
  });

  it("does NOT rewrite a cloud (cloudflare://) slot", () => {
    assert.notEqual(BRAIN_CONFIG.multimodal.model, "concord-core-v6:latest");
  });

  it("resolveBrainModel: unified applies to a local http endpoint only", () => {
    assert.equal(
      resolveBrainModel(undefined, "fallback-model", "http://127.0.0.1:11434"),
      "concord-core-v6:latest",
    );
    assert.equal(
      resolveBrainModel(undefined, "fallback-model", "cloudflare://workers-ai"),
      "fallback-model",
    );
    assert.equal(
      resolveBrainModel("explicit-model", "fallback-model", "http://127.0.0.1:11434"),
      "explicit-model",
    );
  });
});
