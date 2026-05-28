// lib/brain-config.js
// Five-Brain Cognitive Architecture — Configuration
//
// Each brain has a dedicated Ollama instance, model, temperature profile,
// timeout, priority, and concurrency limit. The repair brain always runs
// at highest priority (0). Conscious (user-facing) beats subconscious (autonomous).

// Phase D — multi-endpoint scale-out.
// If BRAIN_<NAME>_URLS is set (comma-separated), it overrides the singular
// BRAIN_<NAME>_URL and a round-robin picker spreads requests across the
// list. Legacy singular form still works unchanged.
function _parseEndpoints(plural, singular, fallback) {
  if (plural) {
    const list = String(plural).split(",").map(s => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return [singular || fallback];
}

const _conscious_urls = _parseEndpoints(
  process.env.BRAIN_CONSCIOUS_URLS,
  process.env.BRAIN_CONSCIOUS_URL || process.env.OLLAMA_HOST,
  "http://ollama-conscious:11434",
);
const _subconscious_urls = _parseEndpoints(
  process.env.BRAIN_SUBCONSCIOUS_URLS,
  process.env.BRAIN_SUBCONSCIOUS_URL,
  "http://ollama-subconscious:11434",
);
const _utility_urls = _parseEndpoints(
  process.env.BRAIN_UTILITY_URLS,
  process.env.BRAIN_UTILITY_URL,
  "http://ollama-utility:11434",
);
const _repair_urls = _parseEndpoints(
  process.env.BRAIN_REPAIR_URLS,
  process.env.BRAIN_REPAIR_URL,
  "http://ollama-repair:11434",
);
const _vision_urls = _parseEndpoints(
  process.env.BRAIN_VISION_URLS,
  process.env.BRAIN_VISION_URL || process.env.BRAIN_MULTIMODAL_URL || process.env.OLLAMA_URL || process.env.OLLAMA_HOST,
  "http://ollama-vision:11434",
);

export const BRAIN_CONFIG = Object.freeze({
  conscious: {
    url: _conscious_urls[0],
    urls: _conscious_urls,
    model: process.env.BRAIN_CONSCIOUS_MODEL || "concord-conscious:latest",
    role: "chat, deep reasoning, council deliberation",
    temperature: 0.7,
    timeout: Number(process.env.BRAIN_CONSCIOUS_TIMEOUT_MS) || 45000, // GPU inference; override per-deployment
    priority: 1,       // CRITICAL — user-facing
    // Bumped 3 → 8 to match OLLAMA_NUM_PARALLEL=8 on the conscious
    // service. Anything lower bottlenecks the JS queue while the GPU
    // sits idle.
    maxConcurrent: Number(process.env.BRAIN_CONSCIOUS_CONCURRENT) || 8,
    contextWindow: 32768,
    maxTokens: 4096,   // Full output — let it think
  },
  subconscious: {
    url: _subconscious_urls[0],
    urls: _subconscious_urls,
    model: process.env.BRAIN_SUBCONSCIOUS_MODEL || "qwen2.5:7b-instruct-q4_K_M",
    role: "autogen, dream, evolution, synthesis, birth",
    temperature: 0.85,
    timeout: Number(process.env.BRAIN_SUBCONSCIOUS_TIMEOUT_MS) || 30000,
    priority: 2,       // NORMAL — autonomous background
    // Bumped 4 → 12 to match OLLAMA_NUM_PARALLEL=12 on the
    // subconscious service.
    maxConcurrent: Number(process.env.BRAIN_SUBCONSCIOUS_CONCURRENT) || 12,
    contextWindow: 8192,
    maxTokens: 1200,   // GPU: 7B brain can generate longer, more coherent DTUs
  },
  utility: {
    url: _utility_urls[0],
    urls: _utility_urls,
    model: process.env.BRAIN_UTILITY_MODEL || "qwen2.5:3b",
    role: "lens interactions, entity actions, quick domain tasks",
    temperature: 0.3,
    timeout: Number(process.env.BRAIN_UTILITY_TIMEOUT_MS) || 20000,
    priority: 3,       // LOW — support tasks
    // Bumped 6 → 16 to match OLLAMA_NUM_PARALLEL=16 on the utility
    // service. Lens action spam doesn't queue at the JS layer anymore.
    maxConcurrent: Number(process.env.BRAIN_UTILITY_CONCURRENT) || 16,
    contextWindow: 16384,
    maxTokens: 800,    // GPU: more complete outputs for entity actions
  },
  repair: {
    url: _repair_urls[0],
    urls: _repair_urls,
    // Default matches the inline BRAIN declaration in server.js
    // (the hand-written object at server.js:14712 is the live source
    // of truth — see Phase 12 audit). 0.5b was the pre-Sprint-D
    // choice; 1.5b proved necessary for the auto-repair quality bar.
    model: process.env.BRAIN_REPAIR_MODEL || "qwen2.5:1.5b",
    role: "error detection, auto-fix, runtime repair",
    temperature: 0.1,
    timeout: Number(process.env.BRAIN_REPAIR_TIMEOUT_MS) || 10000,
    priority: 0,       // HIGHEST — system health
    // Bumped 2 → 4 to match OLLAMA_NUM_PARALLEL=4 on repair.
    maxConcurrent: Number(process.env.BRAIN_REPAIR_CONCURRENT) || 4,
    contextWindow: 4096,
    maxTokens: 500,    // GPU: 1.5B can actually articulate error analysis now
  },
  multimodal: {
    // Resolution order:
    //   1. BRAIN_VISION_URLS / BRAIN_VISION_URL — preferred, set by docker-
    //      compose to point at the dedicated ollama-vision service.
    //   2. BRAIN_MULTIMODAL_URL — legacy alias.
    //   3. OLLAMA_URL / OLLAMA_HOST — single-Ollama deployments.
    //   4. ollama-vision:11434 — docker-compose default.
    url: _vision_urls[0],
    urls: _vision_urls,
    // Default LLaVA 13B v1.6 (vicuna) at q4_K_M ≈ 9GB VRAM. With
    // OLLAMA_FLASH_ATTENTION + the RTX PRO 4500's 5th-gen tensor cores
    // this hits ~50 tok/s on a 1024×1024 input.
    model: process.env.BRAIN_VISION_MODEL || process.env.OLLAMA_VISION_MODEL || "llava:13b-v1.6-vicuna-q4_K_M",
    role: "vision analysis, image understanding, document layout, visual reasoning",
    temperature: 0.1,
    // Vision queries can take longer than chat — bumped 60s → 120s.
    timeout: Number(process.env.BRAIN_VISION_TIMEOUT_MS) || 120000,
    priority: 2,
    // RTX PRO 4500 + 16GB container memory comfortably handles 8 parallel
    // vision queries; bumped from 2 so the food-vision endpoint and
    // personal-locker upload pipeline don't serialize.
    maxConcurrent: Number(process.env.BRAIN_VISION_CONCURRENT) || 8,
    contextWindow: 8192,
    maxTokens: 1500,
  },
});

/**
 * Map from system/subsystem names to brain assignments.
 * Used by the brain router to determine which brain handles each call.
 */
export const SYSTEM_TO_BRAIN = Object.freeze({
  // Conscious brain — user-facing and sovereign
  chat: "conscious",
  sovereign_decree: "conscious",
  entity_dialogue: "conscious",

  // Subconscious brain — autonomous generation + unsaid analysis
  autogen: "subconscious",
  autogen_pipeline: "subconscious",
  meta_derivation: "subconscious",
  dream_synthesis: "subconscious",
  chat_unsaid: "subconscious",

  // Utility brain — analytical and support tasks + conversation compression
  hlr_engine: "utility",
  agent_system: "utility",
  hypothesis_engine: "utility",
  council_voices: "utility",
  research_jobs: "utility",
  chat_summary: "utility",

  // Repair brain — self-healing + entity consistency
  repair_cortex: "repair",
  repair_diagnosis: "repair",
  chat_consistency: "repair",

  // Multimodal brain — vision, image analysis, visual reasoning
  "multimodal.vision_analyze": "multimodal",
  "multimodal.vision_describe": "multimodal",
  personal_locker_vision: "multimodal",
  lens_vision: "multimodal",
});

/**
 * Map brain names to LLM queue priority levels.
 */
export const BRAIN_PRIORITY = Object.freeze({
  repair: 0,       // CRITICAL
  conscious: 1,    // HIGH
  subconscious: 2, // NORMAL
  multimodal: 2,   // NORMAL — vision queries piggyback on subconscious priority
  utility: 3,      // LOW
});

/**
 * Get the brain config for a system name.
 * @param {string} systemName - e.g., "chat", "autogen", "repair_cortex"
 * @returns {{ brainName: string, config: object }}
 */
export function getBrainForSystem(systemName) {
  const brainName = SYSTEM_TO_BRAIN[systemName] || "conscious";
  return { brainName, config: getActiveBrainConfig()[brainName] };
}

// ── Hardware-adaptive profile ────────────────────────────────────────────
//
// The static BRAIN_CONFIG above targets the RTX PRO 4500 Blackwell deploy.
// For workstations / smaller GPUs / CPU-only test runs, the profile system
// in `brain-profiles.js` probes the hardware and selects appropriate model
// + concurrency settings. Resolution order: env override → nvidia-smi
// probe → 32GB default. Explicit BRAIN_*_MODEL / BRAIN_*_CONCURRENT env
// vars still win.

let _activeConfig = null;
let _activeProfile = null;
let _activeSource = null;

/**
 * One-time initialization. Must be awaited before getActiveBrainConfig
 * returns the hardware-tuned config. Safe to call multiple times — second
 * call is a no-op. Until called, getActiveBrainConfig() returns the static
 * BRAIN_CONFIG.
 */
export async function initBrainProfile(opts = {}) {
  if (_activeConfig && !opts.force) return { profile: _activeProfile, source: _activeSource };
  const { resolveProfile, applyProfile } = await import("./brain-profiles.js");
  const r = await resolveProfile(opts);
  _activeProfile = r.profile;
  _activeSource = r.source;
  _activeConfig = applyProfile(BRAIN_CONFIG, r.profile);
  return { profile: r.profile, source: r.source, choice: r.choice, gpuInfo: r.gpuInfo };
}

/**
 * Get the active (possibly profile-merged) brain config. Falls back to the
 * static BRAIN_CONFIG when initBrainProfile() hasn't been called yet.
 */
export function getActiveBrainConfig() {
  return _activeConfig || BRAIN_CONFIG;
}

/** Diagnostic — returns the resolved profile metadata. */
export function getActiveBrainProfile() {
  return { profile: _activeProfile, source: _activeSource };
}

// ── Phase D — multi-endpoint round-robin + inflight tracking ────────────────
//
// Per-endpoint inflight counters let us prefer the less-loaded endpoint when
// a brain has more than one. Without this, naive round-robin would oscillate
// between a wedged endpoint and a healthy one.

/** @type {Map<string, number>} endpoint URL → inflight count */
const _endpointInflight = new Map();
/** @type {Map<string, number>} endpoint URL → consecutive failures */
const _endpointFailures = new Map();
/** @type {Map<string, number>} endpoint URL → last health probe (epoch ms) */
const _endpointLastHealthy = new Map();
/** @type {Map<string, number>} brain name → round-robin cursor */
const _rrCursor = new Map();

function _candidatesForBrain(brainName) {
  const cfg = getActiveBrainConfig()[brainName];
  if (!cfg) return [];
  if (Array.isArray(cfg.urls) && cfg.urls.length) return cfg.urls;
  return cfg.url ? [cfg.url] : [];
}

/**
 * Pick an endpoint URL for a brain. Strategy:
 *   1. Choose the endpoint with the fewest inflight calls.
 *   2. Tiebreak by round-robin cursor so multiple equal endpoints share load.
 *   3. Endpoints with ≥3 consecutive failures are deprioritised.
 */
export function pickBrainEndpoint(brainName) {
  const candidates = _candidatesForBrain(brainName);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  let best = null;
  let bestScore = Infinity;
  let bestIdx = 0;
  candidates.forEach((url, idx) => {
    const inflight = _endpointInflight.get(url) || 0;
    const failures = _endpointFailures.get(url) || 0;
    // Heavy failure penalty so wedged endpoints are starved.
    const score = inflight + (failures >= 3 ? 1_000 : 0);
    if (score < bestScore) { best = url; bestScore = score; bestIdx = idx; }
  });

  // Round-robin tiebreak among equal-score endpoints.
  const ties = candidates
    .map((url, idx) => ({ url, idx, score: (_endpointInflight.get(url) || 0) + ((_endpointFailures.get(url) || 0) >= 3 ? 1_000 : 0) }))
    .filter(c => c.score === bestScore);
  if (ties.length > 1) {
    const cursor = (_rrCursor.get(brainName) || 0) % ties.length;
    best = ties[cursor].url;
    bestIdx = ties[cursor].idx;
    _rrCursor.set(brainName, cursor + 1);
  }

  return best;
}

/** Increment the inflight counter for an endpoint (call before the request). */
export function noteEndpointStart(url) {
  if (!url) return;
  _endpointInflight.set(url, (_endpointInflight.get(url) || 0) + 1);
}

/** Decrement the inflight counter for an endpoint (call after the request). */
export function noteEndpointFinish(url, { ok = true } = {}) {
  if (!url) return;
  const cur = _endpointInflight.get(url) || 0;
  _endpointInflight.set(url, Math.max(0, cur - 1));
  if (ok) {
    _endpointFailures.set(url, 0);
    _endpointLastHealthy.set(url, Date.now());
  } else {
    _endpointFailures.set(url, (_endpointFailures.get(url) || 0) + 1);
  }
}

/** Diagnostic snapshot — used by /api/admin/brain-endpoints. */
export function getEndpointStats() {
  const out = {};
  const config = getActiveBrainConfig();
  for (const [brainName, cfg] of Object.entries(config)) {
    const urls = Array.isArray(cfg.urls) && cfg.urls.length ? cfg.urls : [cfg.url];
    out[brainName] = urls.map((url) => ({
      url,
      inflight: _endpointInflight.get(url) || 0,
      failures: _endpointFailures.get(url) || 0,
      lastHealthyAt: _endpointLastHealthy.get(url) || 0,
    }));
  }
  return out;
}

/** Test-only — reset trackers between tests. */
export function _resetEndpointStats() {
  _endpointInflight.clear();
  _endpointFailures.clear();
  _endpointLastHealthy.clear();
  _rrCursor.clear();
}
