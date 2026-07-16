// tests/depth/game-xp-log-behavior.test.js — REAL behavioral tests for the
// `game` domain's XP activity log (the `xpLogList` macro + the `awardXp`
// logging hook it reads from). Closes the game-lens ENGINEERING gap: "no
// per-event XP log exists server-side yet" (docs/lens-specs/game-capability-map.md).
//
// Design under test: `awardXp(s, userId, xp, gold, meta)` in
// server/domains/game.js pushes a log entry on every non-zero-xp call,
// regardless of call site — so all three real callers (taskComplete,
// partyContribute, challengeProgress) are covered automatically. This file
// drives each of those three real paths (not synthetic log entries) and
// asserts the resulting xpLogList entries.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("game — xpLogList: task completion path (source='task')", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("game-xplog-task"); });

  it("starts empty for a fresh user", async () => {
    const r = await lensRun("game", "xpLogList", {}, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.entries, []);
    assert.equal(r.result.count, 0);
    assert.equal(r.result.totalXpAllTime, 0);
    assert.equal(r.result.totalGoldAllTime, 0);
  });

  it("taskComplete (up) appends a log entry with real source/label/refId", async () => {
    const add = await lensRun("game", "taskCreate", { params: { title: "Do the dishes", kind: "daily", difficulty: "medium" } }, ctx);
    const taskId = add.result.task.id;
    const done = await lensRun("game", "taskComplete", { params: { id: taskId } }, ctx);
    assert.equal(done.ok, true);
    const log = await lensRun("game", "xpLogList", {}, ctx);
    assert.equal(log.ok, true);
    assert.equal(log.result.count, 1);
    const entry = log.result.entries[0];
    assert.equal(entry.source, "task");
    assert.equal(entry.label, "Do the dishes");
    assert.equal(entry.refId, taskId);
    assert.equal(entry.xpDelta, done.result.xpDelta);
    assert.equal(entry.goldDelta, done.result.goldDelta);
    assert.ok(entry.xpDelta > 0);
    assert.ok(entry.id.startsWith("xplog_"));
    assert.equal(typeof entry.at, "string");
    assert.equal(entry.xpAfter, done.result.progress.xp);
    assert.equal(entry.levelAfter, done.result.progress.level);
  });

  it("taskComplete (down) appends a NEGATIVE xpDelta entry, still source='task'", async () => {
    const add = await lensRun("game", "taskCreate", { params: { title: "Skip the gym", kind: "habit", difficulty: "medium" } }, ctx);
    const taskId = add.result.task.id;
    const down = await lensRun("game", "taskComplete", { params: { id: taskId, direction: "down" } }, ctx);
    assert.equal(down.ok, true);
    assert.ok(down.result.xpDelta < 0);
    const log = await lensRun("game", "xpLogList", {}, ctx);
    // Most-recent-first: the down-completion is entries[0].
    const entry = log.result.entries[0];
    assert.equal(entry.source, "task");
    assert.equal(entry.label, "Skip the gym");
    assert.equal(entry.refId, taskId);
    assert.equal(entry.xpDelta, down.result.xpDelta);
    assert.ok(entry.xpDelta < 0);
    assert.equal(entry.goldDelta, 0);
  });

  it("entries are ordered most-recent-first", async () => {
    const log = await lensRun("game", "xpLogList", {}, ctx);
    assert.equal(log.result.count, 2);
    // entries[0] is the "down" penalty (most recent), entries[1] is the
    // original "up" completion (earlier).
    assert.ok(log.result.entries[0].xpDelta < 0);
    assert.ok(log.result.entries[1].xpDelta > 0);
  });

  it("totalXpAllTime / totalGoldAllTime sum the full log, matching the entries sum here (no limiting yet)", async () => {
    const log = await lensRun("game", "xpLogList", {}, ctx);
    const sumXp = log.result.entries.reduce((s, e) => s + e.xpDelta, 0);
    const sumGold = log.result.entries.reduce((s, e) => s + e.goldDelta, 0);
    assert.equal(log.result.totalXpAllTime, sumXp);
    assert.equal(log.result.totalGoldAllTime, sumGold);
  });
});

