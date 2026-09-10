// server/lib/conkay/verticals/molecular-cad.js
// Instantaneous Biological/Molecular CAD — STRUCTURAL GEOMETRY ONLY.
// Honesty: PROXY LJ / bond-stretch / density — NOT full MD, NOT wet-lab, NOT pathogens.

const ELEMENTS = Object.freeze({
  H: { z: 1, r: 0.31, mass: 1.008, color: '#ffffff' },
  C: { z: 6, r: 0.76, mass: 12.011, color: '#333333' },
  N: { z: 7, r: 0.71, mass: 14.007, color: '#3050f8' },
  O: { z: 8, r: 0.66, mass: 15.999, color: '#ff0d0d' },
  F: { z: 9, r: 0.57, mass: 18.998, color: '#90e050' },
  P: { z: 15, r: 1.07, mass: 30.974, color: '#ff8000' },
  S: { z: 16, r: 1.05, mass: 32.06, color: '#ffff30' },
  Cl: { z: 17, r: 1.02, mass: 35.45, color: '#1ff01f' },
  Br: { z: 35, r: 1.20, mass: 79.904, color: '#a62929' },
  Si: { z: 14, r: 1.11, mass: 28.085, color: '#f0c8a0' },
});

const FORMULA_ALIASES = Object.freeze({
  water: 'H2O',
  ethanol: 'C2H6O',
  alcohol: 'C2H6O',
  methane: 'CH4',
  ammonia: 'NH3',
  co2: 'CO2',
  'carbon dioxide': 'CO2',
  benzene: 'C6H6',
  glucose: 'C6H12O6',
  peg: 'PEG',
  polyethylene: 'PE',
  'polyethylene glycol': 'PEG',
  pla: 'PLA',
  'polylactic acid': 'PLA',
  caffeine: 'C8H10N4O2',
  aspirin: 'C9H8O4',
  urea: 'CH4N2O',
  propane: 'C3H8',
  hexane: 'C6H14',
  sucrose: 'C12H22O11',
  sugar: 'C12H22O11',
  fullerene: 'C60',
  buckyball: 'C60',
  c60: 'C60',
});

/** Parse simple molecular formulas like H2O, C2H5OH, CH3COOH (no parentheses nesting). */
export function parseFormula(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'empty_formula', code: 'EMPTY' };
  const tokens = [];
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m;
  let last = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index !== last) {
      // allow OH suffix style by continuing; reject unknown chars
      const gap = s.slice(last, m.index);
      if (!/^[\s\-]*$/.test(gap)) {
        return { ok: false, error: `bad_token:${gap}`, code: 'BAD_FORMULA' };
      }
    }
    const sym = m[1];
    if (!ELEMENTS[sym]) return { ok: false, error: `unknown_element:${sym}`, code: 'UNKNOWN_EL' };
    const count = m[2] ? parseInt(m[2], 10) : 1;
    if (!Number.isFinite(count) || count < 1 || count > 512) {
      return { ok: false, error: 'bad_count', code: 'BAD_COUNT' };
    }
    tokens.push({ symbol: sym, count });
    last = m.index + m[0].length;
  }
  if (!tokens.length || last !== s.replace(/[\s\-]/g, '').length && last < s.length && /[A-Za-z0-9]/.test(s.slice(last))) {
    // re-validate: strip spaces/dashes and re-parse length
    const compact = s.replace(/[\s\-]/g, '');
    const tokens2 = [];
    const re2 = /([A-Z][a-z]?)(\d*)/g;
    let m2;
    let pos = 0;
    while ((m2 = re2.exec(compact)) !== null) {
      if (m2.index !== pos) return { ok: false, error: 'parse_gap', code: 'BAD_FORMULA' };
      if (!ELEMENTS[m2[1]]) return { ok: false, error: `unknown_element:${m2[1]}`, code: 'UNKNOWN_EL' };
      tokens2.push({ symbol: m2[1], count: m2[2] ? parseInt(m2[2], 10) : 1 });
      pos = m2.index + m2[0].length;
    }
    if (pos !== compact.length || !tokens2.length) {
      return { ok: false, error: 'unparsed_formula', code: 'BAD_FORMULA' };
    }
    return { ok: true, formula: compact, tokens: tokens2, mode: 'molecule' };
  }
  const compact = tokens.map((t) => t.symbol + (t.count > 1 ? t.count : '')).join('');
  return { ok: true, formula: compact || s, tokens, mode: 'molecule' };
}

