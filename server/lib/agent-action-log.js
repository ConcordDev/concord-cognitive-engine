// server/lib/agent-action-log.js
//
// Phase 6 Tier 1 — agent long-term memory. Persists ConKay's past actions / tool
// outputs / verified answers (migration 334 `agent_action_log`) and retrieves the
// most relevant ones for a new turn (the Mem0/Qdrant "remember what you did"
// pattern), so future work is grounded in real prior actions across sessions and
// restarts. Retrieval ranks by **relevance × recency** (RAG-as-curator): embedding
// cosine when available, keyword overlap as the offline fallback — same
// degrade-gracefully contract as the rest of the substrate.
//
// `embed`/`cosineSimilarity` are injectable for deterministic offline tests.

import crypto from "node:crypto";
import { embed as realEmbed, cosineSimilarity as realCosine, isEmbeddingAvailable } from "../embeddings.js";

const RELEVANCE_WEIGHT = 0.7;
const RECENCY_WEIGHT = 0.3;
const RECENCY_HALFLIFE_S = 7 * 24 * 3600; // a week
const DEFAULT_WINDOW_DAYS = 30;
const CANDIDATE_CAP = 200;

function nowS() { return Math.floor(Date.now() / 1000); }
function truncate(s, n) { const t = String(s ?? ""); return t.length > n ? t.slice(0, n) + "…" : t; }

function summarize(v, n = 400) {
  if (v == null) return null;
  if (typeof v === "string") return truncate(v, n);
  try { return truncate(JSON.stringify(v), n); } catch { return truncate(String(v), n); }
}

function actionText(action, input, output) {
  return [action, summarize(input, 300), summarize(output, 300)].filter(Boolean).join(" — ");
}

function floatToBlob(vec) {
  const f = vec instanceof Float32Array ? vec : Float32Array.from(vec || []);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}
function blobToFloat(blob) {
  if (!blob) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return new Float32Array(new Uint8Array(buf).buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function tableExists(db) {
  if (!db) return false;
  try { db.prepare("SELECT 1 FROM agent_action_log LIMIT 1").get(); return true; } catch { return false; }
}

/**
 * Record one agent action. Best-effort embed (degrades to keyword-only recall when
 * embeddings are unavailable). Never throws — memory must not break the action.
 */
export async function recordAction(db, { userId, sessionId = null, action, input = null, output = null, tool = null, outcome = null } = {}, { embedImpl } = {}) {
  try {
    if (!tableExists(db) || !userId || !action) return false;
    const text = actionText(action, input, output);
    let embeddingBlob = null;
    const e = embedImpl || (isEmbeddingAvailable() ? realEmbed : null);
    if (e) {
      try { const v = await e(text); if (v && v.length) embeddingBlob = floatToBlob(v); } catch { /* keyword fallback */ }
    }
    db.prepare(
      `INSERT INTO agent_action_log (id, user_id, session_id, action, input_json, output_summary, tool, outcome, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    ).run(crypto.randomUUID(), userId, sessionId, String(action), summarize(input), summarize(output), tool, outcome, embeddingBlob);
    return true;
  } catch { return false; }
}

function keywordScore(query, text) {
  const q = new Set(String(query || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  if (!q.size) return 0;
  const t = new Set(String(text || "").toLowerCase().split(/\W+/).filter(Boolean));
  let hit = 0;
  for (const w of q) if (t.has(w)) hit++;
  return hit / q.size;
}
function recencyScore(createdAt) {
  const age = Math.max(0, nowS() - (Number(createdAt) || 0));
  return Math.exp(-age / RECENCY_HALFLIFE_S);
}

/**
 * Retrieve the most relevant prior actions for a new turn — relevance × recency,
 * embedding cosine when available else keyword. Returns ranked rows + a compact
 * prompt block.
 */
export async function getRecentActions(db, { userId, query = null, limit = 5, sessionId = null, windowDays = DEFAULT_WINDOW_DAYS } = {}, { embedImpl, cosineImpl } = {}) {
  if (!tableExists(db) || !userId) return { actions: [], block: "" };
  const since = nowS() - Math.max(1, windowDays) * 24 * 3600;
  const rows = sessionId
    ? db.prepare("SELECT * FROM agent_action_log WHERE user_id = ? AND session_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?").all(userId, sessionId, since, CANDIDATE_CAP)
    : db.prepare("SELECT * FROM agent_action_log WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?").all(userId, since, CANDIDATE_CAP);
  if (!rows.length) return { actions: [], block: "" };

  // No query → most recent.
  if (!query) {
    const recent = rows.slice(0, limit).map(toPublic);
    return { actions: recent, block: formatActionContext(recent) };
  }

  // Relevance: embedding cosine when we can embed the query AND rows carry vectors.
  const cosine = cosineImpl || realCosine;
  const e = embedImpl || (isEmbeddingAvailable() ? realEmbed : null);
  let qVec = null;
  if (e) { try { qVec = await e(query); } catch { qVec = null; } }

  const scored = rows.map((r) => {
    const text = actionText(r.action, r.input_json, r.output_summary);
    let rel;
    const rowVec = qVec ? blobToFloat(r.embedding) : null;
    if (qVec && rowVec) rel = (cosine(qVec, rowVec) + 1) / 2; // map [-1,1]→[0,1]
    else rel = keywordScore(query, text);
    const score = rel * RELEVANCE_WEIGHT + recencyScore(r.created_at) * RECENCY_WEIGHT;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).map((s) => toPublic(s.r, s.score));
  return { actions: top, block: formatActionContext(top) };
}

function toPublic(r, score) {
  return {
    id: r.id,
    action: r.action,
    tool: r.tool || null,
    outcome: r.outcome || null,
    input: r.input_json || null,
    output: r.output_summary || null,
    createdAt: r.created_at,
    score: typeof score === "number" ? Math.round(score * 1000) / 1000 : undefined,
  };
}

/** Compact prompt block (the "last time you did X" context). */
export function formatActionContext(actions) {
  if (!actions || !actions.length) return "";
  const lines = actions.map((a) => {
    const when = a.createdAt ? new Date(a.createdAt * 1000).toISOString().slice(0, 16).replace("T", " ") : "";
    const out = a.output ? ` → ${truncate(a.output, 160)}` : "";
    return `- [${when}] ${a.action}${a.tool ? ` (${a.tool})` : ""}${out}`;
  });
  return `Relevant prior actions (your long-term memory):\n${lines.join("\n")}`;
}

export default { recordAction, getRecentActions, formatActionContext };
