// server/lib/evo-asset/scheduler.js
// Heartbeat-driven evolution scheduler.
//
// Every 100th governorTick() call the scheduler fires. governorTick()'s own
// interval defaults to 60s (server.js's _startGovernorHeartbeat,
// clamp(heartbeatMs ?? 60000, 15s, 10min)), so this is ~100 minutes between
// evolution ticks by default, not the "~5 minutes" this comment used to
// claim — that figure assumed a faster per-entity tick loop elsewhere in
// the codebase, not the actual governor interval this gate reads from
// (STATE.__bgTickCounter, incremented once per governorTick() call). The
// scheduler does run and IS live at boot (verified against
// _startGovernorHeartbeat's setTimeout(..., 50_000) boot wiring) — the
// interval was simply mis-documented.
//
// On each fire the scheduler:
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
import { runAssetGenerationTick } from "../asset-gen/generate-asset.js";

const TICK_INTERVAL = 100; // every 100th heartbeat tick

/**
 * @returns {Promise<{ checked: number, evolved: number, gated: number, errors: number }>}
 */
export async function runEvolutionTick(STATE, db, deps = {}) {
  const stats = { checked: 0, evolved: 0, gated: 0, errors: 0, generated: 0 };
  if (!db) return stats;

  // Program C, Stage 5 hook (2026-07-23) — CREATE path, distinct from the
  // REFINE loop below. Generates + FEA-validates + registers any missing
  // target from lib/asset-gen/generate-asset.js's GENERATION_TARGETS, then
  // submits it to the same quality gate the refine loop uses below. Thin,
  // guarded, kill-switchable (CONCORD_ASSET_GEN_ENABLED=0 disables) — never
  // touches the candidate-selection/refine loop that follows.
  try {
    const genStats = await runAssetGenerationTick(STATE, db, deps);
    stats.generated = genStats.generated;
  } catch {
    stats.errors += 1;
  }

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

      // GLB refinement is now wired (2026-07-23): subdivision /
      // procedural_wear / higher_lod route .glb/.gltf sources through
      // lib/evo-asset/glb-bridge.js — extract vertex data, run the SAME pure
      // transform (subdivideGeometry / applyProceduralWear), and pack a real
      // .glb variant back out. The {positions, indices} mesh-JSON seed path
      // (content/evo-seed/*.mesh.json) is byte-identical to before. And
      // material_upgrade is no longer orphaned — it flows through the new
      // GET /api/evo-asset/material endpoint + resolveMaterialUpgrade in the
      // frontend loader (consumed by BuildingRenderer3D), and is excluded
      // from the geometry channel so a promoted material JSON can't be served
      // as a mesh.
      //
      // Honest residuals still open (v1 limits, not silently swallowed):
      //   (a) multi-mesh / multi-primitive GLBs throw a named error in
      //       extractMeshData → the pass returns null (single-primitive only).
      //   (b) sources over 1500 input tris still refuse subdivision (the
      //       pre-existing subdivideGeometry cap — unchanged).
      //   (c) detail_maps still needs callImageGen, wired to an async()=>null
      //       stub in this build — OUT OF SCOPE, deferred as before.

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

      // Record the gate verdict on the version row. This persistence is
      // load-bearing: the next refinement loop reads gate_verdict to skip
      // already-verified versions. A silent failure here means the same
      // version gets re-submitted to the gate every cycle, eating quota
      // and never advancing canonical_dtu_id.
      try {
        db.prepare(`
          UPDATE evo_asset_versions
             SET gate_dtu_id = ?, gate_verdict = ?
           WHERE id = ?
        `).run(gateResult.dtuId ?? null, gateResult.verdict, versionId);
      } catch (err) {
        // Log + skip promotion — promoting without the persisted verdict
        // would orphan the canonical pointer from the version metadata.
        if (typeof deps.log === "function") deps.log("warn", "evo_gate_persist_failed", { versionId, err: err?.message });
        else if (typeof console !== "undefined") console.warn("[evo-asset] gate verdict persist failed", versionId, err?.message);
        continue;
      }

      if (gateResult.verdict === "verified") {
        promoteVersion(db, versionId);
        // If this is the first promotion, the asset's canonical_dtu_id
        // gets the new DTU id so future refinements chain off it.
        if (!asset.canonical_dtu_id && gateResult.dtuId) {
          db.prepare(`UPDATE evo_assets SET canonical_dtu_id = ? WHERE id = ?`)
            .run(gateResult.dtuId, asset.id);
        }
        stats.evolved += 1;

        // Notify clients so LevelUpJuiceBridge can fire the "manifested
        // fused power" toast + fanfare. Emit is best-effort — heartbeat
        // must never crash if the realtime layer is unavailable.
        if (typeof deps.realtimeEmit === "function") {
          try {
            deps.realtimeEmit("evo:asset-promoted", {
              assetId: asset.id,
              versionId,
              passKind: result.passKind,
              diffSummary: result.diffSummary ?? null,
              dtuId: gateResult.dtuId ?? null,
            });
          } catch { /* non-fatal */ }
        }
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
