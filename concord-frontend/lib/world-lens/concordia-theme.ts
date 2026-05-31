/**
 * Concordia Theme System
 *
 * Per-canon-world color palettes derived from each world's lore. Each
 * canon world has its own theme so /lenses/world LOOKS different when
 * the player crosses through Concord Link. The theme drives fog, sun
 * + ambient light, portal/lamp glow, sky gradient, toon shading, and
 * a swatch the theme-picker UI uses.
 *
 * Aesthetic target — Biomutant × BOTW × Skyrim cross:
 *   - Cel-shaded base with a 3-stop toon gradient (BOTW)
 *   - Saturated post-apoc palettes per biome (Biomutant)
 *   - Material grounding via PBR for the player + named NPCs (Skyrim)
 *
 * Visual gaps (still): no skybox texture, no proper sun disk (pinned
 * to position), no GLB hero meshes shipped. The infra to load them is
 * in lib/world-lens/asset-loader.ts and lib/concordia/hero-mesh-registry.ts —
 * dropping /public/meshes/heroes/<id>.glb is the path to higher fidelity.
 */

export type ConcordiaThemeId =
  | 'neon-punk'
  | 'classic'
  | 'minimal'
  // Canon-world themes (one per world).
  | 'tunya'
  | 'cyber'
  | 'crime'
  | 'fantasy'
  | 'superhero'
  | 'sovereign-ruins'
  | 'lattice-crucible'
  | 'concord-link-frontier'
  | 'concordia-hub';

export interface ConcordiaTheme {
  id:           ConcordiaThemeId;
  label:        string;
  /** Short lore-derived blurb for the theme picker tooltip. */
  blurb:        string;
  /** CSS color for the picker dot. */
  swatch:       string;
  fog:          { color: number; near: number; far: number };
  ambientLight: { color: number; intensity: number };
  sunLight:     { color: number; intensity: number };
  /** Hex color for the 5 portal-glow point lights (anchors). */
  portalGlow:   number;
  /** Hex color for the 3 street-lamp point lights. */
  streetLamp:   number;
  skyTop:       number;
  skyHorizon:   number;
  /** Toon shading 3-stop gradient: [shadow, mid, highlight]. */
  toonGradient: [string, string, string];
  /**
   * Default ground palette index — points the BiomeStyleRegistry to a
   * keyed entry. Used when the renderer doesn't have explicit biome
   * info for a tile.
   */
  groundKey:    string;
  /**
   * Atmospheric particle bias. Drives ambient dust/leaves/embers
   * particles in SkyWeatherRenderer when set. 0 = off; 1 = pronounced.
   */
  atmosphere:   {
    dust?:    number;
    embers?:  number;
    leaves?:  number;
    fireflies?: number;
    pollen?:  number;
    snow_motes?: number;
  };
  /**
   * Weather profile bias — how often each weather type fires. Reads
   * by the world-event-scheduler; absent fields default to neutral.
   */
  weatherProfile?: Partial<Record<'clear' | 'rain' | 'snow' | 'storm' | 'overcast' | 'fog' | 'sandstorm', number>>;
  /**
   * T3.3 — sun/moon disk in the sky. Renders a billboarded glowing disk so the
   * sky reads as a real dome, not a flat gradient. `elevationDeg`/`azimuthDeg`
   * place it; `color`/`sizeM` style it; `glow` is the halo strength 0..1.
   * Optional — themes without it get a sensible disk derived from sunLight.
   */
  sunDisk?: {
    color: number;
    sizeM: number;
    elevationDeg: number;
    azimuthDeg: number;
    glow: number;
  };
  /**
   * T3.3 — per-world building silhouette. Drives the building renderer's mesh
   * proportions + material so cyber reads neon-vertical and crime noir-lowrise
   * instead of every world sharing one block style. Material/proportion only —
   * no GLB pipeline dependency.
   */
  buildingStyle?:
    | 'neon-tower'      // tall, thin, emissive edges (cyber)
    | 'noir-lowrise'    // squat brick, few windows, muted (crime)
    | 'ruins-marble'    // broken columns, weathered stone (sovereign-ruins)
    | 'frontier-timber' // low timber + thatch (tunya/frontier)
    | 'arcology'        // clean white megastructure (superhero/minimal)
    | 'fantasy-stone'   // turreted stone + banners (fantasy/classic)
    | 'default';
}

