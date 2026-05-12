/**
 * Cross-Lens Intelligence Pipeline Orchestrator
 *
 * Connects existing pipelines (autogen, promotion, verification)
 * into multi-lens automated workflows:
 *
 *   research → analysis → report → marketplace listing
 *   observation → hypothesis → experiment → paper
 *   query → deep-dive → synthesis → teaching material
 *
 * Each pipeline stage runs in a specific lens, produces DTUs,
 * and feeds them into the next stage. The orchestrator manages
 * the flow, tracks progress, and handles failures.
 *
 * Builds on: autogen-pipeline.js, promotion-pipeline.js, verification-pipeline.js
 */

import { v4 as uuid } from "uuid";
import logger from "../logger.js";
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Pipeline Templates ───────────────────────────────────────────────────────

const PIPELINE_TEMPLATES = {
  research_to_market: {
    id: "research_to_market",
    name: "Research → Market",
    description: "Research a topic, analyze findings, generate report, list on marketplace",
    stages: [
      { id: "research",  lens: "research",    action: "deep_research",    outputType: "research_notes" },
      { id: "analyze",   lens: "graph",       action: "analyze_patterns", outputType: "analysis_report", inputFrom: "research" },
      { id: "report",    lens: "studio",      action: "generate_report",  outputType: "formatted_report", inputFrom: "analyze" },
      { id: "list",      lens: "marketplace", action: "create_listing",   outputType: "marketplace_listing", inputFrom: "report" },
    ],
  },

  observation_to_paper: {
    id: "observation_to_paper",
    name: "Observation → Paper",
    description: "From raw observation to structured academic paper",
    stages: [
      { id: "observe",    lens: "research",   action: "collect_data",       outputType: "raw_observations" },
      { id: "hypothesis", lens: "hypothesis",  action: "generate_hypothesis", outputType: "hypothesis_dtu", inputFrom: "observe" },
      { id: "test",       lens: "lab",         action: "run_experiment",     outputType: "experiment_results", inputFrom: "hypothesis" },
      { id: "write",      lens: "paper",       action: "draft_paper",        outputType: "academic_paper", inputFrom: "test" },
    ],
  },

  query_to_course: {
    id: "query_to_course",
    name: "Query → Course Material",
    description: "From a question to structured teaching material",
    stages: [
      { id: "query",     lens: "chat",       action: "deep_query",         outputType: "query_response" },
      { id: "dive",      lens: "research",   action: "deep_research",      outputType: "comprehensive_notes", inputFrom: "query" },
      { id: "synth",     lens: "reasoning",  action: "synthesize",          outputType: "knowledge_synthesis", inputFrom: "dive" },
      { id: "teach",     lens: "education",  action: "create_lesson",       outputType: "course_module", inputFrom: "synth" },
    ],
  },

  audit_to_report: {
    id: "audit_to_report",
    name: "Audit → Report",
    description: "Audit data, verify claims, produce compliance report",
    stages: [
      { id: "collect",  lens: "ingest",     action: "gather_data",       outputType: "raw_data" },
      { id: "verify",   lens: "ethics",     action: "verify_claims",     outputType: "verification_results", inputFrom: "collect" },
      { id: "analyze",  lens: "finance",    action: "compliance_check",  outputType: "compliance_analysis", inputFrom: "verify" },
      { id: "report",   lens: "docs",       action: "generate_report",   outputType: "audit_report", inputFrom: "analyze" },
    ],
  },

  idea_to_product: {
    id: "idea_to_product",
    name: "Idea → Product",
    description: "From concept to designed, costed, market-ready product spec",
    stages: [
      { id: "ideate",    lens: "studio",      action: "brainstorm",        outputType: "concept_doc" },
      { id: "design",    lens: "engineering",  action: "technical_design",  outputType: "design_spec", inputFrom: "ideate" },
      { id: "cost",      lens: "finance",      action: "cost_analysis",     outputType: "cost_breakdown", inputFrom: "design" },
      { id: "validate",  lens: "market",       action: "market_validation", outputType: "validation_report", inputFrom: "cost" },
    ],
  },
};

// ── Pipeline States ──────────────────────────────────────────────────────────

const PIPELINE_STATES = {
  PENDING:   "pending",
  RUNNING:   "running",
  PAUSED:    "paused",
  COMPLETED: "completed",
  FAILED:    "failed",
};

