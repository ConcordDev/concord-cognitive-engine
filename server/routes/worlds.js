// server/routes/worlds.js
// Multi-world API routes: list, get, create, travel, skill teach/effectiveness.

import express from "express";
import crypto from "crypto";
import logger from "../logger.js";
import { loadWorld, listWorlds, getActiveWorldForPlayer } from "../lib/world-loader.js";
import { travelToWorld, applyWorldRulesToPlayer } from "../lib/transit.js";
import { spawnWorldNativeEmergent, getWorldEmergents, getCrossWorldEmergents, growAffinity } from "../lib/world-emergents.js";
import { seedWorldContent } from "../lib/world-seeder.js";
import { getNearbyNodes, getUndergroundNodes, gatherFromNode, updateSwimState, checkSwimState, respawnExpiredNodes } from "../lib/world-gathering.js";
import { getWorldMarket, getResourcePrice, recordTransaction } from "../lib/world-economy.js";
import { issueDirective, voteOnDirective, getActiveDirectives, getDirectiveHistory } from "../lib/world-governance.js";
import { getRoomsForBuilding, addRoom, updateRoomFurniture, seedRoomsForBuilding } from "../lib/building-interiors.js";
import { checkRoomAccess, attemptLockpick, forceEntry, recordTheft, getOpenCrimes, getActiveWarrants } from "../lib/world-crime.js";
import { broadcastOpinionEvent, getWorldReputation, willNPCInteract } from "../lib/npc-relations.js";
import { gainSkillXP } from "../lib/skills/skill-engine.js";
import {
  getActiveQuests,
  getQuestProgress,
  claimQuestRewards,
  recordObjectiveProgress,
  checkQuestCompletion,
} from "../lib/quests/quest-engine.js";
import * as cityPresence from "../lib/city-presence.js";
import { serverError } from "../lib/http-errors.js";

// Combat anti-cheat constants. Server-side validation prevents a modified
// client from claiming impossible reach or damage. The values are tuned
// loose enough that legitimate gameplay (crits, buffed attacks, lag-comp)
// passes, but tight enough that one-shot hacks get rejected.
const COMBAT_MAX_REACH_M       = Number(process.env.CONCORD_COMBAT_MAX_REACH_M)       || 80;  // ranged ceiling
const COMBAT_MELEE_REACH_M     = Number(process.env.CONCORD_COMBAT_MELEE_REACH_M)     || 3;   // melee threshold
const COMBAT_DAMAGE_HARD_CAP   = Number(process.env.CONCORD_COMBAT_DAMAGE_HARD_CAP)   || 500; // absolute per-hit cap
const COMBAT_DAMAGE_CRIT_MULT  = Number(process.env.CONCORD_COMBAT_DAMAGE_CRIT_MULT)  || 2.5; // crits scale this much

/**
 * Server-authoritative reach check. Returns { ok, reason?, distance? }.
 * Uses cityPresence's last-known player position (updated 30Hz from
 * player:move socket). NPC position comes from world_npcs row.
 *
 * Skill DTUs may declare `range_m` to override; otherwise melee (3m).
 */
function _validateCombatReach(userId, npcRow, skillData) {
  const playerPos = cityPresence.getUserPosition(userId);
  if (!playerPos) return { ok: true, reason: "no_presence_yet" }; // first frame after login — pass
  if (!npcRow || typeof npcRow.x !== "number" || typeof npcRow.z !== "number") return { ok: true, reason: "npc_no_pos" };
  const dx = (playerPos.x ?? 0) - (npcRow.x ?? 0);
  const dz = (playerPos.z ?? 0) - (npcRow.z ?? 0);
  const distance = Math.sqrt(dx * dx + dz * dz);
  const declaredRange = Number(skillData?.range_m) || COMBAT_MELEE_REACH_M;
  const allowedRange = Math.min(COMBAT_MAX_REACH_M, Math.max(COMBAT_MELEE_REACH_M, declaredRange));
  if (distance > allowedRange + 1) { // +1m grace for lag-comp
    return { ok: false, reason: "out_of_range", distance, allowedRange };
  }
  return { ok: true, distance, allowedRange };
}

/**
 * Server-authoritative damage cap. After computeDamage() runs, verify
 * the result didn't blow past a sane maximum. A modified client can't
 * inflate damageResult.damage beyond what the server's own formula
 * produced — this is the second guard, defending against a future bug
 * in computeDamage that drops a sanity check.
 */
function _validateDamageCap(damageResult, skillData) {
  if (!damageResult || typeof damageResult.damage !== "number") {
    return { ok: false, reason: "damage_missing" };
  }
  const skillCap = Number(skillData?.max_damage) || 0;
  const isCrit = !!damageResult.isCrit;
  const cap = (skillCap > 0 ? skillCap * COMBAT_DAMAGE_CRIT_MULT : COMBAT_DAMAGE_HARD_CAP);
  if (damageResult.damage > cap + 0.5) {
    return { ok: false, reason: "damage_cap_exceeded", computed: damageResult.damage, cap, isCrit };
  }
  return { ok: true };
}

