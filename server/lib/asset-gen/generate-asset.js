// server/lib/asset-gen/generate-asset.js
//
// Program C, Stage 5 — closes the loop end-to-end: generated geometry
// (Stage 2) + real-material mass grounding (Stage 3) + FEA structural
// validation (Stage 4) becomes a real, on-disk, promotable evo-asset that
// flows through the EXISTING evo-asset registry / quality-gate / resolve
// pipeline unchanged.
//
// This module is deliberately distinct from server/lib/evo-asset/
// refinement-passes.js: a refinement pass MUTATES an existing asset
// (subdivide/wear/LOD an already-registered mesh); `generateValidatedAsset`
// CREATES a brand-new asset from parameters. The two are complementary, not
// overlapping — see nextPassFor/PASS_ORDER in refinement-passes.js for the
// mutation side.
//
// Honest-by-construction gate (per CLAUDE.md): `generateValidatedAsset`
// packs a .glb ONLY when `optimizeToPass` (Stage 4) reports a structurally
// converged design. A design that never converges within the bounded
// iteration budget returns `{ ok:false, reason:'fea_did_not_converge' }` —
// no file is ever written for a structurally-invalid part. There is no
// silent partial-success path.

import fs from "fs";
import path from "path";
import crypto from "crypto";

import { optimizeToPass } from "./fea-gate.js";
import { generateSwordMeshWithNormals } from "./parametric-mesh.js";
import { massProperties } from "./mass-properties.js";
import { packGLB } from "../evo-asset/glb-bridge.js";
import { registerAsset, appendVersion, promoteVersion } from "../evo-asset/registry.js";
import { submitAssetCandidateToGate } from "../evo-asset/quality-gate-bridge.js";

// ── Archetype registry ──────────────────────────────────────────────────
// Only "sword" is implemented (parametric-mesh.js's only Stage-2 archetype
// today). Adding a new archetype means adding a `generateWithNormals` +
// `defaultMaterial` entry here — no other change to this module's flow.
const ARCHETYPES = Object.freeze({
  sword: {
    generateWithNormals: generateSwordMeshWithNormals,
    defaultMaterial: "steel-a36",
  },
});

const GENERATED_ASSET_DIR = process.env.EVO_ASSET_GEN_DIR
  || path.join(process.env.DATA_DIR || "./data", "evo-assets", "generated");

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
}

/**
 * The full generation chain for a single archetype:
 *   optimizeToPass(params)  — Stage 4, bounded adjust-and-rerun FEA loop
 *     → generateSwordMeshWithNormals(finalParams) — Stage 2 + normals
 *     → massProperties(mesh, material)            — Stage 3
 *     → packGLB(...)                               — real .glb on disk
 *
 * NEVER packs/emits a structurally-invalid asset: if `optimizeToPass` does
 * not converge (exhausted its iteration budget, or hit a hard precondition
 * failure thickening can't fix — e.g. an unreasonable load or an unknown
 * material), this returns an honest `{ ok:false, reason:'fea_did_not_converge', history }`
 * with NO file written.
 *
 * @param {object} opts
 * @param {string} [opts.archetype="sword"]
 * @param {object} [opts.params={}]        forwarded to the mesh generator (pre-optimization seed)
 * @param {string} [opts.material]         MATERIAL_LIBRARY key; defaults to the archetype's default
 * @param {string} [opts.outDir]           directory to write the .glb into (default EVO_ASSET_GEN_DIR)
 * @param {number} [opts.maxIters]         forwarded to optimizeToPass
 * @param {number} [opts.tipLoadN]         forwarded to optimizeToPass / structuralCheck
 * @param {number} [opts.safetyFactor]     forwarded to optimizeToPass / structuralCheck
 * @param {number} [opts.thickenFactor]    forwarded to optimizeToPass
 * @param {string} [opts.useCase]          forwarded to structuralCheck (only "sword-bending" supported)
 * @returns {Promise<{
 *   ok: true, archetype: string, glbPath: string, massProps: object,
 *   feaResult: object, params: object, history: Array
 * } | {
 *   ok: false, reason: string, history?: Array, params?: object, error?: string
 * }>}
 */
