// server/domains/game.js
export default function registerGameActions(registerLensAction) {
  registerLensAction("game", "balanceCheck", (ctx, artifact, _params) => {
    const units = artifact.data?.units || [];
    if (units.length < 2) return { ok: true, result: { message: "Add at least 2 game units with stats to check balance." } };
    const analyzed = units.map(u => { const hp = parseFloat(u.hp) || 100; const atk = parseFloat(u.attack) || 10; const def = parseFloat(u.defense) || 10; const spd = parseFloat(u.speed) || 10; const cost = parseFloat(u.cost) || 1; const power = (hp / 10 + atk + def + spd) / 4; const efficiency = cost > 0 ? power / cost : power; return { name: u.name, power: Math.round(power * 10) / 10, cost, efficiency: Math.round(efficiency * 10) / 10, stats: { hp, atk, def, spd } }; });
    const avgPower = analyzed.reduce((s, u) => s + u.power, 0) / analyzed.length;
    const variance = Math.sqrt(analyzed.reduce((s, u) => s + Math.pow(u.power - avgPower, 2), 0) / analyzed.length);
    return { ok: true, result: { units: analyzed.sort((a, b) => b.efficiency - a.efficiency), avgPower: Math.round(avgPower * 10) / 10, powerVariance: Math.round(variance * 10) / 10, balance: variance < avgPower * 0.15 ? "well-balanced" : variance < avgPower * 0.3 ? "slightly-unbalanced" : "needs-rebalancing", strongest: analyzed[0]?.name, weakest: analyzed[analyzed.length - 1]?.name } };
  });
  registerLensAction("game", "economySimulate", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // NB: nullish-aware fallbacks — a deliberate 0 (zero spend, zero inflation)
    // is a legitimate economy-design input and must not coerce to the default.
    const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
    const startGold = num(data.startingGold, 100);
    const earnRate = num(data.goldPerMinute, 5);
    const spendRate = num(data.avgSpendPerMinute, 3);
    const inflationRate = num(data.inflationPercent, 2);
    const minutes = (() => { const n = parseInt(data.simulateMinutes, 10); return Number.isFinite(n) ? n : 60; })();
    const timeline = [];
    let gold = startGold;
    for (let t = 0; t <= minutes; t += 5) {
      const inflation = 1 + (inflationRate / 100) * (t / 60);
      gold += (earnRate - spendRate * inflation) * 5;
      gold = Math.max(0, gold);
      if (t % 10 === 0) timeline.push({ minute: t, gold: Math.round(gold), inflation: Math.round(inflation * 100) / 100 });
    }
    return { ok: true, result: { startGold, earnRate, spendRate, inflationRate, finalGold: Math.round(gold), netFlow: Math.round(gold - startGold), timeline, sustainable: gold > startGold * 0.5, tip: gold < startGold * 0.3 ? "Economy deflating — increase earn rate or add gold sinks" : "Economy is stable" } };
  });
  registerLensAction("game", "levelCurve", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const maxLevel = parseInt(data.maxLevel) || 50;
    const baseXP = parseInt(data.baseXP) || 100;
    const growthFactor = parseFloat(data.growthFactor) || 1.5;
    const levels = [];
    let cumulative = 0;
    for (let l = 1; l <= maxLevel; l++) { const xp = Math.round(baseXP * Math.pow(growthFactor, l - 1)); cumulative += xp; levels.push({ level: l, xpRequired: xp, cumulativeXP: cumulative }); }
    return { ok: true, result: { maxLevel, baseXP, growthFactor, totalXPToMax: cumulative, levels: levels.filter((_, i) => i % Math.max(1, Math.floor(maxLevel / 10)) === 0 || i === levels.length - 1), midpointLevel: levels.find(l => l.cumulativeXP >= cumulative / 2)?.level, earlyGameFeels: growthFactor < 1.3 ? "slow-and-steady" : growthFactor < 1.8 ? "balanced" : "fast-start-hard-finish" } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("game", "dropRateCalc", (ctx, artifact, _params) => {
    const dropRate = parseFloat(artifact.data?.dropRatePercent) || 5;
    const attempts = parseInt(artifact.data?.attempts) || 100;
    const rate = dropRate / 100;
    const expectedDrops = Math.round(attempts * rate * 10) / 10;
    const pAtLeastOne = 1 - Math.pow(1 - rate, attempts);
    const attemptsFor50 = Math.ceil(Math.log(0.5) / Math.log(1 - rate));
    const attemptsFor90 = Math.ceil(Math.log(0.1) / Math.log(1 - rate));
    const attemptsFor99 = Math.ceil(Math.log(0.01) / Math.log(1 - rate));
    return { ok: true, result: { dropRate: `${dropRate}%`, attempts, expectedDrops, probabilityAtLeastOne: `${Math.round(pAtLeastOne * 10000) / 100}%`, attemptsFor50Percent: attemptsFor50, attemptsFor90Percent: attemptsFor90, attemptsFor99Percent: attemptsFor99, pitySystemSuggestion: `Guarantee drop at ${attemptsFor90} attempts (90th percentile)` } };
  });

  // -------------------------------------------------------------------------
  // Persistent gamification substrate — Habitica-style behavior-change loop.
  // All per-user state lives in globalThis._concordSTATE.game.* keyed by userId.
  // -------------------------------------------------------------------------
  function gameState() {
    const STATE = (globalThis._concordSTATE = globalThis._concordSTATE || {});
    if (!STATE.game) {
      STATE.game = {
        tasks: new Map(),       // userId -> Map<taskId, task>  (habits/dailies/todos)
        progress: new Map(),    // userId -> { xp, level, gold, streak, longestStreak, lastActiveDay }
        parties: new Map(),     // partyId -> party
        membership: new Map(),  // userId -> partyId
        cosmetics: new Map(),   // userId -> Map<cosmeticId, owned cosmetic>
        equipped: new Map(),    // userId -> { [slot]: cosmeticId }
        rewards: new Map(),     // userId -> Map<rewardId, custom reward>
        reminders: new Map(),   // userId -> Map<reminderId, reminder>
        challenges: new Map(),  // challengeId -> challenge
      };
    }
    return STATE.game;
  }
  function actorId(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function dayKey(ts) { return new Date(ts || Date.now()).toISOString().slice(0, 10); }
  function uid(prefix) { return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
  function userBucket(map, userId, factory) {
    if (!map.has(userId)) map.set(userId, factory());
    return map.get(userId);
  }
  function getProgress(s, userId) {
    return userBucket(s.progress, userId, () => ({
      xp: 0, level: 1, gold: 0, streak: 0, longestStreak: 0, lastActiveDay: null,
    }));
  }
  function levelForXp(xp) {
    // Each level needs level*200 XP cumulatively.
    let lvl = 1, need = 200, acc = 0;
    while (xp >= acc + need) { acc += need; lvl++; need = lvl * 200; }
    return { level: lvl, intoLevel: xp - acc, nextLevelXp: need };
  }
  function awardXp(s, userId, xp, gold) {
    const p = getProgress(s, userId);
    p.xp = Math.max(0, p.xp + xp);
    p.gold = Math.max(0, p.gold + (gold || 0));
    p.level = levelForXp(p.xp).level;
    return p;
  }
  function bumpStreak(s, userId) {
    const p = getProgress(s, userId);
    const today = dayKey();
    if (p.lastActiveDay === today) return p;
    const yesterday = dayKey(Date.now() - 86400000);
    p.streak = p.lastActiveDay === yesterday ? p.streak + 1 : 1;
    p.longestStreak = Math.max(p.longestStreak, p.streak);
    p.lastActiveDay = today;
    return p;
  }

  // --- Dailies / habits / to-dos ---------------------------------------------
  registerLensAction("game", "taskCreate", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const kind = ["habit", "daily", "todo"].includes(p.kind) ? p.kind : "todo";
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "title is required" };
      const s = gameState();
      const userId = actorId(ctx);
      const map = userBucket(s.tasks, userId, () => new Map());
      const task = {
        id: uid("task"), kind, title,
        notes: String(p.notes || ""),
        difficulty: ["trivial", "easy", "medium", "hard"].includes(p.difficulty) ? p.difficulty : "easy",
        positive: p.positive !== false,
        negative: p.negative === true,
        completedToday: false,
        lastCompletedDay: null,
        streak: 0, longestStreak: 0,
        completions: 0,
        createdAt: Date.now(),
      };
      map.set(task.id, task);
      return { ok: true, result: { task } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "taskList", (ctx, artifact, params) => {
    try {
      const s = gameState();
      const userId = actorId(ctx);
      const map = userBucket(s.tasks, userId, () => new Map());
      const today = dayKey();
      const filter = (artifact?.data?.kind || params?.kind);
      const tasks = [...map.values()]
        .map(t => ({ ...t, completedToday: t.kind === "habit" ? false : t.lastCompletedDay === today }))
        .filter(t => !filter || t.kind === filter)
        .sort((a, b) => b.createdAt - a.createdAt);
      return { ok: true, result: { tasks, count: tasks.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "taskComplete", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.id || params?.id || artifact?.id;
      const direction = (artifact?.data?.direction || params?.direction) === "down" ? "down" : "up";
      if (!id) return { ok: false, error: "task id is required" };
      const s = gameState();
      const userId = actorId(ctx);
      const map = userBucket(s.tasks, userId, () => new Map());
      const task = map.get(id);
      if (!task) return { ok: false, error: "task not found" };
      const today = dayKey();
      const xpByDiff = { trivial: 5, easy: 10, medium: 20, hard: 35 };
      const baseXp = xpByDiff[task.difficulty] || 10;
      let xpDelta = 0, goldDelta = 0;
      if (direction === "down") {
        // Negative habit / penalty.
        xpDelta = -Math.round(baseXp * 0.6);
        task.streak = 0;
      } else {
        if (task.kind !== "habit" && task.lastCompletedDay === today) {
          return { ok: false, error: "task already completed today" };
        }
        const yesterday = dayKey(Date.now() - 86400000);
        task.streak = task.kind === "habit" || task.lastCompletedDay === yesterday || task.lastCompletedDay === today
          ? task.streak + 1 : 1;
        task.longestStreak = Math.max(task.longestStreak, task.streak);
        task.lastCompletedDay = today;
        task.completions++;
        const streakBonus = Math.min(2, 1 + task.streak * 0.05);
        xpDelta = Math.round(baseXp * streakBonus);
        goldDelta = Math.round(baseXp * 0.4 * streakBonus);
      }
      const prog = awardXp(s, userId, xpDelta, goldDelta);
      if (direction === "up") bumpStreak(s, userId);
      const lvl = levelForXp(prog.xp);
      return {
        ok: true,
        result: {
          task, xpDelta, goldDelta,
          progress: { ...prog, ...lvl },
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "taskDelete", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.id || params?.id || artifact?.id;
      if (!id) return { ok: false, error: "task id is required" };
      const s = gameState();
      const map = userBucket(s.tasks, actorId(ctx), () => new Map());
      const existed = map.delete(id);
      return existed ? { ok: true, result: { deleted: id } } : { ok: false, error: "task not found" };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // --- Streaks summary -------------------------------------------------------
  registerLensAction("game", "streakSummary", (ctx, _artifact, _params) => {
    try {
      const s = gameState();
      const userId = actorId(ctx);
      const prog = getProgress(s, userId);
      const map = userBucket(s.tasks, userId, () => new Map());
      const today = dayKey();
      const chains = [...map.values()]
        .filter(t => t.streak > 0)
        .map(t => ({
          id: t.id, title: t.title, kind: t.kind, streak: t.streak, longestStreak: t.longestStreak,
          atRisk: t.kind !== "habit" && t.lastCompletedDay !== today,
        }))
        .sort((a, b) => b.streak - a.streak);
      const atRisk = chains.filter(c => c.atRisk);
      return {
        ok: true,
        result: {
          accountStreak: prog.streak,
          longestAccountStreak: prog.longestStreak,
          activeChains: chains.length,
          chains,
          atRisk,
          lossPenaltyHint: atRisk.length
            ? `${atRisk.length} chain(s) at risk — complete them today or the streak resets to 0.`
            : "All chains safe for today.",
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // --- Parties / guilds ------------------------------------------------------
  registerLensAction("game", "partyCreate", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const name = String(p.name || "").trim();
      if (!name) return { ok: false, error: "party name is required" };
      const s = gameState();
      const userId = actorId(ctx);
      const party = {
        id: uid("party"), name,
        description: String(p.description || ""),
        leaderId: userId,
        members: [userId],
        sharedQuest: null,
        createdAt: Date.now(),
      };
      s.parties.set(party.id, party);
      s.membership.set(userId, party.id);
      return { ok: true, result: { party } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "partyJoin", (ctx, artifact, params) => {
    try {
      const partyId = artifact?.data?.partyId || params?.partyId || artifact?.id;
      if (!partyId) return { ok: false, error: "partyId is required" };
      const s = gameState();
      const party = s.parties.get(partyId);
      if (!party) return { ok: false, error: "party not found" };
      const userId = actorId(ctx);
      if (!party.members.includes(userId)) party.members.push(userId);
      s.membership.set(userId, partyId);
      return { ok: true, result: { party } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "partyLeave", (ctx, _artifact, _params) => {
    try {
      const s = gameState();
      const userId = actorId(ctx);
      const partyId = s.membership.get(userId);
      if (!partyId) return { ok: false, error: "not in a party" };
      const party = s.parties.get(partyId);
      if (party) {
        party.members = party.members.filter(m => m !== userId);
        if (party.leaderId === userId && party.members.length) party.leaderId = party.members[0];
        if (!party.members.length) s.parties.delete(partyId);
      }
      s.membership.delete(userId);
      return { ok: true, result: { left: partyId } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "partyList", (_ctx, _artifact, _params) => {
    try {
      const s = gameState();
      const parties = [...s.parties.values()]
        .map(p => ({ id: p.id, name: p.name, description: p.description, memberCount: p.members.length, hasSharedQuest: !!p.sharedQuest }))
        .sort((a, b) => b.memberCount - a.memberCount);
      return { ok: true, result: { parties, count: parties.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "partyStatus", (ctx, _artifact, _params) => {
    try {
      const s = gameState();
      const userId = actorId(ctx);
      const partyId = s.membership.get(userId);
      if (!partyId) return { ok: true, result: { inParty: false } };
      const party = s.parties.get(partyId);
      if (!party) { s.membership.delete(userId); return { ok: true, result: { inParty: false } }; }
      const members = party.members.map(m => {
        const prog = getProgress(s, m);
        return { userId: m, level: prog.level, xp: prog.xp, streak: prog.streak, isLeader: m === party.leaderId };
      });
      return { ok: true, result: { inParty: true, party: { ...party, members }, sharedQuest: party.sharedQuest } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "partySetQuest", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const s = gameState();
      const userId = actorId(ctx);
      const partyId = s.membership.get(userId);
      if (!partyId) return { ok: false, error: "not in a party" };
      const party = s.parties.get(partyId);
      if (!party) return { ok: false, error: "party not found" };
      if (party.leaderId !== userId) return { ok: false, error: "only the party leader can set a shared quest" };
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "quest title is required" };
      const goal = Math.max(1, parseInt(p.goal) || party.members.length * 5);
      party.sharedQuest = {
        id: uid("squest"), title, description: String(p.description || ""),
        goal, progress: 0, contributions: {}, completed: false, createdAt: Date.now(),
      };
      return { ok: true, result: { sharedQuest: party.sharedQuest } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "partyContribute", (ctx, artifact, params) => {
    try {
      const amount = Math.max(1, parseInt(artifact?.data?.amount || params?.amount) || 1);
      const s = gameState();
      const userId = actorId(ctx);
      const partyId = s.membership.get(userId);
      if (!partyId) return { ok: false, error: "not in a party" };
      const party = s.parties.get(partyId);
      if (!party || !party.sharedQuest) return { ok: false, error: "no shared quest active" };
      const q = party.sharedQuest;
      if (q.completed) return { ok: false, error: "shared quest already completed" };
      q.contributions[userId] = (q.contributions[userId] || 0) + amount;
      q.progress = Math.min(q.goal, q.progress + amount);
      let questReward = null;
      if (q.progress >= q.goal && !q.completed) {
        q.completed = true;
        questReward = 150;
        for (const m of party.members) awardXp(s, m, questReward, 60);
      }
      return { ok: true, result: { sharedQuest: q, questReward } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // --- Avatar cosmetics ------------------------------------------------------
  const COSMETIC_CATALOG = [
    { id: "cos_helm_aurora", name: "Aurora Helm", slot: "head", cost: 250, rarity: "rare", icon: "🪖" },
    { id: "cos_helm_crown", name: "Sovereign Crown", slot: "head", cost: 900, rarity: "legendary", icon: "👑" },
    { id: "cos_body_neon", name: "Neon Plating", slot: "body", cost: 400, rarity: "epic", icon: "🦾" },
    { id: "cos_body_cloak", name: "Drifter Cloak", slot: "body", cost: 180, rarity: "common", icon: "🧥" },
    { id: "cos_aura_violet", name: "Violet Aura", slot: "aura", cost: 600, rarity: "epic", icon: "🟣" },
    { id: "cos_aura_ember", name: "Ember Aura", slot: "aura", cost: 320, rarity: "rare", icon: "🔥" },
    { id: "cos_mount_glider", name: "Lattice Glider", slot: "mount", cost: 750, rarity: "legendary", icon: "🛸" },
    { id: "cos_pet_sprite", name: "Spark Sprite", slot: "pet", cost: 220, rarity: "rare", icon: "✨" },
  ];
  registerLensAction("game", "cosmeticCatalog", (ctx, _artifact, _params) => {
    try {
      const s = gameState();
      const userId = actorId(ctx);
      const owned = userBucket(s.cosmetics, userId, () => new Map());
      const equipped = userBucket(s.equipped, userId, () => ({}));
      const items = COSMETIC_CATALOG.map(c => ({
        ...c,
        owned: owned.has(c.id),
        equipped: equipped[c.slot] === c.id,
      }));
      return { ok: true, result: { items, equipped, gold: getProgress(s, userId).gold } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "cosmeticBuy", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.id || params?.id || artifact?.id;
      const item = COSMETIC_CATALOG.find(c => c.id === id);
      if (!item) return { ok: false, error: "cosmetic not found" };
      const s = gameState();
      const userId = actorId(ctx);
      const owned = userBucket(s.cosmetics, userId, () => new Map());
      if (owned.has(id)) return { ok: false, error: "already owned" };
      const prog = getProgress(s, userId);
      if (prog.gold < item.cost) return { ok: false, error: `not enough gold (need ${item.cost}, have ${prog.gold})` };
      prog.gold -= item.cost;
      owned.set(id, { ...item, acquiredAt: Date.now() });
      return { ok: true, result: { cosmetic: owned.get(id), gold: prog.gold } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "cosmeticEquip", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.id || params?.id || artifact?.id;
      const item = COSMETIC_CATALOG.find(c => c.id === id);
      if (!item) return { ok: false, error: "cosmetic not found" };
      const s = gameState();
      const userId = actorId(ctx);
      const owned = userBucket(s.cosmetics, userId, () => new Map());
      if (!owned.has(id)) return { ok: false, error: "cosmetic not owned" };
      const equipped = userBucket(s.equipped, userId, () => ({}));
      const unequip = (artifact?.data?.unequip || params?.unequip) === true;
      if (unequip) { delete equipped[item.slot]; }
      else { equipped[item.slot] = id; }
      return { ok: true, result: { equipped } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // --- Custom rewards + redemption ------------------------------------------
  registerLensAction("game", "rewardCreate", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "reward title is required" };
      const cost = Math.max(1, parseInt(p.cost) || 50);
      const s = gameState();
      const userId = actorId(ctx);
      const map = userBucket(s.rewards, userId, () => new Map());
      const reward = {
        id: uid("reward"), title, notes: String(p.notes || ""),
        cost, redemptions: 0, createdAt: Date.now(),
      };
      map.set(reward.id, reward);
      return { ok: true, result: { reward } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "rewardList", (ctx, _artifact, _params) => {
    try {
      const s = gameState();
      const userId = actorId(ctx);
      const map = userBucket(s.rewards, userId, () => new Map());
      const rewards = [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
      return { ok: true, result: { rewards, gold: getProgress(s, userId).gold } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "rewardRedeem", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.id || params?.id || artifact?.id;
      if (!id) return { ok: false, error: "reward id is required" };
      const s = gameState();
      const userId = actorId(ctx);
      const map = userBucket(s.rewards, userId, () => new Map());
      const reward = map.get(id);
      if (!reward) return { ok: false, error: "reward not found" };
      const prog = getProgress(s, userId);
      if (prog.gold < reward.cost) return { ok: false, error: `not enough gold (need ${reward.cost}, have ${prog.gold})` };
      prog.gold -= reward.cost;
      reward.redemptions++;
      reward.lastRedeemedAt = Date.now();
      return { ok: true, result: { reward, gold: prog.gold } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "rewardDelete", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.id || params?.id || artifact?.id;
      if (!id) return { ok: false, error: "reward id is required" };
      const s = gameState();
      const map = userBucket(s.rewards, actorId(ctx), () => new Map());
      return map.delete(id) ? { ok: true, result: { deleted: id } } : { ok: false, error: "reward not found" };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // --- Reminders / scheduled notifications ----------------------------------
  registerLensAction("game", "reminderCreate", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "reminder title is required" };
      const time = String(p.time || "").trim();
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, error: "time must be HH:MM (24h)" };
      const validDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      const days = Array.isArray(p.days) ? p.days.filter(d => validDays.includes(d)) : validDays;
      const s = gameState();
      const userId = actorId(ctx);
      const map = userBucket(s.reminders, userId, () => new Map());
      const reminder = {
        id: uid("rem"), title, time,
        days: days.length ? days : validDays,
        taskId: p.taskId || null,
        enabled: true, createdAt: Date.now(),
      };
      map.set(reminder.id, reminder);
      return { ok: true, result: { reminder } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "reminderList", (ctx, _artifact, _params) => {
    try {
      const s = gameState();
      const map = userBucket(s.reminders, actorId(ctx), () => new Map());
      const now = new Date();
      const dayMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const todayName = dayMap[now.getDay()];
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const reminders = [...map.values()].map(r => {
        const [h, m] = r.time.split(":").map(Number);
        const due = r.enabled && r.days.includes(todayName);
        return { ...r, upcomingToday: due, overdueToday: due && (h * 60 + m) <= nowMin };
      }).sort((a, b) => a.time.localeCompare(b.time));
      return { ok: true, result: { reminders, count: reminders.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "reminderToggle", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.id || params?.id || artifact?.id;
      if (!id) return { ok: false, error: "reminder id is required" };
      const s = gameState();
      const map = userBucket(s.reminders, actorId(ctx), () => new Map());
      const reminder = map.get(id);
      if (!reminder) return { ok: false, error: "reminder not found" };
      reminder.enabled = !reminder.enabled;
      return { ok: true, result: { reminder } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "reminderDelete", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.id || params?.id || artifact?.id;
      if (!id) return { ok: false, error: "reminder id is required" };
      const s = gameState();
      const map = userBucket(s.reminders, actorId(ctx), () => new Map());
      return map.delete(id) ? { ok: true, result: { deleted: id } } : { ok: false, error: "reminder not found" };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // --- Cross-user challenges with shared leaderboards -----------------------
  registerLensAction("game", "challengeCreate", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "challenge title is required" };
      const goal = Math.max(1, parseInt(p.goal) || 30);
      const s = gameState();
      const userId = actorId(ctx);
      const challenge = {
        id: uid("chal"), title, description: String(p.description || ""),
        metric: ["tasks", "xp", "streak"].includes(p.metric) ? p.metric : "tasks",
        goal, ownerId: userId,
        participants: { [userId]: 0 },
        prize: Math.max(0, parseInt(p.prize) || 200),
        createdAt: Date.now(), endsAt: Date.now() + (Math.max(1, parseInt(p.days) || 7) * 86400000),
        winnerId: null,
      };
      s.challenges.set(challenge.id, challenge);
      return { ok: true, result: { challenge } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "challengeJoin", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.challengeId || params?.challengeId || artifact?.id;
      if (!id) return { ok: false, error: "challengeId is required" };
      const s = gameState();
      const challenge = s.challenges.get(id);
      if (!challenge) return { ok: false, error: "challenge not found" };
      const userId = actorId(ctx);
      if (challenge.participants[userId] === undefined) challenge.participants[userId] = 0;
      return { ok: true, result: { challenge } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "challengeProgress", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.challengeId || params?.challengeId || artifact?.id;
      const amount = Math.max(1, parseInt(artifact?.data?.amount || params?.amount) || 1);
      if (!id) return { ok: false, error: "challengeId is required" };
      const s = gameState();
      const challenge = s.challenges.get(id);
      if (!challenge) return { ok: false, error: "challenge not found" };
      const userId = actorId(ctx);
      if (challenge.participants[userId] === undefined) return { ok: false, error: "join the challenge first" };
      challenge.participants[userId] += amount;
      let prizeAwarded = null;
      if (!challenge.winnerId && challenge.participants[userId] >= challenge.goal) {
        challenge.winnerId = userId;
        if (challenge.prize > 0) { awardXp(s, userId, challenge.prize, Math.round(challenge.prize * 0.5)); prizeAwarded = challenge.prize; }
      }
      return { ok: true, result: { challenge, prizeAwarded } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "challengeList", (_ctx, _artifact, _params) => {
    try {
      const s = gameState();
      const challenges = [...s.challenges.values()].map(c => ({
        id: c.id, title: c.title, description: c.description, metric: c.metric, goal: c.goal,
        participantCount: Object.keys(c.participants).length, prize: c.prize,
        endsAt: c.endsAt, expired: Date.now() > c.endsAt, winnerId: c.winnerId,
      })).sort((a, b) => b.participantCount - a.participantCount);
      return { ok: true, result: { challenges, count: challenges.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  registerLensAction("game", "challengeLeaderboard", (ctx, artifact, params) => {
    try {
      const id = artifact?.data?.challengeId || params?.challengeId || artifact?.id;
      if (!id) return { ok: false, error: "challengeId is required" };
      const s = gameState();
      const challenge = s.challenges.get(id);
      if (!challenge) return { ok: false, error: "challenge not found" };
      const me = actorId(ctx);
      const board = Object.entries(challenge.participants)
        .map(([userId, score]) => ({
          userId, score,
          progressPct: Math.min(100, Math.round((score / challenge.goal) * 100)),
          isCurrentUser: userId === me,
        }))
        .sort((a, b) => b.score - a.score)
        .map((row, i) => ({ ...row, rank: i + 1 }));
      return { ok: true, result: { challengeId: id, title: challenge.title, goal: challenge.goal, leaderboard: board, winnerId: challenge.winnerId } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // --- Aggregate progress (drives header XP / level / gold) -----------------
  registerLensAction("game", "playerProgress", (ctx, _artifact, _params) => {
    try {
      const s = gameState();
      const userId = actorId(ctx);
      const prog = getProgress(s, userId);
      const lvl = levelForXp(prog.xp);
      const tasks = userBucket(s.tasks, userId, () => new Map());
      const today = dayKey();
      const dailiesTotal = [...tasks.values()].filter(t => t.kind === "daily").length;
      const dailiesDone = [...tasks.values()].filter(t => t.kind === "daily" && t.lastCompletedDay === today).length;
      return {
        ok: true,
        result: {
          xp: prog.xp, gold: prog.gold, ...lvl,
          streak: prog.streak, longestStreak: prog.longestStreak,
          dailiesDone, dailiesTotal,
          totalTasks: tasks.size,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}
