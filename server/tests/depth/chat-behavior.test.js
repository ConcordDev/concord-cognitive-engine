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
import { lensRun, depthCtx, macroRuntime } from "./_harness.js";

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

describe("chat — delete round-trips (wave 17 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`chat-t17-del-${randomUUID()}`); });

  it("prompt-delete removes the row; a subsequent prompt-update on it is not-found", async () => {
    const created = await lensRun("chat", "prompt-create", { params: { name: `p-${randomUUID()}`, content: "body {x}" } }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.prompt.id;

    const del = await lensRun("chat", "prompt-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);

    const list = await lensRun("chat", "prompts-list", {}, ctx);
    assert.equal(list.result.prompts.some((p) => p.id === id), false);

    const upd = await lensRun("chat", "prompt-update", { params: { id, content: "z" } }, ctx);
    assert.equal(upd.result.ok, false);
    assert.match(upd.result.error, /not found/);
  });

  it("assistant-delete removes the row; assistants-list no longer carries it", async () => {
    const created = await lensRun("chat", "assistant-create", { params: { name: "Tmp", instructions: "do x" } }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.assistant.id;

    const del = await lensRun("chat", "assistant-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);

    const list = await lensRun("chat", "assistants-list", {}, ctx);
    assert.equal(list.result.assistants.some((a) => a.id === id), false);
  });

  it("assistant-delete of an unknown id is rejected as not found", async () => {
    const bad = await lensRun("chat", "assistant-delete", { params: { id: `gpt_missing_${randomUUID()}` } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });

  it("branch-delete removes the fork; branches-list drops it", async () => {
    const sourceThreadId = `src-${randomUUID()}`;
    const forked = await lensRun("chat", "branch-fork", { params: { sourceThreadId, atMessageIdx: 0, messages: ["m0", "m1"] } }, ctx);
    assert.equal(forked.ok, true);
    const id = forked.result.branch.id;

    const del = await lensRun("chat", "branch-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);

    const list = await lensRun("chat", "branches-list", { params: { sourceThreadId } }, ctx);
    assert.equal(list.result.branches.some((b) => b.id === id), false);
  });
});

describe("chat — canvas list/get/delete (wave 17 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`chat-t17-cvs-${randomUUID()}`); });

  it("canvas-list projects revisionCount + charCount after an edit", async () => {
    const created = await lensRun("chat", "canvas-create", { params: { title: "Doc A", content: "abc" } }, ctx);
    const id = created.result.doc.id;
    // One update snapshots prior content → revisionCount 1, charCount of "abcd" = 4.
    await lensRun("chat", "canvas-update", { params: { id, content: "abcd" } }, ctx);

    const list = await lensRun("chat", "canvas-list", {}, ctx);
    const row = list.result.docs.find((d) => d.id === id);
    assert.ok(row, "doc present in list");
    assert.equal(row.revisionCount, 1);
    assert.equal(row.charCount, 4);
  });

  it("canvas-list filters by threadId", async () => {
    const threadId = `thr-${randomUUID()}`;
    const a = await lensRun("chat", "canvas-create", { params: { title: "Bound", content: "x", threadId } }, ctx);
    await lensRun("chat", "canvas-create", { params: { title: "Free", content: "y" } }, ctx);

    const list = await lensRun("chat", "canvas-list", { params: { threadId } }, ctx);
    assert.equal(list.result.docs.length, 1);
    assert.equal(list.result.docs[0].id, a.result.doc.id);
  });

  it("canvas-get returns the full doc; canvas-delete makes it not-found", async () => {
    const created = await lensRun("chat", "canvas-create", { params: { title: "Spec X", kind: "code", language: "python", content: "print(1)" } }, ctx);
    const id = created.result.doc.id;

    const got = await lensRun("chat", "canvas-get", { params: { id } }, ctx);
    assert.equal(got.result.doc.title, "Spec X");
    assert.equal(got.result.doc.kind, "code");
    assert.equal(got.result.doc.language, "python");
    assert.equal(got.result.doc.content, "print(1)");

    const del = await lensRun("chat", "canvas-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);

    const after = await lensRun("chat", "canvas-get", { params: { id } }, ctx);
    assert.equal(after.result.ok, false);
    assert.match(after.result.error, /not found/);
  });
});

describe("chat — memory update + delete (wave 17 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`chat-t17-mem-${randomUUID()}`); });

  it("memory-update toggles active=false and edits the fact; memory-list reflects activeCount", async () => {
    const add = await lensRun("chat", "memory-add", { params: { fact: `likes ${randomUUID()} dark mode` } }, ctx);
    const id = add.result.memory.id;
    assert.equal(add.result.memory.active, true);

    const upd = await lensRun("chat", "memory-update", { params: { id, fact: "prefers light mode", active: false, category: "preference" } }, ctx);
    assert.equal(upd.result.memory.fact, "prefers light mode");
    assert.equal(upd.result.memory.active, false);
    assert.equal(upd.result.memory.category, "preference");

    const list = await lensRun("chat", "memory-list", {}, ctx);
    const row = list.result.memories.find((m) => m.id === id);
    assert.equal(row.active, false);
    // The one memory we added is now inactive → it is excluded from activeCount.
    assert.equal(list.result.memories.filter((m) => m.active).length, list.result.activeCount);
    assert.equal(list.result.activeCount, 0);
  });

  it("memory-delete removes one row; memory-delete('*') clears the rest", async () => {
    const fresh = await depthCtx(`chat-t17-memclr-${randomUUID()}`);
    const a = await lensRun("chat", "memory-add", { params: { fact: `fact-a-${randomUUID()}` } }, fresh);
    const b = await lensRun("chat", "memory-add", { params: { fact: `fact-b-${randomUUID()}` } }, fresh);

    const del = await lensRun("chat", "memory-delete", { params: { id: a.result.memory.id } }, fresh);
    assert.equal(del.result.deleted, a.result.memory.id);

    let list = await lensRun("chat", "memory-list", {}, fresh);
    assert.equal(list.result.memories.some((m) => m.id === a.result.memory.id), false);
    assert.equal(list.result.memories.some((m) => m.id === b.result.memory.id), true);

    const cleared = await lensRun("chat", "memory-delete", { params: { id: "*" } }, fresh);
    assert.equal(cleared.result.cleared, 1); // only b remained

    list = await lensRun("chat", "memory-list", {}, fresh);
    assert.equal(list.result.memories.length, 0);
  });
});

describe("chat — voice / share / image surfaces (wave 17 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`chat-t17-vsi-${randomUUID()}`); });

  it("voice-get returns the default profile, then reads back a persisted update", async () => {
    const fresh = await depthCtx(`chat-t17-voice-${randomUUID()}`);
    const def = await lensRun("chat", "voice-get", {}, fresh);
    assert.equal(def.result.prefs.enabled, false);
    assert.equal(def.result.prefs.ttsRate, 1.0);
    assert.equal(def.result.prefs.sttLang, "en-US");
    assert.equal(def.result.prefs.updatedAt, null);

    await lensRun("chat", "voice-update", { params: { enabled: true, ttsRate: 1.25, sttLang: "fr-FR" } }, fresh);
    const got = await lensRun("chat", "voice-get", {}, fresh);
    assert.equal(got.result.prefs.enabled, true);
    assert.equal(got.result.prefs.ttsRate, 1.25);
    assert.equal(got.result.prefs.sttLang, "fr-FR");
  });

  it("voice-update with an out-of-range ttsPitch is rejected", async () => {
    const bad = await lensRun("chat", "voice-update", { params: { ttsPitch: 9 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /ttsPitch must be 0-2\.0/);
  });

  it("share-list returns the projected link (url + counts) for a created share", async () => {
    const threadId = `shr-${randomUUID()}`;
    const created = await lensRun("chat", "share-create", { params: { threadId, title: "My share", messages: [{ role: "user", content: "hey" }] } }, ctx);
    const token = created.result.token;

    const list = await lensRun("chat", "share-list", {}, ctx);
    const row = list.result.links.find((l) => l.token === token);
    assert.ok(row, "link present");
    assert.equal(row.url, `/share/chat/${token}`);
    assert.equal(row.title, "My share");
    assert.equal(row.messageCount, 1);
    assert.equal(row.revoked, false);
    assert.equal(row.viewCount, 0);
  });

  it("image-history reverses newest-first and image-delete removes a stored generation", async () => {
    // image-generate is the only network-touching macro; under the no-egress
    // preload its HEAD fails closed (reachable:false) but the URL/seed are
    // deterministic, prompt-seeded values — used here purely as a fixture so
    // image-history/image-delete have real rows to round-trip. We assert ONLY
    // the deterministic stored fields, never reachability.
    const fresh = await depthCtx(`chat-t17-img-${randomUUID()}`);
    const g1 = await lensRun("chat", "image-generate", { params: { prompt: "a red cube", seed: 11 } }, fresh);
    const g2 = await lensRun("chat", "image-generate", { params: { prompt: "a blue cube", seed: 22 } }, fresh);
    assert.equal(g1.result.image.seed, 11);
    assert.equal(g2.result.image.seed, 22);

    const hist = await lensRun("chat", "image-history", {}, fresh);
    assert.equal(hist.result.total, 2);
    // Newest first → g2 (seed 22) leads.
    assert.equal(hist.result.images[0].id, g2.result.image.id);
    assert.equal(hist.result.images[0].seed, 22);
    assert.equal(hist.result.images[1].id, g1.result.image.id);

    const del = await lensRun("chat", "image-delete", { params: { id: g1.result.image.id } }, fresh);
    assert.equal(del.result.deleted, g1.result.image.id);

    const after = await lensRun("chat", "image-history", {}, fresh);
    assert.equal(after.result.total, 1);
    assert.equal(after.result.images.some((i) => i.id === g1.result.image.id), false);
  });

  it("image-delete of an unknown id is rejected as not found", async () => {
    const bad = await lensRun("chat", "image-delete", { params: { id: `img_missing_${randomUUID()}` } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not found/);
  });
});

// ── register()-family chat macros (NOT lens actions; reached via runMacro) ──
// These are the deterministic, non-LLM macros in server.js: tool discovery,
// the forge-to-DTU pipeline, router/forge/accumulator metrics, the replay
// timeline + summary, the felt-mood correlate, and feedback validation. The
// pure-LLM-completion macros (`chat.respond`, deep `chat.mood` colouring) are
// intentionally NOT asserted here — they call the cognitive brains and would
// egress; only their deterministic guard branches are exercised.
describe("chat — tool discovery (register family)", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("chat-tools")); });

  it("chat.tools lists the fixed tool catalog with the run_compute keys", async () => {
    const r = await runMacro("chat", "tools", {}, ctx);
    assert.equal(r.ok, true);
    const names = r.tools.map((t) => t.name);
    // The five built-in tools are always present regardless of opt-in state.
    assert.ok(names.includes("web_search"));
    assert.ok(names.includes("create_dtu"));
    assert.ok(names.includes("run_compute"));
    assert.ok(names.includes("browse_url"));
    assert.ok(names.includes("run_lens_action"));
    // run_compute is the only tool that does NOT require opt-in.
    const runCompute = r.tools.find((t) => t.name === "run_compute");
    assert.equal(runCompute.requiresOptIn, false);
    // Compute keys are advertised for discovery.
    assert.ok(r.computeKeys.includes("chemistry.balanceReaction"));
    assert.ok(r.computeKeys.includes("math.differentiate"));
  });

  it("chat.tools is unavailable until both the global flag and session opt-in are set", async () => {
    const r = await runMacro("chat", "tools", {}, ctx);
    assert.equal(r.ok, true);
    // available === globalEnabled && sessionOptIn — a fresh internal ctx has
    // neither, so the catalog is listed but not yet active.
    assert.equal(r.available, r.globalEnabled && r.sessionOptIn);
    assert.equal(r.available, false);
  });
});

describe("chat — forge-to-DTU pipeline (register family)", () => {
  let runMacro, STATE, ctx;
  before(async () => { ({ runMacro, STATE, ctx } = await macroRuntime("chat-forge")); });

  it("forge.message promotes a long-enough message to a regular DTU, then forge.delete removes it", async () => {
    const content = `Decision: adopt Redis for the cache layer ${randomUUID()}`;
    const made = await runMacro("chat", "forge.message", { content, sessionId: "s1" }, ctx);
    assert.equal(made.ok, true);
    const dtuId = made.dtuId;
    assert.ok(dtuId);
    assert.ok(made.title.length > 0);
    // The DTU landed in the canonical store at regular tier.
    const stored = STATE.dtus.get(dtuId);
    assert.ok(stored, "forged DTU present in STATE.dtus");
    assert.equal(stored.tier, "regular");
    assert.ok(stored.tags.includes("forged"));

    // forge.delete requires the DTU to be marked forged — saveForgedDTU stamps that.
    await runMacro("chat", "forge.save", { dtu: stored }, ctx);
    const del = await runMacro("chat", "forge.delete", { dtuId }, ctx);
    assert.equal(del.ok, true);
    assert.equal(STATE.dtus.get(dtuId), undefined);
  });

  it("forge.message rejects a too-short message (content < 10 chars)", async () => {
    const bad = await runMacro("chat", "forge.message", { content: "hi" }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "content_too_short");
  });

  it("forge.message rejects an empty message before reaching the forge", async () => {
    const bad = await runMacro("chat", "forge.message", {}, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /content required/);
  });

  it("forge.save without a dtu id is rejected", async () => {
    const bad = await runMacro("chat", "forge.save", {}, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /dtu required/);
  });

  it("forge.delete of an unknown dtuId is not_found", async () => {
    const bad = await runMacro("chat", "forge.delete", { dtuId: `forged_missing_${randomUUID()}` }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "not_found");
  });

  it("forge.iterate without both dtu and content is rejected", async () => {
    const bad = await runMacro("chat", "forge.iterate", { instruction: "tighten" }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /dtu and content required/);
  });

  it("forge.iterate (alreadySaved) forks a child DTU that records the parent in lineage", async () => {
    const parent = {
      id: `forged_${randomUUID().slice(0, 8)}`,
      artifact: { content: "v1", size: 2 },
      lineage: { parents: [] },
      meta: { iterationCount: 0 },
      human: { summary: "v1" },
    };
    const r = await runMacro("chat", "forge.iterate", { dtu: parent, content: "v2 expanded", instruction: "expand", alreadySaved: true }, ctx);
    assert.equal(r.ok, true);
    assert.notEqual(r.dtu.id, parent.id); // a NEW child id
    assert.equal(r.dtu.artifact.content, "v2 expanded");
    assert.ok(r.dtu.lineage.parents.includes(parent.id));
    assert.equal(r.dtu.meta.iterationCount, 1);
  });
});

describe("chat — metrics + replay surfaces (register family)", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("chat-meta")); });

  it("route.metrics returns the three metric buckets", async () => {
    const r = await runMacro("chat", "route.metrics", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.router && typeof r.router === "object");
    assert.ok(r.forge && typeof r.forge === "object");
    assert.ok(r.accumulator && typeof r.accumulator === "object");
  });

  it("chat.timeline returns an empty event list for a session with no messages", async () => {
    const r = await runMacro("chat", "timeline", { sessionId: `empty-${randomUUID()}` }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.count, 0);
    assert.deepEqual(r.events, []);
  });

  it("chat.timeline reports no_actor when no userId can be resolved", async () => {
    // An anonymous ctx with no actor.userId and no input.userId hits the guard.
    const anon = { actor: {} };
    const r = await runMacro("chat", "timeline", {}, anon);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_actor");
  });

  it("chat.summary without a sessionId is rejected with missing_sessionId", async () => {
    const r = await runMacro("chat", "summary", {}, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_sessionId");
  });

  it("chat.summary returns a null summary for an unknown session (no crash)", async () => {
    const r = await runMacro("chat", "summary", { sessionId: `none-${randomUUID()}` }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.summary, null);
  });
});

describe("chat — mood correlate + feedback validation (register family)", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("chat-mood")); });

  it("chat.mood reports a neutral, unlit felt-state for a fresh assistant entity", async () => {
    const r = await runMacro("chat", "mood", {}, ctx);
    assert.equal(r.ok, true);
    // A user with no affect history → engine maps to neutral valence, not lit.
    assert.equal(r.valence, 0);
    assert.equal(r.lit, false);
    assert.equal(r.quale, null);
  });

  it("chat.feedback without a rating is rejected", async () => {
    const r = await runMacro("chat", "feedback", { sessionId: "default" }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.error, /rating required/);
  });
});
