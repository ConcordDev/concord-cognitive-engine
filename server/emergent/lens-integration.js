/**
 * Concord Lens Integration — Rich DTU Enrichment + Emergent Lens Actions
 *
 * Three problems solved:
 *
 * 1. DTU Exhaust Enrichment: _lensEmitDTU currently creates thin "something
 *    happened" DTUs. This module adds domain-aware enrichers that extract
 *    real claims, real tags, and real edges from artifact data.
 *
 * 2. Bidirectional Linking: Artifacts and DTUs are currently separate objects
 *    linked only by artifactId in DTU metadata. This adds bidirectional
 *    references so you can traverse artifact ↔ DTU in one hop.
 *
 * 3. Emergent Lens Actions: Emergent agents can propose lens actions
 *    (analyze, query, export for read-only; mutations through governance).
 *    Results feed back as evidence DTUs into dialogue sessions.
 *
 * 4. DTU Conversation: A DTU knows its artifact, its edges, its working set.
 *    The conversation endpoint builds context from all of these.
 */

import { createEdge } from "./edges.js";
import {
  createLensProposal, getLensProposal, recordProposalApplication,
} from "../lib/emergent-proposals.js";

// ── DTU Enricher Registry ──────────────────────────────────────────────────

const LENS_DTU_ENRICHERS = new Map();

/**
 * Register a domain-specific enrichment function.
 * The enricher receives (artifact, action, extra) and returns
 * { claims, tags, edges, summary, domain } — all optional.
 */
export function registerLensDTUEnricher(domain, enrichFn) {
  LENS_DTU_ENRICHERS.set(domain, enrichFn);
}

/**
 * Get enricher for a domain (or null for fallback).
 */
export function getLensDTUEnricher(domain) {
  return LENS_DTU_ENRICHERS.get(domain) || null;
}

/**
 * Check if a domain has an enricher registered.
 */
export function hasEnricher(domain) {
  return LENS_DTU_ENRICHERS.has(domain);
}

/**
 * Enrich a base DTU with domain-specific claims, tags, edges, and summary.
 * Returns the enriched DTU fields (does NOT modify in place).
 *
 * @param {Object} baseDtu - The thin DTU from _lensEmitDTU
 * @param {Object} artifact - The full lens artifact
 * @param {string} action - The action that triggered emission
 * @param {Object} extra - Additional context (actionResult, etc.)
 * @returns {{ enriched: boolean, claims, tags, edges, summary, domain }}
 */
export function enrichLensDTU(baseDtu, artifact, action, extra = {}) {
  const enricher = LENS_DTU_ENRICHERS.get(artifact.domain);
  if (!enricher) {
    return { enriched: false };
  }

  try {
    const result = enricher(artifact, action, extra);
    return {
      enriched: true,
      claims: result.claims || [],
      tags: result.tags || [],
      edges: result.edges || [],
      summary: result.summary || null,
      domain: result.domain || artifact.domain,
    };
  } catch {
    return { enriched: false };
  }
}

/**
 * Apply enrichment to a DTU and create edges in the lattice.
 * This is the function _lensEmitDTU calls after creating the base DTU.
 *
 * @param {Object} STATE - Global server state
 * @param {string} dtuId - The newly created DTU ID
 * @param {Object} artifact - The lens artifact
 * @param {string} action - The action type
 * @param {Object} extra - Additional context
 * @returns {{ enriched: boolean, edgesCreated: number }}
 */
export function applyEnrichment(STATE, dtuId, artifact, action, extra = {}) {
  const dtu = STATE.dtus?.get(dtuId);
  if (!dtu) return { enriched: false, edgesCreated: 0 };

  const enrichment = enrichLensDTU(dtu, artifact, action, extra);
  if (!enrichment.enriched) return { enriched: false, edgesCreated: 0 };

  // Apply enriched fields
  if (enrichment.summary) {
    dtu.human = dtu.human || {};
    dtu.human.summary = enrichment.summary;
    dtu.summary = enrichment.summary;
  }

  if (enrichment.claims.length > 0) {
    dtu.core = dtu.core || {};
    dtu.core.claims = [...(dtu.core.claims || []), ...enrichment.claims];
    dtu.claims = [...(dtu.claims || []), ...enrichment.claims];
  }

  if (enrichment.tags.length > 0) {
    dtu.tags = [...new Set([...(dtu.tags || []), ...enrichment.tags])];
  }

  if (enrichment.domain) {
    dtu.machine = dtu.machine || {};
    dtu.machine.enrichedDomain = enrichment.domain;
  }

  dtu.meta = dtu.meta || {};
  dtu.meta.enriched = true;
  dtu.meta.enrichedAt = new Date().toISOString();

  // Create edges from enrichment
  let edgesCreated = 0;
  for (const edge of enrichment.edges) {
    if (!edge.targetId) continue;
    // Verify target exists
    if (!STATE.dtus?.has(edge.targetId)) continue;

    const result = createEdge(STATE, {
      sourceId: dtuId,
      targetId: edge.targetId,
      edgeType: edge.type || "references",
      weight: edge.weight || 0.5,
      confidence: edge.confidence || 0.7,
      createdBy: { source: "lens_enricher", domain: artifact.domain },
      label: edge.label || `lens:${artifact.domain}`,
    });

    if (result.ok) edgesCreated++;
  }

  return { enriched: true, edgesCreated };
}

