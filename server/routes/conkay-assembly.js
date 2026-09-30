// server/routes/conkay-assembly.js
// ConKay CAD Wave 1 — assembly CRUD + part mesh/GLB attach.
// Mounted at /api/conkay (alongside design router). Auth required.

import { Router } from 'express';
import {
  ensureAssemblyTables,
  createAssembly,
  getAssembly,
  listAssemblies,
  addPart,
  listParts,
  getPart,
  transformPart,
  removePart,
  deleteAssembly,
  defaultTransform,
  pushAssemblyRevision,
  undoAssembly,
  redoAssembly,
  getAssemblyHistory,
} from '../lib/conkay/assembly-store.js';
import {
  parseDesignIntent,
  intentToPartMeshParams,
  buildPartMesh,
  feaUtilToColor,
} from '../lib/conkay/nlp-design-intent.js';
import { parseAssemblyUtterance } from '../lib/conkay/assembly-nlp.js';
import {
  exportPartStl,
  exportAssemblyStl,
  exportPartStep,
  exportAssemblyStep,
  importStepMesh,
  buildBom,
} from '../lib/conkay/assembly-export.js';
import {
  buildErpBom,
  erpBomToCsv,
} from '../lib/conkay/erp-bom.js';
import {
  probeOcc,
  exportAssemblyBrepStep,
  exportPartBrepStep,
  importBrepStepToAssembly,
  featureRebuild,
  featureCreate,
  featureAppend,
  featureList,
  featureUndo,
  sketchExtrude,
  measureGeometry,
  mateSolids,
  mateSolveDof,
  sketchSolve,
  gdtDigital,
  rebuildPartFromFeatures,
} from '../lib/conkay/occ-bridge.js';
import {
  exportAssemblyDrawing,
  exportPartDrawing,
  exportAssemblyDrawingPdf,
} from '../lib/conkay/assembly-drawing.js';
import { explodeAssembly } from '../lib/conkay/assembly-explode.js';
import {
  listGdt,
  addGdt,
  verifyGeometryCallout,
  updateGdt,
  removeGdt,
  listDimensions,
  addDimension,
  removeDimension,
} from '../lib/conkay/assembly-gdt.js';
import { applyMate, MATE_TYPES } from '../lib/conkay/assembly-mates.js';
import {
  listMaterials,
  attachMaterialToPart,
  resolveMaterial,
} from '../lib/conkay/material-library.js';

