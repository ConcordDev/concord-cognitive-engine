// server/lib/runtime/dhtp-rs-agent-state.js
// Resumable progress tracking for cloud agents (DHTP-RS-MASTER-001 §24)

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SPEC_ID,
  EXECUTION_ORDER,
  PHASE1_BASELINE,
} from "./dhtp-rs-spec.js";

export const DEFAULT_RESULTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../results/dhtp-rs",
);
export const AGENT_STATE_FILE = "AGENT_STATE.json";

const STEP_META = Object.freeze({
  STEP_1_analyze_phase1: {
    label: "Analyze Phase 1 results",
    command: "analyze",
    autoComplete: true,
  },
  STEP_2_phase2_generalization: {
    label: "Phase 2 — 6 probes × 20 trials × 3 conditions",
    command: "phase2",
  },
  STEP_3_selection_ablations: {
    label: "Selection/structure ablations",
    command: "ablation",
  },
  STEP_4_local_model_portability: {
    label: "Local model portability (2B/7B/14B)",
    command: "local-models",
  },
  STEP_5_full_raw_selective: {
    label: "Full raw on strongest probe",
    command: "full-raw",
  },
  STEP_6_human_blind_validation: {
    label: "Human blind validation subset export",
    command: "human-validation",
  },
  STEP_7_freeze_and_publish: {
    label: "Freeze benchmark + publish claim",
    command: "freeze",
  },
});

function defaultSteps() {
  const steps = {};
  for (const id of EXECUTION_ORDER) {
    const meta = STEP_META[id] || {};
    steps[id] = {
      status: meta.autoComplete ? "complete" : "pending",
      label: meta.label,
      command: meta.command,
      manual: !!meta.manual,
      completedAt: meta.autoComplete ? PHASE1_BASELINE.runId : null,
      runId: meta.autoComplete ? PHASE1_BASELINE.runId : null,
      note: meta.autoComplete ? "Phase 1 fleet-health 30-trial baseline complete" : null,
    };
  }
  return steps;
}

export function agentStatePath(resultsDir = DEFAULT_RESULTS_DIR) {
  return join(resultsDir, AGENT_STATE_FILE);
}

export function loadAgentState(resultsDir = DEFAULT_RESULTS_DIR) {
  const path = agentStatePath(resultsDir);
  if (!existsSync(path)) {
    return {
      specId: SPEC_ID,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: defaultSteps(),
      lastRunId: PHASE1_BASELINE.runId,
      lastResultPath: null,
      phase1Baseline: PHASE1_BASELINE.runId,
    };
  }
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    state.steps = { ...defaultSteps(), ...(state.steps || {}) };
    return state;
  } catch {
    return { specId: SPEC_ID, version: 1, steps: defaultSteps(), parseError: true };
  }
}

export function saveAgentState(state, resultsDir = DEFAULT_RESULTS_DIR) {
  const path = agentStatePath(resultsDir);
  mkdirSync(resultsDir, { recursive: true });
  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next;
}

export function markStep(state, stepId, {
  status = "complete",
  runId = null,
  resultPath = null,
  note = null,
  error = null,
} = {}) {
  const steps = { ...state.steps };
  steps[stepId] = {
    ...(steps[stepId] || {}),
    status,
    completedAt: status === "complete" ? new Date().toISOString() : steps[stepId]?.completedAt,
    runId: runId ?? steps[stepId]?.runId,
    resultPath: resultPath ?? steps[stepId]?.resultPath,
    note: note ?? steps[stepId]?.note,
    error: error ?? null,
  };
  return {
    ...state,
    steps,
    lastRunId: runId || state.lastRunId,
    lastResultPath: resultPath || state.lastResultPath,
  };
}

export function findNextStep(state) {
  for (const stepId of EXECUTION_ORDER) {
    const step = state.steps?.[stepId];
    if (!step || step.status === "pending" || step.status === "failed") {
      return { stepId, step: { ...STEP_META[stepId], ...step } };
    }
  }
  return null;
}

export function listResultArtifacts(resultsDir = DEFAULT_RESULTS_DIR) {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir)
    .filter((f) => f.startsWith("rsb_") && f.endsWith(".json"))
    .map((f) => {
      const full = join(resultsDir, f);
      const stat = statSync(full);
      return { file: f, path: full, mtime: stat.mtime.toISOString(), bytes: stat.size };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export function formatAgentStatus(state, { resultsDir = DEFAULT_RESULTS_DIR, configuredProviders = [] } = {}) {
  const lines = [
    `DHTP-RS cloud agent status — ${SPEC_ID}`,
    `Updated: ${state.updatedAt || "never"}`,
    "",
    "EXECUTION PROGRESS",
  ];

  for (const stepId of EXECUTION_ORDER) {
    const step = state.steps?.[stepId] || {};
    const icon = step.status === "complete" ? "✓" : step.status === "running" ? "…" : step.status === "failed" ? "✗" : "○";
    lines.push(`  ${icon} ${stepId}: ${step.label || stepId} [${step.status || "pending"}]`);
    if (step.runId) lines.push(`      run: ${step.runId}`);
    if (step.note) lines.push(`      note: ${step.note}`);
    if (step.error) lines.push(`      error: ${step.error}`);
  }

  const next = findNextStep(state);
  lines.push("");
  if (next) {
    lines.push(`NEXT STEP: ${next.stepId}`);
    lines.push(`  Run: node server/scripts/run-dhtp-rs.mjs ${next.step.command || "resume"}`);
    if (next.step.manual) lines.push("  (requires operator setup — see docs/DHTP_RS_CLOUD_AGENT.md)");
  } else {
    lines.push("ALL AUTOMATED STEPS COMPLETE — review results and proceed to manual validation.");
  }

  lines.push("");
  lines.push("CONFIGURED PROVIDERS:");
  if (configuredProviders.length) {
    for (const p of configuredProviders) {
      lines.push(`  • ${p.provider} via ${p.envVar} (${p.keyLen} chars)`);
    }
  } else {
    lines.push("  (none — set GEMINI_API_KEY or use --env-file)");
  }

  const artifacts = listResultArtifacts(resultsDir);
  lines.push("");
  lines.push(`RESULT ARTIFACTS: ${artifacts.length} in ${resultsDir}`);
  for (const a of artifacts.slice(0, 5)) {
    lines.push(`  • ${a.file} (${a.mtime})`);
  }

  return lines.join("\n");
}

export { STEP_META, EXECUTION_ORDER };
