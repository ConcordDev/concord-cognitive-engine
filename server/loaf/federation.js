import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF II.7 — Federation
 *
 * Export: provenance, evidence, dispute history, license/royalty terms
 * Import: local verification, ontology mapping, sandbox until trusted
 * Reputation attaches to artifacts, not identities.
 */

// Artifact reputation store (attached to artifacts, NOT identities)
const artifactReputation = new Map(); // artifactId -> { score, votes, history }

// Federation peers
const peers = new LruMap(); // peerId -> { id, endpoint, trust, lastSeen }

// Import sandbox queue
const importQueue = []; // items pending local verification

/**
 * Export an artifact for federation.
 * Includes: provenance, evidence, dispute history, license terms.
 */
function exportArtifact(artifact, evidenceBundle, disputeHistory, licenseTerms) {
  return {
    version: "loaf-federation-v1",
    exportedAt: new Date().toISOString(),
    artifact: {
      id: artifact.id,
      type: artifact.type || "dtu",
      title: artifact.title || artifact.name || "",
      content: artifact.content || artifact.text || artifact.description || "",
      tags: artifact.tags || [],
      tier: artifact.tier || "regular",
    },
    provenance: artifact.provenance || {
      source_type: "local",
      source_id: artifact.source || "unknown",
      confidence: 0.5,
      created_at: artifact.createdAt || new Date().toISOString(),
    },
    evidence: evidenceBundle || { evidence: [], counterEvidence: [] },
    disputeHistory: Array.isArray(disputeHistory) ? disputeHistory.map(d => ({
      id: d.id,
      status: d.status,
      claims: d.claims,
      confidence: d.confidence,
      resolvedAt: d.resolvedAt,
    })) : [],
    license: {
      type: licenseTerms?.type || "MIT",
      royaltyPct: Number(licenseTerms?.royaltyPct ?? 0),
      attribution: licenseTerms?.attribution || false,
      terms: String(licenseTerms?.terms || ""),
    },
    reputation: getArtifactReputation(artifact.id),
  };
}

/**
 * Import a federated artifact. Goes through local verification and sandbox.
 */
function importArtifact(federatedData, localVerifier) {
  if (!federatedData || federatedData.version !== "loaf-federation-v1") {
    return { ok: false, error: "invalid_federation_format" };
  }

  const importEntry = {
    id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    data: federatedData,
    status: "pending_verification",  // pending_verification -> verified | rejected | sandboxed
    importedAt: new Date().toISOString(),
    verificationResult: null,
    ontologyMapping: null,
    trust: "untrusted",  // untrusted -> sandboxed -> trusted
  };

  // Run local verification if verifier provided
  if (typeof localVerifier === "function") {
    try {
      const verification = localVerifier(federatedData);
      importEntry.verificationResult = verification;
      importEntry.status = verification.pass ? "verified" : "rejected";
    } catch (e) {
      importEntry.status = "rejected";
      importEntry.verificationResult = { pass: false, error: String(e.message || e) };
    }
  }

  // Sandbox until trusted (even if verified)
  if (importEntry.status === "verified") {
    importEntry.trust = "sandboxed";
    importEntry.status = "sandboxed";
  }

  importQueue.push(importEntry);
  return { ok: true, import: importEntry };
}

/**
 * Perform ontology mapping between imported and local schemas.
 */
function mapOntology(importId, mapping) {
  const entry = importQueue.find(e => e.id === importId);
  if (!entry) return { ok: false, error: "import_not_found" };

  entry.ontologyMapping = {
    mappings: Array.isArray(mapping) ? mapping : [],
    appliedAt: new Date().toISOString(),
  };

  return { ok: true, importId, mapping: entry.ontologyMapping };
}

/**
 * Promote a sandboxed import to trusted.
 */
function trustImport(importId, actor) {
  const entry = importQueue.find(e => e.id === importId);
  if (!entry) return { ok: false, error: "import_not_found" };
  if (entry.trust === "trusted") return { ok: true, alreadyTrusted: true };

  if (!actor || !["owner", "founder", "admin", "council"].includes(actor.role)) {
    return { ok: false, error: "insufficient_role" };
  }

  entry.trust = "trusted";
  entry.status = "trusted";
  return { ok: true, import: entry };
}

/**
 * Get reputation for an artifact.
 */
function getArtifactReputation(artifactId) {
  const rep = artifactReputation.get(artifactId);
  if (!rep) return { score: 0, votes: 0, history: [] };
  return { ...rep };
}

