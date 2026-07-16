// server/tests/dx-finding-history-persistence.test.js
//
// Wave-4 gap closure (docs/WAVE4_INVENTORY.md `dx-platform` row: "No
// historical issue-trend / 'new vs. existing' tracking (leak period)" —
// SonarQube's leak period; docs/lens-specs/dx-platform-capability-map.md's
// matching GENUINELY MISSING item). Migration 365 adds `dx_finding_history`
// (server/domains/dx-platform.js) — a minimal provenance table so
// `reviewDiff` can optionally persist a commit-scoped snapshot, and a new
// `issueTrend` macro can set-diff the last two snapshots for a codebase.
//
// This file proves, against a REAL migrated better-sqlite3 DB (same
// pattern as server/tests/education-catalog-persistence.test.js):
//   - reviewDiff persists a row into dx_finding_history ONLY when the
//     caller supplies commitSha (raw SQL check, not just the macro's own
//     response)
//   - reviewDiff WITHOUT commitSha is backward compatible: zero rows
//     written, and the returned result shape is unaffected
//   - re-reviewing the SAME commit upserts in place (no duplicate rows)
//   - issueTrend is honest with 0 or 1 snapshots (no fabricated trend)
//   - issueTrend computes a real new/existing/resolved set-diff across a
//     genuine 2-commit sequence
//   - the same contract holds in the in-memory fallback (no ctx.db) —
//     dx-platform's usual state-storage mode when no real server DB exists

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerDxPlatformActions from "../domains/dx-platform.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "dx-platform", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`dx-platform.${name} not registered`);
  return fn(ctx, input);
}

// Unified diffs authored so the finding IDENTITY set-diff is exact and
// hand-verifiable: `${detectorId}:${path}:${line}`.
//   commit1: secret_leak @ line 1, console_debug @ line 2
//   commit2: secret_leak @ line 1 (SAME identity -> existing),
//            todo_marker @ line 2 (NEW identity at that line),
//            console_debug @ line 2 is gone -> resolved
const DIFF_COMMIT_1 = [
  "--- a/src/x.js",
  "+++ b/src/x.js",
  "@@ -1,1 +1,3 @@",
  "+const token = 'ghp_aaaaaaaaaaaaaaaa';",
  "+console.log(token);",
].join("\n");
const DIFF_COMMIT_2 = [
  "--- a/src/x.js",
  "+++ b/src/x.js",
  "@@ -1,1 +1,3 @@",
  "+const token = 'ghp_aaaaaaaaaaaaaaaa';",
  "+// TODO fix this properly",
].join("\n");

