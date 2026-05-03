/**
 * server/lib/reasoning/ongoing-shadow.js
 *
 * Shadow crystallization for ongoing reasoning sessions.
 * Called when the agent loop's context budget tracker signals shouldCrystallize.
 *
 * Design:
 * - Uses the subconscious brain (via infer) to summarise reasoning-so-far
 * - Creates a shadow DTU through the caller-supplied commitShadowDTU callback
 *   (lives in server.js where pipelineCommitDTU is available)
 * - Returns continuation context that lets the conscious brain resume
 */

import crypto from 'node:crypto';
import logger from '../../logger.js';

const MAX_GENERATIONS = 20;
const QUALITY_INSIGHT_THRESHOLD = 0.80; // minimum preservation ratio

// ── Session registry (in-memory, bounded) ───────────────────────────────────

/** @type {Map<string, object>} */
const _sessions = new Map();
// Bumped 500 → 10000 for 32GB-heap deployments.
const MAX_SESSIONS = Number(process.env.CONCORD_ONGOING_SHADOW_SESSIONS) || 10_000;

function _pruneOldSessions() {
  if (_sessions.size <= MAX_SESSIONS) return;
  const ids = [..._sessions.keys()];
  for (let i = 0; i < 50; i++) _sessions.delete(ids[i]);
}

// ── Shadow DTU builder ───────────────────────────────────────────────────────

/**
 * Build the shadow DTU data object (does not commit; caller does).
 */
function buildShadowDTU({ sessionId, generation, summary, insights, pendingQuestions, userId, lineage }) {
  const id = `shadow_rs_${crypto.randomBytes(8).toString('hex')}`;
  return {
    id,
    title: `Reasoning Shadow [session:${sessionId.slice(-8)}, gen:${generation}]`,
    tier: 'shadow',
    tags: ['shadow', 'ongoing_reasoning', `gen_${generation}`],
    human: {
      summary: summary.slice(0, 600),
      bullets: insights.slice(0, 5),
    },
    core: {
      definitions: [],
      invariants: insights,
      claims: pendingQuestions.map(q => `PENDING: ${q}`),
      examples: [],
      nextActions: [],
    },
    machine: {
      kind: 'ongoing_reasoning_shadow',
      sessionId,
      generation,
      pendingQuestions,
      createdAt: new Date().toISOString(),
    },
    ongoing_reasoning_session: sessionId,
    shadow_generation: generation,
    reasoning_continues: true,
    lineage: lineage || [],
    owner_user_id: userId || null,
    visibility: 'private',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ── Summary parser ───────────────────────────────────────────────────────────

function parseSummaryText(text) {
  const insights = [];
  const pending = [];
  const lines = text.split('\n');

  let mode = 'summary';
  const summaryLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(key insights?|insights?)\s*:/i.test(trimmed)) { mode = 'insights'; continue; }
    if (/^(pending|pending questions?|unresolved)\s*:/i.test(trimmed)) { mode = 'pending'; continue; }
    if (/^summary\s*:/i.test(trimmed)) { mode = 'summary'; continue; }

    if (mode === 'summary') summaryLines.push(trimmed);
    else if (mode === 'insights') {
      const cleaned = trimmed.replace(/^[-*•]\s*/, '');
      if (cleaned) insights.push(cleaned);
    } else if (mode === 'pending') {
      const cleaned = trimmed.replace(/^[-*•]\s*/, '');
      if (cleaned) pending.push(cleaned);
    }
  }

  return {
    summary: summaryLines.join(' ').slice(0, 1200) || text.slice(0, 1200),
    insights: insights.length ? insights : [text.slice(0, 200)],
    pendingQuestions: pending,
  };
}

// ── Crystallizer factory ─────────────────────────────────────────────────────

/**
 * Create an onCrystallize callback for use in runAgentLoop opts.
 *
 * @param {object} opts
 * @param {Function} opts.inferFn - The infer() function from @concord/inference
 * @param {Function} opts.commitShadowDTU - async (shadowDTU) => { ok, dtu }
 * @param {Function} [opts.updateSessionDb] - async (sessionId, updates) => void
 * @param {string} [opts.userId]
 * @param {string} [opts.callerId]
 * @param {string} opts.originalIntent - The original user message/intent
 * @param {string} [opts.brainRole] - e.g. 'conscious'
 * @returns {{ onCrystallize: Function, getSessionId: Function, getShadowLineage: Function }}
 */
