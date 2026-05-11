// server/lib/world-kit-templates.js
//
// World-kit template generators — sprint 6.
//
// Tunya was authored as the reference "world bible" with 14 enrichment
// files beyond the seeder-minimum (meta + factions + npcs + lore). The
// audit confirmed: content-seeder.js is 100% generic JSON-driven, so
// any of the 8 other worlds can reach Tunya density by adding the same
// shape of files. This module ships the templates.
//
// Each generator accepts `{ worldId, genre, dominantSkillDomain, hints? }`
// and returns a skeleton JSON object that follows the Tunya schema while
// being parameterised by genre. The author fills in lore-specific
// details; the structure is free.
//
// Usage:
//   scripts/scaffold-world-kit.js <worldId>
//   → reads content/world/<worldId>/meta.json for genre/affinity hints
//   → writes any missing enrichment files to content/world/<worldId>/
//   → never overwrites (idempotent)

const HOURS_PER_DAY_BY_GENRE = {
  fantasy: 24,
  cyber: 28,
  superhero: 24,
  crime: 24,
  "sovereign-ruins": 30,
  "lattice-crucible": 26,
  "concord-link-frontier": 24,
  standard: 24,
};

const PHASES_BY_GENRE = {
  fantasy: [
    { id: "dawn", start_hour: 5, end_hour: 8, label: "Dawn", kind: "first_light" },
    { id: "morning", start_hour: 9, end_hour: 12, label: "Morning", kind: "labour_watch" },
    { id: "midday", start_hour: 13, end_hour: 16, label: "Midday", kind: "high_sun" },
    { id: "evenfall", start_hour: 17, end_hour: 20, label: "Evenfall", kind: "trade_watch" },
    { id: "vigil", start_hour: 21, end_hour: 24, label: "Vigil", kind: "first_moon" },
    { id: "depths", start_hour: 1, end_hour: 4, label: "Depths", kind: "deep_night" },
  ],
  cyber: [
    { id: "neon_dawn", start_hour: 1, end_hour: 5, label: "Neon Dawn", kind: "shift_change" },
    { id: "corp_hours", start_hour: 6, end_hour: 13, label: "Corp Hours", kind: "wage_shift" },
    { id: "gray_market", start_hour: 14, end_hour: 18, label: "Gray Market", kind: "trade_shift" },
    { id: "chrome_hours", start_hour: 19, end_hour: 23, label: "Chrome Hours", kind: "augment_shift" },
    { id: "dark_hours", start_hour: 24, end_hour: 28, label: "Dark Hours", kind: "ice_active" },
  ],
  superhero: [
    { id: "patrol_morning", start_hour: 5, end_hour: 9, label: "Morning Patrol", kind: "civic_round" },
    { id: "office_hours", start_hour: 10, end_hour: 17, label: "Office Hours", kind: "civilian_cover" },
    { id: "rush_window", start_hour: 18, end_hour: 20, label: "Rush", kind: "incident_peak" },
    { id: "night_patrol", start_hour: 21, end_hour: 4, label: "Night Patrol", kind: "rooftop_watch" },
  ],
  crime: [
    { id: "morning_legit", start_hour: 6, end_hour: 11, label: "Morning Legit", kind: "front_business" },
    { id: "midday_meet", start_hour: 12, end_hour: 16, label: "Midday Meet", kind: "deal_window" },
    { id: "evening_collect", start_hour: 17, end_hour: 21, label: "Evening Collect", kind: "tribute_window" },
    { id: "night_ops", start_hour: 22, end_hour: 5, label: "Night Ops", kind: "hit_window" },
  ],
  "sovereign-ruins": [
    { id: "ash_dawn", start_hour: 1, end_hour: 6, label: "Ash Dawn", kind: "salvage_hours" },
    { id: "long_silence", start_hour: 7, end_hour: 18, label: "Long Silence", kind: "hide_watch" },
    { id: "remnant_chime", start_hour: 19, end_hour: 24, label: "Remnant Chime", kind: "memorial_watch" },
    { id: "deep_ruin", start_hour: 25, end_hour: 30, label: "Deep Ruin", kind: "predator_watch" },
  ],
  "lattice-crucible": [
    { id: "crystal_inhalation", start_hour: 1, end_hour: 6, label: "Crystal Inhalation", kind: "research_inhale" },
    { id: "lattice_resonance", start_hour: 7, end_hour: 13, label: "Lattice Resonance", kind: "experiment_window" },
    { id: "drift_observation", start_hour: 14, end_hour: 20, label: "Drift Observation", kind: "audit_window" },
    { id: "shutdown", start_hour: 21, end_hour: 26, label: "Shutdown", kind: "safety_protocol" },
  ],
  "concord-link-frontier": [
    { id: "anchor_check", start_hour: 4, end_hour: 8, label: "Anchor Check", kind: "diagnostics" },
    { id: "convoy_hours", start_hour: 9, end_hour: 16, label: "Convoy Hours", kind: "transit_window" },
    { id: "hospitality", start_hour: 17, end_hour: 21, label: "Hospitality", kind: "common_room" },
    { id: "deepwatch", start_hour: 22, end_hour: 3, label: "Deepwatch", kind: "graveyard_shift" },
  ],
};

