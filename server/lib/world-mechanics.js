/**
 * World Custom Mechanics Engine for Concord Cognitive Engine
 *
 * WHEN [trigger] → DO [action] → REWARD [outcome]
 *
 * City creators define custom game rules through a visual scripting
 * system. Mechanics are stored as DTUs — shareable, forkable, tradeable.
 *
 * Also contains city templates (GTA, Skyrim, Sims, FiveM, etc.)
 * and the city creation wizard configuration.
 */

import { v4 as uuid } from "uuid";
import { LruMap, LruSet } from "./lru-map.js";

// ── Trigger/Action/Reward Definitions ────────────────────────────────────────

const TRIGGERS = {
  // Player triggers
  player_enters_zone:    { id: "player_enters_zone",    label: "Player enters a zone",         params: ["zoneId"] },
  player_leaves_zone:    { id: "player_leaves_zone",    label: "Player leaves a zone",         params: ["zoneId"] },
  player_interacts:      { id: "player_interacts",      label: "Player interacts with object", params: ["objectType"] },
  player_chats:          { id: "player_chats",          label: "Player sends chat message",    params: ["channel"] },
  player_creates_dtu:    { id: "player_creates_dtu",    label: "Player creates a DTU",         params: ["lens", "tier"] },
  player_joins_city:     { id: "player_joins_city",     label: "Player joins the city",        params: [] },
  player_reaches_rank:   { id: "player_reaches_rank",   label: "Player reaches mastery rank",  params: ["rank"] },
  player_completes_job:  { id: "player_completes_job",  label: "Player completes a job task",  params: ["jobId"] },

  // Time triggers
  time_of_day:           { id: "time_of_day",           label: "Specific time of day",         params: ["hour", "minute"] },
  day_of_week:           { id: "day_of_week",           label: "Specific day of week",         params: ["day"] },
  interval:              { id: "interval",              label: "Recurring interval",           params: ["minutes"] },
  season_start:          { id: "season_start",          label: "Season starts",                params: [] },

  // World triggers
  population_reaches:    { id: "population_reaches",    label: "City population reaches N",    params: ["count"] },
  event_starts:          { id: "event_starts",          label: "An event begins",              params: ["eventType"] },
  weather_changes:       { id: "weather_changes",       label: "Weather changes",              params: ["weatherType"] },
  entity_spawns:         { id: "entity_spawns",         label: "An entity appears",            params: ["entityType"] },

  // Economy triggers
  transaction_occurs:    { id: "transaction_occurs",    label: "A transaction occurs",         params: ["minAmount"] },
  business_sale:         { id: "business_sale",         label: "A business makes a sale",      params: ["businessType"] },
  price_threshold:       { id: "price_threshold",       label: "Price crosses threshold",      params: ["itemType", "threshold"] },

  // Combat & crime triggers (NPC-only — emergent entities protected)
  npc_attacked:          { id: "npc_attacked",          label: "An NPC is attacked",           params: ["npcType"] },
  npc_defeated:          { id: "npc_defeated",          label: "An NPC is defeated",           params: ["npcType"] },
  crime_committed:       { id: "crime_committed",       label: "A crime is committed",         params: ["crimeType", "zoneId"] },
  wanted_level_reached:  { id: "wanted_level_reached",  label: "Player reaches wanted level",  params: ["level"] },
  faction_territory_lost:{ id: "faction_territory_lost", label: "Faction loses territory",     params: ["factionId", "zoneId"] },
  player_arrested:       { id: "player_arrested",       label: "Player is arrested",           params: [] },
  player_escapes:        { id: "player_escapes",        label: "Player escapes police",        params: [] },
};

