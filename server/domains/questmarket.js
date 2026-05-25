// server/domains/questmarket.js
// Domain actions for quest marketplace: quest difficulty balancing,
// reward economics, leaderboard ranking, achievement unlocking, guild scoring.
//
// Plus a real transactional lifecycle layer (per-user, in globalThis._concordSTATE):
// quest accept → submit → verify, bounty escrow + payout, guild membership +
// shared quests, reputation/rank progression, achievement showcase.

export default function registerQuestmarketActions(registerLensAction) {
  // ── persistent state ──
  function qmState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.questmarketLens) {
      STATE.questmarketLens = {
        quests: new Map(),     // questId -> quest record
        claims: new Map(),     // claimId -> claim record
        wallets: new Map(),    // userId -> { balance, escrowed }
        guilds: new Map(),     // guildId -> guild record
        guildMembers: new Map(), // guildId -> Map<userId, member>
        reputation: new Map(), // userId -> { xp, rank, completed, streak, lastCompletedDay }
        achievements: new Map(), // userId -> Map<achId, { id, name, rarity, unlockedAt }>
        ledger: [],            // economic events
      };
    }
    return STATE.questmarketLens;
  }
  function qmSave() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function qmActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function qmId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function qmNow() { return new Date().toISOString(); }
  function qmDay() { return new Date().toISOString().slice(0, 10); }

  // Starting wallet grant so users can post bounties without an external
  // ledger dependency — this is the lens-local CC pool, not the global wallet.
  const STARTING_BALANCE = 1000;
  function qmWallet(s, userId) {
    if (!s.wallets.has(userId)) {
      s.wallets.set(userId, { balance: STARTING_BALANCE, escrowed: 0 });
    }
    return s.wallets.get(userId);
  }

  // Reputation ranks — cumulative XP thresholds.
  const RANKS = [
    { name: "Novice", min: 0 },
    { name: "Apprentice", min: 100 },
    { name: "Journeyman", min: 400 },
    { name: "Adept", min: 1000 },
    { name: "Expert", min: 2500 },
    { name: "Master", min: 6000 },
    { name: "Grandmaster", min: 15000 },
    { name: "Legend", min: 40000 },
  ];
  function rankForXp(xp) {
    let r = RANKS[0];
    for (const cand of RANKS) { if (xp >= cand.min) r = cand; }
    return r;
  }
  function nextRank(xp) {
    return RANKS.find((r) => r.min > xp) || null;
  }
  function qmRep(s, userId) {
    if (!s.reputation.has(userId)) {
      s.reputation.set(userId, {
        xp: 0, rank: "Novice", completed: 0, posted: 0,
        streak: 0, lastCompletedDay: null,
      });
    }
    return s.reputation.get(userId);
  }

  const XP_BY_DIFFICULTY = { easy: 25, medium: 75, hard: 200, legendary: 600 };

  // Achievement catalogue — evaluated against a player's reputation snapshot.
  const ACH_CATALOG = [
    { id: "first-quest", name: "First Steps", rarity: "Common", test: (r) => r.completed >= 1 },
    { id: "five-quests", name: "Adventurer", rarity: "Common", test: (r) => r.completed >= 5 },
    { id: "twenty-quests", name: "Veteran", rarity: "Uncommon", test: (r) => r.completed >= 20 },
    { id: "fifty-quests", name: "Champion", rarity: "Rare", test: (r) => r.completed >= 50 },
    { id: "hundred-quests", name: "Legend", rarity: "Epic", test: (r) => r.completed >= 100 },
    { id: "xp-1k", name: "Scholar", rarity: "Uncommon", test: (r) => r.xp >= 1000 },
    { id: "xp-10k", name: "Sage", rarity: "Rare", test: (r) => r.xp >= 10000 },
    { id: "streak-7", name: "Consistent", rarity: "Common", test: (r) => r.streak >= 7 },
    { id: "streak-30", name: "Dedicated", rarity: "Uncommon", test: (r) => r.streak >= 30 },
    { id: "patron", name: "Patron", rarity: "Uncommon", test: (r) => r.posted >= 10 },
    { id: "adept-rank", name: "Risen Adept", rarity: "Rare", test: (r) => r.xp >= 1000 },
    { id: "master-rank", name: "Master of the Board", rarity: "Epic", test: (r) => r.xp >= 6000 },
  ];
  function evaluateAchievements(s, userId) {
    const rep = qmRep(s, userId);
    if (!s.achievements.has(userId)) s.achievements.set(userId, new Map());
    const owned = s.achievements.get(userId);
    const newly = [];
    for (const a of ACH_CATALOG) {
      if (!owned.has(a.id) && a.test(rep)) {
        const rec = { id: a.id, name: a.name, rarity: a.rarity, unlockedAt: qmNow() };
        owned.set(a.id, rec);
        newly.push(rec);
      }
    }
    return newly;
  }

  /**
   * balanceDifficulty
   * Analyze quest parameters and suggest difficulty/reward adjustments.
   * artifact.data: { difficulty, reward, completionCriteria, maxParticipants, deadline, completionRate }
   */
  registerLensAction("questmarket", "balanceDifficulty", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const difficulty = (data.difficulty || "medium").toLowerCase();
    const reward = parseFloat(data.reward) || 0;
    const maxParticipants = parseInt(data.maxParticipants) || 10;
    const completionRate = parseFloat(data.completionRate) || 0.5;

    // Target completion rates by difficulty
    const targets = {
      easy: { completionTarget: 0.8, rewardRange: [10, 50], timeMultiplier: 1 },
      medium: { completionTarget: 0.5, rewardRange: [50, 200], timeMultiplier: 1.5 },
      hard: { completionTarget: 0.25, rewardRange: [200, 500], timeMultiplier: 2 },
      legendary: { completionTarget: 0.1, rewardRange: [500, 2000], timeMultiplier: 3 },
    };

    const target = targets[difficulty] || targets.medium;
    const [minReward, maxReward] = target.rewardRange;

    // Balance analysis
    const rewardBalance = reward >= minReward && reward <= maxReward ? "balanced"
      : reward < minReward ? "under-rewarded" : "over-rewarded";

    const completionBalance = Math.abs(completionRate - target.completionTarget) < 0.15 ? "balanced"
      : completionRate > target.completionTarget + 0.15 ? "too-easy" : "too-hard";

    // Suggested adjustments
    const suggestedReward = Math.round((minReward + maxReward) / 2);
    const adjustments = [];
    if (rewardBalance === "under-rewarded") adjustments.push(`Increase reward to ${suggestedReward} DTU (current: ${reward})`);
    if (rewardBalance === "over-rewarded") adjustments.push(`Decrease reward to ${suggestedReward} DTU (current: ${reward})`);
    if (completionBalance === "too-easy") adjustments.push("Add harder completion criteria or reduce time limit");
    if (completionBalance === "too-hard") adjustments.push("Simplify criteria or increase participant limit");

    // XP calculation: base XP scaled by difficulty
    const xpMultipliers = { easy: 1, medium: 2, hard: 4, legendary: 10 };
    const suggestedXP = Math.round(reward * (xpMultipliers[difficulty] || 2) * 0.1);

    return {
      ok: true,
      result: {
        difficulty,
        currentReward: reward,
        suggestedReward,
        suggestedXP,
        rewardBalance,
        completionBalance,
        targetCompletionRate: target.completionTarget,
        actualCompletionRate: completionRate,
        adjustments,
        overallBalance: adjustments.length === 0 ? "Well balanced" : `${adjustments.length} adjustment(s) recommended`,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * leaderboardRank
   * Calculate rankings based on XP, quests completed, streak, and rarity bonuses.
   * artifact.data: { participants: [{ name, xp, questsCompleted, streak, achievements }] }
   */
  registerLensAction("questmarket", "leaderboardRank", (ctx, artifact, _params) => {
  try {
    const participants = artifact.data?.participants || [];
    if (participants.length === 0) {
      return { ok: true, result: { message: "No participants to rank. Add quest completions to generate leaderboard." } };
    }

    const rarityBonuses = { Common: 0, Uncommon: 5, Rare: 15, Epic: 30, Legendary: 50, Mythic: 100 };

    const ranked = participants.map(p => {
      const baseXP = parseInt(p.xp) || 0;
      const questsCompleted = parseInt(p.questsCompleted) || 0;
      const streak = parseInt(p.streak) || 0;

      // Achievement rarity bonus
      const achievementBonus = (p.achievements || []).reduce((s, a) => {
        return s + (rarityBonuses[a.rarity || a] || 0);
      }, 0);

      // Streak multiplier: 5% bonus per consecutive day, max 50%
      const streakMultiplier = 1 + Math.min(streak * 0.05, 0.5);

      // Composite score
      const score = Math.round((baseXP + achievementBonus) * streakMultiplier + questsCompleted * 10);

      // Tier classification
      let tier = "Bronze";
      if (score >= 10000) tier = "Diamond";
      else if (score >= 5000) tier = "Platinum";
      else if (score >= 2000) tier = "Gold";
      else if (score >= 500) tier = "Silver";

      return {
        name: p.name,
        score,
        tier,
        baseXP,
        questsCompleted,
        streak,
        achievementBonus,
        streakMultiplier: Math.round(streakMultiplier * 100) / 100,
      };
    }).sort((a, b) => b.score - a.score);

    // Assign ranks
    ranked.forEach((p, i) => { p.rank = i + 1; });

    return {
      ok: true,
      result: {
        leaderboard: ranked,
        totalParticipants: ranked.length,
        topPlayer: ranked[0]?.name || "N/A",
        tierDistribution: ranked.reduce((acc, p) => { acc[p.tier] = (acc[p.tier] || 0) + 1; return acc; }, {}),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * achievementUnlock
   * Check if an action qualifies for achievement unlocks.
   * artifact.data: { playerStats: { questsCompleted, totalXP, streakDays, uniqueCategories }, achievements: [existing] }
   */
  registerLensAction("questmarket", "achievementUnlock", (ctx, artifact, _params) => {
  try {
    const stats = artifact.data?.playerStats || {};
    const existing = (artifact.data?.achievements || []).map(a => a.id || a.name || a);

    const questsCompleted = parseInt(stats.questsCompleted) || 0;
    const totalXP = parseInt(stats.totalXP) || 0;
    const streakDays = parseInt(stats.streakDays) || 0;
    const uniqueCategories = parseInt(stats.uniqueCategories) || 0;

    // Achievement definitions
    const allAchievements = [
      { id: "first-quest", name: "First Steps", rarity: "Common", condition: questsCompleted >= 1, desc: "Complete your first quest" },
      { id: "five-quests", name: "Adventurer", rarity: "Common", condition: questsCompleted >= 5, desc: "Complete 5 quests" },
      { id: "twenty-quests", name: "Veteran", rarity: "Uncommon", condition: questsCompleted >= 20, desc: "Complete 20 quests" },
      { id: "fifty-quests", name: "Champion", rarity: "Rare", condition: questsCompleted >= 50, desc: "Complete 50 quests" },
      { id: "hundred-quests", name: "Legend", rarity: "Epic", condition: questsCompleted >= 100, desc: "Complete 100 quests" },
      { id: "xp-1k", name: "Scholar", rarity: "Uncommon", condition: totalXP >= 1000, desc: "Earn 1,000 XP" },
      { id: "xp-10k", name: "Sage", rarity: "Rare", condition: totalXP >= 10000, desc: "Earn 10,000 XP" },
      { id: "xp-100k", name: "Archmage", rarity: "Legendary", condition: totalXP >= 100000, desc: "Earn 100,000 XP" },
      { id: "streak-7", name: "Consistent", rarity: "Common", condition: streakDays >= 7, desc: "7-day quest streak" },
      { id: "streak-30", name: "Dedicated", rarity: "Uncommon", condition: streakDays >= 30, desc: "30-day quest streak" },
      { id: "streak-100", name: "Unstoppable", rarity: "Epic", condition: streakDays >= 100, desc: "100-day quest streak" },
      { id: "explorer-5", name: "Explorer", rarity: "Uncommon", condition: uniqueCategories >= 5, desc: "Complete quests in 5 categories" },
      { id: "polymath", name: "Polymath", rarity: "Rare", condition: uniqueCategories >= 8, desc: "Complete quests in 8 categories" },
    ];

    const newlyUnlocked = allAchievements.filter(a => a.condition && !existing.includes(a.id));
    const alreadyUnlocked = allAchievements.filter(a => existing.includes(a.id));
    const locked = allAchievements.filter(a => !a.condition && !existing.includes(a.id));

    return {
      ok: true,
      result: {
        newlyUnlocked: newlyUnlocked.map(a => ({ id: a.id, name: a.name, rarity: a.rarity, desc: a.desc })),
        alreadyUnlocked: alreadyUnlocked.length,
        totalAchievements: allAchievements.length,
        completionRate: Math.round(((alreadyUnlocked.length + newlyUnlocked.length) / allAchievements.length) * 100),
        nextUp: locked.slice(0, 3).map(a => ({ name: a.name, rarity: a.rarity, desc: a.desc })),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * guildScore
   * Calculate guild performance metrics and rank.
   * artifact.data: { guildName, members: [{ name, xp, questsCompleted }], guildQuests }
   */
  registerLensAction("questmarket", "guildScore", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const members = data.members || [];
    const guildQuests = parseInt(data.guildQuests) || 0;

    if (members.length === 0) {
      return { ok: true, result: { message: "No guild members. Add members to calculate guild score." } };
    }

    const totalXP = members.reduce((s, m) => s + (parseInt(m.xp) || 0), 0);
    const totalQuests = members.reduce((s, m) => s + (parseInt(m.questsCompleted) || 0), 0);
    const avgXP = Math.round(totalXP / members.length);
    const avgQuests = Math.round(totalQuests / members.length);

    // Guild score: weighted combination
    const guildScore = Math.round(totalXP * 0.4 + totalQuests * 50 * 0.3 + guildQuests * 100 * 0.2 + members.length * 25 * 0.1);

    let guildTier = "Bronze";
    if (guildScore >= 50000) guildTier = "Diamond";
    else if (guildScore >= 20000) guildTier = "Platinum";
    else if (guildScore >= 8000) guildTier = "Gold";
    else if (guildScore >= 2000) guildTier = "Silver";

    // Top contributors
    const topContributors = members
      .map(m => ({ name: m.name, xp: parseInt(m.xp) || 0, quests: parseInt(m.questsCompleted) || 0 }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 5);

    return {
      ok: true,
      result: {
        guildName: data.guildName || "Unnamed Guild",
        guildScore,
        guildTier,
        memberCount: members.length,
        totalXP,
        totalQuests,
        guildQuests,
        avgXP,
        avgQuests,
        topContributors,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * rewardEconomics
   * Analyze reward distribution and inflation across the quest ecosystem.
   * artifact.data: { quests: [{ reward, difficulty, status, completedAt }] }
   */
  registerLensAction("questmarket", "rewardEconomics", (ctx, artifact, _params) => {
  try {
    const quests = artifact.data?.quests || [];
    if (quests.length === 0) {
      return { ok: true, result: { message: "No quest data. Create quests to analyze reward economics." } };
    }

    const completed = quests.filter(q => q.status === "completed");
    const totalDistributed = completed.reduce((s, q) => s + (parseFloat(q.reward) || 0), 0);
    const totalPending = quests.filter(q => q.status !== "completed").reduce((s, q) => s + (parseFloat(q.reward) || 0), 0);

    // Reward distribution by difficulty
    const byDifficulty = {};
    for (const q of quests) {
      const diff = q.difficulty || "medium";
      if (!byDifficulty[diff]) byDifficulty[diff] = { count: 0, totalReward: 0, completed: 0 };
      byDifficulty[diff].count++;
      byDifficulty[diff].totalReward += parseFloat(q.reward) || 0;
      if (q.status === "completed") byDifficulty[diff].completed++;
    }

    for (const [, data] of Object.entries(byDifficulty)) {
      data.avgReward = data.count > 0 ? Math.round(data.totalReward / data.count) : 0;
      data.completionRate = data.count > 0 ? Math.round((data.completed / data.count) * 100) : 0;
    }

    // Monthly burn rate (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const recentCompleted = completed.filter(q => q.completedAt && new Date(q.completedAt) >= thirtyDaysAgo);
    const monthlyBurn = recentCompleted.reduce((s, q) => s + (parseFloat(q.reward) || 0), 0);

    return {
      ok: true,
      result: {
        totalQuests: quests.length,
        completedQuests: completed.length,
        totalDistributed,
        totalPending,
        monthlyBurnRate: monthlyBurn,
        projectedAnnualBurn: monthlyBurn * 12,
        byDifficulty,
        healthCheck: monthlyBurn > totalPending * 2
          ? "High burn rate — consider adding more quests or reducing rewards"
          : "Reward economy is sustainable",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ────────────────────────────────────────────────────────────
  //  Transactional lifecycle layer (real per-user persistent data)
  // ────────────────────────────────────────────────────────────

  // ── Wallet (lens-local CC pool) ──

  registerLensAction("questmarket", "walletGet", (ctx, _artifact, _params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const w = qmWallet(s, userId);
    return {
      ok: true,
      result: {
        balance: w.balance,
        escrowed: w.escrowed,
        available: w.balance,
        userId,
      },
    };
  });

  // ── Quest / bounty posting with escrow ──
  // Posting a bounty locks the reward CC in escrow. Posting a quest with
  // reward 0 escrows nothing.

  registerLensAction("questmarket", "postQuest", (ctx, _artifact, params = {}) => {
  try {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    if (title.length > 140) return { ok: false, error: "title too long" };
    const kind = params.kind === "bounty" ? "bounty" : "quest";
    const reward = Math.max(0, Math.round(Number(params.reward) || 0));
    const difficulty = ["easy", "medium", "hard", "legendary"].includes(params.difficulty)
      ? params.difficulty : "medium";
    const tags = Array.isArray(params.tags)
      ? params.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : [];
    const maxClaimants = Math.max(1, Math.min(50, Math.round(Number(params.maxClaimants) || 1)));
    const w = qmWallet(s, userId);
    if (reward > 0 && w.balance < reward) {
      return { ok: false, error: `insufficient balance — need ${reward}, have ${w.balance}` };
    }
    if (reward > 0) { w.balance -= reward; w.escrowed += reward; }
    const id = qmId("q");
    const quest = {
      id, kind, title,
      description: String(params.description || "").slice(0, 2000),
      reward, difficulty, tags, maxClaimants,
      poster: userId,
      status: "open",          // open | in_progress | resolved | cancelled
      escrowReleased: false,
      claims: [],              // claimIds
      createdAt: qmNow(),
      guildId: params.guildId ? String(params.guildId) : null,
    };
    s.quests.set(id, quest);
    const rep = qmRep(s, userId);
    rep.posted += 1;
    if (reward > 0) {
      s.ledger.push({ ts: qmNow(), type: "escrow_lock", questId: id, userId, amount: reward });
    }
    evaluateAchievements(s, userId);
    qmSave();
    return { ok: true, result: { quest, walletBalance: w.balance, escrowed: w.escrowed } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("questmarket", "cancelQuest", (ctx, _artifact, params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const quest = s.quests.get(String(params.questId || ""));
    if (!quest) return { ok: false, error: "quest not found" };
    if (quest.poster !== userId) return { ok: false, error: "only the poster can cancel" };
    if (quest.status === "resolved") return { ok: false, error: "quest already resolved" };
    const hasActiveClaim = quest.claims.some((cid) => {
      const c = s.claims.get(cid);
      return c && (c.status === "accepted" || c.status === "submitted");
    });
    if (hasActiveClaim) return { ok: false, error: "cannot cancel — active claims exist" };
    quest.status = "cancelled";
    // Refund escrow.
    if (quest.reward > 0 && !quest.escrowReleased) {
      const w = qmWallet(s, userId);
      w.escrowed -= quest.reward;
      w.balance += quest.reward;
      quest.escrowReleased = true;
      s.ledger.push({ ts: qmNow(), type: "escrow_refund", questId: quest.id, userId, amount: quest.reward });
    }
    qmSave();
    return { ok: true, result: { quest } };
  });

  // ── Discovery + filtering ──

  registerLensAction("questmarket", "listQuests", (ctx, _artifact, params = {}) => {
  try {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    let quests = Array.from(s.quests.values());
    if (params.kind) quests = quests.filter((q) => q.kind === params.kind);
    if (params.status) quests = quests.filter((q) => q.status === params.status);
    if (params.difficulty) quests = quests.filter((q) => q.difficulty === params.difficulty);
    if (params.guildId) quests = quests.filter((q) => q.guildId === String(params.guildId));
    if (params.mine) quests = quests.filter((q) => q.poster === userId);
    const minReward = Number(params.minReward);
    if (Number.isFinite(minReward)) quests = quests.filter((q) => q.reward >= minReward);
    if (params.tag) {
      const t = String(params.tag).toLowerCase();
      quests = quests.filter((q) => q.tags.some((tg) => tg.toLowerCase() === t));
    }
    if (params.search) {
      const q = String(params.search).toLowerCase();
      quests = quests.filter((x) =>
        x.title.toLowerCase().includes(q) || x.description.toLowerCase().includes(q));
    }
    const sort = params.sort || "recent";
    quests.sort((a, b) => {
      if (sort === "reward") return b.reward - a.reward;
      if (sort === "difficulty") {
        const ord = { easy: 0, medium: 1, hard: 2, legendary: 3 };
        return ord[b.difficulty] - ord[a.difficulty];
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    // Annotate with the caller's claim state for each quest.
    const annotated = quests.map((q) => {
      const myClaim = q.claims
        .map((cid) => s.claims.get(cid))
        .find((c) => c && c.claimant === userId);
      return {
        ...q,
        claimCount: q.claims.length,
        myClaimStatus: myClaim ? myClaim.status : null,
        myClaimId: myClaim ? myClaim.id : null,
      };
    });
    return {
      ok: true,
      result: {
        quests: annotated,
        total: annotated.length,
        allTags: Array.from(new Set(Array.from(s.quests.values()).flatMap((q) => q.tags))).sort(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Accept → submit → verify lifecycle ──

  registerLensAction("questmarket", "acceptQuest", (ctx, _artifact, params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const quest = s.quests.get(String(params.questId || ""));
    if (!quest) return { ok: false, error: "quest not found" };
    if (quest.status === "cancelled" || quest.status === "resolved") {
      return { ok: false, error: `quest is ${quest.status}` };
    }
    if (quest.poster === userId) return { ok: false, error: "cannot accept your own quest" };
    const existing = quest.claims
      .map((cid) => s.claims.get(cid))
      .find((c) => c && c.claimant === userId && c.status !== "rejected" && c.status !== "abandoned");
    if (existing) return { ok: false, error: "already have an active claim on this quest" };
    const activeClaims = quest.claims
      .map((cid) => s.claims.get(cid))
      .filter((c) => c && (c.status === "accepted" || c.status === "submitted"));
    if (activeClaims.length >= quest.maxClaimants) {
      return { ok: false, error: "quest is at claimant capacity" };
    }
    const id = qmId("c");
    const claim = {
      id, questId: quest.id, claimant: userId,
      status: "accepted",      // accepted | submitted | verified | rejected | abandoned
      proof: null,
      acceptedAt: qmNow(),
      submittedAt: null,
      verifiedAt: null,
      verdictNote: null,
    };
    s.claims.set(id, claim);
    quest.claims.push(id);
    if (quest.status === "open") quest.status = "in_progress";
    qmSave();
    return { ok: true, result: { claim, quest } };
  });

  registerLensAction("questmarket", "submitProof", (ctx, _artifact, params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const claim = s.claims.get(String(params.claimId || ""));
    if (!claim) return { ok: false, error: "claim not found" };
    if (claim.claimant !== userId) return { ok: false, error: "not your claim" };
    if (claim.status !== "accepted") {
      return { ok: false, error: `cannot submit — claim is ${claim.status}` };
    }
    const summary = String(params.summary || "").trim();
    if (!summary) return { ok: false, error: "proof summary required" };
    const links = Array.isArray(params.links)
      ? params.links.map((l) => String(l).trim()).filter(Boolean).slice(0, 10) : [];
    const artifactIds = Array.isArray(params.artifactIds)
      ? params.artifactIds.map((a) => String(a)).slice(0, 10) : [];
    claim.proof = {
      summary: summary.slice(0, 4000),
      links, artifactIds,
      attachedAt: qmNow(),
    };
    claim.status = "submitted";
    claim.submittedAt = qmNow();
    qmSave();
    return { ok: true, result: { claim } };
  });

  registerLensAction("questmarket", "verifyClaim", (ctx, _artifact, params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const claim = s.claims.get(String(params.claimId || ""));
    if (!claim) return { ok: false, error: "claim not found" };
    const quest = s.quests.get(claim.questId);
    if (!quest) return { ok: false, error: "quest not found" };
    if (quest.poster !== userId) return { ok: false, error: "only the quest poster can verify" };
    if (claim.status !== "submitted") {
      return { ok: false, error: `cannot verify — claim is ${claim.status}` };
    }
    const approve = params.approve !== false;
    claim.verdictNote = String(params.note || "").slice(0, 1000);
    claim.verifiedAt = qmNow();

    if (!approve) {
      claim.status = "rejected";
      qmSave();
      return { ok: true, result: { claim, outcome: "rejected" } };
    }

    claim.status = "verified";
    // Pay out escrowed reward to the claimant.
    let payout = 0;
    if (quest.reward > 0 && !quest.escrowReleased) {
      const posterW = qmWallet(s, quest.poster);
      const claimantW = qmWallet(s, claim.claimant);
      posterW.escrowed -= quest.reward;
      claimantW.balance += quest.reward;
      quest.escrowReleased = true;
      payout = quest.reward;
      s.ledger.push({
        ts: qmNow(), type: "payout", questId: quest.id,
        from: quest.poster, to: claim.claimant, amount: payout,
      });
    }
    quest.status = "resolved";

    // Reputation + XP progression for the claimant.
    const rep = qmRep(s, claim.claimant);
    const xpGain = XP_BY_DIFFICULTY[quest.difficulty] || 75;
    rep.xp += xpGain;
    rep.completed += 1;
    const today = qmDay();
    if (rep.lastCompletedDay) {
      const prev = new Date(rep.lastCompletedDay);
      const cur = new Date(today);
      const diffDays = Math.round((cur - prev) / 86400000);
      if (diffDays === 1) rep.streak += 1;
      else if (diffDays > 1) rep.streak = 1;
      // diffDays === 0 keeps streak unchanged
    } else {
      rep.streak = 1;
    }
    rep.lastCompletedDay = today;
    const prevRank = rep.rank;
    rep.rank = rankForXp(rep.xp).name;
    const rankedUp = prevRank !== rep.rank;

    // Guild contribution: if the quest is bound to a guild the claimant is in.
    if (quest.guildId && s.guildMembers.has(quest.guildId)) {
      const gm = s.guildMembers.get(quest.guildId);
      if (gm.has(claim.claimant)) {
        const m = gm.get(claim.claimant);
        m.contributedXp += xpGain;
        m.questsCompleted += 1;
        const guild = s.guilds.get(quest.guildId);
        if (guild) { guild.totalXp += xpGain; guild.questsCompleted += 1; }
      }
    }

    const newAchievements = evaluateAchievements(s, claim.claimant);
    qmSave();
    return {
      ok: true,
      result: {
        claim, quest, outcome: "verified",
        payout, xpGain,
        reputation: { ...rep, rankedUp },
        newAchievements,
      },
    };
  });

  registerLensAction("questmarket", "abandonClaim", (ctx, _artifact, params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const claim = s.claims.get(String(params.claimId || ""));
    if (!claim) return { ok: false, error: "claim not found" };
    if (claim.claimant !== userId) return { ok: false, error: "not your claim" };
    if (claim.status === "verified" || claim.status === "rejected") {
      return { ok: false, error: `claim already ${claim.status}` };
    }
    claim.status = "abandoned";
    const quest = s.quests.get(claim.questId);
    if (quest && quest.status === "in_progress") {
      const stillActive = quest.claims
        .map((cid) => s.claims.get(cid))
        .some((c) => c && (c.status === "accepted" || c.status === "submitted"));
      if (!stillActive) quest.status = "open";
    }
    qmSave();
    return { ok: true, result: { claim } };
  });

  registerLensAction("questmarket", "myClaims", (ctx, _artifact, _params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const claims = Array.from(s.claims.values())
      .filter((c) => c.claimant === userId)
      .map((c) => {
        const q = s.quests.get(c.questId);
        return {
          ...c,
          questTitle: q ? q.title : "(deleted)",
          questReward: q ? q.reward : 0,
          questDifficulty: q ? q.difficulty : null,
        };
      })
      .sort((a, b) => new Date(b.acceptedAt).getTime() - new Date(a.acceptedAt).getTime());
    return { ok: true, result: { claims, total: claims.length } };
  });

  registerLensAction("questmarket", "questClaims", (ctx, _artifact, params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const quest = s.quests.get(String(params.questId || ""));
    if (!quest) return { ok: false, error: "quest not found" };
    if (quest.poster !== userId) return { ok: false, error: "only the poster can view claims" };
    const claims = quest.claims.map((cid) => s.claims.get(cid)).filter(Boolean);
    return { ok: true, result: { quest, claims, total: claims.length } };
  });

  // ── Reputation / rank progression ──

  registerLensAction("questmarket", "myReputation", (ctx, _artifact, _params = {}) => {
  try {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const rep = qmRep(s, userId);
    const next = nextRank(rep.xp);
    const cur = rankForXp(rep.xp);
    const progress = next
      ? Math.round(((rep.xp - cur.min) / (next.min - cur.min)) * 100)
      : 100;
    return {
      ok: true,
      result: {
        ...rep,
        nextRank: next ? next.name : null,
        xpToNextRank: next ? next.min - rep.xp : 0,
        rankProgressPct: progress,
        ranks: RANKS,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Reputation leaderboard (live, from real claim history) ──

  registerLensAction("questmarket", "reputationBoard", (ctx, _artifact, params = {}) => {
  try {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const limit = Math.max(1, Math.min(100, Math.round(Number(params.limit) || 25)));
    const board = Array.from(s.reputation.entries())
      .map(([uid, rep]) => ({
        userId: uid,
        xp: rep.xp,
        rank: rep.rank,
        completed: rep.completed,
        posted: rep.posted,
        streak: rep.streak,
        achievements: s.achievements.has(uid) ? s.achievements.get(uid).size : 0,
      }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, limit)
      .map((row, i) => ({ ...row, position: i + 1 }));
    const me = qmActor(ctx);
    return {
      ok: true,
      result: {
        board,
        total: s.reputation.size,
        myPosition: board.find((r) => r.userId === me)?.position || null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Achievement showcase ──

  registerLensAction("questmarket", "achievementShowcase", (ctx, _artifact, params = {}) => {
  try {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = params.userId ? String(params.userId) : qmActor(ctx);
    // Recompute to surface any newly-qualified achievements.
    evaluateAchievements(s, userId);
    const owned = s.achievements.get(userId) || new Map();
    const rep = qmRep(s, userId);
    const unlocked = Array.from(owned.values())
      .sort((a, b) => new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime());
    const locked = ACH_CATALOG
      .filter((a) => !owned.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, rarity: a.rarity }));
    const rarityCount = unlocked.reduce((acc, a) => {
      acc[a.rarity] = (acc[a.rarity] || 0) + 1; return acc;
    }, {});
    return {
      ok: true,
      result: {
        userId,
        unlocked,
        locked,
        unlockedCount: unlocked.length,
        totalCount: ACH_CATALOG.length,
        completionPct: Math.round((unlocked.length / ACH_CATALOG.length) * 100),
        rarityCount,
        rank: rep.rank,
        xp: rep.xp,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Guild membership + shared quests ──

  registerLensAction("questmarket", "createGuild", (ctx, _artifact, params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "guild name required" };
    if (name.length > 60) return { ok: false, error: "guild name too long" };
    const dup = Array.from(s.guilds.values())
      .some((g) => g.name.toLowerCase() === name.toLowerCase());
    if (dup) return { ok: false, error: "a guild with that name already exists" };
    const id = qmId("g");
    const guild = {
      id, name,
      description: String(params.description || "").slice(0, 500),
      founder: userId,
      createdAt: qmNow(),
      totalXp: 0,
      questsCompleted: 0,
    };
    s.guilds.set(id, guild);
    const members = new Map();
    members.set(userId, {
      userId, role: "founder", joinedAt: qmNow(),
      contributedXp: 0, questsCompleted: 0,
    });
    s.guildMembers.set(id, members);
    qmSave();
    return { ok: true, result: { guild, memberCount: 1 } };
  });

  registerLensAction("questmarket", "joinGuild", (ctx, _artifact, params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const guild = s.guilds.get(String(params.guildId || ""));
    if (!guild) return { ok: false, error: "guild not found" };
    const members = s.guildMembers.get(guild.id);
    if (members.has(userId)) return { ok: false, error: "already a member" };
    members.set(userId, {
      userId, role: "member", joinedAt: qmNow(),
      contributedXp: 0, questsCompleted: 0,
    });
    qmSave();
    return { ok: true, result: { guild, memberCount: members.size } };
  });

  registerLensAction("questmarket", "leaveGuild", (ctx, _artifact, params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const guild = s.guilds.get(String(params.guildId || ""));
    if (!guild) return { ok: false, error: "guild not found" };
    const members = s.guildMembers.get(guild.id);
    if (!members.has(userId)) return { ok: false, error: "not a member" };
    if (guild.founder === userId && members.size > 1) {
      return { ok: false, error: "founder must transfer or disband before leaving" };
    }
    members.delete(userId);
    if (members.size === 0) { s.guilds.delete(guild.id); s.guildMembers.delete(guild.id); }
    qmSave();
    return { ok: true, result: { left: true, memberCount: members.size } };
  });

  registerLensAction("questmarket", "listGuilds", (ctx, _artifact, _params = {}) => {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = qmActor(ctx);
    const guilds = Array.from(s.guilds.values()).map((g) => {
      const members = s.guildMembers.get(g.id) || new Map();
      return {
        ...g,
        memberCount: members.size,
        isMember: members.has(userId),
        myRole: members.get(userId)?.role || null,
      };
    }).sort((a, b) => b.totalXp - a.totalXp);
    return { ok: true, result: { guilds, total: guilds.length } };
  });

  registerLensAction("questmarket", "guildDetail", (ctx, _artifact, params = {}) => {
  try {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const guild = s.guilds.get(String(params.guildId || ""));
    if (!guild) return { ok: false, error: "guild not found" };
    const members = Array.from((s.guildMembers.get(guild.id) || new Map()).values())
      .sort((a, b) => b.contributedXp - a.contributedXp);
    const sharedQuests = Array.from(s.quests.values())
      .filter((q) => q.guildId === guild.id)
      .map((q) => ({
        id: q.id, title: q.title, kind: q.kind,
        reward: q.reward, difficulty: q.difficulty, status: q.status,
        claimCount: q.claims.length,
      }));
    return {
      ok: true,
      result: {
        guild,
        members,
        memberCount: members.length,
        sharedQuests,
        sharedQuestCount: sharedQuests.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Marketplace overview (real aggregate stats) ──

  registerLensAction("questmarket", "marketStats", (ctx, _artifact, _params = {}) => {
  try {
    const s = qmState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const quests = Array.from(s.quests.values());
    const claims = Array.from(s.claims.values());
    const openCount = quests.filter((q) => q.status === "open").length;
    const inProgress = quests.filter((q) => q.status === "in_progress").length;
    const resolved = quests.filter((q) => q.status === "resolved").length;
    const totalEscrowed = quests
      .filter((q) => !q.escrowReleased && q.reward > 0)
      .reduce((sum, q) => sum + q.reward, 0);
    const totalPaidOut = s.ledger
      .filter((e) => e.type === "payout")
      .reduce((sum, e) => sum + e.amount, 0);
    const verifiedClaims = claims.filter((c) => c.status === "verified").length;
    const pendingVerification = claims.filter((c) => c.status === "submitted").length;
    return {
      ok: true,
      result: {
        totalQuests: quests.length,
        openCount, inProgress, resolved,
        totalClaims: claims.length,
        verifiedClaims, pendingVerification,
        totalEscrowed, totalPaidOut,
        guildCount: s.guilds.size,
        adventurerCount: s.reputation.size,
        recentLedger: s.ledger.slice(-15).reverse(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
