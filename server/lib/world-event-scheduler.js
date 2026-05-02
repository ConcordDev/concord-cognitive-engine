/**
 * World event auto-generation scheduler.
 *
 * Generates recurring world events (concerts, markets, debates, raids, etc.)
 * based on weekly cadence + district-appropriate type. Runs on a slow tick
 * (~every 10 minutes) and only creates an event when none of that type is
 * already active in the world.
 *
 * Cadence (per world):
 *   • daily   — meetup, market
 *   • 2/week  — workshop, debate, exhibition
 *   • weekly  — concert, tournament, hackathon, ceremony
 *   • monthly — rally, festival, raid
 *
 * District affinity decides where each event lands:
 *   concert/exhibition → arts | nexus
 *   market/meetup      → exchange | commons
 *   tournament/raid    → arena
 *   hackathon          → tech | grid
 *   workshop/debate    → academy | observatory
 *   rally/ceremony     → civic | nexus
 */

import { createEvent, EVENT_TYPES } from "./world-events.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS  = 24 * ONE_HOUR_MS;

const CADENCE_MS = {
  meetup:       ONE_DAY_MS,
  market:       ONE_DAY_MS,
  workshop:     ONE_DAY_MS * 3.5,
  debate:       ONE_DAY_MS * 3.5,
  exhibition:   ONE_DAY_MS * 3.5,
  concert:      ONE_DAY_MS * 7,
  tournament:   ONE_DAY_MS * 7,
  hackathon:    ONE_DAY_MS * 7,
  ceremony:     ONE_DAY_MS * 7,
  rally:        ONE_DAY_MS * 30,
  festival:     ONE_DAY_MS * 30,
  raid:         ONE_DAY_MS * 14,
  referendum:   ONE_DAY_MS * 30,
};

const DISTRICT_AFFINITY = {
  concert:    ["district-arts", "district-nexus"],
  exhibition: ["district-arts", "district-nexus"],
  market:     ["district-exchange", "district-commons"],
  meetup:     ["district-commons", "district-exchange"],
  tournament: ["district-arena"],
  raid:       ["district-arena", "district-frontier"],
  hackathon:  ["district-tech", "district-grid"],
  workshop:   ["district-academy", "district-observatory"],
  debate:     ["district-academy", "district-observatory"],
  rally:      ["district-civic", "district-nexus"],
  ceremony:   ["district-civic", "district-nexus"],
  festival:   ["district-arts", "district-commons"],
  referendum: ["district-civic"],
};

const _lastGeneratedAt = new Map(); // `${worldId}:${type}` -> ts

function key(worldId, type) {
  return `${worldId}:${type}`;
}

function pickDistrict(eventType) {
  const list = DISTRICT_AFFINITY[eventType] ?? ["district-commons"];
  return list[Math.floor(Math.random() * list.length)];
}

// Per-event-type host pool — picks a Concordia NPC whose role fits the event.
const HOST_POOL = {
  concert:    [{ id: "scribe_tollan",     name: "Tollan Greave" }, { id: "wanderer_kael",  name: "Kael" }],
  exhibition: [{ id: "archivist_maren",   name: "Maren Ashveil" }, { id: "scribe_tollan",  name: "Tollan Greave" }],
  market:     [{ id: "lorekeeper_yshe",   name: "Yshe Dawnmere" }, { id: "factor_cade",    name: "Factor Cade" }],
  meetup:     [{ id: "wanderer_kael",     name: "Kael" }, { id: "factor_cade",            name: "Factor Cade" }],
  workshop:   [{ id: "scribe_tollan",     name: "Tollan Greave" }, { id: "archivist_maren", name: "Maren Ashveil" }],
  debate:     [{ id: "archivist_maren",   name: "Maren Ashveil" }, { id: "factor_cade",     name: "Factor Cade" }],
  tournament: [{ id: "captain_rael",      name: "Captain Rael" }, { id: "warden_voss",     name: "Commander Voss" }],
  hackathon:  [{ id: "lorekeeper_yshe",   name: "Yshe Dawnmere" }, { id: "scribe_tollan",   name: "Tollan Greave" }],
  ceremony:   [{ id: "warden_voss",       name: "Commander Voss" }, { id: "factor_cade",   name: "Factor Cade" }],
  rally:      [{ id: "captain_rael",      name: "Captain Rael" }, { id: "factor_cade",     name: "Factor Cade" }],
  festival:   [{ id: "wanderer_kael",     name: "Kael" }, { id: "lorekeeper_yshe",         name: "Yshe Dawnmere" }],
  raid:       [{ id: "captain_rael",      name: "Captain Rael" }, { id: "broker_sael",     name: "Sael" }],
  referendum: [{ id: "factor_cade",       name: "Factor Cade" }, { id: "warden_voss",      name: "Commander Voss" }],
};

function pickHost(eventType) {
  const pool = HOST_POOL[eventType] ?? [{ id: "wanderer_kael", name: "Kael" }];
  return pool[Math.floor(Math.random() * pool.length)];
}

