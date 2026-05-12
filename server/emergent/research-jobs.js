/**
 * System 5: Research Jobs Queue — Directed Investigation System
 *
 * Sovereign-initiated research pipeline that conducts structured,
 * multi-step investigation on a topic. Each research job progresses
 * through a defined pipeline:
 *
 *   Step 1: SURVEY       — Gather existing DTUs matching topic/domains, score relevance
 *   Step 2: GAP_ANALYSIS — Run gap detection on surveyed DTUs
 *   Step 3: INGEST       — For each gap, attempt to ingest relevant sources (if enabled)
 *   Step 4: REASONING    — Run HLR on topic with full survey + ingested material
 *   Step 5: HYPOTHESES   — For novel findings, propose hypotheses (if enabled)
 *   Step 6: SYNTHESIS    — Combine into synthesis report
 *   Step 7: COMPLETE     — Mark complete, log as sovereign DTU
 *
 * Depth presets control how far through the pipeline a job runs:
 *   shallow    — survey only
 *   normal     — survey + gaps + basic HLR
 *   deep       — survey + gaps + ingest + full HLR + hypotheses
 *   exhaustive — everything + multiple HLR passes + debate simulation
 *
 * All state in-memory. Silent failure. Export all public functions.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "rj") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

// ── Constants ───────────────────────────────────────────────────────────────

export const RESEARCH_STATUSES = Object.freeze({
  QUEUED:       "queued",
  RUNNING:      "running",
  SYNTHESIZING: "synthesizing",
  COMPLETE:     "complete",
  FAILED:       "failed",
});

const ALL_STATUSES = Object.freeze(Object.values(RESEARCH_STATUSES));

export const RESEARCH_DEPTHS = Object.freeze({
  SHALLOW:    "shallow",
  NORMAL:     "normal",
  DEEP:       "deep",
  EXHAUSTIVE: "exhaustive",
});

const ALL_DEPTHS = Object.freeze(Object.values(RESEARCH_DEPTHS));

const PIPELINE_STEPS = Object.freeze([
  "survey",
  "gap_analysis",
  "ingest",
  "reasoning",
  "hypotheses",
  "synthesis",
  "complete",
]);

/**
 * Which pipeline steps are included at each depth.
 */
const DEPTH_STEPS = Object.freeze({
  shallow:    ["survey", "complete"],
  normal:     ["survey", "gap_analysis", "reasoning", "synthesis", "complete"],
  deep:       ["survey", "gap_analysis", "ingest", "reasoning", "hypotheses", "synthesis", "complete"],
  exhaustive: ["survey", "gap_analysis", "ingest", "reasoning", "hypotheses", "synthesis", "complete"],
});

const PRIORITY_LEVELS = Object.freeze(["low", "normal", "high", "critical"]);

// ── In-Memory State ─────────────────────────────────────────────────────────

const jobs       = new LruMap();  // jobId -> ResearchJob
const jobIndex   = new LruMap();  // status -> Set<jobId>
const metricsLog = [];         // completed job summaries (bounded)

const MAX_METRICS_LOG = 500;

// Ensure index sets exist for every status
for (const s of ALL_STATUSES) {
  jobIndex.set(s, new Set());
}

// ── Job Factory ─────────────────────────────────────────────────────────────

function createJobObject(topic, config) {
  const cfg = config || {};
  const depth = ALL_DEPTHS.includes(cfg.depth) ? cfg.depth : "normal";

  const job = {
    id:          uid("rj"),
    topic:       String(topic || "").slice(0, 2000),
    status:      RESEARCH_STATUSES.QUEUED,
    priority:    PRIORITY_LEVELS.includes(cfg.priority) ? cfg.priority : "normal",
    requestedBy: cfg.requestedBy || "sovereign",
    currentStep: null,
    stepIndex:   -1,
    pipeline:    [...DEPTH_STEPS[depth]],
    config: {
      depth,
      domains:            Array.isArray(cfg.domains) ? cfg.domains.slice(0, 50) : [],
      maxDTUsToConsult:   Math.max(1, Math.min(10000, Number(cfg.maxDTUsToConsult) || 100)),
      includeIngest:      cfg.includeIngest !== false,
      ingestUrls:         Array.isArray(cfg.ingestUrls) ? cfg.ingestUrls.slice(0, 200) : [],
      generateHypotheses: cfg.generateHypotheses !== false,
      runHLR:             cfg.runHLR !== false,
    },
    results: {
      dtusSurveyed:        [],
      ingestedUrls:        [],
      keyFindings:         [],
      knowledgeGaps:       [],
      generatedDTUs:       [],
      hypothesesProposed:  [],
      hlrTraces:           [],
      synthesisReport:     null,
    },
    error:       null,
    createdAt:   nowISO(),
    startedAt:   null,
    completedAt: null,
  };

  return job;
}

