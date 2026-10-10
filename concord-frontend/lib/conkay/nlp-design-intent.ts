// lib/conkay/nlp-design-intent.ts
//
// Free-text → structured engineering design intent (v1). Deterministic
// regex/slot parser for beam / box / cylinder / tube / bracket. Fail closed — no LLM.
// Honesty: NLP intent → partMesh/FEA params, NOT an industrial CAD suite.
// Masses (kg, lb, t) become newtons at g = 9.80665. Defaults are flagged on
// `assumed`. The L-bracket mesh itself is built by POST /api/conkay/design;
// intentToPartMeshParams returns the arm as a box so the client partMesh
// macro (which has no bracket kind) still receives a real solid.

import { z } from 'zod';

export const G_N_PER_KG = 9.80665;
export const DEFAULT_LOAD_N = 5000;
export const SUPPORTED_PARTS = ['i-beam', 'beam', 'box', 'cylinder', 'tube', 'sphere', 'bracket'] as const;

const BRACKET_DEFAULTS = { length: 0.12, width: 0.08, thickness: 0.008, legHeight: 0.08 };
const I_BEAM_DEFAULTS = { flangeWidth: 0.1, height: 0.2, flangeThickness: 0.012, webThickness: 0.008 };
const SEGMENTS = 8;

export const DesignLoadSchema = z.object({
  location: z.union([z.literal('midspan'), z.literal('end'), z.number()]),
  forceN: z.number().finite(),
  direction: z.enum(['Fx', 'Fy', 'Fz']).default('Fy'),
});

export const AssumedFlagsSchema = z.object({
  load: z.boolean(),
  span: z.boolean(),
  section: z.boolean(),
  material: z.boolean(),
  support: z.boolean(),
});

export const DesignIntentSchema = z.object({
  part: z.enum(['i-beam', 'beam', 'box', 'cylinder', 'tube', 'sphere', 'bracket']),
  spans: z.array(z.number().positive().finite()).min(1),
  loads: z.array(DesignLoadSchema).default([]),
  material: z.enum(['steel', 'aluminum', 'concrete', 'wood', 'unknown']),
  units: z.enum(['m', 'mm', 'ft']),
  meshKind: z.enum(['i-beam', 'box', 'cylinder', 'tube', 'sphere', 'bracket']),
  support: z.enum(['simply-supported', 'cantilever', 'fixed']),
  rawText: z.string(),
  section: z.object({
    kind: z.string(),
    area: z.number().finite(),
    momentI: z.number().finite(),
    depthIn: z.number().finite(),
    length: z.number().finite(),
  }).passthrough(),
  assumed: AssumedFlagsSchema,
  assumptions: z.array(z.string()),
});

export type DesignLoad = z.infer<typeof DesignLoadSchema>;
export type DesignIntent = z.infer<typeof DesignIntentSchema>;
export type AssumedFlags = z.infer<typeof AssumedFlagsSchema>;

export interface ParseDesignIntentResult {
  ok: true;
  intent: DesignIntent;
}

export interface ParseDesignIntentError {
  ok: false;
  error: string;
  code: 'empty' | 'unsupported_part' | 'no_span' | 'schema';
  supportedParts?: string[];
}

type Part = DesignIntent['part'];
type MeshKind = DesignIntent['meshKind'];

const PART_ALIASES: Array<{ re: RegExp; part: Part; meshKind: MeshKind }> = [
  { re: /\bl[\s-]?bracket\b|\bangle\s+bracket\b|\bbracket\b|\bcantilever\s+plate\b/i, part: 'bracket', meshKind: 'bracket' },
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

const MATERIAL_PROPS = {
  steel: { E: 200e9, allowable: 250e6 },
  aluminum: { E: 68.9e9, allowable: 276e6 },
  wood: { E: 1.2e10, allowable: 40e6 },
  concrete: { E: 30e9, allowable: 30e6 },
  unknown: { E: 200e9, allowable: 250e6 },
};

const LENGTH_RE = /(\d+(?:\.\d+)?)\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|metres?|meters?|ft|feet|foot)\b/gi;
const FORCE_RE = /(-?\d+(?:\.\d+)?)\s*(kN|MN|kips|kip|lbf|lbs|lb|pounds?|tonnes?|tons?|kg|N|t)\b/gi;
const PINNED = ['x', 'y', 'z', 'rx', 'ry'];
const ROLLER = ['y', 'z', 'rx', 'ry'];
const FIXED = ['x', 'y', 'z', 'rx', 'ry', 'rz'];

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function toMeters(value: number, unit: string): { meters: number; units: DesignIntent['units'] } {
  const u = unit.toLowerCase();
  if (u === 'mm' || u.startsWith('millimet')) return { meters: value / 1000, units: 'mm' };
  if (u === 'cm' || u.startsWith('centimet')) return { meters: value / 100, units: 'mm' };
  if (u === 'ft' || u.startsWith('foot') || u.startsWith('feet')) return { meters: value * 0.3048, units: 'ft' };
  return { meters: value, units: 'm' };
}

