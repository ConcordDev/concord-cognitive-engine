/**
 * System 6: Quest Engine — Structured Learning Paths with Breadcrumb Protocol
 *
 * Provides structured learning paths (quests) composed of typed steps.
 * Each quest can include a breadcrumb protocol that releases insights
 * progressively rather than dumping them raw.
 *
 * Step types:
 *   - learn:      Read DTUs, demonstrate understanding
 *   - challenge:  Apply knowledge to a problem
 *   - discover:   Guided exploration of a domain
 *   - synthesize: Combine knowledge across domains
 *
 * Breadcrumb Protocol:
 *   Insights are never dumped raw. Each has prerequisites.
 *   Release modes: on_completion, timed, sovereign_triggered.
 *   Each breadcrumb becomes a DTU.
 *
 * Additive only. Silent failure. All state in-memory.
 */

import crypto from "crypto";

// ── DB Registration ──────────────────────────────────────────────────────────
//
// quest-engine is in-memory and intentionally has no DB dependency. The
// reward-grant pathway needs a writable db handle though, so the server
// boot calls setQuestRewardDB(db) once after migrations finish. Without
// this registration, quest completion still fires the realtime emit and
// breadcrumbs unlock — the rewards just don't grant.

let _rewardDB = null;

export function setQuestRewardDB(db) { _rewardDB = db; }

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

// ── Constants ───────────────────────────────────────────────────────────────

export const STEP_TYPES = Object.freeze({
  LEARN:      "learn",
  CHALLENGE:  "challenge",
  DISCOVER:   "discover",
  SYNTHESIZE: "synthesize",
});

export const DIFFICULTIES = Object.freeze({
  BEGINNER:     "beginner",
  INTERMEDIATE: "intermediate",
  ADVANCED:     "advanced",
  MASTER:       "master",
});

export const QUEST_TEMPLATES = Object.freeze({
  domain_intro: {
    name: "domain_intro",
    description: "Introduction to a domain — 5 steps covering basics",
    difficulty: DIFFICULTIES.BEGINNER,
    estimatedTime: "2h",
    stepSequence: [
      STEP_TYPES.LEARN,
      STEP_TYPES.LEARN,
      STEP_TYPES.CHALLENGE,
      STEP_TYPES.DISCOVER,
      STEP_TYPES.SYNTHESIZE,
    ],
    breadcrumbCount: 1,
  },
  deep_dive: {
    name: "deep_dive",
    description: "Deep exploration — 10 steps with advanced content",
    difficulty: DIFFICULTIES.ADVANCED,
    estimatedTime: "8h",
    stepSequence: [
      STEP_TYPES.LEARN,
      STEP_TYPES.CHALLENGE,
      STEP_TYPES.LEARN,
      STEP_TYPES.CHALLENGE,
      STEP_TYPES.DISCOVER,
      STEP_TYPES.LEARN,
      STEP_TYPES.CHALLENGE,
      STEP_TYPES.SYNTHESIZE,
      STEP_TYPES.DISCOVER,
      STEP_TYPES.SYNTHESIZE,
    ],
    breadcrumbCount: 3,
  },
  research_quest: {
    name: "research_quest",
    description: "Research-oriented quest — 7 steps at master level",
    difficulty: DIFFICULTIES.MASTER,
    estimatedTime: "12h",
    stepSequence: [
      STEP_TYPES.LEARN,
      STEP_TYPES.LEARN,
      STEP_TYPES.CHALLENGE,
      STEP_TYPES.DISCOVER,
      STEP_TYPES.CHALLENGE,
      STEP_TYPES.SYNTHESIZE,
      STEP_TYPES.DISCOVER,
    ],
    breadcrumbCount: 2,
  },
});

// ── In-Memory State ─────────────────────────────────────────────────────────

const quests = new Map();        // questId → quest object
const activeQuests = new Map();  // questId → quest (only started, not completed)
const questMetrics = {
  totalCreated: 0,
  totalStarted: 0,
  totalCompleted: 0,
  stepsCompleted: 0,
  insightsReleased: 0,
  byDifficulty: {},
  byDomain: {},
  fromTemplate: 0,
};

// ── Quest Creation ──────────────────────────────────────────────────────────

