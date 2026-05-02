/**
 * Oracle Brain — World Narrative AI
 *
 * Synthesizes lore, generates quest chains, and writes dialogue trees using
 * the Utility brain (Qwen2.5 3B) at CRITICAL priority. No new Ollama instance
 * needed — Utility handles fast analytical tasks.
 */

import { BRAIN_CONFIG } from "./brain-config.js";
import logger from "../logger.js";

const MAX_TOKENS_LORE      = 600;
const MAX_TOKENS_QUEST     = 800;
const MAX_TOKENS_DIALOGUE  = 700;

async function callUtilityBrain(prompt, maxTokens = 600) {
  const { url, model, temperature, timeout } = BRAIN_CONFIG.utility;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);

  try {
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
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
  if (!result.ok) return result;

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
    return { ok: false, error: "dialogue_json_parse_failed" };
  }
}
