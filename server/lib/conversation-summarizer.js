/**
 * Conversation Summarizer — Utility Brain Compression
 *
 * Compresses conversation history into a running summary DTU every 5 exchanges
 * (10 messages). The Utility brain (3B) generates a compact context block from
 * the full conversation, keeping context tight even in long conversations.
 *
 * Old summaries are archived (not deleted) — full conversation lineage preserved.
 *
 * Integrates with:
 *   - brain-config.js (Utility brain endpoint)
 *   - chat.respond macro (triggered every 5 exchanges)
 *   - chat-context-pipeline.js (consumed as Source A in context harvest)
 */

import { BRAIN_CONFIG } from "./brain-config.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Number of exchanges (user+assistant pairs) between summary updates */
const SUMMARY_INTERVAL = 5;

/** Maximum number of archived summaries to retain per session.
 *  Bumped 20 → 200 for 32GB-heap deployments — long sessions get
 *  finer-grained summary chains. */
const MAX_ARCHIVED_SUMMARIES = Number(process.env.CONCORD_ARCHIVED_SUMMARIES) || 200;

/** Max tokens for summary generation prompt */
const SUMMARY_MAX_TOKENS = 600;

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Check whether a summary update is due for this session.
 *
 * @param {Map} sessions - STATE.sessions
 * @param {string} sessionId - Current session ID
 * @returns {boolean}
 */
export function isSummaryDue(sessions, sessionId) {
  const sess = sessions.get(sessionId);
  if (!sess || !sess.messages) return false;

  const exchangeCount = Math.floor(sess.messages.length / 2);
  const lastSummarizedAt = sess._lastSummaryExchange || 0;

  return exchangeCount > 0 && exchangeCount >= lastSummarizedAt + SUMMARY_INTERVAL;
}

/**
 * Compress conversation into a running summary DTU via the Utility brain.
 *
 * Fire-and-forget: never blocks the chat path. Wrapped in try/catch by caller.
 *
 * @param {Object} STATE - Global server state
 * @param {string} sessionId - Current session ID
 * @param {Object} [opts]
 * @param {Function} [opts.structuredLog] - Logging function
 * @returns {Promise<{ ok: boolean, summaryId?: string, error?: string }>}
 */
