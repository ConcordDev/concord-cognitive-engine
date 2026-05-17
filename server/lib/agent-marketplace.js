// lib/agent-marketplace.js
//
// Phase 13 (Stage C) — agent marketplace: mint as DTU, list, run, earnings.
//
// Mirrors forge-marketplace.js shape. Agents are stored as kind='agent_spec'
// DTUs (column is unconstrained TEXT — no migration needed for the kind
// itself; migration 202 adds query indexes).
//
// Royalty cascade is opt-in: pass parent_dtu_ids to register citations
// against parent agents/templates. Subsequent purchases pay the cascade
// per royalty-cascade.js (95/5 fee with the existing constants — see
// CLAUDE.md "Marketplace fees are hardcoded" invariant).

import crypto from "node:crypto";
import { validateAgentManifest, capabilitySet } from "./agent-spec-validator.js";

/**
 * Mint an agent manifest as a kind='agent_spec' DTU.
 * Registers citation cascade against parent_dtu_ids on success.
 */
export async function mintAgentAsDtu(db, opts) {
  if (!db) return { ok: false, reason: "no_db" };
  const { userId, agentManifest, summary } = opts || {};
  if (!userId) return { ok: false, reason: "missing_user" };
  const v = validateAgentManifest(agentManifest);
  if (!v.ok) return { ok: false, reason: "invalid_manifest", detail: v.reason };

  const manifest = v.normalized;
  const dtuId = `dtu:agent:${crypto.randomUUID()}`;
  const sourceSha1 = crypto.createHash("sha1")
    .update(JSON.stringify(manifest))
    .digest("hex").slice(0, 16);
  const meta = {
    scope: "public",
    agent_manifest: manifest,
    summary: summary || manifest.summary || "",
    source_sha1: sourceSha1,
    capabilities: [...capabilitySet(manifest)],
  };

  try {
    db.prepare(`
      INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
      VALUES (?, 'agent_spec', ?, ?, ?, 1, 0, unixepoch())
    `).run(dtuId, manifest.name, userId, JSON.stringify(meta));
  } catch (err) {
    return { ok: false, reason: "dtu_insert_failed", error: err?.message };
  }

  // Citation cascade — best-effort. parent_dtu_ids may reference other
  // agents OR DTUs (forge_app, lattice_born_quest, etc).
  const citationIds = [];
  if (manifest.parent_dtu_ids.length > 0) {
    try {
      const royalty = await import("../economy/royalty-cascade.js");
      for (const parentId of manifest.parent_dtu_ids) {
        try {
          const parent = db.prepare(`SELECT id, creator_id, meta_json FROM dtus WHERE id = ?`).get(parentId);
          if (parent && royalty?.registerCitation) {
            const r = royalty.registerCitation(db, {
              childId: dtuId,
              parentId,
              creatorId: userId,
              parentCreatorId: parent.creator_id,
              parentDtu: { ...parent, visibility: "public" },
              generation: 1,
            });
            if (r?.ok) citationIds.push(r.citationId || r.id || null);
          }
        } catch { /* per-parent best-effort */ }
      }
    } catch { /* royalty-cascade tables optional */ }
  }

  return { ok: true, dtuId, citationIds };
}

/**
 * List an agent DTU on the marketplace. Targets creative_artifact_listings
 * (v2 schema); falls back to marketplace_listings if v2 is absent.
 */
export function listAgentOnMarketplace(db, opts) {
  if (!db) return { ok: false, reason: "no_db" };
  const { dtuId, sellerId, priceCents, currency = "USD", title, description } = opts || {};
  if (!dtuId || !sellerId || !(priceCents > 0)) return { ok: false, reason: "missing_inputs" };

  try {
    const id = `cal_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO creative_artifact_listings
        (id, artifact_id, seller_id, price, currency, status, listed_at)
      VALUES (?, ?, ?, ?, ?, 'active', unixepoch())
    `).run(id, dtuId, sellerId, priceCents, currency);
    return { ok: true, listingId: id, schema: "creative_artifact_listings" };
  } catch { /* try v1 */ }

  try {
    const id = `ml_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO marketplace_listings
        (id, owner_user_id, title, description, price_cents, currency, visibility)
      VALUES (?, ?, ?, ?, ?, ?, 'published')
    `).run(id, sellerId, title || "Agent", description || "", priceCents, currency);
    return { ok: true, listingId: id, schema: "marketplace_listings" };
  } catch (err) {
    return { ok: false, reason: "no_marketplace_schema", error: err?.message };
  }
}

/**
 * List a user's published agents (kind='agent_spec' DTUs they authored).
 */
export function listAgentsForUser(db, userId, limit = 50) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, title, meta_json, created_at FROM dtus
      WHERE kind = 'agent_spec' AND creator_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(userId, limit);
  } catch { return []; }
}

/**
 * Aggregate royalty earnings for the user's published agents. Reads
 * royalty_payouts where recipient_id matches and content_id is one of
 * the user's agent_spec DTUs.
 */
export function getAgentEarnings(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_user" };
  const agentDtuFilter = opts.agentDtuId ? `AND rp.content_id = ?` : ``;
  const args = opts.agentDtuId ? [userId, opts.agentDtuId] : [userId];

  let total = 0;
  let byContent = [];
  try {
    const rows = db.prepare(`
      SELECT rp.content_id AS dtuId,
             COALESCE(d.title, '') AS title,
             SUM(rp.amount) AS total,
             COUNT(*) AS count
      FROM royalty_payouts rp
      LEFT JOIN dtus d ON d.id = rp.content_id
      WHERE rp.recipient_id = ?
        AND rp.content_id IN (
          SELECT id FROM dtus WHERE kind = 'agent_spec' AND creator_id = ?
        )
        ${agentDtuFilter}
      GROUP BY rp.content_id
      ORDER BY total DESC
    `).all(...args, userId);
    byContent = rows;
    total = rows.reduce((s, r) => s + (r.total || 0), 0);
  } catch (err) {
    return { ok: false, reason: "no_payouts_schema", error: err?.message };
  }

  return { ok: true, totalEarned: total, byContent };
}

/**
 * Read an agent DTU + parsed manifest. Re-validates the manifest at load
 * time to catch drift between persisted JSON and current spec.
 */
export function loadAgent(db, dtuId) {
  if (!db || !dtuId) return { ok: false, reason: "no_input" };
  let row;
  try {
    row = db.prepare(`SELECT id, kind, title, creator_id, meta_json FROM dtus WHERE id = ?`).get(dtuId);
  } catch (err) { return { ok: false, reason: "lookup_failed", error: err?.message }; }
  if (!row) return { ok: false, reason: "not_found" };
  if (row.kind !== "agent_spec") return { ok: false, reason: "wrong_kind", kind: row.kind };
  let meta;
  try { meta = JSON.parse(row.meta_json || "{}"); }
  catch (err) { return { ok: false, reason: "meta_parse_failed", error: err?.message }; }
  const v = validateAgentManifest(meta.agent_manifest);
  if (!v.ok) return { ok: false, reason: "manifest_drift", detail: v.reason };
  return { ok: true, dtuId: row.id, title: row.title, creatorId: row.creator_id, manifest: v.normalized, meta };
}