/**
 * Per-world theme registry.
 *
 * Notes on the lore each palette tries to evoke:
 *
 * - **tunya** — post-arrival pre-industrial planet. Africa-first arrivals;
 *   sun-baked highlands, ark ruins fused into cliffs. Copper + ochre +
 *   burnt orange. Long golden-hour light. Atmosphere has dust + a few
 *   embers from bloodline forges.
 * - **cyber** — neon-lit megacity, networks, hologram bleed. Magenta /
 *   cyan, oily street reflections. Atmosphere has dust + fireflies (LED
 *   drift). Rain weighted higher.
 * - **crime** — noir modern city. Muted browns + slate. Wet streets,
 *   sodium lamps. Atmosphere dim. Rain weighted highest.
 * - **fantasy** — high fantasy, abundant magic. Skyrim-class — cool
 *   blue-green forests, snowy peaks, sun-shafts through mist. Atmosphere
 *   has fireflies + pollen.
 * - **superhero** — modern Manhattan. Clean sky, bright daylight,
 *   bio-plasma glints. Atmosphere clean. Clear weighted highest.
 * - **sovereign-ruins** — post-collapse archive. Dust motes in eternal
 *   golden hour. Faded marble, copper patina. Atmosphere heavy with
 *   dust; fog weighted high.
 * - **lattice-crucible** — drift-dense procgen world. Shifting purples
 *   and teals. Atmosphere has shimmer/embers. Storm weighted high.
 * - **concord-link-frontier** — peer mesh frontier. Prairie pastels,
 *   golden grasses, big sky. Atmosphere has pollen + leaves.
 * - **concordia-hub** — the walled city under Concordant Law. Roman /
 *   Athenian marble white, olive, warm patina. Atmosphere has dust +
 *   fireflies at dusk. Weather skews clear.
 */
