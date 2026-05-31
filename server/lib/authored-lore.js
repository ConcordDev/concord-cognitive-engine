// server/lib/authored-lore.js
//
// Wave 8b — the read side of the authored cosmology.
//
// The 87+ hand-authored lore events (content/world/**/lore.json) were fed to the
// oracle as SILENT context and never shown to players (the "authored but opaque"
// gap). This module reads them straight from the source files (deterministic,
// seed-independent) so a codex / the goddess can surface the canon.
//
// HARD INVARIANT: `hidden_truth` is author-only — the same class as NPC secrets.
// It is STRIPPED here so it can never reach a player surface or an LLM prompt.

import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = join(__dir, "../../content");
const WORLD_DIR = join(CONTENT_ROOT, "world");

function readJSON(abs) {
  try { return JSON.parse(readFileSync(abs, "utf8")); } catch { return null; }
}

/** Discover every lore.json: the top-level (hub) file + each sub-world dir. */
function loreFiles() {
  const files = [{ worldId: "concordia-hub", path: join(WORLD_DIR, "lore.json") }];
  try {
    for (const entry of readdirSync(WORLD_DIR)) {
      if (entry.startsWith("_") || entry.endsWith(".json")) continue;
      const full = join(WORLD_DIR, entry);
      try {
        if (statSync(full).isDirectory()) {
          files.push({ worldId: entry, path: join(full, "lore.json") });
        }
      } catch { /* skip */ }
    }
  } catch { /* world dir missing */ }
  return files;
}

/** Player-safe projection of one authored event — hidden_truth REMOVED. */
function publicEvent(ev, worldId) {
  if (!ev || typeof ev !== "object") return null;
  return {
    id: ev.id,
    title: ev.title,
    type: ev.type,
    era: ev.era,
    description: ev.description,
    significance: ev.significance,
    factions_involved: ev.factions_involved ?? [],
    known_by: ev.known_by ?? [],
    tags: ev.tags ?? [],
    world_id: ev.world_id || worldId,
    // hidden_truth intentionally omitted (author-only invariant).
  };
}

let _cache = null; // [{...publicEvent}]
function loadAll() {
  if (_cache) return _cache;
  const out = [];
  for (const { worldId, path } of loreFiles()) {
    const data = readJSON(path);
    const history = data?.history;
    if (!Array.isArray(history)) continue;
    for (const ev of history) {
      const pe = publicEvent(ev, worldId);
      if (pe && pe.id && pe.title) out.push(pe);
    }
  }
  _cache = out;
  return out;
}

/** Test/hot-reload hook — drop the in-memory cache. */
export function _resetAuthoredLoreCache() { _cache = null; }

/**
 * List authored lore events, hidden_truth stripped. Filters are AND-combined.
 * @param {object} opts { worldId?, type?, era?, q?, limit? }
 */
export function listAuthoredLore(opts = {}) {
  let events = loadAll();
  if (opts.worldId) events = events.filter((e) => e.world_id === opts.worldId);
  if (opts.type) events = events.filter((e) => e.type === opts.type);
  if (opts.era) events = events.filter((e) => String(e.era).toLowerCase().includes(String(opts.era).toLowerCase()));
  if (opts.q) {
    const q = String(opts.q).toLowerCase();
    events = events.filter((e) =>
      e.title.toLowerCase().includes(q) || (e.description || "").toLowerCase().includes(q));
  }
  const limit = Math.max(1, Math.min(Number(opts.limit) || 500, 1000));
  return events.slice(0, limit);
}

/** Single authored event by id (hidden_truth stripped); null if unknown. */
export function getAuthoredLore(id) {
  if (!id) return null;
  return loadAll().find((e) => e.id === id) || null;
}

/** Distinct facet values for the codex filter UI. */
export function authoredLoreFacets() {
  const events = loadAll();
  const worlds = new Set(), types = new Set(), eras = new Set();
  for (const e of events) { worlds.add(e.world_id); types.add(e.type); eras.add(e.era); }
  return {
    worlds: [...worlds].sort(),
    types: [...types].sort(),
    eras: [...eras].sort(),
    count: events.length,
  };
}

/**
 * The Pillars/Pantheon spine, for the goddess prompt + codex header. Pulls the
 * primordial + great_refusal events (the cosmology), hidden_truth stripped.
 */
export function cosmologySpine() {
  return loadAll().filter((e) => e.type === "primordial" || e.type === "great_refusal" || e.type === "founding");
}
