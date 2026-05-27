// lib/brain-router.js
// Four-Brain Cognitive Architecture — Router
//
// Routes LLM calls to the correct brain based on system name.
// Provides preloadBrains() to warm all models after Ollama health check.
// Integrates with the LLM priority queue for proper scheduling.

import { BRAIN_CONFIG, SYSTEM_TO_BRAIN, BRAIN_PRIORITY } from "./brain-config.js";

/**
 * Preload and warm all brain models.
 * Call AFTER Ollama health check confirms instances are ready.
 *
 * @param {Function} structuredLog - Logging function
 * @returns {Promise<{ loaded: string[], failed: string[] }>}
 */
export async function preloadBrains(structuredLog = () => {}) {
  const loaded = [];
  const failed = [];

  // De-duplicate: group brains by (URL, model) so we don't pull the same
  // model twice. Phase D — also probe every endpoint in `config.urls`
  // (multi-endpoint scale-out) not just the primary.
  const seen = new Set();

  for (const [name, config] of Object.entries(BRAIN_CONFIG)) {
    const endpoints = Array.isArray(config.urls) && config.urls.length ? config.urls : [config.url];
    for (const epUrl of endpoints) {
      const key = `${epUrl}::${config.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const epName = endpoints.length > 1 ? `${name}@${epUrl}` : name;

    try {
      // Pull model if not present (idempotent)
      const pullRes = await fetch(`${epUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: config.model, stream: false }),
        signal: AbortSignal.timeout(300000), // 5 min for large model pulls
      });

      if (!pullRes.ok) {
        structuredLog("warn", "brain_pull_failed", { brain: epName, model: config.model, status: pullRes.status });
        failed.push(epName);
        continue;
      }

      // Warm: send minimal request to load model into memory
      const warmRes = await fetch(`${epUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          prompt: "ping",
          stream: false,
          options: { num_predict: 1 },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (warmRes.ok) {
        loaded.push(epName);
        structuredLog("info", "brain_preloaded", { brain: epName, model: config.model });
      } else {
        failed.push(epName);
        structuredLog("warn", "brain_warm_failed", { brain: epName, model: config.model });
      }
    } catch (err) {
      failed.push(epName);
      structuredLog("warn", "brain_preload_error", { brain: epName, model: config.model, error: err.message });
    }
    }
  }

  return { loaded, failed };
}

/**
 * Get the LLM queue priority for a brain call.
 *
 * @param {string} brainName - "conscious", "subconscious", "utility", "repair"
 * @returns {number} Priority level (0=highest, 3=lowest)
 */
export function getBrainPriority(brainName) {
  return BRAIN_PRIORITY[brainName] ?? 2;
}

/**
 * Resolve which brain should handle a system call.
 *
 * @param {string} systemName - e.g., "chat", "autogen_pipeline", "repair_cortex"
 * @returns {string} Brain name
 */
export function resolveBrain(systemName) {
  return SYSTEM_TO_BRAIN[systemName] || "conscious";
}