export const CONCORDIA_THEMES: Record<ConcordiaThemeId, ConcordiaTheme> = {
  'neon-punk': {
    id: 'neon-punk',
    label: 'Neon Punk',
    blurb: 'Default neon-noir. Used as fallback for un-themed worlds.',
    swatch: '#6366f1',
    fog:          { color: 0x0d0d1a, near: 40, far: 200 },
    ambientLight: { color: 0x1a1a3a, intensity: 0.6 },
    sunLight:     { color: 0xffd4a0, intensity: 1.2 },
    portalGlow:   0x6366f1,
    streetLamp:   0xffd580,
    skyTop:       0x050510,
    skyHorizon:   0x1a0a2e,
    toonGradient: ['#0d0d2a', '#3a3a6a', '#8888cc'],
    groundKey: 'asphalt',
    atmosphere: { dust: 0.4, fireflies: 0.3 },
  },
  'classic': {
    id: 'classic',
    label: 'Classic',
    blurb: 'Warm parchment-and-sun. Generic medieval daylight.',
    swatch: '#e8c97a',
    fog:          { color: 0xd4c8a8, near: 50, far: 250 },
    ambientLight: { color: 0xfff4e0, intensity: 0.8 },
    sunLight:     { color: 0xffe8b0, intensity: 1.4 },
    portalGlow:   0xe8c97a,
    streetLamp:   0xffa040,
    skyTop:       0x87ceeb,
    skyHorizon:   0xf0e8c8,
    toonGradient: ['#4a3820', '#8a6a40', '#f0d890'],
    groundKey: 'cobblestone',
    atmosphere: { dust: 0.2 },
  },
  'minimal': {
    id: 'minimal',
    label: 'Minimal',
    blurb: 'Flat white. For UI capture + screenshots.',
    swatch: '#94a3b8',
    fog:          { color: 0xe8ecf0, near: 60, far: 300 },
    ambientLight: { color: 0xffffff, intensity: 1.0 },
    sunLight:     { color: 0xffffff, intensity: 1.5 },
    portalGlow:   0x60a5fa,
    streetLamp:   0xe2e8f0,
    skyTop:       0xdbeafe,
    skyHorizon:   0xf8fafc,
    toonGradient: ['#cccccc', '#e8e8e8', '#ffffff'],
    groundKey: 'concrete',
    atmosphere: {},
  },

  /* ── Canon-world themes ─────────────────────────────────────── */

  'tunya': {
    id: 'tunya',
    label: 'Tunya',
    blurb: 'Sun-baked highlands, ark ruins, bloodline forges. Long golden hour.',
    swatch: '#c8721a',
    fog:          { color: 0xf0c08a, near: 60, far: 280 },
    ambientLight: { color: 0xfff0d0, intensity: 0.85 },
    sunLight:     { color: 0xffb060, intensity: 1.6 },
    portalGlow:   0xff8030,  // bloodline-forge embers
    streetLamp:   0xffa040,
    skyTop:       0x6ab4d4,  // dusty blue
    skyHorizon:   0xf5c068,  // ochre band
    toonGradient: ['#3a1a08', '#a05028', '#ffd070'],
    groundKey: 'sand_savanna',
    atmosphere: { dust: 0.6, embers: 0.25 },
    weatherProfile: { clear: 0.55, sandstorm: 0.15, overcast: 0.15, rain: 0.10, storm: 0.05 },
  },

  'cyber': {
    id: 'cyber',
    label: 'The Grid',
    blurb: 'Neon megacity. Hologram bleed, oily reflections, ambient hum.',
    swatch: '#ff2bd5',
    fog:          { color: 0x180830, near: 30, far: 180 },
    ambientLight: { color: 0x3a1850, intensity: 0.55 },
    sunLight:     { color: 0xa080ff, intensity: 0.7 },
    portalGlow:   0xff2bd5,  // magenta
    streetLamp:   0x30e8ff,  // cyan
    skyTop:       0x0a0218,
    skyHorizon:   0x4a1078,
    toonGradient: ['#0a0218', '#481a78', '#ff80f0'],
    groundKey: 'wet_asphalt',
    atmosphere: { fireflies: 0.7, dust: 0.3 },  // 'fireflies' = LED motes
    weatherProfile: { rain: 0.45, overcast: 0.30, clear: 0.15, storm: 0.10 },
  },

  'crime': {
    id: 'crime',
    label: 'Crime World',
    blurb: 'Noir city. Sodium lamps, rain on pavement, long shadows.',
    swatch: '#5c4030',
    fog:          { color: 0x2a2018, near: 35, far: 200 },
    ambientLight: { color: 0x40342a, intensity: 0.6 },
    sunLight:     { color: 0xc8b890, intensity: 0.9 },
    portalGlow:   0xffb050,
    streetLamp:   0xffa030,
    skyTop:       0x1a1612,
    skyHorizon:   0x4a3a28,
    toonGradient: ['#15110c', '#3a2c20', '#a08c70'],
    groundKey: 'wet_asphalt',
    atmosphere: { dust: 0.4 },
    weatherProfile: { rain: 0.50, overcast: 0.30, fog: 0.10, clear: 0.10 },
  },

  'fantasy': {
    id: 'fantasy',
    label: 'The Sundering',
    blurb: 'High fantasy. Cool forests, snowy peaks, sun-shafts through mist.',
    swatch: '#3a8a5c',
    fog:          { color: 0xb8d4d0, near: 70, far: 320 },
    ambientLight: { color: 0xc8e0e0, intensity: 0.9 },
    sunLight:     { color: 0xfff0d0, intensity: 1.3 },
    portalGlow:   0x60ffc0,  // arcane green
    streetLamp:   0xffd070,
    skyTop:       0x4a78a8,
    skyHorizon:   0xc8d8e0,
    toonGradient: ['#1a3028', '#487058', '#c8e8b8'],
    groundKey: 'wild_grass',
    atmosphere: { fireflies: 0.5, pollen: 0.4 },
    weatherProfile: { clear: 0.35, snow: 0.25, overcast: 0.20, rain: 0.15, storm: 0.05 },
  },

  'superhero': {
    id: 'superhero',
    label: 'The Superhero City',
    blurb: 'Clean Manhattan daylight. Glass towers, bio-plasma glints.',
    swatch: '#3a78ff',
    fog:          { color: 0xc0d8f0, near: 80, far: 360 },
    ambientLight: { color: 0xe0ecff, intensity: 1.0 },
    sunLight:     { color: 0xfff8e0, intensity: 1.5 },
    portalGlow:   0xa860ff,  // bio-plasma purple
    streetLamp:   0xffe0a0,
    skyTop:       0x60a8d8,
    skyHorizon:   0xe8f0f8,
    toonGradient: ['#283848', '#7898b8', '#e8f0f8'],
    groundKey: 'concrete',
    atmosphere: {},
    weatherProfile: { clear: 0.60, overcast: 0.20, rain: 0.15, storm: 0.05 },
  },

  'sovereign-ruins': {
    id: 'sovereign-ruins',
    label: 'The Sovereign Ruins',
    blurb: 'Faded marble in eternal golden hour. Dust motes, copper patina.',
    swatch: '#b89060',
    fog:          { color: 0xd8c090, near: 50, far: 220 },
    ambientLight: { color: 0xfff0d0, intensity: 0.75 },
    sunLight:     { color: 0xffc880, intensity: 1.2 },
    portalGlow:   0xd0a058,  // refusal-glyph gold
    streetLamp:   0xc8a060,
    skyTop:       0xc8b478,
    skyHorizon:   0xf0d090,
    toonGradient: ['#382818', '#806040', '#f0d8a8'],
    groundKey: 'marble',
    atmosphere: { dust: 0.85, fireflies: 0.15 },
    weatherProfile: { clear: 0.40, fog: 0.30, overcast: 0.25, rain: 0.05 },
  },

  'lattice-crucible': {
    id: 'lattice-crucible',
    label: 'The Crucible',
    blurb: 'Drift-dense. Shifting purples and teals, geometry that flickers.',
    swatch: '#a060ff',
    fog:          { color: 0x301850, near: 35, far: 220 },
    ambientLight: { color: 0x402068, intensity: 0.7 },
    sunLight:     { color: 0xe0a8ff, intensity: 1.0 },
    portalGlow:   0x20ffd0,  // teal drift
    streetLamp:   0xa060ff,  // violet
    skyTop:       0x180838,
    skyHorizon:   0x682878,
    toonGradient: ['#100828', '#503088', '#d0a8ff'],
    groundKey: 'drift_glass',
    atmosphere: { embers: 0.55, fireflies: 0.45, dust: 0.35 },
    weatherProfile: { storm: 0.30, overcast: 0.25, clear: 0.20, fog: 0.15, rain: 0.10 },
  },

  'concord-link-frontier': {
    id: 'concord-link-frontier',
    label: 'The Frontier',
    blurb: 'Prairie pastels, golden grasses, big sky. Mesh towers in silhouette.',
    swatch: '#d8b878',
    fog:          { color: 0xe0d0a0, near: 80, far: 340 },
    ambientLight: { color: 0xfff0d8, intensity: 0.9 },
    sunLight:     { color: 0xfff0c0, intensity: 1.45 },
    portalGlow:   0x88c0ff,
    streetLamp:   0xffc878,
    skyTop:       0x80b8e0,
    skyHorizon:   0xf0e0a8,
    toonGradient: ['#403018', '#a08858', '#f8e8a8'],
    groundKey: 'prairie_grass',
    atmosphere: { pollen: 0.7, leaves: 0.35, dust: 0.25 },
    weatherProfile: { clear: 0.45, overcast: 0.20, rain: 0.20, storm: 0.10, fog: 0.05 },
  },

  'concordia-hub': {
    id: 'concordia-hub',
    label: 'Concordia',
    blurb: 'The walled city. Roman marble, olive groves, warm patina, refusal-field hum.',
    swatch: '#e8d8a8',
    fog:          { color: 0xe0d0a8, near: 90, far: 380 },
    ambientLight: { color: 0xfff8e0, intensity: 0.95 },
    sunLight:     { color: 0xffe8a8, intensity: 1.45 },
    portalGlow:   0xd0c080,  // refusal-glyph gold
    streetLamp:   0xffd890,
    skyTop:       0x80b0e0,
    skyHorizon:   0xf8e8b8,
    toonGradient: ['#403828', '#a08868', '#f8e8c0'],
    groundKey: 'marble',
    atmosphere: { dust: 0.3, fireflies: 0.35, pollen: 0.2 },
    weatherProfile: { clear: 0.65, overcast: 0.20, rain: 0.10, storm: 0.05 },
  },
};