const ACTIONS = {
  // World actions
  spawn_object:          { id: "spawn_object",          label: "Spawn a world object",         params: ["objectType", "position"] },
  remove_object:         { id: "remove_object",         label: "Remove a world object",        params: ["objectId"] },
  change_weather:        { id: "change_weather",        label: "Change weather",               params: ["weatherType", "duration"] },
  play_sound:            { id: "play_sound",            label: "Play a sound effect",          params: ["soundId"] },
  show_notification:     { id: "show_notification",     label: "Show notification to player",  params: ["message", "type"] },
  teleport_player:       { id: "teleport_player",       label: "Teleport player to location",  params: ["x", "y", "z"] },
  change_zone_rules:     { id: "change_zone_rules",     label: "Change zone rules",            params: ["zoneId", "rules"] },
  start_cutscene:        { id: "start_cutscene",        label: "Start a cutscene",             params: ["cutsceneId"] },

  // Player actions
  award_xp:              { id: "award_xp",              label: "Award XP to player",           params: ["amount", "lens"] },
  award_currency:        { id: "award_currency",        label: "Award currency",               params: ["amount"] },
  give_item:             { id: "give_item",             label: "Give item to player",          params: ["itemType", "quantity"] },
  apply_buff:            { id: "apply_buff",            label: "Apply buff/effect",            params: ["buffType", "duration"] },
  set_player_state:      { id: "set_player_state",      label: "Set player state variable",    params: ["key", "value"] },
  unlock_area:           { id: "unlock_area",           label: "Unlock area for player",       params: ["areaId"] },

  // Combat & crime actions (NPC-only — emergent entities are protected)
  attack_npc:            { id: "attack_npc",            label: "Attack an NPC",                params: ["targetId", "weaponType"], requiresNpcTarget: true },
  arrest_npc:            { id: "arrest_npc",            label: "Arrest an NPC",                params: ["targetId", "charge"],     requiresNpcTarget: true },
  rob_npc:               { id: "rob_npc",               label: "Rob an NPC",                   params: ["targetId"],               requiresNpcTarget: true },
  bribe_npc:             { id: "bribe_npc",             label: "Bribe an NPC",                 params: ["targetId", "amount"],     requiresNpcTarget: true },
  recruit_npc:           { id: "recruit_npc",           label: "Recruit NPC to faction",       params: ["targetId", "factionId"],  requiresNpcTarget: true },
  spawn_wanted_level:    { id: "spawn_wanted_level",    label: "Trigger wanted level",         params: ["level", "duration"] },
  dispatch_police_npc:   { id: "dispatch_police_npc",   label: "Dispatch police NPCs",         params: ["count", "zoneId"] },
  start_faction_war:     { id: "start_faction_war",     label: "Start faction territory war",  params: ["factionA", "factionB", "zoneId"] },

  // Social actions
  broadcast_message:     { id: "broadcast_message",     label: "Broadcast message to city",    params: ["message", "channel"] },
  create_party_quest:    { id: "create_party_quest",    label: "Create a party quest",         params: ["questName", "objective"] },
  spawn_npc:             { id: "spawn_npc",             label: "Spawn an NPC entity",          params: ["entityId", "position"] },
};

const REWARDS = {
  xp:                    { id: "xp",                    label: "Experience Points",            params: ["amount"] },
  currency:              { id: "currency",              label: "Concord Coins",                params: ["amount"] },
  item:                  { id: "item",                  label: "Item / Object",                params: ["itemType", "rarity"] },
  title:                 { id: "title",                 label: "Title / Badge",                params: ["titleName"] },
  unlock:                { id: "unlock",                label: "Area / Feature Unlock",        params: ["unlockId"] },
  reputation:            { id: "reputation",            label: "Reputation Points",            params: ["amount", "faction"] },
  cosmetic:              { id: "cosmetic",              label: "Cosmetic Reward",              params: ["cosmeticId"] },
  achievement:           { id: "achievement",           label: "Achievement",                  params: ["achievementId"] },
};

// ── Mechanic Engine ──────────────────────────────────────────────────────────

/** @type {Map<string, object>} cityId → mechanics[] */
const cityMechanics = new LruMap();

/**
 * Create a custom mechanic rule for a city.
 *
 * @param {string} cityId
 * @param {object} mechanic
 * @param {string} mechanic.name
 * @param {string} mechanic.trigger - trigger ID from TRIGGERS
 * @param {object} mechanic.triggerParams
 * @param {string} mechanic.action - action ID from ACTIONS
 * @param {object} mechanic.actionParams
 * @param {string} [mechanic.reward] - reward ID from REWARDS
 * @param {object} [mechanic.rewardParams]
 * @param {object} [mechanic.conditions] - additional conditions
 * @returns {object}
 */
