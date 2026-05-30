#!/usr/bin/env node
// scripts/verify-move-render-coverage.mjs
//
// Universal Move System — Instrument 1, the Move-render coverage gate.
//
// Self-deriving sibling of verify-lens-backends.mjs. It greps the LIVE
// registries (not the docs) and asserts every renderable primitive a created
// move / action verb can resolve to actually binds to a REAL animation clip +
// a REAL world VFX + a REAL SFX voice — i.e. it does NOT silently fall to a
// generic `cast`/`arcane`/placeholder render. Output: a coverage % per layer
// (archetype-clip / VFX / SFX) + the fallback list (every primitive that lands
// on a generic/missing binding, with its registry origin).
//
// Why static-parse instead of import: the registries are TS modules and the
// repo's verifiers all parse source (no build step). We parse the tables and
// REPLICATE the move-resolver derivation here (kept in sync with
// concord-frontend/lib/concordia/move-resolver.ts + skill-motion.ts).
//
// Usage:
//   node scripts/verify-move-render-coverage.mjs           # report
//   node scripts/verify-move-render-coverage.mjs --json     # machine output
//   node scripts/verify-move-render-coverage.mjs --ci [N]    # exit 1 if any
//          layer coverage < floor N (default 100). Ratchet the floor upward.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'concord-frontend');
const read = (rel) => {
  const p = path.join(FE, rel);
  try { return fs.readFileSync(p, 'utf8'); }
  catch { console.error(`[move-render] missing registry: ${rel}`); return ''; }
};

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const ciIdx = args.indexOf('--ci');
const ciMode = ciIdx !== -1;
const ciFloor = ciMode ? Number(args[ciIdx + 1] || 100) : 0;

// ── 1. Parse the registries (the source of truth) ───────────────────────────

const moveTypes = read('lib/concordia/move-catalog/move-types.ts');
const skillMotion = read('lib/concordia/skill-motion.ts');
const actionBio = read('lib/concordia/action-biomechanics.ts');
const worldVfx = read('lib/world-lens/world-vfx-bridge.ts');
const soundscape = read('components/world-lens/SoundscapeEngine.tsx');

// SKILL_KIND_MOTION: kind -> { family, archetype, effect, gauge }
const skillKindMotion = {};
{
  const block = moveTypes.match(/SKILL_KIND_MOTION[^=]*=\s*{([\s\S]*?)\n};/);
  if (block) {
    for (const m of block[1].matchAll(
      /(\w+):\s*{\s*family:\s*'([^']+)',\s*archetype:\s*'([^']+)',\s*effect:\s*'([^']+)',\s*limb:\s*'([^']+)',\s*gauge:\s*'([^']+)'/g
    )) {
      skillKindMotion[m[1]] = { family: m[2], archetype: m[3], effect: m[4], gauge: m[6] };
    }
  }
}

// ELEMENT_EFFECT_BIAS keys = the catalog of elements a move can declare
const elements = new Set();
{
  const block = moveTypes.match(/ELEMENT_EFFECT_BIAS[^=]*=\s*{([\s\S]*?)\n};/);
  if (block) for (const m of block[1].matchAll(/(\w+):\s*'[^']+'/g)) elements.add(m[1]);
}

// ELEMENT_MOTION (skill-motion.ts): element -> { vfx, sfx } (drives modulatedVfx/Sfx)
const elementMotion = {};
{
  const block = skillMotion.match(/ELEMENT_MOTION[^=]*=\s*{([\s\S]*?)\n};/);
  if (block) for (const m of block[1].matchAll(/(\w+):\s*{\s*vfx:\s*'([^']+)',\s*sfx:\s*'([^']+)'/g))
    elementMotion[m[1]] = { vfx: m[2], sfx: m[3] };
}

// ARCHETYPE_GEN keys = archetypes that have a real pose generator (a real clip)
const clipArchetypes = new Set();
{
  // NB: the Record<…> type annotation contains a `=>` arrow, so anchor on the
  // first real `= {` assignment (lazy [\s\S]*? skips the arrow) rather than [^=]*.
  const block = actionBio.match(/ARCHETYPE_GEN[\s\S]*?=\s*{([\s\S]*?)\n};/);
  if (block) for (const m of block[1].matchAll(/(\w+):\s*poses_\w+/g)) clipArchetypes.add(m[1]);
}

// MotionArchetype union members (move-types.ts) — to find declared-but-ungenerated
const declaredArchetypes = new Set();
{
  const block = moveTypes.match(/export type MotionArchetype\s*=([\s\S]*?);/);
  if (block) for (const m of block[1].matchAll(/'([a-z_]+)'/g)) declaredArchetypes.add(m[1]);
}

// ACTION_DESCRIPTORS: verb -> { archetype, vfx, sfxId }
const actionDescriptors = {};
{
  const block = actionBio.match(/ACTION_DESCRIPTORS[^=]*=\s*{([\s\S]*?)\n};/);
  if (block) for (const m of block[1].matchAll(/(\w+):\s*{([^}]*)}/g)) {
    const body = m[2];
    const arch = body.match(/archetype:\s*'([^']+)'/);
    const vfx = body.match(/vfx:\s*'([^']+)'/);
    const sfx = body.match(/sfxId:\s*'([^']+)'/);
    actionDescriptors[m[1]] = { archetype: arch?.[1], vfx: vfx?.[1] || null, sfx: sfx?.[1] || null };
  }
}

