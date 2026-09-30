#!/usr/bin/env node
/**
 * Fair A/B/C on Gemma conscious: RAW vs DHTP vs DHTP+DTU
 * Uses existing representation-sufficiency-bench + Ollama tunnel :11435
 */
import Database from "better-sqlite3";
import { writeFileSync, readFileSync } from "node:fs";

const REPO = "/Users/dutch/concord vs code/concord-cognitive-engine";
const OUT_JSON = "/Users/dutch/.zuko/remaining-work/gemma-dhtp-dtu-bloat.json";
const OUT_MD = "/Users/dutch/.zuko/remaining-work/gemma-dhtp-dtu-bloat.md";
const OUT_BENCH = "/Users/dutch/.zuko/remaining-work/gemma-dhtp-dtu-bloat.bench.json";
const SOFT = "/Users/dutch/.zuko/remaining-work/_gemma_soft_probe.json";

process.chdir(REPO);
process.env.CONCORD_REPO_ROOT = REPO;
process.env.OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11435";
process.env.OLLAMA_HOST = process.env.OLLAMA_URL;

const { up: upMission } = await import(REPO + "/server/migrations/423_mission_runtime.js");
const { up: upPhases } = await import(REPO + "/server/migrations/424_runtime_phases.js");
const { up: upTier } = await import(REPO + "/server/migrations/425_runtime_tier.js");
const { up: upDila } = await import(REPO + "/server/migrations/426_dila_runtime_v1.js");
const { up: upV2 } = await import(REPO + "/server/migrations/427_dila_runtime_v2.js");
const { up: upExec } = await import(REPO + "/server/migrations/428_dila_executive_closure.js");
const { up: upCausal } = await import(REPO + "/server/migrations/429_dila_tier2_brain.js");
const { up: upDhtp } = await import(REPO + "/server/migrations/435_dhtp_metrics.js");
const { up: upCognitive } = await import(REPO + "/server/migrations/436_dhtp_cognitive.js");
const { up: upSavings } = await import(REPO + "/server/migrations/437_cognitive_savings_ledger.js");
const { up: upBilling } = await import(REPO + "/server/migrations/438_provider_billing_telemetry.js");
const { up: upCompilerV2 } = await import(REPO + "/server/migrations/439_cognitive_compiler_v2.js");
const { seedBenchDtuCorpus } = await import(REPO + "/server/lib/runtime/cognitive-savings-ledger.js");
const {
  runRepresentationSufficiencyBench,
  REPRESENTATION_CONDITIONS,
  COGNITIVE_PROBES,
} = await import(REPO + "/server/lib/runtime/representation-sufficiency-bench.js");
const { makeOllamaCallProvider } = await import(REPO + "/server/lib/runtime/dhtp-rs-ollama-provider.js");
const { compileExecutiveCognition } = await import(REPO + "/server/lib/runtime/dhtp-compiler.js");
const { getBlindPathConfig } = await import(REPO + "/server/lib/runtime/cognitive-economics.js");
const { estimateTokens } = await import(REPO + "/server/lib/token-budget-assembler.js");

const MODEL = process.env.DHTP_RS_OLLAMA_MODEL || "concord-brain-conscious:latest";
const OLLAMA = process.env.OLLAMA_URL;
const CONDITIONS = ["dhtp_packet", "dhtp_full", "raw_corpus"]; // DHTP first; RAW last (huge)
const PROBES = [
  "fleet_health",
  "contradiction_detection",
  "decision",
  "anomaly_detection",
  "planning",
];
const TRIALS = Number(process.env.TRIALS || 2);
const DELAY = Number(process.env.DELAY_SEC || 1);
const TIMEOUT = Number(process.env.TIMEOUT_SEC || 240);

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [
    upMission, upPhases, upTier, upDila, upV2, upExec, upCausal,
    upDhtp, upCognitive, upSavings, upBilling, upCompilerV2,
  ]) up(db);
  seedBenchDtuCorpus(db, { count: 50 });
  return db;
}

