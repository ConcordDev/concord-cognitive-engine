/**
 * server/lib/reasoning/continuation.js
 *
 * Multi-generation reasoning coordination.
 * Orchestrates runAgentLoop with crystallization: creates a ContextBudgetTracker,
 * wires onCrystallize via createCrystallizer, runs synthesis across accumulated
 * shadow DTUs, and returns a final response + reasoningSessionId.
 *
 * Used by any agentic task that may exceed a single context window:
 *   const result = await executeReasoningWithCrystallization({ intent, brain, messages, ... })
 *   // result.reasoningSessionId present only when crystallization occurred
 */

import { ContextBudgetTracker, getBrainBudget } from '../inference/context-budget.js';
import { createCrystallizer } from './ongoing-shadow.js';
import { synthesizeFromShadows } from './synthesis.js';
import { runAgentLoop } from '../inference/agent-loop.js';
import logger from '../../logger.js';

/**
 * Build a continuation prompt that incorporates shadow DTU summaries as substrate.
 *
 * @param {object[]} shadows - Shadow DTU objects (each has .human.summary, .core.invariants)
 * @param {string} originalIntent
 * @param {string} [currentFragment] - Partial reasoning from the last step (may be empty)
 * @returns {string}
 */
export function buildContinuationPrompt(shadows, originalIntent, currentFragment = '') {
  if (!shadows.length) {
    return currentFragment
      ? `Continue reasoning about: ${originalIntent}\n\n${currentFragment}`
      : `Address: ${originalIntent}`;
  }

  const shadowSummaries = shadows.map((s, i) => {
    const summary = s.human?.summary || s.machine?.summary || '(summary unavailable)';
    const insights = (s.core?.invariants || s.human?.bullets || []).slice(0, 4);
    const insightBlock = insights.length ? '\n  • ' + insights.join('\n  • ') : '';
    return `Shadow ${i + 1} of ${shadows.length}: ${summary}${insightBlock}`;
  }).join('\n\n');

  return `[Context from ${shadows.length} prior reasoning stage(s)]
${shadowSummaries}

${currentFragment ? `Latest reasoning fragment:\n${currentFragment.slice(0, 2000)}\n\n` : ''}Continue addressing: ${originalIntent}
Build directly on the established insights without re-deriving them.`;
}

/**
 * Continue reasoning using accumulated shadow DTUs as substrate context.
 * Fetches shadow DTU data via the supplied getShadowDTUs callback, injects
 * them into a new inference call, and returns the resulting text.
 *
 * @param {{ shadowLineage: string[], generation: number, originalIntent: string }} state
 * @param {{ inferFn: Function, callerId: string, brainRole?: string, getShadowDTUs?: Function }} ctx
 * @returns {Promise<{ text: string, usedShadows: number }>}
 */
export async function continueReasoningWithShadows(state, ctx) {
  const { shadowLineage = [], generation = 0, originalIntent } = state;
  const { inferFn, callerId, brainRole = 'conscious', getShadowDTUs } = ctx;

  let shadows = [];
  if (getShadowDTUs && shadowLineage.length > 0) {
    try {
      shadows = (await getShadowDTUs(shadowLineage)) || [];
    } catch (_e) {
      logger.debug('reasoning:continuation', 'Shadow DTU retrieval failed (non-fatal)', { error: _e?.message });
    }
  }

  const continuationPrompt = buildContinuationPrompt(shadows, originalIntent);

  const result = await inferFn({
    role: brainRole,
    intent: continuationPrompt,
    history: [],
    callerId: `${callerId}:continuation:gen${generation}`,
    maxSteps: 5,
    skipBudgetTracking: true, // don't recurse into crystallization here
  });

  return { text: result.finalText || '', usedShadows: shadows.length };
}

