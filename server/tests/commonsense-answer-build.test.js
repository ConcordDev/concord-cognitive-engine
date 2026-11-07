// Build tests for the Commonsense branch (a) answering step (D2):
// check-answer retrieves from the CALLER'S OWN thread only — exact
// match first, then term-related findings — stamped with the date the
// finding was stated, verbatim, exceptions named, disputed findings
// answered as contested, collisions answered together, and a miss
// answering honestly. Runs the real domain actions against a real
// (in-memory) checks table with migrations 465 + 498 applied.

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

function seed(ctxU, question, finding, exception) {
  const asked = call("check-ask", ctxU, { question });
  const id = asked.result.checkId;
  if (finding) call("check-finding", ctxU, { id, finding });
  if (exception) call("check-exception", ctxU, { id, exception });
  return id;
}

describe("commonsense check-answer — D2 own-thread retrieval", () => {
  it("an exact re-ask answers with the standing finding, stamped and verbatim", () => {
    seed(ctx, "What happens to water in a freezer?", "It freezes into ice.");
    const res = call("check-answer", ctx, { question: "  what happens to water in a freezer? " });
    assert.equal(res.ok, true);
    assert.equal(res.result.answered, true);
    assert.equal(res.result.match, "exact");
    assert.equal(res.result.source, "your-thread");
    assert.equal(res.result.answers.length, 1);
    assert.equal(res.result.answers[0].finding, "It freezes into ice.");
    assert.ok(res.result.answers[0].statedAt, "the answer carries the date the finding was stated");
    assert.equal(res.result.answers[0].disputed, false);
  });

  it("the exception rides the answer as its boundary", () => {
    seed(ctx, "What happens to water in a freezer?", "It freezes into ice.", "Unless it is supercooled.");
    const res = call("check-answer", ctx, { question: "What happens to water in a freezer?" });
    assert.equal(res.result.answers[0].exception, "Unless it is supercooled.");
  });

  it("a related question retrieves finding-bearing entries sharing its terms", () => {
    seed(ctx, "What happens to water in a freezer?", "It freezes into ice.");
    seed(ctx, "Is the door shut?", "Yes, it latched.");
    const res = call("check-answer", ctx, { question: "Does freezer water expand?" });
    assert.equal(res.result.answered, true);
    assert.equal(res.result.match, "related");
    assert.equal(res.result.answers.length, 1);
    assert.equal(res.result.answers[0].finding, "It freezes into ice.");
  });

  it("a disputed finding answers as contested, never as settled", () => {
    const id = seed(ctx, "Is it safe to put a metal fork toward an outlet?", "It is completely safe.");
    call("check-flag", ctx, { id, flagged: true });
    const res = call("check-answer", ctx, { question: "Is it safe to put a metal fork toward an outlet?" });
    assert.equal(res.result.answered, true);
    assert.equal(res.result.answers[0].disputed, true);
  });

  it("colliding findings answer together, in thread order, neither preferred", () => {
    seed(ctx, "Does the freezer keep food safe?", "Yes, indefinitely.");
    seed(ctx, "Freezer food safety limits?", "Quality degrades after months in the freezer.");
    const res = call("check-answer", ctx, { question: "Freezer food safety?" });
    assert.equal(res.result.answers.length, 2);
    assert.equal(res.result.answers[0].finding, "Yes, indefinitely.");
    assert.equal(res.result.answers[1].finding, "Quality degrades after months in the freezer.");
  });

  it("a question with no finding answers honestly — a miss, not an invention", () => {
    seed(ctx, "Is the door shut?", "");
    const res = call("check-answer", ctx, { question: "Is the door shut?" });
    assert.equal(res.result.answered, false);
    assert.equal(res.result.match, "none");
    assert.deepEqual(res.result.answers, []);
    const empty = call("check-answer", ctx, { question: "What is the airspeed of a swallow?" });
    assert.equal(empty.result.answered, false);
  });

  it("answers never cross accounts — another user's thread is invisible", () => {
    seed(ctxB, "What happens to water in a freezer?", "It freezes into ice.");
    const res = call("check-answer", ctx, { question: "What happens to water in a freezer?" });
    assert.equal(res.result.answered, false);
  });

  it("guards stand: no actor and no question are refused", () => {
    assert.equal(call("check-answer", { actor: {}, userId: "", db }, { question: "Anything?" }).error, "no_actor");
    assert.equal(call("check-answer", ctx, { question: "   " }).error, "question required");
  });
});
