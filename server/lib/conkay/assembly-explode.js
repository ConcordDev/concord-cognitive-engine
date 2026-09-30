// server/lib/conkay/assembly-explode.js
// Explode assembly parts along vectors from assembly COM to part centroids.
// Honesty: geometric centroid explode — NOT physics / animation / SolidWorks explode-table.

import {
  getAssembly,
  listParts,
  transformPart,
  pushAssemblyRevision,
} from './assembly-store.js';

/** World-space centroid of a part (mesh mean + transform, or transform.position). */
export function partCentroid(part) {
  const pos = part?.transform?.position || { x: 0, y: 0, z: 0 };
  const scl = part?.transform?.scale || { x: 1, y: 1, z: 1 };
  const mesh = part?.mesh;
  if (!mesh?.positions?.length) {
    return { x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0 };
  }
  const p = mesh.positions;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const n = Math.floor(p.length / 3);
  if (n <= 0) return { x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0 };
  for (let i = 0; i < n; i++) {
    sx += p[i * 3] * (scl.x ?? 1);
    sy += p[i * 3 + 1] * (scl.y ?? 1);
    sz += p[i * 3 + 2] * (scl.z ?? 1);
  }
  return {
    x: sx / n + (pos.x ?? 0),
    y: sy / n + (pos.y ?? 0),
    z: sz / n + (pos.z ?? 0),
  };
}

export function assemblyCom(parts) {
  if (!parts.length) return { x: 0, y: 0, z: 0 };
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const p of parts) {
    const c = partCentroid(p);
    sx += c.x;
    sy += c.y;
    sz += c.z;
  }
  const n = parts.length;
  return { x: sx / n, y: sy / n, z: sz / n };
}

/**
 * Explode parts: newPos = pos + (centroid - COM) * factor.
 * factor=0 → no change; factor>0 → push outward from COM.
 * Undoable via existing pushAssemblyRevision / undo.
 */
export function explodeAssembly(db, assemblyId, factor = 1) {
  const asm = getAssembly(db, assemblyId);
  if (!asm) return { ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' };
  const f = Number(factor);
  if (!Number.isFinite(f)) {
    return { ok: false, error: 'factor_must_be_number', code: 'BAD_FACTOR' };
  }
  const parts = listParts(db, assemblyId);
  if (!parts.length) return { ok: false, error: 'no_parts', code: 'EMPTY' };

  const com = assemblyCom(parts);
  pushAssemblyRevision(db, assemblyId, `explode:${f}`);

  const updates = [];
  for (const part of parts) {
    const c = partCentroid(part);
    const dx = (c.x - com.x) * f;
    const dy = (c.y - com.y) * f;
    const dz = (c.z - com.z) * f;
    const old = part.transform?.position || { x: 0, y: 0, z: 0 };
    const position = {
      x: (old.x ?? 0) + dx,
      y: (old.y ?? 0) + dy,
      z: (old.z ?? 0) + dz,
    };
    const out = transformPart(db, assemblyId, part.id, { position }, { skipHistory: true, label: 'explode' });
    updates.push({
      partId: part.id,
      name: part.name,
      centroid: c,
      delta: { x: dx, y: dy, z: dz },
      position: out.part?.transform?.position || position,
      ok: !!out.ok,
    });
  }

  return {
    ok: true,
    assemblyId,
    factor: f,
    com,
    updates,
    parts: listParts(db, assemblyId),
    honesty: {
      note: 'Centroid-from-COM explode of transforms — undoable via history. NOT physics explode / SolidWorks table.',
    },
  };
}
