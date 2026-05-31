// concord-frontend/lib/world-lens/appearance-parse.ts
//
// Wave 5a — NPC appearance fidelity: parse authored appearance into a
// RichAppearanceConfig patch.
//
// The 128 hand-authored NPCs carry an `appearance` field in two shapes:
//   • prose  (~40%)  — "a scarred, broad-shouldered warlord with one milky
//                       eye, silver hair shorn close, and a chrome left arm"
//   • structured (~60%) — { build, skin, hair, eyes, outfit, tells, weapon,
//                       teeth, age, ... }
//
// `appearance.for_world` / `for_npc` already SHIP this text to the client as
// `appearanceText`, and `character-schema.ts#generateAppearance` already
// RECEIVES it as `npcAppearanceText` — then silently drops it (the param was
// never destructured). This module is the parser that closes that drop.
//
// Design: this module returns palette KEYS + appendable arrays (never resolved
// hex). The generator owns hex resolution — which keeps this file's import of
// character-schema TYPE-ONLY (erased at runtime), so there is NO import cycle
// with character-schema.ts (which imports parseAuthoredAppearance as a value).
//
// Hard contract: PURE, DETERMINISTIC, TOTAL. Never throws; an unknown token is
// simply omitted (→ the generator falls back to its hash seed). An un-authored
// NPC (empty text) yields an empty patch → byte-identical to today.

import type {
  FacialFeatures,
  Accessories,
  BodyArchetype,
  HeritageMarker,
  HairColorKey,
  EyeColorKey,
  HairStyle,
} from './character-schema';

/**
 * A mergeable patch of palette KEYS + appendable arrays. The generator
 * interleaves each scalar as `patch.x ?? hashSeeded` and APPENDS the arrays
 * (scars/markings/augments/carry).
 */
export interface AuthoredAppearancePatch {
  bodyArchetype?: BodyArchetype;
  heritage?: HeritageMarker;
  hairColorKey?: HairColorKey;
  hairStyle?: HairStyle;
  eyeColorKey?: EyeColorKey;
  facialPatch?: Partial<Pick<FacialFeatures, 'age' | 'weathering' | 'jawShape' | 'noseShape'>>;
  scars?: FacialFeatures['scars'];
  markings?: Accessories['markings'];
  augments?: NonNullable<Accessories['augments']>;
  carry?: NonNullable<Accessories['carry']>;
  /** True when an "emissive/glow" tell was detected (glowing eyes/markings). */
  glow?: boolean;
}

/* ── keyword → enum maps (lowercased, word-boundary matched) ──────────── */

const BUILD_WORDS: Record<string, BodyArchetype> = {
  slim: 'slim', lean: 'slim', lanky: 'slim', wiry: 'slim', slender: 'slim', thin: 'slim',
  average: 'average', medium: 'average', ordinary: 'average',
  stocky: 'stocky', burly: 'stocky', barrel: 'stocky', squat: 'stocky', thickset: 'stocky',
  tall: 'tall', towering: 'tall', lofty: 'tall',
  broad: 'broad', muscular: 'broad', athletic: 'broad', powerful: 'broad',
  'broad-shouldered': 'broad', brawny: 'broad', hulking: 'broad',
  petite: 'petite', small: 'petite', diminutive: 'petite', slight: 'petite',
  legendary: 'legend', heroic: 'legend', imposing: 'legend', statuesque: 'legend',
};

const SKIN_WORDS: Record<string, HeritageMarker> = {
  pale: 'pale', pallid: 'pale', porcelain: 'pale', ashen: 'pale', fair: 'fair', light: 'fair',
  olive: 'olive', tan: 'tan', tanned: 'tan', bronze: 'tan', bronzed: 'tan', sun: 'tan',
  brown: 'brown', dark: 'dark-brown', ebony: 'dark-brown', deep: 'dark-brown', black: 'dark-brown',
};

const HAIR_COLOR_WORDS: Record<string, HairColorKey> = {
  black: 'black', raven: 'black', jet: 'black',
  'dark brown': 'dark_brown', brunette: 'dark_brown',
  brown: 'brown', chestnut: 'brown',
  'light brown': 'light_brown', sandy: 'light_brown',
  blonde: 'blonde', blond: 'blonde', golden: 'blonde', fair: 'light_blonde',
  red: 'red', ginger: 'red', copper: 'red', auburn: 'red',
  silver: 'silver', grey: 'silver', gray: 'silver', white: 'silver', platinum: 'silver',
  magenta: 'cyber_magenta', pink: 'cyber_magenta',
  cyan: 'cyber_cyan', teal: 'cyber_cyan',
  violet: 'drift_violet', purple: 'drift_violet',
  crimson: 'bloodline_red',
};

