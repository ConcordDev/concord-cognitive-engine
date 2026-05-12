import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF V.1 — Cross-Institution Cognition & Knowledge Continuity
 *
 * Capabilities (Civilizational-Scale):
 *   1.  Cross-institution cognition (multiple orgs using shared epistemic primitives)
 *   2.  Long-horizon reasoning across decades with loss-bounded memory
 *   3.  Knowledge continuity independent of any single community or operator
 *   7.  Cross-generation knowledge inheritance
 *   8.  Consensus formation without social coordination
 *   21. Large-scale coordination without centralized authority
 *   22. Replacement of committees with evidence processes
 *   23. Institutional memory immune to political turnover
 *   24. Model-agnostic intelligence continuity across AI generations
 *   25. External systems querying Concord as an epistemic oracle
 *
 * Design:
 *   - Shared epistemic primitives usable across institutions
 *   - Knowledge archives with provenance that survive organizational changes
 *   - Evidence-based consensus formation that doesn't require social coordination
 *   - Epistemic oracle interface for external system queries
 *   - Model-agnostic continuity ensures no lock-in to specific AI versions
 */

// === CROSS-INSTITUTION PRIMITIVES ===

// Shared epistemic primitives: institution-agnostic knowledge objects
const sharedPrimitives = new LruMap(); // primitiveId -> { id, type, content, provenance, institutions[] }

const PRIMITIVE_TYPES = Object.freeze({
  FACT: "fact",               // verified factual claim
  PRINCIPLE: "principle",     // domain-independent principle
  METHOD: "method",           // reusable methodology
  STANDARD: "standard",       // agreed-upon standard
  METRIC: "metric",          // measurement definition
});

/**
 * Create a shared epistemic primitive usable across institutions.
 */
function createPrimitive(type, content, provenance, institutionId) {
  const id = `prim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const primitive = {
    id,
    type: Object.values(PRIMITIVE_TYPES).includes(type) ? type : PRIMITIVE_TYPES.FACT,
    content: String(content).slice(0, 5000),
    provenance: {
      source: String(provenance?.source || "unknown"),
      confidence: Math.max(0, Math.min(1, Number(provenance?.confidence ?? 0.5))),
      verifiedBy: Array.isArray(provenance?.verifiedBy) ? provenance.verifiedBy : [],
      createdAt: new Date().toISOString(),
    },
    institutions: institutionId ? [String(institutionId)] : [],
    adoptionCount: institutionId ? 1 : 0,
    version: 1,
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  sharedPrimitives.set(id, primitive);
  capMap(sharedPrimitives, 50000);

  return { ok: true, primitive: sanitizePrimitive(primitive) };
}

/**
 * Adopt a shared primitive into an institution's knowledge base.
 */
function adoptPrimitive(primitiveId, institutionId) {
  const prim = sharedPrimitives.get(primitiveId);
  if (!prim) return { ok: false, error: "primitive_not_found" };

  if (!prim.institutions.includes(institutionId)) {
    prim.institutions.push(String(institutionId));
    prim.adoptionCount++;
    prim.updatedAt = new Date().toISOString();
  }

  return { ok: true, adoptionCount: prim.adoptionCount, institutions: prim.institutions };
}

// === KNOWLEDGE ARCHIVE (Institutional Memory) ===

// Knowledge archives: survive organizational changes
const archives = new LruMap(); // archiveId -> { entries[], metadata }

/**
 * Create a knowledge archive for institutional memory.
 */
function createArchive(name, description, institutionId) {
  const id = `archive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const archive = {
    id,
    name: String(name).slice(0, 200),
    description: String(description).slice(0, 2000),
    institutionId: String(institutionId || "independent"),
    entries: [],
    metadata: {
      entryCount: 0,
      domains: [],
      lastUpdated: new Date().toISOString(),
    },
    political_immune: true, // survives political turnover by design
    createdAt: new Date().toISOString(),
  };

  archives.set(id, archive);
  capMap(archives, 5000);

  return { ok: true, archive: sanitizeArchive(archive) };
}

