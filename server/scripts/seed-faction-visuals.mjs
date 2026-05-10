#!/usr/bin/env node
/**
 * Sprint D / V1 — backfill faction visual fields.
 *
 * Reads every content/world/**\/factions.json file. For each faction
 * missing a `visual` block, generates one deterministically from
 * sha1(faction.id):
 *   - primary_color (hue from id hash, mid lightness)
 *   - secondary_color (dark complement)
 *   - accent_color (rotated hue + warm bias)
 *   - architecture_style (5 options, picked from id hash)
 *   - preferred_weapon_archetypes (2-3 from a 12-archetype pool)
 *   - preferred_armor_silhouette (4 options)
 *   - sigil_path (simple SVG path, picked from 8 templates)
 *   - banner_sigil_id (text key)
 *   - ornamentation_motifs (2-3 motifs from a 16-pool)
 *
 * Idempotent: skips factions that already have a `visual` field.
 * Run: `node server/scripts/seed-faction-visuals.mjs [--dry-run]`
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '../../content/world');

const ARCHITECTURE_STYLES = ['fortified', 'gracile', 'crystalline', 'organic', 'industrial'];
const WEAPON_POOL = [
  'shortsword', 'longsword', 'axe', 'mace', 'dagger', 'club',
  'scimitar', 'greatsword', 'halberd', 'spear', 'bow', 'crossbow',
];
const ARMOR_SILHOUETTES = ['heavy_plate', 'robed', 'leather', 'exposed'];
const ORNAMENTATION_MOTIFS = [
  'chain', 'spike', 'hammer', 'feather', 'scroll', 'crystal',
  'gear', 'coil', 'rune', 'serpent', 'wing', 'flame',
  'wheel', 'eye', 'leaf', 'star',
];
const SIGIL_TEMPLATES = [
  'M0,-20 L18,18 L-18,18 Z',                     // triangle (peak)
  'M0,-20 L20,0 L0,20 L-20,0 Z',                 // diamond
  'M-15,-15 L15,-15 L15,15 L-15,15 Z',           // square
  'M0,-20 A20,20 0 1,1 0,20 A20,20 0 1,1 0,-20Z',// circle
  'M-15,15 L0,-20 L15,15 L0,5 Z',                // arrow
  'M-18,0 L0,-18 L18,0 L0,18 L-12,0 L0,-6 L12,0 L0,6 Z', // crossed diamond
  'M0,-18 L4,-6 L18,-6 L8,3 L12,18 L0,9 L-12,18 L-8,3 L-18,-6 L-4,-6 Z', // star
  'M-18,-12 Q0,-22 18,-12 Q18,12 0,18 Q-18,12 -18,-12 Z', // shield
];

function hashId(s) {
  return createHash('sha1').update(String(s)).digest('hex');
}

function pickFrom(arr, hash, byteOffset = 0) {
  const idx = parseInt(hash.slice(byteOffset, byteOffset + 4), 16) % arr.length;
  return arr[idx];
}

function pickN(arr, hash, n, byteOffset = 0) {
  const out = [];
  const seen = new Set();
  let off = byteOffset;
  while (out.length < n && off < hash.length - 4) {
    const idx = parseInt(hash.slice(off, off + 4), 16) % arr.length;
    if (!seen.has(idx)) { seen.add(idx); out.push(arr[idx]); }
    off += 2;
  }
  return out;
}

function colorFromHash(hash, byteOffset = 0, light = 50, sat = 60) {
  const hue = parseInt(hash.slice(byteOffset, byteOffset + 4), 16) % 360;
  return hslToHex(hue, sat, light);
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generateVisual(factionId) {
  const h = hashId(factionId);
  return {
    primary_color: colorFromHash(h, 0, 38, 65),
    secondary_color: colorFromHash(h, 6, 12, 35),
    accent_color: colorFromHash(h, 12, 60, 70),
    architecture_style: pickFrom(ARCHITECTURE_STYLES, h, 18),
    preferred_weapon_archetypes: pickN(WEAPON_POOL, h, 3, 22),
    preferred_armor_silhouette: pickFrom(ARMOR_SILHOUETTES, h, 30),
    sigil_path: pickFrom(SIGIL_TEMPLATES, h, 34),
    banner_sigil_id: `${factionId}_sigil`,
    ornamentation_motifs: pickN(ORNAMENTATION_MOTIFS, h, 3, 38),
  };
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (entry === 'factions.json') out.push(p);
  }
  return out;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = walk(ROOT);
  let touched = 0, skipped = 0, generated = 0;
  for (const file of files) {
    let json;
    try { json = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { console.error(`Skipping malformed ${file}: ${e.message}`); continue; }
    if (!Array.isArray(json)) continue;
    let changed = false;
    for (const faction of json) {
      if (!faction?.id) continue;
      if (faction.visual) { skipped++; continue; }
      faction.visual = generateVisual(faction.id);
      generated++;
      changed = true;
    }
    if (changed) {
      touched++;
      if (!dryRun) writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
      console.log(`[seed-visuals] ${file} — ${dryRun ? 'would update' : 'updated'}`);
    }
  }
  console.log(`Done. Files touched: ${touched} | Visuals generated: ${generated} | Already visual: ${skipped}`);
}

main();
