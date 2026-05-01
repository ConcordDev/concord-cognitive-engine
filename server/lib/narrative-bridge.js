/**
 * Narrative Bridge — Enriches oracle-brain LLM calls with authored context.
 *
 * The bridge takes authored NPC backstories, faction motivations, and quest
 * narrative stakes from the content seeder and passes them as rich context to
 * oracle-brain's generateQuestChain and writeDialogueTree. The result is
 * LLM-generated dialogue and quest content that is grounded in the authored world
 * rather than thin procedural descriptions.
 *
 * This is the thesis in code: authored skeleton + LLM muscle.
 *
 * Cache: in-memory LRU by (npcId, questId, relationship) with 5-min TTL.
 * Falls back to direct oracle-brain calls for non-authored NPCs.
 */

import logger from "../logger.js";
import { synthesizeLore, generateQuestChain, writeDialogueTree } from "./oracle-brain.js";
import { getTimeline } from "../emergent/history-engine.js";
import { getAuthoredNPC, getAuthoredFaction, getQuestsForNPC } from "./content-seeder.js";

const DIALOGUE_TTL_MS   = 5 * 60 * 1000;   // 5 minutes
const QUEST_TTL_MS      = 10 * 60 * 1000;  // 10 minutes
const LORE_TTL_MS       = 10 * 60 * 1000;

// ── In-Memory Caches ─────────────────────────────────────────────────────────

const _dialogueCache = new Map();   // key → { result, generatedAt }
const _questCache    = new Map();   // key → { result, generatedAt }
const _loreCache     = new Map();   // worldId → { result, generatedAt }

function cacheGet(map, key, ttlMs) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.generatedAt > ttlMs) {
    map.delete(key);
    return null;
  }
  return entry.result;
}

function cacheSet(map, key, result) {
  map.set(key, { result, generatedAt: Date.now() });
}

// ── Context Builders ──────────────────────────────────────────────────────────

/**
 * Build enriched npcTraits from authored NPC data.
 * Falls back to the raw npcId string if no authored NPC found.
 */
function buildNPCTraits(npcId) {
  const npc = getAuthoredNPC(npcId);
  if (!npc) {
    return { id: npcId, name: npcId, personality: "reserved", role: "resident" };
  }

  const faction = npc.faction_id ? getAuthoredFaction(npc.faction_id) : null;

  return {
    id:          npc.id,
    name:        npc.name,
    role:        npc.role,
    personality: npc.personality_traits?.join(", ") ?? "reserved",
    speechStyle: npc.speech_patterns ?? "",
    backstory:   npc.backstory ?? "",
    factionName: faction?.name ?? "Independent",
    factionGoal: faction?.goal ?? "",
    currentGoal: npc.narrative_context?.current_goal ?? "",
    fears:       npc.narrative_context?.fear ?? "",
    // Deliberately exclude secrets from LLM context — those are for human authors only
  };
}

/**
 * Build enriched factionState from authored faction data.
 */
function buildFactionState(npcId) {
  const npc = getAuthoredNPC(npcId);
  if (!npc?.faction_id) {
    return { factionName: "Independent", reputation: 50, tensions: "" };
  }

  const faction = getAuthoredFaction(npc.faction_id);
  if (!faction) {
    return { factionName: "Independent", reputation: 50, tensions: "" };
  }

  return {
    factionName:  faction.name,
    reputation:   faction.faction_state?.reputation ?? 50,
    tensions:     faction.faction_state?.tensions ?? "",
    rivalFactions: faction.rival_factions?.join(", ") ?? "",
    motto:        faction.motto ?? "",
  };
}

/**
 * Build quest context from authored quest data for an NPC.
 */