// ── Bidirectional Linking ──────────────────────────────────────────────────

/**
 * Link an artifact to a DTU bidirectionally.
 * artifact._dtuIds tracks all DTUs emitted from this artifact.
 * dtu._artifactId points back to the source artifact.
 */
export function linkArtifactDTU(STATE, artifactId, dtuId) {
  const artifact = STATE.lensArtifacts?.get(artifactId);
  const dtu = STATE.dtus?.get(dtuId);

  if (artifact) {
    if (!artifact._dtuIds) artifact._dtuIds = [];
    if (!artifact._dtuIds.includes(dtuId)) {
      artifact._dtuIds.push(dtuId);
    }
  }

  if (dtu) {
    dtu._artifactId = artifactId;
  }

  return { ok: true, artifactId, dtuId };
}

/**
 * Get all DTUs linked to an artifact.
 */
export function getArtifactDTUs(STATE, artifactId) {
  const artifact = STATE.lensArtifacts?.get(artifactId);
  if (!artifact) return { ok: false, error: "artifact_not_found" };

  const dtuIds = artifact._dtuIds || [];
  const dtus = dtuIds
    .map(id => STATE.dtus?.get(id))
    .filter(Boolean);

  return { ok: true, artifactId, dtus, count: dtus.length };
}

/**
 * Get the artifact linked to a DTU.
 */
export function getDTUArtifact(STATE, dtuId) {
  const dtu = STATE.dtus?.get(dtuId);
  if (!dtu) return { ok: false, error: "dtu_not_found" };

  if (!dtu._artifactId) return { ok: true, dtuId, artifact: null, linked: false };

  const artifact = STATE.lensArtifacts?.get(dtu._artifactId);
  return {
    ok: true,
    dtuId,
    artifact: artifact || null,
    linked: !!artifact,
    artifactId: dtu._artifactId,
  };
}

// ── Emergent Lens Action Capability ─────────────────────────────────────────

/**
 * Safe (read-only/analytical) actions that emergent agents can execute
 * without governance approval.
 */
const SAFE_LENS_ACTIONS = new Set([
  "analyze", "query", "export", "trace", "validate",
  "summarize", "detect_consensus", "extract_decisions",
  "detect_patterns", "generate_insights", "schema-inspect",
  "compare", "compare_versions", "rank", "rank_posts",
  "cluster_topics", "extract_thesis", "generate_summary_dtu",
  "trace-lineage", "detect-contradictions",
  "check-compliance",
]);

/**
 * Check whether an emergent agent can execute a lens action.
 *
 * @param {Object} emergent - The emergent agent object
 * @param {string} domain - Lens domain
 * @param {string} action - The action to execute
 * @returns {{ allowed: boolean, reason?: string, requiresGovernance?: boolean }}
 */
export function checkEmergentLensAccess(emergent, domain, action) {
  if (!emergent) {
    return { allowed: false, reason: "no_emergent" };
  }

  // All emergents can execute safe/analytical actions
  if (SAFE_LENS_ACTIONS.has(action)) {
    return { allowed: true, safe: true };
  }

  // Mutation actions require governance approval
  return {
    allowed: false,
    reason: "mutation_requires_governance",
    requiresGovernance: true,
    proposalType: "lens_action",
    domain,
    action,
  };
}

/**
 * Execute a lens action on behalf of an emergent agent.
 * Safe actions execute immediately. Mutations return a proposal stub.
 *
 * @param {Object} STATE - Global server state
 * @param {Object} opts
 * @param {string} opts.emergentId - The emergent agent ID
 * @param {string} opts.artifactId - Target artifact
 * @param {string} opts.action - Action to execute
 * @param {Object} opts.params - Action parameters
 * @param {string} opts.justification - Why the emergent wants this
 * @param {Function} opts.runMacro - The macro runner function
 * @param {Function} opts.makeCtx - Context builder
 * @returns {{ ok, result?, proposal? }}
 */
/**
 * Execute a lens action through the macro path with the emergent's
 * elevated internal context. Shared by the safe-action branch of
 * executeEmergentLensAction and by applyEmergentLensProposal — an
 * approved governance proposal runs through exactly the same path a
 * safe action does, never a privileged side channel.
 */
function _executeViaMacro(STATE, { artifact, artifactId, action, params, emergentId, runMacro, makeCtx }) {
  try {
    const ctx = makeCtx ? makeCtx() : { actor: { userId: `emergent:${emergentId}`, role: "emergent" }, state: STATE };
    // Elevate to internal system call — emergent actions are trusted server-side processes
    ctx.actor = { ...ctx.actor, userId: `emergent:${emergentId}`, orgId: "internal", role: "owner", scopes: ["*"], internal: true };
    ctx.internal = true;
    // Synchronous macro call via provided runner
    if (runMacro) {
      const result = runMacro("lens", "run", {
        id: artifactId,
        action,
        params,
      }, ctx);

      return {
        ok: true,
        executed: true,
        result,
        emergentId,
        domain: artifact.domain,
        action,
      };
    }
    return { ok: false, error: "no_macro_runner" };
  } catch (err) {
    return { ok: false, error: `execution_failed: ${err.message}` };
  }
}

