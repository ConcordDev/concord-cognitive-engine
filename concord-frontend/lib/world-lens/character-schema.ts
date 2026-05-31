/**
 * Concordia Character Schema
 *
 * Rich, realistic per-character appearance description that drives the
 * procedural avatar mesh builder, the (eventual) GLB hero-mesh selector,
 * the cape-and-tack physics, hair-cards, facial-blend-shapes, and
 * eye-parallax shader.
 *
 * Reference data baked into this module:
 *
 * - Body proportion targets follow Wikipedia / Proko / Anatomy For
 *   Sculptors averages: 7.5 heads tall for an average adult, 8 heads
 *   for idealized, 8.5 for heroic. Legs = 3.5–4 heads. Arms = 3 heads.
 *   Hands ≈ face length. Foot ≈ 1 head length.
 * - Skin palette is the Fitzpatrick 6-type scale (Type I-VI). Hex
 *   values from arhfoundation.org's canonical hex/RGB chart.
 * - Hair colour distribution skews to the global modal: black > brown
 *   > blonde > red > grey (age). Per-faction overrides surface
 *   exotic dyes (cyber world has neon hair; sovereign-ruins has dust-
 *   bleached grey).
 * - Eye colour distribution: brown > blue > hazel > green > amber > grey.
 * - PBR values follow the physicallybased.info reference: skin roughness
 *   ~0.65, hair roughness 0.4-0.7, cloth (cotton) 0.85+, leather 0.55,
 *   iron/steel metallic 1.0 roughness 0.3, marble metallic 0 roughness 0.4.
 * - Cel-shading uses a 3-stop toon gradient per theme (BotW pattern);
 *   skin still uses SSS underneath so faces don't look plastic.
 *
 * Faction style overrides (cultural costuming):
 *   tunyan factions  -> earth-tones + copper jewelry + bloodline forge
 *                       ash markings + tribal scarification patterns
 *   cyber factions   -> neon hair dye + chrome implants + dark synth
 *                       leather + holo glasses
 *   crime factions   -> trench coats + fedoras + grey-brown earth tones
 *   fantasy factions -> wool cloaks + leather + iron rings + tattoos
 *   superhero        -> athletic synthetics + mask layer + utility belts
 *   sovereign-ruins  -> dust-bleached robes + memory-glyph tattoos
 *   lattice-crucible -> drift-fractal robes + holographic feathers
 *   frontier         -> oilskin coats + brass goggles + leather gloves
 *   concordia-hub    -> tunic + sandals + olive wreath + civic stole
 *
 * Where this schema is consumed:
 *   - AvatarSystem3D.createAvatarMesh (procedural fallback)
 *   - hero-mesh-registry.loadHeroMesh (GLB path)
 *   - cape-and-tack.tickCape (per-character cape weight)
 *   - facial-blend-shapes.applyExpression (per-character bias)
 *   - eye-parallax-shader (per-character iris color depth)
 *
 * Sources (web-researched May 2026):
 *   Body proportions     -> https://en.wikipedia.org/wiki/Body_proportions
 *   Fitzpatrick scale    -> https://www.arhfoundation.org/fitzpatrick-scale-hex-rgb-codes
 *   PBR reference values -> https://physicallybased.info/
 *   Sudano-Sahelian arch -> https://en.wikipedia.org/wiki/Sudano-Sahelian_architecture
 *   Cyberpunk palettes   -> https://piktochart.com/blog/cyberpunk-color-palette/
 */

import type { ConcordiaThemeId } from './concordia-theme';
import { parseAuthoredAppearance } from './appearance-parse';

/* ── Body proportions ─────────────────────────────────────────────── */

export type BodyArchetype =
  | 'slim'        // 7.5 heads, narrow shoulders, lanky
  | 'average'     // 7.5 heads, balanced
  | 'stocky'      // 7 heads, broad-shoulder, stocky
  | 'tall'        // 8 heads, long limbs
  | 'broad'       // 7.5 heads, athletic v-taper
  | 'petite'      // 7 heads, smaller frame
  | 'legend';     // 8.5 heads, idealized / heroic (for The Three)

export type HeritageMarker =
  /* Skin shading bias — drives Fitzpatrick-aligned palette selection.
   * These are appearance-genome flags, NOT real-world ethnic categories.
   * They map to Fitzpatrick I–VI as a one-axis spectrum for the renderer. */
  | 'pale'        // Type I-II
  | 'fair'        // Type II-III
  | 'olive'       // Type III-IV
  | 'tan'         // Type IV
  | 'brown'       // Type V
  | 'dark-brown'; // Type VI

export interface BodyProportions {
  totalHeight: number;       // metres
  headHeight: number;        // metres (totalHeight / headCount)
  shoulderWidth: number;     // metres (head widths × 1.6-2.2)
  hipWidth: number;          // metres
  torsoLength: number;       // metres (~2.5 heads)
  legLength: number;         // metres (3.5-4 heads)
  armLength: number;         // metres (~3 heads incl. hand)
  handLength: number;        // metres (~1 head)
  footLength: number;        // metres (~1 head)
  neckLength: number;        // metres
  headWidth: number;         // metres
  headDepth: number;         // metres
}

/**
 * Compute realistic body proportions from a body archetype + total
 * height. Uses standard human-proportion ratios (7.5 heads tall =
 * average adult).
 */
export function proportionsFor(arch: BodyArchetype, totalHeight: number): BodyProportions {
  const headCount = {
    slim: 7.5, average: 7.5, stocky: 7.0, tall: 8.0,
    broad: 7.5, petite: 7.0, legend: 8.5,
  }[arch];
  const head = totalHeight / headCount;
  const shoulderFactor = {
    slim: 1.6, average: 1.9, stocky: 2.2, tall: 1.9,
    broad: 2.2, petite: 1.7, legend: 2.3,
  }[arch];
  const hipFactor = {
    slim: 1.5, average: 1.7, stocky: 1.9, tall: 1.7,
    broad: 1.8, petite: 1.6, legend: 1.9,
  }[arch];
  return {
    totalHeight,
    headHeight:    head,
    headWidth:     head * 0.7,
    headDepth:     head * 0.85,
    shoulderWidth: head * shoulderFactor,
    hipWidth:      head * hipFactor,
    torsoLength:   head * 2.5,
    legLength:     head * (arch === 'legend' ? 4.2 : arch === 'tall' ? 4.0 : arch === 'stocky' ? 3.4 : 3.7),
    armLength:     head * 3.0,
    handLength:    head * 0.95,
    footLength:    head * 1.0,
    neckLength:    head * 0.45,
  };
}

/* ── Skin / hair / eye palettes (real-world reference) ────────────── */

/**
 * Fitzpatrick skin types I-VI with the canonical hex / RGB values used
 * in dermatology + inclusive design references (arhfoundation.org).
 * Each type has 3 variants (cool / neutral / warm undertone) so the
 * procedural picker can avoid all NPCs landing on the same exact tone.
 */