async function offlineCompileSizes(db) {
  const sizes = {};
  for (const conditionId of CONDITIONS) {
    const cond = REPRESENTATION_CONDITIONS[conditionId];
    const path = getBlindPathConfig(cond.pathId);
    const probe = COGNITIVE_PROBES.fleet_health;
    const compiled = await compileExecutiveCognition({
      db,
      mission: { id: "mis_offline", goal: probe.goal, template: probe.template, status: "running" },
      step: { tool: "cognitive_delta_execute", args: { text: probe.delta } },
      stepIndex: 1,
      route: { taskClass: probe.taskClass },
      ledger: {},
      lessons: [],
      context: { observation: { missions_running: 1, alerts_open: 0, probe: probe.id } },
      bumpRecall: false,
      ...path.compile,
    });
    const prompt = `${compiled.systemPrompt || ""}\n${compiled.userPrompt || ""}`;
    const chars = prompt.length;
    const tokensEst = estimateTokens(prompt);
    const savings = compiled.savings || {};
    sizes[conditionId] = {
      label: cond.label,
      pathId: cond.pathId,
      pathVariant: path.compile?.pathVariant,
      promptChars: chars,
      estTokensCharsOver4: Math.round(chars / 4),
      estTokensHarness: tokensEst,
      savingsActualModelInputTokens: savings.actualModelInputTokens ?? null,
      savingsDhtpTokens: savings.dhtpTokens ?? null,
      savingsWorldStateTokens: savings.worldStateTokens ?? null,
      savingsAfterDtuTokens: savings.afterDtuTokens ?? null,
      toolOrDtuPath: {
        skipDhtp: !!path.compile?.skipDhtp,
        skipDtuFilter: path.compile?.skipDtuFilter === true,
        dtuFilterOn: path.compile?.skipDtuFilter !== true && path.compile?.useRawJson !== true,
        useRawJson: !!path.compile?.useRawJson,
      },
    };
  }
  const rawChars = sizes.raw_corpus.promptChars || 1;
  const rawTok = sizes.raw_corpus.estTokensHarness || sizes.raw_corpus.estTokensCharsOver4 || 1;
  for (const id of CONDITIONS) {
    sizes[id].ratioVsRawChars = +(rawChars / Math.max(1, sizes[id].promptChars)).toFixed(3);
    sizes[id].ratioVsRawTokens = +(rawTok / Math.max(1, sizes[id].estTokensHarness || sizes[id].estTokensCharsOver4)).toFixed(3);
  }
  return sizes;
}

function pickAggregates(bench) {
  if (bench?.overall?.aggregates && Object.keys(bench.overall.aggregates).length) return bench.overall.aggregates;
  if (bench.aggregates && Object.keys(bench.aggregates).length) return bench.aggregates;
  if (bench.conditionAggregates) return bench.conditionAggregates;
  if (bench.summary?.aggregates) return bench.summary.aggregates;
  return {};
}

