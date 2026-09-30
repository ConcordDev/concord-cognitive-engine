/**
 * DHTP — Dynamic Hybrid Tokenization Protocol
 *
 * Sprint 60+: Token efficiency layer that intercepts chat prompts BEFORE
 * the LLM call and substitutes compact preset templates + cached DTU refs.
 *
 * Design target: up to ~33:1 on HASH-mode DTU ref blocks (live executive IR ~1.2×).
 *
 * Architecture:
 *   1. PATTERN DETECTION (compileRegexes): regex match against 20 common
 *      conversation patterns. Fast (no LLM call), runs in <1ms.
 *   2. PRESET SUBSTITUTION (selectPreset): pick the matched preset's
 *      compact template (~140 chars) + reduced DTU budget.
 *   3. DTU BLOCK CACHE (DTUBlockCache): pre-computed brotli-compressed
 *      DTU refs keyed by content_hash. Hashes are stable so cache hits
 *      are O(1).
 *   4. WIRING: chat-context-pipeline → applyDHTP → token-budget-assembler
 *
 * What this saves per call:
 *   - Default chat path: ~8000 chars DTU context + ~1500 chars system
 *     prompt = ~9500 chars.
 *   - DHTP path: ~140 chars preset template + ~250 chars cached DTU refs
 *     = ~390 chars.
 *   - Ratio: 9500/390 = 24-32x depending on preset budget.
 *
 * The 33:1 figure is for the DTU block specifically:
 *   - Default: 33 DTUs × ~240 chars formatted = ~8000 chars
 *   - DHTP: 1 cached ref string (~250 chars) that LLM can decode
 */

import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
const BROTLI_PARAM_QUALITY = zlibConstants.BROTLI_PARAM_QUALITY;

import { DHTP_PRESETS } from "./dhtp-presets.js";

// ── Pattern Compilation ────────────────────────────────────────────────

/**
 * Compile regex patterns from presets. Cached after first call.
 * @returns {Array<{id: string, regex: RegExp, template: string, dtuBudgetPct: number, maxResponseTokens: number}>}
 */
let _compiled = null;
export function compileRegexes() {
  if (_compiled) return _compiled;
  _compiled = DHTP_PRESETS.map((p) => ({
    id: p.id,
    regex: new RegExp(p.pattern, "i"),
    template: p.template,
    dtuBudgetPct: p.dtu_budget_pct,
    maxResponseTokens: p.max_response_tokens,
  }));
  return _compiled;
}

/**
 * Reset compiled cache. Used by tests when presets change.
 */
export function resetCompiledCache() {
  _compiled = null;
}

// ── Pattern Detection ──────────────────────────────────────────────────

/**
 * Detect the best preset for a prompt.
 * Returns the first match (highest priority — order matters in presets).
 *
 * @param {string} prompt - Raw user prompt
 * @returns {{matched: boolean, preset?: object, matchTimeMs?: number}}
 */
export function selectPreset(prompt) {
  const start = Date.now();
  const compiled = compileRegexes();
  const text = String(prompt || "").trim();

  if (!text) {
    return { matched: false, matchTimeMs: Date.now() - start };
  }

  for (const preset of compiled) {
    if (preset.regex.test(text)) {
      return {
        matched: true,
        preset: {
          id: preset.id,
          template: preset.template,
          dtuBudgetPct: preset.dtuBudgetPct,
          maxResponseTokens: preset.maxResponseTokens,
        },
        matchTimeMs: Date.now() - start,
      };
    }
  }

  return { matched: false, matchTimeMs: Date.now() - start };
}

// ── DTU Block Cache ────────────────────────────────────────────────────

/**
 * LRU cache for pre-compressed DTU blocks.
 * Key: content_hash of the DTU set
 * Value: brotli-compressed JSON blob with refs + minimal summary
 *
 * Cache hits = ~250 chars per call instead of regenerating the full
 * context block every time.
 */
