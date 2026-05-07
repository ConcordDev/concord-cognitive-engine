/**
 * Scenario Engine — What-If Simulation System
 *
 * Run hypothetical scenarios across any domain:
 *   - Finance: "What if interest rates rise 2%?"
 *   - Health: "What if patient switches to medication X?"
 *   - Business: "What if we expand to market Y?"
 *   - Legal: "What if regulation Z passes?"
 *
 * Scenarios are DTU-native: every simulation produces a scenario DTU
 * with inputs, assumptions, projections, and confidence levels.
 *
 * The engine doesn't predict the future — it maps the decision space
 * and shows how variables interact under different assumptions.
 */

import { v4 as uuid } from "uuid";
import logger from "../logger.js";

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_VARIABLES = 20;
const MAX_STEPS = 50;
const MAX_SCENARIOS_PER_USER = 100;

/** Variable types supported by the engine */
const VARIABLE_TYPES = {
  NUMERIC:    "numeric",     // Numbers with ranges
  PERCENTAGE: "percentage",  // 0-100 or 0-1
  BOOLEAN:    "boolean",     // Yes/no
  ENUM:       "enum",        // Select from options
  CURRENCY:   "currency",    // Money amounts
  DATE:       "date",        // Timeline dates
};

/** Scenario states */
const SCENARIO_STATES = {
  DRAFT:     "draft",
  RUNNING:   "running",
  COMPLETED: "completed",
  FAILED:    "failed",
};

/** Confidence levels on projections */
const CONFIDENCE_LEVELS = {
  HIGH:     { label: "High",     range: [0.75, 1.0],  color: "#2ecc71" },
  MODERATE: { label: "Moderate", range: [0.50, 0.75], color: "#f39c12" },
  LOW:      { label: "Low",     range: [0.25, 0.50], color: "#e67e22" },
  SPECULATIVE: { label: "Speculative", range: [0.0, 0.25], color: "#e74c3c" },
};

// ── State ────────────────────────────────────────────────────────────────────

/** @type {Map<string, object>} scenarioId → scenario */
const _scenarios = new Map();

/** @type {Map<string, string[]>} userId → scenarioId[] */
const _userScenarios = new Map();

const _metrics = {
  totalScenarios: 0,
  totalRuns: 0,
  totalProjections: 0,
  byDomain: {},
};

// ── Scenario CRUD ────────────────────────────────────────────────────────────

/**
 * Create a new scenario.
 *
 * @param {object} opts
 * @param {string} opts.userId - Creator
 * @param {string} opts.title - Scenario title
 * @param {string} [opts.description] - What-if question
 * @param {string} [opts.domain] - Domain/lens (finance, health, legal, etc.)
 * @param {object[]} [opts.variables] - Input variables
 * @param {object} [opts.baseline] - Baseline values (current state)
 * @returns {object} The created scenario
 */
export function createScenario({ userId, title, description = "", domain = "general", variables = [], baseline = {} } = {}) {
  if (!userId) throw new Error("userId required");
  if (!title) throw new Error("Scenario title required");
  if (variables.length > MAX_VARIABLES) throw new Error(`Maximum ${MAX_VARIABLES} variables per scenario`);

  // Validate variables
  const validatedVars = variables.map(v => ({
    id: v.id || uuid().slice(0, 8),
    name: v.name,
    type: VARIABLE_TYPES[v.type?.toUpperCase()] || v.type || "numeric",
    description: v.description || "",
    baselineValue: v.baselineValue ?? baseline[v.name] ?? null,
    min: v.min,
    max: v.max,
    options: v.options || [],
    unit: v.unit || "",
  }));

  const scenario = {
    id: uuid(),
    userId,
    title,
    description,
    domain,
    variables: validatedVars,
    baseline,
    branches: [],     // Alternative futures
    projections: [],  // Calculated outcomes
    state: SCENARIO_STATES.DRAFT,
    assumptions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };

  _scenarios.set(scenario.id, scenario);

  if (!_userScenarios.has(userId)) _userScenarios.set(userId, []);
  _userScenarios.get(userId).push(scenario.id);

  // Enforce per-user limit
  const userIds = _userScenarios.get(userId);
  if (userIds.length > MAX_SCENARIOS_PER_USER) {
    const oldest = userIds.shift();
    _scenarios.delete(oldest);
  }

  _metrics.totalScenarios++;
  _metrics.byDomain[domain] = (_metrics.byDomain[domain] || 0) + 1;

  return _serializeScenario(scenario);
}

/**
 * Get a scenario by ID.
 */
export function getScenario(scenarioId) {
  const s = _scenarios.get(scenarioId);
  return s ? _serializeScenario(s) : null;
}

/**
 * List scenarios for a user.
 */
