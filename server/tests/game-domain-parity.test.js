// Contract tests for server/domains/game.js — Habitica-style gamification
// substrate: dailies/habits/todos, streaks, parties + shared quests,
// avatar cosmetics, custom rewards, reminders, and cross-user challenges.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGameActions from "../domains/game.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`game.${name}`);
  assert.ok(fn, `game.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerGameActions(register); });
beforeEach(() => { globalThis._concordSTATE = { dtus: new Map() }; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("game design utility macros (existing)", () => {
  it("balanceCheck still works", () => {
    const fn = ACTIONS.get("game.balanceCheck");
    const r = fn(ctxA, { data: { units: [{ name: "A", hp: 100, attack: 10 }, { name: "B", hp: 120, attack: 8 }] } }, {});
    assert.equal(r.ok, true);
  });
  it("levelCurve still works", () => {
    const fn = ACTIONS.get("game.levelCurve");
    const r = fn(ctxA, { data: { maxLevel: 20 } }, {});
    assert.equal(r.ok, true);
  });
});

describe("game.task* — dailies / habits / todos", () => {
  it("creates a task and lists it", () => {
    const c = call("taskCreate", ctxA, { kind: "daily", title: "Read 30m", difficulty: "medium" });
    assert.equal(c.ok, true);
    assert.equal(c.result.task.kind, "daily");
    const l = call("taskList", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
  });

  it("rejects a task with no title", () => {
    const r = call("taskCreate", ctxA, { kind: "todo" });
    assert.equal(r.ok, false);
  });

  it("completing a task awards XP and gold", () => {
    const c = call("taskCreate", ctxA, { kind: "daily", title: "Workout", difficulty: "hard" });
    const r = call("taskComplete", ctxA, { id: c.result.task.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.xpDelta > 0);
    assert.ok(r.result.progress.xp > 0);
    assert.ok(r.result.progress.gold > 0);
  });

  it("blocks completing a daily twice in one day", () => {
    const c = call("taskCreate", ctxA, { kind: "daily", title: "Once" });
    assert.equal(call("taskComplete", ctxA, { id: c.result.task.id }).ok, true);
    assert.equal(call("taskComplete", ctxA, { id: c.result.task.id }).ok, false);
  });

  it("negative habit direction down deducts XP", () => {
    const c = call("taskCreate", ctxA, { kind: "habit", title: "Skip junk" });
    const r = call("taskComplete", ctxA, { id: c.result.task.id, direction: "down" });
    assert.equal(r.ok, true);
    assert.ok(r.result.xpDelta < 0);
  });

  it("deletes a task", () => {
    const c = call("taskCreate", ctxA, { kind: "todo", title: "Trash me" });
    const d = call("taskDelete", ctxA, { id: c.result.task.id });
    assert.equal(d.ok, true);
  });

  it("tasks are per-user isolated", () => {
    call("taskCreate", ctxA, { kind: "todo", title: "A only" });
    assert.equal(call("taskList", ctxB, {}).result.count, 0);
  });
});

describe("game.streakSummary", () => {
  it("reports chains after completing a daily", () => {
    const c = call("taskCreate", ctxA, { kind: "daily", title: "Streaky" });
    call("taskComplete", ctxA, { id: c.result.task.id });
    const r = call("streakSummary", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.accountStreak >= 1);
    assert.equal(r.result.activeChains, 1);
  });
});

describe("game.party* — parties / guilds with shared quests", () => {
  it("creates a party and reports membership", () => {
    const c = call("partyCreate", ctxA, { name: "The Drifters" });
    assert.equal(c.ok, true);
    const st = call("partyStatus", ctxA, {});
    assert.equal(st.result.inParty, true);
  });

  it("a second user can join a listed party", () => {
    const c = call("partyCreate", ctxA, { name: "Joinable" });
    const list = call("partyList", ctxB, {});
    assert.equal(list.ok, true);
    const j = call("partyJoin", ctxB, { partyId: c.result.party.id });
    assert.equal(j.ok, true);
    assert.equal(call("partyStatus", ctxB, {}).result.party.members.length, 2);
  });

  it("leader sets a shared quest; members contribute and earn the reward", () => {
    const c = call("partyCreate", ctxA, { name: "Questers" });
    call("partyJoin", ctxB, { partyId: c.result.party.id });
    const q = call("partySetQuest", ctxA, { title: "Collect 2", goal: 2 });
    assert.equal(q.ok, true);
    assert.equal(call("partyContribute", ctxA, { amount: 1 }).ok, true);
    const final = call("partyContribute", ctxB, { amount: 1 });
    assert.equal(final.ok, true);
    assert.equal(final.result.sharedQuest.completed, true);
    assert.ok(final.result.questReward > 0);
  });

  it("non-leader cannot set a shared quest", () => {
    const c = call("partyCreate", ctxA, { name: "Locked" });
    call("partyJoin", ctxB, { partyId: c.result.party.id });
    assert.equal(call("partySetQuest", ctxB, { title: "Nope" }).ok, false);
  });

  it("leaving a party clears membership", () => {
    call("partyCreate", ctxA, { name: "Temp" });
    assert.equal(call("partyLeave", ctxA, {}).ok, true);
    assert.equal(call("partyStatus", ctxA, {}).result.inParty, false);
  });
});

describe("game.cosmetic* — avatar customization", () => {
  it("lists the catalog", () => {
    const r = call("cosmeticCatalog", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.items.length > 0);
  });

  it("rejects a buy with insufficient gold", () => {
    const r = call("cosmeticBuy", ctxA, { id: "cos_helm_crown" });
    assert.equal(r.ok, false);
  });

  it("buys and equips a cosmetic once gold is earned", () => {
    // Earn gold via many hard task completions (cheapest cosmetic = 180 gold).
    for (let i = 0; i < 16; i++) {
      const c = call("taskCreate", ctxA, { kind: "todo", title: `Earn ${i}`, difficulty: "hard" });
      call("taskComplete", ctxA, { id: c.result.task.id });
    }
    const buy = call("cosmeticBuy", ctxA, { id: "cos_body_cloak" });
    assert.equal(buy.ok, true);
    const eq = call("cosmeticEquip", ctxA, { id: "cos_body_cloak" });
    assert.equal(eq.ok, true);
    assert.equal(eq.result.equipped.body, "cos_body_cloak");
  });
});

describe("game.reward* — custom rewards + redemption", () => {
  it("creates a custom reward", () => {
    const r = call("rewardCreate", ctxA, { title: "Movie night", cost: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.reward.cost, 10);
  });

  it("rejects redemption without enough gold", () => {
    const c = call("rewardCreate", ctxA, { title: "Expensive", cost: 9999 });
    assert.equal(call("rewardRedeem", ctxA, { id: c.result.reward.id }).ok, false);
  });

  it("redeems a reward after earning gold", () => {
    const c = call("taskCreate", ctxA, { kind: "todo", title: "Earn", difficulty: "hard" });
    call("taskComplete", ctxA, { id: c.result.task.id });
    const rw = call("rewardCreate", ctxA, { title: "Cheap", cost: 1 });
    const red = call("rewardRedeem", ctxA, { id: rw.result.reward.id });
    assert.equal(red.ok, true);
    assert.equal(red.result.reward.redemptions, 1);
  });

  it("deletes a reward", () => {
    const c = call("rewardCreate", ctxA, { title: "Gone", cost: 5 });
    assert.equal(call("rewardDelete", ctxA, { id: c.result.reward.id }).ok, true);
  });
});

describe("game.reminder* — scheduled notifications", () => {
  it("creates a reminder with a valid time", () => {
    const r = call("reminderCreate", ctxA, { title: "Evening review", time: "20:30" });
    assert.equal(r.ok, true);
  });

  it("rejects an invalid time format", () => {
    assert.equal(call("reminderCreate", ctxA, { title: "Bad", time: "25:99" }).ok, false);
  });

  it("toggles and deletes a reminder", () => {
    const c = call("reminderCreate", ctxA, { title: "Toggle me", time: "09:00" });
    const t = call("reminderToggle", ctxA, { id: c.result.reminder.id });
    assert.equal(t.ok, true);
    assert.equal(t.result.reminder.enabled, false);
    assert.equal(call("reminderDelete", ctxA, { id: c.result.reminder.id }).ok, true);
  });

  it("lists reminders with upcoming flags", () => {
    call("reminderCreate", ctxA, { title: "Listed", time: "08:00" });
    const l = call("reminderList", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
  });
});

describe("game.challenge* — cross-user challenges + shared leaderboards", () => {
  it("creates a challenge", () => {
    const r = call("challengeCreate", ctxA, { title: "Read more", goal: 3, prize: 50 });
    assert.equal(r.ok, true);
  });

  it("a second user joins and the leaderboard tracks both", () => {
    const c = call("challengeCreate", ctxA, { title: "Race", goal: 5 });
    const cid = c.result.challenge.id;
    assert.equal(call("challengeJoin", ctxB, { challengeId: cid }).ok, true);
    const board = call("challengeLeaderboard", ctxA, { challengeId: cid });
    assert.equal(board.ok, true);
    assert.equal(board.result.leaderboard.length, 2);
  });

  it("progressing past the goal crowns a winner and awards the prize", () => {
    const c = call("challengeCreate", ctxA, { title: "Sprint", goal: 2, prize: 100 });
    const cid = c.result.challenge.id;
    call("challengeProgress", ctxA, { challengeId: cid, amount: 1 });
    const win = call("challengeProgress", ctxA, { challengeId: cid, amount: 1 });
    assert.equal(win.ok, true);
    assert.equal(win.result.challenge.winnerId, "user_a");
    assert.equal(win.result.prizeAwarded, 100);
  });

  it("rejects progress before joining", () => {
    const c = call("challengeCreate", ctxA, { title: "Closed", goal: 5 });
    assert.equal(call("challengeProgress", ctxB, { challengeId: c.result.challenge.id, amount: 1 }).ok, false);
  });

  it("lists challenges", () => {
    call("challengeCreate", ctxA, { title: "Listed challenge", goal: 3 });
    const l = call("challengeList", ctxA, {});
    assert.equal(l.ok, true);
    assert.ok(l.result.count >= 1);
  });
});

describe("game.playerProgress — aggregate", () => {
  it("reflects XP, level, gold and daily counts", () => {
    const c = call("taskCreate", ctxA, { kind: "daily", title: "Track me", difficulty: "hard" });
    call("taskComplete", ctxA, { id: c.result.task.id });
    const r = call("playerProgress", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.xp > 0);
    assert.equal(r.result.dailiesTotal, 1);
    assert.equal(r.result.dailiesDone, 1);
  });
});
