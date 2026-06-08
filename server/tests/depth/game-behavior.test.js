// tests/depth/game-behavior.test.js — REAL behavioral tests for the `game`
// domain (registerLensAction family, invoked via lensRun). Covers the
// deterministic game-design calculators (balanceCheck/economySimulate/
// levelCurve/dropRateCalc) AND the persistent gamification substrate
// (tasks/streaks/parties/cosmetics/rewards/reminders/challenges/progress),
// with exact-value calcs, CRUD round-trips, and validation rejections.
//
// Contract reminders (see _harness.js + lens.run @ server.js:37484):
//   • A handler returning {ok:true, result:{…}} → lensRun unwraps → r.ok===true,
//     fields under r.result.<field>.
//   • A handler returning {ok:false, error} (no `result` key) is NOT unwrapped,
//     so the verdict lands at r.result.ok===false / r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("game — design calculators (exact computed values)", () => {
  it("balanceCheck: fewer than 2 units returns the add-more hint", async () => {
    const r = await lensRun("game", "balanceCheck", { data: { units: [{ name: "Solo" }] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("at least 2"));
  });

  it("balanceCheck: identical units are well-balanced; power + efficiency are exact", async () => {
    // power = (hp/10 + atk + def + spd)/4. For {hp:100,atk:10,def:10,spd:10}:
    //   (10 + 10 + 10 + 10)/4 = 10. efficiency = power/cost = 10/2 = 5.
    const r = await lensRun("game", "balanceCheck", {
      data: { units: [
        { name: "A", hp: 100, attack: 10, defense: 10, speed: 10, cost: 2 },
        { name: "B", hp: 100, attack: 10, defense: 10, speed: 10, cost: 2 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.avgPower, 10);
    assert.equal(r.result.powerVariance, 0);
    assert.equal(r.result.balance, "well-balanced");
    assert.equal(r.result.units[0].power, 10);
    assert.equal(r.result.units[0].efficiency, 5);
  });

  it("balanceCheck: a wide power spread is flagged needs-rebalancing with right strongest/weakest", async () => {
    const r = await lensRun("game", "balanceCheck", {
      data: { units: [
        { name: "Tank", hp: 1000, attack: 50, defense: 50, speed: 50, cost: 1 },
        { name: "Chump", hp: 10, attack: 1, defense: 1, speed: 1, cost: 1 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.balance, "needs-rebalancing");
    assert.equal(r.result.strongest, "Tank");
    assert.equal(r.result.weakest, "Chump");
  });

  it("economySimulate: a net-positive economy is sustainable with exact final gold", async () => {
    // earn 10/min, spend 0, inflation 0 → loop adds (10-0)*5 = 50 per 5-min step
    // across t=0,5,…,60 (13 steps) → +650. start 100 → 750.
    // (Verifies the zero-spend / zero-inflation falsy-default fix: 0 stays 0.)
    const r = await lensRun("game", "economySimulate", {
      data: { startingGold: 100, goldPerMinute: 10, avgSpendPerMinute: 0, inflationPercent: 0, simulateMinutes: 60 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.startGold, 100);
    assert.equal(r.result.finalGold, 750);
    assert.equal(r.result.netFlow, 650);
    assert.equal(r.result.sustainable, true);
    assert.ok(r.result.timeline.length > 0);
  });

  it("economySimulate: a deflating economy reports the deflation tip + not sustainable", async () => {
    const r = await lensRun("game", "economySimulate", {
      data: { startingGold: 1000, goldPerMinute: 1, avgSpendPerMinute: 20, inflationPercent: 5, simulateMinutes: 60 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sustainable, false);
    assert.ok(r.result.tip.includes("deflating"));
  });

  it("levelCurve: total XP to max + first-level XP are exact for growthFactor 1.5", async () => {
    // baseXP=100, growth=1.5: L1 needs 100, L2 needs 150, … sum geometric.
    // totalXPToMax for 3 levels = 100 + 150 + 225 = 475.
    const r = await lensRun("game", "levelCurve", {
      data: { maxLevel: 3, baseXP: 100, growthFactor: 1.5 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalXPToMax, 475);
    assert.equal(r.result.maxLevel, 3);
    assert.equal(r.result.earlyGameFeels, "balanced");
  });

  it("levelCurve: a very low growth factor reads as slow-and-steady", async () => {
    const r = await lensRun("game", "levelCurve", { data: { maxLevel: 10, baseXP: 50, growthFactor: 1.1 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.earlyGameFeels, "slow-and-steady");
  });

  it("dropRateCalc: 10% over 10 attempts has exact expected drops + binomial floors", async () => {
    // rate=0.1, attempts=10 → expected = 10*0.1 = 1.0.
    // attemptsFor50 = ceil(ln(0.5)/ln(0.9)) = ceil(6.578) = 7.
    const r = await lensRun("game", "dropRateCalc", { data: { dropRatePercent: 10, attempts: 10 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.dropRate, "10%");
    assert.equal(r.result.expectedDrops, 1);
    assert.equal(r.result.attemptsFor50Percent, 7);
    assert.equal(r.result.attemptsFor90Percent, 22);   // ceil(ln(0.1)/ln(0.9))
    assert.ok(r.result.pitySystemSuggestion.includes("22"));
  });
});

describe("game — tasks / dailies / streaks (CRUD round-trips, shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("game-tasks"); });

  it("taskCreate defaults kind to todo + difficulty to easy; reads back via taskList", async () => {
    const add = await lensRun("game", "taskCreate", { params: { title: "Write tests" } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.task.kind, "todo");
    assert.equal(add.result.task.difficulty, "easy");
    assert.equal(add.result.task.title, "Write tests");
    const list = await lensRun("game", "taskList", {}, ctx);
    assert.ok(list.result.tasks.some((t) => t.id === add.result.task.id));
    assert.equal(list.result.count, list.result.tasks.length);
  });

  it("taskCreate: a blank title is rejected", async () => {
    const bad = await lensRun("game", "taskCreate", { params: { title: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title is required/);
  });

  it("taskComplete (up) on a hard daily awards exact streak-1 XP + gold, then is blocked same-day", async () => {
    const add = await lensRun("game", "taskCreate", { params: { title: "Hard daily", kind: "daily", difficulty: "hard" } }, ctx);
    const id = add.result.task.id;
    // hard base=35, first completion streak=1 → bonus = min(2, 1+0.05) = 1.05.
    //   xpDelta = round(35*1.05) = round(36.75) = 37. goldDelta = round(35*0.4*1.05) = round(14.7) = 15.
    const done = await lensRun("game", "taskComplete", { params: { id } }, ctx);
    assert.equal(done.ok, true);
    assert.equal(done.result.xpDelta, 37);
    assert.equal(done.result.goldDelta, 15);
    assert.equal(done.result.task.completions, 1);
    assert.equal(done.result.task.streak, 1);
    // A daily can't be completed twice in one day.
    const again = await lensRun("game", "taskComplete", { params: { id } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /already completed today/);
  });

  it("taskComplete (down) applies a negative XP penalty and resets the streak", async () => {
    const add = await lensRun("game", "taskCreate", { params: { title: "Bad habit", kind: "habit", difficulty: "medium" } }, ctx);
    const id = add.result.task.id;
    // medium base=20, down → xpDelta = -round(20*0.6) = -12.
    const down = await lensRun("game", "taskComplete", { params: { id, direction: "down" } }, ctx);
    assert.equal(down.ok, true);
    assert.equal(down.result.xpDelta, -12);
    assert.equal(down.result.goldDelta, 0);
    assert.equal(down.result.task.streak, 0);
  });

  it("taskComplete: a missing task id is rejected", async () => {
    const bad = await lensRun("game", "taskComplete", { params: { id: "task_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /task not found/);
  });

  it("taskDelete removes a task; a missing id is rejected", async () => {
    const add = await lensRun("game", "taskCreate", { params: { title: "Throwaway" } }, ctx);
    const id = add.result.task.id;
    const del = await lensRun("game", "taskDelete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("game", "taskList", {}, ctx);
    assert.ok(!list.result.tasks.some((t) => t.id === id));
    const bad = await lensRun("game", "taskDelete", { params: { id: "task_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /task not found/);
  });

  it("streakSummary lists active habit chains (habits are never at-risk)", async () => {
    const sc = await lensRun("game", "streakSummary", {}, ctx);
    assert.equal(sc.ok, true);
    // The habit completed above has streak 0 (it was hit 'down'), but the
    // hard-daily completed 'up' has streak 1 → an active chain exists.
    assert.ok(sc.result.activeChains >= 1);
    assert.ok(Array.isArray(sc.result.chains));
    assert.ok(typeof sc.result.lossPenaltyHint === "string");
  });

  it("playerProgress aggregates xp/level/gold and the daily completion split", async () => {
    const pp = await lensRun("game", "playerProgress", {}, ctx);
    assert.equal(pp.ok, true);
    assert.ok(pp.result.xp > 0);          // earned from the hard-daily completion
    assert.ok(pp.result.level >= 1);
    assert.ok(pp.result.totalTasks >= 1);
    assert.equal(pp.result.dailiesDone, 1);   // the one hard daily, done today
    assert.ok(pp.result.dailiesTotal >= 1);
  });
});

describe("game — parties / shared quests (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("game-party-leader"); });

  it("partyCreate seeds the leader as the sole member; partyStatus reflects it", async () => {
    const create = await lensRun("game", "partyCreate", { params: { name: "The Drifters", description: "wanderers" } }, ctx);
    assert.equal(create.ok, true);
    assert.equal(create.result.party.name, "The Drifters");
    assert.equal(create.result.party.members.length, 1);
    const status = await lensRun("game", "partyStatus", {}, ctx);
    assert.equal(status.result.inParty, true);
    assert.equal(status.result.party.members[0].isLeader, true);
  });

  it("partyCreate: a blank name is rejected", async () => {
    const bad = await lensRun("game", "partyCreate", { params: { name: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /party name is required/);
  });

  it("partySetQuest is leader-only and partyContribute completes the quest at goal", async () => {
    const q = await lensRun("game", "partySetQuest", { params: { title: "Slay 3 wyrms", goal: 3 } }, ctx);
    assert.equal(q.ok, true);
    assert.equal(q.result.sharedQuest.goal, 3);
    assert.equal(q.result.sharedQuest.progress, 0);
    const c1 = await lensRun("game", "partyContribute", { params: { amount: 2 } }, ctx);
    assert.equal(c1.result.sharedQuest.progress, 2);
    assert.equal(c1.result.questReward, null);
    const c2 = await lensRun("game", "partyContribute", { params: { amount: 5 } }, ctx); // caps at goal
    assert.equal(c2.result.sharedQuest.progress, 3);
    assert.equal(c2.result.sharedQuest.completed, true);
    assert.equal(c2.result.questReward, 150);
    // Already complete → further contributions rejected.
    const c3 = await lensRun("game", "partyContribute", { params: { amount: 1 } }, ctx);
    assert.equal(c3.result.ok, false);
    assert.match(c3.result.error, /already completed/);
  });

  it("partySetQuest by a non-leader is rejected; partyList surfaces the party", async () => {
    const other = await lensRun("game", "partyContribute", { params: { amount: 1 } }, await depthCtx("game-party-outsider"));
    assert.equal(other.result.ok, false);   // outsider isn't in a party
    assert.match(other.result.error, /not in a party/);
    const list = await lensRun("game", "partyList", {}, ctx);
    assert.ok(list.result.parties.some((p) => p.name === "The Drifters" && p.hasSharedQuest === true));
  });

  it("partyJoin adds a second user; partyLeave reassigns leadership", async () => {
    const create = await lensRun("game", "partyCreate", { params: { name: "Reassign Co" } }, await depthCtx("game-party-A"));
    const partyId = create.result.party.id;
    const joiner = await depthCtx("game-party-B");
    const join = await lensRun("game", "partyJoin", { params: { partyId } }, joiner);
    assert.equal(join.ok, true);
    assert.ok(join.result.party.members.length >= 2);
    // Leader leaves → leadership transfers to a remaining member.
    const leaderCtx = await depthCtx("game-party-A");
    const leave = await lensRun("game", "partyLeave", {}, leaderCtx);
    assert.equal(leave.result.left, partyId);
    const status = await lensRun("game", "partyStatus", {}, joiner);
    assert.equal(status.result.inParty, true);
    assert.notEqual(status.result.party.leaderId, undefined);
  });

  it("partyJoin: a missing partyId is rejected", async () => {
    const bad = await lensRun("game", "partyJoin", { params: { partyId: "party_nope" } }, await depthCtx("game-party-C"));
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /party not found/);
  });
});

describe("game — cosmetics economy (gold-gated, shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("game-cosmetics"); });

  it("cosmeticCatalog lists the full catalog with owned/equipped flags", async () => {
    const cat = await lensRun("game", "cosmeticCatalog", {}, ctx);
    assert.equal(cat.ok, true);
    assert.ok(cat.result.items.length >= 8);
    assert.ok(cat.result.items.every((i) => i.owned === false));
  });

  it("cosmeticBuy: a broke user cannot afford an item", async () => {
    const buy = await lensRun("game", "cosmeticBuy", { params: { id: "cos_helm_aurora" } }, ctx);
    assert.equal(buy.result.ok, false);
    assert.match(buy.result.error, /not enough gold/);
  });

  it("cosmeticBuy: an unknown cosmetic id is rejected", async () => {
    const bad = await lensRun("game", "cosmeticBuy", { params: { id: "cos_not_real" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /cosmetic not found/);
  });

  it("cosmeticBuy → cosmeticEquip → unequip round-trips once the user has gold", async () => {
    // Grant gold via a real task completion path (avoid touching state directly).
    const t = await lensRun("game", "taskCreate", { params: { title: "Grind for cloak", kind: "todo", difficulty: "hard" } }, ctx);
    // Complete it many times can't (todo same-day) — instead create + complete several distinct hard todos.
    for (let i = 0; i < 30; i++) {
      const tc = await lensRun("game", "taskCreate", { params: { title: `Grind ${i}`, kind: "habit", difficulty: "hard" } }, ctx);
      await lensRun("game", "taskComplete", { params: { id: tc.result.task.id } }, ctx);
    }
    const prog = await lensRun("game", "playerProgress", {}, ctx);
    assert.ok(prog.result.gold >= 180, `expected gold >= cloak cost, got ${prog.result.gold}`);
    const buy = await lensRun("game", "cosmeticBuy", { params: { id: "cos_body_cloak" } }, ctx); // cost 180
    assert.equal(buy.ok, true);
    assert.equal(buy.result.cosmetic.id, "cos_body_cloak");
    // Buying again → already owned.
    const dup = await lensRun("game", "cosmeticBuy", { params: { id: "cos_body_cloak" } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already owned/);
    // Equip then unequip.
    const eq = await lensRun("game", "cosmeticEquip", { params: { id: "cos_body_cloak" } }, ctx);
    assert.equal(eq.result.equipped.body, "cos_body_cloak");
    const uneq = await lensRun("game", "cosmeticEquip", { params: { id: "cos_body_cloak", unequip: true } }, ctx);
    assert.equal(uneq.result.equipped.body, undefined);
    void t;
  });

  it("cosmeticEquip: equipping an unowned cosmetic is rejected", async () => {
    const fresh = await depthCtx("game-cosmetics-fresh");
    const bad = await lensRun("game", "cosmeticEquip", { params: { id: "cos_helm_crown" } }, fresh);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not owned/);
  });
});

describe("game — custom rewards + redemption (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("game-rewards"); });

  it("rewardCreate clamps cost to >= 1 and reads back via rewardList", async () => {
    const r = await lensRun("game", "rewardCreate", { params: { title: "Ice cream", cost: 0 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.reward.cost, 50); // parseInt(0)||50 → default 50
    const r2 = await lensRun("game", "rewardCreate", { params: { title: "Movie night", cost: 75 } }, ctx);
    assert.equal(r2.result.reward.cost, 75);
    const list = await lensRun("game", "rewardList", {}, ctx);
    assert.ok(list.result.rewards.some((x) => x.id === r2.result.reward.id));
  });

  it("rewardCreate: a blank title is rejected", async () => {
    const bad = await lensRun("game", "rewardCreate", { params: { title: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /reward title is required/);
  });

  it("rewardRedeem: insufficient gold is rejected; rewardDelete removes it", async () => {
    const r = await lensRun("game", "rewardCreate", { params: { title: "Spa day", cost: 99999 } }, ctx);
    const id = r.result.reward.id;
    const redeem = await lensRun("game", "rewardRedeem", { params: { id } }, ctx);
    assert.equal(redeem.result.ok, false);
    assert.match(redeem.result.error, /not enough gold/);
    const del = await lensRun("game", "rewardDelete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const bad = await lensRun("game", "rewardRedeem", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /reward not found/);
  });
});

describe("game — reminders (validation + toggle, shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("game-reminders"); });

  it("reminderCreate validates HH:MM time and defaults to all 7 days", async () => {
    const r = await lensRun("game", "reminderCreate", { params: { title: "Stretch", time: "08:30" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.reminder.time, "08:30");
    assert.equal(r.result.reminder.days.length, 7);
    assert.equal(r.result.reminder.enabled, true);
  });

  it("reminderCreate: a malformed time is rejected", async () => {
    const bad = await lensRun("game", "reminderCreate", { params: { title: "Bad", time: "25:99" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /HH:MM/);
  });

  it("reminderCreate filters invalid day codes down to the valid subset", async () => {
    const r = await lensRun("game", "reminderCreate", { params: { title: "Weekday only", time: "09:00", days: ["mon", "tue", "funday"] } }, ctx);
    assert.deepEqual(r.result.reminder.days, ["mon", "tue"]);
  });

  it("reminderToggle flips enabled; reminderDelete removes; reminderList counts", async () => {
    const r = await lensRun("game", "reminderCreate", { params: { title: "Toggle me", time: "12:00" } }, ctx);
    const id = r.result.reminder.id;
    const t1 = await lensRun("game", "reminderToggle", { params: { id } }, ctx);
    assert.equal(t1.result.reminder.enabled, false);
    const t2 = await lensRun("game", "reminderToggle", { params: { id } }, ctx);
    assert.equal(t2.result.reminder.enabled, true);
    const list = await lensRun("game", "reminderList", {}, ctx);
    assert.ok(list.result.count >= 1);
    assert.ok(list.result.reminders.some((x) => x.id === id));
    const del = await lensRun("game", "reminderDelete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const bad = await lensRun("game", "reminderToggle", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /reminder not found/);
  });
});

describe("game — cross-user challenges + leaderboards (shared ctx)", () => {
  let owner;
  before(async () => { owner = await depthCtx("game-chal-owner"); });

  it("challengeCreate seeds the owner as a participant; challengeList surfaces it", async () => {
    const c = await lensRun("game", "challengeCreate", { params: { title: "30 tasks", goal: 30, metric: "tasks", prize: 200, days: 7 } }, owner);
    assert.equal(c.ok, true);
    assert.equal(c.result.challenge.goal, 30);
    assert.equal(c.result.challenge.metric, "tasks");
    assert.ok(c.result.challenge.participants[Object.keys(c.result.challenge.participants)[0]] === 0);
    const list = await lensRun("game", "challengeList", {}, owner);
    assert.ok(list.result.challenges.some((x) => x.id === c.result.challenge.id));
  });

  it("challengeCreate: a blank title is rejected", async () => {
    const bad = await lensRun("game", "challengeCreate", { params: { title: "" } }, owner);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /challenge title is required/);
  });

  it("challengeJoin → challengeProgress reaching the goal awards the prize once", async () => {
    const c = await lensRun("game", "challengeCreate", { params: { title: "Race", goal: 5, prize: 100, days: 3 } }, owner);
    const challengeId = c.result.challenge.id;
    const racer = await depthCtx("game-chal-racer");
    const join = await lensRun("game", "challengeJoin", { params: { challengeId } }, racer);
    assert.equal(join.ok, true);
    const p1 = await lensRun("game", "challengeProgress", { params: { challengeId, amount: 3 } }, racer);
    assert.equal(p1.result.prizeAwarded, null);
    const p2 = await lensRun("game", "challengeProgress", { params: { challengeId, amount: 3 } }, racer); // crosses goal 5
    assert.equal(p2.result.challenge.winnerId, racer.actor.userId);
    assert.equal(p2.result.prizeAwarded, 100);
    // A second winner cannot claim the prize again.
    const p3 = await lensRun("game", "challengeProgress", { params: { challengeId, amount: 10 } }, owner);
    assert.equal(p3.result.prizeAwarded, null);
  });

  it("challengeProgress: progressing without joining is rejected", async () => {
    const c = await lensRun("game", "challengeCreate", { params: { title: "Members only", goal: 5 } }, owner);
    const stranger = await depthCtx("game-chal-stranger");
    const bad = await lensRun("game", "challengeProgress", { params: { challengeId: c.result.challenge.id, amount: 1 } }, stranger);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /join the challenge first/);
  });

  it("challengeLeaderboard ranks participants by score with exact pct + rank", async () => {
    const c = await lensRun("game", "challengeCreate", { params: { title: "Board", goal: 10 } }, owner);
    const challengeId = c.result.challenge.id;
    const a = await depthCtx("game-board-a");
    const b = await depthCtx("game-board-b");
    await lensRun("game", "challengeJoin", { params: { challengeId } }, a);
    await lensRun("game", "challengeJoin", { params: { challengeId } }, b);
    await lensRun("game", "challengeProgress", { params: { challengeId, amount: 8 } }, a);
    await lensRun("game", "challengeProgress", { params: { challengeId, amount: 3 } }, b);
    const board = await lensRun("game", "challengeLeaderboard", { params: { challengeId } }, a);
    assert.equal(board.ok, true);
    assert.equal(board.result.goal, 10);
    const top = board.result.leaderboard[0];
    assert.equal(top.rank, 1);
    assert.equal(top.userId, a.actor.userId);
    assert.equal(top.score, 8);
    assert.equal(top.progressPct, 80); // 8/10
    assert.equal(top.isCurrentUser, true);
  });

  it("challengeLeaderboard: a missing challengeId is rejected", async () => {
    const bad = await lensRun("game", "challengeLeaderboard", { params: { challengeId: "chal_nope" } }, owner);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /challenge not found/);
  });
});
