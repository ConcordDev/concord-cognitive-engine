#!/usr/bin/env node
/**
 * Audit Concord Hermes cron gate scripts — dry-run each gate command.
 * Usage: node scripts/audit-hermes-crons.mjs [--resume]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const resume = process.argv.includes("--resume");

const GATES = [
  { name: "concord-doc-drift", script: "concord-doc-drift.sh", critical: true },
  { name: "concord-detectors", script: "concord-detectors.sh", critical: true },
  { name: "concord-depth-floor", script: "concord-depth-floor.sh", critical: true },
  { name: "concord-ux-polish", script: "concord-ux-polish.sh", critical: true },
  { name: "concord-lens-wiring", script: "concord-lens-wiring.sh", critical: true },
  { name: "concord-schema-drift", script: "concord-schema-drift.sh", critical: true },
  { name: "concord-health-pulse", script: "concord-health-pulse.sh", critical: false },
];

function runGate(gate) {
  const sh = join(REPO, "scripts/hermes-cron", gate.script);
  if (!existsSync(sh)) return { name: gate.name, ok: false, reason: "missing_script" };
  const r = spawnSync("bash", [sh], { cwd: REPO, encoding: "utf8", timeout: 300_000 });
  return {
    name: gate.name,
    ok: r.status === 0,
    exit: r.status,
    tail: (r.stdout || r.stderr || "").slice(-500),
    critical: gate.critical,
  };
}

function loadHermesJobs() {
  const p = join(process.env.HOME || "", ".hermes/cron/jobs.json");
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")).jobs || [];
  } catch {
    return [];
  }
}

function resumeGate(name) {
  const r = spawnSync("hermes", ["cron", "resume", name], { encoding: "utf8" });
  return { name, ok: r.status === 0, out: (r.stdout || r.stderr || "").trim() };
}

const results = GATES.map(runGate);
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log(`Hermes cron gate audit: ${passed}/${results.length} passed`);
for (const r of results) {
  console.log(`  ${r.ok ? "OK" : "FAIL"} ${r.name}${r.exit != null ? ` (exit ${r.exit})` : ""}`);
  if (!r.ok && r.tail) console.log(`    ${r.tail.split("\n").slice(-3).join("\n    ")}`);
}

if (resume) {
  const jobs = loadHermesJobs();
  const toResume = [];
  for (const gate of GATES) {
    const job = jobs.find((j) => j.name === gate.name);
    if (!job) continue;
    const gateResult = results.find((r) => r.name === gate.name);
    if (gateResult?.ok && (job.state === "paused" || !job.enabled)) {
      toResume.push(gate.name);
    }
  }
  if (toResume.length) {
    console.log(`\nResuming ${toResume.length} audited gates...`);
    for (const name of toResume) {
      const r = resumeGate(name);
      console.log(`  ${r.ok ? "resumed" : "resume-failed"} ${name}`);
    }
  } else {
    console.log("\nNo paused gates to resume (or audits failed).");
  }
}

process.exit(failed.some((f) => f.critical) ? 1 : 0);