export function listUserScenarios(userId, { domain = null, state = null, limit = 20 } = {}) {
  const ids = _userScenarios.get(userId) || [];
  let results = ids.map(id => _scenarios.get(id)).filter(Boolean);

  if (domain) results = results.filter(s => s.domain === domain);
  if (state) results = results.filter(s => s.state === state);

  return results
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, limit)
    .map(_serializeScenario);
}

// ── Branching ────────────────────────────────────────────────────────────────

/**
 * Add a "what-if" branch to a scenario — a set of variable overrides.
 *
 * @param {string} scenarioId
 * @param {object} branch
 * @param {string} branch.name - Branch name ("Optimistic", "Pessimistic", etc.)
 * @param {object} branch.overrides - Variable overrides { varId: newValue }
 * @param {string[]} [branch.assumptions] - Stated assumptions
 */
export function addBranch(scenarioId, { name, overrides = {}, assumptions = [] } = {}) {
  const scenario = _scenarios.get(scenarioId);
  if (!scenario) throw new Error("Scenario not found");

  const branch = {
    id: uuid().slice(0, 8),
    name: name || `Branch ${scenario.branches.length + 1}`,
    overrides,
    assumptions,
    projections: [],
    createdAt: new Date().toISOString(),
  };

  scenario.branches.push(branch);
  scenario.updatedAt = new Date().toISOString();

  return { ok: true, branchId: branch.id, branchCount: scenario.branches.length };
}

/**
 * Remove a branch.
 */
export function removeBranch(scenarioId, branchId) {
  const scenario = _scenarios.get(scenarioId);
  if (!scenario) throw new Error("Scenario not found");

  const idx = scenario.branches.findIndex(b => b.id === branchId);
  if (idx === -1) throw new Error("Branch not found");

  scenario.branches.splice(idx, 1);
  scenario.updatedAt = new Date().toISOString();

  return { ok: true };
}

// ── Simulation ───────────────────────────────────────────────────────────────

/**
 * Run the scenario simulation — compute projections for all branches.
 *
 * The engine uses a step-based propagation model:
 * 1. Start from baseline values
 * 2. Apply branch overrides
 * 3. Propagate effects through variable relationships
 * 4. Compute delta from baseline
 * 5. Assign confidence levels
 *
 * @param {string} scenarioId
 * @param {object} [opts]
 * @param {number} [opts.steps] - Number of time steps to project
 * @param {object} [opts.relationships] - Variable relationship map
 */
export function runScenario(scenarioId, { steps = 10, relationships = {} } = {}) {
  const scenario = _scenarios.get(scenarioId);
  if (!scenario) throw new Error("Scenario not found");
  if (scenario.branches.length === 0) throw new Error("Add at least one branch before running");

  scenario.state = SCENARIO_STATES.RUNNING;
  _metrics.totalRuns++;

  try {
    // Compute baseline state
    const baseState = {};
    for (const v of scenario.variables) {
      baseState[v.id] = v.baselineValue ?? 0;
    }

    // Run each branch
    for (const branch of scenario.branches) {
      const branchState = { ...baseState, ...branch.overrides };
      const timeline = [{ step: 0, values: { ...branchState } }];

      // Propagate through steps
      for (let step = 1; step <= Math.min(steps, MAX_STEPS); step++) {
        const prevValues = timeline[step - 1].values;
        const nextValues = { ...prevValues };

        // Apply relationships (simple linear propagation)
        for (const [targetVar, rel] of Object.entries(relationships)) {
          if (!nextValues.hasOwnProperty(targetVar)) continue;

          if (rel.type === "proportional" && rel.source) {
            const sourceChange = (nextValues[rel.source] - baseState[rel.source]) / (baseState[rel.source] || 1);
            nextValues[targetVar] = baseState[targetVar] * (1 + sourceChange * (rel.factor || 0.5));
          } else if (rel.type === "inverse" && rel.source) {
            const sourceChange = (nextValues[rel.source] - baseState[rel.source]) / (baseState[rel.source] || 1);
            nextValues[targetVar] = baseState[targetVar] * (1 - sourceChange * (rel.factor || 0.5));
          } else if (rel.type === "threshold" && rel.source) {
            if (nextValues[rel.source] > (rel.threshold || 0)) {
              nextValues[targetVar] = rel.aboveValue ?? nextValues[targetVar];
            }
          } else if (rel.type === "decay") {
            nextValues[targetVar] *= (rel.rate || 0.95);
          } else if (rel.type === "growth") {
            nextValues[targetVar] *= (rel.rate || 1.05);
          }
        }

        timeline.push({ step, values: { ...nextValues } });
      }

      // Compute projections (final step deltas from baseline)
      const finalValues = timeline[timeline.length - 1].values;
      branch.projections = scenario.variables.map(v => {
        const baseline = baseState[v.id] || 0;
        const projected = finalValues[v.id] || 0;
        const delta = projected - baseline;
        const deltaPercent = baseline !== 0 ? (delta / baseline) * 100 : 0;

        // Confidence decreases with larger deltas and more steps
        const magnitude = Math.abs(deltaPercent) / 100;
        const stepPenalty = Math.min(steps / MAX_STEPS, 0.5);
        const confidence = Math.max(0, 1 - magnitude * 0.5 - stepPenalty * 0.3);
        const confidenceLevel = _getConfidenceLevel(confidence);

        return {
          variableId: v.id,
          variableName: v.name,
          baseline,
          projected: Math.round(projected * 100) / 100,
          delta: Math.round(delta * 100) / 100,
          deltaPercent: Math.round(deltaPercent * 10) / 10,
          confidence: Math.round(confidence * 100) / 100,
          confidenceLevel: confidenceLevel.label,
          unit: v.unit,
        };
      });

      branch.timeline = timeline;
      _metrics.totalProjections += branch.projections.length;
    }

    // Compute scenario-level summary
    scenario.projections = _computeSummary(scenario);
    scenario.state = SCENARIO_STATES.COMPLETED;
    scenario.completedAt = new Date().toISOString();
    scenario.updatedAt = new Date().toISOString();

    logger.info("scenario-engine", `Scenario "${scenario.title}" completed: ${scenario.branches.length} branches, ${steps} steps`);

    return _serializeScenario(scenario);

  } catch (err) {
    scenario.state = SCENARIO_STATES.FAILED;
    scenario.updatedAt = new Date().toISOString();
    logger.error("scenario-engine", `Scenario failed: ${err.message}`);
    throw err;
  }
}

