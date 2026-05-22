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

// ─── ChatGPT-parity backlog macros ───────────────────────────────────

describe("chat — voice mode parity", () => {
  it("voice-get returns defaults before any save", () => {
    const r = call("voice-get", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.prefs.enabled, false);
    assert.equal(r.result.prefs.ttsRate, 1.0);
  });

  it("voice-update persists settings and round-trips on get", () => {
    const u = call("voice-update", ctxA, { enabled: true, ttsRate: 1.25, autoplayReplies: true });
    assert.equal(u.ok, true);
    assert.equal(u.result.prefs.enabled, true);
    assert.equal(u.result.prefs.ttsRate, 1.25);
    const g = call("voice-get", ctxA);
    assert.equal(g.result.prefs.autoplayReplies, true);
  });

  it("voice-update rejects out-of-range ttsRate", () => {
    const r = call("voice-update", ctxA, { ttsRate: 5 });
    assert.equal(r.ok, false);
    assert.match(r.error, /ttsRate must be/);
  });

  it("INVARIANT: voice prefs scoped per-user", () => {
    call("voice-update", ctxA, { enabled: true });
    const g = call("voice-get", ctxB);
    assert.equal(g.result.prefs.enabled, false);
  });
});

describe("chat — custom GPTs parity", () => {
  it("creates an assistant and lists it", () => {
    const c = call("assistant-create", ctxA, {
      name: "SQL Tutor",
      instructions: "You teach SQL by example.",
      starters: ["Explain JOINs", "Write a GROUP BY"],
    });
    assert.equal(c.ok, true);
    assert.equal(c.result.assistant.name, "SQL Tutor");
    assert.equal(c.result.assistant.starters.length, 2);
    const l = call("assistants-list", ctxA);
    assert.equal(l.result.assistants.length, 1);
  });

  it("rejects missing instructions", () => {
    const r = call("assistant-create", ctxA, { name: "Empty" });
    assert.equal(r.ok, false);
    assert.match(r.error, /instructions required/);
  });

  it("update edits instructions; delete removes", () => {
    const c = call("assistant-create", ctxA, { name: "n", instructions: "v1" });
    const u = call("assistant-update", ctxA, { id: c.result.assistant.id, instructions: "v2" });
    assert.equal(u.result.assistant.instructions, "v2");
    const d = call("assistant-delete", ctxA, { id: c.result.assistant.id });
    assert.equal(d.ok, true);
    assert.equal(call("assistants-list", ctxA).result.assistants.length, 0);
  });

  it("INVARIANT: assistants scoped per-user", () => {
    call("assistant-create", ctxA, { name: "a-only", instructions: "x" });
    assert.equal(call("assistants-list", ctxB).result.assistants.length, 0);
  });
});

describe("chat — canvas parity", () => {
  it("creates a doc, edits it, and snapshots a revision", () => {
    const c = call("canvas-create", ctxA, { title: "Plan", kind: "document", content: "v1" });
    assert.equal(c.ok, true);
    const u = call("canvas-update", ctxA, { id: c.result.doc.id, content: "v2" });
    assert.equal(u.result.doc.content, "v2");
    assert.equal(u.result.doc.revisions.length, 1);
    assert.equal(u.result.doc.revisions[0].content, "v1");
  });

  it("revert restores a prior revision", () => {
    const c = call("canvas-create", ctxA, { title: "Doc", content: "alpha" });
    call("canvas-update", ctxA, { id: c.result.doc.id, content: "beta" });
    const rv = call("canvas-revert", ctxA, { id: c.result.doc.id, revisionIndex: 0 });
    assert.equal(rv.ok, true);
    assert.equal(rv.result.doc.content, "alpha");
  });

  it("rejects empty title on create", () => {
    const r = call("canvas-create", ctxA, { title: "  " });
    assert.equal(r.ok, false);
    assert.match(r.error, /title required/);
  });

  it("INVARIANT: canvas docs scoped per-user", () => {
    call("canvas-create", ctxA, { title: "secret" });
    assert.equal(call("canvas-list", ctxB).result.docs.length, 0);
  });
});