/**
 * Create a new quest with the given title and configuration.
 *
 * @param {string} title - Quest title
 * @param {object} config - Quest configuration
 * @param {string} [config.description] - Quest description
 * @param {string} [config.difficulty] - beginner|intermediate|advanced|master
 * @param {string} [config.domain] - Domain for the quest
 * @param {string} [config.estimatedTime] - Estimated completion time
 * @param {object[]} [config.steps] - Array of step definitions
 * @param {object} [config.breadcrumbs] - Breadcrumb protocol configuration
 * @param {string[]} [config.prerequisites] - Prerequisite quest IDs
 * @param {string[]} [config.followUp] - Follow-up quest IDs
 * @param {string[]} [config.tags] - Tags for categorization
 * @returns {object} Created quest or error
 */
export function createQuest(title, config = {}) {
  try {
    if (!title || typeof title !== "string") {
      return { ok: false, error: "title_required" };
    }

    const questId = uid("quest");
    const now = nowISO();

    const difficulty = Object.values(DIFFICULTIES).includes(config.difficulty)
      ? config.difficulty
      : DIFFICULTIES.INTERMEDIATE;

    const steps = Array.isArray(config.steps)
      ? config.steps.map((s, i) => buildStep(s, i))
      : [];

    const breadcrumbs = buildBreadcrumbs(config.breadcrumbs);

    const quest = {
      id: questId,
      title: String(title).slice(0, 500),
      description: String(config.description || "").slice(0, 2000),
      creator: "sovereign",
      difficulty,
      domain: config.domain || "general",
      estimatedTime: config.estimatedTime || null,
      steps,
      breadcrumbs,
      // Quest-level rewards block — passed through from authored JSON. The
      // completion handler grants these via lib/quest-rewards.grantQuestRewards
      // when the final step lands. Unknown shape is tolerated; missing fields
      // simply become no-op grants.
      rewards: (config.rewards && typeof config.rewards === "object") ? config.rewards : {},
      authoredId: typeof config.authoredId === "string" ? config.authoredId : null,
      progress: {
        userId: null,
        startedAt: null,
        completedSteps: [],
        currentStep: null,
        badges: [],
        completedAt: null,
      },
      prerequisites: Array.isArray(config.prerequisites) ? config.prerequisites : [],
      followUp: Array.isArray(config.followUp) ? config.followUp : [],
      tags: Array.isArray(config.tags) ? config.tags : [],
      createdAt: now,
    };

    quests.set(questId, quest);
    questMetrics.totalCreated++;
    questMetrics.byDifficulty[difficulty] = (questMetrics.byDifficulty[difficulty] || 0) + 1;
    questMetrics.byDomain[quest.domain] = (questMetrics.byDomain[quest.domain] || 0) + 1;

    return { ok: true, quest };
  } catch {
    return { ok: false, error: "create_quest_failed" };
  }
}

/**
 * Retrieve a quest by ID.
 *
 * @param {string} id - Quest ID
 * @returns {object} Quest or error
 */
export function getQuest(id) {
  try {
    const quest = quests.get(id);
    if (!quest) return { ok: false, error: "quest_not_found" };
    return { ok: true, quest };
  } catch {
    return { ok: false, error: "get_quest_failed" };
  }
}

/**
 * List quests with optional filtering.
 *
 * @param {object} [filter] - Filter criteria
 * @param {string} [filter.difficulty] - Filter by difficulty level
 * @param {string} [filter.domain] - Filter by domain
 * @param {string} [filter.tag] - Filter by tag
 * @param {boolean} [filter.started] - Filter by started status
 * @param {boolean} [filter.completed] - Filter by completed status
 * @returns {object} Filtered quest list
 */
export function listQuests(filter = {}) {
  try {
    let results = Array.from(quests.values());

    if (filter.difficulty) {
      results = results.filter(q => q.difficulty === filter.difficulty);
    }
    if (filter.domain) {
      results = results.filter(q => q.domain === filter.domain);
    }
    if (filter.tag) {
      results = results.filter(q => q.tags.includes(filter.tag));
    }
    if (filter.started === true) {
      results = results.filter(q => q.progress.startedAt !== null);
    }
    if (filter.started === false) {
      results = results.filter(q => q.progress.startedAt === null);
    }
    if (filter.completed === true) {
      results = results.filter(q => q.progress.completedAt !== null);
    }
    if (filter.completed === false) {
      results = results.filter(q => q.progress.completedAt === null);
    }

    return { ok: true, quests: results, count: results.length };
  } catch {
    return { ok: false, error: "list_quests_failed" };
  }
}

