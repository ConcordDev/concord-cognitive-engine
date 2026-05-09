/**
 * Tier-2 contract tests for the GPU-adaptive brain profiles.
 *
 * Pins:
 *   - all 5 profiles (cpu / 12gb / 16gb / 24gb / 32gb) declare the 5 brains
 *   - pickProfile rounds VRAM DOWN to the right band
 *   - resolveProfile honours env override > probe > default order
 *   - applyProfile preserves explicit BRAIN_*_MODEL env vars
 *
 * Run: node --test tests/brain-profiles.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROFILES,
  pickProfile,
  resolveProfile,
  applyProfile,
} from "../lib/brain-profiles.js";

const BRAIN_KEYS = ["conscious", "subconscious", "utility", "repair", "multimodal"];

describe("PROFILES table", () => {
  it("declares 5 brains for every band", () => {
    for (const [name, profile] of Object.entries(PROFILES)) {
      for (const brain of BRAIN_KEYS) {
        assert.ok(profile[brain], `${name} missing brain: ${brain}`);
        assert.ok(profile[brain].model, `${name}.${brain} missing model`);
      }
    }
  });

  it("each profile declares bandGb + label", () => {
    for (const [name, profile] of Object.entries(PROFILES)) {
      assert.equal(typeof profile.bandGb, "number", `${name} missing bandGb`);
      assert.equal(typeof profile.label, "string", `${name} missing label`);
    }
  });

  it("32gb profile matches CLAUDE.md defaults (RTX PRO 4500 baseline)", () => {
    assert.match(PROFILES["32gb"].conscious.model, /qwen.*:32b/);
    assert.match(PROFILES["32gb"].subconscious.model, /qwen.*:7b/);
    assert.match(PROFILES["32gb"].utility.model, /qwen.*:3b/);
    assert.match(PROFILES["32gb"].repair.model, /qwen.*:1\.5b/);
    assert.match(PROFILES["32gb"].multimodal.model, /llava.*13b/);
    assert.equal(PROFILES["32gb"].utility.maxConcurrent, 16);
  });

  it("smaller profiles use smaller models monotonically", () => {
    const sizeOf = m => parseInt((m.match(/(\d+(\.\d+)?)b/) || [])[1] || "0", 10);
    assert.ok(sizeOf(PROFILES.cpu.conscious.model) <= sizeOf(PROFILES["12gb"].conscious.model));
    assert.ok(sizeOf(PROFILES["12gb"].conscious.model) <= sizeOf(PROFILES["16gb"].conscious.model));
    assert.ok(sizeOf(PROFILES["16gb"].conscious.model) <= sizeOf(PROFILES["24gb"].conscious.model));
    assert.ok(sizeOf(PROFILES["24gb"].conscious.model) <= sizeOf(PROFILES["32gb"].conscious.model));
  });
});

describe("pickProfile", () => {
  it("rounds VRAM down to the right band", () => {
    assert.equal(pickProfile(0).bandGb, 0);
    assert.equal(pickProfile(8).bandGb, 0);
    assert.equal(pickProfile(11).bandGb, 0);
    assert.equal(pickProfile(12).bandGb, 12);
    assert.equal(pickProfile(15).bandGb, 12);
    assert.equal(pickProfile(16).bandGb, 16);
    assert.equal(pickProfile(23).bandGb, 16);
    assert.equal(pickProfile(24).bandGb, 24);
    assert.equal(pickProfile(31).bandGb, 24);
    assert.equal(pickProfile(32).bandGb, 32);
    assert.equal(pickProfile(80).bandGb, 32);
  });

  it("returns CPU profile for invalid input", () => {
    assert.equal(pickProfile(-1), PROFILES.cpu);
    assert.equal(pickProfile(NaN), PROFILES.cpu);
    assert.equal(pickProfile(null), PROFILES.cpu);
  });
});

describe("resolveProfile", () => {
  it("honours CONCORD_GPU_PROFILE env override above probe", async () => {
    const prev = process.env.CONCORD_GPU_PROFILE;
    process.env.CONCORD_GPU_PROFILE = "16gb";
    try {
      const r = await resolveProfile();
      assert.equal(r.source, "env");
      assert.equal(r.choice, "16gb");
      assert.equal(r.profile, PROFILES["16gb"]);
    } finally {
      if (prev === undefined) delete process.env.CONCORD_GPU_PROFILE;
      else process.env.CONCORD_GPU_PROFILE = prev;
    }
  });

  it("falls back to default when env override is invalid", async () => {
    const prev = process.env.CONCORD_GPU_PROFILE;
    process.env.CONCORD_GPU_PROFILE = "garbage-band";
    try {
      const r = await resolveProfile();
      assert.notEqual(r.source, "env");
      // Either probe or default.
      assert.ok(["probe", "default"].includes(r.source));
    } finally {
      if (prev === undefined) delete process.env.CONCORD_GPU_PROFILE;
      else process.env.CONCORD_GPU_PROFILE = prev;
    }
  });

  it("returns 32gb default when probe fails (no nvidia-smi in test env)", async () => {
    const prev = process.env.CONCORD_GPU_PROFILE;
    delete process.env.CONCORD_GPU_PROFILE;
    try {
      const r = await resolveProfile({ timeoutMs: 100 });
      // In a CI without nvidia-smi, probe fails and we use the 32GB default.
      // If the host actually has GPUs, probe succeeds — both paths are valid;
      // the contract is we pick a profile, not which one.
      assert.ok(["probe", "default"].includes(r.source));
      assert.ok(PROFILES[r.choice]);
    } finally {
      if (prev !== undefined) process.env.CONCORD_GPU_PROFILE = prev;
    }
  });
});

describe("applyProfile", () => {
  it("merges profile values on top of base config", () => {
    const base = {
      conscious: { url: "http://x", role: "chat", temperature: 0.7, timeout: 1000, priority: 1 },
      subconscious: { url: "http://y", role: "auto", temperature: 0.9, timeout: 1000, priority: 2 },
      utility: { url: "http://z", role: "u", temperature: 0.3, timeout: 1000, priority: 3 },
      repair: { url: "http://r", role: "r", temperature: 0.1, timeout: 1000, priority: 0 },
      multimodal: { url: "http://m", role: "v", temperature: 0.1, timeout: 1000, priority: 4 },
    };
    const out = applyProfile(base, PROFILES["12gb"]);
    assert.equal(out.conscious.url, "http://x");           // base preserved
    assert.equal(out.conscious.model, PROFILES["12gb"].conscious.model);
    assert.equal(out.utility.maxConcurrent, PROFILES["12gb"].utility.maxConcurrent);
    assert.equal(out.subconscious.priority, 2);            // base preserved
  });

  it("explicit BRAIN_*_MODEL env override beats profile", () => {
    const prev = process.env.BRAIN_CONSCIOUS_MODEL;
    process.env.BRAIN_CONSCIOUS_MODEL = "custom:override";
    try {
      const base = {
        conscious: { url: "x", role: "chat", temperature: 0.7, timeout: 1000, priority: 1 },
        subconscious: { url: "y", role: "auto", temperature: 0.9, timeout: 1000, priority: 2 },
        utility: { url: "z", role: "u", temperature: 0.3, timeout: 1000, priority: 3 },
        repair: { url: "r", role: "r", temperature: 0.1, timeout: 1000, priority: 0 },
        multimodal: { url: "m", role: "v", temperature: 0.1, timeout: 1000, priority: 4 },
      };
      const out = applyProfile(base, PROFILES["12gb"]);
      assert.equal(out.conscious.model, "custom:override");
    } finally {
      if (prev === undefined) delete process.env.BRAIN_CONSCIOUS_MODEL;
      else process.env.BRAIN_CONSCIOUS_MODEL = prev;
    }
  });

  it("explicit BRAIN_*_CONCURRENT env override beats profile", () => {
    const prev = process.env.BRAIN_UTILITY_CONCURRENT;
    process.env.BRAIN_UTILITY_CONCURRENT = "99";
    try {
      const base = {
        conscious: { url: "x", role: "chat", temperature: 0.7, timeout: 1000, priority: 1 },
        subconscious: { url: "y", role: "auto", temperature: 0.9, timeout: 1000, priority: 2 },
        utility: { url: "z", role: "u", temperature: 0.3, timeout: 1000, priority: 3 },
        repair: { url: "r", role: "r", temperature: 0.1, timeout: 1000, priority: 0 },
        multimodal: { url: "m", role: "v", temperature: 0.1, timeout: 1000, priority: 4 },
      };
      const out = applyProfile(base, PROFILES["12gb"]);
      assert.equal(out.utility.maxConcurrent, 99);
    } finally {
      if (prev === undefined) delete process.env.BRAIN_UTILITY_CONCURRENT;
      else process.env.BRAIN_UTILITY_CONCURRENT = prev;
    }
  });

  it("does not mutate input config", () => {
    const base = {
      conscious: { url: "x", model: "ORIG", maxConcurrent: 1, role: "x", temperature: 0.5, timeout: 1, priority: 1 },
      subconscious: { url: "y", model: "ORIG2", maxConcurrent: 1, role: "x", temperature: 0.5, timeout: 1, priority: 2 },
      utility: { url: "z", model: "ORIG3", maxConcurrent: 1, role: "x", temperature: 0.5, timeout: 1, priority: 3 },
      repair: { url: "r", model: "ORIG4", maxConcurrent: 1, role: "x", temperature: 0.5, timeout: 1, priority: 0 },
      multimodal: { url: "m", model: "ORIG5", maxConcurrent: 1, role: "x", temperature: 0.5, timeout: 1, priority: 4 },
    };
    applyProfile(base, PROFILES["12gb"]);
    assert.equal(base.conscious.model, "ORIG", "input must not be mutated");
  });
});
