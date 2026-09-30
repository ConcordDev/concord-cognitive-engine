// server/lib/conkay/step-import.js
// Read faceted ASCII STEP (POLY_LOOP / CARTESIAN_POINT) back to positions+indices.
// Honesty: faceted mesh round-trip only — not full B-rep topology import.

/**
 * @param {string|Buffer} stepText
 * @param {{ weldTolerance?: number }} [opts]
 * @returns {{ ok:boolean, positions?:number[], indices?:number[], vertexCount?:number, triangleCount?:number, reason?:string, honesty?:object }}
 */
export function stepToMesh(stepText, opts = {}) {
  const text = Buffer.isBuffer(stepText) ? stepText.toString('utf8') : String(stepText || '');
  if (!text.includes('ISO-10303-21') || !text.includes('END-ISO-10303-21')) {
    return { ok: false, reason: 'not_step_file', detail: 'missing ISO-10303-21 envelope' };
  }

  // Strip comments /* ... */
  const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, ' ');

  /** @type {Map<number, string>} */
  const entities = new Map();
  // Match #id=...; allowing nested parens roughly by scanning
  const re = /#(\d+)\s*=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    entities.set(Number(m[1]), m[2].trim());
  }
  if (!entities.size) {
    return { ok: false, reason: 'no_entities' };
  }

  /** @type {Map<number, [number,number,number]>} */
  const cartesian = new Map();
  for (const [id, body] of entities) {
    const cm = /^CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([^)]+)\)\s*\)/i.exec(body);
    if (!cm) continue;
    const nums = cm[1].split(',').map((s) => Number(s.trim()));
    if (nums.length >= 3 && nums.every((n) => Number.isFinite(n))) {
      cartesian.set(id, [nums[0], nums[1], nums[2]]);
    }
  }

  /** @type {Map<number, number>} vertex_point id → cartesian id */
  const vertexPoint = new Map();
  for (const [id, body] of entities) {
    const vm = /^VERTEX_POINT\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*\)/i.exec(body);
    if (vm) vertexPoint.set(id, Number(vm[1]));
  }

  /** @type {number[][]} */
  const triangles = [];
  for (const [, body] of entities) {
    if (!/^POLY_LOOP\s*\(/i.test(body)) continue;
    const refs = [...body.matchAll(/#(\d+)/g)].map((x) => Number(x[1]));
    if (refs.length < 3) continue;
    // POLY_LOOP('',(#a,#b,#c)) — first # is not a vertex if schema uses only vertex refs
    // All # refs in POLY_LOOP should be VERTEX_POINT ids
    const verts = refs
      .map((rid) => {
        const cpId = vertexPoint.get(rid);
        if (cpId != null) return cartesian.get(cpId);
        // Some writers put CARTESIAN_POINT directly (non-standard) — accept
        return cartesian.get(rid);
      })
      .filter(Boolean);
    if (verts.length < 3) continue;
    // Fan triangulate n-gons
    for (let i = 1; i < verts.length - 1; i++) {
      triangles.push([verts[0], verts[i], verts[i + 1]]);
    }
  }

  if (!triangles.length) {
    return {
      ok: false,
      reason: 'no_faceted_faces',
      detail: 'no POLY_LOOP triangles found — only faceted STEP supported',
      cartesianPoints: cartesian.size,
    };
  }

  const weld = Number.isFinite(opts.weldTolerance) ? opts.weldTolerance : 1e-9;
  /** @type {number[]} */
  const positions = [];
  /** @type {Map<string, number>} */
  const weldMap = new Map();
  /** @type {number[]} */
  const indices = [];

  function weldVert(p) {
    const key =
      weld <= 0
        ? `${p[0]},${p[1]},${p[2]}`
        : `${Math.round(p[0] / weld)},${Math.round(p[1] / weld)},${Math.round(p[2] / weld)}`;
    let idx = weldMap.get(key);
    if (idx != null) return idx;
    idx = positions.length / 3;
    positions.push(p[0], p[1], p[2]);
    weldMap.set(key, idx);
    return idx;
  }

  for (const tri of triangles) {
    indices.push(weldVert(tri[0]), weldVert(tri[1]), weldVert(tri[2]));
  }

  return {
    ok: true,
    positions,
    indices,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    honesty: {
      format: 'faceted STEP POLY_LOOP → triangle mesh',
      note: 'Round-trip for ConKay faceted export. Not full B-rep / NURBS import.',
    },
  };
}

/**
 * Compare two meshes within absolute coordinate tolerance.
 */
export function meshesMatch(a, b, tol = 1e-4) {
  if (!a?.positions || !b?.positions || !a?.indices || !b?.indices) {
    return { ok: false, reason: 'missing_mesh' };
  }
  if (a.indices.length !== b.indices.length) {
    return { ok: false, reason: 'index_count_mismatch', a: a.indices.length, b: b.indices.length };
  }
  // Compare triangle corner positions (order-sensitive within export)
  const n = a.indices.length;
  let maxDelta = 0;
  for (let i = 0; i < n; i++) {
    const ia = a.indices[i] * 3;
    const ib = b.indices[i] * 3;
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(Number(a.positions[ia + k]) - Number(b.positions[ib + k]));
      if (d > maxDelta) maxDelta = d;
      if (d > tol) {
        return { ok: false, reason: 'coord_mismatch', maxDelta, at: i, component: k, tol };
      }
    }
  }
  return { ok: true, maxDelta, triangleCount: n / 3, vertexCountA: a.positions.length / 3, vertexCountB: b.positions.length / 3 };
}

export default stepToMesh;
