/**
 * Tier-2 contract tests for Foundry Phase 7 — the four net-new systems.
 *
 * The substrate audit flagged Size Scaling, Status Window, per-player
 * Skill Affinity, and Isekai Reincarnation as listed-in-spec but
 * absent from the codebase. Phase 7 builds them as real substrate;
 * this pins:
 *   - size-scaling: clamp, effect bands, scaled combat profile, state
 *     round-trip
 *   - skill-affinity: per-use growth, idle decay, effective combine
 *   - status-window: idempotent titles, world-adaptive composition
 *   - reincarnation: inheritance math, life ledger
 *   - the size.* / skill_affinity.* / status.* / reincarnation.*
 *     macros against an in-memory DB (migration 192 + a worlds row
 *     carrying the per-world config)
 *   - the registry: every stub flipped to 'available'
 *
 * Run: node --test server/tests/foundry-phase7-systems.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  clampScale, scaleEffects, scaledCombatProfile, setPlayerScale, getPlayerScale,
} from "../lib/foundry/size-scaling.js";
import {
  recordSkillUse, getPlayerAffinity, effectiveAffinity, SKILL_AFFINITY_INTERNALS,
} from "../lib/foundry/skill-affinity.js";
import {
  awardTitle, listTitles, composeStatusWindow,
} from "../lib/foundry/status-window.js";
import {
  computeInheritance, reincarnate, getLives,
} from "../lib/foundry/reincarnation.js";
import { SYSTEM_REGISTRY } from "../lib/foundry/system-registry.js";
import { up as migrate192 } from "../migrations/192_foundry_phase7.js";
import registerFoundrySystemsMacros from "../domains/foundry-systems.js";

// ── size-scaling.js ─────────────────────────────────────────────────────────

describe("size-scaling", () => {
  it("clamps a requested scale into the world's bounds", () => {
    assert.equal(clampScale(9999, { minScale: 15, maxScale: 800 }), 800);
    assert.equal(clampScale(1, { minScale: 15, maxScale: 800 }), 15);
    assert.equal(clampScale(100, {}), 100);
  });

  it("derives small / normal / large effect bands", () => {
    const small = scaleEffects(20, { smallGrantsFlight: true });
    assert.equal(small.band, "small");
    assert.equal(small.canFly, true);
    assert.ok(small.stealthBonus > 0);

    const large = scaleEffects(400, { largeGrantsDestruction: true });
    assert.equal(large.band, "large");
    assert.equal(large.canDestroy, true);
    assert.ok(large.reachBonus > 0);

    assert.equal(scaleEffects(100, {}).band, "normal");
  });

  it("scaledCombatProfile: small = precision, large = aoe", () => {
    assert.equal(scaledCombatProfile(20, {}).model, "precision");
    assert.equal(scaledCombatProfile(400, {}).model, "aoe");
    assert.ok(scaledCombatProfile(400, {}).damageMult > 1);
    assert.equal(scaledCombatProfile(100, {}).model, "balanced");
  });

  it("setPlayerScale / getPlayerScale round-trip + clamp on write", () => {
    const db = new Database(":memory:");
    migrate192(db);
    const r = setPlayerScale(db, "u1", "w1", 9999, { maxScale: 800 });
    assert.equal(r.ok, true);
    assert.equal(r.scale, 800);
    assert.equal(getPlayerScale(db, "u1", "w1"), 800);
    assert.equal(getPlayerScale(db, "u1", "never-set"), 100); // default
  });
});

// ── skill-affinity.js ───────────────────────────────────────────────────────

describe("skill-affinity", () => {
  it("recordSkillUse grows personal affinity per use", () => {
    const db = new Database(":memory:");
    migrate192(db);
    const a1 = recordSkillUse(db, "u1", "frost-bolt", {});
    const a2 = recordSkillUse(db, "u1", "frost-bolt", {});
    assert.ok(a2.affinity > a1.affinity, "affinity should grow");
    assert.equal(a2.uses, 2);
  });

  it("getPlayerAffinity returns 1.0 for an unused skill, applies idle decay", () => {
    const db = new Database(":memory:");
    migrate192(db);
    assert.equal(getPlayerAffinity(db, "u1", "never-used", {}), 1.0);
    recordSkillUse(db, "u1", "fireball", {});
    const fresh = getPlayerAffinity(db, "u1", "fireball", {});
    // 30 days later, with decayWhenUnused on, it should be lower.
    const later = getPlayerAffinity(db, "u1", "fireball", { decayWhenUnused: true }, Date.now() + 30 * 24 * 3600 * 1000);
    assert.ok(later < fresh, "idle decay should reduce affinity");
    assert.ok(later >= SKILL_AFFINITY_INTERNALS.MIN_AFFINITY, "decay floors at MIN_AFFINITY");
  });

  it("effectiveAffinity is player x world", () => {
    assert.equal(effectiveAffinity(1.5, 150), 2.25);
    assert.equal(effectiveAffinity(1.0, 100), 1.0);
    assert.equal(effectiveAffinity(2.0, 50), 1.0);
  });
});

// ── status-window.js ────────────────────────────────────────────────────────

describe("status-window", () => {
  it("awardTitle is idempotent; listTitles reads them back", () => {
    const db = new Database(":memory:");
    migrate192(db);
    const first = awardTitle(db, "u1", "w1", "Dragonslayer");
    assert.equal(first.awarded, true);
    const again = awardTitle(db, "u1", "w1", "Dragonslayer");
    assert.equal(again.awarded, false); // already had it
    awardTitle(db, "u1", "w1", "Realm Founder");
    assert.equal(listTitles(db, "u1", "w1").length, 2);
  });

  it("composeStatusWindow assembles a world-adaptive panel", () => {
    const db = new Database(":memory:");
    migrate192(db);
    awardTitle(db, "u1", "w1", "Champion");
    const r = composeStatusWindow(db, "u1", "w1", { style: "sci-fi-hud", showHiddenStats: true }, {
      stats: { hp: 100 }, skills: [{ id: "x", level: 3 }], hiddenStats: { luck: 7 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.window.style, "sci-fi-hud");
    assert.equal(r.window.activeTitle, "Champion");
    assert.equal(r.window.stats.hp, 100);
    assert.equal(r.window.hiddenStats.luck, 7); // surfaced because showHiddenStats
  });

  it("composeStatusWindow hides hidden stats by default + coerces a bad style", () => {
    const db = new Database(":memory:");
    migrate192(db);
    const r = composeStatusWindow(db, "u1", "w1", { style: "banana" }, { hiddenStats: { luck: 7 } });
    assert.equal(r.window.style, "classic-rpg"); // coerced
    assert.ok(!("hiddenStats" in r.window));
  });
});

// ── reincarnation.js ────────────────────────────────────────────────────────

describe("reincarnation", () => {
  it("computeInheritance carries a fraction of numeric progress", () => {
    const inh = computeInheritance({ xp: 1000, level: 10, currency: 500 }, { inheritedFraction: 20 });
    assert.equal(inh.fraction, 0.2);
    assert.equal(inh.inherited.xp, 200);
    assert.equal(inh.inherited.level, 2); // floored
    assert.equal(inh.inherited.currency, 100);
  });

  it("reincarnate writes a life ledger; getLives reads it newest-first", () => {
    const db = new Database(":memory:");
    migrate192(db);
    const r1 = reincarnate(db, "u1", "w1", { xp: 1000, level: 8 }, { inheritedFraction: 25 });
    assert.equal(r1.ok, true);
    assert.equal(r1.lifeNumber, 2); // life 1 was the original
    const r2 = reincarnate(db, "u1", "w1", { xp: 400 }, { inheritedFraction: 25 });
    assert.equal(r2.lifeNumber, 3);
    const lives = getLives(db, "u1", "w1");
    assert.equal(lives.length, 2);
    assert.equal(lives[0].lifeNumber, 3); // newest first
  });

  it("reincarnate respects the disabled flag", () => {
    const db = new Database(":memory:");
    migrate192(db);
    const r = reincarnate(db, "u1", "w1", {}, { enabled: false });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "reincarnation_disabled");
  });
});

// ── macros ──────────────────────────────────────────────────────────────────

function makeHarness() {
  const db = new Database(":memory:");
  migrate192(db);
  db.exec(`CREATE TABLE worlds (id TEXT PRIMARY KEY, rule_modulators TEXT DEFAULT '{}')`);
  // A world that enables size-scaling + reincarnation with config.
  db.prepare(`INSERT INTO worlds (id, rule_modulators) VALUES (?, ?)`).run(
    "w-foundry",
    JSON.stringify({
      size_scaling: { minScale: 10, maxScale: 500, smallGrantsFlight: true },
      reincarnation: { inheritedFraction: 30, enabled: true },
      status_window: { style: "ornate", titleSystem: true },
    }),
  );
  const macros = new Map();
  registerFoundrySystemsMacros((domain, name, handler) => macros.set(`${domain}.${name}`, handler));
  const call = (name, input, actor = { userId: "user-1" }) =>
    macros.get(name)({ db, actor }, input || {});
  return { db, call };
}

describe("foundry-systems macros", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("size.set / size.get use the world's config", () => {
    const set = h.call("size.set", { worldId: "w-foundry", scale: 9999 });
    assert.equal(set.ok, true);
    assert.equal(set.scale, 500); // clamped to the world's maxScale
    const get = h.call("size.get", { worldId: "w-foundry" });
    assert.equal(get.scale, 500);
    assert.equal(get.effects.band, "large");
  });

  it("size.combat_profile reflects the player's current scale", () => {
    h.call("size.set", { worldId: "w-foundry", scale: 15 });
    const cp = h.call("size.combat_profile", { worldId: "w-foundry" });
    assert.equal(cp.ok, true);
    assert.equal(cp.profile.band, "small");
  });

  it("skill_affinity.record + get", () => {
    h.call("skill_affinity.record", { skillId: "ice-shard" });
    h.call("skill_affinity.record", { skillId: "ice-shard" });
    const g = h.call("skill_affinity.get", { skillId: "ice-shard", worldAffinityPct: 150 });
    assert.equal(g.ok, true);
    assert.ok(g.playerAffinity > 1.0);
    assert.ok(g.effective > g.playerAffinity); // world 150% amplifies
  });

  it("status.award_title / status.titles / status.window", () => {
    h.call("status.award_title", { worldId: "w-foundry", title: "Worldsmith" });
    assert.equal(h.call("status.titles", { worldId: "w-foundry" }).titles.length, 1);
    const w = h.call("status.window", { worldId: "w-foundry" });
    assert.equal(w.ok, true);
    assert.equal(w.window.style, "ornate");
    assert.equal(w.window.activeTitle, "Worldsmith");
  });

  it("reincarnation.reincarnate / lives use the world's config", () => {
    const r = h.call("reincarnation.reincarnate", { worldId: "w-foundry", priorState: { xp: 1000, level: 10 } });
    assert.equal(r.ok, true);
    assert.equal(r.lifeNumber, 2);
    assert.equal(r.inherited.xp, 300); // 30% per the world config
    assert.equal(h.call("reincarnation.lives", { worldId: "w-foundry" }).lives.length, 1);
  });

  it("macros require an actor + a world id", () => {
    assert.equal(h.call("size.get", { worldId: "w-foundry" }, {}).reason, "no_actor");
    assert.equal(h.call("size.get", {}).reason, "missing_world_id");
  });
});

// ── registry: no stubs remain ───────────────────────────────────────────────

describe("registry after Phase 7", () => {
  it("every system is now 'available' — no stubs", () => {
    const stubs = SYSTEM_REGISTRY.filter((s) => s.status === "stub").map((s) => s.id);
    assert.deepEqual(stubs, [], `still stubbed: ${stubs.join(", ")}`);
  });
});
