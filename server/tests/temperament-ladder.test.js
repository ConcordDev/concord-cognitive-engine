/**
 * Tier-2 contract tests for Phase 2 of the Temperament engine — the graded
 * escalation ladder.
 *
 * Pins:
 *   - RUNGS order + targetRung (disposition × proximity = min gate).
 *   - stepRung escalation forces a THREATENING tick before HOSTILE (the
 *     guaranteed final warning); decays exactly one rung at a time.
 *   - isEngaged only at HOSTILE.
 *   - barkFor archetype-family vocabulary (authority/outlaw/monster/default).
 *   - applyDeescalation: holster/yield step down, comply/pay stand fully down.
 *
 * Run: node --test server/tests/temperament-ladder.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RUNGS,
  targetRung,
  stepRung,
  isEngaged,
  barkFor,
  archetypeFamily,
  applyDeescalation,
  DEESCALATION_VERBS,
} from "../lib/temperament-ladder.js";

const GUARD = { alertRadius: 15, pursuitRadius: 25, melee: 2 };

describe("RUNGS ladder", () => {
  it("is ordered low → high", () => {
    assert.deepEqual(RUNGS, ["neutral", "wary", "warning", "threatening", "hostile"]);
  });
});

describe("targetRung — disposition × proximity", () => {
  it("is neutral when calm or out of alert range", () => {
    assert.equal(targetRung({ effectiveAggro: 0, nearestDist: 1, ...GUARD }), "neutral");
    assert.equal(targetRung({ effectiveAggro: 0.9, nearestDist: 100, ...GUARD }), "neutral");
  });

  it("proximity caps the rung — closer is always a higher rung", () => {
    // melee(2)→hostile; inner-alert(≤7.5)→threatening; alert(≤15)→warning; pursuit(≤25)→wary; beyond→neutral
    assert.equal(targetRung({ effectiveAggro: 0.95, nearestDist: 2, ...GUARD }), "hostile");
    assert.equal(targetRung({ effectiveAggro: 0.95, nearestDist: 7, ...GUARD }), "threatening");
    assert.equal(targetRung({ effectiveAggro: 0.95, nearestDist: 14, ...GUARD }), "warning");
    assert.equal(targetRung({ effectiveAggro: 0.95, nearestDist: 20, ...GUARD }), "wary");
    assert.equal(targetRung({ effectiveAggro: 0.95, nearestDist: 30, ...GUARD }), "neutral");
  });

  it("disposition caps the rung — a lukewarm NPC in melee is only as hot as it feels", () => {
    // effectiveAggro 0.35 → dispositionLevel 'wary' → capped at wary even at melee
    assert.equal(targetRung({ effectiveAggro: 0.35, nearestDist: 1, ...GUARD }), "wary");
    // 0.6 → 'warning' → capped at warning even in melee
    assert.equal(targetRung({ effectiveAggro: 0.6, nearestDist: 1, ...GUARD }), "warning");
  });
});

describe("stepRung — escalation forces a final warning", () => {
  it("never jumps straight to hostile from below threatening", () => {
    assert.deepEqual(stepRung("neutral", "hostile"), { rung: "threatening", transition: "up" });
    assert.deepEqual(stepRung("wary", "hostile"), { rung: "threatening", transition: "up" });
    assert.deepEqual(stepRung("warning", "hostile"), { rung: "threatening", transition: "up" });
  });

  it("goes threatening → hostile on the next tick", () => {
    assert.deepEqual(stepRung("threatening", "hostile"), { rung: "hostile", transition: "up" });
  });

  it("rises freely up to threatening", () => {
    assert.deepEqual(stepRung("neutral", "warning"), { rung: "warning", transition: "up" });
    assert.deepEqual(stepRung("neutral", "threatening"), { rung: "threatening", transition: "up" });
  });

  it("decays exactly one rung at a time", () => {
    assert.deepEqual(stepRung("hostile", "neutral"), { rung: "threatening", transition: "down" });
    assert.deepEqual(stepRung("threatening", "neutral"), { rung: "warning", transition: "down" });
  });

  it("is a no-op at the target", () => {
    assert.deepEqual(stepRung("warning", "warning"), { rung: "warning", transition: "none" });
  });

  it("a full climb neutral→hostile always passes through threatening", () => {
    // simulate: target stays hostile, step each tick
    let rung = "neutral";
    const seen = [rung];
    for (let i = 0; i < 5; i++) {
      rung = stepRung(rung, "hostile").rung;
      seen.push(rung);
    }
    assert.ok(seen.indexOf("threatening") < seen.indexOf("hostile"), "threatening precedes hostile");
    assert.ok(seen.includes("hostile"));
  });
});

describe("isEngaged", () => {
  it("is true only at hostile", () => {
    for (const r of RUNGS) assert.equal(isEngaged(r), r === "hostile");
  });
});

describe("barkFor vocabulary", () => {
  it("maps archetypes to families", () => {
    assert.equal(archetypeFamily("guard"), "authority");
    assert.equal(archetypeFamily("bandit"), "outlaw");
    assert.equal(archetypeFamily("wraith"), "monster");
    assert.equal(archetypeFamily("farmer"), "default");
  });

  it("authority warns before it commits", () => {
    assert.match(barkFor("warning", "guard"), /far enough/i);
    assert.match(barkFor("threatening", "guard"), /last warning/i);
  });

  it("monsters are wordless (audio/snarl layer covers them)", () => {
    assert.equal(barkFor("warning", "wraith"), "");
    assert.equal(barkFor("hostile", "wraith"), "");
  });

  it("civilians get the default warning line", () => {
    assert.match(barkFor("warning", "farmer"), /back off/i);
  });

  it("unknown rung is the empty bark, never throws", () => {
    assert.equal(barkFor("nonsense", "guard"), "");
  });
});

describe("applyDeescalation", () => {
  it("holster / back_off step down one rung", () => {
    assert.equal(applyDeescalation("threatening", "holster"), "warning");
    assert.equal(applyDeescalation("warning", "back_off"), "wary");
  });

  it("yield / leave_zone step down two", () => {
    assert.equal(applyDeescalation("hostile", "yield"), "warning");
    assert.equal(applyDeescalation("threatening", "leave_zone"), "wary");
  });

  it("comply / pay_bounty stand the NPC fully down", () => {
    assert.equal(applyDeescalation("hostile", "comply"), "neutral");
    assert.equal(applyDeescalation("hostile", "pay_bounty"), "neutral");
  });

  it("never drops below neutral; unknown verb is a no-op", () => {
    assert.equal(applyDeescalation("wary", "yield"), "neutral");
    assert.equal(applyDeescalation("hostile", "smalltalk"), "hostile");
    assert.ok(DEESCALATION_VERBS.includes("comply"));
  });
});
