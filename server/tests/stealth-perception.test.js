/**
 * Stealth + perception fairness test.
 *
 * Verifies the opacity curve is asymmetric and skill-driven, plus the
 * backstab gate fails when victim's perception is meaningfully higher
 * than attacker's stealth.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeVisibility,
  MIN_OPACITY,
  MAX_OPACITY,
  BACKSTAB_PERCEPTION_MARGIN,
} from "../lib/stealth-perception.js";

describe("computeVisibility — basic skill matchup", () => {
  it("low perception sees a high-stealth target as nearly invisible", () => {
    const o = computeVisibility({
      targetStealthSkill: 200,
      observerPerceptionSkill: 0,
      distance: 5,
    });
    assert.ok(o < 0.4, `low perception should see a master rogue near floor; got ${o}`);
    assert.ok(o >= MIN_OPACITY);
  });

  it("high perception sees a high-stealth target clearly", () => {
    const o = computeVisibility({
      targetStealthSkill: 200,
      observerPerceptionSkill: 200,
      distance: 5,
    });
    assert.ok(o > 0.7, `high perception should see master rogue clearly; got ${o}`);
  });

  it("equal-skill matchup sits in the middle", () => {
    const o = computeVisibility({
      targetStealthSkill: 100,
      observerPerceptionSkill: 100,
      distance: 5,
    });
    assert.ok(o > 0.5 && o < 0.95, `expected mid-range opacity; got ${o}`);
  });

  it("never returns 0 — silhouette always visible", () => {
    const o = computeVisibility({
      targetStealthSkill: 200,
      observerPerceptionSkill: 0,
      distance: 100,
      isCrouching: true,
      hasCover: true,
      lighting: 0,
    });
    assert.ok(o >= MIN_OPACITY, `should be at least MIN_OPACITY (${MIN_OPACITY}); got ${o}`);
  });

  it("never returns above 1.0", () => {
    const o = computeVisibility({
      targetStealthSkill: 0,
      observerPerceptionSkill: 200,
      distance: 1,
      isCrouching: false,
      hasCover: false,
      lighting: 1.0,
    });
    assert.ok(o <= MAX_OPACITY);
  });
});

describe("computeVisibility — environmental modifiers", () => {
  it("crouch lowers opacity vs same matchup standing", () => {
    const standing = computeVisibility({
      targetStealthSkill: 100,
      observerPerceptionSkill: 100,
      distance: 5,
      isCrouching: false,
    });
    const crouching = computeVisibility({
      targetStealthSkill: 100,
      observerPerceptionSkill: 100,
      distance: 5,
      isCrouching: true,
    });
    assert.ok(crouching < standing, `crouch (${crouching}) should < standing (${standing})`);
  });

  it("hard cover stacks with crouch", () => {
    const open = computeVisibility({
      targetStealthSkill: 100, observerPerceptionSkill: 100, distance: 5,
    });
    const concealed = computeVisibility({
      targetStealthSkill: 100, observerPerceptionSkill: 100, distance: 5,
      isCrouching: true, hasCover: true,
    });
    assert.ok(concealed < open * 0.6);
  });

  it("distance > 30m further reduces visibility", () => {
    const close = computeVisibility({
      targetStealthSkill: 100, observerPerceptionSkill: 100, distance: 5,
    });
    const far = computeVisibility({
      targetStealthSkill: 100, observerPerceptionSkill: 100, distance: 60,
    });
    assert.ok(far < close, `far (${far}) should < close (${close})`);
  });

  it("lighting=0 (pitch dark) doesn't drive opacity below the floor", () => {
    const dark = computeVisibility({
      targetStealthSkill: 0, observerPerceptionSkill: 200, distance: 5,
      lighting: 0,
    });
    const bright = computeVisibility({
      targetStealthSkill: 0, observerPerceptionSkill: 200, distance: 5,
      lighting: 1,
    });
    assert.ok(dark < bright);
    assert.ok(dark > 0.2, `night-vision floor should keep opacity above 0.2; got ${dark}`);
  });
});

describe("computeVisibility — fairness asymmetry", () => {
  it("training observation dramatically improves detection", () => {
    const untrained = computeVisibility({
      targetStealthSkill: 150, observerPerceptionSkill: 0,
    });
    const novice = computeVisibility({
      targetStealthSkill: 150, observerPerceptionSkill: 50,
    });
    const trained = computeVisibility({
      targetStealthSkill: 150, observerPerceptionSkill: 100,
    });
    const expert = computeVisibility({
      targetStealthSkill: 150, observerPerceptionSkill: 200,
    });
    assert.ok(untrained < novice);
    assert.ok(novice < trained);
    assert.ok(trained < expert);
    // The progression should be monotone increasing — more training
    // means more visibility on the same target.
  });
});

describe("backstab perception margin constant", () => {
  it("BACKSTAB_PERCEPTION_MARGIN is a sane value", () => {
    assert.ok(BACKSTAB_PERCEPTION_MARGIN > 0);
    assert.ok(BACKSTAB_PERCEPTION_MARGIN < 100);
  });
});

// "step zero" fix — assertCanBackstab now reads skills from the authoritative
// player_skill_levels table. The prior query hit dtus (owner_user_id/type/tags_json)
// which skill rows aren't keyed by, so it silently returned 0 for everyone.
describe("assertCanBackstab reads real skill levels (player_skill_levels)", () => {
  let Database, runMigrations, assertCanBackstab;
  const mkDb = async () => {
    ({ default: Database } = await import("better-sqlite3"));
    ({ runMigrations } = await import("../migrate.js"));
    ({ assertCanBackstab } = await import("../lib/stealth-perception.js"));
    const d = new Database(":memory:");
    d.pragma("foreign_keys=OFF");
    await runMigrations(d);
    return d;
  };
  const addSkill = (d, user, type, level) =>
    d.prepare(`INSERT INTO player_skill_levels (id,user_id,skill_type,native_world_type,level,xp,xp_to_next)
               VALUES (?,?,?,?,?,0,100)`).run(`${user}_${type}`, user, type, "concordia-hub", level);

  it("a high-perception victim breaks the backstab", async () => {
    const d = await mkDb();
    addSkill(d, "attacker", "stealth", 50);
    addSkill(d, "victim", "perception", 90);
    const r = assertCanBackstab(d, "attacker", "victim");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "perception_breaks_stealth");
    assert.equal(r.attackerStealth, 50);
    assert.equal(r.victimPerception, 90);
  });

  it("an oblivious victim allows the backstab", async () => {
    const d = await mkDb();
    addSkill(d, "attacker", "stealth", 50);
    const r = assertCanBackstab(d, "attacker", "nobody");
    assert.equal(r.ok, true);
    assert.equal(r.victimPerception, 0);
  });

  it("observation OR perception — whichever is higher — gates it", async () => {
    const d = await mkDb();
    addSkill(d, "attacker", "stealth", 50);
    addSkill(d, "victim", "observation", 80);
    const r = assertCanBackstab(d, "attacker", "victim");
    assert.equal(r.ok, false);
    assert.equal(r.victimPerception, 80);
  });
});
