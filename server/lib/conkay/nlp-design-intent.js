// server/lib/conkay/nlp-design-intent.js
// Deterministic free-text → design intent (mirror of frontend nlp-design-intent.ts).
// Fail closed. No LLM.

/**
 * @typedef {{ location: 'midspan'|'end'|number, forceN: number, direction?: string }} DesignLoad
 * @typedef {{
 *   part: string, spans: number[], loads: DesignLoad[], material: string,
 *   units: string, meshKind: string, support?: string, rawText: string
 * }} DesignIntent
 */

const PART_ALIASES = [
  { re: /\bi[\s-]?beam\b|\bi[\s-]?section\b/i, part: 'i-beam', meshKind: 'i-beam' },
  { re: /\bw[\s-]?beam\b|\bwide[\s-]?flange\b/i, part: 'i-beam', meshKind: 'i-beam' },
  { re: /\bcylinder\b|\bpipe\b/i, part: 'cylinder', meshKind: 'cylinder' },
  { re: /\btube\b|\bhollow\s+section\b/i, part: 'tube', meshKind: 'tube' },
  { re: /\bsphere\b|\bball\b/i, part: 'sphere', meshKind: 'sphere' },
  { re: /\bbox\b|\brectangular\b|\bprism\b/i, part: 'box', meshKind: 'box' },
  { re: /\bbeam\b/i, part: 'beam', meshKind: 'i-beam' },
];

const MATERIAL_RE = [
  { re: /\bsteel\b|\ba36\b|\ba992\b/i, material: 'steel' },
  { re: /\balumin?i?um\b/i, material: 'aluminum' },
  { re: /\bconcrete\b|\brc\b/i, material: 'concrete' },
  { re: /\bwood\b|\btimber\b/i, material: 'wood' },
];

function toMeters(value, unit) {
  const u = String(unit || 'm').toLowerCase();
  if (u === 'mm' || u.startsWith('millimet')) return { meters: value / 1000, units: 'mm' };
  if (u === 'ft' || u.startsWith('foot') || u.startsWith('feet')) return { meters: value * 0.3048, units: 'ft' };
  return { meters: value, units: 'm' };
}

function parseForceN(raw) {
  const m = String(raw).match(/(-?\d+(?:\.\d+)?)\s*(kn|kip|kips|n)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  if (unit === 'kn') return n * 1000;
  if (unit.startsWith('kip')) return n * 4448.2216;
  return n;
}

export function parseDesignIntent(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'empty design text', code: 'empty' };
  }
  const raw = text.trim();
  const lower = raw.toLowerCase();

  let part = null;
  let meshKind = null;
  for (const a of PART_ALIASES) {
    if (a.re.test(lower)) {
      part = a.part;
      meshKind = a.meshKind;
      break;
    }
  }
  if (!part || !meshKind) {
    return {
      ok: false,
      error: 'unsupported part — v1 recognises i-beam/beam/box/cylinder/tube/sphere only',
      code: 'unsupported_part',
    };
  }

  const spanMatches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(mm|millimet(?:er|re)s?|m|metres?|meters?|ft|feet|foot)\b/gi)];
  const spans = [];
  let units = 'm';
  for (const sm of spanMatches) {
    const { meters, units: u } = toMeters(Number(sm[1]), sm[2]);
    if (meters > 0 && meters < 500) {
      spans.push(Math.round(meters * 1e6) / 1e6);
      units = u;
    }
  }
  if (!spans.length) {
    const bare = lower.match(/\b(?:span|length|long(?:er)?)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/);
    if (bare) {
      const n = Number(bare[1]);
      if (n > 0 && n < 500) spans.push(n);
    }
  }
  if (!spans.length) {
    return { ok: false, error: 'no span/length found (e.g. "6m")', code: 'no_span' };
  }

  let material = 'unknown';
  for (const m of MATERIAL_RE) {
    if (m.re.test(lower)) {
      material = m.material;
      break;
    }
  }

  let support;
  if (/\bsimply[\s-]?supported\b|\bss\b|\bsimple\s+support/i.test(lower)) support = 'simply-supported';
  else if (/\bcantilever\b/i.test(lower)) support = 'cantilever';
  else if (/\bfixed[\s-]?fixed\b|\bfixed\s+ends?\b/i.test(lower)) support = 'fixed';

  const loads = [];
  const forceRe = /(-?\d+(?:\.\d+)?)\s*(kN|kip|kips|N)\b/gi;
  let fm;
  while ((fm = forceRe.exec(raw)) !== null) {
    const forceN = parseForceN(fm[0]);
    if (forceN == null) continue;
    const window = raw.slice(Math.max(0, fm.index - 24), fm.index + fm[0].length + 24).toLowerCase();
    let location = 'midspan';
    if (/\bmid[\s-]?span\b|\bcenter\b|\bcentre\b|\bmiddle\b/.test(window)) location = 'midspan';
    else if (/\bend\b|\btip\b/.test(window)) location = 'end';
    loads.push({ location, forceN: -Math.abs(forceN), direction: 'Fy' });
  }

  return {
    ok: true,
    intent: { part, spans, loads, material, units, meshKind, support, rawText: raw },
  };
}

