// server/lib/conkay/assembly-mates.js
// Wave 3→v2 — kinematic mates that solve for B given A (distance / axis offset / align_axis).
// Honesty: kinematic mates — NOT an industrial constraint solver / OCC / CAD kernel.
// align_axis orientation is a real solve (Q44/A#27): the driven part is
// rotated by the minimal rotation that makes its free axis parallel to
// the reference part's free axis, preserving its spin about that axis
// as far as the geometry allows. Stored Euler triples are degrees in
// the renderer's convention: they are posted unchanged as Unity eulerAngles
// (set_transform, lib/conkay/unity-bridge.ts), and Unity applies Z, then X,
// then Y: R = Ry·Rx·Rz. (NOT THREE.Euler 'XYZ', which is Rx·Ry·Rz, and NOT
// Rz·Ry·Rx — an earlier version of this file used that and parts that
// looked aligned in its own tests rendered 11-85° off.)

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

// ── Euler (degrees, Unity order R = Ry·Rx·Rz) ↔ rotation matrix ─────
const DEG = Math.PI / 180;
export function eulerToMatrix(rot) {
  const { x, y, z } = vec(rot);
  const cx = Math.cos(x * DEG), sx = Math.sin(x * DEG);
  const cy = Math.cos(y * DEG), sy = Math.sin(y * DEG);
  const cz = Math.cos(z * DEG), sz = Math.sin(z * DEG);
  // R = Ry * Rx * Rz (Unity eulerAngles: Z first, then X, then Y)
  return [
    [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
    [cx * sz, cx * cz, -sx],
    [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
  ];
}

export function matrixToEuler(R) {
  const round = (n) => {
    const r = Math.round(n * 1e6) / 1e6;
    return Object.is(r, -0) ? 0 : r;
  };
  const sx = Math.max(-1, Math.min(1, -R[1][2]));
  const x = Math.asin(sx) / DEG;
  let y, z;
  if (Math.abs(Math.cos(x * DEG)) > 1e-9) {
    y = Math.atan2(R[0][2], R[2][2]) / DEG;
    z = Math.atan2(R[1][0], R[1][1]) / DEG;
  } else {
    // Gimbal lock (x = ±90°): fold everything into y.
    z = 0;
    y = Math.atan2(-R[2][0], R[0][0]) / DEG;
  }
  return { x: round(x), y: round(y), z: round(z) };
}

function matVec(R, v) {
  return {
    x: R[0][0] * v.x + R[0][1] * v.y + R[0][2] * v.z,
    y: R[1][0] * v.x + R[1][1] * v.y + R[1][2] * v.z,
    z: R[2][0] * v.x + R[2][1] * v.y + R[2][2] * v.z,
  };
}
function matMul(A, B) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    out[r][c] = A[r][0] * B[0][c] + A[r][1] * B[1][c] + A[r][2] * B[2][c];
  }
  return out;
}

/**
 * Solve align_axis orientation: rotate the driven part by the minimal
 * rotation Q that takes its free-axis direction onto the reference
 * part's free-axis direction, then express Q·R_driven back as an
 * Euler triple. Already-aligned parts are returned unchanged;
 * opposite axes rotate 180° about a perpendicular axis.
 */
export function solveAlignAxisRotation({ axis = 'x', refRot, drivenRot }) {
  const u = axisUnit(axis);
  const Rref = eulerToMatrix(refRot || {});
  const Rdrv = eulerToMatrix(drivenRot || {});
  const d = matVec(Rdrv, u);
  const t = matVec(Rref, u);
  const dot = Math.max(-1, Math.min(1, d.x * t.x + d.y * t.y + d.z * t.z));
  if (dot > 1 - 1e-12) return vec(drivenRot); // already aligned
  let qAxis, qAngle;
  if (dot < -1 + 1e-12) {
    // Opposite directions: 180° about any axis perpendicular to d.
    const ref = Math.abs(d.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    qAxis = { x: d.y * ref.z - d.z * ref.y, y: d.z * ref.x - d.x * ref.z, z: d.x * ref.y - d.y * ref.x };
    qAngle = Math.PI;
  } else {
    qAxis = { x: d.y * t.z - d.z * t.y, y: d.z * t.x - d.x * t.z, z: d.x * t.y - d.y * t.x };
    qAngle = Math.acos(dot);
  }
  const len = Math.hypot(qAxis.x, qAxis.y, qAxis.z) || 1;
  const kx = qAxis.x / len, ky = qAxis.y / len, kz = qAxis.z / len;
  const c = Math.cos(qAngle), s = Math.sin(qAngle), ic = 1 - c;
  const Q = [
    [c + kx * kx * ic, kx * ky * ic - kz * s, kx * kz * ic + ky * s],
    [ky * kx * ic + kz * s, c + ky * ky * ic, ky * kz * ic - kx * s],
    [kz * kx * ic - ky * s, kz * ky * ic + kx * s, c + kz * kz * ic],
  ];
  return matrixToEuler(matMul(Q, Rdrv));
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
  const refRot = drive === 'b' ? aRot : bRot;
  const drivenPos = drive === 'b' ? { ...bPos } : { ...aPos };
  let drivenRot = drive === 'b' ? { ...bRot } : { ...aRot };
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
    for (const ax of ['x', 'y', 'z']) {
      if (ax !== axis) drivenPos[ax] = refPos[ax];
    }
    if (offset) drivenPos[axis] = refPos[axis] + offset;
    if (type === 'align_axis') {
      // Solve orientation for real (Q44): minimal rotation aligning
      // the driven part's free axis onto the reference's free axis.
      drivenRot = solveAlignAxisRotation({ axis, refRot, drivenRot });
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
  const refRot = vec(d === 'b' ? aRot : bRot);
  const driven = vec(d === 'b' ? bPos : aPos);
  let rot = vec(d === 'b' ? bRot : aRot);
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
      rot = solveAlignAxisRotation({ axis: ax, refRot, drivenRot: rot });
    }
  } else {
    return { ok: false, error: 'unsupported_mate' };
  }
  return { ok: true, position: driven, rotation: rot, drive: d, axis: ax, offset: off, type: t };
}

export { MATE_TYPES };
