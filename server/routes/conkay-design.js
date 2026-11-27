// server/routes/conkay-design.js
// POST /api/conkay/design — free-text NLP → intent → runFEA + partMesh → mesh arrays.
// POST /api/conkay/design-glb — free-text → archetype keyword → evo-asset generate → resolve URL.
// Auth required. Deterministic; no LLM; no fake FEA / no fabricated GLB.

import { Router } from 'express';
import {
  solveDesignText,
  feaUtilToColor,
} from '../lib/conkay/nlp-design-intent.js';
import {
  generateValidatedAsset,
  registerGeneratedAsset,
} from '../lib/asset-gen/generate-asset.js';
import { resolveCurrentBest, promoteVersion } from '../lib/evo-asset/registry.js';
import { buildFromBrief, saveBuild, loadBuild, listBuilds, editBuild, openBuild } from '../lib/conkay/build/index.js';

const ARCHETYPES = Object.freeze(['sword', 'spear', 'staff', 'mace', 'shield']);
// Accept compound FE prompts like "longsword" / "warhammer→mace" without forcing
// users to type the bare archetype token (common ConKay cockpit asks).
const ARCHETYPE_RE = /\b(longsword|shortsword|greatsword|sword|spear|quarterstaff|staff|warhammer|mace|roundshield|shield)\b/i;
const ARCHETYPE_ALIAS = Object.freeze({
  longsword: 'sword', shortsword: 'sword', greatsword: 'sword',
  quarterstaff: 'staff', warhammer: 'mace', roundshield: 'shield',
});

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
  const token = m[1].toLowerCase();
  const archetype = ARCHETYPE_ALIAS[token] || token;
  return { ok: true, archetype, text: raw };
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
      const solved = solveDesignText(String(text));
      if (!solved.ok) {
        return res.status(400).json({
          ok: false,
          error: solved.error,
          code: solved.code,
          ...(solved.supportedParts ? { supportedParts: solved.supportedParts } : {}),
        });
      }
      const { intent, mesh, hand, fea: feaReport, safety } = solved;
      const maxUtilization = Number(feaReport?.maxUtilization);
      // Colour against the required safety factor when one was stated, so a
      // part that passes yield but misses SF 2 does not paint green.
      const bandUtil = Number(feaReport?.utilizationAtSF ?? maxUtilization);
      const utilColor = feaUtilToColor(Number.isFinite(bandUtil) ? bandUtil : 0);
      const fea = feaReport?.ok
        ? {
          ok: true,
          maxUtilization: Number.isFinite(maxUtilization) ? maxUtilization : null,
          maxStressPa: feaReport.maxStressPa,
          maxDeflectionM: feaReport.maxDeflectionM,
          utilizationAtSF: feaReport.utilizationAtSF ?? null,
          allPass: feaReport.allPass ?? null,
          jobId: feaReport.jobId ?? null,
          band: utilColor.band,
          summary: feaReport.summary ?? null,
          hand,
        }
        : { ok: false, error: feaReport?.error || 'runFEA failed', hand };

      return res.json({
        ok: true,
        intent,
        assumed: intent.assumed,
        assumptions: intent.assumptions,
        hand,
        fea,
        // Pass/fail against the stated safety factor (SF 1 = yield when none was stated).
        safety,
        pass: safety?.pass ?? null,
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
          note: 'Not industrial CAD suite / GLB. apply_mesh expected client-side. Defaults are listed on assumed.',
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

  /**
   * POST /api/conkay/build — build anything: { brief, answers?: [{ ask, answer }], id? }
   * Kay plans the design graph (model), every applicable solver checks it,
   * → { ok, id, summary, report, artifact } or { ok:false, error, message }.
   */
  router.post('/build', auth, async (req, res) => {
    const userId = req.user?.id || req.user?.userId || null;
    if (!userId) return res.status(401).json({ ok: false, error: 'auth_required' });
    const brief = String(req.body?.brief ?? req.body?.text ?? '').slice(0, 4000);
    if (!brief.trim()) return res.status(400).json({ ok: false, error: 'brief_required', message: 'Tell Kay what to build.' });
    const answers = (Array.isArray(req.body?.answers) ? req.body.answers : [])
      .filter((a) => a && String(a.answer ?? '').trim()).slice(0, 12)
      .map((a) => ({ ask: String(a.ask ?? '').slice(0, 400), answer: String(a.answer).slice(0, 1000) }));
    const prior = req.body?.id ? loadBuild(db, req.body.id, userId) : null;
    if (req.body?.id && !prior) return res.status(404).json({ ok: false, error: 'not_found' });
    try {
      const result = await buildFromBrief({ brief: prior?.brief || brief, answers, previous: prior?.plan?.ir || null, db, userId });
      const id = saveBuild(db, { id: prior?.id || null, userId, brief: prior?.brief || brief, answers, result });
      if (!result.ok) return res.status(result.error === 'no_model' ? 503 : 422).json({ ok: false, id, error: result.error, message: result.message, errors: result.errors });
      res.json({ ok: true, id, summary: result.summary, report: result.report, ir: result.ir, artifact: result.artifact });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'build_failed', message: String(e?.message || e) });
    }
  });

  /**
   * POST /api/conkay/build/:id/edit — { edits: [{ id, value }] } (ids from report.parameters;
   * values in any unit). Every solver re-runs; no model. → { ok, report, artifact, applied }.
   */
  router.post('/build/:id/edit', auth, async (req, res) => {
    const userId = req.user?.id || req.user?.userId || null;
    if (!userId) return res.status(401).json({ ok: false, error: 'auth_required' });
    const edits = Array.isArray(req.body?.edits) ? req.body.edits.slice(0, 50) : [];
    if (!edits.length) return res.status(400).json({ ok: false, error: 'edits_required' });
    try {
      const r = await editBuild(db, { id: req.params.id, userId, edits });
      if (!r.ok) return res.status(r.error === 'not_found' ? 404 : 422).json(r);
      res.json({ ok: true, id: r.id, report: r.report, artifact: r.artifact, applied: r.applied, ir: r.ir });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'edit_failed', message: String(e?.message || e) });
    }
  });

  router.get('/build/:id', auth, (req, res) => {
    const userId = req.user?.id || req.user?.userId || null;
    const o = userId ? openBuild(db, req.params.id, userId) : null;
    if (!o) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, build: o.build, artifact: o.artifact });
  });

  router.get('/builds', auth, (req, res) => {
    const userId = req.user?.id || req.user?.userId || null;
    res.json({ ok: true, builds: userId ? listBuilds(db, userId, Number(req.query.limit) || 20) : [] });
  });

  return router;
}
