// A filed alert keeps its title, line, edited line, and acknowledgement
// after the in-memory commandCenterLens is dropped. The list does not
// carry the line. The front alert is the oldest one still open.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCommandCenterActions from "../domains/commandcenter.js";
import { up, down } from "../migrations/464_command_center_alerts.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`command-center.${name}`);
  assert.ok(fn, `command-center.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerCommandCenterActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, commandCenterLens: {} };
});

const ctx = { actor: { userId: "user_alert" }, userId: "user_alert", db };

function dropMemory() {
  globalThis._concordSTATE = { db, commandCenterLens: {} };
}

describe("command center alert restart", () => {
  it("lists the title, opens the line, and keeps an edit and an acknowledgement", () => {
    const filed = call("alert-file", ctx, { title: "  Disk pressure  ", line: "  the volume is tight  " });
    assert.equal(filed.ok, true);
    const id = filed.result.alertId;
    assert.equal(filed.result.alert.title, "Disk pressure");
    assert.equal(filed.result.alert.line, undefined);
    assert.equal(filed.result.alert.ackNote, undefined);
    const row = db.prepare("SELECT title, line, status, ack_note FROM command_center_alerts WHERE id = ?").get(id);
    assert.equal(row.title, "Disk pressure");
    assert.equal(row.line, "the volume is tight");
    assert.equal(row.status, "open");
    assert.equal(row.ack_note, null);

    dropMemory();
    const list = call("alert-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.alerts[0].title, "Disk pressure");
    assert.equal(list.result.alerts[0].status, "open");
    assert.equal(list.result.alerts[0].line, undefined);
    const detail = call("alert-detail", ctx, { id });
    assert.equal(detail.result.alert.line, "the volume is tight");
    assert.equal(detail.result.alert.ackNote, null);
    const front = call("alert-front", ctx, {});
    assert.equal(front.result.alert.id, id);

    const edited = call("alert-edit", ctx, { id, line: "  freed the proof db  " });
    assert.equal(edited.ok, true);
    assert.equal(edited.result.alert.line, undefined);
    dropMemory();
    assert.equal(call("alert-detail", ctx, { id }).result.alert.line, "freed the proof db");

    const acked = call("alert-acknowledge", ctx, { id, note: "  cleared  " });
    assert.equal(acked.ok, true);
    assert.equal(acked.result.alert.status, "acknowledged");
    assert.equal(acked.result.alert.ackNote, undefined);
    dropMemory();
    const after = call("alert-detail", ctx, { id }).result.alert;
    assert.equal(after.status, "acknowledged");
    assert.equal(after.ackNote, "cleared");
    assert.equal(after.line, "freed the proof db");
    assert.equal(call("alert-front", ctx, {}).result.alert, null);
    assert.equal(call("alert-acknowledge", ctx, { id, note: "again" }).error, "already_acknowledged");
  });

  it("the front alert is the older open one", () => {
    const first = call("alert-file", ctx, { title: "First", line: "one" });
    const second = call("alert-file", ctx, { title: "Second", line: "two" });
    dropMemory();
    assert.equal(call("alert-front", ctx, {}).result.alert.id, first.result.alertId);
    call("alert-acknowledge", ctx, { id: first.result.alertId, note: "done" });
    dropMemory();
    const front = call("alert-front", ctx, {}).result.alert;
    assert.equal(front.id, second.result.alertId);
    assert.equal(front.title, "Second");
    assert.equal(front.line, undefined);
    const listed = call("alert-list", ctx, {}).result.alerts;
    assert.equal(listed.length, 2);
    assert.equal(listed[0].line, undefined);
    assert.equal(listed[1].line, undefined);
  });

  it("a blank title, line, or note stores nothing", () => {
    assert.equal(call("alert-file", ctx, { title: "  ", line: "x" }).error, "alert title required");
    assert.equal(call("alert-file", ctx, { title: "Disk", line: " " }).error, "alert line required");
    const filed = call("alert-file", ctx, { title: "Disk", line: "tight" });
    assert.equal(call("alert-edit", ctx, { id: filed.result.alertId, line: " " }).error, "alert line required");
    assert.equal(call("alert-acknowledge", ctx, { id: filed.result.alertId, note: " " }).error, "acknowledgement note required");
    assert.equal(db.prepare("SELECT line, status FROM command_center_alerts WHERE id = ?").get(filed.result.alertId).line, "tight");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM command_center_alerts").get().n, 1);
  });

  it("refuses an actorless write and drops the table", () => {
    const anon = { actor: {}, db };
    assert.equal(call("alert-file", anon, { title: "Disk", line: "tight" }).error, "no_actor");
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='command_center_alerts'").get(),
      undefined,
    );
  });
});
