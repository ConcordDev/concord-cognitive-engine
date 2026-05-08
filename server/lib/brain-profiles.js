// server/lib/brain-profiles.js
//
// Hardware-adaptive brain configuration. The default `BRAIN_CONFIG` in
// `brain-config.js` is tuned for an RTX PRO 4500 Blackwell (32GB GDDR7,
// 5th-gen tensor cores) — that's the deploy this codebase was born on.
// Fine for a single-tenant production box; insufficient for anyone trying
// to run Concord on a smaller GPU or a workstation card.
//
// This module:
//   1. Probes the runtime for available VRAM (via nvidia-smi when present,
//      env override otherwise).
//   2. Picks a profile from a small bands table (12GB / 16GB / 24GB / 32GB+).
//   3. Returns model + concurrency overrides to merge into BRAIN_CONFIG.
//
// Override priority (highest → lowest):
//   - explicit env vars (BRAIN_*_MODEL, BRAIN_*_URL, BRAIN_*_CONCURRENT)
//   - CONCORD_GPU_PROFILE env (12gb|16gb|24gb|32gb|cpu)
//   - probe (nvidia-smi)
//   - 32gb fallback (current default)
//
// The probe is exception-safe — any failure falls through to the 32GB profile.

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Profile bands. Each profile lists the four cognitive brains plus vision.
 * Models picked so the SUM of resident weights fits comfortably under the
 * VRAM budget assuming q4_K_M quantization + 8-bit KV cache.
 *
 * 32GB profile reproduces the existing CLAUDE.md default. Smaller profiles
 * scale models down + concurrency down. CPU profile uses the smallest
 * possible models (won't be fast — but it'll run).
 */
export const PROFILES = Object.freeze({
  cpu: {
    label: "CPU only — tiny models, single concurrency",
    bandGb: 0,
    conscious: { model: "qwen2.5:1.5b-instruct-q4_K_M", maxConcurrent: 1, contextWindow: 8192, maxTokens: 1024 },
    subconscious: { model: "qwen2.5:1.5b-instruct-q4_K_M", maxConcurrent: 1, contextWindow: 4096, maxTokens: 800 },
    utility: { model: "qwen2.5:0.5b-instruct-q4_K_M", maxConcurrent: 2, contextWindow: 4096, maxTokens: 600 },
    repair: { model: "qwen2.5:0.5b-instruct-q4_K_M", maxConcurrent: 1, contextWindow: 2048, maxTokens: 400 },
    multimodal: { model: "moondream:1.8b", maxConcurrent: 1 },
  },
  "12gb": {
    label: "12GB GPU — 4070 / 3060 12GB / similar",
    bandGb: 12,
    conscious: { model: "qwen2.5:7b-instruct-q4_K_M", maxConcurrent: 2, contextWindow: 16384, maxTokens: 2048 },
    subconscious: { model: "qwen2.5:3b-instruct-q5_K_M", maxConcurrent: 3, contextWindow: 8192, maxTokens: 1024 },
    utility: { model: "qwen2.5:1.5b-instruct-q5_K_M", maxConcurrent: 4, contextWindow: 8192, maxTokens: 600 },
    repair: { model: "qwen2.5:0.5b-instruct-q5_K_M", maxConcurrent: 2, contextWindow: 2048, maxTokens: 400 },
    multimodal: { model: "llava:7b-v1.6-mistral-q4_K_M", maxConcurrent: 1 },
  },
  "16gb": {
    label: "16GB GPU — 4080 / 4060 Ti 16GB / 5080",
    bandGb: 16,
    conscious: { model: "qwen2.5:7b-instruct-q4_K_M", maxConcurrent: 4, contextWindow: 16384, maxTokens: 2048 },
    subconscious: { model: "qwen2.5:7b-instruct-q4_K_M", maxConcurrent: 4, contextWindow: 8192, maxTokens: 1200 },
    utility: { model: "qwen2.5:3b-instruct-q5_K_M", maxConcurrent: 8, contextWindow: 16384, maxTokens: 800 },
    repair: { model: "qwen2.5:1.5b-instruct-q5_K_M", maxConcurrent: 2, contextWindow: 4096, maxTokens: 500 },
    multimodal: { model: "llava:7b-v1.6-mistral-q4_K_M", maxConcurrent: 2 },
  },
  "24gb": {
    label: "24GB GPU — 4090 / 3090 / 5090 stage",
    bandGb: 24,
    conscious: { model: "qwen2.5:14b-instruct-q4_K_M", maxConcurrent: 4, contextWindow: 24576, maxTokens: 3072 },
    subconscious: { model: "qwen2.5:7b-instruct-q5_K_M", maxConcurrent: 8, contextWindow: 8192, maxTokens: 1200 },
    utility: { model: "qwen2.5:3b-instruct-q5_K_M", maxConcurrent: 12, contextWindow: 16384, maxTokens: 800 },
    repair: { model: "qwen2.5:1.5b-instruct-q5_K_M", maxConcurrent: 3, contextWindow: 4096, maxTokens: 500 },
    multimodal: { model: "llava:13b-v1.6-vicuna-q4_K_M", maxConcurrent: 2 },
  },
  "32gb": {
    label: "32GB+ GPU — RTX PRO 4500 Blackwell / A6000 / H100",
    bandGb: 32,
    conscious: { model: "qwen2.5:32b-instruct-q4_K_M", maxConcurrent: 8, contextWindow: 32768, maxTokens: 4096 },
    subconscious: { model: "qwen2.5:7b-instruct-q5_K_M", maxConcurrent: 12, contextWindow: 8192, maxTokens: 1200 },
    utility: { model: "qwen2.5:3b-instruct-q5_K_M", maxConcurrent: 16, contextWindow: 16384, maxTokens: 800 },
    repair: { model: "qwen2.5:1.5b-instruct-q5_K_M", maxConcurrent: 4, contextWindow: 4096, maxTokens: 500 },
    multimodal: { model: "llava:13b-v1.6-vicuna-q4_K_M", maxConcurrent: 4 },
  },
});

