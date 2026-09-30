// server/lib/runtime/dhtp-rs-freeze.js
// Final report synthesis (DHTP-RS-MASTER-001 STEP 7)

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SPEC_ID, CURRENT_CLAIM, CLAIM_LEVELS } from "./dhtp-rs-spec.js";
import { buildStatisticalReport } from "./dhtp-rs-statistics.js";

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function inferClaimLevel(artifacts) {
  let level = 1;
  const phase2 = artifacts.find((a) => a.stepId === "STEP_2_phase2_generalization");
  if (phase2?.bench?.probes?.length >= 6) level = 2;
  const local = artifacts.find((a) => a.stepId === "STEP_4_local_model_portability");
  if (local?.models?.length >= 1) level = Math.max(level, 3);
  const ablation = artifacts.find((a) => a.stepId === "STEP_3_selection_ablations");
  if (ablation) level = Math.max(level, 4);
  const human = artifacts.find((a) => a.stepId === "STEP_6_human_blind_validation");
  if (human?.exported) level = Math.max(level, 5);
  return level;
}

export function synthesizeFinalReport({ resultsDir, agentState, artifacts = [] }) {
  const runs = [];
  for (const art of artifacts) {
    const bench = art.bench || loadJson(art.path);
    if (!bench) continue;
    runs.push({ stepId: art.stepId, bench, path: art.path });
  }

  const phase2 = runs.find((r) => r.stepId === "STEP_2_phase2_generalization");
  const ablation = runs.find((r) => r.stepId === "STEP_3_selection_ablations");

  let overallStats = null;
  if (phase2?.bench) {
    const runsByCondition = {};
    for (const cond of phase2.bench.conditions || []) runsByCondition[cond] = [];
    for (const pr of Object.values(phase2.bench.probeResults || {})) {
      for (const [cond, condRuns] of Object.entries(pr.runs || {})) {
        runsByCondition[cond] = (runsByCondition[cond] || []).concat(condRuns);
      }
    }
    overallStats = buildStatisticalReport({
      runsByCondition,
      conditions: phase2.bench.conditions || [],
    });
  }

  const claimLevel = inferClaimLevel(artifacts);
  const lines = [
    `# DHTP-RS Final Report — ${SPEC_ID}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Claim level: **${claimLevel}** — ${CLAIM_LEVELS[claimLevel]}`,
    "",
    "## Authorized claim",
    "",
    CURRENT_CLAIM.text,
    "",
    "## Not claimed",
    "",
    ...CURRENT_CLAIM.notClaimed.map((c) => `- ${c}`),
    "",
  ];

  if (phase2?.bench) {
    lines.push("## Phase 2 — Task generalization", "");
    const agg = phase2.bench.overall?.aggregates || {};
    for (const [cond, a] of Object.entries(agg)) {
      lines.push(`- **${cond}**: ${(a.avgComposite * 100).toFixed(1)}% quality, ~${Math.round(a.avgTokensIn)} tokens, ${(a.apiFailureRate * 100).toFixed(0)}% API fail`);
    }
    if (overallStats?.paired) {
      lines.push("", "### Paired deltas (DHTP minus control)", "");
      for (const [key, p] of Object.entries(overallStats.paired)) {
        if (p.n > 0) {
          lines.push(`- ${key}: mean Δ ${(p.meanDelta * 100).toFixed(1)}pp (n=${p.n}, 95% CI ${(p.ci.low * 100).toFixed(1)}–${(p.ci.high * 100).toFixed(1)}pp)`);
        }
      }
    }
    lines.push("");
  }

  if (ablation?.bench) {
    lines.push("## Phase 3 — Selection ablations", "");
    const agg = ablation.bench.overall?.aggregates || {};
    for (const [cond, a] of Object.entries(agg)) {
      lines.push(`- **${cond}**: ${(a.avgComposite * 100).toFixed(1)}%`);
    }
    lines.push("");
  }

  lines.push("## Agent execution state", "");
  for (const [stepId, step] of Object.entries(agentState?.steps || {})) {
    lines.push(`- ${stepId}: ${step.status}${step.runId ? ` (${step.runId})` : ""}`);
  }

  lines.push("", "## Artifacts", "");
  for (const art of artifacts) {
    lines.push(`- ${art.stepId}: ${art.path || art.runId || "inline"}`);
  }

  return {
    markdown: lines.join("\n"),
    claimLevel,
    specId: SPEC_ID,
  };
}

export function listBenchArtifacts(resultsDir) {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir)
    .filter((f) => f.startsWith("rsb_") && f.endsWith(".json"))
    .map((f) => join(resultsDir, f));
}
