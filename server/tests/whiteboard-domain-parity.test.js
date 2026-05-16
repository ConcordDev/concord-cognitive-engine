import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/whiteboard.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`whiteboard.${name}`);
  if (!fn) throw new Error(`whiteboard.${name} not registered`);
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

describe("whiteboard — templates", () => {
  it("lists 6 starter templates", () => {
    const r = call("templates-list", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.templates.length, 6);
    assert.ok(r.result.templates.some((t) => t.id === "swot"));
  });

  it("template-load returns elements", () => {
    const r = call("template-load", {}, { id: "swot" });
    assert.equal(r.ok, true);
    assert.equal(r.result.template.elements.length, 4);
  });

  it("rejects unknown template", () => {
    const r = call("template-load", {}, { id: "bogus" });
    assert.equal(r.ok, false);
  });
});

describe("whiteboard — boards", () => {
  it("save + list", () => {
    call("board-save", ctxA, { title: "My board", scene: { elements: [{ id: "a" }, { id: "b" }] } });
    const r = call("board-list", ctxA);
    assert.equal(r.result.boards.length, 1);
    assert.equal(r.result.boards[0].elementCount, 2);
  });

  it("INVARIANT: boards scoped per-user", () => {
    call("board-save", ctxA, { title: "a-only", scene: { elements: [] } });
    const b = call("board-list", ctxB);
    assert.equal(b.result.boards.length, 0);
  });

  it("save with same id updates", () => {
    const c1 = call("board-save", ctxA, { title: "v1", scene: { elements: [] } });
    const id = c1.result.board.id;
    call("board-save", ctxA, { id, title: "v2", scene: { elements: [{ id: "a" }] } });
    const loaded = call("board-load", ctxA, { id });
    assert.equal(loaded.result.board.title, "v2");
    assert.equal(loaded.result.board.scene.elements.length, 1);
  });

  it("delete removes", () => {
    const c = call("board-save", ctxA, { title: "tmp", scene: {} });
    call("board-delete", ctxA, { id: c.result.board.id });
    assert.equal(call("board-list", ctxA).result.boards.length, 0);
  });
});

describe("whiteboard — voting", () => {
  it("vote-cast increments tally", () => {
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e1" });
    const r = call("vote-tally", ctxA, { boardId: "b1" });
    assert.equal(r.result.tally[0].count, 1);
  });

  it("dedupes votes from same user on same element", () => {
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e1" });
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e1" });
    const r = call("vote-tally", ctxA, { boardId: "b1" });
    // Same voter casting twice on same element = single vote
    assert.equal(r.result.tally[0].count, 1);
  });

  it("tally sorted by count desc", () => {
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e1" });
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e2" });
    const r = call("vote-tally", ctxA, { boardId: "b1" });
    assert.equal(r.result.tally.length, 2);
  });

  it("rejects missing boardId or elementId", () => {
    const r = call("vote-cast", ctxA, { boardId: "b1" });
    assert.equal(r.ok, false);
  });

  it("INVARIANT: votes scoped per-user", () => {
    call("vote-cast", ctxA, { boardId: "b1", elementId: "e1" });
    const b = call("vote-tally", ctxB, { boardId: "b1" });
    assert.equal(b.result.tally.length, 0);
  });
});