function verdictFrom(agg, offline) {
  const raw = agg.raw_corpus;
  const dhtp = agg.dhtp_packet;
  const full = agg.dhtp_full;
  const notes = [];
  if (!raw || !dhtp || !full) {
    return { verdict: "MIXED", reason: "missing condition aggregates — see offline ratios", notes, offlineOnly: true };
  }
  const tokRaw = raw.avgTokensIn || 0;
  const tokDhtp = dhtp.avgTokensIn || 0;
  const tokFull = full.avgTokensIn || 0;
  const offlineFullRatio = offline?.dhtp_full?.ratioVsRawTokens || null;
  const offlineDhtpRatio = offline?.dhtp_packet?.ratioVsRawTokens || null;
  const liveShrinkDhtp = tokRaw > 0 && tokDhtp > 0 ? tokRaw / tokDhtp : null;
  const liveShrinkFull = tokRaw > 0 && tokFull > 0 ? tokRaw / tokFull : null;
  const qualityOk = (full.avgComposite ?? 0) >= (raw.avgComposite ?? 0) - 0.05
    || (full.avgTaskCorrectness ?? 0) >= (raw.avgTaskCorrectness ?? 0) - 0.05;
  const shrinkOk = (liveShrinkFull != null && liveShrinkFull >= 1.15)
    || (offlineFullRatio != null && offlineFullRatio >= 1.15);
  const fullVsDhtpExtra = (liveShrinkFull != null && liveShrinkDhtp != null)
    ? liveShrinkFull > liveShrinkDhtp * 1.05
    : (offlineFullRatio != null && offlineDhtpRatio != null && offlineFullRatio > offlineDhtpRatio * 1.05);

  let verdict = "MIXED";
  let reason = "";
  if (shrinkOk && qualityOk) {
    verdict = "YES";
    reason = "DHTP+DTU shrinks tokens vs RAW while quality holds (±5pp)";
  } else if (shrinkOk && !qualityOk) {
    verdict = "MIXED";
    reason = "token shrink present but quality drops vs RAW";
  } else if (!shrinkOk && qualityOk) {
    verdict = "MIXED";
    reason = "quality holds but token shrink vs RAW is weak (<1.15×)";
  } else {
    verdict = "NO";
    reason = "no meaningful shrink and quality does not hold";
  }
  notes.push(`live_shrink_dhtp=${liveShrinkDhtp?.toFixed?.(2) ?? "n/a"}×`);
  notes.push(`live_shrink_dhtp_dtu=${liveShrinkFull?.toFixed?.(2) ?? "n/a"}×`);
  notes.push(`offline_shrink_dhtp=${offlineDhtpRatio ?? "n/a"}×`);
  notes.push(`offline_shrink_dhtp_dtu=${offlineFullRatio ?? "n/a"}×`);
  notes.push(`dtu_adds_extra_shrink_vs_dhtp_only=${fullVsDhtpExtra}`);
  notes.push("HASH ~55× is scoped DTU-ref bench — NOT this executive IR number");
  notes.push("historical executive IR ~1.2× from dhtp_metrics — separate from this Gemma A/B/C");
  return {
    verdict, reason, liveShrinkDhtp, liveShrinkFull, offlineDhtpRatio, offlineFullRatio,
    quality: {
      raw: raw.avgComposite, dhtp: dhtp.avgComposite, dhtp_dtu: full.avgComposite,
      rawCorrect: raw.avgTaskCorrectness, dhtpCorrect: dhtp.avgTaskCorrectness, dhtpDtuCorrect: full.avgTaskCorrectness,
    },
    tokensIn: { raw: tokRaw, dhtp: tokDhtp, dhtp_dtu: tokFull },
    latencyMs: { raw: raw.avgLatencyMs, dhtp: dhtp.avgLatencyMs, dhtp_dtu: full.avgLatencyMs },
    notes,
  };
}