// Known 3D VFX particle types (world-vfx-bridge.ts particleParamsForType cases)
const knownVfx = new Set();
{
  const block = worldVfx.match(/particleParamsForType[\s\S]*?switch\s*\(type\)\s*{([\s\S]*?)\n\s*default:/);
  const scope = block ? block[1] : worldVfx;
  for (const m of scope.matchAll(/case\s*'([^']+)'/g)) knownVfx.add(m[1]);
}

// Known SFX voices (SFX_MAP + LAYER_MAP keys) and explicit aliases (SoundscapeEngine.tsx)
const knownSfx = new Set();
const sfxAliases = {};
{
  for (const name of ['SFX_MAP', 'LAYER_MAP']) {
    const block = soundscape.match(new RegExp(name + '[^=]*=\\s*{([\\s\\S]*?)\\n};'));
    if (block) for (const m of block[1].matchAll(/'([a-z0-9-]+)'\s*:/g)) knownSfx.add(m[1]);
  }
  const ab = soundscape.match(/SFX_ALIASES[^=]*=\s*{([\s\S]*?)\n};/);
  if (ab) for (const m of ab[1].matchAll(/([\w-]+)\s*:\s*'([a-z0-9-]+)'/g)) sfxAliases[m[1]] = m[2];
}
// Mirrors SoundscapeEngine.resolveSfxId: known voice > explicit alias > underscore→hyphen.
function sfxResolves(id) {
  if (!id) return false;
  if (knownSfx.has(id)) return true;
  if (sfxAliases[id] && knownSfx.has(sfxAliases[id])) return true;
  const hy = id.replace(/_/g, '-');
  return knownSfx.has(hy);
}

// ── 2. Replicate the move-resolver derivation (move-resolver.ts) ─────────────
// For a created move with NO explicit motion block (the backward-compat path
// that covers every move minted before stamping exists), resolveMove derives:
//   motionArchetype = SKILL_KIND_MOTION[kind].archetype
//   element vfx     = modulatedVfx(fallbackVfx, element)   // skill-motion table
//   element sfx     = modulatedSfx(undefined, element)
// where fallbackVfx = family === 'combat_melee' ? 'impact' : 'arcane'.
function deriveVfx(family, element) {
  const em = elementMotion[String(element).toLowerCase()];
  if (em) return { id: em.vfx, fromTable: true };
  const fallback = family === 'combat_melee' ? 'impact' : 'arcane';
  return { id: fallback, fromTable: false };
}
function deriveSfx(element) {
  const em = elementMotion[String(element).toLowerCase()];
  return em ? em.sfx : null; // no element row → created move has NO element sfx
}

// ── 3. Enumerate every renderable primitive & classify each layer ────────────
const findings = []; // { kind, id, layer, reason }
const layerStats = {
  archetype: { ok: 0, total: 0 },
  vfx: { ok: 0, total: 0 },
  sfx: { ok: 0, total: 0 },
};
const ok = (layer) => { layerStats[layer].ok++; layerStats[layer].total++; };
const bad = (layer, kind, id, reason) => { layerStats[layer].total++; findings.push({ kind, id, layer, reason }); };

// (a) Declared motion archetypes must have a pose generator (a real clip)
for (const a of declaredArchetypes) {
  if (clipArchetypes.has(a)) ok('archetype');
  else bad('archetype', 'motion-archetype', a, 'declared in MotionArchetype but NO pose generator in ARCHETYPE_GEN (renders T-pose/generic)');
}

// (b) Created-move matrix: skill_kind × element → derived archetype/vfx/sfx
const elementList = [...new Set([...elements, ...Object.keys(elementMotion)])].sort();
for (const [kind, km] of Object.entries(skillKindMotion)) {
  // archetype layer (per skill_kind — derived archetype must have a clip)
  if (clipArchetypes.has(km.archetype)) ok('archetype');
  else bad('archetype', 'skill_kind', `${kind}→${km.archetype}`, 'skill_kind derives an archetype with no clip');

  for (const el of elementList) {
    const tag = `${kind}+${el}`;
    const v = deriveVfx(km.family, el);
    if (knownVfx.has(v.id)) ok('vfx');
    else bad('vfx', 'created-move', tag, v.fromTable
      ? `element vfx '${v.id}' (skill-motion table) is NOT a world-vfx-bridge particle type → generic puff`
      : `element '${el}' has no skill-motion row → falls to generic '${v.id}'`);

    const s = deriveSfx(el);
    if (s && sfxResolves(s)) ok('sfx');
    else bad('sfx', 'created-move', tag, s
      ? `element sfx '${s}' does not resolve to a SoundscapeEngine voice`
      : `element '${el}' has no skill-motion row → created move emits NO sfx`);
  }
}

// (c) Authored action verbs: archetype has a clip, declared vfx/sfx bind
for (const [verb, d] of Object.entries(actionDescriptors)) {
  if (d.archetype && clipArchetypes.has(d.archetype)) ok('archetype');
  else bad('archetype', 'verb', `${verb}→${d.archetype}`, 'verb archetype has no pose generator');

  if (d.vfx == null) ok('vfx'); // no vfx declared = intentional (silent is fine)
  else if (knownVfx.has(d.vfx)) ok('vfx');
  else bad('vfx', 'verb', `${verb} (vfx '${d.vfx}')`, `verb vfx '${d.vfx}' is NOT a world-vfx-bridge particle type → generic puff`);

  if (d.sfx == null) ok('sfx');
  else if (sfxResolves(d.sfx)) ok('sfx');
  else bad('sfx', 'verb', `${verb} (sfx '${d.sfx}')`, `verb sfx '${d.sfx}' does not resolve to a SoundscapeEngine voice`);
}

// ── 4. Report ────────────────────────────────────────────────────────────────
const pct = (s) => s.total ? Math.round((s.ok / s.total) * 1000) / 10 : 100;
const overall = (() => {
  const ok = layerStats.archetype.ok + layerStats.vfx.ok + layerStats.sfx.ok;
  const total = layerStats.archetype.total + layerStats.vfx.total + layerStats.sfx.total;
  return total ? Math.round((ok / total) * 1000) / 10 : 100;
})();

if (asJson) {
  console.log(JSON.stringify({ overall, layers: {
    archetype: pct(layerStats.archetype), vfx: pct(layerStats.vfx), sfx: pct(layerStats.sfx) },
    counts: layerStats, findings }, null, 2));
} else {
  console.log('\n=== Move-Render Coverage Gate ===');
  console.log(`registries: ${Object.keys(skillKindMotion).length} skill_kinds · ${elementList.length} elements · ` +
    `${Object.keys(actionDescriptors).length} verbs · ${clipArchetypes.size} clip-archetypes · ` +
    `${knownVfx.size} world VFX · ${knownSfx.size} SFX voices`);
  console.log('');
  console.log(`  archetype-clip : ${pct(layerStats.archetype)}%  (${layerStats.archetype.ok}/${layerStats.archetype.total})`);
  console.log(`  VFX binding    : ${pct(layerStats.vfx)}%  (${layerStats.vfx.ok}/${layerStats.vfx.total})`);
  console.log(`  SFX binding    : ${pct(layerStats.sfx)}%  (${layerStats.sfx.ok}/${layerStats.sfx.total})`);
  console.log(`  OVERALL        : ${overall}%`);
  if (findings.length) {
    console.log(`\n--- Fallback list (${findings.length}) — close these to climb to 100% ---`);
    for (const layer of ['archetype', 'vfx', 'sfx']) {
      const rows = findings.filter((f) => f.layer === layer);
      if (!rows.length) continue;
      console.log(`\n  [${layer}] ${rows.length}`);
      for (const f of rows) console.log(`    · ${f.kind} ${f.id}: ${f.reason}`);
    }
  } else {
    console.log('\n✓ Nothing falls back — every primitive resolves to a real clip + VFX + SFX.');
  }
  console.log('');
}

if (ciMode) {
  // Ratcheting floor on the OVERALL score. Bump the floor in audits.yml as
  // WS-RENDER slices land so coverage can only climb, never regress.
  if (overall < ciFloor) {
    console.error(`[move-render] FAIL: overall ${overall}% < floor ${ciFloor}%`);
    process.exit(1);
  }
}
