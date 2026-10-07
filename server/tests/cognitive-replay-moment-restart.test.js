// A chosen moment stores its title and its line. Clearing the in-memory
// cognitiveReplay object (what a process restart does) still lists the
// title and still opens the same line. Role and brain are not stored.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCognitiveReplayActions from "../domains/cognitive-replay.js";
import { up, down } from "../migrations/462_cognitive_replay_moments.js";

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

const ctx = { actor: { userId: "user_moment" }, userId: "user_moment", db };

describe("cognitive replay moment restart", () => {
  it("lists the title and opens the same line after the in-memory lens is dropped", () => {
    const created = call("moment-choose", ctx, { title: "  Door moment  ", line: "  the hinge question  " });
    assert.equal(created.ok, true);
    const id = created.result.momentId;
    assert.equal(created.result.moment.title, "Door moment");
    assert.equal(created.result.moment.line, undefined);
    const row = db.prepare("SELECT title, line FROM cognitive_replay_moments WHERE id = ?").get(id);
    assert.equal(row.title, "Door moment");
    assert.equal(row.line, "the hinge question");

    globalThis._concordSTATE = { db, cognitiveReplay: {}, sessions: new Map() };
    const list = call("moment-list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.moments[0].id, id);
    assert.equal(list.result.moments[0].title, "Door moment");
    assert.equal(list.result.moments[0].line, undefined);
    const detail = call("moment-detail", ctx, { id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.moment.line, "the hinge question");
    assert.equal(detail.result.moment.role, undefined);
  });

  it("pins the live event preview and ignores a different client line", () => {
    globalThis._concordSTATE.sessions.set("sess_door", {
      userId: "user_moment",
      messages: [{ role: "user", content: "What did the hinge hold?", ts: Date.now() }],
    });
    const created = call("moment-choose", ctx, {
      title: "Hinge",
      line: "a different line",
      eventId: "sess_door:0",
    });
    assert.equal(created.ok, true);
    globalThis._concordSTATE = { db, cognitiveReplay: {}, sessions: new Map() };
    const detail = call("moment-detail", ctx, { momentId: created.result.momentId });
    assert.equal(detail.result.moment.line, "What did the hinge hold?");
  });

  it("a blank title stores nothing", () => {
    const created = call("moment-choose", ctx, { title: "   ", line: "x" });
    assert.equal(created.ok, false);
    assert.equal(created.error, "moment title required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cognitive_replay_moments").get().n, 0);
  });

  it("a blank line stores nothing", () => {
    const created = call("moment-choose", ctx, { title: "Door", line: "   " });
    assert.equal(created.ok, false);
    assert.equal(created.error, "moment line required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cognitive_replay_moments").get().n, 0);
  });

  it("a missing event stores nothing", () => {
    const created = call("moment-choose", ctx, { title: "Door", eventId: "missing:0", line: "nope" });
    assert.equal(created.ok, false);
    assert.equal(created.error, "event_not_found");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cognitive_replay_moments").get().n, 0);
  });

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cognitive_replay_moments'").get(),
      undefined,
    );
  });
});
