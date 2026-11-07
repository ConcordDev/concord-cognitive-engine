// build(cognitive-replay) — the Moments journal slices S-CRP-1..3.
//
// The records always carried created_at server-side; the list and
// detail payloads never sent it, and no update or delete verb existed
// (a moment, once added, was permanent — absent-exit-path instance
// #5). These pins hold the new contract: the date rides both payloads,
// an edit keeps the original date, a delete removes the record from
// both stores, and another account's moments are unreachable.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCognitiveReplayActions from "../domains/cognitive-replay.js";
import { up } from "../migrations/462_cognitive_replay_moments.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`cognitive-replay.${name}`);
  assert.ok(fn, `cognitive-replay.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerCognitiveReplayActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, cognitiveReplay: {}, sessions: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_journal" }, userId: "user_journal", db };
const other = { actor: { userId: "user_other" }, userId: "user_other", db };

describe("cognitive-replay full build — the journal's lifecycle", () => {
  it("list and detail carry the date the moment was added", () => {
    const created = call("moment-choose", ctx, { title: "Door moment", line: "the hinge question" });
    assert.equal(created.ok, true);
    const list = call("moment-list", ctx, {});
    assert.equal(list.result.moments.length, 1);
    const stamp = list.result.moments[0].createdAt;
    assert.equal(typeof stamp, "string");
    assert.ok(!Number.isNaN(Date.parse(stamp)), "createdAt parses as a date");
    const detail = call("moment-detail", ctx, { id: created.result.momentId });
    assert.equal(detail.result.moment.createdAt, stamp);
  });

  it("an edit changes title and line and keeps the original date", () => {
    const created = call("moment-choose", ctx, { title: "Door moment", line: "the hinge question" });
    const id = created.result.momentId;
    const before = call("moment-detail", ctx, { id }).result.moment;
    const edited = call("moment-update", ctx, { id, title: "Door moment, kept", line: "the hinge answer" });
    assert.equal(edited.ok, true);
    const after = call("moment-detail", ctx, { id }).result.moment;
    assert.equal(after.title, "Door moment, kept");
    assert.equal(after.line, "the hinge answer");
    assert.equal(after.createdAt, before.createdAt);
    const row = db.prepare("SELECT title, line FROM cognitive_replay_moments WHERE id = ?").get(id);
    assert.equal(row.title, "Door moment, kept");
    assert.equal(row.line, "the hinge answer");
  });

  it("update refuses a blank title and a missing moment", () => {
    const created = call("moment-choose", ctx, { title: "Door moment", line: "the hinge question" });
    const blank = call("moment-update", ctx, { id: created.result.momentId, title: "  ", line: "x" });
    assert.equal(blank.ok, false);
    assert.match(blank.error, /title required/);
    const missing = call("moment-update", ctx, { id: "cr_nope", title: "T", line: "L" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "moment_not_found");
  });

  it("a delete removes the moment from the list, the detail, and the table", () => {
    const created = call("moment-choose", ctx, { title: "Door moment", line: "the hinge question" });
    const id = created.result.momentId;
    const deleted = call("moment-delete", ctx, { id });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.result.remaining, 0);
    assert.equal(call("moment-list", ctx, {}).result.count, 0);
    assert.equal(call("moment-detail", ctx, { id }).ok, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM cognitive_replay_moments").get().c, 0);
    const again = call("moment-delete", ctx, { id });
    assert.equal(again.ok, false);
    assert.equal(again.error, "moment_not_found");
  });

  it("a delete survives a restart (the row is the record)", () => {
    const created = call("moment-choose", ctx, { title: "Door moment", line: "the hinge question" });
    call("moment-delete", ctx, { id: created.result.momentId });
    globalThis._concordSTATE = { db, cognitiveReplay: {}, sessions: new Map() };
    assert.equal(call("moment-list", ctx, {}).result.count, 0);
  });

  it("another account cannot read, edit, or delete the moment", () => {
    const created = call("moment-choose", ctx, { title: "Door moment", line: "the hinge question" });
    const id = created.result.momentId;
    assert.equal(call("moment-list", other, {}).result.count, 0);
    assert.equal(call("moment-detail", other, { id }).ok, false);
    assert.equal(call("moment-update", other, { id, title: "Stolen", line: "x" }).ok, false);
    assert.equal(call("moment-delete", other, { id }).ok, false);
    assert.equal(call("moment-detail", ctx, { id }).result.moment.title, "Door moment");
  });
});