// Reward scaling: CC payout + skill XP, weighted by event significance.
function computeReward(eventType, def) {
  const tiers = {
    concert:    { cc: 30,  skillXp: 0.10, dtuChance: 0.30 },
    exhibition: { cc: 25,  skillXp: 0.12, dtuChance: 0.40 },
    market:     { cc: 15,  skillXp: 0.05, dtuChance: 0.20 },
    meetup:     { cc: 10,  skillXp: 0.04, dtuChance: 0.15 },
    workshop:   { cc: 35,  skillXp: 0.20, dtuChance: 0.50 },
    debate:     { cc: 25,  skillXp: 0.12, dtuChance: 0.30 },
    tournament: { cc: 80,  skillXp: 0.25, dtuChance: 0.40 },
    hackathon:  { cc: 100, skillXp: 0.30, dtuChance: 0.60 },
    ceremony:   { cc: 50,  skillXp: 0.10, dtuChance: 0.30 },
    rally:      { cc: 20,  skillXp: 0.05, dtuChance: 0.10 },
    festival:   { cc: 60,  skillXp: 0.15, dtuChance: 0.40 },
    raid:       { cc: 200, skillXp: 0.50, dtuChance: 0.80 },
    referendum: { cc: 25,  skillXp: 0.10, dtuChance: 0.20 },
  };
  return tiers[eventType] ?? { cc: 10, skillXp: 0.05, dtuChance: 0.10 };
}

function flavorTitle(eventType) {
  const titles = {
    concert:    ["Sunset Sessions", "Echoes of the Forge", "Lattice Live", "Resonance Night"],
    market:     ["Exchange Day Market", "Linkwalker's Bazaar", "Quartermaster's Sale"],
    meetup:     ["Concordia Gathering", "Open Commons Meetup", "Newcomers' Circle"],
    workshop:   ["DTU Forging Workshop", "Citation Mastery Class", "Macro Authoring Lab"],
    debate:     ["Public Debate: Substrate Future", "Council Forum: Open Floor", "Open Verdict"],
    exhibition: ["Gallery Open House", "Lineage Exhibition", "Evo-Asset Showcase"],
    tournament: ["Arena Championship", "Open Combat Tournament", "Skill Showcase"],
    hackathon:  ["Concord Build Sprint", "Plugin Hackathon", "Macro Marathon"],
    ceremony:   ["Creator Awards", "Mastery Recognition", "Legendary Roll Call"],
    rally:      ["Civic Rally", "Compact Day Parade", "Lattice Rally"],
    festival:   ["Founders' Festival", "Compact Anniversary", "Resonance Week"],
    raid:       ["Frontier Raid: Anomaly Surge", "World Boss: Drift Eater", "Cross-World Raid Coord"],
    referendum: ["Referendum Resolution", "Public Vote Conclusion"],
  };
  const opts = titles[eventType] ?? [eventType];
  return opts[Math.floor(Math.random() * opts.length)];
}

/**
 * Run one scheduling pass for a world. Returns array of created event ids.
 */
export function scheduleEventsForWorld({ worldId, now = Date.now() }) {
  if (!worldId) return { ok: false, reason: "no_world_id", created: [] };
  const created = [];

  for (const [eventType, def] of Object.entries(EVENT_TYPES)) {
    const cadence = CADENCE_MS[eventType];
    if (!cadence) continue;
    const k = key(worldId, eventType);
    const lastAt = _lastGeneratedAt.get(k) ?? 0;
    if (now - lastAt < cadence) continue;

    const districtId = pickDistrict(eventType);
    const startTime = new Date(now + 30 * 60 * 1000).toISOString(); // start 30 min from now
    const host = pickHost(eventType);
    const reward = computeReward(eventType, def);
    const e = createEvent({
      type: eventType,
      title: flavorTitle(eventType),
      description: `${def.name} in ${districtId}. Hosted by ${host.name}. Attend to earn ${reward.cc} CC + ${reward.skillXp} skill XP.`,
      worldId,
      districtId,
      startTime,
      duration: def.defaultDuration,
      maxPlayers: def.maxPlayers,
      hostId: host.id,
      hostName: host.name,
      reward,
      location: { x: 0, y: 0, z: 0, districtId },
      createdAt: new Date(now).toISOString(),
    });
    if (e?.ok && e.event?.id) {
      created.push({ id: e.event.id, type: eventType, districtId, hostId: host.id, reward });
      _lastGeneratedAt.set(k, now);
    }
  }

  return { ok: true, created };
}

/**
 * Heartbeat tick — call from governorTick on a slow cadence (every 40 ticks).
 */
export function tick({ worlds = ["concordia"] } = {}) {
  const allCreated = [];
  for (const worldId of worlds) {
    const r = scheduleEventsForWorld({ worldId });
    if (r.ok) for (const c of r.created) allCreated.push({ ...c, worldId });
  }
  return { ok: true, created: allCreated };
}