describe("chat — persistent memory parity", () => {
  it("adds a fact and lists it as active", () => {
    const a = call("memory-add", ctxA, { fact: "User prefers metric units", category: "preference" });
    assert.equal(a.ok, true);
    assert.equal(a.result.memory.active, true);
    const l = call("memory-list", ctxA);
    assert.equal(l.result.activeCount, 1);
  });

  it("dedupes identical facts instead of duplicating", () => {
    call("memory-add", ctxA, { fact: "Lives in Oslo" });
    const dup = call("memory-add", ctxA, { fact: "lives in oslo" });
    assert.equal(dup.result.deduped, true);
    assert.equal(call("memory-list", ctxA).result.memories.length, 1);
  });

  it("update can deactivate a memory; delete '*' clears all", () => {
    const a = call("memory-add", ctxA, { fact: "fact one" });
    call("memory-update", ctxA, { id: a.result.memory.id, active: false });
    assert.equal(call("memory-list", ctxA).result.activeCount, 0);
    const cleared = call("memory-delete", ctxA, { id: "*" });
    assert.ok(cleared.result.cleared >= 1);
    assert.equal(call("memory-list", ctxA).result.memories.length, 0);
  });

  it("INVARIANT: memories scoped per-user", () => {
    call("memory-add", ctxA, { fact: "a-only fact" });
    assert.equal(call("memory-list", ctxB).result.memories.length, 0);
  });
});

describe("chat — code interpreter parity", () => {
  it("runs JS and captures console output", () => {
    const r = call("code-run", ctxA, { code: "console.log(2 + 2);" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.run.logs, ["4"]);
    assert.equal(r.result.run.error, null);
  });

  it("blocks forbidden tokens (require/process/fetch)", () => {
    const r = call("code-run", ctxA, { code: "require('fs')" });
    assert.equal(r.ok, false);
    assert.match(r.error, /forbidden token/);
  });

  it("surfaces runtime errors without throwing", () => {
    const r = call("code-run", ctxA, { code: "throw new Error('boom');" });
    assert.equal(r.ok, true);
    assert.match(r.result.run.error, /boom/);
  });

  it("code-history returns recent runs newest-first", () => {
    call("code-run", ctxA, { code: "console.log('first');" });
    call("code-run", ctxA, { code: "console.log('second');" });
    const h = call("code-history", ctxA, { limit: 5 });
    assert.ok(h.result.runs.length >= 2);
    assert.match(h.result.runs[0].code, /second/);
  });
});

describe("chat — share links parity", () => {
  it("creates a public share link with a frozen snapshot", () => {
    const r = call("share-create", ctxA, {
      threadId: "t_1",
      title: "How JOINs work",
      messages: [
        { role: "user", content: "explain joins", timestamp: new Date().toISOString() },
        { role: "assistant", content: "a join combines rows", timestamp: new Date().toISOString() },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.token);
    assert.equal(r.result.messageCount, 2);
  });

  it("rejects share with no messages", () => {
    const r = call("share-create", ctxA, { threadId: "t", messages: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /messages required/);
  });

  it("share-view reads any link by token and increments viewCount", () => {
    const c = call("share-create", ctxA, {
      threadId: "t_2",
      messages: [{ role: "user", content: "hi", timestamp: new Date().toISOString() }],
    });
    const v1 = call("share-view", ctxB, { token: c.result.token });
    assert.equal(v1.ok, true);
    assert.equal(v1.result.viewCount, 1);
    const v2 = call("share-view", ctxB, { token: c.result.token });
    assert.equal(v2.result.viewCount, 2);
  });

  it("revoked links are no longer viewable", () => {
    const c = call("share-create", ctxA, {
      threadId: "t_3",
      messages: [{ role: "user", content: "x", timestamp: new Date().toISOString() }],
    });
    call("share-revoke", ctxA, { token: c.result.token });
    const v = call("share-view", ctxB, { token: c.result.token });
    assert.equal(v.ok, false);
    assert.match(v.error, /revoked/);
  });
});

describe("chat — image generation parity", () => {
  it("generates an image URL deterministically from the prompt", async () => {
    const r = await call("image-generate", ctxA, { prompt: "a red fox" });
    assert.equal(r.ok, true);
    assert.match(r.result.image.url, /image\.pollinations\.ai/);
    assert.equal(r.result.image.prompt, "a red fox");
    // Same prompt → same seed (reproducible).
    const r2 = await call("image-generate", ctxA, { prompt: "a red fox" });
    assert.equal(r2.result.image.seed, r.result.image.seed);
  });

  it("rejects empty prompt", async () => {
    const r = await call("image-generate", ctxA, { prompt: "  " });
    assert.equal(r.ok, false);
    assert.match(r.error, /prompt required/);
  });

  it("image-history lists generated images; delete removes one", async () => {
    const g = await call("image-generate", ctxA, { prompt: "a blue whale" });
    const h = call("image-history", ctxA);
    assert.ok(h.result.images.length >= 1);
    const d = call("image-delete", ctxA, { id: g.result.image.id });
    assert.equal(d.ok, true);
  });

  it("INVARIANT: image history scoped per-user", async () => {
    await call("image-generate", ctxA, { prompt: "a-only image" });
    assert.equal(call("image-history", ctxB).result.images.length, 0);
  });
});
