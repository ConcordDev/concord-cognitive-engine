// Behavioral macro tests for server/domains/dx-platform.js — the DX-platform
// feature-parity backlog (chat-with-codebase, PR/diff review, team dashboard,
// codebase-wide search, detector config, usage analytics, CI integration).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// through the canonical `register` shim against the REAL in-memory
// globalThis._concordSTATE.dxPlatformLens store the domain uses for persistence.
// These are NOT shape-only assertions: every test asserts ACTUAL values +
// multi-step round-trips (index → list → chat with grounded citations; index →
// review a diff that trips real detectors; configure detectors → re-review;
// record fires/outcomes → analytics acceptance-rate math; create/join team →
// aggregate dashboard; generate a CI workflow that embeds the config), per-user
// isolation, the auth guard, and the fail-CLOSED numeric guard the
// macro-assassin's V2 vector probes. No server boot, no network, no LLM.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDxPlatformActions from "../domains/dx-platform.js";

const ACTIONS = new Map();
// The domain registers through the canonical `register(domain, name, fn)` shim
// (saved-class fix) — fn has the (ctx, input) signature runMacro drives.
function register(domain, name, fn) {
  assert.equal(domain, "dx-platform", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`dx-platform.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerDxPlatformActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

const SAMPLE_FILES = [
  {
    path: "src/auth.js",
    content: [
      "const apiKey = 'sk-abcdef1234567890';", // secret_leak (S5) + loose? no
      "function login(user) {",
      "  console.log('logging in', user);",     // console_debug (S2)
      "  if (user == null) return false;",      // loose_equality (S1)
      "  return true;",
      "}",
    ].join("\n"),
  },
  {
    path: "src/util.js",
    content: [
      "// TODO: refactor this",                  // todo_marker (S1)
      "export function add(a, b) { return a + b; }",
    ].join("\n"),
  },
];

describe("dx-platform — registration", () => {
  it("registers every macro the DxWorkbench calls", () => {
    for (const m of [
      "indexCodebase", "listCodebases", "chatWithCodebase", "reviewDiff",
      "createTeam", "joinTeam", "teamDashboard", "searchCodebase",
      "getDetectorConfig", "setDetectorConfig", "recordDetectorFire",
      "recordFixOutcome", "usageAnalytics", "generateCiConfig", "ciGateCheck",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing dx-platform.${m}`);
    }
  });
});

describe("dx-platform — index → list → chat round-trip", () => {
  it("indexes files, lists them with real counts, then chats with grounded citations", () => {
    const idx = call("indexCodebase", ctxA, { codebaseId: "cb1", name: "Auth service", files: SAMPLE_FILES });
    assert.equal(idx.ok, true);
    assert.equal(idx.result.codebaseId, "cb1");
    assert.equal(idx.result.name, "Auth service");
    assert.equal(idx.result.fileCount, 2);
    // total lines = 6 (auth.js) + 2 (util.js) = 8
    assert.equal(idx.result.totalLines, 8);
    assert.ok(idx.result.totalBytes > 0);

    const list = call("listCodebases", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.codebases[0].id, "cb1");
    assert.equal(list.result.codebases[0].fileCount, 2);

    // grounded chat — token "login" appears on real lines
    const chat = call("chatWithCodebase", ctxA, { codebaseId: "cb1", question: "where is login defined?" });
    assert.equal(chat.ok, true);
    assert.equal(chat.result.grounded, true);
    assert.ok(chat.result.totalMatches >= 1);
    assert.ok(chat.result.citations.some((c) => c.path === "src/auth.js" && /login/i.test(c.text)));
    // a token nowhere in the codebase is NOT grounded
    const miss = call("chatWithCodebase", ctxA, { codebaseId: "cb1", question: "what about quaternion kinematics" });
    assert.equal(miss.result.grounded, false);
    assert.equal(miss.result.citations.length, 0);
  });

  it("rejects empty / missing-codebase / no-question inputs", () => {
    assert.equal(call("indexCodebase", ctxA, { files: [] }).error, "no_files");
    assert.equal(call("chatWithCodebase", ctxA, { question: "x" }).error, "codebase_not_found");
    assert.equal(call("indexCodebase", ctxA, { files: SAMPLE_FILES }).ok, true); // auto id
    assert.equal(call("chatWithCodebase", ctxA, { codebaseId: "nope", question: "x" }).error, "codebase_not_found");
  });
});

