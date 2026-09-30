// server/routes/conkay-design.js
// POST /api/conkay/design — free-text NLP → intent → runFEA + partMesh → mesh arrays.
// POST /api/conkay/design-glb — free-text → archetype keyword → evo-asset generate → resolve URL.
// Auth required. Deterministic; no LLM; no fake FEA / no fabricated GLB.

import { Router } from 'express';
import {
  parseDesignIntent,
  intentToPartMeshParams,
  intentToFeaModel,
  buildPartMesh,
  feaUtilToColor,
} from '../lib/conkay/nlp-design-intent.js';
import {
  generateValidatedAsset,
  registerGeneratedAsset,
} from '../lib/asset-gen/generate-asset.js';
import { resolveCurrentBest, promoteVersion } from '../lib/evo-asset/registry.js';

const ARCHETYPES = Object.freeze(['sword', 'spear', 'staff', 'mace', 'shield']);
const ARCHETYPE_RE = /\b(sword|spear|staff|mace|shield)\b/i;

/** Fail-closed archetype parse from free text (keywords only — not full CAD NLP). */
export function parseArchetypeFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'empty_text', code: 'EMPTY' };
  const m = raw.match(ARCHETYPE_RE);
  if (!m) {
    return {
      ok: false,
      error: `no_archetype_keyword — need one of: ${ARCHETYPES.join(', ')}`,
      code: 'NO_ARCHETYPE',
    };
  }
  return { ok: true, archetype: m[1].toLowerCase(), text: raw };
}

/** Known-robust seed params so FEA converges quickly (mirrors e2e macro test). */
function seedParamsForArchetype(archetype) {
  if (archetype === 'sword' || archetype === 'spear') {
    return { bladeBaseThickness: 0.012 };
  }
  return {};
}

function absoluteGlbUrl(req, relativeUrl) {
  // Prefer same-origin absolute for Unity WebGL on :3000 (Next rewrites /api/*).
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const xfHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  if (xfProto && xfHost) return `${xfProto}://${xfHost}${relativeUrl}`;
  const host = String(req.headers.host || '127.0.0.1:5050');
  const proto = req.secure || xfProto === 'https' ? 'https' : 'http';
  // When called directly on :5050, still return a :3000 absolute if Referer/Origin is frontend —
  // Unity iframe lives on the frontend origin and same-origin fetch needs :3000.
  const originHdr = String(req.headers.origin || '');
  const referer = String(req.headers.referer || '');
  if (originHdr.startsWith('http://127.0.0.1:3000') || originHdr.startsWith('http://localhost:3000')) {
    return `${originHdr.replace(/\/$/, '')}${relativeUrl}`;
  }
  if (referer.includes('127.0.0.1:3000') || referer.includes('localhost:3000')) {
    const base = referer.includes('localhost:3000') ? 'http://localhost:3000' : 'http://127.0.0.1:3000';
    return `${base}${relativeUrl}`;
  }
  return `${proto}://${host}${relativeUrl}`;
}

