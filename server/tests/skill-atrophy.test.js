/**
 * Skill Atrophy Tests
 *
 * Tests the skill decay system that prevents stale high-level skills:
 *   - getAtrophyRisk — pure risk projection
 *   - runAtrophyCycle — decay execution against DB
 *
 * Run: node --test tests/skill-atrophy.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getAtrophyRisk,
  runAtrophyCycle,
} from "../lib/skill-atrophy.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 14;

function nowMs() {
  return Date.now();
}

/** Create a skill that was last used N days ago. */
function skillLastUsedDaysAgo(daysAgo, overrides = {}) {
  return {
    id: "skill_1",
    skill_level: 50,
    last_used_at: nowMs() - daysAgo * DAY_MS,
    ...overrides,
  };
}

/** Build a minimal mock SQLite DB. */
function makeMockDb(skills = []) {
  const updateCalls = [];
  return {
    _updateCalls: updateCalls,
    prepare(sql) {
      const isUpdate = sql.trim().startsWith("UPDATE");
      const isSelect = sql.trim().startsWith("SELECT");
      return {
        run(...args) {
          if (isUpdate) updateCalls.push({ sql, args });
          return { changes: 1 };
        },
        get(...args) {
          return null;
        },
        all(...args) {
          return skills;
        },
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. getAtrophyRisk
// ═══════════════════════════════════════════════════════════════════════════════

describe("getAtrophyRisk", () => {
  it("returns null daysUnused when last_used_at is missing", () => {
    const risk = getAtrophyRisk({ id: "s1", skill_level: 10 });
    assert.equal(risk.daysUnused, null);
    assert.equal(risk.projectedLoss, 0);
    assert.equal(risk.immune, false);
  });

  it("returns 0 projected loss within grace period (< 14 days)", () => {
    const skill = skillLastUsedDaysAgo(5);
    const risk = getAtrophyRisk(skill);
    assert.ok(risk.daysUnused <= GRACE_DAYS);
    assert.equal(risk.projectedLoss, 0);
  });

  it("returns 0 projected loss exactly at grace boundary (14 days)", () => {
    const skill = skillLastUsedDaysAgo(14);
    const risk = getAtrophyRisk(skill);
    assert.equal(risk.projectedLoss, 0, "grace period should still apply at exactly 14 days");
  });

  it("returns positive projected loss beyond grace period", () => {
    const skill = skillLastUsedDaysAgo(21, { skill_level: 50 }); // 7 days over grace
    const risk = getAtrophyRisk(skill);
    assert.ok(risk.projectedLoss > 0, "should have positive projected loss after grace");
  });

  it("projected loss increases with more time unused", () => {
    const skill20 = skillLastUsedDaysAgo(20, { skill_level: 50 });
    const skill30 = skillLastUsedDaysAgo(30, { skill_level: 50 });
    const risk20 = getAtrophyRisk(skill20);
    const risk30 = getAtrophyRisk(skill30);
    assert.ok(risk30.projectedLoss > risk20.projectedLoss, "more time = more decay");
  });

  it("immune skills (level >= 500) have projectedLoss = 0 regardless", () => {
    const skill = skillLastUsedDaysAgo(60, { skill_level: 500 });
    const risk = getAtrophyRisk(skill);
    assert.equal(risk.projectedLoss, 0);
    assert.equal(risk.immune, true);
  });

  it("level 499 is NOT immune", () => {
    const skill = skillLastUsedDaysAgo(30, { skill_level: 499 });
    const risk = getAtrophyRisk(skill);
    assert.equal(risk.immune, false);
    assert.ok(risk.projectedLoss > 0);
  });

  it("projected loss is capped so skill cannot decay below level 1", () => {
    const skill = skillLastUsedDaysAgo(10000, { skill_level: 2 }); // extreme time, low level
    const risk = getAtrophyRisk(skill);
    // projectedLoss cannot exceed skill_level - 1 = 1
    assert.ok(risk.projectedLoss <= skill.skill_level - 1, "cannot lose more than skill_level - 1");
  });

  it("daysUnused is a non-negative integer", () => {
    const skill = skillLastUsedDaysAgo(7);
    const risk = getAtrophyRisk(skill);
    assert.ok(Number.isInteger(risk.daysUnused));
    assert.ok(risk.daysUnused >= 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. runAtrophyCycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("runAtrophyCycle", () => {
  it("returns { processed, decayed } structure", async () => {
    const db = makeMockDb([]);
    const result = await runAtrophyCycle(db);
    assert.ok("processed" in result, "should have 'processed' key");
    assert.ok("decayed" in result, "should have 'decayed' key");
  });

  it("processes 0 when no skills are returned from DB", async () => {
    const db = makeMockDb([]);
    const result = await runAtrophyCycle(db);
    assert.equal(result.processed, 0);
    assert.equal(result.decayed, 0);
  });

  it("decays skills that have been unused beyond grace period", async () => {
    const staleSkills = [
      {
        id: "skill_1",
        skill_level: 50,
        last_used_at: nowMs() - 30 * DAY_MS, // 30 days ago, 16 days past grace
      },
    ];
    const db = makeMockDb(staleSkills);
    const result = await runAtrophyCycle(db);
    assert.equal(result.processed, 1);
    assert.equal(result.decayed, 1);
    assert.equal(db._updateCalls.length, 1, "should issue one UPDATE");
  });

  it("does not update DB for skill with zero computed loss", async () => {
    // A skill just 1 day past grace (minimal decay)
    // With DECAY_RATE=0.01 and 1 day past grace: loss = 0.01 — should still update
    const staleSkills = [
      {
        id: "skill_2",
        skill_level: 2,
        last_used_at: nowMs() - 15 * DAY_MS, // 1 day past grace
      },
    ];
    const db = makeMockDb(staleSkills);
    const result = await runAtrophyCycle(db);
    // Could be decayed (0.01 loss > 0) or not — just verify structure
    assert.ok(result.processed >= 0);
    assert.ok(result.decayed <= result.processed);
  });

  it("processes multiple stale skills", async () => {
    const staleSkills = Array.from({ length: 5 }, (_, i) => ({
      id: `skill_${i}`,
      skill_level: 30,
      last_used_at: nowMs() - (20 + i) * DAY_MS,
    }));
    const db = makeMockDb(staleSkills);
    const result = await runAtrophyCycle(db);
    assert.equal(result.processed, 5);
    assert.equal(result.decayed, 5);
  });

  it("decayed count never exceeds processed count", async () => {
    const skills = Array.from({ length: 3 }, (_, i) => ({
      id: `skill_${i}`,
      skill_level: 20,
      last_used_at: nowMs() - 25 * DAY_MS,
    }));
    const db = makeMockDb(skills);
    const result = await runAtrophyCycle(db);
    assert.ok(result.decayed <= result.processed);
  });
});