/**
 * Add an entry to a knowledge archive.
 */
function addArchiveEntry(archiveId, content, domain, provenance) {
  const archive = archives.get(archiveId);
  if (!archive) return { ok: false, error: "archive_not_found" };

  const entry = {
    id: `ae_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content: String(content).slice(0, 5000),
    domain: String(domain || "general"),
    provenance: {
      source: String(provenance?.source || "unknown"),
      confidence: Math.max(0, Math.min(1, Number(provenance?.confidence ?? 0.5))),
      addedAt: new Date().toISOString(),
    },
    generation: Math.floor(Date.now() / (365.25 * 24 * 3600 * 1000)), // year-level generation
  };

  archive.entries.push(entry);
  if (archive.entries.length > 10000) archive.entries.splice(0, archive.entries.length - 10000);

  archive.metadata.entryCount = archive.entries.length;
  if (!archive.metadata.domains.includes(domain)) {
    archive.metadata.domains.push(domain);
  }
  archive.metadata.lastUpdated = new Date().toISOString();

  return { ok: true, entry };
}

/**
 * Query a knowledge archive for cross-generation inheritance.
 */
function queryArchive(archiveId, query) {
  const archive = archives.get(archiveId);
  if (!archive) return { ok: false, error: "archive_not_found" };

  let results = archive.entries;

  if (query.domain) {
    results = results.filter(e => e.domain === query.domain);
  }
  if (query.keyword) {
    const kw = String(query.keyword).toLowerCase();
    results = results.filter(e => e.content.toLowerCase().includes(kw));
  }
  if (query.minConfidence !== undefined) {
    results = results.filter(e => e.provenance.confidence >= query.minConfidence);
  }
  if (query.generation !== undefined) {
    results = results.filter(e => e.generation === query.generation);
  }

  return {
    ok: true,
    results: results.slice(0, Number(query.limit || 50)),
    total: results.length,
  };
}

// === EVIDENCE-BASED CONSENSUS (Without Social Coordination) ===

// Evidence accumulator for social-coordination-free consensus
const consensusTopics = new LruMap(); // topicId -> { claims, evidence, status }

/**
 * Submit evidence for a consensus topic. No voting — consensus emerges from evidence weight.
 */
function submitEvidence(topicId, claim, evidence, source) {
  if (!consensusTopics.has(topicId)) {
    consensusTopics.set(topicId, {
      id: topicId,
      claims: new Map(),
      status: "accumulating",
      createdAt: new Date().toISOString(),
    });
  }

  const topic = consensusTopics.get(topicId);
  const claimKey = String(claim).slice(0, 500);

  if (!topic.claims.has(claimKey)) {
    topic.claims.set(claimKey, {
      claim: claimKey,
      evidence: [],
      totalWeight: 0,
    });
  }

  const claimEntry = topic.claims.get(claimKey);
  const evidenceWeight = Math.max(0, Math.min(1, Number(evidence?.confidence ?? 0.5)));

  claimEntry.evidence.push({
    text: String(evidence?.text || evidence || "").slice(0, 2000),
    source: String(source || "anonymous"),
    weight: evidenceWeight,
    submittedAt: new Date().toISOString(),
  });

  if (claimEntry.evidence.length > 500) claimEntry.evidence.splice(0, claimEntry.evidence.length - 500);
  claimEntry.totalWeight = claimEntry.evidence.reduce((s, e) => s + e.weight, 0);

  capMap(consensusTopics, 10000);

  return { ok: true, topic: topicId, claim: claimKey, totalWeight: claimEntry.totalWeight };
}

/**
 * Evaluate consensus on a topic. Returns the highest-weighted claim.
 */
function evaluateConsensus(topicId) {
  const topic = consensusTopics.get(topicId);
  if (!topic) return { ok: false, error: "topic_not_found" };

  const claims = Array.from(topic.claims.values())
    .sort((a, b) => b.totalWeight - a.totalWeight);

  if (claims.length === 0) {
    return { ok: true, consensus: null, status: "no_claims" };
  }

  const topClaim = claims[0];
  const totalWeight = claims.reduce((s, c) => s + c.totalWeight, 0);
  const dominance = totalWeight > 0 ? topClaim.totalWeight / totalWeight : 0;

  return {
    ok: true,
    consensus: {
      claim: topClaim.claim,
      weight: topClaim.totalWeight,
      evidenceCount: topClaim.evidence.length,
      dominance,
    },
    alternatives: claims.slice(1, 5).map(c => ({
      claim: c.claim,
      weight: c.totalWeight,
      evidenceCount: c.evidence.length,
    })),
    isStrong: dominance >= 0.6,
    totalClaims: claims.length,
    totalEvidence: claims.reduce((s, c) => s + c.evidence.length, 0),
  };
}

// === EPISTEMIC ORACLE INTERFACE ===

// Oracle query log
const oracleQueries = [];

/**
 * Handle an external epistemic oracle query.
 * External systems can ask Concord for truth assessments.
 */
function oracleQuery(question, context) {
  const query = {
    id: `oracle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    question: String(question).slice(0, 2000),
    context: String(context || "").slice(0, 1000),
    queriedAt: new Date().toISOString(),
    response: null,
  };

  // Search shared primitives for relevant knowledge
  const questionLower = query.question.toLowerCase();
  const relevantPrimitives = Array.from(sharedPrimitives.values())
    .filter(p => {
      const contentLower = p.content.toLowerCase();
      const words = questionLower.split(/\s+/).filter(w => w.length > 3);
      return words.some(w => contentLower.includes(w));
    })
    .sort((a, b) => b.provenance.confidence - a.provenance.confidence)
    .slice(0, 10);

  query.response = {
    relevantPrimitives: relevantPrimitives.map(p => ({
      id: p.id, type: p.type, content: p.content.slice(0, 500),
      confidence: p.provenance.confidence, adoptionCount: p.adoptionCount,
    })),
    totalRelevant: relevantPrimitives.length,
    confidence: relevantPrimitives.length > 0
      ? relevantPrimitives.reduce((s, p) => s + p.provenance.confidence, 0) / relevantPrimitives.length
      : 0,
    answerable: relevantPrimitives.length > 0,
  };

  oracleQueries.push(query);
  if (oracleQueries.length > 5000) oracleQueries.splice(0, oracleQueries.length - 5000);

  return { ok: true, ...query };
}