export const FITZPATRICK_SKIN: Record<HeritageMarker, string[]> = {
  'pale':       ['#f6dabb', '#f3d4b1', '#fadec7'],  // I
  'fair':       ['#e8beac', '#dfb29e', '#f0c8b6'],  // II
  'olive':      ['#d3a18f', '#caa088', '#cf8e74'],  // III
  'tan':        ['#bd8d74', '#a87454', '#c89878'],  // IV
  'brown':      ['#815c49', '#7d4f33', '#8d6a52'],  // V
  'dark-brown': ['#4d332d', '#42291a', '#5a3d30'],  // VI
};

/**
 * Real-world hair color distribution (global, approximate %):
 *   black 75 / brown 18 / dark-blonde 3 / blonde 2 / red <1 / grey (age)
 * Faction overrides surface neon dyes (cyber) and ceremonial whites
 * (sovereign-ruins). The 'silver' entry is used both for age-grey and
 * for cyber-platinum dyes.
 */
export const HAIR_PALETTE = {
  black:        ['#1a1410', '#0e0a08', '#241a14'],
  dark_brown:   ['#3d2818', '#4a3022', '#321e10'],
  brown:        ['#6a4828', '#7a5630', '#5a3818'],
  light_brown:  ['#9a7048', '#aa7c50', '#8a6038'],
  blonde:       ['#c8a070', '#d8b888', '#b88858'],
  light_blonde: ['#e8d4a8', '#f0dcb0', '#dac08c'],
  red:          ['#a04018', '#b85024', '#902c08'],
  silver:       ['#c8c8c8', '#d8d8d8', '#b0b0b0'],
  // Faction-only dyes — only surfaced when the outfit-generator detects
  // the right culture tag.
  cyber_magenta: ['#ff2bd5', '#e028b8', '#ff60d8'],
  cyber_cyan:    ['#30e8ff', '#28d0e8', '#60f0ff'],
  drift_violet:  ['#a060ff', '#8848e0', '#b878ff'],
  bloodline_red: ['#c83020', '#a02818', '#e04028'],
};

export type HairColorKey = keyof typeof HAIR_PALETTE;

/**
 * Real-world eye color distribution:
 *   brown 75 / blue 8-10 / hazel 5 / green 2 / amber/grey/other 1-2
 */
export const EYE_PALETTE = {
  brown:      '#5a3818',
  dark_brown: '#2a1a08',
  hazel:      '#8a7048',
  amber:      '#c08838',
  green:      '#4a7038',
  blue:       '#5078a8',
  light_blue: '#88b8d8',
  grey:       '#6a7078',
  // Concord-substrate eyes — for legend body types only.
  refusal_gold: '#e0c060',
  drift_violet: '#a058e0',
} as const;

export type EyeColorKey = keyof typeof EYE_PALETTE;

/* ── Hair style ───────────────────────────────────────────────────── */

export type HairStyle =
  | 'bald'
  | 'shaved'      // short stubble
  | 'short'
  | 'medium'
  | 'long'
  | 'ponytail'
  | 'bun'
  | 'braids'      // multiple braids (cape-and-tack-friendly)
  | 'locs'        // long locs
  | 'dreads'
  | 'mohawk'
  | 'topknot'
  | 'undercut';   // shaved sides + long top (cyber affinity)

/* ── Facial features (drive blend shapes) ─────────────────────────── */

export interface FacialFeatures {
  jawShape:    'round' | 'square' | 'pointed' | 'soft';
  eyeShape:    'almond' | 'round' | 'narrow' | 'wide';
  noseShape:   'straight' | 'aquiline' | 'broad' | 'snub' | 'narrow';
  browWeight:  'thin' | 'medium' | 'heavy';
  freckles:    number;          // 0..1 density
  age:         'youth' | 'adult' | 'elder';
  weathering:  'fresh' | 'weathered' | 'scarred' | 'sun-baked';
  scars:       Array<{ region: 'face' | 'arm' | 'torso'; kind: 'slash' | 'burn' | 'puncture' | 'glyph' }>;
}

/* ── Clothing kits per world / faction ────────────────────────────── */

export type ClothingTopKind =
  | 'shirt' | 'vest' | 'coat' | 'robe' | 'apron'
  | 'tunic' | 'jacket' | 'trench' | 'breastplate' | 'synth-jacket'
  | 'cassock' | 'kanga' | 'duster' | 'cape';

export type ClothingBottomKind =
  | 'pants' | 'skirt' | 'shorts' | 'robe'
  | 'trousers' | 'kilt' | 'leggings' | 'sarong'
  | 'cargo' | 'leather-pants' | 'breeches';

export type ClothingHatKind =
  | 'cap' | 'tophat' | 'beret' | 'hood' | 'helmet'
  | 'fedora' | 'turban' | 'circlet' | 'wreath'
  | 'visor' | 'goggle' | 'crown' | 'horned-helm';

export interface ClothingKit {
  top:    { color: string; kind: ClothingTopKind };
  bottom: { color: string; kind: ClothingBottomKind };
  hat?:   { color: string; kind: ClothingHatKind };
  /** Outer cape / cloak / robe over top. Cape-physics affordance. */
  cape?:  { color: string; pattern?: 'plain' | 'striped' | 'glyph' };
  /** Belt + pouches. */
  belt?:  { color: string };
  /** Visible footwear. */
  boots?: { color: string; kind: 'sandal' | 'boot' | 'greaves' | 'barefoot' };
}

/* ── Accessory + markings layer ───────────────────────────────────── */

export interface Accessories {
  jewelry: Array<'earrings' | 'necklace' | 'arm-bands' | 'rings' | 'nose-ring' | 'lip-ring' | 'circlet'>;
  /** Tattoos / scarification / glyph markings — drives a decal pass over skin. */
  markings: Array<{ kind: 'tattoo' | 'scar-pattern' | 'paint' | 'glyph'; region: 'face' | 'arms' | 'torso' | 'back'; color: string }>;
  /** Visible carried gear at the hip / shoulder. Drives a prop layer on the mesh. */
  carry?: Array<'sword' | 'staff' | 'pistol' | 'rifle' | 'bow' | 'satchel' | 'tome' | 'tool-belt' | 'pouch'>;
  /** Cybernetic augments (chrome arm, eye implant) — visible chrome materials on the mesh. */
  augments?: Array<{ region: 'left-arm' | 'right-arm' | 'eye' | 'face' | 'chest'; material: 'chrome' | 'matte-black' | 'gold' }>;
}

/* ── The full per-character appearance config ─────────────────────── */

export interface RichAppearanceConfig {
  /* Body */
  bodyArchetype:   BodyArchetype;
  totalHeight:     number;       // metres
  proportions:     BodyProportions;
  heritage:        HeritageMarker;
  skinColor:       string;       // hex; one of the FITZPATRICK_SKIN variants