/**
 * Lookup a theme by world id. Falls back to neon-punk when a world isn't
 * registered (forward-compatible — adding a new world without a theme
 * doesn't break the renderer).
 *
 * Also resolves the legacy 'concordia' alias to 'concordia-hub' so old
 * persisted world ids still land on the right theme.
 */
export function themeForWorldId(worldId: string | null | undefined): ConcordiaThemeId {
  if (!worldId) return DEFAULT_THEME_ID;
  if (worldId === 'concordia') return 'concordia-hub';
  // Direct match — every canon world id is also a theme id.
  if (worldId in CONCORDIA_THEMES) return worldId as ConcordiaThemeId;
  return DEFAULT_THEME_ID;
}

/**
 * List of canon-world themes (excludes generic legacy ones). Used by
 * the theme picker UI to show "world-canon" entries first.
 */
export const CANON_WORLD_THEMES: ConcordiaThemeId[] = [
  'concordia-hub',
  'tunya',
  'cyber',
  'crime',
  'fantasy',
  'superhero',
  'sovereign-ruins',
  'lattice-crucible',
  'concord-link-frontier',
];

export const DEFAULT_THEME_ID: ConcordiaThemeId = 'neon-punk';

// ── Art-direction constants (the locked thesis: coherence > fidelity) ──────────
// Stylized sets its own standard; the load-bearing discipline is that EVERY asset
// shares the same language — one outline weight, one ramp-band count, one
// grounded↔cartoon dial — across all 9 worlds, differing only by PALETTE +
// SATURATION per world. These are the single source of truth the cel-shade +
// outline render passes read, so nothing drifts per-component. See
// docs/ART_STYLE_GUIDE.md for the full rules.
export const ART_STYLE = Object.freeze({
  /** Inverted-hull / edge-outline thickness in metres (one weight for everything). */
  OUTLINE_WIDTH_M: 0.018,
  /** Toon ramp band count — every toonGradient is sampled at exactly this many steps. */
  RAMP_BANDS: 3,
  /** 0 = fully cartoon (flat, high-key), 1 = fully grounded (PBR-ish). BotW sits ~0.45. */
  GROUNDED_DIAL: 0.45,
  /** Outline darkness (multiplier on the shadow band) — shared so silhouettes read alike. */
  OUTLINE_DARKEN: 0.35,
});