/**
 * Add a reputation vote for an artifact.
 */
function voteReputation(artifactId, score, voter) {
  if (!artifactReputation.has(artifactId)) {
    artifactReputation.set(artifactId, { score: 0, votes: 0, history: [] });
  }

  const rep = artifactReputation.get(artifactId);
  const vote = {
    score: Math.max(-1, Math.min(1, Number(score))),
    voterId: voter?.id || "anonymous",
    ts: new Date().toISOString(),
  };

  rep.history.push(vote);
  if (rep.history.length > 100) rep.history.splice(0, rep.history.length - 100);

  // Recalculate average
  rep.votes++;
  rep.score = rep.history.reduce((s, v) => s + v.score, 0) / rep.history.length;

  // Cap total artifacts tracked to prevent unbounded growth
  if (artifactReputation.size > 50000) {
    const oldest = artifactReputation.keys().next().value;
    artifactReputation.delete(oldest);
  }

  return { ok: true, reputation: { ...rep, history: undefined }, vote };
}

/**
 * Register/update a federation peer.
 */
function registerPeer(peerId, endpoint, trust = 0) {
  peers.set(peerId, {
    id: String(peerId),
    endpoint: String(endpoint),
    trust: Math.max(0, Math.min(1, Number(trust))),
    lastSeen: new Date().toISOString(),
    importCount: 0,
    exportCount: 0,
  });
  return { ok: true, peerId };
}

function init({ register, STATE, helpers: _helpers }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.federation = {
    stats: { exports: 0, imports: 0, trusted: 0, rejected: 0, reputationVotes: 0 },
  };

  register("loaf.federation", "status", (ctx) => {
    const f = ctx.state.__loaf.federation;
    return {
      ok: true,
      peers: peers.size,
      pendingImports: importQueue.filter(e => e.status === "sandboxed" || e.status === "pending_verification").length,
      trustedImports: importQueue.filter(e => e.trust === "trusted").length,
      artifactsWithReputation: artifactReputation.size,
      stats: f.stats,
    };
  }, { public: true });

  register("loaf.federation", "export", (ctx, input = {}) => {
    const f = ctx.state.__loaf.federation;
    const result = exportArtifact(input.artifact || {}, input.evidence, input.disputeHistory, input.license);
    f.stats.exports++;
    return { ok: true, exported: result };
  }, { public: false });

  register("loaf.federation", "import", (ctx, input = {}) => {
    const f = ctx.state.__loaf.federation;
    const result = importArtifact(input.data, input.verifier);
    if (result.ok) f.stats.imports++;
    return result;
  }, { public: false });

  register("loaf.federation", "trust", (ctx, input = {}) => {
    const f = ctx.state.__loaf.federation;
    const result = trustImport(String(input.importId || ""), ctx.actor);
    if (result.ok && !result.alreadyTrusted) f.stats.trusted++;
    return result;
  }, { public: false });

  register("loaf.federation", "vote_reputation", (ctx, input = {}) => {
    const f = ctx.state.__loaf.federation;
    const result = voteReputation(String(input.artifactId || ""), input.score, ctx.actor);
    f.stats.reputationVotes++;
    return result;
  }, { public: false });

  register("loaf.federation", "get_reputation", (_ctx, input = {}) => {
    return { ok: true, ...getArtifactReputation(String(input.artifactId || "")) };
  }, { public: true });

  register("loaf.federation", "register_peer", (_ctx, input = {}) => {
    return registerPeer(input.peerId, input.endpoint, input.trust);
  }, { public: false });

  register("loaf.federation", "list_peers", (_ctx) => {
    return { ok: true, peers: Array.from(peers.values()) };
  }, { public: true });

  register("loaf.federation", "list_imports", (_ctx, input = {}) => {
    const status = input.status || null;
    let list = [...importQueue];
    if (status) list = list.filter(e => e.status === status || e.trust === status);
    return { ok: true, imports: list.slice(-(Number(input.limit || 50))) };
  }, { public: true });

  register("loaf.federation", "map_ontology", (_ctx, input = {}) => {
    return mapOntology(String(input.importId || ""), input.mapping);
  }, { public: false });
}

export {
  exportArtifact,
  importArtifact,
  mapOntology,
  trustImport,
  getArtifactReputation,
  voteReputation,
  registerPeer,
  init,
};