  /* Hair + eyes */
  hairColor:       string;       // hex; one of HAIR_PALETTE variants
  hairColorKey:    HairColorKey;
  hairStyle:       HairStyle;
  eyeColor:        string;       // hex
  eyeColorKey:     EyeColorKey;

  /* Facial features */
  facial:          FacialFeatures;

  /* Clothing kit (per world / faction) */
  clothing:        ClothingKit;

  /* Accessories + markings */
  accessories:     Accessories;

  /* Provenance — which world/faction did this character get authored for? */
  worldId:         string;
  factionId:       string | null;
  cultureTags:     string[];      // e.g. ['tunyan', 'fire-bloodline', 'medici']

  /* Hero / GLB hook — when true the renderer tries the hero-mesh-registry first. */
  heroMesh?:       boolean;
}

/* ── Faction style sets (cultural costuming) ──────────────────────── */

export type FactionStyleId =
  | 'tunya-savanna'
  | 'tunya-highland'
  | 'tunya-bloodline-forge'
  | 'tunya-medici-ice'
  | 'tunya-coastal'
  | 'tunya-cactem'
  | 'cyber-corp'
  | 'cyber-street'
  | 'cyber-blackout'
  | 'crime-trench'
  | 'crime-cartel'
  | 'fantasy-paladin'
  | 'fantasy-mage'
  | 'fantasy-goblin'
  | 'superhero-augmented'
  | 'superhero-baseline'
  | 'sovereign-archivist'
  | 'lattice-drift'
  | 'frontier-walker'
  | 'concordia-civic'
  | 'concordia-three';

export interface FactionStyle {
  id:               FactionStyleId;
  label:            string;
  /** Default heritage bias — randomized within ±1 type. */
  heritageBias:     HeritageMarker[];
  /** Body archetypes that surface with this style. */
  bodyBias:         BodyArchetype[];
  /** Hair color keys allowed (one is picked deterministically). */
  hairBias:         HairColorKey[];
  /** Hair styles allowed. */
  hairStyles:       HairStyle[];
  /** Clothing top kinds for this style. */
  tops:             ClothingTopKind[];
  bottoms:          ClothingBottomKind[];
  hats:             (ClothingHatKind | null)[];
  /** Color palette for the clothing. Hex strings. */
  clothingPalette:  string[];
  /** Allowed markings. */
  markings:         Accessories['markings'][number]['kind'][];
  /** Default carry items if the NPC has a weapon/role hint. */
  carryDefault:     Accessories['carry'];
  /** Augments — cyber-only typically. */
  augmentChance:    number;       // 0..1
  /** Boots / footwear. */
  boots:            NonNullable<ClothingKit['boots']>['kind'][];
}

