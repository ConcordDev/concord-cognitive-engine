// server/lib/inference/index.js
// @concord/inference — unified entry point for all brain calls.
// Replaces direct Ollama fetch() calls across the codebase with a typed,
// traced, royalty-aware, VRAM-managed inference interface.
//
// Self-training integration (Layer 1 convergence):
//  - Consults brain_active_models via getActiveBrainModel so the daily
//    Modelfile refresh in lib/brain-training/runner.js takes effect on
//    every inference call (was previously bypassed — only callBrain
//    used the lookup, splitting the corpus across two paths).
//  - Logs every successful call into brain_interactions for the
//    outcome resolver to score later (was previously unwired — the
//    inference module's ~20 call sites in emergent modules were
//    invisible to brain training).

import crypto from "node:crypto";
import { selectBrain, markBrainAvailable, markBrainUnavailable } from "./router.js";
import { assembleContext } from "./context-assembler.js";
import { pickTools } from "./tool-picker.js";
import { runAgentLoop } from "./agent-loop.js";
import { acquire } from "./semaphore.js";
import { emit as traceEmit } from "./tracer.js";
import { emitRoyaltyEvent, computeContributors } from "./royalty-hook.js";

/**
 * @param {import('./types.js').InferRequest} req
 * @param {object} [db] - optional better-sqlite3 instance for DTU lookups
 * @returns {Promise<import('./types.js').InferResponse>}
 */
export async function infer(req, db) {
  const inferenceId = req.traceId || `inf_${crypto.randomBytes(8).toString("hex")}`;
  const startedAt = Date.now();

  traceEmit("start", inferenceId, {
    role: req.role,
    callerId: req.callerId,
    lensId: req.lensContext?.lens,
    scope: "public",
  });

  try {
    // Select brain with fallback
    const { handle, fallbacksUsed } = await selectBrain(req.role || "conscious", {
      brainOverride: req.brainOverride,
    });

    // Layer 1 wire: consult brain_active_models for the daily-refreshed
    // model tag. Falls back to handle.model when no swap has happened
    // yet (or db unavailable). The lookup is fail-safe.
    let activeModel = handle.model;
    if (db) {
      try {
        const { getActiveBrainModel } = await import("../brain-training/runner.js");
        activeModel = getActiveBrainModel(db, handle.name, handle.model);
      } catch { /* fall back to static handle.model */ }
    }

    // Assemble context
    const messages = await assembleContext(req, db);

    // Pick tools
    const tools = req.toolScope?.length
      ? await pickTools(req.intent, req.toolScope, req.toolBudget)
      : [];

    // Acquire VRAM slot
    const slot = await acquire(handle.name);
    let loopResult;

    try {
      loopResult = await runAgentLoop(
        { ...handle, model: activeModel },
        messages,
        tools,
        {
          maxSteps: req.maxSteps,
          stopWhen: req.stopWhen,
          signal: req.signal,
        },
      );
      markBrainAvailable(handle.name);
    } catch (err) {
      markBrainUnavailable(handle.name);
      throw err;
    } finally {
      slot.release();
    }

    const latencyMs = Date.now() - startedAt;
    const dtuContributors = computeContributors(req.dtuRefs, loopResult.steps);

    // Async royalty credit (non-blocking)
    emitRoyaltyEvent(inferenceId, dtuContributors, db);

    // Layer 1 wire: log to brain_interactions so the outcome resolver +
    // daily refresh see this call. Fail-safe — never blocks the user
    // path. Caller can attach _userId via req.callerId, _domain via
    // req.intent or req.lensContext.lens.
    let interactionId = null;
    if (db) {
      try {
        const { logBrainInteraction } = await import("../brain-training/interaction-log.js");
        interactionId = logBrainInteraction(db, {
          brainId:   handle.name,
          userId:    req.callerId || null,
          prompt:    { messages, intent: req.intent, lens: req.lensContext?.lens },
          response:  { content: loopResult.finalText || "", model: activeModel, steps: loopResult.steps?.length || 0 },
          domain:    req.lensContext?.lens || req.intent || null,
          latencyMs,
          tokensIn:  loopResult.tokensIn || 0,
          tokensOut: loopResult.tokensOut || 0,
        });
      } catch { /* logging never blocks */ }
    }

    /** @type {import('./types.js').InferResponse} */
    const response = {
      inferenceId,
      brainUsed: handle.name,
      modelUsed: activeModel,
      steps: loopResult.steps,
      finalText: loopResult.finalText || "",
      toolCalls: loopResult.toolCalls || [],
      dtuContributors,
      tokensIn: loopResult.tokensIn || 0,
      tokensOut: loopResult.tokensOut || 0,
      latencyMs,
      fallbacksUsed,
    };

    if (loopResult.terminated) response.terminated = loopResult.terminated;
    if (interactionId) response._interactionId = interactionId;

    traceEmit("finish", inferenceId, {
      brainUsed: handle.name,
      modelUsed: activeModel,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      latencyMs,
      stepCount: loopResult.steps.length,
      terminated: loopResult.terminated,
    });

    return response;
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    traceEmit("failure", inferenceId, {
      callerId: req.callerId,
      role: req.role,
      error: err?.message,
      latencyMs,
    });
    throw err;
  }
}

/**
 * Streaming inference — returns an async generator of text chunks.
 * Uses SSE-style chunked output from Ollama /api/chat with stream:true.
 *
 * @param {import('./types.js').InferRequest} req
 * @param {object} [db]
 * @returns {AsyncGenerator<{text?: string, done?: boolean, error?: string}>}
 */
export async function* inferStream(req, db) {
  const inferenceId = req.traceId || `inf_${crypto.randomBytes(8).toString("hex")}`;
  const startedAt = Date.now();

  traceEmit("start", inferenceId, { role: req.role, callerId: req.callerId, scope: "public" });

  const { handle, fallbacksUsed } = await selectBrain(req.role || "conscious", {
    brainOverride: req.brainOverride,
  });

  const messages = await assembleContext(req, db);
  const config = (await import("../brain-config.js")).BRAIN_CONFIG[handle.name];
  const url = `${handle.url}/api/chat`;

  const body = JSON.stringify({
    model: handle.model,
    stream: true,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    options: { temperature: req.temperature ?? config?.temperature ?? 0.7 },
  });

  const slot = await acquire(handle.name);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: req.signal,
    });

    if (!res.ok) {
      yield { error: `Brain HTTP ${res.status}` };
      return;
    }

    markBrainAvailable(handle.name);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          if (j.message?.content) yield { text: j.message.content };
          if (j.done) {
            traceEmit("finish", inferenceId, { brainUsed: handle.name, latencyMs: Date.now() - startedAt });
            yield { done: true };
            return;
          }
        } catch { /* skip malformed line */ }
      }
    }
  } catch (err) {
    markBrainUnavailable(handle.name);
    traceEmit("failure", inferenceId, { error: err?.message, latencyMs: Date.now() - startedAt });
    yield { error: err?.message || "stream_error" };
  } finally {
    slot.release();
  }
}

// Re-export supporting utilities for callers that need direct access
export { getVramState } from "./semaphore.js";
export { getSpans, addListener } from "./tracer.js";
export { selectBrain } from "./router.js";
