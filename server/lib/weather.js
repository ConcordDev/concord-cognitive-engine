/**
 * Weather System — server-authoritative per-world precipitation + wind.
 *
 * Same shape as world-clock: server picks the weather, broadcasts to all
 * clients, drives the SoundscapeEngine's weatherOverride prop and the
 * WorldRenderer's particle layer.
 *
 * Each world advances independently. State is in-memory; persistence is a
 * future concern (world events log already captures weather change events).
 *
 * Weather model: smooth Markov chain over five states with per-world bias.
 *   clear -> overcast -> rain -> storm -> fog -> clear
 * Each tick rolls a weighted transition based on current state + world
 * climate profile.
 */

import logger from "../logger.js";
import { LruMap, LruSet } from "./lru-map.js";

const WEATHER_TYPES = Object.freeze(["clear", "overcast", "rain", "storm", "snow", "fog", "wind"]);

const CLIMATE_PROFILES = Object.freeze({
  // weight matrix: probability of NEXT state given current.
  concordia: { clear: 0.55, overcast: 0.20, rain: 0.10, storm: 0.05, snow: 0.02, fog: 0.05, wind: 0.03 },
  fantasy:   { clear: 0.40, overcast: 0.20, rain: 0.15, storm: 0.05, snow: 0.05, fog: 0.10, wind: 0.05 },
  superhero: { clear: 0.50, overcast: 0.25, rain: 0.15, storm: 0.07, snow: 0.00, fog: 0.02, wind: 0.01 },
  crime:     { clear: 0.35, overcast: 0.30, rain: 0.20, storm: 0.05, snow: 0.02, fog: 0.05, wind: 0.03 },
  cyber:     { clear: 0.30, overcast: 0.30, rain: 0.20, storm: 0.10, snow: 0.00, fog: 0.10, wind: 0.00 },
});

const _worldWeather = new LruMap(); // worldId -> { type, intensity, since, windDirection }

function _pickFromDist(dist) {
  const r = Math.random();
  let acc = 0;
  for (const [k, w] of Object.entries(dist)) {
    acc += w;
    if (r < acc) return k;
  }
  return "clear";
}

function _stickyTransition(currentType, profile) {
  // Stickiness: 65% chance to stay in current state, otherwise re-roll
  if (Math.random() < 0.65) return currentType;
  return _pickFromDist(profile);
}

/** Initialize a world's weather state. Idempotent. */
export function ensureWeatherForWorld(worldId) {
  if (_worldWeather.has(worldId)) return _worldWeather.get(worldId);
  const profile = CLIMATE_PROFILES[worldId] ?? CLIMATE_PROFILES.concordia;
  const type    = _pickFromDist(profile);
  const state   = {
    type,
    intensity: 0.3 + Math.random() * 0.4,
    since:     Date.now(),
    windDirection: Math.random() * Math.PI * 2,
  };
  _worldWeather.set(worldId, state);
  return state;
}

/** Advance every world's weather one step. Called from heartbeat (every ~10 min). */
export function advanceWeather(REALTIME = null) {
  const now = Date.now();
  for (const worldId of Object.keys(CLIMATE_PROFILES)) {
    const profile = CLIMATE_PROFILES[worldId];
    const prev    = ensureWeatherForWorld(worldId);
    const next    = _stickyTransition(prev.type, profile);
    const intensity = next === prev.type
      ? Math.max(0.1, Math.min(1.0, prev.intensity + (Math.random() - 0.5) * 0.2))
      : 0.2 + Math.random() * 0.5;
    const state = {
      type:           next,
      intensity,
      since:          next === prev.type ? prev.since : now,
      windDirection:  prev.windDirection + (Math.random() - 0.5) * 0.5,
    };
    _worldWeather.set(worldId, state);

    // Broadcast a per-world weather event so subscribers in that world re-tune.
    if (REALTIME?.io) {
      try {
        REALTIME.io.emit("world:weather", {
          worldId,
          ...state,
          ts: new Date(now).toISOString(),
        });
      } catch { /* socket best-effort */ }
    }
  }
}

export function getWeather(worldId) {
  return ensureWeatherForWorld(worldId);
}

export const WEATHER_CONSTANTS = Object.freeze({ types: WEATHER_TYPES });
