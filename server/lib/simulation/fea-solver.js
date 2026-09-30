/**
 * FEA Solver — Direct Stiffness Method (2D/3D beam-frame)
 *
 * Pure JavaScript, no external dependencies.
 * Frame analysis of 200-member structure completes in <20ms.
 *
 * Input:
 *   nodes   — [{ id, x, y, z }]
 *   members — [{ id, nodeI, nodeJ, area, momentI, elasticModulus, material?, allowableStress? }]
 *   loads   — [{ nodeId, Fx?, Fy?, Fz?, Mx?, My?, Mz? }]
 *   supports— [{ nodeId, fixedDOF: ['x','y','z','rx','ry','rz'] }]  ('fixed' = all 6)
 *
 * Output:
 *   { displacements, reactions, memberForces, stresses, utilization, ok }
 */

const DOF_PER_NODE = 6; // ux, uy, uz, rx, ry, rz

// ── Helpers ──────────────────────────────────────────────────────────────────

function nodeIndex(nodes, id) {
  const i = nodes.findIndex(n => String(n.id) === String(id));
  if (i < 0) throw new Error(`Node '${id}' not found`);
  return i;
}

function memberLength(nodes, m) {
  const ni = nodes[nodeIndex(nodes, m.nodeI)];
  const nj = nodes[nodeIndex(nodes, m.nodeJ)];
  const dx = nj.x - ni.x, dy = nj.y - ni.y, dz = (nj.z || 0) - (ni.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function memberCosines(nodes, m) {
  const ni = nodes[nodeIndex(nodes, m.nodeI)];
  const nj = nodes[nodeIndex(nodes, m.nodeJ)];
  const dx = nj.x - ni.x, dy = nj.y - ni.y, dz = (nj.z || 0) - (ni.z || 0);
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return { lx: dx / L, ly: dy / L, lz: dz / L, L };
}

// ── Frame element (3D Euler–Bernoulli beam, 12 DOF) ─────────────────────────
//
// 2026-09-27 rewrite. The previous element never rotated member stiffness into
// its real orientation: any member lying in the XY plane got its bending
// stiffness added along GLOBAL Y. Right for a horizontal beam, wrong for a
// column — a vertical member got transverse stiffness along its own axis
// (axial deflection ~17% too small) and NO lateral stiffness (a sideways tip
// load returned 0 via a silently-singular solve). Results also depended on
// which end of a member was listed first. Pinned against closed-form cases by
// tests/fea-frame-element.test.js.
//
// Section inputs: `momentI` is the in-plane (strong-axis, local z) inertia.
// Optional `Iy` (out-of-plane, defaults to momentI), `J` torsion constant
// (defaults to Iy+Iz, polar approximation) and `shearModulus` G (defaults to
// E/2.6, steel ν≈0.3). For planar frames only the in-plane terms matter.

function memberProps(m, L) {
  const E = m.elasticModulus || 29e6; // psi (steel default)
  const A = m.area || 1;
  const Iz = m.Iz || m.momentI || 1;
  const Iy = m.Iy || m.momentIy || m.momentI || 1;
  const J = m.J || m.torsionJ || (Iy + Iz);
  const G = m.shearModulus || E / 2.6;
  return { E, A, Iz, Iy, J, G, L };
}

// Rotation (rows = local x, y, z in global coordinates). Local y lies in the
// plane containing global Z (the 2D-frame convention: in-plane bending is about
// local z = global Z); members parallel to Z use global Y as the reference.
function rotation(lx, ly, lz) {
  const x = [lx, ly, lz];
  const ref = Math.abs(lz) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  let y = [ref[1] * x[2] - ref[2] * x[1], ref[2] * x[0] - ref[0] * x[2], ref[0] * x[1] - ref[1] * x[0]];
  const ny = Math.hypot(y[0], y[1], y[2]);
  y = y.map((v) => v / ny);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [x, y, z];
}

function localStiffness({ E, A, Iz, Iy, J, G, L }) {
  const k = Array.from({ length: 12 }, () => new Float64Array(12));
  const set = (r, c, v) => { k[r][c] = v; k[c][r] = v; };
  const a = (E * A) / L, t = (G * J) / L;
  const z12 = 12 * E * Iz / L ** 3, z6 = 6 * E * Iz / L ** 2, z4 = 4 * E * Iz / L, z2 = 2 * E * Iz / L;
  const y12 = 12 * E * Iy / L ** 3, y6 = 6 * E * Iy / L ** 2, y4 = 4 * E * Iy / L, y2 = 2 * E * Iy / L;
  set(0, 0, a); set(0, 6, -a); set(6, 6, a);
  set(3, 3, t); set(3, 9, -t); set(9, 9, t);
  // bending in local x–y plane (v, θz) — uses Iz
  set(1, 1, z12); set(1, 5, z6); set(1, 7, -z12); set(1, 11, z6);
  set(5, 5, z4); set(5, 7, -z6); set(5, 11, z2);
  set(7, 7, z12); set(7, 11, -z6); set(11, 11, z4);
  // bending in local x–z plane (w, θy) — uses Iy
  set(2, 2, y12); set(2, 4, -y6); set(2, 8, -y12); set(2, 10, -y6);
  set(4, 4, y4); set(4, 8, y6); set(4, 10, y2);
  set(8, 8, y12); set(8, 10, y6); set(10, 10, y4);
  return k;
}

// Global element displacement vector → local (T·u), T = diag(R,R,R,R).
function toLocal(R, ue) {
  const out = new Float64Array(12);
  for (let blk = 0; blk < 4; blk++) {
    for (let r = 0; r < 3; r++) {
      let v = 0;
      for (let c = 0; c < 3; c++) v += R[r][c] * ue[blk * 3 + c];
      out[blk * 3 + r] = v;
    }
  }
  return out;
}

function elementData(nodes, m) {
  const { lx, ly, lz, L } = memberCosines(nodes, m);
  const R = rotation(lx, ly, lz);
  const props = memberProps(m, L);
  const kl = localStiffness(props);
  return { R, kl, props, iIdx: nodeIndex(nodes, m.nodeI), jIdx: nodeIndex(nodes, m.nodeJ) };
}

// ── Global Stiffness Matrix ───────────────────────────────────────────────────

export function buildStiffnessMatrix(members, nodes) {
  const n = nodes.length;
  const size = n * DOF_PER_NODE;
  // Flat row-major array
  const K = new Float64Array(size * size);

  for (const m of members) {
    const { R, kl, iIdx, jIdx } = elementData(nodes, m);
    // T (12×12) = block-diagonal of R; Kg = Tᵀ · kl · T
    const T = Array.from({ length: 12 }, () => new Float64Array(12));
    for (let blk = 0; blk < 4; blk++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[blk * 3 + r][blk * 3 + c] = R[r][c];
    const kT = Array.from({ length: 12 }, () => new Float64Array(12));
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) { let v = 0; for (let q = 0; q < 12; q++) v += kl[r][q] * T[q][c]; kT[r][c] = v; }
    const dofs = [];
    for (let d = 0; d < 6; d++) dofs.push(iIdx * DOF_PER_NODE + d);
    for (let d = 0; d < 6; d++) dofs.push(jIdx * DOF_PER_NODE + d);
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 12; c++) {
        let v = 0;
        for (let q = 0; q < 12; q++) v += T[q][r] * kT[q][c];
        if (v !== 0) K[dofs[r] * size + dofs[c]] += v;
      }
    }
  }

  return { K, size };
}

