// tests/workflow-gate-integrity-detector.test.js
//
// Proves the workflow-gate-integrity detector fires on the exact bug class
// this session found in `.github/workflows/deploy.yml` (a gate job — the
// depth-test suite — that ran ONLY on push-to-main, never on a
// pull_request, so a regression reached main invisibly), plus the sibling
// checks (continue-on-error without exemption, missing NODE_ENV=test on a
// test step, curl output captured but never asserted) — and that it does
// NOT fire on the safe counterparts of each.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runWorkflowGateIntegrityDetector,
  buildYamlishTree,
  extractTriggers,
  getStepGroups,
} from "../lib/detectors/workflow-gate-integrity-detector.js";

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wfgate-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}
const byId = (r, id) => r.findings.filter((f) => f.id === id);

describe("workflow-gate-integrity detector — pure helpers", () => {
  it("extractTriggers reads block-mapping, scalar, and flow-array forms", () => {
    const block = buildYamlishTree("on:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n");
    assert.deepEqual([...extractTriggers(block)].sort(), ["pull_request", "push"]);

    const scalar = buildYamlishTree("on: push\n");
    assert.deepEqual([...extractTriggers(scalar)], ["push"]);

    const flow = buildYamlishTree("on: [push, pull_request]\n");
    assert.deepEqual([...extractTriggers(flow)].sort(), ["pull_request", "push"]);
  });

  it("getStepGroups recovers one group per step with correctly-grouped sibling keys", () => {
    const tree = buildYamlishTree([
      "jobs:",
      "  gate:",
      "    steps:",
      "      - name: One",
      "        run: echo one",
      "      - name: Two",
      "        env:",
      "          NODE_ENV: test",
      "        run: npm test",
    ].join("\n"));
    const jobNode = tree.children.find((c) => c.key === "jobs").children.find((c) => c.key === "gate");
    const groups = getStepGroups(jobNode);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].get("name").value, "One");
    assert.equal(groups[0].get("run").value, "echo one");
    assert.equal(groups[1].get("name").value, "Two");
    assert.equal(groups[1].get("env").children.find((c) => c.key === "NODE_ENV").value, "test");
  });
});

