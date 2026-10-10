// server/lib/conkay/nlp-design-intent.js
// Deterministic free-text → design intent (mirror of frontend nlp-design-intent.ts).
// Fail closed. No LLM.
//
// A bracket is a cantilever rectangular plate (the horizontal arm) plus a
// vertical leg that is mesh geometry only. Stress, deflection and utilization
// come from the beam-frame solver, checked against Mc/I and PL^3/(3EI).
// Masses (kg, lb, t) become newtons at g = 9.80665. Anything not in the text
// is flagged on `assumed` so a UI can say "assumed" instead of presenting a
// default as the user's number.

import { sectionProperties } from "../compute/engineering-compute.js";
import { runFEA } from "../simulation/fea-solver.js";

/**
 * @typedef {{ location: 'midspan'|'end'|number, forceN: number, direction?: string }} DesignLoad
 * @typedef {{ load: boolean, span: boolean, section: boolean, material: boolean, support: boolean }} AssumedFlags
 * @typedef {{
 *   part: string, spans: number[], loads: DesignLoad[], material: string,
 *   units: string, meshKind: string, support: string, rawText: string,
 *   section: object, assumed: AssumedFlags, assumptions: string[]
 * }} DesignIntent
 */

export const G_N_PER_KG = 9.80665;
export const DEFAULT_LOAD_N = 5000;
export const SUPPORTED_PARTS = Object.freeze([
  "i-beam", "beam", "box", "cylinder", "tube", "sphere", "bracket",
]);

const BRACKET_DEFAULTS = Object.freeze({ length: 0.12, width: 0.08, thickness: 0.008, legHeight: 0.08 });
const I_BEAM_DEFAULTS = Object.freeze({
  flangeWidth: 0.1, height: 0.2, flangeThickness: 0.012, webThickness: 0.008,
});
const SEGMENTS = 8;

const PART_ALIASES = [
  { re: /\bl[\s-]?bracket\b|\bangle\s+bracket\b|\bbracket\b|\bcantilever\s+plate\b/i, part: "bracket", meshKind: "bracket" },
  { re: /\bi[\s-]?beam\b|\bi[\s-]?section\b/i, part: "i-beam", meshKind: "i-beam" },
  { re: /\bw[\s-]?beam\b|\bwide[\s-]?flange\b/i, part: "i-beam", meshKind: "i-beam" },
  { re: /\bcylinder\b|\bpipe\b/i, part: "cylinder", meshKind: "cylinder" },
  { re: /\btube\b|\bhollow\s+section\b/i, part: "tube", meshKind: "tube" },
  { re: /\bsphere\b|\bball\b/i, part: "sphere", meshKind: "sphere" },
  { re: /\bbox\b|\brectangular\b|\bprism\b/i, part: "box", meshKind: "box" },
  { re: /\bbeam\b/i, part: "beam", meshKind: "i-beam" },
];

const MATERIAL_RE = [
  { re: /\bsteel\b|\ba36\b|\ba992\b/i, material: "steel" },
  { re: /\balumin?i?um\b/i, material: "aluminum" },
  { re: /\bconcrete\b|\brc\b/i, material: "concrete" },
  { re: /\bwood\b|\btimber\b/i, material: "wood" },
];

const MATERIAL_PROPS = {
  steel: { E: 200e9, allowable: 250e6, id: "steel-a36" },
  aluminum: { E: 68.9e9, allowable: 276e6, id: "aluminum-6061-t6" },
  wood: { E: 1.2e10, allowable: 40e6, id: null },
  concrete: { E: 30e9, allowable: 30e6, id: "concrete-30mpa" },
  unknown: { E: 200e9, allowable: 250e6, id: "steel-a36" },
};

const LENGTH_RE = /(\d+(?:\.\d+)?)\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|metres?|meters?|ft|feet|foot)\b/gi;
const FORCE_RE = /(-?\d+(?:\.\d+)?)\s*(kN|MN|kips|kip|lbf|lbs|lb|pounds?|tonnes?|tons?|kg|N|t)\b/gi;

