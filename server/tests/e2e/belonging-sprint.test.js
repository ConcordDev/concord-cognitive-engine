// Phase BA-BE end-to-end smoke test.
//
// Walks the belonging-sprint surfaces through a single user journey,
// confirming the pieces interoperate. Hermetic: fresh in-memory DB
// every run; only the pieces needed for the journey are migrated.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// Migrations.
import { up as upHouses } from "../../migrations/232_player_houses.js";
import { up as upOverrides } from "../../migrations/233_cosmetic_overrides.js";
import { up as upWardrobeOverlay } from "../../migrations/234_wardrobe_overlay.js";
import { up as upFestivals } from "../../migrations/235_festivals.js";
import { up as upSeasonStamp } from "../../migrations/236_achievement_season.js";
import { up as upAnnouncements } from "../../migrations/237_announcements.js";
import { up as upGuild } from "../../migrations/238_guild_substrate.js";
import { up as upMentor } from "../../migrations/239_npc_mentor_profiles.js";
import { up as upBosses } from "../../migrations/240_world_bosses.js";
import { up as upDifficulty } from "../../migrations/241_difficulty_tiers.js";
import { up as upCascades } from "../../migrations/242_event_cascades.js";
import { up as upPhotos } from "../../migrations/243_photo_gallery.js";

// Libraries.
import { claimHouse, placeFurniture, setLockTier, setVisibility } from "../../lib/player-housing.js";
import { captureSnapshot, requestVisit } from "../../lib/house-visit.js";
import { setDye, applyAppearanceOverride } from "../../lib/cosmetics.js";
import { runFestivalTriggerPass, loadFestivalsFromContent } from "../../lib/festivals.js";
import { publishAnnouncement, dequeueBroadcastBatch } from "../../lib/announcements.js";
import {
  awardOrgXp, depositToOrgInventory, withdrawFromOrgInventory, claimHallBuilding,
} from "../../lib/guild-substrate.js";
import { registerMentorProfile, listMentorsInWorld } from "../../lib/mentorship.js";
import {
  registerSchedule, runTriggerPass, defeatBoss, isLockedOut,
} from "../../lib/world-bosses.js";
import { applyDifficulty, getModifier, recordClear, tierUnlockedFor } from "../../lib/difficulty.js";
import { defineCascade, triggerCascade, getCascadeChain } from "../../lib/event-cascades.js";
import { savePhoto, sharePhoto, listPublicPhotosInWorld } from "../../lib/photo-gallery.js";

