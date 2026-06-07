// tests/depth/mounts-behavior.test.js — REAL behavioral tests for the mounts
// domain (register()/runMacro family, via the macroRuntime harness path).
//
// The mount care + evolution macros read/write player_companions, so each
// test seeds a real companion row through ctx.db (the live STATE.db handle the
// macros use), then drives the macro and asserts EXACT values derived from the
// source formulas:
//   - care deltas: server/lib/mount-care.js (FEED_LOYALTY_DELTA=+5,
//     GROOM_LOYALTY_DELTA=+6, REST_STAMINA_DELTA=+35, FEED_HUNGER_DELTA=-40,
//     loyalty/stamina clamp 0..100).
//   - evolution XP: server/lib/companions-mount-evo.js (RIDE_XP_PER_METER=0.01,
//     COMBAT_XP_PER_HIT=0.5, TIER_THRESHOLDS=[0,100,500,2000,10000]).
//   - gear fold: server/lib/mount-gear.js (no gear → clampMul(0)=1 → effective=base).
// Each literal runMacro("mounts","<macro>",…) is credited by the grader.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { macroRuntime } from "./_harness.js";

// Seed a player_companions row owned by ownerId, with the given mount_state
// (JSON) + loyalty. Returns the companion id.
function seedCompanion(db, ownerId, { loyalty = 50, mountState = null, creatureId = null } = {}) {
  const id = `mc-${randomUUID()}`;
  db.prepare(`
    INSERT INTO player_companions
      (id, owner_id, creature_id, name, loyalty, mount_eligible, mount_state, caught_at, last_action_at, world_id)
    VALUES (?, ?, ?, 'Test Mount', ?, 1, ?, unixepoch(), unixepoch(), 'concordia-hub')
  `).run(id, ownerId, creatureId || `cr-${id}`, loyalty, mountState ? JSON.stringify(mountState) : null);
  return id;
}

describe("mounts — care math (exact deltas from mount-care.js)", () => {
  let runMacro, ctx, db, owner;
  before(async () => {
    ({ runMacro, ctx } = await macroRuntime("mounts-care"));
    db = ctx.db;
    owner = ctx.actor.userId;
  });

  it("feed: hunger drops by FEED_HUNGER_DELTA, loyalty rises by FEED_LOYALTY_DELTA", async () => {
    const id = seedCompanion(db, owner, { loyalty: 50, mountState: { hunger: 80, stamina: 100 } });
    const r = await runMacro("mounts", "feed", { mountId: id }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.state.hunger, 40);   // clamp(80 + (-40)) = 40
    assert.equal(r.loyalty, 55);        // clamp(50 + 5) = 55
  });

  it("feed: a second feed within 5 min is rejected as too_soon", async () => {
    const id = seedCompanion(db, owner, { loyalty: 50, mountState: { hunger: 80 } });
    const first = await runMacro("mounts", "feed", { mountId: id }, ctx);
    assert.equal(first.ok, true);
    const second = await runMacro("mounts", "feed", { mountId: id }, ctx);
    assert.equal(second.ok, false);
    assert.equal(second.reason, "too_soon");
  });

  it("groom: loyalty rises by GROOM_LOYALTY_DELTA (+6)", async () => {
    const id = seedCompanion(db, owner, { loyalty: 50 });
    const r = await runMacro("mounts", "groom", { mountId: id }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.loyalty, 56);        // clamp(50 + 6) = 56
  });

  it("rest: stamina rises by REST_STAMINA_DELTA (+35), clamped at 100", async () => {
    const id = seedCompanion(db, owner, { mountState: { stamina: 50 } });
    const r = await runMacro("mounts", "rest", { mountId: id }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.state.stamina, 85);  // clamp(50 + 35) = 85
    // A second rest clamps at 100 (50+35+35=120 → 100).
    const r2 = await runMacro("mounts", "rest", { mountId: id }, ctx);
    assert.equal(r2.state.stamina, 100);
  });

  it("care_state: round-trips a fed mount's loyalty + reports rideable above the 30 threshold", async () => {
    const id = seedCompanion(db, owner, { loyalty: 50, mountState: { hunger: 80, stamina: 100 } });
    await runMacro("mounts", "feed", { mountId: id }, ctx);   // loyalty → 55
    const cs = await runMacro("mounts", "care_state", { mountId: id }, ctx);
    assert.equal(cs.ok, true);
    assert.equal(cs.loyalty, 55);       // persisted by feed, read back
    assert.equal(cs.rideable, true);    // 55 >= LOYALTY_RIDE_THRESHOLD (30)
    assert.equal(cs.state.hunger, 40);  // mount_state persisted by feed
  });
});

