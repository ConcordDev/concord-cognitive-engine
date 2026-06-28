// Training-room domain macros — behavioral test against a real migrated DB.
//
// Proves `server/domains/training-room.js` registers the `training-room.*`
// macros and that they uphold the contract overrides in
// content/contracts/overrides/training-room.*.json:
//   - frame_data resolves a persisted skill DTU AND a built-in weapon kind
//     (no_skill defect from PLAYTEST #21 is gone — default skills resolve)
//   - real frame values: startup/active/recovery > 0 for every skill,
//     parry_window_ms === 0 for bow/staff (ranged, by design),
//     parry_window_ms > 0 for melee
//   - level scaling is applied (higher level → faster startup) and caps
//   - the surface is honest: unknown id → { ok:false, reason:'no_skill' }
//
// The handlers delegate to lib/combat-frame-data.js (single source of truth);
// this test pins the macro envelope the /api/lens/run dispatch surface returns
// plus the underlying frame math.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerTrainingRoomMacros from "../domains/training-room.js";

function buildRegistry() {
  const MACROS = new Map();
  const register = (d, n, fn, spec) => {
    if (!MACROS.has(d)) MACROS.set(d, new Map());
    MACROS.get(d).set(n, { fn, spec });
  };
  registerTrainingRoomMacros(register);
  return {
    run: (name, ctx, input) => MACROS.get("training-room").get(name).fn(ctx, input ?? {}),
    names: [...MACROS.get("training-room").keys()],
  };
}

function seedUser(db, id) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at)
     VALUES (?, ?, ?, 'x', unixepoch())`,
  ).run(id, `u_${id}`, `${id}@example.test`);
}

// Insert a persisted skill DTU the way skill-progression writers do
// (type='skill', metadata in the `data` column, live level in skill_level).
function seedSkillDtu(db, id, userId, { title, kind, level = 1 }) {
  db.prepare(`
    INSERT INTO dtus (id, type, title, creator_id, owner_user_id, data, skill_level, created_at)
    VALUES (?, 'skill', ?, ?, ?, ?, ?, unixepoch())
  `).run(id, title, userId, userId, JSON.stringify({ kind }), level);
}

describe("training-room.* domain macros (real migrated DB)", () => {
  let db, reg;
  const u1 = { db: null, actor: { userId: "u1" } };

  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1");
    reg = buildRegistry();
    u1.db = db;
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("registers the full training-room macro surface", () => {
    assert.deepEqual(
      reg.names.sort(),
      ["frame_data", "kind_frame_data", "list_kinds", "list_skills"],
    );
  });

  it("frame_data resolves a built-in weapon kind with real melee frame values", async () => {
    const r = await reg.run("frame_data", u1, { skillId: "sword" });
    assert.equal(r.ok, true);
    const fd = r.frameData;
    // Real derived numbers, not placeholders.
    assert.ok(fd.startup_ms > 0, "startup > 0");
    assert.ok(fd.active_ms > 0, "active > 0");
    assert.ok(fd.recovery_ms > 0, "recovery > 0");
    assert.ok(fd.dodge_window_ms > 0, "dodge > 0");
    // Melee can parry.
    assert.ok(fd.parry_window_ms > 0, "sword parry window > 0");
    assert.equal(fd.kind, "sword");
  });

  it("bow and staff parry_window_ms === 0 by design (ranged can't parry)", async () => {
    for (const kind of ["bow", "staff"]) {
      const r = await reg.run("frame_data", u1, { skillId: kind });
      assert.equal(r.ok, true, `${kind} resolves`);
      assert.equal(r.frameData.parry_window_ms, 0, `${kind} parry window is 0`);
      // ...but the rest of the envelope is still real & positive.
      assert.ok(r.frameData.startup_ms > 0);
      assert.ok(r.frameData.active_ms > 0);
      assert.ok(r.frameData.recovery_ms > 0);
      assert.ok(r.frameData.dodge_window_ms > 0);
    }
  });

  it("frame_data resolves a persisted skill DTU and reads its real kind + level", async () => {
    seedSkillDtu(db, "skill_u1_blade", "u1", { title: "Blade", kind: "axe", level: 50 });
    const r = await reg.run("frame_data", u1, { skillId: "skill_u1_blade" });
    assert.equal(r.ok, true);
    assert.equal(r.frameData.kind, "axe");
    assert.equal(r.frameData.level, 50);
    assert.ok(r.frameData.parry_window_ms > 0, "axe is melee");
  });

  it("level scaling speeds up startup but is capped (never below 70% / never negative)", async () => {
    // Same kind, different levels — higher level resolves faster startup.
    seedSkillDtu(db, "skill_u1_lo", "u1", { title: "Lo", kind: "sword", level: 1 });
    seedSkillDtu(db, "skill_u1_hi", "u1", { title: "Hi", kind: "sword", level: 100 });
    seedSkillDtu(db, "skill_u1_max", "u1", { title: "Max", kind: "sword", level: 100000 });

    const lo = (await reg.run("frame_data", u1, { skillId: "skill_u1_lo" })).frameData;
    const hi = (await reg.run("frame_data", u1, { skillId: "skill_u1_hi" })).frameData;
    const max = (await reg.run("frame_data", u1, { skillId: "skill_u1_max" })).frameData;

    assert.ok(hi.startup_ms < lo.startup_ms, "level 100 startup faster than level 1");
    // Cap: factor floored at 0.7 → startup never below 70% of base (base 200ms → ≥140ms).
    assert.ok(max.startup_ms >= Math.round(200 * 0.7) - 1, "startup capped at the floor");
    assert.ok(max.startup_ms > 0, "startup never negative");
  });

  it("unknown id → honest { ok:false, reason:'no_skill' }, never fabricated frames", async () => {
    const r = await reg.run("frame_data", u1, { skillId: "__not_a_skill__" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_skill");
    assert.equal(r.frameData, undefined);
  });

  it("frame_data rejects a missing skillId", async () => {
    const r = await reg.run("frame_data", u1, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_skill_id");
  });

  it("kind_frame_data resolves built-ins and rejects unknown / 'default'", async () => {
    assert.equal((await reg.run("kind_frame_data", u1, { kind: "hammer" })).ok, true);
    assert.equal((await reg.run("kind_frame_data", u1, { kind: "default" })).ok, false);
    assert.equal((await reg.run("kind_frame_data", u1, { kind: "banana" })).reason, "unknown_kind");
  });

  it("list_kinds returns every built-in kind with a real positive frame envelope", async () => {
    const r = await reg.run("list_kinds", u1, {});
    assert.equal(r.ok, true);
    assert.ok(r.kinds.length >= 6);
    for (const k of r.kinds) {
      assert.ok(k.startup_ms > 0 && k.active_ms > 0 && k.recovery_ms > 0, `${k.kind} positive`);
      if (k.kind === "bow" || k.kind === "staff") assert.equal(k.parry_window_ms, 0);
      else assert.ok(k.parry_window_ms > 0, `${k.kind} melee parry`);
    }
  });

  it("list_skills returns the user's persisted skill DTUs, requires an actor", async () => {
    seedSkillDtu(db, "skill_u1_a", "u1", { title: "Aikido", kind: "fist", level: 3 });
    const ok = await reg.run("list_skills", u1, {});
    assert.equal(ok.ok, true);
    assert.ok(ok.skills.some((s) => s.id === "skill_u1_a"));

    const noActor = await reg.run("list_skills", { db }, {});
    assert.equal(noActor.ok, false);
    assert.equal(noActor.reason, "no_user");
  });
});
