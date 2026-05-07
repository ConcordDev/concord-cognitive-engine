/**
 * World Progression System for Concord Cognitive Engine
 *
 * Mastery tracks, season system, achievements, explorer tracking,
 * and daily/weekly activity cycles. Every progression action maps
 * to real lens work — XP comes from creating DTUs, not grinding.
 *
 * Key rule: Progression is EARNED through real knowledge work.
 * No fake XP. Every point traces back to a DTU or contribution.
 */

import { v4 as uuid } from "uuid";

// ── Mastery System ───────────────────────────────────────────────────────────

const MASTERY_RANKS = [
  { rank: 0, title: "Novice",       xpRequired: 0 },
  { rank: 1, title: "Apprentice",   xpRequired: 100 },
  { rank: 2, title: "Journeyman",   xpRequired: 500 },
  { rank: 3, title: "Artisan",      xpRequired: 1500 },
  { rank: 4, title: "Expert",       xpRequired: 4000 },
  { rank: 5, title: "Master",       xpRequired: 10000 },
  { rank: 6, title: "Grandmaster",  xpRequired: 25000 },
];

/** XP awards for different actions */
const XP_ACTIONS = {
  dtu_created:          10,
  dtu_mega_created:     50,
  dtu_hyper_created:    100,
  dtu_upvoted:          5,
  dtu_referenced:       3,
  query_answered:       2,
  job_task_completed:   15,
  business_sale:        8,
  mentee_graduated:     200,
  event_hosted:         25,
  event_attended:       10,
  org_contribution:     12,
  franchise_sold:       150,
  achievement_unlocked: 20,
  daily_login:          5,
  weekly_streak:        50,
};

/** @type {Map<string, object>} userId → mastery profile */
const masteryProfiles = new Map();

/**
 * Get or create a mastery profile for a user.
 */
export function getMasteryProfile(userId) {
  if (!masteryProfiles.has(userId)) {
    masteryProfiles.set(userId, {
      userId,
      totalXP: 0,
      lensXP: {},        // lens → xp
      rank: 0,
      title: "Novice",
      streakDays: 0,
      lastActive: null,
      history: [],       // last 100 XP events
      createdAt: new Date().toISOString(),
    });
  }
  return masteryProfiles.get(userId);
}

/**
 * Award XP to a user for a specific action.
 * XP is tracked both globally and per-lens.
 *
 * @param {string} userId
 * @param {string} action - key from XP_ACTIONS
 * @param {object} [opts]
 * @param {string} [opts.lens] - lens the action was performed in
 * @param {number} [opts.multiplier] - XP multiplier (e.g. 2x event)
 * @param {string} [opts.source] - source DTU or entity ID
 * @returns {{ xpAwarded: number, newTotal: number, rankUp: boolean, newRank?: object }}
 */
export function awardXP(userId, action, { lens = null, multiplier = 1, source = null } = {}) {
  const baseXP = XP_ACTIONS[action];
  if (!baseXP) return { xpAwarded: 0, newTotal: 0, rankUp: false, error: "unknown_action" };

  const xp = Math.round(baseXP * multiplier);
  const profile = getMasteryProfile(userId);
  profile.totalXP += xp;
  profile.lastActive = new Date().toISOString();

  if (lens) {
    profile.lensXP[lens] = (profile.lensXP[lens] || 0) + xp;
  }

  // Track history (keep last 100)
  profile.history.push({
    action, xp, lens, source,
    ts: new Date().toISOString(),
  });
  if (profile.history.length > 100) {
    profile.history = profile.history.slice(-100);
  }

  // Check rank up
  let rankUp = false;
  let newRank = null;
  for (const r of MASTERY_RANKS) {
    if (profile.totalXP >= r.xpRequired && r.rank > profile.rank) {
      profile.rank = r.rank;
      profile.title = r.title;
      rankUp = true;
      newRank = { ...r };
    }
  }

  return { xpAwarded: xp, newTotal: profile.totalXP, rankUp, newRank };
}

/**
 * Get the mastery rank for a given XP total.
 */
export function getRankForXP(xp) {
  let result = MASTERY_RANKS[0];
  for (const r of MASTERY_RANKS) {
    if (xp >= r.xpRequired) result = r;
  }
  return { ...result };
}

/**
 * Get top XP earners (leaderboard).
 */
export function getLeaderboard({ lens = null, limit = 20 } = {}) {
  const entries = [...masteryProfiles.values()].map(p => ({
    userId: p.userId,
    xp: lens ? (p.lensXP[lens] || 0) : p.totalXP,
    rank: p.rank,
    title: p.title,
  }));

  return entries
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}

