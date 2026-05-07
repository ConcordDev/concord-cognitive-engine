/**
 * Oracle Brain — World Narrative AI
 *
 * Synthesizes lore, generates quest chains, and writes dialogue trees using
 * the Utility brain (Qwen2.5 3B) at CRITICAL priority. No new Ollama instance
 * needed — Utility handles fast analytical tasks.
 *
 * Brain self-training integration: if a db handle has been registered via
 * setOracleDb(), every call here consults brain_active_models for the
 * currently-routed model (so daily Modelfile refreshes take effect) and
 * logs the interaction to brain_interactions for the outcome resolver
 * to score later. When no db is registered (early bootstrap or tests),
 * falls back to the static BRAIN_CONFIG model.
 */

import { BRAIN_CONFIG } from "./brain-config.js";
import logger from "../logger.js";

const MAX_TOKENS_LORE      = 600;
const MAX_TOKENS_QUEST     = 800;
const MAX_TOKENS_DIALOGUE  = 700;

// Lazy db reference for self-training integration. server.js calls
// setOracleDb(db) after database init.
let _trainingDb = null;
export function setOracleDb(db) { _trainingDb = db || null; }

async function callUtilityBrain(prompt, maxTokens = 600, opts = {}) {
  const { url, model, temperature, timeout } = BRAIN_CONFIG.utility;

  // Brain self-training: route through the daily-refreshed model when one
  // exists. Falls back to BRAIN_CONFIG.utility.model if no swap yet, or
  // when the training infra isn't ready (early bootstrap, tests).
  let activeModel = model;
  if (_trainingDb) {
    try {
      const { getActiveBrainModel } = await import("./brain-training/runner.js");
      activeModel = getActiveBrainModel(_trainingDb, "utility", model);
    } catch { /* fall back to static */ }
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  const start = Date.now();

  try {
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: activeModel,
        prompt,
        stream: false,
        options: { temperature, num_predict: maxTokens },
      }),
      signal: ac.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      logger.warn({ status: res.status }, "oracle_brain_http_error");
      return { ok: false, error: `http_${res.status}` };
    }

    const data = await res.json();
    const text = String(data.response || "").trim();
    const elapsed = Date.now() - start;

    // Log the interaction for the brain-training corpus. Fail-safe — never
    // blocks the user-facing return path.
    if (_trainingDb && text) {
      try {
        const { logBrainInteraction } = await import("./brain-training/interaction-log.js");
        logBrainInteraction(_trainingDb, {
          brainId:   "utility",
          userId:    opts.userId || null,
          prompt:    { input: prompt, maxTokens, source: "oracle-brain" },
          response:  { content: text, model: activeModel },
          domain:    opts.domain || "concordia-narrative",
          latencyMs: elapsed,
          tokensIn:  data.prompt_eval_count || null,
          tokensOut: data.eval_count || null,
        });
      } catch { /* logging never blocks */ }
    }

    return text ? { ok: true, text } : { ok: false, error: "empty_response" };
  } catch (err) {
    clearTimeout(timer);
    logger.warn({ err: err.message }, "oracle_brain_call_failed");
    return { ok: false, error: err.message };
  }
}

/**
 * Synthesize a 3-paragraph lore summary from recent world events and NPC memories.
 *
 * @param {Object[]} worldEvents  - recent history events (title, description, type)
 * @param {Object[]} npcMemories  - NPC memory entries (npc_name, summary)
 * @returns {Promise<{ ok: boolean, lore?: Object, error?: string }>}
 */
export async function synthesizeLore(worldEvents = [], npcMemories = []) {
  const eventSummary = worldEvents
    .slice(0, 15)
    .map(e => `- [${e.type}] ${e.title}: ${e.description || ""}`)
    .join("\n");

  const memorySummary = npcMemories
    .slice(0, 8)
    .map(m => `- ${m.npc_name || "Unknown"}: ${m.summary || ""}`)
    .join("\n");

  const prompt = `You are the Oracle of Concordia, a living city of knowledge.
Based on the following recent events and NPC memories, write a 3-paragraph lore entry
for the World Chronicle. Write in a mythic, slightly poetic tone. Keep each paragraph
under 80 words. Do NOT use headers or bullet points — pure narrative prose only.

Recent Events:
${eventSummary || "The city slumbers in quiet contemplation."}

NPC Memories:
${memorySummary || "The citizens speak little of the recent past."}

Write the 3-paragraph chronicle entry now:`;

  const result = await callUtilityBrain(prompt, MAX_TOKENS_LORE);
  if (!result.ok) return result;

  return {
    ok: true,
    lore: {
      id: `lore_${Date.now()}`,
      text: result.text,
      generatedAt: new Date().toISOString(),
      sourceEventCount: worldEvents.length,
      sourceMemoryCount: npcMemories.length,
    },
  };
}

/**
 * Generate a 3-step quest chain from NPC state.
 *
 * @param {string} npcId
 * @param {Object} factionState  - { factionName, reputation, tensions }
 * @param {number} playerLevel
 * @returns {Promise<{ ok: boolean, questChain?: Object, error?: string }>}
 */
