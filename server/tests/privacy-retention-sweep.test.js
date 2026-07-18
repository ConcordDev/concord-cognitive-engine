// Contract tests for server/emergent/privacy-retention-sweep.js — the
// heartbeat that ENFORCES the privacy lens's per-user retention policy
// (server/domains/privacy.js#retentionGet/#retentionSet). Prior to this
// module, retention config round-tripped honestly but nothing ever acted on
// it. These tests pin:
//   (a) data past its retention window is actually acted on per the
//       declared action (delete / anonymize / archive), for both
//       enforceable categories (access_logs, dsar_records);
//   (b) data within the window is left untouched;
//   (c) the heartbeat never throws, even with malformed/missing config.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPrivacyActions from "../domains/privacy.js";
import { runPrivacyRetentionSweep, ENFORCEABLE_CATEGORIES } from "../emergent/privacy-retention-sweep.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`privacy.${name}`);
  if (!fn) throw new Error(`privacy.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPrivacyActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const DAY_MS = 24 * 60 * 60 * 1000;
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function stateOf() { return globalThis._concordSTATE; }
function sweep() { return runPrivacyRetentionSweep({ state: stateOf() }); }

function backdateAccessEvent(uid, index, daysAgo) {
  const log = stateOf().privacyLens.accessLog.get(uid);
  log[index].at = Date.now() - daysAgo * DAY_MS;
}

function backdateDsar(uid, dsarId, daysAgo) {
  const req = stateOf().privacyLens.dsars.get(uid).get(dsarId);
  req.submittedAt = Date.now() - daysAgo * DAY_MS;
}

describe("privacy-retention-sweep — access_logs enforcement", () => {
  it("deletes access-log events past the declared window; leaves recent ones", async () => {
    call("recordAccess", ctxA, { actor: "system", lensId: "chat", dataCategory: "general", operation: "read" });
    call("recordAccess", ctxA, { actor: "system", lensId: "chat", dataCategory: "general", operation: "read" });
    backdateAccessEvent("user_a", 0, 200); // old (default window 90d)
    // index 1 stays recent (just recorded)

    call("retentionSet", ctxA, { category: "access_logs", windowDays: 90, action: "delete" });

    const res = await sweep();
    assert.equal(res.ok, true);
    assert.equal(res.byCategory.access_logs.actioned, 1);

    const log = stateOf().privacyLens.accessLog.get("user_a");
    assert.equal(log.length, 1, "only the recent event should remain");
  });

  it("anonymizes access-log events past the window instead of deleting", async () => {
    call("recordAccess", ctxA, { actor: "alice", lensId: "chat", dataCategory: "messages", operation: "read" });
    backdateAccessEvent("user_a", 0, 100);
    call("retentionSet", ctxA, { category: "access_logs", windowDays: 90, action: "anonymize" });

    const res = await sweep();
    assert.equal(res.byCategory.access_logs.actioned, 1);

    const log = stateOf().privacyLens.accessLog.get("user_a");
    assert.equal(log.length, 1, "anonymize keeps the record, doesn't delete it");
    assert.equal(log[0].actor, "redacted");
    assert.equal(log[0].lensId, "");
    assert.equal(log[0].dataCategory, "redacted");
    assert.equal(log[0].anonymized, true);
  });

  it("archives access-log events past the window into a separate archive bucket", async () => {
    call("recordAccess", ctxA, { actor: "alice", lensId: "world", dataCategory: "position", operation: "read" });
    backdateAccessEvent("user_a", 0, 100);
    call("retentionSet", ctxA, { category: "access_logs", windowDays: 90, action: "archive" });

    const res = await sweep();
    assert.equal(res.byCategory.access_logs.actioned, 1);

    const log = stateOf().privacyLens.accessLog.get("user_a");
    assert.equal(log.length, 0, "archived events leave the active log");

    const archive = stateOf().privacyLens.retentionArchive.get("user_a");
    assert.equal(archive.length, 1);
    assert.equal(archive[0].category, "access_logs");
    assert.equal(archive[0].record.lensId, "world");
  });

  it("leaves events within the window untouched", async () => {
    call("recordAccess", ctxA, { actor: "alice", lensId: "chat", dataCategory: "general", operation: "read" });
    call("retentionSet", ctxA, { category: "access_logs", windowDays: 90, action: "delete" });

    const res = await sweep();
    assert.equal(res.byCategory.access_logs.actioned, 0);
    assert.equal(stateOf().privacyLens.accessLog.get("user_a").length, 1);
  });

  it("windowDays=0 means keep forever — even ancient events are untouched", async () => {
    call("recordAccess", ctxA, { actor: "alice", lensId: "chat", dataCategory: "general", operation: "read" });
    backdateAccessEvent("user_a", 0, 5000);
    call("retentionSet", ctxA, { category: "access_logs", windowDays: 0, action: "delete" });

    const res = await sweep();
    assert.equal(res.byCategory.access_logs.actioned, 0);
    assert.equal(stateOf().privacyLens.accessLog.get("user_a").length, 1);
  });

  it("applies the documented DEFAULT window (90d) when the user never called retentionSet", async () => {
    call("recordAccess", ctxA, { actor: "alice", lensId: "chat", dataCategory: "general", operation: "read" });
    backdateAccessEvent("user_a", 0, 200); // past the 90-day default
    // No retentionSet call at all.

    const res = await sweep();
    assert.equal(res.byCategory.access_logs.actioned, 1, "default policy (90d/delete) should apply");
    assert.equal(stateOf().privacyLens.accessLog.get("user_a").length, 0);
  });

  it("does not cross-contaminate between users", async () => {
    call("recordAccess", ctxA, { actor: "alice", lensId: "chat", dataCategory: "general", operation: "read" });
    call("recordAccess", ctxB, { actor: "bob", lensId: "chat", dataCategory: "general", operation: "read" });
    backdateAccessEvent("user_a", 0, 200);
    backdateAccessEvent("user_b", 0, 200);
    call("retentionSet", ctxA, { category: "access_logs", windowDays: 90, action: "delete" });
    call("retentionSet", ctxB, { category: "access_logs", windowDays: 0, action: "delete" }); // keep forever

    await sweep();
    assert.equal(stateOf().privacyLens.accessLog.get("user_a").length, 0);
    assert.equal(stateOf().privacyLens.accessLog.get("user_b").length, 1);
  });
});

describe("privacy-retention-sweep — dsar_records enforcement", () => {
  it("deletes DSAR records past the declared window", async () => {
    const submitted = call("dsarSubmit", ctxA, { kind: "access", note: "old request" });
    backdateDsar("user_a", submitted.result.request.id, 800); // past default 730d
    call("retentionSet", ctxA, { category: "dsar_records", windowDays: 730, action: "delete" });

    const res = await sweep();
    assert.equal(res.byCategory.dsar_records.actioned, 1);
    assert.equal(stateOf().privacyLens.dsars.get("user_a").size, 0);
  });

  it("anonymizes DSAR records past the window, stripping the note", async () => {
    const submitted = call("dsarSubmit", ctxA, { kind: "export", note: "sensitive free text" });
    const dsarId = submitted.result.request.id;
    backdateDsar("user_a", dsarId, 800);
    call("retentionSet", ctxA, { category: "dsar_records", windowDays: 730, action: "anonymize" });

    await sweep();
    const req = stateOf().privacyLens.dsars.get("user_a").get(dsarId);
    assert.ok(req, "anonymize keeps the record");
    assert.equal(req.note, "");
    assert.equal(req.anonymized, true);
    assert.equal(req.kind, "export", "non-PII fields survive anonymize");
  });

  it("archives DSAR records past the window", async () => {
    const submitted = call("dsarSubmit", ctxA, { kind: "deletion", note: "please delete" });
    const dsarId = submitted.result.request.id;
    backdateDsar("user_a", dsarId, 800);
    call("retentionSet", ctxA, { category: "dsar_records", windowDays: 730, action: "archive" });

    await sweep();
    assert.equal(stateOf().privacyLens.dsars.get("user_a").has(dsarId), false);
    const archive = stateOf().privacyLens.retentionArchive.get("user_a");
    assert.equal(archive.length, 1);
    assert.equal(archive[0].category, "dsar_records");
    assert.equal(archive[0].record.note, "please delete");
  });

  it("leaves DSAR records within the window untouched", async () => {
    call("dsarSubmit", ctxA, { kind: "access", note: "fresh request" });
    call("retentionSet", ctxA, { category: "dsar_records", windowDays: 730, action: "delete" });

    const res = await sweep();
    assert.equal(res.byCategory.dsar_records.actioned, 0);
    assert.equal(stateOf().privacyLens.dsars.get("user_a").size, 1);
  });
});

describe("privacy-retention-sweep — never throws (heartbeat contract)", () => {
  it("handles a completely missing STATE gracefully", async () => {
    const res = await runPrivacyRetentionSweep({});
    assert.equal(res.ok, true);
    assert.equal(res.reason, "no_data");
  });

  it("handles STATE with no privacyLens yet provisioned", async () => {
    const res = await runPrivacyRetentionSweep({ state: {} });
    assert.equal(res.ok, true);
    assert.equal(res.reason, "no_data");
  });

  it("survives a malformed accessLog entry (non-array value)", async () => {
    call("recordAccess", ctxA, { actor: "alice" });
    stateOf().privacyLens.accessLog.set("user_broken", "not-an-array");
    const res = await sweep();
    assert.equal(res.ok, true);
  });

  it("survives a malformed dsars entry (not a Map)", async () => {
    call("dsarSubmit", ctxA, { kind: "access" });
    stateOf().privacyLens.dsars.set("user_broken", "not-a-map");
    const res = await sweep();
    assert.equal(res.ok, true);
  });

  it("survives an event/record with a missing or non-numeric timestamp", async () => {
    call("recordAccess", ctxA, { actor: "alice" });
    stateOf().privacyLens.accessLog.get("user_a")[0].at = "not-a-timestamp";
    call("retentionSet", ctxA, { category: "access_logs", windowDays: 1, action: "delete" });
    const res = await sweep();
    assert.equal(res.ok, true);
    // Malformed timestamp is treated as "not expired" (kept), never crashes.
    assert.equal(stateOf().privacyLens.accessLog.get("user_a").length, 1);
  });

  it("survives a garbage retention policy entry for a user", async () => {
    call("recordAccess", ctxA, { actor: "alice" });
    if (!stateOf().privacyLens.retention) stateOf().privacyLens.retention = new Map();
    stateOf().privacyLens.retention.set("user_a", "not-a-map");
    const res = await sweep();
    assert.equal(res.ok, true);
  });

  it("respects the CONCORD_PRIVACY_RETENTION_SWEEP=0 kill-switch", async () => {
    process.env.CONCORD_PRIVACY_RETENTION_SWEEP = "0";
    try {
      const res = await runPrivacyRetentionSweep({ state: { privacyLens: {} } });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "disabled");
    } finally {
      delete process.env.CONCORD_PRIVACY_RETENTION_SWEEP;
    }
  });
});

describe("privacy.retentionSweepStatus — observability", () => {
  it("reports hasRun:false before any sweep has executed", () => {
    const res = call("retentionSweepStatus", ctxA, {});
    assert.equal(res.ok, true);
    assert.equal(res.result.hasRun, false);
    assert.deepEqual(res.result.enforcedCategories, ENFORCEABLE_CATEGORIES);
    assert.ok(res.result.declaredOnlyCategories.includes("chat_history"));
    assert.ok(res.result.declaredOnlyCategories.includes("world_activity"));
    assert.ok(res.result.declaredOnlyCategories.includes("search_queries"));
    assert.ok(res.result.declaredOnlyCategories.includes("drafts"));
  });

  it("reports real counts after a sweep actions data", async () => {
    call("recordAccess", ctxA, { actor: "alice" });
    backdateAccessEvent("user_a", 0, 200);
    call("retentionSet", ctxA, { category: "access_logs", windowDays: 90, action: "delete" });

    await sweep();

    const res = call("retentionSweepStatus", ctxA, {});
    assert.equal(res.result.hasRun, true);
    assert.equal(res.result.totalRuns, 1);
    assert.equal(res.result.lastActioned, 1);
    assert.equal(res.result.totalActionedAllTime, 1);
    assert.ok(Number.isFinite(res.result.lastRunAt));
    assert.equal(res.result.byCategory.access_logs.actioned, 1);
  });
});