// ── Season System ────────────────────────────────────────────────────────────

const SEASON_DURATION_DAYS = 90;

/** @type {{ seasons: object[], current: object|null }} */
const seasonState = {
  seasons: [],
  current: null,
};

/**
 * Start a new season.
 */
export function startSeason({ name, theme, description, rewards = [] } = {}) {
  // End current season if active
  if (seasonState.current) {
    endSeason();
  }

  const season = {
    id: uuid(),
    name: name || `Season ${seasonState.seasons.length + 1}`,
    theme: theme || "general",
    description: description || "",
    number: seasonState.seasons.length + 1,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + SEASON_DURATION_DAYS * 86400_000).toISOString(),
    rewards,
    participants: new Map(),  // userId → { xp, contributions, rank }
    challenges: [],
    active: true,
  };

  seasonState.current = season;
  seasonState.seasons.push(season);

  return {
    id: season.id,
    name: season.name,
    number: season.number,
    startDate: season.startDate,
    endDate: season.endDate,
  };
}

/**
 * End the current season and compute final standings.
 */
export function endSeason() {
  const season = seasonState.current;
  if (!season) return null;

  season.active = false;
  season.endedAt = new Date().toISOString();

  // Compute final standings
  const standings = [...season.participants.entries()]
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => b.xp - a.xp);

  season.finalStandings = standings;
  seasonState.current = null;

  return {
    id: season.id,
    name: season.name,
    standings: standings.slice(0, 20),
    totalParticipants: standings.length,
  };
}

/**
 * Record a season contribution.
 */
export function recordSeasonContribution(userId, { xp = 0, type = "general" } = {}) {
  const season = seasonState.current;
  if (!season) return { ok: false, reason: "no_active_season" };

  if (!season.participants.has(userId)) {
    season.participants.set(userId, { xp: 0, contributions: 0, rank: 0 });
  }

  const entry = season.participants.get(userId);
  entry.xp += xp;
  entry.contributions++;

  return { ok: true, seasonXP: entry.xp, contributions: entry.contributions };
}

/**
 * Add a challenge to the current season.
 */
export function addSeasonChallenge({ name, description, xpReward, requirement, lens = null }) {
  const season = seasonState.current;
  if (!season) return { ok: false, reason: "no_active_season" };

  const challenge = {
    id: uuid(),
    name,
    description,
    xpReward: xpReward || 100,
    requirement: requirement || {},
    lens,
    completedBy: [],
    createdAt: new Date().toISOString(),
  };

  season.challenges.push(challenge);
  return { ok: true, challengeId: challenge.id };
}

/**
 * Complete a season challenge.
 */
export function completeChallenge(userId, challengeId) {
  const season = seasonState.current;
  if (!season) return { ok: false, reason: "no_active_season" };

  const challenge = season.challenges.find(c => c.id === challengeId);
  if (!challenge) return { ok: false, reason: "challenge_not_found" };
  if (challenge.completedBy.includes(userId)) return { ok: false, reason: "already_completed" };

  challenge.completedBy.push(userId);

  // Award XP
  const xpResult = awardXP(userId, "achievement_unlocked", {
    lens: challenge.lens,
    source: challengeId,
  });

  recordSeasonContribution(userId, { xp: challenge.xpReward, type: "challenge" });

  return { ok: true, xpAwarded: xpResult.xpAwarded, challengeName: challenge.name };
}

/**
 * Get current season info.
 */
export function getCurrentSeason() {
  const season = seasonState.current;
  if (!season) return null;

  return {
    id: season.id,
    name: season.name,
    number: season.number,
    theme: season.theme,
    startDate: season.startDate,
    endDate: season.endDate,
    active: season.active,
    participantCount: season.participants.size,
    challengeCount: season.challenges.length,
    challenges: season.challenges.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      xpReward: c.xpReward,
      completions: c.completedBy.length,
    })),
  };
}

// ── Achievement System ───────────────────────────────────────────────────────

