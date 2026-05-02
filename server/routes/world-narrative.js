/**
 * World Narrative Routes
 *
 * Lore synthesis, quest chains, and dialogue trees powered by the Oracle brain.
 */

import { Router } from "express";
import logger from "../logger.js";
import { synthesizeLore, generateQuestChain, writeDialogueTree } from "../lib/oracle-brain.js";
import { getTimeline } from "../emergent/history-engine.js";
import {
  synthesizeArcLore,
  generateArcQuestChain,
  generateAuthoredDialogue,
} from "../lib/narrative-bridge.js";
import { getAuthoredNPC } from "../lib/content-seeder.js";

// In-memory LRU cache: worldId → { lore, generatedAt }
const _loreCache = new Map();
const LORE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCachedLore(worldId) {
  const entry = _loreCache.get(worldId);
  if (!entry) return null;
  if (Date.now() - entry.generatedAt > LORE_TTL_MS) {
    _loreCache.delete(worldId);
    return null;
  }
  return entry.lore;
}

function setCachedLore(worldId, lore) {
  _loreCache.set(worldId, { lore, generatedAt: Date.now() });
}

async function buildLore(worldId) {
  // Use narrative bridge so authored lore events (Founding Compact, Purge, etc.)
  // flow into the synthesis prompt as world history context.
  const result = await synthesizeArcLore(worldId);
  if (result.ok) {
    setCachedLore(worldId, result.lore);
    logger.info({ worldId }, "lore_synthesized");
  } else {
    logger.warn({ worldId, error: result.error }, "lore_synthesis_failed");
  }
  return result;
}

/**
 * @param {object} [opts]
 * @param {Function} [opts.requireAuth]
 * @param {Function} [opts.requireAdmin]
 * @returns {Router}
 */
export default function createWorldNarrativeRoutes({ requireAuth, requireAdmin, db = null } = {}) {
  const router = Router();

  const auth = (req, res, next) => {
    if (requireAuth) return requireAuth(req, res, next);
    next();
  };

  const admin = (req, res, next) => {
    if (requireAdmin) return requireAdmin(req, res, next);
    next();
  };

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      logger.warn({ err: err.message }, "world_narrative_route_error");
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  };

  // GET /api/world/lore?worldId=
  router.get("/lore", wrap(async (req, res) => {
    const worldId = String(req.query.worldId || "concordia-hub");
    const cached = getCachedLore(worldId);

    if (cached) {
      return res.json({ ok: true, lore: cached, cached: true });
    }

    // Generate fresh lore (first request or stale)
    const result = await buildLore(worldId);
    if (!result.ok) {
      // Return stub so UI doesn't break while generation is warming up
      return res.json({
        ok: true,
        lore: {
          id: "lore_stub",
          text: "The Oracle is consulting the ancient records. Check back shortly.",
          generatedAt: new Date().toISOString(),
        },
        cached: false,
      });
    }

    res.json({ ok: true, lore: result.lore, cached: false });
  }));

  // POST /api/world/lore/refresh — admin-only forced refresh
  router.post("/lore/refresh", admin, wrap(async (req, res) => {
    const worldId = String(req.body?.worldId || req.query.worldId || "concordia-hub");
    _loreCache.delete(worldId);
    const result = await buildLore(worldId);
    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, lore: result.lore });
  }));

  // GET /api/world/quest-chain/:npcId
  // For authored NPCs, enriches with faction state and NPC backstory via narrative bridge.
  // Falls back to procedural generation for non-authored NPCs.
  router.get("/quest-chain/:npcId", auth, wrap(async (req, res) => {
    const { npcId } = req.params;
    const playerLevel = parseInt(req.query.playerLevel || "1", 10);

    const isAuthored = getAuthoredNPC(npcId) !== null;

    let result;
    if (isAuthored) {
      result = await generateArcQuestChain(npcId, playerLevel, db);
    } else {
      const factionState = {
        factionName: req.query.faction || "Independent",
        reputation: parseInt(req.query.reputation || "50", 10),
      };
      result = await generateQuestChain(npcId, factionState, playerLevel);
    }

    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, questChain: result.questChain, authored: isAuthored });
  }));

  // GET /api/world/dialogue/:npcId
  // For authored NPCs, injects backstory, faction context, and speech patterns.
  // Falls back to procedural generation for non-authored NPCs.
  router.get("/dialogue/:npcId", auth, wrap(async (req, res) => {
    const { npcId } = req.params;
    const questId            = req.query.questId || null;
    const playerRelationship = req.query.relationship || "neutral";
    const isAuthored         = getAuthoredNPC(npcId) !== null;

    let result;
    if (isAuthored) {
      result = await generateAuthoredDialogue(npcId, questId, playerRelationship, db);
    } else {
      const npcTraits = {
        id:          npcId,
        name:        req.query.name || "Citizen",
        personality: req.query.personality || "reserved",
        role:        req.query.role || "resident",
      };
      const questContext = {
        questTitle:  req.query.questTitle || "",
        currentStep: parseInt(req.query.step || "0", 10),
      };
      result = await writeDialogueTree(npcTraits, questContext, playerRelationship);
    }

    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, dialogueTree: result.dialogueTree, authored: isAuthored });
  }));

  return router;
}

// Export for use by server.js interval
export { buildLore, getCachedLore };
