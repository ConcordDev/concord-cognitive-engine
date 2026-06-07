// server/lib/ecosystem/releasers.js
//
// Wave 7 / Layer 4 — the instinct engine: sign-stimulus → fixed-action-pattern
// (Tinbergen/Lorenz). This is the autopilot that runs ~95% of a creature's life
// with ZERO LLM cost. A releaser fires only when BOTH hold: a stimulus channel
// exceeds its threshold AND the gating Panksepp drive (Layer 3) is elevated — the
// classic double-gate (a deer with low PANIC does not bolt at every twig snap; a
// hawk with low SEEKING ignores visible prey). The winning FAP carries a force
// `gain` that the flock loop (creature-behaviors) multiplies onto the forces it
// already computes — a surgical amplify, not a new motion path.
//
//   releasersForSpecies(speciesId, taxonomy) -> [ releaser, ... ]   (total)
//   matchReleaser(releasers, appraisals, drives) -> winning releaser | null
//
// Pure + total. Authored in content/releaser-tables.json (cladeDefaults + species).

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { taxonomyForSpecies } from "../species-taxonomy.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(__dir, "../../../content/releaser-tables.json");

const DEFAULT_DRIVE_GATE = 0.5; // a drive counts as "elevated" at/above this

let _catalog = null;
function catalog() {
  if (_catalog) return _catalog;
  try { _catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) || {}; }
  catch { _catalog = { cladeDefaults: {}, species: {} }; }
  return _catalog;
}
export function _resetReleasersCache() { _catalog = null; }

function sanitize(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (!entry.channel || !entry.fap || !entry.drive) return null;
  return {
    stimulus: String(entry.stimulus || entry.fap),
    channel: String(entry.channel),
    threshold: Number.isFinite(Number(entry.threshold)) ? Number(entry.threshold) : 0,
    drive: String(entry.drive),
    driveGate: Number.isFinite(Number(entry.driveGate)) ? Number(entry.driveGate) : DEFAULT_DRIVE_GATE,
    fap: String(entry.fap),
    gain: Number.isFinite(Number(entry.gain)) ? Number(entry.gain) : 1.0,
  };
}

/**
 * The releaser table for a species: cladeDefaults[clade] ++ species[id]. Species
 * entries are appended after clade so a species-specific FAP can out-compete a
 * generic clade one (higher specificity tends to come with higher gain). Total.
 */
export function releasersForSpecies(speciesId, taxonomy = null) {
  const cat = catalog();
  const id = String(speciesId || "").replace(/^creature:/, "");
  let tax = taxonomy;
  if (!tax || !tax.clade) { try { tax = taxonomyForSpecies(id); } catch { tax = {}; } }
  const clade = tax?.clade || "humanoid";

  const out = [];
  const cladeList = cat.cladeDefaults?.[clade] || cat.cladeDefaults?.humanoid || [];
  for (const e of cladeList) { const s = sanitize(e); if (s) out.push(s); }
  const speciesList = cat.species?.[id] || [];
  for (const e of speciesList) { const s = sanitize(e); if (s) out.push(s); }
  return out;
}

/**
 * Read a stimulus value out of the appraisal bundle. A numeric reading (e.g. noise
 * in dB) compares against `threshold`; a boolean flag (predatorNear, preyVisible)
 * counts as firing when truthy. Returns the margin above threshold (>=0 means the
 * stimulus side passed), or null if the stimulus didn't fire.
 */
function stimulusMargin(appraisals, entry) {
  const raw = appraisals?.[entry.channel];
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "boolean") return raw ? 1 : null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return raw ? 1 : null; // truthy non-number → fired
  if (v < entry.threshold) return null;
  return v - entry.threshold;
}

/**
 * The double-gate match. Walk the releasers; an entry fires when its stimulus
 * channel exceeds threshold AND its gating drive is elevated. Among all firing
 * entries, the winner is the one whose (drive elevation × gain) is greatest — the
 * strongest instinct wins. Returns the winning releaser (a copy, with the matched
 * `driveValue` attached) or null → caller falls through to need-ranking.
 * Pure + total.
 */
export function matchReleaser(releasers, appraisals, drives) {
  const list = Array.isArray(releasers) ? releasers : [];
  const ap = appraisals || {};
  const dr = drives || {};
  let best = null;
  let bestScore = -Infinity;
  for (const entry of list) {
    const margin = stimulusMargin(ap, entry);
    if (margin === null) continue;                 // stimulus gate
    const driveValue = Number(dr[entry.drive]) || 0;
    if (driveValue < entry.driveGate) continue;    // drive gate (the key suppression)
    const score = driveValue * (entry.gain || 1);
    if (score > bestScore) {
      bestScore = score;
      best = { ...entry, driveValue };
    }
  }
  return best;
}

export const _internal = { DEFAULT_DRIVE_GATE, stimulusMargin };
