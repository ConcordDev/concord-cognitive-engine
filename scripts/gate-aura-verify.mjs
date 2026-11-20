#!/usr/bin/env node
/**
 * gate-aura-verify.mjs — the P0-19 PlayMode-log gate (plan §2.4).
 *
 * §2.4 makes "no new `[AuraVerify] … FAIL` in the PlayMode log" a
 * merge gate for the Unity client. This script is that gate: it
 * scans a PlayMode log for lines of the shape `[AuraVerify] … FAIL`
 * and fails the run for every such line that is not recorded in
 * the baseline file. A FAIL is "known" only when a human has
 * recorded its exact line in the baseline
 * (apps/concordia-living-world/unity-client/aura-verify-baseline.txt)
 * with the reason in docs/concordia/CI_GATES.md — the baseline
 * ships empty, so until then every FAIL is new.
 *
 * The [AuraVerify] tag is emitted by the Aura verify tooling
 * (slice L3, P0-11); until those lines exist in a log this gate
 * passes trivially, which is the correct reading of "no new FAIL".
 *
 *   node scripts/gate-aura-verify.mjs <playmode-log> [baseline-file]
 *
 * Exit codes: 0 = no new FAIL lines · 1 = new FAIL lines (listed
 * on stderr as JSON) · 2 = the log could not be read (a gate that
 * cannot read its log must never pass silently).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASELINE = path.join(
  REPO_ROOT,
  "apps",
  "concordia-living-world",
  "unity-client",
  "aura-verify-baseline.txt",
);
const FAIL_LINE = /\[AuraVerify\].*\bFAIL\b/;

function report(obj) {
  process.stderr.write(JSON.stringify({ gate: "aura-verify", ...obj }) + "\n");
}

const logPath = process.argv[2];
if (!logPath) {
  report({ ok: false, reason: "missing_argument:playmode_log_path" });
  process.exit(2);
}
if (!fs.existsSync(logPath)) {
  report({ ok: false, reason: "playmode_log_not_found", logPath });
  process.exit(2);
}

const baselinePath = process.argv[3] || DEFAULT_BASELINE;
const baseline = new Set();
if (fs.existsSync(baselinePath)) {
  for (const raw of fs.readFileSync(baselinePath, "utf8").split("\n")) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) baseline.add(line);
  }
}

const seen = new Set();
const newFails = [];
for (const raw of fs.readFileSync(logPath, "utf8").split("\n")) {
  const line = raw.trim();
  if (!FAIL_LINE.test(line)) continue;
  if (baseline.has(line) || seen.has(line)) continue;
  seen.add(line);
  newFails.push(line);
}

if (newFails.length > 0) {
  report({
    ok: false,
    reason: "new_aura_verify_failures",
    count: newFails.length,
    lines: newFails,
    hint: "Fix the failure, or record the exact line in the baseline with a reason in docs/concordia/CI_GATES.md.",
  });
  process.exit(1);
}

process.stdout.write(
  JSON.stringify({
    ok: true,
    gate: "aura-verify",
    knownFailures: baseline.size,
    newFailures: 0,
  }) + "\n",
);