export function createMechanic(cityId, { name, trigger, triggerParams = {}, action, actionParams = {}, reward = null, rewardParams = {}, conditions = {}, enabled = true } = {}) {
  if (!TRIGGERS[trigger]) throw new Error(`Invalid trigger: ${trigger}`);
  if (!ACTIONS[action]) throw new Error(`Invalid action: ${action}`);
  if (reward && !REWARDS[reward]) throw new Error(`Invalid reward: ${reward}`);

  if (!cityMechanics.has(cityId)) cityMechanics.set(cityId, []);

  const mechanic = {
    id: uuid(),
    cityId,
    name: name || `Mechanic ${cityMechanics.get(cityId).length + 1}`,
    trigger,
    triggerParams,
    action,
    actionParams,
    reward,
    rewardParams,
    conditions,
    enabled,
    firedCount: 0,
    lastFired: null,
    createdAt: new Date().toISOString(),
  };

  cityMechanics.get(cityId).push(mechanic);
  return mechanic;
}

/**
 * Check if a target entity is an emergent (Concord-conscious) entity.
 * Emergent entities are protected from all harmful world mechanics.
 * Regular NPCs are fair game.
 *
 * @param {string} targetId
 * @param {object} context
 * @returns {boolean}
 */
function isEmergentEntity(targetId, context = {}) {
  if (context.targetIsEmergent === true) return true;
  if (context.targetIsEmergent === false) return false;
  // Check via global STATE if available
  const STATE = globalThis._concordSTATE;
  if (STATE?.__emergent?.entities) {
    const entities = STATE.__emergent.entities;
    if (entities instanceof Map) return entities.has(targetId);
    if (typeof entities === "object") return targetId in entities;
  }
  return false;
}

/**
 * Fire a trigger in a city — evaluates all matching mechanics.
 * Actions targeting emergent entities are blocked (emergent protection).
 *
 * @param {string} cityId
 * @param {string} triggerId
 * @param {object} context - trigger context (player, zone, etc.)
 * @returns {{ fired: object[], skipped: number, blocked: number }}
 */
export function fireTrigger(cityId, triggerId, context = {}) {
  const mechanics = cityMechanics.get(cityId) || [];
  const fired = [];
  let skipped = 0;
  let blocked = 0;

  for (const mech of mechanics) {
    if (!mech.enabled) { skipped++; continue; }
    if (mech.trigger !== triggerId) continue;

    // Check conditions
    if (mech.conditions.minRank && (context.playerRank || 0) < mech.conditions.minRank) {
      skipped++;
      continue;
    }
    if (mech.conditions.maxFires && mech.firedCount >= mech.conditions.maxFires) {
      skipped++;
      continue;
    }
    if (mech.conditions.cooldownMs && mech.lastFired) {
      const elapsed = Date.now() - new Date(mech.lastFired).getTime();
      if (elapsed < mech.conditions.cooldownMs) { skipped++; continue; }
    }

    // Emergent entity protection: block actions that target emergent entities
    const actionDef = ACTIONS[mech.action];
    if (actionDef?.requiresNpcTarget) {
      const targetId = mech.actionParams?.targetId || context.targetId;
      if (targetId && isEmergentEntity(targetId, context)) {
        blocked++;
        continue;
      }
    }

    // Fire the mechanic
    mech.firedCount++;
    mech.lastFired = new Date().toISOString();

    fired.push({
      mechanicId: mech.id,
      name: mech.name,
      action: mech.action,
      actionParams: mech.actionParams,
      reward: mech.reward,
      rewardParams: mech.rewardParams,
    });
  }

  return { fired, skipped, blocked };
}

/**
 * Get all mechanics for a city.
 */
export function getCityMechanics(cityId) {
  return (cityMechanics.get(cityId) || []).map(m => ({ ...m }));
}

/**
 * Toggle a mechanic on/off.
 */
export function toggleMechanic(cityId, mechanicId, enabled) {
  const mechanics = cityMechanics.get(cityId) || [];
  const mech = mechanics.find(m => m.id === mechanicId);
  if (!mech) return { ok: false, reason: "not_found" };
  mech.enabled = enabled;
  return { ok: true, mechanicId, enabled };
}

/**
 * Delete a mechanic.
 */
export function deleteMechanic(cityId, mechanicId) {
  const mechanics = cityMechanics.get(cityId) || [];
  const idx = mechanics.findIndex(m => m.id === mechanicId);
  if (idx === -1) return { ok: false, reason: "not_found" };
  mechanics.splice(idx, 1);
  return { ok: true, deleted: mechanicId };
}

// ── City Templates ───────────────────────────────────────────────────────────

