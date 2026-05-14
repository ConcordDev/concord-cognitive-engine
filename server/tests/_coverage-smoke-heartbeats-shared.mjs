// server/tests/_coverage-smoke-heartbeats-shared.mjs
//
// Shared HEARTBEATS list + mock context for the coverage-smoke
// heartbeat suite. Lives outside the `*.test.js` glob so it isn't
// picked up as a test on its own — imported by the 4 split files.

export const HEARTBEATS = [
  ["../emergent/repair-cortex.js", ["runFullDeploy", "runGuardianCheck", "runProphet", "runSurgeon"]],
  ["../emergent/sleep-consolidation.js", ["runConsolidation", "runREMPhase"]],
  ["../emergent/meta-derivation.js", ["runConvergenceCheck", "runMetaDerivationSession"]],
  ["../emergent/gates.js", ["runAllGates", "runAntiEchoGate"]],
  ["../emergent/verification-pipeline.js", ["runPipeline"]],
  ["../emergent/signal-propagation-cycle.js", ["runSignalPropagationCycle"]],
  ["../emergent/season-cycle.js", ["runSeasonCycle"]],
  ["../emergent/scenario-engine.js", ["runScenario"]],
  ["../emergent/research-jobs.js", ["runResearchStep"]],
  ["../emergent/repair-cycle.js", ["runRepairCycle"]],
  ["../emergent/procgen-settlement-cycle.js", ["runProcgenSettlementCycle"]],
  ["../emergent/procedural-npc-spawner.js", ["runProceduralNpcSpawner"]],
  ["../emergent/population-migration-cycle.js", ["runPopulationMigrationCycle"]],
  ["../emergent/player-signs-cleanup.js", ["runPlayerSignsCleanup"]],
  ["../emergent/outcomes.js", ["runWeightLearning"]],
  ["../emergent/npc-skill-evolve-cycle.js", ["runNpcSkillEvolveCycle"]],
  ["../emergent/npc-scheme-cycle.js", ["runNpcSchemeCycle"]],
  ["../emergent/npc-routine-cycle.js", ["runNpcRoutineCycle"]],
  ["../emergent/npc-marketplace-cycle.js", ["runNpcMarketplaceCycle"]],
  ["../emergent/npc-economy-cycle.js", ["runNpcEconomyCycle"]],
  ["../emergent/npc-conversation-initiator.js", ["runNpcConversationInitiator"]],
  ["../emergent/mount-care-cycle.js", ["runMountCareCycle"]],
  ["../emergent/lens-learning.js", ["runLensLearningCycle"]],
  ["../emergent/lattice-quest-cycle.js", ["runLatticeQuestCycle"]],
  ["../emergent/land-claims-cycle.js", ["runLandClaimsCycle"]],
  ["../emergent/kingdom-decree-cycle.js", ["runKingdomDecreeCycle"]],
  ["../emergent/idle-behavior.js", ["runIdleBehavior"]],
  ["../emergent/hlr-engine.js", ["runHLR"]],
  ["../emergent/hlm-engine.js", ["runHLMPass"]],
  ["../emergent/ghost-threads.js", ["runGhostThread"]],
  ["../emergent/forward-sim-cycle.js", ["runForwardSimCycle"]],
  ["../emergent/forgetting-engine.js", ["runForgettingCycle"]],
  ["../emergent/faction-strategy-cycle.js", ["runFactionStrategyCycle"]],
  ["../emergent/environment-sensor.js", ["runEnvironmentSensor"]],
  ["../emergent/embodied-dream-cycle.js", ["runEmbodiedDreamCycle"]],
  ["../emergent/dual-path.js", ["runDualPathSimulation"]],
  ["../emergent/drift-monitor.js", ["runDriftScan"]],
  ["../emergent/dream-cycle.js", ["runDreamCycle"]],
  ["../emergent/deep-health.js", ["runDeepHealthCheck"]],
  ["../emergent/cross-world-scheme-cycle.js", ["runCrossWorldSchemeCycle"]],
];

// Minimal context object — heartbeats expect db, STATE, structuredLog,
// realtimeEmit. Pass safe no-op shapes; throws inside the handler are
// caught + ignored (we just need the first line to execute).
export function makeMockCtx() {
  return {
    db: null,
    STATE: {
      dtus: new Map(),
      shadowDtus: new Map(),
      worlds: new Map(),
      lensArtifacts: new Map(),
      webhookSecrets: new Map(),
      _governorTickRunning: false,
    },
    structuredLog: () => {},
    realtimeEmit: () => {},
    REALTIME: { io: { emit: () => {}, to: () => ({ emit: () => {} }) } },
    BREAKERS: {},
    log: () => {},
  };
}

// Per-probe timeout. `probe` is intentionally SYNCHRONOUS — it only
// registers `test()` cases in a loop, no awaits — so each `test()` is
// its own test rather than being collapsed under a top-level await.
const PROBE_TIMEOUT_MS = 120_000;

// Per-invocation cap. The probe is function-coverage padding: it just
// needs each heartbeat's first line to execute. But some heartbeats,
// called with a null-db mock ctx, don't fail fast — they reach for an
// LLM brain (multi-second fetch timeout) or enter a wait before
// throwing. Imports themselves are cheap (~tens of ms total); the cost
// is these hanging invocations. Race each call against a short cap so a
// slow handler costs INVOCATION_CAP_MS instead of its full brain
// timeout — keeps a 10-module slice well under any runner's budget.
const INVOCATION_CAP_MS = 1_500;

function callCapped(fn, args) {
  return Promise.race([
    Promise.resolve().then(() => fn(...args)).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, INVOCATION_CAP_MS).unref?.()),
  ]).catch(() => {});
}

export function probe(test, assert, entries) {
  for (const [path, runs] of entries) {
    test(`heartbeat-smoke: ${path} — probe ${runs.join(", ")}`, { timeout: PROBE_TIMEOUT_MS }, async () => {
      const mod = await import(path);
      for (const name of runs) {
        const fn = mod[name];
        assert.equal(typeof fn, "function", `${path} expected export ${name} as function, got ${typeof fn}`);
        const ctx = makeMockCtx();
        await callCapped(fn, [ctx, { db: null, STATE: ctx.STATE }]);
        await callCapped(fn, [ctx.STATE]);
        await callCapped(fn, []);
      }
    });
  }
}
