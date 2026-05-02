/**
 * Artifact Budget Tests
 *
 * Tests the daily storage budget system for emergent entity artifacts:
 *   - estimateArtifactSize — domain/action size lookup
 *   - checkBudget — budget enforcement against STATE
 *   - downgradePlan — graceful degradation when budget is tight
 *   - resetDailyUsage — STATE reset
 *
 * Run: node --test tests/artifact-budget.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  estimateArtifactSize,
  checkBudget,
  downgradePlan,
  resetDailyUsage,
} from "../lib/artifact-budget.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const MB = 1024 * 1024;
const KB = 1024;

function makeState(overrides = {}) {
  return {
    dailyArtifactBytes: 0,
    dailyArtifactResetAt: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. estimateArtifactSize
// ═══════════════════════════════════════════════════════════════════════════════

describe("estimateArtifactSize", () => {
  it("returns a positive number for all domain/action combos", () => {
    const combos = [
      ["music", "audio"],
      ["music", "midi"],
      ["art", "full"],
      ["art", "thumbnail"],
      ["studio", "video"],
      ["studio", "thumbnail"],
      ["photography", "full"],
      ["video", "video"],
    ];
    for (const [domain, action] of combos) {
      const size = estimateArtifactSize(domain, action);
      assert.ok(size > 0, `${domain}/${action} should have positive size`);
    }
  });

  it("music/audio returns ~5 MB", () => {
    const size = estimateArtifactSize("music", "audio");
    assert.ok(size >= 4 * MB && size <= 6 * MB, `Expected ~5 MB, got ${size}`);
  });

  it("music/midi returns much less than audio", () => {
    const audio = estimateArtifactSize("music", "audio");
    const midi = estimateArtifactSize("music", "midi");
    assert.ok(midi < audio, "midi should be smaller than audio");
  });

  it("studio/video returns the largest estimate", () => {
    const video = estimateArtifactSize("studio", "video");
    const audio = estimateArtifactSize("music", "audio");
    const image = estimateArtifactSize("art", "full");
    assert.ok(video > audio, "video should be larger than audio");
    assert.ok(video > image, "video should be larger than image");
  });

  it("text/* domain returns tiny size (~10 KB)", () => {
    const size = estimateArtifactSize("text/markdown", "content");
    assert.ok(size <= 20 * KB, `text should be tiny, got ${size}`);
  });

  it("text domain prefix works for any text subdomain", () => {
    const s1 = estimateArtifactSize("text", "note");
    const s2 = estimateArtifactSize("text/html", "document");
    const s3 = estimateArtifactSize("text/plain", "file");
    assert.ok(s1 > 0 && s2 > 0 && s3 > 0);
    // All text variants should be small
    assert.ok(s1 <= 20 * KB);
    assert.ok(s2 <= 20 * KB);
    assert.ok(s3 <= 20 * KB);
  });

  it("returns a positive default for unknown domain", () => {
    const size = estimateArtifactSize("alien-domain", "unknown-action");
    assert.ok(size > 0, "unknown domain should return default positive size");
  });

  it("returns default size for known domain with unknown action", () => {
    const size = estimateArtifactSize("music", "unknown-format");
    // Should fall back to domain default
    assert.ok(size > 0);
  });

  it("art thumbnail is smaller than art full", () => {
    const full = estimateArtifactSize("art", "full");
    const thumb = estimateArtifactSize("art", "thumbnail");
    assert.ok(thumb < full, "thumbnail should be smaller than full");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. checkBudget
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkBudget", () => {
  it("returns required fields", () => {
    const STATE = makeState();
    const result = checkBudget(STATE);

    assert.ok("allowed" in result);
    assert.ok("remainingBytes" in result);
    assert.ok("budgetBytes" in result);
    assert.ok("usedTodayBytes" in result);
    assert.ok("fillRatio" in result);
  });

  it("allows creation when no bytes used", () => {
    const STATE = makeState({ dailyArtifactBytes: 0 });
    const result = checkBudget(STATE);
    assert.equal(result.allowed, true);
    assert.ok(result.remainingBytes > 0);
  });

  it("usedTodayBytes matches STATE.dailyArtifactBytes", () => {
    const STATE = makeState({ dailyArtifactBytes: 1024 * 1024 });
    const result = checkBudget(STATE);
    assert.equal(result.usedTodayBytes, 1024 * 1024);
  });

  it("remainingBytes is budgetBytes minus usedTodayBytes", () => {
    const STATE = makeState({ dailyArtifactBytes: 10 * MB });
    const result = checkBudget(STATE);
    assert.equal(result.remainingBytes, Math.max(0, result.budgetBytes - 10 * MB));
  });

  it("remainingBytes is never negative", () => {
    // Simulate STATE having used more than the budget
    const STATE = makeState({ dailyArtifactBytes: 999 * MB });
    const result = checkBudget(STATE);
    assert.ok(result.remainingBytes >= 0, "remaining bytes should never be negative");
  });

  it("fillRatio is a number between 0 and 1", () => {
    const STATE = makeState();
    const result = checkBudget(STATE);
    assert.ok(typeof result.fillRatio === "number");
    assert.ok(result.fillRatio >= 0 && result.fillRatio <= 1);
  });

  it("budgetBytes is positive", () => {
    const STATE = makeState();
    const result = checkBudget(STATE);
    assert.ok(result.budgetBytes > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. downgradePlan
// ═══════════════════════════════════════════════════════════════════════════════

describe("downgradePlan", () => {
  it("returns null when remaining budget exceeds estimated cost", () => {
    const result = downgradePlan("art", "full", 999 * MB);
    assert.equal(result, null, "should not downgrade when plenty of budget remains");
  });

  it("returns a downgrade object when budget is tight for music", () => {
    const result = downgradePlan("music", "audio", 1 * KB); // 1 KB remaining, but audio ~5 MB
    assert.ok(result !== null, "should suggest a downgrade");
    assert.ok(result.format === "midi" || result.textOnly === true, "should downgrade audio to midi or text-only");
  });

  it("returns a downgrade object when budget is tight for art", () => {
    const result = downgradePlan("art", "full", 1 * KB); // tiny remaining budget
    assert.ok(result !== null, "should suggest a downgrade");
    assert.ok("maxResolution" in result, "art downgrade should limit resolution");
  });

  it("downgrades studio/video to midi when budget is tight", () => {
    const result = downgradePlan("studio", "video", 100); // almost no budget
    assert.ok(result !== null);
    assert.ok(result.format === "midi" || result.textOnly === true);
  });

  it("downgrades unknown domain to textOnly", () => {
    const result = downgradePlan("mystery-domain", "some-action", 1);
    assert.ok(result !== null);
    assert.equal(result.textOnly, true);
  });

  it("does not downgrade text domain (always tiny)", () => {
    // Text is ~10 KB, so even 15 KB remaining should allow it
    const result = downgradePlan("text/markdown", "note", 20 * KB);
    assert.equal(result, null, "text domain at 20KB remaining should not need downgrade");
  });

  it("audio domain downgrades to midi", () => {
    const result = downgradePlan("audio", "audio", 100);
    assert.ok(result !== null);
    assert.equal(result.format, "midi");
  });

  it("video domain downgrades to midi", () => {
    const result = downgradePlan("video", "video", 100);
    assert.ok(result !== null);
    assert.equal(result.format, "midi");
  });

  it("photography domain downgrades with maxResolution", () => {
    const result = downgradePlan("photography", "full", 1);
    assert.ok(result !== null);
    assert.ok("maxResolution" in result);
    assert.ok(result.maxResolution <= 512);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. resetDailyUsage
// ═══════════════════════════════════════════════════════════════════════════════

describe("resetDailyUsage", () => {
  it("resets dailyArtifactBytes to 0", () => {
    const STATE = makeState({ dailyArtifactBytes: 50 * MB });
    resetDailyUsage(STATE);
    assert.equal(STATE.dailyArtifactBytes, 0);
  });

  it("sets dailyArtifactResetAt to a valid ISO timestamp", () => {
    const STATE = makeState();
    resetDailyUsage(STATE);
    assert.ok(STATE.dailyArtifactResetAt, "should set resetAt timestamp");
    assert.doesNotThrow(() => new Date(STATE.dailyArtifactResetAt));
    assert.ok(new Date(STATE.dailyArtifactResetAt).getTime() > 0);
  });

  it("resetAt timestamp is close to now", () => {
    const STATE = makeState();
    const before = Date.now();
    resetDailyUsage(STATE);
    const after = Date.now();
    const resetMs = new Date(STATE.dailyArtifactResetAt).getTime();
    assert.ok(resetMs >= before - 1000 && resetMs <= after + 1000, "resetAt should be approximately now");
  });

  it("can be called multiple times without error", () => {
    const STATE = makeState();
    assert.doesNotThrow(() => {
      resetDailyUsage(STATE);
      resetDailyUsage(STATE);
      resetDailyUsage(STATE);
    });
  });

  it("after reset, checkBudget shows full remaining budget", () => {
    const STATE = makeState({ dailyArtifactBytes: 100 * MB });
    resetDailyUsage(STATE);
    const result = checkBudget(STATE);
    assert.equal(result.usedTodayBytes, 0);
    assert.equal(result.remainingBytes, result.budgetBytes);
  });
});