describe("dx-platform.reviewDiff + issueTrend — DB-backed persistence (ctx.db path)", () => {
  let db, dbFile;
  beforeEach(async () => {
    ACTIONS.clear();
    registerDxPlatformActions(register);
    dbFile = path.join(os.tmpdir(), `dx-finding-history-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new Database(dbFile);
    await runMigrations(db);
    globalThis._concordSTATE = {};
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  const ctx = () => ({ db, actor: { userId: "userA" } });

  it("persists a row into dx_finding_history when commitSha is supplied", () => {
    const r = call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1, commitSha: "commit1" });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.findingCount, 2);

    const row = db.prepare("SELECT * FROM dx_finding_history WHERE user_id = ? AND commit_sha = ?").get("userA", "commit1");
    assert.ok(row, "a row must exist in dx_finding_history");
    assert.equal(row.codebase_id, "");
    assert.equal(row.finding_count, 2);
    const keys = JSON.parse(row.finding_keys_json);
    assert.deepEqual(keys.sort(), ["console_debug:src/x.js:2", "secret_leak:src/x.js:1"]);

    // process-global in-memory fallback must stay untouched — the DB path
    // did the write, not a process Map.
    assert.equal(globalThis._concordSTATE.dxPlatformLens?.findingHistory?.size ?? 0, 0);
  });

  it("without commitSha: zero rows written, result shape unaffected (backward compat)", () => {
    const withSha = call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1, commitSha: "commit1" });
    const withoutSha = call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1 });

    assert.equal(withoutSha.ok, true);
    // exact same result shape/values as the commitSha call — persistence is
    // a pure side effect, never changes what reviewDiff returns.
    assert.equal(withoutSha.result.findingCount, withSha.result.findingCount);
    assert.deepEqual(withoutSha.result.bySeverity, withSha.result.bySeverity);
    assert.equal(withoutSha.result.verdict, withSha.result.verdict);

    const count = db.prepare("SELECT COUNT(*) AS n FROM dx_finding_history").get().n;
    assert.equal(count, 1, "only the commitSha call should have written a row");
  });

  it("re-reviewing the SAME commit upserts in place — no duplicate rows", () => {
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1, commitSha: "commit1" });
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1, commitSha: "commit1" });
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_2, commitSha: "commit1" }); // re-review, different content

    const rows = db.prepare("SELECT * FROM dx_finding_history WHERE user_id = ? AND commit_sha = ?").all("userA", "commit1");
    assert.equal(rows.length, 1, "same commitSha must upsert, never duplicate");
    const keys = JSON.parse(rows[0].finding_keys_json);
    assert.deepEqual(keys.sort(), ["secret_leak:src/x.js:1", "todo_marker:src/x.js:2"], "the upserted row reflects the LATEST review of that commit");
  });

  it("issueTrend is honest with zero snapshots — no fabricated comparison", () => {
    const r = call("issueTrend", ctx(), {});
    assert.equal(r.ok, true);
    assert.equal(r.result.snapshotCount, 0);
    assert.equal(r.result.hasTrend, false);
    assert.equal(r.result.latest, null);
    assert.equal(r.result.previous, null);
    assert.equal(r.result.newCount, null);
    assert.equal(r.result.existingCount, null);
    assert.equal(r.result.resolvedCount, null);
  });

  it("issueTrend is honest with exactly one snapshot — baseline recorded, no comparison yet", () => {
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1, commitSha: "commit1" });
    const r = call("issueTrend", ctx(), {});
    assert.equal(r.ok, true);
    assert.equal(r.result.snapshotCount, 1);
    assert.equal(r.result.hasTrend, false);
    assert.equal(r.result.latest.commitSha, "commit1");
    assert.equal(r.result.latest.findingCount, 2);
    assert.equal(r.result.previous, null);
  });

  it("issueTrend computes a real new/existing/resolved set-diff across a genuine 2-commit sequence", () => {
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1, commitSha: "commit1" });
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_2, commitSha: "commit2" });

    const r = call("issueTrend", ctx(), {});
    assert.equal(r.ok, true);
    assert.equal(r.result.snapshotCount, 2);
    assert.equal(r.result.hasTrend, true);
    assert.equal(r.result.latest.commitSha, "commit2");
    assert.equal(r.result.previous.commitSha, "commit1");
    assert.equal(r.result.newCount, 1);
    assert.equal(r.result.existingCount, 1);
    assert.equal(r.result.resolvedCount, 1);
    assert.deepEqual(r.result.newFindingKeys, ["todo_marker:src/x.js:2"]);
    assert.deepEqual(r.result.resolvedFindingKeys, ["console_debug:src/x.js:2"]);
  });

  it("codebaseId scopes history independently — a trend for one codebase never leaks into another", () => {
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1, commitSha: "commit1", codebaseId: "cb-a" });
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_2, commitSha: "commit2", codebaseId: "cb-a" });
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1, commitSha: "commit1", codebaseId: "cb-b" });

    const trendA = call("issueTrend", ctx(), { codebaseId: "cb-a" });
    assert.equal(trendA.result.hasTrend, true);
    assert.equal(trendA.result.snapshotCount, 2);

    const trendB = call("issueTrend", ctx(), { codebaseId: "cb-b" });
    assert.equal(trendB.result.hasTrend, false);
    assert.equal(trendB.result.snapshotCount, 1);

    // and the default (no codebaseId) bucket is untouched by either
    const trendDefault = call("issueTrend", ctx(), {});
    assert.equal(trendDefault.result.snapshotCount, 0);
  });

  it("auth is required for issueTrend", () => {
    const r = call("issueTrend", {}, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "auth_required");
  });
});

describe("dx-platform.reviewDiff + issueTrend — in-memory fallback (no ctx.db)", () => {
  beforeEach(() => {
    ACTIONS.clear();
    registerDxPlatformActions(register);
    globalThis._concordSTATE = {};
  });

  const ctx = () => ({ actor: { userId: "userA" } });

  it("persists in-memory when commitSha is supplied, and skips persistence without it", () => {
    const r1 = call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1, commitSha: "commit1" });
    assert.equal(r1.ok, true);
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1 }); // no commitSha — must not add a snapshot

    const history = globalThis._concordSTATE.dxPlatformLens.findingHistory.get("userA");
    assert.equal(history.length, 1, "only the commitSha call should have recorded a snapshot");
    assert.equal(history[0].commitSha, "commit1");
  });

  it("computes the same 2-commit new/existing/resolved trend purely in-memory", () => {
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_1, commitSha: "commit1" });
    call("reviewDiff", ctx(), { diff: DIFF_COMMIT_2, commitSha: "commit2" });

    const r = call("issueTrend", ctx(), {});
    assert.equal(r.ok, true);
    assert.equal(r.result.hasTrend, true);
    assert.equal(r.result.newCount, 1);
    assert.equal(r.result.existingCount, 1);
    assert.equal(r.result.resolvedCount, 1);
  });
});