describe("game — xpLogList: party quest path (source='party_quest')", () => {
  let leader, joiner;
  before(async () => {
    leader = await depthCtx("game-xplog-party-leader");
    joiner = await depthCtx("game-xplog-party-joiner");
  });

  it("partyContribute crossing the goal logs 'party_quest' entries for EVERY member", async () => {
    const create = await lensRun("game", "partyCreate", { params: { name: "Log Testers" } }, leader);
    const partyId = create.result.party.id;
    await lensRun("game", "partyJoin", { params: { partyId } }, joiner);
    const setQuest = await lensRun("game", "partySetQuest", { params: { title: "Clear the vault", goal: 3 } }, leader);
    assert.equal(setQuest.ok, true);
    const contribute = await lensRun("game", "partyContribute", { params: { amount: 5 } }, leader); // caps at 3, completes
    assert.equal(contribute.result.sharedQuest.completed, true);
    assert.equal(contribute.result.questReward, 150);

    const leaderLog = await lensRun("game", "xpLogList", {}, leader);
    const leaderEntry = leaderLog.result.entries.find((e) => e.source === "party_quest");
    assert.ok(leaderEntry, "leader should have a party_quest log entry");
    assert.equal(leaderEntry.label, "Clear the vault"); // real sharedQuest.title field
    assert.equal(leaderEntry.refId, partyId);
    assert.equal(leaderEntry.xpDelta, 150);
    assert.equal(leaderEntry.goldDelta, 60);

    const joinerLog = await lensRun("game", "xpLogList", {}, joiner);
    const joinerEntry = joinerLog.result.entries.find((e) => e.source === "party_quest");
    assert.ok(joinerEntry, "joiner (non-contributing member) should ALSO be logged");
    assert.equal(joinerEntry.label, "Clear the vault");
    assert.equal(joinerEntry.refId, partyId);
    assert.equal(joinerEntry.xpDelta, 150);
    assert.equal(joinerEntry.goldDelta, 60);
  });
});

describe("game — xpLogList: challenge prize path (source='challenge_prize')", () => {
  let owner, racer;
  before(async () => {
    owner = await depthCtx("game-xplog-chal-owner");
    racer = await depthCtx("game-xplog-chal-racer");
  });

  it("challengeProgress reaching the goal logs a 'challenge_prize' entry with the real title field", async () => {
    const create = await lensRun("game", "challengeCreate", { params: { title: "Sprint to 5", goal: 5, prize: 100, days: 3 } }, owner);
    const challengeId = create.result.challenge.id;
    await lensRun("game", "challengeJoin", { params: { challengeId } }, racer);
    const win = await lensRun("game", "challengeProgress", { params: { challengeId, amount: 5 } }, racer);
    assert.equal(win.result.prizeAwarded, 100);

    const log = await lensRun("game", "xpLogList", {}, racer);
    const entry = log.result.entries.find((e) => e.source === "challenge_prize");
    assert.ok(entry, "winner should have a challenge_prize log entry");
    assert.equal(entry.label, "Sprint to 5"); // real challenge.title field (not challenge.name)
    assert.equal(entry.refId, challengeId);
    assert.equal(entry.xpDelta, 100);
    assert.equal(entry.goldDelta, 50); // Math.round(100 * 0.5)
  });

  it("the challenge owner (never won) has no challenge_prize entry from this challenge", async () => {
    const log = await lensRun("game", "xpLogList", {}, owner);
    const entries = log.result.entries.filter((e) => e.source === "challenge_prize");
    assert.equal(entries.length, 0);
  });
});

describe("game — xpLogList: limit + source filter + totals-beyond-the-page", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("game-xplog-limit"); });

  it("limit honestly caps the returned page while totals reflect the FULL history", async () => {
    // Create + complete 8 distinct habits (habits can be completed repeatedly
    // same-day, but each needs a distinct id anyway — use 8 separate tasks
    // so each completion is an independent, real xp-earning event).
    const xpDeltas = [];
    for (let i = 0; i < 8; i++) {
      const add = await lensRun("game", "taskCreate", { params: { title: `Grind ${i}`, kind: "habit", difficulty: "easy" } }, ctx);
      const done = await lensRun("game", "taskComplete", { params: { id: add.result.task.id } }, ctx);
      xpDeltas.push(done.result.xpDelta);
    }
    const full = await lensRun("game", "xpLogList", { params: { limit: 200 } }, ctx);
    assert.equal(full.result.count, 8);
    const expectedTotalXp = xpDeltas.reduce((s, x) => s + x, 0);
    assert.equal(full.result.totalXpAllTime, expectedTotalXp);

    const capped = await lensRun("game", "xpLogList", { params: { limit: 3 } }, ctx);
    assert.equal(capped.result.entries.length, 3);
    // count reflects the full (filtered) log size, not just the returned page.
    assert.equal(capped.result.count, 8);
    // Totals are NOT reduced by the page cap — they still cover all 8 entries.
    assert.equal(capped.result.totalXpAllTime, expectedTotalXp);
    assert.equal(capped.result.totalGoldAllTime, full.result.totalGoldAllTime);
    // The 3 returned are the 3 MOST RECENT (last 3 pushed = last 3 completed).
    assert.equal(capped.result.entries[0].refId, full.result.entries[0].refId);
    assert.equal(capped.result.entries[2].refId, full.result.entries[2].refId);
  });

  it("limit is clamped into [1, 200] against out-of-range input", async () => {
    const tooBig = await lensRun("game", "xpLogList", { params: { limit: 99999 } }, ctx);
    assert.ok(tooBig.result.entries.length <= 200);
    const tooSmall = await lensRun("game", "xpLogList", { params: { limit: 0 } }, ctx);
    assert.equal(tooSmall.result.entries.length, 1);
    const negative = await lensRun("game", "xpLogList", { params: { limit: -5 } }, ctx);
    assert.equal(negative.result.entries.length, 1);
  });

  it("defaults limit to 50 when omitted", async () => {
    const r = await lensRun("game", "xpLogList", {}, ctx);
    assert.ok(r.result.entries.length <= 50);
  });

  it("the source filter narrows entries AND totals to just that source", async () => {
    // This ctx currently has 8 'task' entries only.
    const taskOnly = await lensRun("game", "xpLogList", { params: { source: "task" } }, ctx);
    assert.equal(taskOnly.result.count, 8);
    assert.ok(taskOnly.result.entries.every((e) => e.source === "task"));

    const noneOnly = await lensRun("game", "xpLogList", { params: { source: "challenge_prize" } }, ctx);
    assert.equal(noneOnly.result.count, 0);
    assert.equal(noneOnly.result.totalXpAllTime, 0);
    assert.equal(noneOnly.result.totalGoldAllTime, 0);
    assert.deepEqual(noneOnly.result.entries, []);
  });
});