export const FACTION_STYLES: Record<FactionStyleId, FactionStyle> = {
  /* ── Tunya ─────────────────────────────────────────────────────── */
  'tunya-savanna': {
    id: 'tunya-savanna',
    label: 'Tunyan savanna folk',
    heritageBias: ['brown', 'dark-brown', 'tan'],
    bodyBias: ['average', 'tall', 'slim'],
    hairBias: ['black', 'dark_brown'],
    hairStyles: ['locs', 'braids', 'shaved', 'topknot', 'short'],
    tops: ['tunic', 'kanga', 'vest'],
    bottoms: ['sarong', 'pants', 'kilt'],
    hats: [null, null, 'turban'],
    clothingPalette: ['#c8721a', '#a04818', '#683018', '#d8a060', '#f0c068', '#384828', '#684430'],
    markings: ['scar-pattern', 'paint', 'tattoo'],
    carryDefault: ['satchel', 'pouch'],
    augmentChance: 0,
    boots: ['sandal', 'barefoot'],
  },
  'tunya-highland': {
    id: 'tunya-highland',
    label: 'Tunyan highland clans',
    heritageBias: ['brown', 'tan', 'olive'],
    bodyBias: ['stocky', 'average', 'broad'],
    hairBias: ['black', 'dark_brown', 'brown'],
    hairStyles: ['braids', 'long', 'ponytail', 'short'],
    tops: ['vest', 'tunic', 'coat'],
    bottoms: ['leather-pants', 'breeches', 'pants'],
    hats: [null, 'circlet', 'hood'],
    clothingPalette: ['#5c4030', '#785848', '#9a7050', '#382820', '#a0683c', '#48382c'],
    markings: ['tattoo', 'scar-pattern'],
    carryDefault: ['sword', 'bow', 'pouch'],
    augmentChance: 0,
    boots: ['boot', 'sandal'],
  },
  'tunya-bloodline-forge': {
    id: 'tunya-bloodline-forge',
    label: 'Sandrun Sanguire — fire-bloodline forge',
    heritageBias: ['brown', 'tan'],
    bodyBias: ['broad', 'average', 'stocky'],
    hairBias: ['black', 'bloodline_red', 'dark_brown'],
    hairStyles: ['shaved', 'short', 'topknot', 'mohawk'],
    tops: ['apron', 'vest', 'tunic'],
    bottoms: ['leather-pants', 'pants'],
    hats: [null, 'circlet'],
    clothingPalette: ['#c83020', '#a02818', '#7a1a08', '#2a1810', '#ff8030', '#d8a868'],
    markings: ['scar-pattern', 'glyph', 'paint'],
    carryDefault: ['tool-belt', 'pouch'],
    augmentChance: 0,
    boots: ['boot'],
  },
  'tunya-medici-ice': {
    id: 'tunya-medici-ice',
    label: 'Medici alien-heritage ice-bloodline',
    heritageBias: ['pale', 'fair'],
    bodyBias: ['slim', 'tall', 'average'],
    hairBias: ['silver', 'light_blonde', 'blonde'],
    hairStyles: ['long', 'braids', 'bun', 'ponytail'],
    tops: ['robe', 'cassock', 'tunic'],
    bottoms: ['robe', 'skirt', 'leggings'],
    hats: [null, 'circlet', 'hood'],
    clothingPalette: ['#a8c8e0', '#d8e8f0', '#5878a8', '#b8d8d8', '#7898c8', '#c8d8e0'],
    markings: ['glyph', 'tattoo'],
    carryDefault: ['tome', 'satchel'],
    augmentChance: 0,
    boots: ['sandal', 'boot'],
  },
  'tunya-coastal': {
    id: 'tunya-coastal',
    label: 'Tunyan coastal traders',
    heritageBias: ['olive', 'tan', 'brown'],
    bodyBias: ['average', 'slim'],
    hairBias: ['black', 'dark_brown', 'brown'],
    hairStyles: ['short', 'medium', 'braids', 'long'],
    tops: ['tunic', 'shirt', 'vest'],
    bottoms: ['shorts', 'kilt', 'sarong'],
    hats: [null, 'cap'],
    clothingPalette: ['#5078a8', '#80a8c8', '#c8d8e0', '#a86848', '#384858', '#d8c068'],
    markings: ['tattoo', 'paint'],
    carryDefault: ['satchel', 'pouch'],
    augmentChance: 0,
    boots: ['sandal', 'barefoot'],
  },
  'tunya-cactem': {
    id: 'tunya-cactem',
    label: 'Tunyan desert-strip nomads (Bahiij)',
    heritageBias: ['tan', 'brown', 'dark-brown'],
    bodyBias: ['slim', 'average', 'tall'],
    hairBias: ['black', 'dark_brown'],
    hairStyles: ['braids', 'long', 'locs'],
    tops: ['robe', 'tunic', 'cape'],
    bottoms: ['pants', 'sarong'],
    hats: ['hood', 'turban', null],
    clothingPalette: ['#d8b078', '#a87848', '#785838', '#382820', '#c89858', '#604838'],
    markings: ['tattoo', 'paint'],
    carryDefault: ['bow', 'pouch'],
    augmentChance: 0,
    boots: ['boot', 'sandal'],
  },

  /* ── Cyber ─────────────────────────────────────────────────────── */
  'cyber-corp': {
    id: 'cyber-corp',
    label: 'Cyber corporate enforcer',
    heritageBias: ['fair', 'olive', 'tan'],
    bodyBias: ['tall', 'average', 'broad'],
    hairBias: ['black', 'dark_brown', 'silver'],
    hairStyles: ['short', 'shaved', 'undercut', 'topknot'],
    tops: ['synth-jacket', 'trench', 'breastplate'],
    bottoms: ['cargo', 'leather-pants', 'trousers'],
    hats: [null, 'visor', null],
    clothingPalette: ['#181a24', '#2a2e3a', '#444c5a', '#a8b0c0', '#0a0a14', '#ff2bd5'],
    markings: [],
    carryDefault: ['pistol', 'tool-belt'],
    augmentChance: 0.6,
    boots: ['boot'],
  },
  'cyber-street': {
    id: 'cyber-street',
    label: 'Cyber street tech / fixer',
    heritageBias: ['fair', 'olive', 'tan', 'brown'],
    bodyBias: ['slim', 'average'],
    hairBias: ['cyber_magenta', 'cyber_cyan', 'black', 'silver'],
    hairStyles: ['mohawk', 'undercut', 'shaved', 'short', 'long'],
    tops: ['synth-jacket', 'vest', 'jacket'],
    bottoms: ['cargo', 'leather-pants', 'leggings'],
    hats: [null, 'visor', 'goggle'],
    clothingPalette: ['#181a24', '#ff2bd5', '#30e8ff', '#a060ff', '#0a0a14', '#404858'],
    markings: ['tattoo', 'glyph'],
    carryDefault: ['pistol', 'tool-belt'],
    augmentChance: 0.5,
    boots: ['boot'],
  },
  'cyber-blackout': {
    id: 'cyber-blackout',
    label: 'Blackout resistance (off-grid)',
    heritageBias: ['olive', 'tan', 'brown'],
    bodyBias: ['average', 'slim', 'broad'],
    hairBias: ['black', 'dark_brown', 'silver'],
    hairStyles: ['short', 'shaved', 'braids'],
    tops: ['jacket', 'coat', 'vest'],
    bottoms: ['cargo', 'leather-pants'],
    hats: ['hood', null, 'goggle'],
    clothingPalette: ['#1a1812', '#3a342a', '#5a4838', '#888070', '#080604'],
    markings: ['tattoo', 'scar-pattern'],
    carryDefault: ['rifle', 'pouch'],
    augmentChance: 0.2,
    boots: ['boot'],
  },

  /* ── Crime ─────────────────────────────────────────────────────── */
  'crime-trench': {
    id: 'crime-trench',
    label: 'Crime — detective / trenchcoat',
    heritageBias: ['fair', 'olive', 'tan', 'pale'],
    bodyBias: ['average', 'tall', 'broad'],
    hairBias: ['black', 'brown', 'dark_brown', 'silver'],
    hairStyles: ['short', 'medium'],
    tops: ['trench', 'coat', 'shirt'],
    bottoms: ['trousers', 'pants'],
    hats: ['fedora', null],
    clothingPalette: ['#3a2c20', '#1a1612', '#5a4838', '#a08c70', '#080604', '#785848'],
    markings: [],
    carryDefault: ['pistol', 'satchel'],
    augmentChance: 0,
    boots: ['boot'],
  },
  'crime-cartel': {
    id: 'crime-cartel',
    label: 'Crime — cartel / made-man',
    heritageBias: ['fair', 'olive', 'tan'],
    bodyBias: ['broad', 'average', 'stocky'],
    hairBias: ['black', 'dark_brown'],
    hairStyles: ['short', 'medium'],
    tops: ['jacket', 'shirt'],
    bottoms: ['trousers'],
    hats: [null, 'fedora'],
    clothingPalette: ['#080604', '#1a1410', '#380820', '#5a3018', '#a08458'],
    markings: ['tattoo', 'scar-pattern'],
    carryDefault: ['pistol'],
    augmentChance: 0,
    boots: ['boot'],
  },

  /* ── Fantasy ───────────────────────────────────────────────────── */
  'fantasy-paladin': {
    id: 'fantasy-paladin',
    label: 'Fantasy — paladin order',
    heritageBias: ['fair', 'olive', 'tan', 'pale'],
    bodyBias: ['broad', 'tall', 'average'],
    hairBias: ['blonde', 'light_brown', 'brown', 'red'],
    hairStyles: ['short', 'medium', 'long', 'ponytail'],
    tops: ['breastplate', 'tunic', 'cape'],
    bottoms: ['trousers', 'kilt'],
    hats: ['helmet', 'circlet', null],
    clothingPalette: ['#d8c068', '#a08438', '#586878', '#c8c8d8', '#382818', '#f8e8b8'],
    markings: [],
    carryDefault: ['sword'],
    augmentChance: 0,
    boots: ['greaves', 'boot'],
  },
  'fantasy-mage': {
    id: 'fantasy-mage',
    label: 'Fantasy — arcane university',
    heritageBias: ['fair', 'pale', 'olive'],
    bodyBias: ['slim', 'average', 'tall'],
    hairBias: ['silver', 'blonde', 'brown', 'red'],
    hairStyles: ['long', 'medium', 'ponytail', 'bun', 'bald'],
    tops: ['robe', 'cassock', 'cape'],
    bottoms: ['robe', 'leggings'],
    hats: ['hood', 'circlet', null],
    clothingPalette: ['#4a78a8', '#205070', '#a060ff', '#c8a868', '#1a2838', '#d8c0ff'],
    markings: ['glyph', 'tattoo'],
    carryDefault: ['staff', 'tome'],
    augmentChance: 0,
    boots: ['boot', 'sandal'],
  },
  'fantasy-goblin': {
    id: 'fantasy-goblin',
    label: 'Fantasy — goblin warband',
    heritageBias: ['olive', 'tan'],
    bodyBias: ['petite', 'stocky'],
    hairBias: ['black', 'dark_brown', 'red'],
    hairStyles: ['shaved', 'mohawk', 'short'],
    tops: ['vest', 'shirt'],
    bottoms: ['shorts', 'breeches'],
    hats: ['horned-helm', 'hood', null],
    clothingPalette: ['#3a4818', '#5a6828', '#a06438', '#180a08', '#7a3818'],
    markings: ['scar-pattern', 'tattoo'],
    carryDefault: ['sword', 'pouch'],
    augmentChance: 0,
    boots: ['boot', 'barefoot'],
  },

  /* ── Superhero ─────────────────────────────────────────────────── */
  'superhero-augmented': {
    id: 'superhero-augmented',
    label: 'Superhero — augmented / bio-powered',
    heritageBias: ['fair', 'olive', 'tan', 'brown', 'dark-brown'],
    bodyBias: ['tall', 'broad', 'average'],
    hairBias: ['black', 'brown', 'blonde', 'silver'],
    hairStyles: ['short', 'medium', 'long', 'ponytail'],
    tops: ['synth-jacket', 'breastplate', 'jacket'],
    bottoms: ['cargo', 'leather-pants', 'trousers'],
    hats: ['visor', null],
    clothingPalette: ['#3a78ff', '#a860ff', '#ffa800', '#d83838', '#101830', '#f0f0f0'],
    markings: ['glyph'],
    carryDefault: ['tool-belt'],
    augmentChance: 0.3,
    boots: ['boot'],
  },
  'superhero-baseline': {
    id: 'superhero-baseline',
    label: 'Superhero — civilian baseline',
    heritageBias: ['fair', 'olive', 'tan', 'brown'],
    bodyBias: ['average', 'slim', 'broad', 'petite'],
    hairBias: ['black', 'brown', 'blonde', 'dark_brown'],
    hairStyles: ['short', 'medium', 'long', 'ponytail', 'bun'],
    tops: ['shirt', 'jacket', 'coat'],
    bottoms: ['trousers', 'leggings', 'pants'],
    hats: [null, 'cap'],
    clothingPalette: ['#5a78a8', '#88a8c8', '#8c8868', '#d8c0a0', '#384858'],
    markings: [],
    carryDefault: ['satchel', 'pouch'],
    augmentChance: 0,
    boots: ['boot', 'sandal'],
  },

  /* ── Sovereign-Ruins ───────────────────────────────────────────── */
  'sovereign-archivist': {
    id: 'sovereign-archivist',
    label: 'Sovereign-Ruins — archivist / half-conscious',
    heritageBias: ['fair', 'pale', 'olive'],
    bodyBias: ['slim', 'tall', 'average'],
    hairBias: ['silver', 'light_blonde', 'blonde', 'brown'],
    hairStyles: ['long', 'bun', 'bald', 'medium'],
    tops: ['robe', 'cassock', 'cape'],
    bottoms: ['robe'],
    hats: ['hood', null, 'circlet'],
    clothingPalette: ['#d8c090', '#b89060', '#806840', '#e8d8b8', '#382818', '#a08858'],
    markings: ['glyph', 'tattoo'],
    carryDefault: ['tome', 'satchel'],
    augmentChance: 0,
    boots: ['sandal'],
  },

  /* ── Lattice-Crucible ──────────────────────────────────────────── */
  'lattice-drift': {
    id: 'lattice-drift',
    label: 'Lattice — drift-touched experimentalist',
    heritageBias: ['fair', 'olive', 'tan', 'brown', 'pale'],
    bodyBias: ['slim', 'tall', 'average'],
    hairBias: ['drift_violet', 'cyber_cyan', 'silver', 'black'],
    hairStyles: ['long', 'undercut', 'topknot', 'medium', 'mohawk'],
    tops: ['robe', 'jacket', 'cape'],
    bottoms: ['leggings', 'robe', 'cargo'],
    hats: ['hood', null, 'circlet'],
    clothingPalette: ['#a060ff', '#503088', '#20ffd0', '#180838', '#d0a8ff', '#080418'],
    markings: ['glyph', 'tattoo'],
    carryDefault: ['staff', 'tome'],
    augmentChance: 0.15,
    boots: ['boot'],
  },

  /* ── Frontier ──────────────────────────────────────────────────── */
  'frontier-walker': {
    id: 'frontier-walker',
    label: 'Frontier — walker / courier',
    heritageBias: ['tan', 'olive', 'brown', 'fair'],
    bodyBias: ['average', 'tall', 'broad', 'slim'],
    hairBias: ['black', 'brown', 'dark_brown', 'blonde'],
    hairStyles: ['short', 'medium', 'ponytail', 'braids'],
    tops: ['duster', 'coat', 'jacket'],
    bottoms: ['trousers', 'pants', 'cargo'],
    hats: ['fedora', 'goggle', 'cap', null],
    clothingPalette: ['#d8b878', '#a08458', '#785838', '#382818', '#c89858', '#688058'],
    markings: ['tattoo'],
    carryDefault: ['rifle', 'satchel'],
    augmentChance: 0.05,
    boots: ['boot'],
  },

  /* ── Concordia hub ─────────────────────────────────────────────── */
  'concordia-civic': {
    id: 'concordia-civic',
    label: 'Concordia — civic / Compact-folk',
    heritageBias: ['fair', 'olive', 'tan', 'brown'],
    bodyBias: ['average', 'tall', 'slim'],
    hairBias: ['black', 'brown', 'dark_brown', 'blonde'],
    hairStyles: ['short', 'medium', 'long', 'bun', 'ponytail'],
    tops: ['tunic', 'robe', 'cape'],
    bottoms: ['kilt', 'sarong', 'trousers'],
    hats: ['wreath', null, 'circlet'],
    clothingPalette: ['#f8e8b8', '#d8c090', '#a08458', '#688058', '#382818', '#e8d8a8'],
    markings: ['glyph'],
    carryDefault: ['satchel', 'tome'],
    augmentChance: 0,
    boots: ['sandal'],
  },
  'concordia-three': {
    id: 'concordia-three',
    label: 'The Three Above All',
    heritageBias: ['olive', 'tan', 'brown'],
    bodyBias: ['legend'],
    hairBias: ['silver', 'black', 'dark_brown'],
    hairStyles: ['long', 'topknot', 'braids'],
    tops: ['cape', 'robe', 'cassock'],
    bottoms: ['robe'],
    hats: ['crown', 'circlet', 'wreath'],
    clothingPalette: ['#e0c060', '#d0a058', '#a08458', '#180a04', '#f8e8a8', '#a060ff'],
    markings: ['glyph'],
    carryDefault: ['tome', 'staff'],
    augmentChance: 0,
    boots: ['sandal', 'barefoot'],
  },
};

