// Structured fixtures for Phase 5 coverage gaps — macros that need real input
// or pre-seeded state to pass the lens-action contract headlessly.

/** @type {Record<string, object>} */
export const RUNTIME_COVERAGE_FIXTURES = {
  "autonomy.profile": { entityId: "coverage-autonomy-entity" },
  "autonomy.rights": { entityId: "coverage-autonomy-entity" },
  "teaching.profile": { entityId: "coverage-teaching-entity" },
  "cache.get": { key: "coverage-cache-key" },
  "city.followStream": { streamId: "coverage-stream-1" },
  "city.unfollowStream": { streamId: "coverage-stream-1" },
  "city.repeal": { worldId: "concordia-hub", kind: "coverage_policy_kind" },
  "macro_dag.validate": { plan: { steps: [] } },
  "macro_dag.describe": { plan: { steps: [] } },
  "macro_dag.run": { plan: { steps: [] } },
  "observability.log_error": {
    lensId: "runtime-coverage",
    message: "fixture client error",
    stack: "Error: fixture\n    at coverage",
  },
  "grc.validate": {
    grc: {
      toneLock: "Aligned.",
      anchor: { dtus: ["Genesis"], macros: [], stateRefs: [], mode: "governed-response" },
      invariants: ["NoNegativeValence"],
      reality: { facts: ["f1"], assumptions: ["a1"], unknowns: ["u1"] },
      payload: "Coverage payload.",
      nextLoop: { name: "Loop", why: "Coverage probe." },
      question: "What next?",
    },
  },
  "apps.validate": {
    name: "Coverage App",
    primitives: { ui: { type: "panel", children: [] } },
  },
  "physical.validate": {
    dtu: { kind: "movement", payload: { verb: "walk", distance_m: 1 } },
  },
  "emergent.evidence.deprecate": { dtuId: "coverage-dtu-deprecate", reason: "coverage_fixture" },
  "emergent.evidence.retract": { dtuId: "coverage-dtu-retract", reason: "coverage_fixture" },
  "emergent.threat.block": { userId: "coverage-threat-user", reason: "coverage_fixture" },
  "emergent.threat.unblock": { userId: "coverage-threat-user" },
  "dila.dhtp_compile": {
    mission: { goal: "coverage compile probe" },
    step: { tool: "coverage" },
    stepIndex: 0,
    route: { taskClass: "reasoning" },
  },
  "dila.dhtp_process_delta": { text: "coverage delta", f0Authorized: false },
  "dila.dhtp_execute_delta": {
    text: "coverage execute",
    delta: { OBJECTIVE: "probe", DEPENDENCIES: "" },
    mission: { goal: "coverage" },
    step: { tool: "coverage" },
    stepIndex: 0,
    route: { taskClass: "reasoning" },
  },
  "dila.dhtp_metrics": { sinceDays: 7 },
  "dila.cognitive_cache_stats": {},
  "dila.dhtp_policy_learn": { sinceDays: 1 },
  "dila.learning_pipeline": { benchResults: [], repoRoot: process.cwd() },
  "dila.cognitive_mission_bench": { smoke: true },
  "dila.concord_bench": { caseIds: ["math.add"], repoRoot: process.cwd() },
  "dila.pce_bench": { categories: ["math"], repoRoot: process.cwd() },
  "pharmacy.checkInteractions": {
    drugs: ["aspirin", "ibuprofen"],
  },
  "mental-health.generate-insights": {
    moodEntries: [{ date: "2026-01-01", score: 6, notes: "fixture" }],
  },
  "projects.analyze-risks": {
    project: { name: "Coverage", tasks: [{ id: "t1", title: "Task", dependsOn: [] }] },
  },
  "politics.withdraw": { candidateId: "coverage-candidate", officeId: "coverage-office" },
  "religion.leave": { faithId: "coverage-faith" },
};

