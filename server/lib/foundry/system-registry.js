// server/lib/foundry/system-registry.js
//
// Foundry — System Registry (Phase 1).
//
// The declarative catalog that turns Concord's ~40 already-built
// systems into composable building blocks. Foundry's whole premise is
// that the systems already exist (terrain, weather, LLM NPCs, combat
// motor, royalty cascade, ...) — what was missing is a description of
// each one *as a part*: what it is, what config it takes, how it
// activates on a world, what it depends on, what it conflicts with.
//
// This file is that description. The Foundry canvas (Phase 4) renders
// the palette + config panels straight off these entries; the publish
// pipeline (Phase 3) reads `activation` to know how to apply each
// system to the target world.
//
// worldScope (from the substrate audit):
//   'world'  — already per-world configurable (the heartbeats iterate
//              per-world; config rides on worlds.rule_modulators /
//              worlds.physics_modulators). The easy majority.
//   'global' — runs once across the whole lattice, not per-world.
//              Still selectable, but the config is advisory + the
//              publish pipeline flags it as a shared system.
//   'player' — attached to players, not worlds; behaviour may be
//              world-aware but ownership is per-player.
//
// status:
//   'available' — exists in the codebase today, wired.
//   'stub'      — does NOT exist yet; built in Phase 7. Shows in the
//                 palette flagged "coming soon" so the catalog is the
//                 single source of truth and Phase 7 just flips the flag.
//
// activation.kind — how the publish pipeline applies the system:
//   'rule_modulator'     — writes config under worlds.rule_modulators[key]
//   'physics_modulator'  — writes config under worlds.physics_modulators[key]
//   'content_seed'       — emits authored content into the world's seed set
//   'heartbeat_optin'    — toggles a per-world heartbeat participation flag
//   'always_on'          — substrate-level, no per-world activation needed

export const CATEGORIES = Object.freeze({
  WORLD: 'world',
  CHARACTER: 'character',
  COMBAT: 'combat',
  NPC: 'npc',
  ECONOMY: 'economy',
  SOCIAL: 'social',
});

export const CATEGORY_LABELS = Object.freeze({
  world: 'World Systems',
  character: 'Character & Progression',
  combat: 'Combat & Action',
  npc: 'NPC & AI Intelligence',
  economy: 'Economy & Creation',
  social: 'Social & Multiplayer',
});

// ── Config-field shorthand ──────────────────────────────────────────────────
// Each system's configSchema is a flat map of field-name -> descriptor.
// Descriptor shape: { type, label, default, ...constraints }
//   type 'enum'   — { options: [...], default }
//   type 'number' — { min, max, step, default }
//   type 'bool'   — { default }
//   type 'text'   — { maxLength, default }
//   type 'range'  — { min, max, default: [lo, hi] }
const f = {
  enum: (label, options, def) => ({ type: 'enum', label, options, default: def ?? options[0] }),
  number: (label, min, max, def, step = 1) => ({ type: 'number', label, min, max, default: def, step }),
  bool: (label, def = false) => ({ type: 'bool', label, default: def }),
  text: (label, maxLength, def = '') => ({ type: 'text', label, maxLength, default: def }),
  range: (label, min, max, def) => ({ type: 'range', label, min, max, default: def }),
};

