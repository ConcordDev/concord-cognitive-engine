// server/workers/embedding-worker.js
//
// Runs the local (CPU) embedding model in a CHILD PROCESS, off the server's
// main thread.
//
// onnxruntime-node's session.run() is synchronous native code wrapped in a
// setImmediate (node_modules/onnxruntime-node/dist/backend.js), so on the main
// thread every embedding held the event loop for its whole duration — ~1s
// each on a 2-vCPU CI runner. A CPU profile of the tick-SLO load test
// (2026-09-30) put ~205s of the main thread's ~260s busy time there.
//
// Why a process and not a worker thread: a worker thread shares the process,
// and onnxruntime's native session aborts the WHOLE process when the thread is
// torn down at exit ("libc++abi: terminating due to uncaught exception of type
// Napi::Error" — seen in CI on the godot-gateway integration test). A child
// process isolates that; it inherits the parent's execArgv (so test preloads
// such as no-egress apply here too) and exits when the parent disconnects.
//
// Protocol (process IPC, serialization: "advanced"):
//   in  { type: "init", model, threads }   -> out { type: "ready" } | { type: "init_error", error }
//   in  { type: "embed", id, text }        -> out { type: "result", id, embedding } | { type: "error", id, error }

let extractor = null;

process.on("disconnect", () => process.exit(0));

process.on("message", async (msg) => {
  if (msg?.type === "init") {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      extractor = await pipeline("feature-extraction", msg.model, {
        session_options: { intraOpNumThreads: msg.threads, interOpNumThreads: 1 },
      });
      process.send({ type: "ready" });
    } catch (e) {
      process.send({ type: "init_error", error: String(e?.message || e) });
    }
    return;
  }
  if (msg?.type === "embed") {
    if (!extractor) {
      process.send({ type: "error", id: msg.id, error: "embeddings_model_missing" });
      return;
    }
    try {
      const output = await extractor(msg.text, { pooling: "mean", normalize: true });
      process.send({ type: "result", id: msg.id, embedding: Float32Array.from(output.data) });
    } catch (e) {
      process.send({ type: "error", id: msg.id, error: String(e?.message || e) });
    }
  }
});
