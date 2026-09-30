// lib/conkay/nlp-design-intent.ts
//
// Free-text → structured engineering design intent (v1). Deterministic
// regex/slot parser for beam / box / cylinder / tube. Fail closed — no LLM.
// Honesty: NLP intent → partMesh/FEA params, NOT an industrial CAD suite.

import { z } from 'zod';

export const DesignLoadSchema = z.object({
  location: z.union([z.literal('midspan'), z.literal('end'), z.number()]),
  forceN: z.number().finite(),
  direction: z.enum(['Fx', 'Fy', 'Fz']).default('Fy'),
});

export const DesignIntentSchema = z.object({
  part: z.enum(['i-beam', 'beam', 'box', 'cylinder', 'tube', 'sphere']),
  spans: z.array(z.number().positive().finite()).min(1),
  loads: z.array(DesignLoadSchema).default([]),
  material: z.enum(['steel', 'aluminum', 'concrete', 'wood', 'unknown']),
  units: z.enum(['m', 'mm', 'ft']),
  meshKind: z.enum(['i-beam', 'box', 'cylinder', 'tube', 'sphere']),
  support: z.enum(['simply-supported', 'cantilever', 'fixed']).optional(),
  rawText: z.string(),
});

export type DesignLoad = z.infer<typeof DesignLoadSchema>;
export type DesignIntent = z.infer<typeof DesignIntentSchema>;

export interface ParseDesignIntentResult {
  ok: true;
  intent: DesignIntent;
}

export interface ParseDesignIntentError {
  ok: false;
  error: string;
  code: 'empty' | 'unsupported_part' | 'no_span' | 'schema';
}

const PART_ALIASES: Array<{ re: RegExp; part: DesignIntent['part']; meshKind: DesignIntent['meshKind'] }> = [
  { re: /\bi[\s-]?beam\b|\bi[\s-]?section\b/i, part: 'i-beam', meshKind: 'i-beam' },
  { re: /\bw[\s-]?beam\b|\bwide[\s-]?flange\b/i, part: 'i-beam', meshKind: 'i-beam' },
  { re: /\bcylinder\b|\bpipe\b/i, part: 'cylinder', meshKind: 'cylinder' },
  { re: /\btube\b|\bhollow\s+section\b/i, part: 'tube', meshKind: 'tube' },
  { re: /\bsphere\b|\bball\b/i, part: 'sphere', meshKind: 'sphere' },
  { re: /\bbox\b|\brectangular\b|\bprism\b/i, part: 'box', meshKind: 'box' },
  { re: /\bbeam\b/i, part: 'beam', meshKind: 'i-beam' },
];

const MATERIAL_RE: Array<{ re: RegExp; material: DesignIntent['material'] }> = [
  { re: /\bsteel\b|\ba36\b|\ba992\b/i, material: 'steel' },
  { re: /\balumin?i?um\b|\bal\b/i, material: 'aluminum' },
  { re: /\bconcrete\b|\brc\b/i, material: 'concrete' },
  { re: /\bwood\b|\btimber\b/i, material: 'wood' },
];

function toMeters(value: number, unit: string): { meters: number; units: DesignIntent['units'] } {
  const u = unit.toLowerCase();
  if (u === 'mm' || u.startsWith('millimet') || u.startsWith('millimet')) {
    return { meters: value / 1000, units: 'mm' };
  }
  if (u === 'ft' || u.startsWith('foot') || u.startsWith('feet')) {
    return { meters: value * 0.3048, units: 'ft' };
  }
  return { meters: value, units: 'm' };
}

