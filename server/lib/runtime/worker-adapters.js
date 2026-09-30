// server/lib/runtime/worker-adapters.js
//
// Worker adapters — groq / mistral / gemini / cerebras / local only (no missing keys).

import { providerChat } from "../byo-providers.js";
import { pickBrainEndpoint } from "../brain-config.js";

const DEFAULT_ALLOW = [
  "wr-groq", "wr-mistral", "wr-cerebras", "wr-gemini",
  "oc-", "ollama", "local",
];

function allowlist() {
  const raw = process.env.CONCORD_DILA_WORKER_ALLOWLIST;
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return DEFAULT_ALLOW;
}

export function isWorkerAllowed(workerId) {
  const w = String(workerId || "").toLowerCase();
  if (!w) return false;
  if (w.startsWith("cc-")) return false;
  if (w.startsWith("wr-grok")) return false;
  return allowlist().some((prefix) => w.startsWith(prefix.toLowerCase()) || w === prefix.toLowerCase());
}

function providerForWorker(workerId) {
  const w = String(workerId || "").toLowerCase();
  if (w.includes("groq")) return { provider: "groq", envKey: process.env.GROQ_API_KEY || process.env.CONCORD_PLATFORM_GROQ_API_KEY };
  if (w.includes("mistral")) return { provider: "mistral", envKey: process.env.MISTRAL_API_KEY || process.env.CONCORD_PLATFORM_MISTRAL_API_KEY };
  if (w.includes("gemini")) return { provider: "google", envKey: process.env.GEMINI_API_KEY || process.env.CONCORD_PLATFORM_GOOGLE_API_KEY };
  if (w.includes("cerebras")) return { provider: "cerebras", envKey: process.env.CEREBRAS_API_KEY };
  if (w.startsWith("oc-") || w.includes("local") || w.includes("ollama")) return { provider: "ollama", local: true };
  return null;
}

/**
 * Execute a coding/reasoning task on an allowed worker and return structured output.
 */
export async function executeWorkerTask({
  workerId, task, content, taskClass = "coding", compiledPrompt, maxResponseTokens,
} = {}) {
  if (!isWorkerAllowed(workerId)) {
    return { ok: false, reason: "worker_not_allowed", workerId };
  }

  const route = providerForWorker(workerId);
  if (!route) {
    return { ok: false, reason: "no_adapter", workerId };
  }

  if (route.local) {
    const endpoint = pickBrainEndpoint(taskClass === "coding" ? "utility" : "conscious");
    return {
      ok: true,
      workerId,
      provider: "ollama",
      endpoint,
      result: {
        observation: { task, content, routed: "local", endpoint },
        note: "Local worker — use marathon or coding_loop_closure for edits",
      },
    };
  }

  if (!route.envKey) {
    return { ok: false, reason: "provider_key_missing", provider: route.provider, workerId };
  }

  const systemContent = compiledPrompt || "You are a coding worker. Return concise patches or structured @ACTION deltas only.";
  const messages = [
    { role: "system", content: systemContent },
    { role: "user", content: `Task: ${task}\n\n${content}` },
  ];

  const started = Date.now();
  const chat = await providerChat({
    provider: route.provider,
    apiKey: route.envKey,
    slot: taskClass === "coding" ? "repair" : "utility",
    messages,
    opts: { maxTokens: maxResponseTokens || 1024 },
  });

  return {
    ok: chat.ok !== false,
    workerId,
    provider: route.provider,
    latencyMs: Date.now() - started,
    text: chat.text || "",
    tokensIn: chat.tokensIn,
    tokensOut: chat.tokensOut,
    error: chat.error,
    result: {
      observation: { task, workerId, provider: route.provider, text: (chat.text || "").slice(0, 4000) },
    },
  };
}

export function filterAllowedWorkers(roster = []) {
  return roster.filter((w) => isWorkerAllowed(w.name || w.worker_id || w));
}