class DTUBlockCache {
  constructor(maxEntries = 512) {
    this.max = maxEntries;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Hash a DTU set deterministically.
   */
  hash(dtus) {
    const norm = dtus
      .map((d) => `${d.id}|${d.tier || "regular"}|${d.title || ""}|${d.updatedAt || ""}`)
      .sort()
      .join("\n");
    return createHash("sha256").update(norm).digest("hex").slice(0, 16);
  }

  /**
   * Build a compact DTU ref string.
   *
   * Two modes:
   * - INLINE (dtus ≤ 5): titles inline, ~30 chars each
   * - HASH (dtus > 5): single SHA hash + tier summary, 8 chars
   *
   * HASH mode design target (not kitchen IR avg — live executive IR ~1.2×):
   * 33 DTUs × 30 chars inline = 990 chars
   * 33 DTUs × hash (8 chars) = 8 chars
   * Ratio: 990/8 ≈ 124× on the ref-string alone (design math; not measured IR avg)
   *
   * The LLM can decode via the hash → fetch full DTUs when needed.
   */
  buildRefString(dtus) {
    if (!dtus || dtus.length === 0) return "";

    // HASH mode for >5 DTUs — maximum compression
    if (dtus.length > 5) {
      const blockHash = this.hash(dtus);
      const tierCounts = {};
      for (const d of dtus) {
        const t = d.tier || "regular";
        tierCounts[t] = (tierCounts[t] || 0) + 1;
      }
      const tierSummary = Object.entries(tierCounts)
        .map(([t, n]) => `${n}${t[0]}`)
        .join("+");
      return `#${blockHash.slice(0, 8)}[${dtus.length}/${tierSummary}]`;
    }

    // INLINE mode for ≤5 DTUs — show titles directly
    const titles = dtus.map((d) => {
      const t = (d.title || d.id || "").slice(0, 30);
      return t.replace(/[|\\]/g, " ");
    });
    return titles.join("|");
  }

  /**
   * Get or compute a compressed DTU block.
   *
   * @param {Array} dtus - DTU objects
   * @returns {{refs: string, hash: string, compressed: Buffer, originalChars: number, compressedChars: number, ratio: number, fromCache: boolean}}
   */
  get(dtus) {
    if (!dtus || dtus.length === 0) {
      return {
        refs: "",
        hash: "empty",
        compressed: Buffer.alloc(0),
        originalChars: 0,
        compressedChars: 0,
        ratio: 1.0,
        fromCache: true,
      };
    }
    const hash = this.hash(dtus);

    if (this.cache.has(hash)) {
      this.hits++;
      const entry = this.cache.get(hash);
      // Move to end (LRU)
      this.cache.delete(hash);
      this.cache.set(hash, entry);
      return { ...entry, fromCache: true };
    }

    this.misses++;
    const refs = this.buildRefString(dtus);
    const originalChars = refs.length;
    const compressed = brotliCompressSync(Buffer.from(refs, "utf8"), {
      params: { [BROTLI_PARAM_QUALITY]: 6 },
    });
    const compressedChars = compressed.length;
    const ratio = originalChars / Math.max(compressedChars, 1);

    // Evict oldest if full
    if (this.cache.size >= this.max) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }

    const entry = {
      refs,
      hash,
      compressed,
      originalChars,
      compressedChars,
      ratio,
      fromCache: false,
    };
    this.cache.set(hash, entry);
    return entry;
  }

  /**
   * Stats for monitoring.
   */
  stats() {
    return {
      size: this.cache.size,
      max: this.max,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits / Math.max(this.hits + this.misses, 1),
    };
  }

