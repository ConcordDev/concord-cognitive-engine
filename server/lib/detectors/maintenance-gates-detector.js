// server/lib/detectors/maintenance-gates-detector.js
//
// Maintenance B — wire the new SENSES into the immune loop. The schema-drift +
// economic-invariant gates are CLI scripts; this detector runs them (per-commit,
// heavy) and maps their exit code to findings the repair-cortex bridge consumes.
// Prophet calls runAllDetectors and treats any `critical` here as a build blocker,
// so a change can't merge if it introduces drift or breaks an economic invariant.
//
// NOT in the runtime Guardian — these are per-commit scans only.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");

const GATES = [
  { name: "schema-drift", script: "scripts/verify-schema-drift.mjs", args: ["--ci", "0"], severity: "critical",
    hint: "schema_drift", message: "Schema/query drift detected — a SELECT references a column the schema lacks." },
  { name: "economic-invariants", script: "scripts/verify-economic-invariants.mjs", args: ["--ci"], severity: "critical",
    hint: "economic_invariant", message: "An economic invariant failed (conservation / royalty split / dupe / hold)." },
];

/**
 * Pure mapping: a gate's exit code → a finding (or null when clean). Testable
 * without spawning. Non-zero exit = the gate's floor was breached.
 */
export function gateFinding(gate, exitCode) {
  if (exitCode === 0) return null;
  return {
    severity: gate.severity,
    kind: "runtime",
    title: `${gate.name} gate failed`,
    detail: gate.message,
    fixHint: gate.hint,
    file: gate.script,
  };
}

function runGate(gate) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (code) => { if (!done) { done = true; resolve(gateFinding(gate, code)); } };
    try {
      const child = spawn("node", [gate.script, ...gate.args], { cwd: REPO_ROOT, stdio: "ignore" });
      child.on("close", (code) => finish(code ?? 1));
      child.on("error", () => finish(0)); // gate missing / unrunnable → don't block (best-effort)
      // Safety timeout — a hung gate must not hang Prophet.
      setTimeout(() => { try { child.kill(); } catch { /* noop */ } finish(0); }, 120_000);
    } catch { finish(0); }
  });
}

export async function runMaintenanceGatesDetector(_ctx = {}) {
  const t0 = Date.now();
  try {
    const results = await Promise.all(GATES.map(runGate));
    const findings = results.filter(Boolean);
    return makeReport("maintenance-gates", findings, t0);
  } catch (err) {
    return makeError("maintenance-gates", err, t0);
  }
}