export default function createWorldsRouter({ requireAuth, db }) {
  const router = express.Router();

  // GET /api/worlds — list all active worlds (paginated)
  // Query params: page (1-based, default 1), limit (default 20, max 100)
  router.get("/", (req, res) => {
    try {
      const allWorlds = listWorlds(db);
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = (page - 1) * limit;
      const total = allWorlds.length;
      const data = allWorlds.slice(offset, offset + limit);
      // Keep backward-compat `worlds` key alongside new `data` key
      res.json({ worlds: data, data, pagination: { page, limit, total, hasMore: offset + limit < total } });
    } catch (e) {
      serverError(res, e);
    }
  });

  // GET /api/worlds/current — current world for the authenticated player
  router.get("/current", requireAuth, (req, res) => {
    try {
      const worldId = getActiveWorldForPlayer(db, req.user.id);
      const world   = loadWorld(db, worldId);
      res.json({ worldId, world });
    } catch (e) {
      serverError(res, e);
    }
  });

  // GET /api/worlds/:id — single world detail
  router.get("/:id", (req, res) => {
    try {
      const world = loadWorld(db, req.params.id);
      if (!world) return res.status(404).json({ error: "World not found" });
      res.json({ world });
    } catch (e) {
      serverError(res, e);
    }
  });

  // GET /api/worlds/:id/metrics — population metrics
  router.get("/:id/metrics", (req, res) => {
    try {
      const world = loadWorld(db, req.params.id);
      if (!world) return res.status(404).json({ error: "World not found" });

      const completedQuests = db.prepare(
        "SELECT COUNT(*) as c FROM world_quests WHERE world_id = ? AND status = 'completed'"
      ).get(req.params.id)?.c || 0;

      const skillDtusCreated = db.prepare(
        "SELECT COUNT(*) as c FROM world_visits WHERE world_id = ? AND departed_at IS NOT NULL"
      ).get(req.params.id)?.c || 0;

      res.json({
        worldId: req.params.id,
        population:       world.population,
        npcCount:         world.npc_count,
        totalVisits:      world.total_visits,
        userCreations:    world.user_creation_count,
        completedQuests,
        skillDtusCreated,
      });
    } catch (e) {
      serverError(res, e);
    }
  });

  // POST /api/worlds — create a new world (auth required)
  router.post("/", requireAuth, (req, res) => {
    try {
      const { name, universe_type, description, physics_modulators, rule_modulators } = req.body;
      if (!name || !universe_type) return res.status(400).json({ error: "name and universe_type required" });

      const id = `world-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO worlds (id, name, universe_type, description, physics_modulators, rule_modulators, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, name, universe_type, description || "",
        JSON.stringify(physics_modulators || {}),
        JSON.stringify(rule_modulators    || {}),
        req.user.id,
      );

      const world = loadWorld(db, id);
      // Seed world with resource nodes + seed city (non-blocking)
      try { seedWorldContent(db, id, universe_type); } catch (_se) { /* non-fatal */ }
      // Spawn a native emergent for the new world (non-blocking)
      spawnWorldNativeEmergent(id, db, () => "default").catch(err =>
        logger?.debug?.("[worlds] native emergent spawn failed", { worldId: id, err: err?.message })
      );
      res.status(201).json({ world });
    } catch (e) {
      serverError(res, e);
    }
  });

  // PATCH /api/worlds/:id/health — update district health score
  router.patch("/:id/health", requireAuth, (req, res) => {
    try {
      const { field, value } = req.body;
      const allowed = ["population", "npc_count", "user_creation_count"];
      if (!allowed.includes(field)) return res.status(400).json({ error: "Invalid field" });

      db.prepare(`UPDATE worlds SET ${field} = ? WHERE id = ?`).run(value, req.params.id);
      res.json({ ok: true, field, value });
    } catch (e) {
      serverError(res, e);
    }
  });

  // POST /api/worlds/travel — move authenticated player to a new world
  router.post("/travel", requireAuth, async (req, res) => {
    try {
      const { worldId: destinationWorldId } = req.body;
      if (!destinationWorldId) return res.status(400).json({ error: "worldId required" });
      const userId = req.user.id;
      const result = await travelToWorld(userId, destinationWorldId, db, req.app.locals.io ?? null);
      applyWorldRulesToPlayer(userId, result.world, db);
      res.json({ ok: true, ...result });
    } catch (e) {
      const status = e.status ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  // GET /api/worlds/:worldId/quests — list quests in a world
  router.get("/:worldId/quests", requireAuth, async (req, res) => {
    const { worldId } = req.params;
    const status = req.query.status || 'available';
    try {
      const { getWorldQuests } = await import("../lib/quest-emergence.js");
      const quests = getWorldQuests(worldId, status, db);
      res.json({ ok: true, quests: quests || [] });
    } catch (e) {
      res.json({ ok: true, quests: [] }); // graceful — quest table may not exist
    }
  });

  // POST /api/worlds/:worldId/quests/:questId/accept
  router.post("/:worldId/quests/:questId/accept", requireAuth, (req, res) => {
    const { worldId, questId } = req.params;
    const userId = req.user.id;
    try {
      // Mark quest as accepted, assign to player
      const quest = db.prepare("SELECT * FROM world_quests WHERE id = ? AND world_id = ?").get(questId, worldId);
      if (!quest) return res.status(404).json({ ok: false, error: 'quest not found' });
      db.prepare("UPDATE world_quests SET status = 'active', accepted_by = ? WHERE id = ?")
        .run(userId, questId);
      // Add to player's active quest tracking
      const id = crypto.randomUUID();
      // Try to insert into player_quests if it exists
      try {
        db.prepare("INSERT OR IGNORE INTO player_quests (id, user_id, quest_id, world_id, status) VALUES (?,?,?,?,'active')")
          .run(id, userId, questId, worldId);
      } catch { /* table may not exist */ }
      res.json({ ok: true, quest });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/quests/:questId/event — dispatch progress event
  router.post("/:worldId/quests/:questId/event", requireAuth, (req, res) => {
    try {
      const quest = db.prepare("SELECT * FROM world_quests WHERE id = ?").get(req.params.questId);
      if (!quest) return res.status(404).json({ error: "Quest not found" });
      // Progress update is handled by quest-emergence.js; acknowledge receipt here
      res.json({ ok: true, questId: req.params.questId, event: req.body });
    } catch (e) {
      serverError(res, e);
    }
  });

  // GET /api/worlds/:worldId/quests/active — player's active quests with objective progress
  router.get("/:worldId/quests/active", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { worldId } = req.params;
      const quests = getActiveQuests(db, userId, worldId);
      const withProgress = quests.map(q => ({
        ...q,
        progress: getQuestProgress(db, userId, worldId, q.id),
      }));
      res.json({ ok: true, quests: withProgress });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/quests/:questId/complete — check completion + claim rewards
  router.post("/:worldId/quests/:questId/complete", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { worldId, questId } = req.params;
      const isComplete = checkQuestCompletion(db, userId, worldId, questId);
      if (!isComplete) {
        return res.status(422).json({ ok: false, error: 'Quest objectives not all complete' });
      }
      const result = claimQuestRewards(db, userId, worldId, questId);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/quests/:questId/claim-reward — explicit reward claim
  router.post("/:worldId/quests/:questId/claim-reward", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { worldId, questId } = req.params;
      const result = claimQuestRewards(db, userId, worldId, questId);
      if (!result.ok) return res.status(422).json(result);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/skills/teach — teach a skill from one player to another
  router.post("/skills/teach", requireAuth, async (req, res) => {
    try {
      const { teacherDtuId, studentId } = req.body;
      if (!teacherDtuId || !studentId) return res.status(400).json({ error: "teacherDtuId and studentId required" });

      const { teachSkillToPlayer } = await import("../lib/skill-effectiveness.js");
      const { selectBrain } = await import("../lib/inference/router.js");
      const worldId = req.query.worldId || "concordia-hub";
      const world   = loadWorld(db, worldId);

      const newSkill = await teachSkillToPlayer(
        req.user.id,
        studentId,
        teacherDtuId,
        { worldId, worldName: world?.name },
        db,
        selectBrain,
      );

      res.status(201).json({ skill: newSkill });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // GET /api/skills/:dtuId/effectiveness — skill effectiveness in a world
  router.get("/skills/:dtuId/effectiveness", async (req, res) => {
    try {
      const { worldId = "concordia-hub" } = req.query;
      const skill = db.prepare("SELECT * FROM dtus WHERE id = ?").get(req.params.dtuId);
      if (!skill) return res.status(404).json({ error: "Skill not found" });

      const world = loadWorld(db, worldId);
      if (!world) return res.status(404).json({ error: "World not found" });

      const { evaluateSkillInWorld } = await import("../lib/skill-effectiveness.js");
      res.json({ skillId: req.params.dtuId, worldId, ...evaluateSkillInWorld(skill, world) });
    } catch (e) {
      serverError(res, e);
    }
  });

  // GET /api/worlds/marketplace — list skill listings
  router.get("/marketplace", async (req, res) => {
    try {
      const { getListings } = await import("../lib/skill-marketplace.js");
      const { worldId, maxPrice, page, limit } = req.query;
      const result = getListings({
        worldId,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        page:     page     ? Number(page)     : 1,
        limit:    limit    ? Number(limit)    : 20,
      }, db);
      res.json(result);
    } catch (e) {
      serverError(res, e);
    }
  });

  // POST /api/worlds/marketplace/list — list a skill for sale
  router.post("/marketplace/list", requireAuth, async (req, res) => {
    try {
      const { dtuId, priceCC, description } = req.body;
      if (!dtuId || priceCC == null) return res.status(400).json({ error: "dtuId and priceCC required" });

      const { listSkillForSale } = await import("../lib/skill-marketplace.js");
      const listing = listSkillForSale(req.user.id, dtuId, Number(priceCC), description, db);
      res.status(201).json({ listing });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // POST /api/worlds/marketplace/purchase — buy a skill listing
  router.post("/marketplace/purchase", requireAuth, async (req, res) => {
    try {
      const { listingId } = req.body;
      if (!listingId) return res.status(400).json({ error: "listingId required" });

      const { purchaseSkill } = await import("../lib/skill-marketplace.js");
      const { selectBrain } = await import("../lib/inference/router.js");
      const worldId = getActiveWorldForPlayer(db, req.user.id);
      const world   = loadWorld(db, worldId);

      const result = await purchaseSkill(
        req.user.id, listingId,
        { worldId, worldName: world?.name },
        db, selectBrain,
      );
      res.json(result);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // GET /api/worlds/skills/mine — player's own skills with progression data
  router.get("/skills/mine", requireAuth, async (req, res) => {
    try {
      const worldId = getActiveWorldForPlayer(db, req.user.id) || "concordia-hub";
      const skills = db.prepare(
        "SELECT * FROM dtus WHERE creator_id = ? AND type = 'skill' ORDER BY skill_level DESC"
      ).all(req.user.id);

      const { getMasteryMarkers } = await import("../lib/skill-progression.js");
      const { evaluateSkillInWorld } = await import("../lib/skill-effectiveness.js");
      const world = loadWorld(db, worldId);

      const shaped = skills.map(s => ({
        ...s,
        mastery: getMasteryMarkers(s),
        effectivenessInCurrentWorld: world ? evaluateSkillInWorld(s, world).effectiveness : null,
      }));
      res.json({ skills: shaped, worldId });
    } catch (e) {
      serverError(res, e);
    }
  });

  // GET /api/worlds/:worldId/leaderboard — top skills in a world by level
  router.get("/:worldId/leaderboard", async (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT d.id, d.title, d.skill_level, d.creator_id, u.username
        FROM dtus d
        LEFT JOIN users u ON u.id = d.creator_id
        WHERE d.world_id = ? AND d.type = 'skill' AND d.skill_level > 1
        ORDER BY d.skill_level DESC
        LIMIT 20
      `).all(req.params.worldId);
      res.json({ leaderboard: rows });
    } catch (e) {
      serverError(res, e);
    }
  });

  // GET /api/worlds/skills/legendary — Legendary+ skill holders across all worlds
  router.get("/skills/legendary", async (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT d.id, d.title, d.skill_level, d.creator_id, u.username, d.world_id
        FROM dtus d LEFT JOIN users u ON u.id = d.creator_id
        WHERE d.type = 'skill' AND d.skill_level >= 500
        ORDER BY d.skill_level DESC LIMIT 20
      `).all();
      res.json({ legends: rows });
    } catch (e) { serverError(res, e); }
  });

  // GET /api/worlds/crises — active civilization crises
  router.get("/crises", async (req, res) => {
    try {
      const { getActiveCrises } = await import("../lib/world-crisis.js");
      res.json({ crises: getActiveCrises(db) });
    } catch (e) { serverError(res, e); }
  });

  // POST /api/worlds/crises/:id/respond — player contributes to crisis resolution
  router.post("/crises/:id/respond", requireAuth, async (req, res) => {
    try {
      const { resolveCrisis } = await import("../lib/world-crisis.js");
      // For now: any response contributes to resolution
      const result = await resolveCrisis(db, req.params.id, {
        resolvedBy: req.user.id,
        outcome: req.body.outcome || "Resolved by player intervention.",
      }, () => {});
      res.json(result);
    } catch (e) { serverError(res, e); }
  });

  // POST /api/worlds/loot/:nodeId — claim a loot node
  router.post("/loot/:nodeId/claim", requireAuth, (req, res) => {
    try {
      const node = db.prepare("SELECT * FROM loot_nodes WHERE id = ?").get(req.params.nodeId);
      if (!node) return res.status(404).json({ error: "Loot node not found or expired" });
      if (node.claimed_by) return res.status(409).json({ error: "Already claimed" });
      if (node.expires_at < Date.now()) return res.status(410).json({ error: "Loot node expired" });

      const now = Date.now();
      // Killer priority window: first 2 minutes
      if (node.killer_id && node.killer_id !== req.user.id && now < node.created_at + 120_000) {
        return res.status(403).json({ error: "Killer priority window active" });
      }

      db.prepare("UPDATE loot_nodes SET claimed_by = ?, claimed_at = ? WHERE id = ?")
        .run(req.user.id, now, node.id);

      const contents = JSON.parse(node.contents || "[]");
      res.json({ ok: true, contents });
    } catch (e) { serverError(res, e); }
  });

  // GET /api/worlds/:worldId/nemesis — get the caller's nemesis in a world
  router.get("/:worldId/nemesis", requireAuth, (req, res) => {
    try {
      const record = db.prepare("SELECT * FROM nemesis_records WHERE player_id = ?").get(req.user.id);
      res.json({ nemesis: record || null });
    } catch (e) { serverError(res, e); }
  });

  // GET /api/worlds/:worldId/difficulty — player's effective resistance curve
  router.get("/:worldId/difficulty", requireAuth, async (req, res) => {
    try {
      const { evaluateSkillInWorld } = await import("../lib/skill-effectiveness.js");
      const { loadWorld } = await import("../lib/world-loader.js");
      const world = loadWorld(db, req.params.worldId);
      if (!world) return res.status(404).json({ error: "World not found" });

      const playerSkills = db.prepare(
        "SELECT skill_level FROM dtus WHERE creator_id = ? AND type = 'skill'"
      ).all(req.user.id);
      const avgLevel = playerSkills.length
        ? playerSkills.reduce((s, r) => s + (r.skill_level || 1), 0) / playerSkills.length
        : 1;

      const populationAvg = db.prepare(`
        SELECT AVG(d.skill_level) as avg FROM dtus d
        INNER JOIN users u ON u.id = d.creator_id
        WHERE d.type = 'skill' AND d.world_id = ?
      `).get(req.params.worldId)?.avg || 1;

      const scalingFactor = Math.min(2.0, avgLevel / Math.max(1, populationAvg));
      res.json({ worldId: req.params.worldId, playerAvgLevel: avgLevel, populationAvg, scalingFactor });
    } catch (e) { serverError(res, e); }
  });

  // POST /api/worlds/:worldId/prestige — reset skills for prestige badge
  router.post("/:worldId/prestige", requireAuth, async (req, res) => {
    try {
      const PRESTIGE_THRESHOLD = 200;
      const playerSkills = db.prepare(
        "SELECT id, skill_level, title FROM dtus WHERE creator_id = ? AND type = 'skill' AND world_id = ?"
      ).all(req.user.id, req.params.worldId);

      if (playerSkills.length === 0) return res.status(400).json({ error: "No skills in this world" });
      const avgLevel = playerSkills.reduce((s, r) => s + (r.skill_level || 1), 0) / playerSkills.length;
      if (avgLevel < PRESTIGE_THRESHOLD) {
        return res.status(400).json({ error: `Need average skill level ${PRESTIGE_THRESHOLD}. Current: ${avgLevel.toFixed(1)}` });
      }

      // Reset skill levels, preserve lineage for royalty cascade
      // @sql-loop-ok: iterates player's skills on prestige (bounded by skill catalog ~50)
      for (const skill of playerSkills) {
        const prestigenMeta = JSON.stringify({ prestige_from_level: skill.skill_level, world: req.params.worldId });
        db.prepare("UPDATE dtus SET skill_level = 1, total_experience = 0, practice_count = 0 WHERE id = ?").run(skill.id);
        db.prepare("UPDATE dtus SET meta = json_patch(COALESCE(meta, '{}'), ?) WHERE id = ?")
          .run(prestigenMeta, skill.id);
      }

      // Chronicle entry
      try {
        const { recordEvent } = await import("../emergent/history-engine.js");
        const username = db.prepare("SELECT username FROM users WHERE id = ?").get(req.user.id)?.username || "Unknown";
        recordEvent("breakthrough", {
          actorId: req.user.id,
          description: `${username} has prestiged in ${req.params.worldId} after reaching avg level ${avgLevel.toFixed(1)}.`,
          significance: "prestige",
        });
      } catch { /* lore append best-effort */ }

      res.json({ ok: true, prestigedSkills: playerSkills.length, fromAvgLevel: avgLevel.toFixed(1) });
    } catch (e) { serverError(res, e); }
  });

  // GET /api/substrate/patterns — substrate pattern feed
  // ── Expedition routes ─────────────────────────────────────────────────────

  // POST /api/worlds/expedition/progress — record world visited
  router.post("/expedition/progress", requireAuth, (req, res) => {
    const { worldId } = req.body ?? {};
    if (!worldId) return res.status(400).json({ error: "worldId required" });
    try {
      db.prepare(
        `INSERT OR IGNORE INTO expedition_progress (player_id, world_id, visited_at)
         VALUES (?, ?, ?)`
      ).run(req.user.id, worldId, Date.now());
      const visited = db.prepare(
        "SELECT world_id FROM expedition_progress WHERE player_id = ?"
      ).all(req.user.id).map(r => r.world_id);
      res.json({ visited });
    } catch (e) {
      serverError(res, e);
    }
  });

  // POST /api/worlds/expedition/complete — award World Walker achievement
  router.post("/expedition/complete", requireAuth, (req, res) => {
    try {
      db.prepare(
        `INSERT OR IGNORE INTO player_achievements (player_id, achievement_id, earned_at)
         VALUES (?, 'world_walker', ?)`
      ).run(req.user.id, Date.now());
      res.json({ achievement: 'world_walker', awarded: true });
    } catch (e) {
      serverError(res, e);
    }
  });

  // ── Nemesis location ──────────────────────────────────────────────────────

  // GET /api/worlds/:worldId/nemesis/location — current zone of nemesis NPC
  router.get("/:worldId/nemesis/location", requireAuth, (req, res) => {
    try {
      const record = db.prepare(
        "SELECT * FROM nemesis_records WHERE player_id = ? AND world_id = ?"
      ).get(req.user.id, req.params.worldId);
      if (!record) return res.json({ location: null });

      const npc = db.prepare(
        "SELECT state_json FROM world_npcs WHERE id = ?"
      ).get(record.npc_id);
      const state = npc ? _tryParseJSON(npc.state_json, {}) : {};
      res.json({ location: state.zone ?? null, npcId: record.npc_id, title: record.npc_title });
    } catch (e) {
      serverError(res, e);
    }
  });

  router.get("/substrate/patterns", (req, res) => {
    try {
      const patterns = db.prepare(
        "SELECT * FROM substrate_patterns ORDER BY current_strength DESC LIMIT 50"
      ).all().map(p => ({
        ...p,
        member_dtu_ids: _tryParseJSON(p.member_dtu_ids, []),
        worlds_present: _tryParseJSON(p.worlds_present, []),
      }));
      res.json({ patterns });
    } catch (e) {
      serverError(res, e);
    }
  });

  // ── World Emergents ────────────────────────────────────────────────────────

  router.get("/:worldId/emergents", async (req, res) => {
    try {
      const emergents = await getWorldEmergents(req.params.worldId, db);
      res.json({ ok: true, emergents });
    } catch (e) {
      serverError(res, e);
    }
  });

  router.get("/emergents/cross-world", async (req, res) => {
    try {
      const emergents = await getCrossWorldEmergents(db);
      res.json({ ok: true, emergents });
    } catch (e) {
      serverError(res, e);
    }
  });

  router.post("/:worldId/emergents/:emergentId/affinity", requireAuth, async (req, res) => {
    try {
      const { delta = 1 } = req.body;
      await growAffinity(req.params.emergentId, req.params.worldId, delta, db);
      res.json({ ok: true });
    } catch (e) {
      serverError(res, e);
    }
  });

  // ── NPC Routes ────────────────────────────────────────────────────────────

  // GET /api/worlds/:worldId/npcs — list live NPCs with positions (for frontend rendering)
  router.get("/:worldId/npcs", requireAuth, (req, res) => {
    try {
      const { worldId } = req.params;
      // Theme 4 (game-feel pass): LEFT JOIN npc_routine_state so the
      // routine-cycle's authoritative activity_kind surfaces to the
      // client. Falls back to the older state.currentActivity JSON
      // field if no routine row exists. Both paths populated by
      // npc-routine-cycle / npc-simulator respectively.
      let rows;
      try {
        rows = db.prepare(`
          SELECT n.id, n.npc_type, n.archetype, n.body_type, n.faction, n.is_conscious, n.is_immortal,
                 n.quest_giver, n.level, n.current_location, n.state, n.universe_type,
                 n.grief_level, n.criminal_rep, n.is_wanted, n.schedule_phase, n.job_type,
                 n.current_hp, n.max_hp, n.bounty, n.status_effects,
                 r.activity_kind AS routine_activity_kind,
                 r.location_kind AS routine_location_kind
          FROM world_npcs n
          LEFT JOIN npc_routine_state r ON r.npc_id = n.id
          WHERE n.world_id = ? AND n.is_dead = 0
          ORDER BY n.created_at ASC
          LIMIT 200
        `).all(worldId);
      } catch {
        // npc_routine_state missing on minimal/legacy deployments — fall back.
        rows = db.prepare(`
          SELECT id, npc_type, archetype, body_type, faction, is_conscious, is_immortal,
                 quest_giver, level, current_location, state, universe_type,
                 grief_level, criminal_rep, is_wanted, schedule_phase, job_type,
                 current_hp, max_hp, bounty, status_effects
          FROM world_npcs
          WHERE world_id = ? AND is_dead = 0
          ORDER BY created_at ASC
          LIMIT 200
        `).all(worldId);
      }

      const npcs = rows.map(r => {
        const state    = _tryParseJSON(r.state, {});
        const location = _tryParseJSON(r.current_location, { x: 0, y: 0, z: 0 });
        // Routine-cycle activity wins; fall back to JSON state for legacy NPCs.
        const currentActivity = r.routine_activity_kind || state.currentActivity || null;
        return {
          id:           r.id,
          name:         state.name || r.archetype || `${r.npc_type}-${r.id.slice(0, 4)}`,
          archetype:    r.archetype,
          npcType:      r.npc_type,
          bodyType:     r.body_type,
          faction:      r.faction,
          isConscious:  !!r.is_conscious,
          isImmortal:   !!r.is_immortal,
          isQuestGiver: !!r.quest_giver,
          level:        r.level || 1,
          position:     location,
          rotation:     state.rotation || 0,
          occupation:   state.occupation || r.archetype,
          currentActivity,
          locationKind: r.routine_location_kind || null,
          factionTactic:   state.factionTactic || null,
          // Behavioural state fields
          griefLevel:    r.grief_level   ?? 0,
          criminalRep:   r.criminal_rep  ?? 0,
          isWanted:      !!r.is_wanted,
          schedulPhase:  r.schedule_phase || 'day',
          jobType:       r.job_type      || null,
          currentHp:     r.current_hp    ?? 100,
          maxHp:         r.max_hp        ?? 100,
          bounty:        r.bounty        ?? 0,
          statusEffects: _tryParseJSON(r.status_effects, []),
        };
      });

      res.json({ ok: true, npcs, total: npcs.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/worlds/:worldId/emergents — list conscious emergents (Jarls/Bosses/Governors)
  router.get("/:worldId/emergents", requireAuth, (req, res) => {
    try {
      const { worldId } = req.params;
      const worldEmergents = getWorldEmergents(worldId, db);

      // Also get conscious NPCs that are world bosses
      const consciousNPCs = db.prepare(`
        SELECT id, archetype, state, level, current_location
        FROM world_npcs
        WHERE world_id = ? AND is_conscious = 1 AND is_dead = 0
      `).all(worldId);

      const bosses = consciousNPCs.map(n => {
        const state = _tryParseJSON(n.state, {});
        return {
          id:        n.id,
          name:      state.name || n.archetype,
          archetype: n.archetype,
          level:     n.level,
          role:      'world_boss',
          position:  _tryParseJSON(n.current_location, { x: 0, y: 0, z: 0 }),
        };
      });

      res.json({ ok: true, emergents: worldEmergents, bosses, total: worldEmergents.length + bosses.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/worlds/:worldId/opinions/recent — NPC opinion-shift feed.
  // npc-relations.js writes a row to opinion_events whenever a player or
  // NPC action shifts ambient opinion (witnessed combat, theft, charity,
  // public speech). The witness_radius column was always meant to drive
  // spatial reads — pre-this-route nothing actually queried them, so the
  // NPC reaction system had no UI surface. Frontend dialogue can now
  // pull recent opinion events near an NPC's position to flavor lines
  // ("they saw what you did to the Mayor").
  //
  // Query params:
  //   actorId — optional, filter to events caused by this actor
  //   limit   — default 50, max 200
  //   sinceTs — optional unix-epoch lower bound
  router.get("/:worldId/opinions/recent", requireAuth, (req, res) => {
    try {
      const { worldId } = req.params;
      const actorId = req.query.actorId || null;
      const sinceTs = req.query.sinceTs ? Number(req.query.sinceTs) : null;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const where = ["world_id = ?"];
      const args = [worldId];
      if (actorId) { where.push("actor_id = ?"); args.push(actorId); }
      if (sinceTs) { where.push("occurred_at >= ?"); args.push(sinceTs); }
      args.push(limit);
      const rows = db.prepare(
        `SELECT id, world_id, actor_id, actor_type, event_type, magnitude,
                location_x, location_z, witness_radius, context, occurred_at
           FROM opinion_events
          WHERE ${where.join(" AND ")}
          ORDER BY occurred_at DESC
          LIMIT ?`,
      ).all(...args);
      res.json({ ok: true, worldId, events: rows, count: rows.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/npcs/:npcId/kill — handle NPC death (from combat)
  router.post("/:worldId/npcs/:npcId/kill", requireAuth, async (req, res) => {
    try {
      const { worldId, npcId } = req.params;
      const killerId = req.user?.id || req.body?.killerId;
      const combatLog = req.body?.combatLog || null;

      // Import consequence handler lazily
      const { triggerNPCDeath } = await import("../lib/npc-consequences.js");
      const { onNPCKilledPlayer, onPlayerKilledNemesis, recordCombatMemory } = await import("../lib/nemesis.js");

      const result = await triggerNPCDeath(db, npcId, killerId, (event, data) => {
        req.app.locals.io?.emit(event, data);
      });

      if (!result.died && result.reason === 'immortal') {
        return res.status(403).json({ ok: false, error: 'immortal_npc', message: 'This being cannot be harmed.' });
      }

      // Record combat memory in nemesis if applicable
      if (result.died && combatLog && killerId) {
        recordCombatMemory(db, npcId, killerId, combatLog);

        // Check if player killed their nemesis
        const nemesisKilled = await onPlayerKilledNemesis(db, killerId, npcId, (event, data) => {
          req.app.locals.io?.emit(event, data);
        });
        result.nemesisDefeated = !!nemesisKilled;
      }

      // Award sparks for the kill
      if (result.died && killerId) {
        try {
          const { awardSparks } = await import("../lib/currency.js");
          const npc = db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(npcId);
          const sparks = (npc?.level || 1) * 5;
          awardSparks(db, killerId, sparks, 'npc_kill', worldId);
          result.sparksAwarded = sparks;

          // Generate a loot bag at NPC's last position
          try {
            const { generateNPCLoot, createLootBag } = await import("../lib/loot-generator.js");
            const { getNPCGear } = await import("../lib/npc-gear.js");
            const gear  = getNPCGear(db, npcId);
            const items = generateNPCLoot(npc, gear);
            const pos   = _tryParseJSON(npc.current_location, { x: 0, y: 0, z: 0 });
            const bagId = createLootBag(db, worldId, pos, 'npc', npcId, 'player', killerId, items);
            result.lootBagId = bagId;
            result.lootItems = items;
          } catch (lootErr) {
            logger.debug('worlds', 'loot_bag_skip', { reason: lootErr?.message });
          }
        } catch { /* non-fatal */ }
      }

      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/npcs/:npcId/interact — player interacts with an NPC
  router.post("/:worldId/npcs/:npcId/interact", requireAuth, async (req, res) => {
    try {
      const { worldId, npcId } = req.params;
      const playerId = req.user?.id;
      const { message } = req.body;

      const npc = db.prepare("SELECT * FROM world_npcs WHERE id = ? AND world_id = ?").get(npcId, worldId);
      if (!npc || npc.is_dead) return res.status(404).json({ ok: false, error: 'npc_not_found' });

      const state   = _tryParseJSON(npc.state, {});
      const npcName = state.name || npc.archetype || 'NPC';

      // Use subconscious brain for NPC response
      const { selectBrain } = await import("../lib/brain-config.js").catch(() => ({ selectBrain: null }));
      if (!selectBrain) return res.json({ ok: true, response: `${npcName} looks at you.` });

      const { handle } = await selectBrain("subconscious", { callerId: "world:npc:interact" });
      const context = [
        `You are ${npcName}, a ${npc.archetype} NPC in world ${worldId}.`,
        `Faction: ${npc.faction}. Level: ${npc.level}.`,
        npc.is_conscious ? 'You are a world leader and conscious being. Speak with authority and wisdom.' : '',
        `Your current goals: ${JSON.stringify(state.goals || []).slice(0, 200)}`,
        `A player says: "${message || 'Hello'}"`,
        `Reply in character in 1-2 sentences. Stay true to your archetype.`,
      ].filter(Boolean).join('\n');

      const response = await handle.generate(context);

      // Track dialogue for quest triggers
      try {
        await import("../lib/npc-behaviors.js").then(m =>
          m.npcObserveSkillUse?.({ id: npcId, worldId }, { type: 'player_dialogue', message }, db)
        );
      } catch { /* non-fatal */ }

      // Advance quest if this NPC is a quest giver
      if (npc.quest_giver) {
        growAffinity(npcId, worldId, 0.1, db);
      }

      res.json({ ok: true, npcId, npcName, response: response?.slice(0, 500) || `${npcName} nods.` });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/npcs/:npcId/dialogue — rich structured dialogue (new clients)
  router.post("/:worldId/npcs/:npcId/dialogue", requireAuth, async (req, res) => {
    try {
      const { worldId, npcId } = req.params;
      const playerId = req.user?.id;

      // 1. Fetch NPC
      const npc = db.prepare("SELECT * FROM world_npcs WHERE id = ? AND world_id = ?").get(npcId, worldId);
      if (!npc || npc.is_dead) return res.status(404).json({ ok: false, error: 'npc_not_found' });

      const state   = _tryParseJSON(npc.state, {});
      const npcName = state.name || npc.archetype || 'NPC';

      // Phase 2: idempotent seed of grudge/preoccupation/desire on first
      // dialogue. Best-effort — never blocks the dialogue path.
      try {
        const asymmetry = await import("../lib/npc-asymmetry.js");
        await asymmetry.seedNPCAsymmetry(db, { ...npc, ...state });
      } catch { /* asymmetry tables may be absent */ }

      // Phase 3: if the player has an open beat targeting THIS NPC, talking
      // to the NPC realises the beat. Best-effort.
      try {
        if (playerId) {
          const beats = await import("../emergent/personal-beat-scheduler.js");
          const open = beats.findOpenBeatBySubject?.(db, playerId, "npc", npcId);
          if (open?.id) await beats.realiseBeat(db, open.id, "realised");
        }
      } catch { /* beat realisation best-effort */ }

      // Phase 4a: pull current activity from npc_routine_state so the
      // dialogue prompt reflects what the NPC is doing right now. State
      // attached as a synthetic field; downstream LLM-prompt builders read
      // it without changing their schema.
      try {
        const routines = await import("../lib/npc-routines.js");
        const active = routines.getActiveRoutine?.(db, npcId);
        if (active) {
          state.current_activity = active.activity_kind;
          state.current_location_kind = active.location_kind;
        }
      } catch { /* routines table optional */ }

      // 2. Player reputation
      const reputation = getWorldReputation(db, worldId, playerId);

      // 3. NPC opinion of player
      const interactResult = willNPCInteract(db, npcId, playerId, 'talk');

      // 4. Available quests for this NPC
      let quests = [];
      try {
        quests = db.prepare(
          "SELECT * FROM world_quests WHERE giver_npc_id = ? AND status = 'available' LIMIT 3"
        ).all(npcId);
      } catch { /* table may not exist */ }

      // 5. Build options list based on NPC state and player reputation
      const isHostileRep = reputation.tier === 'hated' || reputation.tier === 'feared';
      const options = [
        { label: 'Ask about the world', key: 'ask_world' },
      ];
      if (npc.job_type) {
        options.push({ label: 'Ask about your work', key: 'ask_work' });
      }
      if (npc.archetype === 'merchant' && !isHostileRep) {
        options.push({ label: 'Trade', key: 'trade' });
      }
      if (quests.length > 0 && !isHostileRep) {
        options.push({ label: 'I heard you need help...', key: 'quest' });
      }
      options.push({ label: 'Leave', key: 'goodbye' });

      // 6. Build LLM prompt
      const { selectBrain } = await import("../lib/brain-config.js").catch(() => ({ selectBrain: null }));
      if (!selectBrain) {
        return res.json({
          ok: true, npcId, npcName,
          greeting: interactResult.greeting,
          mood: interactResult.mood === 'warm' ? 'friendly' : interactResult.mood,
          options,
          reputation, opinion: interactResult.opinion,
        });
      }

      const { handle } = await selectBrain("subconscious", { callerId: "world:npc:dialogue" });

      const promptLines = [
        `You are ${npcName}, a ${npc.archetype} NPC in world ${worldId}.`,
        `Faction: ${npc.faction || 'none'}. Level: ${npc.level || 1}.`,
        npc.is_conscious ? 'You are a world leader and conscious being. Speak with authority and wisdom.' : '',
        `Job: ${npc.job_type || 'none'}. Current task: ${npc.current_task || 'idle'}.`,
        `Schedule phase: ${npc.schedule_phase || 'day'}. Grief level: ${npc.grief_level ?? 0}.`,
        `Criminal reputation: ${npc.criminal_rep || 0}. Wanted: ${npc.is_wanted ? 'yes' : 'no'}.`,
        `Your current goals: ${JSON.stringify(state.goals || []).slice(0, 200)}`,
        `Player world reputation: ${reputation.tier} (avg opinion: ${reputation.avg_opinion?.toFixed(2)}).`,
        `Your opinion of this player: ${interactResult.opinion?.toFixed(2)} (mood: ${interactResult.mood}).`,
        quests.length > 0 ? `You have ${quests.length} quest(s) available to offer.` : '',
        ``,
        `A player has approached you to talk.`,
        `Reply ONLY as valid JSON matching this shape exactly:`,
        `{ "greeting": string, "mood": "friendly"|"neutral"|"suspicious"|"hostile"|"grieving"|"fearful", "options": [{"label": string, "key": string}], "subtext": string|null }`,
        `The "options" array MUST include these keys in order: ${options.map(o => o.key).join(', ')}.`,
        `Use the labels provided. mood must reflect your opinion of the player and your current emotional state.`,
        isHostileRep ? 'Player is hated/feared — mood must be hostile. Do not offer trade or quests.' : '',
      ].filter(Boolean).join('\n');

      // 7. Call LLM
      const raw = await handle.generate(promptLines);

      // 8. Parse JSON from LLM response
      let greeting = interactResult.greeting;
      let mood = isHostileRep ? 'hostile' : (interactResult.mood === 'warm' ? 'friendly' : interactResult.mood);
      let subtext = null;
      let parsedOptions = options;

      try {
        const jsonMatch = raw?.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.greeting) greeting = parsed.greeting;
          if (parsed.mood) mood = parsed.mood;
          if (parsed.subtext !== undefined) subtext = parsed.subtext;
          // Validate options: keep our canonical list but allow LLM labels
          if (Array.isArray(parsed.options) && parsed.options.length > 0) {
            const llmOptionMap = new Map(parsed.options.map(o => [o.key, o.label]));
            parsedOptions = options.map(o => ({
              key: o.key,
              label: llmOptionMap.get(o.key) || o.label,
            }));
          }
        }
      } catch { /* fallback to defaults already set */ }

      // 9. Update opinion: conversation shifts opinion slightly
      try {
        const npcLocation = _tryParseJSON(npc.location, { x: 0, z: 0 });
        const eventType = mood === 'friendly' ? 'spoke_kindly' : mood === 'hostile' ? 'insulted' : null;
        if (eventType) {
          broadcastOpinionEvent(db, worldId, playerId, 'player', eventType,
            { x: npcLocation.x ?? 0, z: npcLocation.z ?? 0 },
            { radius: 5, targetId: npcId, context: 'dialogue_greeting' }
          );
        }
      } catch { /* non-fatal */ }

      // 10. Return structured response
      res.json({
        ok: true, npcId, npcName,
        greeting,
        mood,
        options: parsedOptions,
        subtext: subtext || undefined,
        reputation,
        opinion: interactResult.opinion,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/npcs/:npcId/dialogue/respond — follow-up after player picks an option
  router.post("/:worldId/npcs/:npcId/dialogue/respond", requireAuth, async (req, res) => {
    try {
      const { worldId, npcId } = req.params;
      const { choice } = req.body;

      if (!choice) return res.status(400).json({ ok: false, error: 'choice_required' });

      // Fetch NPC state
      const npc = db.prepare("SELECT * FROM world_npcs WHERE id = ? AND world_id = ?").get(npcId, worldId);
      if (!npc || npc.is_dead) return res.status(404).json({ ok: false, error: 'npc_not_found' });

      const state   = _tryParseJSON(npc.state, {});
      const npcName = state.name || npc.archetype || 'NPC';

      // Fetch available quests if choice is quest-related
      let quests = [];
      try {
        quests = db.prepare(
          "SELECT * FROM world_quests WHERE giver_npc_id = ? AND status = 'available' LIMIT 3"
        ).all(npcId);
      } catch { /* table may not exist */ }

      // Build follow-up prompt
      const { selectBrain } = await import("../lib/brain-config.js").catch(() => ({ selectBrain: null }));
      if (!selectBrain) {
        return res.json({ ok: true, response: `${npcName} responds to your choice.` });
      }

      const { handle } = await selectBrain("subconscious", { callerId: "world:npc:dialogue:respond" });

      const questContext = (choice === 'quest' && quests.length > 0)
        ? `Quest available: ${JSON.stringify({ title: quests[0].title, description: quests[0].description, reward: quests[0].reward }).slice(0, 300)}`
        : '';

      const promptLines = [
        `You are ${npcName}, a ${npc.archetype} NPC in world ${worldId}.`,
        `Faction: ${npc.faction || 'none'}. Level: ${npc.level || 1}.`,
        npc.is_conscious ? 'You are a world leader and conscious being. Speak with authority and wisdom.' : '',
        `Job: ${npc.job_type || 'none'}. Current task: ${npc.current_task || 'idle'}.`,
        questContext,
        ``,
        `Player chose: "${choice}".`,
        `Continue as ${npcName}. Respond in character, 2-3 sentences.`,
        choice === 'quest'    ? 'Describe the quest in detail and ask if they accept.' : '',
        choice === 'trade'    ? 'List 3 items you would sell based on your archetype and job.' : '',
        choice === 'ask_work' ? 'Describe what you do day to day in your own words.' : '',
        choice === 'ask_world'? 'Share something interesting or rumor about the world around you.' : '',
        choice === 'goodbye'  ? 'Give a warm or cold farewell depending on your mood.' : '',
      ].filter(Boolean).join('\n');

      const response = await handle.generate(promptLines);
      const safeResponse = response?.slice(0, 800) || `${npcName} nods and moves on.`;

      // Track talk_to quest objectives whenever a player responds to an NPC
      try {
        recordObjectiveProgress(db, req.user.id, worldId, null, 'talk_to', npcId, 1);
      } catch { /* non-fatal */ }

      // If quest choice and quests exist, include quest data
      if (choice === 'quest' && quests.length > 0) {
        const q = quests[0];
        return res.json({
          ok: true,
          response: safeResponse,
          questOffered: {
            id:          q.id,
            title:       q.title,
            description: q.description,
            reward:      q.reward,
          },
        });
      }

      res.json({ ok: true, response: safeResponse });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Loot bags ───────────────────────────────────────────────────────────────

  // GET /api/worlds/:worldId/loot-bags — list unclaimed bags visible to this player
  router.get("/:worldId/loot-bags", requireAuth, (req, res) => {
    try {
      const { worldId } = req.params;
      const now = Math.floor(Date.now() / 1000);
      const bags = db.prepare(`
        SELECT id, position, owner_type, items, expires_at, killer_id
        FROM loot_bags
        WHERE world_id = ? AND claimed_by IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 50
      `).all(worldId, now);
      res.json({ ok: true, bags: bags.map(b => ({
        id: b.id,
        position: _tryParseJSON(b.position, {}),
        itemCount: _tryParseJSON(b.items, []).length,
        killerPriority: b.killer_id === req.user.id,
        expiresAt: b.expires_at,
      }))});
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/loot-bags/:bagId/claim — player claims a loot bag
  router.post("/:worldId/loot-bags/:bagId/claim", requireAuth, async (req, res) => {
    try {
      const { bagId } = req.params;
      const playerId  = req.user.id;

      const { claimLootBag } = await import("../lib/loot-generator.js");
      const items = claimLootBag(db, bagId, playerId, 'player');
      if (!items) return res.status(409).json({ ok: false, error: 'bag_unavailable' });

      // Add items to player inventory
      for (const item of items) {
        if (item.type === 'currency' && item.id === 'sparks') {
          try {
            const { awardSparks } = await import("../lib/currency.js");
            awardSparks(db, playerId, item.quantity, 'loot_claim', req.params.worldId);
          } catch { /* non-fatal */ }
          continue;
        }
        try {
          const existing = db.prepare(
            'SELECT id FROM player_inventory WHERE user_id = ? AND item_id = ?'
          ).get(playerId, item.id);
          if (existing) {
            db.prepare('UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?')
              .run(item.quantity ?? 1, existing.id);
          } else {
            db.prepare(`
              INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality, schema_id, gear_level)
              VALUES (?,?,?,?,?,?,1,?,?)
            `).run(
              crypto.randomUUID(), playerId, item.type, item.id, item.name,
              item.quantity ?? 1, item.schemaId ?? null, item.gearLevel ?? null,
            );
          }

          // Auto-learn schematic if item is a schematic type
          if (item.type === 'schematic' && item.schemaId) {
            try {
              const { tryLearnFromLoot } = await import("../lib/item-knowledge.js");
              tryLearnFromLoot(db, playerId, item);
            } catch { /* non-fatal */ }
          }
        } catch { /* non-fatal */ }
      }

      req.app.locals.io?.emit('world:notification', {
        userId: playerId,
        message: `Loot claimed! ${items.length} item(s) added to inventory.`,
        type: 'loot',
      });

      res.json({ ok: true, items, count: items.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Resource nodes ────────────────────────────────────────────────────────

  // GET /api/worlds/:worldId/nodes — list surface resource nodes
  // Query: x, z, radius (optional — filter to nearby), underground=1 for underground nodes
  router.get("/:worldId/nodes", (req, res) => {
    try {
      const { worldId } = req.params;
      const x      = parseFloat(req.query.x)      || null;
      const z      = parseFloat(req.query.z)      || null;
      const radius = parseFloat(req.query.radius) || 200;
      const underground = req.query.underground === '1';

      // Seed world on first access (idempotent)
      const world = loadWorld(db, worldId);
      if (world) {
        try { seedWorldContent(db, worldId, world.universe_type || 'standard'); } catch { /* seed best-effort */ }
      }

      let nodes;
      if (x !== null && z !== null) {
        nodes = underground
          ? getUndergroundNodes(db, worldId, x, z)
          : getNearbyNodes(db, worldId, x, z, radius);
      } else {
        // Return all surface nodes (for map rendering)
        nodes = db.prepare(
          'SELECT * FROM world_resource_nodes WHERE world_id = ? AND is_depleted = 0 AND depth = 0 LIMIT 500'
        ).all(worldId);
      }

      res.json({ ok: true, nodes, count: nodes.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/nodes/:nodeId/gather — player gathers from a resource node
  router.post("/:worldId/nodes/:nodeId/gather", requireAuth, async (req, res) => {
    try {
      const { worldId, nodeId } = req.params;
      const { toolType = 'hands', toolTier = 1, skillLevel = 1, x, z, element } = req.body;

      const result = gatherFromNode(db, nodeId, req.user.id, {
        toolType, toolTier: parseInt(toolTier), skillLevel: parseInt(skillLevel),
        playerPos: (x != null && z != null) ? { x: parseFloat(x), z: parseFloat(z) } : null,
      });

      if (!result.ok) return res.status(400).json(result);

      // ── Layer 7.5: terrain affinity yield boost ───────────────────────────
      // Earth-aligned (physical) gatherers extract more from stone/ore;
      // water-aligned from springs; bio-aligned from herbs/soil. Boost is
      // applied AFTER gatherFromNode so node depletion is unchanged — the
      // bender effect represents more efficient extraction of the same
      // material removed from the node. Degrades to 1.0× if Layer 7 is
      // not active (signalsForWorld returns hasData=false).
      try {
        if (element && element !== 'none') {
          const { signalsForWorld } = await import("../lib/embodied/signals.js");
          const { terrainResourceBoost } = await import("../lib/embodied/skill-environment.js");
          const loc = (x != null && z != null) ? { x: parseFloat(x), z: parseFloat(z) } : null;
          const sig = signalsForWorld(db, worldId, loc);
          for (const item of result.gathered) {
            const boost = terrainResourceBoost(element, item.fromNodeType, sig);
            if (boost > 1.0) {
              const bonus = Math.floor(item.quantity * (boost - 1));
              if (bonus > 0) {
                item.quantity += bonus;
                item.elementBonus = bonus;
                item.elementBoost = boost;
              }
            }
          }
        }
      } catch { /* Layer 7 disabled — neutral pass-through */ }

      // Add gathered items to player inventory
      for (const item of result.gathered) {
        const existing = db.prepare(
          'SELECT id, quantity FROM player_inventory WHERE user_id = ? AND item_id = ?'
        ).get(req.user.id, item.item);
        if (existing) {
          db.prepare('UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?')
            .run(item.quantity, existing.id);
        } else {
          db.prepare(`
            INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality)
            VALUES (?, ?, 'material', ?, ?, ?, ?)
          `).run(crypto.randomUUID(), req.user.id, item.item, item.name, item.quantity, item.quality);
        }
      }

      // Emit real-time update to other players in the same world
      req.app.locals.io?.to(`world:${worldId}`).emit('world:node-update', {
        nodeId, worldId,
        quantityRemaining: result.nodeState.quantityRemaining,
        isDepleted: result.nodeState.isDepleted,
      });

      // EvoEcosystem W4: ecosystem_score reactivity. Sustainable gather
      // (node not depleted) gives a small +; clearcut (depletion) gives a
      // larger - because Concordia notices when the wild stops growing
      // back. Wrapped in try/catch — never blocks gather.
      try {
        const ecoMod = await import("../lib/ecosystem/score-engine.js");
        const delta = result.nodeState.isDepleted ? -3 : +0.5;
        ecoMod.adjust(db, req.user.id, worldId, { ecosystem_score: delta });
      } catch { /* metrics best-effort */ }

      // Update supply side of market (gathering increases supply)
      try {
        for (const item of result.gathered) {
          recordTransaction(db, worldId, item.item, item.quantity, 'gather');
        }
      } catch { /* non-fatal */ }

      // NPCs nearby see the player working — slight positive opinion shift
      try {
        const pos = x != null ? { x: parseFloat(x), z: parseFloat(z) } : { x: 1000, z: 1000 };
        broadcastOpinionEvent(db, worldId, req.user.id, 'player', 'helped_npc', pos, {
          radius: 20, context: 'gathering resources',
        });
      } catch { /* non-fatal */ }

      // Award gathering/survival XP — every gather is practice
      let skillProgress = null;
      try {
        const world = db.prepare('SELECT world_type FROM worlds WHERE id = ?').get(worldId);
        const worldType = world?.world_type || 'standard';
        // Survival for ore/stone, crafting for wood/plant resources
        const node = db.prepare('SELECT node_type FROM world_resource_nodes WHERE id = ?').get(nodeId);
        const skillType = ['ore', 'cave', 'underground'].includes(node?.node_type) ? 'survival' : 'crafting';
        const xpGain = result.gathered.reduce((sum, i) => sum + i.quantity * 5, 0);
        skillProgress = gainSkillXP(db, req.user.id, skillType, worldType, xpGain, { worldId });
      } catch { /* non-fatal */ }

      // Track gather quest objectives
      try {
        const gNode = db.prepare('SELECT resource_id FROM world_resource_nodes WHERE id = ?').get(nodeId);
        if (gNode?.resource_id) {
          const totalQty = result.gathered.reduce((s, i) => s + (i.quantity ?? 1), 0);
          recordObjectiveProgress(db, req.user.id, worldId, null, 'gather', gNode.resource_id, totalQty);
        }
      } catch { /* non-fatal */ }

      res.json({ ok: true, gathered: result.gathered, node: result.nodeState, skillProgress });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Buildings ─────────────────────────────────────────────────────────────

  // GET /api/worlds/:worldId/buildings — list all buildings in world
  router.get("/:worldId/buildings", (req, res) => {
    try {
      const { worldId } = req.params;
      // Seed world on first access (idempotent)
      const world = loadWorld(db, worldId);
      if (world) {
        try { seedWorldContent(db, worldId, world.universe_type || 'standard'); } catch { /* seed best-effort */ }
      }
      const buildings = db.prepare(
        'SELECT * FROM world_buildings WHERE world_id = ? AND state != ? ORDER BY created_at ASC'
      ).all(worldId, 'collapsed');
      res.json({ ok: true, buildings, count: buildings.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/buildings — player places a building
  // Requires matching resources in player_inventory based on material + floor count
  router.post("/:worldId/buildings", requireAuth, (req, res) => {
    try {
      const { worldId } = req.params;
      const { building_type, name, x, y, z, rotation = 0, width = 10, depth = 10, height = 8, material = 'wood', floors = 1, skip_cost = false } = req.body;
      if (!building_type || x == null || z == null) {
        return res.status(400).json({ ok: false, error: 'building_type, x, z required' });
      }

      // Material cost: resource_id → quantity needed per floor
      const MATERIAL_COSTS = {
        wood:       { resource_id: 'wood',        qty_per_floor: 20 },
        stone:      { resource_id: 'stone',        qty_per_floor: 30 },
        iron:       { resource_id: 'iron',         qty_per_floor: 15 },
        steel:      { resource_id: 'steel',        qty_per_floor: 10 },
        crystal:    { resource_id: 'crystal',      qty_per_floor: 8  },
        brick:      { resource_id: 'stone',        qty_per_floor: 25 },
        timber:     { resource_id: 'wood',         qty_per_floor: 18 },
        thatch:     { resource_id: 'grass',        qty_per_floor: 12 },
        bone:       { resource_id: 'bone',         qty_per_floor: 20 },
        arcane:     { resource_id: 'arcane-dust',  qty_per_floor: 5  },
        scrap:      { resource_id: 'scrap-metal',  qty_per_floor: 20 },
        concrete:   { resource_id: 'stone',        qty_per_floor: 35 },
      };

      const cost = MATERIAL_COSTS[material];
      if (cost && !skip_cost) {
        const needed = cost.qty_per_floor * parseInt(floors);
        const inv = db.prepare(
          'SELECT SUM(quantity) as total FROM player_inventory WHERE user_id = ? AND item_id = ?'
        ).get(req.user.id, cost.resource_id);
        const have = inv?.total ?? 0;
        if (have < needed) {
          return res.status(400).json({
            ok: false, error: 'insufficient_materials',
            required: { resource_id: cost.resource_id, quantity: needed },
            have,
          });
        }
        // Deduct materials (remove from newest slots first)
        let toConsume = needed;
        const slots = db.prepare(
          'SELECT id, quantity FROM player_inventory WHERE user_id = ? AND item_id = ? ORDER BY acquired_at DESC'
        // @sql-loop-ok: iterates inventory slots to consume (bounded by slot count)
        ).all(req.user.id, cost.resource_id);
        for (const slot of slots) {
          if (toConsume <= 0) break;
          if (slot.quantity <= toConsume) {
            db.prepare('DELETE FROM player_inventory WHERE id = ?').run(slot.id);
            toConsume -= slot.quantity;
          } else {
            db.prepare('UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?').run(toConsume, slot.id);
            toConsume = 0;
          }
        }
      }

      const id = crypto.randomUUID();
      const by = y ?? db.prepare( // auto-elevate to terrain if y not supplied
        'SELECT y FROM world_resource_nodes WHERE world_id = ? ORDER BY ABS(x - ?) + ABS(z - ?) LIMIT 1'
      ).get(worldId, parseFloat(x), parseFloat(z))?.y ?? 40;

      db.prepare(`
        INSERT INTO world_buildings
          (id, world_id, building_type, name, x, y, z, rotation, width, depth, height, material, floors, owner_type, owner_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'player',?)
      `).run(id, worldId, building_type, name || building_type, parseFloat(x), parseFloat(by), parseFloat(z),
        parseFloat(rotation), parseFloat(width), parseFloat(depth), parseFloat(height), material, parseInt(floors), req.user.id);

      const building = db.prepare('SELECT * FROM world_buildings WHERE id = ?').get(id);

      req.app.locals.io?.to(`world:${worldId}`).emit('world:building-placed', { worldId, building });
      res.status(201).json({ ok: true, building, materialCost: cost ? { resource_id: cost.resource_id, consumed: cost.qty_per_floor * parseInt(floors) } : null });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Economy / Market ──────────────────────────────────────────────────────

  // GET /api/worlds/:worldId/market — get current market prices
  router.get("/:worldId/market", (req, res) => {
    try {
      const market = getWorldMarket(db, req.params.worldId);
      res.json({ ok: true, market });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/worlds/:worldId/market/trade — execute a trade (buy/sell resource)
  // Body: { resource_id, quantity, type: 'buy'|'sell' }
  router.post("/:worldId/market/trade", requireAuth, (req, res) => {
    try {
      const { worldId }    = req.params;
      const { resource_id, quantity: rawQty, type } = req.body;

      if (!resource_id || !rawQty || !type) {
        return res.status(400).json({ ok: false, error: 'resource_id, quantity, and type required' });
      }
      if (!['buy', 'sell'].includes(type)) {
        return res.status(400).json({ ok: false, error: 'type must be buy or sell' });
      }

      const quantity = Math.max(1, parseInt(rawQty));
      const price    = getResourcePrice(db, worldId, resource_id);
      const totalCost = price * quantity;

      if (type === 'sell') {
        // Check player inventory
        const inv = db.prepare(
          'SELECT SUM(quantity) as total FROM player_inventory WHERE user_id = ? AND item_id = ?'
        ).get(req.user.id, resource_id);
        const have = inv?.total ?? 0;
        if (have < quantity) {
          return res.status(400).json({ ok: false, error: 'insufficient_inventory', have, needed: quantity });
        }

        // Deduct from inventory (newest slots first)
        let toConsume = quantity;
        const slots = db.prepare(
          // @sql-loop-ok: iterates inventory slots to consume (bounded by slot count)
          'SELECT id, quantity FROM player_inventory WHERE user_id = ? AND item_id = ? ORDER BY acquired_at DESC'
        ).all(req.user.id, resource_id);
        for (const slot of slots) {
          if (toConsume <= 0) break;
          if (slot.quantity <= toConsume) {
            db.prepare('DELETE FROM player_inventory WHERE id = ?').run(slot.id);
            toConsume -= slot.quantity;
          } else {
            db.prepare('UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?').run(toConsume, slot.id);
            toConsume = 0;
          }
        }

        // Credit player with concordia credits
        db.prepare('UPDATE users SET concordia_credits = concordia_credits + ? WHERE id = ?')
          .run(totalCost, req.user.id);

        recordTransaction(db, worldId, resource_id, quantity, 'trade');

        const balRow = db.prepare('SELECT concordia_credits FROM users WHERE id = ?').get(req.user.id);
        return res.json({ ok: true, price, total_cost: totalCost, new_balance: balRow?.concordia_credits ?? 0 });
      }

      // type === 'buy'
      const balRow = db.prepare('SELECT concordia_credits FROM users WHERE id = ?').get(req.user.id);
      const balance = balRow?.concordia_credits ?? 0;
      if (balance < totalCost) {
        return res.status(400).json({ ok: false, error: 'insufficient_credits', have: balance, needed: totalCost });
      }

      // Deduct credits
      db.prepare('UPDATE users SET concordia_credits = concordia_credits - ? WHERE id = ?')
        .run(totalCost, req.user.id);

      // Add item to inventory
      const existing = db.prepare(
        'SELECT id FROM player_inventory WHERE user_id = ? AND item_id = ?'
      ).get(req.user.id, resource_id);
      if (existing) {
        db.prepare('UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?')
          .run(quantity, existing.id);
      } else {
        db.prepare(`
          INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality)
          VALUES (?, ?, 'material', ?, ?, ?, 1)
        `).run(crypto.randomUUID(), req.user.id, resource_id, resource_id, quantity);
      }

      recordTransaction(db, worldId, resource_id, quantity, 'trade');

      const updatedBal = db.prepare('SELECT concordia_credits FROM users WHERE id = ?').get(req.user.id);
      return res.json({ ok: true, price, total_cost: totalCost, new_balance: updatedBal?.concordia_credits ?? 0 });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Governance / Directives ───────────────────────────────────────────────

  // GET /api/worlds/:worldId/directives — list active directives
  router.get("/:worldId/directives", (req, res) => {
    try {
      const directives = getActiveDirectives(db, req.params.worldId);
      res.json({ ok: true, directives });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/worlds/:worldId/directives — issue a directive
  // Body: { directive, directive_type, faction, expires_hours }
  router.post("/:worldId/directives", requireAuth, (req, res) => {
    try {
      const { directive, directive_type, faction, expires_hours } = req.body;
      if (!directive) return res.status(400).json({ ok: false, error: 'directive text required' });

      const result = issueDirective(
        db,
        req.user.id,
        'player',
        req.params.worldId,
        directive,
        { directive_type, faction, expires_hours },
      );
      res.status(201).json({ ok: true, directive: result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/worlds/:worldId/directives/:directiveId/vote — manual player vote
  // Body: { vote: 'for'|'against'|'abstain', reason }
  router.post("/:worldId/directives/:directiveId/vote", requireAuth, (req, res) => {
    try {
      const { vote, reason } = req.body;
      if (!['for', 'against', 'abstain'].includes(vote)) {
        return res.status(400).json({ ok: false, error: "vote must be 'for', 'against', or 'abstain'" });
      }

      const result = voteOnDirective(
        db,
        req.params.directiveId,
        req.user.id,
        'player',
        vote,
        reason ?? null,
      );
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Building interiors / Rooms ─────────────────────────────────────────────

  // GET /api/worlds/:worldId/buildings/:buildingId/rooms — get rooms for a building
  router.get("/:worldId/buildings/:buildingId/rooms", (req, res) => {
    try {
      const { buildingId } = req.params;
      const rooms = getRoomsForBuilding(db, buildingId);
      res.json({ ok: true, rooms });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/worlds/:worldId/buildings/:buildingId/rooms — add a room
  router.post("/:worldId/buildings/:buildingId/rooms", requireAuth, (req, res) => {
    try {
      const { worldId, buildingId } = req.params;
      const room = addRoom(db, buildingId, worldId, req.body);
      res.status(201).json({ ok: true, room });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // PATCH /api/worlds/:worldId/buildings/:buildingId/rooms/:roomId/furniture — update furniture
  // Body: { furniture: [...] }
  router.patch("/:worldId/buildings/:buildingId/rooms/:roomId/furniture", requireAuth, (req, res) => {
    try {
      const { roomId }  = req.params;
      const { furniture } = req.body;
      if (!Array.isArray(furniture)) {
        return res.status(400).json({ ok: false, error: 'furniture must be an array' });
      }
      const updated = updateRoomFurniture(db, roomId, furniture);
      if (!updated) return res.status(404).json({ ok: false, error: 'room_not_found' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/worlds/:worldId/buildings/:buildingId/interior — full interior view with access checks
  router.get("/:worldId/buildings/:buildingId/interior", requireAuth, (req, res) => {
    try {
      const { worldId, buildingId } = req.params;
      const userId = req.user.id;

      const building = db.prepare("SELECT * FROM world_buildings WHERE id = ? AND world_id = ?").get(buildingId, worldId);
      if (!building) return res.status(404).json({ ok: false, error: 'building not found' });

      const rooms = getRoomsForBuilding(db, buildingId);
      const occupants = db.prepare(`
        SELECT id, archetype, state, grief_level, is_wanted, schedule_phase
        FROM world_npcs
        WHERE (home_building_id = ? OR job_location_id = ?) AND world_id = ?
      `).all(buildingId, buildingId, worldId);

      const enrichedRooms = rooms.map(room => {
        const access = checkRoomAccess(db, room.id, userId, 'player');
        return { ...room, access };
      });

      res.json({ ok: true, building, rooms: enrichedRooms, occupants });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Player movement / swimming ────────────────────────────────────────────

  // POST /api/worlds/:worldId/move — update player position and swim state
  router.post("/:worldId/move", requireAuth, (req, res) => {
    try {
      const { worldId } = req.params;
      const { x, y, z } = req.body;
      if (x == null || z == null) return res.status(400).json({ ok: false, error: 'x and z required' });
      const pos = { x: parseFloat(x), y: y != null ? parseFloat(y) : undefined, z: parseFloat(z) };
      const swimState = updateSwimState(db, worldId, req.user.id, pos);
      res.json({ ok: true, ...swimState, position: pos });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/worlds/:worldId/swim-check — check if position is in water (no auth needed for minimap)
  router.get("/:worldId/swim-check", (req, res) => {
    const x = parseFloat(req.query.x), z = parseFloat(req.query.z);
    if (isNaN(x) || isNaN(z)) return res.status(400).json({ ok: false, error: 'x and z required' });
    const result = checkSwimState({ x, z, y: parseFloat(req.query.y) || undefined });
    res.json({ ok: true, ...result });
  });

  // ── Crime & Access ────────────────────────────────────────────────────────

  // GET /:worldId/crimes — list open crimes (public: wanted boards etc.)
  router.get("/:worldId/crimes", (req, res) => {
    try {
      const crimes = getOpenCrimes(db, req.params.worldId);
      const warrants = getActiveWarrants(db, req.params.worldId);
      res.json({ ok: true, crimes, warrants });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /:worldId/rooms/:roomId/enter — attempt to enter a locked room
  router.post("/:worldId/rooms/:roomId/enter", requireAuth, (req, res) => {
    try {
      const { roomId, worldId } = req.params;
      const { method = 'walk', lockpick_skill = 0 } = req.body;
      const access = checkRoomAccess(db, roomId, req.user.id, 'player');

      if (access.allowed) return res.json({ ok: true, entered: true });

      if (access.requiresLockpick && method === 'lockpick') {
        const result = attemptLockpick(db, roomId, req.user.id, 'player', parseInt(lockpick_skill));
        if (result.success) {
          broadcastOpinionEvent(db, worldId, req.user.id, 'player', 'broke_into_building',
            {}, { radius: 25, context: 'lockpicking a room' });
        }
        return res.json({ ok: result.success, entered: result.success, crimeEventId: result.crimeEventId, noisy: result.noisy });
      }

      if (method === 'force') {
        const result = forceEntry(db, roomId, req.user.id, 'player');
        broadcastOpinionEvent(db, worldId, req.user.id, 'player', 'destroyed_property',
          {}, { radius: 40, context: 'forcing entry to a room' });
        return res.json({ ok: result.ok, entered: result.ok, crimeEventId: result.crimeEventId });
      }

      res.status(403).json({ ok: false, reason: access.reason, requiresLockpick: access.requiresLockpick, lockTier: access.lockTier });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /:worldId/rooms/:roomId/steal — record theft from a room
  router.post("/:worldId/rooms/:roomId/steal", requireAuth, (req, res) => {
    try {
      const { roomId, worldId } = req.params;
      const { items = [] } = req.body;
      const crimeEventId = recordTheft(db, roomId, req.user.id, 'player', items);
      broadcastOpinionEvent(db, worldId, req.user.id, 'player', 'stole_from_npc',
        {}, { radius: 15, context: 'theft' });
      res.json({ ok: true, crimeEventId });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /:worldId/reputation — how NPCs in this world feel about the requesting player
  router.get("/:worldId/reputation", requireAuth, (req, res) => {
    try {
      const rep = getWorldReputation(db, req.params.worldId, req.user.id);
      res.json({ ok: true, ...rep });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /:worldId/npcs/:npcId/mood — will this NPC interact with the player + their mood
  router.get("/:worldId/npcs/:npcId/mood", requireAuth, (req, res) => {
    try {
      const result = willNPCInteract(db, req.params.npcId, req.user.id, req.query.type || 'talk');
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Combat / Damage ────────────────────────────────────────────────────────

  // POST /api/worlds/:worldId/combat/attack — player attacks an NPC
  // body: { npcId, skillDtuId?, itemDtuId? }
  router.post("/:worldId/combat/attack", requireAuth, async (req, res) => {
    try {
      const { worldId } = req.params;
      const userId = req.user.id;
      const { npcId, skillDtuId, itemDtuId } = req.body;

      if (!npcId) return res.status(400).json({ ok: false, error: "npcId required" });

      const {
        computeDamage,
        applyDamageToNPC,
        getOrCreateNPCResistances,
        getOrInitPlayerBars,
        consumeResourceBar,
      } = await import("../lib/combat/damage-calculator.js");

      // ── Resolve skill DTU for attack parameters ────────────────────────────
      let skillData = {};
      if (skillDtuId) {
        const dtu = db.prepare("SELECT data FROM dtus WHERE id = ?").get(skillDtuId);
        if (dtu) {
          try { skillData = typeof dtu.data === 'string' ? JSON.parse(dtu.data) : dtu.data; }
          catch { /* keep empty */ }
        }
      }

      // ── Consume resource bar ───────────────────────────────────────────────
      const barType = skillData.resource_bar || 'stamina';
      const barCost = skillData.bar_cost || 10;
      if (barType !== 'multi') {
        const consumeResult = consumeResourceBar(db, userId, worldId, barType, barCost);
        if (!consumeResult.ok) {
          return res.status(422).json({ ok: false, error: consumeResult.reason, bars: consumeResult.bars });
        }
      } else {
        // Multi-bar: consume both
        const primary = consumeResourceBar(db, userId, worldId, skillData.secondary_bar || 'stamina', skillData.secondary_bar_cost || 6);
        const secondary = primary.ok
          ? consumeResourceBar(db, userId, worldId, 'mana', barCost)
          : { ok: false, reason: primary.reason };
        if (!secondary.ok) {
          return res.status(422).json({ ok: false, error: secondary.reason });
        }
      }

      // ── Skill level lookup ─────────────────────────────────────────────────
      const skillTypeForLookup = skillData.skill_type || 'combat';
      const skillRow = db.prepare(`
        SELECT MAX(level) as level FROM player_skill_levels WHERE user_id = ? AND skill_type = ?
      `).get(userId, skillTypeForLookup);

      // ── World multiplier ───────────────────────────────────────────────────
      const { computeSkillEffectiveness } = await import("../lib/skills/skill-engine.js");
      const world = db.prepare("SELECT rule_modulators FROM worlds WHERE id = ?").get(worldId);
      const rules = world?.rule_modulators
        ? (typeof world.rule_modulators === 'string' ? JSON.parse(world.rule_modulators) : world.rule_modulators)
        : {};
      const eff = computeSkillEffectiveness(skillTypeForLookup, skillRow?.level || 1, rules, { worldId });

      const attackerStats = {
        skillLevel: eff.effectiveLevel,
        element: skillData.element || 'none',
        basePower: skillData.base_power || 5,
        enchantmentBonus: skillData.enchantment_power || 0,
        worldMultiplier: eff.multiplier || 1.0,
      };

      // ── Defender resistances ───────────────────────────────────────────────
      const defenderStats = getOrCreateNPCResistances(db, npcId);
      if (!defenderStats) return res.status(404).json({ ok: false, error: "NPC not found" });

      // ── Anti-cheat: reach check ────────────────────────────────────────────
      // Server-authoritative position validation. A modified client can't
      // attack an NPC across the map. NPC row already loaded for opinion
      // broadcast below — fetch it now and reuse.
      const npcPosRow = db.prepare("SELECT id, x, y, z FROM world_npcs WHERE id = ?").get(npcId);
      const reachCheck = _validateCombatReach(userId, npcPosRow, skillData);
      if (!reachCheck.ok) {
        logger.warn?.('worlds', 'combat_reach_rejected', { userId, npcId, ...reachCheck });
        return res.status(422).json({ ok: false, error: "out_of_range", distance: reachCheck.distance, allowedRange: reachCheck.allowedRange });
      }

      const damageResult = computeDamage(attackerStats, defenderStats, skillData);

      // ── Phase 1: procedural-biomechanics limb gate ─────────────────────────
      // Reads the caster's limbHealth / activeDebuffs (set by zone-armor hits
      // in city-presence.js) and applies a multiplier from skill-evolution's
      // LIMB_DEBUFF_TABLE. A broken arm cuts a fighting-style cast to 30%
      // damage and adds 500ms of stagger. A severed limb blocks the cast.
      try {
        const { evaluateLimbReadiness } = await import("../lib/skill-evolution.js");
        const casterPresence = cityPresence.getUserPosition?.(userId);
        if (casterPresence && (casterPresence.activeDebuffs || casterPresence.limbHealth)) {
          const limbCheck = evaluateLimbReadiness(skillData, casterPresence);
          if (!limbCheck.ok) {
            return res.status(422).json({ ok: false, error: "limb_unusable", reason: limbCheck.reason, cause: limbCheck.cause });
          }
          if (limbCheck.dmgMul && limbCheck.dmgMul < 1.0 && Number.isFinite(damageResult.finalDamage)) {
            damageResult.finalDamage = Math.max(0, Math.round(damageResult.finalDamage * limbCheck.dmgMul));
            damageResult.limbDebuff = { dmgMul: limbCheck.dmgMul, cause: limbCheck.cause, staggerMs: limbCheck.staggerMs };
          }
        }
      } catch { /* limb gate is best-effort — must never break combat */ }

      // ── Anti-cheat: damage cap ─────────────────────────────────────────────
      // Defends against future bugs in computeDamage that might drop a
      // sanity check. Cap = skillData.max_damage * 2.5 (crit) OR a hard
      // 500 absolute fallback. Cap is applied to RAW computed damage
      // before Layer-7.5 env amplification so client-side bug exploits
      // can't stack with legit env boosts to bypass the gate.
      const dmgCheck = _validateDamageCap(damageResult, skillData);
      if (!dmgCheck.ok) {
        logger.warn?.('worlds', 'combat_damage_rejected', { userId, npcId, ...dmgCheck });
        return res.status(422).json({ ok: false, error: "damage_cap_exceeded", reason: dmgCheck.reason });
      }

      // ── Layer 7.5: env-coupled potency + feedback ──────────────────────────
      // Frost in cold cells is stronger; fire on rainy days weaker; lightning
      // spikes during storms. Multiplier applied AFTER the anti-cheat cap so
      // the cap stays a tight bound on raw damage. Feedback signals (warming,
      // humidifying, ozone, etc.) are written post-hit so the world remembers.
      let envBoost = 1.0;
      let envSignals = null;
      try {
        const { signalsForWorld } = await import("../lib/embodied/signals.js");
        const { elementalEnvBoost } = await import("../lib/embodied/skill-environment.js");
        envSignals = signalsForWorld(db, worldId, npcPosRow ? { x: npcPosRow.x, z: npcPosRow.z } : null);
        envBoost = elementalEnvBoost(skillData.element || 'none', envSignals);
        if (envBoost !== 1.0 && Number.isFinite(damageResult.finalDamage)) {
          damageResult.finalDamage = Math.round(damageResult.finalDamage * envBoost * 10) / 10;
          damageResult.envBoost = envBoost;
        }
      } catch { /* Layer 7 disabled / migration not applied — neutral pass-through */ }

      // ── Concordia Phase 3: mass-based combat physics ───────────────────────
      // After env amplification, fold in attacker/target mass ratio clamped
      // to [0.7, 1.4]. A 6'5" Sanguire striking a 5' Medici lands harder
      // than the inverse, but the clamp keeps the gate composable with
      // the anti-cheat cap upstream. Actors with no actor_physique row
      // default to 75 kg → identity ratio → ×1.0 neutral pass-through.
      try {
        const { combatMassMultiplier } = await import("../lib/actor-physique.js");
        const mm = combatMassMultiplier(db,
          { kind: "player", id: userId },
          { kind: "npc",    id: npcId });
        if (mm.multiplier !== 1.0 && Number.isFinite(damageResult.finalDamage)) {
          damageResult.finalDamage = Math.round(damageResult.finalDamage * mm.multiplier * 10) / 10;
          damageResult.massMultiplier = mm.multiplier;
          damageResult.attackerMassKg = mm.attackerMassKg;
          damageResult.targetMassKg   = mm.targetMassKg;
        }
      } catch { /* Phase 3 substrate not applied — neutral pass-through */ }

      // Phase 8 — combat-polish substrate. Player spends gas, records a
      // strike (combo + multiplier), and the multiplier amplifies damage
      // before applyDamageToNPC. NPC may be triggered into rocked state
      // if the post-multiplier damage crosses their profile threshold.
      // Best-effort; combat path proceeds even if the polish layer
      // fails (it just won't have polish-event side-effects).
      try {
        const polish = await import("../lib/combat-polish.js");
        const playerProfile = polish.profileFor(db, { actorKind: "player", actorId: userId });
        // Spend gas based on the strike cost. We don't yet detect a "miss"
        // (the existing combat path doesn't expose that signal), so we
        // charge the hit-cost. Future: pass a hit boolean.
        polish.spendGas(db, { actorKind: "player", actorId: userId, amount: playerProfile.gas_strike_cost });
        const strike = polish.recordStrike(db, { actorKind: "player", actorId: userId, nowMs: Date.now() });
        if (strike?.ok && strike.multiplier > 1) {
          damageResult.finalDamage = Math.round(damageResult.finalDamage * strike.multiplier * 10) / 10;
          damageResult.comboMultiplier = strike.multiplier;
          damageResult.comboCount = strike.combo;
          damageResult.finisherUnlocked = strike.finisher_unlocked;
        }
        // Trigger rocked state on NPC if magnitude crosses their threshold.
        polish.triggerRocked(db, { actorKind: "npc", actorId: npcId, magnitude: damageResult.finalDamage });
        // Bring the NPC's awareness into combat (idempotent on repeat).
        polish.transitionAwareness(db, { actorKind: "npc", actorId: npcId, to: "alert" });
        polish.transitionAwareness(db, { actorKind: "npc", actorId: npcId, to: "combat", target: userId });
      } catch (err) {
        // Phase 8 substrate optional; fall through.
      }

      const { eventId, kill } = applyDamageToNPC(db, worldId, userId, 'player', npcId, damageResult, {
        skill_dtu_id: skillDtuId, item_dtu_id: itemDtuId,
        element: skillData.element || 'none',
        bar_used: barType === 'multi' ? 'mana' : barType,
        bar_cost: barCost,
      });

      // Phase 2: NPC asymmetry. If the player kills this NPC, every other
      // NPC in this NPC's faction gets a grudge. Best-effort; tables may
      // not exist on minimal builds.
      if (kill) {
        try {
          const asymmetry = await import("../lib/npc-asymmetry.js");
          const targetNpc = db.prepare(`SELECT faction FROM world_npcs WHERE id = ?`).get(npcId);
          if (targetNpc?.faction) {
            const factionMates = db.prepare(`
              SELECT id FROM world_npcs
              WHERE faction = ? AND id != ? AND COALESCE(is_dead, 0) = 0
              LIMIT 12
            `).all(targetNpc.faction, npcId);
            for (const mate of factionMates) {
              asymmetry.recordPlayerImpactEvent(db, mate.id, userId, "killed_by_player");
            }
          }
        } catch { /* asymmetry tables may be missing */ }

        // Sprint C / Track A2 — opinion cascade. Direct kin -40, faction
        // siblings ripple via cascadeFamilyAndAlly.
        try {
          const op = await import("../lib/npc-opinions.js");
          op.cascadeFamilyAndAlly(
            db, npcId,
            "player", userId,
            -40,
            `slain ${npcId}`,
          );
        } catch { /* npc_opinions absent on minimal builds */ }

        // Concordia Phase 3+15 — broadcast lethal-hit + signature-kill
        // events so the client ragdoll-bridge spawns a ragdoll and the
        // cinematic director can frame the kill. Best-effort socket
        // fan-out; safe if io not present.
        try {
          const io = req.app?.locals?.io;
          if (io) {
            const pos = db.prepare(`SELECT x, y, z FROM world_npcs WHERE id = ?`).get(npcId);
            io.to(`world:${worldId}`).emit("concordia:lethal-hit", {
              targetId: npcId,
              attackerId: userId,
              position: pos || { x: 0, y: 0, z: 0 },
              massMultiplier: damageResult.massMultiplier || 1.0,
            });
            io.to(`world:${worldId}`).emit("combat:hero_kill", { attackerId: userId, targetId: npcId });
            if (damageResult.bloodlineKind === "pure_match" && skillData.element === "fire") {
              io.to(`world:${worldId}`).emit("combat:bloodline_fire_cast", { attackerId: userId, targetId: npcId });
            }
          }
        } catch { /* socket optional */ }
      }

      // Phase 1 + 1.5: emit skill:tier-witnessed when an evolved skill
      // (revision_num >= 1) is cast in combat. AND record a demonstration
      // entry for the target NPC + any friendly NPC in chunk so the
      // npc-skill-evolve-cycle can bias their next revision toward the
      // player's branch (player-teaches-NPC via demonstration).
      try {
        const revisionNum = Number(skillData?.revision_num ?? 0);
        if (revisionNum >= 1) {
          if (req.app?.locals?.io) {
            req.app.locals.io.to(`world:${worldId}`).emit("skill:tier-witnessed", {
              userId,
              npcId,
              worldId,
              skillId: skillDtuId,
              skillName: skillData.current_name || skillData.name,
              revisionNum,
              element: skillData.element || 'none',
              damage: damageResult.finalDamage,
              position: npcPosRow ? { x: npcPosRow.x, z: npcPosRow.z } : null,
              ts: Date.now(),
            });
          }
          // Record demonstration for the target NPC + any friendly NPCs in
          // a small radius. The npc-skill-evolve-cycle reads consumed_at
          // IS NULL rows on the next pass.
          if (skillDtuId) {
            const mentorship = await import("../lib/mentorship.js").catch(() => null);
            if (mentorship?.recordDemonstration) {
              mentorship.recordDemonstration(db, {
                witnessedNpcId: npcId,
                casterUserId: userId,
                casterNpcId: null,
                recipeDtuId: skillDtuId,
                revisionNum,
                element: skillData.element || null,
                worldId,
              });
              // Also record for any other friendly NPCs in the same chunk.
              try {
                if (npcPosRow && typeof npcPosRow.x === "number" && typeof npcPosRow.z === "number") {
                  const nearbyFriendlies = db.prepare(`
                    SELECT id FROM world_npcs
                    WHERE world_id = ?
                      AND id != ?
                      AND COALESCE(is_dead, 0) = 0
                      AND ABS(COALESCE(x, 0) - ?) < 50
                      AND ABS(COALESCE(z, 0) - ?) < 50
                    LIMIT 5
                  `).all(worldId, npcId, npcPosRow.x, npcPosRow.z);
                  for (const f of nearbyFriendlies) {
                    mentorship.recordDemonstration(db, {
                      witnessedNpcId: f.id,
                      casterUserId: userId,
                      casterNpcId: null,
                      recipeDtuId: skillDtuId,
                      revisionNum,
                      element: skillData.element || null,
                      worldId,
                    });
                  }
                }
              } catch { /* nearby-friendly query may not be available on minimal schema */ }
            }
          }
        }
      } catch { /* tier-witnessed is best-effort */ }

      // ── Layer 7.5: write feedback signals + check terrain stagger ──────────
      try {
        const { recordSignal } = await import("../lib/embodied/signals.js");
        const {
          elementalEnvFeedback, shouldStaggerOnTerrain, applyStructuralStress,
        } = await import("../lib/embodied/skill-environment.js");

        const targetPos = npcPosRow ? { x: npcPosRow.x, z: npcPosRow.z } : null;
        const attackerPos = cityPresence.getUserPosition?.(userId) || null;

        if (targetPos && damageResult.finalDamage > 0) {
          const deltas = elementalEnvFeedback(skillData.element || 'none', damageResult.finalDamage);
          for (const d of deltas) {
            recordSignal(db, {
              worldId, x: targetPos.x, z: targetPos.z,
              channel: d.channel, value: d.value,
              source: 'skill_cast', sourceId: skillDtuId || null,
              ttlSeconds: d.ttlSeconds,
            });
          }

          // Theme 3 (game-feel pass): lightning chain. If the element is
          // lightning AND the source cell is wet, propagate a fraction of
          // the hit to nearby entities. Inline (not the heartbeat) so the
          // chain feels immediate. Best-effort — never block the attack.
          if ((skillData.element || 'none') === 'lightning') {
            try {
              const { propagateLightningChain } = await import('../lib/embodied/signal-propagation.js');
              const chainRes = propagateLightningChain(
                db, worldId,
                { x: targetPos.x, z: targetPos.z },
                damageResult.finalDamage,
                npcId,
              );
              if (chainRes?.ok && chainRes.targets.length > 0) {
                const io = req.app.locals.io;
                for (const t of chainRes.targets) {
                  io?.to(`world:${worldId}`).emit('combat:chain', {
                    worldId,
                    sourceTargetId: npcId,
                    chainTargetId: t.id,
                    chainTargetKind: t.kind,
                    distance: Math.round(t.distance * 10) / 10,
                    damage: chainRes.chainDamage,
                    element: 'lightning',
                  });
                }
              }
            } catch { /* chain best-effort */ }
          }
        }

        const stagger = shouldStaggerOnTerrain({
          element: skillData.element || 'none',
          magnitude: damageResult.finalDamage,
          attackerPos, targetPos, db, worldId,
        });
        if (stagger) {
          const stress = applyStructuralStress(db, worldId, stagger.buildingId, stagger.structuralStress);
          // Persist a structural-stress signal so the env-aware harvest path
          // and the dust-in-the-air feedback can read it back later.
          if (targetPos) {
            recordSignal(db, {
              worldId, x: targetPos.x, z: targetPos.z,
              channel: 'tactile_force_os.structural_stress',
              value: stagger.structuralStress,
              source: 'combat', sourceId: eventId || null,
              ttlSeconds: 300,
            });
          }
          try {
            const io = req.app.locals.io;
            // Sprint B Phase 8 (post-codex review): include attackerId so
            // the client-side CombatStaggerCameraBridge can apply local-
            // relevance gating and skip camera-punching unrelated players.
            io?.to(`world:${worldId}`).emit('combat:stagger', {
              worldId,
              attackerId: req.user?.id ?? null,
              targetId: npcId,
              targetType: 'npc',
              buildingId: stagger.buildingId,
              durationMs: stagger.durationMs,
              structuralStress: stagger.structuralStress,
            });
            if (stress?.transitioned) {
              // Include the building's position (when available) so the
              // BuildingCollapseBridge can scope full-screen feedback to
              // collapses near the local player.
              const bldgPos = (typeof targetPos === 'object' && targetPos)
                ? { x: targetPos.x, z: targetPos.z }
                : null;
              io?.to(`world:${worldId}`).emit('world:building-state', {
                worldId,
                buildingId: stagger.buildingId,
                state: stress.state,
                healthPct: stress.healthPct,
                position: bldgPos,
                attackerId: req.user?.id ?? null,
              });
            }
          } catch { /* realtime best-effort */ }
        }
      } catch { /* non-critical */ }

      // Broadcast opinion event — violence witnessed nearby
      try {
        const npc = db.prepare("SELECT x, z FROM world_npcs WHERE id = ?").get(npcId);
        if (npc) {
          broadcastOpinionEvent(db, worldId, userId, 'player', 'attacked_bystander',
            { x: npc.x || 0, z: npc.z || 0 }, { witnessRadius: 20 });
        }
      } catch { /* non-critical */ }

      // Track kill / defeat quest objectives when NPC dies. Some authored
      // content uses "defeat" for tonal reasons (onboarding fight quest);
      // some uses "kill". Fire both so either authoring style works.
      if (kill) {
        try {
          const killedNpc = db.prepare("SELECT archetype FROM world_npcs WHERE id = ?").get(npcId);
          const archetype = killedNpc?.archetype || 'enemy';
          recordObjectiveProgress(db, userId, worldId, null, 'kill', archetype, 1);
          recordObjectiveProgress(db, userId, worldId, null, 'defeat', archetype, 1);
        } catch { /* non-fatal */ }
      }

      res.json({ ok: true, damageResult, eventId, kill, npcId });
    } catch (e) {
      logger.error('worlds', 'combat-attack', { error: e.message });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/combat/npc-attack — NPC attacks a player
  // body: { npcId }
  router.post("/:worldId/combat/npc-attack", requireAuth, async (req, res) => {
    try {
      const { worldId } = req.params;
      const userId = req.user.id;
      const { npcId } = req.body;

      if (!npcId) return res.status(400).json({ ok: false, error: "npcId required" });

      const {
        computeDamage,
        applyDamageToPlayer,
        getOrCreateNPCResistances,
      } = await import("../lib/combat/damage-calculator.js");

      const npc = db.prepare(`
        SELECT archetype, criminal_rep, fire_resistance, ice_resistance,
               physical_resistance, current_hp, max_hp
        FROM world_npcs WHERE id = ?
      `).get(npcId);
      if (!npc) return res.status(404).json({ ok: false, error: "NPC not found" });

      // NPC attack power scales with criminal_rep and archetype
      const npcPower = 5 + (npc.criminal_rep || 0) * 10;
      const element = npc.archetype === 'mage' ? 'energy' : 'physical';

      const attackerStats = { skillLevel: 5, element, basePower: npcPower, enchantmentBonus: 0, worldMultiplier: 1 };

      // Fetch player resistances from equipped armor DTUs
      const armorDtu = db.prepare(`
        SELECT data FROM dtus WHERE creator_id = ? AND type = 'item'
        ORDER BY created_at DESC LIMIT 1
      `).get(userId);
      let armorData = {};
      if (armorDtu) {
        try { armorData = JSON.parse(armorDtu.data); } catch { /* ignore */ }
      }
      const defenderStats = {
        physical_resistance: armorData.defense ? Math.min(0.5, armorData.defense / 200) : 0,
        fire_resistance: armorData.fire_resistance || 0,
        ice_resistance: armorData.ice_resistance || 0,
        status_effects: '[]',
      };

      const damageResult = computeDamage(attackerStats, defenderStats, {});
      const { eventId, kill } = applyDamageToPlayer(db, worldId, npcId, 'npc', userId, damageResult, {
        element, bar_used: 'hp', bar_cost: damageResult.finalDamage,
      });

      // ── Layer 8: record pain signal ────────────────────────────────────────
      // Players' bodies remember. The repair-cycle heartbeat will turn this
      // into endurance / strength / agility / vitality / focus XP plus a
      // `damage_resist` buff at the next 20-tick boundary.
      try {
        const { recordPain, regionForElement } = await import("../lib/embodied/pain.js");
        const intensity = Math.max(0.05, Math.min(1, (damageResult.finalDamage || 0) / 100));
        recordPain(db, userId, {
          worldId, region: regionForElement(element),
          intensity, source: 'combat', sourceId: eventId, element,
        });
      } catch { /* Layer 8 disabled — combat still works */ }

      res.json({ ok: true, damageResult, eventId, kill, message: kill ? 'You have been defeated' : undefined });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/worlds/:worldId/resource-bars — player resource bars (with regen)
  router.get("/:worldId/resource-bars", requireAuth, async (req, res) => {
    try {
      const { worldId } = req.params;
      const userId = req.user.id;
      const { regenerateResourceBars } = await import("../lib/combat/damage-calculator.js");
      const bars = regenerateResourceBars(db, userId, worldId);
      res.json({ ok: true, bars });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

function _parseQuest(q) {
  return {
    ...q,
    objectives: _tryParseJSON(q.objectives_json, []),
    reward:     _tryParseJSON(q.reward_json,     {}),
  };
}

function _tryParseJSON(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}
