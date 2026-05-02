// server/lib/inference/context-assembler.js
// Assembles the messages array from an InferRequest:
//   system prompt (lens context) → DTU substrate → personal substrate → history → intent

import { fetchPersonalSubstrate } from "../chat-context-pipeline.js";
import { MEMORY_LAYERS } from "../agentic/memory-bank.js";
import freshnessEngine from "../freshness-engine.js";
const { applyFreshnessToRelevance } = freshnessEngine;

const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_CHARS = 12000;
const MAX_DTU_CHARS = 4000;

/**
 * Build a lens-aware system prompt.
 */
function buildLensSystemPrompt(lensContext) {
  if (!lensContext) return null;
  const { lens, mode, focus, operation } = lensContext;
  const parts = ["You are operating within the Concord cognitive system."];
  if (lens) parts.push(`Active lens: ${lens}.`);
  if (mode) parts.push(`Mode: ${mode}.`);
  if (focus) parts.push(`Focus area: ${focus}.`);
  if (operation) parts.push(`Current operation: ${operation}.`);
  return parts.join(" ");
}

/**
 * Format a list of DTU objects into a substrate context block.
 */
function formatDTUContext(dtus) {
  if (!dtus?.length) return null;
  const lines = ["[SUBSTRATE CONTEXT — relevant knowledge DTUs]"];
  let chars = lines[0].length;

  for (const dtu of dtus) {
    const snippet = `\n• ${dtu.title || dtu.id}: ${(dtu.content || dtu.summary || "").slice(0, 400)}`;
    if (chars + snippet.length > MAX_DTU_CHARS) break;
    lines.push(snippet);
    chars += snippet.length;
  }

  return lines.join("");
}

/**
 * Format personal DTUs (scope = 'personal') for system prompt insertion.
 * Marked user-private so the tracer skips capture.
 */
function formatPersonalSubstrate(dtus) {
  if (!dtus?.length) return null;
  const lines = ["[PERSONAL SUBSTRATE — your private knowledge]"];
  for (const dtu of dtus) {
    lines.push(`• ${dtu.title || dtu.id}: ${(dtu.analysis?.summary || "").slice(0, 300)}`);
  }
  return lines.join("\n");
}

/**
 * Compress history to fit within token budget.
 * Simple strategy: keep the most recent messages that fit within char limit.
 */
function compressHistory(history) {
  if (!history?.length) return [];
  const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
  let totalChars = 0;
  const result = [];
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const len = (trimmed[i].content || "").length;
    if (totalChars + len > MAX_HISTORY_CHARS) break;
    result.unshift(trimmed[i]);
    totalChars += len;
  }
  return result;
}

/**
 * Fetch DTUs from the public substrate by ref IDs.
 * Falls back gracefully if db is not provided.
 * @param {string[]} dtuRefs
 * @param {object} [db]
 * @returns {Promise<object[]>}
 */
async function fetchPublicDTUs(dtuRefs, db) {
  if (!dtuRefs?.length || !db) return [];
  try {
    const placeholders = dtuRefs.map(() => "?").join(",");
    return db.prepare(`SELECT id, title, content FROM dtus WHERE id IN (${placeholders})`).all(...dtuRefs);
  } catch {
    return [];
  }
}

/**
 * Assemble a complete messages array from an InferRequest.
 *
 * @param {import('./types.js').InferRequest} req
 * @param {object} [db] - better-sqlite3 instance for DTU lookups
 * @returns {Promise<import('./types.js').Message[]>}
 */
export async function assembleContext(req, db) {
  /** @type {import('./types.js').Message[]} */
  const messages = [];

  // 1. Lens system prompt
  const lensPrompt = buildLensSystemPrompt(req.lensContext);
  if (lensPrompt) {
    messages.push({ role: "system", content: lensPrompt });
  }

  // 2. Public DTU substrate
  if (req.dtuRefs?.length) {
    let dtus = await fetchPublicDTUs(req.dtuRefs, db);
    // Apply freshness-weighted re-ranking before taking top-N
    try {
      const ranked = applyFreshnessToRelevance(
        dtus.map(d => ({ score: d.score || 0.5, dtu: d, ...d })),
        { freshnessWeight: 0.3 }
      );
      dtus = ranked.map(r => r.dtu || r);
    } catch (_frErr) {
      // Non-fatal: use original order if freshness ranking fails
    }
    const block = formatDTUContext(dtus);
    if (block) messages.push({ role: "system", content: block });
  }

  // 3. Personal substrate (user-private — excluded from tracer capture)
  if (req.userId && req.sessionKey && db) {
    const personalDTUs = fetchPersonalSubstrate(req.userId, req.sessionKey, req.intent, db);
    const block = formatPersonalSubstrate(personalDTUs);
    if (block) {
      messages.push({ role: "system", content: block, scope: "user-private" });
    }
  }

  // 4. Conversation history (compressed)
  const history = compressHistory(req.history);
  messages.push(...history);

  // 5. Current intent
  messages.push({ role: "user", content: req.intent });

  return messages;
}

/**
 * Describe the available memory layers for metadata / introspection purposes.
 * This is additive — callers can inspect what memory layers are available
 * without any behavioral change to assembleContext().
 *
 * @returns {typeof MEMORY_LAYERS}
 */
export function getMemoryLayerMetadata() {
  return MEMORY_LAYERS;
}
