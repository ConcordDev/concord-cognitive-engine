// server/lib/evo-asset/scheduler.js
// Heartbeat-driven evolution scheduler.
//
// Every ~5 minutes (every 100th heartbeat tick) the scheduler:
//   1. Recomputes evolution_score for the top N most-active assets
//   2. Selects up to 3 candidates with highest score
//   3. Picks the next refinement pass for each based on current quality_level
//   4. Runs the pass (cheap geometry passes inline; image-gen passes
//      submitted to a pending queue, processed by separate worker)
//   5. Submits the candidate to the quality gate via the bridge
//   6. On VERIFIED: promotes the version, bumps quality_level
//   7. On DISPUTED/QUARANTINED: leaves the candidate as a non-promoted
//      version row for lineage / rollback / audit
//
// Defensive throughout — every failure mode logs and moves on. Heartbeat
// must never crash here.

import {
  selectEvolutionCandidates,
  recomputeEvolutionScore,
  appendVersion,
  promoteVersion,
} from "./registry.js";
import {
  runSubdivisionPass,
  runMaterialUpgradePass,
  runWearPass,
  runDetailMapsPass,
  runHigherLodPass,
  nextPassFor,
} from "./refinement-passes.js";
import { submitAssetCandidateToGate } from "./quality-gate-bridge.js";

const TICK_INTERVAL = 100; // every 100th heartbeat tick

/**
 * @returns {Promise<{ checked: number, evolved: number, gated: number, errors: number }>}
 */
export async function runEvolutionTick(STATE, db, deps = {}) {
  const stats = { checked: 0, evolved: 0, gated: 0, errors: 0 };
  if (!db) return stats;

  // Select candidates: top 3 by evolution_score, not at max quality, not archived.
  let candidates = [];
  try {
    candidates = selectEvolutionCandidates(db, 3);
  } catch {
    stats.errors += 1;
    return stats;
  }

  for (const asset of candidates) {
    stats.checked += 1;
    try {
      // Recompute score so this tick's candidate selection becomes monotonic
      // (next tick won't pick the same asset if interaction has decayed).
      recomputeEvolutionScore(db, asset.id);

      const passKind = nextPassFor(asset.quality_level);
      if (!passKind) continue;

      // Compute interaction density for the wear pass.
      const interactionDensity = (() => {
        const now = Math.floor(Date.now() / 1000);
        const weekAgo = now - 7 * 86400;
        const r = db.prepare(`
          SELECT COUNT(*) AS n FROM evo_asset_interactions
           WHERE asset_id = ? AND ts >= ?
        `).get(asset.id, weekAgo);
        return r?.n ?? 0;
      })();

      const ageDays = (() => {
        const now = Math.floor(Date.now() / 1000);
        return Math.max(0, (now - asset.created_at) / 86400);
      })();

      let result = null;
      switch (passKind) {
        case "subdivision":
          result = await runSubdivisionPass(asset.id, asset.local_path);
          break;
        case "material_upgrade":
          result = runMaterialUpgradePass(asset.id, asset.local_path);
          break;
        case "procedural_wear":
          result = await runWearPass(asset.id, asset.local_path, { ageDays, interactionDensity });
          break;
        case "detail_maps":
          if (deps.callVision && deps.callImageGen) {
            result = await runDetailMapsPass(asset.id, asset.local_path, {
              callVision: deps.callVision,
              callImageGen: deps.callImageGen,
            });
          }
          break;
        case "higher_lod":
          result = await runHigherLodPass(asset.id, asset.local_path);
          break;
      }

      if (!result) continue;

      // Append a version row first (un-promoted). The gate verdict will
      // promote it (or not).
      const versionId = appendVersion(db, asset.id, {
        passKind: result.passKind,
        localPath: result.localPath,
        diffSummary: result.diffSummary,
      });

      // Submit to the Atlas 5-stage gate.
      stats.gated += 1;
      const gateResult = await submitAssetCandidateToGate(STATE, {
        assetId: asset.id,
        passKind: result.passKind,
        localPath: result.localPath,
        diffSummary: result.diffSummary,
        parentDtuId: asset.canonical_dtu_id,
      }, deps);

      // Record the gate verdict on the version row.
      try {
        db.prepare(`
          UPDATE evo_asset_versions
             SET gate_dtu_id = ?, gate_verdict = ?
           WHERE id = ?
        `).run(gateResult.dtuId ?? null, gateResult.verdict, versionId);
      } catch { /* non-fatal */ }

      if (gateResult.verdict === "verified") {
        promoteVersion(db, versionId);
        // If this is the first promotion, the asset's canonical_dtu_id
        // gets the new DTU id so future refinements chain off it.
        if (!asset.canonical_dtu_id && gateResult.dtuId) {
          db.prepare(`UPDATE evo_assets SET canonical_dtu_id = ? WHERE id = ?`)
            .run(gateResult.dtuId, asset.id);
        }
        stats.evolved += 1;
      }
    } catch {
      stats.errors += 1;
    }
  }

  return stats;
}

/**
 * Convenience: should this tick run the evolution scheduler?
 * Mirrors the existing pattern: every Nth heartbeat tick.
 */
export function shouldRunOnTick(tickCounter) {
  return (tickCounter || 0) % TICK_INTERVAL === 0;
}