describe("workflow-gate-integrity detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("never throws on an empty/minimal repo — 0 findings beyond the summary", async () => {
    dir = await tmpRepo({ "README.md": "hi" });
    const r = await runWorkflowGateIntegrityDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(r.findings.length, 1, "only the info summary");
    assert.equal(r.findings[0].id, "workflow_gate_integrity_summary");

    // minimal but real workflow, no jobs at all
    const dir2 = await tmpRepo({
      ".github/workflows/noop.yml": "name: Noop\non:\n  push:\n    branches: [main]\n",
    });
    const r2 = await runWorkflowGateIntegrityDetector({ root: dir2 });
    assert.equal(r2.ok, true);
    assert.equal(byId(r2, "workflow_gate_not_visible_on_pr").length, 0, "no test steps → no gate-visibility finding");
    await rm(dir2, { recursive: true, force: true });
  });

  it("FIRES (high) on the deploy.yml shape: push-only trigger + a test step, no pull_request", async () => {
    dir = await tmpRepo({
      ".github/workflows/deploy.yml": [
        "name: Deploy",
        "on:",
        "  push:",
        "    branches: [main]",
        "  workflow_dispatch:",
        "jobs:",
        "  gate:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v6",
        "      - name: Depth behavioral tests",
        "        working-directory: ./server",
        "        run: npm run test:depth:ci",
      ].join("\n"),
    });
    const r = await runWorkflowGateIntegrityDetector({ root: dir });
    assert.equal(r.ok, true);
    const hits = byId(r, "workflow_gate_not_visible_on_pr");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "high");
    assert.match(hits[0].location, /deploy\.yml/);
  });

  it("does NOT flag gate-visibility when pull_request is in the trigger list", async () => {
    dir = await tmpRepo({
      ".github/workflows/ci.yml": [
        "name: CI",
        "on:",
        "  push:",
        "    branches: [main]",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run tests",
        "        run: npm test",
      ].join("\n"),
    });
    const r = await runWorkflowGateIntegrityDetector({ root: dir });
    assert.equal(byId(r, "workflow_gate_not_visible_on_pr").length, 0);
  });

  it("FIRES (medium) on a test step with no reachable NODE_ENV=test", async () => {
    dir = await tmpRepo({
      ".github/workflows/ci.yml": [
        "name: CI",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run tests",
        "        run: node --test tests/depth/*.test.js",
      ].join("\n"),
    });
    const r = await runWorkflowGateIntegrityDetector({ root: dir });
    const hits = byId(r, "workflow_test_step_missing_node_env");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].severity, "medium");
  });

  it("does NOT flag missing-NODE_ENV when it's set at the job env level", async () => {
    dir = await tmpRepo({
      ".github/workflows/ci.yml": [
        "name: CI",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    env:",
        "      NODE_ENV: test",
        "    steps:",
        "      - name: Run tests",
        "        run: node --test tests/depth/*.test.js",
      ].join("\n"),
    });
    const r = await runWorkflowGateIntegrityDetector({ root: dir });
    assert.equal(byId(r, "workflow_test_step_missing_node_env").length, 0);
  });

  it("does NOT flag missing-NODE_ENV when it's inline in the run script", async () => {
    dir = await tmpRepo({
      ".github/workflows/ci.yml": [
        "name: CI",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Run tests",
        "        run: NODE_ENV=test node --test tests/depth/*.test.js",
      ].join("\n"),
    });
    const r = await runWorkflowGateIntegrityDetector({ root: dir });
    assert.equal(byId(r, "workflow_test_step_missing_node_env").length, 0);
  });

  it("FIRES (medium) on unexempted continue-on-error, and stops after a matching manifest entry", async () => {
    const workflow = [
      "name: CI",
      "on:",
      "  pull_request:",
      "    branches: [main]",
      "jobs:",
      "  notify:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Best-effort Slack ping",
      "        continue-on-error: true",
      "        run: curl -X POST https://example.invalid",
    ].join("\n");
    dir = await tmpRepo({ ".github/workflows/ci.yml": workflow });
    const r = await runWorkflowGateIntegrityDetector({ root: dir });
    assert.equal(byId(r, "workflow_continue_on_error_unexempted").length, 1);

    const dir2 = await tmpRepo({
      ".github/workflows/ci.yml": workflow,
      "audit/detectors/gate-monitors.json": JSON.stringify([
        { workflow: ".github/workflows/ci.yml", job_or_step: "notify:Best-effort Slack ping", reason: "non-blocking notification", owner_ack_date: "2026-07-05" },
      ]),
    });
    const r2 = await runWorkflowGateIntegrityDetector({ root: dir2 });
    assert.equal(byId(r2, "workflow_continue_on_error_unexempted").length, 0, "exempted pair must stop flagging");
    await rm(dir2, { recursive: true, force: true });
  });

  it("FIRES (low) on a curl capture never used in a later conditional", async () => {
    dir = await tmpRepo({
      ".github/workflows/deploy.yml": [
        "name: Deploy",
        "on:",
        "  pull_request:",
        "jobs:",
        "  health:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Smoke",
        "        run: |",
        "          READY=$(curl -sf http://localhost:5050/ready 2>/dev/null || echo \"FAIL\")",
        "          echo \"Readiness check: $READY\"",
      ].join("\n"),
    });
    const r = await runWorkflowGateIntegrityDetector({ root: dir });
    const hits = byId(r, "workflow_curl_captured_not_asserted");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].evidence.varName, "READY");
  });

  it("does NOT flag a curl capture that IS used in a later conditional", async () => {
    dir = await tmpRepo({
      ".github/workflows/deploy.yml": [
        "name: Deploy",
        "on:",
        "  pull_request:",
        "jobs:",
        "  health:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Smoke",
        "        run: |",
        "          HEALTH=$(curl -sf http://localhost:5050/health 2>/dev/null || echo \"FAIL\")",
        "          echo \"Health check: $HEALTH\"",
        "          if echo \"$HEALTH\" | grep -qi \"fail\"; then",
        "            exit 1",
        "          fi",
      ].join("\n"),
    });
    const r = await runWorkflowGateIntegrityDetector({ root: dir });
    assert.equal(byId(r, "workflow_curl_captured_not_asserted").length, 0);
  });

  it("treats a malformed gate-monitors.json as zero exemptions, not a crash", async () => {
    dir = await tmpRepo({
      ".github/workflows/ci.yml": [
        "name: CI",
        "on:",
        "  pull_request:",
        "jobs:",
        "  notify:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Best-effort",
        "        continue-on-error: true",
        "        run: echo hi",
      ].join("\n"),
      "audit/detectors/gate-monitors.json": "{ not valid json",
    });
    const r = await runWorkflowGateIntegrityDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(byId(r, "workflow_continue_on_error_unexempted").length, 1);
    assert.equal(byId(r, "workflow_gate_monitors_manifest_malformed").length, 1);
  });
});
