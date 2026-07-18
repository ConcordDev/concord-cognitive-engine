// lib/conkay/fea-iterate.ts
//
// Phase S3-c — the FEA re-solve showcase (the demo money shot): say "make the
// columns thicker" → the REAL direct-stiffness solver re-runs → the frame
// recolors by utilization, red→green, in place.
//
// Honest asymmetry vs. the building Iterate loop (S3-b): a building's geometry
// is a pure function of its input, so it re-derives client-side, instantly. A
// frame's UTILIZATION is not — it's the output of the solver. So this loop does
// NOT predict the new colors; it transforms the model, re-runs the real
// engineering.runFEA macro (non-mutating deterministic compute), and shows the
// solver's actual new result. The recolor is `stressToColor(member.utilization)`
// applied to a real re-solve — a pure function of a real backend event, nothing
// faked (invariants #1, #5 "compute-don't-guess").
//
// This module is the pure, unit-tested spine: parse an utterance into a model
// transform, apply it, and package the new macro input. Running the macro +
// swapping the artifact is the async UI shell (FeaIterateBar), a thin layer over
// these + `lensRun('engineering','runFEA', …)`.

/** The FEA model the solver consumes (mirrors runFEA's `model = data.model || data`). */
export interface FeaModel {
  nodes: Record<string, unknown>[];
  members: Record<string, unknown>[];
  loads: Record<string, unknown>[];
  supports: Record<string, unknown>[];
  [k: string]: unknown;
}

export type FeaTarget = 'section' | 'load';

export interface FeaDelta {
  /** `section` scales member area+momentI (stiffness); `load` scales applied forces. */
  target: FeaTarget;
  /** Multiplier applied to the target quantity. >1 strengthens/loads-up, <1 the reverse. */
  factor: number;
  /** Grow vs shrink, for the human summary. */
  direction: 'up' | 'down';
  rawUtterance: string;
}

// Default factors chosen to produce a VISIBLE utilization shift (enough to move
// a member across a color band) when no explicit magnitude is given.
const DEFAULTS: Record<string, number> = {
  'section:up': 1.6,
  'section:down': 0.6,
  'load:up': 1.5,
  'load:down': 0.6,
};

const SECTION_UP = ['thicker', 'stronger', 'stiffer', 'beef', 'reinforce', 'reinforced', 'heftier', 'sturdier'];
const SECTION_DOWN = ['thinner', 'slimmer', 'lighter section', 'smaller section', 'trim the section'];
const LOAD_UP = ['heavier', 'more load', 'add load', 'increase the load', 'increase load', 'more weight', 'heavier load'];
const LOAD_DOWN = ['less load', 'lighter load', 'reduce the load', 'reduce load', 'lighten the load', 'less weight'];

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

// A magnitude with INHERENT direction (double up, half down), usable even
// without a direction keyword ("double the load"). Percent is NOT here — "the
// load 30%" is directionally ambiguous, so it only resolves via a direction word.
function inherentFactor(text: string): number | null {
  if (/\b(double|twice|2x|2 times)\b/.test(text)) return 2;
  if (/\b(triple|3x|3 times)\b/.test(text)) return 3;
  if (/\b(half|halve|halved)\b/.test(text)) return 0.5;
  const times = text.match(/(\d+(?:\.\d+)?)\s*(?:x|times)\b/);
  if (times) return Number(times[1]);
  return null;
}

/** Explicit magnitude given a KNOWN direction (adds percent to the inherent set). */
function explicitFactor(text: string, direction: 'up' | 'down'): number | null {
  const inh = inherentFactor(text);
  if (inh != null) return inh;
  const pct = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/);
  if (pct) {
    const p = Number(pct[1]) / 100;
    return direction === 'up' ? 1 + p : Math.max(0.05, 1 - p);
  }
  return null;
}

// Bare target nouns — resolve a target when no up/down keyword is present, but
// only alongside an inherent-direction magnitude.
const SECTION_NOUNS = ['member', 'members', 'section', 'sections', 'column', 'columns', 'beam', 'beams', 'strut', 'struts'];
const LOAD_NOUNS = ['load', 'loads', 'weight'];

/**
 * Parse an utterance into an FEA model delta, or null if it names no explicit
 * strengthen/weaken or load change. Null is the honest STOP-POINT — never a
 * guessed edit (invariant #4).
 */
