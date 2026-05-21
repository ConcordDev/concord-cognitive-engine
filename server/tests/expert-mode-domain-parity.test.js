// Contract tests for server/domains/expert-mode.js — the Perplexity
// feature-parity macro surface: threaded conversation, focus modes,
// live web search, Pages/Spaces, related questions, upload-as-source,
// and answer export.
//
// Pattern mirrors server/tests/travel-domain-parity.test.js: a local
// register() collects the macros, then each macro is invoked with a
// real ctx and the `ok` contract is asserted. The brain HTTP call is
// stubbed via globalThis.fetch so `ask` / `ask_with_upload` exercise
// the full path without a live Ollama instance.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerExpertModeMacros from "../domains/expert-mode.js";
import { up as upMig170 } from "../migrations/170_byo_brain_overrides.js";

// ---- macro registry ------------------------------------------------------

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`expert_mode.${name}`);
  if (!fn) throw new Error(`expert_mode.${name} not registered`);
  return fn(ctx, input);
}

// ---- db fixture ----------------------------------------------------------

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
    "dtu_steel",
    "Refractory steel melt cycle calibration",
    "Refractory steel melt cycle calibration tables and analysis.",
    "claudia",
    "public",
    "anthropic",
    "claude-opus-4-7",
  );
  return db;
}

// A fake Ollama response that always includes a [1] citation marker so
// the citation-extraction + cascade path runs.
function stubBrainFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/chat")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: "Refractory steel calibration works as follows [1]." },
          prompt_eval_count: 10,
          eval_count: 8,
        }),
      };
    }
    // Web search / anything else — return empty so liveWebSources yields [].
    return { ok: false, status: 503, json: async () => ({}) };
  };
}

const ctxA = (db) => ({ db, actor: { userId: "user_a" }, userId: "user_a" });

before(() => {
  registerExpertModeMacros(register);
});

beforeEach(() => {
  // Default: network disabled. Tests that need the brain opt in.
  globalThis.fetch = async () => {
    throw new Error("network disabled in tests");
  };
  // Fresh per-user store each test.
  if (globalThis._concordSTATE) delete globalThis._concordSTATE._expertMode;
});

afterEach(() => {
  delete globalThis.fetch;
});

// ---- core / utility ------------------------------------------------------

describe("expert_mode focus + utility macros", () => {
  it("focus_modes lists the five behavioural modes", async () => {
    const r = await call("focus_modes", ctxA(setupDb()));
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.modes));
    const ids = r.modes.map((m) => m.id);
    for (const expected of ["all", "academic", "writing", "math", "video"]) {
      assert.ok(ids.includes(expected), `missing focus mode ${expected}`);
    }
  });

  it("sources_preview returns corpus rows without a brain call", async () => {
    const db = setupDb();
    const r = await call("sources_preview", ctxA(db), {
      query: "refractory steel calibration",
    });
    assert.equal(r.ok, true);
    assert.ok(r.sources.length >= 1);
  });

  it("extract_citations parses [N] markers", async () => {
    const r = await call("extract_citations", ctxA(setupDb()), {
      text: "Claim one [1]. Claim two [2, 3].",
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.indices, [1, 2, 3]);
  });

  it("related_questions derives grounded follow-ups", async () => {
    const r = await call("related_questions", ctxA(setupDb()), {
      query: "How does refractory steel calibration work?",
      answer: "Refractory steel calibration depends on the melt cycle temperature.",
    });
    assert.equal(r.ok, true);
    assert.ok(r.questions.length >= 1);
  });

  it("web_search returns an ok envelope even when the web stack is offline", async () => {
    const r = await call("web_search", ctxA(setupDb()), { query: "anything" });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.results));
  });
});

// ---- threaded conversation ----------------------------------------------