/* ── Theme → default faction style map (for generic NPCs) ─────────── */

/**
 * When a procgen NPC has no faction tag, fall back to a per-world
 * "civilian" style. Drives the population-of-the-streets look.
 */
export const DEFAULT_STYLE_FOR_THEME: Record<ConcordiaThemeId, FactionStyleId> = {
  'neon-punk':              'cyber-street',
  'classic':                'concordia-civic',
  'minimal':                'concordia-civic',
  'tunya':                  'tunya-savanna',
  'cyber':                  'cyber-street',
  'crime':                  'crime-trench',
  'fantasy':                'fantasy-paladin',
  'superhero':              'superhero-baseline',
  'sovereign-ruins':        'sovereign-archivist',
  'lattice-crucible':       'lattice-drift',
  'concord-link-frontier':  'frontier-walker',
  'concordia-hub':          'concordia-civic',
};

/* ── Per-faction style map (drives per-NPC outfit) ────────────────── */

/**
 * Maps the authored faction_id (from content/world/<w>/factions.json)
 * to a FactionStyleId. Lookups that miss fall through to the world's
 * DEFAULT_STYLE_FOR_THEME entry.
 */
export const FACTION_TO_STYLE: Record<string, FactionStyleId> = {
  // Tunya 14 factions
  'sandrun_sanguire': 'tunya-bloodline-forge',
  'kree':             'tunya-savanna',
  'medici':           'tunya-medici-ice',
  'cree':             'tunya-highland',
  'aekon':            'tunya-savanna',
  'asbir':            'tunya-coastal',
  'sahm':             'tunya-highland',
  'dinye':            'tunya-savanna',
  'bahiij':           'tunya-cactem',
  'masond':           'tunya-coastal',
  'dormas':           'tunya-highland',
  'fluxom':           'tunya-coastal',
  'nil':              'tunya-savanna',
  'akeia_of_kahlay':  'tunya-savanna',
  // Cyber
  'cyber_arasacorp':         'cyber-corp',
  'zero_collective':         'cyber-street',
  'blackout_resistance':     'cyber-blackout',
  'cyber_fixer_guild':       'cyber-street',
  'cyber_street_docs':       'cyber-street',
  'cyber_ai_rights_movement':'cyber-street',
  'cyber_augmented_elite_club':'cyber-corp',
  // Crime
  'iron_rose_syndicate':     'crime-cartel',
  'ghost_network':           'crime-trench',
  'crime_corrupt_precinct':  'crime-trench',
  'crime_federal_task_force':'crime-trench',
  'crime_north_market_gang': 'crime-cartel',
  'crime_pi_agency':         'crime-trench',
  'crime_white_collar_ring': 'crime-trench',
  // Fantasy
  'fantasy_paladin_order':   'fantasy-paladin',
  'fantasy_arcane_university':'fantasy-mage',
  'fantasy_obsidian_crown':  'fantasy-paladin',
  'fantasy_goblin_warband_league':'fantasy-goblin',
  'fantasy_pantheon_priesthood':'fantasy-mage',
  // Superhero
  // (faction ids vary; default falls to superhero-baseline)
  // Sovereign-Ruins
  // (default sovereign-archivist)
  // Lattice + Frontier — defaults.
  // Hub
};