const PINNED = ["x", "y", "z", "rx", "ry"];
const ROLLER = ["y", "z", "rx", "ry"];
const FIXED = ["x", "y", "z", "rx", "ry", "rz"];

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function toMeters(value, unit) {
  const u = String(unit || "m").toLowerCase();
  if (u === "mm" || u.startsWith("millimet")) return { meters: value / 1000, units: "mm" };
  if (u === "cm" || u.startsWith("centimet")) return { meters: value / 100, units: "mm" };
  if (u === "ft" || u.startsWith("foot") || u.startsWith("feet")) return { meters: value * 0.3048, units: "ft" };
  return { meters: value, units: "m" };
}

/** Masses become weight. kip/kN/N stay forces. lb is weight (lbf). */
export function forceToNewtons(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const u = String(unit || "n").toLowerCase();
  if (u === "kn") return n * 1000;
  if (u === "mn") return n * 1e6;
  if (u.startsWith("kip")) return n * 4448.2216;
  if (u === "lbf" || u === "lb" || u === "lbs" || u.startsWith("pound")) return n * 0.45359237 * G_N_PER_KG;
  if (u === "kg") return n * G_N_PER_KG;
  if (u === "t" || u.startsWith("ton")) return n * 1000 * G_N_PER_KG;
  return n;
}

function lengthLabel(raw, index, matchLen) {
  const before = raw.slice(Math.max(0, index - 32), index).toLowerCase();
  const after = raw.slice(index + matchLen, index + matchLen + 18).toLowerCase();
  if (/flange\s+thickness|t_?f\b/.test(before)) return "flangeThickness";
  if (/web\s+thickness|t_?w\b/.test(before)) return "webThickness";
  if (/flange\s+width|b_?f\b/.test(before)) return "flangeWidth";
  if (/\b(diameter|dia)\b/.test(before)) return "diameter";
  if (/\b(radius|rad)\b/.test(before)) return "radius";
  if (/\b(thickness|thick)\b/.test(before) || /^\s*(thick|thickness)\b/.test(after)) return "thickness";
  if (/\b(width|wide)\b/.test(before) || /^\s*(wide|width)\b/.test(after)) return "width";
  if (/\bleg\b/.test(before)) return "legHeight";
  if (/\b(depth|height|deep|tall)\b/.test(before) || /^\s*(deep|tall)\b/.test(after)) return "height";
  if (/\b(arm|span|length|long)\b/.test(before) || /^\s*(span|long|length)\b/.test(after)) return "span";
  return null;
}

function materialProps(material) {
  return MATERIAL_PROPS[material] || MATERIAL_PROPS.unknown;
}

function resolveSupport(part, parsed) {
  if (parsed) return { support: parsed, assumed: false, source: "text" };
  if (part === "bracket") return { support: "cantilever", assumed: false, source: "part" };
  return { support: "simply-supported", assumed: true, source: "default" };
}

