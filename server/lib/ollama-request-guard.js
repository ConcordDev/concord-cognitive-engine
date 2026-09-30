// server/lib/ollama-request-guard.js
//
// One chokepoint on every request Concord sends to a brain's Ollama, fixing
// two ways the brains quietly fight the box they run on. Both were measured
// on a RunPod pod on 2026-09-27; both apply to the docker-compose deploy too.
//
// 1. num_ctx is PINNED per model.
//    Ollama loads a model once per (model, num_ctx). ~23 call sites talk to
//    the brains and they disagree on num_ctx (4096 from one path, 32768 from
//    a conscious→subconscious fallback, the adaptive profile's value from a
//    third), so the same 7B blob was reloaded 260 times in ~20 minutes —
//    every reload evicts the other resident models, burns CPU, and blocks
//    the request behind it. Earlier fixes corrected individual call sites
//    (see _brainNameForModel in server.js and the lockstep note in
//    brain-profiles.js) and new sites kept reintroducing it. Here, a request
//    whose `model` is a configured brain's model always carries that brain's
//    contextWindow (capped by CONCORD_NUM_CTX_CAP), whatever the caller sent.
//    A caller that needs a bigger window for a model raises the brain's
//    configured window (BRAIN_<NAME>_CONTEXT), so every caller moves together.
//    Unknown models pass through untouched. Off switch:
//    CONCORD_OLLAMA_PIN_CTX=0.
//
// 2. CPU threads are capped per brain (opt-in).
//    llama.cpp sizes its thread pool from the HOST's physical cores, not the
//    container's quota: on a 128-thread host with a 6.8-CPU quota the runner
//    started 64 threads, exhausted the quota, and CFS throttled the whole
//    cgroup — the Node event loop stalled past 900 ms and every request was
//    shed as `service_overloaded`. docker-compose caps each Ollama container
//    at 0.6–4 CPUs with nothing telling llama.cpp. Set:
//      OLLAMA_NUM_THREAD=4          default for every brain endpoint
//      BRAIN_<NAME>_NUM_THREAD=2    per brain (CONSCIOUS, SUBCONSCIOUS,
//                                   UTILITY, REPAIR, MULTIMODAL/VISION)
//    sized to that Ollama's CPU allowance. A caller's explicit num_thread is
//    kept — but note num_thread is also a load key, so keep it uniform.
//
// Pinned by tests/ollama-request-guard.test.js.

const OLLAMA_PATHS = new Set(["/api/chat", "/api/generate", "/api/embed", "/api/embeddings"]);

function positiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 1 << 20 ? n : null;
}

function envKeysFor(brain) {
  const b = String(brain).toUpperCase();
  return b === "MULTIMODAL" ? ["BRAIN_MULTIMODAL_NUM_THREAD", "BRAIN_VISION_NUM_THREAD"] : [`BRAIN_${b}_NUM_THREAD`];
}

function originsOf(cfg) {
  const out = [];
  for (const u of [...(Array.isArray(cfg?.urls) ? cfg.urls : []), cfg?.url].filter(Boolean)) {
    try { out.push(new URL(u).origin); } catch { /* skip */ }
  }
  return out;
}

/**
 * origin → thread cap, from brain configs + env.
 * @returns {Map<string, number>}
 */
export function buildThreadMap(brains, env = process.env) {
  const fallback = positiveInt(env.OLLAMA_NUM_THREAD);
  const map = new Map();
  for (const [name, cfg] of Object.entries(brains || {})) {
    let cap = null;
    for (const k of envKeysFor(name)) cap = cap ?? positiveInt(env[k]);
    cap = cap ?? fallback;
    if (!cap) continue;
    // Several brains can share one Ollama: one quota per container, so the
    // smallest configured cap for that endpoint is the safe one.
    for (const origin of originsOf(cfg)) map.set(origin, map.has(origin) ? Math.min(map.get(origin), cap) : cap);
  }
  return map;
}

/**
 * model tag → pinned num_ctx. When two brains run the same model the larger
 * window wins (one load that serves both, never a smaller one that truncates).
 * @returns {Map<string, number>}
 */
export function buildContextMap(brains, env = process.env) {
  const map = new Map();
  if (String(env.CONCORD_OLLAMA_PIN_CTX ?? "1") === "0") return map;
  const cap = positiveInt(env.CONCORD_NUM_CTX_CAP) || 32768;
  for (const cfg of Object.values(brains || {})) {
    const model = typeof cfg?.model === "string" ? cfg.model.trim() : "";
    const win = positiveInt(cfg?.contextWindow);
    if (!model || !win) continue;
    const ctx = Math.min(cap, win);
    map.set(model, Math.max(map.get(model) || 0, ctx));
  }
  return map;
}

/** Returns the rewritten body string, or null when nothing should change. */
export function guardBody(bodyText, { threads = null, ctxForModel = null } = {}) {
  if (typeof bodyText !== "string") return null;
  let body;
  try { body = JSON.parse(bodyText); } catch { return null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const options = body.options && typeof body.options === "object" ? { ...body.options } : {};
  let changed = false;
  if (threads && options.num_thread == null) { options.num_thread = threads; changed = true; }
  const pinned = ctxForModel && typeof body.model === "string" ? ctxForModel.get(body.model) : null;
  if (pinned && options.num_ctx !== pinned) { options.num_ctx = pinned; changed = true; }
  return changed ? JSON.stringify({ ...body, options }) : null;
}

let _installed = null;

/**
 * Wrap globalThis.fetch once (re-calling refreshes the maps). Only requests
 * to a configured brain origin's inference paths are touched.
 * @returns {{threads: Map<string,number>, ctx: Map<string,number>}}
 */
export function installOllamaRequestGuard(brains, env = process.env) {
  const threads = buildThreadMap(brains, env);
  const ctx = buildContextMap(brains, env);
  const origins = new Set(Object.values(brains || {}).flatMap(originsOf));
  if (_installed) { Object.assign(_installed, { threads, ctx, origins }); return { threads, ctx }; }
  if ((threads.size === 0 && ctx.size === 0) || typeof globalThis.fetch !== "function") return { threads, ctx };
  const inner = globalThis.fetch;
  const state = { threads, ctx, origins };
  globalThis.fetch = function ollamaGuardedFetch(input, init) {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : null;
      if (raw && init && typeof init.body === "string") {
        const u = new URL(raw);
        if (state.origins.has(u.origin) && OLLAMA_PATHS.has(u.pathname.replace(/\/+$/, ""))) {
          const next = guardBody(init.body, { threads: state.threads.get(u.origin), ctxForModel: state.ctx });
          if (next) return inner.call(this, input, { ...init, body: next });
        }
      }
    } catch { /* never let the guard break a request */ }
    return inner.call(this, input, init);
  };
  _installed = state;
  return { threads, ctx };
}