function renderMd(report) {
  const v = report.verdict_block;
  const labels = { raw_corpus: "RAW", dhtp_packet: "DHTP", dhtp_full: "DHTP+DTU" };
  const lines = [];
  lines.push(`# Gemma DHTP+DTU context-bloat A/B/C`);
  lines.push(``);
  lines.push(`**When (ET):** ${report.when_et}`);
  lines.push(`**Model:** \`${report.model}\` via \`${report.ollama_url}\` (conscious / Gemma2-27B Q8)`);
  lines.push(`**Harness:** existing \`representation-sufficiency-bench\` (raw_corpus / dhtp_packet / dhtp_full)`);
  lines.push(`**Probes:** ${report.probes.join(", ")}`);
  lines.push(`**Trials/condition/probe:** ${report.trials}`);
  lines.push(``);
  lines.push(`## Verdict`);
  lines.push(``);
  lines.push(`**${v.verdict}** — ${v.reason}`);
  lines.push(``);
  lines.push(`Key live ratios (prompt tokens in):`);
  lines.push(`- RAW → DHTP: **${v.liveShrinkDhtp?.toFixed?.(2) ?? "n/a"}×**`);
  lines.push(`- RAW → DHTP+DTU: **${v.liveShrinkFull?.toFixed?.(2) ?? "n/a"}×**`);
  lines.push(`Offline compile ratios (same corpus): DHTP **${v.offlineDhtpRatio ?? "n/a"}×**, DHTP+DTU **${v.offlineFullRatio ?? "n/a"}×**`);
  lines.push(``);
  lines.push(`### Honesty fence`);
  lines.push(`- Executive DHTP IR historically **~1.2×** (\`dhtp-check.json\` live_ir_avg) — do **not** conflate with HASH.`);
  lines.push(`- HASH DTU-refs **~55×** is a **scoped** compression bench, not kitchen executive IR.`);
  lines.push(`- This run answers Gemma-on-conscious bloat for RAW vs DHTP vs DHTP+DTU only.`);
  lines.push(``);
  lines.push(`## Condition table (live Gemma calls)`);
  lines.push(``);
  lines.push(`| Condition | avg tokensIn | avg tokensOut | avg latency(s) | quality | correct | schema | API fail |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const id of CONDITIONS) {
    const a = report.aggregates?.[id] || {};
    lines.push(`| ${labels[id]} | ${Math.round(a.avgTokensIn || 0)} | ${Math.round(a.avgTokensOut || 0)} | ${((a.avgLatencyMs || 0)/1000).toFixed(1)} | ${((a.avgComposite || 0)*100).toFixed(1)}% | ${((a.avgTaskCorrectness || 0)*100).toFixed(0)}% | ${((a.avgSchemaAdherence || 0)*100).toFixed(0)}% | ${((a.apiFailureRate || 0)*100).toFixed(0)}% |`);
  }
  lines.push(``);
  lines.push(`## Offline compile sizes (no LLM)`);
  lines.push(``);
  lines.push(`| Condition | chars | est tokens | ratio vs RAW | pathVariant | DTU on | DHTP on |`);
  lines.push(`|---|---:|---:|---:|---|---|---|`);
  for (const id of CONDITIONS) {
    const s = report.offline_compile?.[id] || {};
    const dtuOn = s.toolOrDtuPath?.dtuFilterOn ? "yes" : "no";
    const dhtpOn = s.toolOrDtuPath?.skipDhtp ? "no" : "yes";
    lines.push(`| ${labels[id]} | ${s.promptChars} | ${s.estTokensHarness} | ${s.ratioVsRawTokens}× | ${s.pathVariant} | ${dtuOn} | ${dhtpOn} |`);
  }
  lines.push(``);
  lines.push(`## Soft claim re-probe`);
  const soft = report.soft_probe || {};
  const brains = soft.local_5050_summary?.brains || {};
  lines.push(`- Local \`:5050\` health: **${soft.local_5050_summary?.status || "?"}**`);
  lines.push(`- Five-Brain model IDs: ${Object.entries(brains).map(([k,v]) => `${k}=\`${v.model}\``).join(", ") || "n/a"}`);
  lines.push(`- Workers pgrep llm-worker: **${soft.workers_live_pgrep?.count ?? "?"}**; workers.json alive: **${soft.workers_file?.alive ?? soft.workers_file?.alive_count ?? soft.workers_file?.summary?.alive ?? "see file"}**`);
  lines.push(`- Prod \`concord-os.org/health\`: HTTP **${soft.prod_concord_os?.http ?? "?"}** status **${soft.prod_summary?.status ?? "?"}**`);
  lines.push(`- Prior executive IR: **${Number(soft.dhtp_check?.live_ir_avg || 0).toFixed(3)}×** (n=${soft.dhtp_check?.live_ir_n ?? "?"})`);
  lines.push(`- HASH scoped badge (docs): **55.60×** — not re-run here; kept separate`);
  lines.push(``);
  lines.push(`## Proof paths`);
  lines.push(`- \`${OUT_JSON}\``);
  lines.push(`- \`${OUT_MD}\``);
  lines.push(`- Full bench: \`${OUT_BENCH}\``);
  lines.push(`- Soft probe: \`${SOFT}\``);
  lines.push(``);
  lines.push(`## Notes`);
  for (const n of v.notes || []) lines.push(`- ${n}`);
  if (report.headline?.primaryClaim) lines.push(`- Bench headline: ${report.headline.primaryClaim}`);
  lines.push(`- Smoke: ok=${report.smoke?.ok} text=${JSON.stringify(report.smoke?.text || "")}`);
  lines.push(`- Evaluator: deterministic rubric (blind to condition, not independent human).`);
  lines.push(`- Elapsed: ${Math.round((report.elapsed_ms || 0)/1000)}s`);
  lines.push(``);
  return lines.join("\n");
}

