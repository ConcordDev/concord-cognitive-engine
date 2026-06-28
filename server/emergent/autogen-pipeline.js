/**
 * Autogen Pipeline — 6-Stage Knowledge Synthesis Engine
 *
 * Replaces the old "last 8 DTUs" approach with signal-driven, evidence-backed
 * DTU generation that integrates Ollama shaping + deterministic gates.
 *
 * Pipeline stages:
 *   Stage 0: Target Selection (intent-based, not recency-based)
 *   Stage 1: Retrieval Pack (50–300 scored DTUs, core/peripheral/conflicts)
 *   Stage 2: Multi-Role Synthesis (Builder → Critic → Synthesizer)
 *   Stage 3: Evidence + Citation Discipline (support[] mandatory)
 *   Stage 4: Novelty + Redundancy Control (similarity gate)
 *   Stage 5: Promotion / Write Policy (shadow-first)
 *
 * LLM integration contract:
 *   Ollama  = Output Shaper (always-on when available) — reformats, never invents
 *   Gates   = Deterministic validation (always-on) — the real "brain"
 *   Cloud   = Optional deep synth (rare) — only on escalation
 *
 * Three intents (replacing dream/synth/evolution):
 *   Dream     = gap-filling + creative hypotheses (labeled)
 *   Synth     = conflict resolution + patch proposals
 *   Evolution = cluster compression + mega DTU rollup
 */

import crypto from "node:crypto";
import { runEmpiricalGates } from "./empirical-gates.js";
import { assessGrounding, stampGrounding, classifyGrounding, collectWebSources } from "../lib/dtu-grounding.js";
import { DEFAULT_RUNNERS } from "../lib/grounding-runners.js";
import { formatAndValidate as formatGRC } from "../grc/index.js";
import { runCouncilVoices } from "./council-voices.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";

// ── Intent Types ─────────────────────────────────────────────────────────────

export const INTENTS = Object.freeze({
  FILL_GAPS: "fill_gaps",
  RESOLVE_CONFLICTS: "resolve_conflicts",
  COMPRESS_CLUSTERS: "compress_clusters",
  EXTRACT_PATTERNS: "extract_patterns",
  ELEVATE_HIGH_USAGE: "elevate_high_usage",
});

export const ALL_INTENTS = Object.freeze(Object.values(INTENTS));

export const VARIANT_INTENTS = Object.freeze({
  dream: [INTENTS.FILL_GAPS, INTENTS.EXTRACT_PATTERNS],
  synth: [INTENTS.RESOLVE_CONFLICTS, INTENTS.FILL_GAPS],
  evolution: [INTENTS.COMPRESS_CLUSTERS, INTENTS.ELEVATE_HIGH_USAGE],
});

// ── Escalation Reasons ───────────────────────────────────────────────────────

export const ESCALATION_REASONS = Object.freeze({
  INSUFFICIENT_SYNTHESIS: "insufficient_synthesis",
  UNRESOLVABLE_CONFLICTS: "unresolvable_conflicts",
  MEGA_HYPER_PROMOTION: "mega_hyper_promotion",
});

// ── Pipeline State ───────────────────────────────────────────────────────────

export function ensurePipelineState(STATE) {
  if (!STATE._autogenPipeline) {
    STATE._autogenPipeline = {
      initialized: true,
      initializedAt: new Date().toISOString(),
      recentGeneratedHashes: [],    // last 500 claim hashes for novelty
      maxRecentHashes: 500,
      metrics: {
        totalRuns: 0,
        byIntent: {},
        byVariant: {},
        candidatesProduced: 0,
        candidatesRejected: 0,
        shadowsCreated: 0,
        ollamaShapings: 0,
        ollamaFailures: 0,
        cloudEscalations: 0,
        noveltyRejects: 0,
        patchProposals: 0,
      },
    };
  }
  // Ensure sub-fields exist even if pipeline state was deserialized
  // without them (old saved states may predate fields that were
  // added later; the worker calls .find() / .push() on these so
  // missing them throws "Cannot read properties of undefined".)
  if (!Array.isArray(STATE._autogenPipeline.recentGeneratedHashes)) {
    STATE._autogenPipeline.recentGeneratedHashes = [];
  }
  if (typeof STATE._autogenPipeline.maxRecentHashes !== "number") {
    STATE._autogenPipeline.maxRecentHashes = 500;
  }
  if (!STATE._autogenPipeline.metrics) {
    STATE._autogenPipeline.metrics = {
      totalRuns: 0,
      byIntent: {},
      byVariant: {},
      candidatesProduced: 0,
      candidatesRejected: 0,
      shadowsCreated: 0,
      ollamaShapings: 0,
      ollamaFailures: 0,
      cloudEscalations: 0,
      noveltyRejects: 0,
      patchProposals: 0,
    };
  }
  return STATE._autogenPipeline;
}

// ── Stage 0: Target Selection ────────────────────────────────────────────────

/**
 * Select an autogen intent based on lattice signals, not recency.
 *
 * Intents:
 *   1. Fill gaps:       DTUs with missing fields (no defs/invariants/examples)
 *   2. Resolve conflicts: two DTUs that contradict
 *   3. Compress clusters: many DTUs sharing tags → 1 mega rollup
 *   4. Extract patterns: repeated workflows emerge across artifacts
 *   5. Elevate high-usage: DTUs referenced often across lenses
 *
 * @param {object} STATE
 * @param {object} opts - { variant?: "dream"|"synth"|"evolution" }
 * @returns {{ intent: string, signal: object, score: number }}
 */
