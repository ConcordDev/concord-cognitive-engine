// @sync-fs-ok: detector runs in CI/audit context, never the server runtime. Sync fs in this file is intentional and not on the user request path (audited 2026-06).
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
import fs from "node:fs";
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
    id: `${gate.name}-gate-failed`,
    severity: gate.severity,
    kind: "runtime",
    // Canonical Finding shape is { id, severity, kind, message, location } —
    // the run-detectors renderer reads f.id / f.message / f.location. The prior
    // { title, detail, file } shape rendered as `undefined — undefined`, hiding
    // which gate actually failed behind a malformed critical.
    message: `${gate.name} gate failed — ${gate.message}`,
    location: gate.script,
    fixHint: gate.hint,
  };
}

/** A gate whose script is missing or can't run is itself a finding — a
 *  security/quality gate that silently can't execute is WORSE than a failing
 *  one, because it reads as a pass. Pre-fix this returned 0 (clean) on a
 *  missing script, so renaming a verify-*.mjs file would have quietly disarmed
 *  the gate. */
function unrunnableFinding(gate, why) {
  return {
    id: `${gate.name}-gate-unrunnable`,
    severity: "high",
    kind: "runtime",
    message: `${gate.name} gate could not run: ${why} — the gate is disarmed, not passing.`,
    location: gate.script,
    fixHint: "restore_or_fix_gate_script",
  };
}

function runGate(gate) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };

    // Pre-flight: a missing script is a disarmed gate, not a pass.
    const abs = path.resolve(REPO_ROOT, gate.script);
    if (!fs.existsSync(abs)) {
      finish(unrunnableFinding(gate, "gate script not found"));
      return;
    }
    try {
      const child = spawn("node", [gate.script, ...gate.args], { cwd: REPO_ROOT, stdio: "ignore" });
      child.on("close", (code) => finish(gateFinding(gate, code ?? 1)));
      // A spawn error (node missing, EACCES, …) means the gate didn't actually
      // run — surface it instead of swallowing it as a pass.
      child.on("error", () => finish(unrunnableFinding(gate, "gate process failed to start")));
      // Safety timeout — a hung gate must not hang Prophet; a timeout is also a
      // non-pass (we don't know its verdict), so flag it rather than clear it.
      setTimeout(() => {
        try { child.kill(); } catch { /* noop */ }
        finish(unrunnableFinding(gate, "gate timed out after 120s"));
      }, 120_000);
    } catch {
      finish(unrunnableFinding(gate, "gate could not be spawned"));
    }
  });
}

export async function runMaintenanceGatesDetector(_ctx = {}) {
  const t0 = Date.now();
  try {
    const results = await Promise.all(GATES.map(runGate));
    const findings = results.filter(Boolean);
    return makeReport("maintenance-gates", findings, t0);
  } catch (err) {
    return makeError("maintenance-gates", "detector_error", err, t0);
  }
}