function bootDb() {
  const db = new Database(":memory:");
  // Minimal substrate for the journey.
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, appearance_json TEXT);
    CREATE TABLE land_claims (id TEXT PRIMARY KEY, owner_user_id TEXT, world_id TEXT, anchor_x REAL, anchor_z REAL, radius_m REAL, bond_sparks REAL, maintenance_per_day REAL, claimed_at INTEGER, last_maintained_at INTEGER, status TEXT);
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, name TEXT, x REAL, y REAL, z REAL, width REAL, depth REAL, height REAL, material TEXT, owner_type TEXT, owner_id TEXT, state TEXT DEFAULT 'standing', health_pct REAL DEFAULT 1.0);
    CREATE TABLE building_rooms (id TEXT PRIMARY KEY, building_id TEXT, world_id TEXT, room_type TEXT, name TEXT, width REAL, depth REAL, height REAL, x_offset REAL, z_offset REAL, floor INTEGER, capacity INTEGER, is_public INTEGER DEFAULT 1, furniture TEXT DEFAULT '[]', lock_tier INTEGER DEFAULT 0, lock_state TEXT DEFAULT 'open');
    CREATE TABLE player_achievements (player_id TEXT, achievement_id TEXT, earned_at INTEGER, PRIMARY KEY (player_id, achievement_id));
    CREATE TABLE lattice_born_quests (id TEXT PRIMARY KEY, quest_id TEXT, drift_alert_signature TEXT UNIQUE, world_id TEXT, parent_quest_id TEXT, cascade_depth INTEGER);
    CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, kind TEXT, created_by TEXT, created_at INTEGER, body_json TEXT);
  `);
  upHouses(db);
  upOverrides(db);
  upWardrobeOverlay(db);
  upFestivals(db);
  upSeasonStamp(db);
  upAnnouncements(db);
  upGuild(db);
  upMentor(db);
  upBosses(db);
  upDifficulty(db);
  upCascades(db);
  upPhotos(db);
  // Override photo dir for hermetic test.
  process.env.CONCORD_PHOTO_DIR = "/tmp/concord-photos-e2e";
  return db;
}

describe("Phase BA-BE — belonging sprint end-to-end", () => {
  it("walks the full journey without exception", async () => {
    const db = bootDb();
    db.prepare(`INSERT INTO users (id, appearance_json) VALUES (?, ?)`).run("u1", JSON.stringify({ slots: {} }));

    // ── BA1 — claim land, place building, claim as house ─────────────
    db.prepare(`INSERT INTO land_claims VALUES ('lc-1', 'u1', 'tunya', 0, 0, 100, 50, 5, unixepoch(), unixepoch(), 'active')`).run();
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, x, y, z, width, depth, height, material) VALUES ('b-1', 'tunya', 'house', 5, 0, 5, 10, 10, 8, 'wood')`).run();
    db.prepare(`INSERT INTO building_rooms (id, building_id, world_id, room_type, name, width, depth, height, x_offset, z_offset, floor, capacity) VALUES ('r-1', 'b-1', 'tunya', 'bedroom', 'Bedroom', 5, 5, 3, 0, 0, 1, 2)`).run();
    const claim = claimHouse(db, "u1", { landClaimId: "lc-1", buildingId: "b-1", name: "Cottage" });
    assert.equal(claim.ok, true);

    // ── BA1 — decorate ────────────────────────────────────────────────
    placeFurniture(db, "u1", claim.houseId, "r-1", { itemId: "bed-1", x: 1, y: 0, z: 1, rot: 0 });
    placeFurniture(db, "u1", claim.houseId, "r-1", { itemId: "chest-1", x: 3, y: 0, z: 1, rot: 90 });
    setLockTier(db, "u1", claim.houseId, "r-1", 3);
    setVisibility(db, "u1", claim.houseId, "friends");

    // ── BA2 — snapshot + visit ────────────────────────────────────────
    captureSnapshot(db, claim.houseId);
    const visit = requestVisit(db, "friend", claim.houseId, { isFriend: true });
    assert.equal(visit.ok, true);
    assert.equal(visit.mode, "snapshot");
    assert.equal(visit.payload.rooms[0].lockTier, 3);

    // ── BA3 — set a dye, verify compose ──────────────────────────────
    setDye(db, "u1", "default", "chest", "primary", "#FF00FF");
    const composed = applyAppearanceOverride({ slots: {} }, { chest: { primary: "#FF00FF" } });
    assert.equal(composed.slots.chest.primary, "#FF00FF");

    // ── BB1 — festivals load + trigger pass on deep_winter day 0 ────
    loadFestivalsFromContent(db);
    const winterDay = 35 * 86400000;
    const pass = runFestivalTriggerPass(db, "tunya", { now: winterDay });
    assert.ok(pass.opened.some(f => f.festivalId === "wintersday"));

    // ── BB3 — announcement publishes + dequeues exactly once ────────
    publishAnnouncement(db, { kind: "feature_drop", title: "Belonging is here", body: "All the new things." });
    const broadcast = dequeueBroadcastBatch(db);
    assert.equal(broadcast.length, 1);
    assert.equal(dequeueBroadcastBatch(db).length, 0, "second dequeue is empty (idempotent)");

    // ── BC1 — guild XP + bank ─────────────────────────────────────────
    const xp = awardOrgXp(db, "org-1", 500);
    assert.ok(xp.newLevel >= 2);
    const members = new Set(["u1"]);
    const officers = new Set(["u1"]);
    depositToOrgInventory(db, "u1", "org-1", { itemDescriptor: "herb", quantity: 10, isMember: (id) => members.has(id) });
    const wd = withdrawFromOrgInventory(db, "u1", "org-1", { itemDescriptor: "herb", quantity: 3, isOfficer: (id) => officers.has(id) });
    assert.equal(wd.withdrawn, 3);

    // ── BC1 — claim guild hall (same building substrate as housing) ──
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, x, y, z, width, depth, height, material) VALUES ('hall-1', 'tunya', 'tower', 50, 0, 50, 12, 12, 12, 'stone')`).run();
    const hall = claimHallBuilding(db, "u1", "org-1", "hall-1", { isLeader: (id) => id === "u1" });
    assert.equal(hall.ok, true);

    // ── BC2 — register a mentor + list it in-world ───────────────────
    registerMentorProfile(db, { npcId: "elder-vesh", worldId: "tunya", skillCategory: "sword", depth: 8 });
    const mentors = listMentorsInWorld(db, "tunya");
    assert.equal(mentors.length, 1);

    // ── BD1 — boss spawn + defeat + lockout ──────────────────────────
    registerSchedule(db, { id: "wbs-1", worldId: "tunya", bossTemplate: "river-serpent", cadenceSeconds: 86400, nextSpawnAt: 1, difficultyTierDefault: "normal" });
    const trigger = runTriggerPass(db);
    assert.equal(trigger.opened.length, 1);
    const activeId = trigger.opened[0].activeId;
    const defeat = defeatBoss(db, { activeId, participantUserIds: ["u1"] });
    assert.equal(defeat.ok, true);
    assert.equal(isLockedOut(db, "u1", "wbs-1"), true);

    // ── BD2 — difficulty modifier + clear ladder ─────────────────────
    const mod = getModifier(db, "heroic");
    const scaled = applyDifficulty({ damage: 100, health: 1000, loot: 50 }, mod);
    assert.equal(scaled.damage, 150);
    recordClear(db, "u1", "river-serpent", "finder");
    assert.equal(tierUnlockedFor(db, "u1", "river-serpent", "normal"), true);

    // ── BD3 — cascade chain ──────────────────────────────────────────
    db.prepare(`INSERT INTO lattice_born_quests (id, quest_id, parent_quest_id, cascade_depth) VALUES ('q1', 'root', NULL, 0)`).run();
    defineCascade(db, "root", { onSuccess: "investigate-upstream" });
    const child = triggerCascade(db, "root", "success");
    assert.equal(child.spawned, true);
    db.prepare(`INSERT INTO lattice_born_quests (id, quest_id, parent_quest_id, cascade_depth) VALUES ('q2', ?, 'root', 1)`).run(child.childQuestId);
    const chain = getCascadeChain(db, child.childQuestId);
    assert.equal(chain.length, 2);

    // ── BE1 — photo save + share + appear in world feed ──────────────
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
    const photo = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: tinyPng, caption: "Decorated my cottage." });
    assert.equal(photo.ok, true);
    sharePhoto(db, photo.id);
    const feed = listPublicPhotosInWorld(db, "tunya");
    assert.equal(feed.length, 1);
  });
});