function deriveSection(part, meshKind, dims, span) {
  const notes = [];
  const take = (key, fallback, label) => {
    if (dims[key] != null) return dims[key];
    notes.push(label);
    return fallback;
  };
  if (part === "bracket") {
    const width = take("width", BRACKET_DEFAULTS.width, "width 80 mm");
    const thickness = take("thickness", BRACKET_DEFAULTS.thickness, "thickness 8 mm");
    const legHeight = take("legHeight", BRACKET_DEFAULTS.legHeight, "leg height 80 mm");
    const sec = sectionProperties("box", { width, height: thickness });
    return {
      assumed: notes.length > 0,
      note: notes.length ? `Section assumed: ${notes.join(", ")}.` : null,
      section: {
        kind: "plate", width, thickness, legHeight, length: span,
        area: sec.area, momentI: sec.Ix, Iy: sec.Iy, depthIn: thickness,
      },
    };
  }
  if (meshKind === "i-beam") {
    const flangeWidth = take("flangeWidth", I_BEAM_DEFAULTS.flangeWidth, "flange width 100 mm");
    const height = take("height", I_BEAM_DEFAULTS.height, "depth 200 mm");
    const flangeThickness = take("flangeThickness", I_BEAM_DEFAULTS.flangeThickness, "flange thickness 12 mm");
    const webThickness = take("webThickness", I_BEAM_DEFAULTS.webThickness, "web thickness 8 mm");
    const sec = sectionProperties("i-beam", { flangeWidth, height, flangeThickness, webThickness });
    return {
      assumed: notes.length > 0,
      note: notes.length ? `Section assumed: ${notes.join(", ")}.` : null,
      section: {
        kind: "i-beam", flangeWidth, height, flangeThickness, webThickness, length: span,
        area: sec.area, momentI: sec.Ix, Iy: sec.Iy, depthIn: height,
      },
    };
  }
  if (meshKind === "cylinder" || meshKind === "sphere") {
    const radius = take("radius", meshKind === "sphere" ? Math.min(Math.max(span / 2, 0.05), 5) : 0.08, meshKind === "sphere" ? `radius ${round6(span / 2)} m screened as a solid bar` : "radius 80 mm");
    const sec = sectionProperties("cylinder", { radius });
    const noteExtra = meshKind === "sphere" ? " Sphere is screened as a solid round bar, not a shell." : "";
    const assumedSection = meshKind === "sphere" || notes.length > 0;
    return {
      assumed: assumedSection,
      note: assumedSection ? `Section assumed: ${notes.join(", ") || "solid bar"}.${noteExtra}` : null,
      section: {
        kind: "cylinder", radius, length: meshKind === "sphere" ? radius * 2 : span,
        area: sec.area, momentI: sec.Ix, Iy: sec.Iy, depthIn: radius * 2,
      },
    };
  }
  if (meshKind === "tube") {
    const radius = take("radius", 0.08, "outer radius 80 mm");
    const innerRadius = take("innerRadius", Math.min(0.06, radius * 0.75), "inner radius 60 mm");
    const sec = sectionProperties("tube", { radius, innerRadius });
    return {
      assumed: notes.length > 0,
      note: notes.length ? `Section assumed: ${notes.join(", ")}.` : null,
      section: {
        kind: "tube", radius, innerRadius, length: span,
        area: sec.area, momentI: sec.Ix, Iy: sec.Iy, depthIn: radius * 2,
      },
    };
  }
  const width = take("width", 0.2, "width 200 mm");
  const height = take("height", 0.2, "height 200 mm");
  const sec = sectionProperties("box", { width, height });
  return {
    assumed: notes.length > 0,
    note: notes.length ? `Section assumed: ${notes.join(", ")}.` : null,
    section: {
      kind: "box", width, height, length: span,
      area: sec.area, momentI: sec.Ix, Iy: sec.Iy, depthIn: height,
    },
  };
}

