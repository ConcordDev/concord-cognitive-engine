// server/lib/conkay/occ-bridge.js
// Node ↔ OpenCascade (OCP) bridge via ~/.zuko/venvs/cad-occ Python CLI.
// Honesty: real advanced B-rep STEP when venv+OCP available; else unavailable.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { listParts, getPart, getAssembly, addPart, defaultTransform, updatePartMeta, setPartMesh, pushAssemblyRevision } from './assembly-store.js';
import * as occDaemon from '../sidecars/occ-daemon-client.js'; // Concurrency Refactor Phase 2 — warm OCC daemon, off the per-request execFile path

const execFileAsync = promisify(execFile);

const DEFAULT_VENV_PYTHON = path.join(os.homedir(), '.zuko', 'venvs', 'cad-occ', 'bin', 'python');
const DEFAULT_CLI = path.join(os.homedir(), '.zuko', 'venvs', 'cad-occ', 'bin', 'conkay_occ_cli.py');
const REPO_CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/conkay_occ_cli.py');

function resolvePython() {
  return process.env.CONKAY_OCC_PYTHON || DEFAULT_VENV_PYTHON;
}

function resolveCli() {
  if (process.env.CONKAY_OCC_CLI && fs.existsSync(process.env.CONKAY_OCC_CLI)) {
    return process.env.CONKAY_OCC_CLI;
  }
  if (fs.existsSync(DEFAULT_CLI)) return DEFAULT_CLI;
  if (fs.existsSync(REPO_CLI)) return REPO_CLI;
  return DEFAULT_CLI;
}

function brepDataDir() {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'conkay-brep');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Run CLI command; returns parsed JSON object.
 */
export async function runOccCli(cmd, payload = {}, opts = {}) {
  const timeout = opts.timeoutMs || 60000;

  // Concurrency Refactor Phase 2: prefer the warm daemon so we don't pay a cold
  // `import OCP` per call and don't stack processes under a burst. Fail soft —
  // any transport error drops through to the execFile path below unchanged.
  if (process.env.CONCORD_OCC_DAEMON_DISABLE !== '1') {
    try {
      if (await occDaemon.isAvailable()) {
        const r = await occDaemon.runCommand(cmd, payload || {}, { timeoutMs: timeout });
        if (r && r.reason !== 'occ_daemon_empty_response' && r.reason !== 'occ_daemon_dispatch_error') {
          if (opts.includeStderr && r.stderr == null) r.stderr = undefined;
          return r;
        }
      }
    } catch {
      /* daemon down / errored — fall through to cold execFile */
    }
  }

  const python = resolvePython();
  const cli = resolveCli();
  if (!fs.existsSync(python)) {
    return {
      ok: false,
      reason: 'occ_venv_missing',
      detail: `python not found at ${python}`,
      honesty: { note: 'Install cadquery-ocp into ~/.zuko/venvs/cad-occ on Mac kitchen' },
    };
  }
  if (!fs.existsSync(cli)) {
    return {
      ok: false,
      reason: 'occ_cli_missing',
      detail: `CLI not found at ${cli}`,
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      python,
      [cli, cmd, JSON.stringify(payload || {})],
      {
        timeout,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      },
    );
    const lines = String(stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // OCC writes ANSI stats to stdout sometimes interleaved — take last JSON line
    let parsed = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith('{')) continue;
      try {
        parsed = JSON.parse(line);
        break;
      } catch {
        /* continue */
      }
    }
    if (!parsed) {
      return {
        ok: false,
        reason: 'occ_cli_no_json',
        stdout: String(stdout || '').slice(-500),
        stderr: String(stderr || '').slice(-500),
      };
    }
    if (stderr && opts.includeStderr) parsed.stderr = String(stderr).slice(-500);
    return parsed;
  } catch (e) {
    return {
      ok: false,
      reason: 'occ_cli_failed',
      error: e instanceof Error ? e.message : String(e),
      stderr: e?.stderr ? String(e.stderr).slice(-800) : undefined,
    };
  }
}

export async function probeOcc() {
  return runOccCli('probe', {});
}

