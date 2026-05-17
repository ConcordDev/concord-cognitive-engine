// server/lib/world-hostiles-seed.js
//
// Phase 13 follow-on — lore-appropriate hostile NPCs, camps, dungeons,
// and quest hooks for every non-hub world.
//
// Pre-this-seed, the only hostile NPCs in the entire substrate were 6
// wraiths/drift_eaters/shard_husks in concordia-hub (which itself refuses
// combat via Concordant Law — so they were unfightable). All 13 sub-worlds
// were combat-permitted but had no enemies. Players landing in fantasy /
// cyber / crime / war-zone could walk anywhere without consequence.
//
// This seeder fixes that by populating each world with hostiles whose
// archetypes match the world's lore (orcs in fantasy, rogue androids in
// cyber, street gangs in crime, etc.), grouped into camps + dungeons at
// world-appropriate coordinates, with kill-mission quests authored against
// each camp.
//
// Idempotent — re-runs are no-ops if rows already exist for that world.

import crypto from "node:crypto";

// ── Hostile roster per world ──────────────────────────────────────────────
// archetype names sourced from server/lib/npc-archetypes.js
// faction names match content/world/<world>/factions.json where possible;
// fallback to generic 'hostile' for procedurally-spawned non-faction mobs.

export const WORLD_HOSTILE_SEEDS = {
  // ── fantasy: The Sundering — orcs/undead/goblins/dragons ────────────────
  fantasy: {
    factions: ["fantasy_obsidian_crown", "fantasy_goblin_warband_league"],
    hostiles: [
      { archetype: "goblin",          level: 2, hp: 45,  damage: 6,  count: 4, faction: "fantasy_goblin_warband_league" },
      { archetype: "orc_warrior",     level: 4, hp: 95,  damage: 12, count: 3, faction: "fantasy_obsidian_crown" },
      { archetype: "dark_wizard",     level: 6, hp: 80,  damage: 18, count: 2, faction: "fantasy_obsidian_crown" },
      { archetype: "undead",          level: 3, hp: 70,  damage: 9,  count: 4, faction: "undead" },
      { archetype: "bandit",          level: 3, hp: 65,  damage: 8,  count: 3, faction: "outlaw" },
      { archetype: "troll",           level: 8, hp: 220, damage: 24, count: 1, faction: "fantasy_obsidian_crown" },
      { archetype: "dragon_cultist",  level: 7, hp: 110, damage: 16, count: 2, faction: "cult" },
    ],
    camps: [
      { id: "fantasy_goblin_warband",   name: "Goblin Warband Camp",    pos: { x: 800, z: 800 },   buildings: ["watchtower:wood", "house:wood", "house:wood"] },
      { id: "fantasy_orc_warcamp",      name: "Obsidian Warcamp",       pos: { x: 1200, z: 1500 }, buildings: ["forge:stone", "barracks:wood", "watchtower:stone"] },
      { id: "fantasy_bandit_outpost",   name: "Bandit Roadside Camp",   pos: { x: -600, z: 400 },  buildings: ["house:wood", "house:wood"] },
    ],
    dungeons: [
      { id: "fantasy_undead_crypt",     name: "The Lit Veil Crypt",     pos: { x: -1500, z: 1800 }, buildings: ["tomb:stone", "tomb:stone", "altar:stone"] },
      { id: "fantasy_dragon_cult_lair", name: "Cultist Vault of Embers", pos: { x: 2000, z: -1200 }, buildings: ["altar:stone", "altar:stone", "tower:stone"] },
    ],
    quests: [
      { id: "fantasy_q_clear_goblins",  giver: "kael_torchlight",    title: "Clear the Goblin Warband",     target: "fantasy_goblin_warband",   reward_cc: 25 },
      { id: "fantasy_q_orc_warcamp",    giver: "captain_rael",       title: "Strike the Obsidian Warcamp",  target: "fantasy_orc_warcamp",      reward_cc: 60 },
      { id: "fantasy_q_undead_crypt",   giver: "wanderer_kael",      title: "Cleanse the Lit Veil Crypt",   target: "fantasy_undead_crypt",     reward_cc: 80 },
      { id: "fantasy_q_dragon_cult",    giver: "blackroot_thorne",   title: "Stop the Cultist Vault Ritual", target: "fantasy_dragon_cult_lair", reward_cc: 120 },
    ],
  },

  // ── cyber: The Grid — rogue AIs, corp enforcers, hacked drones ──────────
  cyber: {
    factions: ["cyber_corp_zenith", "cyber_rogue_ai_collective"],
    hostiles: [
      { archetype: "rogue_android",       level: 5, hp: 100, damage: 14, count: 3, faction: "cyber_rogue_ai_collective" },
      { archetype: "corporate_enforcer",  level: 4, hp: 85,  damage: 12, count: 3, faction: "cyber_corp_zenith" },
      { archetype: "combat_drone",        level: 3, hp: 60,  damage: 10, count: 4, faction: "cyber_corp_zenith" },
      { archetype: "cyborg_enforcer",     level: 6, hp: 120, damage: 16, count: 2, faction: "cyber_corp_zenith" },
      { archetype: "corpo_assassin",      level: 7, hp: 90,  damage: 22, count: 2, faction: "cyber_corp_zenith" },
      { archetype: "ai_overlord",         level: 12, hp: 400, damage: 35, count: 1, faction: "cyber_rogue_ai_collective" },
    ],
    camps: [
      { id: "cyber_corp_strike_zone",   name: "Zenith Corp Strike Zone",   pos: { x: 1000, z: -800 },  buildings: ["watchtower:steel", "barracks:steel", "barracks:steel"] },
      { id: "cyber_server_farm",        name: "Abandoned Server Farm",     pos: { x: -1200, z: 600 },  buildings: ["warehouse:steel", "warehouse:steel"] },
    ],
    dungeons: [
      { id: "cyber_ai_core_vault",      name: "Rogue AI Core Vault",       pos: { x: 1800, z: 1800 },  buildings: ["tower:steel", "tower:steel", "altar:steel"] },
    ],
    quests: [
      { id: "cyber_q_corp_strike",      giver: "nakamura_zero",   title: "Disrupt the Zenith Strike Zone",  target: "cyber_corp_strike_zone", reward_cc: 50 },
      { id: "cyber_q_server_farm",      giver: "torres_blackout", title: "Loot the Abandoned Server Farm",  target: "cyber_server_farm",      reward_cc: 35 },
      { id: "cyber_q_ai_vault",         giver: "nakamura_zero",   title: "Shut Down the AI Core",           target: "cyber_ai_core_vault",    reward_cc: 200 },
    ],
  },

  // ── crime: Crime World — street gangs, hitmen, dirty cops ──────────────
  crime: {
    factions: ["iron_rose_syndicate", "crime_dragon_triad"],
    hostiles: [
      { archetype: "street_gang",         level: 2, hp: 55,  damage: 7,  count: 4, faction: "iron_rose_syndicate" },
      { archetype: "hitman",              level: 5, hp: 95,  damage: 16, count: 3, faction: "iron_rose_syndicate" },
      { archetype: "corrupt_officer",     level: 4, hp: 80,  damage: 11, count: 2, faction: "crime_corrupt_pd" },
      { archetype: "assassin",            level: 6, hp: 100, damage: 18, count: 2, faction: "crime_dragon_triad" },
      { archetype: "bandit_gang",         level: 3, hp: 70,  damage: 9,  count: 3, faction: "outlaw" },
      { archetype: "gang_warlord",        level: 10, hp: 250, damage: 28, count: 1, faction: "iron_rose_syndicate" },
    ],
    camps: [
      { id: "crime_syndicate_hideout",  name: "Iron Rose Hideout",         pos: { x: 700, z: 1100 },   buildings: ["warehouse:brick", "house:brick", "house:brick"] },
      { id: "crime_triad_compound",     name: "Dragon Triad Compound",     pos: { x: -900, z: -700 },  buildings: ["warehouse:steel", "warehouse:steel", "watchtower:steel"] },
    ],
    dungeons: [
      { id: "crime_underground_bunker", name: "Underground Crime Bunker",  pos: { x: 1400, z: -1400 }, buildings: ["tomb:stone", "tomb:stone", "altar:stone"] },
    ],
    quests: [
      { id: "crime_q_iron_rose",        giver: "rivera_jax",        title: "Hit the Iron Rose Hideout",        target: "crime_syndicate_hideout", reward_cc: 45 },
      { id: "crime_q_dragon_triad",     giver: "rivera_jax",        title: "Burn the Dragon Triad Compound",   target: "crime_triad_compound",    reward_cc: 65 },
      { id: "crime_q_bunker",           giver: "delgado_iron_rose", title: "Raid the Crime Bunker",            target: "crime_underground_bunker",reward_cc: 150 },
    ],
  },

  // ── sovereign-ruins — refusal-tainted shadows + cultists ───────────────
  "sovereign-ruins": {
    factions: ["sovereign_refusal_cult"],
    hostiles: [
      { archetype: "wraith",              level: 4, hp: 75,  damage: 11, count: 3, faction: "undead" },
      { archetype: "possessed",           level: 5, hp: 95,  damage: 14, count: 3, faction: "cult" },
      { archetype: "plague_bearer",       level: 5, hp: 90,  damage: 13, count: 2, faction: "cult" },
      { archetype: "cultist",             level: 3, hp: 65,  damage: 9,  count: 4, faction: "sovereign_refusal_cult" },
      { archetype: "undead",              level: 3, hp: 70,  damage: 10, count: 3, faction: "undead" },
      { archetype: "shadow_government",   level: 11, hp: 320, damage: 32, count: 1, faction: "sovereign_refusal_cult" },
    ],
    camps: [
      { id: "sov_cultist_camp",         name: "Refusal Cultist Camp",      pos: { x: 600, z: -600 },   buildings: ["altar:stone", "house:wood", "watchtower:wood"] },
      { id: "sov_plague_ground",        name: "Plague-Bearer Ground",      pos: { x: -1100, z: 900 },  buildings: ["tomb:stone", "tomb:stone"] },
    ],
    dungeons: [
      { id: "sov_refusal_crypt",        name: "The Refusal Crypt",         pos: { x: -2000, z: -2000 }, buildings: ["tomb:stone", "tomb:stone", "tomb:stone", "altar:stone"] },
    ],
    quests: [
      { id: "sov_q_cultist_camp",       giver: "weaver_of_echoes",     title: "Disperse the Refusal Cult",      target: "sov_cultist_camp",  reward_cc: 50 },
      { id: "sov_q_plague_ground",      giver: "sovereign_first_refusal", title: "Burn the Plague Ground",      target: "sov_plague_ground", reward_cc: 75 },
      { id: "sov_q_refusal_crypt",      giver: "sovereign_first_refusal", title: "Sound the Refusal Crypt",     target: "sov_refusal_crypt", reward_cc: 200 },
    ],
  },

  // ── lattice-crucible — drift entities + paradox spawn ──────────────────
  "lattice-crucible": {
    factions: ["lattice_drift_collective"],
    hostiles: [
      { archetype: "wraith",              level: 5, hp: 80,  damage: 12, count: 2, faction: "lattice_drift_collective" },
      { archetype: "possessed",           level: 6, hp: 100, damage: 15, count: 3, faction: "lattice_drift_collective" },
      { archetype: "rogue_android",       level: 7, hp: 130, damage: 18, count: 2, faction: "lattice_drift_collective" },
      { archetype: "cultist",             level: 4, hp: 70,  damage: 10, count: 3, faction: "cult" },
      { archetype: "elder_god",           level: 15, hp: 600, damage: 45, count: 1, faction: "lattice_drift_collective" },
    ],
    camps: [
      { id: "lat_drift_site",           name: "Drift Anomaly Site",        pos: { x: 1500, z: 1500 },   buildings: ["altar:stone", "tower:stone"] },
      { id: "lat_paradox_camp",         name: "Paradox-Spawn Encampment",  pos: { x: -1500, z: 1000 },  buildings: ["house:stone", "house:stone", "watchtower:stone"] },
    ],
    dungeons: [
      { id: "lat_paradox_vault",        name: "The Paradox Vault",         pos: { x: 2500, z: -2500 },  buildings: ["tower:stone", "tower:stone", "tower:stone", "altar:stone"] },
    ],
    quests: [
      { id: "lat_q_drift_site",         giver: "concord_first_thought", title: "Investigate the Drift Site",      target: "lat_drift_site",     reward_cc: 60 },
      { id: "lat_q_paradox_camp",       giver: "concord_first_thought", title: "Disperse the Paradox-Spawn Camp", target: "lat_paradox_camp",   reward_cc: 90 },
      { id: "lat_q_paradox_vault",      giver: "concord_first_thought", title: "Seal the Paradox Vault",          target: "lat_paradox_vault",  reward_cc: 250 },
    ],
  },

  // ── superhero — villains, henchmen, alien soldiers ─────────────────────
  superhero: {
    factions: ["coalition_villains", "alien_invader_fleet"],
    hostiles: [
      { archetype: "henchman",            level: 2, hp: 50,  damage: 7,  count: 4, faction: "coalition_villains" },
      { archetype: "mutant_brute",        level: 5, hp: 140, damage: 16, count: 2, faction: "coalition_villains" },
      { archetype: "tech_villain",        level: 6, hp: 95,  damage: 18, count: 2, faction: "coalition_villains" },
      { archetype: "robot_enforcer",      level: 5, hp: 110, damage: 14, count: 3, faction: "coalition_villains" },
      { archetype: "alien_soldier",       level: 7, hp: 120, damage: 17, count: 3, faction: "alien_invader_fleet" },
      { archetype: "corrupted_hero",      level: 10, hp: 240, damage: 28, count: 1, faction: "coalition_villains" },
    ],
    camps: [
      { id: "hero_villain_lair",        name: "Villain Coalition Lair",    pos: { x: 1100, z: 1100 },   buildings: ["tower:steel", "barracks:steel", "watchtower:steel"] },
      { id: "hero_henchman_outpost",    name: "Henchman Street Outpost",   pos: { x: -800, z: 500 },    buildings: ["warehouse:brick", "warehouse:brick"] },
    ],
    dungeons: [
      { id: "hero_alien_hive",          name: "Alien Invader Hive",        pos: { x: 1800, z: -1500 },  buildings: ["altar:stone", "altar:stone", "tower:steel"] },
    ],
    quests: [
      { id: "hero_q_henchman_outpost",  giver: "coalition_luminary", title: "Bust the Henchman Outpost",       target: "hero_henchman_outpost", reward_cc: 40 },
      { id: "hero_q_villain_lair",      giver: "coalition_luminary", title: "Storm the Villain Lair",          target: "hero_villain_lair",     reward_cc: 90 },
      { id: "hero_q_alien_hive",        giver: "coalition_luminary", title: "Purge the Alien Invader Hive",    target: "hero_alien_hive",       reward_cc: 180 },
    ],
  },

  // ── concord-link-frontier — Wild-West outlaws + bandits ─────────────────
  "concord-link-frontier": {
    factions: ["frontier_outlaws"],
    hostiles: [
      { archetype: "outlaw",              level: 3, hp: 70,  damage: 10, count: 4, faction: "frontier_outlaws" },
      { archetype: "bandit",              level: 3, hp: 65,  damage: 9,  count: 3, faction: "outlaw" },
      { archetype: "bounty_hunter",       level: 5, hp: 95,  damage: 14, count: 2, faction: "neutral" },
      { archetype: "mercenary",           level: 6, hp: 110, damage: 15, count: 2, faction: "neutral" },
      { archetype: "railroad_baron",      level: 12, hp: 280, damage: 30, count: 1, faction: "frontier_outlaws" },
    ],
    camps: [
      { id: "frontier_outlaw_outpost",  name: "Outlaw Trail Outpost",      pos: { x: 700, z: 700 },     buildings: ["house:wood", "watchtower:wood", "house:wood"] },
      { id: "frontier_bandit_hideout",  name: "Bandit Canyon Hideout",     pos: { x: -1000, z: -500 },  buildings: ["house:wood", "warehouse:wood"] },
    ],
    dungeons: [
      { id: "frontier_train_tunnels",   name: "Robber-Baron Train Tunnels",pos: { x: 1500, z: 1500 },   buildings: ["warehouse:steel", "tower:steel", "tower:steel"] },
    ],
    quests: [
      { id: "frontier_q_outpost",       giver: "frontier_sheriff",   title: "Clear the Outlaw Outpost",        target: "frontier_outlaw_outpost", reward_cc: 35 },
      { id: "frontier_q_hideout",       giver: "frontier_sheriff",   title: "Smoke Out the Bandit Hideout",    target: "frontier_bandit_hideout", reward_cc: 55 },
      { id: "frontier_q_train_tunnels", giver: "frontier_sheriff",   title: "Stop the Railroad Baron",         target: "frontier_train_tunnels",  reward_cc: 160 },
    ],
  },

  // ── tunya — gang remnants + corrupted ────────────────────────────────────
  tunya: {
    factions: ["tunya_corrupted"],
    hostiles: [
      { archetype: "street_gang",         level: 2, hp: 50,  damage: 7,  count: 3, faction: "outlaw" },
      { archetype: "cultist",             level: 4, hp: 75,  damage: 11, count: 3, faction: "tunya_corrupted" },
      { archetype: "possessed",           level: 5, hp: 90,  damage: 13, count: 2, faction: "tunya_corrupted" },
      { archetype: "cult_leader",         level: 9, hp: 200, damage: 24, count: 1, faction: "tunya_corrupted" },
    ],
    camps: [
      { id: "tunya_gang_camp",          name: "Gang Remnant Camp",         pos: { x: 600, z: 600 },     buildings: ["house:wood", "watchtower:wood"] },
      { id: "tunya_cultist_grove",      name: "Corrupted Cultist Grove",   pos: { x: -800, z: 800 },    buildings: ["altar:stone", "altar:stone"] },
    ],
    dungeons: [],
    quests: [
      { id: "tunya_q_gang_camp",        giver: "tunya_elder",        title: "Disperse the Gang Camp",         target: "tunya_gang_camp",     reward_cc: 30 },
      { id: "tunya_q_cultist_grove",    giver: "tunya_elder",        title: "Cleanse the Cultist Grove",      target: "tunya_cultist_grove", reward_cc: 100 },
    ],
  },

  // ── war-zone — military enemy soldiers + mercenaries ────────────────────
  "war-zone": {
    factions: ["enemy_red_army", "war_mercenary_company"],
    hostiles: [
      { archetype: "alien_soldier",       level: 5, hp: 100, damage: 14, count: 4, faction: "enemy_red_army" },
      { archetype: "mercenary",           level: 6, hp: 115, damage: 15, count: 3, faction: "war_mercenary_company" },
      { archetype: "combat_drone",        level: 4, hp: 65,  damage: 11, count: 3, faction: "enemy_red_army" },
      { archetype: "robot_enforcer",      level: 7, hp: 140, damage: 18, count: 2, faction: "enemy_red_army" },
      { archetype: "intelligence_chief",  level: 12, hp: 280, damage: 32, count: 1, faction: "enemy_red_army" },
    ],
    camps: [
      { id: "war_enemy_fob",            name: "Enemy Forward Operating Base", pos: { x: 1200, z: 1200 }, buildings: ["barracks:steel", "barracks:steel", "watchtower:steel"] },
      { id: "war_merc_camp",            name: "Mercenary Strike Camp",     pos: { x: -1000, z: 700 },   buildings: ["barracks:steel", "warehouse:steel"] },
    ],
    dungeons: [
      { id: "war_intel_bunker",         name: "Enemy Intel Bunker",        pos: { x: 1800, z: -1800 },  buildings: ["tower:steel", "tower:steel", "warehouse:steel"] },
    ],
    quests: [
      { id: "war_q_fob",                giver: "war_commander",      title: "Take the Enemy FOB",              target: "war_enemy_fob",     reward_cc: 70 },
      { id: "war_q_merc_camp",          giver: "war_commander",      title: "Sweep the Mercenary Camp",        target: "war_merc_camp",     reward_cc: 55 },
      { id: "war_q_intel_bunker",       giver: "war_commander",      title: "Breach the Intel Bunker",         target: "war_intel_bunker",  reward_cc: 180 },
    ],
  },

  // ── wasteland-world — raiders + mutants ─────────────────────────────────
  "wasteland-world": {
    factions: ["wasteland_raider_clan"],
    hostiles: [
      { archetype: "bandit_gang",         level: 4, hp: 80,  damage: 11, count: 4, faction: "wasteland_raider_clan" },
      { archetype: "mutant_brute",        level: 6, hp: 160, damage: 18, count: 3, faction: "wasteland_raider_clan" },
      { archetype: "plague_bearer",       level: 5, hp: 100, damage: 13, count: 2, faction: "cult" },
      { archetype: "outlaw_king",         level: 11, hp: 280, damage: 30, count: 1, faction: "wasteland_raider_clan" },
    ],
    camps: [
      { id: "waste_raider_camp",        name: "Raider Scrap Camp",         pos: { x: 800, z: 800 },     buildings: ["house:steel", "watchtower:steel", "house:steel"] },
      { id: "waste_mutant_warren",      name: "Mutant Warren",             pos: { x: -1200, z: -800 },  buildings: ["tomb:stone", "tomb:stone"] },
    ],
    dungeons: [
      { id: "waste_raider_fortress",    name: "Raider King Fortress",      pos: { x: 1800, z: 1800 },   buildings: ["tower:steel", "barracks:steel", "warehouse:steel"] },
    ],
    quests: [
      { id: "waste_q_raider_camp",      giver: "waste_survivor",     title: "Burn the Raider Camp",           target: "waste_raider_camp",     reward_cc: 40 },
      { id: "waste_q_mutant_warren",    giver: "waste_survivor",     title: "Clear the Mutant Warren",        target: "waste_mutant_warren",   reward_cc: 70 },
      { id: "waste_q_raider_fortress",  giver: "waste_survivor",     title: "Topple the Raider King",         target: "waste_raider_fortress", reward_cc: 200 },
    ],
  },

  // ── crime-city — same shape as crime, named separately for the duplicate
  "crime-city": {
    factions: ["crime_city_syndicate"],
    hostiles: [
      { archetype: "street_gang",         level: 2, hp: 55,  damage: 7,  count: 4, faction: "crime_city_syndicate" },
      { archetype: "hitman",              level: 5, hp: 95,  damage: 16, count: 2, faction: "crime_city_syndicate" },
      { archetype: "corrupt_officer",     level: 4, hp: 80,  damage: 11, count: 2, faction: "crime_city_corrupt_pd" },
      { archetype: "crime_lord",          level: 12, hp: 290, damage: 32, count: 1, faction: "crime_city_syndicate" },
    ],
    camps: [
      { id: "cc_gang_hideout",          name: "City Gang Hideout",         pos: { x: 600, z: 600 },     buildings: ["warehouse:brick", "house:brick"] },
    ],
    dungeons: [
      { id: "cc_kingpin_penthouse",     name: "Kingpin Penthouse",         pos: { x: 1500, z: 1500 },   buildings: ["tower:steel", "tower:steel"] },
    ],
    quests: [
      { id: "cc_q_gang_hideout",        giver: "cc_detective",       title: "Bust the City Gang Hideout",     target: "cc_gang_hideout",       reward_cc: 45 },
      { id: "cc_q_kingpin",             giver: "cc_detective",       title: "Take Down the Kingpin",          target: "cc_kingpin_penthouse",  reward_cc: 220 },
    ],
  },

  // ── superhero-world — variant of superhero ──────────────────────────────
  "superhero-world": {
    factions: ["sw_villain_coalition"],
    hostiles: [
      { archetype: "henchman",            level: 2, hp: 50,  damage: 7,  count: 4, faction: "sw_villain_coalition" },
      { archetype: "mutant_brute",        level: 5, hp: 140, damage: 16, count: 2, faction: "sw_villain_coalition" },
      { archetype: "dimension_ruler",     level: 14, hp: 450, damage: 40, count: 1, faction: "sw_villain_coalition" },
    ],
    camps: [
      { id: "sw_villain_lair",          name: "Coalition Lair",            pos: { x: 1000, z: 1000 },   buildings: ["tower:steel", "barracks:steel"] },
    ],
    dungeons: [
      { id: "sw_dimension_rift",        name: "Dimensional Rift",          pos: { x: 1800, z: -1800 },  buildings: ["altar:stone", "altar:stone"] },
    ],
    quests: [
      { id: "sw_q_villain_lair",        giver: "sw_hero_council",    title: "Storm the Coalition Lair",       target: "sw_villain_lair",    reward_cc: 80 },
      { id: "sw_q_dimension_rift",      giver: "sw_hero_council",    title: "Close the Dimensional Rift",     target: "sw_dimension_rift",  reward_cc: 250 },
    ],
  },

  // ── fable-world — fantasy variant ───────────────────────────────────────
  "fable-world": {
    factions: ["fable_dark_court"],
    hostiles: [
      { archetype: "goblin",              level: 2, hp: 45,  damage: 6,  count: 3, faction: "fable_dark_court" },
      { archetype: "orc_warrior",         level: 4, hp: 95,  damage: 12, count: 2, faction: "fable_dark_court" },
      { archetype: "dragon_lord",         level: 15, hp: 600, damage: 50, count: 1, faction: "fable_dark_court" },
    ],
    camps: [
      { id: "fable_goblin_camp",        name: "Fable Goblin Camp",         pos: { x: 700, z: 700 },     buildings: ["watchtower:wood", "house:wood"] },
    ],
    dungeons: [
      { id: "fable_dragon_lair",        name: "Dragon Lord's Lair",        pos: { x: 2000, z: 2000 },   buildings: ["tower:stone", "tower:stone", "altar:stone"] },
    ],
    quests: [
      { id: "fable_q_goblin_camp",      giver: "fable_king",         title: "Rout the Goblin Camp",           target: "fable_goblin_camp",  reward_cc: 30 },
      { id: "fable_q_dragon_lair",      giver: "fable_king",         title: "Slay the Dragon Lord",           target: "fable_dragon_lair",  reward_cc: 300 },
    ],
  },
};