export function parseFeaIntent(utterance: string): FeaDelta | null {
  if (typeof utterance !== 'string') return null;
  const text = utterance.toLowerCase().trim();
  if (!text) return null;
  const raw = utterance.trim();

  // 1) Strong signal: an up/down keyword fixes both target and direction.
  let target: FeaTarget | null = null;
  let direction: 'up' | 'down' | null = null;
  if (hasAny(text, SECTION_UP)) { target = 'section'; direction = 'up'; }
  else if (hasAny(text, SECTION_DOWN)) { target = 'section'; direction = 'down'; }
  else if (hasAny(text, LOAD_UP)) { target = 'load'; direction = 'up'; }
  else if (hasAny(text, LOAD_DOWN)) { target = 'load'; direction = 'down'; }

  if (target && direction) {
    const factor = explicitFactor(text, direction) ?? DEFAULTS[`${target}:${direction}`];
    return { target, factor, direction, rawUtterance: raw };
  }

  // 2) Weaker signal: a bare target noun ("the load", "the members") resolves
  //    ONLY with an inherent-direction magnitude ("double", "half", "2x").
  //    A noun with no such magnitude is directionally ambiguous ⟹ null.
  const nounTarget: FeaTarget | null = hasAny(text, LOAD_NOUNS)
    ? 'load'
    : hasAny(text, SECTION_NOUNS)
      ? 'section'
      : null;
  const inh = inherentFactor(text);
  if (nounTarget && inh != null) {
    return { target: nounTarget, factor: inh, direction: inh >= 1 ? 'up' : 'down', rawUtterance: raw };
  }
  return null;
}

/** Safely pull the solver model out of a macro input (`input.model || input`). */
export function feaModelFromInput(sourceInput: unknown): FeaModel | null {
  if (!sourceInput || typeof sourceInput !== 'object') return null;
  const inObj = sourceInput as Record<string, unknown>;
  const raw = (inObj.model && typeof inObj.model === 'object' ? inObj.model : inObj) as Record<string, unknown>;
  const nodes = Array.isArray(raw.nodes) ? (raw.nodes as Record<string, unknown>[]) : [];
  const members = Array.isArray(raw.members) ? (raw.members as Record<string, unknown>[]) : [];
  if (nodes.length === 0 || members.length === 0) return null;
  return {
    ...raw,
    nodes,
    members,
    loads: Array.isArray(raw.loads) ? (raw.loads as Record<string, unknown>[]) : [],
    supports: Array.isArray(raw.supports) ? (raw.supports as Record<string, unknown>[]) : [],
  };
}

function scaleField(v: unknown, f: number): unknown {
  return typeof v === 'number' && Number.isFinite(v) ? v * f : v;
}

/**
 * Apply the delta to a model, returning a NEW model (originals untouched).
 * `section` scales each member's area + momentI (governs axial + bending
 * stress → utilization); `load` scales each load's Fx/Fy/Fz. Fields that are
 * absent are left absent (nothing invented).
 */
export function applyFeaModelDelta(model: FeaModel, delta: FeaDelta): FeaModel {
  if (delta.target === 'section') {
    const members = model.members.map((m) => ({
      ...m,
      area: scaleField(m.area, delta.factor),
      momentI: scaleField(m.momentI, delta.factor),
    }));
    return { ...model, members };
  }
  const loads = model.loads.map((l) => ({
    ...l,
    Fx: scaleField(l.Fx, delta.factor),
    Fy: scaleField(l.Fy, delta.factor),
    Fz: scaleField(l.Fz, delta.factor),
  }));
  return { ...model, loads };
}

export interface FeaProposal {
  ok: true;
  delta: FeaDelta;
  /** The new macro input to re-run — canonical `{ model }` form. */
  newInput: { model: FeaModel };
  summary: string;
}
export interface FeaRejection {
  ok: false;
  reason: 'no_intent' | 'no_model';
  message: string;
}

/** Human summary for the confirm gate — states the INTENT (the solver decides the result). */
export function describeFeaDelta(delta: FeaDelta): string {
  const pct = Math.round(Math.abs(delta.factor - 1) * 100);
  if (delta.target === 'section') {
    return delta.direction === 'up'
      ? `thicken all members ${pct}% (more area + stiffness)`
      : `slim all members ${pct}%`;
  }
  return delta.direction === 'up' ? `increase all loads ${pct}%` : `reduce all loads ${pct}%`;
}

/**
 * Turn an utterance into a reviewable FEA re-solve, or an honest rejection.
 * Does NOT predict the new utilization — that's the solver's job on re-run.
 */
export function proposeFeaIteration(sourceInput: unknown, utterance: string): FeaProposal | FeaRejection {
  const delta = parseFeaIntent(utterance);
  if (!delta) {
    return {
      ok: false,
      reason: 'no_intent',
      message: "I didn't catch a change to run — try “make the members thicker”, “reduce the load 30%”, or “double the load”.",
    };
  }
  const model = feaModelFromInput(sourceInput);
  if (!model) {
    return { ok: false, reason: 'no_model', message: 'This analysis has no editable model to re-solve.' };
  }
  const newModel = applyFeaModelDelta(model, delta);
  return { ok: true, delta, newInput: { model: newModel }, summary: describeFeaDelta(delta) };
}
