#!/usr/bin/env node
/**
 * gen-art-style-spec.mjs — derive the machine-readable art spec that the Godot
 * client reads, FROM the single source of truth the web client reads.
 *
 * Source of truth: concord-frontend/lib/world-lens/concordia-theme.ts
 *   - ART_STYLE          (OUTLINE_WIDTH_M / RAMP_BANDS / GROUNDED_DIAL / OUTLINE_DARKEN)
 *   - WORLD_SATURATION   (per-world saturation dial)
 *   - CONCORDIA_THEMES   (per-theme palette: toonGradient, sky, lights, fog)
 *
 * Output: world-lens-godot/art_style.json
 *
 * WHY GENERATED, NOT HAND-COPIED: docs/ART_STYLE_GUIDE.md's locked thesis is that
 * every render pass reads ONE set of constants so styling never drifts per
 * component. A hand-maintained GDScript copy of those numbers is exactly the drift
 * the guide exists to prevent — and a visual harness asserting against a drifted
 * copy would be a false assurance. `--check` is the CI drift gate: it regenerates
 * in memory and fails if the committed JSON disagrees with the TS.
 *
 * Usage:
 *   node scripts/gen-art-style-spec.mjs            # write
 *   node scripts/gen-art-style-spec.mjs --check    # exit 1 on drift, write nothing
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'concord-frontend/lib/world-lens/concordia-theme.ts');
const OUT = path.join(ROOT, 'world-lens-godot/art_style.json');

function fail(msg) {
  console.error(`[gen-art-style-spec] ${msg}`);
  process.exit(1);
}

const ts = fs.readFileSync(SRC, 'utf8');

/* ── ART_STYLE ─────────────────────────────────────────────────────────── */
const artBlock = ts.match(/export const ART_STYLE = Object\.freeze\(\{([\s\S]*?)\}\);/);
if (!artBlock) fail('could not locate ART_STYLE in the TS source');
const artStyle = {};
for (const [, k, v] of artBlock[1].matchAll(/^\s*([A-Z_]+):\s*([0-9.]+),/gm)) {
  artStyle[k] = Number(v);
}
for (const req of ['OUTLINE_WIDTH_M', 'RAMP_BANDS', 'GROUNDED_DIAL', 'OUTLINE_DARKEN']) {
  if (!(req in artStyle)) fail(`ART_STYLE.${req} missing from the TS source`);
}

/* ── WORLD_SATURATION ──────────────────────────────────────────────────── */
const satBlock = ts.match(
  /export const WORLD_SATURATION: Record<ConcordiaThemeId, number> = \{([\s\S]*?)\n\} as Record/
);
if (!satBlock) fail('could not locate WORLD_SATURATION in the TS source');
const worldSaturation = {};
for (const m of satBlock[1].matchAll(/^\s*'?([a-zA-Z-]+)'?:\s*([0-9.]+),/gm)) {
  worldSaturation[m[1]] = Number(m[2]);
}
if (Object.keys(worldSaturation).length < 9) {
  fail(`WORLD_SATURATION parsed only ${Object.keys(worldSaturation).length} entries (expected >= 9)`);
}

/* ── CANON_WORLD_THEMES ────────────────────────────────────────────────── */
const canonBlock = ts.match(/export const CANON_WORLD_THEMES: ConcordiaThemeId\[\] = \[([\s\S]*?)\];/);
if (!canonBlock) fail('could not locate CANON_WORLD_THEMES in the TS source');
const canonWorlds = [...canonBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);

/* ── DEFAULT_THEME_ID ──────────────────────────────────────────────────── */
const defTheme = ts.match(/export const DEFAULT_THEME_ID: ConcordiaThemeId = '([a-z-]+)';/);
if (!defTheme) fail('could not locate DEFAULT_THEME_ID in the TS source');

/* ── CONCORDIA_THEMES (palette per theme) ──────────────────────────────── */
const themesBlock = ts.match(
  /export const CONCORDIA_THEMES: Record<ConcordiaThemeId, ConcordiaTheme> = \{([\s\S]*?)\n\};/
);
if (!themesBlock) fail('could not locate CONCORDIA_THEMES in the TS source');

const hex = (s) => (s.startsWith('0x') ? parseInt(s, 16) : parseInt(s.replace('#', ''), 16));
const themes = {};
// Each entry starts at column 2: `  'theme-id': {` and closes with `  },`
const entryRe = /^ {2}'([a-z-]+)': \{\n([\s\S]*?)^ {2}\},$/gm;
for (const m of themesBlock[1].matchAll(entryRe)) {
  const id = m[1];
  const body = m[2];
  const pick = (re) => {
    const hit = body.match(re);
    return hit ? hit : null;
  };
  const grad = pick(/toonGradient:\s*\['(#[0-9a-fA-F]{6})',\s*'(#[0-9a-fA-F]{6})',\s*'(#[0-9a-fA-F]{6})'\]/);
  if (!grad) fail(`theme '${id}' has no parseable toonGradient`);
  const amb = pick(/ambientLight:\s*\{\s*color:\s*(0x[0-9a-fA-F]+),\s*intensity:\s*([0-9.]+)/);
  const sun = pick(/sunLight:\s*\{\s*color:\s*(0x[0-9a-fA-F]+),\s*intensity:\s*([0-9.]+)/);
  const skyTop = pick(/skyTop:\s*(0x[0-9a-fA-F]+)/);
  const skyHorizon = pick(/skyHorizon:\s*(0x[0-9a-fA-F]+)/);
  const fog = pick(/fog:\s*\{\s*color:\s*(0x[0-9a-fA-F]+),\s*near:\s*([0-9.]+),\s*far:\s*([0-9.]+)/);
  if (!amb || !sun || !skyTop || !skyHorizon || !fog) fail(`theme '${id}' is missing a required render field`);
  themes[id] = {
    toonGradient: [grad[1], grad[2], grad[3]],
    ambientLight: { color: hex(amb[1]), intensity: Number(amb[2]) },
    sunLight: { color: hex(sun[1]), intensity: Number(sun[2]) },
    skyTop: hex(skyTop[1]),
    skyHorizon: hex(skyHorizon[1]),
    fog: { color: hex(fog[1]), near: Number(fog[2]), far: Number(fog[3]) },
  };
}
for (const w of canonWorlds) {
  if (!themes[w]) fail(`canon world '${w}' has no parsed theme entry`);
  if (!(w in worldSaturation)) fail(`canon world '${w}' has no WORLD_SATURATION entry`);
}

const spec = {
  _generated_by: 'scripts/gen-art-style-spec.mjs',
  _source_of_truth: 'concord-frontend/lib/world-lens/concordia-theme.ts',
  _do_not_edit: 'Run `node scripts/gen-art-style-spec.mjs` after changing the TS source.',
  artStyle,
  worldSaturation,
  canonWorlds,
  defaultThemeId: defTheme[1],
  themes,
};

const json = JSON.stringify(spec, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (existing !== json) {
    console.error(
      '[gen-art-style-spec] DRIFT: world-lens-godot/art_style.json disagrees with concordia-theme.ts.\n' +
        '  Fix: node scripts/gen-art-style-spec.mjs'
    );
    process.exit(1);
  }
  console.log('[gen-art-style-spec] ok — art_style.json matches concordia-theme.ts');
  process.exit(0);
}

fs.writeFileSync(OUT, json);
console.log(
  `[gen-art-style-spec] wrote ${path.relative(ROOT, OUT)} ` +
    `(${Object.keys(themes).length} themes, ${canonWorlds.length} canon worlds)`
);