function parseForceN(raw: string): number | null {
  const m = raw.match(/(-?\d+(?:\.\d+)?)\s*(kn|kip|kips|n)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  if (unit === 'kn') return n * 1000;
  if (unit.startsWith('kip')) return n * 4448.2216;
  return n;
}

/**
 * Parse free-text engineering design prompt into a Zod-validated intent.
 * Fail closed: unknown part / missing span → error, never a guessed mesh.
 */
export function parseDesignIntent(text: string): ParseDesignIntentResult | ParseDesignIntentError {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'empty design text', code: 'empty' };
  }
  const raw = text.trim();
  const lower = raw.toLowerCase();

  let part: DesignIntent['part'] | null = null;
  let meshKind: DesignIntent['meshKind'] | null = null;
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

  // Spans: "6m", "6 m", "6000mm", "20ft" — prefer explicit length near beam words.
  const spanMatches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(mm|millimet(?:er|re)s?|m|metres?|meters?|ft|feet|foot)\b/gi)];
  let spans: number[] = [];
  let units: DesignIntent['units'] = 'm';
  for (const sm of spanMatches) {
    const { meters, units: u } = toMeters(Number(sm[1]), sm[2]);
    if (meters > 0 && meters < 500) {
      spans.push(Math.round(meters * 1e6) / 1e6);
      units = u;
    }
  }
  // Fallback: bare number with unit-less "span" / "long" context e.g. "span 6"
  if (!spans.length) {
    const bare = lower.match(/\b(?:span|length|long(?:er)?)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/);
    if (bare) {
      const n = Number(bare[1]);
      if (n > 0 && n < 500) spans = [n];
    }
  }
  if (!spans.length) {
    return { ok: false, error: 'no span/length found (e.g. "6m")', code: 'no_span' };
  }

  let material: DesignIntent['material'] = 'unknown';
  for (const m of MATERIAL_RE) {
    if (m.re.test(lower)) {
      material = m.material;
      break;
    }
  }

  let support: DesignIntent['support'] | undefined;
  if (/\bsimply[\s-]?supported\b|\bss\b|\bsimple\s+support/i.test(lower)) support = 'simply-supported';
  else if (/\bcantilever\b/i.test(lower)) support = 'cantilever';
  else if (/\bfixed[\s-]?fixed\b|\bfixed\s+ends?\b/i.test(lower)) support = 'fixed';

  const loads: DesignLoad[] = [];
  const forceRe = /(-?\d+(?:\.\d+)?)\s*(kN|kip|kips|N)\b/gi;
  let fm: RegExpExecArray | null;
  while ((fm = forceRe.exec(raw)) !== null) {
    const forceN = parseForceN(fm[0]);
    if (forceN == null) continue;
    const window = raw.slice(Math.max(0, fm.index - 24), fm.index + fm[0].length + 24).toLowerCase();
    let location: DesignLoad['location'] = 'midspan';
    if (/\bmid[\s-]?span\b|\bcenter\b|\bcentre\b|\bmiddle\b/.test(window)) location = 'midspan';
    else if (/\bend\b|\btip\b/.test(window)) location = 'end';
    // downward by default for structural loads (negative Fy in FEA frame)
    loads.push({ location, forceN: -Math.abs(forceN), direction: 'Fy' });
  }

  const candidate = {
    part,
    spans,
    loads,
    material,
    units,
    meshKind,
    support,
    rawText: raw,
  };

  const parsed = DesignIntentSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message, code: 'schema' };
  }
  return { ok: true, intent: parsed.data };
}

/** Map intent → engineering.partMesh kind+params (deterministic defaults). */
export function intentToPartMeshParams(intent: DesignIntent): {
  kind: DesignIntent['meshKind'];
  params: Record<string, number>;
} {
  const length = intent.spans[0] ?? 1;
  // Visual/world scale: keep mesh ~1–2 units for Unity; store real length in params.
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
    params: {
      width: 0.2,
      height: 0.2,
      length: Math.min(Math.max(length, 0.2), 20),
    },
  };
}

/**
 * Map intent → FEA frame model (simply-supported / midspan load).
 * Uses same node layout idea as FEA_FRAME; span from intent; load from intent or -5000N.
 */
export function intentToFeaModel(intent: DesignIntent): {
  nodes: Array<{ id: string; x: number; y: number; z: number }>;
  members: Array<Record<string, unknown>>;
  loads: Array<{ nodeId: string; Fy: number }>;
  supports: Array<Record<string, unknown>>;
} {
  const L = intent.spans[0] ?? 10;
  const half = L / 2;
  const force =
    intent.loads.find((l) => l.location === 'midspan')?.forceN ??
    intent.loads[0]?.forceN ??
    -5000;
  const E = intent.material === 'aluminum' ? 7e10 : intent.material === 'wood' ? 1.2e10 : 2e11;
  const member = {
    area: 0.01,
    momentI: 1e-5,
    elasticModulus: E,
    allowableStress: 2.5e8,
  };
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