/** Macros exercised in the stateful / interactive harness (class D, E, heavy). */
export const STATEFUL_COVERAGE_MACRO_IDS = new Set([
  // Class D — interactive / stateful mutations
  "chat.merge_threads", "chat.publish", "chat.save", "chat.send", "chat.vote",
  "housing.claim",
  "marketplace.checkout-create", "marketplace.checkout-history", "marketplace.install",
  "marketplace.installed", "marketplace.publish", "marketplace.purchase",
  "marketplace.purchasePlugin", "marketplace.purchaseWithRoyalties", "marketplace.save",
  "marketplace.saved-searches-delete", "marketplace.saved-searches-list",
  "marketplace.saved-searches-save", "marketplace.submit", "marketplace.updateListing",
  "marketplace.vote",
  "personas.create", "personas.install", "personas.publish", "personas.update",
  "quests.claimRewards",
  "wallet.publish", "wallet.save", "wallet.splitCreate", "wallet.splitList",
  "wallet.splitSettle", "wallet.vote",
  "world.publish", "world.save", "world.spawn-npc", "world.vote",
  // Class E — destructive (safe isolated harness)
  "agent_marathon.revoke", "agents.destroy", "agents.reset", "animation.reset",
  "apps.delete", "automation.delete", "cache.clear", "custom.unpublish", "drafts.delete",
  "dreams.unpublish", "dtu.delete", "foundry.delete", "foundry.unpublish",
  "hermes_memory.delete", "hooks.destroy", "hooks.drop", "insurance.revoke",
  "lens.delete", "licensing.revoke", "loaf.sandbox.kill", "oxygen.reset",
  "persona.delete", "personas.delete", "playerCorpse.drop", "sandbox.kill",
  "settings.reset", "webhook.delete",
  // Heavy deterministic (too slow for bulk sweep)
  "dila.cognitive_mission_bench", "dila.learning_pipeline",
]);

export const INTERACTIVE_DILA_FIXTURES = {
  "dila.cognitive_mission_bench": { smoke: true },
  "dila.learning_pipeline": { benchResults: [], repoRoot: process.cwd() },
};

export function buildRuntimeCoverageInput(domain, action, baseInput) {
  const key = `${domain}.${action}`;
  const fixture = RUNTIME_COVERAGE_FIXTURES[key];
  if (!fixture) return baseInput;
  return { ...baseInput, ...fixture };
}

/** @type {Record<string, unknown>} */
export const RUNTIME_COVERAGE_SEEDS = {};

/**
 * Pre-seed state for macros that need existing rows (cache, spaces, sports).
 * @param {Function} dispatch
 * @param {object} ctx
 */
export async function preflightCoverageSetup(dispatch, ctx) {
  await dispatch("cache", "set", {
    key: RUNTIME_COVERAGE_FIXTURES["cache.get"].key,
    data: { coverage: true },
    ttl: 60000,
  }, ctx);

  const room = await dispatch("spaces", "create", {
    title: "Coverage Room",
    description: "preflight",
    maxListeners: 10,
  }, ctx);
  const roomId = room?.roomId || room?.room?.id || room?.result?.room?.id;
  if (roomId) {
    RUNTIME_COVERAGE_SEEDS.roomId = roomId;
    RUNTIME_COVERAGE_FIXTURES["spaces.get"] = { roomId };
    RUNTIME_COVERAGE_FIXTURES["spaces.leave"] = { roomId };
  }

  const league = await dispatch("sports_careers", "open_league", {
    name: "Coverage League",
    sport: "basketball",
  }, ctx);
  const leagueId = league?.leagueId || league?.result?.leagueId;
  if (leagueId) {
    RUNTIME_COVERAGE_SEEDS.leagueId = leagueId;
    const team = await dispatch("sports_careers", "add_team", {
      leagueId,
      name: "Coverage Team",
    }, ctx);
    const career = await dispatch("sports_careers", "request_tryout", {
      leagueId,
      teamId: team?.teamId || team?.result?.teamId,
      playerName: "Coverage Player",
    }, ctx);
    const careerId = career?.careerId || career?.result?.careerId;
    if (careerId) {
      RUNTIME_COVERAGE_SEEDS.careerId = careerId;
      RUNTIME_COVERAGE_FIXTURES["sports_careers.record_outcome"] = { careerId, points: 10, wonMvp: false };
      RUNTIME_COVERAGE_FIXTURES["sports_careers.retire"] = { careerId };
    }
  }
}