// ── The catalog ─────────────────────────────────────────────────────────────
export const SYSTEM_REGISTRY = Object.freeze([
  // ===== WORLD SYSTEMS =========================================================
  {
    id: 'terrain-biomes',
    category: CATEGORIES.WORLD,
    displayName: 'Procedural Terrain & Biomes',
    description: 'Seeded heightfield terrain with biome distribution. The 3D renderer reads the terrain config to draw the world.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'physics_modulator', key: 'terrain' },
    configSchema: {
      biomeSet: f.enum('Biome set', ['temperate', 'arid', 'frozen', 'tropical', 'volcanic', 'mixed'], 'mixed'),
      seaLevel: f.number('Sea level', 0, 100, 30),
      ruggedness: f.number('Terrain ruggedness', 0, 100, 50),
      seed: f.text('Terrain seed (blank = random)', 64),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'weather-ecology',
    category: CATEGORIES.WORLD,
    displayName: 'Dynamic Weather & Ecology',
    description: 'The environment-sensor heartbeat writes per-cell climate signals; weather shifts over time and feeds skill/combat env coupling.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'climate' },
    configSchema: {
      baseClimate: f.enum('Base climate', ['temperate', 'desert', 'tundra', 'rainforest', 'storm-locked'], 'temperate'),
      weatherVolatility: f.number('Weather volatility', 0, 100, 40),
      dayNightCycle: f.bool('Day/night cycle', true),
    },
    dependsOn: ['terrain-biomes'],
    conflictsWith: [],
  },
  {
    id: 'fauna-flocks',
    category: CATEGORIES.WORLD,
    displayName: 'Fauna & Creature Flocks',
    description: 'The creature-flock-cycle heartbeat spawns and flocks fauna per world with separation/alignment/cohesion + flee-from-player.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'heartbeat_optin', key: 'fauna' },
    configSchema: {
      density: f.enum('Fauna density', ['sparse', 'moderate', 'abundant'], 'moderate'),
      predators: f.bool('Predator species', true),
      flockingIntensity: f.number('Flocking intensity', 0, 100, 60),
    },
    dependsOn: ['terrain-biomes'],
    conflictsWith: [],
  },
  {
    id: 'seasons',
    category: CATEGORIES.WORLD,
    displayName: 'Seasons & Long-Cycle Time',
    description: 'Six-season 42-day world year with per-season temperature/yield bias. The season-cycle heartbeat advances it.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'heartbeat_optin', key: 'seasons' },
    configSchema: {
      yearLengthDays: f.number('World-year length (days)', 6, 120, 42),
      startingSeason: f.enum('Starting season', ['spring', 'high-summer', 'harvest', 'fade', 'deep-winter', 'thaw'], 'spring'),
    },
    dependsOn: ['weather-ecology'],
    conflictsWith: [],
  },
  {
    id: 'physics-modifiers',
    category: CATEGORIES.WORLD,
    displayName: 'Per-World Physics',
    description: 'Gravity, water density, and movement tuning. Written to physics_modulators and consumed by the Rapier physics world.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'physics_modulator', key: 'movement' },
    configSchema: {
      gravity: f.number('Gravity (% of Earth)', 10, 300, 100),
      waterDensity: f.number('Water density', 50, 200, 100),
      jumpHeight: f.number('Jump height (%)', 25, 400, 100),
      glideEnabled: f.bool('Gliding enabled', true),
      swimEnabled: f.bool('Swimming enabled', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'size-scaling',
    category: CATEGORIES.WORLD,
    displayName: 'Size Scaling (Ant-Man / Giant)',
    description: 'Player size as a core loop — shrink for stealth/flight access, grow for destruction/reach. Render scale + physics scale + combat scale.',
    worldScope: 'world',
    status: 'available', // Phase 7 — built: server/lib/foundry/size-scaling.js
    activation: { kind: 'rule_modulator', key: 'size_scaling' },
    configSchema: {
      minScale: f.number('Minimum scale (%)', 5, 100, 15),
      maxScale: f.number('Maximum scale (%)', 100, 2000, 800),
      smallGrantsFlight: f.bool('Small size grants flight access', true),
      largeGrantsDestruction: f.bool('Large size grants structure destruction', true),
      scaleChangeCost: f.enum('Scale-change cost', ['free', 'stamina', 'cooldown', 'item'], 'stamina'),
    },
    dependsOn: ['physics-modifiers'],
    conflictsWith: [],
  },
  {
    id: 'mount-system',
    category: CATEGORIES.WORLD,
    displayName: 'Mounts & MountDesigner',
    description: 'Player-owned mounts with coat generation, care, gear, and a behavior heartbeat (wander/flee/feed). Behavior is world-aware.',
    worldScope: 'player',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'mounts' },
    configSchema: {
      allowMounts: f.bool('Mounts allowed', true),
      mountCombat: f.bool('Mounted combat', true),
      wildMounts: f.bool('Tameable wild mounts', false),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'concord-link',
    category: CATEGORIES.WORLD,
    displayName: 'Concord Link (Cross-World Travel)',
    description: 'Registers the world as a travelable node in the lattice. Characters, skills, and inventory carry across the link.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'content_seed', key: 'concord_link_anchor' },
    configSchema: {
      travelMode: f.enum('Arrival mode', ['portal', 'walker-escort', 'open'], 'portal'),
      inboundOpen: f.bool('Open to inbound travelers', true),
      outboundOpen: f.bool('Travelers may leave', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },

  // ===== CHARACTER & PROGRESSION ===============================================
  {
    id: 'status-window',
    category: CATEGORIES.CHARACTER,
    displayName: 'Status Window (Isekai-Style)',
    description: 'World-adaptive character status panel — stats, titles, skills surfaced as a diegetic isekai-style overlay.',
    worldScope: 'world',
    status: 'available', // Phase 7 — built
    activation: { kind: 'rule_modulator', key: 'status_window' },
    configSchema: {
      style: f.enum('Window style', ['classic-rpg', 'minimal', 'ornate', 'sci-fi-hud'], 'classic-rpg'),
      showHiddenStats: f.bool('Reveal hidden stats', false),
      titleSystem: f.bool('Earnable titles', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'skill-affinity-world',
    category: CATEGORIES.CHARACTER,
    displayName: 'World Skill Affinity',
    description: 'Per-world potency multipliers — a power means different things in different worlds (magic 1.5x here, hacking 0.1x there).',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'skill_affinity' },
    configSchema: {
      magic: f.number('Magic affinity (%)', 0, 300, 100),
      technology: f.number('Technology affinity (%)', 0, 300, 100),
      martial: f.number('Martial affinity (%)', 0, 300, 100),
      psionics: f.number('Psionics affinity (%)', 0, 300, 100),
      nature: f.number('Nature affinity (%)', 0, 300, 100),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'skill-affinity-player',
    category: CATEGORIES.CHARACTER,
    displayName: 'Per-Player Skill Learning',
    description: 'Skills a player uses heavily grow personal affinity that travels with them — distinct from the per-world multipliers.',
    worldScope: 'player',
    status: 'available', // Phase 7 — built
    activation: { kind: 'always_on' },
    configSchema: {
      learnRate: f.number('Learn rate (%)', 25, 400, 100),
      decayWhenUnused: f.bool('Affinity decays when unused', true),
      crossWorldCarry: f.bool('Carries across worlds', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'isekai-reincarnation',
    category: CATEGORIES.CHARACTER,
    displayName: 'Isekai Reincarnation',
    description: 'On death, a character can reincarnate into the world — carrying a fraction of prior progress as an inherited boon.',
    worldScope: 'world',
    status: 'available', // Phase 7 — built
    activation: { kind: 'rule_modulator', key: 'reincarnation' },
    configSchema: {
      enabled: f.bool('Reincarnation enabled', true),
      inheritedFraction: f.number('Progress carried over (%)', 0, 75, 20),
      rerollAppearance: f.bool('New appearance each life', true),
      memoryFragments: f.bool('Fragmentary past-life memories', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'persistent-inventory',
    category: CATEGORIES.CHARACTER,
    displayName: 'Cross-World Persistent Inventory',
    description: 'Items follow the player per world (migration 101). With Concord Link enabled, inventory travels across worlds.',
    worldScope: 'player',
    status: 'available',
    activation: { kind: 'always_on' },
    configSchema: {
      slotCap: f.number('Inventory slots', 10, 500, 80),
      bindOnPickup: f.bool('Items bind on pickup', false),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'appearance-customization',
    category: CATEGORIES.CHARACTER,
    displayName: 'Appearance & Customization',
    description: 'Character creation + in-world re-customization, persisted as a RichAppearanceConfig.',
    worldScope: 'player',
    status: 'available',
    activation: { kind: 'always_on' },
    configSchema: {
      depth: f.enum('Customization depth', ['preset', 'standard', 'deep'], 'standard'),
      lockAfterCreation: f.bool('Lock appearance after creation', false),
    },
    dependsOn: [],
    conflictsWith: [],
  },

  // ===== COMBAT & ACTION =======================================================
  {
    id: 'combat-motor',
    category: CATEGORIES.COMBAT,
    displayName: 'Combat Motor Driver',
    description: 'Sekiro-precision + Spider-Man-fluidity combat motor — server-validated reach/damage, env-coupled potency, DBZ-style stagger.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'combat' },
    configSchema: {
      combatAllowed: f.bool('Combat allowed in this world', true),
      lethality: f.enum('Lethality', ['training', 'standard', 'hardcore'], 'standard'),
      friendlyFire: f.bool('Friendly fire', false),
      envCoupling: f.bool('Environmental potency coupling', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'armor-weapon-reflex',
    category: CATEGORIES.COMBAT,
    displayName: 'Armor / Weapon / Reflex',
    description: 'Equipment slots with armor meshes, weapon archetypes, and a reflex layer (block/parry/dodge over the base animation).',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'equipment' },
    configSchema: {
      armorSlots: f.number('Armor slots', 0, 8, 5),
      reflexActions: f.bool('Block / parry / dodge', true),
      durability: f.bool('Equipment durability', true),
    },
    dependsOn: ['combat-motor'],
    conflictsWith: [],
  },
  {
    id: 'elemental-status-effects',
    category: CATEGORIES.COMBAT,
    displayName: 'Elemental & Status Effects',
    description: 'Fire/frost/lightning/bio/poison elements with environment coupling, plus status effects (burn, freeze, poison, stun).',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'elements' },
    configSchema: {
      enabledElements: f.enum('Element set', ['classical-four', 'extended-six', 'all', 'none'], 'extended-six'),
      statusStacking: f.bool('Status effects stack', true),
    },
    dependsOn: ['combat-motor'],
    conflictsWith: [],
  },
  {
    id: 'boss-phases',
    category: CATEGORIES.COMBAT,
    displayName: 'Boss Phase Scripting',
    description: 'Multi-phase boss encounters — HP-threshold phase transitions wired into the combat/attack path.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'content_seed', key: 'boss_phases' },
    configSchema: {
      maxPhases: f.number('Max phases per boss', 1, 6, 3),
      cinematicTransitions: f.bool('Cinematic phase transitions', true),
    },
    dependsOn: ['combat-motor'],
    conflictsWith: [],
  },
  {
    id: 'aerial-mount-combat',
    category: CATEGORIES.COMBAT,
    displayName: 'Aerial & Mount Combat',
    description: 'Flight-physics combat and mounted combat — strikes, gait-aware attacks, rider-IK during engagements.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'aerial_combat' },
    configSchema: {
      aerialCombat: f.bool('Aerial combat', true),
      mountedCombat: f.bool('Mounted combat', true),
    },
    dependsOn: ['combat-motor'],
    conflictsWith: [],
  },
  {
    id: 'size-scaled-combat',
    category: CATEGORIES.COMBAT,
    displayName: 'Size-Scaled Combat',
    description: 'Combat mechanics that change with player scale — small = precision/evasion, large = AoE/knockback.',
    worldScope: 'world',
    status: 'available', // Phase 7 — built: scaledCombatProfile in size-scaling.js
    activation: { kind: 'rule_modulator', key: 'size_combat' },
    configSchema: {
      smallDamageModel: f.enum('Small-scale damage', ['precision', 'evasion', 'swarm'], 'precision'),
      largeDamageModel: f.enum('Large-scale damage', ['aoe', 'knockback', 'crush'], 'aoe'),
    },
    dependsOn: ['combat-motor', 'size-scaling'],
    conflictsWith: [],
  },

  // ===== NPC & AI INTELLIGENCE =================================================
  {
    id: 'llm-npcs',
    category: CATEGORIES.NPC,
    displayName: 'Living LLM NPCs',
    description: 'NPCs with memory, grudges, dreams, schemes, and ambition — driven by the oracle-brain + asymmetry substrate.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'content_seed', key: 'npcs' },
    configSchema: {
      npcCount: f.number('Seeded NPC count', 0, 200, 24),
      memoryDepth: f.enum('Memory depth', ['shallow', 'standard', 'deep'], 'standard'),
      grudgesEnabled: f.bool('Grudges & preoccupations', true),
      dreamsEnabled: f.bool('NPC dreams', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'npc-schedules',
    category: CATEGORIES.NPC,
    displayName: 'NPC Schedules & Daily Routines',
    description: 'Deterministic per-NPC daily schedules — work, patrol, trade, socialize — advanced by the npc-routine-cycle heartbeat.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'heartbeat_optin', key: 'npc_routines' },
    configSchema: {
      scheduleGranularity: f.enum('Schedule granularity', ['coarse', 'standard', 'fine'], 'standard'),
      activityTags: f.bool('Floating activity tags', true),
    },
    dependsOn: ['llm-npcs'],
    conflictsWith: [],
  },
  {
    id: 'npc-voice-idiolect',
    category: CATEGORIES.NPC,
    displayName: 'NPC Voice & Idiolect',
    description: 'Each NPC develops a distinct speaking style over time via the persona idiolect substrate.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'npc_voice' },
    configSchema: {
      voiceVariety: f.enum('Voice variety', ['uniform', 'regional', 'per-npc'], 'per-npc'),
      spokenAudio: f.bool('TTS spoken dialogue', false),
    },
    dependsOn: ['llm-npcs'],
    conflictsWith: [],
  },
  {
    id: 'emergent-events',
    category: CATEGORIES.NPC,
    displayName: 'Emergent Events',
    description: 'NPCs and factions start wars, form alliances, stage coups — the faction-strategy + ambition cycles, surfaced as world events.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'heartbeat_optin', key: 'emergent_events' },
    configSchema: {
      intensity: f.enum('Emergent intensity', ['calm', 'lively', 'turbulent'], 'lively'),
      warsEnabled: f.bool('Faction wars', true),
      coupsEnabled: f.bool('Coups & rebellions', true),
    },
    dependsOn: ['llm-npcs'],
    conflictsWith: [],
  },
  {
    id: 'npc-sponsorship-staking',
    category: CATEGORIES.NPC,
    displayName: 'NPC Sponsorship & Staking',
    description: 'Players can sponsor or stake on NPCs — backing their ambitions for a share of the outcome.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'npc_sponsorship' },
    configSchema: {
      sponsorshipEnabled: f.bool('Sponsorship enabled', true),
      stakingEnabled: f.bool('Staking on NPC outcomes', true),
    },
    dependsOn: ['llm-npcs'],
    conflictsWith: [],
  },

  // ===== ECONOMY & CREATION ====================================================
  {
    id: 'royalty-cascade',
    category: CATEGORIES.ECONOMY,
    displayName: 'Multi-Generational Royalty Cascade',
    description: 'Every cited asset pays its lineage up to 50 generations deep. Lattice-global — applies the same everywhere.',
    worldScope: 'global',
    status: 'available',
    activation: { kind: 'always_on' },
    configSchema: {
      // global system — config here is advisory; the cascade math is constitutional
      acknowledged: f.bool('Royalty cascade applies (lattice-global)', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'recipe-authoring',
    category: CATEGORIES.ECONOMY,
    displayName: 'Recipe Authoring',
    description: 'Players author skills, spells, buildings, and items as recipe DTUs. Effectiveness is modulated by world skill-affinity.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'recipe_authoring' },
    configSchema: {
      allowedKinds: f.enum('Authorable kinds', ['items-only', 'items-and-skills', 'all'], 'all'),
      personalScopeDefault: f.bool('New recipes default to personal scope', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'player-orgs',
    category: CATEGORIES.ECONOMY,
    displayName: 'Companies, Guilds & Kingdoms',
    description: 'Player-run organizations with governance voting, treasuries, and per-world presence.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'orgs' },
    configSchema: {
      orgTypes: f.enum('Org types', ['guilds-only', 'companies-and-guilds', 'all'], 'all'),
      kingdomsEnabled: f.bool('Kingdoms & realms', true),
      governanceVoting: f.bool('Governance voting', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'insurance-construction',
    category: CATEGORIES.ECONOMY,
    displayName: 'Insurance & Construction Economies',
    description: 'Construction projects (blueprint -> world spawn) plus an insurance layer against loss.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'construction' },
    configSchema: {
      constructionEnabled: f.bool('Player construction', true),
      insuranceEnabled: f.bool('Insurance market', true),
      buildOverlapCheck: f.bool('Enforce build bounding-box checks', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'marketplace-spectator-betting',
    category: CATEGORIES.ECONOMY,
    displayName: 'Marketplace & Spectator Betting',
    description: 'The creative marketplace plus spectator betting on events, matches, and NPC outcomes.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'marketplace' },
    configSchema: {
      marketplaceEnabled: f.bool('In-world marketplace', true),
      spectatorBetting: f.bool('Spectator betting', false),
      bettingCurrency: f.enum('Betting currency', ['cc', 'sparks', 'disabled'], 'sparks'),
    },
    dependsOn: [],
    conflictsWith: [],
  },

  // ===== SOCIAL & MULTIPLAYER ==================================================
  {
    id: 'realtime-coop-pvp',
    category: CATEGORIES.SOCIAL,
    displayName: 'Real-Time Co-op & PvP',
    description: 'Real-time shared presence with spatial chunking + anti-cheat. Co-op and/or PvP per the world ruleset.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'multiplayer' },
    configSchema: {
      mode: f.enum('Multiplayer mode', ['solo', 'coop', 'pvp', 'coop-and-pvp'], 'coop'),
      maxConcurrent: f.number('Max concurrent players', 1, 200, 50),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'factions-politics',
    category: CATEGORIES.SOCIAL,
    displayName: 'Factions & Persistent Politics',
    description: 'Authored + emergent factions with relations, territory, decrees, and persistent political state.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'content_seed', key: 'factions' },
    configSchema: {
      factionCount: f.number('Seeded factions', 0, 20, 4),
      territoryControl: f.bool('Territorial control', true),
      decreeSystem: f.bool('Realm decrees', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'live-spectator',
    category: CATEGORIES.SOCIAL,
    displayName: 'Live Spectator Mode',
    description: 'Non-participants can watch the world live — events, matches, and emergent drama as a broadcast surface.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'spectator' },
    configSchema: {
      spectatorEnabled: f.bool('Spectator mode', true),
      observerReports: f.bool('Auto-composed observer reports', true),
    },
    dependsOn: [],
    conflictsWith: [],
  },
  {
    id: 'voice-chat-proximity',
    category: CATEGORIES.SOCIAL,
    displayName: 'Voice Chat & Proximity Voice',
    description: 'WebRTC mesh voice with proximity falloff — hear who is near you in-world.',
    worldScope: 'world',
    status: 'available',
    activation: { kind: 'rule_modulator', key: 'voice' },
    configSchema: {
      voiceMode: f.enum('Voice mode', ['off', 'global', 'proximity', 'proximity-and-channels'], 'proximity'),
      proximityRange: f.number('Proximity range (m)', 5, 100, 25),
    },
    dependsOn: [],
    conflictsWith: [],
  },
]);

// ── Indexes ─────────────────────────────────────────────────────────────────
const _byId = new Map(SYSTEM_REGISTRY.map((s) => [s.id, s]));

// ── Public API ──────────────────────────────────────────────────────────────

/** All system ids. */
export function allSystemIds() {
  return SYSTEM_REGISTRY.map((s) => s.id);
}

/** Look up one system by id. Returns null if unknown. */
export function getSystem(id) {
  return _byId.get(id) || null;
}

/** List systems, optionally filtered by category. */
export function listSystems({ category } = {}) {
  if (!category) return SYSTEM_REGISTRY.slice();
  return SYSTEM_REGISTRY.filter((s) => s.category === category);
}

/** Systems grouped by category, in CATEGORY_LABELS order. */
export function systemsByCategory() {
  const out = {};
  for (const key of Object.values(CATEGORIES)) {
    out[key] = { label: CATEGORY_LABELS[key], systems: listSystems({ category: key }) };
  }
  return out;
}

/** The config schema for one system (the shape the ConfigPanel renders). */
export function getConfigSchema(id) {
  const sys = getSystem(id);
  return sys ? sys.configSchema : null;
}

/**
 * Coerce + validate a config object against a system's schema. Unknown
 * keys are dropped; missing keys fall back to the schema default; values
 * out of range are clamped (numbers) or rejected (enums/bools).
 * Returns { ok, config, errors }.
 */
export function coerceConfig(id, rawConfig = {}) {
  const schema = getConfigSchema(id);
  if (!schema) return { ok: false, config: {}, errors: [`unknown system: ${id}`] };
  const config = {};
  const errors = [];
  for (const [field, desc] of Object.entries(schema)) {
    const raw = rawConfig[field];
    if (raw === undefined || raw === null) {
      config[field] = desc.default;
      continue;
    }
    switch (desc.type) {
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) { errors.push(`${id}.${field}: not a number`); config[field] = desc.default; }
        else config[field] = Math.min(desc.max, Math.max(desc.min, n));
        break;
      }
      case 'bool':
        config[field] = Boolean(raw);
        break;
      case 'enum':
        if (desc.options.includes(raw)) config[field] = raw;
        else { errors.push(`${id}.${field}: '${raw}' not in [${desc.options.join(', ')}]`); config[field] = desc.default; }
        break;
      case 'text': {
        const s = String(raw);
        config[field] = desc.maxLength ? s.slice(0, desc.maxLength) : s;
        break;
      }
      case 'range': {
        if (Array.isArray(raw) && raw.length === 2) {
          const lo = Math.min(desc.max, Math.max(desc.min, Number(raw[0])));
          const hi = Math.min(desc.max, Math.max(desc.min, Number(raw[1])));
          config[field] = [Math.min(lo, hi), Math.max(lo, hi)];
        } else { errors.push(`${id}.${field}: expected [lo, hi]`); config[field] = desc.default; }
        break;
      }
      default:
        config[field] = raw;
    }
  }
  return { ok: errors.length === 0, config, errors };
}

/**
 * Validate a worldspec's system selection — the dependency + conflict
 * graph plus per-system config coercion. This is the gate Phase 2's
 * foundry.validate and Phase 3's publish pipeline both call.
 *
 * @param {Array<{id: string, config?: object}>} systems
 * @returns {{ ok, errors, warnings, resolved }}
 *   resolved — the systems list with coerced configs, ready to persist.
 */
export function validateSystemSelection(systems = []) {
  const errors = [];
  const warnings = [];
  const resolved = [];
  if (!Array.isArray(systems)) {
    return { ok: false, errors: ['systems must be an array'], warnings, resolved };
  }

  const selectedIds = new Set();
  for (const entry of systems) {
    const id = entry && entry.id;
    if (!id || !_byId.has(id)) { errors.push(`unknown system: ${id}`); continue; }
    if (selectedIds.has(id)) { warnings.push(`duplicate system dropped: ${id}`); continue; }
    selectedIds.add(id);
  }

  for (const id of selectedIds) {
    const sys = _byId.get(id);

    // dependency check
    for (const dep of sys.dependsOn) {
      if (!selectedIds.has(dep)) {
        errors.push(`'${id}' depends on '${dep}' — add it or remove '${id}'`);
      }
    }
    // conflict check
    for (const conflict of sys.conflictsWith) {
      if (selectedIds.has(conflict)) {
        errors.push(`'${id}' conflicts with '${conflict}' — pick one`);
      }
    }
    // stub advisory — not an error; it just won't activate until Phase 7 lands
    if (sys.status === 'stub') {
      warnings.push(`'${id}' is not built yet (status: stub) — selectable, activates once Phase 7 ships`);
    }

    const raw = (systems.find((s) => s.id === id) || {}).config || {};
    const coerced = coerceConfig(id, raw);
    if (!coerced.ok) errors.push(...coerced.errors);
    resolved.push({ id, config: coerced.config });
  }

  return { ok: errors.length === 0, errors, warnings, resolved };
}

export const REGISTRY_INTERNALS = Object.freeze({ _byId, f });