async function main() {
  const started = Date.now();
  const whenEt = new Date().toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET";
  console.log(`[gemma-bloat] model=${MODEL} ollama=${OLLAMA}`);
  console.log(`[gemma-bloat] conditions=${CONDITIONS.join(",")} probes=${PROBES.length} trials=${TRIALS}`);

  const db = setupDb();
  console.log("[gemma-bloat] offline compile sizes…");
  const offline = await offlineCompileSizes(db);
  console.log(JSON.stringify(offline, null, 2));

  const callProvider = makeOllamaCallProvider(MODEL, OLLAMA);
  console.log("[gemma-bloat] smoke chat…");
  const smoke = await callProvider({
    messages: [{ role: "user", content: "Reply with exactly: PONG" }],
    opts: { maxTokens: 16, timeoutMs: 180000 },
  });
  console.log("[gemma-bloat] smoke=", smoke.ok, (smoke.text || "").slice(0, 80), smoke.error || "");

  console.log("[gemma-bloat] running representation sufficiency A/B/C…");
  const bench = await runRepresentationSufficiencyBench({
    db,
    trials: TRIALS,
    probes: PROBES,
    conditions: CONDITIONS,
    provider: "ollama",
    apiKey: "ollama-local",
    callProvider,
    timeoutMs: TIMEOUT * 1000,
    interCallDelayMs: DELAY * 1000,
    maxRetries: Number(process.env.MAX_RETRIES || 1),
    onTrialComplete: ({ run, probeId, conditionId, trialIndex }) => {
      const tok = run?.live?.tokensIn ?? "?";
      const ok = run?.live?.ok;
      const fail = run?.live?.apiFailure || run?.live?.error;
      const ms = run?.live?.latencyMs ?? run?.latencyMs ?? "?";
      console.log(`[trial] ${conditionId} probe=${probeId} t=${trialIndex} ok=${ok} tokensIn=${tok} ms=${ms} err=${fail || ""}`);
    },
  });

  let soft = {};
  try { soft = JSON.parse(readFileSync(SOFT, "utf8")); } catch { /* ignore */ }

  let agg = pickAggregates(bench);
  const succ = bench?.overall?.aggregatesSuccessfulOnly || {};
  // Prefer successful-only when RAW has high API fail but successes exist
  if (succ.raw_corpus && (agg.raw_corpus?.apiFailureRate || 0) > 0.2) {
    agg = succ;
    console.log("[gemma-bloat] using aggregatesSuccessfulOnly due to raw API fail rate");
  }
  const verdict_block = Object.keys(agg).length
    ? verdictFrom(agg, offline)
    : (() => {
        // offline-only fallback if live agg missing
        const fake = {
          raw_corpus: { avgTokensIn: offline.raw_corpus.estTokensHarness, avgComposite: 0, avgTaskCorrectness: 0, avgLatencyMs: 0 },
          dhtp_packet: { avgTokensIn: offline.dhtp_packet.estTokensHarness, avgComposite: 0, avgTaskCorrectness: 0, avgLatencyMs: 0 },
          dhtp_full: { avgTokensIn: offline.dhtp_full.estTokensHarness, avgComposite: 0, avgTaskCorrectness: 0, avgLatencyMs: 0 },
        };
        const v = verdictFrom(fake, offline);
        v.reason = (v.reason || "") + " [aggregates missing — ratios from offline compile + any live trials in bench file]";
        return v;
      })();

  const report = {
    when_et: whenEt,
    when_utc: new Date().toISOString(),
    model: MODEL,
    parent_model: "gemma2:27b-instruct-q8_0",
    ollama_url: OLLAMA,
    conditions: CONDITIONS,
    condition_map: { RAW: "raw_corpus", DHTP: "dhtp_packet", "DHTP+DTU": "dhtp_full" },
    probes: PROBES,
    trials: TRIALS,
    smoke: { ok: smoke.ok, text: (smoke.text || "").slice(0, 120), error: smoke.error || null, tokensIn: smoke.tokensIn, tokensOut: smoke.tokensOut },
    offline_compile: offline,
    aggregates: agg,
    headline: bench.headline || null,
    runId: bench.runId || bench.id || null,
    elapsed_ms: Date.now() - started,
    verdict_block,
    soft_probe: {
      local_5050_summary: soft.local_5050_summary,
      prod_concord_os: soft.prod_concord_os,
      prod_summary: soft.prod_summary,
      workers_live_pgrep: soft.workers_live_pgrep,
      workers_file: soft.workers_file,
      dhtp_check: soft.dhtp_check,
      ollama_models: soft.ollama_models,
    },
    honesty: {
      executive_ir_historical: soft.dhtp_check?.live_ir_avg ?? 1.2,
      hash_dtu_refs_scoped: 55.6,
      do_not_conflate: true,
    },
    bench_keys: Object.keys(bench || {}),
  };

  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  writeFileSync(OUT_BENCH, JSON.stringify(bench, null, 2));
  writeFileSync(OUT_MD, renderMd(report));
  console.log("[gemma-bloat] VERDICT", verdict_block.verdict, verdict_block.reason);
  console.log("[gemma-bloat] wrote", OUT_JSON);
}

main().catch((e) => {
  console.error(e);
  writeFileSync(OUT_JSON, JSON.stringify({ ok: false, error: String(e?.stack || e) }, null, 2));
  process.exit(1);
});