const ACHIEVEMENTS = [
  // Knowledge achievements
  { id: "first_dtu",        name: "First Thought",         description: "Create your first DTU",                     category: "knowledge", requirement: { action: "dtu_created", count: 1 } },
  { id: "dtu_10",           name: "Knowledge Seeker",      description: "Create 10 DTUs",                            category: "knowledge", requirement: { action: "dtu_created", count: 10 } },
  { id: "dtu_100",          name: "Knowledge Architect",   description: "Create 100 DTUs",                           category: "knowledge", requirement: { action: "dtu_created", count: 100 } },
  { id: "dtu_1000",         name: "Knowledge Titan",       description: "Create 1000 DTUs",                          category: "knowledge", requirement: { action: "dtu_created", count: 1000 } },
  { id: "first_mega",       name: "Mega Mind",             description: "Create your first MEGA-tier DTU",           category: "knowledge", requirement: { action: "dtu_mega_created", count: 1 } },
  { id: "first_hyper",      name: "Hyper Thinker",         description: "Create your first HYPER-tier DTU",          category: "knowledge", requirement: { action: "dtu_hyper_created", count: 1 } },

  // Social achievements
  { id: "first_mentor",     name: "Guide",                 description: "Become a mentor",                           category: "social", requirement: { action: "mentee_graduated", count: 0 } },
  { id: "mentor_grad",      name: "Master Teacher",        description: "Graduate a mentee",                         category: "social", requirement: { action: "mentee_graduated", count: 1 } },
  { id: "org_founder",      name: "Founder",               description: "Create an organization",                    category: "social", requirement: { action: "org_contribution", count: 1 } },
  { id: "event_host",       name: "Event Planner",         description: "Host your first event",                     category: "social", requirement: { action: "event_hosted", count: 1 } },
  { id: "event_10",         name: "Community Pillar",      description: "Host 10 events",                            category: "social", requirement: { action: "event_hosted", count: 10 } },

  // Career achievements
  { id: "first_job",        name: "Employed",              description: "Complete your first job task",               category: "career", requirement: { action: "job_task_completed", count: 1 } },
  { id: "job_50",           name: "Hard Worker",           description: "Complete 50 job tasks",                      category: "career", requirement: { action: "job_task_completed", count: 50 } },
  { id: "first_business",   name: "Entrepreneur",          description: "Make your first business sale",              category: "career", requirement: { action: "business_sale", count: 1 } },
  { id: "franchise_sold",   name: "Franchise Mogul",       description: "Sell your first franchise",                  category: "career", requirement: { action: "franchise_sold", count: 1 } },

  // Exploration achievements
  { id: "explorer_5",       name: "Explorer",              description: "Visit 5 different districts",                category: "exploration", requirement: { action: "district_visited", count: 5 } },
  { id: "explorer_15",      name: "Wanderer",              description: "Visit 15 different districts",               category: "exploration", requirement: { action: "district_visited", count: 15 } },
  { id: "explorer_all",     name: "World Walker",          description: "Visit every district in the Global City",    category: "exploration", requirement: { action: "district_visited", count: 30 } },

  // Streak achievements
  { id: "streak_7",         name: "Consistent",            description: "7-day login streak",                         category: "dedication", requirement: { action: "daily_login", count: 7 } },
  { id: "streak_30",        name: "Dedicated",             description: "30-day login streak",                        category: "dedication", requirement: { action: "daily_login", count: 30 } },
  { id: "streak_100",       name: "Unstoppable",           description: "100-day login streak",                       category: "dedication", requirement: { action: "daily_login", count: 100 } },

  // Mastery achievements
  { id: "rank_artisan",     name: "Rising Star",           description: "Reach Artisan rank",                         category: "mastery", requirement: { rank: 3 } },
  { id: "rank_expert",      name: "Authority",             description: "Reach Expert rank",                          category: "mastery", requirement: { rank: 4 } },
  { id: "rank_master",      name: "Luminary",              description: "Reach Master rank",                          category: "mastery", requirement: { rank: 5 } },
  { id: "rank_grandmaster", name: "Legend",                description: "Reach Grandmaster rank",                     category: "mastery", requirement: { rank: 6 } },
];

/** @type {Map<string, Set<string>>} userId → set of unlocked achievement IDs */
const userAchievements = new Map();

/** @type {Map<string, Map<string, number>>} userId → action → count */
const actionCounters = new Map();

/**
 * Track an action for achievement progress.
 */
export function trackAction(userId, action, count = 1) {
  if (!actionCounters.has(userId)) {
    actionCounters.set(userId, new Map());
  }
  const counters = actionCounters.get(userId);
  counters.set(action, (counters.get(action) || 0) + count);

  // Check for newly unlocked achievements
  return checkAchievements(userId);
}

/**
 * Check and unlock any earned achievements.
 */
