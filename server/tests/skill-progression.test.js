/**
 * Skill Progression Tests
 *
 * Tests the open-ended, anti-grinding skill progression system:
 *   - computeLevelFromExperience
 *   - computeCreationQuality
 *   - verifyMeaningfulEvent
 *   - detectGrinding
 *   - getMasteryMarkers
 *   - awardExperience (with mock DB)
 *
 * Run: node --test tests/skill-progression.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EXPERIENCE_RATES,
  computeLevelFromExperience,
  computeCreationQuality,
  verifyMeaningfulEvent,
  detectGrinding,
  getMasteryMarkers,
  awardExperience,
} from "../lib/skill-progression.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSkill(overrides = {}) {
  return {
    id: "skill_test_1",
    title: "Swordsmanship",
    type: "skill",
    skill_level: 1,
    total_experience: 0,
    world_id: "concordia-hub",
    ...overrides,
  };
}

/** Build a mock SQLite DB that tracks .run() calls and returns configurable rows. */
function makeMockDb(rows = []) {
  const runCalls = [];
  return {
    _runCalls: runCalls,
    prepare(sql) {
      return {
        run(...args) {
          runCalls.push({ sql, args });
          return { changes: 1 };
        },
        get(...args) {
          return null;
        },
        all(...args) {
          return rows;
        },
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. EXPERIENCE_RATES
// ═══════════════════════════════════════════════════════════════════════════════

describe("EXPERIENCE_RATES", () => {
  it("defines expected event types", () => {
    assert.ok("practice" in EXPERIENCE_RATES);
    assert.ok("teaching" in EXPERIENCE_RATES);
    assert.ok("meaningful_application" in EXPERIENCE_RATES);
    assert.ok("cross_world_use" in EXPERIENCE_RATES);
    assert.ok("hybrid_contribution" in EXPERIENCE_RATES);
    assert.ok("master_demonstration" in EXPERIENCE_RATES);
  });

  it("hybrid_contribution has the highest base rate", () => {
    const max = Math.max(...Object.values(EXPERIENCE_RATES));
    assert.equal(EXPERIENCE_RATES.hybrid_contribution, max);
  });

  it("all rates are positive numbers", () => {
    for (const [key, val] of Object.entries(EXPERIENCE_RATES)) {
      assert.ok(val > 0, `${key} should be positive`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. computeLevelFromExperience
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeLevelFromExperience", () => {
  it("returns 1 for 0 experience", () => {
    assert.equal(computeLevelFromExperience(0), 1);
  });

  it("returns a value greater than 1 for positive experience", () => {
    assert.ok(computeLevelFromExperience(100) > 1);
  });

  it("level increases monotonically with experience", () => {
    const levels = [0, 10, 100, 1000, 10000].map(computeLevelFromExperience);
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i] > levels[i - 1], `Level at index ${i} should be > level at ${i - 1}`);
    }
  });

  it("grows logarithmically (diminishing returns)", () => {
    // Jump from 0 to 100 XP vs 100 to 200 XP — first jump should yield more level gain
    const gain1 = computeLevelFromExperience(100) - computeLevelFromExperience(0);
    const gain2 = computeLevelFromExperience(200) - computeLevelFromExperience(100);
    assert.ok(gain1 > gain2, "First 100 XP should yield more levels than second 100 XP");
  });

  it("is unbounded — very high XP still returns > 1", () => {
    assert.ok(computeLevelFromExperience(1_000_000) > 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. computeCreationQuality
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeCreationQuality", () => {
  it("returns a number between 1 and 100", () => {
    const q = computeCreationQuality(50, 50);
    assert.ok(q >= 1 && q <= 100);
  });

  it("at minimum skill and tool quality, returns at least 1", () => {
    const q = computeCreationQuality(1, 0);
    assert.ok(q >= 1);
  });

  it("at max skill (500+) and max tool quality (100), returns 100", () => {
    const q = computeCreationQuality(500, 100);
    assert.equal(q, 100);
  });

  it("higher skill level produces better quality", () => {
    const low = computeCreationQuality(10, 50);
    const high = computeCreationQuality(400, 50);
    assert.ok(high > low);
  });

  it("higher tool quality produces better quality", () => {
    const lowTool = computeCreationQuality(100, 10);
    const highTool = computeCreationQuality(100, 90);
    assert.ok(highTool > lowTool);
  });

  it("uses 1 as default skill level", () => {
    const q = computeCreationQuality(undefined, 100);
    assert.ok(q >= 1 && q <= 100);
  });

  it("uses 10 as default tool quality", () => {
    const q = computeCreationQuality(100, undefined);
    assert.ok(q >= 1 && q <= 100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. verifyMeaningfulEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe("verifyMeaningfulEvent", () => {
  const skill = makeSkill();

  it("practice is meaningful when changedWorldState is set", () => {
    assert.equal(verifyMeaningfulEvent(skill, "practice", { changedWorldState: true }), true);
  });

  it("practice is meaningful when affectedNPC is set", () => {
    assert.equal(verifyMeaningfulEvent(skill, "practice", { affectedNPC: "npc_42" }), true);
  });

  it("practice is meaningful when solvedChallenge is set", () => {
    assert.equal(verifyMeaningfulEvent(skill, "practice", { solvedChallenge: "ch_1" }), true);
  });

  it("practice is not meaningful when no flags set", () => {
    assert.equal(verifyMeaningfulEvent(skill, "practice", {}), false);
  });

  it("teaching is meaningful when studentImproved is truthy", () => {
    assert.equal(verifyMeaningfulEvent(skill, "teaching", { studentImproved: true }), true);
  });

  it("teaching is not meaningful when studentImproved is false", () => {
    assert.equal(verifyMeaningfulEvent(skill, "teaching", { studentImproved: false }), false);
  });

  it("meaningful_application is meaningful when solvedChallenge is set", () => {
    assert.equal(verifyMeaningfulEvent(skill, "meaningful_application", { solvedChallenge: "ch_2" }), true);
  });

  it("cross_world_use is meaningful when worldId differs from skill.world_id", () => {
    const s = makeSkill({ world_id: "concordia-hub" });
    assert.equal(verifyMeaningfulEvent(s, "cross_world_use", { worldId: "another-world" }), true);
  });

  it("cross_world_use is not meaningful when worldId is same as skill.world_id", () => {
    const s = makeSkill({ world_id: "concordia-hub" });
    assert.equal(verifyMeaningfulEvent(s, "cross_world_use", { worldId: "concordia-hub" }), false);
  });

  it("hybrid_contribution is always meaningful", () => {
    assert.equal(verifyMeaningfulEvent(skill, "hybrid_contribution", {}), true);
  });

  it("master_demonstration is meaningful when audienceSize > 0", () => {
    assert.equal(verifyMeaningfulEvent(skill, "master_demonstration", { audienceSize: 5 }), true);
  });

  it("master_demonstration is not meaningful when audienceSize is 0", () => {
    assert.equal(verifyMeaningfulEvent(skill, "master_demonstration", { audienceSize: 0 }), false);
  });

  it("unknown event type returns false", () => {
    assert.equal(verifyMeaningfulEvent(skill, "unknown_type", { anything: true }), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. detectGrinding
// ═══════════════════════════════════════════════════════════════════════════════

describe("detectGrinding", () => {
  it("returns false when userId is null", () => {
    const db = makeMockDb();
    assert.equal(detectGrinding("skill_1", null, db), false);
  });

  it("returns false when fewer than 5 events exist", () => {
    const rows = [
      { context: JSON.stringify({ challengeId: "c1", worldId: "w1" }) },
      { context: JSON.stringify({ challengeId: "c2", worldId: "w2" }) },
    ];
    const db = makeMockDb(rows);
    assert.equal(detectGrinding("skill_1", "user_1", db), false);
  });

  it("detects grinding when all 20 events have the same context", () => {
    const rows = Array.from({ length: 20 }, () => ({
      context: JSON.stringify({ challengeId: "c1", targetId: "t1", worldId: "w1" }),
    }));
    const db = makeMockDb(rows);
    assert.equal(detectGrinding("skill_1", "user_1", db), true);
  });

  it("does not flag as grinding when contexts are diverse", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      context: JSON.stringify({ challengeId: `c${i}`, targetId: `t${i}`, worldId: "w1" }),
    }));
    const db = makeMockDb(rows);
    assert.equal(detectGrinding("skill_1", "user_1", db), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. getMasteryMarkers
// ═══════════════════════════════════════════════════════════════════════════════

describe("getMasteryMarkers", () => {
  it("returns unranked for level below 10", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 5 }));
    assert.equal(markers.badge, "unranked");
  });

  it("returns novice at level 10", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 10 }));
    assert.equal(markers.badge, "novice");
  });

  it("returns adept at level 25", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 25 }));
    assert.equal(markers.badge, "adept");
  });

  it("returns skilled at level 50", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 50 }));
    assert.equal(markers.badge, "skilled");
    assert.equal(markers.aura, "blue");
    assert.equal(markers.npcRecognition, true);
  });

  it("returns expert at level 100 with teacherEligible=true", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 100 }));
    assert.equal(markers.badge, "expert");
    assert.equal(markers.teacherEligible, true);
  });

  it("returns legendary at level 500 with legendaryStatus", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 500 }));
    assert.equal(markers.badge, "legendary");
    assert.equal(markers.legendaryStatus, true);
  });

  it("returns mythic at level 1000", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 1000 }));
    assert.equal(markers.badge, "mythic");
    assert.equal(markers.mythicStatus, true);
  });

  it("returns transcendent at level 5000", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 5000 }));
    assert.equal(markers.badge, "transcendent");
  });

  it("includes the current level in the output", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 75 }));
    assert.equal(markers.level, 75);
  });

  it("includes nextThreshold when not at max", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 10 }));
    assert.ok(markers.nextThreshold !== null);
    assert.ok(markers.nextThreshold > 10);
  });

  it("returns null nextThreshold at or beyond transcendent", () => {
    const markers = getMasteryMarkers(makeSkill({ skill_level: 9999 }));
    assert.equal(markers.nextThreshold, null);
  });

  it("defaults to level 1 when skill_level is missing", () => {
    const markers = getMasteryMarkers({});
    assert.equal(markers.level, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. awardExperience
// ═══════════════════════════════════════════════════════════════════════════════

describe("awardExperience", () => {
  it("returns 0 awarded for unknown event type", async () => {
    const db = makeMockDb();
    const skill = makeSkill();
    const result = await awardExperience(skill, "unknown_event", {}, db);
    assert.equal(result.awarded, 0);
  });

  it("awards XP for a meaningful practice event", async () => {
    const db = makeMockDb();
    const skill = makeSkill();
    const result = await awardExperience(
      skill,
      "practice",
      { worldId: "test-world", userId: "u1", changedWorldState: true },
      db,
    );
    assert.ok(result.awarded > 0, "meaningful practice should award XP");
    assert.ok(result.newLevel >= 1);
    assert.equal(result.grinding, false);
  });

  it("awards reduced XP for a non-meaningful practice event", async () => {
    const db = makeMockDb();
    const skill = makeSkill();
    // Non-meaningful: no changedWorldState, affectedNPC, or solvedChallenge
    const result = await awardExperience(
      skill,
      "practice",
      { worldId: "test-world", userId: "u1" },
      db,
    );
    assert.ok(result.awarded > 0, "non-meaningful practice still awards reduced XP");
    // Should award less than meaningful rate (1 XP) — reduced by 0.1x factor
    assert.ok(result.awarded < 1, "non-meaningful should award less than base rate");
  });

  it("detects grinding and returns 0 XP", async () => {
    // Simulate grinding: 20 identical contexts
    const rows = Array.from({ length: 20 }, () => ({
      context: JSON.stringify({ challengeId: "c1", targetId: "t1", worldId: "w1" }),
    }));
    const db = makeMockDb(rows);
    const skill = makeSkill();
    const result = await awardExperience(
      skill,
      "practice",
      { worldId: "w1", userId: "u1", changedWorldState: true },
      db,
    );
    assert.equal(result.awarded, 0);
    assert.equal(result.grinding, true);
  });

  it("awards more XP for hybrid_contribution than for practice", async () => {
    const db1 = makeMockDb();
    const db2 = makeMockDb();
    const skill = makeSkill();

    const practiceResult = await awardExperience(
      skill, "practice",
      { worldId: "w", userId: "u1", changedWorldState: true },
      db1,
    );
    const hybridResult = await awardExperience(
      skill, "hybrid_contribution",
      { worldId: "w", userId: "u1" },
      db2,
    );

    assert.ok(hybridResult.awarded > practiceResult.awarded, "hybrid should award more than practice");
  });

  it("applies diminishing returns at high skill level", async () => {
    const db1 = makeMockDb();
    const db2 = makeMockDb();

    const lowLevel = makeSkill({ skill_level: 1, total_experience: 0 });
    const highLevel = makeSkill({ skill_level: 1000, total_experience: 5000 });

    const lowResult = await awardExperience(
      lowLevel, "hybrid_contribution",
      { worldId: "w", userId: "u1" },
      db1,
    );
    const highResult = await awardExperience(
      highLevel, "hybrid_contribution",
      { worldId: "w", userId: "u1" },
      db2,
    );

    assert.ok(lowResult.awarded > highResult.awarded, "high-level skills should award less XP due to diminishing returns");
  });

  it("calls db.prepare at least twice (UPDATE + INSERT)", async () => {
    const db = makeMockDb();
    const skill = makeSkill();

    await awardExperience(
      skill, "teaching",
      { worldId: "w", userId: "u1", studentImproved: true },
      db,
    );

    assert.ok(db._runCalls.length >= 2, "should update skill AND insert event record");
  });
});