/* ── Deterministic seeded helpers ─────────────────────────────────── */

function _hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = ((h ^ str.charCodeAt(i)) * 16777619) >>> 0;
  }
  return h >>> 0;
}

function _seededPick<T>(arr: readonly T[], seed: number, salt: number): T {
  if (!arr || arr.length === 0) throw new Error('empty pick');
  return arr[((seed + salt * 2654435761) >>> 0) % arr.length];
}

function _seededFloat(seed: number, salt: number): number {
  return (((seed + salt * 2654435761) >>> 0) / 0xffffffff);
}

/* ── Deterministic appearance generator ───────────────────────────── */

/**
 * Generate a deterministic RichAppearanceConfig for an NPC. Same id +
 * worldId + factionId always produces the same character (so the
 * authored Aldra Sahm always looks like Aldra Sahm; the procedurally
 * spawned bandit_42 always looks the same too).
 *
 * Inputs the caller knows:
 *   - id            (npc id; primary entropy source)
 *   - worldId       (drives theme + biome bias)
 *   - factionId     (drives FactionStyle lookup)
 *   - archetype     (warrior / scholar / civilian — biases carry + scars)
 *   - themeId       (resolved from worldId via themeForWorldId)
 *   - heroMesh      (set true for named characters with a GLB on disk)
 *   - factionVisual (authored faction colors — overrides the style's
 *                    generic clothingPalette; from
 *                    content/world/<w>/factions.json `visual` block)
 *   - npcAppearanceText (authored prose; used as a hint surface so
 *                    downstream code knows the canon description; the
 *                    procedural mesh ignores it for now)
 *   - override      (authored RichAppearanceConfig fields win over
 *                    generated ones — set any field here to pin it)
 */