function meshBBox(mesh) {
  const p = mesh?.positions;
  if (!p?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = Number(p[i]);
    const y = Number(p[i + 1]);
    const z = Number(p[i + 2]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ, dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ };
}

function applyPos(transform) {
  return {
    x: Number(transform?.position?.x || 0),
    y: Number(transform?.position?.y || 0),
    z: Number(transform?.position?.z || 0),
  };
}

function partToOccSpec(part) {
  const kindRaw = String(part.kind || part.meta?.intent?.part || '').toLowerCase();
  const intent = part.meta?.intent || {};
  const params = {};
  let kind = 'box';
  if (/cyl|pipe|rod|shaft/.test(kindRaw)) {
    kind = 'cylinder';
    params.r = Number(intent.radius || intent.r || 0.5);
    params.h = Number(intent.height || intent.h || intent.length || 2);
  } else if (/box|cube|beam|plate|block|rect/.test(kindRaw) || kindRaw === 'mesh') {
    kind = 'box';
    params.dx = Number(intent.width || intent.dx || intent.x || 1);
    params.dy = Number(intent.depth || intent.dy || intent.y || 1);
    params.dz = Number(intent.height || intent.dz || intent.z || 1);
  } else {
    kind = 'box';
  }
  const bboxLocal = meshBBox(part.mesh);
  const pos = applyPos(part.transform);
  // Prefer AABB in world space for mesh-backed parts without clean archetype dims
  let bbox = null;
  if (bboxLocal) {
    const scl = part.transform?.scale || { x: 1, y: 1, z: 1 };
    bbox = {
      minX: bboxLocal.minX * (scl.x ?? 1) + pos.x,
      minY: bboxLocal.minY * (scl.y ?? 1) + pos.y,
      minZ: bboxLocal.minZ * (scl.z ?? 1) + pos.z,
      maxX: bboxLocal.maxX * (scl.x ?? 1) + pos.x,
      maxY: bboxLocal.maxY * (scl.y ?? 1) + pos.y,
      maxZ: bboxLocal.maxZ * (scl.z ?? 1) + pos.z,
    };
    bbox.dx = bbox.maxX - bbox.minX;
    bbox.dy = bbox.maxY - bbox.minY;
    bbox.dz = bbox.maxZ - bbox.minZ;
  }
  return {
    id: part.id,
    name: part.name,
    kind,
    params,
    position: pos,
    bbox,
  };
}

/**
 * Export assembly as OCC advanced B-rep STEP; persist under data/conkay-brep/.
 */
export async function exportAssemblyBrepStep(db, assemblyId, opts = {}) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, reason: 'assembly_not_found' };
  const parts = listParts(db, assemblyId);
  if (!parts.length) return { ok: false, reason: 'no_parts' };

  const specs = [];
  const skipped = [];
  for (const p of parts) {
    if (!p.mesh?.positions?.length && !/box|cube|cyl|beam|pipe|rod/.test(String(p.kind || ''))) {
      skipped.push({ id: p.id, name: p.name, reason: 'no_mesh_or_archetype' });
      continue;
    }
    specs.push(partToOccSpec(p));
  }
  if (!specs.length) return { ok: false, reason: 'no_exportable_parts', skipped };

  const outPath = path.join(brepDataDir(), `assembly-${assemblyId}-brep.step`);
  const result = await runOccCli('export_compound', {
    name: `assembly_${String(assemblyId).slice(0, 8)}`,
    out: outPath,
    parts: specs,
    deflection: opts.deflection || 0.5,
  });
  if (!result.ok) return { ...result, skipped, assemblyId };
  let buffer = null;
  try {
    buffer = await readFile(outPath);
  } catch (e) {
    return { ok: false, reason: 'step_file_unreadable', error: String(e), path: outPath };
  }
  return {
    ok: true,
    assemblyId,
    assemblyName: asm.name,
    path: outPath,
    buffer,
    bytes: buffer.length,
    advanced_brep: result.export?.advanced_brep,
    markers: result.export?.markers,
    faceted_markers: result.export?.faceted_markers,
    solids: result.solids,
    parts: result.parts,
    skipped,
    mesh: result.mesh,
    honesty: {
      kernel: 'OpenCascade/OCP',
      format: 'AP214 advanced B-rep STEP',
      note: 'LIVE OCC B-rep when advanced_brep=true. Mesh parts approximated as AABB boxes / cylinders from kind.',
      not: 'SolidWorks UI parity / physical ISO 17025 CMM',
    },
  };
}

