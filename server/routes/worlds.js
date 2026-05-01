// server/routes/worlds.js
// Multi-world API routes: list, get, create, travel, skill teach/effectiveness.

import express from "express";
import crypto from "crypto";
import logger from "../logger.js";
import { loadWorld, listWorlds, getActiveWorldForPlayer } from "../lib/world-loader.js";
import { travelToWorld, applyWorldRulesToPlayer } from "../lib/transit.js";
import { spawnWorldNativeEmergent, getWorldEmergents, getCrossWorldEmergents, growAffinity } from "../lib/world-emergents.js";

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
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/worlds/current — current world for the authenticated player
  router.get("/current", requireAuth, (req, res) => {
    try {
      const worldId = getActiveWorldForPlayer(db, req.user.id);
      const world   = loadWorld(db, worldId);
      res.json({ worldId, world });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/worlds/:id — single world detail
  router.get("/:id", (req, res) => {
    try {
      const world = loadWorld(db, req.params.id);
      if (!world) return res.status(404).json({ error: "World not found" });
      res.json({ world });
    } catch (e) {
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      // Spawn a native emergent for the new world (non-blocking)
      spawnWorldNativeEmergent(id, db, () => "default").catch(err =>
        logger?.debug?.("[worlds] native emergent spawn failed", { worldId: id, err: err?.message })
      );
      res.status(201).json({ world });
    } catch (e) {
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
  router.get("/:worldId/quests", (req, res) => {
    try {
      const { status = "available" } = req.query;
      const quests = db.prepare(
        "SELECT * FROM world_quests WHERE world_id = ? AND (status = ? OR ? = 'all') ORDER BY created_at DESC"
      ).all(req.params.worldId, status, status);

      res.json({ quests: quests.map(_parseQuest) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/worlds/:worldId/quests/:questId/accept
  router.post("/:worldId/quests/:questId/accept", requireAuth, (req, res) => {
    try {
      const { questId } = req.params;
      const quest = db.prepare("SELECT * FROM world_quests WHERE id = ? AND status = 'available'").get(questId);
      if (!quest) return res.status(404).json({ error: "Quest not available" });

      db.prepare(
        "UPDATE world_quests SET status = 'active', accepted_by = ? WHERE id = ?"
      ).run(req.user.id, questId);

      res.json({ ok: true, quest: _parseQuest({ ...quest, status: "active", accepted_by: req.user.id }) });
    } catch (e) {
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/worlds/crises — active civilization crises
  router.get("/crises", async (req, res) => {
    try {
      const { getActiveCrises } = await import("../lib/world-crisis.js");
      res.json({ crises: getActiveCrises(db) });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
    } catch (e) { res.status(500).json({ error: e.message }); }
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
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/worlds/:worldId/nemesis — get the caller's nemesis in a world
  router.get("/:worldId/nemesis", requireAuth, (req, res) => {
    try {
      const record = db.prepare("SELECT * FROM nemesis_records WHERE player_id = ?").get(req.user.id);
      res.json({ nemesis: record || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
    } catch (e) { res.status(500).json({ error: e.message }); }
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
      } catch (_) {}

      res.json({ ok: true, prestigedSkills: playerSkills.length, fromAvgLevel: avgLevel.toFixed(1) });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  // ── World Emergents ────────────────────────────────────────────────────────

  router.get("/:worldId/emergents", async (req, res) => {
    try {
      const emergents = await getWorldEmergents(req.params.worldId, db);
      res.json({ ok: true, emergents });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/emergents/cross-world", async (req, res) => {
    try {
      const emergents = await getCrossWorldEmergents(db);
      res.json({ ok: true, emergents });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:worldId/emergents/:emergentId/affinity", requireAuth, async (req, res) => {
    try {
      const { delta = 1 } = req.body;
      await growAffinity(req.params.emergentId, req.params.worldId, delta, db);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── NPC Routes ────────────────────────────────────────────────────────────

  // GET /api/worlds/:worldId/npcs — list live NPCs with positions (for frontend rendering)
  router.get("/:worldId/npcs", requireAuth, (req, res) => {
    try {
      const { worldId } = req.params;
      const rows = db.prepare(`
        SELECT id, npc_type, archetype, body_type, faction, is_conscious, is_immortal,
               quest_giver, level, current_location, state, universe_type
        FROM world_npcs
        WHERE world_id = ? AND is_dead = 0
        ORDER BY created_at ASC
        LIMIT 200
      `).all(worldId);

      const npcs = rows.map(r => {
        const state    = _tryParseJSON(r.state, {});
        const location = _tryParseJSON(r.current_location, { x: 0, y: 0, z: 0 });
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
          currentActivity: state.currentActivity || null,
          factionTactic:   state.factionTactic || null,
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
          const npc = db.prepare("SELECT level FROM world_npcs WHERE id = ?").get(npcId);
          const sparks = (npc?.level || 1) * 5;
          awardSparks(db, killerId, sparks, 'npc_kill', worldId);
          result.sparksAwarded = sparks;
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
