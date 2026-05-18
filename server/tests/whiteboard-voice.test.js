// server/tests/whiteboard-voice.test.js
//
// Tier-2 contract test for Whiteboard Sprint B Item #10 — voice-to-element.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerWhiteboardVoiceMacros, { __test } from "../domains/whiteboard-voice.js";
import { upsertBoard, inviteParticipant, getBoard } from "../lib/whiteboard/persistence.js";

const { _classify } = __test;
let db; let boardId; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/208_whiteboard_persistence.js");
  mig.up(db);
  registerWhiteboardVoiceMacros((_d, n, h) => macros.set(n, h));
  const r = upsertBoard(db, { ownerId: "u_alice", title: "Voice board" });
  boardId = r.id;
  inviteParticipant(db, { boardId, userId: "u_view", role: "viewer" });
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("voice classifier", () => {
  it("default = sticky with transcript text", () => {
    const c = _classify("we should test the brown bag idea");
    assert.equal(c.kind, "notecard");
    assert.equal(c.text, "we should test the brown bag idea");
  });

  it("draw a rectangle → rectangle", () => {
    const c = _classify("draw a rectangle that says deploy by Friday");
    assert.equal(c.kind, "rectangle");
    assert.ok(c.text.toLowerCase().includes("deploy"));
  });

  it("add a circle → ellipse", () => {
    const c = _classify("add a circle labelled core");
    assert.equal(c.kind, "ellipse");
    assert.equal(c.text, "core");
  });

  it("draw an arrow → arrow", () => {
    const c = _classify("draw an arrow from A to B");
    assert.equal(c.kind, "arrow");
  });

  it("empty transcript → empty sticky", () => {
    const c = _classify("");
    assert.equal(c.kind, "notecard");
    assert.equal(c.text, "");
  });
});

describe("voice_to_element macro", () => {
  it("rejects no-auth", async () => {
    const r = await macros.get("voice_to_element")({ db }, { boardId, transcript: "hi" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });

  it("rejects missing transcript", async () => {
    const r = await macros.get("voice_to_element")({ db, actor: { userId: "u_alice" } }, { boardId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "transcript_required");
  });

  it("viewer is forbidden (editor+ required)", async () => {
    const r = await macros.get("voice_to_element")({ db, actor: { userId: "u_view" } }, { boardId, transcript: "test" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("owner can drop a sticky from a transcript", async () => {
    const r = await macros.get("voice_to_element")({ db, actor: { userId: "u_alice" } }, {
      boardId, transcript: "we should ship next week", x: 100, y: 200,
    });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "notecard");
    const row = getBoard(db, boardId);
    assert.ok(row.scene.elements.some((e) => e.id === r.element.id));
  });

  it("draw a circle dispatches as ellipse element", async () => {
    const r = await macros.get("voice_to_element")({ db, actor: { userId: "u_alice" } }, {
      boardId, transcript: "draw a circle called core",
    });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "ellipse");
    assert.equal(r.element.text, "core");
  });
});
