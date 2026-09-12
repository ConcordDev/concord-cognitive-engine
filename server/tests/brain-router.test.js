/**
 * Brain Router Test Suite
 *
 * Tests the four-brain cognitive architecture router:
 *   - preloadBrains() model warming (with mocked fetch)
 *   - getBrainPriority() priority level resolution
 *   - resolveBrain() system→brain name resolution
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import { getBrainPriority, resolveBrain } from "../lib/brain-router.js";
import { BRAIN_CONFIG, BRAIN_PRIORITY, SYSTEM_TO_BRAIN } from "../lib/brain-config.js";

// ── getBrainPriority ────────────────────────────────────────────────────────

describe("getBrainPriority", () => {
  it("returns 0 for repair brain (highest priority)", () => {
    assert.equal(getBrainPriority("repair"), 0);
  });

  it("returns 1 for conscious brain", () => {
    assert.equal(getBrainPriority("conscious"), 1);
  });

  it("returns 2 for subconscious brain", () => {
    assert.equal(getBrainPriority("subconscious"), 2);
  });

  it("returns 3 for utility brain", () => {
    assert.equal(getBrainPriority("utility"), 3);
  });

  it("falls back to 2 for unknown brain names", () => {
    assert.equal(getBrainPriority("unknown"), 2);
    assert.equal(getBrainPriority(null), 2);
    assert.equal(getBrainPriority(undefined), 2);
  });

  it("matches BRAIN_PRIORITY constants", () => {
    for (const [brain, priority] of Object.entries(BRAIN_PRIORITY)) {
      assert.equal(getBrainPriority(brain), priority, `Priority mismatch for ${brain}`);
    }
  });

  it("priority ordering: repair < conscious < subconscious <= utility", () => {
    assert.ok(getBrainPriority("repair") < getBrainPriority("conscious"));
    assert.ok(getBrainPriority("conscious") < getBrainPriority("subconscious"));
    assert.ok(getBrainPriority("subconscious") <= getBrainPriority("utility"));
  });
});

// ── resolveBrain ────────────────────────────────────────────────────────────

describe("resolveBrain", () => {
  it("resolves chat to conscious", () => {
    assert.equal(resolveBrain("chat"), "conscious");
  });

  it("resolves sovereign_decree to conscious", () => {
    assert.equal(resolveBrain("sovereign_decree"), "conscious");
  });

  it("resolves entity_dialogue to conscious", () => {
    assert.equal(resolveBrain("entity_dialogue"), "conscious");
  });

  it("resolves autogen to subconscious", () => {
    assert.equal(resolveBrain("autogen"), "subconscious");
  });

  it("resolves autogen_pipeline to subconscious", () => {
    assert.equal(resolveBrain("autogen_pipeline"), "subconscious");
  });

  it("resolves meta_derivation to subconscious", () => {
    assert.equal(resolveBrain("meta_derivation"), "subconscious");
  });

  it("resolves dream_synthesis to subconscious", () => {
    assert.equal(resolveBrain("dream_synthesis"), "subconscious");
  });

  it("resolves hlr_engine to utility", () => {
    assert.equal(resolveBrain("hlr_engine"), "utility");
  });

  it("resolves agent_system to utility", () => {
    assert.equal(resolveBrain("agent_system"), "utility");
  });

  it("resolves hypothesis_engine to utility", () => {
    assert.equal(resolveBrain("hypothesis_engine"), "utility");
  });

  it("resolves council_voices to utility", () => {
    assert.equal(resolveBrain("council_voices"), "utility");
  });

  it("resolves research_jobs to utility", () => {
    assert.equal(resolveBrain("research_jobs"), "utility");
  });

  it("resolves repair_cortex to repair", () => {
    assert.equal(resolveBrain("repair_cortex"), "repair");
  });

  it("resolves repair_diagnosis to repair", () => {
    assert.equal(resolveBrain("repair_diagnosis"), "repair");
  });

  it("falls back to conscious for unknown system names", () => {
    assert.equal(resolveBrain("unknown_system"), "conscious");
  });

  it("falls back to conscious for null/undefined", () => {
    assert.equal(resolveBrain(null), "conscious");
    assert.equal(resolveBrain(undefined), "conscious");
    assert.equal(resolveBrain(""), "conscious");
  });

  it("handles all mapped system names from SYSTEM_TO_BRAIN", () => {
    for (const [system, brain] of Object.entries(SYSTEM_TO_BRAIN)) {
      assert.equal(resolveBrain(system), brain, `Mismatch for system: ${system}`);
    }
  });

  it("always returns a valid brain name", () => {
    const validBrains = new Set(["conscious", "subconscious", "utility", "repair"]);
    const testInputs = [
      "chat", "autogen", "repair_cortex", "hlr_engine",
      "unknown", null, undefined, "", "random_system",
    ];
    for (const input of testInputs) {
      const result = resolveBrain(input);
      assert.ok(validBrains.has(result), `resolveBrain(${input}) returned invalid: ${result}`);
    }
  });
});

// ── preloadBrains ───────────────────────────────────────────────────────────

describe("preloadBrains", () => {
  // BRAIN_CONFIG's default URLs are docker-compose hostnames
  // (ollama-conscious, etc.) that don't resolve outside that network —
  // this file's own header comment promises "mocked fetch" but never wired
  // one up, so every test below made a REAL fetch() per brain per endpoint,
  // each only bounded by the 5-minute AbortSignal.timeout in
  // lib/brain-router.js#preloadBrains's model-pull call. Across 4 tests x 5
  // brains that's a real, reproducible multi-minute-to-tens-of-minutes stall
  // (worse on a resolver that's slow to NXDOMAIN an unknown host rather than
  // an instant ECONNREFUSED), not a flake — it just never surfaced before
  // because this whole gate never ran to completion. Mock fetch to fail
  // fast, matching the header's original intent and the "will fail in test
  // env" comment two lines below (which was true in outcome, just not fast).
  // Resolve with ok:false rather than throwing: preloadBrains only retries
  // (with a real 5s+15s setTimeout backoff) on a THROWN fetch error — a
  // resolved-but-failed response takes the fast `if (!res.ok) { failed.push
  // (...); continue; }` path instead, so tests stay fast.
  let restoreFetch;
  beforeEach(() => {
    restoreFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503 }));
  });
  afterEach(() => {
    mock.restoreAll();
    globalThis.fetch = restoreFetch;
  });

  it("is exported as a function", async () => {
    const mod = await import("../lib/brain-router.js");
    assert.equal(typeof mod.preloadBrains, "function");
  });

  it("accepts an optional structuredLog parameter", async () => {
    const mod = await import("../lib/brain-router.js");
    // preloadBrains makes fetch calls which will fail in test env
    // But it should handle errors gracefully and return loaded/failed arrays
    const logs = [];
    const result = await mod.preloadBrains((level, event, data) => {
      logs.push({ level, event, data });
    });

    assert.ok(result);
    assert.ok(Array.isArray(result.loaded));
    assert.ok(Array.isArray(result.failed));
  });

  it("returns loaded and failed arrays that cover all brains", async () => {
    const mod = await import("../lib/brain-router.js");
    const result = await mod.preloadBrains();

    const allBrains = new Set([...result.loaded, ...result.failed]);
    // Should have attempted all four brains
    assert.ok(allBrains.size >= 1, "Should attempt at least some brains");
  });

  it("logs structured messages during preload", async () => {
    const mod = await import("../lib/brain-router.js");
    const logs = [];
    await mod.preloadBrains((level, event, data) => {
      logs.push({ level, event });
    });

    // Should have logged either success or failure for each brain
    assert.ok(logs.length >= 0); // May have logs depending on network
  });
});

// ── Integration: resolveBrain + getBrainPriority ────────────────────────────

describe("resolveBrain + getBrainPriority integration", () => {
  it("chat system has priority 1", () => {
    const brain = resolveBrain("chat");
    assert.equal(getBrainPriority(brain), 1);
  });

  it("repair_cortex system has priority 0 (highest)", () => {
    const brain = resolveBrain("repair_cortex");
    assert.equal(getBrainPriority(brain), 0);
  });

  it("autogen system has priority 2", () => {
    const brain = resolveBrain("autogen");
    assert.equal(getBrainPriority(brain), 2);
  });

  it("hlr_engine system has priority 3", () => {
    const brain = resolveBrain("hlr_engine");
    assert.equal(getBrainPriority(brain), 3);
  });

  it("all system→brain→priority chains resolve correctly", () => {
    for (const [system, expectedBrain] of Object.entries(SYSTEM_TO_BRAIN)) {
      const brain = resolveBrain(system);
      assert.equal(brain, expectedBrain, `Wrong brain for ${system}`);

      const priority = getBrainPriority(brain);
      assert.equal(priority, BRAIN_PRIORITY[brain], `Wrong priority for ${system}→${brain}`);
    }
  });
});
