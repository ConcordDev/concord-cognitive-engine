// server/lib/quest-dialogue-composer.js
//
// Phase AE — Skyrim-radiant LLM dialogue for procgen quests.
//
// Procgen quests from the lattice-quest-cycle today are template prose.
// This composer takes (quest, npcContext, worldVoice) and produces a
// 3-part dialogue so the same template delivered by different NPCs in
// different worlds sounds genuinely different:
//
//   - opener  : NPC offers the quest
//   - midline : NPC reacts when the player reports progress
//   - closer  : NPC reacts when the player completes
//
// Opt-in via CONCORD_QUEST_DIALOGUE_LLM=true. Deterministic fallback
// always works — composer never throws, falls back to template prose
// on LLM failure / timeout / env disabled.

import crypto from "node:crypto";
import logger from "../logger.js";

const LLM_TIMEOUT_MS = 8000;

/**
 * Pick a deterministic opener line per drift-type. Same signature
 * always picks the same line — caller composes the rest of the
 * dialogue around it.
 */
function _deterministicOpener(quest, npcContext = {}) {
  const tone = (npcContext.preoccupation || "neutral").slice(0, 24);
  const title = quest?.title || "this matter";
  const lines = [
    `Listen close — ${title}. ${npcContext.desire ? `If you can help, I'll see you rewarded with ${npcContext.desire}.` : "I'd owe you for this."}`,
    `Trouble's been brewing, traveler. ${title}. I can't ignore it, ${tone === "neutral" ? "not anymore" : `not while ${tone} weighs on me`}.`,
    `You look capable. ${title} — there's coin and standing in it for you.`,
  ];
  // Seed off quest id + npc tone so same quest with different NPCs
  // genuinely varies. Same NPC always picks the same opener for the
  // same quest (idempotent).
  const seed = _hashSeed((quest?.id || quest?.title || "x") + "|" + tone + "|" + (npcContext.desire || ""));
  return lines[seed % lines.length];
}

function _deterministicMidline(_quest, _npcContext) {
  const lines = [
    "Aye? Tell me — what did you find?",
    "Don't keep me waiting. What's happening out there?",
    "Speak plainly. How does it stand?",
  ];
  const seed = _hashSeed((_quest?.id || "x") + "_mid");
  return lines[seed % lines.length];
}

function _deterministicCloser(quest, npcContext) {
  const title = quest?.title || "the matter";
  const lines = [
    `Well done. Few would've seen ${title} through to the end.`,
    `So ${title} is settled. You've my thanks, and ${npcContext.desire ? `the ${npcContext.desire} I promised` : "what was promised"}.`,
    `Then it's done. The world's a touch lighter for ${title}.`,
  ];
  const seed = _hashSeed((quest?.id || "x") + "_close");
  return lines[seed % lines.length];
}

function _hashSeed(str) {
  return parseInt(crypto.createHash("sha1").update(String(str)).digest("hex").slice(0, 8), 16);
}

/**
 * Returns the deterministic 3-part dialogue.
 */
export function composeDeterministicDialogue(quest, npcContext = {}, _worldVoice = {}) {
  return {
    opener: _deterministicOpener(quest, npcContext),
    midline: _deterministicMidline(quest, npcContext),
    closer: _deterministicCloser(quest, npcContext),
    composer: "deterministic",
  };
}

/**
 * Async entry. Returns { opener, midline, closer, composer }. Calls
 * llm if CONCORD_QUEST_DIALOGUE_LLM=true and llm is provided; otherwise
 * falls back to deterministic. Never throws.
 */
export async function composeQuestDialogue(quest, npcContext = {}, worldVoice = {}, opts = {}) {
  const fallback = () => composeDeterministicDialogue(quest, npcContext, worldVoice);

  if (process.env.CONCORD_QUEST_DIALOGUE_LLM !== "true") return fallback();
  if (!opts?.llm) return fallback();

  let timeoutHandle = null;
  try {
    const prompt = _buildPrompt(quest, npcContext, worldVoice);
    const timeoutPromise = new Promise((_, rej) => {
      timeoutHandle = setTimeout(() => rej(new Error("timeout")), LLM_TIMEOUT_MS);
    });
    const callPromise = Promise.resolve().then(() => opts.llm.chat({
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      maxTokens: 400,
    }));
    const reply = await Promise.race([callPromise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const parsed = _parseLLMResponse(reply?.content || reply?.text || "");
    if (!parsed) return fallback();
    return { ...parsed, composer: "llm" };
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    logger.debug?.("quest-dialogue-composer", "llm_failed", { error: err?.message });
    return fallback();
  }
}

function _buildPrompt(quest, npcContext, worldVoice) {
  const voice = worldVoice?.tone || "neutral";
  return {
    system: `You are voicing a quest giver in a fantasy MMO. World tone: ${voice}. Compose three short lines for ONE NPC delivering ONE quest. The NPC's traits: ${JSON.stringify({
      preoccupation: npcContext.preoccupation || null,
      desire: npcContext.desire || null,
      grudge: npcContext.grudge || null,
    })}. Stay grounded in the quest title; do not invent events that contradict the quest summary.`,
    user: `Quest title: "${quest?.title || ""}". Summary: "${quest?.summary || ""}".
Respond in this exact format (newlines required):
OPENER: <one sentence the NPC says when offering the quest>
MIDLINE: <one sentence when the player reports progress>
CLOSER: <one sentence when the player completes the quest>`,
  };
}

function _parseLLMResponse(text) {
  if (!text || typeof text !== "string") return null;
  const opener = _extract(text, /OPENER:\s*(.+)/i);
  const midline = _extract(text, /MIDLINE:\s*(.+)/i);
  const closer = _extract(text, /CLOSER:\s*(.+)/i);
  if (!opener || !midline || !closer) return null;
  return { opener, midline, closer };
}

function _extract(text, re) {
  const m = text.match(re);
  return m ? m[1].trim().replace(/\n.*$/s, "") : null;
}

/**
 * Persist composed dialogue onto a lattice_born_quests row. Idempotent
 * on (drift_alert_signature) — re-compose overwrites. No-op if column
 * is missing.
 */
export function persistDialogue(db, questId, dialogue) {
  if (!db || !questId || !dialogue) return { ok: false, reason: "missing_inputs" };
  try {
    const json = JSON.stringify(dialogue);
    const r = db.prepare(`
      UPDATE lattice_born_quests SET dialogue_json = ? WHERE quest_id = ?
    `).run(json, questId);
    return { ok: true, changes: r.changes };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}

export function getDialogue(db, questId) {
  if (!db || !questId) return null;
  try {
    const r = db.prepare(`
      SELECT dialogue_json FROM lattice_born_quests WHERE quest_id = ?
    `).get(questId);
    if (!r?.dialogue_json) return null;
    return JSON.parse(r.dialogue_json);
  } catch { return null; }
}