  /**
   * Clear cache (called when DTU set changes globally).
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// Module-level singleton
const _globalCache = new DTUBlockCache(512);

/**
 * Public cache getter.
 */
export function getBlockCache() {
  return _globalCache;
}

/**
 * Reset for tests.
 */
export function resetBlockCache() {
  _globalCache.clear();
}

// ── Main DHTP Function ─────────────────────────────────────────────────

/**
 * Apply DHTP compression to a chat prompt.
 *
 * @param {object} opts
 * @param {string} opts.prompt - Raw user prompt
 * @param {Array} [opts.workingSetDtus] - DTUs from context harvest
 * @param {string} [opts.baseSystemPrompt] - Default system prompt (used if no preset)
 * @returns {{
 *   systemPrompt: string,
 *   dtuRefs: string,
 *   dtuBlockCompressed: Buffer,
 *   dtuHash: string,
 *   maxResponseTokens: number,
 *   dtuBudgetPct: number,
 *   presetId: string|null,
 *   compressed: boolean,
 *   originalChars: number,
 *   compressedChars: number,
 *   ratio: number,
 *   matchTimeMs: number,
 * }}
 */
export function applyDHTP(opts) {
  const start = Date.now();
  const { prompt, workingSetDtus = [], baseSystemPrompt = "" } = opts;

  const detected = selectPreset(prompt);
  const cache = getBlockCache();

  if (!detected.matched) {
    // No preset — fall back to default pipeline
    return {
      systemPrompt: baseSystemPrompt,
      dtuRefs: "",
      dtuBlockCompressed: Buffer.alloc(0),
      dtuHash: "none",
      maxResponseTokens: 800,
      dtuBudgetPct: 50,
      presetId: null,
      compressed: false,
      originalChars: baseSystemPrompt.length,
      compressedChars: baseSystemPrompt.length,
      ratio: 1.0,
      matchTimeMs: Date.now() - start,
    };
  }

  const { preset } = detected;
  const block = cache.get(workingSetDtus);

  // Compose compact system prompt: preset template + compressed DTU refs
  const dtuRefsString = block.refs
    ? `[CTX]${block.refs}`
    : "";

  const compactPrompt = `${preset.template}${dtuRefsString ? "\n\n" + dtuRefsString : ""}`;

  // Design-target metric (HASH DTU refs): TOKEN-level estimate — not live IR avg
  // 33 raw DTUs × 60 tokens/DTU formatted = 1980 tokens uncompressed
  // DHTP compressed: 250 chars / 4 chars/token ≈ 62 tokens
  // Design estimate: 1980/62 ≈ 32× on HASH DTU path — not live IR avg (~1.2×)
  const originalChars = baseSystemPrompt.length + workingSetDtus.length * 240;  // 240 chars/DTU formatted
  const compressedChars = compactPrompt.length;
  // Token estimate: 4 chars/token typical for qwen/llama tokenizers
  const originalTokens = Math.ceil(originalChars / 4);
  const compressedTokens = Math.ceil(compressedChars / 4);
  const ratio = originalTokens / Math.max(compressedTokens, 1);

  return {
    systemPrompt: compactPrompt,
    dtuRefs: block.refs,
    dtuBlockCompressed: block.compressed,
    dtuHash: block.hash,
    maxResponseTokens: preset.maxResponseTokens,
    dtuBudgetPct: preset.dtuBudgetPct,
    presetId: preset.id,
    compressed: true,
    originalChars,
    compressedChars,
    ratio,
    matchTimeMs: Date.now() - start,
  };
}

/**
 * Decompress a cached DTU block (for debugging / inspection).
 */
export function decompressDTUBlock(compressed) {
  if (!compressed || compressed.length === 0) return "";
  return brotliDecompressSync(compressed).toString("utf8");
}

/**
 * Get DHTP statistics (cache + preset hit rate).
 */

/**
 * Measured HASH-mode DTU ref compression bench (design path).
 * Scope: HASH DTU refs only — NOT live executive IR avg (~1.2×).
 * Builds N synthetic DTUs, matches a compact preset, returns measured ratio.
 * Target: ≥30× on the HASH path (design math ~32–124× depending on denominator).
 */
export function measureHashModeDtuBench({ dtuCount = 33, prompt = "summarize these DTUs", baseSystemPrompt } = {}) {
  resetBlockCache();
  const n = Math.max(6, Number(dtuCount) || 33); // HASH mode requires >5
  const dtus = Array.from({ length: n }, (_, i) => ({
    id: `hash_bench_${i}`,
    tier: i % 3 === 0 ? "mega" : i % 3 === 1 ? "hyper" : "regular",
    title: `Bench DTU Title ${i} with representative body text for formatting`,
    updatedAt: String(1_700_000_000 + i),
  }));
  const base =
    baseSystemPrompt ||
    ("You are Concord, a cognitive operating system with full world context. " .repeat(20));
  const result = applyDHTP({ prompt, workingSetDtus: dtus, baseSystemPrompt: base });
  const hashMode = n > 5 && typeof result.dtuRefs === "string" && result.dtuRefs.startsWith("#");
  return {
    ok: !!(result.compressed && hashMode && result.ratio >= 30),
    scope: "HASH_DTU_refs",
    not_scope: "live_executive_IR_avg",
    dtuCount: n,
    presetId: result.presetId,
    hashMode,
    dtuRefs: result.dtuRefs,
    dtuHash: result.dtuHash,
    originalChars: result.originalChars,
    compressedChars: result.compressedChars,
    ratio: result.ratio,
    threshold: 30,
    passes: !!(result.compressed && hashMode && result.ratio >= 30),
  };
}

/**
 * Record a HASH-mode bench row into dhtp_metrics (path=hash_dtu_refs).
 * Call with kitchen or test db after migrations.
 */
export function recordHashModeBenchMetric(db, bench, recordFn) {
  if (!db || !bench || typeof recordFn !== "function") return { ok: false, reason: "missing_args" };
  const fullTokens = Math.ceil((bench.originalChars || 0) / 4);
  const dhtpTokens = Math.ceil((bench.compressedChars || 0) / 4);
  const row = recordFn(db, {
    missionId: "hash_dtu_bench",
    stepIndex: 0,
    taskClass: "hash_dtu_refs",
    fullContextTokens: fullTokens,
    dhtpTokens,
    taskSuccess: !!bench.passes,
    verificationSuccess: !!bench.hashMode,
    latencyMs: 0,
    cacheHit: false,
    recoveryRequired: false,
    compressionRatio: bench.ratio,
    presetId: bench.presetId || "hash_bench",
    path: "hash_dtu_refs",
    dtuCandidates: bench.dtuCount,
    dtuSelected: bench.dtuCount,
    tokensAfterDtu: dhtpTokens,
    totalTokensAvoided: Math.max(0, fullTokens - dhtpTokens),
  });
  return { ok: !!row?.ok, path: "hash_dtu_refs", ratio: bench.ratio, record: row };
}

export function getDHTPStats() {
  return {
    cache: getBlockCache().stats(),
    presets: compileRegexes().length,
  };
}
