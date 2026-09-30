#!/usr/bin/env node
// server/scripts/run-provider-billed-ab.mjs
//
// Live provider A/B harness — uses free-tier / local API keys (no paid spend required).
//
// Usage:
//   export GROQ_API_KEY=... OPENROUTER_API_KEY=...   # or use --env-file
//   node server/scripts/run-provider-billed-ab.mjs --probe
//   node server/scripts/run-provider-billed-ab.mjs --mirror
//   node server/scripts/run-provider-billed-ab.mjs --cache-baseline --provider groq
//   node server/scripts/run-provider-billed-ab.mjs --blind --live
//   node server/scripts/run-provider-billed-ab.mjs --full --live
//   node server/scripts/run-provider-billed-ab.mjs --full --live --include-xai   # caps at $2.50
//
// XAI: hard budget cap via CONCORD_XAI_BUDGET_USD (default 2.5). Never auto top-up.

import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up as upBilling } from "../migrations/438_provider_billing_telemetry.js";
import { up as upCompilerV2 } from "../migrations/439_cognitive_compiler_v2.js";
import { loadProviderEnv, resolveConfiguredProviders } from "../lib/runtime/provider-env-loader.js";
import {
  probeAllProviders,
  runMirrorComparison,
  runProviderCacheBaseline,
  runBilledBlindSubset,
  runProviderAbBattery,
  resetSessionSpend,
  getSessionSpendUsd,
} from "../lib/runtime/provider-ab-harness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

function parseArgs(argv) {
  const opts = {
    probe: false,
    mirror: false,
    cacheBaseline: false,
    blind: false,
    full: false,
    live: false,
    includeXai: false,
    json: false,
    envFile: null,
    provider: "groq",
    providers: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--probe") opts.probe = true;
    else if (a === "--mirror") opts.mirror = true;
    else if (a === "--cache-baseline") opts.cacheBaseline = true;
    else if (a === "--blind") opts.blind = true;
    else if (a === "--full") opts.full = true;
    else if (a === "--live") opts.live = true;
    else if (a === "--include-xai") opts.includeXai = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--env-file" && argv[i + 1]) opts.envFile = argv[++i];
    else if (a === "--provider" && argv[i + 1]) opts.provider = argv[++i];
    else if (a === "--providers" && argv[i + 1]) opts.providers = argv[++i].split(",").map((s) => s.trim());
  }
  if (!opts.probe && !opts.mirror && !opts.cacheBaseline && !opts.blind && !opts.full) {
    opts.probe = true;
  }
  return opts;
}

function setupDb() {
  const db = new Database(":memory:");
  upBilling(db);
  upCompilerV2(db);
  return db;
}

function printConfigured() {
  const configured = resolveConfiguredProviders();
  console.log("\nConfigured providers:");
  if (!configured.length) {
    console.log("  (none — set GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, etc.)");
    console.log("  Tip: --env-file path/to/keys.env  or export keys in your shell");
    return false;
  }
  for (const c of configured) {
    console.log(`  · ${c.provider} via ${c.envVar} (${c.keyLen} chars)`);
  }
  return true;
}

function printProbe(result) {
  console.log(`\n${"─".repeat(60)}`);
  console.log("PROVIDER PROBE");
  for (const r of result.results || []) {
    if (r.ok) {
      console.log(`  ✓ ${r.provider}: ${r.tokensIn}+${r.tokensOut} tok, ${r.latencyMs}ms, ~$${(r.estimatedUsd || 0).toFixed(6)}`);
    } else {
      console.log(`  ✗ ${r.provider}: ${r.reason || r.error || "failed"}`);
    }
  }
  console.log(`  Session spend: $${getSessionSpendUsd().toFixed(6)}`);
}

function printMirror(result) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`MIRROR COMPARISON (${result.mirrorId})`);
  for (const r of result.runs || []) {
    if (r.ok) {
      console.log(`  ${r.provider}: in=${r.tokensIn} out=${r.tokensOut} lat=${r.latencyMs}ms`);
    } else {
      console.log(`  ${r.provider}: ${r.reason || r.error}`);
    }
  }
  if (result.comparison) {
    console.log(`  Leanest output: ${result.comparison.leanestTokens}`);
  }
}