describe("dx-platform — diff review trips real detectors", () => {
  it("parses a unified diff and reports findings + verdict from the added lines only", () => {
    const diff = [
      "--- a/src/x.js",
      "+++ b/src/x.js",
      "@@ -1,2 +1,5 @@",
      " const z = 1;",
      "+const token = 'ghp_aaaaaaaaaaaaaaaa';", // secret_leak S5 (blocking)
      "+console.log(token);",                    // console_debug S2
      "-const old = 2;",                         // removed
      "+// TODO fix later",                      // todo_marker S1
    ].join("\n");
    const r = call("reviewDiff", ctxA, { diff });
    assert.equal(r.ok, true);
    assert.equal(r.result.filesChanged, 1);
    assert.equal(r.result.linesAdded, 3);
    assert.equal(r.result.linesRemoved, 1);
    assert.ok(r.result.findingCount >= 3);
    // the secret leak is a blocking (severity >= 4) finding → changes_requested
    assert.ok(r.result.blockingCount >= 1);
    assert.equal(r.result.verdict, "changes_requested");
    assert.ok(r.result.findings.some((f) => f.detectorId === "secret_leak"));
  });

  it("a clean diff yields a clean verdict", () => {
    const diff = [
      "--- a/src/ok.js",
      "+++ b/src/ok.js",
      "@@ -1 +1,2 @@",
      " const a = 1;",
      "+const b = 2;",
    ].join("\n");
    const r = call("reviewDiff", ctxA, { diff });
    assert.equal(r.result.findingCount, 0);
    assert.equal(r.result.verdict, "clean");
  });

  it("rejects an empty diff", () => {
    assert.equal(call("reviewDiff", ctxA, { diff: "   " }).error, "no_diff");
  });
});

describe("dx-platform — detector config gates the review", () => {
  it("disabling a detector removes its findings from a subsequent diff review", () => {
    call("indexCodebase", ctxA, { codebaseId: "cbcfg", files: SAMPLE_FILES });
    const cfg = call("getDetectorConfig", ctxA, { codebaseId: "cbcfg" });
    assert.equal(cfg.ok, true);
    assert.ok(cfg.result.detectors.find((d) => d.id === "secret_leak").enabled);

    // keep only console_debug enabled
    const set = call("setDetectorConfig", ctxA, { codebaseId: "cbcfg", enabledIds: ["console_debug"] });
    assert.equal(set.ok, true);
    assert.deepEqual(set.result.enabledIds, ["console_debug"]);

    const diff = [
      "--- a/x", "+++ b/x", "@@ -1 +1,3 @@",
      "+const apiKey = 'sk-abcdef1234567890';", // secret_leak — now disabled
      "+console.log('x');",                      // console_debug — enabled
    ].join("\n");
    const r = call("reviewDiff", ctxA, { codebaseId: "cbcfg", diff });
    assert.ok(r.result.findings.every((f) => f.detectorId !== "secret_leak"), "secret_leak suppressed");
    assert.ok(r.result.findings.some((f) => f.detectorId === "console_debug"));
  });

  it("rejects config ops on unknown codebases / missing ids", () => {
    assert.equal(call("getDetectorConfig", ctxA, { codebaseId: "nope" }).error, "codebase_not_found");
    assert.equal(call("setDetectorConfig", ctxA, { codebaseId: "nope", enabledIds: [] }).error, "codebase_not_found");
    call("indexCodebase", ctxA, { codebaseId: "cb_noids", files: SAMPLE_FILES });
    assert.equal(call("setDetectorConfig", ctxA, { codebaseId: "cb_noids" }).error, "no_enabled_ids");
  });
});

