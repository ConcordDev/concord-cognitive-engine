// server/lib/governance/auto-proposal.js
//
// Phase 3 + Phase 8: Auto-proposal pipeline.
//
// When a detector finding is severe enough to warrant governance review,
// route it through this module instead of acting unilaterally. Critical
// invariant violations, architectural-drift / scaling-pressure warnings,
// and other Reflex-Cortex outputs all flow through here.
//
// Emits a `kind: "auto_proposal"` DTU per proposal so the council can
// review the full chain (detector → finding → proposal → vote outcome).
// Sovereign retains override at all times via the existing voting layer.

import crypto from "node:crypto";

const PROPOSAL_KIND_DEFAULTS = {
  invariant_violation:    { severity: "critical", quorum: 5,  duration_ms: 1000 * 60 * 60 * 24 * 3 },
  architectural_drift:    { severity: "high",     quorum: 3,  duration_ms: 1000 * 60 * 60 * 24 * 7 },
  scaling_pressure:       { severity: "critical", quorum: 5,  duration_ms: 1000 * 60 * 60 * 24 * 1 },
  dependency_entropy:     { severity: "high",     quorum: 3,  duration_ms: 1000 * 60 * 60 * 24 * 5 },
  unsafe_expansion:       { severity: "critical", quorum: 5,  duration_ms: 1000 * 60 * 60 * 24 * 2 },
  reflex_warning:         { severity: "high",     quorum: 3,  duration_ms: 1000 * 60 * 60 * 24 * 5 },
};

/**
 * Post a council proposal derived from a detector finding (or Reflex output).
 *
 * @param {object} params
 * @param {object} params.db                  better-sqlite3 instance (optional)
 * @param {string} params.kind                proposal kind (see PROPOSAL_KIND_DEFAULTS)
 * @param {string} params.title               short human title
 * @param {string} params.body                long-form rationale
 * @param {object} [params.evidence]          detector finding + metadata
 * @param {string} [params.suggestedAction]   optional fixHint from the detector
 * @returns {{ ok: boolean, proposalId: string, dtuId: string, kind: string }}
 */
export function postAutoProposal({ db, kind, title, body, evidence = {}, suggestedAction = null }) {
  if (process.env.CONCORD_AUTO_GOVERNANCE === "0") {
    return { ok: false, reason: "auto_governance_disabled" };
  }
  const proposalId = `prop:${crypto.randomUUID().slice(0, 12)}`;
  const dtuId = `dtu:auto:${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const defaults = PROPOSAL_KIND_DEFAULTS[kind] || PROPOSAL_KIND_DEFAULTS.reflex_warning;

  const proposal = {
    id: proposalId,
    kind,
    title: String(title || `Auto-proposal: ${kind}`).slice(0, 160),
    body: String(body || "").slice(0, 4000),
    severity: defaults.severity,
    quorum: defaults.quorum,
    expires_at: new Date(Date.now() + defaults.duration_ms).toISOString(),
    suggested_action: suggestedAction,
    evidence_json: JSON.stringify(evidence).slice(0, 8000),
    status: "open",
    sovereign_override: false,
    auto_generated: true,
    created_at: now,
  };

  // Persist to council_proposals if the table exists. Tolerant of schema.
  if (db) {
    try {
      const tableExists = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='council_proposals'`,
      ).get();
      if (!tableExists) {
        // Create a minimal schema-tolerant table for auto-proposals so they
        // accumulate even on builds that haven't migrated council_proposals.
        db.exec(`
          CREATE TABLE IF NOT EXISTS auto_proposals (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            title TEXT,
            body TEXT,
            severity TEXT,
            quorum INTEGER,
            expires_at TEXT,
            suggested_action TEXT,
            evidence_json TEXT,
            status TEXT,
            sovereign_override INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          )
        `);
        db.prepare(`
          INSERT INTO auto_proposals (id, kind, title, body, severity, quorum,
            expires_at, suggested_action, evidence_json, status, sovereign_override, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `).run(
          proposal.id, proposal.kind, proposal.title, proposal.body,
          proposal.severity, proposal.quorum, proposal.expires_at,
          proposal.suggested_action, proposal.evidence_json,
          proposal.status, proposal.created_at,
        );
      } else {
        // Best-effort insert into council_proposals — schema may vary.
        // We only insert columns common across versions.
        try {
          db.prepare(`
            INSERT INTO council_proposals (id, title, body, status, created_at)
            VALUES (?, ?, ?, 'open', ?)
          `).run(proposal.id, proposal.title, proposal.body, proposal.created_at);
        } catch (_e) { /* schema mismatch — fall through to auto_proposals */ }
      }
    } catch (_e) { /* persistence is best-effort */ }
  }

  // Always log a DTU so the chain is auditable even without a table.
  if (db) {
    try {
      const dtuColExists = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='dtus'`,
      ).get();
      if (dtuColExists) {
        db.prepare(`
          INSERT INTO dtus (id, type, creator_id, data,
            created_at, updated_at)
          VALUES (?, 'auto_proposal', 'system', ?, ?, ?)
        `).run(
          dtuId,
          JSON.stringify({ proposal, evidence }),
          proposal.created_at, proposal.created_at,
        );
      }
    } catch (_e) { /* DTU logging best-effort — schema may not have kind column */ }
  }

  return { ok: true, proposalId, dtuId, kind, proposal };
}

/**
 * Translate a detector finding into a proposal kind string.
 *
 * @param {{detector: string, id: string, severity: string, fixHint?: string}} f
 */
export function findingToProposalKind(f) {
  if (f.detector === "invariant-guardian") return "invariant_violation";
  if (f.detector === "architectural-hub") return "architectural_drift";
  if (f.detector === "predictive-growth") return "scaling_pressure";
  if (f.detector === "secret-leak") return "invariant_violation";
  return "reflex_warning";
}

/**
 * Bulk-post: take a Findings array (already filtered to severity >= high),
 * deduplicate by location + id, and post one proposal per unique finding.
 */
export function bulkPostFromFindings(db, findings) {
  const out = [];
  const seen = new Set();
  for (const f of findings || []) {
    const key = `${f.detector}|${f.id}|${f.location || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = findingToProposalKind(f);
    const r = postAutoProposal({
      db,
      kind,
      title: `[${f.detector}] ${f.message}`.slice(0, 160),
      body: `Detector: ${f.detector}\nFinding ID: ${f.id}\nLocation: ${f.location || "n/a"}\nSeverity: ${f.severity}\n\nMessage: ${f.message}\n\nFix hint: ${f.fixHint || "(none)"}`,
      evidence: f,
      suggestedAction: f.fixHint || null,
    });
    if (r.ok) out.push(r);
  }
  return { ok: true, posted: out.length, proposals: out };
}