/**
 * Compare two branches side-by-side.
 */
export function compareBranches(scenarioId, branchIdA, branchIdB) {
  const scenario = _scenarios.get(scenarioId);
  if (!scenario) throw new Error("Scenario not found");

  const branchA = scenario.branches.find(b => b.id === branchIdA);
  const branchB = scenario.branches.find(b => b.id === branchIdB);
  if (!branchA || !branchB) throw new Error("Branch not found");

  if (!branchA.projections?.length || !branchB.projections?.length) {
    throw new Error("Run the scenario first");
  }

  const comparison = scenario.variables.map(v => {
    const projA = branchA.projections.find(p => p.variableId === v.id);
    const projB = branchB.projections.find(p => p.variableId === v.id);

    return {
      variable: v.name,
      unit: v.unit,
      baseline: projA?.baseline ?? 0,
      branchA: { name: branchA.name, projected: projA?.projected, delta: projA?.delta, confidence: projA?.confidence },
      branchB: { name: branchB.name, projected: projB?.projected, delta: projB?.delta, confidence: projB?.confidence },
      divergence: Math.abs((projA?.projected || 0) - (projB?.projected || 0)),
    };
  });

  return { scenarioId, branchA: branchA.name, branchB: branchB.name, comparison };
}

/**
 * Get engine metrics.
 */
export function getScenarioMetrics() {
  return {
    ..._metrics,
    activeScenarios: _scenarios.size,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _getConfidenceLevel(confidence) {
  for (const level of Object.values(CONFIDENCE_LEVELS)) {
    if (confidence >= level.range[0] && confidence <= level.range[1]) return level;
  }
  return CONFIDENCE_LEVELS.SPECULATIVE;
}

function _computeSummary(scenario) {
  // Find variables with largest divergence across branches
  const divergences = {};

  for (const branch of scenario.branches) {
    for (const proj of (branch.projections || [])) {
      if (!divergences[proj.variableId]) {
        divergences[proj.variableId] = { name: proj.variableName, min: proj.projected, max: proj.projected, unit: proj.unit };
      }
      divergences[proj.variableId].min = Math.min(divergences[proj.variableId].min, proj.projected);
      divergences[proj.variableId].max = Math.max(divergences[proj.variableId].max, proj.projected);
    }
  }

  return Object.values(divergences)
    .map(d => ({ ...d, range: d.max - d.min }))
    .sort((a, b) => b.range - a.range);
}

function _serializeScenario(s) {
  return {
    id: s.id,
    userId: s.userId,
    title: s.title,
    description: s.description,
    domain: s.domain,
    variables: s.variables,
    baseline: s.baseline,
    branches: s.branches.map(b => ({
      id: b.id,
      name: b.name,
      overrides: b.overrides,
      assumptions: b.assumptions,
      projections: b.projections || [],
    })),
    projections: s.projections || [],
    state: s.state,
    assumptions: s.assumptions,
    createdAt: s.createdAt,
    completedAt: s.completedAt,
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { VARIABLE_TYPES, SCENARIO_STATES, CONFIDENCE_LEVELS };

export default {
  createScenario,
  getScenario,
  listUserScenarios,
  addBranch,
  removeBranch,
  runScenario,
  compareBranches,
  getScenarioMetrics,
};