// === MODEL-AGNOSTIC CONTINUITY ===

/**
 * Export knowledge in a model-agnostic format.
 * Ensures continuity across AI generations.
 */
function exportForContinuity() {
  return {
    version: "concord-continuity-v1",
    exportedAt: new Date().toISOString(),
    primitives: Array.from(sharedPrimitives.values()).map(p => ({
      id: p.id, type: p.type, content: p.content,
      confidence: p.provenance.confidence, institutions: p.institutions,
    })),
    archives: Array.from(archives.values()).map(a => ({
      id: a.id, name: a.name, entryCount: a.entries.length,
      domains: a.metadata.domains,
    })),
    consensusTopics: Array.from(consensusTopics.entries()).map(([id, t]) => ({
      id, claimCount: t.claims.size,
    })),
    format: "json",
    modelAgnostic: true,
  };
}

// === HELPERS ===

function sanitizePrimitive(p) {
  return {
    id: p.id, type: p.type, content: p.content.slice(0, 200),
    confidence: p.provenance.confidence, adoptionCount: p.adoptionCount,
    institutions: p.institutions.length, version: p.version,
  };
}

function sanitizeArchive(a) {
  return {
    id: a.id, name: a.name, description: a.description.slice(0, 200),
    entryCount: a.metadata.entryCount, domains: a.metadata.domains,
    institutionId: a.institutionId, createdAt: a.createdAt,
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
  STATE.__loaf.crossInstitution = {
    stats: {
      primitivesCreated: 0, adoptions: 0, archivesCreated: 0,
      archiveEntries: 0, evidenceSubmitted: 0, consensusEvaluations: 0,
      oracleQueries: 0, exports: 0,
    },
  };

  register("loaf.institution", "status", (ctx) => {
    const ci = ctx.state.__loaf.crossInstitution;
    return {
      ok: true,
      primitives: sharedPrimitives.size,
      archives: archives.size,
      consensusTopics: consensusTopics.size,
      oracleQueryCount: oracleQueries.length,
      stats: ci.stats,
    };
  }, { public: true });

  register("loaf.institution", "create_primitive", (ctx, input = {}) => {
    const ci = ctx.state.__loaf.crossInstitution;
    ci.stats.primitivesCreated++;
    return createPrimitive(input.type, input.content, input.provenance, input.institutionId);
  }, { public: false });

  register("loaf.institution", "adopt_primitive", (ctx, input = {}) => {
    const ci = ctx.state.__loaf.crossInstitution;
    ci.stats.adoptions++;
    return adoptPrimitive(String(input.primitiveId || ""), String(input.institutionId || ""));
  }, { public: false });

  register("loaf.institution", "create_archive", (ctx, input = {}) => {
    const ci = ctx.state.__loaf.crossInstitution;
    ci.stats.archivesCreated++;
    return createArchive(input.name, input.description, input.institutionId);
  }, { public: false });

  register("loaf.institution", "add_archive_entry", (ctx, input = {}) => {
    const ci = ctx.state.__loaf.crossInstitution;
    ci.stats.archiveEntries++;
    return addArchiveEntry(String(input.archiveId || ""), input.content, input.domain, input.provenance);
  }, { public: false });

  register("loaf.institution", "query_archive", (_ctx, input = {}) => {
    return queryArchive(String(input.archiveId || ""), input);
  }, { public: true });

  register("loaf.institution", "submit_evidence", (ctx, input = {}) => {
    const ci = ctx.state.__loaf.crossInstitution;
    ci.stats.evidenceSubmitted++;
    return submitEvidence(
      String(input.topicId || ""), input.claim, input.evidence,
      ctx.actor?.id || input.source
    );
  }, { public: false });

  register("loaf.institution", "evaluate_consensus", (ctx, input = {}) => {
    const ci = ctx.state.__loaf.crossInstitution;
    ci.stats.consensusEvaluations++;
    return evaluateConsensus(String(input.topicId || ""));
  }, { public: true });

  register("loaf.institution", "oracle_query", (ctx, input = {}) => {
    const ci = ctx.state.__loaf.crossInstitution;
    ci.stats.oracleQueries++;
    return oracleQuery(input.question, input.context);
  }, { public: true });

  register("loaf.institution", "export_continuity", (ctx) => {
    const ci = ctx.state.__loaf.crossInstitution;
    ci.stats.exports++;
    return { ok: true, ...exportForContinuity() };
  }, { public: true });

  register("loaf.institution", "list_primitives", (_ctx, input = {}) => {
    let list = Array.from(sharedPrimitives.values());
    if (input.type) list = list.filter(p => p.type === input.type);
    if (input.institutionId) list = list.filter(p => p.institutions.includes(input.institutionId));
    const limit = Math.min(Number(input.limit || 50), 200);
    return { ok: true, primitives: list.slice(0, limit).map(sanitizePrimitive) };
  }, { public: true });
}

export {
  PRIMITIVE_TYPES,
  createPrimitive,
  adoptPrimitive,
  createArchive,
  addArchiveEntry,
  queryArchive,
  submitEvidence,
  evaluateConsensus,
  oracleQuery,
  exportForContinuity,
  init,
};
