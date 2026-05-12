import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF V.3 — Civilization-Scale Simulation & Executable Knowledge
 *
 * Capabilities (Civilizational-Scale):
 *   10. Parallel civilization-scale simulations with outcome comparison
 *   11. Policy rehearsal with reversible deployment
 *   12. Science programs as executable artifacts
 *   13. Law and governance as testable systems
 *   14. Education pipelines generated from knowledge gaps
 *   15. Automatic identification of missing sciences
 *
 * Design:
 *   - Simulations run as independent sandboxed environments
 *   - Policies can be rehearsed (dry-run) before deployment
 *   - Science programs are executable: they have inputs, methods, and expected outputs
 *   - Laws and governance rules are testable: given scenario X, is outcome Y legal?
 *   - Education pipelines are auto-generated from knowledge gap analysis
 *   - Missing sciences are identified from gaps between domains
 */

// === CIVILIZATION SIMULATIONS ===

const SIM_STATES = Object.freeze({
  INITIALIZED: "initialized",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
});

const simulations = new LruMap(); // simId -> Simulation

/**
 * Create a civilization-scale simulation.
 */
function createSimulation(label, initialConditions, parameters) {
  const id = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const sim = {
    id,
    label: String(label).slice(0, 500),
    state: SIM_STATES.INITIALIZED,
    initialConditions: (() => { try { return JSON.parse(JSON.stringify(initialConditions || {})); } catch (err) { console.debug('[civilization-sim] deep clone failed', err?.message); return { ...initialConditions }; } })(),
    currentState: (() => { try { return JSON.parse(JSON.stringify(initialConditions || {})); } catch (err) { console.debug('[civilization-sim] deep clone failed', err?.message); return { ...initialConditions }; } })(),
    parameters: {
      timeStepMs: Number(parameters?.timeStepMs || 86400000), // default 1 day
      maxSteps: Number(parameters?.maxSteps || 1000),
      ...parameters,
    },
    steps: [],
    outcomes: [],
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  simulations.set(id, sim);
  capMap(simulations, 1000);

  return { ok: true, simulation: sanitizeSim(sim) };
}

/**
 * Advance a simulation by one step.
 */
function stepSimulation(simId, event, stateTransform) {
  const sim = simulations.get(simId);
  if (!sim) return { ok: false, error: "simulation_not_found" };
  if (sim.state === SIM_STATES.COMPLETED || sim.state === SIM_STATES.FAILED) {
    return { ok: false, error: "simulation_already_finished" };
  }

  if (sim.steps.length >= sim.parameters.maxSteps) {
    sim.state = SIM_STATES.COMPLETED;
    sim.completedAt = new Date().toISOString();
    return { ok: false, error: "max_steps_reached" };
  }

  const step = {
    index: sim.steps.length,
    event: String(event || "").slice(0, 1000),
    stateBeforeKeys: Object.keys(sim.currentState),
    appliedAt: new Date().toISOString(),
  };

  // Apply state transform
  if (typeof stateTransform === "object" && stateTransform !== null) {
    for (const [key, value] of Object.entries(stateTransform)) {
      sim.currentState[key] = value;
    }
  }

  step.stateAfterKeys = Object.keys(sim.currentState);
  sim.steps.push(step);
  if (sim.steps.length > 5000) sim.steps.splice(0, sim.steps.length - 5000);

  sim.state = SIM_STATES.RUNNING;

  return { ok: true, step: step.index, totalSteps: sim.steps.length };
}

/**
 * Compare outcomes of two simulations.
 */
function compareSimulations(simIdA, simIdB) {
  const a = simulations.get(simIdA);
  const b = simulations.get(simIdB);
  if (!a || !b) return { ok: false, error: "simulation_not_found" };

  const stateA = a.currentState || {};
  const stateB = b.currentState || {};

  const allKeys = new Set([...Object.keys(stateA), ...Object.keys(stateB)]);
  const differences = [];
  const shared = [];

  for (const key of allKeys) {
    const inA = key in stateA;
    const inB = key in stateB;

    if (inA && inB) {
      if (JSON.stringify(stateA[key]) !== JSON.stringify(stateB[key])) {
        differences.push({ key, valueA: stateA[key], valueB: stateB[key] });
      } else {
        shared.push(key);
      }
    } else if (inA) {
      differences.push({ key, valueA: stateA[key], type: "only_in_a" });
    } else {
      differences.push({ key, valueB: stateB[key], type: "only_in_b" });
    }
  }

  return {
    ok: true,
    simA: { id: a.id, label: a.label, steps: a.steps.length, state: a.state },
    simB: { id: b.id, label: b.label, steps: b.steps.length, state: b.state },
    differences,
    sharedKeys: shared.length,
    divergenceRatio: allKeys.size > 0 ? differences.length / allKeys.size : 0,
  };
}

// === POLICY REHEARSAL ===

const REHEARSAL_STATES = Object.freeze({
  DRAFT: "draft",
  REHEARSING: "rehearsing",
  PASSED: "passed",
  FAILED: "failed",
  DEPLOYED: "deployed",
  REVERTED: "reverted",
});

const rehearsals = new LruMap(); // rehearsalId -> PolicyRehearsal

/**
 * Create a policy rehearsal (dry-run before deployment).
 */
function createRehearsal(policy, testScenarios) {
  const id = `reh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const rehearsal = {
    id,
    policy: {
      name: String(policy.name || "unnamed").slice(0, 200),
      rules: Array.isArray(policy.rules) ? policy.rules.map(r => String(r).slice(0, 500)) : [],
      description: String(policy.description || "").slice(0, 2000),
    },
    state: REHEARSAL_STATES.DRAFT,
    scenarios: Array.isArray(testScenarios) ? testScenarios.map(s => ({
      description: String(s.description || s).slice(0, 1000),
      input: s.input || {},
      expectedOutcome: s.expectedOutcome || null,
      actualOutcome: null,
      passed: null,
    })) : [],
    results: null,
    createdAt: new Date().toISOString(),
    deployedAt: null,
    revertedAt: null,
  };

  rehearsals.set(id, rehearsal);
  capMap(rehearsals, 5000);

  return { ok: true, rehearsal: sanitizeRehearsal(rehearsal) };
}

/**
 * Run a policy rehearsal against its test scenarios.
 */
function runRehearsal(rehearsalId) {
  const rehearsal = rehearsals.get(rehearsalId);
  if (!rehearsal) return { ok: false, error: "rehearsal_not_found" };

  rehearsal.state = REHEARSAL_STATES.REHEARSING;

  let passed = 0;
  let failed = 0;

  for (const scenario of rehearsal.scenarios) {
    // Simple evaluation: check if policy rules are compatible with scenario input
    const inputText = JSON.stringify(scenario.input).toLowerCase();
    let scenarioPassed = true;

    for (const rule of rehearsal.policy.rules) {
      const ruleLower = rule.toLowerCase();
      const prohibitionMatch = ruleLower.match(/\b(must not|shall not|cannot|prohibited)\b/);
      if (prohibitionMatch) {
        const actionWords = ruleLower.split(/must not|shall not|cannot|prohibited/)
          .pop()?.trim().split(/\s+/).filter(w => w.length > 3) || [];
        if (actionWords.some(w => inputText.includes(w))) {
          scenarioPassed = false;
          break;
        }
      }
    }

    scenario.actualOutcome = scenarioPassed ? "compliant" : "violation";
    scenario.passed = scenario.expectedOutcome
      ? scenario.actualOutcome === scenario.expectedOutcome
      : scenarioPassed;

    if (scenario.passed) passed++;
    else failed++;
  }

  rehearsal.results = { passed, failed, total: rehearsal.scenarios.length };
  rehearsal.state = failed === 0 ? REHEARSAL_STATES.PASSED : REHEARSAL_STATES.FAILED;

  return { ok: true, rehearsal: sanitizeRehearsal(rehearsal), results: rehearsal.results };
}

/**
 * Deploy a rehearsed policy (mark as deployed).
 */
function deployPolicy(rehearsalId) {
  const rehearsal = rehearsals.get(rehearsalId);
  if (!rehearsal) return { ok: false, error: "rehearsal_not_found" };
  if (rehearsal.state !== REHEARSAL_STATES.PASSED) {
    return { ok: false, error: "only_passed_rehearsals_can_deploy", currentState: rehearsal.state };
  }

  rehearsal.state = REHEARSAL_STATES.DEPLOYED;
  rehearsal.deployedAt = new Date().toISOString();
  return { ok: true, rehearsal: sanitizeRehearsal(rehearsal) };
}

/**
 * Revert a deployed policy.
 */
function revertPolicy(rehearsalId) {
  const rehearsal = rehearsals.get(rehearsalId);
  if (!rehearsal) return { ok: false, error: "rehearsal_not_found" };
  if (rehearsal.state !== REHEARSAL_STATES.DEPLOYED) {
    return { ok: false, error: "only_deployed_policies_can_revert" };
  }

  rehearsal.state = REHEARSAL_STATES.REVERTED;
  rehearsal.revertedAt = new Date().toISOString();
  return { ok: true, rehearsal: sanitizeRehearsal(rehearsal) };
}

// === EXECUTABLE SCIENCE PROGRAMS ===

const sciencePrograms = new LruMap(); // programId -> ExecutableScienceProgram

/**
 * Create a science program as an executable artifact.
 */
function createScienceProgram(name, hypothesis, method, expectedOutputs) {
  const id = `sci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const program = {
    id,
    name: String(name).slice(0, 200),
    hypothesis: String(hypothesis).slice(0, 2000),
    method: Array.isArray(method) ? method.map(s => String(s).slice(0, 500)) : [],
    expectedOutputs: Array.isArray(expectedOutputs) ? expectedOutputs.map(o => String(o).slice(0, 500)) : [],
    runs: [],
    status: "defined", // defined | running | completed
    createdAt: new Date().toISOString(),
  };

  sciencePrograms.set(id, program);
  capMap(sciencePrograms, 5000);

  return { ok: true, program };
}

/**
 * Record a run of a science program with actual results.
 */
function recordScienceRun(programId, actualOutputs, notes) {
  const program = sciencePrograms.get(programId);
  if (!program) return { ok: false, error: "program_not_found" };

  const run = {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    actualOutputs: Array.isArray(actualOutputs) ? actualOutputs.map(o => String(o).slice(0, 500)) : [],
    notes: String(notes || "").slice(0, 2000),
    matchesExpected: null,
    ranAt: new Date().toISOString(),
  };

  // Compare actual vs expected
  const expectedSet = new Set(program.expectedOutputs.map(o => o.toLowerCase()));
  const actualSet = new Set(run.actualOutputs.map(o => o.toLowerCase()));
  const matches = [...actualSet].filter(a => expectedSet.has(a)).length;
  run.matchesExpected = expectedSet.size > 0 ? matches / expectedSet.size : null;

  program.runs.push(run);
  if (program.runs.length > 100) program.runs.splice(0, program.runs.length - 100);
  program.status = "completed";

  return { ok: true, run };
}

// === TESTABLE GOVERNANCE ===

/**
 * Test a governance rule against a scenario.
 * Given scenario X, is outcome Y permissible under the rules?
 */
function testGovernanceRule(rules, scenario) {
  const results = [];

  for (const rule of (Array.isArray(rules) ? rules : [rules])) {
    const ruleText = String(rule.text || rule).toLowerCase();
    const scenarioText = String(scenario.description || scenario).toLowerCase();

    let verdict = "permissible"; // default: permissible unless a rule blocks it

    const prohibitionMatch = ruleText.match(/\b(must not|shall not|cannot|prohibited|forbidden)\b/);
    if (prohibitionMatch) {
      const actionWords = ruleText.split(/must not|shall not|cannot|prohibited|forbidden/)
        .pop()?.trim().split(/\s+/).filter(w => w.length > 3) || [];
      if (actionWords.some(w => scenarioText.includes(w))) {
        verdict = "prohibited";
      }
    }

    results.push({
      rule: String(rule.text || rule).slice(0, 200),
      verdict,
      scenario: String(scenario.description || scenario).slice(0, 200),
    });
  }

  const prohibited = results.filter(r => r.verdict === "prohibited");

  return {
    ok: true,
    permissible: prohibited.length === 0,
    results,
    prohibitionCount: prohibited.length,
  };
}

// === EDUCATION PIPELINE GENERATION ===

/**
 * Generate an education pipeline from knowledge gaps.
 */
function generateEducationPipeline(gaps, existingKnowledge) {
  if (!Array.isArray(gaps) || gaps.length === 0) {
    return { ok: true, pipeline: [], reason: "no_gaps_provided" };
  }

  const existingDomains = new Set(
    Array.isArray(existingKnowledge)
      ? existingKnowledge.map(k => k.domain || k)
      : []
  );

  const pipeline = gaps
    .sort((a, b) => (a.coverage || 0) - (b.coverage || 0))
    .map((gap, i) => ({
      stage: i + 1,
      domain: gap.domain,
      currentCoverage: gap.coverage || 0,
      prerequisites: findPrerequisites(gap.domain, existingDomains),
      learningObjectives: [
        `Understand foundational concepts in ${gap.domain}`,
        `Identify key open problems in ${gap.domain}`,
        `Map connections to related domains`,
      ],
      priority: gap.severity === "critical" ? "high" : gap.severity === "high" ? "medium" : "low",
    }));

  return {
    ok: true,
    pipeline,
    totalStages: pipeline.length,
    generatedAt: new Date().toISOString(),
  };
}

function findPrerequisites(domain, existingDomains) {
  // Simple prerequisite mapping based on domain name similarity
  const prereqs = [];
  for (const existing of existingDomains) {
    if (domain.includes(existing) || existing.includes(domain)) {
      prereqs.push(existing);
    }
  }
  return prereqs.slice(0, 5);
}

// === MISSING SCIENCES IDENTIFICATION ===

/**
 * Identify potential missing sciences — gaps between known domains
 * that suggest an undiscovered field.
 */
function identifyMissingSciences(domains, connections) {
  const domainSet = new Set(Array.isArray(domains) ? domains : []);
  const connectedPairs = new Set();

  for (const conn of (Array.isArray(connections) ? connections : [])) {
    connectedPairs.add(`${conn.from}::${conn.to}`);
    connectedPairs.add(`${conn.to}::${conn.from}`);
  }

  const missing = [];
  const domainList = [...domainSet];

  for (let i = 0; i < domainList.length; i++) {
    for (let j = i + 1; j < domainList.length; j++) {
      const pair = `${domainList[i]}::${domainList[j]}`;
      if (!connectedPairs.has(pair)) {
        missing.push({
          between: [domainList[i], domainList[j]],
          potentialName: `${domainList[i]}-${domainList[j]} bridging science`,
          reason: "No known connection between these domains",
          priority: "exploratory",
        });
      }
    }
  }

  // Limit to most interesting gaps (domains with fewest connections)
  const connectionCounts = {};
  for (const conn of (Array.isArray(connections) ? connections : [])) {
    connectionCounts[conn.from] = (connectionCounts[conn.from] || 0) + 1;
    connectionCounts[conn.to] = (connectionCounts[conn.to] || 0) + 1;
  }

  const prioritized = missing
    .map(m => ({
      ...m,
      isolationScore: m.between.reduce(
        (s, d) => s + (1 / ((connectionCounts[d] || 0) + 1)), 0
      ),
    }))
    .sort((a, b) => b.isolationScore - a.isolationScore)
    .slice(0, 50);

  return {
    ok: true,
    missingSciences: prioritized,
    totalGaps: missing.length,
    domainsAnalyzed: domainSet.size,
  };
}

// === HELPERS ===

function sanitizeSim(sim) {
  return {
    id: sim.id, label: sim.label, state: sim.state,
    steps: sim.steps.length, maxSteps: sim.parameters.maxSteps,
    stateKeys: Object.keys(sim.currentState).length,
    createdAt: sim.createdAt,
  };
}

function sanitizeRehearsal(r) {
  return {
    id: r.id, policyName: r.policy.name, state: r.state,
    scenarios: r.scenarios.length, results: r.results,
    createdAt: r.createdAt, deployedAt: r.deployedAt,
  };
}

function capMap(map, max) {
  if (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

function init({ register, STATE }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.civilizationSim = {
    stats: {
      simulations: 0, simSteps: 0, simComparisons: 0,
      rehearsals: 0, rehearsalRuns: 0, deploys: 0, reverts: 0,
      sciencePrograms: 0, scienceRuns: 0, governanceTests: 0,
      educationPipelines: 0, missingScienceScans: 0,
    },
  };

  register("loaf.civilization", "status", (ctx) => {
    const cs = ctx.state.__loaf.civilizationSim;
    return {
      ok: true,
      simulations: simulations.size,
      rehearsals: rehearsals.size,
      sciencePrograms: sciencePrograms.size,
      stats: cs.stats,
    };
  }, { public: true });

  // Simulation operations
  register("loaf.civilization", "create_simulation", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.simulations++;
    return createSimulation(input.label, input.initialConditions, input.parameters);
  }, { public: false });

  register("loaf.civilization", "step_simulation", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.simSteps++;
    return stepSimulation(String(input.simId || ""), input.event, input.stateTransform);
  }, { public: false });

  register("loaf.civilization", "compare_simulations", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.simComparisons++;
    return compareSimulations(String(input.simIdA || ""), String(input.simIdB || ""));
  }, { public: true });

  // Policy rehearsal operations
  register("loaf.civilization", "create_rehearsal", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.rehearsals++;
    return createRehearsal(input.policy || {}, input.scenarios);
  }, { public: false });

  register("loaf.civilization", "run_rehearsal", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.rehearsalRuns++;
    return runRehearsal(String(input.rehearsalId || ""));
  }, { public: false });

  register("loaf.civilization", "deploy_policy", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.deploys++;
    return deployPolicy(String(input.rehearsalId || ""));
  }, { public: false });

  register("loaf.civilization", "revert_policy", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.reverts++;
    return revertPolicy(String(input.rehearsalId || ""));
  }, { public: false });

  // Science programs
  register("loaf.civilization", "create_science_program", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.sciencePrograms++;
    return createScienceProgram(input.name, input.hypothesis, input.method, input.expectedOutputs);
  }, { public: false });

  register("loaf.civilization", "record_science_run", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.scienceRuns++;
    return recordScienceRun(String(input.programId || ""), input.actualOutputs, input.notes);
  }, { public: false });

  // Testable governance
  register("loaf.civilization", "test_governance", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.governanceTests++;
    return testGovernanceRule(input.rules, input.scenario || {});
  }, { public: true });

  // Education pipeline
  register("loaf.civilization", "generate_education_pipeline", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.educationPipelines++;
    return generateEducationPipeline(input.gaps || [], input.existingKnowledge);
  }, { public: true });

  // Missing sciences
  register("loaf.civilization", "identify_missing_sciences", (ctx, input = {}) => {
    const cs = ctx.state.__loaf.civilizationSim;
    cs.stats.missingScienceScans++;
    return identifyMissingSciences(input.domains, input.connections);
  }, { public: true });

  register("loaf.civilization", "list_simulations", (_ctx) => {
    return { ok: true, simulations: Array.from(simulations.values()).map(sanitizeSim) };
  }, { public: true });

  register("loaf.civilization", "list_rehearsals", (_ctx, input = {}) => {
    let list = Array.from(rehearsals.values());
    if (input.state) list = list.filter(r => r.state === input.state);
    return { ok: true, rehearsals: list.map(sanitizeRehearsal) };
  }, { public: true });
}

export {
  SIM_STATES,
  REHEARSAL_STATES,
  createSimulation,
  stepSimulation,
  compareSimulations,
  createRehearsal,
  runRehearsal,
  deployPolicy,
  revertPolicy,
  createScienceProgram,
  recordScienceRun,
  testGovernanceRule,
  generateEducationPipeline,
  identifyMissingSciences,
  init,
};
