// server/domains/evo-asset.js
//
// R8/CL3 gap fix — the missing on-demand generation trigger for Program C's
// generative pipeline (server/lib/asset-gen/generate-asset.js).
//
// REAL GAP FOUND (server/tests/e2e/design-simulate-fea-loop.test.js's header):
// `generateValidatedAsset` / `runAssetGenerationTick` compose correctly
// end-to-end (parametric mesh -> real FEA structural gate -> mass grounding ->
// pack .glb -> register -> Atlas quality gate -> promote -> resolve), but the
// ONLY production caller was the fixed, one-item `GENERATION_TARGETS`
// heartbeat list (server/lib/evo-asset/scheduler.js). There was no macro or
// HTTP route letting a player or ConKay request a CUSTOM on-demand design —
// the pipeline could only ever regenerate the same pre-baked "sword" target.
//
// This macro is that missing trigger. It runs the caller's own params through
// the EXACT SAME validated pipeline the heartbeat uses — never a shortcut
// that skips the FEA structural gate — and returns a real, resolvable
// result. Honest failure (per CLAUDE.md "honest by construction"): a design
// that never structurally converges returns { ok:false, reason:
// 'fea_did_not_converge' } with nothing registered — no fabricated success.
//
//   evo-asset.generate
//     input: { archetype?='sword', params?={}, material?, maxIters?,
//               tipLoadN?, safetyFactor?, thickenFactor?, useCase? }
//     `outDir` is intentionally NEVER accepted from macro input — path
//     placement always goes through generateValidatedAsset's own default
//     (EVO_ASSET_GEN_DIR), so a macro caller has no path-traversal knob.

import {
  generateValidatedAsset,
  registerGeneratedAsset,
  targetSourceId,
} from "../lib/asset-gen/generate-asset.js";
import { submitAssetCandidateToGate } from "../lib/evo-asset/quality-gate-bridge.js";
import { resolveCurrentBest, promoteVersion } from "../lib/evo-asset/registry.js";

// optimizeToPass's own bounded search loop already caps iterations
// internally; this is an additional ceiling on what a macro CALLER can ask
// for, so an abusive input can't request an unreasonably long solver run.
const MAX_ITERS_CAP = 30;

function finiteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function registerEvoAssetMacros(register) {
  register("evo-asset", "generate", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };

    const archetype = typeof input.archetype === "string" && input.archetype ? input.archetype : "sword";
    const params = input.params && typeof input.params === "object" && !Array.isArray(input.params) ? input.params : {};

    const genOpts = { archetype, params };
    if (typeof input.material === "string" && input.material) genOpts.material = input.material;
    const maxIters = finiteNumber(input.maxIters);
    if (maxIters !== undefined) genOpts.maxIters = Math.max(1, Math.min(MAX_ITERS_CAP, Math.floor(maxIters)));
    const tipLoadN = finiteNumber(input.tipLoadN);
    if (tipLoadN !== undefined) genOpts.tipLoadN = tipLoadN;
    const safetyFactor = finiteNumber(input.safetyFactor);
    if (safetyFactor !== undefined) genOpts.safetyFactor = safetyFactor;
    const thickenFactor = finiteNumber(input.thickenFactor);
    if (thickenFactor !== undefined) genOpts.thickenFactor = thickenFactor;
    if (typeof input.useCase === "string" && input.useCase) genOpts.useCase = input.useCase;
    // NOTE: `outDir` is deliberately never forwarded from `input` — see file header.

    let generated;
    try {
      generated = await generateValidatedAsset(genOpts);
    } catch (err) {
      return { ok: false, reason: "generation_error", error: err?.message };
    }

    if (!generated.ok) {
      // Honest non-fabrication: the SAME structural gate the heartbeat
      // respects rejected this design. No file was written; nothing to
      // register. Never synthesize a fallback "close enough" asset.
      return {
        ok: false,
        archetype,
        reason: generated.reason,
        optimizeReason: generated.optimizeReason,
        history: generated.history,
        params: generated.params,
        error: generated.error,
      };
    }

    const sourceId = targetSourceId(archetype, generated.params);
    const reg = registerGeneratedAsset(db, {
      archetype,
      params: generated.params,
      glbPath: generated.glbPath,
      massProps: generated.massProps,
      feaResult: generated.feaResult,
      sourceId,
    });

    // Submit to the SAME Atlas quality-gate bridge the fixed-target heartbeat
    // uses (server/lib/evo-asset/scheduler.js#runEvolutionTick) — an
    // on-demand generation earns its promotion the identical way a refined
    // or auto-generated candidate does, never a shortcut path. The atlas
    // modules are lazy-imported (matching the "wire-the-unwired" pattern
    // used throughout server.js) to avoid a load-order dependency between
    // this domain file and the emergent/atlas-* modules.
    let gateResult = { verdict: "pending" };
    try {
      const [atlasMod, guardMod] = await Promise.all([
        import("../emergent/atlas-store.js").catch(() => null),
        import("../emergent/atlas-write-guard.js").catch(() => null),
      ]);
      gateResult = await submitAssetCandidateToGate(ctx?.state || {}, {
        assetId: reg.assetId,
        passKind: "authored_replacement",
        localPath: generated.glbPath,
        diffSummary: `on-demand generated ${archetype} mass=${generated.massProps.mass_kg.toFixed(3)}kg util=${generated.feaResult.maxUtilization.toFixed(3)}`,
        parentDtuId: null,
      }, {
        createAtlasDtu: atlasMod?.createAtlasDtu,
        runAutoPromoteGate: guardMod?.runAutoPromoteGate,
        promoteAtlasDtu: atlasMod?.promoteAtlasDtu,
      });
    } catch (err) {
      gateResult = { verdict: "pending", error: err?.message };
    }

    try {
      db.prepare(`
        UPDATE evo_asset_versions SET gate_dtu_id = ?, gate_verdict = ? WHERE id = ?
      `).run(gateResult.dtuId ?? null, gateResult.verdict, reg.versionId);
    } catch {
      // best-effort stamp only — the asset is still genuinely registered
      // even if this particular column update fails (e.g. older schema).
    }

    let promoted = false;
    if (gateResult.verdict === "verified") {
      try {
        promoteVersion(db, reg.versionId);
        db.prepare(`
          UPDATE evo_assets SET canonical_dtu_id = COALESCE(canonical_dtu_id, ?) WHERE id = ?
        `).run(gateResult.dtuId ?? null, reg.assetId);
        promoted = true;
      } catch {
        // Leave unpromoted — still a real, registered, gated candidate;
        // never fabricate a promotion that didn't actually happen.
      }
    }

    const resolved = resolveCurrentBest(db, { source: "evolved", sourceId });

    return {
      ok: true,
      archetype,
      assetId: reg.assetId,
      versionId: reg.versionId,
      sourceId,
      created: reg.created,
      params: generated.params,
      massProps: generated.massProps,
      feaResult: generated.feaResult,
      gateVerdict: gateResult.verdict,
      promoted,
      resolved: resolved ? { canonicalPath: resolved.canonicalPath, qualityLevel: resolved.qualityLevel } : null,
    };
  }, {
    description: "On-demand custom asset design generation — parametric mesh -> real FEA structural gate -> mass grounding -> pack .glb -> register -> Atlas quality gate -> promote -> resolve, the SAME validated pipeline the fixed-target GENERATION_TARGETS heartbeat uses (server/lib/asset-gen/generate-asset.js). Honest failure (no file, no registration) when the design never structurally converges. Previously this pipeline had no macro or HTTP trigger at all — only the heartbeat could invoke it, and only for its one hardcoded 'sword' target.",
  });
}
