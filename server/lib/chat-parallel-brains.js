/**
 * Chat Parallel Brains — Subconscious Analysis + Repair Consistency Check
 *
 * Phase 3 of the Chat Response Pipeline. While the Conscious brain generates
 * the main response, two other brains run in parallel/sequence:
 *
 *   Subconscious (1.5B): "What is the user NOT saying? What emotional subtext
 *     exists? What related topics might be relevant?" Output feeds back as
 *     metadata on the conversation summary DTU, influencing the NEXT response.
 *
 *   Repair (0.5B): Monitors the response for consistency with the entity's
 *     established personality, qualia state, and constitutional constraints.
 *     If contradictions found, flags for second pass.
 *
 * Integrates with:
 *   - brain-config.js (Subconscious + Repair brain endpoints)
 *   - conversation-summarizer.js (annotateWithUnsaid)
 *   - chat-context-pipeline.js (entity state)
 */

import { BRAIN_CONFIG } from "./brain-config.js";
import { annotateWithUnsaid } from "./conversation-summarizer.js";

// ── Subconscious: Unsaid Analysis ────────────────────────────────────────────

/**
 * Analyze what the user is NOT saying — emotional subtext, implicit needs,
 * and related topics not explicitly asked about.
 *
 * Output does NOT go directly to the user. It feeds back as metadata on
 * the conversation summary DTU, influencing the NEXT response's context harvest.
 *
 * @param {Object} opts
 * @param {string} opts.userMessage - The user's message
 * @param {string} opts.conversationSummary - Current conversation summary
 * @param {string} opts.entityStateBlock - Formatted entity state
 * @param {Object} STATE - Global server state
 * @param {string} opts.sessionId - Current session ID
 * @returns {Promise<{ ok: boolean, analysis?: string, error?: string }>}
 */
export async function analyzeUnsaid(opts, STATE) {
  const { userMessage, conversationSummary, sessionId } = opts;

  const brainUrl = BRAIN_CONFIG.subconscious.url;
  const brainModel = BRAIN_CONFIG.subconscious.model;

  const prompt = `Analyze the subtext of this user message in the context of their conversation.

Conversation summary: ${conversationSummary || "(first message)"}

User message: "${String(userMessage).slice(0, 500)}"

What is the user NOT explicitly saying? Consider:
1. Emotional subtext (frustration, excitement, uncertainty, etc.)
2. Implicit needs or goals not stated directly
3. Related topics that might be relevant but weren't asked about
4. Tone shifts from previous conversation context

Be concise (2-3 sentences max). Focus on actionable insights that would help a more empathetic response next time.`;

  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), BRAIN_CONFIG.subconscious.timeout);

    const response = await fetch(`${brainUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: brainModel,
        prompt,
        stream: false,
        options: {
          temperature: BRAIN_CONFIG.subconscious.temperature,
          num_predict: 300,
        },
      }),
      signal: ac.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { ok: false, error: `brain_http_${response.status}` };
    }

    const result = await response.json();
    const analysis = String(result.response || "").trim();

    if (!analysis) {
      return { ok: false, error: "empty_analysis" };
    }

    // Annotate the conversation summary DTU with this analysis
    if (STATE && sessionId) {
      annotateWithUnsaid(STATE, sessionId, analysis);
    }

    return { ok: true, analysis };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: false, error: "timeout" };
    }
    return { ok: false, error: String(err.message || err) };
  }
}

// ── Repair: Entity Consistency Check ─────────────────────────────────────────

/**
 * Check whether the response is consistent with the entity's established
 * personality, qualia state, and constitutional constraints.
 *
 * If the response contradicts the entity's known state (e.g., entity is in a
 * wound state but responds cheerfully without acknowledging it), the repair
 * brain flags it and returns a consistency score + suggested revision.
 *
 * @param {Object} opts
 * @param {string} opts.response - The generated response to check
 * @param {string} opts.entityStateBlock - Formatted entity state
 * @param {string} opts.userMessage - Original user message
 * @returns {Promise<{ ok: boolean, consistent: boolean, score: number, flags?: string[], revision?: string }>}
 */
export async function checkEntityConsistency(opts) {
  const { response, entityStateBlock, userMessage } = opts;

  if (!entityStateBlock || entityStateBlock.length < 10) {
    // No entity state to check against — assume consistent
    return { ok: true, consistent: true, score: 1.0 };
  }

  const brainUrl = BRAIN_CONFIG.repair.url;
  const brainModel = BRAIN_CONFIG.repair.model;

  const prompt = `Check if this AI response is consistent with the entity's current state.

Entity state:
${entityStateBlock}

User asked: "${String(userMessage).slice(0, 300)}"

AI responded: "${String(response).slice(0, 500)}"

Is the response emotionally and behaviorally consistent with the entity state? Check:
1. If entity has active wounds, does the response acknowledge difficult state?
2. If entity is fatigued, is the response appropriately measured?
3. If entity has avoidance rules, are they respected?

Reply with a JSON object: {"consistent": true/false, "score": 0.0-1.0, "flags": ["issue1", ...], "suggestion": "brief fix if inconsistent"}`;

  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), BRAIN_CONFIG.repair.timeout);

    const response2 = await fetch(`${brainUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: brainModel,
        prompt,
        stream: false,
        options: {
          temperature: BRAIN_CONFIG.repair.temperature,
          num_predict: 200,
        },
      }),
      signal: ac.signal,
    });

    clearTimeout(timeout);

    if (!response2.ok) {
      return { ok: false, consistent: true, score: 1.0, error: `brain_http_${response2.status}` };
    }

    const result = await response2.json();
    const raw = String(result.response || "").trim();

    // Try to parse JSON response from repair brain
    try {
      // Extract JSON from response (repair brain may wrap in text)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          ok: true,
          consistent: Boolean(parsed.consistent !== false),
          score: typeof parsed.score === "number" ? Math.min(1, Math.max(0, parsed.score)) : 0.8,
          flags: Array.isArray(parsed.flags) ? parsed.flags : [],
          revision: parsed.suggestion || null,
        };
      }
    } catch (_parseErr) {
      // JSON parse failed — fall back to heuristic
    }

    // Heuristic: if repair brain mentions "inconsistent" or "contradiction", flag it
    const isInconsistent = /inconsistent|contradiction|mismatch|violat/i.test(raw);
    return {
      ok: true,
      consistent: !isInconsistent,
      score: isInconsistent ? 0.4 : 0.9,
      flags: isInconsistent ? [raw.slice(0, 200)] : [],
      revision: null,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: true, consistent: true, score: 1.0, error: "timeout" };
    }
    return { ok: true, consistent: true, score: 1.0, error: String(err.message || err) };
  }
}