describe("expert_mode threaded conversation", () => {
  it("ask creates a thread, returns a turn + related questions", async () => {
    stubBrainFetch();
    const db = setupDb();
    const r = await call("ask", ctxA(db), {
      query: "How does refractory steel calibration work?",
      focus: "academic",
      useWeb: false,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.threadId);
    assert.ok(r.turn && typeof r.turn.answer === "string");
    assert.equal(r.turnCount, 1);
    assert.ok(Array.isArray(r.relatedQuestions));
  });

  it("ask folds a follow-up into the same thread", async () => {
    stubBrainFetch();
    const ctx = ctxA(setupDb());
    const first = await call("ask", ctx, { query: "What is steel?", useWeb: false });
    assert.equal(first.ok, true);
    const followup = await call("ask", ctx, {
      query: "Why does it matter?",
      threadId: first.threadId,
      useWeb: false,
    });
    assert.equal(followup.ok, true);
    assert.equal(followup.turnCount, 2);
    assert.equal(followup.threadId, first.threadId);
  });

  it("thread_list / thread_get / thread_delete round-trip", async () => {
    stubBrainFetch();
    const ctx = ctxA(setupDb());
    const asked = await call("ask", ctx, { query: "Steel question", useWeb: false });
    const list = await call("thread_list", ctx);
    assert.equal(list.ok, true);
    assert.equal(list.total, 1);

    const got = await call("thread_get", ctx, { threadId: asked.threadId });
    assert.equal(got.ok, true);
    assert.equal(got.thread.turns.length, 1);

    const del = await call("thread_delete", ctx, { threadId: asked.threadId });
    assert.equal(del.ok, true);
    const afterList = await call("thread_list", ctx);
    assert.equal(afterList.total, 0);
  });

  it("ask rejects a missing query", async () => {
    const r = await call("ask", ctxA(setupDb()), { query: "" });
    assert.equal(r.ok, false);
  });
});

// ---- Pages / Spaces ------------------------------------------------------

describe("expert_mode Pages / Spaces", () => {
  it("space create / add / get / share / remove / delete round-trip", async () => {
    const ctx = ctxA(setupDb());
    const created = await call("space_create", ctx, {
      name: "Steel research",
      description: "metallurgy notes",
    });
    assert.equal(created.ok, true);
    const spaceId = created.space.id;

    const added = await call("space_add_answer", ctx, {
      spaceId,
      query: "What is steel?",
      answer: "Steel is an iron-carbon alloy [1].",
      sources: [{ idx: 1, id: "dtu_steel", title: "Steel" }],
    });
    assert.equal(added.ok, true);
    assert.equal(added.answerCount, 1);

    const got = await call("space_get", ctx, { spaceId });
    assert.equal(got.ok, true);
    assert.equal(got.space.answers.length, 1);
    assert.equal(got.owner, true);

    const shared = await call("space_share", ctx, { spaceId });
    assert.equal(shared.ok, true);
    assert.ok(shared.shareToken);
    assert.ok(shared.shareUrl.includes(spaceId));

    // Non-owner can read with the token.
    const stranger = { db: ctx.db, actor: { userId: "user_b" }, userId: "user_b" };
    const strangerGet = await call("space_get", stranger, {
      spaceId,
      shareToken: shared.shareToken,
    });
    assert.equal(strangerGet.ok, true);
    assert.equal(strangerGet.owner, false);

    const removed = await call("space_remove_answer", ctx, {
      spaceId,
      answerId: added.entry.id,
    });
    assert.equal(removed.ok, true);
    assert.equal(removed.answerCount, 0);

    const list = await call("space_list", ctx);
    assert.equal(list.ok, true);
    assert.equal(list.total, 1);

    const deleted = await call("space_delete", ctx, { spaceId });
    assert.equal(deleted.ok, true);
  });

  it("space_get forbids a non-owner without a token", async () => {
    const ctx = ctxA(setupDb());
    const created = await call("space_create", ctx, { name: "Private space" });
    const stranger = { db: ctx.db, actor: { userId: "user_b" }, userId: "user_b" };
    const r = await call("space_get", stranger, { spaceId: created.space.id });
    assert.equal(r.ok, false);
  });
});

// ---- upload-as-source ----------------------------------------------------

describe("expert_mode upload-as-source", () => {
  it("upload_source / upload_list / upload_delete round-trip", async () => {
    const ctx = ctxA(setupDb());
    const up = await call("upload_source", ctx, {
      name: "report.pdf",
      text: "This document covers refractory steel melt-cycle calibration in depth.",
    });
    assert.equal(up.ok, true);
    assert.ok(up.upload.id);
    assert.ok(up.upload.chars > 0);

    const list = await call("upload_list", ctx);
    assert.equal(list.ok, true);
    assert.equal(list.total, 1);

    const del = await call("upload_delete", ctx, { uploadId: up.upload.id });
    assert.equal(del.ok, true);
    const afterList = await call("upload_list", ctx);
    assert.equal(afterList.total, 0);
  });

  it("upload_source rejects empty text", async () => {
    const r = await call("upload_source", ctxA(setupDb()), { name: "x", text: "" });
    assert.equal(r.ok, false);
  });

  it("ask_with_upload grounds an answer in the uploaded document", async () => {
    stubBrainFetch();
    const ctx = ctxA(setupDb());
    const up = await call("upload_source", ctx, {
      name: "notes.txt",
      text: "Refractory steel calibration relies on a controlled melt cycle.",
    });
    const r = await call("ask_with_upload", ctx, {
      query: "Summarise the document.",
      uploadId: up.upload.id,
      focus: "writing",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.sources.length >= 1);
    assert.equal(r.sources[0].origin, "upload");
    assert.ok(Array.isArray(r.relatedQuestions));
  });
});

// ---- answer export ------------------------------------------------------

describe("expert_mode answer export", () => {
  it("export_markdown renders portable markdown", async () => {
    const r = await call("export_markdown", ctxA(setupDb()), {
      query: "What is steel?",
      answer: "Steel is an iron-carbon alloy [1].",
      sources: [{ idx: 1, id: "dtu_steel", title: "Steel", creatorId: "claudia" }],
      title: "Metallurgy",
    });
    assert.equal(r.ok, true);
    assert.ok(r.markdown.includes("# Metallurgy"));
    assert.ok(r.markdown.includes("Steel is an iron-carbon alloy"));
    assert.ok(r.bytes > 0);
  });

  it("export_thread_markdown exports a whole thread", async () => {
    stubBrainFetch();
    const ctx = ctxA(setupDb());
    const asked = await call("ask", ctx, { query: "Steel?", useWeb: false });
    const r = await call("export_thread_markdown", ctx, { threadId: asked.threadId });
    assert.equal(r.ok, true);
    assert.equal(r.turnCount, 1);
    assert.ok(r.markdown.length > 0);
  });

  it("share_answer mints a token and share_resolve resolves it", async () => {
    const ctx = ctxA(setupDb());
    const shared = await call("share_answer", ctx, {
      query: "What is steel?",
      answer: "An alloy [1].",
      sources: [],
    });
    assert.equal(shared.ok, true);
    assert.ok(shared.shareToken);

    const resolved = await call("share_resolve", ctxA(setupDb()), {
      shareToken: shared.shareToken,
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.kind, "answer");
    assert.equal(resolved.answer.query, "What is steel?");
  });

  it("share_resolve rejects an unknown token", async () => {
    const r = await call("share_resolve", ctxA(setupDb()), { shareToken: "nope" });
    assert.equal(r.ok, false);
  });
});
