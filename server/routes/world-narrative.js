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

// Negative cache: worldId → timestamp of last FAILED synthesis. When the brain
// is degraded (A40 down, Ollama mid-model-swap) every `synthesizeArcLore` call
// runs the full narrative-bridge → oracle-brain → fetch(ollama) chain and fails,
// and `history-engine.js` re-triggers `buildLore("concordia-hub")` every 20
// civilization ticks — so a down brain turns into a steady storm of failing
// synthesis chains + `oracle_brain_call_failed` / `lore_synthesis_failed` log
// triplets. This backs the background trigger off for a cooldown after a
// failure; the admin force-refresh route bypasses it.
const _loreFailAt = new Map();
const LORE_FAIL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// In-flight de-dupe: worldId → the pending buildLore promise. A slow/degraded
// brain makes each synthesis attempt take tens of seconds; without this,
// history-engine's every-20-tick trigger + the 10-min interval + any HTTP GET
// all fire concurrently BEFORE the first attempt completes and records its
// failure, so the negative cache above never gets a chance to short-circuit
// them. Coalesce concurrent callers onto one attempt per world.
const _loreInflight = new Map();

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

async function buildLore(worldId, { force = false } = {}) {
  // Use narrative bridge so authored lore events (Founding Compact, Purge, etc.)
  // flow into the synthesis prompt as world history context.
  if (!force) {
    const failedAt = _loreFailAt.get(worldId);
    if (failedAt && Date.now() - failedAt < LORE_FAIL_COOLDOWN_MS) {
      return { ok: false, error: "lore_synthesis_cooldown", cooldown: true };
    }
    // Coalesce concurrent callers onto the single pending attempt for this world.
    const pending = _loreInflight.get(worldId);
    if (pending) return pending;
  }

  const run = (async () => {
    const result = await synthesizeArcLore(worldId);
    if (result.ok) {
      setCachedLore(worldId, result.lore);
      _loreFailAt.delete(worldId);
      logger.info({ worldId }, "lore_synthesized");
    } else {
      _loreFailAt.set(worldId, Date.now());
      logger.warn({ worldId, error: result.error }, "lore_synthesis_failed");
    }
    return result;
  })();

  _loreInflight.set(worldId, run);
  try {
    return await run;
  } finally {
    _loreInflight.delete(worldId);
  }
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
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/lore/refresh", admin, wrap(async (req, res) => {
    const worldId = String(req.body?.worldId || req.query.worldId || "concordia-hub");
    _loreCache.delete(worldId);
    const result = await buildLore(worldId, { force: true });
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
    let   phase              = req.query.phase || null;
    const playerRelationship = req.query.relationship || "neutral";
    const isAuthored         = getAuthoredNPC(npcId) !== null;

    // Concordia (the goddess) reacts to the player's ecosystem_score AND
    // the active Refusal-Field composition. When the caller doesn't pin a
    // phase, we auto-select using two signals:
    //   1. Refusal-Field strength (glyph algebra composition) — overrides
    //      ecosystem when the Sovereign has stacked enough refusals that
    //      reality bends. This is the load-bearing seat for the glyph
    //      algebra: see server/lib/refusal-field.js#computeFieldComposition.
    //   2. ecosystem_score — falls back to the per-player alignment metric
    //      when no compound refusal is active.
    if (isAuthored && !phase && npcId === "concordia_first_breath") {
      try {
        const userId = req.user?.id;
        const worldId = String(req.query.worldId || "concordia-hub");
        // Compound refusal cuts to "cold" regardless of ecosystem score —
        // the goddess' tone follows the Sovereign's will when it bends
        // hard enough. STATE comes through as req.app.locals.STATE.
        const STATE = req.app?.locals?.STATE;
        if (STATE) {
          try {
            const { isCompoundRefusal } = await import("../lib/refusal-field.js");
            if (isCompoundRefusal(STATE, worldId)) {
              phase = "cold";
            }
          } catch { /* fall through */ }
        }
        if (!phase && userId) {
          const { getMetrics } = await import("../lib/ecosystem/score-engine.js");
          const m = getMetrics(db, userId, worldId);
          phase = (m.ecosystem_score >= 0) ? "warm" : "cold";
        }
      } catch { /* fall through with no phase if metrics unavailable */ }
    }

    // H3 — a wed NPC speaks in the warmest register. Spouse status overrides
    // an unset phase so married partners' lines shift (devoted), independent of
    // the goddess ecosystem path above.
    if (!phase && req.user?.id) {
      try {
        const { spouseDialoguePhase } = await import("../lib/heart-events.js");
        const sp = spouseDialoguePhase(db, req.user.id, npcId, 0);
        if (sp === "devoted") phase = "devoted";
      } catch { /* spouse phase optional */ }
    }

    let result;
    if (isAuthored) {
      result = await generateAuthoredDialogue(npcId, questId, playerRelationship, db, phase);
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
    res.json({
      ok: true,
      dialogueTree: result.dialogueTree,
      authored: isAuthored,
      handAuthored: !!result.handAuthored,
    });
  }));

  return router;
}

// Export for use by server.js interval
export { buildLore, getCachedLore };
