// server/workers/hlm-pass-worker.js
//
// Runs ONE HLM analysis pass off the main thread. The pass (emergent/hlm-engine.js#computeHLMPass) is a pure
// function of its DTU array but is O(n²) over the whole store — measured 3.1 s at 5,000 DTUs and 41.6 s at
// 20,000 — and used to run synchronously on the main event loop every 20 minutes, freezing the whole backend
// for 7-13 s+ each time. A fresh worker is spawned per pass and terminated afterwards (hlm-offthread.js), so
// it holds no memory between passes.
//
//   in : { dtus: [{ id, tags, parentId, domain, tier, createdAt, authority, human }] }   (slim projection)
//   out: { ok: true, pass } | { ok: false, error }

import { parentPort } from "node:worker_threads";
import { computeHLMPass } from "../emergent/hlm-engine.js";

parentPort.once("message", (msg) => {
  try {
    const pass = computeHLMPass(Array.isArray(msg?.dtus) ? msg.dtus : []);
    parentPort.postMessage(pass?.ok ? { ok: true, pass } : { ok: false, error: pass?.error || "hlm_pass_failed" });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String(e?.message || e) });
  }
});
