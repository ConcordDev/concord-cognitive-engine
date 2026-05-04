/**
 * Brain Config Test Suite
 *
 * Tests the four-brain cognitive architecture configuration:
 *   - BRAIN_CONFIG — per-brain settings
 *   - SYSTEM_TO_BRAIN — system→brain routing map
 *   - BRAIN_PRIORITY — priority levels
 *   - getBrainForSystem() — system→brain resolver
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BRAIN_CONFIG,
  SYSTEM_TO_BRAIN,
  BRAIN_PRIORITY,
  getBrainForSystem,
} from "../lib/brain-config.js";

// ── BRAIN_CONFIG ────────────────────────────────────────────────────────────

describe("BRAIN_CONFIG", () => {
  it("is frozen", () => {
    assert.ok(Object.isFrozen(BRAIN_CONFIG));
  });

  it("defines all five brains (4 cognitive + 1 multimodal/vision)", () => {
    const brains = Object.keys(BRAIN_CONFIG);
    assert.equal(brains.length, 5);
    assert.ok(brains.includes("conscious"));
    assert.ok(brains.includes("subconscious"));
    assert.ok(brains.includes("utility"));
    assert.ok(brains.includes("repair"));
    assert.ok(brains.includes("multimodal"));
  });

  it("each brain has required configuration fields", () => {
    for (const [name, config] of Object.entries(BRAIN_CONFIG)) {
      assert.ok(config.url, `${name} missing url`);
      assert.ok(config.model, `${name} missing model`);
      assert.ok(config.role, `${name} missing role`);
      assert.equal(typeof config.temperature, "number", `${name} temperature not number`);
      assert.equal(typeof config.timeout, "number", `${name} timeout not number`);
      assert.equal(typeof config.priority, "number", `${name} priority not number`);
      assert.equal(typeof config.maxConcurrent, "number", `${name} maxConcurrent not number`);
      assert.equal(typeof config.contextWindow, "number", `${name} contextWindow not number`);
      assert.equal(typeof config.maxTokens, "number", `${name} maxTokens not number`);
    }
  });

  describe("conscious brain", () => {
    const c = BRAIN_CONFIG.conscious;

    it("has highest temperature among main brains for creativity", () => {
      assert.equal(c.temperature, 0.7);
    });

    it("has longest timeout for deep reasoning", () => {
      assert.ok(c.timeout >= 30000);
    });

    it("has priority 1 (user-facing critical)", () => {
      assert.equal(c.priority, 1);
    });

    it("has largest context window", () => {
      assert.ok(c.contextWindow >= 16384);
    });

    it("has largest maxTokens for full output", () => {
      assert.ok(c.maxTokens >= 2048);
    });

    it("has a valid URL", () => {
      assert.ok(c.url.startsWith("http"));
    });
  });

  describe("subconscious brain", () => {
    const s = BRAIN_CONFIG.subconscious;

    it("has high temperature for creative generation", () => {
      assert.ok(s.temperature >= 0.8);
    });

    it("has priority 2 (normal, background)", () => {
      assert.equal(s.priority, 2);
    });

    it("has high concurrency for parallel tasks", () => {
      assert.ok(s.maxConcurrent >= 3);
    });
  });

  describe("utility brain", () => {
    const u = BRAIN_CONFIG.utility;

    it("has low temperature for precision", () => {
      assert.ok(u.temperature <= 0.5);
    });

    it("has priority 3 (low, support tasks)", () => {
      assert.equal(u.priority, 3);
    });

    it("has highest concurrency (entity actions)", () => {
      assert.ok(u.maxConcurrent >= 5);
    });
  });

  describe("repair brain", () => {
    const r = BRAIN_CONFIG.repair;

    it("has lowest temperature for deterministic fixes", () => {
      assert.ok(r.temperature <= 0.2);
    });

    it("has priority 0 (highest — system health)", () => {
      assert.equal(r.priority, 0);
    });

    it("has shortest timeout", () => {
      assert.ok(r.timeout <= 15000);
    });

    it("has smallest context window and tokens", () => {
      assert.ok(r.contextWindow <= 8192);
      assert.ok(r.maxTokens <= 1000);
    });
  });

  it("priorities are ordered: repair < conscious < subconscious < utility", () => {
    assert.ok(BRAIN_CONFIG.repair.priority < BRAIN_CONFIG.conscious.priority);
    assert.ok(BRAIN_CONFIG.conscious.priority < BRAIN_CONFIG.subconscious.priority);
    assert.ok(BRAIN_CONFIG.subconscious.priority < BRAIN_CONFIG.utility.priority);
  });

  it("temperatures cover a wide range (0.1 to 0.85)", () => {
    const temps = Object.values(BRAIN_CONFIG).map(c => c.temperature);
    assert.ok(Math.min(...temps) <= 0.2);
    assert.ok(Math.max(...temps) >= 0.7);
  });

  it("all brain URLs are valid HTTP URLs", () => {
    for (const [name, config] of Object.entries(BRAIN_CONFIG)) {
      assert.ok(
        config.url.startsWith("http://") || config.url.startsWith("https://"),
        `${name} URL invalid: ${config.url}`,
      );
    }
  });
});

// ── SYSTEM_TO_BRAIN ─────────────────────────────────────────────────────────

describe("SYSTEM_TO_BRAIN", () => {
  it("is frozen", () => {
    assert.ok(Object.isFrozen(SYSTEM_TO_BRAIN));
  });

  it("maps conscious systems correctly", () => {
    assert.equal(SYSTEM_TO_BRAIN.chat, "conscious");
    assert.equal(SYSTEM_TO_BRAIN.sovereign_decree, "conscious");
    assert.equal(SYSTEM_TO_BRAIN.entity_dialogue, "conscious");
  });

  it("maps subconscious systems correctly", () => {
    assert.equal(SYSTEM_TO_BRAIN.autogen, "subconscious");
    assert.equal(SYSTEM_TO_BRAIN.autogen_pipeline, "subconscious");
    assert.equal(SYSTEM_TO_BRAIN.meta_derivation, "subconscious");
    assert.equal(SYSTEM_TO_BRAIN.dream_synthesis, "subconscious");
  });

  it("maps utility systems correctly", () => {
    assert.equal(SYSTEM_TO_BRAIN.hlr_engine, "utility");
    assert.equal(SYSTEM_TO_BRAIN.agent_system, "utility");
    assert.equal(SYSTEM_TO_BRAIN.hypothesis_engine, "utility");
    assert.equal(SYSTEM_TO_BRAIN.council_voices, "utility");
    assert.equal(SYSTEM_TO_BRAIN.research_jobs, "utility");
  });

  it("maps repair systems correctly", () => {
    assert.equal(SYSTEM_TO_BRAIN.repair_cortex, "repair");
    assert.equal(SYSTEM_TO_BRAIN.repair_diagnosis, "repair");
  });

  it("all values are valid brain names", () => {
    const validBrains = new Set(["conscious", "subconscious", "utility", "repair"]);
    for (const [system, brain] of Object.entries(SYSTEM_TO_BRAIN)) {
      assert.ok(validBrains.has(brain), `System "${system}" maps to invalid brain "${brain}"`);
    }
  });

  it("every mapped brain exists in BRAIN_CONFIG", () => {
    for (const brain of Object.values(SYSTEM_TO_BRAIN)) {
      assert.ok(BRAIN_CONFIG[brain], `Brain "${brain}" not found in BRAIN_CONFIG`);
    }
  });
});

// ── BRAIN_PRIORITY ──────────────────────────────────────────────────────────

describe("BRAIN_PRIORITY", () => {
  it("is frozen", () => {
    assert.ok(Object.isFrozen(BRAIN_PRIORITY));
  });

  it("defines priority for all four brains", () => {
    assert.equal(typeof BRAIN_PRIORITY.repair, "number");
    assert.equal(typeof BRAIN_PRIORITY.conscious, "number");
    assert.equal(typeof BRAIN_PRIORITY.subconscious, "number");
    assert.equal(typeof BRAIN_PRIORITY.utility, "number");
  });

  it("repair has highest priority (lowest number)", () => {
    assert.equal(BRAIN_PRIORITY.repair, 0);
  });

  it("conscious has second highest priority", () => {
    assert.equal(BRAIN_PRIORITY.conscious, 1);
  });

  it("subconscious has third priority", () => {
    assert.equal(BRAIN_PRIORITY.subconscious, 2);
  });

  it("utility has lowest priority", () => {
    assert.equal(BRAIN_PRIORITY.utility, 3);
  });

  it("matches BRAIN_CONFIG priority values", () => {
    for (const [brain, priority] of Object.entries(BRAIN_PRIORITY)) {
      assert.equal(priority, BRAIN_CONFIG[brain].priority, `Priority mismatch for ${brain}`);
    }
  });
});

// ── getBrainForSystem ───────────────────────────────────────────────────────

describe("getBrainForSystem", () => {
  it("returns correct brain for chat system", () => {
    const { brainName, config } = getBrainForSystem("chat");
    assert.equal(brainName, "conscious");
    assert.equal(config, BRAIN_CONFIG.conscious);
  });

  it("returns correct brain for autogen system", () => {
    const { brainName, config } = getBrainForSystem("autogen");
    assert.equal(brainName, "subconscious");
    assert.equal(config, BRAIN_CONFIG.subconscious);
  });

  it("returns correct brain for hlr_engine system", () => {
    const { brainName, config } = getBrainForSystem("hlr_engine");
    assert.equal(brainName, "utility");
    assert.equal(config, BRAIN_CONFIG.utility);
  });

  it("returns correct brain for repair_cortex system", () => {
    const { brainName, config } = getBrainForSystem("repair_cortex");
    assert.equal(brainName, "repair");
    assert.equal(config, BRAIN_CONFIG.repair);
  });

  it("falls back to conscious for unknown system names", () => {
    const { brainName, config } = getBrainForSystem("unknown_system");
    assert.equal(brainName, "conscious");
    assert.equal(config, BRAIN_CONFIG.conscious);
  });

  it("falls back to conscious for null/undefined", () => {
    const { brainName: n1 } = getBrainForSystem(null);
    const { brainName: n2 } = getBrainForSystem(undefined);
    assert.equal(n1, "conscious");
    assert.equal(n2, "conscious");
  });

  it("returns the full config object", () => {
    const { config } = getBrainForSystem("dream_synthesis");
    assert.ok(config.url);
    assert.ok(config.model);
    assert.equal(typeof config.temperature, "number");
    assert.equal(typeof config.timeout, "number");
  });

  it("handles all mapped system names", () => {
    for (const systemName of Object.keys(SYSTEM_TO_BRAIN)) {
      const { brainName, config } = getBrainForSystem(systemName);
      assert.ok(brainName, `No brain for system: ${systemName}`);
      assert.ok(config, `No config for system: ${systemName}`);
    }
  });
});