// ── Quest Lifecycle ─────────────────────────────────────────────────────────

/**
 * Start a quest for a given user. Sets progress tracking and marks the
 * first step as the current step.
 *
 * @param {string} questId - Quest to start
 * @param {string} userId - User starting the quest
 * @returns {object} Updated quest or error
 */
export function startQuest(questId, userId) {
  try {
    const quest = quests.get(questId);
    if (!quest) return { ok: false, error: "quest_not_found" };
    if (!userId) return { ok: false, error: "user_id_required" };
    if (quest.progress.startedAt) return { ok: false, error: "quest_already_started" };

    // Check prerequisites
    for (const prereqId of quest.prerequisites) {
      const prereq = quests.get(prereqId);
      if (!prereq || !prereq.progress.completedAt) {
        return { ok: false, error: "prerequisites_not_met", prerequisite: prereqId };
      }
    }

    const now = nowISO();
    quest.progress.userId = userId;
    quest.progress.startedAt = now;
    quest.progress.currentStep = quest.steps.length > 0 ? quest.steps[0].id : null;

    activeQuests.set(questId, quest);
    questMetrics.totalStarted++;

    return { ok: true, quest };
  } catch {
    return { ok: false, error: "start_quest_failed" };
  }
}

/**
 * Complete a step within a quest. Handles dependency checking, badge
 * awarding, breadcrumb release (on_completion mode), and auto-advancing
 * to the next step.
 *
 * @param {string} questId - Quest containing the step
 * @param {string} stepId - Step to complete
 * @returns {object} Completion result with any released insights
 */
export function completeStep(questId, stepId) {
  try {
    const quest = quests.get(questId);
    if (!quest) return { ok: false, error: "quest_not_found" };
    if (!quest.progress.startedAt) return { ok: false, error: "quest_not_started" };

    const step = quest.steps.find(s => s.id === stepId);
    if (!step) return { ok: false, error: "step_not_found" };
    if (step.completed) return { ok: false, error: "step_already_completed" };

    // Check step dependencies
    for (const depId of step.dependsOn) {
      const dep = quest.steps.find(s => s.id === depId);
      if (!dep || !dep.completed) {
        return { ok: false, error: "step_dependencies_not_met", dependency: depId };
      }
    }

    // Mark step completed
    step.completed = true;
    step.completedAt = nowISO();
    quest.progress.completedSteps.push(stepId);
    questMetrics.stepsCompleted++;

    // Award badges from step rewards
    const badges = [];
    if (step.rewards && step.rewards.badge) {
      quest.progress.badges.push(step.rewards.badge);
      badges.push(step.rewards.badge);
    }

    // Release breadcrumbs triggered by this step completion
    const releasedInsights = [];
    if (quest.breadcrumbs.enabled &&
        quest.breadcrumbs.releaseSchedule === "on_completion") {
      const toRelease = quest.breadcrumbs.pendingInsights.filter(
        ins => ins.unlocksAfter === stepId
      );
      for (const insight of toRelease) {
        insight.releasedAt = nowISO();
        quest.breadcrumbs.unlockedInsights.push(insight);
        quest.breadcrumbs.pendingInsights = quest.breadcrumbs.pendingInsights.filter(
          ins => ins.id !== insight.id
        );
        releasedInsights.push(insight);
        questMetrics.insightsReleased++;
      }
    }

    // Advance to next step
    const currentIndex = quest.steps.findIndex(s => s.id === stepId);
    const nextStep = findNextAvailableStep(quest, currentIndex);
    quest.progress.currentStep = nextStep ? nextStep.id : null;

    // Check quest completion
    const allCompleted = quest.steps.length > 0 &&
      quest.steps.every(s => s.completed);
    if (allCompleted) {
      quest.progress.completedAt = nowISO();
      activeQuests.delete(questId);
      questMetrics.totalCompleted++;

      // Release any remaining breadcrumbs on quest completion
      if (quest.breadcrumbs.enabled) {
        for (const insight of quest.breadcrumbs.pendingInsights) {
          insight.releasedAt = nowISO();
          quest.breadcrumbs.unlockedInsights.push(insight);
          releasedInsights.push(insight);
          questMetrics.insightsReleased++;
        }
        quest.breadcrumbs.pendingInsights = [];
      }

      // Realtime emit so the GameJuice bridge fires the fanfare.
      try {
        const userId = quest.progress?.userId;
        const io = globalThis.realtimeEmit ? null : globalThis._concordREALTIME?.io;
        const payload = { questId: quest.id, title: quest.title, completedAt: quest.progress.completedAt };
        if (userId && io) io.to(`user:${userId}`).emit("quest:completed", payload);
        else if (typeof globalThis.realtimeEmit === "function") globalThis.realtimeEmit("quest:completed", payload);
      } catch { /* realtime best-effort */ }

      // Phase 3 — beat realisation. If this completion matches an open
      // beat (subject_kind='quest', subject_id=quest.id), realise it so
      // the player metric shifts + cascade marks the underlying
      // forward-sim prediction realised. Best-effort, never blocks.
      (async () => {
        try {
          const userId = quest.progress?.userId;
          const db = globalThis._concordDB || globalThis.__CONCORD_DB__;
          if (userId && db) {
            const beats = await import("./personal-beat-scheduler.js");
            const open = beats.findOpenBeatBySubject?.(db, userId, "quest", quest.id);
            if (open?.id) await beats.realiseBeat(db, open.id, "realised");
          }
        } catch { /* beat realisation best-effort */ }
      })();

      // Quest-level reward grant. Requires both a known userId on the quest
      // progress and a registered db reference (set at server boot via
      // setQuestRewardDB). Idempotent at the lib layer; safe to call on
      // re-completion attempts.
      try {
        const userId = quest.progress?.userId;
        const db = _rewardDB;
        if (userId && db && quest.rewards && Object.keys(quest.rewards).length > 0) {
          import("../lib/quest-rewards.js")
            .then((m) => m.grantQuestRewards(db, userId, quest.id, quest.rewards))
            .catch(() => { /* grant best-effort — log inside the lib */ });
        }
      } catch { /* reward grant best-effort */ }
    }

    return {
      ok: true,
      quest,
      stepCompleted: stepId,
      badges,
      releasedInsights,
      questCompleted: !!quest.progress.completedAt,
      nextStep: quest.progress.currentStep,
    };
  } catch {
    return { ok: false, error: "complete_step_failed" };
  }
}