function buildQuestContext(npcId, questId) {
  if (!questId) {
    const quests = getQuestsForNPC(npcId);
    if (quests.length === 0) return { questTitle: "none", currentStep: 0 };
    const first = quests[0];
    return {
      questTitle:   first.raw?.title ?? "none",
      questSummary: first.raw?.description ?? "",
      currentStep:  0,
    };
  }

  // Try to find authored quest by authored id
  const npcQuests = getQuestsForNPC(npcId);
  const match = npcQuests.find(q => q.raw?.id === questId || q.engineId === questId);
  if (!match) return { questTitle: questId, currentStep: 0 };

  return {
    questTitle:   match.raw?.title ?? questId,
    questSummary: match.raw?.description ?? "",
    currentStep:  0,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate dialogue for an authored NPC, enriched with their backstory and
 * faction context. Falls back gracefully to procedural generation for non-authored NPCs.
 *
 * @param {string} npcId
 * @param {string|null} questId
 * @param {string} playerRelationship  - "stranger" | "ally" | "enemy" | "neutral"
 * @returns {Promise<{ ok: boolean, dialogueTree?: object, authored: boolean, error?: string }>}
 */
export async function generateAuthoredDialogue(npcId, questId = null, playerRelationship = "neutral") {
  const cacheKey = `${npcId}:${questId ?? "none"}:${playerRelationship}`;
  const cached = cacheGet(_dialogueCache, cacheKey, DIALOGUE_TTL_MS);
  if (cached) return { ...cached, cached: true };

  const npcTraits    = buildNPCTraits(npcId);
  const questContext = buildQuestContext(npcId, questId);
  const authored     = getAuthoredNPC(npcId) !== null;

  const result = await writeDialogueTree(npcTraits, questContext, playerRelationship);

  if (result.ok) {
    const enriched = { ...result, authored };
    cacheSet(_dialogueCache, cacheKey, enriched);
    return enriched;
  }

  logger.warn({ npcId, questId, error: result.error }, "narrative_bridge_dialogue_failed");
  return { ...result, authored };
}

/**
 * Generate a quest chain for an authored NPC, enriched with faction state and narrative stakes.
 * Falls back to procedural generation for non-authored NPCs.
 *
 * @param {string} npcId
 * @param {number} playerLevel
 * @returns {Promise<{ ok: boolean, questChain?: object, authored: boolean, error?: string }>}
 */
export async function generateArcQuestChain(npcId, playerLevel = 1) {
  const cacheKey = `${npcId}:${playerLevel}`;
  const cached = cacheGet(_questCache, cacheKey, QUEST_TTL_MS);
  if (cached) return { ...cached, cached: true };

  const factionState = buildFactionState(npcId);
  const authored     = getAuthoredNPC(npcId) !== null;

  // For authored NPCs, enrich the factionState with the NPC's narrative context
  if (authored) {
    const npc = getAuthoredNPC(npcId);
    factionState.npcBackstory  = npc.backstory ?? "";
    factionState.npcCurrentGoal = npc.narrative_context?.current_goal ?? "";
  }

  const result = await generateQuestChain(npcId, factionState, playerLevel);

  if (result.ok) {
    const enriched = { ...result, authored };
    cacheSet(_questCache, cacheKey, enriched);
    return enriched;
  }

  logger.warn({ npcId, playerLevel, error: result.error }, "narrative_bridge_quest_chain_failed");
  return { ...result, authored };
}

/**
 * Synthesize world lore, seeding the history engine with authored events first.
 * The authored lore events (Founding Compact, Purge, etc.) flow into synthesizeLore
 * as the world event history, giving the LLM rich authored context to write from.
 *
 * @param {string} worldId
 * @returns {Promise<{ ok: boolean, lore?: object, error?: string }>}
 */
export async function synthesizeArcLore(worldId = "concordia-hub") {
  const cached = cacheGet(_loreCache, worldId, LORE_TTL_MS);
  if (cached) return { ...cached, cached: true };

  // Pull timeline including authored lore events (tagged "authored_lore")
  const timelineResult = getTimeline({ limit: 20, granularity: "major" });
  const worldEvents    = timelineResult?.events ?? [];

  const result = await synthesizeLore(worldEvents, []);

  if (result.ok) {
    cacheSet(_loreCache, worldId, result);
    logger.info({ worldId, eventCount: worldEvents.length }, "narrative_bridge_lore_synthesized");
    return result;
  }

  logger.warn({ worldId, error: result.error }, "narrative_bridge_lore_failed");
  return result;
}

/**
 * Invalidate cached dialogue for an NPC (call when player relationship changes).
 *
 * @param {string} npcId
 */
export function invalidateNPCDialogue(npcId) {
  for (const key of _dialogueCache.keys()) {
    if (key.startsWith(`${npcId}:`)) {
      _dialogueCache.delete(key);
    }
  }
}

/**
 * Expose cache stats for health monitoring.
 */
export function getBridgeStats() {
  return {
    dialogueCacheSize: _dialogueCache.size,
    questCacheSize:    _questCache.size,
    loreCacheSize:     _loreCache.size,
  };
}