const HAIR_STYLE_WORDS: Record<string, HairStyle> = {
  bald: 'bald', shaved: 'shaved', shorn: 'shaved', stubble: 'shaved', buzzed: 'shaved',
  short: 'short', cropped: 'short', close: 'short',
  medium: 'medium', shoulder: 'medium',
  long: 'long', flowing: 'long',
  ponytail: 'ponytail', tail: 'ponytail',
  bun: 'bun', topknot: 'topknot',
  braid: 'braids', braids: 'braids', braided: 'braids',
  locs: 'locs', dreads: 'dreads', dreadlocks: 'dreads',
  mohawk: 'mohawk', undercut: 'undercut',
};

const EYE_COLOR_WORDS: Record<string, EyeColorKey> = {
  brown: 'brown', 'dark brown': 'dark_brown', hazel: 'hazel', amber: 'amber',
  green: 'green', emerald: 'green', blue: 'blue', 'light blue': 'light_blue',
  grey: 'grey', gray: 'grey', steel: 'grey',
  gold: 'refusal_gold', golden: 'refusal_gold', violet: 'drift_violet', purple: 'drift_violet',
};

const WEAPON_WORDS: Record<string, NonNullable<Accessories['carry']>[number]> = {
  sword: 'sword', blade: 'sword', saber: 'sword', katana: 'sword', greatsword: 'sword',
  staff: 'staff', stave: 'staff', wand: 'staff',
  pistol: 'pistol', revolver: 'pistol', sidearm: 'pistol',
  rifle: 'rifle', gun: 'rifle', carbine: 'rifle',
  bow: 'bow', longbow: 'bow',
  tome: 'tome', book: 'tome', grimoire: 'tome',
  satchel: 'satchel', pack: 'satchel', pouch: 'pouch',
};

/* ── small helpers ────────────────────────────────────────────────────── */

/** Find the first keyword from a map present as a whole word in `text`. */
function _firstMatch<T>(text: string, map: Record<string, T>): T | undefined {
  for (const key of Object.keys(map)) {
    // multi-word keys: substring; single-word: word-boundary.
    const hit = key.includes(' ')
      ? text.includes(key)
      : new RegExp(`\\b${key}\\b`).test(text);
    if (hit) return map[key];
  }
  return undefined;
}

/* ── scars / markings / augments (shared by both shapes) ──────────────── */

function markingsFromText(text: string): Partial<AuthoredAppearancePatch> {
  const out: Partial<AuthoredAppearancePatch> = {};
  const scars: FacialFeatures['scars'] = [];
  const markings: Accessories['markings'] = [];
  const augments: NonNullable<Accessories['augments']> = [];

  if (/\bscar|scarred|scarring\b/.test(text)) {
    const region: FacialFeatures['scars'][number]['region'] =
      /arm/.test(text) ? 'arm' : /torso|chest|back/.test(text) ? 'torso' : 'face';
    const kind: FacialFeatures['scars'][number]['kind'] =
      /burn|burnt|scorch/.test(text) ? 'burn'
        : /punctur|stab/.test(text) ? 'puncture'
          : /glyph|rune|sigil/.test(text) ? 'glyph' : 'slash';
    scars.push({ region, kind });
  }
  if (/\btattoo|ink|inked\b/.test(text)) {
    markings.push({ kind: 'tattoo', region: /face/.test(text) ? 'face' : 'arms', color: '#222222' });
  }
  if (/\bglyph|rune|sigil|brand\b/.test(text)) {
    markings.push({ kind: 'glyph', region: /face/.test(text) ? 'face' : 'torso', color: '#7ad0ff' });
    out.glow = true; // glyphs read as lit
  }
  if (/\bwar.?paint|warpaint|painted face\b/.test(text)) {
    markings.push({ kind: 'paint', region: 'face', color: '#c83020' });
  }
  if (/\bchrome|cyber|augment|prosthet|bionic|implant\b/.test(text)) {
    const region: NonNullable<Accessories['augments']>[number]['region'] =
      /eye/.test(text) ? 'eye' : /left arm|left-arm/.test(text) ? 'left-arm'
        : /right arm|right-arm/.test(text) ? 'right-arm'
          : /chest/.test(text) ? 'chest' : 'right-arm';
    const material: NonNullable<Accessories['augments']>[number]['material'] =
      /gold|gilded|brass/.test(text) ? 'gold' : /matte|black/.test(text) ? 'matte-black' : 'chrome';
    augments.push({ region, material });
    out.glow = true;
  }
  if (/\bmilky eye|blind eye|missing eye|one.eyed|eyepatch|scarred eye\b/.test(text)) {
    scars.push({ region: 'face', kind: 'slash' });
    augments.push({ region: 'eye', material: 'matte-black' });
  }

  if (scars.length) out.scars = scars;
  if (markings.length) out.markings = markings;
  if (augments.length) out.augments = augments;
  return out;
}