export function checkAchievements(userId) {
  if (!userAchievements.has(userId)) {
    userAchievements.set(userId, new Set());
  }

  const unlocked = userAchievements.get(userId);
  const counters = actionCounters.get(userId) || new Map();
  const profile = getMasteryProfile(userId);
  const newlyUnlocked = [];

  for (const ach of ACHIEVEMENTS) {
    if (unlocked.has(ach.id)) continue;

    let earned = false;

    if (ach.requirement.action && ach.requirement.count !== undefined) {
      const current = counters.get(ach.requirement.action) || 0;
      earned = current >= ach.requirement.count;
    }

    if (ach.requirement.rank !== undefined) {
      earned = profile.rank >= ach.requirement.rank;
    }

    if (earned) {
      unlocked.add(ach.id);
      newlyUnlocked.push({
        id: ach.id,
        name: ach.name,
        description: ach.description,
        category: ach.category,
      });
    }
  }

  return newlyUnlocked;
}

/**
 * Get all achievements with unlock status for a user.
 */
export function getAchievements(userId) {
  const unlocked = userAchievements.get(userId) || new Set();
  const counters = actionCounters.get(userId) || new Map();
  const profile = getMasteryProfile(userId);

  return ACHIEVEMENTS.map(ach => {
    let progress = 0;
    let target = 1;

    if (ach.requirement.action && ach.requirement.count !== undefined) {
      progress = counters.get(ach.requirement.action) || 0;
      target = ach.requirement.count || 1;
    } else if (ach.requirement.rank !== undefined) {
      progress = profile.rank;
      target = ach.requirement.rank;
    }

    return {
      ...ach,
      unlocked: unlocked.has(ach.id),
      progress: Math.min(progress, target),
      target,
      percent: Math.min(100, Math.round((progress / target) * 100)),
    };
  });
}

// ── Explorer Tracking ────────────────────────────────────────────────────────

/** @type {Map<string, object>} userId → explorer state */
const explorerState = new Map();

/**
 * Record a district visit.
 */
export function recordDistrictVisit(userId, districtId) {
  if (!explorerState.has(userId)) {
    explorerState.set(userId, {
      visitedDistricts: new Set(),
      visitLog: [],
      totalVisits: 0,
      favoriteDistrict: null,
      districtVisitCounts: {},
    });
  }

  const state = explorerState.get(userId);
  const isNew = !state.visitedDistricts.has(districtId);
  state.visitedDistricts.add(districtId);
  state.totalVisits++;

  state.districtVisitCounts[districtId] = (state.districtVisitCounts[districtId] || 0) + 1;

  // Update favorite
  let maxVisits = 0;
  for (const [did, count] of Object.entries(state.districtVisitCounts)) {
    if (count > maxVisits) {
      maxVisits = count;
      state.favoriteDistrict = did;
    }
  }

  // Log visit (keep last 50)
  state.visitLog.push({ districtId, ts: new Date().toISOString(), isNew });
  if (state.visitLog.length > 50) state.visitLog = state.visitLog.slice(-50);

  // Track for achievements
  if (isNew) {
    trackAction(userId, "district_visited");
  }

  return {
    isNewDistrict: isNew,
    uniqueDistricts: state.visitedDistricts.size,
    totalVisits: state.totalVisits,
  };
}

/**
 * Get explorer stats for a user.
 */
export function getExplorerStats(userId) {
  const state = explorerState.get(userId);
  if (!state) {
    return {
      visitedDistricts: 0,
      totalVisits: 0,
      favoriteDistrict: null,
      recentVisits: [],
      completionPercent: 0,
    };
  }

  return {
    visitedDistricts: state.visitedDistricts.size,
    visitedList: [...state.visitedDistricts],
    totalVisits: state.totalVisits,
    favoriteDistrict: state.favoriteDistrict,
    recentVisits: state.visitLog.slice(-10),
    completionPercent: Math.round((state.visitedDistricts.size / 30) * 100), // 30 districts in Global City
  };
}

// ── Daily/Weekly Activities ──────────────────────────────────────────────────

/** @type {Map<string, object>} userId → activity state */
const activityState = new Map();

/**
 * Record daily login and manage streaks.
 */