const STAGE_STATES = {
  PENDING:   "pending",
  RUNNING:   "running",
  COMPLETED: "completed",
  FAILED:    "failed",
  SKIPPED:   "skipped",
};

// ── State ────────────────────────────────────────────────────────────────────

/** @type {Map<string, object>} pipelineId → pipeline run */
const _pipelines = new LruMap();

/** @type {Map<string, string[]>} userId → pipelineId[] */
const _userPipelines = new LruMap();

const _metrics = {
  totalPipelines: 0,
  totalStages: 0,
  completedPipelines: 0,
  failedPipelines: 0,
  byTemplate: {},
  dtusProduced: 0,
};

// ── Pipeline Execution ───────────────────────────────────────────────────────

/**
 * Create and start a cross-lens pipeline.
 *
 * @param {object} opts
 * @param {string} opts.userId - Who initiated it
 * @param {string} opts.templateId - Pipeline template ID
 * @param {object} [opts.input] - Initial input data
 * @param {string} [opts.title] - Custom title
 * @param {object} [opts.config] - Stage-level config overrides
 * @returns {object} Pipeline run
 */
export function createPipeline({ userId, templateId, input = {}, title = null, config = {} } = {}) {
  const template = PIPELINE_TEMPLATES[templateId];
  if (!template) throw new Error(`Unknown pipeline template: ${templateId}`);
  if (!userId) throw new Error("userId required");

  const pipeline = {
    id: uuid(),
    userId,
    templateId,
    templateName: template.name,
    title: title || `${template.name} — ${new Date().toLocaleDateString()}`,
    state: PIPELINE_STATES.PENDING,
    stages: template.stages.map((s, idx) => ({
      ...s,
      stageIndex: idx,
      state: STAGE_STATES.PENDING,
      input: idx === 0 ? input : null,
      output: null,
      outputDtuId: null,
      startedAt: null,
      completedAt: null,
      error: null,
      config: config[s.id] || {},
    })),
    currentStage: 0,
    dtusProduced: [],
    input,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };

  _pipelines.set(pipeline.id, pipeline);

  if (!_userPipelines.has(userId)) _userPipelines.set(userId, []);
  _userPipelines.get(userId).push(pipeline.id);

  _metrics.totalPipelines++;
  _metrics.byTemplate[templateId] = (_metrics.byTemplate[templateId] || 0) + 1;

  logger.info("cross-lens-pipeline", `Pipeline created: "${pipeline.title}" (${templateId}) by ${userId}`);

  return _serializePipeline(pipeline);
}

/**
 * Advance the pipeline to the next stage.
 * Called by the system or manually after each stage completes.
 *
 * @param {string} pipelineId
 * @param {object} [stageOutput] - Output from the current stage
 * @returns {object} Updated pipeline state
 */
export function advancePipeline(pipelineId, stageOutput = null) {
  const pipeline = _pipelines.get(pipelineId);
  if (!pipeline) throw new Error("Pipeline not found");

  const currentIdx = pipeline.currentStage;
  const currentStage = pipeline.stages[currentIdx];

  if (!currentStage) throw new Error("No current stage");

  // Complete current stage
  if (stageOutput) {
    currentStage.output = stageOutput;
    currentStage.state = STAGE_STATES.COMPLETED;
    currentStage.completedAt = new Date().toISOString();

    // Track DTU if produced
    if (stageOutput.dtuId) {
      currentStage.outputDtuId = stageOutput.dtuId;
      pipeline.dtusProduced.push(stageOutput.dtuId);
      _metrics.dtusProduced++;
    }

    _metrics.totalStages++;
  }

  // Move to next stage
  const nextIdx = currentIdx + 1;
  if (nextIdx >= pipeline.stages.length) {
    // Pipeline complete
    pipeline.state = PIPELINE_STATES.COMPLETED;
    pipeline.completedAt = new Date().toISOString();
    _metrics.completedPipelines++;

    logger.info("cross-lens-pipeline", `Pipeline completed: "${pipeline.title}" — ${pipeline.dtusProduced.length} DTUs produced`);
  } else {
    // Start next stage
    pipeline.currentStage = nextIdx;
    const nextStage = pipeline.stages[nextIdx];
    nextStage.state = STAGE_STATES.RUNNING;
    nextStage.startedAt = new Date().toISOString();

    // Feed output from previous stage as input
    if (nextStage.inputFrom) {
      const sourceStage = pipeline.stages.find(s => s.id === nextStage.inputFrom);
      if (sourceStage?.output) {
        nextStage.input = sourceStage.output;
      }
    }

    pipeline.state = PIPELINE_STATES.RUNNING;
  }

  pipeline.updatedAt = new Date().toISOString();
  return _serializePipeline(pipeline);
}