export function forceToNewtons(value: number, unit: string): number | null {
  if (!Number.isFinite(value)) return null;
  const u = unit.toLowerCase();
  if (u === 'kn') return value * 1000;
  if (u === 'mn') return value * 1e6;
  if (u.startsWith('kip')) return value * 4448.2216;
  if (u === 'lbf' || u === 'lb' || u === 'lbs' || u.startsWith('pound')) return value * 0.45359237 * G_N_PER_KG;
  if (u === 'kg') return value * G_N_PER_KG;
  if (u === 't' || u.startsWith('ton')) return value * 1000 * G_N_PER_KG;
  return value;
}

function lengthLabel(raw: string, index: number, matchLen: number): string | null {
  const before = raw.slice(Math.max(0, index - 32), index).toLowerCase();
  const after = raw.slice(index + matchLen, index + matchLen + 18).toLowerCase();
  if (/flange\s+thickness|t_?f\b/.test(before)) return 'flangeThickness';
  if (/web\s+thickness|t_?w\b/.test(before)) return 'webThickness';
  if (/flange\s+width|b_?f\b/.test(before)) return 'flangeWidth';
  if (/\b(diameter|dia)\b/.test(before)) return 'diameter';
  if (/\b(radius|rad)\b/.test(before)) return 'radius';
  if (/\b(thickness|thick)\b/.test(before) || /^\s*(thick|thickness)\b/.test(after)) return 'thickness';
  if (/\b(width|wide)\b/.test(before) || /^\s*(wide|width)\b/.test(after)) return 'width';
  if (/\bleg\b/.test(before)) return 'legHeight';
  if (/\b(depth|height|deep|tall)\b/.test(before) || /^\s*(deep|tall)\b/.test(after)) return 'height';
  if (/\b(arm|span|length|long)\b/.test(before) || /^\s*(span|long|length)\b/.test(after)) return 'span';
  return null;
}

function iBeamSection(p: { flangeWidth: number; height: number; flangeThickness: number; webThickness: number }) {
  const { flangeWidth: bf, height: dh, flangeThickness: tf, webThickness: tw } = p;
  const area = 2 * bf * tf + (dh - 2 * tf) * tw;
  const Ix = (bf * dh ** 3) / 12 - ((bf - tw) * (dh - 2 * tf) ** 3) / 12;
  const Iy = (2 * tf * bf ** 3) / 12 + ((dh - 2 * tf) * tw ** 3) / 12;
  return { area, Ix, Iy };
}

function boxSection(width: number, height: number) {
  return { area: width * height, Ix: (width * height ** 3) / 12, Iy: (height * width ** 3) / 12 };
}

function cylinderSection(radius: number) {
  return { area: Math.PI * radius * radius, Ix: (Math.PI * radius ** 4) / 4, Iy: (Math.PI * radius ** 4) / 4 };
}

function tubeSection(ro: number, ri: number) {
  return {
    area: Math.PI * (ro * ro - ri * ri),
    Ix: (Math.PI / 4) * (ro ** 4 - ri ** 4),
    Iy: (Math.PI / 4) * (ro ** 4 - ri ** 4),
  };
}