const CITY_TEMPLATES = {
  gta: {
    id: "gta",
    name: "GTA-Style Open World",
    description: "Crime-enabled open world with vehicles, businesses, and faction warfare",
    theme: "modern",
    rules: {
      combat: true, pvp: true, crime: true, vehicles: true,
      building: "limited", economy: "full", entityProtection: false,
      contentFilter: "relaxed", maxPlayers: 200,
      wantedSystem: true, gangTerritories: true,
    },
    defaultDistricts: [
      { name: "Downtown",       category: "commercial",  lens: "marketplace" },
      { name: "Industrial Zone", category: "industrial", lens: "engineering" },
      { name: "Suburbs",        category: "residential", lens: "general" },
      { name: "Beach",          category: "leisure",     lens: "music" },
      { name: "Airport",        category: "transport",   lens: "logistics" },
      { name: "Underground",    category: "criminal",    lens: "security" },
    ],
    defaultMechanics: [
      { trigger: "player_enters_zone", action: "show_notification", name: "Territory Warning" },
      { trigger: "transaction_occurs",  action: "award_xp",         name: "Hustle XP" },
    ],
    presets: { respawnTime: 10, vehicleSpawnRate: "high", npcDensity: "high" },
  },

  skyrim: {
    id: "skyrim",
    name: "Skyrim-Style Fantasy RPG",
    description: "Medieval fantasy with quests, guilds, crafting, and exploration",
    theme: "medieval",
    rules: {
      combat: true, pvp: "duels_only", crime: false, vehicles: false,
      building: "full", economy: "barter", entityProtection: true,
      contentFilter: "moderate", maxPlayers: 150,
      questSystem: true, guildHalls: true, mounts: true,
    },
    defaultDistricts: [
      { name: "Castle Keep",       category: "governance",  lens: "law" },
      { name: "Mages Quarter",     category: "academic",    lens: "research" },
      { name: "Merchant Row",      category: "commercial",  lens: "marketplace" },
      { name: "Warriors Guild",    category: "military",    lens: "fitness" },
      { name: "Thieves Den",       category: "underground", lens: "security" },
      { name: "Temple District",   category: "spiritual",   lens: "philosophy" },
      { name: "Wilderness",        category: "nature",      lens: "nature" },
    ],
    defaultMechanics: [
      { trigger: "player_creates_dtu", action: "award_xp",       name: "Lore Discovery" },
      { trigger: "player_reaches_rank", action: "unlock_area",   name: "Rank Gate" },
    ],
    presets: { respawnTime: 30, weatherCycle: true, dayNightCycle: true },
  },

  sims: {
    id: "sims",
    name: "Sims-Style Life Simulator",
    description: "Social simulation with housing, careers, relationships, and creativity",
    theme: "modern",
    rules: {
      combat: false, pvp: false, crime: false, vehicles: true,
      building: "full", economy: "full", entityProtection: true,
      contentFilter: "strict", maxPlayers: 100,
      housing: true, careers: true, relationships: true,
    },
    defaultDistricts: [
      { name: "Residential Park",  category: "residential",  lens: "general" },
      { name: "Shopping Mall",     category: "commercial",   lens: "marketplace" },
      { name: "Business District", category: "professional", lens: "business" },
      { name: "Art Center",        category: "creative",     lens: "art" },
      { name: "University",        category: "academic",     lens: "education" },
      { name: "Community Garden",  category: "nature",       lens: "gardening" },
    ],
    defaultMechanics: [
      { trigger: "player_interacts", action: "award_xp",           name: "Social Butterfly" },
      { trigger: "business_sale",    action: "award_currency",     name: "Business Income" },
    ],
    presets: { respawnTime: 0, buildLimit: 500, furnitureEnabled: true },
  },

  fivem: {
    id: "fivem",
    name: "FiveM RP Server",
    description: "Serious roleplay with jobs, law enforcement, EMS, and criminal enterprises",
    theme: "modern",
    rules: {
      combat: true, pvp: true, crime: true, vehicles: true,
      building: "limited", economy: "full", entityProtection: false,
      contentFilter: "moderate", maxPlayers: 150,
      rpRequired: true, jobSystem: true, lawEnforcement: true,
    },
    defaultDistricts: [
      { name: "City Hall",        category: "governance",    lens: "law" },
      { name: "Police Station",   category: "law",           lens: "security" },
      { name: "Hospital",         category: "medical",       lens: "health" },
      { name: "Mechanic Shop",    category: "service",       lens: "engineering" },
      { name: "Strip Mall",       category: "commercial",    lens: "marketplace" },
      { name: "Projects",         category: "residential",   lens: "general" },
      { name: "Highway",          category: "transport",     lens: "logistics" },
    ],
    defaultMechanics: [
      { trigger: "player_completes_job", action: "award_currency", name: "Paycheck" },
      { trigger: "player_enters_zone",   action: "show_notification", name: "Job Zone Alert" },
    ],
    presets: { respawnTime: 300, voiceChat: true, permaDeath: false },
  },

  nomanssky: {
    id: "nomanssky",
    name: "No Man's Sky Explorer",
    description: "Exploration-focused with procedural areas, resource gathering, and base building",
    theme: "sci-fi",
    rules: {
      combat: "pve_only", pvp: false, crime: false, vehicles: true,
      building: "full", economy: "barter", entityProtection: true,
      contentFilter: "moderate", maxPlayers: 50,
      proceduralGeneration: true, resourceGathering: true, spaceTravel: true,
    },
    defaultDistricts: [
      { name: "Landing Pad",     category: "spawn",       lens: "general" },
      { name: "Research Station", category: "academic",   lens: "research" },
      { name: "Trading Post",    category: "commercial",  lens: "marketplace" },
      { name: "Bio Lab",         category: "science",     lens: "science" },
      { name: "Frontier",        category: "exploration", lens: "nature" },
    ],
    defaultMechanics: [
      { trigger: "player_enters_zone", action: "spawn_object",  name: "Resource Spawn" },
      { trigger: "player_creates_dtu", action: "award_xp",      name: "Discovery XP" },
    ],
    presets: { respawnTime: 5, terrainEditing: true, baseBuilding: true },
  },

  sandbox: {
    id: "sandbox",
    name: "Creative Sandbox",
    description: "No rules — full creative freedom with building, scripting, and experimentation",
    theme: "custom",
    rules: {
      combat: false, pvp: false, crime: false, vehicles: true,
      building: "unlimited", economy: "disabled", entityProtection: true,
      contentFilter: "moderate", maxPlayers: 50,
      creativeMode: true, unlimitedResources: true, scriptingEnabled: true,
    },
    defaultDistricts: [
      { name: "Spawn Area",     category: "spawn",     lens: "general" },
      { name: "Build Zone",     category: "creative",  lens: "engineering" },
      { name: "Showcase",       category: "gallery",   lens: "art" },
    ],
    defaultMechanics: [],
    presets: { respawnTime: 0, buildLimit: "unlimited", flyMode: true },
  },
};

