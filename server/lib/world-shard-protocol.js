// server/lib/world-shard-protocol.js
//
// Message types exchanged between the parent process (world-shard-manager)
// and each forked world-shard child (workers/world-shard.js).
//
// Keep this file dependency-free — both processes import it, including the
// child which boots fresh.

/** Parent → Child messages. */
export const PARENT_TO_CHILD = Object.freeze({
  INIT: "shard:init",
  TICK: "shard:tick",
  STATE_SYNC: "shard:state-sync",
  SHUTDOWN: "shard:shutdown",
});

/** Child → Parent messages. */
export const CHILD_TO_PARENT = Object.freeze({
  READY: "shard:ready",
  TICK_RESULT: "shard:tick-result",
  EMIT: "shard:emit",
  LOG: "shard:log",
  ERROR: "shard:error",
});

/**
 * Whether a write SQL statement targets a per-world table (write-owned by the
 * world shard) or a user-global table (write-owned by the parent process).
 * Pattern-matched on the TABLE name so the rule survives schema renames.
 *
 * Per CLAUDE.md (Phase F) — DB write-ownership rules.
 */
export const PER_WORLD_WRITE_TABLES = Object.freeze(new Set([
  "world_npcs",
  "city_presence",
  "npc_routine_state",
  "world_events",
  "world_buildings",
  "world_terrain_deformations",
  "world_water_cells",
  "employment_edges",
  "movements",
  "movement_members",
  "movement_plans",
  "movement_visibility",
  "world_seasons",
  "season_events",
  "npc_schedules",
  "embodied_signal_log",
  "creature_motion",
  "creature_corpses",
  "dreams",
  "forward_predictions",
  "faction_strategy_state",
  "faction_relations",
  "faction_strategy_log",
  "lattice_born_quests",
  "procgen_regions",
  "procgen_region_visits",
  "land_claims",
  "land_claim_invites",
  "land_claim_events",
  "quest_triggers",
  "quest_trigger_visits",
  "player_signs",
  "player_corpses",
  "npc_economy_flows",
  "regional_scarcity",
  "npc_inventory",
  "npc_grudges",
  "npc_preoccupations",
  "npc_desires",
  "npc_schemes",
  "npc_stress",
  "character_opinions",
  "secrets",
]));

/**
 * User-global tables (write-owned by the parent process).
 */
export const USER_GLOBAL_WRITE_TABLES = Object.freeze(new Set([
  "users",
  "user_wallets",
  "user_active_effects",
  "dtus",
  "dtu_citations",
  "economy_ledger",
  "pain_signals",
  "mentorships",
  "npc_skill_acquisitions",
  "player_inventory",       // scoped by world_id column but written by HTTP routes on parent
  "schema_version",
  "auth_sessions",
  "refresh_tokens",
]));

/** Resolve the shard-control flag at runtime so tests can override per-env. */
export function shardingEnabled() {
  return process.env.CONCORD_SHARD_WORLDS === "true" || process.env.CONCORD_SHARD_WORLDS === "1";
}