export function executeEmergentLensAction(STATE, opts = {}) {
  const { emergentId, artifactId, action, params = {}, justification, submittedBy = null, runMacro, makeCtx } = opts;

  if (!artifactId || !action) {
    return { ok: false, error: "artifactId_and_action_required" };
  }

  const artifact = STATE.lensArtifacts?.get(artifactId);
  if (!artifact) {
    return { ok: false, error: "artifact_not_found" };
  }

  // Check access
  const access = checkEmergentLensAccess({ id: emergentId }, artifact.domain, action);

  if (access.allowed) {
    // Execute through the normal macro path
    return _executeViaMacro(STATE, { artifact, artifactId, action, params, emergentId, runMacro, makeCtx });
  }

  // Mutation requires governance — persist the proposal in the
  // governance queue (lib/emergent-proposals.js) instead of returning a
  // stub that evaporates. A human governance role decides it; only an
  // approved proposal can ever be applied (applyEmergentLensProposal).
  const created = createLensProposal(STATE, {
    type: "lens_action",
    emergentId,
    submittedBy,
    domain: artifact.domain,
    artifactId,
    action,
    params,
    justification: justification || `Emergent ${emergentId} requests ${action} on ${artifact.domain} artifact ${artifactId}`,
    createdAt: new Date().toISOString(),
  });
  if (!created.ok) return { ok: false, executed: false, requiresGovernance: true, error: created.error, limit: created.limit };
  if (!created.deduped) recordEnrichmentMetric("emergentProposals");
  return {
    ok: true,
    executed: false,
    requiresGovernance: true,
    proposalId: created.proposal.id,
    proposal: created.proposal,
    ...(created.deduped ? { deduped: true } : {}),
  };
}

/**
 * Apply a governance-APPROVED emergent lens proposal: execute its stored
 * action through the same macro path safe actions use, and record the
 * outcome on the proposal. Refuses from any other state — nothing
 * applies from "pending", ever, and a rejected proposal is terminal.
 *
 * @param {Object} STATE - Global server state
 * @param {string} proposalId
 * @param {Object} opts - { runMacro, makeCtx } as in executeEmergentLensAction
 * @returns {{ ok, proposal?, result?, error? }}
 */
export function applyEmergentLensProposal(STATE, proposalId, opts = {}) {
  const { runMacro, makeCtx } = opts;
  const proposal = getLensProposal(STATE, proposalId);
  if (!proposal) return { ok: false, error: "proposal_not_found" };
  if (proposal.status !== "approved" && proposal.status !== "apply_failed") {
    return { ok: false, error: "proposal_not_applicable", status: proposal.status };
  }
  const artifact = STATE.lensArtifacts?.get(proposal.artifactId);
  if (!artifact) {
    recordProposalApplication(STATE, proposalId, { ok: false, error: "artifact_not_found" });
    return { ok: false, error: "artifact_not_found", proposal };
  }
  const exec = _executeViaMacro(STATE, {
    artifact,
    artifactId: proposal.artifactId,
    action: proposal.action,
    params: proposal.params || {},
    emergentId: proposal.emergentId,
    runMacro,
    makeCtx,
  });
  if (!exec.ok || !exec.executed) {
    recordProposalApplication(STATE, proposalId, { ok: false, error: exec.error || "not_executed" });
    return { ok: false, error: exec.error || "not_executed", proposal };
  }
  recordProposalApplication(STATE, proposalId, { ok: true, result: exec.result });
  return { ok: true, executed: true, result: exec.result, proposal };
}

// ── DTU Conversation Context Builder ────────────────────────────────────────

/**
 * Build conversation context for a DTU.
 * Aggregates the DTU, its linked artifact, edge neighborhood,
 * and activation working set into a single context object.
 *
 * @param {Object} STATE - Global server state
 * @param {string} dtuId - The DTU to converse with
 * @param {Object} opts
 * @param {string} opts.sessionId - Session for activation
 * @returns {{ ok, context }}
 */