export function intentToPartMeshParams(intent) {
  const length = intent.spans?.[0] ?? 1;
  const kind = intent.meshKind;
  if (kind === 'i-beam') {
    return {
      kind,
      params: {
        flangeWidth: 0.1,
        height: 0.2,
        flangeThickness: 0.012,
        webThickness: 0.008,
        length: Math.min(Math.max(length, 0.2), 20),
      },
    };
  }
  if (kind === 'cylinder' || kind === 'tube') {
    return { kind, params: { radius: 0.08, length: Math.min(Math.max(length, 0.2), 20) } };
  }
  if (kind === 'sphere') {
    return { kind, params: { radius: Math.min(Math.max(length / 2, 0.05), 5) } };
  }
  return {
    kind: 'box',
    params: { width: 0.2, height: 0.2, length: Math.min(Math.max(length, 0.2), 20) },
  };
}

export function intentToFeaModel(intent) {
  const L = intent.spans?.[0] ?? 10;
  const half = L / 2;
  const force =
    intent.loads?.find((l) => l.location === 'midspan')?.forceN ??
    intent.loads?.[0]?.forceN ??
    -5000;
  const E = intent.material === 'aluminum' ? 7e10 : intent.material === 'wood' ? 1.2e10 : 2e11;
  const member = { area: 0.01, momentI: 1e-5, elasticModulus: E, allowableStress: 2.5e8 };
  return {
    nodes: [
      { id: 'N1', x: 0, y: 0, z: 0 },
      { id: 'N2', x: half, y: 0, z: 0 },
      { id: 'N3', x: L, y: 0, z: 0 },
    ],
    members: [
      { id: 'M1', nodeI: 'N1', nodeJ: 'N2', ...member },
      { id: 'M2', nodeI: 'N2', nodeJ: 'N3', ...member },
    ],
    loads: [{ nodeId: 'N2', Fy: force }],
    supports: [
      { nodeId: 'N1', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
      { nodeId: 'N3', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
    ],
  };
}

/** Mirror engineering.partMesh i-beam / box / cylinder builders (deterministic). */
export function buildPartMesh(kind, params = {}) {
  const positions = [];
  const indices = [];
  const pushQuad = (a, b, c, d) => {
    const base = positions.length / 3;
    for (const v of [a, b, c, d]) positions.push(v[0], v[1], v[2]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const k = kind || 'box';
  if (k === 'cylinder' || k === 'tube') {
    const ro = params.radius || 0.05;
    const len = params.length || 0.2;
    const seg = 28;
    const h = len / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      pushQuad(
        [Math.cos(a0) * ro, -h, Math.sin(a0) * ro],
        [Math.cos(a1) * ro, -h, Math.sin(a1) * ro],
        [Math.cos(a1) * ro, h, Math.sin(a1) * ro],
        [Math.cos(a0) * ro, h, Math.sin(a0) * ro],
      );
    }
  } else if (k === 'i-beam') {
    const bf = params.flangeWidth || 0.1;
    const dh = params.height || 0.2;
    const tf = params.flangeThickness || 0.012;
    const tw = params.webThickness || 0.008;
    const len = params.length || 1.0;
    const L = len / 2;
    const flange = (yc) => {
      const verts = [
        [-bf / 2, yc - tf / 2, -L], [bf / 2, yc - tf / 2, -L],
        [bf / 2, yc + tf / 2, -L], [-bf / 2, yc + tf / 2, -L],
        [-bf / 2, yc - tf / 2, L], [bf / 2, yc - tf / 2, L],
        [bf / 2, yc + tf / 2, L], [-bf / 2, yc + tf / 2, L],
      ];
      pushQuad(verts[0], verts[1], verts[2], verts[3]);
      pushQuad(verts[5], verts[4], verts[7], verts[6]);
      pushQuad(verts[4], verts[0], verts[3], verts[7]);
      pushQuad(verts[1], verts[5], verts[6], verts[2]);
      pushQuad(verts[3], verts[2], verts[6], verts[7]);
      pushQuad(verts[4], verts[5], verts[1], verts[0]);
    };
    flange(dh / 2 - tf / 2);
    flange(-dh / 2 + tf / 2);
    const wy = (dh - 2 * tf) / 2;
    const webV = [
      [-tw / 2, -wy, -L], [tw / 2, -wy, -L], [tw / 2, wy, -L], [-tw / 2, wy, -L],
      [-tw / 2, -wy, L], [tw / 2, -wy, L], [tw / 2, wy, L], [-tw / 2, wy, L],
    ];
    pushQuad(webV[0], webV[1], webV[2], webV[3]);
    pushQuad(webV[5], webV[4], webV[7], webV[6]);
    pushQuad(webV[4], webV[0], webV[3], webV[7]);
    pushQuad(webV[1], webV[5], webV[6], webV[2]);
  } else {
    // box default
    const w = (params.width || 0.2) / 2;
    const h = (params.height || 0.2) / 2;
    const L = (params.length || 1.0) / 2;
    const v = [
      [-w, -h, -L], [w, -h, -L], [w, h, -L], [-w, h, -L],
      [-w, -h, L], [w, -h, L], [w, h, L], [-w, h, L],
    ];
    pushQuad(v[0], v[1], v[2], v[3]);
    pushQuad(v[5], v[4], v[7], v[6]);
    pushQuad(v[4], v[0], v[3], v[7]);
    pushQuad(v[1], v[5], v[6], v[2]);
    pushQuad(v[3], v[2], v[6], v[7]);
    pushQuad(v[4], v[5], v[1], v[0]);
  }
  const round = (x) => Math.round(x * 1e6) / 1e6;
  return {
    kind: k,
    positions: positions.map(round),
    indices,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

function utilizationBand(u) {
  if (!Number.isFinite(u)) return 'low';
  if (u > 1) return 'overstressed';
  if (u > 0.75) return 'high';
  if (u > 0.4) return 'moderate';
  return 'low';
}

const BAND_COLORS = {
  low: { hex: '#22c55e', rgba: { r: 0.133, g: 0.773, b: 0.369, a: 1 } },
  moderate: { hex: '#eab308', rgba: { r: 0.918, g: 0.702, b: 0.031, a: 1 } },
  high: { hex: '#f97316', rgba: { r: 0.976, g: 0.451, b: 0.086, a: 1 } },
  overstressed: { hex: '#ef4444', rgba: { r: 0.937, g: 0.267, b: 0.267, a: 1 } },
};

export function feaUtilToColor(utilization) {
  const band = utilizationBand(utilization);
  const c = BAND_COLORS[band];
  return { band, hex: c.hex, rgba: { ...c.rgba } };
}