// Per-world saturation philosophy (multiplier applied to base albedo/lighting).
// Neon worlds push past 1.0; noir/ruin worlds pull below. This is what lets
// "same rules, different palette" read as 9 distinct moods without 9 art styles.
export const WORLD_SATURATION: Record<ConcordiaThemeId, number> = {
  'concordia-hub': 1.0,
  tunya: 1.05,
  cyber: 1.35,
  crime: 0.62,
  fantasy: 1.12,
  superhero: 1.25,
  'sovereign-ruins': 0.8,
  'lattice-crucible': 1.15,
  'concord-link-frontier': 0.95,
  // legacy / alias theme ids fall back to 1.0 via saturationForWorld().
} as Record<ConcordiaThemeId, number>;

/** Saturation multiplier for a world (defaults to 1.0 for un-tabled themes). */
export function saturationForWorld(worldId: string | null | undefined): number {
  const id = themeForWorldId(worldId);
  return WORLD_SATURATION[id] ?? 1.0;
}

// ── T3.3 — per-world silhouette resolvers ───────────────────────────────────

type BuildingStyle = NonNullable<ConcordiaTheme['buildingStyle']>;

// Canonical building silhouette per theme. A theme may also set `buildingStyle`
// inline (which wins); this table is the lore-derived default so every world
// reads distinct without editing all 12 entries.
const BUILDING_STYLE_BY_THEME: Record<ConcordiaThemeId, BuildingStyle> = {
  'neon-punk':             'neon-tower',
  'cyber':                 'neon-tower',
  'crime':                 'noir-lowrise',
  'sovereign-ruins':       'ruins-marble',
  'tunya':                 'frontier-timber',
  'concord-link-frontier': 'frontier-timber',
  'superhero':             'arcology',
  'minimal':               'arcology',
  'fantasy':               'fantasy-stone',
  'classic':               'fantasy-stone',
  'lattice-crucible':      'neon-tower',
  'concordia-hub':         'fantasy-stone',
};

