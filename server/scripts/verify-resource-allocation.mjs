#!/usr/bin/env node
// server/scripts/verify-resource-allocation.mjs
//
// "Will the brains + Concordia's slice actually FIT on the one Blackwell, or will Ollama
// thrash-evict?" — the pre-boot resource sanity check. Estimates each brain model's VRAM
// from its name + quant, adds the resident KV buffer, adds Concordia's reserved slice +
// a system buffer, and asserts the total fits the GPU. Prints a budget table; exit 0 if
// it fits with margin, 1 if it would over-commit (so a bad config can't silently ship).
//
// Estimates are conservative (q4_K_M weights ~0.6 GB/B + ~1 GB resident KV/model). The
// REAL per-model VRAM is in `GET <brain>/api/ps` once the stack is up — run the wiring
// verifier for live numbers; this is the BEFORE-you-boot check.
//
// Usage (from server/, with .env.runpod loaded):  node scripts/verify-resource-allocation.mjs

import { BRAIN_CONFIG } from "../lib/brain-config.js";
import { execSync } from "node:child_process";

const g = (s) => `\x1b[32m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`, y = (s) => `\x1b[33m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const MB = (gb) => Math.round(gb * 1024);

// detect the GPU's VRAM (MB); fall back to the 32GB Blackwell Concord was tuned for.
function gpuVramMB() {
  try {
    const out = execSync("nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits", { timeout: 5000 }).toString().trim().split("\n")[0];
    const v = parseInt(out, 10);
    if (Number.isFinite(v) && v > 0) return v;
  } catch { /* no gpu here */ }
  return 32768;
}

// crude-but-honest model VRAM estimate from the tag (params × bytes-per-param + KV).
// Custom tags with no size in the name (e.g. concord-conscious:latest) can declare their
// size via CONCORD_<ROLE>_PARAMS_B so the budget is accurate.
//
// KV estimate (audit 2026-07-27): was a flat 1.0 GB, documented as "modest ctx" — but
// server.js used to never SEND num_ctx to Ollama at all, so every call silently ran at
// Ollama's small default (2k/4k) regardless of BRAIN_CONFIG.contextWindow. That bug is
// now fixed (server.js sends num_ctx = min(CONCORD_NUM_CTX_CAP, contextWindow) on every
// call), which means the RESIDENT KV cache now actually grows to the full configured
// context — so this estimate must scale with it, or the fit gate stops being honest for
// exactly the config it's supposed to protect. Rough q8_0 GQA rate, scaled by params and
// NUM_PARALLEL (KV scales linearly with concurrent in-flight sequences); tune via
// CONCORD_KV_GB_PER_1K_TOKENS if `GET <brain>/api/ps` shows a different real number.
const KV_GB_PER_1K_TOKENS = Number(process.env.CONCORD_KV_GB_PER_1K_TOKENS) || 0.12; // per 7B-equivalent params
const OLLAMA_NUM_PARALLEL = Number(process.env.OLLAMA_NUM_PARALLEL) || 1;
const NUM_CTX_CAP = Number(process.env.CONCORD_NUM_CTX_CAP) || 32768;

function estimateModelMB(model, role, contextWindow) {
  const name = String(model || "").toLowerCase();
  const m = name.match(/(\d+(?:\.\d+)?)\s*b\b/);
  const override = role && Number(process.env[`CONCORD_${role.toUpperCase()}_PARAMS_B`]);
  const params = Number.isFinite(override) && override > 0 ? override : (m ? parseFloat(m[1]) : 7);
  const declared = !m && Number.isFinite(override) && override > 0;
  let bpp = 0.6;                                     // q4_K_M ≈ 0.6 GB / B
  if (/q8|fp16|:16|f16/.test(name)) bpp = 1.1;
  if (/q2|q3/.test(name)) bpp = 0.45;
  let weightsGB = params * bpp;
  if (/vl|vision|llava/.test(name)) weightsGB += 1.5; // vision encoder
  const effectiveCtx = Math.min(NUM_CTX_CAP, contextWindow || 8192);
  const kvGB = (effectiveCtx / 1000) * (params / 7) * KV_GB_PER_1K_TOKENS * OLLAMA_NUM_PARALLEL;
  return { params, weightsMB: MB(weightsGB), kvMB: MB(kvGB), totalMB: MB(weightsGB) + MB(kvGB), assumed: !m && !declared, declared, effectiveCtx };
}

const VRAM = gpuVramMB();
const SLICE = Number(process.env.CONCORD_WORLD_VRAM_MB) || 6144;
const SYS = 1024; // driver/context/cuda buffer

console.log(`\nConcord — GPU resource fit (one card: ${(VRAM / 1024).toFixed(0)} GB)\n`);
console.log(`${"role".padEnd(13)} ${"model".padEnd(34)} ${"VRAM".padStart(8)}`);
console.log(dim("─".repeat(58)));

let brainsMB = 0;
const ROLE_ORDER = ["conscious", "subconscious", "utility", "repair", "multimodal"];
for (const role of ROLE_ORDER.filter((k) => BRAIN_CONFIG[k])) {
  const e = estimateModelMB(BRAIN_CONFIG[role].model, role, BRAIN_CONFIG[role].contextWindow);
  brainsMB += e.totalMB;
  const tag = e.assumed ? dim("(size assumed 7B — set CONCORD_" + role.toUpperCase() + "_PARAMS_B)") : e.declared ? dim(`(${e.params}B declared)`) : dim(`(ctx ${e.effectiveCtx}, KV ${e.kvMB} MB)`);
  console.log(`${role.padEnd(13)} ${String(BRAIN_CONFIG[role].model).slice(0, 33).padEnd(34)} ${(e.totalMB + " MB").padStart(8)} ${tag}`);
}
console.log(dim("─".repeat(58)));
console.log(`${"brains total".padEnd(48)} ${(brainsMB + " MB").padStart(8)}`);
console.log(`${"Concordia reserved slice".padEnd(48)} ${(SLICE + " MB").padStart(8)} ${dim("(CONCORD_WORLD_VRAM_MB)")}`);
console.log(`${"system / driver buffer".padEnd(48)} ${(SYS + " MB").padStart(8)}`);
const used = brainsMB + SLICE + SYS;
const free = VRAM - used;
console.log(dim("─".repeat(58)));
console.log(`${"TOTAL".padEnd(48)} ${(used + " MB").padStart(8)}  / ${VRAM} MB`);
console.log("");

if (free >= 1024) {
  console.log(g(`✓ Fits with ${free} MB to spare. Brains stay resident (no evict-thrash), Concordia keeps its ${SLICE} MB.`));
  process.exit(0);
} else if (free >= 0) {
  console.log(y(`⚠ Fits, but only ${free} MB headroom — long contexts could push it over. Consider CONCORD_GPU_PROFILE one band down.`));
  process.exit(0);
} else {
  console.log(r(`✗ OVER-COMMIT by ${-free} MB. The 5 models + Concordia slice exceed the card — Ollama will evict/reload models (latency spikes).`));
  console.log(dim(`  Fix: drop CONCORD_GPU_PROFILE a band (smaller models), lower a BRAIN_*_MODEL, or reduce CONCORD_WORLD_VRAM_MB.`));
  process.exit(1);
}