/**
 * Manually release a breadcrumb insight (for sovereign_triggered mode).
 *
 * @param {string} questId - Quest containing the insight
 * @param {string} insightId - Insight to release
 * @returns {object} Released insight or error
 */
export function releaseInsight(questId, insightId) {
  try {
    const quest = quests.get(questId);
    if (!quest) return { ok: false, error: "quest_not_found" };

    const insightIndex = quest.breadcrumbs.pendingInsights.findIndex(
      ins => ins.id === insightId
    );
    if (insightIndex === -1) return { ok: false, error: "insight_not_found" };

    const insight = quest.breadcrumbs.pendingInsights[insightIndex];

    // Check if prerequisite step is completed (if specified)
    if (insight.unlocksAfter) {
      const requiredStep = quest.steps.find(s => s.id === insight.unlocksAfter);
      if (requiredStep && !requiredStep.completed) {
        return { ok: false, error: "prerequisite_step_not_completed", step: insight.unlocksAfter };
      }
    }

    insight.releasedAt = nowISO();
    quest.breadcrumbs.unlockedInsights.push(insight);
    quest.breadcrumbs.pendingInsights.splice(insightIndex, 1);
    questMetrics.insightsReleased++;

    return { ok: true, insight, quest };
  } catch {
    return { ok: false, error: "release_insight_failed" };
  }
}

// ── Query Functions ─────────────────────────────────────────────────────────

/**
 * Get all currently active (started but not completed) quests.
 *
 * @returns {object} Active quests list
 */
export function getActiveQuests() {
  try {
    const results = Array.from(activeQuests.values());
    return { ok: true, quests: results, count: results.length };
  } catch {
    return { ok: false, error: "get_active_quests_failed" };
  }
}

/**
 * Get progress details for a specific quest.
 *
 * @param {string} questId - Quest to inspect
 * @returns {object} Progress details
 */
export function getQuestProgress(questId) {
  try {
    const quest = quests.get(questId);
    if (!quest) return { ok: false, error: "quest_not_found" };

    const totalSteps = quest.steps.length;
    const completedSteps = quest.steps.filter(s => s.completed).length;
    const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    const pendingInsights = quest.breadcrumbs.pendingInsights.length;
    const unlockedInsights = quest.breadcrumbs.unlockedInsights.length;

    return {
      ok: true,
      questId,
      title: quest.title,
      progress: { ...quest.progress },
      totalSteps,
      completedSteps,
      percentage,
      pendingInsights,
      unlockedInsights,
      currentStep: quest.progress.currentStep
        ? quest.steps.find(s => s.id === quest.progress.currentStep) || null
        : null,
    };
  } catch {
    return { ok: false, error: "get_quest_progress_failed" };
  }
}

