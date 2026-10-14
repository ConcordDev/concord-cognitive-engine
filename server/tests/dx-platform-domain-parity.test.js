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
  // Stands in for users-table lookupUserIdentity (PRAGMA + SELECT).
  const people = [
    { id: "user_a", username: "acct1", displayName: "Acct One" },
    { id: "user_b", username: "acct2", displayName: "Acct Two" },
    { id: "user_c", username: "acct3", displayName: "Acct Three" },
  ];
  globalThis._concordSTATE = {
    db: {
      prepare(sql) {
        const s = String(sql);
        if (s.includes("PRAGMA")) {
          return { all() { return [{ name: "id" }, { name: "username" }, { name: "display_name" }]; } };
        }
        return {
          get(param) {
            const p = String(param || "");
            return people.find((r) =>
              r.id === p || r.username.toLowerCase() === p.toLowerCase()
            ) || null;
          },
        };
      },
    },
  };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a", displayName: "Acct One" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b", displayName: "Acct Two" }, userId: "user_b" };
const ctxC = { actor: { userId: "user_c", displayName: "Acct Three" }, userId: "user_c" };
const noAuth = {};
const RAW_IDS = ["user_a", "user_b", "user_c"];

function assertNoRawUserIds(value, ids = RAW_IDS) {
  const blob = JSON.stringify(value);
  for (const id of ids) {
    assert.equal(blob.includes(id), false, `response leaked ${id}: ${blob}`);
  }
  assert.equal(blob.includes("ownerId"), false, `response leaked ownerId: ${blob}`);
  assert.equal(blob.includes("caregiverUserId"), false);
}

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
    // Owner is already a member — attach does not need a fresh invite.
    call("joinTeam", ctxA, { teamId: t.result.teamId, codebaseId: "cb1" });
    const dash = call("teamDashboard", ctxA, { teamId: t.result.teamId });
    assert.equal(dash.ok, true);
    assert.equal(dash.result.codebaseCount, 1);
    assert.ok(dash.result.totalFindings > 0);
    assert.ok(dash.result.topDetectors.length > 0);
    assert.ok(dash.result.perCodebase[0].riskScore > 0);
    assertNoRawUserIds(t);
    assertNoRawUserIds(dash);
  });
  it("rejects non-members and unknown teams", () => {
    const t = call("createTeam", ctxA, { name: "T" });
    assert.equal(call("teamDashboard", ctxB, { teamId: t.result.teamId }).ok, false);
    assert.equal(call("teamDashboard", ctxA, { teamId: "nope" }).ok, false);
    assert.equal(call("createTeam", ctxA, { name: "" }).ok, false);
  });

  // INC-77 / F1 — uninvited join must fail; private codebase + raw ids must
  // never appear in team responses for the outsider.
  it("INC-77 two-account: uninvited join refused; no private codebase or raw ids", () => {
    const indexed = call("indexCodebase", ctxA, {
      codebaseId: "cb_private",
      name: "sweep-private-secret",
      files: [{ path: "src/secret.js", content: "export const marker = 'SWEEP_MARKER';\n" }],
    });
    assert.equal(indexed.ok, true);
    const t = call("createTeam", ctxA, { name: "Sweep team" });
    assert.equal(t.ok, true);
    assert.ok(t.result.inviteCode);
    assertNoRawUserIds(t);

    // Owner attaches private codebase (already a member).
    const attach = call("joinTeam", ctxA, {
      teamId: t.result.teamId,
      codebaseId: "cb_private",
    });
    assert.equal(attach.ok, true);
    assertNoRawUserIds(attach);

    // acct2: bare teamId join with no invite → not_invited, not added.
    const bare = call("joinTeam", ctxB, { teamId: t.result.teamId });
    assert.equal(bare.ok, false);
    assert.equal(bare.error, "not_invited");
    assert.equal(call("teamDashboard", ctxB, { teamId: t.result.teamId }).ok, false);
    assert.equal(call("teamDashboard", ctxB, { teamId: t.result.teamId }).error, "not_a_member");

    // Wrong / spent invite also refused.
    assert.equal(
      call("joinTeam", ctxB, { teamId: t.result.teamId, inviteCode: "inv_nope" }).ok,
      false
    );

    // Invited join succeeds; responses stay free of raw ids.
    const inv = call("inviteToTeam", ctxA, { teamId: t.result.teamId });
    assert.equal(inv.ok, true);
    assert.ok(inv.result.inviteCode);
    assertNoRawUserIds(inv);

    const joined = call("joinTeam", ctxB, {
      teamId: t.result.teamId,
      inviteCode: inv.result.inviteCode,
    });
    assert.equal(joined.ok, true);
    assert.equal(joined.result.memberCount, 2);
    assertNoRawUserIds(joined);
    for (const m of joined.result.members) {
      assert.ok(m.id);
      assert.notEqual(m.id, "user_a");
      assert.notEqual(m.id, "user_b");
      assert.equal(m.userId, undefined);
    }

    const dashB = call("teamDashboard", ctxB, { teamId: t.result.teamId });
    assert.equal(dashB.ok, true);
    assert.equal(dashB.result.codebaseCount, 1);
    assert.equal(dashB.result.perCodebase[0].name, "sweep-private-secret");
    assert.equal(dashB.result.perCodebase[0].ownerId, undefined);
    assert.ok(dashB.result.perCodebase[0].owner?.id);
    assertNoRawUserIds(dashB);

    // Stranger still blocked + listMyTeams isolation.
    assert.equal(call("joinTeam", ctxC, { teamId: t.result.teamId }).error, "not_invited");
    assert.equal(call("listMyTeams", ctxC, {}).result.count, 0);
    assert.equal(call("listMyTeams", ctxB, {}).result.count, 1);
    assertNoRawUserIds(call("listMyTeams", ctxA, {}));
  });

  it("leaveTeam removes membership and listMyTeams stays private", () => {
    const t = call("createTeam", ctxA, { name: "Leave me" });
    const inv = call("inviteToTeam", ctxA, { teamId: t.result.teamId });
    call("joinTeam", ctxB, { teamId: t.result.teamId, inviteCode: inv.result.inviteCode });
    const left = call("leaveTeam", ctxB, { teamId: t.result.teamId });
    assert.equal(left.ok, true);
    assert.equal(call("teamDashboard", ctxB, { teamId: t.result.teamId }).error, "not_a_member");
    assert.equal(call("listMyTeams", ctxB, {}).result.count, 0);
    assertNoRawUserIds(left);
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
