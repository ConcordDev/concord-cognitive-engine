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
    const e = createEvent({
      type: eventType,
      title: flavorTitle(eventType),
      description: `Auto-scheduled ${def.name} in ${districtId}.`,
      worldId,
      districtId,
      startTime,
      duration: def.defaultDuration,
      maxPlayers: def.maxPlayers,
      hostId: "system_event_scheduler",
      location: { x: 0, y: 0, z: 0, districtId },
      createdAt: new Date(now).toISOString(),
    });
    if (e?.ok && e.event?.id) {
      created.push({ id: e.event.id, type: eventType, districtId });
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
