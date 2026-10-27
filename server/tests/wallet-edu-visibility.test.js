// Cross-account safety wave, part 3: wallet social-feed "friends" visibility
// and education cohort/discussion lists follow their course's visibility.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerWalletActions from "../domains/wallet.js";
import registerEducationActions from "../domains/education.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
const call = (dom, name, ctx, params = {}) => {
  const fn = ACTIONS.get(`${dom}.${name}`);
  assert.ok(fn, `${dom}.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
};
const ctxOf = (u, db) => ({ actor: { userId: u }, userId: u, ...(db ? { db } : {}) });

function friendsDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE friendships (id TEXT PRIMARY KEY, requester_id TEXT NOT NULL, addressee_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL DEFAULT (unixepoch()), responded_at INTEGER);`);
  db.prepare("INSERT INTO friendships (id, requester_id, addressee_id, status) VALUES ('f1','user_a','user_friend','accepted')").run();
  db.prepare("INSERT INTO friendships (id, requester_id, addressee_id, status) VALUES ('f2','user_a','user_pending','pending')").run();
  return db;
}

before(() => { registerWalletActions(register); registerEducationActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  delete globalThis._concordDB;
});

describe("wallet feed visibility", () => {
  it("friends entries reach the author, the counterparty and accepted friends only", () => {
    const db = friendsDb();
    const pub = call("wallet", "feedPost", ctxOf("user_a", db), { counterparty: "user_x", note: "pub", visibility: "public" }).result.entry;
    const fr = call("wallet", "feedPost", ctxOf("user_a", db), { counterparty: "user_cp", note: "fr", visibility: "friends" }).result.entry;
    const pr = call("wallet", "feedPost", ctxOf("user_a", db), { counterparty: "user_cp", note: "pr", visibility: "private" }).result.entry;
    const ids = (u) => call("wallet", "feedList", ctxOf(u, db), {}).result.entries.map(e => e.id).sort();
    assert.deepEqual(ids("user_a"), [pub.id, fr.id, pr.id].sort());
    assert.deepEqual(ids("user_friend"), [pub.id, fr.id].sort());
    assert.deepEqual(ids("user_cp"), [pub.id, fr.id].sort());
    assert.deepEqual(ids("user_pending"), [pub.id]);
    assert.deepEqual(ids("user_stranger"), [pub.id]);
    assert.deepEqual(call("wallet", "feedList", { userId: "anon" }, {}).result.entries.map(e => e.id), [pub.id]);
    // can't like what you can't see
    assert.equal(call("wallet", "feedLike", ctxOf("user_stranger", db), { id: fr.id }).ok, false);
    assert.equal(call("wallet", "feedLike", ctxOf("user_friend", db), { id: fr.id }).ok, true);
  });

  it("with no friendships database, friends entries are author-only (plus counterparty)", () => {
    const fr = call("wallet", "feedPost", ctxOf("user_a"), { counterparty: "user_cp", note: "fr" }).result.entry;
    assert.equal(fr.visibility, "friends");
    assert.equal(call("wallet", "feedList", ctxOf("user_friend"), {}).result.entries.length, 0);
    assert.equal(call("wallet", "feedList", ctxOf("user_a"), {}).result.entries.length, 1);
  });
});

describe("education cohort/discussion lists follow course visibility", () => {
  it("draft course records are hidden from other accounts", () => {
    const A = ctxOf("user_a"), B = ctxOf("user_b");
    const draft = call("education", "courses-create", A, { title: "Draft", status: "draft" }).result.course;
    const pub = call("education", "courses-create", A, { title: "Pub" }).result.course;
    call("education", "cohorts-create", A, { title: "c-draft", instructor: "A", courseId: draft.id });
    call("education", "cohorts-create", A, { title: "c-pub", instructor: "A", courseId: pub.id });
    call("education", "discussions-post", A, { courseId: draft.id, text: "secret" });
    call("education", "discussions-post", A, { courseId: pub.id, text: "hello" });

    const titles = (ctx) => call("education", "cohorts-list", ctx, {}).result.cohorts.map(c => c.title).sort();
    assert.deepEqual(titles(A), ["c-draft", "c-pub"]);
    assert.deepEqual(titles(B), ["c-pub"]);
    assert.deepEqual(call("education", "cohorts-list", B, { courseId: draft.id }).result.cohorts, []);
    const texts = (ctx, p = {}) => call("education", "discussions-list", ctx, p).result.discussions.map(d => d.text).sort();
    assert.deepEqual(texts(A), ["hello", "secret"]);
    assert.deepEqual(texts(B), ["hello"]);
    assert.deepEqual(texts(B, { courseId: draft.id }), []);
    assert.deepEqual(texts({ userId: "anon" }), ["hello"]);
    // B can't post into or join the draft course's records either
    assert.equal(call("education", "discussions-post", B, { courseId: draft.id, text: "x" }).ok, false);
    const draftCohort = call("education", "cohorts-list", A, { courseId: draft.id }).result.cohorts[0];
    assert.equal(call("education", "cohorts-join", B, { id: draftCohort.id }).ok, false);
  });

  it("an enrolled learner keeps access after the course goes back to draft", () => {
    const A = ctxOf("user_a"), B = ctxOf("user_b");
    const course = call("education", "courses-create", A, { title: "Was public" }).result.course;
    call("education", "discussions-post", A, { courseId: course.id, text: "lesson 1" });
    assert.equal(call("education", "enrollments-enroll", B, { courseId: course.id }).ok, true);
    // unpublish directly in the in-memory catalog
    const lens = globalThis._concordSTATE.educationLens;
    const store = lens.courses instanceof Map ? lens.courses : null;
    assert.ok(store, "in-memory course catalog");
    const row = store.get(course.id) || [...store.values()].flat().find(c => c && c.id === course.id);
    row.status = "draft";
    assert.deepEqual(call("education", "discussions-list", B, { courseId: course.id }).result.discussions.map(d => d.text), ["lesson 1"]);
    assert.deepEqual(call("education", "discussions-list", ctxOf("user_c"), { courseId: course.id }).result.discussions, []);
  });
});