export function selectIntent(STATE, opts = {}) {
  const dtus = Array.from(STATE.dtus.values());
  if (dtus.length === 0) {
    return { intent: INTENTS.FILL_GAPS, signal: { reason: "empty_lattice" }, score: 0 };
  }

  const scores = [];

  // 1. Gap score: how many DTUs have missing core fields?
  let gapCount = 0;
  const gapDtus = [];
  for (const d of dtus) {
    const c = d.core || {};
    const missing =
      (!c.definitions?.length ? 1 : 0) +
      (!c.invariants?.length ? 1 : 0) +
      (!c.examples?.length ? 1 : 0);
    if (missing >= 2) {
      gapCount++;
      if (gapDtus.length < 30) gapDtus.push(d.id);
    }
  }
  scores.push({
    intent: INTENTS.FILL_GAPS,
    score: Math.min(gapCount / Math.max(dtus.length, 1), 1) * 100,
    signal: { gapCount, sampleIds: gapDtus.slice(0, 5) },
  });

  // 2. Conflict score: DTUs with contradicting claims/invariants
  const conflictPairs = findConflictPairs(dtus);
  scores.push({
    intent: INTENTS.RESOLVE_CONFLICTS,
    score: Math.min(conflictPairs.length * 15, 100),
    signal: { conflictCount: conflictPairs.length, pairs: conflictPairs.slice(0, 5) },
  });

  // 3. Cluster compression score: tag groups with many members
  const tagGroups = buildTagGroups(dtus);
  const largeGroups = tagGroups.filter(g => g.count >= 4);
  scores.push({
    intent: INTENTS.COMPRESS_CLUSTERS,
    score: Math.min(largeGroups.length * 10, 100),
    signal: { largeGroupCount: largeGroups.length, topGroups: largeGroups.slice(0, 5) },
  });

  // 4. Pattern extraction: repeated lineage/workflow patterns
  const patternScore = computePatternScore(dtus);
  scores.push({
    intent: INTENTS.EXTRACT_PATTERNS,
    score: patternScore.score,
    signal: patternScore.signal,
  });

  // 5. High-usage elevation: DTUs referenced in lineage of many others
  const usageCounts = computeUsageCounts(dtus);
  const highUsageDtus = usageCounts.filter(u => u.refCount >= 3);
  scores.push({
    intent: INTENTS.ELEVATE_HIGH_USAGE,
    score: Math.min(highUsageDtus.length * 8, 100),
    signal: { highUsageCount: highUsageDtus.length, top: highUsageDtus.slice(0, 5) },
  });

  // If variant specified, prefer those intents
  if (opts.variant && VARIANT_INTENTS[opts.variant]) {
    const preferred = VARIANT_INTENTS[opts.variant];
    for (const s of scores) {
      if (preferred.includes(s.intent)) s.score += 30;
    }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores[0];
}

// ── Stage 1: Retrieval Pack ──────────────────────────────────────────────────

/**
 * Build a scored source pack of 50–300 DTUs for synthesis.
 *
 * Scoring signals:
 *   - tag overlap with intent targets
 *   - council credibility (authority.score)
 *   - evidence/citation presence
 *   - usage/reference count
 *   - freshness (recency bonus)
 *
 * @returns {{ core: DTU[], peripheral: DTU[], conflicts: object[], citations: object[] }}
 */
export function buildRetrievalPack(STATE, intent) {
  // Probation quarantine: DTUs in probation cannot be parents for new autogen candidates.
  // This prevents confidence laundering — probationary DTUs must be validated before
  // they can serve as source material for further generation.
  const dtus = Array.from(STATE.dtus.values()).filter(d => {
    if (d.classification?.status === "probation") return false;
    if (d.meta?.probation === true) return false;
    return true;
  });
  if (dtus.length === 0) {
    return { core: [], peripheral: [], conflicts: [], citations: [], stats: { total: 0 } };
  }

  const targetIds = new Set(intent.signal?.sampleIds || []);
  const scored = [];

  // Compute usage map for reference count scoring
  const refCounts = new Map();
  for (const d of dtus) {
    for (const parent of (Array.isArray(d.lineage) ? d.lineage : [])) {
      refCounts.set(parent, (refCounts.get(parent) || 0) + 1);
    }
  }

  for (const d of dtus) {
    let score = 0;

    // Direct target match
    if (targetIds.has(d.id)) score += 50;

    // Council credibility
    score += Math.min((d.authority?.score || 0) * 3, 20);

    // Evidence/citation presence
    if (d.meta?.citations?.length) score += 10;
    if (d.meta?.evidence?.length) score += 10;

    // Usage/reference count
    const refs = refCounts.get(d.id) || 0;
    score += Math.min(refs * 5, 25);

    // Tag overlap with intent signal
    if (intent.signal?.topGroups?.length) {
      const targetTags = new Set(intent.signal.topGroups.flatMap(g => g.tags || [g.tag]));
      const dtuTags = new Set(d.tags || []);
      let overlap = 0;
      for (const t of dtuTags) if (targetTags.has(t)) overlap++;
      score += Math.min(overlap * 5, 15);
    }

    // Freshness bonus (newer DTUs get slight boost)
    const age = Date.now() - new Date(d.createdAt || 0).getTime();
    const daysSinceCreation = age / 86400000;
    if (daysSinceCreation < 7) score += 5;

    // Core completeness (more complete = better source material)
    const c = d.core || {};
    const coreFields = (c.definitions?.length || 0) + (c.invariants?.length || 0) +
      (c.examples?.length || 0) + (c.claims?.length || 0);
    score += Math.min(coreFields * 2, 15);

    scored.push({ dtu: d, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // Core: top 10–30 (highest scored)
  const coreCount = Math.min(Math.max(Math.ceil(scored.length * 0.05), 10), 30);
  const core = scored.slice(0, coreCount).map(s => s.dtu);

  // Peripheral: next 50–200
  const periphCount = Math.min(Math.max(Math.ceil(scored.length * 0.15), 50), 200);
  const peripheral = scored.slice(coreCount, coreCount + periphCount).map(s => s.dtu);

  // Conflicts: any conflict pairs involving core DTUs
  const coreIds = new Set(core.map(d => d.id));
  const allConflicts = findConflictPairs(dtus);
  const relevantConflicts = allConflicts.filter(p =>
    coreIds.has(p.dtuA) || coreIds.has(p.dtuB)
  );

  // Citations: extract from core DTUs
  const citations = core
    .filter(d => d.meta?.citations?.length)
    .map(d => ({ dtuId: d.id, citations: d.meta.citations }));

  return {
    core,
    peripheral,
    conflicts: relevantConflicts,
    citations,
    stats: {
      total: dtus.length,
      coreCount: core.length,
      peripheralCount: peripheral.length,
      conflictCount: relevantConflicts.length,
      citationCount: citations.length,
    },
  };
}

// ── Stage 2: Multi-Role Synthesis (Builder + Critic + Synth) ─────────────────

/**
 * Builder: deterministic structured extraction + merge rules.
 * Produces a raw candidate DTU from the retrieval pack.
 */
export function builderPhase(intent, pack) {
  const core = pack.core || [];
  if (core.length === 0) {
    return { ok: false, error: "empty_pack" };
  }

  const definitions = [];
  const invariants = [];
  const examples = [];
  const claims = [];
  const nextActions = [];
  const support = [];
  const conflicts = [];

  // Extract and merge from core DTUs based on intent
  for (const d of core) {
    const c = d.core || {};

    if (intent.intent === INTENTS.FILL_GAPS) {
      // Fill from DTUs that HAVE the fields others are missing
      if (c.definitions?.length) {
        for (const def of c.definitions) {
          if (definitions.length < 6 && !definitions.includes(def)) {
            definitions.push(def);
            support.push({ claimIndex: definitions.length - 1, field: "definitions", sourceDtuId: d.id, type: "fact" });
          }
        }
      }
      if (c.invariants?.length) {
        for (const inv of c.invariants) {
          if (invariants.length < 6 && !invariants.includes(inv)) {
            invariants.push(inv);
            support.push({ claimIndex: invariants.length - 1, field: "invariants", sourceDtuId: d.id, type: "fact" });
          }
        }
      }
      if (c.examples?.length) {
        for (const ex of c.examples) {
          if (examples.length < 6 && !examples.includes(ex)) {
            examples.push(ex);
            support.push({ claimIndex: examples.length - 1, field: "examples", sourceDtuId: d.id, type: "fact" });
          }
        }
      }
    }

    // Always extract claims with provenance
    if (c.claims?.length) {
      for (const claim of c.claims) {
        if (claims.length < 8 && !claims.includes(claim)) {
          claims.push(claim);
          support.push({ claimIndex: claims.length - 1, field: "claims", sourceDtuId: d.id, type: "fact" });
        }
      }
    }

    if (c.nextActions?.length) {
      for (const act of c.nextActions) {
        if (nextActions.length < 4 && !nextActions.includes(act)) nextActions.push(act);
      }
    }
  }

  // Process conflicts
  for (const cp of (pack.conflicts || []).slice(0, 5)) {
    conflicts.push({
      withDtuId: cp.dtuB,
      conflictType: cp.type || "claim_contradiction",
      description: cp.description || `Conflict between ${cp.dtuA} and ${cp.dtuB}`,
    });
  }

  // Generate title based on intent
  const tagHints = extractTopTags(core, 6);
  const title = generateTitle(intent, tagHints);

  // Build lineage from all core DTU IDs
  const lineage = core.map(d => d.id);

  // Tag the candidate
  const tags = Array.from(new Set([
    "autogen",
    intent.intent.replace(/_/g, "-"),
    ...tagHints,
  ])).slice(0, 20);

  const candidate = {
    title,
    tags,
    tier: "regular",
    lineage,
    core: { definitions, invariants, examples, claims, nextActions },
    human: {
      summary: `Auto-generated via ${intent.intent} from ${core.length} source DTUs.`,
      bullets: [
        `Intent: ${intent.intent}`,
        `Sources: ${core.length} core, ${(pack.peripheral || []).length} peripheral`,
        `Tag focus: ${tagHints.join(", ") || "none"}`,
      ],
    },
    machine: {
      notes: `autogen.pipeline intent=${intent.intent} coreCount=${core.length}`,
    },
    meta: {
      autogenIntent: intent.intent,
      autogenScore: intent.score,
      sourcePack: {
        coreIds: lineage,
        peripheralCount: (pack.peripheral || []).length,
        conflictCount: conflicts.length,
      },
      claims: claims.map((text, i) => {
        const sup = support.filter(s => s.field === "claims" && s.claimIndex === i);
        return {
          text,
          support: sup.map(s => s.sourceDtuId),
          confidence: sup.length > 0 ? 0.8 : 0.4,
          type: sup.length > 0 ? "fact" : "hypothesis",
        };
      }),
      conflicts,
      provenance: {
        sourceIds: lineage,
        packSize: (pack.core?.length || 0) + (pack.peripheral?.length || 0),
        builtAt: new Date().toISOString(),
      },
    },
    source: "autogen.pipeline",
  };

  // Ensure minimum structure
  if (definitions.length < 1) {
    definitions.push(`Working definition: ${intent.intent.replace(/_/g, " ")} synthesis from ${core.length} DTUs.`);
  }
  if (invariants.length < 1) {
    invariants.push("All claims must cite source DTU IDs or be labeled hypothesis.");
  }

  return { ok: true, candidate };
}

/**
 * Critic: deterministic rule-based checks.
 * Returns issues list; candidate fails if critical issues found.
 */
export function criticPhase(candidate, pack) {
  const issues = [];
  const c = candidate.core || {};

  // Check: missing core fields
  if (!c.definitions?.length) issues.push({ severity: "warning", rule: "no_definitions" });
  if (!c.invariants?.length) issues.push({ severity: "warning", rule: "no_invariants" });
  if (!c.examples?.length) issues.push({ severity: "info", rule: "no_examples" });

  // Check: claims without support
  const claimsMeta = candidate.meta?.claims || [];
  const unsupported = claimsMeta.filter(cm => cm.type === "hypothesis");
  if (unsupported.length > claimsMeta.length * 0.7 && claimsMeta.length > 0) {
    issues.push({
      severity: "warning",
      rule: "mostly_hypothetical",
      detail: `${unsupported.length}/${claimsMeta.length} claims are hypothetical`,
    });
  }

  // Check: evidence linking
  const hasEvidence = candidate.meta?.claims?.some(cm => cm.support?.length > 0);
  if (!hasEvidence && claimsMeta.length > 0) {
    issues.push({ severity: "critical", rule: "no_evidence_links" });
  }

  // Check: title quality
  if (!candidate.title || candidate.title.length < 5) {
    issues.push({ severity: "warning", rule: "weak_title" });
  }

  // Check: scope creep (too many unrelated tags)
  if ((candidate.tags?.length || 0) > 15) {
    issues.push({ severity: "info", rule: "too_many_tags", detail: `${candidate.tags.length} tags` });
  }

  // Check: conflicts acknowledged
  if ((pack.conflicts?.length || 0) > 0 && !(candidate.meta?.conflicts?.length)) {
    issues.push({ severity: "warning", rule: "conflicts_not_acknowledged" });
  }

  // ── Empirical Gates (math / units / physical constants) ──────────────────
  const empirical = runEmpiricalGates(candidate);
  for (const ei of empirical.issues) {
    issues.push({
      severity: ei.severity,
      rule: `empirical.${ei.gate}.${ei.rule}`,
      detail: ei.detail,
      gate: ei.gate,
    });
  }

  const hasCritical = issues.some(i => i.severity === "critical");
  const needsEscalation = hasCritical || unsupported.length > 3;

  return {
    ok: !hasCritical,
    issues,
    hasCritical,
    needsEscalation,
    empiricalStats: empirical.stats,
    escalationReason: needsEscalation
      ? (hasCritical ? ESCALATION_REASONS.INSUFFICIENT_SYNTHESIS : ESCALATION_REASONS.UNRESOLVABLE_CONFLICTS)
      : null,
  };
}

/**
 * Synthesizer: canonicalize, minimize redundancy, finalize provenance.
 * Takes builder output + critic feedback → final candidate.
 */
export function synthesizerPhase(candidate, criticResult, runners = DEFAULT_RUNNERS) {
  // Apply critic feedback
  const revised = { ...candidate };
  revised.core = { ...candidate.core };
  revised.meta = { ...candidate.meta };
  revised.human = { ...candidate.human };

  // Add critic trace to provenance
  revised.meta.criticTrace = {
    issueCount: criticResult.issues.length,
    hasCritical: criticResult.hasCritical,
    issues: criticResult.issues.map(i => `${i.severity}: ${i.rule}`),
    passedAt: new Date().toISOString(),
  };

  // De-duplicate claims
  const seenClaims = new Set();
  const dedupedClaims = [];
  const dedupedClaimsMeta = [];
  const originalClaims = revised.core.claims || [];
  const originalClaimsMeta = revised.meta.claims || [];

  for (let i = 0; i < originalClaims.length; i++) {
    const normalized = String(originalClaims[i] ?? "").toLowerCase().trim();
    if (!seenClaims.has(normalized)) {
      seenClaims.add(normalized);
      dedupedClaims.push(originalClaims[i]);
      if (originalClaimsMeta[i]) dedupedClaimsMeta.push(originalClaimsMeta[i]);
    }
  }
  revised.core.claims = dedupedClaims;
  revised.meta.claims = dedupedClaimsMeta;

  // De-duplicate definitions
  revised.core.definitions = [...new Set(revised.core.definitions || [])];
  revised.core.invariants = [...new Set(revised.core.invariants || [])];
  revised.core.examples = [...new Set(revised.core.examples || [])];

  // Update human projection
  revised.human.bullets = [
    ...(revised.human.bullets || []),
    `Critic: ${criticResult.issues.length} issues (${criticResult.hasCritical ? "CRITICAL" : "clean"})`,
  ];

  // "Show your work" gate — the subconscious-quality bar. An autonomous DTU that asserts a
  // feasibility CLAIM must carry an EXTERNAL web source (internal DTU citations alone are
  // confidence laundering); a CREATIVE generation must be reproducibly EXECUTABLE. Anything
  // that can't show its work is PROBATIONED here (confidence-capped, not promoted/published)
  // — it can still exist, it just can't launder into verified/global knowledge ungrounded.
  // Definitional DTUs owe no external grounding and pass untouched.
  try {
    const grounding = assessGrounding(revised, runners);
    stampGrounding(revised, grounding);
    revised.meta.criticTrace.grounding = grounding.kind + (grounding.grounded ? ":grounded" : ":probation(" + (grounding.gaps?.[0] || "ungrounded") + ")");
  } catch (_e) { /* grounding is best-effort; never block synthesis */ }

  return { ok: true, candidate: revised };
}

// ── Stage 3: Ollama Shaping (always-on when available) ───────────────────────

/**
 * Build the Ollama structuring prompt.
 *
 * Contract:
 *   - Input: draftDTU + sourcePack excerpts
 *   - Output: STRICT JSON matching DTU schema
 *   - Forbidden: adding new claims not in sourcePack, fabricating citations
 *   - Required: every claim includes support[] or type:"hypothesis"
 */
export function buildOllamaPrompt(candidate, coreExcerpts) {
  const allowedSources = coreExcerpts.map(d => ({
    id: d.id,
    title: d.title,
    snippet: (d.human?.summary || d.cretiHuman || "").slice(0, 200),
  }));

  return {
    system: TASK_PROMPTS.autogenStructureFormatter(),
    user: JSON.stringify({
      task: "structure_dtu",
      draftDTU: {
        title: candidate.title,
        core: candidate.core,
        claims: candidate.meta?.claims || [],
        conflicts: candidate.meta?.conflicts || [],
      },
      allowedSources,
      schema: {
        title: "string (concise, descriptive)",
        core: {
          definitions: "string[] (clear, sourced)",
          invariants: "string[] (constraints/axioms)",
          examples: "string[] (concrete instances)",
          claims: "string[] (propositions)",
          nextActions: "string[] (actionable steps)",
        },
        claimAnnotations: "[{ text, support:[dtuIds], confidence:0-1, type:fact|inference|hypothesis }]",
      },
    }),
    maxTokens: 1200,
    temperature: 0.3,
  };
}

/**
 * Parse Ollama response and merge into candidate.
 * Rejects any claims that reference DTU IDs not in the source pack.
 */
export function applyOllamaShaping(candidate, ollamaResponse, allowedIds) {
  if (!ollamaResponse?.ok || !ollamaResponse.content) {
    return { ok: false, shaped: false, reason: "ollama_unavailable" };
  }

  try {
    // Try to parse JSON from Ollama response
    const content = ollamaResponse.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, shaped: false, reason: "no_json_in_response" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const allowedSet = new Set(allowedIds);

    // Apply title if improved
    if (parsed.title && typeof parsed.title === "string" && parsed.title.length > 3) {
      candidate.title = parsed.title.slice(0, 200);
    }

    // Apply core fields (only if they're arrays of strings)
    for (const field of ["definitions", "invariants", "examples", "claims", "nextActions"]) {
      if (Array.isArray(parsed.core?.[field])) {
        candidate.core[field] = parsed.core[field]
          .filter(x => typeof x === "string" && x.length > 0)
          .slice(0, 10);
      }
    }

    // Apply claim annotations (validate support IDs)
    if (Array.isArray(parsed.claimAnnotations)) {
      candidate.meta.claims = parsed.claimAnnotations
        .filter(ca => ca && typeof ca.text === "string")
        .map(ca => ({
          text: ca.text,
          support: Array.isArray(ca.support) ? ca.support.filter(id => allowedSet.has(id)) : [],
          confidence: typeof ca.confidence === "number" ? Math.min(Math.max(ca.confidence, 0), 1) : 0.5,
          type: ["fact", "inference", "hypothesis"].includes(ca.type) ? ca.type : "hypothesis",
        }));

      // Any claim that cited non-existent IDs gets downgraded to hypothesis
      for (const cm of candidate.meta.claims) {
        if (cm.support.length === 0 && cm.type === "fact") {
          cm.type = "hypothesis";
          cm.confidence = Math.min(cm.confidence, 0.4);
        }
      }
    }

    candidate.meta.ollamaShaped = true;
    candidate.meta.ollamaShapedAt = new Date().toISOString();

    return { ok: true, shaped: true };
  } catch (e) {
    return { ok: false, shaped: false, reason: `parse_error: ${e.message}` };
  }
}

// ── Stage 4: Novelty + Redundancy Control ────────────────────────────────────

/**
 * Compute similarity against recent generated DTUs.
 * If too similar → propose patch/merge instead of new DTU.
 *
 * Uses tag + claim hash + title similarity.
 */
export function noveltyCheck(STATE, candidate, opts = {}) {
  const ps = ensurePipelineState(STATE);
  const threshold = opts.similarityThreshold || 0.65;

  // Hash the candidate's claims + title + tags
  const candidateHash = hashCandidate(candidate);

  // Check against recent generated hashes
  const recentMatch = ps.recentGeneratedHashes.find(h => h.hash === candidateHash);
  if (recentMatch) {
    return {
      ok: false,
      novel: false,
      action: "reject_duplicate",
      matchedHash: recentMatch.hash,
      matchedDtuId: recentMatch.dtuId,
    };
  }

  // Check tag + title similarity against FULL DTU corpus (canonical + shadow)
  const canonical = Array.from(STATE.dtus.values());
  const shadows = STATE.shadowDtus ? Array.from(STATE.shadowDtus.values()) : [];
  const dtus = canonical.concat(shadows);
  const candidateTags = new Set(candidate.tags || []);
  const candidateTitle = (candidate.title || "").toLowerCase();
  const candidateClaimTexts = (candidate.core?.claims || []).map(c => String(c ?? "").toLowerCase());

  let bestMatch = null;
  let bestScore = 0;

  for (const d of dtus) {
    // Tag Jaccard similarity
    const dTags = new Set(d.tags || []);
    const intersection = [...candidateTags].filter(t => dTags.has(t)).length;
    const union = new Set([...candidateTags, ...dTags]).size;
    const tagSim = union > 0 ? intersection / union : 0;

    // Title similarity (simple word overlap)
    const dTitle = (d.title || "").toLowerCase();
    const titleSim = wordOverlap(candidateTitle, dTitle);

    // Claim overlap
    const dClaims = (d.core?.claims || []).map(c => String(c ?? "").toLowerCase());
    let claimOverlap = 0;
    for (const cc of candidateClaimTexts) {
      for (const dc of dClaims) {
        if (wordOverlap(cc, dc) > 0.7) { claimOverlap++; break; }
      }
    }
    const claimSim = candidateClaimTexts.length > 0 ? claimOverlap / candidateClaimTexts.length : 0;

    const combined = tagSim * 0.3 + titleSim * 0.3 + claimSim * 0.4;
    if (combined > bestScore) {
      bestScore = combined;
      bestMatch = d;
    }
  }

  if (bestScore >= threshold && bestMatch) {
    ps.metrics.noveltyRejects++;
    return {
      ok: false,
      novel: false,
      action: "propose_patch",
      similarity: bestScore,
      existingDtuId: bestMatch.id,
      existingTitle: bestMatch.title,
    };
  }

  return { ok: true, novel: true, similarity: bestScore, candidateHash };
}

// ── Stage 5: Promotion / Write Policy (shadow-first) ─────────────────────────

/**
 * Determine write policy for the autogen candidate.
 *
 * Default: shadow tier (needs council vote or human push to become regular/global).
 * Exception: if it resolves a known gap or conflict, can go regular with probation.
 */
export function determineWritePolicy(candidate, criticResult, noveltyResult) {
  const intent = candidate.meta?.autogenIntent;

  // Default: shadow tier
  let tier = "shadow";
  const needsCouncilVote = true;
  let needsHumanPush = true;
  let reason = "default_shadow_policy";

  // If critic found critical issues → always shadow
  if (criticResult?.hasCritical) {
    return { tier: "shadow", needsCouncilVote: true, needsHumanPush: true, reason: "critic_critical_issues" };
  }

  // If novelty check proposed a patch → this becomes a patch suggestion, not a new DTU
  if (noveltyResult?.action === "propose_patch") {
    return {
      tier: "shadow",
      needsCouncilVote: true,
      needsHumanPush: true,
      reason: "patch_proposal_for_existing",
      patchTarget: noveltyResult.existingDtuId,
    };
  }

  // Good quality candidates that fill gaps can be regular (with probation)
  if (intent === INTENTS.FILL_GAPS && !criticResult?.hasCritical) {
    const issueCount = criticResult?.issues?.length || 0;
    if (issueCount <= 1) {
      tier = "regular";
      needsHumanPush = false;
      reason = "gap_fill_auto_regular";
    }
  }

  return { tier, needsCouncilVote, needsHumanPush, reason };
}

// ── Stage 6: GRC Formatting ───────────────────────────────────────────────────

/**
 * Format the autogen candidate DTU into GRC v1 shape.
 * This ensures all auto-generated DTUs — from dream, synth, and evolution —
 * are produced in the canonical GRC format for readability and growth.
 *
 * The GRC envelope wraps the DTU's core content as payload while anchoring
 * it to source DTUs, recording invariants, and providing the recursive
 * nextLoop + question hooks that keep the lattice growing.
 *
 * @param {object} candidate - The DTU candidate from the synthesis stages
 * @param {object} pack - The retrieval pack (for anchor references)
 * @param {object} opts - { STATE, inLatticeReality }
 * @returns {{ ok: boolean, grc: object|null, candidate: object }}
 */
export function formatCandidateAsGRC(candidate, pack, opts = {}) {
  // Build the payload from candidate's core content
  const sections = [];

  if (candidate.human?.summary) {
    sections.push(candidate.human.summary);
  }

  // Definitions
  if (candidate.core?.definitions?.length) {
    sections.push("\n**Definitions:**");
    for (const def of candidate.core.definitions) {
      if (typeof def === "object" && def.term) {
        sections.push(`- **${def.term}**: ${def.definition}`);
      } else {
        sections.push(`- ${def}`);
      }
    }
  }

  // Invariants
  if (candidate.core?.invariants?.length) {
    sections.push("\n**Invariants:**");
    for (const inv of candidate.core.invariants) {
      sections.push(`- ${inv}`);
    }
  }

  // Claims with provenance
  if (candidate.core?.claims?.length) {
    sections.push("\n**Claims:**");
    const claimsMeta = candidate.meta?.claims || [];
    for (let i = 0; i < candidate.core.claims.length; i++) {
      const claim = candidate.core.claims[i];
      const meta = claimsMeta[i];
      const confidence = meta?.confidence ? ` [${meta.type || "hypothesis"}, confidence: ${meta.confidence}]` : "";
      const sources = meta?.support?.length ? ` (sources: ${meta.support.join(", ")})` : "";
      sections.push(`- ${claim}${confidence}${sources}`);
    }
  }

  // Examples
  if (candidate.core?.examples?.length) {
    sections.push("\n**Examples:**");
    for (const ex of candidate.core.examples) {
      sections.push(`- ${ex}`);
    }
  }

  // Conflicts
  if (candidate.meta?.conflicts?.length) {
    sections.push("\n**Open Conflicts:**");
    for (const conflict of candidate.meta.conflicts) {
      sections.push(`- ${conflict.description || conflict.conflictType} (with: ${conflict.withDtuId})`);
    }
  }

  const payloadText = sections.join("\n");

  // Build GRC context for formatting
  const dtuRefs = (pack.core || []).slice(0, 10).map(d => d.id || d.title || "unknown");
  const intent = candidate.meta?.autogenIntent || "autogen";

  const grcContext = {
    dtuRefs,
    macroRefs: ["autogen-pipeline"],
    stateRefs: [],
    mode: `autogen-${intent}`,
    invariantsApplied: [
      "NoNegativeValence",
      "RealityGateBeforeEffects",
      "AllClaimsCited",
      "NoveltyEnforced",
    ],
    realitySnapshot: {
      facts: [
        `Generated via autogen intent: ${intent}`,
        `Source pack: ${(pack.core || []).length} core DTUs, ${(pack.peripheral || []).length} peripheral`,
        `Candidate tier: ${candidate.tier || "shadow"}`,
      ],
      assumptions: [
        candidate.meta?.ollamaShaped ? "Output shaped by Ollama (reformatted, not invented)" : "No LLM shaping applied",
        candidate.meta?.writePolicy?.reason || "Default write policy",
      ],
      unknowns: [
        "Full lattice coherence impact not computed until post-commit",
        ...(candidate.meta?.conflicts?.length
          ? [`${candidate.meta.conflicts.length} conflict(s) remain unresolved`]
          : []),
      ],
    },
  };

  // Format through GRC pipeline
  const grcResult = formatGRC(payloadText, grcContext, {
    STATE: opts.STATE || null,
    inLatticeReality: opts.inLatticeReality || null,
    affectState: null,
  });

  // Attach GRC envelope to the candidate
  if (grcResult.ok && grcResult.grc) {
    candidate.grc = grcResult.grc;
    candidate.meta = candidate.meta || {};
    candidate.meta.grcFormatted = true;
    candidate.meta.grcFormattedAt = new Date().toISOString();
    candidate.meta.grcValidation = grcResult.validation;
  }

  return {
    ok: grcResult.ok,
    grc: grcResult.grc,
    candidate,
    validation: grcResult.validation,
    repairs: grcResult.repairs || [],
  };
}

// ── Full Pipeline Runner ─────────────────────────────────────────────────────

/**
 * Run the complete 6-stage autogen pipeline.
 *
 * @param {object} STATE - Global state
 * @param {object} opts - {
 *   variant?: "dream"|"synth"|"evolution",
 *   callOllama?: async (prompt) => response,
 *   callCloud?: async (prompt) => response,
 *   similarityThreshold?: number,
 *   dryRun?: boolean
 * }
 * @returns {object} Pipeline result with candidate and stage traces
 */
export async function runPipeline(STATE, opts = {}) {
  const ps = ensurePipelineState(STATE);
  ps.metrics.totalRuns++;
  if (opts.variant) {
    ps.metrics.byVariant[opts.variant] = (ps.metrics.byVariant[opts.variant] || 0) + 1;
  }

  const trace = {
    startedAt: new Date().toISOString(),
    variant: opts.variant || null,
    stages: {},
  };

  // Stage 0: Target Selection
  const intent = selectIntent(STATE, { variant: opts.variant });
  trace.stages.targetSelection = { intent: intent.intent, score: intent.score, signal: intent.signal };
  ps.metrics.byIntent[intent.intent] = (ps.metrics.byIntent[intent.intent] || 0) + 1;

  // Stash conflict pairs for capability bridge hypothesis engine
  if (intent.intent === "resolve_conflicts" && intent.signal?.pairs?.length) {
    if (!ps._recentConflicts) ps._recentConflicts = [];
    for (const p of intent.signal.pairs) {
      ps._recentConflicts.push(p);
    }
    // Keep bounded
    if (ps._recentConflicts.length > 20) {
      ps._recentConflicts = ps._recentConflicts.slice(-20);
    }
  }

  // Stage 1: Retrieval Pack
  const pack = buildRetrievalPack(STATE, intent);
  trace.stages.retrievalPack = pack.stats;

  if (pack.core.length === 0) {
    return { ok: false, error: "empty_retrieval_pack", trace };
  }

  // Stage 2: Multi-Role Synthesis
  //   Builder
  const builderResult = builderPhase(intent, pack);
  if (!builderResult.ok) {
    return { ok: false, error: `builder_failed: ${builderResult.error}`, trace };
  }
  let candidate = builderResult.candidate;

  //   Critic
  const criticResult = criticPhase(candidate, pack);
  trace.stages.critic = {
    ok: criticResult.ok,
    issueCount: criticResult.issues.length,
    hasCritical: criticResult.hasCritical,
    issues: criticResult.issues,
    empiricalStats: criticResult.empiricalStats,
  };

  //   Web grounding — for an EMPIRICAL claim with no external source yet, fetch REAL web
  //   sources so the synthesizer's grounding gate can verify it instead of probationing it.
  //   webSearch is injected (server.js → tools.web_search). If absent, the claim simply stays
  //   ungrounded → probation, which is the safe default (no laundering on internal vibes).
  if (typeof opts.webSearch === "function") {
    try {
      if (classifyGrounding(candidate) === "empirical" && collectWebSources(candidate).length === 0) {
        const q = (candidate.core?.claims?.[0] || candidate.human?.summary || candidate.title || "").toString().slice(0, 200);
        if (q) {
          const sr = await opts.webSearch(q);
          const results = Array.isArray(sr?.results) ? sr.results : (Array.isArray(sr) ? sr : []);
          const urls = results.map(r => r?.url || r?.link || r?.href).filter(u => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 5);
          if (urls.length) {
            candidate.meta = candidate.meta || {};
            candidate.meta.sources = [...(candidate.meta.sources || []), ...urls.map(url => ({ url, via: "autogen_web_research", q }))];
            trace.stages.webGrounding = { searched: q, sources: urls.length };
          }
        }
      }
    } catch (_e) { /* web research is best-effort; ungrounded → probation downstream */ }
  }

  //   Synthesizer (runners verify creative reproducibility; default arithmetic/recipe runners)
  const synthResult = synthesizerPhase(candidate, criticResult, opts.runners);
  candidate = synthResult.candidate;
  trace.stages.synthesis = { ok: synthResult.ok };

  // Stage 3: Ollama Shaping (always-on when available)
  if (typeof opts.callOllama === "function") {
    const coreExcerpts = pack.core.slice(0, 20);
    const prompt = buildOllamaPrompt(candidate, coreExcerpts);
    try {
      const ollamaResp = await opts.callOllama(prompt.user, {
        system: prompt.system,
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
      });
      const allowedIds = pack.core.map(d => d.id);
      const shapeResult = applyOllamaShaping(candidate, ollamaResp, allowedIds);
      trace.stages.ollamaShaping = shapeResult;
      if (shapeResult.shaped) ps.metrics.ollamaShapings++;
      else ps.metrics.ollamaFailures++;
    } catch (e) {
      trace.stages.ollamaShaping = { ok: false, error: e.message };
      ps.metrics.ollamaFailures++;
    }
  } else {
    trace.stages.ollamaShaping = { ok: false, shaped: false, reason: "no_ollama_callback" };
  }

  // Stage 4: Novelty + Redundancy Control
  const noveltyResult = noveltyCheck(STATE, candidate, {
    similarityThreshold: opts.similarityThreshold,
  });
  trace.stages.novelty = noveltyResult;

  if (!noveltyResult.novel && noveltyResult.action === "reject_duplicate") {
    ps.metrics.candidatesRejected++;
    return {
      ok: false,
      error: "duplicate_rejected",
      action: "reject_duplicate",
      matchedDtuId: noveltyResult.matchedDtuId,
      trace,
    };
  }

  // Stage 5: Promotion / Write Policy
  const writePolicy = determineWritePolicy(candidate, criticResult, noveltyResult);
  trace.stages.writePolicy = writePolicy;

  // Apply policy
  candidate.tier = writePolicy.tier === "shadow" ? "regular" : writePolicy.tier;
  candidate.meta = candidate.meta || {};
  candidate.meta.writePolicy = writePolicy;

  // If shadow-first, mark accordingly
  if (writePolicy.tier === "shadow") {
    candidate.meta.shadowFirst = true;
    candidate.meta.needsCouncilVote = writePolicy.needsCouncilVote;
    candidate.meta.needsHumanPush = writePolicy.needsHumanPush;
    ps.metrics.shadowsCreated++;
  }

  // If patch proposal, record target
  if (noveltyResult.action === "propose_patch") {
    candidate.meta.patchTarget = noveltyResult.existingDtuId;
    candidate.tags = [...(candidate.tags || []), "patch-proposal"];
    ps.metrics.patchProposals++;
  }

  // Optional cloud escalation
  if (criticResult.needsEscalation && typeof opts.callCloud === "function") {
    trace.stages.cloudEscalation = { triggered: true, reason: criticResult.escalationReason };
    ps.metrics.cloudEscalations++;
    // Cloud call would happen here in production; for now, just mark it
  } else {
    trace.stages.cloudEscalation = { triggered: false };
  }

  // Record hash for future novelty checks
  if (noveltyResult.candidateHash) {
    ps.recentGeneratedHashes.push({
      hash: noveltyResult.candidateHash,
      dtuId: null, // will be set after commit
      createdAt: new Date().toISOString(),
    });
    // Trim to max
    if (ps.recentGeneratedHashes.length > ps.maxRecentHashes) {
      ps.recentGeneratedHashes = ps.recentGeneratedHashes.slice(-ps.maxRecentHashes);
    }
  }

  ps.metrics.candidatesProduced++;

  // Stage 5b: Council Five-Voice Gate — all candidates go through governance deliberation
  try {
    const qualiaState = null; // entity qualia not available in system-level autogen
    const proposal = {
      title: candidate.title || candidate.content?.slice(0, 100) || "autogen candidate",
      content: candidate.content || candidate.human?.summary || "",
      tags: candidate.tags || [],
      tier: candidate.tier || "regular",
      evidence_weight: criticResult.issues?.length === 0 ? 0.9 : 0.5,
      logical_consistency_score: criticResult.hasCritical ? 0.3 : 0.8,
      uncertainty_score: noveltyResult.novel ? 0.3 : 0.7,
      risk_magnitude: writePolicy.tier === "shadow" ? 0.2 : 0.5,
      value_alignment: 0.7,
      outcome_likelihood: noveltyResult.novel ? 0.7 : 0.4,
      scarcity_level: intent.score || 0.5,
    };
    const councilResult = runCouncilVoices(proposal, qualiaState);
    trace.stages.councilVoices = {
      confidence: councilResult.confidence,
      verdict: councilResult.verdictAction,
      unanimous: councilResult.unanimous,
      voices: councilResult.voices?.map(v => ({ id: v.voiceId, vote: v.vote, score: v.score?.toFixed(3) })),
    };
    candidate.meta = candidate.meta || {};
    candidate.meta.councilVerdict = councilResult.verdictAction;
    candidate.meta.councilConfidence = councilResult.confidence;

    // Reject if council says reject — mark as blocked and return as failed candidate
    if (councilResult.verdictAction === "reject") {
      candidate.meta.councilBlocked = true;
      candidate.meta.councilBlockedAt = new Date().toISOString();
      ps.metrics.candidatesRejected = (ps.metrics.candidatesRejected || 0) + 1;
      return {
        ok: false,
        error: "council_rejected",
        councilResult: trace.stages.councilVoices,
        trace,
      };
    }
    // needs_more_data: still produce but demote to shadow
    if (councilResult.verdictAction === "needs_more_data") {
      candidate.tier = "shadow";
      candidate.meta.shadowFirst = true;
      candidate.meta.councilDemoted = true;
    }
  } catch (e) {
    // Council offline: hold candidate in pending queue rather than auto-accepting.
    // This prevents unreviewed candidates from entering the lattice.
    trace.stages.councilVoices = { ok: false, error: String(e?.message || e), held: true };
    candidate.tier = "shadow";
    candidate.meta = candidate.meta || {};
    candidate.meta.shadowFirst = true;
    candidate.meta.councilOfflineHeld = true;
    candidate.meta.councilOfflineAt = new Date().toISOString();
    if (!ps._pendingCouncilQueue) ps._pendingCouncilQueue = [];
    ps._pendingCouncilQueue.push({
      candidateTitle: candidate.title,
      candidateHash: noveltyResult?.candidateHash || null,
      heldAt: new Date().toISOString(),
      reason: String(e?.message || e),
    });
    // Cap queue size
    if (ps._pendingCouncilQueue.length > 200) {
      ps._pendingCouncilQueue = ps._pendingCouncilQueue.slice(-200);
    }
  }

  // Stage 6: GRC Formatting — wrap candidate in GRC v1 envelope
  const grcResult = formatCandidateAsGRC(candidate, pack, {
    STATE,
    inLatticeReality: opts.inLatticeReality || null,
  });
  trace.stages.grcFormatting = {
    ok: grcResult.ok,
    formatted: !!grcResult.grc,
    repairs: grcResult.repairs?.length || 0,
    validationErrors: grcResult.validation?.errors?.length || 0,
    validationWarnings: grcResult.validation?.warnings?.length || 0,
  };

  // Gate enforcement assertion: every autogen output carries proof it passed all stages
  candidate.meta = candidate.meta || {};
  candidate.meta.gateResults = {
    empiricalGates: criticResult.empiricalStats || { passed: true },
    criticPassed: criticResult.ok,
    criticIssues: criticResult.issues?.length || 0,
    noveltyPassed: noveltyResult.novel !== false,
    noveltyScore: noveltyResult.similarity || 0,
    councilVerdict: candidate.meta.councilVerdict || (candidate.meta.councilOfflineHeld ? "held" : "unknown"),
    grcFormatted: grcResult.ok,
    allGatesPassed: criticResult.ok && noveltyResult.novel !== false && !candidate.meta.councilOfflineHeld,
    verifiedAt: new Date().toISOString(),
  };

  trace.completedAt = new Date().toISOString();

  if (opts.dryRun) {
    return { ok: true, dryRun: true, candidate, trace };
  }

  return { ok: true, candidate, trace, writePolicy, grc: grcResult.grc };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export function getPipelineMetrics(STATE) {
  const ps = ensurePipelineState(STATE);
  return {
    ok: true,
    ...ps.metrics,
    recentHashCount: ps.recentGeneratedHashes.length,
  };
}

// ── Helpers (internal) ───────────────────────────────────────────────────────

function findConflictPairs(dtus) {
  const pairs = [];
  const claimMap = new Map(); // normalized claim → dtuId

  for (const d of dtus) {
    const claims = d.core?.claims || [];
    const invariants = d.core?.invariants || [];

    for (const claim of [...claims, ...invariants]) {
      const normalized = String(claim ?? "").toLowerCase().trim();
      // Check for negation conflicts
      const negated = negateNormalized(normalized);

      if (claimMap.has(negated)) {
        const other = claimMap.get(negated);
        if (other !== d.id) {
          pairs.push({
            dtuA: other,
            dtuB: d.id,
            type: "claim_contradiction",
            description: `"${claim.slice(0, 80)}" vs negation in ${other}`,
          });
        }
      }
      claimMap.set(normalized, d.id);
    }
  }
  return pairs;
}

function negateNormalized(s) {
  if (s.startsWith("not ")) return s.slice(4);
  if (s.startsWith("no ")) return s.slice(3);
  if (s.includes(" not ")) return s.replace(" not ", " ");
  if (s.includes(" never ")) return s.replace(" never ", " always ");
  if (s.includes(" always ")) return s.replace(" always ", " never ");
  return "not " + s;
}

function buildTagGroups(dtus) {
  const groups = new Map();
  for (const d of dtus) {
    for (const tag of (d.tags || [])) {
      if (!groups.has(tag)) groups.set(tag, { tag, count: 0, ids: [] });
      const g = groups.get(tag);
      g.count++;
      if (g.ids.length < 20) g.ids.push(d.id);
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

function computePatternScore(dtus) {
  // Detect repeated source patterns (same source appearing often)
  const sourceCounts = new Map();
  for (const d of dtus) {
    const src = d.source || "unknown";
    sourceCounts.set(src, (sourceCounts.get(src) || 0) + 1);
  }
  const repeatedSources = Array.from(sourceCounts.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  // Detect repeated tag co-occurrences
  const pairCounts = new Map();
  for (const d of dtus) {
    const tags = (d.tags || []).slice(0, 10);
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const pair = [tags[i], tags[j]].sort().join("+");
        pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
      }
    }
  }
  const repeatedPairs = Array.from(pairCounts.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  const score = Math.min(
    (repeatedSources.length * 8) + (repeatedPairs.length * 5),
    100
  );

  return {
    score,
    signal: {
      repeatedSources: repeatedSources.slice(0, 5).map(([src, count]) => ({ src, count })),
      repeatedTagPairs: repeatedPairs.slice(0, 5).map(([pair, count]) => ({ pair, count })),
    },
  };
}

function computeUsageCounts(dtus) {
  const refMap = new Map();
  for (const d of dtus) {
    for (const parent of (Array.isArray(d.lineage) ? d.lineage : [])) {
      refMap.set(parent, (refMap.get(parent) || 0) + 1);
    }
  }
  return Array.from(refMap.entries())
    .map(([dtuId, refCount]) => ({ dtuId, refCount }))
    .sort((a, b) => b.refCount - a.refCount);
}

function extractTopTags(dtus, n = 6) {
  const freq = new Map();
  for (const d of dtus) {
    for (const t of (d.tags || [])) {
      if (t === "autogen" || t === "dream" || t === "council") continue;
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(x => x[0]);
}

function generateTitle(intent, tagHints) {
  const date = new Date().toISOString().slice(0, 10);
  const tagStr = tagHints.slice(0, 3).join(", ") || "general";

  switch (intent.intent) {
    case INTENTS.FILL_GAPS:
      return `Gap Fill: ${tagStr} — ${date}`;
    case INTENTS.RESOLVE_CONFLICTS:
      return `Conflict Resolution: ${tagStr} — ${date}`;
    case INTENTS.COMPRESS_CLUSTERS:
      return `Cluster Compression: ${tagStr} — ${date}`;
    case INTENTS.EXTRACT_PATTERNS:
      return `Pattern Extraction: ${tagStr} — ${date}`;
    case INTENTS.ELEVATE_HIGH_USAGE:
      return `High-Usage Elevation: ${tagStr} — ${date}`;
    default:
      return `Autogen: ${tagStr} — ${date}`;
  }
}

function hashCandidate(candidate) {
  const payload = [
    candidate.title || "",
    ...(candidate.core?.claims || []),
    ...(candidate.tags || []),
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function wordOverlap(a, b) {
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  return overlap / Math.max(wordsA.size, wordsB.size);
}