export function buildDTUConversationContext(STATE, dtuId, opts = {}) {
  const dtu = STATE.dtus?.get(dtuId);
  if (!dtu) return { ok: false, error: "dtu_not_found" };

  const context = {
    dtu: {
      id: dtu.id,
      title: dtu.title,
      tier: dtu.tier,
      tags: dtu.tags || [],
      claims: dtu.claims || dtu.core?.claims || [],
      summary: dtu.summary || dtu.human?.summary || "",
      definitions: dtu.core?.definitions || [],
      invariants: dtu.core?.invariants || [],
      examples: dtu.core?.examples || [],
    },
    artifact: null,
    neighbors: [],
    edges: [],
  };

  // Get linked artifact if exists
  if (dtu._artifactId) {
    const artifact = STATE.lensArtifacts?.get(dtu._artifactId);
    if (artifact) {
      context.artifact = {
        id: artifact.id,
        domain: artifact.domain,
        type: artifact.type,
        title: artifact.title,
        data: artifact.data,
      };
    }
  }

  // Get edge neighborhood via the emergent edge store
  try {
    const es = STATE.__emergent;
    const edgeStore = es?._edges;
    if (edgeStore) {
      const outEdgeIds = edgeStore.bySource?.get(dtuId);
      const inEdgeIds = edgeStore.byTarget?.get(dtuId);

      const neighborIds = new Set();

      if (outEdgeIds) {
        for (const eid of outEdgeIds) {
          const edge = edgeStore.edges.get(eid);
          if (edge) {
            context.edges.push({
              targetId: edge.targetId,
              type: edge.edgeType,
              weight: edge.weight,
              direction: "outgoing",
            });
            neighborIds.add(edge.targetId);
          }
        }
      }

      if (inEdgeIds) {
        for (const eid of inEdgeIds) {
          const edge = edgeStore.edges.get(eid);
          if (edge) {
            context.edges.push({
              sourceId: edge.sourceId,
              type: edge.edgeType,
              weight: edge.weight,
              direction: "incoming",
            });
            neighborIds.add(edge.sourceId);
          }
        }
      }

      // Load neighbor DTUs (top 20 by edge weight)
      for (const nId of neighborIds) {
        if (context.neighbors.length >= 20) break;
        const neighbor = STATE.dtus?.get(nId);
        if (neighbor) {
          context.neighbors.push({
            id: neighbor.id,
            title: neighbor.title,
            tier: neighbor.tier,
            summary: neighbor.summary || neighbor.human?.summary || "",
          });
        }
      }
    }
  } catch {
    // Edge store not initialized — fine, just no edges
  }

  return {
    ok: true,
    dtuId,
    context,
    edgeCount: context.edges.length,
    neighborCount: context.neighbors.length,
    hasArtifact: !!context.artifact,
  };
}

// ── Built-in Domain Enrichers ──────────────────────────────────────────────

/**
 * Register all built-in domain enrichers.
 * Called once during init.
 */