export function calendarTemplate({ worldId, genre, hints = {} }) {
  const hpd = HOURS_PER_DAY_BY_GENRE[genre] || 24;
  const phases = PHASES_BY_GENRE[genre] || PHASES_BY_GENRE.fantasy;
  return {
    world_id: worldId,
    schema_version: "1.0",
    hours_per_day: hpd,
    minutes_per_hour: 60,
    days_per_month: hints.days_per_month || 30,
    months_per_year: hints.months_per_year || 12,
    days_per_year: (hints.days_per_month || 30) * (hints.months_per_year || 12),
    moons: hints.moons ?? 1,
    moon_lore: hints.moon_lore || `[AUTHOR] Moon lore for ${worldId}. Replace with canon.`,
    temperature_units: hints.temperature_units || "celsius",
    biome_note: hints.biome_note || `[AUTHOR] Biome distribution note for ${worldId}.`,
    day_phases: phases,
    months: Array.from({ length: hints.months_per_year || 12 }, (_, i) => ({
      id: `month_${i + 1}`,
      label: `[AUTHOR] Month ${i + 1}`,
      season: i < 3 ? "season_a" : i < 6 ? "season_b" : i < 9 ? "season_c" : "season_d",
      temperature_band: "[AUTHOR]",
      cultural_notes: "[AUTHOR]",
    })),
    notes: [
      `[AUTHOR] Replace placeholder strings before shipping to canon.`,
      `Scaffolded by world-kit-templates.js — genre: ${genre}, hours/day: ${hpd}.`,
    ],
  };
}

export function industriesTemplate({ worldId, genre, dominantSkillDomain }) {
  const INDUSTRIES_BY_GENRE = {
    fantasy: ["agriculture","fishing","smithing","weaving","alchemy","scribing","mining","mercenary_work"],
    cyber: ["data_brokerage","chrome_shop","corp_security","gig_economy","gray_market","ice_engineering","aug_clinic","decking"],
    superhero: ["civic_defense","journalism","corp_research","public_relations","emergency_response","insurance","supply_logistics","manufacturing"],
    crime: ["protection","smuggling","fencing","loansharking","gambling","front_business","forgery","muscle"],
    "sovereign-ruins": ["salvage","memory_keeping","ash_farming","artefact_trade","scavenge","ruin_cartography","survival_craft"],
    "lattice-crucible": ["research","crystal_refining","drift_monitoring","experiment_brokering","safety_audit","substrate_engineering"],
    "concord-link-frontier": ["anchor_maintenance","hospitality","convoy_escort","cartography","translation","portage"],
  };
  const list = INDUSTRIES_BY_GENRE[genre] || ["primary","secondary","tertiary"];
  return {
    world_id: worldId,
    schema_version: "1.0",
    purpose: `Industry rollups for ${worldId}. Each industry names jobs, raw inputs, processed outputs, and seasonal cadence. Used by the world-economy heartbeat to model price + scarcity + production cycles.`,
    dominant_industry: list[0],
    skill_domain_alignment: dominantSkillDomain || "default",
    industries: list.map(id => ({
      id,
      category: "[AUTHOR: primary|secondary|tertiary|exotic]",
      jobs_referenced: ["[AUTHOR]"],
      inputs: ["[AUTHOR]"],
      outputs: ["[AUTHOR]"],
      seasonal_peak: "[AUTHOR]",
      key_kingdoms: ["[AUTHOR]"],
      cross_world_exports_to: ["[AUTHOR — list of other worldIds that import this]"],
      notes: "[AUTHOR]",
    })),
  };
}

export function namingTemplate({ worldId, genre }) {
  return {
    world_id: worldId,
    schema_version: "1.0",
    purpose: `Per-faction / per-kingdom naming patterns for ${worldId}. The npc-spawner reads this to generate plausible names. Authored examples anchor the procedural generator.`,
    genre,
    patterns: [
      {
        faction_or_kingdom: "[AUTHOR — primary faction id]",
        first_name_pattern: "[AUTHOR: consonant clusters + vowel patterns]",
        last_name_pattern: "[AUTHOR]",
        examples: ["[AUTHOR Name 1]", "[AUTHOR Name 2]", "[AUTHOR Name 3]"],
        etymology: "[AUTHOR — what these names mean in-world]",
      },
    ],
    forbidden_patterns: ["[AUTHOR — names that conflict with other worlds' canon]"],
  };
}

