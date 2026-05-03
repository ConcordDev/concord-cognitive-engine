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
import { getAuthoredNPC, getAuthoredFaction, getQuestsForNPC, getAuthoredDialogue } from "./content-seeder.js";
import { getFactionPolicyState } from "./council-world-bridge.js";

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
/**
 * Pull recent "social_awareness" shadows for an NPC's world/faction.
 * Cap on size keeps oracle prompts from blowing out (default 1024 bytes).
 * Returns a short array of { author, summary } strings; empty array if
 * the social-npc-bridge hasn't run yet or STATE is missing.
 */
function buildSocialSignals(npcId, _db = null, maxBytes = 1024, maxItems = 5) {
  // STATE.shadowDtus is populated by the shadow-graph + social-npc-bridge.
  const state = globalThis._concordSTATE;
  if (!state?.shadowDtus || state.shadowDtus.size === 0) return [];

  const npc = getAuthoredNPC(npcId);
  const npcWorld = npc?.world_id ?? null;
  const npcFaction = npc?.faction_id ?? null;

  // Newest first.
  const all = Array.from(state.shadowDtus.values())
    .filter((s) => Array.isArray(s.tags) && s.tags.includes("social_awareness"))
    .filter((s) => {
      // If the shadow names a target world or faction, it must match the NPC's.
      // Untargeted (global) shadows reach every NPC.
      if (s.targetWorldId && npcWorld && s.targetWorldId !== npcWorld) return false;
      if (s.targetFactionId && npcFaction && s.targetFactionId !== npcFaction) return false;
      return true;
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const out = [];
  let bytes = 0;
  for (const s of all) {
    if (out.length >= maxItems) break;
    const summary = (s.core?.summary ?? s.summary ?? "").toString().slice(0, 280);
    if (!summary) continue;
    const item = { author: s.authorHandle ?? "anon", summary };
    const itemSize = Buffer.byteLength(JSON.stringify(item), "utf-8");
    if (bytes + itemSize > maxBytes) break;
    out.push(item);
    bytes += itemSize;
  }
  return out;
}

function buildNPCTraits(npcId, db = null) {
  const npc = getAuthoredNPC(npcId);
  if (!npc) {
    return {
      id: npcId,
      name: npcId,
      personality: "reserved",
      role: "resident",
      socialSignals: buildSocialSignals(npcId, db),
    };
  }

  const faction = npc.faction_id ? getAuthoredFaction(npc.faction_id) : null;

  // Pull the most recent council referendum outcome for the NPC's faction so
  // dialogue can visibly shift after a Phase A summit. Best-effort: a missing
  // db, missing table, or missing faction simply leaves recentPolicy null.
  let recentPolicy = null;
  if (db && npc.faction_id) {
    try {
      const history = getFactionPolicyState(db, npc.faction_id);
      if (history?.length > 0) recentPolicy = history[0].outcome;
    } catch { /* policy is best-effort context, never blocks dialogue */ }
  }

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
    recentPolicy,
    // v2.0 bidirectional awareness: recent public Social Lens posts that
    // reached this NPC's world/faction via the social-npc-bridge. Capped
    // at 1KB total + 5 items so the LLM prompt stays tight.
    socialSignals: buildSocialSignals(npcId, db),
    // Deliberately exclude secrets from LLM context — those are for human authors only
  };
}

/**
 * Build enriched factionState from authored faction data.
 */
function buildFactionState(npcId, db = null) {
  const npc = getAuthoredNPC(npcId);
  if (!npc?.faction_id) {
    return { factionName: "Independent", reputation: 50, tensions: "", recentPolicy: null };
  }

  const faction = getAuthoredFaction(npc.faction_id);
  if (!faction) {
    return { factionName: "Independent", reputation: 50, tensions: "", recentPolicy: null };
  }

  // Phase A bridge: pull the most recent referendum outcome so quest chains
  // reflect council decisions. Failure is silent — we never block on policy.
  let recentPolicy = null;
  let policyTimestamp = null;
  if (db) {
    try {
      const history = getFactionPolicyState(db, npc.faction_id);
      if (history?.length > 0) {
        recentPolicy    = history[0].outcome;
        policyTimestamp = history[0].ts;
      }
    } catch { /* best-effort */ }
  }

  return {
    factionName:  faction.name,
    reputation:   faction.faction_state?.reputation ?? 50,
    tensions:     faction.faction_state?.tensions ?? "",
    rivalFactions: faction.rival_factions?.join(", ") ?? "",
    motto:        faction.motto ?? "",
    recentPolicy,
    policyTimestamp,
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
export async function generateAuthoredDialogue(npcId, questId = null, playerRelationship = "neutral", db = null, phase = null) {
  // Hand-authored dialogue takes precedence over LLM generation. The seeder
  // loads trees from content/dialogues/ keyed by `${npcId}:${questId}:${phase}`.
  // Returning the authored tree directly bypasses the LLM and any caching —
  // these trees are immutable per release and don't need TTL invalidation.
  const authoredTree = getAuthoredDialogue(npcId, questId, phase);
  if (authoredTree) {
    return {
      ok: true,
      authored: true,
      handAuthored: true,
      dialogueTree: {
        npcId,
        generatedAt: new Date().toISOString(),
        ...authoredTree,
      },
    };
  }

  // Cache-bust on policy timestamp so a fresh referendum invalidates stale dialogue.
  const npcForKey = getAuthoredNPC(npcId);
  let policyKey = "0";
  if (db && npcForKey?.faction_id) {
    try {
      const h = getFactionPolicyState(db, npcForKey.faction_id);
      if (h?.length > 0) policyKey = String(h[0].ts);
    } catch { /* default 0 */ }
  }
  const cacheKey = `${npcId}:${questId ?? "none"}:${playerRelationship}:p${policyKey}`;
  const cached = cacheGet(_dialogueCache, cacheKey, DIALOGUE_TTL_MS);
  if (cached) return { ...cached, cached: true };

  const npcTraits    = buildNPCTraits(npcId, db);
  const questContext = buildQuestContext(npcId, questId);
  const authored     = getAuthoredNPC(npcId) !== null;

  // Repair-brain pre-flight on the seed text we're about to feed the LLM.
  // We check the backstory + speech_patterns since those are the strings most
  // likely to have been authored or user-supplied. NPC `secret` is intentionally
  // excluded from the prompt entirely; we only vet what we send.
  try {
    const rb = await import("./repair-brain.js");
    const seedText = [
      npcTraits?.role,
      npcTraits?.backstory,
      npcTraits?.personality_traits?.join?.(", "),
      npcTraits?.speech_patterns,
    ].filter(Boolean).join(" \n ").slice(0, 3000);
    if (seedText) {
      const vet = await rb.vetNPCDialogue(seedText, npcTraits);
      if (vet?.score !== null && vet?.score < rb.REPAIR_DEFAULT_FLOOR.dialogue) {
        logger.warn({ npcId, score: vet.score, flags: vet.flags },
                    "narrative_bridge_dialogue_blocked_by_repair");
        return {
          ok: false,
          error: "repair_brain_blocked",
          repair: vet,
          authored,
        };
      }
    }
  } catch { /* repair brain unavailable — fail open */ }

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
export async function generateArcQuestChain(npcId, playerLevel = 1, db = null) {
  const factionState = buildFactionState(npcId, db);
  // Quest chain caches separately per policy so a referendum forks the chain.
  const policyKey = factionState.policyTimestamp ?? "0";
  const cacheKey = `${npcId}:${playerLevel}:p${policyKey}`;
  const cached = cacheGet(_questCache, cacheKey, QUEST_TTL_MS);
  if (cached) return { ...cached, cached: true };

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
