/**
 * Cognitive Worker Thread — Runs CPU-intensive pipeline stages off the main thread.
 *
 * Architecture (Option A — Single Worker):
 *   Main Thread                          Cognitive Worker
 *       |                                     |
 *       |-- postMessage({type:'tick',...}) --> |
 *       |                                     |-- runPipeline(snapshot, {variant:'dream'})
 *       |   (serving HTTP freely)             |-- runPipeline(snapshot, {variant:null})    [autogen]
 *       |                                     |-- runPipeline(snapshot, {variant:'evolution'})
 *       |                                     |-- runPipeline(snapshot, {variant:'synth'})
 *       |<-- postMessage({type:'tick-result'})|
 *       |-- merge results into STATE          |
 *
 * The worker runs the 6-stage autogen pipeline for each cognitive task.
 * It operates on a serialized snapshot of STATE — never touches main-thread STATE directly.
 * Results are candidates + pipeline state deltas that the main thread merges.
 *
 * What stays on main thread:
 *   - DTU commits (via macro system)
 *   - Ingest queue processing
 *   - Bridge heartbeat tick
 *   - Plugin ticks
 *   - Local self-upgrade
 *   - Qualia hooks
 */

import { parentPort } from "node:worker_threads";
import { execSync } from "node:child_process";
import { runPipeline, ensurePipelineState } from "../emergent/autogen-pipeline.js";

// ── CPU Pinning (when CONCORD_WORKER_CORES is set) ─────────────────────────────
// The startup script sets this so the cognitive worker stays on its dedicated core.
const workerCores = process.env.CONCORD_WORKER_CORES;
if (workerCores) {
  try {
    execSync(`taskset -p -c ${workerCores} ${process.pid}`, { stdio: "ignore" });
  } catch {
    // taskset not available (e.g. macOS) — no-op, OS scheduler handles it
  }
}

// ── LLM callback for Ollama (runs fetch from worker thread) ──────────────────

function makeOllamaCallback(ollamaConfig) {
  if (!ollamaConfig?.enabled || !ollamaConfig?.url) return null;

  return async (prompt, options = {}) => {
    const payload = {
      model: options.model || ollamaConfig.model || "llama3.2",
      prompt,
      stream: false,
      options: {
        temperature: options.temperature || 0.7,
        num_predict: options.maxTokens || 800,
      },
    };
    if (options.system) payload.system = options.system;

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    try {
      const res = await fetch(`${ollamaConfig.url}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      clearTimeout(t);
      if (!res.ok) return { ok: false, error: `ollama_http_${res.status}` };
      const data = await res.json();
      return { ok: true, text: data.response || "", source: "ollama" };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, error: e.message, source: "ollama" };
    }
  };
}

// ── Reconstruct STATE-like object from snapshot ──────────────────────────────

function hydrateSnapshot(snapshot) {
  return {
    dtus: new Map(snapshot.dtus),                       // [[id, dtu], ...]
    shadowDtus: new Map(snapshot.shadowDtus || []),
    settings: snapshot.settings || {},
    _autogenPipeline: snapshot.pipelineState || null,
    _governanceConfig: snapshot.governanceConfig || null,
  };
}

// ── Run all cognitive pipeline tasks ─────────────────────────────────────────

// Track which phase to run next (round-robin across ticks)
let _tickPhaseIndex = 0;

async function runCognitiveTick(msg) {
  const { snapshot, settings, ollamaConfig } = msg;

  const STATE = hydrateSnapshot(snapshot);
  ensurePipelineState(STATE);

  const callOllama = makeOllamaCallback(ollamaConfig);
  const results = {
    candidates: [],
    pipelineStateDelta: null,
    errors: [],
    timings: {},
  };

  const t0 = Date.now();

  // STAGGERED: Run ONE cognitive phase per tick (round-robin).
  // Running all 4 simultaneously (autogen + dream + evolution + synthesis)
  // clogs the LLM pipeline at boot and starves user-facing requests.
  // With 120s ticks, each phase gets a full cycle to breathe.
  const phases = [];
  if (settings.autogenEnabled) phases.push("autogen");
  if (settings.dreamEnabled) phases.push("dream");
  if (settings.evolutionEnabled) phases.push("evolution");
  if (settings.synthEnabled) phases.push("synthesis");

  if (phases.length > 0) {
    const phase = phases[_tickPhaseIndex % phases.length];
    _tickPhaseIndex++;

    const ts = Date.now();
    try {
      const opts = { callOllama };
      if (phase === "dream") { opts.variant = "dream"; opts.seed = "Concord heartbeat dream"; }
      else if (phase === "evolution") { opts.variant = "evolution"; }
      else if (phase === "synthesis") { opts.variant = "synth"; }

      const r = await runPipeline(STATE, opts);
      results.candidates.push({
        task: phase,
        ok: r?.ok || false,
        candidate: r?.candidate || null,
        trace: r?.trace || null,
        writePolicy: r?.writePolicy || null,
        error: r?.error || null,
      });
    } catch (e) {
      results.errors.push(`${phase}: ${e.message}`);
    }
    results.timings[phase] = Date.now() - ts;
  }

  // (Synthesis is now handled in the round-robin phase above — no separate block)

  // Capture pipeline state delta for main thread to merge
  results.pipelineStateDelta = STATE._autogenPipeline;
  results.timings.total = Date.now() - t0;

  return results;
}

// ── Message Handler ──────────────────────────────────────────────────────────

let tickInProgress = false;

parentPort.on("message", async (msg) => {
  if (msg.type === "tick") {
    if (tickInProgress) {
      parentPort.postMessage({
        type: "tick-result",
        results: { candidates: [], errors: ["tick_skipped_already_running"], timings: {} },
      });
      return;
    }

    tickInProgress = true;
    try {
      const results = await runCognitiveTick(msg);
      parentPort.postMessage({ type: "tick-result", results });
    } catch (e) {
      parentPort.postMessage({
        type: "tick-result",
        results: { candidates: [], errors: [`fatal: ${e.message}`], timings: {} },
      });
    } finally {
      tickInProgress = false;
    }
  }

  if (msg.type === "shutdown") {
    process.exit(0);
  }
});

parentPort.postMessage({ type: "ready" });

process.on("uncaughtException", (err) => {
  parentPort?.postMessage({
    type: "tick-result",
    results: { candidates: [], errors: [`uncaughtException: ${err?.message}`], timings: {} },
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  parentPort?.postMessage({
    type: "tick-result",
    results: { candidates: [], errors: [`unhandledRejection: ${String(reason)}`], timings: {} },
  });
  process.exit(1);
});