export function parseMolecularIntent(textOrFormula) {
  const raw = String(textOrFormula || '').trim();
  if (!raw) return { ok: false, error: 'empty', code: 'EMPTY' };

  // Polymer intents
  const peg = raw.match(/\bPEG(?:-?\s*n\s*=\s*(\d+)|\s+(\d+))?\b/i) || raw.match(/polyethylene\s+glycol(?:\s+n\s*=\s*(\d+))?/i);
  if (peg || /\bPEG\b/i.test(raw)) {
    const n = Math.min(96, Math.max(4, parseInt(peg?.[1] || peg?.[2] || '24', 10) || 24));
    return { ok: true, mode: 'polymer', polymer: 'PEG', n, text: raw, formula: `PEG-n=${n}` };
  }
  const pe = raw.match(/\b(?:PE|polyethylene)\b(?:\s+n\s*=\s*(\d+))?/i);
  if (pe && !/glycol/i.test(raw)) {
    const n = Math.min(96, Math.max(4, parseInt(pe[1] || '24', 10) || 24));
    return { ok: true, mode: 'polymer', polymer: 'PE', n, text: raw, formula: `PE-n=${n}` };
  }
  const pla = raw.match(/\b(?:PLA|polylactic\s+acid)\b(?:\s+n\s*=\s*(\d+))?/i);
  if (pla) {
    const n = Math.min(64, Math.max(4, parseInt(pla[1] || '16', 10) || 16));
    return { ok: true, mode: 'polymer', polymer: 'PLA', n, text: raw, formula: `PLA-n=${n}` };
  }

  const lower = raw.toLowerCase();
  if (FORMULA_ALIASES[lower]) {
    const p = parseFormula(FORMULA_ALIASES[lower]);
    if (!p.ok) return p;
    return { ...p, text: raw, mode: 'molecule' };
  }
  for (const [k, v] of Object.entries(FORMULA_ALIASES)) {
    if (lower.includes(k)) {
      const p = parseFormula(v);
      if (!p.ok) return p;
      return { ...p, text: raw, mode: 'molecule' };
    }
  }

  // Direct formula
  const compact = raw.replace(/[\s\-]/g, '');
  if (/^[A-Z][a-z]?(?:\d*[A-Z][a-z]?\d*)*$/.test(compact)) {
    const p = parseFormula(compact);
    if (p.ok) return { ...p, text: raw };
  }

  return {
    ok: false,
    error: 'unrecognized_intent — try H2O, C2H6O, water, sucrose, C60, PEG n=24, PE n=24, PLA n=16',
    code: 'NO_INTENT',
  };
}

function icosahedronMesh(cx, cy, cz, radius, subdivisions = 0) {
  // Minimal UV sphere-ish: octahedron subdivided once for browser mesh
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => {
    const L = Math.hypot(x, y, z) || 1;
    return [x / L, y / L, z / L];
  });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  // one mid-edge subdivision for smoother spheres (still lean)
  if (subdivisions > 0) {
    const midCache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (midCache.has(key)) return midCache.get(key);
      const va = verts[a];
      const vb = verts[b];
      let x = va[0] + vb[0], y = va[1] + vb[1], z = va[2] + vb[2];
      const L = Math.hypot(x, y, z) || 1;
      const idx = verts.length;
      verts.push([x / L, y / L, z / L]);
      midCache.set(key, idx);
      return idx;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const positions = [];
  const indices = [];
  const base = 0;
  for (const [x, y, z] of verts) {
    positions.push(cx + x * radius, cy + y * radius, cz + z * radius);
  }
  for (const f of faces) indices.push(f[0] + base, f[1] + base, f[2] + base);
  return { positions, indices, vertexCount: verts.length };
}

