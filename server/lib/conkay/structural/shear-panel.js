// server/lib/conkay/structural/shear-panel.js
//
// Thin sheets that work in shear (a floor, a firewall, a bulkhead) inside a
// frame model. A four-node panel of thickness t is replaced by a pair of
// crossed pin-ended diagonals whose axial stiffness equals the panel's
// in-plane shear stiffness:
//
//   rectangle a × b, shear force V along side a: the panel shears by
//   gamma = tau / G = V / (G t a), so the side-b offset is delta = V b / (G t a)
//   and the panel's shear stiffness is k = G t a / b.
//   One diagonal (length d = sqrt(a² + b²), area A, modulus E) gives
//   k = E A cos²(theta) / d with cos(theta) = a / d, i.e. E A a² / d³.
//   Two crossed diagonals act together (one in tension, one in compression),
//   so each takes A = G t d³ / (2 E a b).
//
// This is the equivalent-truss idealisation of a shear panel (derived above
// from tau = G gamma; benchmarked in tests/conkay-car-tub.test.js against the
// closed-form panel shear stiffness). It credits the panel's shear stiffness
// only: its out-of-plane bending is not modelled, and it is valid while the
// sheet does not buckle. Non-rectangular quadrilaterals use the mean opposite
// side lengths for a and b (an approximation, stated in the result).
//
// Shear recovered from the diagonal forces: tau = (|N1| / d1 + |N2| / d2) / t
// (the magnitudes added: conservative when the two do not act equal and
// opposite). Checks: tau <= Fy / (sqrt(3) FS) (von Mises in pure shear) and
// tau <= the elastic shear buckling stress of a plate simply supported on four
// edges, tau_cr = k_s pi² E / (12 (1 - nu²)) (t / b)², k_s = 5.35 + 4 (b / a)²,
// b the shorter side (Timoshenko & Gere, Theory of Elastic Stability, 2nd ed.,
// sec. 9.7). Above tau_cr the sheet carries load as a tension field with a
// lower stiffness that is not modelled, so a buckled panel is a failed check,
// never a pass.

const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y, (q.z ?? 0) - (p.z ?? 0));

/** Geometry of a panel through nodes [n1, n2, n3, n4] (in order around it). */
export function panelGeometry(nodesById, panel) {
  const p = panel.nodes.map((id) => nodesById.get(String(id)));
  if (p.length !== 4 || p.some((x) => !x)) throw new Error(`panel ${panel.id}: needs four known nodes`);
  const a = (dist(p[0], p[1]) + dist(p[3], p[2])) / 2;
  const b = (dist(p[1], p[2]) + dist(p[0], p[3])) / 2;
  const d1 = dist(p[0], p[2]), d2 = dist(p[1], p[3]);
  const rect = Math.abs(dist(p[0], p[1]) - dist(p[3], p[2])) < 1e-6 && Math.abs(dist(p[1], p[2]) - dist(p[0], p[3])) < 1e-6 && Math.abs(d1 - d2) < 1e-6;
  return { a, b, d1, d2, area: a * b, rectangular: rect };
}

/** Equivalent diagonal members for a panel: [{ id, i, j, section, d }]. */
export function panelDiagonals(nodesById, panel, { E, G, t }) {
  if (!(E > 0 && G > 0 && t > 0)) throw new Error(`panel ${panel.id}: needs E, G and thickness`);
  const g = panelGeometry(nodesById, panel);
  const area = (d) => (G * t * d ** 3) / (2 * E * g.a * g.b);
  const sec = (A) => {
    // a pin-ended bar: negligible bending and torsion (a thin strip of the sheet), shear areas = A
    const I = (A * t * t) / 12;
    return { shape: "properties", A, Iz: I, Iy: I, J: (2 * I), Asy: A, Asz: A, cy: 0, cz: 0, depth: t };
  };
  return {
    geometry: g,
    diagonals: [
      { id: `${panel.id}/d1`, i: panel.nodes[0], j: panel.nodes[2], section: sec(area(g.d1)), d: g.d1, segments: 1 },
      { id: `${panel.id}/d2`, i: panel.nodes[1], j: panel.nodes[3], section: sec(area(g.d2)), d: g.d2, segments: 1 },
    ],
  };
}

/** Elastic shear buckling stress of a plate a × b, thickness t, simply supported on four edges. */
export function plateShearBuckling({ a, b, t, E, nu }) {
  const long = Math.max(a, b), short = Math.min(a, b);
  const ks = 5.35 + 4 * (short / long) ** 2;
  return { ks, tauCr: (ks * Math.PI ** 2 * E) / (12 * (1 - nu * nu)) * (t / short) ** 2 };
}

/** Shear in a panel from its diagonals' axial forces (tension +). */
export function panelShear({ N1, N2, d1, d2, t }) {
  return (Math.abs(N1) / d1 + Math.abs(N2) / d2) / t;
}