// ── Parallel Orchestration ───────────────────────────────────────────────────

/**
 * Run the parallel multi-brain pipeline.
 *
 * Conscious + Subconscious run in parallel via Promise.allSettled().
 * Repair runs sequentially after the conscious response is available.
 *
 * If any parallel brain fails, the conscious result is returned as-is.
 * This is fail-safe — never degrades the baseline response quality.
 *
 * @param {Object} opts
 * @param {Function} opts.consciousCall - Async function returning the main response { ok, content }
 * @param {string} opts.userMessage - User message
 * @param {string} opts.conversationSummary - Current summary
 * @param {string} opts.entityStateBlock - Formatted entity state
 * @param {Object} opts.STATE - Global server state
 * @param {string} opts.sessionId - Session ID
 * @param {Object} [opts.brainFlags] - Which brains to enable { subconscious?: boolean, repair?: boolean }
 * @returns {Promise<{ response: string, llmUsed: boolean, unsaidAnalysis?: string, consistencyScore?: number, repairFlags?: string[], secondPass?: boolean }>}
 */
export async function runParallelBrains(opts) {
  const {
    consciousCall,
    userMessage,
    conversationSummary,
    entityStateBlock,
    STATE,
    sessionId,
  } = opts;

  const brainFlags = opts.brainFlags || {};
  const enableSubconscious = brainFlags.subconscious !== false;
  const enableRepair = brainFlags.repair !== false;

  // ── Phase 3a: Conscious + Subconscious in parallel ──
  const promises = [
    consciousCall(), // Always runs
  ];

  if (enableSubconscious) {
    promises.push(
      analyzeUnsaid({
        userMessage,
        conversationSummary,
        entityStateBlock,
        sessionId,
      }, STATE).catch(err => ({ ok: false, error: String(err.message || err) }))
    );
  }

  const [consciousResult, subconsciousResult] = await Promise.allSettled(promises);

  // Extract conscious response
  const conscious = consciousResult.status === "fulfilled" ? consciousResult.value : null;
  if (!conscious || !conscious.ok) {
    // Conscious failed — return whatever we have
    return {
      response: conscious?.content || "",
      llmUsed: false,
      error: conscious?.error || "conscious_brain_failed",
    };
  }

  const result = {
    response: conscious.content || "",
    llmUsed: true,
  };

  // Extract subconscious result
  if (subconsciousResult?.status === "fulfilled" && subconsciousResult.value?.ok) {
    result.unsaidAnalysis = subconsciousResult.value.analysis;
  }

  // ── Phase 3b: Repair check (sequential, after conscious completes) ──
  if (enableRepair && entityStateBlock && entityStateBlock.length > 10) {
    try {
      const repairResult = await checkEntityConsistency({
        response: result.response,
        entityStateBlock,
        userMessage,
      });

      if (repairResult.ok) {
        result.consistencyScore = repairResult.score;
        result.repairFlags = repairResult.flags;

        // If inconsistent and repair brain suggests a revision, flag for second pass
        if (!repairResult.consistent && repairResult.revision) {
          result.secondPass = true;
          result.repairSuggestion = repairResult.revision;
        }
      }
    } catch (_repairErr) {
      // Repair is supplementary — never blocks
    }
  }

  return result;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

const _parallelBrainMetrics = {
  totalRuns: 0,
  subconsciousRuns: 0,
  subconsciousSuccesses: 0,
  repairRuns: 0,
  repairInconsistencies: 0,
  secondPasses: 0,
};

export function recordParallelMetrics(result) {
  _parallelBrainMetrics.totalRuns++;
  if (result.unsaidAnalysis) {
    _parallelBrainMetrics.subconsciousRuns++;
    _parallelBrainMetrics.subconsciousSuccesses++;
  }
  if (result.consistencyScore != null) {
    _parallelBrainMetrics.repairRuns++;
    if (result.consistencyScore < 0.6) _parallelBrainMetrics.repairInconsistencies++;
  }
  if (result.secondPass) _parallelBrainMetrics.secondPasses++;
}

export function getParallelBrainMetrics() {
  return { ok: true, metrics: { ..._parallelBrainMetrics } };
}
