// server/workers/hlm-pass-worker.js
//
// Runs ONE HLM analysis pass off the main thread. The pass (emergent/hlm-engine.js#computeHLMPass) is a pure
// function of its DTU array but is O(n²) over the whole store — measured 3.1 s at 5,000 DTUs and 41.6 s at
// 20,000 — and used to run synchronously on the main event loop every 20 minutes, freezing the whole backend
// for 7-13 s+ each time. A fresh worker is spawned per pass and terminated afterwards (hlm-offthread.js), so
// it holds no memory between passes.
//
//   in : { chunk: [slim DTUs] } x N, then { run: true }   (or one legacy { dtus: [...] })
//        slim DTU = { id, tags, parentId, domain, tier, createdAt, authority, human }
//   out: { ok: true, pass } | { ok: false, error }

import { parentPort } from "node:worker_threads";
import { computeHLMPass, boundHLMPass } from "../emergent/hlm-engine.js";

// Input arrives either as one legacy message { dtus } or, from hlm-offthread.js, as { chunk } messages followed by
// { run: true } — chunked so the SENDER never holds its event loop for the structured clone of the whole store
// (postMessage serialises synchronously: ~0.5 s per 600k DTUs measured).
const received = [];
parentPort.on("message", (msg) => {
  try {
    if (Array.isArray(msg?.chunk)) { for (const d of msg.chunk) received.push(d); return; }
    if (!msg?.run && !Array.isArray(msg?.dtus)) return;
    const dtus = Array.isArray(msg?.dtus) ? msg.dtus : received;
    // Bounded BEFORE the post: the clone is deserialised on the main thread (see boundHLMPass).
    const pass = boundHLMPass(computeHLMPass(dtus));
    parentPort.postMessage(pass?.ok ? { ok: true, pass } : { ok: false, error: pass?.error || "hlm_pass_failed" });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String(e?.message || e) });
  }
});
