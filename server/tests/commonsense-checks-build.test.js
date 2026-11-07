// Build tests for the Commonsense thread slices (S-CS-2/S-CS-3/S-CS-4):
// dedup on re-ask, the dispute flag, per-field provenance dates on
// check-detail, check-delete, and the lens export provider. Runs the
// real domain actions against a real (in-memory) checks table with
// migrations 465 + 498 applied, in production boot order.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCommonsenseActions from "../domains/commonsense.js";
import { up as up465 } from "../migrations/465_commonsense_checks.js";
import { up as up498 } from "../migrations/498_commonsense_check_provenance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`commonsense.${name}`);
  assert.ok(fn, `commonsense.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerCommonsenseActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up465(db);
  up498(db);
  globalThis._concordSTATE = { db, commonsenseLens: { facts: new Map() } };
});

const ctx = { actor: { userId: "cs_user" }, userId: "cs_user", db };
const ctxB = { actor: { userId: "cs_other" }, userId: "cs_other", db };

function dropMemory() {
  globalThis._concordSTATE = { db, commonsenseLens: { facts: new Map() } };
}

describe("commonsense checks — provenance (S-CS-3)", () => {
  it("check-detail carries the dates each field was stated", () => {
    const asked = call("check-ask", ctx, { question: "What happens to water in a freezer?" });
    assert.equal(asked.ok, true);
    const id = asked.result.checkId;
    const fresh = call("check-detail", ctx, { id }).result.check;
    assert.ok(fresh.createdAt, "question date present");
    assert.equal(fresh.flagged, false);
    call("check-finding", ctx, { id, finding: "It freezes into ice." });
    call("check-exception", ctx, { id, exception: "Unless it is supercooled." });
    dropMemory();
    const detail = call("check-detail", ctx, { id }).result.check;
    assert.equal(detail.finding, "It freezes into ice.");
    assert.ok(detail.findingAt, "finding date present after restart");
    assert.ok(detail.exceptionAt, "exception date present after restart");
  });
});

describe("commonsense checks — dedup (S-CS-2)", () => {
  it("a verbatim re-ask returns the standing entry instead of duplicating", () => {
    const first = call("check-ask", ctx, { question: "Is the door shut?" });
    const again = call("check-ask", ctx, { question: "  is the   door shut? " });
    assert.equal(again.ok, true);
    assert.equal(again.result.duplicate, true);
    assert.equal(again.result.checkId, first.result.checkId);
    assert.equal(call("check-list", ctx, {}).result.count, 1);
    const other = call("check-ask", ctx, { question: "Is the light on?" });
    assert.notEqual(other.result.checkId, first.result.checkId);
    assert.equal(call("check-list", ctx, {}).result.count, 2);
  });
});

describe("commonsense checks — dispute flag (S-CS-2)", () => {
  it("flags a finding, renders flagged on detail, persists across restart, unflags", () => {
    const asked = call("check-ask", ctx, { question: "Is a metal fork near an outlet safe?" });
    const id = asked.result.checkId;
    const noFinding = call("check-flag", ctx, { id, flagged: true });
    assert.equal(noFinding.ok, false);
    assert.equal(noFinding.error, "nothing_to_dispute");
    call("check-finding", ctx, { id, finding: "It is completely safe." });
    const flagged = call("check-flag", ctx, { id, flagged: true });
    assert.equal(flagged.ok, true);
    assert.equal(flagged.result.flagged, true);
    dropMemory();
    assert.equal(call("check-detail", ctx, { id }).result.check.flagged, true);
    call("check-flag", ctx, { id, flagged: false });
    assert.equal(call("check-detail", ctx, { id }).result.check.flagged, false);
  });
});

describe("commonsense checks — delete (S-CS-2)", () => {
  it("deletes the caller's entry end to end; another user's id is not found", () => {
    const a = call("check-ask", ctx, { question: "Mine to remove?" });
    const b = call("check-ask", ctx, { question: "Mine to keep?" });
    const notMine = call("check-delete", ctxB, { id: a.result.checkId });
    assert.equal(notMine.ok, false);
    assert.equal(notMine.error, "check_not_found");
    const del = call("check-delete", ctx, { id: a.result.checkId });
    assert.equal(del.ok, true);
    assert.equal(del.result.remaining, 1);
    dropMemory();
    assert.equal(call("check-detail", ctx, { id: a.result.checkId }).ok, false);
    assert.equal(call("check-detail", ctx, { id: b.result.checkId }).ok, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM commonsense_checks").get().n, 1);
  });
});

describe("commonsense checks — export provider (S-CS-4)", () => {
  it("exports the caller's checks, and only the caller's", async () => {
    const { collectLensExport, _clearLensExportProvidersForTests } = await import("../lib/lens-export.js");
    const asked = call("check-ask", ctx, { question: "Does the sun rise in the east?" });
    call("check-finding", ctx, { id: asked.result.checkId, finding: "Yes, from Earth's rotation." });
    call("check-ask", ctxB, { question: "Someone else's question?" });
    const out = await collectLensExport({
      runMacro: async () => ({ ok: true, artifacts: [] }),
      domain: "commonsense",
      ctx,
      limit: 50,
    });
    assert.equal(out.ok, true);
    const titles = out.artifacts.map((a) => a.title);
    assert.ok(titles.includes("Does the sun rise in the east?"), `export carries the caller's check: ${titles.join(" | ")}`);
    assert.ok(!titles.includes("Someone else's question?"), "export excludes other users' checks");
    _clearLensExportProvidersForTests();
  });
});
