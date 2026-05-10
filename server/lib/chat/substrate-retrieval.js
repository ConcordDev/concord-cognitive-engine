// server/lib/chat/substrate-retrieval.js
// Semantically retrieves relevant shadow DTUs from the user's personal locker.
// Replaces linear history scrolling with query-targeted substrate recall.
// Combines relevance (keyword overlap + optional embedding) with recency decay.

import { decryptBlob, SAFE_REVIVER } from "../personal-locker/crypto.js";

const EMBEDDINGS_ENABLED = process.env.EMBEDDINGS_ENABLED !== "false" && process.env.ENABLE_EMBEDDINGS !== "false";
const DAY_MS = 86400000;
const RELEVANCE_WEIGHT = 0.7;
const RECENCY_WEIGHT = 0.3;

/**
 * Keyword overlap score between query and shadow content.
 * Simple but fast — avoids blocking embedding calls in the hot path.
 */
function keywordScore(query, content) {
  const queryWords = new Set(query.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const contentWords = content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  if (!queryWords.size) return 0;
  let hits = 0;
  for (const w of contentWords) { if (queryWords.has(w)) hits++; }
  return Math.min(1, hits / queryWords.size);
}

/**
 * Recency score: 1.0 at creation, decays over days toward 0.1.
 */
function recencyScore(timestampMs) {
  const ageInDays = (Date.now() - (timestampMs || 0)) / DAY_MS;
  return 0.1 + 0.9 * Math.exp(-ageInDays / 30); // half-life ~21 days
}

/**
 * Attempt cosine similarity via embeddings module (graceful fallback if unavailable).
 */
async function tryEmbeddingScore(query, content) {
  if (!EMBEDDINGS_ENABLED) return null;
  try {
    const { embed } = await import("../embeddings.js");
    const [qEmb, cEmb] = await Promise.all([embed(query), embed(content)]);
    if (!qEmb || !cEmb || qEmb.length !== cEmb.length) return null;
    let dot = 0, magQ = 0, magC = 0;
    for (let i = 0; i < qEmb.length; i++) {
      dot += qEmb[i] * cEmb[i]; magQ += qEmb[i] ** 2; magC += cEmb[i] ** 2;
    }
    const denom = Math.sqrt(magQ) * Math.sqrt(magC);
    return denom === 0 ? 0 : dot / denom;
  } catch { return null; }
}

/**
 * Retrieve and decrypt all shadow DTUs for a user.
 * @returns {object[]} decrypted shadow payloads
 */
function listShadows(userId, sessionKey, db) {
  if (!userId || !sessionKey || !db) return [];
  try {
    const rows = db.prepare(
      "SELECT * FROM personal_dtus WHERE user_id = ? AND content_type = 'shadow' ORDER BY created_at DESC LIMIT 200"
    ).all(userId);

    const result = [];
    for (const row of rows) {
      try {
        const plain = decryptBlob({ iv: row.iv, ciphertext: row.encrypted_content, authTag: row.auth_tag }, sessionKey);
        const payload = JSON.parse(plain.toString("utf-8"), SAFE_REVIVER);
        result.push({ ...payload, _rowId: row.id, _createdAt: row.created_at });
      } catch { /* skip undecryptable rows */ }
    }
    return result;
  } catch { return []; }
}

/**
 * Fetch the most relevant shadow DTUs for a given query.
 * Uses embedding cosine similarity when available; falls back to keyword overlap.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {Buffer} opts.sessionKey
 * @param {string} opts.query - current user message
 * @param {object} opts.db
 * @param {number} [opts.limit=5]
 * @param {string} [opts.sessionId] - optionally exclude same-session shadows
 * @returns {Promise<object[]>} top-N shadow payloads, scored
 */
export async function fetchRelevantShadowDTUs({ userId, sessionKey, query, db, limit = 5, sessionId }) {
  const shadows = listShadows(userId, sessionKey, db);
  if (!shadows.length) return [];

  const scored = await Promise.all(
    shadows.map(async (shadow) => {
      // Optionally skip shadows from the current session (already in raw history)
      if (sessionId && shadow.sessionId === sessionId) return null;

      const contentText = `${shadow.content?.intent || ""} ${shadow.content?.outcome || ""}`;
      const timestamp = shadow.content?.timestamp || 0;

      // Try embedding-based score; fall back to keyword overlap
      const embScore = await tryEmbeddingScore(query, contentText);
      const relScore = embScore !== null ? embScore : keywordScore(query, contentText);
      const recScore = recencyScore(timestamp);

      const combined = relScore * RELEVANCE_WEIGHT + recScore * RECENCY_WEIGHT;
      return { shadow, score: combined };
    })
  );

  return scored
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.shadow);
}

/**
 * Format shadow DTUs into a prompt-ready context block.
 * @param {object[]} shadows
 * @returns {string}
 */
export function formatShadowContext(shadows) {
  if (!shadows?.length) return "";
  const lines = ["[PRIOR CONVERSATION CONTEXT — semantically retrieved]"];
  for (const s of shadows) {
    const intent = s.content?.intent || "";
    const outcome = s.content?.outcome || "";
    if (intent || outcome) {
      lines.push(`• You discussed: "${intent}" → ${outcome}`);
    }
  }
  return lines.join("\n");
}