/* ── structured-shape parse ───────────────────────────────────────────── */

function parseStructured(obj: Record<string, unknown>): AuthoredAppearancePatch {
  const p: AuthoredAppearancePatch = {};
  const str = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');

  const build = str(obj.build ?? obj.body ?? obj.frame);
  if (build) p.bodyArchetype = _firstMatch(build, BUILD_WORDS);

  const skin = str(obj.skin ?? obj.complexion);
  if (skin) p.heritage = _firstMatch(skin, SKIN_WORDS);

  const hair = str(obj.hair);
  if (hair) {
    p.hairColorKey = _firstMatch(hair, HAIR_COLOR_WORDS);
    const sk = _firstMatch(hair, HAIR_STYLE_WORDS);
    if (sk) p.hairStyle = sk;
  }

  const eyes = str(obj.eyes ?? obj.eye);
  if (eyes) {
    p.eyeColorKey = _firstMatch(eyes, EYE_COLOR_WORDS);
    if (/glow|lumin|shine|bright/.test(eyes)) p.glow = true;
  }

  const age = str(obj.age);
  if (age) {
    p.facialPatch = {
      age: /old|elder|aged|grey|ancient|venerable/.test(age) ? 'elder'
        : /young|youth|child|teen|adolescent/.test(age) ? 'youth' : 'adult',
    };
  }

  const tells = `${str(obj.tells)} ${str(obj.marks)} ${str(obj.scars)} ${str(obj.notable)}`.trim();
  if (tells) Object.assign(p, markingsFromText(tells));

  const weapon = str(obj.weapon ?? obj.weapons ?? obj.carry);
  if (weapon) {
    const w = _firstMatch(weapon, WEAPON_WORDS);
    if (w) p.carry = [w];
  }

  return p;
}

/* ── prose-shape parse ────────────────────────────────────────────────── */

function parseProse(text: string): AuthoredAppearancePatch {
  const t = text.toLowerCase();
  const p: AuthoredAppearancePatch = {};

  p.bodyArchetype = _firstMatch(t, BUILD_WORDS);
  p.heritage = _firstMatch(t, SKIN_WORDS);

  const ck = _firstMatch(t, HAIR_COLOR_WORDS);
  if (ck && /hair|mane|locks|braid/.test(t)) p.hairColorKey = ck;
  const sk = _firstMatch(t, HAIR_STYLE_WORDS);
  if (sk && /hair|mane|head|shorn|shaved|bald/.test(t)) p.hairStyle = sk;

  const ek = _firstMatch(t, EYE_COLOR_WORDS);
  if (ek && /eye/.test(t)) p.eyeColorKey = ek;
  if (/glowing eye|luminous eye|burning eye|bright eye/.test(t)) p.glow = true;

  if (/old|elder|aged|ancient|venerable|wrinkl|grey-haired/.test(t)) p.facialPatch = { age: 'elder' };
  else if (/young|youth|boyish|girlish|teen/.test(t)) p.facialPatch = { age: 'youth' };
  if (/weathered|grizzled|battle-worn|hardened/.test(t)) p.facialPatch = { ...(p.facialPatch || {}), weathering: 'weathered' };

  const w = _firstMatch(t, WEAPON_WORDS);
  if (w) p.carry = [w];

  Object.assign(p, markingsFromText(t));

  return p;
}

/* ── public entry ─────────────────────────────────────────────────────── */

/**
 * Parse an authored appearance (prose string OR structured object) into a
 * mergeable patch of palette keys + appendable arrays. Returns {} on
 * empty/unknown input. Pure + total — never throws.
 */
export function parseAuthoredAppearance(
  appearance: string | Record<string, unknown> | null | undefined,
): AuthoredAppearancePatch {
  try {
    if (!appearance) return {};
    if (typeof appearance === 'string') {
      const trimmed = appearance.trim();
      if (!trimmed) return {};
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try { return parseStructured(JSON.parse(trimmed)); } catch { /* fall through to prose */ }
      }
      return parseProse(trimmed);
    }
    if (typeof appearance === 'object') return parseStructured(appearance);
    return {};
  } catch {
    // Totality guarantee — a parse fault must never break mesh generation.
    return {};
  }
}

/** Convenience: did the authored text ask for emissive treatment? */
export function authoredWantsGlow(patch: AuthoredAppearancePatch): boolean {
  return !!patch.glow;
}