export default function createConkayDesignRouter({ requireAuth, db }) {
  const router = Router();
  const auth = requireAuth;

  /**
   * POST /api/conkay/design
   * body: { text: string }
   * → { ok, intent, fea?, mesh:{positions,indices,...}, utilColor }
   */
  router.post('/design', auth, async (req, res) => {
    try {
      const text = req.body?.text ?? req.body?.prompt ?? '';
      const parsed = parseDesignIntent(String(text));
      if (!parsed.ok) {
        return res.status(400).json({ ok: false, error: parsed.error, code: parsed.code });
      }
      const intent = parsed.intent;
      const { kind, params } = intentToPartMeshParams(intent);
      const mesh = buildPartMesh(kind, params);

      let fea = null;
      let utilColor = feaUtilToColor(0.125);
      try {
        const { runFEA } = await import('../lib/simulation/fea-solver.js');
        const model = intentToFeaModel(intent);
        const result = runFEA(model);
        if (result && result.ok !== false) {
          const maxUtilization = Number(result.summary?.maxUtilization);
          if (Number.isFinite(maxUtilization)) {
            utilColor = feaUtilToColor(maxUtilization);
            fea = {
              ok: true,
              maxUtilization,
              jobId: result.jobId ?? null,
              band: utilColor.band,
              summary: result.summary ?? null,
            };
          } else {
            fea = { ok: true, maxUtilization: null, note: 'runFEA ok but maxUtilization missing' };
          }
        } else {
          fea = { ok: false, error: result?.error || 'runFEA failed' };
        }
      } catch (e) {
        fea = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }

      return res.json({
        ok: true,
        intent,
        fea,
        mesh: {
          positions: mesh.positions,
          indices: mesh.indices,
          kind: mesh.kind,
          vertexCount: mesh.vertexCount,
          triangleCount: mesh.triangleCount,
        },
        utilColor,
        honesty: {
          path: 'nlp-intent→deterministic-FEA/partMesh→mesh-arrays',
          note: 'Not industrial CAD suite / GLB. apply_mesh expected client-side.',
          glb: false,
        },
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * POST /api/conkay/design-glb
   * body: { text: string, archetype?: string, maxIters?: number, promote?: boolean }
   * → { ok, archetype, assetId, sourceId, glbUrl, glbUrlAbsolute, promoted, fea?, massProps? }
   *
   * Honesty: archetype keyword → generateValidatedAsset (parametric FEA gate → pack GLB)
   * → register → resolve URL. NOT full free-text CAD / industrial suite.
   */
  router.post('/design-glb', auth, async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ ok: false, error: 'no_db', code: 'NO_DB' });
      }

      const text = req.body?.text ?? req.body?.prompt ?? '';
      let archetype = typeof req.body?.archetype === 'string' ? req.body.archetype.toLowerCase().trim() : '';
      if (archetype && !ARCHETYPES.includes(archetype)) {
        return res.status(400).json({
          ok: false,
          error: `unknown_archetype — need one of: ${ARCHETYPES.join(', ')}`,
          code: 'UNKNOWN_ARCHETYPE',
        });
      }
      if (!archetype) {
        const parsed = parseArchetypeFromText(text);
        if (!parsed.ok) {
          return res.status(400).json({ ok: false, error: parsed.error, code: parsed.code });
        }
        archetype = parsed.archetype;
      }

      const paramsIn =
        req.body?.params && typeof req.body.params === 'object' && !Array.isArray(req.body.params)
          ? req.body.params
          : seedParamsForArchetype(archetype);

      const genOpts = { archetype, params: paramsIn };
      if (typeof req.body?.material === 'string' && req.body.material) genOpts.material = req.body.material;
      const maxIters = Number(req.body?.maxIters);
      if (Number.isFinite(maxIters) && maxIters > 0) {
        genOpts.maxIters = Math.max(1, Math.min(30, Math.floor(maxIters)));
      }

      let generated;
      try {
        generated = await generateValidatedAsset(genOpts);
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: err?.message || String(err),
          code: 'GENERATION_ERROR',
          archetype,
        });
      }

      if (!generated.ok) {
        return res.status(422).json({
          ok: false,
          archetype,
          reason: generated.reason,
          optimizeReason: generated.optimizeReason,
          error: generated.error,
          code: 'FEA_OR_GEN_FAILED',
          honesty: {
            path: 'archetype→generateValidatedAsset',
            note: 'Honest failure — nothing registered when FEA does not converge.',
            glb: false,
          },
        });
      }

      const reg = registerGeneratedAsset(db, {
        archetype,
        params: generated.params,
        glbPath: generated.glbPath,
        massProps: generated.massProps,
        feaResult: generated.feaResult,
      });

      // Best-effort promote so resolve prefers the new version; resolve also
      // falls back to evo_assets.local_path when unpromoted.
      let promoted = false;
      const wantPromote = req.body?.promote !== false;
      if (wantPromote && reg.versionId) {
        try {
          promoteVersion(db, reg.versionId);
          promoted = true;
        } catch {
          promoted = false;
        }
      }

      const resolved = resolveCurrentBest(db, { source: 'evolved', sourceId: reg.sourceId });
      if (!resolved?.assetId) {
        return res.status(500).json({
          ok: false,
          error: 'registered_but_unresolvable',
          code: 'RESOLVE_FAILED',
          assetId: reg.assetId,
          sourceId: reg.sourceId,
        });
      }

      const relativeUrl = `/api/evo-asset/file/${resolved.assetId}?v=${resolved.qualityLevel ?? 0}`;
      const glbUrlAbsolute = absoluteGlbUrl(req, relativeUrl);

      return res.json({
        ok: true,
        intent: { archetype, text: String(text || ''), mode: 'glb' },
        archetype,
        assetId: resolved.assetId,
        versionId: reg.versionId,
        sourceId: reg.sourceId,
        created: reg.created,
        promoted,
        glbUrl: relativeUrl,
        glbUrlAbsolute,
        massProps: generated.massProps,
        fea: generated.feaResult
          ? {
              ok: !!generated.feaResult.ok,
              maxUtilization: generated.feaResult.maxUtilization ?? null,
            }
          : null,
        honesty: {
          path: 'archetype-keyword→generateValidatedAsset→register→resolve→load_glb',
          note: 'Archetypes only (sword/spear/staff/mace/shield). Not full free-text CAD / industrial suite.',
          glb: true,
        },
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}