describe("dx-platform — codebase-wide search", () => {
  it("literal + regex search return real line hits", () => {
    call("indexCodebase", ctxA, { codebaseId: "cbs", files: SAMPLE_FILES });
    const lit = call("searchCodebase", ctxA, { codebaseId: "cbs", query: "login" });
    assert.equal(lit.ok, true);
    assert.ok(lit.result.matchCount >= 1);
    assert.ok(lit.result.results.every((h) => /login/i.test(h.text)));

    const rx = call("searchCodebase", ctxA, { codebaseId: "cbs", query: "console\\.\\w+", regex: true });
    assert.equal(rx.ok, true);
    assert.ok(rx.result.matchCount >= 1);

    assert.equal(call("searchCodebase", ctxA, { codebaseId: "cbs", query: "(", regex: true }).error, "invalid_regex");
    assert.equal(call("searchCodebase", ctxA, { codebaseId: "nope", query: "x" }).error, "codebase_not_found");
    assert.equal(call("searchCodebase", ctxA, { codebaseId: "cbs", query: "  " }).error, "no_query");
  });
});

describe("dx-platform — team dashboard aggregates live findings", () => {
  it("creates a team, attaches a codebase, and aggregates real risk", () => {
    call("indexCodebase", ctxA, { codebaseId: "cbteam", name: "Risky repo", files: SAMPLE_FILES });
    const team = call("createTeam", ctxA, { name: "Platform team" });
    assert.equal(team.ok, true);
    const teamId = team.result.teamId;

    const join = call("joinTeam", ctxA, { teamId, codebaseId: "cbteam" });
    assert.equal(join.ok, true);

    const dash = call("teamDashboard", ctxA, { teamId });
    assert.equal(dash.ok, true);
    assert.equal(dash.result.codebaseCount, 1);
    assert.equal(dash.result.totalFiles, 2);
    assert.ok(dash.result.totalFindings >= 3);
    // severity totals sum to totalFindings
    const sevSum = Object.values(dash.result.severityTotals).reduce((a, b) => a + b, 0);
    assert.equal(sevSum, dash.result.totalFindings);
    // the highest-risk codebase carries a positive riskScore
    assert.ok(dash.result.perCodebase[0].riskScore > 0);
    assert.ok(dash.result.topDetectors.length >= 1);

    assert.equal(call("teamDashboard", ctxA, { teamId: "nope" }).error, "team_not_found");
    assert.equal(call("teamDashboard", ctxB, { teamId }).error, "not_a_member");
    assert.equal(call("createTeam", ctxA, {}).error, "no_name");
  });
});

describe("dx-platform — usage analytics acceptance-rate math", () => {
  it("records fires + outcomes and computes the real acceptance rate", () => {
    call("recordDetectorFire", ctxA, { detectorId: "console_debug", count: 3 });
    call("recordDetectorFire", ctxA, { detectorId: "todo_marker" });
    call("recordFixOutcome", ctxA, { detectorId: "console_debug", decision: "accepted" });
    call("recordFixOutcome", ctxA, { detectorId: "console_debug", decision: "accepted" });
    call("recordFixOutcome", ctxA, { detectorId: "todo_marker", decision: "rejected" });

    const a = call("usageAnalytics", ctxA, { windowDays: 30 });
    assert.equal(a.ok, true);
    assert.equal(a.result.totalFires, 4); // 3 + 1
    assert.equal(a.result.totalDecisions, 3);
    assert.equal(a.result.accepted, 2);
    assert.equal(a.result.rejected, 1);
    assert.equal(a.result.acceptanceRate, 0.6667);
    assert.equal(a.result.topFiring[0].detectorId, "console_debug");
    assert.ok(a.result.acceptanceTrend.length >= 1);

    assert.equal(call("recordDetectorFire", ctxA, { detectorId: "nope" }).error, "unknown_detector");
    assert.equal(call("recordFixOutcome", ctxA, { detectorId: "console_debug", decision: "maybe" }).error, "invalid_decision");
  });
});

