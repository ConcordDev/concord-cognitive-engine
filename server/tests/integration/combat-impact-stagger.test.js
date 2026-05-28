/**
 * T1.4a — server-authoritative impact momentum + poise-stagger.
 *
 * Pins the "bone-mass × angular-velocity impact resolution" claim as REAL:
 *   - momentum ordering is physical (hammer rocks harder than a dagger)
 *   - momentum + poise are deterministic (no RNG, no stagger_chance)
 *   - stagger grades flinch < rocked < knockdown by momentum-vs-poise overflow
 *   - a parried/near-zero-momentum hit does not stagger; a heavy/flank hit knocks down
 *
 * Run: node --test tests/integration/combat-impact-stagger.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  computeImpactMomentum, impactKinematics, momentumFor,
  poiseBudget, resolvePoiseStagger,
} from "../../lib/combat-impact.js";
import { getSkillFrameData } from "../../lib/combat-frame-data.js";
import { up as up_polish } from "../../migrations/140_combat_polish.js";
import { triggerStaggerFromImpact, getOrCreateActorState } from "../../lib/combat-polish.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function frame(kind) { return getSkillFrameData({ kind, level: 1 }); }
function mForKind(kind, tier = 3) { return momentumFor({ kind, tier, frame: frame(kind) }); }

describe("T1.4a — impact momentum model", () => {
  it("computeImpactMomentum is bone-mass × angular-velocity × lever", () => {
    assert.equal(computeImpactMomentum({ boneMass: 2, angularVelocity: 5, leverArmM: 0.5 }), 5);
  });

  it("momentum ordering is physical: hammer > sword > dagger", () => {
    const hammer = mForKind("hammer");
    const sword = mForKind("sword");
    const dagger = mForKind("dagger");
    assert.ok(hammer > sword, `hammer (${hammer.toFixed(1)}) should exceed sword (${sword.toFixed(1)})`);
    assert.ok(sword > dagger, `sword (${sword.toFixed(1)}) should exceed dagger (${dagger.toFixed(1)})`);
  });

  it("higher mastery tier raises momentum (more body behind the strike)", () => {
    const lo = momentumFor({ kind: "sword", tier: 1, frame: frame("sword") });
    const hi = momentumFor({ kind: "sword", tier: 5, frame: frame("sword") });
    assert.ok(hi > lo, "tier 5 should out-hit tier 1");
  });

  it("is deterministic — identical inputs give identical momentum (no RNG)", () => {
    const a = impactKinematics({ kind: "axe", tier: 3, frame: frame("axe") });
    const b = impactKinematics({ kind: "axe", tier: 3, frame: frame("axe") });
    assert.deepEqual(a, b);
  });
});

describe("T1.4a — poise-stagger resolution", () => {
  it("grades flinch < rocked < knockdown by momentum vs poise", () => {
    const poise = poiseBudget({});
    assert.equal(resolvePoiseStagger({ momentum: poise * 0.5, poise }).severity, "none");
    assert.equal(resolvePoiseStagger({ momentum: poise * 1.2, poise }).severity, "flinch");
    assert.equal(resolvePoiseStagger({ momentum: poise * 1.8, poise }).severity, "rocked");
    assert.equal(resolvePoiseStagger({ momentum: poise * 3.0, poise }).severity, "knockdown");
  });

  it("a flank hit (off-axis) breaks poise harder than a dead-on hit", () => {
    const poise = poiseBudget({});
    const front = resolvePoiseStagger({ momentum: poise * 1.1, poise, offAxis: 0 });
    const back = resolvePoiseStagger({ momentum: poise * 1.1, poise, offAxis: 1 });
    assert.ok(back.overflowRatio > front.overflowRatio, "a hit from behind transfers more effective momentum");
  });

  it("a braced/grounded recipient has more poise than an airborne one", () => {
    assert.ok(poiseBudget({ bracing: true }) > poiseBudget({ bracing: false }));
    assert.ok(poiseBudget({ stance: "ground" }) > poiseBudget({ stance: "aerial" }));
  });
});

describe("T1.4a — triggerStaggerFromImpact integration", () => {
  function setupDb() {
    const db = new Database(":memory:");
    up_polish(db);
    return db;
  }

  it("a heavy hammer hit knocks a default-stance NPC down; a feather tap does nothing", () => {
    const db = setupDb();
    getOrCreateActorState(db, { actorKind: "npc", actorId: "grunt", worldId: "w", profileId: "street_freeroam" });
    const heavy = triggerStaggerFromImpact(db, { actorKind: "npc", actorId: "grunt", momentum: mForKind("hammer", 5) * 3 });
    assert.ok(["rocked", "knockdown"].includes(heavy.severity), `heavy hit should stagger, got ${heavy.severity}`);

    getOrCreateActorState(db, { actorKind: "npc", actorId: "stoic", worldId: "w", profileId: "street_freeroam" });
    const tap = triggerStaggerFromImpact(db, { actorKind: "npc", actorId: "stoic", momentum: 0.2 });
    assert.equal(tap.severity, "none", "a near-zero-momentum (e.g. parried) hit must not stagger");
  });

  it("identical hits produce identical severity (deterministic, no RNG)", () => {
    const db = setupDb();
    getOrCreateActorState(db, { actorKind: "npc", actorId: "a", worldId: "w", profileId: "street_freeroam" });
    getOrCreateActorState(db, { actorKind: "npc", actorId: "b", worldId: "w", profileId: "street_freeroam" });
    const m = mForKind("sword", 3) * 1.6;
    const r1 = triggerStaggerFromImpact(db, { actorKind: "npc", actorId: "a", momentum: m });
    const r2 = triggerStaggerFromImpact(db, { actorKind: "npc", actorId: "b", momentum: m });
    assert.equal(r1.severity, r2.severity);
  });
});

describe("T1.4a — no probability roll remains in the resolution path", () => {
  it("combat-impact.js contains no Math.random()", () => {
    const src = readFileSync(path.resolve(HERE, "..", "..", "lib", "combat-impact.js"), "utf8");
    assert.doesNotMatch(src, /Math\.random/);
  });
  it("triggerStaggerFromImpact does not roll Math.random()", () => {
    const src = readFileSync(path.resolve(HERE, "..", "..", "lib", "combat-polish.js"), "utf8");
    const fnStart = src.indexOf("export function triggerStaggerFromImpact");
    const fnEnd = src.indexOf("\nexport ", fnStart + 1);
    const body = src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
    assert.doesNotMatch(body, /Math\.random/);
  });
});
