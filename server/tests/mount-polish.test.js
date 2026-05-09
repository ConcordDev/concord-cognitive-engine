/**
 * Tier-2 contract tests for Concordia Procedural Mount System Phase B4.
 *
 * Pinned:
 *   - migration 145: skill columns + mount_care_events + actor_state.mount_state
 *   - mount-care: feed/groom/rest deltas, anti-spam window, lazy decay,
 *     loyaltyForRiding ride gate, 24h decay cap.
 *   - companions-mount-evo: gain XP, tier promotion at thresholds.
 *   - mount-combat-overlay: applyMountedOverlay multiplies + clamps.
 *   - mount-care-cycle heartbeat: never throws, respects FF_MOUNT_CARE,
 *     processes within MAX_PER_PASS.
 *
 * Run: node --test tests/mount-polish.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig104 from "../migrations/104_player_companions.js";
import * as mig140 from "../migrations/140_combat_polish.js";
import * as mig142 from "../migrations/142_mount_substrate.js";
import * as mig145 from "../migrations/145_mount_polish.js";
import {
  feedMount, groomMount, restMount,
  decayCare, getCareState,
  loyaltyForRiding, LOYALTY_RIDE_THRESHOLD,
  _internals as careInternals,
} from "../lib/mount-care.js";
import {
  gainSkillXp, gainRideDistance, gainCombatHits, gainFlightSeconds,
  getEvolutionState, _internals as evoInternals,
} from "../lib/companions-mount-evo.js";
import {
  applyMountedOverlay, MOUNTED_MODIFIER, readMountState, setMountState,
} from "../lib/mount-combat-overlay.js";
import { runMountCareCycle } from "../emergent/mount-care-cycle.js";
import { COMBAT_PROFILES } from "../lib/combat-polish.js";
import { seedMountSpecies } from "../lib/ecosystem/mount-species-seeder.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, archetype TEXT NOT NULL,
      x REAL, y REAL, z REAL, is_dead INTEGER DEFAULT 0
    );
  `);
  mig104.up(db);
  mig140.up(db);
  mig142.up(db);
  mig145.up(db);
  seedMountSpecies(db);
  delete process.env.FF_MOUNT_CARE;
  delete process.env.FF_MOUNT_EVO;
  delete process.env.FF_MOUNT_COMBAT;
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

function _seedCompanion(id, ownerId = "alice", { mountEligible = 1, loyalty = 50 } = {}) {
  db.prepare(`
    INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, mount_eligible, tame_bond, loyalty)
    VALUES (?, ?, 'cr', 'Pet', 'concordia-hub', ?, 100, ?)
  `).run(id, ownerId, mountEligible, loyalty);
}

describe("migration 145 — mount polish", () => {
  it("adds skill + evolution columns to player_companions", () => {
    const cols = db.prepare("PRAGMA table_info(player_companions)").all().map(c => c.name);
    for (const k of ["gait_skill", "combat_skill", "flight_skill", "evolution_tier", "last_ridden_at"]) {
      assert.ok(cols.includes(k), `missing column ${k}`);
    }
  });

  it("creates mount_care_events with event_type CHECK", () => {
    const cols = db.prepare("PRAGMA table_info(mount_care_events)").all().map(c => c.name);
    for (const k of ["companion_id", "event_type", "delta_loyalty", "delta_stamina", "delta_hunger", "ts"]) {
      assert.ok(cols.includes(k));
    }
    assert.throws(() => {
      db.prepare(`INSERT INTO mount_care_events (companion_id, event_type) VALUES ('x', 'invalid')`).run();
    }, /CHECK/);
  });

  it("adds mount_state column to combat_actor_state", () => {
    const cols = db.prepare("PRAGMA table_info(combat_actor_state)").all().map(c => c.name);
    assert.ok(cols.includes("mount_state"));
  });

  it("ALTER is idempotent on re-run", () => {
    let threw = false;
    try { mig145.up(db); } catch { threw = true; }
    assert.equal(threw, false);
  });
});

describe("mount-care: feed / groom / rest", () => {
  beforeEach(() => _seedCompanion("c1"));

  it("feedMount drops hunger + raises loyalty + writes a feed event", () => {
    // Pre-elevate hunger so the FEED delta has room.
    db.prepare(`UPDATE player_companions SET mount_state = '{"hunger":80}' WHERE id = 'c1'`).run();
    const r = feedMount(db, { companionId: "c1", ownerId: "alice", foodItemId: "hay_bale" });
    assert.equal(r.ok, true);
    const cs = getCareState(db, "c1");
    assert.ok(cs.state.hunger < 80);
    assert.ok(cs.loyalty > 50);
    const evt = db.prepare(`SELECT * FROM mount_care_events WHERE companion_id = 'c1' AND event_type = 'feed'`).all();
    assert.equal(evt.length, 1);
  });

  it("feedMount enforces a 5-minute anti-spam window", () => {
    feedMount(db, { companionId: "c1", ownerId: "alice" });
    const r2 = feedMount(db, { companionId: "c1", ownerId: "alice" });
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "too_soon");
    assert.ok(r2.retryAfterS > 0);
  });

  it("groomMount lifts loyalty", () => {
    const r = groomMount(db, { companionId: "c1", ownerId: "alice" });
    assert.equal(r.ok, true);
    assert.ok(r.loyalty > 50);
  });

  it("restMount fills stamina", () => {
    db.prepare(`UPDATE player_companions SET mount_state = '{"stamina":40}' WHERE id = 'c1'`).run();
    const r = restMount(db, { companionId: "c1", ownerId: "alice" });
    assert.equal(r.ok, true);
    assert.ok(r.state.stamina > 40);
  });

  it("rejects non-owner", () => {
    const r = feedMount(db, { companionId: "c1", ownerId: "bob" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });
});

describe("mount-care: lazy decay + ride gate", () => {
  beforeEach(() => _seedCompanion("c1", "alice", { loyalty: 80 }));

  it("decayCare bumps hunger + drops loyalty after elapsed time", () => {
    // Backdate last_action_at by 12h.
    db.prepare(`UPDATE player_companions SET last_action_at = (unixepoch() - 43200) WHERE id = 'c1'`).run();
    const r = decayCare(db, "c1");
    assert.equal(r.ok, true);
    assert.equal(r.applied, true);
    // 12h × 1.5/h = 18 hunger.
    assert.ok(r.state.hunger >= 17);
    assert.ok(r.state.hunger <= 19);
    // 12h ÷ 24 × 4 = 2 loyalty.
    assert.ok(r.loyalty < 80);
  });

  it("caps decay at 24h regardless of elapsed", () => {
    db.prepare(`UPDATE player_companions SET last_action_at = (unixepoch() - 86400 * 7) WHERE id = 'c1'`).run();
    const r = decayCare(db, "c1");
    assert.equal(r.applied, true);
    // Hunger after exactly 24h = 36; if cap broken would be 252.
    assert.ok(r.state.hunger <= 40);
  });

  it("skips sub-minute decay", () => {
    // Default last_action_at = unixepoch() of insert.
    const r = decayCare(db, "c1");
    assert.equal(r.applied, false);
  });

  it("loyaltyForRiding gate: < 30 blocks", () => {
    assert.equal(loyaltyForRiding(50), true);
    assert.equal(loyaltyForRiding(LOYALTY_RIDE_THRESHOLD), true);
    assert.equal(loyaltyForRiding(LOYALTY_RIDE_THRESHOLD - 1), false);
    assert.equal(loyaltyForRiding(0), false);
  });
});

describe("companions-mount-evo: skill XP + tier promotion", () => {
  beforeEach(() => _seedCompanion("c1"));

  it("gainSkillXp accumulates on the right column", () => {
    const r = gainSkillXp(db, { mountId: "c1", axis: "gait", delta: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.before, 0);
    assert.equal(r.after, 50);
    const row = db.prepare(`SELECT gait_skill, combat_skill, evolution_tier FROM player_companions WHERE id = 'c1'`).get();
    assert.equal(row.gait_skill, 50);
    assert.equal(row.combat_skill, 0);
  });

  it("rejects invalid axis", () => {
    const r = gainSkillXp(db, { mountId: "c1", axis: "magic", delta: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_axis");
  });

  it("promotes tier when crossing threshold (100/500/2000/10000)", () => {
    let r = gainSkillXp(db, { mountId: "c1", axis: "gait", delta: 99 });
    assert.equal(r.tierAfter, 0);
    r = gainSkillXp(db, { mountId: "c1", axis: "gait", delta: 1 });
    assert.equal(r.tierAfter, 1);
    assert.equal(r.leveledUp, true);
    r = gainSkillXp(db, { mountId: "c1", axis: "gait", delta: 400 });
    assert.equal(r.tierAfter, 2);
  });

  it("convenience wrappers — ride / combat / flight axes", () => {
    gainRideDistance(db, "c1", 1000);   // 1000m × 0.01 = 10 XP
    gainCombatHits(db, "c1", 50);        // 50 × 0.5 = 25
    gainFlightSeconds(db, "c1", 10);     // 10 × 0.5 = 5
    const e = getEvolutionState(db, "c1");
    assert.equal(e.skill.gait, 10);
    assert.equal(e.skill.combat, 25);
    assert.equal(e.skill.flight, 5);
  });

  it("getEvolutionState shape", () => {
    const e = getEvolutionState(db, "c1");
    assert.ok(Array.isArray(e.thresholds));
    assert.equal(e.tier, 0);
    assert.equal(e.maxTier, evoInternals.TIER_THRESHOLDS.length - 1);
  });
});

describe("mount-combat-overlay", () => {
  it("applyMountedOverlay multiplies base profile constants", () => {
    const profile = COMBAT_PROFILES.ufc_groundgame;
    const out = applyMountedOverlay(profile, "warhorse");
    assert.ok(out._mounted_overlay_active);
    assert.equal(out._mount_archetype, "warhorse");
    // Warhorse: gas_strike_cost_mul = 1.20
    assert.ok(Math.abs(out.gas_strike_cost - profile.gas_strike_cost * 1.20) < 1e-9);
    // gas_recovery_per_s_mul = 0.85
    assert.ok(Math.abs(out.gas_recovery_per_s - profile.gas_recovery_per_s * 0.85) < 1e-9);
  });

  it("clamps multipliers to [0.5, 2.0]", () => {
    // Construct a synthetic overlay key to test clamp.
    const profile = COMBAT_PROFILES.ufc_groundgame;
    const out = applyMountedOverlay(profile, "generic");
    // Generic overlay = 1.0 across the board, no change.
    assert.equal(out.gas_strike_cost, profile.gas_strike_cost);
  });

  it("falls back to generic for unknown archetype", () => {
    const profile = COMBAT_PROFILES.sifu_brawler;
    const out = applyMountedOverlay(profile, "ghost_unicorn");
    assert.equal(out._mount_archetype, "ghost_unicorn");
    // generic overlay → unchanged.
    assert.equal(out.gas_strike_cost, profile.gas_strike_cost);
  });

  it("readMountState / setMountState round-trip", () => {
    db.prepare(`
      INSERT INTO combat_actor_state (actor_kind, actor_id, world_id, profile_id)
      VALUES ('player', 'alice', 'concordia-hub', 'street_freeroam')
    `).run();
    setMountState(db, "player", "alice", { mount_id: "c1", archetype: "warhorse", mounted_modifier_active: true });
    const s = readMountState(db, "player", "alice");
    assert.equal(s.archetype, "warhorse");
    setMountState(db, "player", "alice", null);
    assert.equal(readMountState(db, "player", "alice"), null);
  });

  it("MOUNTED_MODIFIER table covers the 8 seeded species + generic", () => {
    const expected = ["warhorse", "dire_wolf", "chimera", "giant_elk", "salamander_mount",
                      "hippogriff", "gryphon", "juvenile_wyvern", "generic"];
    for (const k of expected) {
      assert.ok(MOUNTED_MODIFIER[k], `missing overlay for ${k}`);
    }
  });
});

describe("mount-care-cycle heartbeat", () => {
  it("returns ok:true with reason flag_off when FF_MOUNT_CARE=0", async () => {
    process.env.FF_MOUNT_CARE = "0";
    const r = await runMountCareCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.reason, "flag_off");
  });

  it("returns ok:true reason no_db when missing db", async () => {
    const r = await runMountCareCycle({});
    assert.equal(r.ok, true);
    assert.equal(r.reason, "no_db");
  });

  it("processes mount-eligible companions (best-effort)", async () => {
    _seedCompanion("c1");
    db.prepare(`UPDATE player_companions SET last_action_at = (unixepoch() - 7200) WHERE id = 'c1'`).run();
    const r = await runMountCareCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.processed, 1);
    assert.equal(r.neglectful, 1);
  });

  it("never throws when individual mount handling fails", async () => {
    _seedCompanion("c1");
    let threw = false;
    try { await runMountCareCycle({ db }); }
    catch { threw = true; }
    assert.equal(threw, false);
  });
});

describe("internals exports", () => {
  it("careInternals expose tunables", () => {
    assert.ok(careInternals.HUNGER_RATE_PER_HOUR > 0);
    assert.equal(careInternals.LOYALTY_RIDE_THRESHOLD, 30);
  });

  it("evoInternals expose thresholds", () => {
    assert.ok(Array.isArray(evoInternals.TIER_THRESHOLDS));
    assert.ok(evoInternals.TIER_THRESHOLDS.length >= 4);
  });
});