/**
 * Execute reasoning with automatic crystallization when the context budget is exceeded.
 * This is the top-level entry point for agentic tasks that may need unlimited context.
 *
 * Wires together:
 *   - ContextBudgetTracker (context-budget.js) — detects when to crystallize
 *   - createCrystallizer (ongoing-shadow.js) — produces shadow DTUs and continuation prompts
 *   - runAgentLoop (agent-loop.js) — multi-step inference with tool dispatch
 *   - synthesizeFromShadows (synthesis.js) — final synthesis when shadows accumulated
 *
 * @param {object} opts
 * @param {string}   opts.intent          - User's question or task
 * @param {object}   opts.brain           - BrainHandle from selectBrain()
 * @param {object[]} opts.messages        - Initial message array
 * @param {object[]} [opts.tools]         - Tool definitions for the loop
 * @param {Function} opts.inferFn         - infer() function (for subconscious summary + synthesis)
 * @param {Function} opts.commitShadowDTU - async (shadowDTU) => { ok } — saves shadow to substrate
 * @param {string}   [opts.userId]
 * @param {string}   [opts.callerId]
 * @param {string}   [opts.brainRole]     - e.g. 'conscious'
 * @param {string}   [opts.modelName]     - Brain model for budget calculation (e.g. 'qwen2.5:14b')
 * @param {number}   [opts.maxSteps]      - Max agent loop steps (default 10)
 * @param {object}   [opts.dispatchCtx]   - Tool dispatch context
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{
 *   finalText: string,
 *   reasoningSessionId?: string,
 *   shadowCount: number,
 *   crystallizations: number,
 *   wasSynthesized: boolean,
 *   steps: object[],
 * }>}
 */
export async function executeReasoningWithCrystallization(opts) {
  const {
    intent,
    brain,
    messages,
    tools = [],
    inferFn,
    commitShadowDTU,
    userId,
    callerId = 'reasoning:execute',
    brainRole = 'conscious',
    modelName,
    maxSteps = 10,
    dispatchCtx,
    signal,
  } = opts;

  // Budget tracker: fires shouldCrystallize at 75% of the effective context window
  const capacity = getBrainBudget(modelName);
  const budgetTracker = new ContextBudgetTracker(capacity);

  // Crystallizer: wraps the onCrystallize callback, creates session + shadow DTUs
  const crystallizer = createCrystallizer({
    inferFn,
    commitShadowDTU: commitShadowDTU || (async (_dtu) => ({ ok: true })),
    userId,
    callerId,
    originalIntent: intent,
    brainRole,
  });

  const reasoningSessionId = crystallizer.getSessionId();

  logger.debug('reasoning:continuation', 'Starting crystallization-capable reasoning', {
    callerId,
    reasoningSessionId,
    capacity,
    maxSteps,
  });

  try {
    const result = await runAgentLoop(brain, messages, tools, {
      maxSteps,
      budgetTracker,
      onCrystallize: crystallizer.onCrystallize,
      dispatchCtx,
      signal,
    });

    const shadowLineage = crystallizer.getShadowLineage();
    const generation = crystallizer.getGeneration();

    let finalText = result.finalText;
    let wasSynthesized = false;

    // If shadows accumulated, synthesize a coherent final response across all of them
    if (generation > 0 && shadowLineage.length > 0) {
      logger.debug('reasoning:continuation', 'Synthesizing from accumulated shadows', {
        reasoningSessionId,
        shadowCount: generation,
      });

      const synthResult = await synthesizeFromShadows({
        originalIntent: intent,
        shadows: [], // synthesis.js uses the prompt built from shadowLineage via buildSynthesisPrompt
        currentReasoningText: result.finalText,
        inferFn,
        callerId,
        brainRole,
      });

      finalText = synthResult.text;
      wasSynthesized = synthResult.wasSynthesized;
    }

    crystallizer.completeSession('complete');

    logger.debug('reasoning:continuation', 'Reasoning complete', {
      reasoningSessionId,
      shadowCount: generation,
      wasSynthesized,
      crystallizations: result.crystallizations || 0,
    });

    return {
      finalText,
      // Only expose sessionId when crystallization actually occurred
      reasoningSessionId: generation > 0 ? reasoningSessionId : undefined,
      shadowCount: generation,
      crystallizations: result.crystallizations || 0,
      wasSynthesized,
      steps: result.steps || [],
    };
  } catch (err) {
    logger.warn('reasoning:continuation', 'Reasoning execution failed', {
      error: err?.message,
      callerId,
      reasoningSessionId,
    });
    crystallizer.completeSession('failed');
    throw err;
  }
}