function deriveSection(part: Part, meshKind: MeshKind, dims: Record<string, number>, span: number) {
  const notes: string[] = [];
  const take = (key: string, fallback: number, label: string) => {
    if (dims[key] != null) return dims[key];
    notes.push(label);
    return fallback;
  };
  if (part === 'bracket') {
    const width = take('width', BRACKET_DEFAULTS.width, 'width 80 mm');
    const thickness = take('thickness', BRACKET_DEFAULTS.thickness, 'thickness 8 mm');
    const legHeight = take('legHeight', BRACKET_DEFAULTS.legHeight, 'leg height 80 mm');
    const sec = boxSection(width, thickness);
    return {
      assumed: notes.length > 0,
      note: notes.length ? `Section assumed: ${notes.join(', ')}.` : null,
      section: { kind: 'plate', width, thickness, legHeight, length: span, area: sec.area, momentI: sec.Ix, Iy: sec.Iy, depthIn: thickness },
    };
  }
  if (meshKind === 'i-beam') {
    const flangeWidth = take('flangeWidth', I_BEAM_DEFAULTS.flangeWidth, 'flange width 100 mm');
    const height = take('height', I_BEAM_DEFAULTS.height, 'depth 200 mm');
    const flangeThickness = take('flangeThickness', I_BEAM_DEFAULTS.flangeThickness, 'flange thickness 12 mm');
    const webThickness = take('webThickness', I_BEAM_DEFAULTS.webThickness, 'web thickness 8 mm');
    const sec = iBeamSection({ flangeWidth, height, flangeThickness, webThickness });
    return {
      assumed: notes.length > 0,
      note: notes.length ? `Section assumed: ${notes.join(', ')}.` : null,
      section: { kind: 'i-beam', flangeWidth, height, flangeThickness, webThickness, length: span, area: sec.area, momentI: sec.Ix, Iy: sec.Iy, depthIn: height },
    };
  }
  if (meshKind === 'cylinder' || meshKind === 'sphere') {
    const radius = take('radius', meshKind === 'sphere' ? Math.min(Math.max(span / 2, 0.05), 5) : 0.08, 'radius');
    const sec = cylinderSection(radius);
    const assumedSection = meshKind === 'sphere' || notes.length > 0;
    return {
      assumed: assumedSection,
      note: !assumedSection ? null
        : meshKind === 'sphere'
          ? 'Section assumed. Sphere is screened as a solid round bar, not a shell.'
          : `Section assumed: ${notes.join(', ') || 'radius'}.`,
      section: { kind: 'cylinder', radius, length: meshKind === 'sphere' ? radius * 2 : span, area: sec.area, momentI: sec.Ix, Iy: sec.Iy, depthIn: radius * 2 },
    };
  }
  if (meshKind === 'tube') {
    const radius = take('radius', 0.08, 'outer radius 80 mm');
    const innerRadius = take('innerRadius', Math.min(0.06, radius * 0.75), 'inner radius 60 mm');
    const sec = tubeSection(radius, innerRadius);
    return {
      assumed: notes.length > 0,
      note: notes.length ? `Section assumed: ${notes.join(', ')}.` : null,
      section: { kind: 'tube', radius, innerRadius, length: span, area: sec.area, momentI: sec.Ix, Iy: sec.Iy, depthIn: radius * 2 },
    };
  }
  const width = take('width', 0.2, 'width 200 mm');
  const height = take('height', 0.2, 'height 200 mm');
  const sec = boxSection(width, height);
  return {
    assumed: notes.length > 0,
    note: notes.length ? `Section assumed: ${notes.join(', ')}.` : null,
    section: { kind: 'box', width, height, length: span, area: sec.area, momentI: sec.Ix, Iy: sec.Iy, depthIn: height },
  };
}

/**
 * Parse free-text engineering design prompt into a Zod-validated intent.
 * Fail closed: unknown part / missing span (except a bracket, which flags a
 * 0.12 m arm) → error, never a guessed mesh.
 */