describe("game — xpLogList: no entry is logged unless awardXp actually fires", () => {
  it("a challenge participant who never reaches the goal has zero challenge_prize entries", async () => {
    const owner = await depthCtx("game-xplog-nowin-owner");
    const laggard = await depthCtx("game-xplog-nowin-laggard");
    const create = await lensRun("game", "challengeCreate", { params: { title: "Unreached", goal: 100, prize: 200, days: 1 } }, owner);
    const challengeId = create.result.challenge.id;
    await lensRun("game", "challengeJoin", { params: { challengeId } }, laggard);
    const progress = await lensRun("game", "challengeProgress", { params: { challengeId, amount: 1 } }, laggard);
    assert.equal(progress.ok, true);
    assert.equal(progress.result.challenge.winnerId, null); // goal not reached → awardXp never called
    const log = await lensRun("game", "xpLogList", { params: { source: "challenge_prize" } }, laggard);
    assert.equal(log.result.count, 0);
    assert.equal(log.result.totalXpAllTime, 0);
  });

  it("a second contributor who reaches an already-won challenge's goal gets no additional prize entry", async () => {
    const owner = await depthCtx("game-xplog-secondwin-owner");
    const first = await depthCtx("game-xplog-secondwin-first");
    const second = await depthCtx("game-xplog-secondwin-second");
    const create = await lensRun("game", "challengeCreate", { params: { title: "Only one winner", goal: 3, prize: 100, days: 1 } }, owner);
    const challengeId = create.result.challenge.id;
    await lensRun("game", "challengeJoin", { params: { challengeId } }, first);
    await lensRun("game", "challengeJoin", { params: { challengeId } }, second);
    const win1 = await lensRun("game", "challengeProgress", { params: { challengeId, amount: 3 } }, first);
    assert.equal(win1.result.prizeAwarded, 100);
    const win2 = await lensRun("game", "challengeProgress", { params: { challengeId, amount: 3 } }, second);
    assert.equal(win2.result.prizeAwarded, null); // challenge.winnerId already set → awardXp not called for `second`
    const log = await lensRun("game", "xpLogList", { params: { source: "challenge_prize" } }, second);
    assert.equal(log.result.count, 0);
  });
});

describe("game — xpLogList: per-user isolation", () => {
  it("two independent users never see each other's xp log entries", async () => {
    const a = await depthCtx("game-xplog-iso-a");
    const b = await depthCtx("game-xplog-iso-b");
    const addA = await lensRun("game", "taskCreate", { params: { title: "A's task", kind: "todo", difficulty: "hard" } }, a);
    await lensRun("game", "taskComplete", { params: { id: addA.result.task.id } }, a);
    const addB = await lensRun("game", "taskCreate", { params: { title: "B's task", kind: "todo", difficulty: "trivial" } }, b);
    await lensRun("game", "taskComplete", { params: { id: addB.result.task.id } }, b);

    const logA = await lensRun("game", "xpLogList", {}, a);
    const logB = await lensRun("game", "xpLogList", {}, b);
    assert.equal(logA.result.count, 1);
    assert.equal(logB.result.count, 1);
    assert.equal(logA.result.entries[0].label, "A's task");
    assert.equal(logB.result.entries[0].label, "B's task");
    assert.notEqual(logA.result.entries[0].refId, logB.result.entries[0].refId);
  });
});
