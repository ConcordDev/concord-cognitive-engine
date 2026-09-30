// server/workers/embedding-worker.js
//
// Runs the local (CPU) embedding model off the main thread.
//
// onnxruntime-node's session.run() is synchronous native code wrapped in a
// setImmediate (node_modules/onnxruntime-node/dist/backend.js), so on the main
// thread every embedding held the event loop for its whole duration — ~1s
// each on a 2-vCPU CI runner. A CPU profile of the tick-SLO load test
// (2026-09-30) put ~205s of the main thread's ~260s busy time there, enough to
// stop /metrics and the governor answering. Here it blocks only this thread.
//
// Protocol (parentPort):
//   in  { type: "init", model, threads }   -> out { type: "ready" } | { type: "init_error", error }
//   in  { type: "embed", id, text }        -> out { type: "result", id, embedding } | { type: "error", id, error }
// `embedding` is a Float32Array whose buffer is transferred, not copied.

import { parentPort } from "node:worker_threads";

let extractor = null;

parentPort.on("message", async (msg) => {
  if (msg?.type === "init") {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      extractor = await pipeline("feature-extraction", msg.model, {
        session_options: { intraOpNumThreads: msg.threads, interOpNumThreads: 1 },
      });
      parentPort.postMessage({ type: "ready" });
    } catch (e) {
      parentPort.postMessage({ type: "init_error", error: String(e?.message || e) });
    }
    return;
  }
  if (msg?.type === "embed") {
    if (!extractor) {
      parentPort.postMessage({ type: "error", id: msg.id, error: "embeddings_model_missing" });
      return;
    }
    try {
      const output = await extractor(msg.text, { pooling: "mean", normalize: true });
      const embedding = Float32Array.from(output.data);
      parentPort.postMessage({ type: "result", id: msg.id, embedding }, [embedding.buffer]);
    } catch (e) {
      parentPort.postMessage({ type: "error", id: msg.id, error: String(e?.message || e) });
    }
  }
});
