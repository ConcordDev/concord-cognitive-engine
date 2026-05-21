// Contract tests for the dx-platform lens — feature-parity backlog vs
// Sourcegraph Cody / GitHub Copilot platform. Covers the seven buildable
// items in docs/lens-specs/dx-platform.md.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDxPlatformActions from "../domains/dx-platform.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`dx-platform.${name}`);
  assert.ok(fn, `dx-platform.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDxPlatformActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const noAuth = {};

function indexSample(ctx, codebaseId = "cb1") {
  return call("indexCodebase", ctx, {
    codebaseId,
    name: "sample-repo",
    files: [
      { path: "src/auth.js", content: "const apiKey = 'secret_abcdefghij';\nfunction login() {\n  console.log('debug');\n}\n// TODO refactor this\n" },
      { path: "src/util.js", content: "var x = 1;\nif (x == 2) { fetch('http://example.com/api'); }\n" },
    ],
  });
}

describe("dx-platform.indexCodebase + listCodebases (chat-with-codebase index)", () => {
  it("indexes user-supplied files and reports counts", () => {
    const r = indexSample(ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.fileCount, 2);
    assert.ok(r.result.totalLines > 0);
    assert.ok(r.result.totalBytes > 0);
  });
  it("rejects empty file lists and unauthenticated callers", () => {
    assert.equal(call("indexCodebase", ctxA, { files: [] }).ok, false);
    assert.equal(call("indexCodebase", noAuth, { files: [{ path: "a", content: "b" }] }).ok, false);
  });
  it("lists codebases per user only", () => {
    indexSample(ctxA);
    assert.equal(call("listCodebases", ctxA, {}).result.count, 1);
    assert.equal(call("listCodebases", ctxB, {}).result.count, 0);
  });
});

describe("dx-platform.chatWithCodebase", () => {
  it("answers grounded in indexed file content with citations", () => {
    indexSample(ctxA);
    const r = call("chatWithCodebase", ctxA, { codebaseId: "cb1", question: "where is login defined?" });
    assert.equal(r.ok, true);
    assert.equal(r.result.grounded, true);
    assert.ok(r.result.citations.length > 0);
    assert.ok(r.result.citations.some((c) => c.path === "src/auth.js"));
  });
  it("returns not-grounded for terms absent from the codebase", () => {
    indexSample(ctxA);
    const r = call("chatWithCodebase", ctxA, { codebaseId: "cb1", question: "kubernetes helm chart" });
    assert.equal(r.result.grounded, false);
    assert.equal(r.result.citations.length, 0);
  });
  it("rejects missing question or unknown codebase", () => {
    indexSample(ctxA);
    assert.equal(call("chatWithCodebase", ctxA, { codebaseId: "cb1" }).ok, false);
    assert.equal(call("chatWithCodebase", ctxA, { codebaseId: "nope", question: "x" }).ok, false);
  });
});

describe("dx-platform.reviewDiff (PR/diff review)", () => {
  it("runs detectors over added lines of a unified diff", () => {
    const diff = [
      "--- a/src/new.js",
      "+++ b/src/new.js",
      "@@ -1,2 +1,3 @@",
      " const ok = 1;",
      "+const apiKey = 'secret_loremipsum';",
      "+console.log('hi');",
      "-const removed = 0;",
    ].join("\n");
    const r = call("reviewDiff", ctxA, { diff });
    assert.equal(r.ok, true);
    assert.equal(r.result.linesAdded, 2);
    assert.equal(r.result.linesRemoved, 1);
    assert.ok(r.result.findingCount >= 2);
    assert.equal(r.result.verdict, "changes_requested");
  });
  it("returns clean verdict for a benign diff", () => {
    const diff = "--- a/x.js\n+++ b/x.js\n@@ -1 +1,2 @@\n const a = 1;\n+const b = 2;\n";
    assert.equal(call("reviewDiff", ctxA, { diff }).result.verdict, "clean");
  });
  it("rejects an empty diff", () => {
    assert.equal(call("reviewDiff", ctxA, { diff: "" }).ok, false);
  });
});

describe("dx-platform.createTeam + joinTeam + teamDashboard", () => {
  it("aggregates findings across a team's codebases", () => {
    indexSample(ctxA, "cb1");
    const t = call("createTeam", ctxA, { name: "Platform team" });
    assert.equal(t.ok, true);
    call("joinTeam", ctxA, { teamId: t.result.teamId, codebaseId: "cb1" });
    const dash = call("teamDashboard", ctxA, { teamId: t.result.teamId });
    assert.equal(dash.ok, true);
    assert.equal(dash.result.codebaseCount, 1);
    assert.ok(dash.result.totalFindings > 0);
    assert.ok(dash.result.topDetectors.length > 0);
    assert.ok(dash.result.perCodebase[0].riskScore > 0);
  });
  it("rejects non-members and unknown teams", () => {
    const t = call("createTeam", ctxA, { name: "T" });
    assert.equal(call("teamDashboard", ctxB, { teamId: t.result.teamId }).ok, false);
    assert.equal(call("teamDashboard", ctxA, { teamId: "nope" }).ok, false);
    assert.equal(call("createTeam", ctxA, { name: "" }).ok, false);
  });
});

describe("dx-platform.searchCodebase", () => {
  it("finds literal matches across indexed files", () => {
    indexSample(ctxA);
    const r = call("searchCodebase", ctxA, { codebaseId: "cb1", query: "fetch" });
    assert.equal(r.ok, true);
    assert.ok(r.result.matchCount >= 1);
    assert.ok(r.result.results.some((x) => x.path === "src/util.js"));
  });
  it("supports regex search and rejects invalid patterns", () => {
    indexSample(ctxA);
    assert.ok(call("searchCodebase", ctxA, { codebaseId: "cb1", query: "console\\.\\w+", regex: true }).result.matchCount >= 1);
    assert.equal(call("searchCodebase", ctxA, { codebaseId: "cb1", query: "[", regex: true }).ok, false);
  });
  it("rejects missing query or unknown codebase", () => {
    assert.equal(call("searchCodebase", ctxA, { codebaseId: "nope", query: "x" }).ok, false);
  });
});

describe("dx-platform.getDetectorConfig + setDetectorConfig", () => {
  it("returns the detector grid with default-enabled state", () => {
    const r = call("getDetectorConfig", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.totalCount >= 10);
    assert.ok(r.result.enabledCount > 0);
  });
  it("persists a per-codebase enable/disable set", () => {
    indexSample(ctxA);
    const set = call("setDetectorConfig", ctxA, { codebaseId: "cb1", enabledIds: ["secret_leak", "eval_use"] });
    assert.equal(set.ok, true);
    assert.equal(set.result.enabledCount, 2);
    const cfg = call("getDetectorConfig", ctxA, { codebaseId: "cb1" });
    assert.equal(cfg.result.detectors.find((d) => d.id === "secret_leak").enabled, true);
    assert.equal(cfg.result.detectors.find((d) => d.id === "todo_marker").enabled, false);
  });
  it("rejects unknown codebase and missing ids", () => {
    assert.equal(call("setDetectorConfig", ctxA, { codebaseId: "nope", enabledIds: [] }).ok, false);
  });
});

describe("dx-platform.usageAnalytics (recordDetectorFire + recordFixOutcome)", () => {
  it("reports fire counts and fix-acceptance rate", () => {
    call("recordDetectorFire", ctxA, { detectorId: "secret_leak", count: 3 });
    call("recordDetectorFire", ctxA, { detectorId: "todo_marker", count: 1 });
    call("recordFixOutcome", ctxA, { detectorId: "secret_leak", decision: "accepted" });
    call("recordFixOutcome", ctxA, { detectorId: "secret_leak", decision: "accepted" });
    call("recordFixOutcome", ctxA, { detectorId: "todo_marker", decision: "rejected" });
    const r = call("usageAnalytics", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFires, 4);
    assert.equal(r.result.accepted, 2);
    assert.equal(r.result.acceptanceRate, 0.6667);
    assert.equal(r.result.topFiring[0].detectorId, "secret_leak");
    assert.ok(r.result.acceptanceTrend.length >= 1);
  });
  it("rejects unknown detectors and invalid decisions", () => {
    assert.equal(call("recordDetectorFire", ctxA, { detectorId: "nope" }).ok, false);
    assert.equal(call("recordFixOutcome", ctxA, { detectorId: "secret_leak", decision: "maybe" }).ok, false);
  });
});

describe("dx-platform.generateCiConfig + ciGateCheck", () => {
  it("emits a GitHub Action workflow for a codebase", () => {
    indexSample(ctxA);
    const r = call("generateCiConfig", ctxA, { codebaseId: "cb1", failOn: "warning" });
    assert.equal(r.ok, true);
    assert.equal(r.result.path, ".github/workflows/concord-dx.yml");
    assert.ok(r.result.workflowYaml.includes("concord-os/dx-action@v1"));
    assert.equal(r.result.minSeverity, 3);
  });
  it("rejects unknown codebase", () => {
    assert.equal(call("generateCiConfig", ctxA, { codebaseId: "nope" }).ok, false);
  });
  it("turns findings into a pre-merge gate verdict", () => {
    const fail = call("ciGateCheck", ctxA, { findings: [{ severity: 5 }, { severity: 1 }], failOn: "error" });
    assert.equal(fail.result.passed, false);
    assert.equal(fail.result.verdict, "fail");
    const pass = call("ciGateCheck", ctxA, { findings: [{ severity: 1 }, { severity: 2 }], failOn: "error" });
    assert.equal(pass.result.passed, true);
    assert.equal(pass.result.verdict, "pass");
  });
});