export function parseDesignIntent(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "empty design text", code: "empty" };
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
      error: `unsupported part — recognised parts: ${SUPPORTED_PARTS.join(", ")}`,
      code: "unsupported_part",
      supportedParts: [...SUPPORTED_PARTS],
    };
  }

  const dims = {};
  const spans = [];
  let units = "m";
  for (const sm of raw.matchAll(LENGTH_RE)) {
    const { meters, units: u } = toMeters(Number(sm[1]), sm[2]);
    if (!(meters > 0 && meters < 500)) continue;
    const label = lengthLabel(raw, sm.index, sm[0].length);
    const v = round6(meters);
    if (label === "span") {
      spans.push(v);
      units = u;
    } else if (label === "diameter") {
      dims.radius = round6(v / 2);
    } else if (label && label !== "span") {
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

  const assumptions = [];
  const assumed = { load: false, span: false, section: false, material: false, support: false };

  if (!spans.length) {
    if (part !== "bracket") {
      return { ok: false, error: 'no span/length found (e.g. "6m")', code: "no_span" };
    }
    spans.push(BRACKET_DEFAULTS.length);
    assumed.span = true;
    assumptions.push("Span assumed 0.12 m (no length was given).");
  }

  let material = "unknown";
  for (const m of MATERIAL_RE) {
    if (m.re.test(lower)) {
      material = m.material;
      break;
    }
  }
  if (material === "unknown") {
    assumed.material = true;
    assumptions.push("Material assumed ASTM A36 steel.");
  } else if (material === "wood") {
    assumptions.push("Wood allowable stress assumed 40 MPa (no grade was given).");
  } else if (material === "concrete") {
    assumptions.push("Concrete allowable stress assumed 30 MPa (screening, no mix was given).");
  }

  let parsedSupport;
  if (/\bsimply[\s-]?supported\b|\bss\b|\bsimple\s+support/i.test(lower)) parsedSupport = "simply-supported";
  else if (/\bcantilever\b/i.test(lower) && part !== "bracket") parsedSupport = "cantilever";
  else if (/\bcantilever\b/i.test(lower)) parsedSupport = "cantilever";
  else if (/\bfixed[\s-]?fixed\b|\bfixed\s+ends?\b|\bfixed\s+at\s+both\b/i.test(lower)) parsedSupport = "fixed";
  const supportInfo = resolveSupport(part, parsedSupport);
  assumed.support = supportInfo.assumed;
  if (supportInfo.assumed) {
    assumptions.push("Support assumed simply supported (pinned + roller). The text did not say how it is held.");
  }

  const loads = [];
  for (const fm of raw.matchAll(FORCE_RE)) {
    const forceN = forceToNewtons(fm[1], fm[2]);
    if (forceN == null || forceN === 0) continue;
    const window = raw.slice(Math.max(0, fm.index - 24), fm.index + fm[0].length + 24).toLowerCase();
    let location = null;
    if (/\bmid[\s-]?span\b|\bcenter\b|\bcentre\b|\bmiddle\b/.test(window)) location = "midspan";
    else if (/\bend\b|\btip\b/.test(window)) location = "end";
    loads.push({
      location: location || (supportInfo.support === "cantilever" ? "end" : "midspan"),
      forceN: -Math.abs(forceN),
      direction: "Fy",
    });
  }
  if (!loads.length) {
    assumed.load = true;
    assumptions.push("Load assumed 5 kN downward (no force was given).");
  }

  const sectionInfo = deriveSection(part, meshKind, dims, spans[0]);
  assumed.section = sectionInfo.assumed;
  if (sectionInfo.note) assumptions.push(sectionInfo.note);

  return {
    ok: true,
    intent: {
      part, spans, loads, material, units, meshKind,
      support: supportInfo.support,
      rawText: raw,
      section: sectionInfo.section,
      assumed,
      assumptions,
    },
  };
}

export function intentToPartMeshParams(intent) {
  const s = intent.section || {};
  const length = s.length || intent.spans?.[0] || 1;
  if (intent.part === "bracket" || intent.meshKind === "bracket") {
    return {
      kind: "bracket",
      params: {
        length,
        width: s.width ?? BRACKET_DEFAULTS.width,
        thickness: s.thickness ?? BRACKET_DEFAULTS.thickness,
        legHeight: s.legHeight ?? BRACKET_DEFAULTS.legHeight,
      },
    };
  }
  const clamped = Math.min(Math.max(length, 0.2), 20);
  if (intent.meshKind === "i-beam") {
    return {
      kind: "i-beam",
      params: {
        flangeWidth: s.flangeWidth ?? I_BEAM_DEFAULTS.flangeWidth,
        height: s.height ?? I_BEAM_DEFAULTS.height,
        flangeThickness: s.flangeThickness ?? I_BEAM_DEFAULTS.flangeThickness,
        webThickness: s.webThickness ?? I_BEAM_DEFAULTS.webThickness,
        length: clamped,
      },
    };
  }
  if (intent.meshKind === "cylinder" || intent.meshKind === "tube") {
    return { kind: intent.meshKind, params: { radius: s.radius ?? 0.08, length: clamped } };
  }
  if (intent.meshKind === "sphere") {
    return { kind: "sphere", params: { radius: s.radius ?? Math.min(Math.max(length / 2, 0.05), 5) } };
  }
  return {
    kind: "box",
    params: { width: s.width ?? 0.2, height: s.height ?? 0.2, length: clamped },
  };
}

function loadPlacement(support, loads) {
  const atMid = (loads || []).some((l) => l.location === "midspan");
  const atEnd = (loads || []).some((l) => l.location === "end");
  if (support === "cantilever") {
    if (atMid && !atEnd) return { at: "mid", formula: "cantilever-mid" };
    return { at: "tip", formula: "cantilever-tip" };
  }
  if (atEnd && !atMid) return { at: "tip", formula: "end" };
  return { at: "mid", formula: support === "fixed" ? "fixed-mid" : "simple-mid" };
}

/**
 * Beam-frame model. Section A/I come from the parsed (or flagged-default)
 * geometry. Supports follow the parsed condition: pinned+roller, cantilever
 * root, or fixed-fixed. Eight segments so a node sits on the load.
 */
export function intentToFeaModel(intent) {
  const L = intent.spans?.[0] ?? intent.section?.length ?? 1;
  const support = intent.support || (intent.part === "bracket" ? "cantilever" : "simply-supported");
  const placement = loadPlacement(support, intent.loads);
  const signed = intent.loads?.find((l) => (placement.at === "tip" ? l.location === "end" : l.location === "midspan"))?.forceN
    ?? intent.loads?.[0]?.forceN
    ?? -DEFAULT_LOAD_N;
  const props = materialProps(intent.material);
  const sec = intent.section || {};
  const area = sec.area;
  const momentI = sec.momentI;
  const Iy = sec.Iy ?? momentI;
  const depthIn = sec.depthIn;
  const n = SEGMENTS;
  const nodes = Array.from({ length: n + 1 }, (_, i) => ({
    id: `N${i}`, x: round6((L * i) / n), y: 0, z: 0,
  }));
  const member = {
    area, momentI, Iy, elasticModulus: props.E, allowableStress: props.allowable, depthIn,
  };
  const members = Array.from({ length: n }, (_, i) => ({
    id: `M${i + 1}`, nodeI: `N${i}`, nodeJ: `N${i + 1}`, ...member,
  }));
  const loadIndex = placement.at === "tip" ? n : n / 2;
  let supports;
  if (support === "cantilever") supports = [{ nodeId: "N0", fixedDOF: FIXED }];
  else if (support === "fixed") supports = [{ nodeId: "N0", fixedDOF: FIXED }, { nodeId: `N${n}`, fixedDOF: FIXED }];
  else supports = [{ nodeId: "N0", fixedDOF: PINNED }, { nodeId: `N${n}`, fixedDOF: ROLLER }];
  return {
    nodes,
    members,
    loads: [{ nodeId: `N${loadIndex}`, Fy: signed }],
    supports,
    placement: placement.formula,
  };
}

/** Closed-form check for the three textbook cases. Other placements are FEA-only. */
export function screeningHand(intent) {
  const L = intent.spans?.[0] ?? 1;
  const P = Math.abs(intent.loads?.[0]?.forceN ?? DEFAULT_LOAD_N);
  const support = intent.support || "simply-supported";
  const placement = loadPlacement(support, intent.loads);
  const I = intent.section?.momentI;
  const c = (intent.section?.depthIn || 0) / 2;
  const props = materialProps(intent.material);
  const applicable = placement.formula === "cantilever-tip" || placement.formula === "fixed-mid" || placement.formula === "simple-mid";
  let M = null;
  let deflection = null;
  if (placement.formula === "cantilever-tip") {
    M = P * L;
    deflection = (P * L ** 3) / (3 * props.E * I);
  } else if (placement.formula === "fixed-mid") {
    M = (P * L) / 8;
    deflection = (P * L ** 3) / (192 * props.E * I);
  } else if (placement.formula === "simple-mid") {
    M = (P * L) / 4;
    deflection = (P * L ** 3) / (48 * props.E * I);
  }
  const stress = applicable ? (M * c) / I : null;
  const utilization = applicable ? stress / props.allowable : null;
  return {
    applicable,
    formula: placement.formula,
    loadN: P,
    maxStressPa: stress,
    maxDeflectionM: deflection,
    utilization,
    allowablePa: props.allowable,
    elasticModulusPa: props.E,
    allPass: applicable ? utilization <= 1 : null,
    area: intent.section?.area ?? null,
    momentI: I ?? null,
  };
}

/** Parse, mesh, FEA and hand check in one pass. */
export function solveDesignText(text) {
  const parsed = parseDesignIntent(text);
  if (!parsed.ok) return parsed;
  const intent = parsed.intent;
  const meshSpec = intentToPartMeshParams(intent);
  const mesh = buildPartMesh(meshSpec.kind, meshSpec.params);
  const model = intentToFeaModel(intent);
  const hand = screeningHand(intent);
  let feaReport;
  try {
    const result = runFEA(model);
    if (!result || result.ok === false) {
      feaReport = { ok: false, error: result?.error || "runFEA failed" };
    } else {
      const maxStressPa = Math.max(...result.stresses.map((s) => s.combinedStress));
      const maxDeflectionM = Math.max(...result.displacements.map((d) => d.magnitude));
      const maxUtilization = Number(result.summary?.maxUtilization);
      feaReport = {
        ok: true,
        maxUtilization: Number.isFinite(maxUtilization) ? maxUtilization : null,
        maxStressPa,
        maxDeflectionM,
        allPass: result.summary?.allPass === true,
        summary: result.summary ?? null,
        jobId: result.jobId ?? null,
      };
    }
  } catch (e) {
    feaReport = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, intent, mesh, model, hand, fea: feaReport };
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
  const pushBox = (x0, x1, y0, y1, z0, z1) => {
    const v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    pushQuad(v[0], v[1], v[2], v[3]);
    pushQuad(v[5], v[4], v[7], v[6]);
    pushQuad(v[4], v[0], v[3], v[7]);
    pushQuad(v[1], v[5], v[6], v[2]);
    pushQuad(v[3], v[2], v[6], v[7]);
    pushQuad(v[4], v[5], v[1], v[0]);
  };
  const k = kind || "box";
  if (k === "cylinder" || k === "tube") {
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
  } else if (k === "bracket") {
    const L = params.length || BRACKET_DEFAULTS.length;
    const w = params.width || BRACKET_DEFAULTS.width;
    const t = params.thickness || BRACKET_DEFAULTS.thickness;
    const leg = params.legHeight || BRACKET_DEFAULTS.legHeight;
    pushBox(0, L, 0, t, -w / 2, w / 2);
    pushBox(0, t, 0, leg, -w / 2, w / 2);
  } else if (k === "i-beam") {
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
  if (!Number.isFinite(u)) return "low";
  if (u > 1) return "overstressed";
  if (u > 0.75) return "high";
  if (u > 0.4) return "moderate";
  return "low";
}

const BAND_COLORS = {
  low: { hex: "#22c55e", rgba: { r: 0.133, g: 0.773, b: 0.369, a: 1 } },
  moderate: { hex: "#eab308", rgba: { r: 0.918, g: 0.702, b: 0.031, a: 1 } },
  high: { hex: "#f97316", rgba: { r: 0.976, g: 0.451, b: 0.086, a: 1 } },
  overstressed: { hex: "#ef4444", rgba: { r: 0.937, g: 0.267, b: 0.267, a: 1 } },
};

export function feaUtilToColor(utilization) {
  const band = utilizationBand(utilization);
  const c = BAND_COLORS[band];
  return { band, hex: c.hex, rgba: { ...c.rgba } };
}
