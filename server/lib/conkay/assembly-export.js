// server/lib/conkay/assembly-export.js
// Wave 2 — STL + BOM; Wave STEP — faceted ASCII STEP. Reuses meshToSTL / meshToSTEP.
// Honest failures. NOT SolidWorks/OCC B-rep.

import { meshToSTL } from '../asset-gen/stl-export.js';
import { meshToSTEP } from './step-export.js';
import { stepToMesh } from './step-import.js';
import { listParts, getPart, getAssembly } from './assembly-store.js';

function applyTransformToPositions(positions, transform) {
  const pos = transform?.position || { x: 0, y: 0, z: 0 };
  const scl = transform?.scale || { x: 1, y: 1, z: 1 };
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] * (scl.x ?? 1) + (pos.x ?? 0);
    out[i + 1] = positions[i + 1] * (scl.y ?? 1) + (pos.y ?? 0);
    out[i + 2] = positions[i + 2] * (scl.z ?? 1) + (pos.z ?? 0);
  }
  return out;
}

/** Export one part's mesh to binary STL (world transform applied). */
export function exportPartStl(part) {
  if (!part) return { ok: false, reason: 'part_not_found' };
  if (!part.mesh?.positions?.length || !part.mesh?.indices?.length) {
    return {
      ok: false,
      reason: 'no_triangle_mesh',
      detail: part.glbUrl
        ? 'GLB parts need mesh arrays for STL in Wave 2 — glb→triangle not wired here'
        : 'part has no mesh',
    };
  }
  const positions = applyTransformToPositions(part.mesh.positions, part.transform);
  return meshToSTL(
    { positions, indices: part.mesh.indices },
    { header: `Concord ConKay part ${part.id}`.slice(0, 80) },
  );
}

/**
 * Merge all triangle-mesh parts into one STL (simple translate+scale, no rotation).
 * Skips GLB-only parts; reports skipped in result.
 */
export function exportAssemblyStl(db, assemblyId) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, reason: 'assembly_not_found' };
  const parts = listParts(db, assemblyId);
  const allPos = [];
  const allIdx = [];
  let vertOffset = 0;
  const included = [];
  const skipped = [];
  for (const p of parts) {
    if (!p.mesh?.positions?.length || !p.mesh?.indices?.length) {
      skipped.push({ id: p.id, name: p.name, reason: p.glbUrl ? 'glb_only' : 'no_mesh' });
      continue;
    }
    const positions = applyTransformToPositions(p.mesh.positions, p.transform);
    for (let i = 0; i < positions.length; i++) allPos.push(positions[i]);
    for (const idx of p.mesh.indices) allIdx.push(idx + vertOffset);
    vertOffset += positions.length / 3;
    included.push({ id: p.id, name: p.name, kind: p.kind });
  }
  if (!allIdx.length) {
    return { ok: false, reason: 'no_exportable_mesh_parts', skipped };
  }
  const stl = meshToSTL(
    { positions: allPos, indices: allIdx },
    { header: `Concord ConKay assembly ${assemblyId}`.slice(0, 80) },
  );
  if (!stl.ok) return { ...stl, included, skipped };
  return { ...stl, included, skipped, assemblyId, assemblyName: asm.name };
}

/** BOM JSON: part id, kind, material, qty (grouped by kind+material). */
export function buildBom(db, assemblyId) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, reason: 'assembly_not_found' };
  const parts = listParts(db, assemblyId);
  const groups = new Map();
  for (const p of parts) {
    const kind = p.kind || 'unknown';
    const material = p.material || p.meta?.intent?.material || 'unspecified';
    const key = `${kind}||${material}`;
    if (!groups.has(key)) {
      groups.set(key, {
        kind,
        material,
        qty: 0,
        partIds: [],
        names: [],
      });
    }
    const g = groups.get(key);
    g.qty += 1;
    g.partIds.push(p.id);
    g.names.push(p.name);
  }
  const lines = [...groups.values()];
  return {
    ok: true,
    assemblyId,
    assemblyName: asm.name,
    lines,
    totalParts: parts.length,
    parts: parts.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      material: p.material || p.meta?.intent?.material || 'unspecified',
      qty: 1,
      source: p.source,
      hasMesh: !!(p.mesh?.positions?.length),
      glbUrl: p.glbUrl || null,
    })),
    honesty: {
      wave: 2,
      note: 'BOM from assembly store — qty grouped by kind+material. Not ERP/PLM.',
    },
  };
}

/** Export one part's mesh to faceted ASCII STEP (world transform applied). */
export function exportPartStep(part) {
  if (!part) return { ok: false, reason: 'part_not_found' };
  if (!part.mesh?.positions?.length || !part.mesh?.indices?.length) {
    return {
      ok: false,
      reason: 'no_triangle_mesh',
      detail: part.glbUrl
        ? 'GLB parts need mesh arrays for STEP — glb→triangle not wired here'
        : 'part has no mesh',
    };
  }
  const positions = applyTransformToPositions(part.mesh.positions, part.transform);
  return meshToSTEP(
    { positions, indices: part.mesh.indices },
    { name: `part_${part.name || part.id}`, headerNote: `ConKay part ${part.id}` },
  );
}

/** Merge triangle-mesh parts into one faceted STEP (translate+scale, no rotation). */
export function exportAssemblyStep(db, assemblyId) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, reason: 'assembly_not_found' };
  const parts = listParts(db, assemblyId);
  const allPos = [];
  const allIdx = [];
  let vertOffset = 0;
  const included = [];
  const skipped = [];
  for (const p of parts) {
    if (!p.mesh?.positions?.length || !p.mesh?.indices?.length) {
      skipped.push({ id: p.id, name: p.name, reason: p.glbUrl ? 'glb_only' : 'no_mesh' });
      continue;
    }
    const positions = applyTransformToPositions(p.mesh.positions, p.transform);
    for (let i = 0; i < positions.length; i++) allPos.push(positions[i]);
    for (const idx of p.mesh.indices) allIdx.push(idx + vertOffset);
    vertOffset += positions.length / 3;
    included.push({ id: p.id, name: p.name, kind: p.kind });
  }
  if (!allIdx.length) {
    return { ok: false, reason: 'no_exportable_mesh_parts', skipped };
  }
  const step = meshToSTEP(
    { positions: allPos, indices: allIdx },
    { name: `assembly_${assemblyId.slice(0, 8)}`, headerNote: `ConKay assembly ${assemblyId}` },
  );
  if (!step.ok) return { ...step, included, skipped };
  return { ...step, included, skipped, assemblyId, assemblyName: asm.name };
}

/**
 * Parse faceted STEP → mesh suggest payload for addPart.
 */
export function importStepMesh(stepText) {
  return stepToMesh(stepText);
}

export { applyTransformToPositions, meshToSTEP, stepToMesh };
