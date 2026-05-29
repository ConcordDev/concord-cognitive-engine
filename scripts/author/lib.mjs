// scripts/author/lib.mjs
//
// Shared helpers for the offline authoring pipeline: deterministic RNG (so runs
// are reproducible + diffable), bible loading (a world's existing npcs/factions/
// lore), JSON read/write, and idempotent merge-by-id.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO = join(__dirname, "..", "..");
export const CONTENT = join(REPO, "content");
export const WORLD_DIR = join(CONTENT, "world");

/** Deterministic 32-bit RNG (mulberry32) seeded from a string — reproducible runs. */
export function seededRng(seedStr) {
  let h = 1779033703 ^ String(seedStr).length;
  for (let i = 0; i < String(seedStr).length; i++) {
    h = Math.imul(h ^ String(seedStr).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const sha1 = (s) => crypto.createHash("sha1").update(String(s)).digest("hex");

export function readJSON(absPath, fallback = null) {
  try { return existsSync(absPath) ? JSON.parse(readFileSync(absPath, "utf8")) : fallback; }
  catch { return fallback; }
}
export function writeJSON(absPath, data) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Normalise a content file into an array (handles [..] or { <key>: [..] } shapes). */
export function asArray(data, key) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    if (key && Array.isArray(data[key])) return data[key];
    const firstArr = Object.values(data).find((v) => Array.isArray(v));
    if (firstArr) return firstArr;
  }
  return [];
}

/** Load a world's "bible": its existing NPCs, factions, lore (for grounding). */
export function loadBible(world) {
  const dir = world === "concordia-hub" ? WORLD_DIR : join(WORLD_DIR, world);
  // hub roster also lives at the top-level world/npcs.json + factions.json
  const hubExtra = world === "concordia-hub"
    ? { npcs: asArray(readJSON(join(WORLD_DIR, "npcs.json")), "npcs"), factions: asArray(readJSON(join(WORLD_DIR, "factions.json")), "factions") }
    : { npcs: [], factions: [] };
  const npcs = [...asArray(readJSON(join(dir, "npcs.json")), "npcs"), ...asArray(readJSON(join(dir, "npcs-extra.json")), "npcs"), ...hubExtra.npcs];
  // factions-extra.json is the opt-in density slot mirroring npcs-extra.json — the
  // pipeline writes here so rich primary factions.json files aren't spliced.
  const factions = [...asArray(readJSON(join(dir, "factions.json")), "factions"), ...asArray(readJSON(join(dir, "factions-extra.json")), "factions"), ...hubExtra.factions];
  const lore = asArray(readJSON(join(dir, "lore.json")), "lore");
  return { world, dir, npcs, factions, lore };
}

export function existingIds(items) { return new Set((items || []).map((x) => x?.id).filter(Boolean)); }
export function existingNames(items) { return new Set((items || []).map((x) => (x?.name || "").toLowerCase()).filter(Boolean)); }

/** List the sub-world directory names (mirrors content-seeder discovery). */
export function listWorlds() {
  try {
    return readdirSync(WORLD_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "_shared")
      .map((d) => d.name)
      .concat("concordia-hub")
      .filter((v, i, a) => a.indexOf(v) === i);
  } catch { return []; }
}