export function generateAppearance(opts: {
  id: string;
  worldId: string;
  factionId?: string | null;
  archetype?: string | null;
  themeId: ConcordiaThemeId;
  heroMesh?: boolean;
  factionVisual?: {
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
  } | null;
  npcAppearanceText?: string | null;
  override?: Partial<RichAppearanceConfig>;
}): RichAppearanceConfig {
  const { id, worldId, factionId = null, archetype, themeId, heroMesh, factionVisual, npcAppearanceText, override } = opts;
  const seed = _hash(`${worldId}::${factionId ?? '_'}::${id}`);

  // Wave 5a — authored appearance fidelity. The macro ships the NPC's authored
  // description (prose OR structured) as `npcAppearanceText`; parse it into a
  // patch of palette KEYS + appendable arrays. Authored keys win below
  // (`authored.x ?? hashSeeded`); markings/augments/scars/carry APPEND; the
  // hash stays the fallback for everything the author didn't specify. Pure +
  // total — an un-authored NPC yields {} → byte-identical to the prior output.
  const authored = parseAuthoredAppearance(npcAppearanceText);

  const styleId = (factionId && FACTION_TO_STYLE[factionId])
    || DEFAULT_STYLE_FOR_THEME[themeId]
    || 'concordia-civic';
  const style = FACTION_STYLES[styleId];

  /* Body archetype + height */
  const bodyArchetype = authored.bodyArchetype ?? _seededPick(style.bodyBias, seed, 1);
  const heightBand = { slim: 1.74, average: 1.75, stocky: 1.65, tall: 1.92, broad: 1.80, petite: 1.55, legend: 2.10 }[bodyArchetype];
  const heightJitter = (_seededFloat(seed, 2) - 0.5) * 0.10; // ±5cm
  const totalHeight = heightBand + heightJitter;
  const proportions = proportionsFor(bodyArchetype, totalHeight);

  /* Heritage + skin (authored heritage wins; hex resolved from the key) */
  const heritage = authored.heritage ?? _seededPick(style.heritageBias, seed, 3);
  const skinVariants = FITZPATRICK_SKIN[heritage];
  const skinColor = _seededPick(skinVariants, seed, 4);

  /* Hair */
  const hairColorKey = authored.hairColorKey ?? _seededPick(style.hairBias, seed, 5);
  const hairColor = _seededPick(HAIR_PALETTE[hairColorKey], seed, 6);
  const hairStyle = authored.hairStyle ?? _seededPick(style.hairStyles, seed, 7);

  /* Eyes */
  const eyeKeys = (['brown', 'brown', 'brown', 'dark_brown', 'hazel', 'amber', 'green', 'blue', 'light_blue', 'grey'] as EyeColorKey[]);
  const eyeColorKey = authored.eyeColorKey ?? (bodyArchetype === 'legend'
    ? (_seededFloat(seed, 8) > 0.5 ? 'refusal_gold' : 'drift_violet')
    : _seededPick(eyeKeys, seed, 8));
  const eyeColor = EYE_PALETTE[eyeColorKey];

  /* Facial features */
  const ageRoll = _seededFloat(seed, 9);
  const age: FacialFeatures['age'] = ageRoll < 0.08 ? 'youth' : ageRoll < 0.92 ? 'adult' : 'elder';
  const weatheringRoll = _seededFloat(seed, 10);
  const weathering: FacialFeatures['weathering'] =
    archetype === 'warrior' || archetype === 'hunter' || archetype === 'guard'
      ? weatheringRoll < 0.5 ? 'weathered' : 'scarred'
      : weatheringRoll < 0.6 ? 'fresh' : weatheringRoll < 0.9 ? 'weathered' : 'sun-baked';
  const facial: FacialFeatures = {
    jawShape:   authored.facialPatch?.jawShape ?? _seededPick(['round', 'square', 'pointed', 'soft'] as const, seed, 11),
    eyeShape:   _seededPick(['almond', 'round', 'narrow', 'wide'] as const, seed, 12),
    noseShape:  authored.facialPatch?.noseShape ?? _seededPick(['straight', 'aquiline', 'broad', 'snub', 'narrow'] as const, seed, 13),
    browWeight: _seededPick(['thin', 'medium', 'medium', 'heavy'] as const, seed, 14),
    freckles:   heritage === 'pale' || heritage === 'fair' ? _seededFloat(seed, 15) * 0.6 : 0,
    age:        authored.facialPatch?.age ?? age,
    weathering: authored.facialPatch?.weathering ?? weathering,
    // hash-seeded scar (when weathered=scarred) + any authored scars appended.
    scars: [
      ...(weathering === 'scarred' ? [{ region: 'face', kind: 'slash' } as const] : []),
      ...(authored.scars ?? []),
    ],
  };

  /* Clothing — when the authoring layer supplied a faction `visual`
   * block, prefer it so the faction's heraldry surfaces consistently
   * across every NPC of that faction. Mix in 1-2 colors from the
   * generic style palette so we don't get monochrome NPCs. */
  const effectivePalette = (() => {
    if (!factionVisual) return style.clothingPalette;
    const authored = [
      factionVisual.primary_color,
      factionVisual.secondary_color,
      factionVisual.accent_color,
    ].filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c));
    if (authored.length === 0) return style.clothingPalette;
    return [...authored, ...style.clothingPalette.slice(0, 3)];
  })();

  const topColor    = factionVisual?.primary_color   || _seededPick(effectivePalette, seed, 20);
  const bottomColor = factionVisual?.secondary_color || _seededPick(effectivePalette, seed, 21);
  const hat = _seededPick(style.hats, seed, 22);
  const hatColor = hat ? (factionVisual?.accent_color || _seededPick(effectivePalette, seed, 23)) : null;
  const bootKind = _seededPick(style.boots, seed, 24);
  const clothing: ClothingKit = {
    top:    { color: topColor, kind: _seededPick(style.tops, seed, 25) },
    bottom: { color: bottomColor, kind: _seededPick(style.bottoms, seed, 26) },
    hat: hat && hatColor ? { color: hatColor, kind: hat } : undefined,
    boots: { color: _seededPick(style.clothingPalette, seed, 27), kind: bootKind },
  };
  // Capes — heroic / authority figures get one ~40% of the time.
  if (bodyArchetype === 'legend' || archetype === 'commander' || archetype === 'mystic') {
    if (_seededFloat(seed, 28) > 0.4) {
      clothing.cape = { color: _seededPick(style.clothingPalette, seed, 29), pattern: bodyArchetype === 'legend' ? 'glyph' : 'plain' };
    }
  }

  /* Accessories */
  const jewelryPool: Accessories['jewelry'] = ['earrings', 'necklace', 'arm-bands', 'rings', 'nose-ring', 'lip-ring'];
  const jewelry: Accessories['jewelry'] = [];
  for (let i = 0; i < 2; i++) {
    if (_seededFloat(seed, 30 + i) < 0.45) {
      jewelry.push(_seededPick(jewelryPool, seed, 31 + i));
    }
  }
  const markingCount = _seededFloat(seed, 35) < 0.4 ? 1 : 0;
  const markings: Accessories['markings'] = [];
  if (markingCount > 0 && style.markings.length > 0) {
    markings.push({
      kind: _seededPick(style.markings, seed, 36),
      region: _seededPick(['face', 'arms', 'torso', 'back'] as const, seed, 37),
      color: _seededPick(style.clothingPalette, seed, 38),
    });
  }
  const carry: Accessories['carry'] = [...(style.carryDefault || [])];
  // Archetype-driven carry override.
  if (archetype === 'warrior' && !carry.includes('sword')) carry.unshift('sword');
  if (archetype === 'mystic' && !carry.includes('staff'))  carry.unshift('staff');
  if (archetype === 'guard'   && !carry.includes('sword')) carry.unshift('sword');
  if (archetype === 'hunter'  && !carry.includes('bow'))   carry.unshift('bow');
  if (archetype === 'scholar' && !carry.includes('tome'))  carry.unshift('tome');

  const augments: Accessories['augments'] = [];
  if (style.augmentChance > 0 && _seededFloat(seed, 40) < style.augmentChance) {
    const region = _seededPick(['left-arm', 'right-arm', 'eye'] as const, seed, 41);
    const material = _seededPick(['chrome', 'matte-black', 'gold'] as const, seed, 42);
    augments.push({ region, material });
  }

  // Append any authored markings / augments / carry (dedup), so an authored
  // scar-glyph or chrome arm or named weapon surfaces alongside the hash-seeded
  // accessories rather than replacing them.
  for (const m of authored.markings ?? []) {
    if (!markings.some((x) => x.kind === m.kind && x.region === m.region)) markings.push(m);
  }
  for (const a of authored.augments ?? []) {
    if (!augments.some((x) => x.region === a.region && x.material === a.material)) augments.push(a);
  }
  for (const c of authored.carry ?? []) {
    if (!carry.includes(c)) carry.unshift(c);
  }

  const accessories: Accessories = { jewelry, markings, carry, augments };

  return {
    bodyArchetype,
    totalHeight,
    proportions,
    heritage,
    skinColor,
    hairColor,
    hairColorKey,
    hairStyle,
    eyeColor,
    eyeColorKey,
    facial,
    clothing,
    accessories,
    worldId,
    factionId,
    cultureTags: [styleId, ...(factionId ? [factionId] : [])],
    heroMesh: !!heroMesh,
    ...override,
  };
}