// Per-style proportions + material the building renderer reads. heightMul/
// widthMul scale the base box; emissive drives edge glow; roughness/metalness
// style the material; windowDensity tunes the window-light shader.
export interface BuildingStyleSpec {
  style: BuildingStyle;
  heightMul: number;
  widthMul: number;
  emissive: number;        // hex; 0 = none
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  windowDensity: number;   // 0..1
}

const BUILDING_STYLE_SPECS: Record<BuildingStyle, BuildingStyleSpec> = {
  'neon-tower':      { style: 'neon-tower',      heightMul: 1.9, widthMul: 0.7, emissive: 0x18d0ff, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.7, windowDensity: 0.85 },
  'noir-lowrise':    { style: 'noir-lowrise',    heightMul: 0.7, widthMul: 1.2, emissive: 0x000000, emissiveIntensity: 0.0,  roughness: 0.9,  metalness: 0.1, windowDensity: 0.25 },
  'ruins-marble':    { style: 'ruins-marble',    heightMul: 0.85, widthMul: 1.1, emissive: 0x000000, emissiveIntensity: 0.0, roughness: 0.95, metalness: 0.0, windowDensity: 0.1 },
  'frontier-timber': { style: 'frontier-timber', heightMul: 0.6, widthMul: 1.05, emissive: 0x000000, emissiveIntensity: 0.0, roughness: 0.85, metalness: 0.05, windowDensity: 0.3 },
  'arcology':        { style: 'arcology',        heightMul: 1.3, widthMul: 1.0, emissive: 0xeaf4ff, emissiveIntensity: 0.12, roughness: 0.25, metalness: 0.4, windowDensity: 0.6 },
  'fantasy-stone':   { style: 'fantasy-stone',   heightMul: 1.0, widthMul: 1.0, emissive: 0x000000, emissiveIntensity: 0.0, roughness: 0.8,  metalness: 0.05, windowDensity: 0.35 },
  'default':         { style: 'default',         heightMul: 1.0, widthMul: 1.0, emissive: 0x000000, emissiveIntensity: 0.0, roughness: 0.7,  metalness: 0.2, windowDensity: 0.4 },
};

/** Resolve the building-style spec for a world (theme inline override wins). */
export function buildingStyleForWorld(worldId: string | null | undefined): BuildingStyleSpec {
  const themeId = themeForWorldId(worldId);
  const inline = CONCORDIA_THEMES[themeId]?.buildingStyle;
  const style = inline || BUILDING_STYLE_BY_THEME[themeId] || 'default';
  return BUILDING_STYLE_SPECS[style] || BUILDING_STYLE_SPECS.default;
}

/**
 * Resolve the sun-disk for a world. Uses the theme's inline `sunDisk` when set,
 * otherwise derives a sensible disk from sunLight color + a mid-elevation so
 * every world gets a real disk in the sky dome.
 */
export function sunDiskForWorld(worldId: string | null | undefined): NonNullable<ConcordiaTheme['sunDisk']> {
  const theme = CONCORDIA_THEMES[themeForWorldId(worldId)] || CONCORDIA_THEMES[DEFAULT_THEME_ID];
  if (theme.sunDisk) return theme.sunDisk;
  return {
    color: theme.sunLight?.color ?? 0xffe8b0,
    sizeM: 60,
    elevationDeg: 38,
    azimuthDeg: 135,
    glow: 0.6,
  };
}
