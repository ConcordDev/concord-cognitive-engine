// server/tests/gate-aura-verify.test.js
//
// P0-19 — the AuraVerify PlayMode-log gate lock-in.
//
// §2.4 makes "no new `[AuraVerify] … FAIL` in the PlayMode log" a
// merge gate. scripts/gate-aura-verify.mjs is the mechanism; this
// suite pins its contract against synthetic logs:
//   * a clean log passes;
//   * a FAIL line that is not in the baseline fails the gate and
//     is named in the report;
//   * a FAIL line recorded in the baseline passes;
//   * duplicates of one new line are reported once;
//   * an unreadable log exits 2 — a gate that cannot read its log
//     must never pass silently;
// and pins the wiring: unity-ci.yml runs the gate on the PlayMode
// log, after the PlayMode step and before the builds, and the
// desktop build step is advisory (continue-on-error) per the
// §2.4 gate list in docs/concordia/CI_GATES.md.
// Reference: CONCORDIA_PLAN.md §2.4; docs/concordia/CI_GATES.md.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = import.meta.dirname;
const REPO_ROOT = join(HERE, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "gate-aura-verify.mjs");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "unity-ci.yml");

const FAIL_A = "[AuraVerify] B-04 settings tabs FAIL: tab strip missing";
const FAIL_B = "[AuraVerify] B-09 staged connect FAIL: connected=False";

function runGate(logText, baselineText) {
  const dir = mkdtempSync(join(tmpdir(), "aura-gate-"));
  const log = join(dir, "playmode.log");
  const baseline = join(dir, "baseline.txt");
  if (logText !== null) writeFileSync(log, logText);
  if (baselineText !== null) writeFileSync(baseline, baselineText);
  return spawnSync("node", [SCRIPT, log, baseline], { encoding: "utf8" });
}

test("a clean PlayMode log passes the gate", () => {
  const r = runGate("boot ok\n[AuraVerify] B-01 PASS\nall proofs green\n", "");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"ok":true/);
});

test("a new FAIL line fails the gate and is named", () => {
  const r = runGate(`boot ok\n${FAIL_A}\n`, "");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /new_aura_verify_failures/);
  assert.match(r.stderr, /B-04 settings tabs/);
});

test("a FAIL line recorded in the baseline passes", () => {
  const r = runGate(`${FAIL_A}\n`, `# known\n${FAIL_A}\n`);
  assert.equal(r.status, 0, r.stderr);
});

test("one new line among known ones still fails; duplicates report once", () => {
  const r = runGate(`${FAIL_A}\n${FAIL_B}\n${FAIL_B}\n`, `${FAIL_A}\n`);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stderr.trim());
  assert.equal(parsed.count, 1);
  assert.deepEqual(parsed.lines, [FAIL_B]);
});

test("an unreadable log exits 2, never a silent pass", () => {
  const r = runGate(null, "");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /playmode_log_not_found/);
});

test("the shipped baseline exists and carries no entries", () => {
  const shipped = readFileSync(
    join(
      REPO_ROOT,
      "apps",
      "concordia-living-world",
      "unity-client",
      "aura-verify-baseline.txt",
    ),
    "utf8",
  );
  const entries = shipped
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(entries, [], "the baseline must ship empty — every FAIL is new until recorded");
});

test("unity-ci.yml wires the gate after PlayMode and before the builds; desktop is advisory", () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  const play = yml.indexOf("-testPlatform PlayMode");
  const gate = yml.indexOf("gate-aura-verify.mjs");
  const build = yml.indexOf("Concordia.Editor.ConcordiaWebExport.Export");
  assert.ok(play >= 0 && gate > play, "the gate runs on the PlayMode log after the PlayMode step");
  assert.ok(gate < build, "the gate runs before the builds");
  const steps = yml.split(/^\s*- name:/m).slice(1);
  const desktop = steps.find((s) => s.startsWith(" Build desktop"));
  assert.ok(desktop, "desktop build step not found");
  assert.match(desktop, /continue-on-error: true/, "the desktop build is advisory (§2.4) — it must not block the job");
});