export function createCrystallizer({
  inferFn,
  commitShadowDTU,
  updateSessionDb,
  userId,
  callerId = 'reasoning',
  originalIntent,
  brainRole = 'conscious',
}) {
  const sessionId = `rsn_${crypto.randomBytes(8).toString('hex')}`;
  const shadowLineage = [];
  let generation = 0;

  _sessions.set(sessionId, {
    id: sessionId,
    userId,
    callerId,
    originalIntent,
    brainRole,
    shadowCount: 0,
    status: 'active',
    startedAt: new Date().toISOString(),
    lastShadowAt: null,
    completedAt: null,
  });
  _pruneOldSessions();

  /**
   * Called by runAgentLoop when shouldCrystallize fires.
   * @param {{ steps: object[], workingMessages: object[] }} state
   * @returns {Promise<{ summaryText: string, continuationMessages: object[] }>}
   */
  async function onCrystallize({ steps, workingMessages }) {
    generation++;
    if (generation > MAX_GENERATIONS) {
      logger.warn('reasoning:ongoing-shadow', 'Max generations hit', { sessionId, generation });
      return null; // signal loop to stop crystallizing
    }

    logger.debug('reasoning:ongoing-shadow', 'Crystallizing reasoning', { sessionId, generation });

    // Build prompt for subconscious brain to summarise
    const historyText = workingMessages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role.toUpperCase()}: ${String(m.content || '').slice(0, 500)}`)
      .join('\n')
      .slice(0, 8000);

    const summaryPrompt = `You are summarizing an in-progress reasoning session for substrate crystallization.

Original question: ${originalIntent}

Reasoning history so far:
${historyText}

Produce a compact summary in this format:
SUMMARY:
[2-4 sentences capturing what has been reasoned so far]

KEY INSIGHTS:
- [each key finding or conclusion, one per line]

PENDING:
- [each unresolved question or next step, one per line]

Be concise but do not lose critical information. Preserve uncertainty markers.`;

    let summaryResult;
    try {
      summaryResult = await inferFn({
        role: 'subconscious',
        intent: summaryPrompt,
        history: [],
        callerId: `${callerId}:shadow-summary:gen${generation}`,
        skipBudgetTracking: true,
        maxSteps: 1,
      });
    } catch (err) {
      logger.warn('reasoning:ongoing-shadow', 'Subconscious summary failed', { sessionId, error: err?.message });
      // Fallback: use last assistant message as summary
      const lastAssistant = [...workingMessages].reverse().find(m => m.role === 'assistant');
      summaryResult = { finalText: lastAssistant?.content || 'Reasoning context summarized.' };
    }

    const parsed = parseSummaryText(summaryResult.finalText || '');

    // Create and commit shadow DTU
    const shadowDTU = buildShadowDTU({
      sessionId,
      generation,
      summary: parsed.summary,
      insights: parsed.insights,
      pendingQuestions: parsed.pendingQuestions,
      userId,
      lineage: [...shadowLineage],
    });

    try {
      await commitShadowDTU(shadowDTU);
      shadowLineage.push(shadowDTU.id);
    } catch (err) {
      logger.warn('reasoning:ongoing-shadow', 'Shadow DTU commit failed', { sessionId, error: err?.message });
      // Continue anyway — reasoning can proceed without the DTU
    }

    // Update in-memory session
    const session = _sessions.get(sessionId);
    if (session) {
      session.shadowCount = generation;
      session.lastShadowAt = new Date().toISOString();
    }

    // Notify DB if callback provided
    if (updateSessionDb) {
      try {
        await updateSessionDb(sessionId, { shadowCount: generation, lastShadowAt: new Date().toISOString() });
      } catch (_e) { /* non-fatal */ }
    }

    // Build continuation messages
    const continuationMessages = [
      {
        role: 'user',
        content: `[Continuing from reasoning shadow #${generation}]

The reasoning so far has been crystallized. Summary:
${parsed.summary}

Key insights established:
${parsed.insights.map(i => `• ${i}`).join('\n')}

${parsed.pendingQuestions.length ? `Still to resolve:\n${parsed.pendingQuestions.map(q => `• ${q}`).join('\n')}` : ''}

Continue the original task: ${originalIntent}

Build on the insights above. Do not re-derive what is already established. Proceed toward a final answer.`,
      },
    ];

    logger.debug('reasoning:ongoing-shadow', 'Crystallization complete', {
      sessionId, generation, shadowId: shadowDTU.id,
      insightsCount: parsed.insights.length,
    });

    return {
      summaryText: parsed.summary,
      continuationMessages,
      shadowId: shadowDTU.id,
      generation,
    };
  }

  function getSessionId() { return sessionId; }
  function getShadowLineage() { return [...shadowLineage]; }
  function getGeneration() { return generation; }

  /**
   * Mark session complete and return summary.
   */
  function completeSession(status = 'complete') {
    const session = _sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.completedAt = new Date().toISOString();
    }
    return {
      sessionId,
      shadowCount: generation,
      shadowLineage: [...shadowLineage],
    };
  }

  return { onCrystallize, getSessionId, getShadowLineage, getGeneration, completeSession };
}

// ── Session accessors (for routes) ──────────────────────────────────────────

export function getReasoningSession(id) {
  return _sessions.get(id) || null;
}

export function listReasoningSessions(limit = 20) {
  return [..._sessions.values()]
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, limit);
}