function cylinderBond(ax, ay, az, bx, by, bz, radius = 0.12, segments = 6) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  // build local frame
  let fx = 1, fy = 0, fz = 0;
  if (Math.abs(dx) < 0.9) { fx = 1; fy = 0; fz = 0; }
  else { fx = 0; fy = 1; fz = 0; }
  let ux = dy * fz - dz * fy, uy = dz * fx - dx * fz, uz = dx * fy - dy * fx;
  const uL = Math.hypot(ux, uy, uz) || 1;
  ux /= uL; uy /= uL; uz /= uL;
  let vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  const vL = Math.hypot(vx, vy, vz) || 1;
  vx /= vL; vy /= vL; vz /= vL;
  const nx = dx / len, ny = dy / len, nz = dz / len;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    const cx = Math.cos(th) * radius, cy = Math.sin(th) * radius;
    // ring at A
    positions.push(ax + ux * cx + vx * cy, ay + uy * cx + vy * cy, az + uz * cx + vz * cy);
    // ring at B
    positions.push(bx + ux * cx + vx * cy, by + uy * cx + vy * cy, bz + uz * cx + vz * cy);
  }
  for (let i = 0; i < segments; i++) {
    const a0 = i * 2, a1 = a0 + 1, b0 = (i + 1) * 2, b1 = b0 + 1;
    indices.push(a0, b0, a1, a1, b0, b1);
  }
  return { positions, indices, length: len, axis: [nx, ny, nz] };
}