export async function generateQuestChain(npcId, factionState = {}, playerLevel = 1) {
  const policyLine = factionState.recentPolicy
    ? `Recent Council Decision: ${factionState.recentPolicy}\n`
    : "";

  const prompt = `You are the Quest Oracle for Concordia.
Generate a 3-step quest chain for an NPC interaction. Output ONLY valid JSON.

NPC ID: ${npcId}
Faction: ${factionState.factionName || "Independent"}
Reputation: ${factionState.reputation ?? 50}/100
${policyLine}Player Level: ${playerLevel}

Output this exact JSON structure:
{
  "title": "Quest Chain Title",
  "steps": [
    {
      "step": 1,
      "objective": "short task description",
      "failCondition": "what causes failure",
      "reward": { "sparks": 50, "xp": 100, "item": "optional item name" }
    },
    {
      "step": 2,
      "objective": "second task",
      "failCondition": "failure condition",
      "reward": { "sparks": 100, "xp": 200 }
    },
    {
      "step": 3,
      "objective": "final task",
      "failCondition": "failure condition",
      "reward": { "sparks": 250, "xp": 500, "item": "rare reward" }
    }
  ]
}`;

  const result = await callUtilityBrain(prompt, MAX_TOKENS_QUEST);
  if (!result.ok) return result;

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (!parsed?.steps?.length) {
      return { ok: false, error: "invalid_quest_json" };
    }
    return {
      ok: true,
      questChain: {
        ...parsed,
        npcId,
        generatedAt: new Date().toISOString(),
        playerLevel,
      },
    };
  } catch {
    return { ok: false, error: "quest_json_parse_failed" };
  }
}

/**
 * Write a 4-node branching dialogue tree for an NPC encounter.
 *
 * @param {Object} npcTraits        - { name, personality, role }
 * @param {Object} questContext     - { questTitle, currentStep }
 * @param {string} playerRelationship - "stranger" | "ally" | "enemy" | "neutral"
 * @returns {Promise<{ ok: boolean, dialogueTree?: Object, error?: string }>}
 */
export async function writeDialogueTree(npcTraits = {}, questContext = {}, playerRelationship = "neutral") {
  const policyLine = npcTraits.recentPolicy
    ? `Recent Council Decision (NPC will reference this): ${npcTraits.recentPolicy}\n`
    : "";

  const prompt = `You are writing branching NPC dialogue for Concordia.
Output ONLY valid JSON. Create a 4-node dialogue tree.

NPC Name: ${npcTraits.name || "Citizen"}
Personality: ${npcTraits.personality || "reserved"}
Role: ${npcTraits.role || "resident"}
Player Relationship: ${playerRelationship}
Quest Context: ${questContext.questTitle || "none"} (step ${questContext.currentStep || 0})
${policyLine}

Output this exact JSON structure:
{
  "greeting": "NPC opening line",
  "nodes": [
    {
      "id": "node_1",
      "npcText": "what NPC says",
      "playerOptions": [
        { "text": "player choice A", "leadsTo": "node_2" },
        { "text": "player choice B", "leadsTo": "node_3" }
      ]
    },
    {
      "id": "node_2",
      "npcText": "response to A",
      "playerOptions": [
        { "text": "continue", "leadsTo": "node_4" }
      ]
    },
    {
      "id": "node_3",
      "npcText": "response to B",
      "playerOptions": [
        { "text": "farewell", "leadsTo": null }
      ]
    },
    {
      "id": "node_4",
      "npcText": "closing line that may advance quest",
      "playerOptions": []
    }
  ]
}`;

  const result = await callUtilityBrain(prompt, MAX_TOKENS_DIALOGUE);
  if (!result.ok) {
    // LLM unavailable — return a deterministic fallback tree so the dialogue
    // panel still functions. Players in offline mode get terse but coherent
    // lines tailored from npcTraits + questContext.
    return { ok: true, dialogueTree: _buildFallbackDialogue(npcTraits, questContext, playerRelationship) };
  }

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (!parsed?.nodes?.length) {
      return { ok: false, error: "invalid_dialogue_json" };
    }
    return {
      ok: true,
      dialogueTree: {
        ...parsed,
        npcId: npcTraits.id,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch {
    return { ok: true, dialogueTree: _buildFallbackDialogue(npcTraits, questContext, playerRelationship) };
  }
}

// ── Offline / fallback dialogue ─────────────────────────────────────────────
// Used when the Utility brain is offline or returns malformed JSON. The
// generated tree has the same shape as the LLM output so the dialogue
// panel doesn't need to special-case it.
function _buildFallbackDialogue(npcTraits = {}, questContext = {}, _playerRelationship = "neutral") {
  const name = npcTraits.name || "Citizen";
  const role = npcTraits.role || "resident";
  const greeting = questContext.questTitle
    ? `${name} looks up. "You're the one I've been waiting for. ${questContext.questTitle}."`
    : `${name} nods. "Stranger. What brings you to my corner of Concordia?"`;
  return {
    npcId: npcTraits.id,
    generatedAt: new Date().toISOString(),
    fallback: true,
    greeting,
    nodes: [
      {
        id: "node_1",
        npcText: questContext.questTitle
          ? `It's about ${questContext.questTitle}. The work isn't safe, but it pays.`
          : `Things have been quiet. Word travels slowly between districts.`,
        playerOptions: [
          { text: "Tell me more.", leadsTo: "node_2" },
          { text: "I should go.",  leadsTo: "node_4" },
        ],
      },
      {
        id: "node_2",
        npcText: `As a ${role}, I see what others miss. Take care of this and I'll have something for you.`,
        playerOptions: [
          { text: "I'll help.",     leadsTo: "node_3" },
          { text: "Not today.",     leadsTo: "node_4" },
        ],
      },
      {
        id: "node_3",
        npcText: `Good. Find what I described and come back.`,
        playerOptions: [
          { text: "On my way.", leadsTo: "node_4" },
        ],
      },
      {
        id: "node_4",
        npcText: `Until next time, traveler.`,
        playerOptions: [],
      },
    ],
  };
}