export default function createConkayAssemblyRouter({ requireAuth, db }) {
  const router = Router();
  const auth = requireAuth;

  function needDb(res) {
    if (!db) {
      res.status(503).json({ ok: false, error: 'no_db', code: 'NO_DB' });
      return false;
    }
    try {
      ensureAssemblyTables(db);
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
    return true;
  }

  /** POST /api/conkay/assemblies  { name?, meta? } */
  router.post('/assemblies', auth, (req, res) => {
    if (!needDb(res)) return;
    try {
      const ownerId = req.user?.id || req.user?.userId || null;
      const asm = createAssembly(db, {
        name: req.body?.name,
        ownerId,
        meta: req.body?.meta,
      });
      return res.json({
        ok: true,
        assembly: asm,
        honesty: { wave: 1, note: 'Assembly store LIVE — not full CAD suite' },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** GET /api/conkay/assemblies */
  router.get('/assemblies', auth, (req, res) => {
    if (!needDb(res)) return;
    const ownerId = req.query?.mine === '1' ? (req.user?.id || req.user?.userId || null) : null;
    const list = listAssemblies(db, { ownerId, limit: req.query?.limit });
    return res.json({ ok: true, assemblies: list });
  });

  /** GET /api/conkay/assemblies/:id */
  router.get('/assemblies/:id', auth, (req, res) => {
    if (!needDb(res)) return;
    const asm = getAssembly(db, req.params.id);
    if (!asm) return res.status(404).json({ ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' });
    const parts = listParts(db, asm.id);
    return res.json({ ok: true, assembly: asm, parts });
  });

  /** DELETE /api/conkay/assemblies/:id */
  router.delete('/assemblies/:id', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = deleteAssembly(db, req.params.id);
    if (!out.ok) return res.status(404).json(out);
    return res.json(out);
  });

  /**
   * POST /api/conkay/assemblies/:id/parts
   * body: {
   *   name?, kind?, source?, transform?, parentId?, mate?, material?,
   *   text? (NLP design → mesh), glbUrl?, mesh?: {positions,indices,kind?}
   * }
   */
  router.post('/assemblies/:id/parts', auth, async (req, res) => {
    if (!needDb(res)) return;
    try {
      const assemblyId = req.params.id;
      if (!getAssembly(db, assemblyId)) {
        return res.status(404).json({ ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' });
      }

      let mesh = req.body?.mesh || null;
      let glbUrl = req.body?.glbUrl || req.body?.glb_url || null;
      let kind = req.body?.kind || null;
      let material = req.body?.material || null;
      let source = req.body?.source || null;
      let utilColor = null;
      let intent = null;

      const text = req.body?.text || req.body?.prompt || '';
      if (!mesh && !glbUrl && text) {
        const parsed = parseDesignIntent(String(text));
        if (!parsed.ok) {
          return res.status(400).json({ ok: false, error: parsed.error, code: parsed.code || 'NLP_FAIL' });
        }
        intent = parsed.intent;
        const pm = intentToPartMeshParams(intent);
        const built = buildPartMesh(pm.kind, pm.params);
        mesh = {
          positions: built.positions,
          indices: built.indices,
          kind: built.kind,
          vertexCount: built.vertexCount,
          triangleCount: built.triangleCount,
        };
        kind = kind || built.kind;
        material = material || intent.material || null;
        source = source || 'nlp-design';
        utilColor = feaUtilToColor(0.125);
      }

      if (glbUrl) {
        source = source || 'evo-glb';
        kind = kind || 'glb';
      }
      if (mesh) {
        source = source || 'mesh';
        kind = kind || mesh.kind || 'mesh';
      }
      if (!mesh && !glbUrl) {
        return res.status(400).json({
          ok: false,
          error: 'need_text_or_mesh_or_glbUrl',
          code: 'MISSING_GEOMETRY',
        });
      }

      const transform = defaultTransform(req.body?.transform);
      // Auto-offset new parts along X if caller did not set position
      if (!req.body?.transform?.position) {
        const existing = listParts(db, assemblyId);
        transform.position.x = existing.length * 1.5;
        transform.position.y = 1.2;
      }

      const out = addPart(db, assemblyId, {
        name: req.body?.name || kind || intent?.part || 'part',
        kind,
        source,
        transform,
        parentId: req.body?.parentId,
        mate: req.body?.mate || { type: 'fixed' },
        mesh,
        glbUrl,
        material,
        meta: {
          ...(req.body?.meta || {}),
          intent: intent || undefined,
          utilColor: utilColor || undefined,
          text: text || undefined,
        },
      });
      if (!out.ok) return res.status(400).json(out);
      return res.json({
        ok: true,
        part: out.part,
        honesty: {
          wave: 1,
          path: glbUrl ? 'glbUrl→assembly part' : 'nlp/mesh→assembly part',
          note: 'Assembly part stored — client apply_mesh/load_glb for Unity',
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** GET /api/conkay/assemblies/:id/parts */
  router.get('/assemblies/:id/parts', auth, (req, res) => {
    if (!needDb(res)) return;
    if (!getAssembly(db, req.params.id)) {
      return res.status(404).json({ ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' });
    }
    return res.json({ ok: true, parts: listParts(db, req.params.id) });
  });

  /** PATCH /api/conkay/assemblies/:id/parts/:partId  { transform } */
  router.patch('/assemblies/:id/parts/:partId', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = transformPart(db, req.params.id, req.params.partId, req.body?.transform || req.body);
    if (!out.ok) return res.status(404).json(out);
    return res.json({
      ok: true,
      part: out.part,
      honesty: { wave: 1, note: 'Server transform updated — Unity set_transform or clear+redraw' },
    });
  });

  /** DELETE /api/conkay/assemblies/:id/parts/:partId */
  router.delete('/assemblies/:id/parts/:partId', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = removePart(db, req.params.id, req.params.partId);
    if (!out.ok) return res.status(404).json(out);
    return res.json(out);
  });

  /**
   * POST /api/conkay/assemblies/:id/revise
   * body: { text } — chat revise: "add beam…", "move part X …"
   */
  router.post('/assemblies/:id/revise', auth, async (req, res) => {
    if (!needDb(res)) return;
    try {
      const assemblyId = req.params.id;
      if (!getAssembly(db, assemblyId)) {
        return res.status(404).json({ ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' });
      }
      const text = String(req.body?.text || req.body?.prompt || '').trim();
      const parsed = parseAssemblyUtterance(text, { parts: listParts(db, assemblyId) });
      if (!parsed.ok) {
        return res.status(400).json({ ok: false, error: parsed.error, code: parsed.code });
      }

      if (parsed.action === 'add') {
        // Reuse add-part logic via internal call shape
        req.body = {
          text: parsed.addText || text,
          name: parsed.name,
          transform: parsed.transform,
        };
        // Inline add (avoid recursive router)
        const nlp = parseDesignIntent(String(req.body.text));
        if (!nlp.ok) return res.status(400).json({ ok: false, error: nlp.error, code: nlp.code });
        const pm = intentToPartMeshParams(nlp.intent);
        const built = buildPartMesh(pm.kind, pm.params);
        const transform = defaultTransform(req.body.transform);
        if (!req.body.transform?.position) {
          const existing = listParts(db, assemblyId);
          transform.position.x = existing.length * 1.5;
          transform.position.y = 1.2;
        }
        const out = addPart(db, assemblyId, {
          name: req.body.name || pm.kind || 'part',
          kind: pm.kind,
          source: 'nlp-design',
          transform,
          mate: { type: 'fixed' },
          mesh: {
            positions: built.positions,
            indices: built.indices,
            kind: built.kind,
            vertexCount: built.vertexCount,
            triangleCount: built.triangleCount,
          },
          material: nlp.intent.material || null,
          meta: { intent: nlp.intent, text },
        });
        return res.json({
          ok: true,
          action: 'add',
          part: out.part,
          parts: listParts(db, assemblyId),
          utterance: parsed,
        });
      }

      if (parsed.action === 'move' || parsed.action === 'transform') {
        const out = transformPart(db, assemblyId, parsed.partId, parsed.transform);
        if (!out.ok) return res.status(404).json(out);
        return res.json({
          ok: true,
          action: 'transform',
          part: out.part,
          parts: listParts(db, assemblyId),
          utterance: parsed,
        });
      }

      if (parsed.action === 'remove') {
        const out = removePart(db, assemblyId, parsed.partId);
        if (!out.ok) return res.status(404).json(out);
        return res.json({
          ok: true,
          action: 'remove',
          removed: out.removed,
          parts: listParts(db, assemblyId),
          utterance: parsed,
        });
      }

      if (parsed.action === 'list') {
        return res.json({
          ok: true,
          action: 'list',
          parts: listParts(db, assemblyId),
          utterance: parsed,
        });
      }

      if (parsed.action === 'undo') {
        const out = undoAssembly(db, assemblyId);
        if (!out.ok) {
          const code = out.code === 'EMPTY_UNDO' ? 409 : 400;
          return res.status(code).json({ ...out, utterance: parsed });
        }
        return res.json({ ...out, utterance: parsed });
      }

      if (parsed.action === 'redo') {
        const out = redoAssembly(db, assemblyId);
        if (!out.ok) {
          const code = out.code === 'EMPTY_REDO' ? 409 : 400;
          return res.status(code).json({ ...out, utterance: parsed });
        }
        return res.json({ ...out, utterance: parsed });
      }

      return res.status(400).json({ ok: false, error: 'unsupported_action', action: parsed.action });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });


  /** GET /api/conkay/assemblies/:id/bom */
  router.get('/assemblies/:id/bom', auth, (req, res) => {
    if (!needDb(res)) return;
    const bom = buildBom(db, req.params.id);
    if (!bom.ok) return res.status(404).json(bom);
    return res.json(bom);
  });

  /** GET /api/conkay/assemblies/:id/bom/erp — ERP-shaped BOM JSON (not SAP/Oracle) */
  router.get('/assemblies/:id/bom/erp', auth, (req, res) => {
    if (!needDb(res)) return;
    const overheadPct = req.query?.overheadPct != null ? Number(req.query.overheadPct) : undefined;
    const bom = buildErpBom(db, req.params.id, { overheadPct });
    if (!bom.ok) return res.status(404).json(bom);
    return res.json(bom);
  });

  /** GET /api/conkay/assemblies/:id/bom/erp.csv — ERP-shaped BOM CSV download */
  router.get('/assemblies/:id/bom/erp.csv', auth, (req, res) => {
    if (!needDb(res)) return;
    const overheadPct = req.query?.overheadPct != null ? Number(req.query.overheadPct) : undefined;
    const bom = buildErpBom(db, req.params.id, { overheadPct });
    if (!bom.ok) return res.status(404).json(bom);
    const csv = erpBomToCsv(bom);
    if (!csv.ok) return res.status(422).json(csv);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
    res.setHeader('X-ConKay-Bom-Schema', 'conkay.erp-bom.v1');
    res.setHeader('X-ConKay-Bom-Lines', String(bom.lines?.length || 0));
    return res.send(csv.csv);
  });


  /** GET /api/conkay/assemblies/:id/parts/:partId/stl — binary STL download */
  router.get('/assemblies/:id/parts/:partId/stl', auth, (req, res) => {
    if (!needDb(res)) return;
    const part = getPart(db, req.params.id, req.params.partId);
    if (!part) return res.status(404).json({ ok: false, error: 'part_not_found', code: 'NOT_FOUND' });
    const stl = exportPartStl(part);
    if (!stl.ok) return res.status(422).json(stl);
    const filename = `conkay-part-${part.name || part.id}.stl`.replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'model/stl');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-ConKay-Triangle-Count', String(stl.triangleCount));
    res.setHeader('X-ConKay-Vertex-Count', String(stl.vertexCount));
    return res.send(stl.buffer);
  });

  /** GET /api/conkay/assemblies/:id/stl — merged assembly STL */
  router.get('/assemblies/:id/stl', auth, (req, res) => {
    if (!needDb(res)) return;
    const stl = exportAssemblyStl(db, req.params.id);
    if (!stl.ok) return res.status(422).json(stl);
    const filename = `conkay-assembly-${req.params.id.slice(0, 8)}.stl`;
    res.setHeader('Content-Type', 'model/stl');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-ConKay-Triangle-Count', String(stl.triangleCount));
    res.setHeader('X-ConKay-Included-Parts', String(stl.included?.length || 0));
    res.setHeader('X-ConKay-Skipped-Parts', String(stl.skipped?.length || 0));
    return res.send(stl.buffer);
  });


  /** GET /api/conkay/assemblies/:id/parts/:partId/export.step — faceted ASCII STEP (?kernel=occ → B-rep) */
  router.get('/assemblies/:id/parts/:partId/export.step', auth, async (req, res) => {
    if (!needDb(res)) return;
    const part = getPart(db, req.params.id, req.params.partId);
    if (!part) return res.status(404).json({ ok: false, error: 'part_not_found', code: 'NOT_FOUND' });
    const kernel = String(req.query?.kernel || '').toLowerCase();
    if (kernel === 'occ' || kernel === 'brep' || kernel === 'ocp') {
      const step = await exportPartBrepStep(part);
      if (!step.ok) return res.status(422).json(step);
      const filename = `conkay-part-${part.name || part.id}-brep.step`.replace(/[^\w.-]+/g, '_');
      res.setHeader('Content-Type', 'application/step');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-ConKay-STEP-Format', 'occ-advanced-brep');
      res.setHeader('X-ConKay-Advanced-BRep', String(!!step.advanced_brep));
      if (step.path) res.setHeader('X-ConKay-BRep-Path', step.path);
      return res.send(step.buffer);
    }
    const step = exportPartStep(part);
    if (!step.ok) return res.status(422).json(step);
    const filename = `conkay-part-${part.name || part.id}.step`.replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'application/step');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-ConKay-Triangle-Count', String(step.triangleCount));
    res.setHeader('X-ConKay-Vertex-Count', String(step.vertexCount));
    res.setHeader('X-ConKay-STEP-Format', 'faceted-AP214-MANIFOLD_SOLID_BREP');
    return res.send(step.buffer);
  });

  /** GET /api/conkay/assemblies/:id/export.step — faceted STEP (?kernel=occ → B-rep) */
  router.get('/assemblies/:id/export.step', auth, async (req, res) => {
    if (!needDb(res)) return;
    const kernel = String(req.query?.kernel || '').toLowerCase();
    if (kernel === 'occ' || kernel === 'brep' || kernel === 'ocp') {
      const step = await exportAssemblyBrepStep(db, req.params.id);
      if (!step.ok) return res.status(422).json(step);
      const filename = `conkay-assembly-${req.params.id.slice(0, 8)}-brep.step`;
      res.setHeader('Content-Type', 'application/step');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-ConKay-STEP-Format', 'occ-advanced-brep');
      res.setHeader('X-ConKay-Advanced-BRep', String(!!step.advanced_brep));
      res.setHeader('X-ConKay-Solids', String(step.solids || 0));
      if (step.path) res.setHeader('X-ConKay-BRep-Path', step.path);
      return res.send(step.buffer);
    }
    const step = exportAssemblyStep(db, req.params.id);
    if (!step.ok) return res.status(422).json(step);
    const filename = `conkay-assembly-${req.params.id.slice(0, 8)}.step`;
    res.setHeader('Content-Type', 'application/step');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-ConKay-Triangle-Count', String(step.triangleCount));
    res.setHeader('X-ConKay-Included-Parts', String(step.included?.length || 0));
    res.setHeader('X-ConKay-Skipped-Parts', String(step.skipped?.length || 0));
    res.setHeader('X-ConKay-STEP-Format', 'faceted-AP214-MANIFOLD_SOLID_BREP');
    return res.send(step.buffer);
  });

  /**
   * POST /api/conkay/assemblies/:id/import.step
   * body: raw STEP text (Content-Type: application/step|text/plain) OR JSON { step|text, name?, material? }
   * Creates a part with mesh from faceted POLY_LOOP STEP.
   */
  router.post('/assemblies/:id/import.step', auth, async (req, res) => {
    if (!needDb(res)) return;
    try {
      const assemblyId = req.params.id;
      if (!getAssembly(db, assemblyId)) {
        return res.status(404).json({ ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' });
      }
      const kernel = String(req.query?.kernel || req.body?.kernel || '').toLowerCase();
      if (kernel === 'occ' || kernel === 'brep' || kernel === 'ocp') {
        let stepTextOcc = '';
        let nameOcc = req.query?.name || null;
        let materialOcc = req.query?.material || null;
        const ctOcc = String(req.headers['content-type'] || '');
        if (ctOcc.includes('application/json')) {
          stepTextOcc = req.body?.step || req.body?.text || req.body?.data || '';
          nameOcc = req.body?.name || nameOcc;
          materialOcc = req.body?.material || materialOcc;
        } else if (Buffer.isBuffer(req.body)) {
          stepTextOcc = req.body.toString('utf8');
        } else if (typeof req.body === 'string') {
          stepTextOcc = req.body;
        } else if (req.body?.step || req.body?.text) {
          stepTextOcc = req.body.step || req.body.text;
          nameOcc = req.body?.name || nameOcc;
          materialOcc = req.body?.material || materialOcc;
        }
        const outOcc = await importBrepStepToAssembly(db, assemblyId, stepTextOcc, {
          name: nameOcc,
          material: materialOcc,
          transform: req.body?.transform,
        });
        if (!outOcc.ok) {
          const code = outOcc.code === 'MISSING_STEP' || outOcc.reason === 'need_step_body' ? 400 : 422;
          return res.status(code).json(outOcc);
        }
        return res.json(outOcc);
      }
      let stepText = '';
      let name = req.query?.name || null;
      let material = req.query?.material || null;
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('application/json')) {
        stepText = req.body?.step || req.body?.text || req.body?.data || '';
        name = req.body?.name || name;
        material = req.body?.material || material;
      } else if (Buffer.isBuffer(req.body)) {
        stepText = req.body.toString('utf8');
      } else if (typeof req.body === 'string') {
        stepText = req.body;
      } else if (req.body?.step || req.body?.text) {
        stepText = req.body.step || req.body.text;
        name = req.body?.name || name;
        material = req.body?.material || material;
      } else {
        stepText = '';
      }
      if (!stepText || !String(stepText).includes('ISO-10303-21')) {
        return res.status(400).json({
          ok: false,
          error: 'need_step_body',
          code: 'MISSING_STEP',
          detail: 'POST ASCII STEP (ISO-10303-21) as raw body or JSON { step }',
        });
      }
      const parsed = importStepMesh(stepText);
      if (!parsed.ok) return res.status(422).json(parsed);

      const transform = defaultTransform(req.body?.transform);
      if (!req.body?.transform?.position) {
        const existing = listParts(db, assemblyId);
        transform.position.x = existing.length * 1.5;
        transform.position.y = 1.2;
      }
      const out = addPart(db, assemblyId, {
        name: name || 'step-import',
        kind: 'step-faceted',
        source: 'step-import',
        transform,
        mate: { type: 'fixed' },
        mesh: {
          positions: parsed.positions,
          indices: parsed.indices,
          kind: 'step-faceted',
          vertexCount: parsed.vertexCount,
          triangleCount: parsed.triangleCount,
        },
        material: material || null,
        meta: { importedFrom: 'faceted-step', honesty: parsed.honesty },
      });
      if (!out.ok) return res.status(400).json(out);
      return res.json({
        ok: true,
        part: out.part,
        mesh: {
          vertexCount: parsed.vertexCount,
          triangleCount: parsed.triangleCount,
        },
        honesty: {
          wave: 'STEP',
          note: 'Faceted STEP import → triangle mesh part. NOT full B-rep CAD kernel.',
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** GET /api/conkay/occ/status — OCP/cadquery-ocp probe */
  router.get('/occ/status', auth, async (_req, res) => {
    const st = await probeOcc();
    return res.status(st.ok ? 200 : 503).json(st);
  });

  /**
   * POST|GET /api/conkay/assemblies/:id/export.brep.step — OCC advanced B-rep STEP
   * Alias of export.step?kernel=occ
   */
  async function handleExportBrep(req, res) {
    if (!needDb(res)) return;
    const step = await exportAssemblyBrepStep(db, req.params.id);
    if (!step.ok) return res.status(422).json(step);
    const filename = `conkay-assembly-${req.params.id.slice(0, 8)}-brep.step`;
    res.setHeader('Content-Type', 'application/step');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-ConKay-STEP-Format', 'occ-advanced-brep');
    res.setHeader('X-ConKay-Advanced-BRep', String(!!step.advanced_brep));
    res.setHeader('X-ConKay-Solids', String(step.solids || 0));
    if (step.path) res.setHeader('X-ConKay-BRep-Path', step.path);
    return res.send(step.buffer);
  }
  router.get('/assemblies/:id/export.brep.step', auth, handleExportBrep);
  router.post('/assemblies/:id/export.brep.step', auth, handleExportBrep);

  /**
   * POST /api/conkay/assemblies/:id/import.brep.step
   * OCC B-rep STEP → tessellated mesh part + keep B-rep under data/conkay-brep/
   */
  router.post('/assemblies/:id/import.brep.step', auth, async (req, res) => {
    if (!needDb(res)) return;
    try {
      const assemblyId = req.params.id;
      if (!getAssembly(db, assemblyId)) {
        return res.status(404).json({ ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' });
      }
      let stepText = '';
      let name = req.query?.name || null;
      let material = req.query?.material || null;
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('application/json')) {
        stepText = req.body?.step || req.body?.text || req.body?.data || '';
        name = req.body?.name || name;
        material = req.body?.material || material;
      } else if (Buffer.isBuffer(req.body)) {
        stepText = req.body.toString('utf8');
      } else if (typeof req.body === 'string') {
        stepText = req.body;
      } else if (req.body?.step || req.body?.text) {
        stepText = req.body.step || req.body.text;
        name = req.body?.name || name;
        material = req.body?.material || material;
      }
      const out = await importBrepStepToAssembly(db, assemblyId, stepText, {
        name,
        material,
        transform: req.body?.transform,
      });
      if (!out.ok) {
        const code = out.code === 'MISSING_STEP' || out.reason === 'need_step_body' ? 400 : 422;
        return res.status(code).json(out);
      }
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** GET /api/conkay/materials */
  router.get('/materials', auth, (_req, res) => {
    return res.json({
      ok: true,
      materials: listMaterials(),
      honesty: { wave: 3, note: 'Material library catalog — attach via POST …/parts/:id/material' },
    });
  });

  /** POST /api/conkay/assemblies/:id/parts/:partId/material  { material } */
  router.post('/assemblies/:id/parts/:partId/material', auth, (req, res) => {
    if (!needDb(res)) return;
    const material = req.body?.material || req.body?.materialId || req.body?.id;
    const out = attachMaterialToPart(db, req.params.id, req.params.partId, material);
    if (!out.ok) {
      const code = out.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(code).json(out);
    }
    return res.json(out);
  });

  /** POST /api/conkay/assemblies/:id/mates  { type, aPartId, bPartId?, axis?, offset?, drive? } */
  router.post('/assemblies/:id/mates', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = applyMate(db, req.params.id, {
      type: req.body?.type,
      aPartId: req.body?.aPartId || req.body?.a,
      bPartId: req.body?.bPartId || req.body?.b || null,
      axis: req.body?.axis,
      offset: req.body?.offset,
      drive: req.body?.drive,
    });
    if (!out.ok) {
      const code = out.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(code).json(out);
    }
    return res.json(out);
  });

  /** GET /api/conkay/mate-types */
  router.get('/mate-types', auth, (_req, res) => {
    return res.json({
      ok: true,
      types: MATE_TYPES,
      honesty: {
        wave: '3-v2',
        note: 'Kinematic solve for B given A (distance/offset/align_axis) — NOT industrial solver / OCC',
      },
    });
  });

  /** POST /api/conkay/assemblies/:id/undo */
  router.post('/assemblies/:id/undo', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = undoAssembly(db, req.params.id);
    if (!out.ok) {
      const code = out.code === 'NOT_FOUND' ? 404 : out.code === 'EMPTY_UNDO' ? 409 : 400;
      return res.status(code).json(out);
    }
    return res.json({
      ...out,
      honesty: { note: 'Undo restored prior parts+transforms snapshot — not parametric CAD history' },
    });
  });

  /** POST /api/conkay/assemblies/:id/redo */
  router.post('/assemblies/:id/redo', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = redoAssembly(db, req.params.id);
    if (!out.ok) {
      const code = out.code === 'NOT_FOUND' ? 404 : out.code === 'EMPTY_REDO' ? 409 : 400;
      return res.status(code).json(out);
    }
    return res.json({
      ...out,
      honesty: { note: 'Redo restored forward parts+transforms snapshot — not parametric CAD history' },
    });
  });


  /** GET /api/conkay/assemblies/:id/drawing.json — orthographic views + segments + svg */
  router.get('/assemblies/:id/drawing.json', auth, (req, res) => {
    if (!needDb(res)) return;
    const drawing = exportAssemblyDrawing(db, req.params.id);
    if (!drawing.ok) return res.status(422).json(drawing);
    return res.json(drawing);
  });

  /** GET /api/conkay/assemblies/:id/drawing.svg — SVG download */
  router.get('/assemblies/:id/drawing.svg', auth, (req, res) => {
    if (!needDb(res)) return;
    const drawing = exportAssemblyDrawing(db, req.params.id);
    if (!drawing.ok) return res.status(422).json(drawing);
    const filename = `conkay-assembly-${req.params.id.slice(0, 8)}-drawing.svg`;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-ConKay-Drawing-Views', String(drawing.views?.length || 0));
    return res.send(drawing.svg);
  });

  /** GET /api/conkay/assemblies/:id/parts/:partId/drawing.json */
  router.get('/assemblies/:id/parts/:partId/drawing.json', auth, (req, res) => {
    if (!needDb(res)) return;
    const part = getPart(db, req.params.id, req.params.partId);
    if (!part) return res.status(404).json({ ok: false, reason: 'part_not_found' });
    const drawing = exportPartDrawing(part);
    if (!drawing.ok) return res.status(422).json(drawing);
    return res.json(drawing);
  });

  /** GET /api/conkay/assemblies/:id/parts/:partId/drawing.svg */
  router.get('/assemblies/:id/parts/:partId/drawing.svg', auth, (req, res) => {
    if (!needDb(res)) return;
    const part = getPart(db, req.params.id, req.params.partId);
    if (!part) return res.status(404).json({ ok: false, reason: 'part_not_found' });
    const drawing = exportPartDrawing(part);
    if (!drawing.ok) return res.status(422).json(drawing);
    const filename = `conkay-part-${(part.name || part.id).slice(0, 24)}-drawing.svg`.replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(drawing.svg);
  });


  /** GET /api/conkay/assemblies/:id/drawing.pdf — multi-page PDF pack */
  router.get('/assemblies/:id/drawing.pdf', auth, async (req, res) => {
    if (!needDb(res)) return;
    try {
      const pdf = await exportAssemblyDrawingPdf(db, req.params.id);
      if (!pdf.ok) return res.status(422).json(pdf);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
      res.setHeader('X-ConKay-Drawing-Pages', String(pdf.pages || 4));
      return res.send(pdf.buffer);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/assemblies/:id/dimensions — optional user dim */
  router.post('/assemblies/:id/dimensions', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = addDimension(db, req.params.id, req.body || {});
    if (!out.ok) {
      const code = out.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(code).json(out);
    }
    return res.json(out);
  });

  /** GET /api/conkay/assemblies/:id/dimensions */
  router.get('/assemblies/:id/dimensions', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = listDimensions(db, req.params.id);
    if (!out.ok) return res.status(404).json(out);
    return res.json(out);
  });

  /** DELETE /api/conkay/assemblies/:id/dimensions/:dimId */
  router.delete('/assemblies/:id/dimensions/:dimId', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = removeDimension(db, req.params.id, req.params.dimId);
    if (!out.ok) return res.status(404).json(out);
    return res.json(out);
  });

  /** POST /api/conkay/assemblies/:id/explode { factor } */
  router.post('/assemblies/:id/explode', auth, (req, res) => {
    if (!needDb(res)) return;
    const factor = req.body?.factor ?? 1;
    const out = explodeAssembly(db, req.params.id, factor);
    if (!out.ok) {
      const code = out.code === 'NOT_FOUND' ? 404 : out.code === 'EMPTY' ? 409 : 400;
      return res.status(code).json(out);
    }
    return res.json(out);
  });

  /** GET /api/conkay/assemblies/:id/gdt */
  router.get('/assemblies/:id/gdt', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = listGdt(db, req.params.id);
    if (!out.ok) return res.status(404).json(out);
    return res.json(out);
  });

  /** POST /api/conkay/assemblies/:id/gdt */
  router.post('/assemblies/:id/gdt', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = addGdt(db, req.params.id, req.body || {});
    if (!out.ok) {
      const code = out.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(code).json(out);
    }
    return res.json(out);
  });

  /** PATCH /api/conkay/assemblies/:id/gdt/:annId */
  router.patch('/assemblies/:id/gdt/:annId', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = updateGdt(db, req.params.id, req.params.annId, req.body || {});
    if (!out.ok) return res.status(404).json(out);
    return res.json(out);
  });

  /** DELETE /api/conkay/assemblies/:id/gdt/:annId */
  router.delete('/assemblies/:id/gdt/:annId', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = removeGdt(db, req.params.id, req.params.annId);
    if (!out.ok) return res.status(404).json(out);
    return res.json(out);
  });

  /** GET /api/conkay/assemblies/:id/history */
  router.get('/assemblies/:id/history', auth, (req, res) => {
    if (!needDb(res)) return;
    const out = getAssemblyHistory(db, req.params.id);
    if (!out.ok) {
      const code = out.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(code).json(out);
    }
    return res.json(out);
  });


  // ── Solid world (OCC feature tree / sketch / mates / measure) ──────────

  /** POST /api/conkay/occ/feature-rebuild */
  router.post('/occ/feature-rebuild', auth, async (req, res) => {
    const out = await featureRebuild(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  router.post('/occ/feature-create', auth, async (req, res) => {
    const out = await featureCreate(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  router.post('/occ/feature-append', auth, async (req, res) => {
    const out = await featureAppend(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  router.get('/occ/feature-list/:partId', auth, async (req, res) => {
    const out = await featureList({ partId: req.params.partId });
    return res.status(out.ok ? 200 : 422).json(out);
  });

  router.post('/occ/feature-undo', auth, async (req, res) => {
    const out = await featureUndo(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  router.post('/occ/sketch-extrude', auth, async (req, res) => {
    const out = await sketchExtrude(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  router.post('/occ/measure', auth, async (req, res) => {
    const out = await measureGeometry(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  router.post('/occ/mate-solids', auth, async (req, res) => {
    const out = await mateSolids(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  /** POST /api/conkay/occ/mate-solve-dof — INDUSTRIAL_CLASS multi-DOF solver */
  router.post('/occ/mate-solve-dof', auth, async (req, res) => {
    const out = await mateSolveDof(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  /** POST /api/conkay/occ/sketch-solve — INDUSTRIAL_CLASS 2D constraints */
  router.post('/occ/sketch-solve', auth, async (req, res) => {
    const out = await sketchSolve(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  /** POST /api/conkay/occ/gdt-digital — digital ASME Y14.5 harness (NOT ISO CMM) */
  router.post('/occ/gdt-digital', auth, async (req, res) => {
    const out = await gdtDigital(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  /** POST /api/conkay/occ/feature-list — alias body form */
  router.post('/occ/feature-list', auth, async (req, res) => {
    const out = await featureList(req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  /** POST /api/conkay/assemblies/:id/parts/:partId/rebuild-solid */
  router.post('/assemblies/:id/parts/:partId/rebuild-solid', auth, async (req, res) => {
    if (!needDb(res)) return;
    const out = await rebuildPartFromFeatures(db, req.params.id, req.params.partId, req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  /** POST /api/conkay/assemblies/:id/gdt/verify — geometry verification harness */
  router.post('/assemblies/:id/gdt/verify', auth, async (req, res) => {
    if (!needDb(res)) return;
    const out = await verifyGeometryCallout(db, req.params.id, req.body || {});
    return res.status(out.ok ? 200 : 422).json(out);
  });

  return router;
}