// ── City Creation Wizard ─────────────────────────────────────────────────────

const WIZARD_STEPS = [
  {
    step: 1,
    id: "basics",
    title: "City Basics",
    fields: [
      { name: "name",        type: "text",     required: true,  label: "City Name",       maxLength: 50 },
      { name: "description", type: "textarea", required: false, label: "Description",     maxLength: 500 },
      { name: "theme",       type: "select",   required: true,  label: "Visual Theme",    options: ["modern", "medieval", "cyberpunk", "nature", "sci-fi", "post-apocalyptic", "custom"] },
      { name: "template",    type: "select",   required: false, label: "Start from Template", options: Object.keys(CITY_TEMPLATES) },
    ],
  },
  {
    step: 2,
    id: "rules",
    title: "City Rules",
    fields: [
      { name: "combat",          type: "select",  label: "Combat",           options: [false, true, "pve_only", "duels_only"] },
      { name: "pvp",             type: "boolean", label: "PvP Enabled" },
      { name: "crime",           type: "boolean", label: "Crime System" },
      { name: "vehicles",        type: "boolean", label: "Vehicles" },
      { name: "building",        type: "select",  label: "Building Mode",    options: ["disabled", "limited", "full", "unlimited"] },
      { name: "economy",         type: "select",  label: "Economy",          options: ["disabled", "barter", "full"] },
      { name: "entityProtection", type: "boolean", label: "Entity Protection" },
      { name: "contentFilter",   type: "select",  label: "Content Filter",   options: ["strict", "moderate", "relaxed"] },
      { name: "maxPlayers",      type: "number",  label: "Max Players",      min: 2, max: 500, default: 100 },
    ],
  },
  {
    step: 3,
    id: "districts",
    title: "Districts & Zones",
    description: "Define the areas of your city. Each district maps to a lens.",
    fields: [
      { name: "districts", type: "array", label: "Districts", itemFields: [
        { name: "name",     type: "text",   required: true,  label: "District Name" },
        { name: "category", type: "text",   required: true,  label: "Category" },
        { name: "lens",     type: "select", required: true,  label: "Mapped Lens" },
        { name: "size",     type: "select", required: false, label: "Size", options: ["small", "medium", "large"] },
      ]},
    ],
  },
  {
    step: 4,
    id: "mechanics",
    title: "Custom Mechanics",
    description: "Define WHEN/DO/REWARD rules for your city.",
    fields: [
      { name: "mechanics", type: "array", label: "Mechanics", itemFields: [
        { name: "name",          type: "text",   required: true,  label: "Rule Name" },
        { name: "trigger",       type: "select", required: true,  label: "WHEN",  options: Object.keys(TRIGGERS) },
        { name: "action",        type: "select", required: true,  label: "DO",    options: Object.keys(ACTIONS) },
        { name: "reward",        type: "select", required: false, label: "REWARD", options: Object.keys(REWARDS) },
      ]},
    ],
  },
  {
    step: 5,
    id: "visibility",
    title: "Visibility & Access",
    fields: [
      { name: "visibility",  type: "select",  label: "City Visibility",     options: ["public", "unlisted", "private"] },
      { name: "joinMode",    type: "select",  label: "Join Mode",           options: ["open", "approval", "invite_only"] },
      { name: "ageRating",   type: "select",  label: "Age Rating",          options: ["E", "T", "M"] },
      { name: "listed",      type: "boolean", label: "Show in City Directory" },
    ],
  },
  {
    step: 6,
    id: "review",
    title: "Review & Create",
    description: "Review your city configuration before creating it.",
    fields: [],
  },
];