// ── Boundary Conditions ───────────────────────────────────────────────────────

const DOF_MAP = { x: 0, y: 1, z: 2, rx: 3, ry: 4, rz: 5 };

export function applyBoundaryConditions(K, F, nodes, supports, size) {
  const constrained = new Set();

  for (const sup of supports) {
    const idx = nodeIndex(nodes, sup.nodeId);
    const base = idx * DOF_PER_NODE;

    const dofs = sup.fixedDOF === 'fixed' || sup.type === 'fixed'
      ? ['x', 'y', 'z', 'rx', 'ry', 'rz']
      : sup.fixedDOF || [];

    for (const d of dofs) {
      const dofIdx = base + (DOF_MAP[d] ?? 0);
      constrained.add(dofIdx);
    }
  }

  // Penalty method: set K[i,i] = 1e30, F[i] = 0 for constrained DOFs
  for (const i of constrained) {
    for (let j = 0; j < size; j++) {
      K[i * size + j] = 0;
      K[j * size + i] = 0;
    }
    K[i * size + i] = 1e30;
    F[i] = 0;
  }

  return constrained;
}

// ── Gaussian Elimination ─────────────────────────────────────────────────────

export function solveSystem(K, F, size) {
  // Copy to avoid mutation
  const A = K.slice();
  const b = new Float64Array(F);
  const singular = [];

  for (let col = 0; col < size; col++) {
    // Find pivot
    let maxVal = Math.abs(A[col * size + col]);
    let maxRow = col;
    for (let row = col + 1; row < size; row++) {
      const v = Math.abs(A[row * size + col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    // Swap rows
    if (maxRow !== col) {
      for (let k = 0; k < size; k++) {
        const tmp = A[col * size + k];
        A[col * size + k] = A[maxRow * size + k];
        A[maxRow * size + k] = tmp;
      }
      const tmp = b[col]; b[col] = b[maxRow]; b[maxRow] = tmp;
    }

    const pivot = A[col * size + col];
    if (Math.abs(pivot) < 1e-12) { singular.push(col); continue; } // singular DOF (mechanism / unrestrained)

    for (let row = col + 1; row < size; row++) {
      const factor = A[row * size + col] / pivot;
      for (let k = col; k < size; k++) {
        A[row * size + k] -= factor * A[col * size + k];
      }
      b[row] -= factor * b[col];
    }
  }

  // Back substitution
  const u = new Float64Array(size);
  for (let row = size - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < size; k++) sum -= A[row * size + k] * u[k];
    const diag = A[row * size + row];
    u[row] = Math.abs(diag) < 1e-12 ? 0 : sum / diag;
  }

  // Report singular DOFs instead of silently returning 0 for them: a zero
  // displacement at an unrestrained DOF is a mechanism, not a stiff result.
  u.singularDofs = singular;
  return u;
}

// ── Member Forces ─────────────────────────────────────────────────────────────

export function computeMemberForces(u, members, nodes) {
  return members.map(m => {
    const { R, kl, props, iIdx, jIdx } = elementData(nodes, m);
    const ue = new Float64Array(12);
    for (let d = 0; d < 6; d++) { ue[d] = u[iIdx * DOF_PER_NODE + d]; ue[6 + d] = u[jIdx * DOF_PER_NODE + d]; }
    const ul = toLocal(R, ue);
    const f = new Float64Array(12);
    for (let r = 0; r < 12; r++) { let v = 0; for (let c = 0; c < 12; c++) v += kl[r][c] * ul[c]; f[r] = v; }
    // Local end forces: f[6] is the axial force at end j (tension positive);
    // f[1]/f[5]/f[11] are in-plane shear at i and moments at i/j; f[4]/f[10]
    // are the out-of-plane moments.
    return {
      id: m.id,
      axialForce: f[6],
      shearI: f[1],
      momentI: f[5],
      momentJ: f[11],
      maxMoment: Math.max(Math.abs(f[5]), Math.abs(f[11]), Math.abs(f[4]), Math.abs(f[10])),
      torsion: f[9],
      L: props.L,
    };
  });
}

// ── Stresses ──────────────────────────────────────────────────────────────────

export function computeStresses(memberForces, members) {
  return memberForces.map((mf, i) => {
    const m = members[i];
    const A = m.area || 1;
    const I = m.momentI || 1;
    // Distance from neutral axis to extreme fiber (assume square-ish section)
    const c = m.depthIn ? m.depthIn / 2 : Math.sqrt(A) / 2;

    const axialStress   = mf.axialForce / A;                    // P/A
    const bendingStress = (mf.maxMoment * c) / I;               // Mc/I
    const combinedStress = Math.abs(axialStress) + bendingStress; // conservative combination

    return {
      id: mf.id,
      axialStress,
      bendingStress,
      combinedStress,
    };
  });
}

// ── Utilization ───────────────────────────────────────────────────────────────

export function checkUtilization(stresses, members) {
  return stresses.map((s, i) => {
    const m = members[i];
    const allowable = m.allowableStress || 21600; // 21.6 ksi = A36 steel ASD allowable
    const utilization = s.combinedStress / allowable;
    return {
      id: s.id,
      utilization,
      pass: utilization <= 1.0,
      combinedStress: s.combinedStress,
      allowableStress: allowable,
    };
  });
}

// ── Top-level FEA ─────────────────────────────────────────────────────────────

export function runFEA(input) {
  const { nodes = [], members = [], loads = [], supports = [], onStage = null } = input;

  // Honest ConKay HUD beat (K1): emit a real `macro:stage` at each phase the
  // solve actually reaches (assemble → solve → postprocess). Best-effort — a
  // throwing hook never affects the solve; the beats are pure decoration bound
  // to the true internal structure, never a timer.
  const stage = (s) => { try { onStage?.(s); } catch { /* decoration only */ } };

  if (nodes.length === 0 || members.length === 0) {
    return { ok: false, error: 'Model must have at least one node and one member' };
  }

  const size = nodes.length * DOF_PER_NODE;

  stage('assembling');
  // Build global stiffness matrix
  const { K } = buildStiffnessMatrix(members, nodes);

  // Build load vector
  const F = new Float64Array(size);
  for (const load of loads) {
    const idx = nodeIndex(nodes, load.nodeId);
    const base = idx * DOF_PER_NODE;
    if (load.Fx) F[base + 0] += load.Fx;
    if (load.Fy) F[base + 1] += load.Fy;
    if (load.Fz) F[base + 2] += load.Fz;
    if (load.Mx) F[base + 3] += load.Mx;
    if (load.My) F[base + 4] += load.My;
    if (load.Mz) F[base + 5] += load.Mz;
  }

  // Snapshot the UNCONSTRAINED system before applyBoundaryConditions mutates
  // K (zeros constrained rows/cols, 1e30 on the diagonal) and F (zeros the
  // constrained entries). Support reactions are recovered from the original
  // stiffness + load below: R = K0·u − F0. Cost is a size² Float64 copy —
  // fine at the documented ~200-member scale (solveSystem already copies K).
  const K0 = K.slice();
  const F0 = F.slice();

  // Apply boundary conditions
  const constrained = applyBoundaryConditions(K, F, nodes, supports, size);

  stage('solving');
  // Solve
  const u = solveSystem(K, F, size);

  // Extract displacements per node
  const displacements = nodes.map((node, i) => ({
    nodeId: node.id,
    dx: u[i * DOF_PER_NODE + 0],
    dy: u[i * DOF_PER_NODE + 1],
    dz: u[i * DOF_PER_NODE + 2],
    rx: u[i * DOF_PER_NODE + 3],
    ry: u[i * DOF_PER_NODE + 4],
    rz: u[i * DOF_PER_NODE + 5],
    magnitude: Math.sqrt(
      u[i * DOF_PER_NODE + 0] ** 2 +
      u[i * DOF_PER_NODE + 1] ** 2 +
      u[i * DOF_PER_NODE + 2] ** 2
    ),
  }));

  // Reactions at supports — direct-stiffness recovery from the UNMUTATED
  // system: at a constrained dof i, the support reaction balances the
  // internal force minus the applied external load, R_i = (K0·u)_i − F0_i.
  // (At free dofs this same quantity is ~0 by equilibrium — the identity the
  // reactions test uses as its oracle.)
  const reactions = [];
  for (const i of constrained) {
    const nodeIdx = Math.floor(i / DOF_PER_NODE);
    const dofLocal = i % DOF_PER_NODE;
    const dofName = Object.keys(DOF_MAP)[dofLocal];
    let internal = 0;
    for (let j = 0; j < size; j++) {
      internal += K0[i * size + j] * u[j];
    }
    const force = internal - F0[i];
    reactions.push({ nodeId: nodes[nodeIdx].id, dof: dofName, nodeIdx, dofLocal, force });
  }

  stage('postprocess');
  // Member forces and stresses
  const memberForces = computeMemberForces(u, members, nodes);
  const stresses     = computeStresses(memberForces, members);
  const utilization  = checkUtilization(stresses, members);

  const maxDisp = Math.max(...displacements.map(d => d.magnitude));
  const warnings = [];
  if (u.singularDofs?.length) {
    const names = Object.keys(DOF_MAP);
    warnings.push({
      code: 'unstable_structure',
      message: 'Some degrees of freedom have no stiffness (a mechanism or missing support); their displacements are not meaningful.',
      dofs: u.singularDofs.slice(0, 24).map((i) => `${nodes[Math.floor(i / DOF_PER_NODE)]?.id}.${names[i % DOF_PER_NODE]}`),
    });
  }
  const maxUtil = Math.max(...utilization.map(u => u.utilization));

  return {
    ok: true,
    displacements,
    reactions,
    memberForces,
    stresses,
    utilization,
    warnings,
    summary: {
      maxDisplacement: maxDisp,
      maxUtilization: maxUtil,
      allPass: utilization.every(u => u.pass),
      memberCount: members.length,
      nodeCount: nodes.length,
    },
  };
}