// ── Seeder ────────────────────────────────────────────────────────────────

/**
 * Seed hostile NPCs + camp/dungeon buildings + quest hooks for a single world.
 * Idempotent. Re-running won't create duplicates because each NPC/building/quest
 * gets a deterministic id and INSERT is guarded by existence check.
 */
export function seedHostilesForWorld(db, worldId) {
  if (!db) return { ok: false, reason: "no_db" };
  const config = WORLD_HOSTILE_SEEDS[worldId];
  if (!config) return { ok: true, reason: "no_config", worldId };

  let npcCount = 0, bldgCount = 0, questCount = 0;

  // 1) NPCs — spread hostiles in clusters around their camp/dungeon coords
  const allLocations = [...(config.camps || []), ...(config.dungeons || [])];
  let locIndex = 0;
  for (const spec of config.hostiles) {
    for (let i = 0; i < spec.count; i++) {
      const npcId = `${worldId}_${spec.archetype}_${i + 1}_${shortHash(worldId + spec.archetype + i)}`;
      const exists = safeGet(db, "SELECT id FROM world_npcs WHERE id = ?", [npcId]);
      if (exists) continue;
      // Distribute around one of the camp/dungeon centers
      const center = allLocations[locIndex % Math.max(1, allLocations.length)] || { pos: { x: 1000, z: 1000 } };
      const pos = {
        x: center.pos.x + (Math.random() - 0.5) * 80,
        y: 20,
        z: center.pos.z + (Math.random() - 0.5) * 80,
      };
      try {
        db.prepare(`INSERT INTO world_npcs
          (id, world_id, npc_type, archetype, body_type, universe_type, faction,
           is_conscious, is_immortal, quest_giver, level, current_hp, max_hp,
           spawn_location, current_location, state)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            npcId, worldId, spec.archetype, spec.archetype, "humanoid", worldId, spec.faction,
            0, 0, 0,
            spec.level, spec.hp, spec.hp,
            JSON.stringify(pos), JSON.stringify(pos),
            JSON.stringify({
              name: spec.archetype.replace(/_/g, " "),
              hostile: true,
              damage: spec.damage,
              aggroRadius: 12,
              camp_id: center.id || null,
            }),
          );
        npcCount++;
        locIndex++;
      } catch { /* row insert silent */ }
    }
  }

  // 2) Buildings — camps + dungeons
  for (const cluster of allLocations) {
    for (let b = 0; b < (cluster.buildings || []).length; b++) {
      const def = cluster.buildings[b]; // "watchtower:wood" → [type, material]
      const [bldgType, material] = def.split(":");
      const bldgId = `${cluster.id}_b${b + 1}`;
      const exists = safeGet(db, "SELECT id FROM world_buildings WHERE id = ?", [bldgId]);
      if (exists) continue;
      const x = cluster.pos.x + (b % 3 - 1) * 25;
      const z = cluster.pos.z + (Math.floor(b / 3) - 1) * 25;
      try {
        db.prepare(`INSERT INTO world_buildings
          (id, world_id, building_type, name, x, y, z, rotation, width, depth, height, material, floors, owner_type, owner_id, is_seed, state, health_pct)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            bldgId, worldId, bldgType,
            `${cluster.name} (${bldgType})`,
            x, 0, z, 0,
            10, 10, 6, material, 1,
            "faction", config.factions[0] || "hostile",
            1, "standing", 1.0,
          );
        bldgCount++;
      } catch { /* row insert silent */ }
    }
  }

  // 3) Quests — kill-mission quests targeting each camp/dungeon.
  // world_quests schema (migration 042): id, world_id, giver_npc_id, title,
  // description, objectives_json, reward_json, status, created_at, accepted_by, completed_at
  for (const q of config.quests || []) {
    const exists = safeGet(db, "SELECT id FROM world_quests WHERE id = ?", [q.id]);
    if (exists) continue;
    try {
      db.prepare(`INSERT INTO world_quests
        (id, world_id, giver_npc_id, title, description, objectives_json, reward_json, status)
        VALUES (?,?,?,?,?,?,?,?)`).run(
          q.id, worldId, q.giver, q.title,
          `Clear all hostile NPCs at ${q.target}. Return to ${q.giver} for reward.`,
          JSON.stringify([
            { kind: "clear_camp", target: q.target, description: `Eliminate all hostile NPCs in ${q.target}` },
            { kind: "return", target: q.giver, description: `Report to ${q.giver}` },
          ]),
          JSON.stringify({ cc: q.reward_cc, xp: q.reward_cc * 10 }),
          "available",
        );
      questCount++;
    } catch { /* row insert silent — table may lack columns on older deploys */ }
  }

  return { ok: true, worldId, npcs: npcCount, buildings: bldgCount, quests: questCount };
}

/**
 * Seed all configured worlds. Returns per-world summary.
 */
export function seedAllWorldHostiles(db) {
  if (!db) return { ok: false, reason: "no_db" };
  const summary = {};
  for (const worldId of Object.keys(WORLD_HOSTILE_SEEDS)) {
    summary[worldId] = seedHostilesForWorld(db, worldId);
  }
  return { ok: true, summary };
}

// Helpers
function safeGet(db, sql, params) {
  try { return db.prepare(sql).get(...params); } catch { return null; }
}
function shortHash(s) { return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 6); }