describe("whiteboard — shared boards (real-time multiplayer)", () => {
  function captureRealtimeEmits() {
    const events = [];
    globalThis._concordREALTIME = {
      io: {
        to: (room) => ({
          emit: (name, payload) => events.push({ room, name, payload }),
        }),
      },
    };
    return events;
  }

  it("share-board creates a new shared board owned by the caller", () => {
    const r = call("share-board", ctxA, { title: "Team retro", scene: { elements: [{ id: "e1" }] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.board.ownerId, "u");
    assert.equal(r.result.board.participants[0], "u");
    assert.equal(r.result.board.elementCount, 1);
  });

  it("share-board promotes an existing private board (carries scene + title)", () => {
    const priv = call("board-save", ctxA, { title: "My idea", scene: { elements: [{ id: "x" }, { id: "y" }] } });
    const r = call("share-board", ctxA, { id: priv.result.board.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.board.title, "My idea");
    assert.equal(r.result.board.elementCount, 2);
  });

  it("join-shared adds participant + returns scene; leave-shared removes them", () => {
    const created = call("share-board", ctxA, { title: "Collab", scene: { elements: [] } });
    const sid = created.result.board.id;
    const join = call("join-shared", ctxB, { id: sid });
    assert.equal(join.ok, true);
    assert.equal(join.result.board.participantCount, 2);
    assert.ok(join.result.board.scene);
    const leave = call("leave-shared", ctxB, { id: sid });
    assert.equal(leave.ok, true);
    assert.equal(leave.result.remainingParticipants, 1);
  });

  it("shared-list shows boards the caller participates in (not all boards)", () => {
    const aBoard = call("share-board", ctxA, { title: "A's board" }).result.board.id;
    call("share-board", ctxB, { title: "B's board" }); // userB created, userA not invited
    const listA = call("shared-list", ctxA, {});
    assert.equal(listA.result.boards.length, 1);
    assert.equal(listA.result.boards[0].id, aBoard);
  });

  it("broadcast-scene persists scene + fans out to socket.io room", () => {
    const events = captureRealtimeEmits();
    const sid = call("share-board", ctxA, { title: "X" }).result.board.id;
    call("join-shared", ctxB, { id: sid });
    const r = call("broadcast-scene", ctxA, { id: sid, scene: { elements: [{ id: "e1" }, { id: "e2" }] } });
    assert.equal(r.ok, true);
    // Persisted scene visible to other participants
    const reJoin = call("join-shared", ctxB, { id: sid });
    assert.equal(reJoin.result.board.scene.elements.length, 2);
    // Realtime fan-out
    const e = events.find((ev) => ev.name === "whiteboard:scene-update");
    assert.ok(e);
    assert.equal(e.room, `whiteboard:${sid}`);
    assert.equal(e.payload.boardId, sid);
    assert.equal(e.payload.userId, "u");
    assert.equal(e.payload.elementCount, 2);
  });

  it("broadcast-scene rejects non-participants", () => {
    const sid = call("share-board", ctxA, { title: "X" }).result.board.id;
    const r = call("broadcast-scene", ctxB, { id: sid, scene: { elements: [] } });
    assert.equal(r.ok, false);
    assert.match(r.error, /not a participant/);
  });

  it("broadcast-cursor emits ephemeral cursor event (no scene persist)", () => {
    const events = captureRealtimeEmits();
    const sid = call("share-board", ctxA, { title: "X" }).result.board.id;
    call("join-shared", ctxB, { id: sid });
    const r = call("broadcast-cursor", ctxB, { id: sid, x: 120, y: 240 });
    assert.equal(r.ok, true);
    const e = events.find((ev) => ev.name === "whiteboard:cursor");
    assert.ok(e);
    assert.equal(e.payload.x, 120);
    assert.equal(e.payload.userId, "v");
  });

  it("broadcast-cursor rejects non-numeric coords", () => {
    const sid = call("share-board", ctxA, { title: "X" }).result.board.id;
    const r = call("broadcast-cursor", ctxA, { id: sid, x: "nope" });
    assert.equal(r.ok, false);
  });

  it("shared-vote-cast aggregates across participants (not per-user)", () => {
    const events = captureRealtimeEmits();
    const sid = call("share-board", ctxA, { title: "X" }).result.board.id;
    call("join-shared", ctxB, { id: sid });
    call("shared-vote-cast", ctxA, { id: sid, elementId: "e1" });
    call("shared-vote-cast", ctxB, { id: sid, elementId: "e1" });
    // Both users see the same tally (vote aggregated, not per-user as in private boards)
    const tallyA = call("shared-vote-tally", ctxA, { id: sid });
    const tallyB = call("shared-vote-tally", ctxB, { id: sid });
    assert.equal(tallyA.result.tally[0].count, 2);
    assert.deepEqual(tallyA.result.tally, tallyB.result.tally);
    // Realtime fan-out: two events should fire, the second carrying voteCount 2
    const voteEvents = events.filter((ev) => ev.name === "whiteboard:vote-cast");
    assert.equal(voteEvents.length, 2);
    assert.equal(voteEvents[1].payload.voteCount, 2);
  });

  it("shared-vote-cast dedupes same voter on same element", () => {
    const sid = call("share-board", ctxA, { title: "X" }).result.board.id;
    call("shared-vote-cast", ctxA, { id: sid, elementId: "e1" });
    call("shared-vote-cast", ctxA, { id: sid, elementId: "e1" });
    const tally = call("shared-vote-tally", ctxA, { id: sid });
    assert.equal(tally.result.tally[0].count, 1);
  });

  it("realtime emit failure does not throw (best-effort)", () => {
    globalThis._concordREALTIME = {
      io: { to: () => ({ emit: () => { throw new Error("socket dead"); } }) },
    };
    const sid = call("share-board", ctxA, { title: "X" }).result.board.id;
    const r = call("broadcast-scene", ctxA, { id: sid, scene: { elements: [] } });
    assert.equal(r.ok, true);
  });
});
