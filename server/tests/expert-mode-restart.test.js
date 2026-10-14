// INC-29 — Expert Mode threads, Spaces, uploads, and share tokens must
// survive the same snapshot the process writes on a clean shutdown.
//
// _serializeState() persists lens Maps only through
// lib/lens-state-persistence.js. A Map that is not on LENS_STATE_KEYS is
// omitted, and JSON.stringify(new Map()) is "{}" even if it were included
// raw. This test writes real macro state, round-trips the snapshot JSON
// the shutdown saver writes, drops the live process state, hydrates a
// fresh STATE, and checks the data and the ownership checks.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerExpertModeMacros from "../domains/expert-mode.js";
import { serializeLensState, hydrateLensState, LENS_STATE_KEYS } from "../lib/lens-state-persistence.js";
import { httpStatusForLensFailure } from "../lib/lens-run-http.js";
import { up as upMig170 } from "../migrations/170_byo_brain_overrides.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`expert_mode.${name}`);
  if (!fn) throw new Error(`expert_mode.${name} not registered`);
  return fn(ctx, input);
}

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT,
      creator_id TEXT,
      scope TEXT NOT NULL DEFAULT 'personal',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  upMig170(db);
  db.prepare(
    `INSERT INTO dtus (id, title, content, creator_id, scope, minted_by_provider, minted_by_model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "dtu_paris",
    "France",
    "Paris is the capital of France.",
    "editor",
    "public",
    "concord_default",
    "qwen",
  );
  return db;
}

function stubBrainFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/chat")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: "Paris is the capital of France [1]." },
          prompt_eval_count: 4,
          eval_count: 6,
        }),
      };
    }
    return { ok: false, status: 503, json: async () => ({}) };
  };
}

// What a clean shutdown does with lens state: serialize, JSON-encode the
// snapshot blob, then a new process hydrates from the parsed blob.
function restartFromSnapshot() {
  const persisted = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
  const next = {};
  hydrateLensState(next, persisted);
  globalThis._concordSTATE = next;
  return persisted;
}

const ctxA = (db) => ({ db, actor: { userId: "user_a" }, userId: "user_a" });
const ctxB = (db) => ({ db, actor: { userId: "user_b" }, userId: "user_b" });
const ctxAnon = (db) => ({ db });

before(() => {
  registerExpertModeMacros(register);
});

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("network disabled in tests");
  };
  globalThis._concordSTATE = {};
});

afterEach(() => {
  delete globalThis.fetch;
});

describe("expert mode survives a snapshot restart", () => {
  it("registers expertModeLens on the snapshot key list", () => {
    assert.ok(LENS_STATE_KEYS.includes("expertModeLens"));
  });

  it("restores threads, spaces with answers, upload text, and share tokens", async () => {
    stubBrainFetch();
    const db = setupDb();
    const owner = ctxA(db);

    const asked = await call("ask", owner, {
      query: "What is the capital of France?",
      focus: "writing",
      useWeb: false,
    });
    assert.equal(asked.ok, true, JSON.stringify(asked));
    const threadId = asked.threadId;

    const created = await call("space_create", owner, {
      name: "France notes",
      description: "capitals",
    });
    assert.equal(created.ok, true);
    const spaceId = created.space.id;
    const added = await call("space_add_answer", owner, {
      spaceId,
      query: "What is the capital of France?",
      answer: "Paris.",
      sources: [{ idx: 1, id: "dtu_paris", title: "France" }],
    });
    assert.equal(added.ok, true);
    const shared = await call("space_share", owner, { spaceId });
    assert.equal(shared.ok, true);

    const doc = "Primary source: Paris is the capital and largest city of France.";
    const up = await call("upload_source", owner, {
      name: "france.txt",
      kind: "text",
      text: doc,
    });
    assert.equal(up.ok, true);
    const uploadId = up.upload.id;

    const answerShare = await call("share_answer", owner, {
      query: "What is the capital of France?",
      answer: "Paris.",
      sources: [],
    });
    assert.equal(answerShare.ok, true);

    const blob = restartFromSnapshot();
    const lens = blob.expertModeLens;
    assert.equal(lens.threads.__type, "Map");
    assert.equal(lens.spaces.__type, "Map");
    assert.equal(lens.uploads.__type, "Map");
    assert.equal(lens.shares.__type, "Map");
    assert.ok(lens.threads.entries.some((e) => e[0] === threadId));

    const threads = await call("thread_list", owner);
    assert.equal(threads.ok, true);
    assert.equal(threads.total, 1);
    assert.equal(threads.threads[0].id, threadId);

    const thread = await call("thread_get", owner, { threadId });
    assert.equal(thread.ok, true);
    assert.equal(thread.thread.turns.length, 1);
    assert.equal(thread.thread.turns[0].query, "What is the capital of France?");
    assert.equal(thread.thread.turns[0].answer, "Paris is the capital of France [1].");
    assert.equal(thread.thread.userId, "user_a");

    const space = await call("space_get", owner, { spaceId });
    assert.equal(space.ok, true);
    assert.equal(space.owner, true);
    assert.equal(space.space.answers.length, 1);
    assert.equal(space.space.answers[0].id, added.entry.id);
    assert.equal(space.space.answers[0].answer, "Paris.");
    assert.equal(space.space.shareToken, shared.shareToken);

    const uploads = await call("upload_list", owner);
    assert.equal(uploads.ok, true);
    assert.equal(uploads.total, 1);
    assert.equal(uploads.uploads[0].id, uploadId);
    const restored = globalThis._concordSTATE.expertModeLens.uploads.get(uploadId);
    assert.equal(restored.text, doc);
    assert.equal(restored.chars, doc.length);

    const grounded = await call("ask_with_upload", owner, {
      query: "What does the document say the capital is?",
      uploadId,
      focus: "writing",
    });
    assert.equal(grounded.ok, true, JSON.stringify(grounded));
    assert.equal(grounded.sources[0].id, uploadId);

    const spaceLink = await call("share_resolve", ctxAnon(db), { shareToken: shared.shareToken });
    assert.equal(spaceLink.ok, true);
    assert.equal(spaceLink.kind, "space");
    assert.equal(spaceLink.space.id, spaceId);
    assert.equal(spaceLink.space.answers.length, 1);
    assert.equal(spaceLink.space.answers[0].answer, "Paris.");

    const answerLink = await call("share_resolve", ctxAnon(db), { shareToken: answerShare.shareToken });
    assert.equal(answerLink.ok, true);
    assert.equal(answerLink.kind, "answer");
    assert.equal(answerLink.answer.query, "What is the capital of France?");
    assert.equal(answerLink.answer.answer, "Paris.");
  });

  it("keeps cross-account isolation and the anonymous failure after reload", async () => {
    stubBrainFetch();
    const db = setupDb();
    const owner = ctxA(db);
    const other = ctxB(db);

    const asked = await call("ask", owner, {
      query: "What is the capital of France?",
      focus: "writing",
      useWeb: false,
    });
    const created = await call("space_create", owner, { name: "Private" });
    const up = await call("upload_source", owner, {
      name: "notes.txt",
      text: "Paris is the capital of France.",
    });
    assert.equal(asked.ok, true);
    assert.equal(created.ok, true);
    assert.equal(up.ok, true);

    restartFromSnapshot();

    const threadMiss = await call("thread_get", other, { threadId: asked.threadId });
    assert.equal(threadMiss.ok, false);
    assert.equal(threadMiss.reason, "thread_not_found");
    assert.equal(httpStatusForLensFailure(threadMiss.reason), 404);

    const otherThreads = await call("thread_list", other);
    assert.equal(otherThreads.ok, true);
    assert.equal(otherThreads.total, 0);

    const spaceMiss = await call("space_get", other, { spaceId: created.space.id });
    assert.equal(spaceMiss.ok, false);
    assert.equal(spaceMiss.reason, "forbidden");
    assert.equal(httpStatusForLensFailure(spaceMiss.reason), 403);

    const otherSpaces = await call("space_list", other);
    assert.equal(otherSpaces.ok, true);
    assert.equal(otherSpaces.total, 0);

    const uploadMiss = await call("ask_with_upload", other, {
      query: "Summarise.",
      uploadId: up.upload.id,
    });
    assert.equal(uploadMiss.ok, false);
    assert.equal(uploadMiss.reason, "upload_not_found");
    assert.equal(httpStatusForLensFailure(uploadMiss.reason), 404);
    const otherUploads = await call("upload_list", other);
    assert.equal(otherUploads.total, 0);

    // Gate 1 (authMiddleware) still 401s an unauthenticated POST
    // /api/lens/run before this domain runs. A call that arrives with
    // no user id fails closed here and does not read the owner's rows.
    const anonThread = await call("thread_get", ctxAnon(db), { threadId: asked.threadId });
    assert.equal(anonThread.ok, false);
    assert.equal(anonThread.reason, "no_actor");
    const anonList = await call("thread_list", ctxAnon(db));
    assert.equal(anonList.ok, false);
    assert.equal(anonList.reason, "no_actor");
    const anonSpace = await call("space_get", ctxAnon(db), { spaceId: created.space.id });
    assert.equal(anonSpace.ok, false);
    assert.equal(anonSpace.reason, "forbidden");
    const anonUpload = await call("upload_list", ctxAnon(db));
    assert.equal(anonUpload.ok, false);
    assert.equal(anonUpload.reason, "no_actor");

    const stillThere = await call("thread_get", owner, { threadId: asked.threadId });
    assert.equal(stillThere.ok, true);
    assert.equal(stillThere.thread.userId, "user_a");
  });

  it("rejects an over-cap upload so document text cannot blow the snapshot", async () => {
    const db = setupDb();
    const owner = ctxA(db);
    const tooBig = await call("upload_source", owner, {
      name: "huge.txt",
      text: "x".repeat(200_001),
    });
    assert.equal(tooBig.ok, false);
    assert.equal(tooBig.reason, "too_large");
    const atCap = await call("upload_source", owner, {
      name: "cap.txt",
      text: "y".repeat(200_000),
    });
    assert.equal(atCap.ok, true);
    restartFromSnapshot();
    const restored = globalThis._concordSTATE.expertModeLens.uploads.get(atCap.upload.id);
    assert.equal(restored.text.length, 200_000);
    const list = await call("upload_list", owner);
    assert.equal(list.total, 1);
    assert.equal(list.uploads[0].id, atCap.upload.id);
  });

  // F2 mandatory restart-persistence: name/content identical after
  // serialize/hydrate, still selectable for grounding, acct2 isolated.
  it("F2 stored source survives serialize/hydrate with identical name/content and acct2 isolation", async () => {
    stubBrainFetch();
    const db = setupDb();
    const owner = ctxA(db);
    const other = ctxB(db);
    const name = "Sweep source 20261014";
    const text = "Sweep document. The sweep token is MAGENTA-ORCHID-kznt. End of extract.";

    const up = await call("upload_source", owner, { name, kind: "text", text });
    assert.equal(up.ok, true, JSON.stringify(up));
    const uploadId = up.upload.id;
    assert.equal(up.upload.name, name);
    assert.equal(up.upload.chars, text.length);

    restartFromSnapshot();

    const list = await call("upload_list", owner);
    assert.equal(list.ok, true);
    assert.equal(list.total, 1);
    assert.equal(list.uploads[0].id, uploadId);
    assert.equal(list.uploads[0].name, name);
    assert.equal(list.uploads[0].chars, text.length);

    const restored = globalThis._concordSTATE.expertModeLens.uploads.get(uploadId);
    assert.ok(restored, "upload row present after hydrate");
    assert.equal(restored.name, name);
    assert.equal(restored.text, text);
    assert.equal(restored.userId, "user_a");

    const grounded = await call("ask_with_upload", owner, {
      query: "What is the sweep token in the uploaded document?",
      uploadId,
      focus: "writing",
    });
    assert.equal(grounded.ok, true, JSON.stringify(grounded));
    assert.equal(grounded.sources[0].id, uploadId);
    assert.equal(grounded.uploadName, name);

    const otherList = await call("upload_list", other);
    assert.equal(otherList.ok, true);
    assert.equal(otherList.total, 0);
    assert.ok(!otherList.uploads.some((u) => u.id === uploadId));

    const otherRead = await call("ask_with_upload", other, {
      query: "What is the sweep token?",
      uploadId,
      focus: "writing",
    });
    assert.equal(otherRead.ok, false);
    assert.equal(otherRead.reason, "upload_not_found");
    assert.equal(httpStatusForLensFailure(otherRead.reason), 404);
  });
});