function mergeMeshes(parts) {
  const positions = [];
  const indices = [];
  let base = 0;
  for (const p of parts) {
    positions.push(...p.positions);
    for (const i of p.indices) indices.push(i + base);
    base += p.positions.length / 3;
  }
  return {
    positions,
    indices,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

function placeC60() {
  // Structural PROXY fullerene shell — NOT chemistry / NOT dual-use bio.
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw = [];
  for (const [a, b] of [[0, 1], [1, 0]]) {
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
      raw.push([0, s1 * a, s2 * b * phi]);
      raw.push([s1 * a, s2 * b * phi, 0]);
      raw.push([s1 * b * phi, 0, s2 * a]);
    }
  }
  // Truncated-icosahedron-ish: seed icosa verts + mid-edge points scaled to ~3.5Å radius
  const ico = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ];
  const verts = [];
  const pushN = (x, y, z) => {
    const L = Math.hypot(x, y, z) || 1;
    verts.push([x / L, y / L, z / L]);
  };
  for (const v of ico) pushN(v[0], v[1], v[2]);
  // midpoints of icosa edges → ~30 more; pad to 60 with golden spiral
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const midCache = new Map();
  const mid = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (midCache.has(key)) return midCache.get(key);
    const va = ico[a], vb = ico[b];
    pushN(va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]);
    const idx = verts.length - 1;
    midCache.set(key, idx);
    return idx;
  };
  for (const [a, b, c] of faces) { mid(a, b); mid(b, c); mid(c, a); }
  while (verts.length < 60) {
    const i = verts.length;
    const th = Math.acos(1 - 2 * ((i + 0.5) / 60));
    const ph = Math.PI * (1 + Math.sqrt(5)) * i;
    pushN(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th));
  }
  const R = 3.55;
  const atoms = verts.slice(0, 60).map(([x, y, z]) => ({
    symbol: 'C', ...ELEMENTS.C, x: x * R, y: y * R, z: z * R,
  }));
  const bonds = [];
  const cutoff = 1.55 * 1.55;
  for (let i = 0; i < atoms.length; i++) {
    const near = [];
    for (let j = i + 1; j < atoms.length; j++) {
      const dx = atoms[i].x - atoms[j].x;
      const dy = atoms[i].y - atoms[j].y;
      const dz = atoms[i].z - atoms[j].z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < cutoff * 1.35) near.push([j, d2]);
    }
    near.sort((a, b) => a[1] - b[1]);
    for (const [j] of near.slice(0, 3)) bonds.push([i, j]);
  }
  // dedupe
  const seen = new Set();
  const uniq = [];
  for (const [i, j] of bonds) {
    const a = Math.min(i, j), b = Math.max(i, j);
    const k = `${a}_${b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push([a, b]);
  }
  return { atoms, bonds: uniq };
}

function placeMolecule(tokens) {
  // Expand atom list
  const atoms = [];
  for (const t of tokens) {
    for (let i = 0; i < t.count; i++) atoms.push({ symbol: t.symbol, ...ELEMENTS[t.symbol] });
  }
  // C60 structural shell PROXY
  if (atoms.length === 60 && atoms.every((a) => a.symbol === 'C')) {
    return placeC60();
  }
  // Simple geometry: central heaviest non-H, hydrogens around, others on ring / 3D helix for large
  const heavy = atoms.filter((a) => a.symbol !== 'H');
  const hydro = atoms.filter((a) => a.symbol === 'H');
  const positions = [];
  const bonds = [];
  if (heavy.length === 0) {
    atoms.forEach((a, i) => {
      positions.push({ ...a, x: i * 0.74, y: 0, z: 0 });
    });
    for (let i = 0; i < positions.length - 1; i++) bonds.push([i, i + 1]);
    return { atoms: positions, bonds };
  }
  const R = heavy.length > 20 ? 1.15 + heavy.length * 0.02 : 1.4;
  heavy.forEach((a, i) => {
    if (heavy.length === 1) {
      positions.push({ ...a, x: 0, y: 0, z: 0 });
    } else if (heavy.length === 2) {
      positions.push({ ...a, x: (i === 0 ? -1 : 1) * 0.75, y: 0, z: 0 });
    } else if (heavy.length > 12) {
      // 3D helical / spherical shell for larger organics (sucrose-class)
      const th = (i / heavy.length) * Math.PI * 2 * (1 + heavy.length / 40);
      const y = (i / Math.max(heavy.length - 1, 1) - 0.5) * Math.min(4, heavy.length * 0.12);
      const rr = R * (0.85 + 0.25 * Math.sin(i * 0.7));
      positions.push({ ...a, x: Math.cos(th) * rr, y, z: Math.sin(th) * rr });
    } else {
      const th = (i / heavy.length) * Math.PI * 2;
      const y = (i % 2) * 0.35 - 0.15;
      positions.push({ ...a, x: Math.cos(th) * R, y, z: Math.sin(th) * R });
    }
  });
  for (let i = 0; i < heavy.length; i++) {
    const j = (i + 1) % heavy.length;
    if (heavy.length === 2 && i > 0) break;
    if (heavy.length > 2 || i === 0) bonds.push([i, j === 0 && heavy.length > 2 ? 0 : j]);
  }
  if (heavy.length === 2) { bonds.length = 0; bonds.push([0, 1]); }
  // Extra near-neighbor bonds for large shells (richer connectivity)
  if (heavy.length > 12) {
    for (let i = 0; i < heavy.length; i++) {
      const j = (i + 2) % heavy.length;
      bonds.push([i, j]);
    }
  }
  hydro.forEach((h, hi) => {
    const parent = hi % Math.max(heavy.length, 1);
    const th = (hi / Math.max(hydro.length, 1)) * Math.PI * 2 + parent;
    const px = positions[parent].x + Math.cos(th) * 1.0;
    const py = positions[parent].y + 0.35 * ((hi % 2) * 2 - 1);
    const pz = positions[parent].z + Math.sin(th) * 1.0;
    const idx = positions.length;
    positions.push({ ...h, x: px, y: py, z: pz });
    bonds.push([parent, idx]);
  });
  return { atoms: positions, bonds };
}

function placePolymer(kind, n) {
  const atoms = [];
  const bonds = [];
  // Coarse bead helix — biocompatible polymer GEOMETRY only (PROXY, not chemistry)
  const monomer = kind === 'PLA'
    ? [{ s: 'C' }, { s: 'C' }, { s: 'O' }]
    : kind === 'PEG'
      ? [{ s: 'C' }, { s: 'C' }, { s: 'O' }]
      : [{ s: 'C' }, { s: 'C' }]; // PE
  let idx = 0;
  const pitch = 1.35;
  const radius = 0.55;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < monomer.length; j++) {
      const s = monomer[j].s;
      const el = ELEMENTS[s];
      const t = i + j / monomer.length;
      const th = t * 0.85;
      const x = t * pitch;
      const y = Math.sin(th) * radius + Math.sin(i * 0.35 + j) * 0.15;
      const z = Math.cos(th) * radius;
      atoms.push({ symbol: s, ...el, x, y, z, monomer: i });
      if (idx > 0) bonds.push([idx - 1, idx]);
      idx++;
    }
  }
  return { atoms, bonds };
}

/** Lennard-Jones 12-6 PROXY energy (ε=1, σ from covalent radii sum * 1.1). */
export function ljEnergyProxy(atoms) {
  let E = 0;
  const n = atoms.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = atoms[i].x - atoms[j].x;
      const dy = atoms[i].y - atoms[j].y;
      const dz = atoms[i].z - atoms[j].z;
      const r = Math.hypot(dx, dy, dz);
      if (r < 1e-6) continue;
      const sigma = ((atoms[i].r || 0.7) + (atoms[j].r || 0.7)) * 1.1;
      const sr = sigma / r;
      const sr6 = sr ** 6;
      const sr12 = sr6 * sr6;
      E += 4 * (sr12 - sr6);
    }
  }
  return E;
}

export function bondStretchProxy(atoms, bonds, k = 100) {
  let E = 0;
  for (const [i, j] of bonds) {
    const a = atoms[i], b = atoms[j];
    const r = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const r0 = (a.r || 0.7) + (b.r || 0.7);
    E += 0.5 * k * (r - r0) ** 2;
  }
  return E;
}

/** Harmonic angle-bend PROXY from bonded triples (θ0≈109.5°). NOT full valence FF. */
export function angleBendProxy(atoms, bonds, kAngle = 20) {
  const adj = new Map();
  for (const [i, j] of bonds) {
    if (!adj.has(i)) adj.set(i, []);
    if (!adj.has(j)) adj.set(j, []);
    adj.get(i).push(j);
    adj.get(j).push(i);
  }
  const th0 = Math.acos(-1 / 3); // tetrahedral
  let E = 0;
  let angleCount = 0;
  for (const [c, nbrs] of adj.entries()) {
    for (let a = 0; a < nbrs.length; a++) {
      for (let b = a + 1; b < nbrs.length; b++) {
        const i = nbrs[a], j = nbrs[b];
        const vix = atoms[i].x - atoms[c].x, viy = atoms[i].y - atoms[c].y, viz = atoms[i].z - atoms[c].z;
        const vjx = atoms[j].x - atoms[c].x, vjy = atoms[j].y - atoms[c].y, vjz = atoms[j].z - atoms[c].z;
        const ni = Math.hypot(vix, viy, viz) || 1e-6;
        const nj = Math.hypot(vjx, vjy, vjz) || 1e-6;
        let cos = (vix * vjx + viy * vjy + viz * vjz) / (ni * nj);
        cos = Math.max(-1, Math.min(1, cos));
        const th = Math.acos(cos);
        E += 0.5 * kAngle * (th - th0) ** 2;
        angleCount++;
      }
    }
  }
  return { energy: E, angleCount };
}

export function densityEstimate(atoms) {
  if (!atoms.length) return { massU: 0, volumeA3: 0, densityU_per_A3: 0 };
  let mass = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const a of atoms) {
    mass += a.mass || 1;
    const r = a.r || 0.7;
    minX = Math.min(minX, a.x - r); maxX = Math.max(maxX, a.x + r);
    minY = Math.min(minY, a.y - r); maxY = Math.max(maxY, a.y + r);
    minZ = Math.min(minZ, a.z - r); maxZ = Math.max(maxZ, a.z + r);
  }
  const volume = Math.max(1e-6, (maxX - minX) * (maxY - minY) * (maxZ - minZ));
  return { massU: mass, volumeA3: volume, densityU_per_A3: mass / volume };
}

/** Simple PROXY force field: LJ pair + harmonic bonds → steepest-descent / damped Verlet.
 * Honesty: NOT full MD / NOT quantum / NOT thermostatted NVT production run.
 */
export function forcesProxy(atoms, bonds, { kBond = 80 } = {}) {
  const n = atoms.length;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const fz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = atoms[i].x - atoms[j].x;
      const dy = atoms[i].y - atoms[j].y;
      const dz = atoms[i].z - atoms[j].z;
      const r = Math.hypot(dx, dy, dz);
      if (r < 1e-6) continue;
      const sigma = ((atoms[i].r || 0.7) + (atoms[j].r || 0.7)) * 1.1;
      const sr = sigma / r;
      const sr6 = sr ** 6;
      const sr12 = sr6 * sr6;
      // dE/dr for 4*(sr12-sr6); force magnitude = -dE/dr
      const dEdr = 4 * ((-12) * sr12 / r + 6 * sr6 / r);
      const f = -dEdr / r;
      fx[i] += f * dx; fy[i] += f * dy; fz[i] += f * dz;
      fx[j] -= f * dx; fy[j] -= f * dy; fz[j] -= f * dz;
    }
  }
  for (const [i, j] of bonds) {
    const a = atoms[i], b = atoms[j];
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    const r = Math.hypot(dx, dy, dz) || 1e-6;
    const r0 = (a.r || 0.7) + (b.r || 0.7);
    const f = -kBond * (r - r0) / r;
    fx[i] += f * dx; fy[i] += f * dy; fz[i] += f * dz;
    fx[j] -= f * dx; fy[j] -= f * dy; fz[j] -= f * dz;
  }
  return { fx, fy, fz };
}

/**
 * PROXY MD relaxation steps (damped velocity Verlet). Geometry only — not production MD.
 * @returns {{atoms, steps, energyBefore, energyAfter, deltaE, maxForceFinal, trajectorySample, label}}
 */
export function relaxMdProxy(atomsIn, bonds, { steps = 96, dt = 0.01, kBond = 80, kAngle = 20, fClip = 50, maxDisp = 0.08 } = {}) {
  // Clipped steepest-descent PROXY — stable on coarse placements; NOT production MD.
  const atoms = atomsIn.map((a) => ({
    ...a,
    x: a.x, y: a.y, z: a.z,
    mass: a.mass || 12,
  }));
  const energyOf = () => ljEnergyProxy(atoms) + bondStretchProxy(atoms, bonds, kBond) + angleBendProxy(atoms, bonds, kAngle).energy;
  const energyBefore = energyOf();
  const trajectorySample = [];
  let maxForceFinal = 0;
  let accepted = 0;
  let stepSize = Number(dt) || 0.01;
  const N = Math.max(1, Math.min(400, Number(steps) || 96));
  for (let step = 0; step < N; step++) {
    const { fx, fy, fz } = forcesProxy(atoms, bonds, { kBond });
    maxForceFinal = 0;
    const trial = atoms.map((a) => ({ ...a }));
    for (let i = 0; i < atoms.length; i++) {
      let fxi = fx[i], fyi = fy[i], fzi = fz[i];
      const fmag = Math.hypot(fxi, fyi, fzi);
      if (fmag > maxForceFinal) maxForceFinal = fmag;
      if (fmag > fClip) {
        const s = fClip / fmag;
        fxi *= s; fyi *= s; fzi *= s;
      }
      let dx = fxi * stepSize, dy = fyi * stepSize, dz = fzi * stepSize;
      const dmag = Math.hypot(dx, dy, dz);
      if (dmag > maxDisp) {
        const s = maxDisp / dmag;
        dx *= s; dy *= s; dz *= s;
      }
      trial[i].x = atoms[i].x + dx;
      trial[i].y = atoms[i].y + dy;
      trial[i].z = atoms[i].z + dz;
    }
    const E0 = energyOf();
    // swap in trial for energy eval
    const backup = atoms.map((a) => ({ x: a.x, y: a.y, z: a.z }));
    for (let i = 0; i < atoms.length; i++) {
      atoms[i].x = trial[i].x; atoms[i].y = trial[i].y; atoms[i].z = trial[i].z;
    }
    const E1 = energyOf();
    if (E1 <= E0 || !Number.isFinite(E0)) {
      accepted++;
      stepSize = Math.min(0.05, stepSize * 1.05);
    } else {
      // reject uphill — shrink step
      for (let i = 0; i < atoms.length; i++) {
        atoms[i].x = backup[i].x; atoms[i].y = backup[i].y; atoms[i].z = backup[i].z;
      }
      stepSize = Math.max(1e-4, stepSize * 0.5);
    }
    if (step % Math.max(1, Math.floor(N / 8)) === 0 || step === N - 1) {
      trajectorySample.push({
        step,
        E: Number(energyOf().toFixed(6)),
        maxF: Number(maxForceFinal.toFixed(4)),
        stepSize: Number(stepSize.toFixed(5)),
      });
    }
  }
  const energyAfter = energyOf();
  return {
    atoms,
    steps: N,
    acceptedSteps: accepted,
    energyBefore,
    energyAfter,
    deltaE: energyAfter - energyBefore,
    maxForceFinal,
    trajectorySample,
    label: 'PROXY_RELAX',
    note: 'Clipped steepest-descent LJ+bond PROXY — NOT full MD / NOT thermostatted production',
  };
}

/**
 * text/NLP or structured formula → browser-ready molecular/polymer mesh + PROXY physics.
 */
export function buildMolecularCad(input = {}) {
  const t0 = Date.now();
  const text = input.text ?? input.formula ?? input.prompt ?? '';
  const intent = parseMolecularIntent(text);
  if (!intent.ok) return { ok: false, ...intent, ms: Date.now() - t0 };

  let structure;
  if (intent.mode === 'polymer') {
    structure = placePolymer(intent.polymer, intent.n);
  } else {
    structure = placeMolecule(intent.tokens);
  }

  const relaxSteps = Math.max(0, Math.min(400, Number(input.relaxSteps ?? 96) || 0));
  let mdRelax = null;
  if (relaxSteps > 0 && structure.atoms.length >= 2) {
    mdRelax = relaxMdProxy(structure.atoms, structure.bonds, {
      steps: relaxSteps,
      dt: Number(input.relaxDt) || 0.003,
    });
    structure = { atoms: mdRelax.atoms, bonds: structure.bonds };
  }

  const meshParts = [];
  const atomMeshes = [];
  for (const a of structure.atoms) {
    const sphere = icosahedronMesh(a.x, a.y, a.z, (a.r || 0.7) * 0.55, 1);
    meshParts.push(sphere);
    atomMeshes.push({
      symbol: a.symbol,
      position: [a.x, a.y, a.z],
      radius: a.r,
      color: a.color,
    });
  }
  const bondMeshes = [];
  for (const [i, j] of structure.bonds) {
    const a = structure.atoms[i], b = structure.atoms[j];
    const cyl = cylinderBond(a.x, a.y, a.z, b.x, b.y, b.z, 0.12);
    meshParts.push({ positions: cyl.positions, indices: cyl.indices });
    bondMeshes.push({ from: i, to: j, length: cyl.length });
  }

  const mesh = mergeMeshes(meshParts);
  const lj = ljEnergyProxy(structure.atoms);
  const stretch = bondStretchProxy(structure.atoms, structure.bonds);
  const density = densityEstimate(structure.atoms);
  const ms = Date.now() - t0;

  return {
    ok: true,
    intent,
    atoms: atomMeshes,
    bonds: bondMeshes,
    mesh: {
      positions: mesh.positions,
      indices: mesh.indices,
      vertexCount: mesh.vertexCount,
      triangleCount: mesh.triangleCount,
      id: `mol-${intent.formula || intent.polymer || 'x'}`,
      color: '#88ccff',
    },
    proxy: {
      label: 'PROXY',
      note: 'LJ + harmonic bond/angle PROXY + AABB density + clipped steepest-descent PROXY relax — NOT full MD / NOT quantum chemistry',
      ljEnergy: lj,
      bondStretchEnergy: stretch,
      angleBend: angleBendProxy(structure.atoms, structure.bonds),
      density,
      atomCount: structure.atoms.length,
      bondCount: structure.bonds.length,
      mdRelax: mdRelax
        ? {
            label: mdRelax.label,
            steps: mdRelax.steps,
            energyBefore: mdRelax.energyBefore,
            energyAfter: mdRelax.energyAfter,
            deltaE: mdRelax.deltaE,
            maxForceFinal: mdRelax.maxForceFinal,
            trajectorySample: mdRelax.trajectorySample,
            note: mdRelax.note,
          }
        : null,
    },
    honesty: {
      domain: 'structural_molecular_geometry',
      not: ['pathogens', 'enhancement', 'reverse_genetics', 'weaponization', 'wet_lab', 'full_MD'],
      fda: false,
      clinical: false,
    },
    ms,
  };
}

export default { buildMolecularCad, parseMolecularIntent, parseFormula, relaxMdProxy, forcesProxy, ljEnergyProxy, bondStretchProxy, angleBendProxy };
