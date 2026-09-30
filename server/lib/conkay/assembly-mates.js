// server/lib/conkay/assembly-mates.js
// Wave 3→v2 — kinematic mates that solve for B given A (distance / axis offset / align_axis).
// Honesty: kinematic stubs — NOT an industrial constraint solver / OCC / CAD kernel.

import {
  getPart,
  listParts,
  transformPart,
  getAssembly,
  pushAssemblyRevision,
} from './assembly-store.js';

const MATE_TYPES = Object.freeze([
  'fixed',
  'coincident',
  'offset',
  'aligned',
  'distance',
  'align_axis',
]);

function vec(v) {
  return {
    x: Number.isFinite(Number(v?.x)) ? Number(v.x) : 0,
    y: Number.isFinite(Number(v?.y)) ? Number(v.y) : 0,
    z: Number.isFinite(Number(v?.z)) ? Number(v.z) : 0,
  };
}

function axisUnit(axis) {
  if (axis === 'y') return { x: 0, y: 1, z: 0 };
  if (axis === 'z') return { x: 0, y: 0, z: 1 };
  return { x: 1, y: 0, z: 0 };
}

/**
 * Solve driven part transform given reference part (or world origin).
 * Default drive='b': A is grounded reference, B is solved (CAD-like).
 * drive='a' keeps legacy stub behavior (move A toward B).
 *
 * @param {object} db
 * @param {string} assemblyId
 * @param {{
 *   type: string,
 *   aPartId: string,
 *   bPartId?: string|null,
 *   axis?: 'x'|'y'|'z',
 *   offset?: number,
 *   drive?: 'a'|'b',
 * }} spec
 */
export function applyMate(db, assemblyId, spec) {
  const type = String(spec?.type || '').toLowerCase();
  if (!MATE_TYPES.includes(type)) {
    return { ok: false, error: `unsupported_mate — need one of: ${MATE_TYPES.join(', ')}`, code: 'BAD_MATE' };
  }
  if (!getAssembly(db, assemblyId)) {
    return { ok: false, error: 'assembly_not_found', code: 'NOT_FOUND' };
  }
  const a = getPart(db, assemblyId, spec.aPartId);
  if (!a) return { ok: false, error: 'a_part_not_found', code: 'NOT_FOUND' };

  const axis = ['x', 'y', 'z'].includes(String(spec.axis || '').toLowerCase())
    ? String(spec.axis).toLowerCase()
    : 'x';
  const offset = Number.isFinite(Number(spec.offset)) ? Number(spec.offset) : 0;
  const drive = String(spec.drive || 'b').toLowerCase() === 'a' ? 'a' : 'b';

  let b = null;
  if (spec.bPartId) {
    b = getPart(db, assemblyId, spec.bPartId);
    if (!b) return { ok: false, error: 'b_part_not_found', code: 'NOT_FOUND' };
  }

  if (drive === 'b' && !b) {
    return {
      ok: false,
      error: 'b_part_required_when_drive_b — pass bPartId (or drive:"a" for legacy A←B)',
      code: 'NEED_B',
    };
  }

  const mate = {
    type,
    aPartId: a.id,
    bPartId: b?.id || null,
    axis,
    offset,
    drive,
    appliedAt: new Date().toISOString(),
  };

  const aPos = vec(a.transform?.position);
  const bPos = vec(b?.transform?.position || { x: 0, y: 0, z: 0 });
  const aRot = vec(a.transform?.rotation);
  const bRot = vec(b?.transform?.rotation || { x: 0, y: 0, z: 0 });

  // Reference = grounded; driven = solved
  const refPos = drive === 'b' ? aPos : bPos;
  const drivenPos = drive === 'b' ? { ...bPos } : { ...aPos };
  const drivenRot = drive === 'b' ? { ...bRot } : { ...aRot };
  const drivenId = drive === 'b' ? b.id : a.id;

  const u = axisUnit(axis);

  if (type === 'fixed') {
    drivenPos.x = refPos.x;
    drivenPos.y = refPos.y;
    drivenPos.z = refPos.z;
  } else if (type === 'coincident') {
    drivenPos[axis] = refPos[axis];
  } else if (type === 'offset') {
    // Axis offset: driven[axis] = ref[axis] + offset (other axes unchanged on driven)
    drivenPos[axis] = refPos[axis] + offset;
  } else if (type === 'distance') {
    // Place driven at ref + offset * axis_unit (full 3D solve along axis from A)
    drivenPos.x = refPos.x + u.x * offset;
    drivenPos.y = refPos.y + u.y * offset;
    drivenPos.z = refPos.z + u.z * offset;
  } else if (type === 'aligned' || type === 'align_axis') {
    // Align orthogonal axes to reference; leave free axis (optionally offset).
    // align_axis also zeros rotation about the free axis toward identity (euler stub).
    for (const ax of ['x', 'y', 'z']) {
      if (ax !== axis) drivenPos[ax] = refPos[ax];
    }
    if (offset) drivenPos[axis] = refPos[axis] + offset;
    if (type === 'align_axis') {
      // Euler stub: clear rotations that would twist off the free axis.
      if (axis === 'x') {
        drivenRot.y = 0;
        drivenRot.z = 0;
      } else if (axis === 'y') {
        drivenRot.x = 0;
        drivenRot.z = 0;
      } else {
        drivenRot.x = 0;
        drivenRot.y = 0;
      }
    }
  }

  pushAssemblyRevision(db, assemblyId, `mate:${type}`);
  const patch = { position: drivenPos };
  if (type === 'align_axis') patch.rotation = drivenRot;
  const xf = transformPart(db, assemblyId, drivenId, patch, { skipHistory: true, label: `mate:${type}` });
  if (!xf.ok) return xf;

  try {
    db.prepare(
      `UPDATE conkay_assembly_parts SET mate_json = ?, updated_at = ? WHERE assembly_id = ? AND id = ?`,
    ).run(JSON.stringify({ ...mate, role: 'a' }), new Date().toISOString(), assemblyId, a.id);
    if (b) {
      db.prepare(
        `UPDATE conkay_assembly_parts SET mate_json = ?, updated_at = ? WHERE assembly_id = ? AND id = ?`,
      ).run(JSON.stringify({ ...mate, role: 'b' }), new Date().toISOString(), assemblyId, b.id);
    }
  } catch {
    /* non-fatal */
  }

  return {
    ok: true,
    mate,
    part: xf.part,
    drivenPartId: drivenId,
    parts: listParts(db, assemblyId),
    honesty: {
      wave: '3-v2',
      note: 'Kinematic mate solved for driven part given reference — NOT industrial solver / OCC',
      drive,
    },
  };
}