/**
 * Pick the profile band that best matches `gb` of available VRAM.
 * Always rounds DOWN — better to under-allocate than thrash on swap.
 */
export function pickProfile(gb) {
  if (!Number.isFinite(gb) || gb <= 0) return PROFILES.cpu;
  if (gb < 12) return PROFILES.cpu;
  if (gb < 16) return PROFILES["12gb"];
  if (gb < 24) return PROFILES["16gb"];
  if (gb < 32) return PROFILES["24gb"];
  return PROFILES["32gb"];
}

/**
 * Probe nvidia-smi for total VRAM in MiB → returns GB, or null on failure.
 * Sums across all GPUs (multi-GPU boxes give the largest band).
 *
 * @returns {Promise<{gb: number, gpus: Array<{name: string, totalMiB: number}>} | null>}
 */
export async function probeGpu(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 3000;
  try {
    const { stdout } = await execAsync(
      "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits",
      { timeout: timeoutMs },
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    const gpus = lines.map(l => {
      const [name, miB] = l.split(",").map(s => s.trim());
      return { name, totalMiB: Number(miB) || 0 };
    });
    const totalMiB = gpus.reduce((sum, g) => sum + g.totalMiB, 0);
    if (totalMiB <= 0) return null;
    return { gb: Math.floor(totalMiB / 1024), gpus };
  } catch (_e) {
    return null;
  }
}

/**
 * Resolve the active brain profile. Order:
 *   1. CONCORD_GPU_PROFILE env (cpu|12gb|16gb|24gb|32gb)
 *   2. probeGpu() → pickProfile()
 *   3. 32gb default
 *
 * Returns:
 *   { profile, source: "env"|"probe"|"default", gpuInfo? }
 */
export async function resolveProfile(opts = {}) {
  const envChoice = (process.env.CONCORD_GPU_PROFILE || "").toLowerCase();
  if (envChoice && PROFILES[envChoice]) {
    return { profile: PROFILES[envChoice], source: "env", choice: envChoice };
  }
  const probe = await probeGpu(opts);
  if (probe) {
    const profile = pickProfile(probe.gb);
    const choice = Object.keys(PROFILES).find(k => PROFILES[k] === profile);
    return { profile, source: "probe", choice, gpuInfo: probe };
  }
  return { profile: PROFILES["32gb"], source: "default", choice: "32gb" };
}

/**
 * Apply a profile on top of a BRAIN_CONFIG-shape object. Per-brain explicit
 * env vars (BRAIN_*_MODEL, BRAIN_*_URL, BRAIN_*_CONCURRENT) STILL win over
 * the profile — this is a base layer, not an override.
 *
 * Returns a NEW config object (never mutates input).
 */
export function applyProfile(baseConfig, profile) {
  const out = {};
  for (const [brain, cfg] of Object.entries(baseConfig)) {
    const profCfg = profile?.[brain];
    if (!profCfg) { out[brain] = { ...cfg }; continue; }

    // Explicit env override per brain — highest priority.
    const envModel = process.env[`BRAIN_${brain.toUpperCase()}_MODEL`];
    const envConcurrent = process.env[`BRAIN_${brain.toUpperCase()}_CONCURRENT`];

    out[brain] = {
      ...cfg,
      model: envModel || profCfg.model || cfg.model,
      maxConcurrent: Number(envConcurrent) || profCfg.maxConcurrent || cfg.maxConcurrent,
      contextWindow: profCfg.contextWindow || cfg.contextWindow,
      maxTokens: profCfg.maxTokens || cfg.maxTokens,
    };
  }
  return out;
}