export async function generateValidatedAsset(opts = {}) {
  const {
    archetype = "sword",
    params = {},
    material,
    outDir,
    maxIters,
    tipLoadN,
    safetyFactor,
    thickenFactor,
    useCase,
    generate, // test-only override, forwarded to optimizeToPass
  } = opts;

  const arch = ARCHETYPES[archetype];
  if (!arch) {
    return { ok: false, reason: "unknown_archetype", archetype };
  }
  const mat = material || arch.defaultMaterial;

  const optimizeOpts = { material: mat };
  if (maxIters !== undefined) optimizeOpts.maxIters = maxIters;
  if (tipLoadN !== undefined) optimizeOpts.tipLoadN = tipLoadN;
  if (safetyFactor !== undefined) optimizeOpts.safetyFactor = safetyFactor;
  if (thickenFactor !== undefined) optimizeOpts.thickenFactor = thickenFactor;
  if (useCase !== undefined) optimizeOpts.useCase = useCase;
  if (generate !== undefined) optimizeOpts.generate = generate;

  let optResult;
  try {
    optResult = await optimizeToPass(params, optimizeOpts);
  } catch (err) {
    // A thrown error here means the mesh generator itself rejected the
    // params (e.g. a bad shape/negative dimension) — honest failure, no file.
    return { ok: false, reason: "fea_did_not_converge", error: err?.message, params };
  }

  if (!optResult.ok) {
    // Covers both optimizeToPass exhaustion ("did_not_converge") and a hard
    // precondition failure thickening can't fix ("cannot_converge") — from
    // this module's perspective both mean the same thing: no structurally
    // valid design was found, so nothing gets packed.
    return {
      ok: false,
      reason: "fea_did_not_converge",
      optimizeReason: optResult.reason,
      history: optResult.history,
      params: optResult.params ?? params,
    };
  }

  // Regenerate the CONVERGED params with real vertex normals — the search
  // loop inside optimizeToPass uses the plain (normal-less) generator for
  // speed, so the final artifact needs one more (byte-identical-geometry)
  // pass through the "WithNormals" convenience wrapper.
  let meshWithNormals;
  try {
    meshWithNormals = await arch.generateWithNormals(optResult.params);
  } catch (err) {
    return { ok: false, reason: "mesh_regen_failed", error: err?.message, params: optResult.params };
  }

  let massProps;
  try {
    massProps = massProperties(meshWithNormals, mat);
  } catch (err) {
    return { ok: false, reason: "mass_properties_failed", error: err?.message, params: optResult.params };
  }

  const dir = outDir || GENERATED_ASSET_DIR;
  ensureDir(dir);
  const paramsHash = crypto.createHash("sha1").update(JSON.stringify(optResult.params)).digest("hex").slice(0, 10);
  const stamp = Date.now().toString(36);
  const glbPath = path.join(dir, `${archetype}_${paramsHash}_${stamp}.glb`);

  try {
    await packGLB({
      positions: meshWithNormals.positions,
      indices: meshWithNormals.indices,
      normals: meshWithNormals.normals,
    }, glbPath);
  } catch (err) {
    return { ok: false, reason: "pack_glb_failed", error: err?.message, params: optResult.params };
  }

  return {
    ok: true,
    archetype,
    material: mat,
    glbPath,
    massProps,
    feaResult: optResult.check,
    params: optResult.params,
    history: optResult.history,
  };
}

/**
 * Deterministic idempotency key for a generation TARGET (archetype + the
 * pre-optimization seed params a caller asked for) — distinct from the
 * converged output params, which vary run-to-run as optimizeToPass
 * thickens a marginal design. Used so the same requested target is never
 * re-generated once it has a registered asset.
 */
export function targetSourceId(archetype, params = {}) {
  const hash = crypto.createHash("sha1").update(JSON.stringify({ archetype, params })).digest("hex").slice(0, 16);
  return `generated:${archetype}:${hash}`;
}

/**
 * Register a successfully-generated asset (registerAsset) and append its
 * first version row (appendVersion) — the same two registry primitives
 * every refinement candidate goes through, so a generated asset is
 * indistinguishable from a refined one to the rest of the pipeline
 * (gate submission, promotion, `/api/evo-asset/resolve`).
 *
 * The version's `pass_kind` is `'authored_replacement'` — the existing
 * `evo_asset_versions` CHECK constraint's closest fit for "a freshly
 * generated asset, not a mutation of a prior one" (no new migration needed).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{archetype:string, params:object, glbPath:string, massProps?:object, feaResult?:object, sourceId?:string}} opts
 * @returns {{assetId:string, created:boolean, versionId:string, sourceId:string}}
 */