export function parseDesignIntent(text: string): ParseDesignIntentResult | ParseDesignIntentError {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'empty design text', code: 'empty' };
  }
  const raw = text.trim();
  const lower = raw.toLowerCase();

  let part: Part | null = null;
  let meshKind: MeshKind | null = null;
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
      error: `unsupported part — recognised parts: ${SUPPORTED_PARTS.join(', ')}`,
      code: 'unsupported_part',
      supportedParts: [...SUPPORTED_PARTS],
    };
  }

  const dims: Record<string, number> = {};
  const spans: number[] = [];
  let units: DesignIntent['units'] = 'm';
  for (const sm of raw.matchAll(LENGTH_RE)) {
    const { meters, units: u } = toMeters(Number(sm[1]), sm[2]);
    if (!(meters > 0 && meters < 500)) continue;
    const label = lengthLabel(raw, sm.index, sm[0].length);
    const v = round6(meters);
    if (label === 'span') {
      spans.push(v);
      units = u;
    } else if (label === 'diameter') {
      dims.radius = round6(v / 2);
    } else if (label && label !== 'span') {
      dims[label] = v;
    } else {
      spans.push(v);
      units = u;
    }
  }
  if (!spans.length) {
    const bare = lower.match(/\b(?:span|length|long(?:er)?|arm)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/);
    if (bare) {
      const n = Number(bare[1]);
      if (n > 0 && n < 500) spans.push(n);
    }
  }

  const assumptions: string[] = [];
  const assumed: AssumedFlags = { load: false, span: false, section: false, material: false, support: false };
  if (!spans.length) {
    if (part !== 'bracket') return { ok: false, error: 'no span/length found (e.g. "6m")', code: 'no_span' };
    spans.push(BRACKET_DEFAULTS.length);
    assumed.span = true;
    assumptions.push('Span assumed 0.12 m (no length was given).');
  }

  let material: DesignIntent['material'] = 'unknown';
  for (const m of MATERIAL_RE) {
    if (m.re.test(lower)) {
      material = m.material;
      break;
    }
  }
  if (material === 'unknown') {
    assumed.material = true;
    assumptions.push('Material assumed ASTM A36 steel.');
  } else if (material === 'wood') {
    assumptions.push('Wood allowable stress assumed 40 MPa (no grade was given).');
  } else if (material === 'concrete') {
    assumptions.push('Concrete allowable stress assumed 30 MPa (screening, no mix was given).');
  }

  let parsedSupport: DesignIntent['support'] | undefined;
  if (/\bsimply[\s-]?supported\b|\bss\b|\bsimple\s+support/i.test(lower)) parsedSupport = 'simply-supported';
  else if (/\bcantilever\b/i.test(lower)) parsedSupport = 'cantilever';
  else if (/\bfixed[\s-]?fixed\b|\bfixed\s+ends?\b|\bfixed\s+at\s+both\b/i.test(lower)) parsedSupport = 'fixed';
  const support: DesignIntent['support'] = parsedSupport || (part === 'bracket' ? 'cantilever' : 'simply-supported');
  assumed.support = !parsedSupport && part !== 'bracket';
  if (assumed.support) assumptions.push('Support assumed simply supported (pinned + roller). The text did not say how it is held.');

  const loads: DesignLoad[] = [];
  for (const fm of raw.matchAll(FORCE_RE)) {
    const forceN = forceToNewtons(Number(fm[1]), fm[2]);
    if (forceN == null || forceN === 0) continue;
    const window = raw.slice(Math.max(0, fm.index - 24), fm.index + fm[0].length + 24).toLowerCase();
    let location: DesignLoad['location'] | null = null;
    if (/\bmid[\s-]?span\b|\bcenter\b|\bcentre\b|\bmiddle\b/.test(window)) location = 'midspan';
    else if (/\bend\b|\btip\b/.test(window)) location = 'end';
    loads.push({
      location: location || (support === 'cantilever' ? 'end' : 'midspan'),
      forceN: -Math.abs(forceN),
      direction: 'Fy',
    });
  }
  if (!loads.length) {
    assumed.load = true;
    assumptions.push('Load assumed 5 kN downward (no force was given).');
  }

  const sectionInfo = deriveSection(part, meshKind, dims, spans[0]);
  assumed.section = sectionInfo.assumed;
  if (sectionInfo.note) assumptions.push(sectionInfo.note);

  const candidate = {
    part, spans, loads, material, units, meshKind, support, rawText: raw,
    section: sectionInfo.section, assumed, assumptions,
  };
  const parsed = DesignIntentSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: parsed.error.message, code: 'schema' };
  return { ok: true, intent: parsed.data };
}

type ClientMeshKind = 'i-beam' | 'box' | 'cylinder' | 'tube' | 'sphere';