/**
 * Export a single part as OCC B-rep STEP.
 */
export async function exportPartBrepStep(part, opts = {}) {
  if (!part) return { ok: false, reason: 'part_not_found' };
  const spec = partToOccSpec(part);
  const outPath = path.join(
    brepDataDir(),
    `part-${part.id}-brep.step`,
  );
  const payload = {
    kind: spec.kind,
    params: spec.params,
    position: spec.bbox
      ? { x: spec.bbox.minX, y: spec.bbox.minY, z: spec.bbox.minZ }
      : spec.position,
    out: outPath,
    name: `part_${part.name || part.id}`,
    deflection: opts.deflection || 0.5,
  };
  // Prefer bbox box for mesh fidelity of extent
  if (spec.bbox) {
    payload.kind = 'box';
    payload.params = { dx: Math.max(spec.bbox.dx, 1e-3), dy: Math.max(spec.bbox.dy, 1e-3), dz: Math.max(spec.bbox.dz, 1e-3) };
  }
  const result = await runOccCli('make_archetype', payload);
  if (!result.ok) return result;
  const buffer = await readFile(outPath);
  return {
    ok: true,
    partId: part.id,
    path: outPath,
    buffer,
    bytes: buffer.length,
    advanced_brep: result.export?.advanced_brep,
    markers: result.export?.markers,
    faceted_markers: result.export?.faceted_markers,
    solids: result.solids,
    mesh: result.mesh,
    honesty: result.honesty,
  };
}

/**
 * Import OCC/advanced STEP → tessellated mesh part + keep B-rep on disk.
 */
export async function importBrepStepToAssembly(db, assemblyId, stepTextOrPath, opts = {}) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, reason: 'assembly_not_found' };

  const keepPath = path.join(brepDataDir(), `import-${assemblyId}-${Date.now()}-brep.step`);
  let payload;
  if (typeof stepTextOrPath === 'string' && fs.existsSync(stepTextOrPath) && !String(stepTextOrPath).includes('ISO-10303-21')) {
    payload = { path: stepTextOrPath, keep_path: keepPath, deflection: opts.deflection || 0.5 };
  } else {
    const text = Buffer.isBuffer(stepTextOrPath) ? stepTextOrPath.toString('utf8') : String(stepTextOrPath || '');
    if (!text.includes('ISO-10303-21')) {
      return { ok: false, reason: 'need_step_body', code: 'MISSING_STEP' };
    }
    payload = { step: text, keep_path: keepPath, deflection: opts.deflection || 0.5 };
  }

  const result = await runOccCli('import_step', payload);
  if (!result.ok) return result;
  if (!result.mesh?.positions?.length || !result.mesh?.indices?.length) {
    return { ok: false, reason: 'tessellation_empty', detail: result };
  }

  const transform = defaultTransform(opts.transform);
  if (!opts.transform?.position) {
    const existing = listParts(db, assemblyId);
    transform.position.x = existing.length * 1.5;
    transform.position.y = 1.2;
  }

  const out = addPart(db, assemblyId, {
    name: opts.name || 'occ-step-import',
    kind: 'step-brep-occ',
    source: 'occ-step-import',
    transform,
    mate: { type: 'fixed' },
    mesh: {
      positions: result.mesh.positions,
      indices: result.mesh.indices,
      kind: 'step-brep-occ',
      vertexCount: result.mesh.vertexCount,
      triangleCount: result.mesh.triangleCount,
    },
    material: opts.material || null,
    meta: {
      importedFrom: 'occ-brep-step',
      brepPath: result.keptPath || keepPath,
      advanced_brep: result.advanced_brep,
      markers: result.markers,
      solids: result.solids,
      honesty: result.honesty,
    },
  });
  if (!out.ok) return out;
  return {
    ok: true,
    part: out.part,
    mesh: {
      vertexCount: result.mesh.vertexCount,
      triangleCount: result.mesh.triangleCount,
    },
    brepPath: result.keptPath || keepPath,
    advanced_brep: result.advanced_brep,
    markers: result.markers,
    faceted_markers: result.faceted_markers,
    solids: result.solids,
    honesty: {
      wave: 'OCC-BREP',
      note: 'OCC B-rep STEP imported, tessellated for Unity, B-rep file kept under data/conkay-brep/.',
    },
  };
}