export function apparelTemplate({ worldId, genre }) {
  return {
    world_id: worldId,
    schema_version: "1.0",
    purpose: `Costume templates per faction + occasion for ${worldId}. Drives NPC procedural appearance + player wardrobe options.`,
    occasions: ["everyday","ceremonial","work","combat","festival"],
    factions: [
      {
        faction_id: "[AUTHOR]",
        signature_palette: ["[AUTHOR hex or name]"],
        signature_silhouette: "[AUTHOR]",
        wardrobe_by_occasion: {
          everyday: "[AUTHOR]",
          ceremonial: "[AUTHOR]",
          work: "[AUTHOR]",
          combat: "[AUTHOR]",
          festival: "[AUTHOR]",
        },
      },
    ],
    genre_notes: `[AUTHOR — ${genre}-genre wardrobe tropes go here]`,
  };
}

export function bestiaryTemplate({ worldId, genre }) {
  const CREATURES_BY_GENRE = {
    fantasy: ["wolf","wyvern","forest_spirit","goblin_raider","drake","mimic","wisp"],
    cyber: ["security_drone","ice_construct","data_ghost","chrome_rat","aug_predator","kill_switch"],
    superhero: ["civic_drone","emergent_anomaly","sentinel","metaphage","rogue_avatar"],
    crime: ["guard_dog","corrupt_inspector","contract_killer","loan_enforcer","junkie"],
    "sovereign-ruins": ["remnant_walker","ash_lurker","memory_eater","fallen_construct"],
    "lattice-crucible": ["drift_anomaly","crystal_predator","substrate_ghost","resonance_storm"],
    "concord-link-frontier": ["anchor_parasite","liminal_creature","crossroad_horror","wayfarer_ghost"],
  };
  const list = CREATURES_BY_GENRE[genre] || ["common_predator","prey","alpha"];
  return {
    world_id: worldId,
    schema_version: "1.0",
    purpose: `Bestiary for ${worldId}. Each entry feeds the fauna-spawner, the loot tables, and the bestiary lens.`,
    creatures: list.map(id => ({
      id,
      kind: "[AUTHOR: predator|prey|alpha|boss|hazard]",
      habitats: ["[AUTHOR biome ids]"],
      behavior_pattern: "[AUTHOR — flock | solitary | ambush | patrol | etc.]",
      power_tier: "[AUTHOR: novice|standard|standard_high|elite|boss|mythic_boss]",
      drops: ["[AUTHOR]"],
      lore: "[AUTHOR]",
      cross_world_corollary: "[AUTHOR — what this species resembles in other worlds]",
    })),
  };
}

export function diplomaticGraphTemplate({ worldId }) {
  return {
    world_id: worldId,
    schema_version: "1.0",
    purpose: `Per-faction-pair relationship lattice for ${worldId}. Drives Layer 11 faction-strategy + cross-world relationship seeding.`,
    edges: [
      {
        from: "[AUTHOR faction id]",
        to: "[AUTHOR faction id]",
        relationship: "[AUTHOR: ally|trade_pact|truce|tension|rival|war|blood_feud]",
        history: "[AUTHOR]",
        cross_world_resonance: "[AUTHOR — does this rivalry mirror one in another world?]",
      },
    ],
  };
}

export function schedulesTemplate({ worldId, genre }) {
  return {
    world_id: worldId,
    schema_version: "1.0",
    purpose: `Archetype-routine templates for ${worldId}. The npc-routines lib composes per-NPC schedules deterministically from these blocks + the NPC's preoccupations.`,
    genre,
    archetypes: {
      "[AUTHOR archetype]": {
        blocks: [
          { phase: "[AUTHOR day_phase id from calendar]", activity: "[AUTHOR]", location_tag: "[AUTHOR]" },
        ],
      },
    },
  };
}

export const TEMPLATES = Object.freeze({
  calendar:         { fileName: "calendar.json",         generator: calendarTemplate },
  industries:       { fileName: "industries.json",       generator: industriesTemplate },
  naming_conventions: { fileName: "naming_conventions.json", generator: namingTemplate },
  apparel:          { fileName: "apparel.json",          generator: apparelTemplate },
  bestiary:         { fileName: "bestiary.json",         generator: bestiaryTemplate },
  diplomatic_graph: { fileName: "diplomatic_graph.json", generator: diplomaticGraphTemplate },
  schedules:        { fileName: "schedules.json",        generator: schedulesTemplate },
});

/**
 * Scaffold every missing enrichment file for the given world.
 * Reads {worldId, genre, dominantSkillDomain}; never overwrites.
 *
 * @returns {{ created: string[], skipped: string[], errors: string[] }}
 */
export function scaffoldWorld({ worldId, genre, dominantSkillDomain, hints = {}, fsLike, dir }) {
  const created = [];
  const skipped = [];
  const errors = [];
  for (const [_kind, { fileName, generator }] of Object.entries(TEMPLATES)) {
    const path = `${dir}/${fileName}`;
    if (fsLike.exists(path)) {
      skipped.push(fileName);
      continue;
    }
    try {
      const payload = generator({ worldId, genre, dominantSkillDomain, hints });
      fsLike.writeFile(path, JSON.stringify(payload, null, 2) + "\n");
      created.push(fileName);
    } catch (err) {
      errors.push(`${fileName}: ${err?.message || err}`);
    }
  }
  return { created, skipped, errors };
}