describe("mounts — evolution XP (exact curve from companions-mount-evo.js)", () => {
  let runMacro, ctx, db, owner;
  before(async () => {
    ({ runMacro, ctx } = await macroRuntime("mounts-evo"));
    db = ctx.db;
    owner = ctx.actor.userId;
  });

  it("gain_xp ride: 1000m → +10 gait XP (RIDE_XP_PER_METER=0.01), stays tier 0", async () => {
    const id = seedCompanion(db, owner);
    const r = await runMacro("mounts", "gain_xp", { mountId: id, kind: "ride", amount: 1000 }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.axis, "gait");
    assert.equal(r.after, 10);          // 1000 * 0.01
    assert.equal(r.tierAfter, 0);       // 10 < first threshold (100)
    assert.equal(r.leveledUp, false);
  });

  it("gain_xp combat: 300 hits → +150 combat XP crosses threshold 100 → tier 1 levelUp", async () => {
    const id = seedCompanion(db, owner);
    const r = await runMacro("mounts", "gain_xp", { mountId: id, kind: "combat", amount: 300 }, ctx);
    assert.equal(r.after, 150);         // 300 * 0.5
    assert.equal(r.tierAfter, 1);       // 150 >= TIER_THRESHOLDS[1] (100)
    assert.equal(r.leveledUp, true);
    // Round-trip: evolution_state reflects the persisted tier + nextThreshold.
    const ev = await runMacro("mounts", "evolution_state", { mountId: id }, ctx);
    assert.equal(ev.tier, 1);
    assert.equal(ev.nextThreshold, 500); // TIER_THRESHOLDS[2]
    assert.equal(ev.skill.combat, 150);
  });

  it("gain_xp: an invalid kind is rejected", async () => {
    const id = seedCompanion(db, owner);
    const r = await runMacro("mounts", "gain_xp", { mountId: id, kind: "telepathy", amount: 5 }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_kind");
  });

  it("gain_xp: a mount the caller does not own is rejected as not_owner", async () => {
    const id = seedCompanion(db, "someone-else");
    const r = await runMacro("mounts", "gain_xp", { mountId: id, kind: "ride", amount: 100 }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });
});

describe("mounts — gear stats + validation", () => {
  let runMacro, ctx, db, owner;
  before(async () => {
    ({ runMacro, ctx } = await macroRuntime("mounts-gear"));
    db = ctx.db;
    owner = ctx.actor.userId;
  });

  // Seed a mount_species + a world_npcs creature + an owned mount-eligible
  // companion. Returns { companionId, speciesId }.
  function seedMountWithSpecies({ baseSpeed = 8.0, baseStamina = 200.0, carry = 150.0 } = {}) {
    const speciesId = `sp-${randomUUID()}`;
    db.prepare(`
      INSERT INTO mount_species (species_id, display_name, size_class, base_speed_mps, base_stamina, carry_capacity_kg)
      VALUES (?, 'Test Steed', 'large', ?, ?, ?)
    `).run(speciesId, baseSpeed, baseStamina, carry);
    const creatureId = `npc-${randomUUID()}`;
    db.prepare(`
      INSERT INTO world_npcs (id, world_id, archetype, x, y, z, is_dead)
      VALUES (?, 'concordia-hub', ?, 0, 0, 0, 0)
    `).run(creatureId, `creature:${speciesId}`);
    const companionId = seedCompanion(db, owner, { creatureId });
    return { companionId, speciesId, creatureId };
  }

  // Mint a mount_gear DTU directly into `dtus` (the row equipGear reads).
  function seedGearDtu(meta) {
    const id = `mg-${randomUUID()}`;
    db.prepare(`
      INSERT INTO dtus (id, type, title, creator_id, data, skill_level, total_experience, created_at)
      VALUES (?, 'mount_gear', 'Test Gear', ?, ?, 1, 0, unixepoch())
    `).run(id, owner, JSON.stringify(meta));
    return id;
  }

  it("compute_stats: a bare mount's effective stats equal its species base (clampMul(0)=1)", async () => {
    const { companionId, speciesId } = seedMountWithSpecies({ baseSpeed: 8.0, carry: 150.0 });
    const r = await runMacro("mounts", "compute_stats", { mountId: companionId }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.speciesId, speciesId);
    assert.equal(r.base.speedMps, 8.0);
    assert.equal(r.effective.speedMps, 8.0);        // base × clampMul(0) = base × 1
    assert.equal(r.effective.carryCapacityKg, 150.0);
    assert.equal(r.effective.comfort, 0);           // no gear → comfort 0
  });

  it("equip_gear → get_equipped_gear → unequip_gear: full slot round-trip", async () => {
    const { companionId } = seedMountWithSpecies();
    const meta = {
      slot: "saddle", species_compat: [], weight_kg: 12, weight_rating_kg: 200,
      stat_mods: { speed: 0.2, comfort: 4 }, material_list: [{ material_id: "leather", qty: 4 }],
    };
    const gearId = seedGearDtu(meta);

    const eq = await runMacro("mounts", "equip_gear", { mountId: companionId, gearDtuId: gearId, slot: "saddle" }, ctx);
    assert.equal(eq.ok, true);
    assert.equal(eq.replaced, null);   // slot was empty → nothing replaced

    // Read-back: the gear reads back in the saddle slot with its meta.
    const ge = await runMacro("mounts", "get_equipped_gear", { mountId: companionId }, ctx);
    assert.equal(ge.gear.saddle.dtuId, gearId);
    assert.equal(ge.gear.saddle.weight_kg, 12);
    assert.equal(ge.gear.bridle, null);             // other slots empty

    const un = await runMacro("mounts", "unequip_gear", { mountId: companionId, slot: "saddle" }, ctx);
    assert.equal(un.had, true);                      // slot had gear before clearing
    assert.equal(un.removed, gearId);
    const ge2 = await runMacro("mounts", "get_equipped_gear", { mountId: companionId }, ctx);
    assert.equal(ge2.gear.saddle, null);            // cleared
  });

  it("compute_stats: equipped speed mod (+0.2) folds onto base speed (8.0 → 9.6)", async () => {
    const { companionId } = seedMountWithSpecies({ baseSpeed: 8.0, carry: 150.0 });
    const gearId = seedGearDtu({
      slot: "saddle", species_compat: [], weight_kg: 12, weight_rating_kg: 200,
      stat_mods: { speed: 0.2, comfort: 4 }, material_list: [{ material_id: "leather", qty: 4 }],
    });
    await runMacro("mounts", "equip_gear", { mountId: companionId, gearDtuId: gearId, slot: "saddle" }, ctx);
    const r = await runMacro("mounts", "compute_stats", { mountId: companionId }, ctx);
    assert.equal(r.modifiers.speed, 0.2);
    assert.equal(r.effective.speedMps, 9.6);        // 8.0 × clampMul(0.2) = 8.0 × 1.2
    assert.equal(r.effective.comfort, 4);           // Σ comfort, clamped [0, 30]
  });

  it("equip_gear: equipping a gear DTU into the wrong slot is a slot_mismatch", async () => {
    const { companionId } = seedMountWithSpecies();
    const gearId = seedGearDtu({
      slot: "saddle", species_compat: [], weight_kg: 12, weight_rating_kg: 200,
      stat_mods: {}, material_list: [{ material_id: "leather", qty: 4 }],
    });
    // Recipe is a saddle but we try to slot it as a bridle.
    const r = await runMacro("mounts", "equip_gear", { mountId: companionId, gearDtuId: gearId, slot: "bridle" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "slot_mismatch");
  });

  it("applied_profile: warhorse overlay scales the base profile multiplicatively", async () => {
    // warhorse: gas_strike_cost_mul 1.20, parry_window_ms_mul 0.90, speed_factor 1.05.
    const r = await runMacro("mounts", "applied_profile", {
      archetype: "warhorse",
      profile: { gas_strike_cost: 10, gas_recovery_per_s: 5, combo_window_ms: 100, parry_window_ms: 200, dodge_window_ms: 300, stagger_chance: 0.5 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.profile.gas_strike_cost, 12);     // 10 × 1.20
    assert.equal(r.profile.parry_window_ms, 180);    // 200 × 0.90
    assert.equal(r.profile._speed_factor, 1.05);     // clamp(1.05)
    assert.equal(r.profile.stagger_chance, 0.7);     // min(1, 0.5 × 1.40)
    assert.deepEqual(r.profile._mounted_finishers, ["lance_thrust", "trample"]);
  });

  it("combat_overlay: unknown archetype falls back to the generic (neutral) overlay", async () => {
    const r = await runMacro("mounts", "combat_overlay", { archetype: "no_such_beast" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.overlay.speed_factor, 1.0);       // generic = NEUTRAL
    assert.equal(r.overlay.stagger_chance_mul, 1.0);
  });

  it("validate_gear_recipe: an out-of-bounds speed mod is rejected with a bounds error", async () => {
    const r = await runMacro("mounts", "validate_gear_recipe", {
      recipe: {
        slot: "saddle",
        species_compat: [],
        weight_kg: 12,
        weight_rating_kg: 200,
        stat_mods: { speed: 0.9 },           // out of [-0.5, 0.5]
        material_list: [{ material_id: "leather", qty: 4 }],
      },
    }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "validation_failed");
    assert.ok(r.errors.some((e) => e.includes("stat_mods.speed out of bounds")));
  });

  it("validate_gear_recipe: a missing recipe is rejected", async () => {
    const r = await runMacro("mounts", "validate_gear_recipe", {}, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_recipe");
  });
});