describe("dx-platform — CI integration", () => {
  it("generates a workflow embedding the codebase config, and gate-checks findings", () => {
    call("indexCodebase", ctxA, { codebaseId: "cbci", files: SAMPLE_FILES });
    call("setDetectorConfig", ctxA, { codebaseId: "cbci", enabledIds: ["secret_leak", "eval_use"] });
    const ci = call("generateCiConfig", ctxA, { codebaseId: "cbci", failOn: "warning" });
    assert.equal(ci.ok, true);
    assert.equal(ci.result.failOn, "warning");
    assert.equal(ci.result.minSeverity, 3);
    assert.match(ci.result.workflowYaml, /codebase-id: cbci/);
    assert.match(ci.result.workflowYaml, /detectors: secret_leak,eval_use/);
    assert.equal(ci.result.path, ".github/workflows/concord-dx.yml");

    assert.equal(call("generateCiConfig", ctxA, {}).error, "no_codebase_id");
    assert.equal(call("generateCiConfig", ctxA, { codebaseId: "nope" }).error, "codebase_not_found");

    // ciGateCheck — error threshold blocks on S4+, passes on lower
    const fail = call("ciGateCheck", ctxA, { findings: [{ severity: 5 }, { severity: 2 }], failOn: "error" });
    assert.equal(fail.result.passed, false);
    assert.equal(fail.result.blockingFindings, 1);
    const pass = call("ciGateCheck", ctxA, { findings: [{ severity: 2 }, { severity: 1 }], failOn: "error" });
    assert.equal(pass.result.passed, true);
    assert.equal(pass.result.verdict, "pass");
  });
});

describe("dx-platform — per-user isolation + auth guard", () => {
  it("never leaks one user's codebases to another", () => {
    call("indexCodebase", ctxA, { codebaseId: "a-only", files: SAMPLE_FILES });
    assert.equal(call("listCodebases", ctxA, {}).result.count, 1);
    assert.equal(call("listCodebases", ctxB, {}).result.count, 0);
    assert.equal(call("chatWithCodebase", ctxB, { codebaseId: "a-only", question: "x" }).error, "codebase_not_found");
  });

  it("rejects anonymous callers on every macro", () => {
    const anon = {};
    for (const m of [
      "indexCodebase", "listCodebases", "chatWithCodebase", "reviewDiff",
      "createTeam", "joinTeam", "teamDashboard", "searchCodebase",
      "getDetectorConfig", "setDetectorConfig", "recordDetectorFire",
      "recordFixOutcome", "usageAnalytics", "generateCiConfig", "ciGateCheck",
    ]) {
      assert.equal(call(m, anon, {}).error, "auth_required", `dx-platform.${m} leaked to anon`);
    }
  });
});

describe("dx-platform — fail-CLOSED numeric guard (assassin V2)", () => {
  it("rejects poisoned windowDays / count instead of clamping to ok:true", () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const r1 = call("usageAnalytics", ctxA, { windowDays: bad });
      assert.equal(r1.ok, false, `windowDays=${bad} should fail-closed`);
      assert.equal(r1.error, "invalid_windowDays");
      const r2 = call("recordDetectorFire", ctxA, { detectorId: "console_debug", count: bad });
      assert.equal(r2.ok, false, `count=${bad} should fail-closed`);
      assert.equal(r2.error, "invalid_count");
    }
  });

  it("still honours a valid windowDays / count", () => {
    call("recordDetectorFire", ctxA, { detectorId: "console_debug", count: 5 });
    const a = call("usageAnalytics", ctxA, { windowDays: 7 });
    assert.equal(a.ok, true);
    assert.equal(a.result.windowDays, 7);
    assert.equal(a.result.totalFires, 5);
  });
});
