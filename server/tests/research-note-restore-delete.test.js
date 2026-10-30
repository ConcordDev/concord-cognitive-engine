// Research S2 — note snapshot Restore + note Delete behaviour.
// Pins Product Review 2 findings F4/F5 (research.md §3/§7 S2): the macros
// note-restore / note-delete must actually apply/remove server-side, fail
// honestly on unknown ids, and a delete must leave nothing behind.
// Harness mirrors research-domain-parity.test.js (direct register/call).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/research.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`research.${name}`);
  if (!fn) throw new Error(`research.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("research S2 — snapshot restore (F4)", () => {
  it("restore applies the snapshot body and title", () => {
    const c = call("note-create", ctxA, { title: "Draft", body: "original body" });
    const id = c.result.note.id;
    const snap = call("note-snapshot", ctxA, { noteId: id, label: "before edit" });
    assert.equal(snap.ok, true);
    call("note-update", ctxA, { id, title: "Draft v2", body: "PR2 SNAPSHOT TEST LINE" });
    const r = call("note-restore", ctxA, { noteId: id, snapshotId: snap.result.snapshot.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.restoredFrom, snap.result.snapshot.id);
    const after = call("note-get", ctxA, { id });
    assert.equal(after.result.note.body, "original body");
    assert.equal(after.result.note.title, "Draft");
  });

  it("restore snapshots the pre-restore text first (restore is reversible)", () => {
    const c = call("note-create", ctxA, { title: "N", body: "v1" });
    const id = c.result.note.id;
    const snap = call("note-snapshot", ctxA, { noteId: id });
    call("note-update", ctxA, { id, body: "v2 overwritten" });
    call("note-restore", ctxA, { noteId: id, snapshotId: snap.result.snapshot.id });
    const list = call("note-snapshots", ctxA, { noteId: id });
    const auto = list.result.snapshots.find((s) => s.label === "auto: before restore");
    assert.ok(auto, "expected an 'auto: before restore' snapshot");
    const got = call("note-snapshot-get", ctxA, { noteId: id, snapshotId: auto.id });
    assert.equal(got.result.snapshot.body, "v2 overwritten");
  });

  it("restore of an unknown snapshot fails honestly and changes nothing", () => {
    const c = call("note-create", ctxA, { title: "N", body: "keep me" });
    const id = c.result.note.id;
    const r = call("note-restore", ctxA, { noteId: id, snapshotId: "snap_nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /snapshot not found/);
    assert.equal(call("note-get", ctxA, { id }).result.note.body, "keep me");
  });

  it("restore on an unknown note fails honestly", () => {
    const r = call("note-restore", ctxA, { noteId: "note_nope", snapshotId: "snap_x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /note not found/);
  });

  it("restore is scoped per-user", () => {
    const c = call("note-create", ctxA, { title: "mine", body: "a body" });
    const id = c.result.note.id;
    const snap = call("note-snapshot", ctxA, { noteId: id });
    const r = call("note-restore", ctxB, { noteId: id, snapshotId: snap.result.snapshot.id });
    assert.equal(r.ok, false);
  });
});

describe("research S2 — note delete (F5)", () => {
  it("delete removes the note and it no longer lists", () => {
    const a = call("note-create", ctxA, { title: "keep", body: "x" });
    const b = call("note-create", ctxA, { title: "drop", body: "y" });
    const d = call("note-delete", ctxA, { id: b.result.note.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.deleted, b.result.note.id);
    const list = call("notes-list", ctxA);
    assert.deepEqual(list.result.notes.map((n) => n.id), [a.result.note.id]);
    assert.equal(call("note-get", ctxA, { id: b.result.note.id }).ok, false);
  });

  it("delete of an unknown note fails honestly", () => {
    const r = call("note-delete", ctxA, { id: "note_nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("delete also removes the note's version history", () => {
    const c = call("note-create", ctxA, { title: "hist", body: "v1" });
    const id = c.result.note.id;
    call("note-snapshot", ctxA, { noteId: id });
    assert.equal(call("note-snapshots", ctxA, { noteId: id }).result.count, 1);
    call("note-delete", ctxA, { id });
    assert.equal(call("note-snapshots", ctxA, { noteId: id }).result.count, 0);
  });

  it("a deleted daily note is recreated fresh, not returned empty", () => {
    const d1 = call("daily-note", ctxA, { date: "2026-02-03" });
    assert.equal(d1.result.created, true);
    call("note-delete", ctxA, { id: d1.result.note.id });
    const d2 = call("daily-note", ctxA, { date: "2026-02-03" });
    assert.equal(d2.result.created, true);
    assert.ok(d2.result.note && d2.result.note.body.length > 0);
    assert.notEqual(d2.result.note.id, d1.result.note.id);
  });

  it("delete is scoped per-user", () => {
    const c = call("note-create", ctxA, { title: "mine", body: "x" });
    const r = call("note-delete", ctxB, { id: c.result.note.id });
    assert.equal(r.ok, false);
    assert.equal(call("notes-list", ctxA).result.notes.length, 1);
  });
});
