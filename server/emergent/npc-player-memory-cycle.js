// server/emergent/npc-player-memory-cycle.js
//
// Wave A / A2 — periodically compiles `summary_json` for npc_player_memories
// rows that have stale or missing summaries. Deterministic stub by default;
// upgrades to a subconscious-brain summary when CONCORD_NPC_PLAYER_MEMORY_LLM
// is set.
//
// Heartbeat invariant: never throws.
// Kill switch: CONCORD_NPC_PLAYER_MEMORY=0.

import logger from "../logger.js";
import {
  persistSummary, recentInteractions, pruneStaleInteractions,
} from "../lib/npc-player-memory.js";

const MAX_COMPILES_PER_PASS = 8;
const SUMMARY_STALENESS_S = 6 * 3600;     // recompile every 6h if interactions changed
const MIN_INTERACTIONS_TO_SUMMARIZE = 3;  // skip drive-by sightings
const PRUNE_EVERY_N_TICKS = 24;            // ~ daily at freq 60 (15min cadence)

let _tickCount = 0;

export async function runNpcPlayerMemoryCycle({ db } = {}) {
  if (process.env.CONCORD_NPC_PLAYER_MEMORY === "0") {
    return { ok: false, reason: "disabled" };
  }
  if (!db) return { ok: false, reason: "no_db" };
  _tickCount++;

  let candidates = [];
  try {
    candidates = db.prepare(`
      SELECT npc_id, player_id, world_id, sentiment, interactions, last_interaction_at,
             last_summary_compiled_at
      FROM npc_player_memories
      WHERE interactions >= ?
        AND (
          last_summary_compiled_at IS NULL
          OR last_summary_compiled_at < ?
        )
      ORDER BY last_interaction_at DESC
      LIMIT ?
    `).all(
      MIN_INTERACTIONS_TO_SUMMARIZE,
      Math.floor(Date.now() / 1000) - SUMMARY_STALENESS_S,
      MAX_COMPILES_PER_PASS,
    );
  } catch {
    return { ok: true, reason: "no_table", compiled: 0 };
  }

  const stats = { ok: true, evaluated: candidates.length, compiled: 0, errored: 0, pruned: 0 };
  for (const c of candidates) {
    try {
      const events = recentInteractions(db, c.npc_id, c.player_id, 40);
      if (events.length === 0) continue;
      const summary = await _composeSummary({ memory: c, events });
      persistSummary(db, c.npc_id, c.player_id, summary);
      stats.compiled++;
    } catch (err) {
      stats.errored++;
      logger?.warn?.("npc-player-memory-cycle", "compile_failed", {
        npcId: c.npc_id, playerId: c.player_id, error: err?.message,
      });
    }
  }

  // Periodic prune of the interaction log so it doesn't grow forever.
  if (_tickCount % PRUNE_EVERY_N_TICKS === 0) {
    const p = pruneStaleInteractions(db, 90);
    if (p?.deleted) stats.pruned = p.deleted;
  }
  return stats;
}

/**
 * Compose a compact summary. Default is deterministic from event counts +
 * sentiment. LLM mode (CONCORD_NPC_PLAYER_MEMORY_LLM=true) routes to the
 * subconscious brain. The deterministic path keeps the substrate testable
 * without depending on a live brain stack.
 */
async function _composeSummary({ memory, events }) {
  const counts = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  const dominantKind = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  const lastTopic = events.find((e) => e.payload?.topic)?.payload?.topic ?? null;
  const dominantSentiment = memory.sentiment >= 0.4 ? "warm"
                           : memory.sentiment <= -0.4 ? "cold"
                           : "neutral";

  const headline = _composeHeadline(dominantSentiment, dominantKind, lastTopic);

  // Try LLM if explicitly enabled and the brain registry resolves.
  if (process.env.CONCORD_NPC_PLAYER_MEMORY_LLM === "true") {
    try {
      const llm = await _maybeLlmCompose({ memory, events, dominantKind, lastTopic });
      if (llm) return { ...llm, dominantKind, lastTopic, dominantSentiment };
    } catch { /* fall back to deterministic */ }
  }

  return {
    headline,
    dominantKind,
    lastTopic,
    dominantSentiment,
    eventCounts: counts,
    sentiment: memory.sentiment,
  };
}

function _composeHeadline(sentiment, kind, topic) {
  const verb = {
    spoke:               sentiment === "warm" ? "shared words with" : sentiment === "cold" ? "argued with" : "spoke with",
    answered_question:   sentiment === "warm" ? "opened up to" : sentiment === "cold" ? "snapped at" : "answered",
    gift:                sentiment === "warm" ? "received a gift from" : "took something from",
    fought:              sentiment === "cold" ? "fought against" : "trained beside",
    helped:              "was helped by",
    witnessed_atrocity:  "watched a terrible act by",
    sighting:            "saw",
  }[kind] || "interacted with";
  return topic ? `${verb} them; topic: ${topic}` : `${verb} them`;
}

async function _maybeLlmCompose({ memory, events, dominantKind, lastTopic }) {
  // Lazy-import so tests that don't have the brain stack don't break.
  try {
    const { composeSystemPrompt } = await import("../lib/prompt-registry.js");
    const router = await import("../lib/brain-router.js");
    const callBrain = router?.default?.callBrain || router?.callBrain;
    if (!callBrain) return null;
    const { system } = composeSystemPrompt
      ? composeSystemPrompt("subconscious", { task: "npc-player-memory-summary" })
      : { system: "You compose terse first-person NPC memory summaries." };
    const eventLines = events.slice(0, 10).map((e) =>
      `- ${e.kind}${e.payload?.topic ? ` (topic: ${e.payload.topic})` : ""}`,
    ).join("\n");
    const user = [
      "Compose a 2-sentence memory the NPC carries of this player.",
      `Sentiment: ${memory.sentiment.toFixed(2)} (range -1..+1)`,
      `Sightings: ${memory.sightings}, Interactions: ${memory.interactions}`,
      `Dominant interaction kind: ${dominantKind}`,
      lastTopic ? `Last topic mentioned: ${lastTopic}` : "",
      "Recent interactions:",
      eventLines,
    ].filter(Boolean).join("\n");
    const out = await callBrain({ brain: "subconscious", system, user, maxTokens: 80, timeoutMs: 8000 });
    const text = typeof out === "string" ? out : (out?.text || "");
    if (text && text.length > 4) return { headline: text.trim().slice(0, 320), composer: "subconscious" };
    return null;
  } catch {
    return null;
  }
}

export const _internal = { _composeSummary, _composeHeadline };
