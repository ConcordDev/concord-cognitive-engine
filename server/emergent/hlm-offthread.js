// server/emergent/hlm-offthread.js
//
// The HLM slow pass without freezing the event loop. See workers/hlm-pass-worker.js for why. The main thread
// only (1) projects the DTUs the analysis actually reads into a slim array, yielding every PROJECT_CHUNK
// items so even a very large store never holds the loop for long, (2) hands it to a short-lived worker,
// (3) records the returned pass (stores + metrics + recommendations) in this process's hlm-engine state.
//
// Failure is reported, never papered over by falling back to the synchronous pass (which is the freeze).

import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordHLMPass } from "./hlm-engine.js";

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "workers", "hlm-pass-worker.js");
export const HLM_PROJECT_CHUNK = 2000;
const DEFAULT_TIMEOUT_MS = Number(process.env.CONCORD_HLM_PASS_TIMEOUT_MS) || 15 * 60 * 1000;
const DEFAULT_HEAP_MB = Number(process.env.CONCORD_HLM_PASS_HEAP_MB) || 1536;

/** The fields hlm-engine reads from a DTU, nothing else (id, tags, parentId, domain, tier, createdAt, authority.score, human.summary). */
export function slimDtu(d) {
  return {
    id: d.id,
    tags: Array.isArray(d.tags) ? d.tags.slice() : d.tags,
    parentId: d.parentId,
    domain: d.domain,
    tier: d.tier,
    createdAt: d.createdAt,
    authority: d.authority && typeof d.authority === "object" ? { score: d.authority.score } : d.authority,
    human: d.human && typeof d.human === "object" ? { summary: d.human.summary } : d.human,
  };
}

/** Project an iterable of DTUs to slim objects, yielding to the event loop between chunks. */
export async function projectDtus(source, { chunk = HLM_PROJECT_CHUNK } = {}) {
  const out = [];
  let n = 0;
  for (const d of source) {
    if (d && typeof d === "object") out.push(slimDtu(d));
    if (++n % chunk === 0) await new Promise((r) => setImmediate(r));
  }
  return out;
}

/**
 * Run one pass off-thread. `source` is any iterable of DTUs (e.g. STATE.dtus.values()).
 * @returns {Promise<object>} the recorded pass, or { ok:false, error }
 */
export async function runHLMPassOffThread(source, { timeoutMs = DEFAULT_TIMEOUT_MS, workerPath = WORKER_PATH, heapMb = DEFAULT_HEAP_MB } = {}) {
  const dtus = await projectDtus(source);
  if (dtus.length === 0) return { ok: true, skipped: "no_dtus" };
  return new Promise((resolve) => {
    let settled = false;
    let worker;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker?.terminate(); } catch { /* already gone */ }
      resolve(res);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "hlm_pass_timeout" }), timeoutMs);
    if (timer.unref) timer.unref();
    try {
      worker = new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: heapMb } });
    } catch (e) {
      return finish({ ok: false, error: `hlm_worker_spawn_failed: ${e?.message || e}` });
    }
    worker.once("message", (msg) => {
      if (!msg?.ok) return finish({ ok: false, error: msg?.error || "hlm_pass_failed" });
      finish(recordHLMPass(msg.pass, { replayRecommendations: true }));
    });
    worker.once("error", (e) => finish({ ok: false, error: `hlm_worker_error: ${e?.message || e}` }));
    worker.once("exit", (code) => finish({ ok: false, error: `hlm_worker_exit_${code}` }));
    worker.postMessage({ dtus });
  });
}