export function registerBuiltinEnrichers() {

  // ── Studio (music production) ──
  registerLensDTUEnricher("studio", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = [];
    const edges = [];

    if (data.bpm) { claims.push(`Project tempo is ${data.bpm} BPM`); tags.push(`bpm:${data.bpm}`); }
    if (data.key) {
      claims.push(`Project key is ${data.key} ${data.scale || "major"}`);
      tags.push(`key:${data.key}`);
      if (data.scale) tags.push(`scale:${data.scale}`);
    }
    if (data.genre) { claims.push(`Genre is ${data.genre}`); tags.push(`genre:${data.genre}`); }
    if (data.tracks) {
      claims.push(`Project has ${data.tracks.length} tracks`);
      for (const track of data.tracks) {
        if (track.instrumentId) tags.push(`instrument:${track.instrumentId}`);
        if (track.instrument) tags.push(`instrument:${track.instrument}`);
        for (const fx of (track.effects || [])) {
          tags.push(`effect:${fx.name || fx.effectId || fx}`);
        }
      }
    }
    if (data.arrangement?.sections) {
      claims.push(`Arrangement has ${data.arrangement.sections.length} sections`);
    }

    const summary = data.bpm
      ? `Studio ${action}: "${artifact.title}" (${data.bpm}BPM, ${data.key || "?"} ${data.scale || ""})`
      : `Studio ${action}: "${artifact.title}"`;

    return { claims, tags, edges, summary, domain: "music_production" };
  });

  // ── Music (analysis/playback) ──
  registerLensDTUEnricher("music", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = [];

    if (data.bpm) { claims.push(`Track BPM: ${data.bpm}`); tags.push(`bpm:${data.bpm}`); }
    if (data.key) tags.push(`key:${data.key}`);
    if (data.genre) tags.push(`genre:${data.genre}`);
    if (data.artist) tags.push(`artist:${data.artist}`);
    if (data.stems) {
      tags.push(...data.stems.map(s => `stem:${typeof s === "string" ? s : s.name || s}`));
    }
    if (extra.actionResult?.analysis) {
      const a = extra.actionResult.analysis;
      if (a.energy != null) claims.push(`Energy level: ${(a.energy * 100).toFixed(0)}%`);
      if (a.danceability != null) claims.push(`Danceability: ${(a.danceability * 100).toFixed(0)}%`);
      if (a.valence != null) claims.push(`Valence: ${(a.valence * 100).toFixed(0)}%`);
      if (a.complexity != null) claims.push(`Complexity: ${(a.complexity * 100).toFixed(0)}%`);
    }

    return {
      claims, tags, edges: [],
      summary: `${artifact.title}${data.artist ? ` - ${data.artist}` : ""}`,
      domain: "music",
    };
  });

  // ── Paper (research) ──
  registerLensDTUEnricher("paper", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = [];
    const edges = [];

    if (data.thesis) claims.push(data.thesis);
    if (data.conclusion) claims.push(data.conclusion);
    if (data.abstract) claims.push(data.abstract);
    if (data.methodology) claims.push(`Methodology: ${data.methodology}`);

    if (data.keywords) tags.push(...data.keywords.map(k => `topic:${k}`));
    if (data.field) tags.push(`field:${data.field}`);

    // Citations become references edges
    for (const c of (data.citations || [])) {
      if (c.dtuId) {
        edges.push({
          targetId: c.dtuId, type: "references",
          weight: 0.7, confidence: 0.8,
          label: `cited in paper "${artifact.title}"`,
        });
      }
    }

    return {
      claims, tags, edges,
      summary: data.thesis || artifact.title,
      domain: data.field || "research",
    };
  });

  // ── Reasoning (logic chains) ──
  registerLensDTUEnricher("reasoning", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["reasoning", "logic"];

    if (data.premises) {
      for (const p of data.premises) {
        claims.push(typeof p === "string" ? p : p.text || p.statement || JSON.stringify(p));
      }
      tags.push("has_premises");
    }
    if (data.conclusion) {
      claims.push(typeof data.conclusion === "string" ? data.conclusion : data.conclusion.text || JSON.stringify(data.conclusion));
      tags.push("has_conclusion");
    }
    if (data.method) tags.push(`method:${data.method}`);
    if (data.valid !== undefined) {
      claims.push(`Reasoning validity: ${data.valid ? "valid" : "invalid"}`);
    }

    return {
      claims, tags, edges: [],
      summary: data.conclusion ? `Reasoning: ${typeof data.conclusion === "string" ? data.conclusion.slice(0, 100) : artifact.title}` : artifact.title,
      domain: "logic",
    };
  });

  // ── Law (legal analysis) ──
  registerLensDTUEnricher("law", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["law", "legal"];
    const edges = [];

    if (data.jurisdiction) tags.push(`jurisdiction:${data.jurisdiction}`);
    if (data.area) tags.push(`area:${data.area}`);
    if (data.statutes) {
      for (const s of data.statutes) {
        claims.push(`References statute: ${typeof s === "string" ? s : s.name || s.code || JSON.stringify(s)}`);
        if (s.dtuId) edges.push({ targetId: s.dtuId, type: "references", weight: 0.8, confidence: 0.9 });
      }
    }
    if (data.compliance) {
      claims.push(`Compliance status: ${data.compliance.status || "unknown"}`);
      if (data.compliance.issues) {
        for (const issue of data.compliance.issues) {
          claims.push(`Compliance issue: ${typeof issue === "string" ? issue : issue.description || JSON.stringify(issue)}`);
        }
      }
    }
    if (data.analysis) claims.push(typeof data.analysis === "string" ? data.analysis : "");

    return { claims: claims.filter(Boolean), tags, edges, summary: artifact.title, domain: "legal" };
  });

  // ── Graph (knowledge graph operations) ──
  registerLensDTUEnricher("graph", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["graph"];

    if (data.nodes) claims.push(`Graph contains ${Array.isArray(data.nodes) ? data.nodes.length : "?"} nodes`);
    if (data.edges) claims.push(`Graph contains ${Array.isArray(data.edges) ? data.edges.length : "?"} edges`);
    if (data.clusters) claims.push(`${data.clusters.length} clusters detected`);

    if (action === "cluster" && extra.actionResult) {
      const r = extra.actionResult;
      if (r.clusters) claims.push(`Clustering produced ${r.clusters.length} groups`);
    }
    if (action === "analyze" && extra.actionResult) {
      const r = extra.actionResult;
      if (r.density != null) claims.push(`Graph density: ${r.density}`);
      if (r.components != null) claims.push(`Connected components: ${r.components}`);
    }

    return { claims, tags, edges: [], summary: `Graph ${action}: ${artifact.title}`, domain: "knowledge_graph" };
  });

  // ── Sim (simulation) ──
  registerLensDTUEnricher("sim", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["simulation"];

    if (data.type) tags.push(`sim_type:${data.type}`);
    if (data.parameters) {
      claims.push(`Simulation parameters: ${Object.keys(data.parameters).join(", ")}`);
    }
    if (action === "simulate" && extra.actionResult) {
      const r = extra.actionResult;
      if (r.iterations != null) claims.push(`Ran ${r.iterations} iterations`);
      if (r.outcome) claims.push(`Outcome: ${typeof r.outcome === "string" ? r.outcome : JSON.stringify(r.outcome).slice(0, 200)}`);
    }

    return { claims, tags, edges: [], summary: `Simulation: ${artifact.title}`, domain: "simulation" };
  });

  // ── Council (governance deliberation) ──
  registerLensDTUEnricher("council", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["council", "governance"];

    if (data.topic) claims.push(`Deliberation topic: ${data.topic}`);
    if (data.outcome) claims.push(`Outcome: ${data.outcome}`);
    if (data.votes) {
      const forVotes = data.votes.filter(v => v.position === "for" || v.vote === true).length;
      const againstVotes = data.votes.filter(v => v.position === "against" || v.vote === false).length;
      claims.push(`Vote tally: ${forVotes} for, ${againstVotes} against`);
    }
    if (action === "debate" && extra.actionResult) {
      const r = extra.actionResult;
      if (r.consensus != null) claims.push(`Consensus: ${r.consensus}`);
    }

    return { claims, tags, edges: [], summary: artifact.title, domain: "governance" };
  });

  // ── Marketplace (economic) ──
  registerLensDTUEnricher("marketplace", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["marketplace"];

    if (data.price != null) { claims.push(`Listed at price: ${data.price}`); tags.push("has_price"); }
    if (data.category) tags.push(`category:${data.category}`);
    if (data.purchases?.length) claims.push(`${data.purchases.length} purchases recorded`);
    if (data.reviews?.length) {
      const avgRating = data.reviews.reduce((s, r) => s + (r.rating || 0), 0) / data.reviews.length;
      claims.push(`Average rating: ${avgRating.toFixed(1)} from ${data.reviews.length} reviews`);
    }
    if (data.licenses?.length) claims.push(`${data.licenses.length} licenses issued`);

    return {
      claims, tags, edges: [],
      summary: `Marketplace ${action}: "${artifact.title}"${data.price != null ? ` ($${data.price})` : ""}`,
      domain: "marketplace",
    };
  });

  // ── Forum (discussion) ──
  registerLensDTUEnricher("forum", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["forum", "discussion"];

    if (data.posts?.length) claims.push(`Thread has ${data.posts.length} posts`);
    if (data.category) tags.push(`topic:${data.category}`);
    if (action === "extract_thesis" && extra.actionResult?.thesis) {
      claims.push(extra.actionResult.thesis);
    }
    if (action === "vote" && extra.actionResult) {
      claims.push(`Vote recorded: ${extra.actionResult.direction || "unknown"}`);
    }

    return { claims, tags, edges: [], summary: artifact.title, domain: "discussion" };
  });

  // ── ML (machine learning) ──
  registerLensDTUEnricher("ml", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["ml", "machine_learning"];

    if (data.model) tags.push(`model:${data.model}`);
    if (data.dataset) tags.push(`dataset:${data.dataset}`);
    if (action === "evaluate" && extra.actionResult) {
      const r = extra.actionResult;
      if (r.accuracy != null) claims.push(`Model accuracy: ${(r.accuracy * 100).toFixed(1)}%`);
      if (r.loss != null) claims.push(`Loss: ${r.loss}`);
    }
    if (action === "train" && extra.actionResult) {
      const r = extra.actionResult;
      if (r.epochs != null) claims.push(`Trained for ${r.epochs} epochs`);
    }

    return { claims, tags, edges: [], summary: `ML ${action}: ${artifact.title}`, domain: "machine_learning" };
  });

  // ── Experience (portfolio/resume) ──
  registerLensDTUEnricher("experience", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["experience"];

    if (data.role) { claims.push(`Role: ${data.role}`); tags.push(`role:${data.role}`); }
    if (data.company) tags.push(`company:${data.company}`);
    if (data.skills) tags.push(...data.skills.map(s => `skill:${s}`));
    if (data.duration) claims.push(`Duration: ${data.duration}`);

    return { claims, tags, edges: [], summary: artifact.title, domain: "professional" };
  });

  // ── Finance ──
  registerLensDTUEnricher("finance", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["finance"];

    if (data.instrument) tags.push(`instrument:${data.instrument}`);
    if (data.strategy) tags.push(`strategy:${data.strategy}`);
    if (action === "analyze" && extra.actionResult) {
      const r = extra.actionResult;
      if (r.trend) claims.push(`Market trend: ${r.trend}`);
      if (r.risk != null) claims.push(`Risk assessment: ${r.risk}`);
    }
    if (action === "simulate" && extra.actionResult) {
      const r = extra.actionResult;
      if (r.returnRate != null) claims.push(`Simulated return: ${(r.returnRate * 100).toFixed(1)}%`);
    }

    return { claims, tags, edges: [], summary: artifact.title, domain: "finance" };
  });

  // ── Database ──
  registerLensDTUEnricher("database", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["database"];

    if (data.engine) tags.push(`engine:${data.engine}`);
    if (data.tables) claims.push(`Schema has ${data.tables.length} tables`);
    if (action === "query" && extra.actionResult?.rowCount != null) {
      claims.push(`Query returned ${extra.actionResult.rowCount} rows`);
    }

    return { claims, tags, edges: [], summary: artifact.title, domain: "data" };
  });

  // ── Daily (journal/planner) ──
  registerLensDTUEnricher("daily", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["daily", "journal"];

    if (data.date) tags.push(`date:${data.date}`);
    if (data.mood) tags.push(`mood:${data.mood}`);
    if (action === "detect_patterns" && extra.actionResult?.patterns) {
      for (const p of extra.actionResult.patterns) {
        claims.push(`Pattern: ${typeof p === "string" ? p : p.description || JSON.stringify(p)}`);
      }
    }

    return { claims, tags, edges: [], summary: artifact.title, domain: "personal" };
  });

  // ── SRS (spaced repetition) ──
  registerLensDTUEnricher("srs", (artifact, action, extra) => {
    const data = artifact.data || {};
    const claims = [];
    const tags = ["srs", "learning"];

    if (data.cards?.length) claims.push(`Deck has ${data.cards.length} cards`);
    if (data.subject) tags.push(`subject:${data.subject}`);
    if (action === "review" && extra.actionResult) {
      const r = extra.actionResult;
      if (r.correct != null && r.total != null) claims.push(`Review score: ${r.correct}/${r.total}`);
    }

    return { claims, tags, edges: [], summary: artifact.title, domain: "learning" };
  });

  // ── Super-Lens Domain Enrichers (23 domains) ─────────────────────────────

  registerLensDTUEnricher("healthcare", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["healthcare"];
    if (d.prescriptions?.length) claims.push(`${d.prescriptions.length} active prescriptions`);
    if (d.diagnosis) { claims.push(`Diagnosis: ${d.diagnosis}`); tags.push(`diagnosis:${d.diagnosis}`); }
    if (d.patient?.age) tags.push(`age_group:${d.patient.age < 18 ? "pediatric" : d.patient.age > 65 ? "geriatric" : "adult"}`);
    if (d.protocol) tags.push(`protocol:${d.protocol}`);
    return { claims, tags, edges: [], summary: d.diagnosis || artifact.title, domain: "healthcare" };
  });

  registerLensDTUEnricher("accounting", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["accounting"];
    if (d.accounts?.length) claims.push(`Chart of accounts: ${d.accounts.length} accounts`);
    if (d.totalDebits != null) claims.push(`Total debits: ${d.totalDebits}`);
    if (d.period) tags.push(`period:${d.period}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "accounting" };
  });

  registerLensDTUEnricher("agriculture", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["agriculture"];
    if (d.crop) { claims.push(`Crop: ${d.crop}`); tags.push(`crop:${d.crop}`); }
    if (d.acreage) claims.push(`Acreage: ${d.acreage}`);
    if (d.yield) claims.push(`Yield: ${d.yield}`);
    if (d.soilType) tags.push(`soil:${d.soilType}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "agriculture" };
  });

  registerLensDTUEnricher("aviation", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["aviation"];
    if (d.aircraft) { claims.push(`Aircraft: ${d.aircraft}`); tags.push(`aircraft:${d.aircraft}`); }
    if (d.flightPhase) tags.push(`phase:${d.flightPhase}`);
    if (d.altitude != null) claims.push(`Altitude: ${d.altitude} ft`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "aviation" };
  });

  registerLensDTUEnricher("creative", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["creative"];
    if (d.medium) tags.push(`medium:${d.medium}`);
    if (d.style) tags.push(`style:${d.style}`);
    if (d.collaborators?.length) claims.push(`${d.collaborators.length} collaborators`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "creative" };
  });

  registerLensDTUEnricher("education", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["education"];
    if (d.subject) { claims.push(`Subject: ${d.subject}`); tags.push(`subject:${d.subject}`); }
    if (d.gradeLevel) tags.push(`grade:${d.gradeLevel}`);
    if (d.students != null) claims.push(`Students: ${d.students}`);
    if (d.curriculum) tags.push(`curriculum:${d.curriculum}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "education" };
  });

  registerLensDTUEnricher("environment", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["environment"];
    if (d.metric) { claims.push(`Metric: ${d.metric}`); tags.push(`metric:${d.metric}`); }
    if (d.reading != null) claims.push(`Reading: ${d.reading} ${d.unit || ""}`);
    if (d.ecosystem) tags.push(`ecosystem:${d.ecosystem}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "environment" };
  });

  registerLensDTUEnricher("events", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["events"];
    if (d.eventType) tags.push(`event_type:${d.eventType}`);
    if (d.date) tags.push(`date:${d.date}`);
    if (d.attendees != null) claims.push(`Expected attendees: ${d.attendees}`);
    if (d.venue) tags.push(`venue:${d.venue}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "events" };
  });

  registerLensDTUEnricher("fitness", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["fitness"];
    if (d.exercise) { claims.push(`Exercise: ${d.exercise}`); tags.push(`exercise:${d.exercise}`); }
    if (d.duration) claims.push(`Duration: ${d.duration} min`);
    if (d.calories) claims.push(`Calories: ${d.calories}`);
    if (d.heartRate) claims.push(`Heart rate: ${d.heartRate} bpm`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "fitness" };
  });

  registerLensDTUEnricher("food", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["food"];
    if (d.recipe) tags.push(`recipe:${d.recipe}`);
    if (d.cuisine) tags.push(`cuisine:${d.cuisine}`);
    if (d.ingredients?.length) claims.push(`${d.ingredients.length} ingredients`);
    if (d.servings) claims.push(`Servings: ${d.servings}`);
    if (d.prepTime) claims.push(`Prep time: ${d.prepTime} min`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "food" };
  });

  registerLensDTUEnricher("government", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["government"];
    if (d.agency) tags.push(`agency:${d.agency}`);
    if (d.jurisdiction) tags.push(`jurisdiction:${d.jurisdiction}`);
    if (d.policyArea) { claims.push(`Policy area: ${d.policyArea}`); tags.push(`policy:${d.policyArea}`); }
    return { claims, tags, edges: [], summary: artifact.title, domain: "government" };
  });

  registerLensDTUEnricher("household", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["household"];
    if (d.category) tags.push(`category:${d.category}`);
    if (d.room) tags.push(`room:${d.room}`);
    if (d.urgency) claims.push(`Urgency: ${d.urgency}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "household" };
  });

  registerLensDTUEnricher("insurance", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["insurance"];
    if (d.policyType) { claims.push(`Policy type: ${d.policyType}`); tags.push(`policy_type:${d.policyType}`); }
    if (d.premium != null) claims.push(`Premium: $${d.premium}`);
    if (d.coverage) claims.push(`Coverage: ${d.coverage}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "insurance" };
  });

  registerLensDTUEnricher("legal", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["legal"];
    if (d.caseType) tags.push(`case_type:${d.caseType}`);
    if (d.jurisdiction) tags.push(`jurisdiction:${d.jurisdiction}`);
    if (d.parties?.length) claims.push(`${d.parties.length} parties involved`);
    if (d.status) tags.push(`status:${d.status}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "legal" };
  });

  registerLensDTUEnricher("logistics", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["logistics"];
    if (d.origin) tags.push(`origin:${d.origin}`);
    if (d.destination) tags.push(`destination:${d.destination}`);
    if (d.carrier) tags.push(`carrier:${d.carrier}`);
    if (d.weight) claims.push(`Weight: ${d.weight}`);
    if (d.status) claims.push(`Shipment status: ${d.status}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "logistics" };
  });

  registerLensDTUEnricher("manufacturing", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["manufacturing"];
    if (d.product) { claims.push(`Product: ${d.product}`); tags.push(`product:${d.product}`); }
    if (d.batchSize) claims.push(`Batch size: ${d.batchSize}`);
    if (d.defectRate != null) claims.push(`Defect rate: ${(d.defectRate * 100).toFixed(1)}%`);
    if (d.line) tags.push(`line:${d.line}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "manufacturing" };
  });

  registerLensDTUEnricher("nonprofit", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["nonprofit"];
    if (d.mission) claims.push(`Mission: ${d.mission}`);
    if (d.cause) tags.push(`cause:${d.cause}`);
    if (d.donations != null) claims.push(`Donations: $${d.donations}`);
    if (d.volunteers != null) claims.push(`Volunteers: ${d.volunteers}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "nonprofit" };
  });

  registerLensDTUEnricher("realestate", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["realestate"];
    if (d.propertyType) tags.push(`property_type:${d.propertyType}`);
    if (d.location) tags.push(`location:${d.location}`);
    if (d.price != null) claims.push(`Price: $${d.price.toLocaleString?.() || d.price}`);
    if (d.sqft) claims.push(`Size: ${d.sqft} sqft`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "realestate" };
  });

  registerLensDTUEnricher("retail", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["retail"];
    if (d.sku) tags.push(`sku:${d.sku}`);
    if (d.category) tags.push(`category:${d.category}`);
    if (d.price != null) claims.push(`Price: $${d.price}`);
    if (d.inventory != null) claims.push(`Inventory: ${d.inventory} units`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "retail" };
  });

  registerLensDTUEnricher("science", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["science"];
    if (d.field) { claims.push(`Field: ${d.field}`); tags.push(`field:${d.field}`); }
    if (d.hypothesis) claims.push(`Hypothesis: ${d.hypothesis}`);
    if (d.method) tags.push(`method:${d.method}`);
    if (d.results) claims.push(`Results: ${typeof d.results === "string" ? d.results : JSON.stringify(d.results).slice(0, 200)}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "science" };
  });

  registerLensDTUEnricher("security", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["security"];
    if (d.threatLevel) { claims.push(`Threat level: ${d.threatLevel}`); tags.push(`threat:${d.threatLevel}`); }
    if (d.vulnerability) tags.push(`vuln:${d.vulnerability}`);
    if (d.protocol) tags.push(`protocol:${d.protocol}`);
    if (d.incidents != null) claims.push(`${d.incidents} incidents recorded`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "security" };
  });

  registerLensDTUEnricher("services", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["services"];
    if (d.serviceType) tags.push(`service_type:${d.serviceType}`);
    if (d.provider) tags.push(`provider:${d.provider}`);
    if (d.rate != null) claims.push(`Rate: $${d.rate}/hr`);
    if (d.duration) claims.push(`Duration: ${d.duration}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "services" };
  });

  registerLensDTUEnricher("trades", (artifact, action, extra) => {
    const d = artifact.data || {};
    const claims = [];
    const tags = ["trades"];
    if (d.trade) { claims.push(`Trade: ${d.trade}`); tags.push(`trade:${d.trade}`); }
    if (d.materials?.length) claims.push(`${d.materials.length} materials required`);
    if (d.laborHours) claims.push(`Labor: ${d.laborHours} hours`);
    if (d.certification) tags.push(`cert:${d.certification}`);
    return { claims, tags, edges: [], summary: artifact.title, domain: "trades" };
  });
}

// ── Metrics ─────────────────────────────────────────────────────────────────

const _enrichmentMetrics = {
  enriched: 0,
  unenriched: 0,
  edgesCreated: 0,
  linksCreated: 0,
  emergentActions: 0,
  emergentProposals: 0,
};

export function recordEnrichmentMetric(type) {
  if (type in _enrichmentMetrics) _enrichmentMetrics[type]++;
}

export function getLensIntegrationMetrics() {
  return {
    ok: true,
    version: "1.0.0",
    enricherCount: LENS_DTU_ENRICHERS.size,
    enrichedDomains: Array.from(LENS_DTU_ENRICHERS.keys()),
    safeLensActions: Array.from(SAFE_LENS_ACTIONS),
    metrics: { ..._enrichmentMetrics },
  };
}