export function registerGeneratedAsset(db, opts) {
  const { archetype, params, glbPath, massProps, feaResult, sourceId } = opts;
  const sid = sourceId || targetSourceId(archetype, params);
  const reg = registerAsset(db, {
    kind: "mesh",
    source: "evolved",
    sourceId: sid,
    localPath: glbPath,
    category: archetype,
    tags: ["generated", archetype],
    qualityLevel: 0,
  });
  const massLabel = typeof massProps?.mass_kg === "number" ? massProps.mass_kg.toFixed(3) : "?";
  const utilLabel = typeof feaResult?.maxUtilization === "number" ? feaResult.maxUtilization.toFixed(3) : "n/a";
  const versionId = appendVersion(db, reg.id, {
    passKind: "authored_replacement",
    localPath: glbPath,
    diffSummary: `generated ${archetype} mass=${massLabel}kg util=${utilLabel}`,
  });
  return { assetId: reg.id, created: reg.created, versionId, sourceId: sid };
}

// Fixed, small set of generation targets this hook is responsible for
// creating when missing. Kept here (not scheduler.js) so the scheduler
// stays a thin dispatcher — extend this list to generate more archetypes.
export const GENERATION_TARGETS = Object.freeze([
  { archetype: "sword", params: {}, material: "steel-a36" },
]);

/**
 * Thin heartbeat-tick orchestrator (the "wire-the-unwired" shape): for each
 * target in GENERATION_TARGETS not already registered, generate + validate
 * + pack a real .glb, register it, and submit it to the SAME quality-gate
 * bridge (`submitAssetCandidateToGate`) every refinement candidate goes
 * through — on a VERIFIED verdict it promotes exactly like
 * `runEvolutionTick` does, so a generated asset resolves via the same
 * `resolveCurrentBest` / `/api/evo-asset/resolve` path as everything else.
 *
 * Guarded by `CONCORD_ASSET_GEN_ENABLED` (default enabled; set to `"0"` to
 * disable). Never throws — every failure is caught and counted.
 *
 * @param {object} STATE   server STATE map (forwarded to the gate bridge)
 * @param {import('better-sqlite3').Database} db
 * @param {object} [deps]  { createAtlasDtu, runAutoPromoteGate, promoteAtlasDtu, realtimeEmit, log }
 * @returns {Promise<{checked:number, generated:number, gated:number, promoted:number, errors:number}>}
 */
export async function runAssetGenerationTick(STATE, db, deps = {}) {
  const stats = { checked: 0, generated: 0, gated: 0, promoted: 0, errors: 0 };
  if (!db) return stats;
  if (process.env.CONCORD_ASSET_GEN_ENABLED === "0") return stats;

  for (const target of GENERATION_TARGETS) {
    stats.checked += 1;
    try {
      const sourceId = targetSourceId(target.archetype, target.params);
      const existing = db.prepare(`
        SELECT id FROM evo_assets WHERE source = 'evolved' AND source_id = ?
      `).get(sourceId);
      if (existing) continue; // this target already has a registered asset

      const result = await generateValidatedAsset({
        archetype: target.archetype,
        params: target.params,
        material: target.material,
      });
      if (!result.ok) continue; // honest non-fabrication: no file, no registration

      const { assetId, versionId } = registerGeneratedAsset(db, {
        archetype: target.archetype,
        params: target.params,
        glbPath: result.glbPath,
        massProps: result.massProps,
        feaResult: result.feaResult,
        sourceId,
      });
      stats.generated += 1;

      stats.gated += 1;
      const gateResult = await submitAssetCandidateToGate(STATE, {
        assetId,
        passKind: "authored_replacement",
        localPath: result.glbPath,
        diffSummary: `generated ${target.archetype} mass=${result.massProps.mass_kg.toFixed(3)}kg`,
        parentDtuId: null,
      }, deps);

      try {
        db.prepare(`
          UPDATE evo_asset_versions SET gate_dtu_id = ?, gate_verdict = ? WHERE id = ?
        `).run(gateResult.dtuId ?? null, gateResult.verdict, versionId);
      } catch (err) {
        if (typeof deps.log === "function") deps.log("warn", "evo_asset_gen_gate_persist_failed", { versionId, err: err?.message });
        continue;
      }

      if (gateResult.verdict === "verified") {
        promoteVersion(db, versionId);
        db.prepare(`
          UPDATE evo_assets SET canonical_dtu_id = COALESCE(canonical_dtu_id, ?) WHERE id = ?
        `).run(gateResult.dtuId ?? null, assetId);
        stats.promoted += 1;

        if (typeof deps.realtimeEmit === "function") {
          try {
            deps.realtimeEmit("evo:asset-promoted", {
              assetId,
              versionId,
              passKind: "authored_replacement",
              diffSummary: `generated ${target.archetype}`,
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