// ── Template System ─────────────────────────────────────────────────────────

/**
 * Create a quest from a predefined template.
 *
 * @param {string} templateName - Template name (domain_intro|deep_dive|research_quest)
 * @param {string} domain - Domain for the quest
 * @param {string} title - Quest title
 * @returns {object} Created quest or error
 */
export function createFromTemplate(templateName, domain, title) {
  try {
    const template = QUEST_TEMPLATES[templateName];
    if (!template) {
      return { ok: false, error: "template_not_found", available: Object.keys(QUEST_TEMPLATES) };
    }

    if (!domain || typeof domain !== "string") {
      return { ok: false, error: "domain_required" };
    }

    if (!title || typeof title !== "string") {
      return { ok: false, error: "title_required" };
    }

    // Build steps from template sequence
    const steps = template.stepSequence.map((type, i) => {
      const stepNum = i + 1;
      const stepDef = {
        title: generateStepTitle(type, stepNum, domain),
        type,
        content: {
          dtuIds: [],
          prompt: generateStepPrompt(type, domain),
          hint: generateStepHint(type, domain),
          successCriteria: generateSuccessCriteria(type),
        },
        rewards: {
          knowledgeUnlock: [],
          badge: i === template.stepSequence.length - 1
            ? `${domain}_${templateName}_complete`
            : "",
        },
        dependsOn: i > 0 ? [`step_${i}`] : [],
      };
      return stepDef;
    });

    // Build breadcrumb insights from template
    const pendingInsights = [];
    for (let b = 0; b < template.breadcrumbCount; b++) {
      const triggerStepIndex = Math.min(
        Math.floor(((b + 1) / (template.breadcrumbCount + 1)) * template.stepSequence.length),
        template.stepSequence.length - 1
      );
      pendingInsights.push({
        id: `insight_${b + 1}`,
        content: `Insight ${b + 1} for ${domain} — unlocked through ${templateName} progression`,
        unlocksAfter: `step_${triggerStepIndex + 1}`,
        dtuReward: uid("dtu"),
      });
    }

    const breadcrumbs = {
      enabled: true,
      releaseSchedule: "on_completion",
      unlockedInsights: [],
      pendingInsights,
    };

    const result = createQuest(title, {
      description: `${template.description} — Domain: ${domain}`,
      difficulty: template.difficulty,
      domain,
      estimatedTime: template.estimatedTime,
      steps,
      breadcrumbs,
      tags: [domain, templateName, template.difficulty],
    });

    if (result.ok) {
      questMetrics.fromTemplate++;
    }

    return result;
  } catch {
    return { ok: false, error: "create_from_template_failed" };
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Get aggregate metrics about the quest engine.
 *
 * @returns {object} Quest engine metrics
 */
export function getQuestMetrics() {
  try {
    return {
      ok: true,
      metrics: { ...questMetrics },
      totalQuests: quests.size,
      activeQuests: activeQuests.size,
    };
  } catch {
    return { ok: false, error: "get_quest_metrics_failed" };
  }
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Build a step object from a step definition.
 */
function buildStep(def, index) {
  const type = Object.values(STEP_TYPES).includes(def.type)
    ? def.type
    : STEP_TYPES.LEARN;

  return {
    id: def.id || `step_${index + 1}`,
    title: String(def.title || `Step ${index + 1}`).slice(0, 500),
    type,
    content: {
      dtuIds: Array.isArray(def.content?.dtuIds) ? def.content.dtuIds : [],
      prompt: String(def.content?.prompt || ""),
      hint: String(def.content?.hint || ""),
      successCriteria: String(def.content?.successCriteria || ""),
    },
    rewards: {
      knowledgeUnlock: Array.isArray(def.rewards?.knowledgeUnlock) ? def.rewards.knowledgeUnlock : [],
      badge: String(def.rewards?.badge || ""),
    },
    completed: false,
    completedAt: null,
    dependsOn: Array.isArray(def.dependsOn) ? def.dependsOn : [],
  };
}

/**
 * Build a breadcrumbs configuration from a definition.
 */
function buildBreadcrumbs(def) {
  if (!def) {
    return {
      enabled: false,
      releaseSchedule: "on_completion",
      unlockedInsights: [],
      pendingInsights: [],
    };
  }

  const validSchedules = ["on_completion", "timed", "sovereign_triggered"];
  const schedule = validSchedules.includes(def.releaseSchedule)
    ? def.releaseSchedule
    : "on_completion";

  const pendingInsights = Array.isArray(def.pendingInsights)
    ? def.pendingInsights.map((ins, i) => ({
        id: ins.id || `insight_${i + 1}`,
        content: String(ins.content || ""),
        unlocksAfter: ins.unlocksAfter || null,
        dtuReward: ins.dtuReward || null,
      }))
    : [];

  return {
    enabled: def.enabled !== false,
    releaseSchedule: schedule,
    unlockedInsights: Array.isArray(def.unlockedInsights) ? def.unlockedInsights : [],
    pendingInsights,
  };
}

/**
 * Find the next uncompleted step that has all dependencies met.
 */
function findNextAvailableStep(quest, afterIndex) {
  for (let i = afterIndex + 1; i < quest.steps.length; i++) {
    const step = quest.steps[i];
    if (step.completed) continue;

    const depsMet = step.dependsOn.every(depId => {
      const dep = quest.steps.find(s => s.id === depId);
      return dep && dep.completed;
    });

    if (depsMet) return step;
  }

  // Also check earlier steps (in case of non-linear dependencies)
  for (let i = 0; i <= afterIndex; i++) {
    const step = quest.steps[i];
    if (step.completed) continue;

    const depsMet = step.dependsOn.every(depId => {
      const dep = quest.steps.find(s => s.id === depId);
      return dep && dep.completed;
    });

    if (depsMet) return step;
  }

  return null;
}

/**
 * Generate a step title based on type and context.
 */
function generateStepTitle(type, stepNum, domain) {
  switch (type) {
    case STEP_TYPES.LEARN:
      return `Step ${stepNum}: Learn ${domain} fundamentals`;
    case STEP_TYPES.CHALLENGE:
      return `Step ${stepNum}: Apply ${domain} knowledge`;
    case STEP_TYPES.DISCOVER:
      return `Step ${stepNum}: Explore ${domain} connections`;
    case STEP_TYPES.SYNTHESIZE:
      return `Step ${stepNum}: Synthesize ${domain} insights`;
    default:
      return `Step ${stepNum}`;
  }
}

/**
 * Generate a step prompt based on type and domain.
 */
function generateStepPrompt(type, domain) {
  switch (type) {
    case STEP_TYPES.LEARN:
      return `Review the provided DTUs on ${domain} and demonstrate understanding of the core concepts.`;
    case STEP_TYPES.CHALLENGE:
      return `Apply your ${domain} knowledge to solve the following problem.`;
    case STEP_TYPES.DISCOVER:
      return `Explore the ${domain} domain and identify connections to related areas.`;
    case STEP_TYPES.SYNTHESIZE:
      return `Combine your knowledge across ${domain} topics into a unified understanding.`;
    default:
      return `Complete this step for ${domain}.`;
  }
}

/**
 * Generate a hint based on step type.
 */
function generateStepHint(type, domain) {
  switch (type) {
    case STEP_TYPES.LEARN:
      return `Focus on key terms and their relationships within ${domain}.`;
    case STEP_TYPES.CHALLENGE:
      return `Break the problem down and apply principles from earlier steps.`;
    case STEP_TYPES.DISCOVER:
      return `Look for patterns and unexpected connections in ${domain}.`;
    case STEP_TYPES.SYNTHESIZE:
      return `Consider how different ${domain} concepts interact and reinforce each other.`;
    default:
      return "";
  }
}

/**
 * Generate success criteria based on step type.
 */
function generateSuccessCriteria(type) {
  switch (type) {
    case STEP_TYPES.LEARN:
      return "Demonstrate understanding of core concepts through accurate summary.";
    case STEP_TYPES.CHALLENGE:
      return "Produce a correct solution that applies the relevant principles.";
    case STEP_TYPES.DISCOVER:
      return "Identify at least two non-obvious connections to related domains.";
    case STEP_TYPES.SYNTHESIZE:
      return "Create a coherent synthesis that integrates knowledge from multiple steps.";
    default:
      return "Complete the step requirements.";
  }
}
