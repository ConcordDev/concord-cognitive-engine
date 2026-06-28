// Behavioral macro tests for server/domains/sandbox.js — the Combat Sandbox
// feel-tuning persistence substrate (weapon/skill loadouts, dummy behavior
// presets, combat replays, frame-time/hitstop telemetry).
//
// LIGHTWEIGHT + HERMETIC: drives each macro the way runMacro would — a
// (ctx, input) call — against the REAL in-memory globalThis._concordSTATE.
// sandboxLens store the domain uses for persistence. No server boot, no DB, no
// network/LLM. These are NOT shape-only assertions: every test asserts ACTUAL
// computed values + multi-step round-trips, per-user isolation, the bounded
// store cap, the derived telemetry math, and the fail-CLOSED numeric guard the
// macro-assassin's V2 vector probes.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSandboxMacros from "../domains/sandbox.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "sandbox", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`sandbox.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerSandboxMacros(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("sandbox — registration", () => {
  it("registers every macro the lens calls", () => {
    for (const m of [
      "catalog",
      "saveLoadout", "listLoadouts", "deleteLoadout",
      "saveDummyConfig", "listDummyConfigs", "deleteDummyConfig",
      "saveReplay", "listReplays", "getReplay", "deleteReplay",
      "recordTelemetry", "telemetryStats", "deleteTelemetry",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing sandbox.${m}`);
    }
  });
});

describe("sandbox — catalog is the fixed engine vocabulary", () => {
  it("returns weapons, skills, and behaviors with real fields", () => {
    const r = call("catalog", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.weapons.length >= 5);
    assert.ok(r.result.skills.length >= 5);
    assert.equal(r.result.behaviors.length, 4);
    const fist = r.result.weapons.find((w) => w.id === "fist");
    assert.equal(fist.baseLight, 8);
    assert.equal(fist.baseHeavy, 16);
    const behaviorIds = r.result.behaviors.map((b) => b.id).sort();
    assert.deepEqual(behaviorIds, ["aggressive", "defensive", "idle", "static"]);
  });
});

describe("sandbox — loadout lifecycle round-trip (save → list → delete)", () => {
  it("saves a loadout, lists it newest-first, then deletes it", () => {
    const saved = call("saveLoadout", ctxA, {
      weaponId: "blade", skillId: "ember-arc", lightDamage: 20, heavyDamage: 40, name: "Sword build",
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.loadout.weaponId, "blade");
    assert.equal(saved.result.loadout.skillId, "ember-arc");
    assert.equal(saved.result.loadout.lightDamage, 20);
    assert.equal(saved.result.loadout.heavyDamage, 40);
    assert.equal(saved.result.loadout.name, "Sword build");
    assert.equal(saved.result.total, 1);
    const id = saved.result.loadout.id;

    // a second loadout — list returns newest first
    call("saveLoadout", ctxA, { weaponId: "fist", name: "Punch" });
    const listed = call("listLoadouts", ctxA, {});
    assert.equal(listed.result.count, 2);
    assert.equal(listed.result.loadouts[0].name, "Punch", "newest first");
    assert.equal(listed.result.loadouts[1].name, "Sword build");

    // default name + default damage from the weapon catalog when omitted
    const def = call("saveLoadout", ctxA, { weaponId: "greataxe" });
    assert.equal(def.result.loadout.name, "Greataxe loadout");
    assert.equal(def.result.loadout.lightDamage, 16, "defaults to weapon baseLight");
    assert.equal(def.result.loadout.heavyDamage, 40, "defaults to weapon baseHeavy");

    // delete the first one
    const del = call("deleteLoadout", ctxA, { loadoutId: id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    assert.equal(del.result.count, 2);
    assert.equal(call("deleteLoadout", ctxA, { loadoutId: id }).error, "loadout_not_found");
  });

  it("rejects an unknown weapon or skill", () => {
    assert.equal(call("saveLoadout", ctxA, { weaponId: "nope" }).error, "unknown_weaponId");
    assert.equal(call("saveLoadout", ctxA, { weaponId: "fist", skillId: "nope" }).error, "unknown_skillId");
  });

  it("clamps out-of-range (but finite) damage into [1,500]", () => {
    const r = call("saveLoadout", ctxA, { weaponId: "fist", lightDamage: 99999, heavyDamage: 0.2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.loadout.lightDamage, 500);
    assert.equal(r.result.loadout.heavyDamage, 1);
  });
});

describe("sandbox — dummy config lifecycle", () => {
  it("saves a dummy preset with rounded clamped hp/count", () => {
    const r = call("saveDummyConfig", ctxA, { behaviorId: "aggressive", hp: 250.7, count: 99, name: "Brawlers" });
    assert.equal(r.ok, true);
    assert.equal(r.result.dummyConfig.behaviorId, "aggressive");
    assert.equal(r.result.dummyConfig.hp, 251, "hp rounded");
    assert.equal(r.result.dummyConfig.count, 10, "count clamped to max 10");
    assert.equal(r.result.dummyConfig.name, "Brawlers");

    const listed = call("listDummyConfigs", ctxA, {});
    assert.equal(listed.result.count, 1);

    const del = call("deleteDummyConfig", ctxA, { configId: r.result.dummyConfig.id });
    assert.equal(del.result.deleted, r.result.dummyConfig.id);
    assert.equal(call("deleteDummyConfig", ctxA, { configId: "x" }).error, "dummy_config_not_found");
  });

  it("rejects an unknown behavior", () => {
    assert.equal(call("saveDummyConfig", ctxA, { behaviorId: "nope" }).error, "unknown_behaviorId");
  });
});

describe("sandbox — replay recorder computes real aggregates", () => {
  it("normalises frames and derives durationMs / totalDamage / hitCount", () => {
    const frames = [
      { t: 0, kind: "hit", targetId: "dummy_0", damage: 10, isCrit: false },
      { t: 250, kind: "hit", targetId: "dummy_0", damage: 22, isCrit: true, heavy: true },
      { t: 800, kind: "miss", targetId: "dummy_1", damage: 0 },
    ];
    const r = call("saveReplay", ctxA, { frames, name: "Combo A" });
    assert.equal(r.ok, true);
    // the summary returned omits frames (fetched on demand via getReplay)
    assert.equal(r.result.replay.frames, undefined);
    assert.equal(r.result.frameCount, 3);
    assert.equal(r.result.replay.durationMs, 800, "max t");
    assert.equal(r.result.replay.totalDamage, 32, "10 + 22");
    assert.equal(r.result.replay.hitCount, 2, "two 'hit' kinds");

    const id = r.result.replay.id;
    const full = call("getReplay", ctxA, { replayId: id });
    assert.equal(full.ok, true);
    assert.equal(full.result.replay.frames.length, 3);
    assert.equal(full.result.replay.frames[1].seq, 1, "frames are re-sequenced");

    const list = call("listReplays", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.replays[0].frameCount, 3);
    assert.equal(list.result.replays[0].frames, undefined, "list returns summaries only");

    call("deleteReplay", ctxA, { replayId: id });
    assert.equal(call("getReplay", ctxA, { replayId: id }).error, "replay_not_found");
  });

  it("rejects an empty replay", () => {
    assert.equal(call("saveReplay", ctxA, { frames: [] }).error, "replay_has_no_frames");
    assert.equal(call("saveReplay", ctxA, {}).error, "replay_has_no_frames");
  });

  it("bounds the per-user replay store at 50", () => {
    for (let i = 0; i < 55; i++) call("saveReplay", ctxA, { frames: [{ t: i, damage: 1 }] });
    assert.equal(call("listReplays", ctxA, {}).result.count, 50);
  });
});

describe("sandbox — telemetry math + aggregation", () => {
  it("computes avgFps / p95 / jankFrames from real frame samples", () => {
    // 4 frames at 16.67ms (~60fps) and one slow 40ms frame (25fps → jank).
    const frameTimes = [16.67, 16.67, 16.67, 16.67, 40];
    const r = call("recordTelemetry", ctxA, { frameTimes, hitstops: [80, 120], name: "Session 1" });
    assert.equal(r.ok, true);
    const s = r.result.sample;
    assert.equal(s.frameCount, 5);
    assert.equal(s.maxFrameMs, 40);
    assert.equal(s.minFrameMs, 16.67);
    assert.equal(s.jankFrames, 1, "one frame slower than 50fps (>20ms)");
    assert.equal(s.hitstopCount, 2);
    assert.equal(s.avgHitstopMs, 100, "(80+120)/2");
    assert.equal(s.maxHitstopMs, 120);
    // avg = (16.67*4 + 40)/5 = 21.336 → avgFps = round(1000/21.336*10)/10
    assert.ok(Math.abs(s.avgFrameMs - 21.34) < 0.01);
    assert.ok(s.avgFps > 46 && s.avgFps < 47);

    const stats = call("telemetryStats", ctxA, {});
    assert.equal(stats.result.count, 1);
    assert.equal(stats.result.overall.sessions, 1);
    assert.equal(stats.result.overall.totalJankFrames, 1);

    call("deleteTelemetry", ctxA, { sampleId: s.id });
    assert.equal(call("telemetryStats", ctxA, {}).result.count, 0);
    assert.equal(call("telemetryStats", ctxA, {}).result.overall, null);
    assert.equal(call("deleteTelemetry", ctxA, { sampleId: "x" }).error, "telemetry_sample_not_found");
  });

  it("rejects telemetry with no valid frame samples", () => {
    assert.equal(call("recordTelemetry", ctxA, { frameTimes: [] }).error, "no_frame_samples");
    // all-invalid samples filter out to empty → rejected
    assert.equal(call("recordTelemetry", ctxA, { frameTimes: [NaN, -1, 0, Infinity] }).error, "no_frame_samples");
  });
});

describe("sandbox — per-user isolation", () => {
  it("never leaks one user's loadouts / configs / replays / telemetry to another", () => {
    call("saveLoadout", ctxA, { weaponId: "fist", name: "A-only" });
    call("saveDummyConfig", ctxA, { behaviorId: "static" });
    call("saveReplay", ctxA, { frames: [{ t: 1, damage: 5 }] });
    call("recordTelemetry", ctxA, { frameTimes: [16.6] });

    assert.equal(call("listLoadouts", ctxA, {}).result.count, 1);
    assert.equal(call("listLoadouts", ctxB, {}).result.count, 0);
    assert.equal(call("listDummyConfigs", ctxB, {}).result.count, 0);
    assert.equal(call("listReplays", ctxB, {}).result.count, 0);
    assert.equal(call("telemetryStats", ctxB, {}).result.count, 0);
  });
});

describe("sandbox — fail-CLOSED numeric guard (assassin V2)", () => {
  it("rejects poisoned numeric inputs instead of clamping to ok:true", () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const ld = call("saveLoadout", ctxA, { weaponId: "fist", lightDamage: bad });
      assert.equal(ld.ok, false, `lightDamage=${bad} should fail-closed`);
      assert.equal(ld.error, "invalid_lightDamage");

      const ld2 = call("saveLoadout", ctxA, { weaponId: "fist", heavyDamage: bad });
      assert.equal(ld2.error, "invalid_heavyDamage");

      const dc = call("saveDummyConfig", ctxA, { behaviorId: "static", hp: bad });
      assert.equal(dc.ok, false, `hp=${bad} should fail-closed`);
      assert.equal(dc.error, "invalid_hp");

      const dc2 = call("saveDummyConfig", ctxA, { behaviorId: "static", count: bad });
      assert.equal(dc2.error, "invalid_count");
    }
    // a valid finite value still goes through
    assert.equal(call("saveLoadout", ctxA, { weaponId: "fist", lightDamage: 25 }).ok, true);
  });
});
