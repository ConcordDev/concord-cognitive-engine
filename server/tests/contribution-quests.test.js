// server/tests/contribution-quests.test.js
//
// Contribution Quests (#36) — completion is VERIFIABLE from real authored DTUs,
// not self-reported. Reward claim is idempotent and survives an uninitialised
// treasury (records the claim, reward_minted=0). Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createDTU } from "../economy/dtu-pipeline.js";
import {
  createContributionQuest, refreshProgress, claimReward, listOpenQuests, getQuestProgress,
} from "../lib/contribution-quests.js";
import registerContribMacros from "../domains/contrib.js";

function author(db, creator, lens, n) {
  for (let i = 0; i < n; i++) {
    createDTU(db, { creatorId: creator, title: `${lens} ${i}-${Math.random()}`, content: `c${i}`, contentType: "text", lensId: lens, citationMode: "original" });
  }
}

describe("Contribution Quests (#36)", () => {
  let db, macros, questId;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerContribMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
    // Quest opens NOW; only DTUs authored at/after start count.
    const q = createContributionQuest(db, { sponsorId: "sponsor", title: "Write 2 lore DTUs", targetLens: "literary", targetCount: 2, rewardCc: 5 });
    questId = q.questId;
  });

  it("measures progress from REAL authored DTUs (not self-reported)", () => {
    let p = refreshProgress(db, questId, "u1");
    assert.equal(p.contributed, 0, "no work yet");
    assert.equal(p.completed, false);
    author(db, "u1", "literary", 1);
    p = refreshProgress(db, questId, "u1");
    assert.equal(p.contributed, 1);
    assert.equal(p.completed, false, "1 of 2");
    author(db, "u1", "literary", 1);
    p = refreshProgress(db, questId, "u1");
    assert.equal(p.contributed, 2);
    assert.equal(p.completed, true, "target met");
  });

  it("DTUs in OTHER lenses don't count toward the quest", () => {
    author(db, "u2", "code", 5);
    const p = refreshProgress(db, questId, "u2");
    assert.equal(p.contributed, 0, "wrong lens");
    assert.equal(p.completed, false);
  });

  it("cannot claim before completion; claim is idempotent after", () => {
    const early = claimReward(db, questId, "u2");
    assert.equal(early.ok, false);
    assert.equal(early.reason, "not_completed");

    // u1 completed above.
    const first = claimReward(db, questId, "u1");
    assert.equal(first.ok, true);
    assert.equal(first.rewardCc, 5);
    assert.equal(typeof first.minted, "boolean", "mint outcome recorded (true when treasury ready)");
    // Idempotent: a second claim does not double-pay.
    const second = claimReward(db, questId, "u1");
    assert.equal(second.ok, true);
    assert.equal(second.alreadyClaimed, true);
    // The mint is idempotent on the refId — exactly one MINT event for this quest+user.
    const mints = db.prepare("SELECT COUNT(*) AS n FROM treasury_events WHERE event_type='MINT' AND ref_id = ?").get(`contrib_quest:${questId}:u1`).n;
    assert.ok(mints <= 1, "reward minted at most once");
  });

  it("lists open quests + a user's progress", () => {
    const open = listOpenQuests(db, { targetLens: "literary" });
    assert.ok(open.some((q) => q.id === questId));
    const mine = getQuestProgress(db, "u1");
    assert.ok(mine.some((m) => m.questId === questId && m.completedAt));
  });

  it("contrib macros round-trip", async () => {
    const c = await macros.get("contrib.create")({ db, actor: { userId: "sp2" } }, { title: "macro quest", targetLens: "game", targetCount: 1 });
    assert.equal(c.ok, true);
    author(db, "u3", "game", 1);
    const p = await macros.get("contrib.progress")({ db, actor: { userId: "u3" } }, { questId: c.questId });
    assert.equal(p.completed, true);
    const claim = await macros.get("contrib.claim")({ db, actor: { userId: "u3" } }, { questId: c.questId });
    assert.equal(claim.ok, true);
  });
});
