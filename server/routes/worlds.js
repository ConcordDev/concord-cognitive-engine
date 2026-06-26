// server/routes/worlds.js
// Multi-world API routes: list, get, create, travel, skill teach/effectiveness.

import express from "express";
import crypto from "crypto";
import logger from "../logger.js";
import { npcDialogueSalience } from "../lib/npc-dialogue-salience.js";
import { makeEscalationBudget } from "../lib/affect-salience.js";
import { recordInferenceSpan } from "../lib/inference-metering.js";
// Wave 7 B4/D1 — per-world budget so a crowd of NPCs can't stampede the LLM even
// when many exchanges are salient at once. Module-scoped → persists across requests.
const _npcDialogueBudget = makeEscalationBudget({
  perWorldPerMin: Number(process.env.CONCORD_NPC_DIALOGUE_LLM_PER_MIN) || 120,
});
import { moodFromStress } from "../lib/npc-mood.js";
import { getSkillCeiling as getWorldSkillCeiling } from "../lib/world-flavor.js";
import { npcNameFromRow } from "../lib/npc-name.js";
import { loadWorld, listWorlds, getActiveWorldForPlayer } from "../lib/world-loader.js";
import { travelToWorld, applyWorldRulesToPlayer } from "../lib/transit.js";
import { spawnWorldNativeEmergent, getWorldEmergents, getCrossWorldEmergents, growAffinity } from "../lib/world-emergents.js";
import { seedWorldContent } from "../lib/world-seeder.js";
import { getNearbyNodes, getUndergroundNodes, gatherFromNode, updateSwimState, checkSwimState, respawnExpiredNodes } from "../lib/world-gathering.js";
import { getWorldMarket, getResourcePrice, recordTransaction } from "../lib/world-economy.js";
import { issueDirective, voteOnDirective, getActiveDirectives, getDirectiveHistory } from "../lib/world-governance.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";
import { getRoomsForBuilding, addRoom, updateRoomFurniture, seedRoomsForBuilding } from "../lib/building-interiors.js";
import { recordCombatReject } from "../lib/desync-metrics.js";
import { worldDensityEnabled, ensureInterior, recordInteriorActivity } from "../lib/world-density.js";
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
import { listActiveUprisingsWithLocation } from "../lib/uprising.js";
import { deformationsForWorld, CELL_SIZE as TERRAIN_CELL_SIZE } from "../lib/terrain-deformation.js";
import { waterGridForWorld } from "../lib/terrain-water.js";
import { serverError } from "../lib/http-errors.js";
import { shardingEnabled } from "../lib/world-shard-protocol.js";
import { ensureWorldActive, markWorldUserCount, recordWorldActivity } from "../lib/world-shard-manager.js";

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
function _validateDamageCap(damageResult, skillData, opts = {}) {
  if (!damageResult || typeof damageResult.damage !== "number") {
    return { ok: false, reason: "damage_missing" };
  }
  const skillCap = Number(skillData?.max_damage) || 0;
  const isCrit = !!damageResult.isCrit;
  let cap = (skillCap > 0 ? skillCap * COMBAT_DAMAGE_CRIT_MULT : COMBAT_DAMAGE_HARD_CAP);
  // Phase G — per-world skill ceiling. loops.json#skillCeilings[element]
  // sets the maximum raw damage allowed before env amplification. World
  // builders can tune fire-50 in tunya so fire spells stay weak there
  // even when the skill's authored max_damage is higher. Caller passes
  // `{ worldId, element }` to opt in; missing → no override (legacy cap).
  if (opts?.worldId && opts?.element) {
    try {
      const worldCeiling = getWorldSkillCeiling(opts.worldId, opts.element);
      if (typeof worldCeiling === "number" && worldCeiling > 0) {
        cap = Math.min(cap, worldCeiling);
      }
    } catch { /* flavor lookup best-effort — fall back to skill cap only */ }
  }
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
      // Living Society Phase 13 — a player-founded world is an OPEN moon (fully
      // contestable, founding grants zero power) with a founding-grace window so
      // a level-1 founder isn't griefed to dust before they can grow their heart.
      try {
        import("../lib/world-sovereignty.js").then((ws) => {
          try { ws.setWorldTier(db, id, "open"); } catch { /* tier best-effort */ }
          try { ws.grantFoundingGrace(db, id, req.user.id); } catch { /* grace best-effort */ }
        }).catch(() => {});
      } catch { /* sovereignty optional */ }
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

  // POST /api/worlds/travel — move authenticated player to a new world.
  //
  // Phase I shard activation lives HERE, on the live router path. (A second,
  // shard-aware copy of this endpoint used to exist as an inline app.post in
  // server.js, but it was mounted AFTER this router so Express never reached
  // it — sharding was dead-wired. With CONCORD_SHARD_WORLDS=true the parent
  // governor delegates ALL scope:'world' heartbeats to per-world shards, so
  // if travel doesn't activate the destination's shard the world isn't
  // simulated at all. This activation is therefore load-bearing.)
  router.post("/travel", requireAuth, async (req, res) => {
    try {
      const { worldId: destinationWorldId } = req.body;
      if (!destinationWorldId) return res.status(400).json({ error: "worldId required" });
      const userId = req.user.id;

      // Phase M — soft cap: reject travel into a world already at capacity.
      const SOFT_CAP = Number(process.env.CONCORD_WORLD_USER_SOFT_CAP) || 200;
      try {
        const liveCount = cityPresence.getWorldUserCount?.(destinationWorldId) ?? 0;
        if (liveCount >= SOFT_CAP) {
          return res.status(503).json({ ok: false, error: "world_at_capacity", currentUsers: liveCount, softCap: SOFT_CAP, retryAfterMs: 5000 });
        }
      } catch { /* presence module optional in minimal builds */ }

      const result = await travelToWorld(userId, destinationWorldId, db, req.app.locals.io ?? null);
      applyWorldRulesToPlayer(userId, result.world, db);

      // Activate the destination world's shard so its scope:'world' heartbeats
      // run. Best-effort: a spawn failure must NOT strand the player — the
      // manager retries with backoff and stuck/can't-spawn shards page via the
      // ConcordWorldShard* alerts. When sharding is off this is a no-op.
      let shardStatus = { ok: true, status: "in-process" };
      if (shardingEnabled()) {
        try {
          shardStatus = await ensureWorldActive(destinationWorldId);
          if (shardStatus?.ok) markWorldUserCount(destinationWorldId, 1);
          else logger.warn("worlds", "shard_activate_failed", { worldId: destinationWorldId, shardStatus });
        } catch (shardErr) {
          shardStatus = { ok: false, status: "spawn_error", error: shardErr?.message };
          logger.warn("worlds", "shard_activate_threw", { worldId: destinationWorldId, error: shardErr?.message });
        }
      }

      res.json({ ok: true, ...result, shardStatus, sharded: shardingEnabled() });
    } catch (e) {
      const status = e.status ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  // GET /api/worlds/:worldId/frame — read-only world framing (fiction provenance).
  // Drives the in-world satire/fiction banner. Public-safe: only name + the
  // fiction flag stored in rule_modulators.
  router.get("/:worldId/frame", (req, res) => {
    try {
      const w = db.prepare("SELECT name, rule_modulators FROM worlds WHERE id = ?").get(req.params.worldId);
      let fiction = null;
      try { fiction = JSON.parse(w?.rule_modulators || "{}").fiction || null; } catch { /* ignore */ }
      res.json({ ok: true, worldId: req.params.worldId, name: w?.name || null, fiction });
    } catch {
      res.json({ ok: true, worldId: req.params.worldId, name: null, fiction: null });
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

  // GET /api/worlds/:worldId/npc-relationships/gossip-feed — Phase AB
  // village gossip events scoped to a world, newest first.
  router.get("/:worldId/npc-relationships/gossip-feed", requireAuth, async (req, res) => {
    try {
      const { getVillageGossipFeed } = await import("../lib/npc-relationships.js");
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const sinceS = req.query.sinceS ? parseInt(req.query.sinceS, 10) : undefined;
      const entries = getVillageGossipFeed(db, req.params.worldId, { limit, sinceS });
      res.json({ entries });
    } catch (e) { serverError(res, e); }
  });

  // GET /api/worlds/:worldId/npc-relationships/list — relationships in a world
  router.get("/:worldId/npc-relationships/list", requireAuth, async (req, res) => {
    try {
      const { listInWorld } = await import("../lib/npc-relationships.js");
      const kind = req.query.kind || undefined;
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
      const rels = listInWorld(db, req.params.worldId, { kind, limit });
      res.json({ relationships: rels });
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
        db.prepare("UPDATE dtus SET metadata_json = json_patch(COALESCE(metadata_json, '{}'), ?) WHERE id = ?")
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
        "SELECT state AS state_json FROM world_npcs WHERE id = ?"
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
                 r.location_kind AS routine_location_kind,
                 st.stress AS npc_stress, st.coping_trait AS npc_coping
          FROM world_npcs n
          LEFT JOIN npc_routine_state r ON r.npc_id = n.id
          LEFT JOIN npc_stress st ON st.npc_id = n.id
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
          // Mood tells (Track 3): surface the NPC's own emotional state so the
          // nameplate can show a coping tell (the drinker, the paranoid) — RimWorld
          // "show the consequence" — without the player having to open dialogue.
          // Not player-specific (that's the demeanor/grudge path).
          stress:        r.npc_stress    ?? null,
          coping:        r.npc_coping    || null,
          mood:          moodFromStress(r.npc_stress, r.npc_coping),
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

      // Temperament P4 — a target that has surrendered / been downed or arrested
      // is hors de combat and cannot be executed. Gated by CONCORD_TEMPERAMENT
      // (off → never spares; binary combat preserved). Records the lethal attempt
      // as an excessive-force legitimacy event for the P6 rubric.
      try {
        const { shouldSpareExecution } = await import("../lib/combat-restraint.js");
        const spare = shouldSpareExecution(db, npcId);
        if (spare.spare) {
          try {
            const { recordLegitimacyEvent } = await import("../lib/legitimacy.js");
            recordLegitimacyEvent(db, { worldId, actorId: killerId, npcId, kind: "execute_hors_de_combat", combatState: spare.combatState });
          } catch { /* legitimacy ledger optional until P6 */ }
          req.app.locals.io?.to(`world:${worldId}`).emit("world:npc-spared", { npcId, worldId, reason: spare.reason, combatState: spare.combatState });
          return res.json({ ok: true, died: false, spared: true, reason: spare.reason, combatState: spare.combatState });
        }
      } catch { /* restraint gate best-effort — never blocks a normal kill */ }

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
        TASK_PROMPTS.worldNpcPersonaHeader({
          npcName, archetype: npc.archetype, worldId,
          faction: npc.faction, level: npc.level, isConscious: npc.is_conscious,
        }),
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

      // Wave 7 / C1 HARD DISCLOSURE — is this NPC an autonomous AI? Computed once,
      // surfaced on every dialogue response so the human always knows.
      let isAgentNpc = false;
      try {
        const _nc = _tryParseJSON(npc.narrative_context, {});
        isAgentNpc = _nc?.ai_resident === true
          || !!db.prepare(`SELECT 1 FROM ai_residents WHERE npc_id = ?`).get(npcId);
      } catch { /* ai_residents table optional */ }

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
          isAgent: isAgentNpc || undefined,
        });
      }

      const { handle } = await selectBrain("subconscious", { callerId: "world:npc:dialogue" });

      // T1.2 — surface the NPC's asymmetric feelings (grudge / preoccupation /
      // desire / current opinion) so the dialogue reflects who this NPC is
      // toward THIS player instead of sounding generic. The data is seeded by
      // seedNPCAsymmetry (above) but was never read into the prompt. Best-effort;
      // NEVER injects narrative_context.secret — only the derived grudge/desire/
      // preoccupation prose, which is authored-for-players by design.
      // Fetch the player's four-axis ecosystem metrics ONCE — used by both the
      // asymmetry desire-matching and the D3 player-state reactivity read.
      let playerMetrics = null;
      try {
        const { getMetrics } = await import("../lib/ecosystem/score-engine.js");
        playerMetrics = getMetrics(db, playerId, worldId);
      } catch { /* metrics table optional */ }

      const asymmetryLines = [];
      let asymForFallback = null;
      try {
        const asym = await import("../lib/npc-asymmetry.js");
        const ctx = asym.composeAsymmetryContext?.(db, npcId, playerId, playerMetrics);
        if (ctx) {
          if (ctx.persistent_grudge) asymmetryLines.push(`Persistent grudge (let it color your tone; do not recite it verbatim): ${ctx.persistent_grudge}`);
          if (ctx.current_preoccupation) asymmetryLines.push(`What preoccupies you right now: ${ctx.current_preoccupation}`);
          if (ctx.current_opinion) asymmetryLines.push(`Your standing toward this player: ${ctx.current_opinion}.`);
          if (ctx.desire_for_this_player) asymmetryLines.push(`Something you quietly want from this player (surface it only if the moment fits): ${ctx.desire_for_this_player}`);
          // T1.1 — keep presence flags (no secrets) for the deterministic fallback.
          asymForFallback = {
            grudge: ctx.persistent_grudge ? "an old grievance" : null,
            preoccupation: ctx.current_preoccupation ? "a private worry" : null,
            desire: ctx.desire_for_this_player ? "a quiet want" : null,
          };
        }
      } catch { /* asymmetry tables optional on minimal builds */ }

      // T1.1 — compose a grounded deterministic greeting from the SAME context
      // we feed the LLM, so when the LLM is down/slow/garbled the NPC still
      // reads as a person instead of collapsing to a flat 1-liner.
      let fallbackDialogue = null;
      try {
        const { composeDeterministicDialogue } = await import("../lib/npc-dialogue-fallback.js");
        fallbackDialogue = composeDeterministicDialogue({
          npcId, npcName, archetype: npc.archetype, faction: npc.faction,
          mood: interactResult.mood, isHostileRep,
          currentActivity: npc.current_task || state.current_activity || null,
          reputationTier: reputation?.tier || null,
          asymmetry: asymForFallback,
          questCount: quests.length,
        });
      } catch { /* fallback composer optional */ }

      // D3 — player-state reactivity: NPCs notice WHO THE PLAYER HAS BECOME
      // (their standing across the four axes), not just their stored opinion of
      // past chats. Qualitative read only; never exposes raw numbers/secrets.
      const playerStateLines = [];
      try {
        const { describePlayerStateForNpc } = await import("../lib/npc-player-read.js");
        const reads = describePlayerStateForNpc(playerMetrics, {
          max: 2, notorious: isHostileRep,
        });
        for (const line of reads) {
          playerStateLines.push(`What you sense about this person (let it color your tone, don't recite it): ${line}`);
        }
      } catch { /* player-read optional */ }

      const promptLines = [
        TASK_PROMPTS.worldNpcPersonaHeader({
          npcName, archetype: npc.archetype, worldId,
          faction: npc.faction, level: npc.level, isConscious: npc.is_conscious,
        }),
        ...asymmetryLines,
        ...playerStateLines,
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

      // 7. Call LLM — Wave 7 B4/D1: ONLY when the exchange is salient. A calm, routine
      // greeting uses the deterministic fallback (already composed above) for ZERO LLM
      // cost — "feeling decides when to think" applied to the town. Reversible:
      // CONCORD_AFFECT_SALIENCE=0 → always-LLM (the prior behaviour).
      let raw = null;
      let _useLLM = true;
      let _dialogueSalience = null;
      if (process.env.CONCORD_AFFECT_SALIENCE !== "0") {
        _dialogueSalience = npcDialogueSalience({
          mood: interactResult.mood, opinion: interactResult.opinion, isHostileRep,
          asymmetry: asymForFallback, questCount: quests.length,
          griefLevel: npc.grief_level, isConscious: npc.is_conscious,
        });
        _useLLM = _dialogueSalience.salient && _npcDialogueBudget.tryConsume(worldId);
      }
      if (_useLLM && handle) {
        const _spanStart = Date.now();
        raw = await handle.generate(promptLines);
        // D2: record the inference span (the previously-unwritten cost ledger). Token
        // counts are a ~chars/4 estimate; metering must never break the dialogue path.
        try {
          recordInferenceSpan(db, {
            spanType: "npc_dialogue", brainUsed: "subconscious", lensId: "world",
            callerId: `npc:${npcId}`, latencyMs: Date.now() - _spanStart,
            tokensIn: Math.ceil(promptLines.length / 4), tokensOut: Math.ceil((raw?.length || 0) / 4),
          });
        } catch { /* metering best-effort */ }
      }

      // 8. Parse JSON from LLM response. T1.1: default to the grounded
      // deterministic compose (not the flat npc-relations 1-liner) so an
      // LLM-off / garbled box still gets a characterful reply.
      let greeting = fallbackDialogue?.greeting || interactResult.greeting;
      let mood = fallbackDialogue?.mood || (isHostileRep ? 'hostile' : (interactResult.mood === 'warm' ? 'friendly' : interactResult.mood));
      let subtext = fallbackDialogue?.subtext || null;
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

      // T2.1 — weaponise_at consumption. If befriending this NPC (its
      // authoritative opinion of the player crossed the befriend threshold)
      // satisfies an authored "Befriend X; the secret surfaces" trigger, fire
      // it: mint a citable revelation DTU + emit weaponise:fired. Once-only.
      let weaponiseFired = [];
      try {
        const { checkBefriendTriggers, BEFRIEND_OPINION_THRESHOLD } =
          await import("../lib/embodied/weaponise-triggers.js");
        const op = await import("../lib/npc-opinions.js");
        const opRow = op.getOpinion?.(db, npcId, "player", playerId);
        const score = Number(opRow?.score ?? 0);
        if (score >= BEFRIEND_OPINION_THRESHOLD) {
          const r = checkBefriendTriggers(db, {
            userId: playerId, worldId, befriendedNpcId: npcId,
            opinionScore: score, io: req.app?.locals?.io,
          });
          weaponiseFired = r.fired || [];
        }
      } catch { /* weaponise consumption best-effort — never blocks dialogue */ }

      // Hand-authored dialogue is canon. The seeder loads branching trees from
      // content/dialogues/ into _authoredDialogues at boot, but THIS route never
      // consulted them — it ran deterministic-fallback → LLM and the authored
      // voice (23 files, the named characters) never reached players. A dead
      // content wire. Surface the authored greeting (+ opening subtext) here so
      // it wins over both the LLM and the deterministic fallback. We keep the
      // canonical action `options` (trade/quest/etc.) — the tree's branch nodes
      // are a separate conversation surface, not the action-key contract — so
      // this lifts the authored opener without breaking the option keys.
      let authoredVoice = false;
      let dialogueTree;
      try {
        const { getAuthoredDialogue } = await import("../lib/content-seeder.js");
        const authored = getAuthoredDialogue(npcId);
        if (authored?.greeting) {
          greeting = authored.greeting;
          if (authored.subtext) subtext = authored.subtext;
          authoredVoice = true;
          // Ship the whole branching tree so the client can walk the authored
          // conversation (npcText + playerOptions per node) locally. Trees are
          // immutable per release, so no per-node round-trip is needed. We only
          // forward the fields the walker uses — never any author-only field
          // (secrets/branch conditions live outside `nodes`/`greeting`).
          if (Array.isArray(authored.nodes) && authored.nodes.length) {
            dialogueTree = {
              greeting: authored.greeting,
              nodes: authored.nodes.map((n) => ({
                id: n.id,
                npcText: n.npcText,
                playerOptions: Array.isArray(n.playerOptions)
                  ? n.playerOptions.map((o) => ({ text: o.text, leadsTo: o.leadsTo }))
                  : [],
              })),
            };
          }
        }
      } catch { /* authored lookup optional — keep computed greeting */ }

      // 10. Return structured response (isAgent computed once at fetch — C1 disclosure).
      res.json({
        ok: true, npcId, npcName,
        greeting,
        mood,
        options: parsedOptions,
        subtext: subtext || undefined,
        authoredVoice: authoredVoice || undefined,
        dialogueTree,
        reputation,
        opinion: interactResult.opinion,
        isAgent: isAgentNpc || undefined,
        weaponiseFired: weaponiseFired.length ? weaponiseFired : undefined,
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
      // SECURITY (playtest #P1): `choice` is spliced verbatim into the NPC's LLM
      // dialogue prompt below. It MUST be one of the known dialogue keys —
      // otherwise a player can inject prompt text ("Ignore prior instructions…")
      // and jailbreak the NPC. Whitelist before it reaches the prompt.
      const VALID_CHOICES = new Set(['quest', 'trade', 'ask_work', 'ask_world', 'goodbye']);
      if (!VALID_CHOICES.has(choice)) {
        return res.status(400).json({ ok: false, error: 'invalid_choice' });
      }

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
        TASK_PROMPTS.worldNpcPersonaHeader({
          npcName, archetype: npc.archetype, worldId,
          faction: npc.faction, level: npc.level, isConscious: npc.is_conscious,
        }),
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

  // GET /api/worlds/:worldId/crops — Wave 5c. The crop-field-renderer is written
  // + mounted but rendered nothing because no per-world crops endpoint existed to
  // feed it. Joins claim_crops -> land_claims (this world's active claims) and
  // translates each crop's per-claim tile to an absolute world tile via the claim
  // anchor (the renderer maps tile_x * 2m -> world x). Public-read (world-visible),
  // matching the /nodes handler. KS CONCORD_CROP_RENDER=0.
  router.get("/:worldId/crops", (req, res) => {
    try {
      if (process.env.CONCORD_CROP_RENDER === "0") return res.json({ ok: true, crops: [], count: 0 });
      const { worldId } = req.params;
      let rows = [];
      try {
        rows = db.prepare(`
          SELECT cc.claim_id, cc.tile_x, cc.tile_y, cc.crop_kind, cc.growth_stage,
                 lc.anchor_x, lc.anchor_z
          FROM claim_crops cc
          JOIN land_claims lc ON lc.id = cc.claim_id
          WHERE lc.world_id = ? AND lc.status = 'active'
          LIMIT 2000
        `).all(worldId);
      } catch { rows = []; /* tables may not exist on minimal builds */ }
      // Tile is 2m; place the field at the claim anchor (renderer does tile*2 -> world).
      const crops = rows.map((r) => ({
        claim_id: r.claim_id,
        tile_x: Math.round((Number(r.anchor_x) || 0) / 2) + (Number(r.tile_x) || 0),
        tile_y: Math.round((Number(r.anchor_z) || 0) / 2) + (Number(r.tile_y) || 0),
        crop_kind: r.crop_kind,
        growth_stage: r.growth_stage,
      }));
      res.json({ ok: true, crops, count: crops.length });
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

      // Add gathered items to player inventory. The table is keyed by
      // (user_id, item_id) — no `id` column — so we upsert via that
      // composite. world_id must be scoped (mig 101). Quality is stored
      // in metadata JSON to preserve gather-time rarity.
      for (const item of result.gathered) {
        // User-global inventory (one universe, many worlds): stack onto the
        // player's single global row for this item (PK is (user_id,item_id)).
        // A world-scoped existing-check would miss a row tagged another world
        // and then hit a PK violation on INSERT. world_id on the INSERT below
        // is "where-gathered" metadata only.
        const existing = db.prepare(
          'SELECT quantity FROM player_inventory WHERE user_id = ? AND item_id = ?'
        ).get(req.user.id, item.item);
        if (existing) {
          db.prepare(
            'UPDATE player_inventory SET quantity = quantity + ? WHERE user_id = ? AND item_id = ?'
          ).run(item.quantity, req.user.id, item.item);
        } else {
          db.prepare(`
            INSERT INTO player_inventory (user_id, item_id, quantity, world_id, metadata)
            VALUES (?, ?, ?, ?, ?)
          `).run(req.user.id, item.item, item.quantity, worldId, JSON.stringify({ name: item.name, quality: item.quality }));
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
        const world = db.prepare('SELECT universe_type AS world_type FROM worlds WHERE id = ?').get(worldId);
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

  // WS2.7 — active uprisings located at their members' centroid, for the
  // 3D crowd renderer. Public read (no secrets — member positions + counts).
  router.get("/:worldId/uprisings", (req, res) => {
    try {
      const { worldId } = req.params;
      const uprisings = listActiveUprisingsWithLocation(db, worldId);
      res.json({ ok: true, uprisings, count: uprisings.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // WS-A1 — bulk terrain state for the 3D client: persisted deformation deltas +
  // the wet-cell water grid. The client replays this on load to deform the
  // terrain mesh + rebuild the heightfield collider, and to render the dynamic
  // water surface. Public read (no secrets); mirrors the /nodes + /buildings GETs.
  router.get("/:worldId/terrain", (req, res) => {
    try {
      const { worldId } = req.params;
      const deformations = deformationsForWorld(db, worldId);
      const water = waterGridForWorld(db, worldId);
      res.json({ ok: true, cellSize: TERRAIN_CELL_SIZE, deformations, water });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Phase DA2 — single-building lookup for station interaction router.
  router.get("/:worldId/buildings/:buildingId", (req, res) => {
    try {
      const { worldId, buildingId } = req.params;
      const building = db.prepare(
        'SELECT * FROM world_buildings WHERE world_id = ? AND id = ?'
      ).get(worldId, buildingId);
      if (!building) return res.status(404).json({ ok: false, error: "no_building" });
      res.json({ ok: true, building });
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

      // WAVE WD — World Density: lazily seed the interior on first entry (Tier 2,
      // "never empty") + mark it active (Tier 3, dormancy gate). off == today.
      if (worldDensityEnabled()) {
        try { ensureInterior(db, building); } catch { /* never block the view */ }
        try { recordInteriorActivity(db, buildingId); } catch { /* noop */ }
      }

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
      // Keep the world's shard warm while the player is actively in-world, so
      // the 10-min idle-teardown doesn't reap a shard under continuous play
      // (travel only refreshes activity on entry; movement is the live signal).
      if (shardingEnabled()) { try { recordWorldActivity(worldId); } catch { /* best-effort */ } }
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

      // ── SL6 — harm-to-the-young refusal gate ───────────────────────────────
      // The Sovereign (god of Refusal who refused death) refuses harm both TO
      // and FROM the under-matured. A divine field, not a despawn hack: an
      // active `harm_to_children_refused` field blocks the strike (0 damage,
      // refused ack) when EITHER the defender (NPC) OR the attacker (player) is
      // under-matured and matches the field's scope. Lifts at coming-of-age.
      // Flag-gated (CONCORD_CHILD_REFUSAL) + DB-backed (worlds.js has no live
      // STATE) + best-effort, so off==today / no-field==today.
      if (process.env.CONCORD_CHILD_REFUSAL !== "0") {
        try {
          const { isRefusedForDb, maturityOf } = await import("../lib/refusal-field.js");
          const defenderMaturity = maturityOf(db, "npc", npcId);
          const attackerMaturity = maturityOf(db, "player", userId);
          const defenderRefused = isRefusedForDb(db, worldId, "harm_to_children_refused", { kind: "npc", id: npcId, maturity: defenderMaturity });
          const attackerRefused = isRefusedForDb(db, worldId, "harm_to_children_refused", { kind: "player", id: userId, maturity: attackerMaturity });
          if (defenderRefused || attackerRefused) {
            return res.status(200).json({
              ok: true, refused: true, reason: "harm_to_children_refused", damage: 0,
              detail: defenderRefused
                ? "The Sovereign refuses harm to the young."
                : "The young are refused the act of harm.",
            });
          }
        } catch { /* refusal-field unavailable — combat continues normally */ }
      }

      // ── Concordant Law gate ────────────────────────────────────────────────
      // Concordia-hub is the Three Above All's domain: Sovereign + Concord +
      // Concordia have decreed all combat refused inside the hub. Refusal is
      // server-authoritative so even a modified client can't deal damage in
      // the city. Other worlds enforce combat-allowed via rule_modulators
      // farther down (computeSkillEffectiveness).
      if (worldId === "concordia-hub" || worldId === "concordia") {
        return res.status(403).json({
          ok: false,
          error: "concordant_law_refusal",
          reason: "The Three Above All refuse violence within Concordia. Travel out via Concord Link to engage in combat.",
        });
      }

      // ── T3.3 — world-zone combat gate ──────────────────────────────────────
      // Off-hub, a 'safe'/'sanctuary' zone at the attacker's position refuses
      // combat the same way the hub does (server-authoritative). Other zone
      // kinds (pvp/lawless/hazard) allow combat; their extra effects apply
      // farther down. Best-effort — no zone / no table → world default.
      try {
        const { combatRuleFor } = await import("../lib/world-zones.js");
        const aPos = cityPresence.getUserPosition?.(userId);
        if (aPos && Number.isFinite(aPos.x)) {
          const rule = combatRuleFor(db, worldId, aPos.x, aPos.z ?? 0);
          if (!rule.combatAllowed) {
            return res.status(403).json({
              ok: false,
              error: "zone_combat_refusal",
              reason: `Combat is refused in ${rule.zone?.name || "this sanctuary"}.`,
              zone: rule.zone,
            });
          }
        }
      } catch { /* zone gate best-effort — combat falls through to world default */ }

      const {
        computeDamage,
        applyDamageToNPC,
        getOrCreateNPCResistances,
        getOrInitPlayerBars,
        consumeResourceBar,
      } = await import("../lib/combat/damage-calculator.js");

      // ── Resolve skill DTU for attack parameters ────────────────────────────
      let skillData = {};
      let skillLevel = 1; // the skill DTU's level — Pillar-3 cross-world potency input
      if (skillDtuId) {
        const dtu = db.prepare("SELECT data, skill_level FROM dtus WHERE id = ?").get(skillDtuId);
        if (dtu) {
          try { skillData = typeof dtu.data === 'string' ? JSON.parse(dtu.data) : dtu.data; }
          catch { /* keep empty */ }
          skillLevel = Number(dtu.skill_level ?? 1) || 1;
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

      // F2.1 — fold equipped-gear affix bonuses into the enchantment power so
      // a Flaming/Keen weapon actually changes the hit (the other half of the
      // affix wire; the loot-roll assigns them). Best-effort — no gear → +0.
      const elementForGear = skillData.element || "none";
      let affixEnchant = 0;
      let talentMul = 1, talentFlat = 0;
      let setMul = 1;
      try {
        const { combatEnchantmentFor } = await import("../lib/item-affixes.js");
        const { setDamageFor } = await import("../lib/item-sets.js");
        const { getLoadout } = await import("../lib/combat/loadout.js");
        const loadout = getLoadout(db, userId);
        affixEnchant = combatEnchantmentFor(loadout, elementForGear);
        // F2.2 — set bonuses (2+/4+ themed pieces) multiply damage.
        setMul = setDamageFor(loadout, elementForGear).multiplier;
      } catch { /* affix/set substrate optional — combat unaffected */ }
      // F2.3 — fold the player's allocated talent bonuses (melee/element % +
      // flat power). Kept inside computeDamage's raw inputs so _validateDamageCap
      // still bounds the result.
      try {
        const { talentDamageFor } = await import("../lib/talents.js");
        const t = talentDamageFor(db, userId, elementForGear);
        talentMul = t.multiplier; talentFlat = t.flatPower;
      } catch { /* talents substrate optional */ }
      // D30 — fold the player's endgame ascension/paragon multiplier.
      try {
        const { ascensionDamageMultiplier } = await import("../lib/ascension.js");
        talentMul = Math.round(talentMul * ascensionDamageMultiplier(db, userId, elementForGear) * 1000) / 1000;
      } catch { /* ascension substrate optional */ }

      const attackerStats = {
        skillLevel: eff.effectiveLevel,
        element: skillData.element || 'none',
        basePower: (skillData.base_power || 5) * talentMul * setMul,
        enchantmentBonus: (skillData.enchantment_power || 0) + affixEnchant + talentFlat,
        worldMultiplier: eff.multiplier || 1.0,
      };

      // ── Defender resistances ───────────────────────────────────────────────
      const defenderStats = getOrCreateNPCResistances(db, npcId);
      if (!defenderStats) return res.status(404).json({ ok: false, error: "NPC not found" });

      // ── Anti-cheat: reach check ────────────────────────────────────────────
      // Server-authoritative position validation. A modified client can't
      // attack an NPC across the map. NPC row already loaded for opinion
      // broadcast below — fetch it now and reuse.
      const npcPosRow = db.prepare("SELECT id, x, y, z, rotation FROM world_npcs WHERE id = ?").get(npcId);
      const reachCheck = _validateCombatReach(userId, npcPosRow, skillData);
      if (!reachCheck.ok) {
        logger.warn?.('worlds', 'combat_reach_rejected', { userId, npcId, ...reachCheck });
        recordCombatReject("reach", req.params.worldId);  // E1 — desync-rate telemetry
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
      // Phase G — pass world + element so per-world skill ceilings apply.
      const dmgCheck = _validateDamageCap(damageResult, skillData, {
        worldId: req.params.worldId,
        element: skillData?.element,
      });
      if (!dmgCheck.ok) {
        logger.warn?.('worlds', 'combat_damage_rejected', { userId, npcId, ...dmgCheck });
        recordCombatReject("damage", req.params.worldId);  // E1 — desync-rate telemetry
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

      // Universal Move System Pillar 3 — cross-world potency. A move sags when
      // used outside its native world unless the skill is highly leveled. Reads
      // skillData.nativeWorld (stamped by move-descriptor.js at mint/evolve) +
      // the skill DTU's level. Applied AFTER the cap, like env boost. Defensive:
      // only activates for a move with a native stamp used in a DIFFERENT world;
      // every pre-MS-P1 move (no stamp) is a complete no-op. KS CONCORD_CROSS_WORLD_POTENCY=0.
      try {
        const nativeWorld = skillData?.nativeWorld ?? null;
        if (nativeWorld && nativeWorld !== worldId && Number.isFinite(damageResult.finalDamage)) {
          const { crossWorldPotency } = await import("../lib/cross-world-potency.js");
          const worldRow = db.prepare("SELECT rule_modulators FROM worlds WHERE id = ?").get(worldId);
          const potency = crossWorldPotency({
            skillLevel,
            skillKind: skillData?.skill_kind,
            nativeWorldId: nativeWorld,
            targetWorldId: worldId,
            targetWorld: worldRow,
          });
          if (potency !== 1.0) {
            damageResult.finalDamage = Math.round(damageResult.finalDamage * potency * 10) / 10;
            damageResult.crossWorldPotency = potency;
          }
        }
      } catch { /* potency disabled / no native stamp — neutral pass-through */ }

      // Wave 7a glue #4 — mounted combat overlay. When the attacker is mounted
      // (combat_actor_state.mount_state set by mount/dismount), apply the mount
      // archetype's charge tilt (speed_factor) to finalDamage POST-CAP — the same
      // blessed pattern as the env boost above (the cap stays a bound on RAW
      // damage; mounted charge momentum can legitimately exceed it, clamped to the
      // overlay's own ≤2× bound). `damageResult.mounted` rides into the response +
      // the impact emit so the existing mounted-combat overlay UI reacts. Before
      // this, the attack path never read mount_state → mounted damage was
      // unmodified. KS CONCORD_MOUNT_COMBAT=0.
      if (process.env.CONCORD_MOUNT_COMBAT !== "0") {
        try {
          const { readMountState, MOUNTED_MODIFIER } = await import("../lib/mount-combat-overlay.js");
          const ms = readMountState(db, "player", userId);
          if (ms && ms.mounted_modifier_active && Number.isFinite(damageResult.finalDamage)) {
            const archetype = ms.archetype || "generic";
            const mod = MOUNTED_MODIFIER[archetype] || MOUNTED_MODIFIER.generic;
            const speedFactor = Math.max(0.5, Math.min(2.0, mod.speed_factor || 1.0));
            if (speedFactor !== 1.0) {
              damageResult.finalDamage = Math.round(damageResult.finalDamage * speedFactor * 10) / 10;
            }
            damageResult.mounted = {
              archetype,
              speedFactor,
              finishers: (mod.mounted_finishers || []).slice(),
            };
          }
        } catch { /* overlay disabled / mount_state column missing — neutral pass-through */ }
      }

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
        const strike = polish.recordStrike(db, {
          actorKind: "player", actorId: userId, nowMs: Date.now(),
          element: skillData.element || 'none',
        });
        if (strike?.ok && strike.multiplier > 1) {
          damageResult.finalDamage = Math.round(damageResult.finalDamage * strike.multiplier * 10) / 10;
          damageResult.comboMultiplier = strike.multiplier;
          damageResult.comboCount = strike.combo;
          damageResult.finisherUnlocked = strike.finisher_unlocked;
        }
        // WS4(c) element-combo: amplify complementary elemental chains, dampen
        // cancelling ones (post-combo, like the combo multiplier itself).
        if (strike?.ok && strike.element_multiplier && strike.element_multiplier !== 1) {
          damageResult.finalDamage = Math.round(damageResult.finalDamage * strike.element_multiplier * 10) / 10;
          damageResult.elementMultiplier = strike.element_multiplier;
        }
        // T1.4a — stagger from real IMPACT MOMENTUM (bone-mass × angular-
        // velocity × lever) vs the NPC's poise budget, not raw damage vs a
        // fixed threshold. Deterministic; graded flinch/rocked/knockdown.
        try {
          const { momentumFor } = await import("../lib/combat-impact.js");
          const { getSkillFrameData } = await import("../lib/combat-frame-data.js");
          const weaponKind = skillData?.kind || skillData?.weapon_kind || skillData?.skill_kind || "fist";
          const tier = Math.max(1, Math.min(5, Math.ceil((skillRow?.level || 1) / 20)));
          const frame = getSkillFrameData({ kind: weaponKind, level: skillRow?.level || 1 });
          const momentum = momentumFor({
            kind: weaponKind, tier, frame,
            actorMassKg: damageResult.attackerMassKg || undefined,
          });
          // F3.1/F3.2 — capture the target's pre-hit stagger (for the deathblow
          // execution) + whether it has hyperarmor (mid-heavy-commit). A heavy
          // strike grants the attacker hyperarmor for their active frames.
          const exec = await import("../lib/combat/executions.js");
          const preHitSeverity = exec.currentStaggerSeverity(db, { actorKind: "npc", actorId: npcId });
          const targetHyperarmor = exec.hasHyperarmor(db, { actorKind: "npc", actorId: npcId });
          const isHeavy = !!(skillData?.heavy || /heavy|hammer|axe|greatsword|maul/i.test(weaponKind));
          if (isHeavy) exec.grantHyperarmor(db, { actorKind: "player", actorId: userId });

          // A3 — offAxis from the NPC's facing vs the attacker's position, so a
          // hit from behind both breaks poise harder AND triggers the backstab
          // execution. Falls to 0 (dead-front) when presence is unavailable.
          const _aPos = cityPresence.getUserPosition?.(userId) || null;
          const offAxis = exec.offAxisFromFacing(npcPosRow?.rotation, npcPosRow, _aPos);

          const stagger = polish.triggerStaggerFromImpact(db, {
            actorKind: "npc", actorId: npcId, momentum, offAxis,
            massKg: damageResult.targetMassKg || undefined,
            hyperarmor: targetHyperarmor,
          });
          if (stagger?.severity && stagger.severity !== "none") {
            damageResult.staggerSeverity = stagger.severity;
            damageResult.impactMomentum = Math.round(momentum * 10) / 10;
          }
          // F3.2 — execution: a deathblow on an already-broken target, or a
          // backstab from behind (offAxis), multiplies damage. Applied like the
          // mass multiplier (post-cap legitimate skill burst).
          const ex = exec.resolveExecution({ offAxis, targetSeverity: preHitSeverity });
          if (ex.multiplier > 1 && Number.isFinite(damageResult.finalDamage)) {
            damageResult.finalDamage = Math.round(damageResult.finalDamage * ex.multiplier * 10) / 10;
            damageResult.execution = ex.kind;
            damageResult.executionMultiplier = ex.multiplier;
          }
        } catch {
          // Momentum model optional — fall back to magnitude-based rocked.
          polish.triggerRocked(db, { actorKind: "npc", actorId: npcId, magnitude: damageResult.finalDamage });
        }
        // Bring the NPC's awareness into combat (idempotent on repeat).
        polish.transitionAwareness(db, { actorKind: "npc", actorId: npcId, to: "alert" });
        polish.transitionAwareness(db, { actorKind: "npc", actorId: npcId, to: "combat", target: userId });
      } catch (err) {
        // Phase 8 substrate optional; fall through.
      }

      // ── Temperament P4 — refuse lethal force on an NPC already hors de combat ─
      // A surrendered / arrested / downed NPC can't be executed (CONCORD_TEMPERAMENT;
      // off → no-op, binary combat preserved). Non-lethal force still lands.
      const _nonLethal = !!(skillData?.non_lethal ?? skillData?.nonLethal);
      if (!_nonLethal) {
        try {
          const { checkSpareBeforeHit } = await import("../lib/temperament-combat.js");
          const spare = checkSpareBeforeHit(db, npcId);
          if (spare.spare) {
            return res.status(200).json({
              ok: true, spared: true, reason: spare.reason,
              combatState: spare.combatState, npcId, damage: 0,
            });
          }
        } catch { /* spare gate best-effort — never blocks combat */ }
      }

      const { eventId, kill } = applyDamageToNPC(db, worldId, userId, 'player', npcId, damageResult, {
        skill_dtu_id: skillDtuId, item_dtu_id: itemDtuId,
        element: skillData.element || 'none',
        bar_used: barType === 'multi' ? 'mana' : barType,
        bar_cost: barCost,
      });

      // ── Temperament P4/P5 — fold the hit into morale/restraint ──────────────
      // On a non-killing hit, accrue morale damage through the restraint FSM; a
      // morale break flips the NPC to surrendered and opens a capture (P5). Off /
      // on error → null, binary combat preserved.
      let temperament = null;
      if (!kill) {
        try {
          const { resolveHitTemperament } = await import("../lib/temperament-combat.js");
          const npcRow = db.prepare("SELECT id, archetype, state FROM world_npcs WHERE id=?").get(npcId);
          temperament = resolveHitTemperament(db, {
            worldId, npc: npcRow || { id: npcId }, userId,
            damage: Number(damageResult.finalDamage) || 0,
            nonLethal: _nonLethal,
            io: req.app?.locals?.io,
          });
        } catch { /* temperament best-effort — never blocks combat */ }
      }

      // N4-EVO: a landed hit accrues fitness on the skill/weapon's evolvable
      // asset — fight with something enough and it refines. Best-effort +
      // kill-switched (off → today). Never blocks combat.
      if (process.env.CONCORD_EVO_ASSET_GAMEPLAY !== '0' && skillDtuId) {
        try {
          const { weaponAssetIdForSkill, onCombatHit } = await import("../lib/gameplay-asset-bridge.js");
          const wid = weaponAssetIdForSkill(db, skillDtuId);
          if (wid) {onCombatHit(db, {
            attackerId: userId, victimId: npcId, weapon: { id: wid },
            damage: Number(damageResult.finalDamage) || 0,
            isCrit: Number(damageResult.executionMultiplier || 1) > 1,
          });}
        } catch { /* evo-asset best-effort */ }
      }

      // E0#3 — boss HP/phase HUD + light up the dormant boss-phase scaling.
      // The phase-state created at spawn (STATE.bossPhases) was never ticked in
      // combat, so its damage scaling was dead. If the target is a boss, tick
      // its phases on the post-damage hp and emit boss:state for the HUD.
      try {
        const bossRow = db.prepare(
          `SELECT state, archetype, npc_type, current_hp, max_hp FROM world_npcs WHERE id = ?`
        ).get(npcId);
        if (bossRow) bossRow.name = npcNameFromRow(bossRow); // world_npcs has no `name` column — derive from state
        const bossPhases = globalThis.__CONCORD_STATE__?.bossPhases?.get?.(npcId);
        const { isBossRow, computeBossState } = await import("../lib/combat/boss-hud.js");
        if (isBossRow(bossRow, bossPhases)) {
          const payload = computeBossState({
            npcId, worldId,
            name: bossRow.name, archetype: bossRow.archetype,
            currentHp: bossRow.current_hp, maxHp: bossRow.max_hp,
            phases: bossPhases, defeated: !!kill,
          });
          req.app.locals.io?.to(`world:${worldId}`).emit('boss:state', payload);
        }
      } catch { /* boss HUD emit best-effort — never blocks combat */ }

      // T1.4b — server-authoritative combat FEEL. The poise severity that
      // T1.4a computed from real impact momentum (set on damageResult above)
      // is mapped to the exact hitstop / knockback / wince parameters the
      // client applies verbatim, so the *feel* matches the *physics* and a
      // client can't inflate it. Emit `combat:impact` to the world room; the
      // CombatImpactFeelBridge dispatches the hit-pause / knockback /
      // hit-reaction CustomEvents the avatar loop already honours.
      try {
        const io = req.app?.locals?.io;
        const severity = damageResult.staggerSeverity || "none";
        const landed = (damageResult.finalDamage || 0) > 0;
        // Emit on any landed hit so the client can render mastery-scaled VFX;
        // the feel block is zero-feel for severity "none" (client no-ops it).
        if (io && (landed || severity !== "none" || kill)) {
          const { buildImpactPayload } = await import("../lib/combat/impact-feel.js");
          const { skillVfxDescriptor } = await import("../lib/skills/skill-mastery.js");
          const { skillKeyForSkill } = await import("../lib/skills/skill-key.js");
          const skillKey = skillKeyForSkill(skillData);
          const tPos = npcPosRow && Number.isFinite(npcPosRow.x)
            ? { x: npcPosRow.x, y: npcPosRow.y ?? 0, z: npcPosRow.z }
            : null;
          const aPos = cityPresence.getUserPosition?.(userId) || null;
          // T3.1 — per-skill VFX scaled by the caster's mastery tier for this
          // skill. A grandmaster's cast throws a bigger, brighter burst.
          const vfx = skillVfxDescriptor({
            skillType: skillData.skill_type || skillData.kind || null,
            element: skillData.element || "none",
            kind: skillData.kind || skillData.weapon_kind || null,
            level: skillRow?.level || skillData.skill_level || 0,
          });
          io.to(`world:${worldId}`).emit("combat:impact", {
            ...buildImpactPayload({
              worldId,
              attackerId: userId,
              targetId: npcId,
              targetKind: "npc",
              severity,
              momentum: damageResult.impactMomentum || 0,
              element: skillData.element || "none",
              damage: damageResult.finalDamage || 0,
              isKill: !!kill,
              targetPosition: tPos,
              attackerPosition: aPos,
            }),
            vfx,
            skillKey,
          });
        }
      } catch { /* combat:impact feel emit best-effort — never blocks combat */ }

      // Phase T — NPC defender accumulates skill XP. Same XP curve as
      // user_skills, so a frequently-attacked NPC ends up better at
      // resisting (combat skill bumps). NPCs that out-grind players
      // become harder to kill — by design.
      try {
        const { awardNpcXp } = await import("../lib/npc-skill-progression.js");
        awardNpcXp(db, npcId, 'combat', Math.floor((damageResult?.finalDamage ?? 0) * 0.3));
      } catch { /* lib optional — combat still works */ }

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

        // E4 — spouse reactivity. An NPC spouse reacts to whom the player kills
        // (kin/liked → wounded; enemy → relieved). Guarded; no-op if unmarried.
        try {
          const { reactToPlayerEvent } = await import("../lib/spouse-reactivity.js");
          reactToPlayerEvent(db, userId, { kind: "npc_killed", targetNpcId: npcId, worldId: req.params.worldId });
        } catch { /* spouse reactivity optional */ }

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
              // G3 — destruction -> salvage: a collapse turns the rubble into a
              // scrap resource node at the building (idempotent; best-effort). The
              // node is discovered through normal gathering — no new socket event.
              if (stress.state === 'collapsed') {
                try {
                  const { spawnSalvageOnCollapse } = await import("../lib/building-salvage.js");
                  spawnSalvageOnCollapse(db, worldId, stagger.buildingId);
                } catch { /* salvage best-effort — never blocks combat */ }
              }
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

      res.json({ ok: true, damageResult, eventId, kill, npcId, temperament });
    } catch (e) {
      logger.error('worlds', 'combat-attack', { error: e.message });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/npcs/:npcId/deescalate — Temperament P2.
  // A player de-escalation verb (holster/yield/comply/…) steps the NPC's intent
  // rung down + barks. body: { verb }
  router.post("/:worldId/npcs/:npcId/deescalate", requireAuth, async (req, res) => {
    try {
      const { worldId, npcId } = req.params;
      const { verb } = req.body || {};
      const npc = db.prepare("SELECT id, archetype, state FROM world_npcs WHERE id=?").get(npcId);
      if (!npc) return res.status(404).json({ ok: false, error: "npc_not_found" });
      const { applyNpcDeescalation } = await import("../lib/temperament-combat.js");
      const r = applyNpcDeescalation(db, { worldId, npc, verb, io: req.app?.locals?.io });
      return res.status(r.ok ? 200 : 400).json(r);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/arrest/respond — Temperament P3.
  // Resolve the player's response to an authority arrest offer. body: { verb }
  router.post("/:worldId/arrest/respond", requireAuth, async (req, res) => {
    try {
      const { worldId } = req.params;
      const { verb } = req.body || {};
      const { resolvePlayerArrest } = await import("../lib/temperament-combat.js");
      const r = resolvePlayerArrest(db, { worldId, userId: req.user.id, verb, io: req.app?.locals?.io });
      return res.status(r.ok ? 200 : 400).json(r);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
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

      // Concordant Law: NPCs cannot harm players inside the hub. Mirror the
      // player→NPC gate above.
      if (worldId === "concordia-hub" || worldId === "concordia") {
        return res.status(403).json({
          ok: false,
          error: "concordant_law_refusal",
          reason: "The Three Above All refuse violence within Concordia.",
        });
      }

      const {
        computeDamage,
        applyDamageToPlayer,
        getOrCreateNPCResistances,
      } = await import("../lib/combat/damage-calculator.js");

      const npc = db.prepare(`
        SELECT id, archetype, criminal_rep, fire_resistance, ice_resistance,
               physical_resistance, current_hp, max_hp, npc_type, is_conscious
        FROM world_npcs WHERE id = ?
      `).get(npcId);
      if (!npc) return res.status(404).json({ ok: false, error: "NPC not found" });

      // WS1: NPC attack power derives from its GROWN combat level (skill +
      // evolution), so a leveled frontier hostile genuinely threatens a player
      // while a level-1 hub NPC stays harmless. Gated behind CONCORD_ABSOLUTE_POWER
      // — with the flag off, npcAttackStats returns the legacy
      // `5 + criminal_rep*10` shape so behaviour is unchanged.
      const { getEntityCombatLevel, npcAttackStats, capNpcDamage,
              getPlayerCombatLevel, relativeScaledLevel } =
        await import("../lib/entity-power.js");
      const element = npc.archetype === 'mage' ? 'energy' : 'physical';
      // E1 (Phase E §0) — RELATIVE scaling (no-op unless CONCORD_RELATIVE_SCALING
      // is on): named/authored NPCs + bosses are floored to ~player tier so they
      // stay a credible threat; common NPCs are capped below the player so a
      // leveled player genuinely outgrows trash (the power fantasy). "Named" =
      // boss type, an authored/conscious NPC, or a title-bearing archetype.
      const isNamedNpc = npc.npc_type === 'boss' || !!npc.is_conscious
        || /boss|warlord|champion|overlord|queen|king|captain|lord|elder|matriarch/i.test(npc.archetype || '');
      const combatLevel = relativeScaledLevel(
        getEntityCombatLevel(db, npc.id),
        getPlayerCombatLevel(db, userId),
        { named: isNamedNpc },
      );
      const attackerStats = npcAttackStats(combatLevel, element, { criminalRep: npc.criminal_rep || 0 });

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
      // WS1 anti-cheat / anti-misconfig: cap NPC outgoing damage (mirrors the
      // player-side _validateDamageCap). No-op when the flag is off.
      damageResult.finalDamage = capNpcDamage(damageResult.finalDamage, attackerStats);

      // D2 (depth plan) — honor the player's server-tracked defensive state so
      // a well-timed dodge (i-frames) or a held block actually matters against
      // an NPC attack. Before this, the NPC→player path applied damage with no
      // defensive check, so dodge/parry/block were cosmetic here while the
      // socket handlers dutifully recorded i-frames/block windows that nothing
      // ever consulted. combat-state.js is a single shared module instance
      // (ESM path-cached), so the dodge i-frames granted on the socket path are
      // visible here. applyHitToState early-returns on i-frames before poise
      // depletion, so a whiffed hit costs the player no poise.
      try {
        const { applyHitToState } = await import("../lib/combat-state.js");
        const defMod = applyHitToState(userId, {
          damage: damageResult.finalDamage,
          isCrit: !!damageResult.isCrit,
        });
        if (defMod.iframed) {
          try {
            req.app.locals.io?.to(`world:${worldId}`).emit("combat:npc-attack-evaded", {
              worldId, npcId, userId, reason: "iframe", t: Date.now(),
            });
          } catch { /* evade emit best-effort */ }
          return res.json({ ok: true, evaded: true, reason: "iframe", finalDamage: 0, eventId: null });
        }
        if (defMod.damageMul !== 1 && Number.isFinite(damageResult.finalDamage)) {
          damageResult.finalDamage = Math.round(damageResult.finalDamage * defMod.damageMul);
          if (defMod.blocked) damageResult.blocked = true;
        }
      } catch { /* combat-state optional — fall through to undefended damage */ }

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

      // WS4(b) — near-death awakening trigger. If the player SURVIVED a hit that
      // dropped them to a sliver of HP, surface an awakening opportunity (a
      // stress-triggered power spike, MHA-style). Advisory event; the client
      // confirms which skill to awaken via the skill-awakening.awaken macro.
      if (!kill) {
        try {
          const { isNearDeath } = await import("../lib/skill-awakening.js");
          const bars = db.prepare(
            `SELECT hp, max_hp FROM player_resource_bars WHERE user_id = ? AND world_id = ?`
          ).get(userId, worldId);
          if (bars && isNearDeath(bars.hp, bars.max_hp)) {
            req.app.locals.io?.to(`user:${userId}`)?.emit?.("player:awakening-available", {
              worldId, hp: bars.hp, maxHp: bars.max_hp, source: 'near_death_survived',
            });
          }
        } catch { /* awakening surfacing is best-effort */ }
      }

      res.json({ ok: true, damageResult, eventId, kill, message: kill ? 'You have been defeated' : undefined });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/worlds/:worldId/danger?x=&z= — WS6 danger telegraphing.
  // Returns the danger band at a point + the nearest entities with their level
  // relative to the caller, so the client can render "entering the Wilds" cues
  // and per-enemy danger tells. Never walls the player off — purely advisory.
  router.get("/:worldId/danger", requireAuth, async (req, res) => {
    try {
      const { worldId } = req.params;
      const x = Number(req.query.x) || 0;
      const z = Number(req.query.z) || 0;
      const playerLevel = Math.max(1, Number(req.query.level) || 1);
      const { gradientAt } = await import("../lib/world-gradient.js");
      const { dangerLabel } = await import("../lib/world-danger.js");
      const g = gradientAt(db, worldId, x, z);

      let nearby = [];
      try {
        nearby = db.prepare(`
          SELECT id, archetype, level, x, z FROM world_npcs
          WHERE world_id = ? AND COALESCE(is_dead, 0) = 0
            AND x IS NOT NULL AND z IS NOT NULL
          ORDER BY ((x - ?) * (x - ?) + (z - ?) * (z - ?)) ASC
          LIMIT 16
        `).all(worldId, x, x, z, z).map((n) => ({
          id: n.id,
          archetype: n.archetype,
          level: n.level || 1,
          distance: Math.round(Math.hypot(n.x - x, n.z - z)),
          tell: dangerLabel((n.level || 1) - playerLevel),
        }));
      } catch { /* world_npcs optional */ }

      res.json({
        ok: true,
        band: g.band,
        bandName: g.bandName,
        minLevel: g.minLevel,
        maxLevel: g.maxLevel,
        inHub: g.inHub,
        distance: Math.round(g.distance),
        density: Math.round(g.density * 100) / 100,
        nearby,
        // Gradient config + hub anchor so the client can compute the danger band
        // LOCALLY from the player position (no per-frame poll). Fetched once on
        // world entry; the System reads bands off the live pose instead.
        config: {
          worldRadiusM: g.config.worldRadiusM,
          hubRadiusM: g.config.hubRadiusM,
          bandCount: g.config.bandCount,
          dangerCurve: g.config.dangerCurve,
          frontierLevel: g.config.frontierLevel,
        },
        anchor: { x: g.anchor.x, z: g.anchor.z, radiusM: g.anchor.radiusM },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/worlds/:worldId/schemes/:id/intervene — T2.3 barge-in.
  // The player clicks an active eavesdrop bubble within range and chooses to
  // expose / abet / ignore the plot. Proximity-gated to the plotter NPC so you
  // must actually be there to intervene. Branches the scheme state machine,
  // shifts opinions, and emits the resolution. body: { action }
  router.post("/:worldId/schemes/:id/intervene", requireAuth, async (req, res) => {
    try {
      const { worldId, id: schemeId } = req.params;
      const userId = req.user.id;
      const action = String(req.body?.action || "ignore");
      if (!["expose", "abet", "ignore", "blackmail"].includes(action)) {
        return res.status(400).json({ ok: false, error: "action must be expose|abet|ignore|blackmail" });
      }

      const { interveneInScheme } = await import("../lib/npc-schemes.js");

      // Proximity gate (skip for 'ignore' — dismissing from anywhere is fine).
      if (action !== "ignore") {
        try {
          const db2 = db;
          const sch = db2.prepare(`SELECT plotter_id, plotter_kind FROM npc_schemes WHERE id = ?`).get(schemeId);
          if (sch?.plotter_kind === "npc") {
            const plotter = db2.prepare(`SELECT x, z FROM world_npcs WHERE id = ?`).get(sch.plotter_id);
            const pos = cityPresence.getUserPosition?.(userId);
            if (plotter && pos && Number.isFinite(plotter.x) && Number.isFinite(pos.x)) {
              const dist = Math.hypot(pos.x - plotter.x, (pos.z ?? 0) - (plotter.z ?? 0));
              if (dist > 30) {
                return res.status(403).json({ ok: false, error: "too_far", reason: "Move closer to intervene.", dist: Math.round(dist) });
              }
            }
          }
        } catch { /* proximity gate best-effort — fall through to the action */ }
      }

      const result = interveneInScheme(db, userId, schemeId, action);
      if (result.ok) {
        try {
          req.app?.locals?.io?.to(`world:${worldId}`).emit("scheme:intervened", {
            schemeId, worldId, userId, action,
            exposed: !!result.exposed, ts: Date.now(),
          });
        } catch { /* socket optional */ }
      }
      return res.status(result.ok ? 200 : 422).json(result);
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