/** Pure solve helper for unit tests (no DB). */
export function solveMateTransform({ type, axis = 'x', offset = 0, drive = 'b', aPos, bPos, aRot, bRot }) {
  const t = String(type || '').toLowerCase();
  const ax = ['x', 'y', 'z'].includes(String(axis).toLowerCase()) ? String(axis).toLowerCase() : 'x';
  const off = Number.isFinite(Number(offset)) ? Number(offset) : 0;
  const d = String(drive || 'b').toLowerCase() === 'a' ? 'a' : 'b';
  const ref = vec(d === 'b' ? aPos : bPos);
  const driven = vec(d === 'b' ? bPos : aPos);
  const rot = vec(d === 'b' ? bRot : aRot);
  const u = axisUnit(ax);
  if (t === 'fixed') {
    driven.x = ref.x; driven.y = ref.y; driven.z = ref.z;
  } else if (t === 'coincident') {
    driven[ax] = ref[ax];
  } else if (t === 'offset') {
    driven[ax] = ref[ax] + off;
  } else if (t === 'distance') {
    driven.x = ref.x + u.x * off;
    driven.y = ref.y + u.y * off;
    driven.z = ref.z + u.z * off;
  } else if (t === 'aligned' || t === 'align_axis') {
    for (const k of ['x', 'y', 'z']) {
      if (k !== ax) driven[k] = ref[k];
    }
    if (off) driven[ax] = ref[ax] + off;
    if (t === 'align_axis') {
      if (ax === 'x') { rot.y = 0; rot.z = 0; }
      else if (ax === 'y') { rot.x = 0; rot.z = 0; }
      else { rot.x = 0; rot.y = 0; }
    }
  } else {
    return { ok: false, error: 'unsupported_mate' };
  }
  return { ok: true, position: driven, rotation: rot, drive: d, axis: ax, offset: off, type: t };
}

export { MATE_TYPES };