/**
 * Start the pipeline (begin first stage).
 */
export function startPipeline(pipelineId) {
  const pipeline = _pipelines.get(pipelineId);
  if (!pipeline) throw new Error("Pipeline not found");

  pipeline.state = PIPELINE_STATES.RUNNING;
  pipeline.stages[0].state = STAGE_STATES.RUNNING;
  pipeline.stages[0].startedAt = new Date().toISOString();
  pipeline.updatedAt = new Date().toISOString();

  return _serializePipeline(pipeline);
}

/**
 * Fail a pipeline stage.
 */
export function failStage(pipelineId, error) {
  const pipeline = _pipelines.get(pipelineId);
  if (!pipeline) throw new Error("Pipeline not found");

  const stage = pipeline.stages[pipeline.currentStage];
  stage.state = STAGE_STATES.FAILED;
  stage.error = String(error).slice(0, 500);
  stage.completedAt = new Date().toISOString();

  pipeline.state = PIPELINE_STATES.FAILED;
  pipeline.updatedAt = new Date().toISOString();
  _metrics.failedPipelines++;

  logger.warn("cross-lens-pipeline", `Pipeline failed at stage "${stage.id}": ${error}`);

  return _serializePipeline(pipeline);
}

/**
 * Pause a running pipeline.
 */
export function pausePipeline(pipelineId) {
  const pipeline = _pipelines.get(pipelineId);
  if (!pipeline) throw new Error("Pipeline not found");
  pipeline.state = PIPELINE_STATES.PAUSED;
  pipeline.updatedAt = new Date().toISOString();
  return _serializePipeline(pipeline);
}

/**
 * Resume a paused pipeline.
 */
export function resumePipeline(pipelineId) {
  const pipeline = _pipelines.get(pipelineId);
  if (!pipeline) throw new Error("Pipeline not found");
  if (pipeline.state !== PIPELINE_STATES.PAUSED) throw new Error("Pipeline is not paused");
  pipeline.state = PIPELINE_STATES.RUNNING;
  pipeline.updatedAt = new Date().toISOString();
  return _serializePipeline(pipeline);
}

/**
 * Get a pipeline by ID.
 */
export function getPipeline(pipelineId) {
  const p = _pipelines.get(pipelineId);
  return p ? _serializePipeline(p) : null;
}

/**
 * List pipelines for a user.
 */
export function listUserPipelines(userId, { state = null, templateId = null, limit = 20 } = {}) {
  const ids = _userPipelines.get(userId) || [];
  let results = ids.map(id => _pipelines.get(id)).filter(Boolean);

  if (state) results = results.filter(p => p.state === state);
  if (templateId) results = results.filter(p => p.templateId === templateId);

  return results
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, limit)
    .map(_serializePipeline);
}

/**
 * List available pipeline templates.
 */
export function listTemplates() {
  return Object.values(PIPELINE_TEMPLATES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    stageCount: t.stages.length,
    lenses: t.stages.map(s => s.lens),
  }));
}

/**
 * Get metrics.
 */
export function getPipelineMetrics() {
  return { ..._metrics, activePipelines: _pipelines.size };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _serializePipeline(p) {
  return {
    id: p.id,
    userId: p.userId,
    templateId: p.templateId,
    templateName: p.templateName,
    title: p.title,
    state: p.state,
    currentStage: p.currentStage,
    stages: p.stages.map(s => ({
      id: s.id,
      lens: s.lens,
      action: s.action,
      outputType: s.outputType,
      state: s.state,
      outputDtuId: s.outputDtuId,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      error: s.error,
    })),
    dtusProduced: p.dtusProduced,
    createdAt: p.createdAt,
    completedAt: p.completedAt,
    progress: `${p.stages.filter(s => s.state === "completed").length}/${p.stages.length}`,
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { PIPELINE_TEMPLATES, PIPELINE_STATES, STAGE_STATES };

export default {
  createPipeline,
  startPipeline,
  advancePipeline,
  failStage,
  pausePipeline,
  resumePipeline,
  getPipeline,
  listUserPipelines,
  listTemplates,
  getPipelineMetrics,
};