export async function compressConversation(STATE, sessionId, opts = {}) {
  const log = opts.structuredLog || (() => {});
  const sess = STATE.sessions.get(sessionId);
  if (!sess || !sess.messages || sess.messages.length < 4) {
    return { ok: false, error: "insufficient_messages" };
  }

  const exchangeCount = Math.floor(sess.messages.length / 2);
  const summaryId = `summary_session_${sessionId}`;

  // Get previous summary for incremental compression
  const existingSummary = STATE.shadowDtus?.get(summaryId);
  const previousSummaryText = existingSummary?.machine?.summaryText || "";

  // Build conversation text for the brain
  const recentMessages = sess.messages.slice(-20); // Last 20 messages max
  const conversationText = recentMessages.map(m =>
    `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content || "").slice(0, 400)}`
  ).join("\n");

  // Build the compression prompt
  const prompt = previousSummaryText
    ? `Previous summary:\n${previousSummaryText}\n\nNew messages:\n${conversationText}\n\nUpdate the summary to include the new messages. Keep it under 300 words. Focus on: key topics discussed, decisions made, user intent/goals, any DTUs referenced, and emotional tone. Be concise.`
    : `Conversation:\n${conversationText}\n\nSummarize this conversation in under 300 words. Focus on: key topics discussed, decisions made, user intent/goals, any DTUs referenced, and emotional tone. Be concise.`;

  // Call Utility brain
  const brainUrl = BRAIN_CONFIG.utility.url;
  const brainModel = BRAIN_CONFIG.utility.model;

  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), BRAIN_CONFIG.utility.timeout);

    const response = await fetch(`${brainUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: brainModel,
        prompt,
        stream: false,
        options: {
          temperature: BRAIN_CONFIG.utility.temperature,
          num_predict: SUMMARY_MAX_TOKENS,
        },
      }),
      signal: ac.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      log("warn", "conversation_summary_brain_error", { sessionId, status: response.status });
      return { ok: false, error: `brain_http_${response.status}` };
    }

    const result = await response.json();
    const summaryText = String(result.response || "").trim();

    if (!summaryText) {
      return { ok: false, error: "empty_summary" };
    }

    // Archive previous summary if it exists
    const previousSummaries = existingSummary?.machine?.previousSummaries || [];
    if (previousSummaryText) {
      previousSummaries.push({
        text: previousSummaryText,
        archivedAt: new Date().toISOString(),
        exchangeCount: existingSummary?.machine?.exchangeCount || 0,
      });
      // Trim archived summaries
      if (previousSummaries.length > MAX_ARCHIVED_SUMMARIES) {
        previousSummaries.splice(0, previousSummaries.length - MAX_ARCHIVED_SUMMARIES);
      }
    }

    // Create/update summary shadow DTU
    const now = new Date().toISOString();
    const summaryDtu = {
      id: summaryId,
      title: `Conversation Summary — ${sessionId.slice(0, 12)}`,
      tier: "shadow",
      tags: ["shadow", "summary", "session", `session:${sessionId}`],
      human: { summary: summaryText, bullets: [] },
      core: {
        definitions: [],
        invariants: [],
        claims: [],
        examples: [],
        nextActions: [],
      },
      machine: {
        kind: "conversation_summary",
        sessionId,
        summaryText,
        exchangeCount,
        messageCount: sess.messages.length,
        previousSummaries,
        generatedBy: "utility_brain",
        unsaidAnnotation: null, // Populated by subconscious brain (chat-parallel-brains.js)
      },
      lineage: { parents: [], children: [] },
      source: "shadow",
      meta: { hidden: true, conversationSummary: true },
      createdAt: existingSummary?.createdAt || now,
      updatedAt: now,
      authority: { model: brainModel, score: 0 },
      hash: "",
    };

    // Upsert
    if (!STATE.shadowDtus) STATE.shadowDtus = new Map();
    STATE.shadowDtus.set(summaryId, summaryDtu);

    // Mark the exchange count we summarized up to
    sess._lastSummaryExchange = exchangeCount;

    log("info", "conversation_summary_generated", {
      sessionId,
      summaryId,
      exchangeCount,
      summaryLength: summaryText.length,
      archivedCount: previousSummaries.length,
    });

    return { ok: true, summaryId, exchangeCount, summaryLength: summaryText.length };
  } catch (err) {
    if (err.name === "AbortError") {
      log("warn", "conversation_summary_timeout", { sessionId });
      return { ok: false, error: "timeout" };
    }
    log("warn", "conversation_summary_error", { sessionId, error: err.message });
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * Get the current conversation summary DTU for a session.
 *
 * @param {Object} STATE - Global server state
 * @param {string} sessionId - Session ID
 * @returns {{ ok: boolean, summary?: Object, error?: string }}
 */
export function getSessionSummary(STATE, sessionId) {
  const summaryId = `summary_session_${sessionId}`;
  const summary = STATE.shadowDtus?.get(summaryId);

  if (!summary) {
    return { ok: false, error: "no_summary" };
  }

  return {
    ok: true,
    summary: {
      id: summary.id,
      text: summary.machine?.summaryText || "",
      exchangeCount: summary.machine?.exchangeCount || 0,
      messageCount: summary.machine?.messageCount || 0,
      unsaidAnnotation: summary.machine?.unsaidAnnotation || null,
      archivedSummaryCount: (summary.machine?.previousSummaries || []).length,
      updatedAt: summary.updatedAt,
      createdAt: summary.createdAt,
    },
  };
}

/**
 * Get the raw summary text for inclusion in the context pipeline.
 * Returns empty string if no summary exists.
 *
 * @param {Object} STATE - Global server state
 * @param {string} sessionId - Session ID
 * @returns {string}
 */
export function getSummaryText(STATE, sessionId) {
  const summaryId = `summary_session_${sessionId}`;
  const summary = STATE.shadowDtus?.get(summaryId);
  return summary?.machine?.summaryText || "";
}

/**
 * Annotate a session summary with subconscious analysis.
 * Called by chat-parallel-brains.js after the subconscious brain runs.
 *
 * @param {Object} STATE - Global server state
 * @param {string} sessionId - Session ID
 * @param {string} annotation - Subconscious analysis text
 */
export function annotateWithUnsaid(STATE, sessionId, annotation) {
  const summaryId = `summary_session_${sessionId}`;
  const summary = STATE.shadowDtus?.get(summaryId);
  if (!summary) return;

  if (!summary.machine) summary.machine = {};
  summary.machine.unsaidAnnotation = annotation;
  summary.updatedAt = new Date().toISOString();
}

// ── Exports ──────────────────────────────────────────────────────────────────

export const SUMMARY_CONSTANTS = Object.freeze({
  SUMMARY_INTERVAL,
  MAX_ARCHIVED_SUMMARIES,
  SUMMARY_MAX_TOKENS,
});