function printCache(result) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`CACHE BASELINE B (${result.provider})`);
  if (!result.ok) {
    console.log(`  Failed: ${result.reason || result.first?.error || result.second?.error}`);
    return;
  }
  console.log(`  1st call: prompt=${result.first.usage?.prompt_tokens} cached=${result.first.usage?.cached_prompt_tokens}`);
  console.log(`  2nd call: prompt=${result.second.usage?.prompt_tokens} cached=${result.second.usage?.cached_prompt_tokens}`);
  console.log(`  Cache detected: ${result.cacheDetected ? "YES" : "no"}`);
}

function printBlind(result) {
  console.log(`\n${"─".repeat(60)}`);
  console.log("BILLED BLIND SUBSET (A vs E)");
  console.log(`  Real provider telemetry: ${result.billingSummary?.hasRealProviderTelemetry ? "YES" : "no"}`);
  console.log(`  Publishability: ${result.publishability?.status}`);
  for (const g of result.publishability?.gates || []) {
    console.log(`    ${g.passed ? "✓" : "✗"} ${g.label}`);
  }
  const agg = result.billingSummary?.aggregate;
  if (agg) {
    console.log(`  Path A: ${agg.A?.invocations || 0} inv, $${(agg.A?.totalUsd || 0).toFixed(6)}`);
    console.log(`  Path E: ${agg.E?.invocations || 0} inv, $${(agg.E?.totalUsd || 0).toFixed(6)}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.envFile) {
    const { loadEnvFile } = await import("../lib/runtime/provider-env-loader.js");
    loadEnvFile(opts.envFile, { overwrite: true });
  } else {
    const loaded = loadProviderEnv({ repoRoot: REPO_ROOT });
    if (!opts.json && loaded.results?.length) {
      console.log("\nLoaded env files:");
      for (const r of loaded.results) console.log(`  · ${r.path} (${r.loaded} vars)`);
    }
  }

  if (opts.live) process.env.COGNITIVE_LIVE_PROVIDERS = "1";
  resetSessionSpend();

  const db = setupDb();
  const hasKeys = printConfigured();
  if (!hasKeys && !opts.json) {
    console.log("\nNo API keys found — exiting (use --env-file or export keys).");
    process.exit(1);
  }

  let result = { ok: false };

  if (opts.full) {
    result = await runProviderAbBattery({
      db,
      providers: opts.providers,
      includeBlind: true,
      includeXai: opts.includeXai,
    });
    if (!opts.json) {
      printProbe(result.probe);
      printMirror(result.mirror);
      printCache(result.cache);
      if (result.blind) printBlind(result.blind);
      console.log(`\nTotal session spend: $${result.sessionSpendUsd.toFixed(6)}`);
      if (opts.includeXai) console.log(`XAI budget cap: $${result.xaiBudgetCapUsd}`);
    }
  } else {
    const parts = {};
    if (opts.probe) parts.probe = await probeAllProviders({ db, providers: opts.providers });
    if (opts.mirror) parts.mirror = await runMirrorComparison({ db, providers: opts.providers });
    if (opts.cacheBaseline) {
      parts.cache = await runProviderCacheBaseline({ db, provider: opts.provider });
    }
    if (opts.blind) {
      parts.blind = await runBilledBlindSubset({ db });
    }
    result = { ok: Object.values(parts).some((p) => p?.ok), parts, sessionSpendUsd: getSessionSpendUsd() };
    if (!opts.json) {
      if (parts.probe) printProbe(parts.probe);
      if (parts.mirror) printMirror(parts.mirror);
      if (parts.cache) printCache(parts.cache);
      if (parts.blind) printBlind(parts.blind);
      console.log(`\nTotal session spend: $${result.sessionSpendUsd.toFixed(6)}`);
    }
  }

  if (opts.json) {
    const outPath = join(REPO_ROOT, `provider-ab-${Date.now()}.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(outPath);
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
