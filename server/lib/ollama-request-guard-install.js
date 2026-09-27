// server/lib/ollama-request-guard-install.js
//
// Side-effect import for worker threads / child processes. A worker has its
// own globalThis, so the guard server.js installs never sees a worker's
// fetch — workers/cognitive-worker.js called the subconscious model with no
// num_ctx at all, and Ollama picked its own window, reloading the model every
// 30 s (see lib/ollama-request-guard.js). Import this FIRST in any entry that
// can reach a brain.
import { BRAIN_CONFIG } from "./brain-config.js";
import { installOllamaRequestGuard } from "./ollama-request-guard.js";

try { installOllamaRequestGuard(BRAIN_CONFIG); } catch { /* never block a worker on this */ }
