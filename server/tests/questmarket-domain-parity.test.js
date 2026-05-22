// Contract tests for server/domains/questmarket.js
// Pure-math macros (balanceDifficulty, leaderboardRank, achievementUnlock,
// guildScore, rewardEconomics) plus the transactional lifecycle layer
// (accept → submit → verify, bounty escrow + payout, guilds, reputation).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerQuestmarketActions from "../domains/questmarket.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`questmarket.${name}`);
  if (!fn) throw new Error(`questmarket.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
function callArtifact(name, ctx, data = {}) {
  const fn = ACTIONS.get(`questmarket.${name}`);
  if (!fn) throw new Error(`questmarket.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, {});
}

before(() => { registerQuestmarketActions(register); });

beforeEach(() => {
  // Fresh in-memory state per test.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxC = { actor: { userId: "user_c" }, userId: "user_c" };

describe("questmarket — pure-math macros", () => {
  it("balanceDifficulty flags under-rewarded quests", () => {
    const r = callArtifact("balanceDifficulty", ctxA, { difficulty: "hard", reward: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.rewardBalance, "under-rewarded");
  });

  it("leaderboardRank ranks participants by composite score", () => {
    const r = callArtifact("leaderboardRank", ctxA, {
      participants: [
        { name: "A", xp: 5000, questsCompleted: 10, streak: 3 },
        { name: "B", xp: 100, questsCompleted: 1, streak: 0 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.leaderboard[0].name, "A");
    assert.equal(r.result.leaderboard[0].rank, 1);
  });

  it("achievementUnlock reports newly unlocked achievements", () => {
    const r = callArtifact("achievementUnlock", ctxA, {
      playerStats: { questsCompleted: 5, totalXP: 1000 },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.newlyUnlocked.length > 0);
  });

  it("guildScore computes guild tier", () => {
    const r = callArtifact("guildScore", ctxA, {
      guildName: "Test", guildQuests: 5,
      members: [{ name: "x", xp: 1000, questsCompleted: 5 }],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.guildScore > 0);
  });

  it("rewardEconomics summarises distributed CC", () => {
    const r = callArtifact("rewardEconomics", ctxA, {
      quests: [{ reward: 100, difficulty: "medium", status: "completed" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDistributed, 100);
  });
});

describe("questmarket — wallet + posting", () => {
  it("walletGet grants a starting balance", () => {
    const r = call("walletGet", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.balance, 1000);
    assert.equal(r.result.escrowed, 0);
  });

  it("postQuest with reward locks CC in escrow", () => {
    const r = call("postQuest", ctxA, { title: "Slay the bug", kind: "bounty", reward: 250 });
    assert.equal(r.ok, true);
    assert.equal(r.result.quest.status, "open");
    assert.equal(r.result.walletBalance, 750);
    assert.equal(r.result.escrowed, 250);
  });

  it("postQuest rejects insufficient balance", () => {
    const r = call("postQuest", ctxA, { title: "Too rich", reward: 5000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /insufficient/);
  });

  it("postQuest requires a title", () => {
    const r = call("postQuest", ctxA, { reward: 10 });
    assert.equal(r.ok, false);
  });

  it("cancelQuest refunds escrow to the poster", () => {
    const posted = call("postQuest", ctxA, { title: "Cancelme", reward: 200 });
    const r = call("cancelQuest", ctxA, { questId: posted.result.quest.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.quest.status, "cancelled");
    const w = call("walletGet", ctxA);
    assert.equal(w.result.balance, 1000);
    assert.equal(w.result.escrowed, 0);
  });
});

describe("questmarket — accept → submit → verify lifecycle", () => {
  it("runs the full happy path and pays out escrow", () => {
    const posted = call("postQuest", ctxA, { title: "Build it", reward: 300, difficulty: "hard" });
    const qid = posted.result.quest.id;

    const accepted = call("acceptQuest", ctxB, { questId: qid });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.result.claim.status, "accepted");
    const cid = accepted.result.claim.id;

    const submitted = call("submitProof", ctxB, { claimId: cid, summary: "Done", links: ["http://x"] });
    assert.equal(submitted.ok, true);
    assert.equal(submitted.result.claim.status, "submitted");

    const verified = call("verifyClaim", ctxA, { claimId: cid, approve: true });
    assert.equal(verified.ok, true);
    assert.equal(verified.result.outcome, "verified");
    assert.equal(verified.result.payout, 300);
    assert.equal(verified.result.xpGain, 200);

    // Claimant received the payout.
    const wB = call("walletGet", ctxB);
    assert.equal(wB.result.balance, 1300);
    // Poster's escrow released.
    const wA = call("walletGet", ctxA);
    assert.equal(wA.result.escrowed, 0);
  });

  it("cannot accept your own quest", () => {
    const posted = call("postQuest", ctxA, { title: "Mine" });
    const r = call("acceptQuest", ctxA, { questId: posted.result.quest.id });
    assert.equal(r.ok, false);
  });

  it("verifyClaim rejecting does not pay out", () => {
    const posted = call("postQuest", ctxA, { title: "Reject path", reward: 150 });
    const cid = call("acceptQuest", ctxB, { questId: posted.result.quest.id }).result.claim.id;
    call("submitProof", ctxB, { claimId: cid, summary: "weak" });
    const r = call("verifyClaim", ctxA, { claimId: cid, approve: false });
    assert.equal(r.ok, true);
    assert.equal(r.result.outcome, "rejected");
    const wB = call("walletGet", ctxB);
    assert.equal(wB.result.balance, 1000);
  });

  it("only the poster can verify", () => {
    const posted = call("postQuest", ctxA, { title: "Guard" });
    const cid = call("acceptQuest", ctxB, { questId: posted.result.quest.id }).result.claim.id;
    call("submitProof", ctxB, { claimId: cid, summary: "x" });
    const r = call("verifyClaim", ctxC, { claimId: cid });
    assert.equal(r.ok, false);
  });

  it("abandonClaim reopens the quest", () => {
    const posted = call("postQuest", ctxA, { title: "Abandonable" });
    const cid = call("acceptQuest", ctxB, { questId: posted.result.quest.id }).result.claim.id;
    const r = call("abandonClaim", ctxB, { claimId: cid });
    assert.equal(r.ok, true);
    assert.equal(r.result.claim.status, "abandoned");
  });

  it("myClaims and questClaims surface lifecycle records", () => {
    const posted = call("postQuest", ctxA, { title: "Visible" });
    call("acceptQuest", ctxB, { questId: posted.result.quest.id });
    const mine = call("myClaims", ctxB);
    assert.equal(mine.ok, true);
    assert.equal(mine.result.total, 1);
    const qc = call("questClaims", ctxA, { questId: posted.result.quest.id });
    assert.equal(qc.ok, true);
    assert.equal(qc.result.total, 1);
  });
});

describe("questmarket — discovery + filtering", () => {
  it("listQuests filters by kind, difficulty and tag", () => {
    call("postQuest", ctxA, { title: "Easy one", difficulty: "easy", tags: ["combat"] });
    call("postQuest", ctxA, { title: "Hard bounty", kind: "bounty", difficulty: "hard", reward: 100, tags: ["code"] });
    const byKind = call("listQuests", ctxB, { kind: "bounty" });
    assert.equal(byKind.ok, true);
    assert.equal(byKind.result.total, 1);
    const byTag = call("listQuests", ctxB, { tag: "combat" });
    assert.equal(byTag.result.total, 1);
    const byMin = call("listQuests", ctxB, { minReward: 50 });
    assert.equal(byMin.result.total, 1);
  });
});

describe("questmarket — reputation + achievements", () => {
  it("myReputation reflects completed quests", () => {
    const posted = call("postQuest", ctxA, { title: "Rep quest", difficulty: "medium" });
    const cid = call("acceptQuest", ctxB, { questId: posted.result.quest.id }).result.claim.id;
    call("submitProof", ctxB, { claimId: cid, summary: "ok" });
    call("verifyClaim", ctxA, { claimId: cid });
    const r = call("myReputation", ctxB);
    assert.equal(r.ok, true);
    assert.equal(r.result.completed, 1);
    assert.equal(r.result.xp, 75);
  });

  it("achievementShowcase unlocks First Steps after a completion", () => {
    const posted = call("postQuest", ctxA, { title: "Ach quest" });
    const cid = call("acceptQuest", ctxB, { questId: posted.result.quest.id }).result.claim.id;
    call("submitProof", ctxB, { claimId: cid, summary: "ok" });
    call("verifyClaim", ctxA, { claimId: cid });
    const r = call("achievementShowcase", ctxB);
    assert.equal(r.ok, true);
    assert.ok(r.result.unlocked.some((a) => a.id === "first-quest"));
  });

  it("reputationBoard ranks adventurers by xp", () => {
    const posted = call("postQuest", ctxA, { title: "Board quest" });
    const cid = call("acceptQuest", ctxB, { questId: posted.result.quest.id }).result.claim.id;
    call("submitProof", ctxB, { claimId: cid, summary: "ok" });
    call("verifyClaim", ctxA, { claimId: cid });
    const r = call("reputationBoard", ctxB);
    assert.equal(r.ok, true);
    assert.ok(r.result.board.length >= 1);
  });
});

describe("questmarket — guilds", () => {
  it("createGuild → joinGuild → guildDetail", () => {
    const g = call("createGuild", ctxA, { name: "Iron Wolves" });
    assert.equal(g.ok, true);
    const gid = g.result.guild.id;
    const joined = call("joinGuild", ctxB, { guildId: gid });
    assert.equal(joined.ok, true);
    assert.equal(joined.result.memberCount, 2);
    const detail = call("guildDetail", ctxA, { guildId: gid });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.memberCount, 2);
  });

  it("createGuild rejects duplicate names", () => {
    call("createGuild", ctxA, { name: "Dups" });
    const r = call("createGuild", ctxB, { name: "dups" });
    assert.equal(r.ok, false);
  });

  it("guild-bound quest credits guild on verify", () => {
    const g = call("createGuild", ctxA, { name: "Builders" });
    call("joinGuild", ctxB, { guildId: g.result.guild.id });
    const posted = call("postQuest", ctxA, {
      title: "Guild quest", difficulty: "hard", guildId: g.result.guild.id,
    });
    const cid = call("acceptQuest", ctxB, { questId: posted.result.quest.id }).result.claim.id;
    call("submitProof", ctxB, { claimId: cid, summary: "ok" });
    call("verifyClaim", ctxA, { claimId: cid });
    const detail = call("guildDetail", ctxA, { guildId: g.result.guild.id });
    assert.equal(detail.result.guild.totalXp, 200);
    assert.equal(detail.result.guild.questsCompleted, 1);
  });

  it("listGuilds marks membership", () => {
    call("createGuild", ctxA, { name: "Listed" });
    const r = call("listGuilds", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.guilds[0].isMember, true);
  });

  it("leaveGuild removes a member", () => {
    const g = call("createGuild", ctxA, { name: "Leavers" });
    call("joinGuild", ctxB, { guildId: g.result.guild.id });
    const r = call("leaveGuild", ctxB, { guildId: g.result.guild.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.memberCount, 1);
  });
});

describe("questmarket — market stats", () => {
  it("marketStats aggregates the marketplace", () => {
    call("postQuest", ctxA, { title: "Stat quest", reward: 100 });
    const r = call("marketStats", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalQuests, 1);
    assert.equal(r.result.totalEscrowed, 100);
  });

  it("marketStats records payout in the recent ledger", () => {
    const posted = call("postQuest", ctxA, { title: "Ledger quest", reward: 120 });
    const cid = call("acceptQuest", ctxB, { questId: posted.result.quest.id }).result.claim.id;
    call("submitProof", ctxB, { claimId: cid, summary: "ok" });
    call("verifyClaim", ctxA, { claimId: cid });
    const r = call("marketStats", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPaidOut, 120);
    assert.ok(r.result.recentLedger.some((e) => e.type === "payout"));
  });
});

describe("questmarket — UI-facing macro shapes", () => {
  it("myReputation exposes rank ladder + progress for the rep card", () => {
    const r = call("myReputation", ctxA);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.ranks) && r.result.ranks.length > 0);
    assert.equal(typeof r.result.rankProgressPct, "number");
    assert.equal(r.result.rank, "Novice");
  });

  it("achievementShowcase returns locked + unlocked split for the showcase grid", () => {
    const r = call("achievementShowcase", ctxA);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.locked));
    assert.ok(Array.isArray(r.result.unlocked));
    assert.equal(r.result.totalCount, r.result.locked.length + r.result.unlocked.length);
  });

  it("listQuests annotates the caller's own claim state", () => {
    const posted = call("postQuest", ctxA, { title: "Annotate me" });
    call("acceptQuest", ctxB, { questId: posted.result.quest.id });
    const r = call("listQuests", ctxB, {});
    assert.equal(r.ok, true);
    const q = r.result.quests.find((x) => x.id === posted.result.quest.id);
    assert.equal(q.myClaimStatus, "accepted");
    assert.ok(q.myClaimId);
  });

  it("guildDetail surfaces shared quests bound to the guild", () => {
    const g = call("createGuild", ctxA, { name: "SharedQuesters" });
    call("postQuest", ctxA, {
      title: "Guild objective", guildId: g.result.guild.id, reward: 50,
    });
    const detail = call("guildDetail", ctxA, { guildId: g.result.guild.id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.sharedQuestCount, 1);
    assert.equal(detail.result.sharedQuests[0].title, "Guild objective");
  });

  it("rewardEconomics summarises real lifecycle quest data", () => {
    const posted = call("postQuest", ctxA, { title: "Econ", reward: 80, difficulty: "medium" });
    const cid = call("acceptQuest", ctxB, { questId: posted.result.quest.id }).result.claim.id;
    call("submitProof", ctxB, { claimId: cid, summary: "ok" });
    call("verifyClaim", ctxA, { claimId: cid });
    const listed = call("listQuests", ctxA, {});
    const quests = listed.result.quests.map((q) => ({
      reward: q.reward,
      difficulty: q.difficulty,
      status: q.status === "resolved" ? "completed" : q.status,
    }));
    const r = callArtifact("rewardEconomics", ctxA, { quests });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDistributed, 80);
  });
});