/** Map intent → engineering.partMesh kind+params. A bracket's arm is a box; the L mesh is the API artifact. */
export function intentToPartMeshParams(intent: DesignIntent): {
  kind: ClientMeshKind;
  params: Record<string, number>;
} {
  const s = intent.section;
  const length = s.length || intent.spans[0] || 1;
  if (intent.part === 'bracket' || intent.meshKind === 'bracket') {
    const width = Number(s.width ?? BRACKET_DEFAULTS.width);
    const thickness = Number(s.thickness ?? BRACKET_DEFAULTS.thickness);
    return {
      kind: 'box',
      params: {
        length,
        width,
        height: thickness,
        thickness,
        legHeight: Number(s.legHeight ?? BRACKET_DEFAULTS.legHeight),
      },
    };
  }
  const clamped = Math.min(Math.max(length, 0.2), 20);
  if (intent.meshKind === 'i-beam') {
    return {
      kind: 'i-beam',
      params: {
        flangeWidth: Number(s.flangeWidth ?? I_BEAM_DEFAULTS.flangeWidth),
        height: Number(s.height ?? I_BEAM_DEFAULTS.height),
        flangeThickness: Number(s.flangeThickness ?? I_BEAM_DEFAULTS.flangeThickness),
        webThickness: Number(s.webThickness ?? I_BEAM_DEFAULTS.webThickness),
        length: clamped,
      },
    };
  }
  if (intent.meshKind === 'cylinder' || intent.meshKind === 'tube') {
    return { kind: intent.meshKind, params: { radius: Number(s.radius ?? 0.08), length: clamped } };
  }
  if (intent.meshKind === 'sphere') {
    return { kind: 'sphere', params: { radius: Number(s.radius ?? Math.min(Math.max(length / 2, 0.05), 5)) } };
  }
  return { kind: 'box', params: { width: Number(s.width ?? 0.2), height: Number(s.height ?? 0.2), length: clamped } };
}

function loadPlacement(support: DesignIntent['support'], loads: DesignLoad[]) {
  const atMid = loads.some((l) => l.location === 'midspan');
  const atEnd = loads.some((l) => l.location === 'end');
  if (support === 'cantilever') {
    if (atMid && !atEnd) return 'mid' as const;
    return 'tip' as const;
  }
  if (atEnd && !atMid) return 'tip' as const;
  return 'mid' as const;
}

/**
 * Map intent → FEA frame model. Section A/I and supports come from the parse,
 * not from a hardcoded 0.01 / 1e-5 fixed-fixed frame.
 */
export function intentToFeaModel(intent: DesignIntent): {
  nodes: Array<{ id: string; x: number; y: number; z: number }>;
  members: Array<Record<string, unknown>>;
  loads: Array<{ nodeId: string; Fy: number }>;
  supports: Array<Record<string, unknown>>;
} {
  const L = intent.spans[0] ?? intent.section.length ?? 1;
  const support = intent.support;
  const placement = loadPlacement(support, intent.loads);
  const signed = intent.loads.find((l) => (placement === 'tip' ? l.location === 'end' : l.location === 'midspan'))?.forceN
    ?? intent.loads[0]?.forceN
    ?? -DEFAULT_LOAD_N;
  const props = MATERIAL_PROPS[intent.material] || MATERIAL_PROPS.unknown;
  const n = SEGMENTS;
  const member = {
    area: intent.section.area,
    momentI: intent.section.momentI,
    Iy: Number(intent.section.Iy ?? intent.section.momentI),
    elasticModulus: props.E,
    allowableStress: props.allowable,
    depthIn: intent.section.depthIn,
  };
  const nodes = Array.from({ length: n + 1 }, (_, i) => ({ id: `N${i}`, x: round6((L * i) / n), y: 0, z: 0 }));
  const members = Array.from({ length: n }, (_, i) => ({
    id: `M${i + 1}`, nodeI: `N${i}`, nodeJ: `N${i + 1}`, ...member,
  }));
  const loadIndex = placement === 'tip' ? n : n / 2;
  let supports: Array<Record<string, unknown>>;
  if (support === 'cantilever') supports = [{ nodeId: 'N0', fixedDOF: FIXED }];
  else if (support === 'fixed') supports = [{ nodeId: 'N0', fixedDOF: FIXED }, { nodeId: `N${n}`, fixedDOF: FIXED }];
  else supports = [{ nodeId: 'N0', fixedDOF: PINNED }, { nodeId: `N${n}`, fixedDOF: ROLLER }];
  return { nodes, members, loads: [{ nodeId: `N${loadIndex}`, Fy: signed }], supports };
}
