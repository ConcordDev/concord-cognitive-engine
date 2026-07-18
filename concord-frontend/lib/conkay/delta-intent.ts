// lib/conkay/delta-intent.ts
//
// Phase S3-a (docs/CONKAY_SPATIAL_NEXT_GEN_SPEC.md) — the "Iterate" wedge, the
// smallest honest slice: map a natural-language utterance about an artifact
// into a STRUCTURED parameter delta on the macro input that produced it, so
// "make it taller" becomes a real re-run of the real macro with new dimensions
// (S3-b), not a fabricated animation.
//
// This is the DETERMINISTIC FLOOR. It recognises a documented set of explicit
// building-dimension edits (set / add / scale on width / height / depth / all)
// and returns `null` for anything it can't map — never a guessed change. That
// null IS the honesty contract (invariant #4: Iterate never fabricates
// agreement): an unparsed utterance leaves the artifact untouched and says so.
// The optional conscious-brain enhancement (S3-b) sits ON TOP of this floor and
// falls back to it; the floor alone works with no LLM.
//
// Pure + framework-free so the mapping is directly unit-testable.

export interface BuildingDimensions {
  width: number;
  height: number;
  depth: number;
}

export type DimAxis = 'width' | 'height' | 'depth' | 'all';
export type DimOp = 'set' | 'add' | 'scale';

export interface DimensionDelta {
  axis: DimAxis;
  op: DimOp;
  /** metres for set/add (add may be negative); a multiplier for scale. */
  value: number;
  /** the utterance this was parsed from, for provenance + the confirm gate. */
  rawUtterance: string;
}

// Sane clamp so a re-run can't produce a degenerate or absurd building.
export const MIN_DIM_M = 0.5;
export const MAX_DIM_M = 500;
const SCALE_UP = 1.25;
const SCALE_DOWN = 0.8;

// Axis keyword tables. `all` (bigger/smaller/size) scales every dimension.
const AXIS_WORDS: { axis: Exclude<DimAxis, 'all'>; up: string[]; down: string[]; noun: string[] }[] = [
  {
    axis: 'height',
    up: ['taller', 'higher'],
    down: ['shorter', 'lower'],
    noun: ['height', 'tall', 'high'],
  },
  {
    axis: 'width',
    up: ['wider'],
    down: ['narrower'],
    noun: ['width', 'wide'],
  },
  {
    axis: 'depth',
    up: ['deeper', 'longer'],
    down: ['shallower'],
    noun: ['depth', 'deep', 'long'],
  },
];
const ALL_UP = ['bigger', 'larger'];
const ALL_DOWN = ['smaller'];

/** First number (metres) in the text, or null. */
function extractNumber(text: string): number | null {
  const m = text.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function hasWord(text: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`\\b${w}\\b`).test(text));
}

/**
 * Parse an utterance into a building-dimension delta, or null if no explicit,
 * unambiguous dimension edit is present. Recognised shapes:
 *   set:   "make it 10m tall", "set width to 8", "height = 12"
 *   add:   "taller by 2m", "add 3 metres to the depth", "reduce height by 4"
 *   scale: "make it taller", "a bit wider", "bigger", "smaller"
 */
export function parseBuildingDimIntent(utterance: string): DimensionDelta | null {
  if (typeof utterance !== 'string') return null;
  const text = utterance.toLowerCase().trim();
  if (!text) return null;
  const raw = utterance.trim();
  const num = extractNumber(text);

  // ── Resolve axis + direction from keywords ──────────────────────────────
  let axis: DimAxis | null = null;
  let dirUp: boolean | null = null; // true=grow, false=shrink, null=neutral noun
  for (const a of AXIS_WORDS) {
    if (hasWord(text, a.up)) {
      axis = a.axis;
      dirUp = true;
      break;
    }
    if (hasWord(text, a.down)) {
      axis = a.axis;
      dirUp = false;
      break;
    }
    if (hasWord(text, a.noun)) {
      axis = a.axis;
      dirUp = null;
      break;
    }
  }
  if (!axis) {
    if (hasWord(text, ALL_UP)) {
      axis = 'all';
      dirUp = true;
    } else if (hasWord(text, ALL_DOWN)) {
      axis = 'all';
      dirUp = false;
    } else {
      // No axis keyword at all ⟹ no dimension edit to extract.
      return null;
    }
  }

  const shrink = dirUp === false;

  // ── SET: explicit target value ──────────────────────────────────────────
  // "... to N", "= N", or "N m {tall|wide|deep|...}".
  const setToTarget = /(?:to|=)\s*-?\d/.test(text);
  const setUnitNoun = /-?\d+(?:\.\d+)?\s*(?:m|meters?|metres?)?\s*(?:tall|high|wide|deep|long)\b/.test(text);
  if (num != null && (setToTarget || setUnitNoun)) {
    if (axis === 'all') return null; // "set everything to N" is ambiguous — don't guess
    return { axis, op: 'set', value: Math.abs(num), rawUtterance: raw };
  }

  // ── ADD: relative change by an amount ───────────────────────────────────
  const addKeyword = /\b(by|add|increase|reduce|decrease|extend|shrink)\b/.test(text);
  if (num != null && addKeyword) {
    const reduce = shrink || /\b(reduce|decrease|shrink)\b/.test(text);
    if (axis === 'all') return null; // ambiguous which dim
    return { axis, op: 'add', value: reduce ? -Math.abs(num) : Math.abs(num), rawUtterance: raw };
  }

  // ── SCALE: directional, no explicit amount ──────────────────────────────
  if (dirUp === true) return { axis, op: 'scale', value: SCALE_UP, rawUtterance: raw };
  if (dirUp === false) return { axis, op: 'scale', value: SCALE_DOWN, rawUtterance: raw };

  // A bare noun ("the height") with no number and no direction is not an edit.
  return null;
}

function clampDim(v: number): number {
  return Math.min(MAX_DIM_M, Math.max(MIN_DIM_M, v));
}

/**
 * Apply a parsed delta to the current dimensions, returning NEW dimensions
 * (clamped to [MIN_DIM_M, MAX_DIM_M]). Pure — the caller feeds the result back
 * into the macro input for a real re-run.
 */
export function applyDimensionDelta(
  dims: BuildingDimensions,
  delta: DimensionDelta,
): BuildingDimensions {
  const next: BuildingDimensions = { ...dims };
  const axes: Exclude<DimAxis, 'all'>[] =
    delta.axis === 'all' ? ['width', 'height', 'depth'] : [delta.axis];
  for (const ax of axes) {
    const cur = dims[ax];
    let v = cur;
    if (delta.op === 'set') v = delta.value;
    else if (delta.op === 'add') v = cur + delta.value;
    else if (delta.op === 'scale') v = cur * delta.value;
    next[ax] = clampDim(v);
  }
  return next;
}

/** Human-readable summary of a delta for the confirm gate ("apply this?"). */
export function describeDelta(delta: DimensionDelta): string {
  const axis = delta.axis === 'all' ? 'size' : delta.axis;
  if (delta.op === 'set') return `set ${axis} to ${delta.value} m`;
  if (delta.op === 'add') {
    const sign = delta.value >= 0 ? '+' : '−';
    return `${sign}${Math.abs(delta.value)} m ${axis}`;
  }
  const pct = Math.round((delta.value - 1) * 100);
  return `${pct >= 0 ? 'grow' : 'shrink'} ${axis} ${Math.abs(pct)}%`;
}