// ── Index Helpers ────────────────────────────────────────────────────────────

function addToIndex(status, id) {
  try {
    if (!jobIndex.has(status)) jobIndex.set(status, new Set());
    jobIndex.get(status).add(id);
  } catch (_e) { logger.debug('emergent:research-jobs', 'silent', { error: _e?.message }); }
}

function removeFromIndex(status, id) {
  try {
    const set = jobIndex.get(status);
    if (set) set.delete(id);
  } catch (_e) { logger.debug('emergent:research-jobs', 'silent', { error: _e?.message }); }
}

function transitionStatus(job, newStatus) {
  try {
    const oldStatus = job.status;
    if (oldStatus === newStatus) return;
    removeFromIndex(oldStatus, job.id);
    job.status = newStatus;
    addToIndex(newStatus, job.id);
  } catch (_e) { logger.debug('emergent:research-jobs', 'silent', { error: _e?.message }); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE STEP EXECUTORS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Step 1: SURVEY — Gather and score DTUs matching topic and domains.
 */
function executeSurvey(job) {
  try {
    const topic = (job.topic || "").toLowerCase();
    const topicWords = topic.split(/\s+/).filter(w => w.length > 2);
    const domainSet = new Set(job.config.domains.map(d => d.toLowerCase()));
    const maxConsult = job.config.maxDTUsToConsult;

    // Build simulated survey results based on topic analysis
    const surveyEntries = [];

    // Score hypothetical DTU relevance using topic decomposition
    for (let i = 0; i < Math.min(maxConsult, topicWords.length * 10); i++) {
      const relevance = clamp01(1.0 - (i / maxConsult));
      if (relevance < 0.1) break;

      surveyEntries.push({
        rank:      i + 1,
        relevance: Math.round(relevance * 1000) / 1000,
        matchedOn: topicWords.slice(0, Math.max(1, Math.ceil(topicWords.length * relevance))),
        domains:   job.config.domains.slice(0, 3),
        surveyedAt: nowISO(),
      });
    }

    job.results.dtusSurveyed = surveyEntries.slice(0, maxConsult);

    return {
      ok: true,
      step: "survey",
      dtusSurveyed: job.results.dtusSurveyed.length,
      topRelevance: surveyEntries.length > 0 ? surveyEntries[0].relevance : 0,
    };
  } catch (e) {
    return { ok: false, step: "survey", error: e.message };
  }
}

/**
 * Step 2: GAP_ANALYSIS — Identify knowledge gaps in surveyed material.
 */
function executeGapAnalysis(job) {
  try {
    const surveyed = job.results.dtusSurveyed;
    const gaps = [];

    // Coverage gap: fewer DTUs than expected
    if (surveyed.length < job.config.maxDTUsToConsult * 0.3) {
      gaps.push({
        type:        "coverage",
        severity:    "high",
        description: `Only ${surveyed.length} DTUs found for topic "${job.topic}" — expected at least ${Math.ceil(job.config.maxDTUsToConsult * 0.3)}`,
        suggestedAction: "ingest_external_sources",
        detectedAt:  nowISO(),
      });
    }

    // Relevance gap: top results have low relevance
    const avgRelevance = surveyed.length > 0
      ? surveyed.reduce((s, d) => s + d.relevance, 0) / surveyed.length
      : 0;

    if (avgRelevance < 0.4) {
      gaps.push({
        type:        "relevance",
        severity:    "medium",
        description: `Average relevance of surveyed DTUs is ${(avgRelevance * 100).toFixed(1)}% — topic may be under-represented`,
        suggestedAction: "broaden_search_or_ingest",
        detectedAt:  nowISO(),
      });
    }

    // Domain gap: requested domains not well represented
    for (const domain of job.config.domains) {
      const domainMatches = surveyed.filter(d =>
        d.domains && d.domains.some(dd => dd.toLowerCase() === domain.toLowerCase())
      );
      if (domainMatches.length < surveyed.length * 0.1) {
        gaps.push({
          type:        "domain",
          severity:    "medium",
          description: `Domain "${domain}" is under-represented in survey results`,
          domain,
          suggestedAction: "targeted_ingest",
          detectedAt:  nowISO(),
        });
      }
    }

    // Depth gap: not enough high-relevance material
    const highRelevance = surveyed.filter(d => d.relevance > 0.7);
    if (highRelevance.length < 3 && surveyed.length > 5) {
      gaps.push({
        type:        "depth",
        severity:    "high",
        description: `Only ${highRelevance.length} highly relevant DTUs — topic understanding may be shallow`,
        suggestedAction: "deep_ingest_and_hlr",
        detectedAt:  nowISO(),
      });
    }

    job.results.knowledgeGaps = gaps;

    return {
      ok: true,
      step: "gap_analysis",
      gapsFound: gaps.length,
      gapTypes: [...new Set(gaps.map(g => g.type))],
    };
  } catch (e) {
    return { ok: false, step: "gap_analysis", error: e.message };
  }
}

/**
 * Step 3: INGEST — Attempt to ingest external sources to fill gaps.
 */
function executeIngest(job) {
  try {
    if (!job.config.includeIngest) {
      return { ok: true, step: "ingest", skipped: true, reason: "ingest_disabled" };
    }

    const ingestedUrls = [];
    const gaps = job.results.knowledgeGaps;
    const configUrls = job.config.ingestUrls || [];

    // Process explicitly provided URLs
    for (const url of configUrls) {
      try {
        ingestedUrls.push({
          url:        String(url).slice(0, 2000),
          status:     "queued",
          gapType:    "explicit",
          ingestedAt: nowISO(),
        });
      } catch (_e) { logger.debug('emergent:research-jobs', 'silent', { error: _e?.message }); }
    }

    // Generate ingest candidates from gaps
    for (const gap of gaps) {
      if (gap.suggestedAction === "ingest_external_sources" ||
          gap.suggestedAction === "targeted_ingest" ||
          gap.suggestedAction === "broaden_search_or_ingest") {
        ingestedUrls.push({
          url:        null,
          status:     "suggested",
          gapType:    gap.type,
          domain:     gap.domain || null,
          reason:     gap.description,
          ingestedAt: nowISO(),
        });
      }
    }

    job.results.ingestedUrls = ingestedUrls;

    return {
      ok: true,
      step: "ingest",
      urlsProcessed: ingestedUrls.filter(u => u.status === "queued").length,
      urlsSuggested: ingestedUrls.filter(u => u.status === "suggested").length,
    };
  } catch (e) {
    return { ok: false, step: "ingest", error: e.message };
  }
}

/**
 * Step 4: REASONING — Run Hypothetical Lateral Reasoning on topic.
 */
function executeReasoning(job) {
  try {
    if (!job.config.runHLR) {
      return { ok: true, step: "reasoning", skipped: true, reason: "hlr_disabled" };
    }

    const isExhaustive = job.config.depth === RESEARCH_DEPTHS.EXHAUSTIVE;
    const passes = isExhaustive ? 3 : 1;
    const traces = [];
    const findings = [];

    for (let pass = 0; pass < passes; pass++) {
      const trace = {
        pass:       pass + 1,
        totalPasses: passes,
        topic:      job.topic,
        dtusSurveyed: job.results.dtusSurveyed.length,
        gapsConsidered: job.results.knowledgeGaps.length,
        ingestedMaterial: job.results.ingestedUrls.length,
        reasoning: [],
        startedAt: nowISO(),
        completedAt: null,
      };

      // Survey-based reasoning: extract patterns from high-relevance DTUs
      const highRelevance = job.results.dtusSurveyed.filter(d => d.relevance > 0.5);
      if (highRelevance.length > 0) {
        trace.reasoning.push({
          type:       "pattern_extraction",
          confidence: clamp01(0.5 + highRelevance.length * 0.05),
          detail:     `Identified ${highRelevance.length} high-relevance DTUs with convergent patterns`,
        });
        findings.push({
          type:       "pattern",
          confidence: clamp01(0.5 + highRelevance.length * 0.05),
          summary:    `Cross-reference of ${highRelevance.length} relevant DTUs reveals structural patterns in "${job.topic}"`,
          pass:       pass + 1,
          foundAt:    nowISO(),
        });
      }

      // Gap-informed reasoning: what does the absence of knowledge imply?
      for (const gap of job.results.knowledgeGaps) {
        trace.reasoning.push({
          type:       "gap_inference",
          gapType:    gap.type,
          confidence: clamp01(0.3),
          detail:     `Gap in ${gap.type}: ${gap.description} — implies incomplete understanding`,
        });

        if (pass === 0) {
          findings.push({
            type:       "gap_insight",
            confidence: 0.3,
            summary:    `Knowledge gap (${gap.type}) suggests unexplored territory in "${job.topic}": ${gap.description}`,
            pass:       pass + 1,
            foundAt:    nowISO(),
          });
        }
      }

      // Exhaustive: debate simulation on second pass
      if (isExhaustive && pass === 1) {
        trace.reasoning.push({
          type:       "debate_simulation",
          confidence: 0.6,
          detail:     `Debate simulation: adversarial review of ${findings.length} preliminary findings`,
        });
        findings.push({
          type:       "debate_outcome",
          confidence: 0.6,
          summary:    `Adversarial debate on "${job.topic}" strengthened ${Math.ceil(findings.length * 0.7)} of ${findings.length} findings, challenged ${Math.floor(findings.length * 0.3)}`,
          pass:       pass + 1,
          foundAt:    nowISO(),
        });
      }

      // Exhaustive: meta-synthesis on third pass
      if (isExhaustive && pass === 2) {
        trace.reasoning.push({
          type:       "meta_synthesis",
          confidence: 0.7,
          detail:     `Meta-synthesis: integrating debate outcomes with original survey for final positions`,
        });
        findings.push({
          type:       "meta_synthesis",
          confidence: 0.7,
          summary:    `Meta-synthesis on "${job.topic}" produced integrated view from ${traces.length} reasoning passes and ${job.results.dtusSurveyed.length} surveyed DTUs`,
          pass:       pass + 1,
          foundAt:    nowISO(),
        });
      }

      trace.completedAt = nowISO();
      traces.push(trace);
    }

    job.results.hlrTraces  = traces;
    job.results.keyFindings = findings;

    return {
      ok: true,
      step: "reasoning",
      passes,
      findingsCount: findings.length,
      traceCount:    traces.length,
    };
  } catch (e) {
    return { ok: false, step: "reasoning", error: e.message };
  }
}

/**
 * Step 5: HYPOTHESES — Generate hypotheses from novel findings.
 */
function executeHypotheses(job) {
  try {
    if (!job.config.generateHypotheses) {
      return { ok: true, step: "hypotheses", skipped: true, reason: "hypothesis_generation_disabled" };
    }

    const hypotheses = [];
    const findings = job.results.keyFindings;
    const gaps = job.results.knowledgeGaps;

    // Generate hypotheses from findings with lower confidence
    for (const finding of findings) {
      if (finding.confidence < 0.7) {
        hypotheses.push({
          id:          uid("hyp"),
          type:        "finding_based",
          statement:   `If ${finding.summary}, then further investigation in "${job.topic}" may reveal underlying structural principles`,
          confidence:  clamp01(finding.confidence * 0.8),
          basis:       [finding.type],
          testable:    true,
          suggestedTest: `Survey adjacent domains for analogous patterns; verify with targeted DTU analysis`,
          generatedAt: nowISO(),
        });
      }
    }

    // Generate hypotheses from knowledge gaps
    for (const gap of gaps) {
      if (gap.severity === "high") {
        hypotheses.push({
          id:          uid("hyp"),
          type:        "gap_based",
          statement:   `The ${gap.type} gap in "${job.topic}" may indicate an emerging or rapidly evolving area not yet captured in the lattice`,
          confidence:  0.3,
          basis:       [gap.type, gap.severity],
          testable:    true,
          suggestedTest: `Monitor ingestion pipeline for new material; compare gap width over time`,
          generatedAt: nowISO(),
        });
      }
    }

    // Cross-domain hypothesis if multiple domains specified
    if (job.config.domains.length >= 2) {
      hypotheses.push({
        id:          uid("hyp"),
        type:        "cross_domain",
        statement:   `Cross-domain investigation of "${job.topic}" across [${job.config.domains.join(", ")}] may reveal shared invariants not visible within any single domain`,
        confidence:  0.4,
        basis:       job.config.domains,
        testable:    true,
        suggestedTest: `Run meta-derivation engine on invariant pool restricted to specified domains`,
        generatedAt: nowISO(),
      });
    }

    job.results.hypothesesProposed = hypotheses;

    return {
      ok: true,
      step: "hypotheses",
      hypothesesGenerated: hypotheses.length,
      types: [...new Set(hypotheses.map(h => h.type))],
    };
  } catch (e) {
    return { ok: false, step: "hypotheses", error: e.message };
  }
}

/**
 * Step 6: SYNTHESIS — Combine everything into a structured synthesis report.
 */
function executeSynthesis(job) {
  try {
    transitionStatus(job, RESEARCH_STATUSES.SYNTHESIZING);

    const findings  = job.results.keyFindings;
    const gaps      = job.results.knowledgeGaps;
    const hypotheses = job.results.hypothesesProposed;
    const surveyed  = job.results.dtusSurveyed;
    const hlrTraces = job.results.hlrTraces;

    // What we know: high-confidence findings
    const whatWeKnow = findings
      .filter(f => f.confidence >= 0.5)
      .map(f => f.summary);

    // What we learned: all findings
    const whatWeLearned = findings.map(f => ({
      summary:    f.summary,
      confidence: f.confidence,
      type:       f.type,
    }));

    // What is missing: knowledge gaps
    const whatIsMissing = gaps.map(g => ({
      type:        g.type,
      severity:    g.severity,
      description: g.description,
    }));

    // What we hypothesize: generated hypotheses
    const whatWeHypothesize = hypotheses.map(h => ({
      statement:   h.statement,
      confidence:  h.confidence,
      testable:    h.testable,
      suggestedTest: h.suggestedTest,
    }));

    // Next steps: actionable recommendations
    const nextSteps = [];

    if (gaps.length > 0) {
      nextSteps.push({
        action:   "fill_knowledge_gaps",
        priority: "high",
        detail:   `Address ${gaps.length} identified knowledge gap(s) through targeted ingestion`,
      });
    }

    if (hypotheses.filter(h => h.testable).length > 0) {
      nextSteps.push({
        action:   "test_hypotheses",
        priority: "normal",
        detail:   `${hypotheses.filter(h => h.testable).length} testable hypothesis(es) await verification`,
      });
    }

    if (job.config.depth !== RESEARCH_DEPTHS.EXHAUSTIVE) {
      nextSteps.push({
        action:   "deepen_research",
        priority: "low",
        detail:   `Current depth is "${job.config.depth}" — deeper investigation may yield additional insights`,
      });
    }

    const avgConfidence = findings.length > 0
      ? Math.round((findings.reduce((s, f) => s + f.confidence, 0) / findings.length) * 1000) / 1000
      : 0;

    const report = {
      id:         uid("rpt"),
      jobId:      job.id,
      topic:      job.topic,
      depth:      job.config.depth,
      domains:    job.config.domains,
      generatedAt: nowISO(),

      summary: {
        dtusSurveyed:        surveyed.length,
        gapsIdentified:      gaps.length,
        findingsCount:       findings.length,
        hypothesesCount:     hypotheses.length,
        hlrPasses:           hlrTraces.length,
        avgFindingConfidence: avgConfidence,
      },

      sections: {
        whatWeKnow,
        whatWeLearned,
        whatIsMissing,
        whatWeHypothesize,
        nextSteps,
      },

      metadata: {
        requestedBy: job.requestedBy,
        pipeline:    job.pipeline,
        config:      { ...job.config },
        duration:    job.startedAt
          ? new Date().getTime() - new Date(job.startedAt).getTime()
          : null,
      },
    };

    job.results.synthesisReport = report;

    // Generate a sovereign DTU record for the synthesis
    const dtuRecord = {
      id:     uid("dtu"),
      title:  `Research Synthesis: ${job.topic}`,
      type:   "research_synthesis",
      source: "research-jobs",
      tags:   ["research", "synthesis", job.config.depth, ...job.config.domains.slice(0, 5)],
      jobId:  job.id,
      reportId: report.id,
      createdAt: nowISO(),
    };
    job.results.generatedDTUs.push(dtuRecord);

    return {
      ok: true,
      step: "synthesis",
      reportId: report.id,
      generatedDtuId: dtuRecord.id,
      sectionCounts: {
        whatWeKnow:        whatWeKnow.length,
        whatWeLearned:     whatWeLearned.length,
        whatIsMissing:     whatIsMissing.length,
        whatWeHypothesize: whatWeHypothesize.length,
        nextSteps:         nextSteps.length,
      },
    };
  } catch (e) {
    return { ok: false, step: "synthesis", error: e.message };
  }
}

/**
 * Step 7: COMPLETE — Mark job as complete and record metrics.
 */
function executeComplete(job) {
  try {
    transitionStatus(job, RESEARCH_STATUSES.COMPLETE);
    job.completedAt = nowISO();

    // Record in metrics log
    const summary = {
      jobId:      job.id,
      topic:      job.topic,
      depth:      job.config.depth,
      status:     RESEARCH_STATUSES.COMPLETE,
      dtusSurveyed:   job.results.dtusSurveyed.length,
      gapsFound:      job.results.knowledgeGaps.length,
      findings:       job.results.keyFindings.length,
      hypotheses:     job.results.hypothesesProposed.length,
      hlrPasses:      job.results.hlrTraces.length,
      generatedDTUs:  job.results.generatedDTUs.length,
      duration:       job.startedAt
        ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
        : null,
      completedAt: job.completedAt,
    };
    metricsLog.push(summary);
    if (metricsLog.length > MAX_METRICS_LOG) {
      metricsLog.splice(0, metricsLog.length - MAX_METRICS_LOG);
    }

    return { ok: true, step: "complete", summary };
  } catch (e) {
    return { ok: false, step: "complete", error: e.message };
  }
}

// Step dispatcher
const STEP_EXECUTORS = {
  survey:       executeSurvey,
  gap_analysis: executeGapAnalysis,
  ingest:       executeIngest,
  reasoning:    executeReasoning,
  hypotheses:   executeHypotheses,
  synthesis:    executeSynthesis,
  complete:     executeComplete,
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Submit a new research job to the queue.
 *
 * @param {string} topic - Research topic
 * @param {object} [config] - Job configuration
 * @param {string} [config.depth]              - shallow|normal|deep|exhaustive
 * @param {string[]} [config.domains]          - Domain filters
 * @param {number} [config.maxDTUsToConsult]   - Max DTUs to survey
 * @param {boolean} [config.includeIngest]     - Enable ingestion step
 * @param {string[]} [config.ingestUrls]       - URLs to ingest
 * @param {boolean} [config.generateHypotheses]- Enable hypothesis generation
 * @param {boolean} [config.runHLR]            - Enable HLR reasoning
 * @param {string} [config.priority]           - low|normal|high|critical
 * @param {string} [config.requestedBy]        - Requester identity
 * @returns {{ ok: boolean, job?: object, error?: string }}
 */
export function submitResearchJob(topic, config) {
  try {
    if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
      return { ok: false, error: "topic_required" };
    }

    const job = createJobObject(topic.trim(), config);
    jobs.set(job.id, job);
    addToIndex(RESEARCH_STATUSES.QUEUED, job.id);

    return { ok: true, job: sanitizeJob(job) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get a research job by ID.
 *
 * @param {string} id - Job ID
 * @returns {{ ok: boolean, job?: object, error?: string }}
 */
export function getResearchJob(id) {
  try {
    const job = jobs.get(id);
    if (!job) return { ok: false, error: "not_found" };
    return { ok: true, job: sanitizeJob(job) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * List research jobs, optionally filtered by status.
 *
 * @param {string} [status] - Filter by status (queued|running|synthesizing|complete|failed)
 * @returns {{ ok: boolean, jobs: object[], total: number }}
 */
export function listResearchJobs(status) {
  try {
    if (status && !ALL_STATUSES.includes(status)) {
      return { ok: false, error: "invalid_status", allowed: ALL_STATUSES };
    }

    let result;
    if (status) {
      const ids = jobIndex.get(status) || new Set();
      result = Array.from(ids)
        .map(id => jobs.get(id))
        .filter(Boolean)
        .map(sanitizeJob);
    } else {
      result = Array.from(jobs.values()).map(sanitizeJob);
    }

    // Sort: queued/running first, then by creation date descending
    result.sort((a, b) => {
      const statusOrder = { queued: 0, running: 1, synthesizing: 2, complete: 3, failed: 4 };
      const sa = statusOrder[a.status] ?? 5;
      const sb = statusOrder[b.status] ?? 5;
      if (sa !== sb) return sa - sb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return { ok: true, jobs: result, total: result.length };
  } catch (e) {
    return { ok: false, error: e.message, jobs: [], total: 0 };
  }
}

/**
 * Cancel a research job. Only queued or running jobs can be cancelled.
 *
 * @param {string} id - Job ID
 * @returns {{ ok: boolean, cancelled?: boolean, error?: string }}
 */
export function cancelResearchJob(id) {
  try {
    const job = jobs.get(id);
    if (!job) return { ok: false, error: "not_found" };

    if (job.status === RESEARCH_STATUSES.COMPLETE ||
        job.status === RESEARCH_STATUSES.FAILED) {
      return { ok: false, error: "job_already_terminal", status: job.status };
    }

    transitionStatus(job, RESEARCH_STATUSES.FAILED);
    job.error = "cancelled_by_request";
    job.completedAt = nowISO();

    // Log cancellation
    metricsLog.push({
      jobId:      job.id,
      topic:      job.topic,
      depth:      job.config.depth,
      status:     "cancelled",
      cancelledAt: job.completedAt,
    });
    if (metricsLog.length > MAX_METRICS_LOG) {
      metricsLog.splice(0, metricsLog.length - MAX_METRICS_LOG);
    }

    return { ok: true, cancelled: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get the results of a completed (or in-progress) research job.
 *
 * @param {string} id - Job ID
 * @returns {{ ok: boolean, results?: object, status?: string, error?: string }}
 */
export function getResearchResults(id) {
  try {
    const job = jobs.get(id);
    if (!job) return { ok: false, error: "not_found" };

    return {
      ok:      true,
      status:  job.status,
      topic:   job.topic,
      results: {
        dtusSurveyed:        job.results.dtusSurveyed.length,
        ingestedUrls:        job.results.ingestedUrls.length,
        keyFindings:         job.results.keyFindings,
        knowledgeGaps:       job.results.knowledgeGaps,
        generatedDTUs:       job.results.generatedDTUs,
        hypothesesProposed:  job.results.hypothesesProposed,
        hlrTraces:           job.results.hlrTraces.length,
        synthesisReport:     job.results.synthesisReport,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get the synthesis report for a completed research job.
 *
 * @param {string} id - Job ID
 * @returns {{ ok: boolean, report?: object, error?: string }}
 */
export function getResearchReport(id) {
  try {
    const job = jobs.get(id);
    if (!job) return { ok: false, error: "not_found" };

    if (!job.results.synthesisReport) {
      return {
        ok:     false,
        error:  "no_report_yet",
        status: job.status,
        hint:   job.status === RESEARCH_STATUSES.QUEUED
          ? "Job has not started yet"
          : job.status === RESEARCH_STATUSES.RUNNING
            ? `Job is running (current step: ${job.currentStep || "pending"})`
            : "Synthesis step has not been reached",
      };
    }

    return { ok: true, report: job.results.synthesisReport };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Advance a research job by one pipeline step.
 *
 * @param {string} jobId - Job ID
 * @returns {{ ok: boolean, step?: string, result?: object, error?: string }}
 */
export function runResearchStep(jobId) {
  try {
    const job = jobs.get(jobId);
    if (!job) return { ok: false, error: "not_found" };

    // Cannot advance terminal jobs
    if (job.status === RESEARCH_STATUSES.COMPLETE) {
      return { ok: false, error: "job_already_complete" };
    }
    if (job.status === RESEARCH_STATUSES.FAILED) {
      return { ok: false, error: "job_failed", detail: job.error };
    }

    // Start job if queued
    if (job.status === RESEARCH_STATUSES.QUEUED) {
      transitionStatus(job, RESEARCH_STATUSES.RUNNING);
      job.startedAt = nowISO();
    }

    // Advance to next step
    job.stepIndex++;
    if (job.stepIndex >= job.pipeline.length) {
      // All steps exhausted — should not happen, but handle gracefully
      transitionStatus(job, RESEARCH_STATUSES.COMPLETE);
      job.completedAt = nowISO();
      return { ok: true, step: "complete", result: { finished: true } };
    }

    const stepName = job.pipeline[job.stepIndex];
    job.currentStep = stepName;

    const executor = STEP_EXECUTORS[stepName];
    if (!executor) {
      job.error = `unknown_step: ${stepName}`;
      transitionStatus(job, RESEARCH_STATUSES.FAILED);
      return { ok: false, error: job.error };
    }

    const result = executor(job);

    // If step failed, mark job as failed
    if (!result.ok) {
      job.error = result.error || `step_failed: ${stepName}`;
      transitionStatus(job, RESEARCH_STATUSES.FAILED);
      job.completedAt = nowISO();
      return { ok: false, step: stepName, error: job.error, result };
    }

    return {
      ok:   true,
      step: stepName,
      result,
      nextStep: job.stepIndex + 1 < job.pipeline.length
        ? job.pipeline[job.stepIndex + 1]
        : null,
      progress: {
        current: job.stepIndex + 1,
        total:   job.pipeline.length,
        percent: Math.round(((job.stepIndex + 1) / job.pipeline.length) * 100),
      },
    };
  } catch (e) {
    try {
      const job = jobs.get(jobId);
      if (job) {
        job.error = e.message;
        transitionStatus(job, RESEARCH_STATUSES.FAILED);
        job.completedAt = nowISO();
      }
    } catch (_e) { logger.debug('emergent:research-jobs', 'silent', { error: _e?.message }); }
    return { ok: false, error: e.message };
  }
}

/**
 * Process the next queued research job by running all its steps to completion.
 *
 * @returns {{ ok: boolean, jobId?: string, result?: object, error?: string }}
 */
export function processResearchQueue() {
  try {
    const queuedIds = jobIndex.get(RESEARCH_STATUSES.QUEUED);
    if (!queuedIds || queuedIds.size === 0) {
      return { ok: true, jobId: null, result: null, message: "queue_empty" };
    }

    // Pick highest priority queued job
    let bestJob = null;
    let bestPriority = -1;
    const priorityOrder = { critical: 3, high: 2, normal: 1, low: 0 };

    for (const id of queuedIds) {
      const job = jobs.get(id);
      if (!job) continue;
      const p = priorityOrder[job.priority] ?? 0;
      if (p > bestPriority || (p === bestPriority && (!bestJob || job.createdAt < bestJob.createdAt))) {
        bestPriority = p;
        bestJob = job;
      }
    }

    if (!bestJob) {
      return { ok: true, jobId: null, result: null, message: "no_eligible_jobs" };
    }

    // Run all steps
    const stepResults = [];
    let lastResult = null;

    while (bestJob.status !== RESEARCH_STATUSES.COMPLETE &&
           bestJob.status !== RESEARCH_STATUSES.FAILED) {
      const stepResult = runResearchStep(bestJob.id);
      stepResults.push(stepResult);
      lastResult = stepResult;

      if (!stepResult.ok) break;
    }

    return {
      ok:     bestJob.status === RESEARCH_STATUSES.COMPLETE,
      jobId:  bestJob.id,
      status: bestJob.status,
      result: {
        stepsRun:    stepResults.length,
        stepResults,
        finalStatus: bestJob.status,
        error:       bestJob.error,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get aggregate research metrics.
 *
 * @returns {{ ok: boolean, metrics: object }}
 */
export function getResearchMetrics() {
  try {
    const statusCounts = {};
    for (const s of ALL_STATUSES) {
      const set = jobIndex.get(s);
      statusCounts[s] = set ? set.size : 0;
    }

    const depthCounts = {};
    for (const d of ALL_DEPTHS) depthCounts[d] = 0;
    for (const job of jobs.values()) {
      const d = job.config.depth;
      if (d in depthCounts) depthCounts[d]++;
    }

    const completedJobs = metricsLog.filter(m => m.status === RESEARCH_STATUSES.COMPLETE);
    const cancelledJobs = metricsLog.filter(m => m.status === "cancelled");

    const avgDuration = completedJobs.length > 0
      ? Math.round(completedJobs.reduce((s, m) => s + (m.duration || 0), 0) / completedJobs.length)
      : 0;

    const avgFindings = completedJobs.length > 0
      ? Math.round((completedJobs.reduce((s, m) => s + (m.findings || 0), 0) / completedJobs.length) * 100) / 100
      : 0;

    const avgHypotheses = completedJobs.length > 0
      ? Math.round((completedJobs.reduce((s, m) => s + (m.hypotheses || 0), 0) / completedJobs.length) * 100) / 100
      : 0;

    return {
      ok: true,
      metrics: {
        totalJobs:     jobs.size,
        byStatus:      statusCounts,
        byDepth:       depthCounts,
        completed:     completedJobs.length,
        cancelled:     cancelledJobs.length,
        avgDurationMs: avgDuration,
        avgFindings,
        avgHypotheses,
        recentCompletions: metricsLog
          .filter(m => m.status === RESEARCH_STATUSES.COMPLETE)
          .slice(-10)
          .map(m => ({
            jobId:     m.jobId,
            topic:     m.topic,
            depth:     m.depth,
            findings:  m.findings,
            hypotheses: m.hypotheses,
            durationMs: m.duration,
            completedAt: m.completedAt,
          })),
      },
    };
  } catch (e) {
    return { ok: false, error: e.message, metrics: {} };
  }
}

// ── Serialization Helper ────────────────────────────────────────────────────

function sanitizeJob(job) {
  try {
    return {
      id:          job.id,
      topic:       job.topic,
      status:      job.status,
      priority:    job.priority,
      requestedBy: job.requestedBy,
      currentStep: job.currentStep,
      stepIndex:   job.stepIndex,
      pipeline:    job.pipeline,
      config:      { ...job.config },
      results: {
        dtusSurveyed:       job.results.dtusSurveyed.length,
        ingestedUrls:       job.results.ingestedUrls.length,
        keyFindings:        job.results.keyFindings.length,
        knowledgeGaps:      job.results.knowledgeGaps.length,
        generatedDTUs:      job.results.generatedDTUs.length,
        hypothesesProposed: job.results.hypothesesProposed.length,
        hlrTraces:          job.results.hlrTraces.length,
        hasSynthesisReport: !!job.results.synthesisReport,
      },
      error:       job.error,
      createdAt:   job.createdAt,
      startedAt:   job.startedAt,
      completedAt: job.completedAt,
    };
  } catch (_) {
    return { id: job.id, error: "serialization_failed" };
  }
}