export function recordDailyLogin(userId) {
  if (!activityState.has(userId)) {
    activityState.set(userId, {
      lastLoginDate: null,
      streakDays: 0,
      totalLogins: 0,
      weeklyTasks: [],
      dailyTasks: [],
    });
  }

  const state = activityState.get(userId);
  const today = new Date().toISOString().slice(0, 10);

  if (state.lastLoginDate === today) {
    return { alreadyLoggedIn: true, streakDays: state.streakDays };
  }

  state.totalLogins++;

  // Check streak
  if (state.lastLoginDate) {
    const lastDate = new Date(state.lastLoginDate);
    const todayDate = new Date(today);
    const diffDays = Math.round((todayDate - lastDate) / 86400_000);

    if (diffDays === 1) {
      state.streakDays++;
    } else if (diffDays > 1) {
      state.streakDays = 1; // Reset streak
    }
  } else {
    state.streakDays = 1;
  }

  state.lastLoginDate = today;

  // Award XP
  const xpResult = awardXP(userId, "daily_login");

  // Track for achievements
  trackAction(userId, "daily_login");

  // Check weekly streak bonus
  let weeklyBonus = false;
  if (state.streakDays > 0 && state.streakDays % 7 === 0) {
    awardXP(userId, "weekly_streak");
    weeklyBonus = true;
  }

  // Update mastery profile streak
  const profile = getMasteryProfile(userId);
  profile.streakDays = state.streakDays;

  return {
    alreadyLoggedIn: false,
    streakDays: state.streakDays,
    totalLogins: state.totalLogins,
    xpAwarded: xpResult.xpAwarded,
    weeklyBonus,
  };
}

/**
 * Generate daily tasks for a user based on their lens activity.
 */
export function generateDailyTasks(userId, { lenses = [] } = {}) {
  const taskTemplates = [
    { type: "create_dtu",    description: "Create a DTU in {lens}",              xpReward: 15, lens: true },
    { type: "visit_district", description: "Visit a new district",               xpReward: 10, lens: false },
    { type: "help_query",     description: "Answer a query in {lens}",           xpReward: 10, lens: true },
    { type: "job_task",       description: "Complete a job task",                 xpReward: 20, lens: false },
    { type: "social_interact", description: "Interact with another player",      xpReward: 8,  lens: false },
    { type: "attend_event",   description: "Attend an event",                    xpReward: 15, lens: false },
  ];

  const tasks = [];
  const usedTypes = new Set();

  // Pick 3 daily tasks
  while (tasks.length < 3 && usedTypes.size < taskTemplates.length) {
    const template = taskTemplates[Math.floor(Math.random() * taskTemplates.length)];
    if (usedTypes.has(template.type)) continue;
    usedTypes.add(template.type);

    const lens = template.lens && lenses.length > 0
      ? lenses[Math.floor(Math.random() * lenses.length)]
      : null;

    tasks.push({
      id: uuid(),
      type: template.type,
      description: template.description.replace("{lens}", lens || "any lens"),
      xpReward: template.xpReward,
      lens,
      completed: false,
      createdAt: new Date().toISOString(),
    });
  }

  if (!activityState.has(userId)) {
    activityState.set(userId, {
      lastLoginDate: null, streakDays: 0, totalLogins: 0,
      weeklyTasks: [], dailyTasks: [],
    });
  }
  activityState.get(userId).dailyTasks = tasks;

  return tasks;
}

/**
 * Complete a daily task.
 */
export function completeDailyTask(userId, taskId) {
  const state = activityState.get(userId);
  if (!state) return { ok: false, reason: "no_activity_state" };

  const task = state.dailyTasks.find(t => t.id === taskId);
  if (!task) return { ok: false, reason: "task_not_found" };
  if (task.completed) return { ok: false, reason: "already_completed" };

  task.completed = true;
  task.completedAt = new Date().toISOString();

  // Award XP
  const xpResult = awardXP(userId, "dtu_created", { lens: task.lens });

  return {
    ok: true,
    taskType: task.type,
    xpAwarded: xpResult.xpAwarded,
    dailyProgress: state.dailyTasks.filter(t => t.completed).length + "/" + state.dailyTasks.length,
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export {
  MASTERY_RANKS,
  XP_ACTIONS,
  ACHIEVEMENTS,
  SEASON_DURATION_DAYS,
};

export default {
  // Mastery
  getMasteryProfile,
  awardXP,
  getRankForXP,
  getLeaderboard,
  // Seasons
  startSeason,
  endSeason,
  recordSeasonContribution,
  addSeasonChallenge,
  completeChallenge,
  getCurrentSeason,
  // Achievements
  trackAction,
  checkAchievements,
  getAchievements,
  // Explorer
  recordDistrictVisit,
  getExplorerStats,
  // Activities
  recordDailyLogin,
  generateDailyTasks,
  completeDailyTask,
};
