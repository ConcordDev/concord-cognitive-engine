// An asked check keeps its question, its edited finding, and its
// exception after the in-memory commonsenseLens is dropped. The list
// does not carry the finding or the exception. A second question stays
// in the thread.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCommonsenseActions from "../domains/commonsense.js";
import { up, down } from "../migrations/465_commonsense_checks.js";

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
  up(db);
  globalThis._concordSTATE = { db, commonsenseLens: { facts: new Map() } };
});

const ctx = { actor: { userId: "user_check" }, userId: "user_check", db };

function dropMemory() {
  globalThis._concordSTATE = { db, commonsenseLens: { facts: new Map() } };
}

describe("commonsense check restart", () => {
  it("lists the question, opens the finding, and keeps an edit and an exception", () => {
    const asked = call("check-ask", ctx, { question: "  Is the door shut?  " });
    assert.equal(asked.ok, true);
    const id = asked.result.checkId;
    assert.equal(asked.result.check.question, "Is the door shut?");
    assert.equal(asked.result.check.finding, undefined);
    assert.equal(asked.result.check.exception, undefined);
    const row = db.prepare("SELECT question, finding, exception FROM commonsense_checks WHERE id = ?").get(id);
    assert.equal(row.question, "Is the door shut?");
    assert.equal(row.finding, "");
    assert.equal(row.exception, null);

    dropMemory();
    const list = call("check-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.checks[0].question, "Is the door shut?");
    assert.equal(list.result.checks[0].finding, undefined);
    assert.equal(list.result.checks[0].exception, undefined);
    const detail = call("check-detail", ctx, { id });
    assert.equal(detail.result.check.finding, "");
    assert.equal(detail.result.check.exception, null);

    const stated = call("check-finding", ctx, { id, finding: "  The latch is down.  " });
    assert.equal(stated.ok, true);
    assert.equal(stated.result.check.finding, undefined);
    dropMemory();
    assert.equal(call("check-detail", ctx, { id }).result.check.finding, "The latch is down.");

    const edited = call("check-finding", ctx, { id, finding: "  The latch is still down.  " });
    assert.equal(edited.ok, true);
    assert.equal(edited.result.check.finding, undefined);
    dropMemory();
    assert.equal(call("check-detail", ctx, { id }).result.check.finding, "The latch is still down.");

    const noted = call("check-exception", ctx, { id, exception: "  Unless the wind has it.  " });
    assert.equal(noted.ok, true);
    assert.equal(noted.result.check.exception, undefined);
    dropMemory();
    const after = call("check-detail", ctx, { id }).result.check;
    assert.equal(after.question, "Is the door shut?");
    assert.equal(after.finding, "The latch is still down.");
    assert.equal(after.exception, "Unless the wind has it.");
  });

  it("keeps a second question in the thread", async () => {
    const first = call("check-ask", ctx, { question: "Is the door shut?" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = call("check-ask", ctx, { question: "Is the light on?" });
    dropMemory();
    const listed = call("check-list", ctx, {}).result.checks;
    assert.equal(listed.length, 2);
    assert.equal(listed[0].id, first.result.checkId);
    assert.equal(listed[1].id, second.result.checkId);
    assert.equal(listed[0].question, "Is the door shut?");
    assert.equal(listed[1].question, "Is the light on?");
    assert.equal(listed[0].finding, undefined);
    assert.equal(listed[1].finding, undefined);
  });

  it("a blank question, finding, or exception stores nothing", () => {
    assert.equal(call("check-ask", ctx, { question: "  " }).error, "question required");
    const asked = call("check-ask", ctx, { question: "Is the door shut?" });
    assert.equal(call("check-finding", ctx, { id: asked.result.checkId, finding: " " }).error, "finding required");
    assert.equal(call("check-exception", ctx, { id: asked.result.checkId, exception: " " }).error, "exception required");
    const row = db.prepare("SELECT finding, exception FROM commonsense_checks WHERE id = ?").get(asked.result.checkId);
    assert.equal(row.finding, "");
    assert.equal(row.exception, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM commonsense_checks").get().n, 1);
  });

  it("refuses an actorless write, rolls back a failed write, and drops the table", () => {
    const anon = { actor: {}, db };
    assert.equal(call("check-ask", anon, { question: "Is the door shut?" }).error, "no_actor");
    const bad = {
      prepare(sql) {
        if (String(sql).includes("sqlite_master")) return { get: () => ({ ok: 1 }) };
        throw new Error("disk");
      },
    };
    globalThis._concordSTATE = { db: bad, commonsenseLens: { facts: new Map() } };
    const failed = call("check-ask", { actor: { userId: "user_check" }, userId: "user_check", db: bad }, { question: "Is the door shut?" });
    assert.equal(failed.error, "check_not_saved");
    assert.equal(globalThis._concordSTATE.commonsenseLens.checks.get("user_check").length, 0);
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='commonsense_checks'").get(),
      undefined,
    );
  });

  it("still stores a personal fact in memory", () => {
    const added = call("factAdd", ctx, { subject: "door", object: "shut" });
    assert.equal(added.ok, true);
    assert.equal(added.result.fact.subject, "door");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM commonsense_checks").get().n, 0);
  });
});