/**
 * Feature-tree solid rebuild via OCC CLI (Gate A).
 */
export async function featureRebuild(payload = {}) {
  return runOccCli('feature_rebuild', {
    include_mesh: payload.include_mesh !== false && !payload.omit_mesh,
    mesh_summary_only: !!payload.mesh_summary_only,
    ...payload,
  });
}

export async function featureCreate(payload = {}) {
  return runOccCli('feature_create', payload);
}

export async function featureAppend(payload = {}) {
  return runOccCli('feature_append', payload);
}

export async function featureList(payload = {}) {
  return runOccCli('feature_list', payload);
}

export async function featureUndo(payload = {}) {
  return runOccCli('feature_undo', payload);
}

/** Gate B — sketch → extrude/revolve */
export async function sketchExtrude(payload = {}) {
  return runOccCli('sketch_extrude', {
    include_mesh: payload.include_mesh !== false && !payload.omit_mesh,
    ...payload,
  });
}

/** Gate D — geometry verification harness (NOT ISO CMM) */
export async function measureGeometry(payload = {}) {
  return runOccCli('measure', payload);
}

/** Gate C — solid-instance mates (stronger than mesh-only mates v2) */
export async function mateSolids(payload = {}) {
  return runOccCli('mate_solids', {
    include_mesh: payload.include_mesh !== false && !payload.omit_mesh,
    ...payload,
  });
}

/**
 * Persist feature tree on part meta + rebuild B-rep + tessellate into part mesh.
 */
export async function rebuildPartFromFeatures(db, assemblyId, partId, opts = {}) {
  const part = getPart(db, assemblyId, partId);
  if (!part) return { ok: false, reason: 'part_not_found' };
  const features = opts.features || part.meta?.featureTree || [];
  if (!features.length) return { ok: false, reason: 'empty_feature_tree' };
  const outPath = path.join(brepDataDir(), `part-${partId}-features.step`);
  const result = await featureRebuild({
    partId,
    features,
    out: outPath,
    name: `feat_${part.name || partId}`,
    deflection: opts.deflection || 0.5,
  });
  if (!result.ok) return result;
  if (!opts.skipHistory) pushAssemblyRevision(db, assemblyId, opts.label || 'rebuildSolid');
  updatePartMeta(db, assemblyId, partId, {
    featureTree: result.features,
    brepPath: outPath,
    advanced_brep: result.export?.advanced_brep,
    bbox: result.bbox,
    solids: result.solids,
    honesty: result.honesty,
  });
  let meshPayload = null;
  if (result.mesh?.positions?.length) {
    meshPayload = {
      positions: result.mesh.positions,
      indices: result.mesh.indices,
      kind: 'occ-feature-brep',
      vertexCount: result.mesh.vertexCount,
      triangleCount: result.mesh.triangleCount,
    };
    setPartMesh(db, assemblyId, partId, meshPayload, { skipHistory: true, kind: 'occ-feature-brep' });
  }
  return {
    ok: true,
    partId,
    assemblyId,
    features: result.features,
    export: result.export,
    bbox: result.bbox,
    solids: result.solids,
    mesh: meshPayload,
    part: getPart(db, assemblyId, partId),
    honesty: result.honesty,
  };
}



/** INDUSTRIAL_CLASS — multi-DOF mate solver (not AABB snap) */
export async function mateSolveDof(payload = {}) {
  return runOccCli('mate-solve-dof', {
    include_mesh: payload.include_mesh !== false && !payload.omit_mesh,
    ...payload,
  });
}

/** INDUSTRIAL_CLASS — 2D sketch constraint solve + optional extrude */
export async function sketchSolve(payload = {}) {
  return runOccCli('sketch-solve', {
    include_mesh: payload.include_mesh !== false && !payload.omit_mesh,
    ...payload,
  });
}

/** INDUSTRIAL_CLASS — digital ASME Y14.5-style software metrology (NOT ISO CMM) */
export async function gdtDigital(payload = {}) {
  return runOccCli('gdt-digital', payload);
}

export { resolvePython, resolveCli, brepDataDir };
export default {
  runOccCli,
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
};
