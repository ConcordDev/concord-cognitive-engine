// server/lib/ecosystem/drives.js
//
// Wave 7 / Layer 3 — Panksepp's 7 primary emotional systems as drive scalars.
// SEEKING, RAGE, FEAR, CARE, PANIC, PLAY, LUST — each 0..1, evolutionarily
// conserved raw affects. Per-species RESTING balance (temperament) is authored in
// content/temperament-profiles.json; each tick the live drives DECAY toward resting
// and are nudged by appraisals (predator → FEAR, hunt-blocked → RAGE, need pressure
// → SEEKING, …) and coupled to core affect (Layer 2). The dominant drive biases the
// instinct engine (Layer 4): high FEAR → flee, high SEEKING → forage/explore.
//
//   restingDrivesForSpecies(id, taxonomy) -> { SEEKING,RAGE,FEAR,CARE,PANIC,PLAY,LUST }
//   updateDrives(prior, resting, affect, appraisals, dtScale) -> drives
//   dominantDrive(drives) -> { name, value }
//
// Pure + total. Creatures keep drives in-memory on STATE.creatureMotion; NPCs/agents
// round-trip them through affect_state.meta_json (no migration).

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { taxonomyForSpecies } from "../species-taxonomy.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(__dir, "../../../content/temperament-profiles.json");

export const DRIVE_KINDS = Object.freeze([
  "SEEKING", "RAGE", "FEAR", "CARE", "PANIC", "PLAY", "LUST",
]);
const FLAT_BASELINE = 0.3;
const DECAY_RATE = 0.25;   // fraction of the gap to resting closed per unit dtScale
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

let _catalog = null;
function catalog() {
  if (_catalog) return _catalog;
  try { _catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) || {}; }
  catch { _catalog = { cladeDefaults: {}, dimodel: {}, species: {} }; }
  return _catalog;
}
export function _resetDrivesCache() { _catalog = null; }

function blankDrives(fill = FLAT_BASELINE) {
  const o = {};
  for (const k of DRIVE_KINDS) o[k] = fill;
  return o;
}
function overlay(base, partial) {
  if (!partial || typeof partial !== "object") return base;
  for (const k of DRIVE_KINDS) {
    if (partial[k] !== undefined && Number.isFinite(Number(partial[k]))) base[k] = clamp01(partial[k]);
  }
  return base;
}

/**
 * Resting drive balance for a species. Composition (each layer overrides the prior
 * for the keys it specifies): flat 0.3 ← cladeDefaults[clade] ← dimodel[diet] ←
 * species. Always total.
 */
export function restingDrivesForSpecies(speciesId, taxonomy = null) {
  const cat = catalog();
  const id = String(speciesId || "").replace(/^creature:/, "");
  let tax = taxonomy;
  if (!tax || !tax.clade) { try { tax = taxonomyForSpecies(id); } catch { tax = {}; } }
  const clade = tax?.clade || "humanoid";
  const diet = tax?.diet || "omnivore";

  let drives = blankDrives();
  drives = overlay(drives, cat.cladeDefaults?.[clade] || cat.cladeDefaults?.humanoid);
  drives = overlay(drives, cat.dimodel?.[diet]);
  drives = overlay(drives, cat.species?.[id]);
  return drives;
}

/**
 * One tick of drive dynamics: decay toward resting, then apply appraisal deltas +
 * affect coupling. Pure.
 *
 * @param {object} prior      previous drives (or resting on first call)
 * @param {object} resting    species resting balance
 * @param {object} affect     { v: [-1,1], a: [0,1] } core affect (Layer 2)
 * @param {object} appraisals { predatorNear, isHunting, attacked, isolated, mateAvailable,
 *                              needs:{hunger,thirst,reproduction,...} }
 * @param {number} [dtScale]  time scale (1 = one nominal pass)
 */
export function updateDrives(prior, resting, affect = {}, appraisals = {}, dtScale = 1) {
  const rest = resting && typeof resting === "object" ? resting : blankDrives();
  const cur = {};
  for (const k of DRIVE_KINDS) {
    const start = Number.isFinite(Number(prior?.[k])) ? clamp01(prior[k]) : rest[k];
    // decay toward resting
    cur[k] = start + (rest[k] - start) * DECAY_RATE * Math.max(0, dtScale);
  }

  const ap = appraisals || {};
  const needs = ap.needs || {};
  const v = Math.max(-1, Math.min(1, Number(affect?.v) || 0));
  const a = clamp01(affect?.a);

  // ── Panksepp couplings (appraisal → drive) ──
  if (ap.predatorNear) cur.FEAR += 0.35;
  if (ap.isolated)     cur.PANIC += 0.30;          // separation distress
  if (ap.attacked || (ap.isHunting && ap.blocked)) cur.RAGE += 0.30; // threat/frustration
  // foraging drive scales with the dominant consumptive need
  const forage = Math.max(clamp01(needs.hunger), clamp01(needs.thirst));
  cur.SEEKING += 0.30 * forage;
  cur.LUST    += 0.40 * clamp01(needs.reproduction) * (ap.mateAvailable ? 1 : 0.4);
  // PLAY only when safe, satiated and calm
  if (!ap.predatorNear && a < 0.35 && forage < 0.3) cur.PLAY += 0.15;
  if (ap.nearKinJuvenile) cur.CARE += 0.25;

  // ── affect coupling ──
  // negative valence biases the aversive drives; positive biases the appetitive.
  if (v < 0) { cur.FEAR += 0.15 * -v; cur.RAGE += 0.10 * -v; cur.PANIC += 0.10 * -v; }
  else       { cur.SEEKING += 0.12 * v; cur.PLAY += 0.08 * v; cur.CARE += 0.06 * v; }
  // high arousal amplifies whichever drive is currently dominant (winner-take-more)
  if (a > 0.6) {
    const dom = dominantDrive(cur);
    if (dom.name) cur[dom.name] += 0.10 * (a - 0.6) / 0.4;
  }

  for (const k of DRIVE_KINDS) cur[k] = clamp01(cur[k]);
  return cur;
}

/** The currently dominant drive (argmax). Total — returns {name:null,value:0} on
 * garbage / all-zero input (no drive is actually "lit"). */
export function dominantDrive(drives) {
  let name = null, value = 0;
  for (const k of DRIVE_KINDS) {
    const d = Number(drives?.[k]) || 0;
    if (d > value) { value = d; name = k; }
  }
  return { name, value };
}
