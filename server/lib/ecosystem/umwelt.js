// server/lib/ecosystem/umwelt.js
//
// Wave 7 / Layer 1 — the umwelt filter (von Uexküll). Each species inhabits a
// different perceptual world: the same embodied signals (thermal/humidity/
// airQuality/light/sound/pressure/structural — see lib/embodied/signals.js) are
// weighted by a per-species perception vector before they become "what this
// creature notices". A deer's world is sound + scent vigilance; a hawk's is
// light + thermal; the humanoid agent gets the full balanced band.
//
// This is the FIRST cheap number the affect/instinct stack runs on: perceiveSignals
// turns the world bundle into a per-species perceived view + a derived
// `salientChannel` (what's loudest for THIS species) + `salience` (0..1, how loud).
// Layer 2 (core-affect) folds salience into arousal; Layer 5 (salience interrupt)
// uses it as one of the constraint streams.
//
// Authored in content/umwelt-profiles.json; unknown species fall back to clade
// defaults (via taxonomyForSpecies) then humanoid baseline — the lookup is total.
//
//   umweltForSpecies(id)        -> { thermal, humidity, airQuality, light, sound, pressure, structural }
//   perceiveSignals(signals, w) -> { ...alias values, salientChannel, salience }

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { taxonomyForSpecies } from "../species-taxonomy.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(__dir, "../../../content/umwelt-profiles.json");

// The 7 perception channels (weight keys) and the signalsForWorld alias each maps
// onto. signalsForWorld returns: temperature, humidity, airQuality, light, noise,
// pressure, structuralStress.
export const UMWELT_CHANNELS = Object.freeze([
  "thermal", "humidity", "airQuality", "light", "sound", "pressure", "structural",
]);
const CHANNEL_TO_ALIAS = Object.freeze({
  thermal: "temperature", humidity: "humidity", airQuality: "airQuality",
  light: "light", sound: "noise", pressure: "pressure", structural: "structuralStress",
});

// Per-channel neutral baseline + perceptual span used to normalise a raw reading
// into a 0..1 "deviation intensity" (how far from neutral, how attention-grabbing),
// so channels in wildly different units (°C vs lux vs dB) are comparable before the
// species weight tips the argmax. light is handled in log10 space (lux spans 6 orders).
const NORM = Object.freeze({
  temperature:     { neutral: 18,  span: 25,  log: false },
  humidity:        { neutral: 50,  span: 50,  log: false },
  airQuality:      { neutral: 0.92, span: 0.6, log: false }, // lower (worse air) is more salient
  light:           { neutral: 4,   span: 2,   log: true  },  // log10(lux): 100lux→2, 1e6→6
  noise:           { neutral: 42,  span: 45,  log: false },  // dB above ambient floor
  pressure:        { neutral: 101.325, span: 12, log: false },
  structuralStress:{ neutral: 0,   span: 1,   log: false },
});

let _catalog = null;
function catalog() {
  if (_catalog) return _catalog;
  try { _catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) || {}; }
  catch { _catalog = { cladeDefaults: {}, species: {} }; }
  return _catalog;
}
export function _resetUmweltCache() { _catalog = null; }

const HUMANOID_BASELINE = Object.freeze({
  thermal: 1, humidity: 1, airQuality: 1, light: 1, sound: 1, pressure: 1, structural: 1,
});

function completeVector(partial, fallback) {
  const out = {};
  for (const c of UMWELT_CHANNELS) {
    const v = Number(partial?.[c]);
    out[c] = Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : (fallback?.[c] ?? 1);
  }
  return out;
}

/**
 * The umwelt perception-weight vector for a species. Authored first, then the
 * clade default (resolved via taxonomy), then humanoid baseline. Always total.
 */
export function umweltForSpecies(speciesId) {
  const cat = catalog();
  const id = String(speciesId || "").replace(/^creature:/, "");
  const authored = cat.species?.[id];
  if (authored) return completeVector(authored, HUMANOID_BASELINE);
  // fall back to clade default
  let clade = "humanoid";
  try { clade = taxonomyForSpecies(id).clade || "humanoid"; } catch { /* total */ }
  const cladeDefault = cat.cladeDefaults?.[clade] || cat.cladeDefaults?.humanoid || HUMANOID_BASELINE;
  return completeVector(cladeDefault, HUMANOID_BASELINE);
}

/** Normalise one raw signal reading into a 0..1 deviation intensity. Pure. */
function deviationIntensity(alias, rawValue) {
  const n = NORM[alias];
  if (!n) return 0;
  let v = Number(rawValue);
  if (!Number.isFinite(v)) return 0;
  if (n.log) v = Math.log10(Math.max(1, v));
  const dev = Math.abs(v - n.neutral) / (n.span || 1);
  return Math.max(0, Math.min(1, dev));
}

/**
 * Filter a world signal bundle (from signalsForWorld) through a species' umwelt.
 * Returns the raw alias values passed through (perception doesn't change the world,
 * it changes what's SALIENT) plus:
 *   salientChannel — the weight-key of the loudest channel FOR THIS SPECIES
 *   salience       — 0..1, how loud that loudest channel is (weight × deviation)
 * Degrades to salience≈0 when signals.hasData === false. Total/pure.
 */
export function perceiveSignals(signals, umwelt) {
  const s = signals || {};
  const w = umwelt && typeof umwelt === "object" ? umwelt : HUMANOID_BASELINE;
  const out = {
    temperature: s.temperature, humidity: s.humidity, airQuality: s.airQuality,
    light: s.light, noise: s.noise, pressure: s.pressure, structuralStress: s.structuralStress,
  };
  let salientChannel = null;
  let salience = 0;
  if (s.hasData !== false) {
    for (const c of UMWELT_CHANNELS) {
      const alias = CHANNEL_TO_ALIAS[c];
      const intensity = deviationIntensity(alias, s[alias]);
      // weight up to 2 → divide by 2 so a max-weight, max-deviation channel ≈ 1.0
      const weighted = Math.max(0, Math.min(1, (Number(w[c]) || 0) * intensity / 2));
      if (weighted > salience) { salience = weighted; salientChannel = c; }
    }
  }
  out.salientChannel = salientChannel;
  out.salience = salience;
  return out;
}
