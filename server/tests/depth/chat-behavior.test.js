// tests/depth/chat-behavior.test.js — REAL behavioral tests for the `chat`
// domain (registerLensAction family, via lensRun). Exact-value assertions on the
// deterministic analysis macros (TF-IDF thread summary, participant engagement /
// Gini, cosine-similarity topic detection), CRUD round-trips over the in-memory
// STATE.chatLens (projects, prompts, assistants, canvas with revisions, memory
// dedupe, thread index + search, branches, scheduled tasks, share links), the
// node:vm code interpreter, and validation rejections.
//
// SKIPPED — no LLM-backed macro exists in this domain to skip; all "compose"
// work here is deterministic. The ONE non-deterministic surface is
// `image-generate`, which does a network HEAD against pollinations.ai. Under the
// no-egress preload that HEAD fails closed (reachable:false) but the macro still
// returns a deterministic, prompt-seeded URL — so we assert ONLY the deterministic
// parts (seed/url/dimensions), never network reachability.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("chat — deterministic analysis macros (exact values)", () => {
  it("threadSummarize: counts messages, detects a decision + a question, exact messageCount", async () => {
    const r = await lensRun("chat", "threadSummarize", {
      data: {
        messages: [
          { author: "ana", text: "What database should we use for the cache layer?" },
          { author: "bo", text: "We decided to go with Redis for the cache." },
          { author: "ana", text: "Sounds good, Redis it is." },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.messageCount, 3);
    // "decided" matches the decision pattern → exactly the bo message.
    assert.equal(r.result.decisions.count, 1);
    assert.ok(r.result.decisions.items.some((d) => d.author === "bo"));
    // The first message ends in "?" → a question.
    assert.ok(r.result.questions.count >= 1);
    assert.ok(r.result.questions.items.some((q) => q.author === "ana"));
  });

  it("threadSummarize: empty messages yields the 'No messages' shape", async () => {
    const r = await lensRun("chat", "threadSummarize", { data: { messages: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No messages to summarize.");
  });

  it("participantAnalysis: per-author share + Gini for a 2:1 split", async () => {
    const r = await lensRun("chat", "participantAnalysis", {
      data: {
        messages: [
          { author: "ana", text: "great work everyone" },
          { author: "ana", text: "this is awesome and helpful" },
          { author: "bo", text: "there is a problem with the build" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalMessages, 3);
    assert.equal(r.result.participantCount, 2);
    const ana = r.result.participants.find((p) => p.name === "ana");
    assert.equal(ana.messageCount, 2);
    assert.equal(ana.shareOfConversation, 66.67); // 2/3 → 66.67
    assert.equal(ana.sentiment.label, "positive"); // great/awesome/helpful
    // ana is most active (2 msgs > 1).
    assert.equal(r.result.highlights.mostActive, "ana");
    // Gini for counts [1,2]: numerator = (2*1-2-1)*1 + (2*2-2-1)*2 = -1 + 2 = 1; /(2*3)=0.167
    assert.equal(r.result.engagementBalance.giniCoefficient, 0.167);
  });

  it("topicDetection: identical-topic stream is highly coherent (avg sim 1)", async () => {
    const msgs = Array.from({ length: 6 }, (_, i) => ({
      author: "x",
      text: "database performance cache redis tuning index latency",
    }));
    const r = await lensRun("chat", "topicDetection", { data: { messages: msgs } }, undefined);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalMessages, 6);
    // Every window is identical text → cosine similarity 1 across the board.
    assert.equal(r.result.averageCoherence, 1);
    assert.equal(r.result.topicShiftCount, 0);
    assert.equal(r.result.coherenceLabel, "highly focused");
  });

  it("topicDetection: fewer than 2 messages returns the guard message", async () => {
    const r = await lensRun("chat", "topicDetection", { data: { messages: [{ author: "a", text: "hi" }] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /at least 2 messages/);
  });
});

describe("chat — code interpreter (node:vm)", () => {
  it("code-run: last-expression value is captured and stored in history", async () => {
    const ctx = await depthCtx(`chat-code-${randomUUID()}`);
    const r = await lensRun("chat", "code-run", { params: { code: "const a = 6; const b = 7; a * b" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.run.returnValue, "42");
    assert.equal(r.result.run.error, null);

    const hist = await lensRun("chat", "code-history", { params: {} }, ctx);
    assert.ok(hist.result.runs.some((run) => run.id === r.result.run.id && run.returnValue === "42"));
  });

  it("code-run: console.log output is captured into logs", async () => {
    const ctx = await depthCtx(`chat-code-log-${randomUUID()}`);
    const r = await lensRun("chat", "code-run", { params: { code: "console.log('hello'); console.log(2 + 3)" } }, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.run.logs, ["hello", "5"]);
  });

  it("code-run: a forbidden token (require) is rejected before execution", async () => {
    const bad = await lensRun("chat", "code-run", { params: { code: "require('fs')" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /forbidden token/);
  });
});

describe("chat — CRUD round-trips over STATE.chatLens", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`chat-crud-${randomUUID()}`); });

  it("project-create → projects-list → project-update → project-get → project-delete", async () => {
    const created = await lensRun("chat", "project-create", { params: { name: "Cache Redesign", color: "amber" } }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.project.id;
    assert.ok(id);

    const list = await lensRun("chat", "projects-list", {}, ctx);
    assert.ok(list.result.projects.some((p) => p.id === id && p.name === "Cache Redesign"));

    const upd = await lensRun("chat", "project-update", { params: { id, systemPrompt: "Be terse." } }, ctx);
    assert.equal(upd.result.project.systemPrompt, "Be terse.");

    const got = await lensRun("chat", "project-get", { params: { id } }, ctx);
    assert.equal(got.result.project.name, "Cache Redesign");
    assert.equal(got.result.project.color, "amber");

    const del = await lensRun("chat", "project-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const after = await lensRun("chat", "project-get", { params: { id } }, ctx);
    assert.equal(after.result.ok, false);
    assert.match(after.result.error, /not found/);
  });

  it("prompt-create → prompts-list → prompt-update reads back updated content", async () => {
    const name = `tmpl-${randomUUID()}`;
    const created = await lensRun("chat", "prompt-create", { params: { name, content: "Summarize {x}", shortcut: "Sum!Up" } }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.prompt.id;
    // shortcut is lowercased + stripped of non [a-z0-9_-].
    assert.equal(created.result.prompt.shortcut, "sumup");

    const list = await lensRun("chat", "prompts-list", {}, ctx);
    assert.ok(list.result.prompts.some((p) => p.id === id));

    const upd = await lensRun("chat", "prompt-update", { params: { id, content: "Rewrite {x}" } }, ctx);
    assert.equal(upd.result.prompt.content, "Rewrite {x}");
  });

  it("assistant-create stores model + starters; assistant-update changes model; round-trips through list", async () => {
    const created = await lensRun("chat", "assistant-create", {
      params: { name: "Coder", instructions: "Write clean code.", model: "code", starters: ["Refactor this"] },
    }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.assistant.id;
    assert.equal(created.result.assistant.model, "code");
    assert.deepEqual(created.result.assistant.starters, ["Refactor this"]);

    // An unknown model is rejected by the whitelist on update → model unchanged.
    const upd = await lensRun("chat", "assistant-update", { params: { id, model: "deep" } }, ctx);
    assert.equal(upd.result.assistant.model, "deep");

    const list = await lensRun("chat", "assistants-list", {}, ctx);
    assert.ok(list.result.assistants.some((a) => a.id === id && a.model === "deep"));
  });

  it("canvas-create → canvas-update snapshots prior content → canvas-revert restores it", async () => {
    const created = await lensRun("chat", "canvas-create", { params: { title: "Spec", content: "v1" } }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.doc.id;
    assert.equal(created.result.doc.content, "v1");

    const upd = await lensRun("chat", "canvas-update", { params: { id, content: "v2" } }, ctx);
    assert.equal(upd.result.doc.content, "v2");
    assert.equal(upd.result.doc.revisions.length, 1); // v1 snapshotted
    assert.equal(upd.result.doc.revisions[0].content, "v1");

    const rev = await lensRun("chat", "canvas-revert", { params: { id, revisionIndex: 0 } }, ctx);
    assert.equal(rev.result.doc.content, "v1"); // reverted to the v1 snapshot
    assert.equal(rev.result.revertedTo, 0);
  });

  it("memory-add dedupes a case-insensitive identical fact instead of duplicating", async () => {
    const fact = `prefers ${randomUUID()} tabs`;
    const first = await lensRun("chat", "memory-add", { params: { fact } }, ctx);
    assert.equal(first.ok, true);
    const memId = first.result.memory.id;

    const dup = await lensRun("chat", "memory-add", { params: { fact: fact.toUpperCase() } }, ctx);
    assert.equal(dup.result.deduped, true);
    assert.equal(dup.result.memory.id, memId); // same row, not a new one

    const list = await lensRun("chat", "memory-list", {}, ctx);
    const matches = list.result.memories.filter((m) => m.id === memId);
    assert.equal(matches.length, 1);
  });

  it("thread-index then threads-search scores a title hit above a snippet-only hit", async () => {
    const tagged = `widget${randomUUID().slice(0, 8)}`;
    await lensRun("chat", "thread-index", { params: { threadId: `t-${randomUUID()}`, title: `${tagged} design notes`, snippet: "unrelated body" } }, ctx);
    await lensRun("chat", "thread-index", { params: { threadId: `t-${randomUUID()}`, title: "other thread", snippet: `a passing mention of ${tagged}` } }, ctx);

    const res = await lensRun("chat", "threads-search", { params: { query: tagged } }, ctx);
    assert.equal(res.ok, true);
    assert.ok(res.result.totalMatched >= 2);
    // Title hit (+5) sorts ahead of snippet-only hit (+1).
    assert.equal(res.result.hits[0].score, 5);
    assert.ok(res.result.hits[0].title.includes(tagged));
  });

  it("branch-fork seeds messages up to atMessageIdx; branches-list reads it back", async () => {
    const sourceThreadId = `src-${randomUUID()}`;
    const forked = await lensRun("chat", "branch-fork", {
      params: { sourceThreadId, atMessageIdx: 1, messages: ["m0", "m1", "m2", "m3"] },
    }, ctx);
    assert.equal(forked.ok, true);
    // slice(0, atMessageIdx+1) → first 2 messages.
    assert.deepEqual(forked.result.branch.seededMessages, ["m0", "m1"]);

    const list = await lensRun("chat", "branches-list", { params: { sourceThreadId } }, ctx);
    assert.ok(list.result.branches.some((b) => b.id === forked.result.branch.id));
  });

  it("scheduled-create (future runAt) → scheduled-cancel flips status to cancelled", async () => {
    const runAt = new Date(Date.now() + 3600_000).toISOString();
    const created = await lensRun("chat", "scheduled-create", { params: { prompt: "daily digest", runAt, recurring: "daily" } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.task.status, "pending");
    assert.equal(created.result.task.recurring, "daily");
    const id = created.result.task.id;

    const cancelled = await lensRun("chat", "scheduled-cancel", { params: { id } }, ctx);
    assert.equal(cancelled.result.task.status, "cancelled");

    const list = await lensRun("chat", "scheduled-list", {}, ctx);
    assert.ok(list.result.tasks.some((t) => t.id === id && t.status === "cancelled"));
  });

  it("share-create freezes a snapshot → share-view increments viewCount → share-revoke blocks view", async () => {
    const threadId = `shr-${randomUUID()}`;
    const created = await lensRun("chat", "share-create", {
      params: { threadId, messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }] },
    }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.messageCount, 2);
    const token = created.result.token;

    const view = await lensRun("chat", "share-view", { params: { token } }, ctx);
    assert.equal(view.result.messageCount, 2);
    assert.equal(view.result.viewCount, 1); // first view

    const revoked = await lensRun("chat", "share-revoke", { params: { token } }, ctx);
    assert.equal(revoked.result.revoked, true);

    const afterRevoke = await lensRun("chat", "share-view", { params: { token } }, ctx);
    assert.equal(afterRevoke.result.ok, false);
    assert.match(afterRevoke.result.error, /revoked/);
  });
});

describe("chat — validation rejections", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`chat-reject-${randomUUID()}`); });

  it("project-create without a name is rejected", async () => {
    const bad = await lensRun("chat", "project-create", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("scheduled-create with a past runAt is rejected", async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const bad = await lensRun("chat", "scheduled-create", { params: { prompt: "x", runAt: past } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /future/);
  });

  it("voice-update with an out-of-range ttsRate is rejected", async () => {
    const bad = await lensRun("chat", "voice-update", { params: { ttsRate: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /ttsRate must be 0\.5-2\.0/);
  });
});