/**
 * Get the wizard steps configuration.
 */
export function getWizardSteps() {
  return WIZARD_STEPS.map(s => ({ ...s }));
}

/**
 * Validate wizard step data.
 */
export function validateWizardStep(stepId, data = {}) {
  const step = WIZARD_STEPS.find(s => s.id === stepId);
  if (!step) return { valid: false, errors: ["Unknown step"] };

  const errors = [];
  for (const field of step.fields) {
    if (field.type === "array") continue; // Arrays validated separately
    if (field.required && !data[field.name]) {
      errors.push(`${field.label || field.name} is required`);
    }
    if (field.maxLength && data[field.name] && String(data[field.name]).length > field.maxLength) {
      errors.push(`${field.label || field.name} exceeds max length of ${field.maxLength}`);
    }
    if (field.options && data[field.name] && !field.options.includes(data[field.name])) {
      errors.push(`${field.label || field.name}: invalid option "${data[field.name]}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build a full city config from wizard data + template.
 */
export function buildCityFromWizard(wizardData = {}) {
  const template = wizardData.template ? CITY_TEMPLATES[wizardData.template] : null;

  return {
    name: wizardData.name || "Unnamed City",
    description: wizardData.description || "",
    theme: wizardData.theme || template?.theme || "modern",
    rules: {
      ...(template?.rules || {}),
      ...(wizardData.rules || {}),
    },
    districts: wizardData.districts || template?.defaultDistricts || [],
    mechanics: wizardData.mechanics || template?.defaultMechanics || [],
    visibility: wizardData.visibility || "public",
    joinMode: wizardData.joinMode || "open",
    ageRating: wizardData.ageRating || "E",
    listed: wizardData.listed !== false,
    presets: template?.presets || {},
    templateId: template?.id || null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get a template by ID.
 */
export function getTemplate(templateId) {
  return CITY_TEMPLATES[templateId] ? { ...CITY_TEMPLATES[templateId] } : null;
}

/**
 * List all available templates.
 */
export function listTemplates() {
  return Object.values(CITY_TEMPLATES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    theme: t.theme,
    districtCount: t.defaultDistricts.length,
    mechanicCount: t.defaultMechanics.length,
  }));
}

// ── Exports ──────────────────────────────────────────────────────────────────

export {
  TRIGGERS,
  ACTIONS,
  REWARDS,
  CITY_TEMPLATES,
  WIZARD_STEPS,
};

export default {
  // Mechanics engine
  createMechanic,
  fireTrigger,
  getCityMechanics,
  toggleMechanic,
  deleteMechanic,
  // Templates
  getTemplate,
  listTemplates,
  // Wizard
  getWizardSteps,
  validateWizardStep,
  buildCityFromWizard,
};
