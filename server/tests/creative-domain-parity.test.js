// Contract tests for the creative Milanote 2026-parity visual board
// tool (boards, positioned cards, connections, templates).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCreativeActions from "../domains/creative.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`creative.${name}`);
  assert.ok(fn, `creative.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCreativeActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newBoard(ctx = ctxA) {
  const r = call("board-create", ctx, { title: "Campaign ideas" });
  assert.equal(r.ok, true);
  return r.result.board.id;
}

describe("creative.board-*", () => {
  it("creates, lists with card counts, renames and deletes", () => {
    const bid = newBoard();
    call("card-add", ctxA, { boardId: bid, type: "note", content: "Idea" });
    const list = call("board-list", ctxA, {});
    assert.equal(list.result.boards[0].cardCount, 1);
    call("board-rename", ctxA, { id: bid, title: "Final ideas" });
    assert.equal(call("board-get", ctxA, { id: bid }).result.board.title, "Final ideas");
    call("board-delete", ctxA, { id: bid });
    assert.equal(call("board-list", ctxA, {}).result.count, 0);
  });

  it("isolates boards per user", () => {
    newBoard(ctxA);
    assert.equal(call("board-list", ctxB, {}).result.count, 0);
  });

  it("duplicates a board with its cards and connections", () => {
    const bid = newBoard();
    const c1 = call("card-add", ctxA, { boardId: bid, type: "note", content: "A" }).result.card;
    const c2 = call("card-add", ctxA, { boardId: bid, type: "note", content: "B" }).result.card;
    call("connection-add", ctxA, { fromCardId: c1.id, toCardId: c2.id });
    const dup = call("board-duplicate", ctxA, { id: bid }).result.board;
    const got = call("board-get", ctxA, { id: dup.id });
    assert.equal(got.result.cards.length, 2);
    assert.equal(got.result.connections.length, 1);
  });
});

describe("creative cards", () => {
  it("adds cards with a type and increasing z-order", () => {
    const bid = newBoard();
    const c1 = call("card-add", ctxA, { boardId: bid, type: "task", content: "Do this" }).result.card;
    const c2 = call("card-add", ctxA, { boardId: bid, type: "note", content: "Note" }).result.card;
    assert.ok(c2.z > c1.z);
  });

  it("updates content, moves and toggles done", () => {
    const bid = newBoard();
    const c = call("card-add", ctxA, { boardId: bid, type: "task", content: "x" }).result.card;
    call("card-update", ctxA, { cardId: c.id, content: "updated", done: true });
    call("card-move", ctxA, { cardId: c.id, x: 400, y: 300 });
    const got = call("board-get", ctxA, { id: bid }).result.cards[0];
    assert.equal(got.content, "updated");
    assert.equal(got.done, true);
    assert.equal(got.x, 400);
  });

  it("card-raise bumps a card to the top", () => {
    const bid = newBoard();
    const c1 = call("card-add", ctxA, { boardId: bid, type: "note", content: "A" }).result.card;
    const c2 = call("card-add", ctxA, { boardId: bid, type: "note", content: "B" }).result.card;
    const r = call("card-raise", ctxA, { cardId: c1.id });
    assert.ok(r.result.z > c2.z);
  });

  it("deletes a card and its connections", () => {
    const bid = newBoard();
    const c1 = call("card-add", ctxA, { boardId: bid, type: "note", content: "A" }).result.card;
    const c2 = call("card-add", ctxA, { boardId: bid, type: "note", content: "B" }).result.card;
    call("connection-add", ctxA, { fromCardId: c1.id, toCardId: c2.id });
    call("card-delete", ctxA, { cardId: c1.id });
    const got = call("board-get", ctxA, { id: bid });
    assert.equal(got.result.cards.length, 1);
    assert.equal(got.result.connections.length, 0);
  });
});

describe("creative connections", () => {
  it("connects two cards and rejects bad connections", () => {
    const bid = newBoard();
    const c1 = call("card-add", ctxA, { boardId: bid, type: "note", content: "A" }).result.card;
    const c2 = call("card-add", ctxA, { boardId: bid, type: "note", content: "B" }).result.card;
    assert.equal(call("connection-add", ctxA, { fromCardId: c1.id, toCardId: c1.id }).ok, false);
    const conn = call("connection-add", ctxA, { fromCardId: c1.id, toCardId: c2.id }).result.connection;
    assert.equal(call("connection-add", ctxA, { fromCardId: c1.id, toCardId: c2.id }).ok, false);
    call("connection-delete", ctxA, { id: conn.id });
    assert.equal(call("board-get", ctxA, { id: bid }).result.connections.length, 0);
  });
});

describe("creative templates & dashboard", () => {
  it("lists templates and seeds a board from one", () => {
    assert.ok(call("board-templates", ctxA, {}).result.templates.length >= 4);
    const r = call("board-from-template", ctxA, { templateId: "story-outline", title: "My Story" });
    assert.ok(r.result.cardsSeeded > 0);
    const got = call("board-get", ctxA, { id: r.result.board.id });
    assert.equal(got.result.cards.length, r.result.cardsSeeded);
  });

  it("rejects an unknown template", () => {
    assert.equal(call("board-from-template", ctxA, { templateId: "nope" }).ok, false);
  });

  it("dashboard counts boards, cards and tasks", () => {
    const bid = newBoard();
    call("card-add", ctxA, { boardId: bid, type: "task", content: "open" });
    const done = call("card-add", ctxA, { boardId: bid, type: "task", content: "done" }).result.card;
    call("card-update", ctxA, { cardId: done.id, done: true });
    const d = call("creative-dashboard", ctxA, {});
    assert.equal(d.result.boards, 1);
    assert.equal(d.result.openTasks, 1);
    assert.equal(d.result.doneTasks, 1);
  });
});

// ── Feature 1: Frame-accurate review comments ────────────────────────
describe("creative review assets & comments", () => {
  it("creates a video review asset, lists it and deletes it", () => {
    const r = call("review-asset-create", ctxA, { name: "Cut v1", kind: "video", durationSec: 120 });
    assert.equal(r.ok, true);
    assert.equal(r.result.asset.kind, "video");
    const list = call("review-asset-list", ctxA, {});
    assert.equal(list.result.count, 1);
    call("review-asset-delete", ctxA, { id: r.result.asset.id });
    assert.equal(call("review-asset-list", ctxA, {}).result.count, 0);
  });

  it("adds a frame-accurate comment, resolves and deletes it", () => {
    const a = call("review-asset-create", ctxA, { name: "Edit", kind: "video", durationSec: 60 }).result.asset;
    const c = call("review-comment-add", ctxA, { assetId: a.id, body: "Cut here", timestampSec: 12.5 });
    assert.equal(c.ok, true);
    assert.equal(c.result.comment.timestampSec, 12.5);
    const listed = call("review-comment-list", ctxA, { assetId: a.id });
    assert.equal(listed.result.count, 1);
    const res = call("review-comment-resolve", ctxA, { id: c.result.comment.id, resolved: true });
    assert.equal(res.result.comment.resolved, true);
    call("review-comment-delete", ctxA, { id: c.result.comment.id });
    assert.equal(call("review-comment-list", ctxA, { assetId: a.id }).result.count, 0);
  });

  it("rejects a comment with no body", () => {
    const a = call("review-asset-create", ctxA, { name: "X", kind: "image" }).result.asset;
    assert.equal(call("review-comment-add", ctxA, { assetId: a.id, body: "" }).ok, false);
  });
});

// ── Feature 2: Call sheet generator ──────────────────────────────────
describe("creative call sheets", () => {
  it("creates a call sheet, adds rows and recomputes general call", () => {
    const cs = call("callsheet-create", ctxA, { project: "Spot", shootDate: "2026-06-01", generalCall: "09:00" });
    assert.equal(cs.ok, true);
    const id = cs.result.sheet.id;
    call("callsheet-add-row", ctxA, { id, section: "cast", name: "Lead", role: "Hero", callTime: "07:30" });
    call("callsheet-add-row", ctxA, { id, section: "crew", name: "DP", department: "Camera", callTime: "08:00" });
    call("callsheet-add-row", ctxA, { id, section: "locations", name: "Studio A", address: "1 Main" });
    const got = call("callsheet-get", ctxA, { id });
    assert.equal(got.result.sheet.cast.length, 1);
    assert.equal(got.result.sheet.crew.length, 1);
    // earliest call time wins
    assert.equal(got.result.sheet.generalCall, "07:30");
  });

  it("removes a row and deletes the sheet", () => {
    const id = call("callsheet-create", ctxA, { project: "P" }).result.sheet.id;
    const row = call("callsheet-add-row", ctxA, { id, section: "schedule", time: "10:00", scene: "Scene 1" }).result.sheet.schedule[0];
    call("callsheet-remove-row", ctxA, { id, section: "schedule", rowId: row.id });
    assert.equal(call("callsheet-get", ctxA, { id }).result.sheet.schedule.length, 0);
    call("callsheet-delete", ctxA, { id });
    assert.equal(call("callsheet-list", ctxA, {}).result.count, 0);
  });

  it("rejects a call sheet without a project", () => {
    assert.equal(call("callsheet-create", ctxA, {}).ok, false);
  });
});

// ── Feature 3: Script breakdown ──────────────────────────────────────
describe("creative script breakdown", () => {
  const SCRIPT = "INT. KITCHEN - DAY\n\nJANE\nHello there.\n\nEXT. PARK - NIGHT\n\nBOB\nHi.";

  it("creates a breakdown and auto-extracts cast + locations", () => {
    const r = call("breakdown-create", ctxA, { title: "Pilot", script: SCRIPT });
    assert.equal(r.ok, true);
    assert.ok(r.result.suggestions.cast.includes("JANE"));
    assert.ok(r.result.suggestions.locations.includes("KITCHEN"));
  });

  it("tags and untags categories", () => {
    const bd = call("breakdown-create", ctxA, { title: "T", script: "" }).result.breakdown;
    const tagged = call("breakdown-tag", ctxA, { id: bd.id, category: "props", value: "Chair" });
    assert.equal(tagged.result.breakdown.tags.props.length, 1);
    const tagId = tagged.result.breakdown.tags.props[0].id;
    call("breakdown-untag", ctxA, { id: bd.id, category: "props", tagId });
    assert.equal(call("breakdown-get", ctxA, { id: bd.id }).result.breakdown.tags.props.length, 0);
  });

  it("rescans an updated script and rejects bad categories", () => {
    const bd = call("breakdown-create", ctxA, { title: "T2", script: "" }).result.breakdown;
    const re = call("breakdown-rescan", ctxA, { id: bd.id, script: SCRIPT });
    assert.ok(re.result.suggestions.cast.length >= 1);
    assert.equal(call("breakdown-tag", ctxA, { id: bd.id, category: "bogus", value: "x" }).ok, false);
    call("breakdown-delete", ctxA, { id: bd.id });
    assert.equal(call("breakdown-list", ctxA, {}).result.count, 0);
  });
});

// ── Features 4 + 5: Version stacking + approval workflow ──────────────
describe("creative deliverables & approval workflow", () => {
  it("stacks versions and points currentVersion at the latest", () => {
    const d = call("deliverable-create", ctxA, { name: "Logo", note: "v1" }).result.deliverable;
    assert.equal(d.currentVersion, 1);
    const av = call("deliverable-add-version", ctxA, { id: d.id, note: "v2" });
    assert.equal(av.result.deliverable.currentVersion, 2);
    assert.equal(av.result.deliverable.versions.length, 2);
    const sc = call("deliverable-set-current", ctxA, { id: d.id, version: 1 });
    assert.equal(sc.result.deliverable.currentVersion, 1);
  });

  it("runs the submit → decide approval workflow", () => {
    const d = call("deliverable-create", ctxA, { name: "Banner" }).result.deliverable;
    const sub = call("deliverable-submit", ctxA, { id: d.id, reviewer: "Client" });
    assert.equal(sub.result.deliverable.status, "in_review");
    const dec = call("deliverable-decide", ctxA, { id: d.id, decision: "approved", note: "looks good" });
    assert.equal(dec.result.deliverable.status, "approved");
    // a new version reopens the deliverable
    const reopened = call("deliverable-add-version", ctxA, { id: d.id, note: "v2" });
    assert.equal(reopened.result.deliverable.status, "draft");
  });

  it("rejects deciding on a deliverable not in review", () => {
    const d = call("deliverable-create", ctxA, { name: "Z" }).result.deliverable;
    assert.equal(call("deliverable-decide", ctxA, { id: d.id, decision: "approved" }).ok, false);
    call("deliverable-delete", ctxA, { id: d.id });
  });
});

// ── Feature 6: Production calendar ───────────────────────────────────
describe("creative production calendar", () => {
  it("adds events, lists them and counts upcoming/overdue", () => {
    call("calendar-add", ctxA, { title: "Shoot", date: "2099-01-01", kind: "shoot_day" });
    call("calendar-add", ctxA, { title: "Past", date: "2000-01-01", kind: "milestone" });
    const list = call("calendar-list", ctxA, {});
    assert.equal(list.result.count, 2);
    assert.equal(list.result.upcoming, 1);
    assert.equal(list.result.overdue, 1);
  });

  it("updates and deletes events", () => {
    const ev = call("calendar-add", ctxA, { title: "Review", date: "2099-02-02", kind: "review" }).result.event;
    const up = call("calendar-update", ctxA, { id: ev.id, done: true });
    assert.equal(up.result.event.done, true);
    call("calendar-delete", ctxA, { id: ev.id });
    assert.equal(call("calendar-list", ctxA, { kind: "review" }).result.count, 0);
  });

  it("rejects an event with a bad date", () => {
    assert.equal(call("calendar-add", ctxA, { title: "Bad", date: "not-a-date" }).ok, false);
  });
});

// ── Feature 7: Shareable proof links + external comments ─────────────
describe("creative proof links", () => {
  it("creates a proof link, resolves it publicly and captures an external comment", () => {
    const asset = call("review-asset-create", ctxA, { name: "Final", kind: "video", durationSec: 90 }).result.asset;
    const lk = call("prooflink-create", ctxA, { assetId: asset.id, label: "Client review" });
    assert.equal(lk.ok, true);
    const token = lk.result.link.token;
    assert.ok(lk.result.shareUrl.includes(token));
    // public read works without auth context
    const pub = call("prooflink-public-get", {}, { token });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.asset.name, "Final");
    // external reviewer leaves a comment
    const xc = call("prooflink-public-comment", {}, { token, authorName: "Guest", body: "Looks great", timestampSec: 30 });
    assert.equal(xc.ok, true);
    // owner sees it in the inbox
    const inbox = call("prooflink-inbox", ctxA, {});
    assert.equal(inbox.result.count, 1);
    assert.equal(inbox.result.comments[0].body, "Looks great");
  });

  it("toggles a link inactive and blocks public access", () => {
    const asset = call("review-asset-create", ctxA, { name: "A2", kind: "image" }).result.asset;
    const lk = call("prooflink-create", ctxA, { assetId: asset.id }).result.link;
    call("prooflink-toggle", ctxA, { id: lk.id, active: false });
    assert.equal(call("prooflink-public-get", {}, { token: lk.token }).ok, false);
    call("prooflink-delete", ctxA, { id: lk.id });
  });

  it("rejects a public comment when commenting is disabled", () => {
    const asset = call("review-asset-create", ctxA, { name: "A3", kind: "image" }).result.asset;
    const lk = call("prooflink-create", ctxA, { assetId: asset.id, allowComments: false }).result.link;
    assert.equal(call("prooflink-public-comment", {}, { token: lk.token, body: "no" }).ok, false);
  });
});
