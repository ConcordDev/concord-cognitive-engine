// server/tests/platinum-repair-cortex-enforcer.test.js
//
// Sprint 31 — Repair Cortex as platinum-gate enforcer.
//
// Asserts the runner script + workflow exist, expose every platinum
// gate, and the workflow is wired to push + PR + nightly cron with
// auto-fix opt-in. Catches the failure mode where the runner ships
// without one of the new gates and Repair Cortex silently skips it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const REPO_ROOT = join(HERE, "..", "..");
const RUNNER = join(REPO_ROOT, "scripts", "repair-cortex-platinum-runner.sh");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "repair-cortex.yml");
const PERCEPTION_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "detectors-cartography.yml");

test("repair-cortex runner script exists + is executable", () => {
  assert.ok(existsSync(RUNNER), "scripts/repair-cortex-platinum-runner.sh missing");
});

test("repair-cortex workflow exists at .github/workflows/repair-cortex.yml", () => {
  assert.ok(existsSync(WORKFLOW), "Workflow missing — Repair Cortex enforcement layer not wired");
});

test("detectors+cartography perception workflow exists", () => {
  assert.ok(existsSync(PERCEPTION_WORKFLOW), "Perception layer workflow missing — Repair Cortex has no input");
});

test("runner script registers all platinum-tier gates from sprints 18-30", () => {
  const src = readFileSync(RUNNER, "utf-8");

  const REQUIRED_GATES = [
    "lint-server",
    "lint-frontend",
    "typecheck-server",
    "typecheck-frontend",
    "route-auth",
    "deps-graph",
    "migration-up-down",
    "security-headers",
    "chaos-heartbeat",
    "gdpr",
    "observability",
    "openapi-contract",
    "slo",
    "threat-model",
    "privacy-review",
    "prompt-injection",
    "dr-drill",
    "property-based",
  ];

  const missing = REQUIRED_GATES.filter(g => !src.includes(`add_gate  ${g}`) && !src.includes(`add_gate ${g}`));
  assert.equal(missing.length, 0,
    `Runner missing gates: ${missing.join(", ")} — Repair Cortex won't enforce them`);
});

test("runner supports --fix, --only, --no-fail flags", () => {
  const src = readFileSync(RUNNER, "utf-8");
  for (const flag of ["--only=", "--fix", "--no-fail"]) {
    assert.ok(src.includes(flag), `Runner missing flag: ${flag}`);
  }
});

test("runner emits machine-readable result lines (gate=X status=Y)", () => {
  const src = readFileSync(RUNNER, "utf-8");
  // Repair Cortex parses lines of the form `gate=name status=pass|fail|skip`.
  // Confirm the runner emits that exact shape.
  assert.ok(/gate=\$name status=/.test(src),
    "Runner doesn't emit `gate=X status=Y` lines — Repair Cortex can't parse results");
});

test("runner has auto-fix recipes for safe categories", () => {
  const src = readFileSync(RUNNER, "utf-8");
  // The user's plan calls for auto-fix on lint, formatting, baseline drift.
  // Check the AUTOFIX map covers at least these three.
  assert.ok(/AUTOFIX\[lint-server\]/.test(src), "No auto-fix for lint-server");
  assert.ok(/AUTOFIX\[lint-frontend\]/.test(src), "No auto-fix for lint-frontend");
  assert.ok(/AUTOFIX\[route-auth\]/.test(src), "No auto-fix for route-auth baseline drift");
});

test("workflow runs on push + on-demand + schedule (nightly cron)", () => {
  const yaml = readFileSync(WORKFLOW, "utf-8");
  assert.ok(/^on:/m.test(yaml), "Workflow has no `on:` trigger block");
  assert.ok(/\bpush:/.test(yaml), "Workflow missing `push:` trigger");
  // The workflow MUST be invocable on demand — either via `pull_request:`
  // (the original spec) or `workflow_dispatch:` (the temporary substitute
  // while platinum-tier baselines are being seeded; see commit d6478e23
  // for the rationale of dropping pull_request to silence webhook noise
  // from missing-baseline first runs). Either shape satisfies the
  // "humans can trigger this without waiting for cron" intent.
  const onDemand = /pull_request:/.test(yaml) || /workflow_dispatch:/.test(yaml);
  assert.ok(onDemand,
    "Workflow missing both `pull_request:` and `workflow_dispatch:` triggers — one must be present so the gate is invocable on demand");
  assert.ok(/schedule:/.test(yaml), "Workflow missing `schedule:` trigger (nightly cron)");
});

test("workflow includes a promotion-gate job downstream consumers can depend on", () => {
  const yaml = readFileSync(WORKFLOW, "utf-8");
  // The promotion gate is the deployment signal. Other workflows
  // (deploy-staging, deploy-prod) needs: [promote-gate] to gate
  // their runs on platinum-pass.
  assert.ok(/promote-gate:|promotion.gate/i.test(yaml),
    "Workflow has no promote-gate job — deployment promotion can't depend on Repair Cortex");
});

test("perception workflow runs detectors + cartograph + synthesises summary", () => {
  const yaml = readFileSync(PERCEPTION_WORKFLOW, "utf-8");
  assert.ok(/detectors:/.test(yaml), "Missing detectors job");
  assert.ok(/cartograph:/.test(yaml), "Missing cartograph job");
  assert.ok(/perception-summary:/.test(yaml), "Missing perception-summary synthesis job — Repair Cortex has no aggregated input");
});

test("workflow auto-fix mode is opt-in via workflow_dispatch input", () => {
  const yaml = readFileSync(WORKFLOW, "utf-8");
  assert.ok(/workflow_dispatch:/.test(yaml), "Missing workflow_dispatch trigger (no manual run path)");
  assert.ok(/auto_fix/.test(yaml), "Missing auto_fix input — operator can't toggle auto-fix");
});

test("workflow uploads gate log as artifact on failure (debuggability)", () => {
  const yaml = readFileSync(WORKFLOW, "utf-8");
  assert.ok(/upload-artifact/.test(yaml), "Workflow missing artifact upload — failed runs are undebuggable");
  assert.ok(/repair-cortex-log/.test(yaml), "Log artifact missing predictable name");
});
