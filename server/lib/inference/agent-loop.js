// server/lib/inference/agent-loop.js
// Multi-step inference loop: call brain → detect tool calls → dispatch → reinject.
// Respects maxSteps and StopCondition to prevent infinite loops.

import { registerTrustTrajectoryHook } from "../agentic/trust-trajectory.js";
import { createWorktree, recordOperation } from "../agentic/worktree.js";
import logger from '../../logger.js';

// Register the trust-trajectory before_tool hook once at module load.
// This is async but non-blocking; any error is non-fatal.
registerTrustTrajectoryHook().catch((err) => {
  logger.warn('inference:agent-loop', 'trust trajectory hook registration failed', { error: err?.message });
});

const DEFAULT_MAX_STEPS = 10;

/**
 * Evaluate a stop condition against accumulated steps.
 * @param {import('./types.js').StopCondition} cond
 * @param {import('./types.js').InferStep[]} steps
 * @param {string} latestText
 * @returns {boolean}
 */
function evaluateStopCondition(cond, steps, latestText) {
  if (!cond) return false;
  switch (cond.type) {
    case "text_contains":
      return latestText.includes(cond.value || "");
    case "tool_called":
      return steps.some(s => s.type === "tool_call" && s.call?.name === cond.value);
    case "max_tokens":
      return steps.reduce((sum, s) => sum + (s.response?.tokensOut || 0), 0) >= Number(cond.value || 1000);
    default:
      return false;
  }
}

/**
 * Dispatch a tool call to the appropriate lens action or MCP handler.
 * Falls back to a structured error result if dispatch isn't available.
 *
 * @param {import('./types.js').ToolCall} call
 * @param {object} [dispatchCtx]
 * @returns {Promise<string>}
 */
async function dispatchTool(call, dispatchCtx) {
  try {
    if (dispatchCtx?.dispatch) {
      const result = await dispatchCtx.dispatch(call.name, call.args);
      return typeof result === "string" ? result : JSON.stringify(result);
    }
    // No dispatcher available — return informative stub
    return JSON.stringify({ tool: call.name, status: "dispatched", note: "no_dispatcher_configured" });
  } catch (err) {
    return JSON.stringify({ tool: call.name, error: err?.message || "dispatch_failed" });
  }
}

/**
 * Run the inference agent loop.
 *
 * @param {import('./types.js').BrainHandle} brain
 * @param {import('./types.js').Message[]} messages
 * @param {object[]} tools
 * @param {object} opts
 * @param {number} [opts.maxSteps]
 * @param {import('./types.js').StopCondition} [opts.stopWhen]
 * @param {AbortSignal} [opts.signal]
 * @param {object} [opts.dispatchCtx]
 * @param {object} [opts.budgetTracker] - ContextBudgetTracker instance (optional)
 * @param {Function} [opts.onCrystallize] - async ({steps, workingMessages}) => {continuationMessages} | null
 * @returns {Promise<{steps: import('./types.js').InferStep[], finalText: string, toolCalls: import('./types.js').ToolCall[], tokensIn: number, tokensOut: number, terminated?: string, crystallizations?: number}>}
 */
export async function runAgentLoop(brain, messages, tools, opts = {}) {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const steps = [];
  const allToolCalls = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let workingMessages = [...messages];
  let crystallizationCount = 0;

  // A3: Per-emergent worktree — created once per agent task execution.
  // Skipped silently when no emergentId is present.
  const emergentId = opts.emergentId || null;
  let _worktree = null;
  if (emergentId) {
    try {
      _worktree = createWorktree(emergentId);
    } catch { /* non-fatal; proceed without worktree */ }
  }

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) {
      return { steps, finalText: "", toolCalls: allToolCalls, tokensIn: totalTokensIn, tokensOut: totalTokensOut, terminated: "aborted", crystallizations: crystallizationCount };
    }

    const stepStart = Date.now();
    const response = await brain.chat(workingMessages, { tools, signal: opts.signal });
    const stepDuration = Date.now() - stepStart;

    totalTokensIn += response.tokensIn || 0;
    totalTokensOut += response.tokensOut || 0;

    // Context budget tracking: crystallize when approaching capacity limit
    if (opts.budgetTracker && opts.onCrystallize && !opts.skipBudgetTracking) {
      try {
        const budget = opts.budgetTracker.trackStep({
          tokensIn: response.tokensIn || 0,
          tokensOut: response.tokensOut || 0,
        });
        if (budget.shouldCrystallize) {
          const crystal = await opts.onCrystallize({ steps: steps.slice(), workingMessages });
          if (crystal && crystal.continuationMessages) {
            // Reset working messages to continuation context
            const systemMsgs = workingMessages.filter(m => m.role === 'system');
            workingMessages = [...systemMsgs, ...crystal.continuationMessages];
            steps.push({ type: 'crystallization', generation: crystal.generation, shadowId: crystal.shadowId });
            crystallizationCount++;
            opts.budgetTracker.reset();
          }
          // null return = max generations hit, stop crystallizing
        }
      } catch (_crystalErr) {
        logger.debug('inference:agent-loop', 'Budget crystallization skipped', { error: _crystalErr?.message });
      }
    }

    const inferStep = {
      type: "inference",
      startedAt: stepStart,
      duration: stepDuration,
      response,
    };
    steps.push(inferStep);

    if (!response.ok) {
      return { steps, finalText: response.error || "", toolCalls: allToolCalls, tokensIn: totalTokensIn, tokensOut: totalTokensOut, terminated: "brain_error", crystallizations: crystallizationCount };
    }

    // No tool calls — done
    if (!response.toolCalls?.length) {
      const finalText = response.text || "";
      if (opts.stopWhen && evaluateStopCondition(opts.stopWhen, steps, finalText)) {
        return { steps, finalText, toolCalls: allToolCalls, tokensIn: totalTokensIn, tokensOut: totalTokensOut, crystallizations: crystallizationCount };
      }
      return { steps, finalText, toolCalls: allToolCalls, tokensIn: totalTokensIn, tokensOut: totalTokensOut, crystallizations: crystallizationCount };
    }

    // Dispatch each tool call and reinject results
    for (const call of response.toolCalls) {
      allToolCalls.push(call);

      // A3: Record the operation in the emergent's worktree (if present).
      if (_worktree) {
        try {
          recordOperation(emergentId, _worktree.branch, {
            type: "annotate",
            payload: { tool: call.name, args: call.args },
          });
        } catch { /* non-fatal */ }
      }

      const toolStart = Date.now();
      const result = await dispatchTool(call, opts.dispatchCtx);

      steps.push({
        type: "tool_call",
        startedAt: toolStart,
        duration: Date.now() - toolStart,
        call,
        result,
      });

      // Reinject: assistant message with tool call, then tool result
      workingMessages = [
        ...workingMessages,
        { role: "assistant", content: response.text || "", toolCalls: [call] },
        { role: "tool", content: result, toolCallId: call.id },
      ];
    }

    if (opts.stopWhen && evaluateStopCondition(opts.stopWhen, steps, response.text || "")) {
      return { steps, finalText: response.text || "", toolCalls: allToolCalls, tokensIn: totalTokensIn, tokensOut: totalTokensOut, crystallizations: crystallizationCount };
    }
  }

  return { steps, finalText: "", toolCalls: allToolCalls, tokensIn: totalTokensIn, tokensOut: totalTokensOut, terminated: "max_steps", crystallizations: crystallizationCount };
}
