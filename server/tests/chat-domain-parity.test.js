// Tier-2 contract tests for chat lens parity macros
// (projects / prompts / threads-search / branches / scheduled).
// Pins per-user scoping + input validation + idempotency.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerChatActions from "../domains/chat.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`chat.${name}`);
  if (!fn) throw new Error(`chat.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerChatActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => {
    throw new Error("network disabled");
  };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("chat — projects parity", () => {
  it("creates a project and returns it on list", () => {
    const created = call("project-create", ctxA, {
      name: "Q1 planning",
      systemPrompt: "You are a planning assistant.",
      color: "emerald",
    });
    assert.equal(created.ok, true);
    assert.ok(created.result.project.id);
    assert.equal(created.result.project.name, "Q1 planning");
    assert.equal(created.result.project.systemPrompt, "You are a planning assistant.");
    assert.equal(created.result.project.color, "emerald");

    const listed = call("projects-list", ctxA);
    assert.equal(listed.ok, true);
    assert.equal(listed.result.projects.length, 1);
    assert.equal(listed.result.projects[0].id, created.result.project.id);
  });

  it("rejects empty name on create", () => {
    const r = call("project-create", ctxA, { name: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /name required/);
  });

  it("rejects oversized name (>80 chars)", () => {
    const r = call("project-create", ctxA, { name: "x".repeat(81) });
    assert.equal(r.ok, false);
    assert.match(r.error, /name too long/);
  });

  it("INVARIANT: per-user scoping — user A's projects invisible to user B", () => {
    call("project-create", ctxA, { name: "user-a-secret" });
    const listB = call("projects-list", ctxB);
    assert.equal(listB.ok, true);
    assert.equal(listB.result.projects.length, 0);
  });

  it("update preserves id + updates updatedAt", async () => {
    const c = call("project-create", ctxA, { name: "v1" });
    const id = c.result.project.id;
    const originalUpdated = c.result.project.updatedAt;
    await new Promise((r) => { setTimeout(r, 2); });
    const u = call("project-update", ctxA, { id, name: "v2", color: "rose" });
    assert.equal(u.ok, true);
    assert.equal(u.result.project.id, id);
    assert.equal(u.result.project.name, "v2");
    assert.equal(u.result.project.color, "rose");
    assert.notEqual(u.result.project.updatedAt, originalUpdated);
  });

  it("update rejects clearing name to empty string", () => {
    const c = call("project-create", ctxA, { name: "keep" });
    const r = call("project-update", ctxA, { id: c.result.project.id, name: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /cannot be empty/);
  });

  it("delete removes from list", () => {
    const c = call("project-create", ctxA, { name: "tmp" });
    const d = call("project-delete", ctxA, { id: c.result.project.id });
    assert.equal(d.ok, true);
    const l = call("projects-list", ctxA);
    assert.equal(l.result.projects.length, 0);
  });

  it("get returns 404-shape on unknown id", () => {
    const r = call("project-get", ctxA, { id: "proj_nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});

describe("chat — saved prompts parity", () => {
  it("creates a prompt with shortcut sanitized", () => {
    const r = call("prompt-create", ctxA, {
      name: "Review checklist",
      content: "Walk through PR using these criteria: ...",
      tags: ["dev", "review"],
      shortcut: "Review!Now",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.prompt.name, "Review checklist");
    assert.equal(r.result.prompt.shortcut, "reviewnow");
    assert.deepEqual(r.result.prompt.tags, ["dev", "review"]);
  });

  it("rejects empty content", () => {
    const r = call("prompt-create", ctxA, { name: "x", content: "  " });
    assert.equal(r.ok, false);
    assert.match(r.error, /content required/);
  });

  it("INVARIANT: per-user scoping — user A's prompts invisible to user B", () => {
    call("prompt-create", ctxA, { name: "secret", content: "do not share" });
    const list = call("prompts-list", ctxB);
    assert.equal(list.result.prompts.length, 0);
  });

  it("update sanitizes shortcut on edit", () => {
    const c = call("prompt-create", ctxA, { name: "n", content: "c" });
    const u = call("prompt-update", ctxA, {
      id: c.result.prompt.id,
      shortcut: "WITH$$Special@#chars",
    });
    assert.equal(u.ok, true);
    assert.equal(u.result.prompt.shortcut, "withspecialchars");
  });

  it("delete removes from list", () => {
    const c = call("prompt-create", ctxA, { name: "tmp", content: "x" });
    const d = call("prompt-delete", ctxA, { id: c.result.prompt.id });
    assert.equal(d.ok, true);
    assert.equal(call("prompts-list", ctxA).result.prompts.length, 0);
  });
});

describe("chat — thread search parity", () => {
  beforeEach(() => {
    call("thread-index", ctxA, {
      threadId: "t_alpha",
      title: "Notes on the Concordia faction war",
      snippet: "Discussion of strategy. The bear faction has declared war.",
      lastMsgAt: new Date(Date.now() - 86400_000).toISOString(),
    });
    call("thread-index", ctxA, {
      threadId: "t_beta",
      title: "Recipe brainstorm",
      snippet: "Trying to think through a new soup recipe.",
      lastMsgAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    call("thread-index", ctxA, {
      threadId: "t_gamma",
      title: "Bear migration patterns",
      snippet: "Studying how black bears move through the boreal forest.",
      lastMsgAt: new Date(Date.now() - 600_000).toISOString(),
    });
  });

  it("finds threads matching a term in title or snippet", () => {
    const r = call("threads-search", ctxA, { query: "bear" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hits.length, 2);
    const ids = r.result.hits.map((h) => h.threadId).sort();
    assert.deepEqual(ids, ["t_alpha", "t_gamma"]);
  });

  it("title hits outrank snippet-only hits", () => {
    const r = call("threads-search", ctxA, { query: "bear" });
    assert.equal(r.result.hits[0].threadId, "t_gamma");
  });

  it("rejects 1-char query", () => {
    const r = call("threads-search", ctxA, { query: "a" });
    assert.equal(r.ok, false);
    assert.match(r.error, /query too short/);
  });

  it("INVARIANT: search results scoped per-user", () => {
    const r = call("threads-search", ctxB, { query: "bear" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hits.length, 0);
  });

  it("re-indexing the same threadId replaces the entry", () => {
    call("thread-index", ctxA, {
      threadId: "t_alpha",
      title: "Renamed: Faction war retrospective",
      snippet: "We won.",
      lastMsgAt: new Date().toISOString(),
    });
    const r = call("threads-search", ctxA, { query: "retrospective" });
    assert.equal(r.result.hits.length, 1);
    assert.equal(r.result.hits[0].threadId, "t_alpha");
  });
});

describe("chat — branches parity", () => {
  it("forks at message index with seeded messages", () => {
    const r = call("branch-fork", ctxA, {
      sourceThreadId: "thread_x",
      atMessageIdx: 3,
      messages: [
        { role: "user", content: "one" },
        { role: "assistant", content: "two" },
        { role: "user", content: "three" },
        { role: "assistant", content: "four" },
        { role: "user", content: "five" },
      ],
      note: "explore alternate path",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.branch.sourceThreadId, "thread_x");
    assert.equal(r.result.branch.atMessageIdx, 3);
    assert.equal(r.result.branch.seededMessages.length, 4);
    assert.equal(r.result.branch.note, "explore alternate path");
  });

  it("rejects missing atMessageIdx", () => {
    const r = call("branch-fork", ctxA, { sourceThreadId: "t" });
    assert.equal(r.ok, false);
    assert.match(r.error, /atMessageIdx required/);
  });

  it("INVARIANT: branches are scoped per-user", () => {
    call("branch-fork", ctxA, {
      sourceThreadId: "t",
      atMessageIdx: 0,
      messages: [{ role: "user", content: "x" }],
    });
    const list = call("branches-list", ctxB);
    assert.equal(list.result.branches.length, 0);
  });

  it("list filters by sourceThreadId when provided", () => {
    call("branch-fork", ctxA, { sourceThreadId: "thread_x", atMessageIdx: 0, messages: [] });
    call("branch-fork", ctxA, { sourceThreadId: "thread_y", atMessageIdx: 0, messages: [] });
    const r = call("branches-list", ctxA, { sourceThreadId: "thread_x" });
    assert.equal(r.result.branches.length, 1);
    assert.equal(r.result.branches[0].sourceThreadId, "thread_x");
  });
});

describe("chat — scheduled tasks parity", () => {
  it("schedules a future task", () => {
    const r = call("scheduled-create", ctxA, {
      prompt: "Run a weekly recap.",
      runAt: new Date(Date.now() + 60_000).toISOString(),
      recurring: "weekly",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.task.status, "pending");
    assert.equal(r.result.task.recurring, "weekly");
  });

  it("rejects runAt in the past", () => {
    const r = call("scheduled-create", ctxA, {
      prompt: "x",
      runAt: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /must be in the future/);
  });

  it("rejects invalid timestamp", () => {
    const r = call("scheduled-create", ctxA, { prompt: "x", runAt: "not-a-date" });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid timestamp/);
  });

  it("ignores invalid recurring values (treats as one-shot)", () => {
    const r = call("scheduled-create", ctxA, {
      prompt: "x",
      runAt: new Date(Date.now() + 60_000).toISOString(),
      recurring: "yearly",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.task.recurring, null);
  });

  it("cancel marks status cancelled and stamps cancelledAt", () => {
    const c = call("scheduled-create", ctxA, {
      prompt: "x",
      runAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const r = call("scheduled-cancel", ctxA, { id: c.result.task.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.task.status, "cancelled");
    assert.ok(r.result.task.cancelledAt);
  });

  it("INVARIANT: tasks are scoped per-user", () => {
    call("scheduled-create", ctxA, {
      prompt: "user-a only",
      runAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const list = call("scheduled-list", ctxB);
    assert.equal(list.result.tasks.length, 0);
  });
});

describe("chat — STATE unavailable path", () => {
  it("returns error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("projects-list", ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