/* ── Back-compat adapter for the existing AvatarSystem3D.AppearanceConfig ── */

/**
 * The existing AvatarSystem3D consumes a narrower AppearanceConfig
 * (5 body types, 6 hair styles, simpler clothing kinds). Project the
 * rich schema down to that subset so we can keep the existing
 * procedural mesh builder working while gaining richer character
 * authoring.
 */
export interface LegacyAppearanceConfig {
  skinColor: string;
  hairColor: string;
  hairStyle: 'short' | 'medium' | 'long' | 'bald' | 'ponytail' | 'bun';
  bodyType: 'slim' | 'average' | 'stocky' | 'tall' | 'legend';
  clothing: {
    top: { color: string; type: 'shirt' | 'vest' | 'coat' | 'robe' | 'apron' };
    bottom: { color: string; type: 'pants' | 'skirt' | 'shorts' | 'robe' };
    hat?: { color: string; type: 'cap' | 'tophat' | 'beret' | 'hood' | 'helmet' };
  };
}

export function toLegacyAppearance(rich: RichAppearanceConfig): LegacyAppearanceConfig {
  // Body type — map broad/petite to closest existing types.
  const bodyType: LegacyAppearanceConfig['bodyType'] =
    rich.bodyArchetype === 'broad'  ? 'stocky' :
    rich.bodyArchetype === 'petite' ? 'slim'   :
    rich.bodyArchetype as LegacyAppearanceConfig['bodyType'];

  // Hair style — collapse the richer set into the legacy 6.
  const hairStyle: LegacyAppearanceConfig['hairStyle'] =
    rich.hairStyle === 'bald' || rich.hairStyle === 'shaved' ? 'bald' :
    rich.hairStyle === 'braids' || rich.hairStyle === 'locs' || rich.hairStyle === 'dreads' || rich.hairStyle === 'mohawk' ? 'medium' :
    rich.hairStyle === 'topknot' || rich.hairStyle === 'undercut' ? 'short' :
    rich.hairStyle === 'ponytail' ? 'ponytail' :
    rich.hairStyle === 'bun'      ? 'bun'      :
    rich.hairStyle as 'short' | 'medium' | 'long';

  // Top kind — collapse to legacy 5.
  const topKind: LegacyAppearanceConfig['clothing']['top']['type'] =
    rich.clothing.top.kind === 'tunic' || rich.clothing.top.kind === 'shirt' ? 'shirt' :
    rich.clothing.top.kind === 'cassock' || rich.clothing.top.kind === 'robe' ? 'robe' :
    rich.clothing.top.kind === 'jacket' || rich.clothing.top.kind === 'synth-jacket' || rich.clothing.top.kind === 'trench' || rich.clothing.top.kind === 'duster' || rich.clothing.top.kind === 'coat' || rich.clothing.top.kind === 'cape' ? 'coat' :
    rich.clothing.top.kind === 'apron' || rich.clothing.top.kind === 'breastplate' ? 'apron' :
    'vest';

  const bottomKind: LegacyAppearanceConfig['clothing']['bottom']['type'] =
    rich.clothing.bottom.kind === 'pants' || rich.clothing.bottom.kind === 'trousers' || rich.clothing.bottom.kind === 'cargo' || rich.clothing.bottom.kind === 'leather-pants' || rich.clothing.bottom.kind === 'breeches' || rich.clothing.bottom.kind === 'leggings' ? 'pants' :
    rich.clothing.bottom.kind === 'skirt' || rich.clothing.bottom.kind === 'kilt' || rich.clothing.bottom.kind === 'sarong' ? 'skirt' :
    rich.clothing.bottom.kind === 'robe' ? 'robe' :
    'shorts';

  const hatKind: LegacyAppearanceConfig['clothing']['hat'] | undefined = rich.clothing.hat ? {
    color: rich.clothing.hat.color,
    type:
      rich.clothing.hat.kind === 'cap' || rich.clothing.hat.kind === 'visor' || rich.clothing.hat.kind === 'goggle' ? 'cap' :
      rich.clothing.hat.kind === 'tophat' ? 'tophat' :
      rich.clothing.hat.kind === 'beret' || rich.clothing.hat.kind === 'wreath' || rich.clothing.hat.kind === 'circlet' || rich.clothing.hat.kind === 'crown' ? 'beret' :
      rich.clothing.hat.kind === 'hood' || rich.clothing.hat.kind === 'turban' ? 'hood' :
      rich.clothing.hat.kind === 'helmet' || rich.clothing.hat.kind === 'horned-helm' || rich.clothing.hat.kind === 'fedora' ? 'helmet' :
      'cap',
  } : undefined;

  return {
    skinColor: rich.skinColor,
    hairColor: rich.hairColor,
    hairStyle,
    bodyType,
    clothing: {
      top:    { color: rich.clothing.top.color,    type: topKind },
      bottom: { color: rich.clothing.bottom.color, type: bottomKind },
      hat: hatKind,
    },
  };
}

/* ── PBR material reference (physically-based.info values) ────────── */

/**
 * Reference PBR values for the material types the renderer uses. Real-
 * world reference from physicallybased.info — we don't need to hit the
 * web at render time, the values are constants.
 */
export const PBR_REFERENCE = {
  skin:    { roughness: 0.65, metalness: 0.0, sss: 0.4 },   // SSS shader hook
  hair:    { roughness: 0.55, metalness: 0.0 },
  cotton:  { roughness: 0.85, metalness: 0.0 },
  wool:    { roughness: 0.95, metalness: 0.0 },
  leather: { roughness: 0.55, metalness: 0.0 },
  silk:    { roughness: 0.35, metalness: 0.0 },
  iron:    { roughness: 0.35, metalness: 1.0 },
  steel:   { roughness: 0.25, metalness: 1.0 },
  bronze:  { roughness: 0.40, metalness: 1.0 },
  chrome:  { roughness: 0.05, metalness: 1.0 },
  marble:  { roughness: 0.40, metalness: 0.0 },
  stone:   { roughness: 0.90, metalness: 0.0 },
  wood:    { roughness: 0.85, metalness: 0.0 },
  glass:   { roughness: 0.10, metalness: 0.0, transmission: 0.95 },
  emissive_glyph: { roughness: 0.40, metalness: 0.0, emissiveIntensity: 0.6 },
} as const;
