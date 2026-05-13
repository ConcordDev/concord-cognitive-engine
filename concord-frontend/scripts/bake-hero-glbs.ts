/**
 * Phase S — bake lore-driven rigged hero GLBs.
 *
 * Runs in Node via `npx tsx scripts/bake-hero-glbs.ts`. Produces:
 *   - 4 bespoke .glb for the Three Above All + Weaver
 *   - 7 archetype .glb × 6 representative worlds = 42 per-world archetypes
 *   - 7 universal .glb fallbacks (used when an NPC's home world has no
 *     authored archetype slot)
 *
 * Total: 53 .glb files in concord-frontend/public/meshes/heroes/.
 *
 * Each mesh is a real THREE.SkinnedMesh on the 22-bone Mixamo skeleton
 * via `createSkinnedHumanoid`. Outfit color comes from the dominant
 * faction's `visual.primary_color` in the world's `factions.json`. The
 * Four NPCs get authored color choices.
 *
 * NPCs travel cross-world (Phase T), so the GLB chosen at runtime is
 * keyed off the NPC's `home_world_id` — a courier from
 * `concord-link-frontier` keeps looking like a concord-link courier
 * even when visiting concordia-hub.
 */

import * as THREE from 'three';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkinnedHumanoid, type SkinnedHumanoidAppearance } from '../lib/concordia/skinned-humanoid';

// Polyfill globals GLTFExporter touches in Node:
//   - window / self      — Three.js inspects these at evaluation time.
//   - FileReader         — GLTFExporter ferries the body buffer + final
//                          GLB through Blob → FileReader.readAsArrayBuffer.
//                          Node 18+ has Blob natively (Blob#arrayBuffer
//                          returns a Promise); we shim FileReader as a
//                          thin async wrapper around it.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window: unknown }).window = globalThis;
}
if (typeof (globalThis as { self?: unknown }).self === 'undefined') {
  (globalThis as { self: unknown }).self = globalThis;
}
if (typeof (globalThis as { FileReader?: unknown }).FileReader === 'undefined') {
  class FileReaderShim {
    public result: ArrayBuffer | string | null = null;
    public error: Error | null = null;
    public onload:    ((ev: { target: FileReaderShim }) => void) | null = null;
    public onloadend: ((ev: { target: FileReaderShim }) => void) | null = null;
    public onerror:   ((err: Error) => void) | null = null;
    private _fire() {
      const ev = { target: this };
      this.onload?.(ev);
      this.onloadend?.(ev);
    }
    readAsArrayBuffer(blob: Blob): void {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this._fire();
      }).catch((err) => {
        this.error = err as Error;
        this.onerror?.(err as Error);
      });
    }
    readAsDataURL(blob: Blob): void {
      blob.arrayBuffer().then((buf) => {
        const b64 = Buffer.from(buf).toString('base64');
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
        this._fire();
      }).catch((err) => {
        this.error = err as Error;
        this.onerror?.(err as Error);
      });
    }
  }
  (globalThis as { FileReader: unknown }).FileReader = FileReaderShim;
}

// Import GLTFExporter AFTER polyfills — Three's example modules
// inspect `window` at evaluation time in some versions.
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// ── Paths ─────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const HEROES_DIR = path.join(REPO_ROOT, 'concord-frontend/public/meshes/heroes');
const CONTENT_WORLD = path.join(REPO_ROOT, 'content/world');

// ── Types ─────────────────────────────────────────────────────────
interface FactionVisual {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  preferred_armor_silhouette?: string;
  preferred_weapon_archetypes?: string[];
}
interface Faction {
  id: string;
  name?: string;
  visual?: FactionVisual;
}

// ── Constants ─────────────────────────────────────────────────────
const ARCHETYPES = ['warrior', 'guard', 'scholar', 'mystic', 'hunter', 'trader', 'legend'] as const;
type Archetype = typeof ARCHETYPES[number];

/** Worlds whose factions.json gets per-world archetype GLBs baked.
 *  Other worlds fall through to the universal fallback at runtime. */
const WORLDS: { id: string; factionsPath: string }[] = [
  { id: 'concordia-hub',         factionsPath: 'factions.json' },
  { id: 'cyber',                 factionsPath: 'cyber/factions.json' },
  { id: 'fantasy',               factionsPath: 'fantasy/factions.json' },
  { id: 'sovereign-ruins',       factionsPath: 'sovereign-ruins/factions.json' },
  { id: 'lattice-crucible',      factionsPath: 'lattice-crucible/factions.json' },
  { id: 'concord-link-frontier', factionsPath: 'concord-link-frontier/factions.json' },
];

const DEFAULT_SKIN = '#a8867a';

// ── Lore → mesh mapping ───────────────────────────────────────────
function pickFactionForArchetype(factions: Faction[], archetype: Archetype): Faction | null {
  // Heuristic: pick the faction whose `preferred_armor_silhouette`
  // matches the archetype's silhouette signature; fall back to first
  // faction if no semantic match.
  const sigByArch: Record<Archetype, string[]> = {
    warrior: ['heavy', 'plate', 'reinforced', 'martial'],
    guard:   ['heavy', 'plate', 'mail', 'reinforced'],
    scholar: ['robed', 'cloth', 'civic', 'scholarly'],
    mystic:  ['robed', 'cloth', 'ritual', 'arcane'],
    hunter:  ['light', 'leather', 'hide', 'swift'],
    trader:  ['light', 'merchant', 'civic', 'mercantile'],
    legend:  ['ceremonial', 'royal', 'divine', 'robed'],
  };
  const sigs = sigByArch[archetype];
  for (const f of factions) {
    const sil = (f.visual?.preferred_armor_silhouette ?? '').toLowerCase();
    if (sigs.some(s => sil.includes(s))) return f;
  }
  return factions[0] ?? null;
}

function bodyTypeForArchetype(archetype: Archetype): SkinnedHumanoidAppearance['bodyType'] {
  switch (archetype) {
    case 'warrior': return 'stocky';
    case 'guard':   return 'tall';
    case 'scholar': return 'slim';
    case 'mystic':  return 'slim';
    case 'hunter':  return 'average';
    case 'trader':  return 'average';
    case 'legend':  return 'legend';
  }
}

// ── Build one mesh group ─────────────────────────────────────────
function buildGroup(opts: {
  bodyType: SkinnedHumanoidAppearance['bodyType'];
  outfitColor: string;
  skinColor: string;
  emissive?: boolean;
}): THREE.Group {
  const { group } = createSkinnedHumanoid({
    bodyType: opts.bodyType,
    skinColor: opts.skinColor,
    outfitColor: opts.outfitColor,
    emissive: opts.emissive ?? false,
  });
  return group;
}

// ── Export to GLB ─────────────────────────────────────────────────
async function exportGLB(group: THREE.Group, outPath: string): Promise<void> {
  const exporter = new GLTFExporter();
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      group,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('Expected ArrayBuffer (binary mode); got JSON.'));
      },
      (err) => reject(err),
      { binary: true, embedImages: false, animations: [] },
    );
  });
  fs.writeFileSync(outPath, Buffer.from(buffer));
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(HEROES_DIR, { recursive: true });

  let total = 0;

  // 1. Per-world archetype (6 worlds × 7 archetypes = 42)
  for (const world of WORLDS) {
    const factionsAbs = path.join(CONTENT_WORLD, world.factionsPath);
    if (!fs.existsSync(factionsAbs)) {
      console.warn(`  skip world ${world.id} — factions file missing: ${factionsAbs}`);
      continue;
    }
    const factions = JSON.parse(fs.readFileSync(factionsAbs, 'utf8')) as Faction[];
    if (!Array.isArray(factions) || factions.length === 0) {
      console.warn(`  skip world ${world.id} — no factions`);
      continue;
    }
    for (const arch of ARCHETYPES) {
      const f = pickFactionForArchetype(factions, arch);
      const outfit = f?.visual?.primary_color ?? '#5a5a5a';
      const group = buildGroup({
        bodyType: bodyTypeForArchetype(arch),
        outfitColor: outfit,
        skinColor: DEFAULT_SKIN,
        emissive: arch === 'legend',
      });
      const outPath = path.join(HEROES_DIR, `_archetype_${arch}__${world.id}.glb`);
      await exportGLB(group, outPath);
      const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
      console.log(`  ✓ ${path.basename(outPath)} (${kb} KB) — faction=${f?.id ?? 'fallback'} outfit=${outfit}`);
      total++;
    }
  }

  // 2. Universal archetype fallback (7)
  for (const arch of ARCHETYPES) {
    const group = buildGroup({
      bodyType: bodyTypeForArchetype(arch),
      outfitColor: arch === 'legend' ? '#3a2a4a' : '#5a5a5a',
      skinColor: DEFAULT_SKIN,
      emissive: arch === 'legend',
    });
    const outPath = path.join(HEROES_DIR, `_archetype_${arch}.glb`);
    await exportGLB(group, outPath);
    const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`  ✓ ${path.basename(outPath)} (${kb} KB) — universal fallback`);
    total++;
  }

  // 3. Per-NPC bespoke (the Four). Outfit colors authored from each
  // goddess's lore — Sovereign refuses (dark indigo); Concord
  // synthesises (forest green); Concordia welcomes (warm gold);
  // Weaver weaves echoes (russet umber).
  const FOUR = [
    { id: 'sovereign_first_refusal', outfit: '#1a0d2e', skin: '#d4ad8a' },
    { id: 'concord_first_thought',   outfit: '#0d2e1a', skin: '#c89a72' },
    { id: 'concordia_first_breath',  outfit: '#fce8a8', skin: '#e0b890' },
    { id: 'weaver_of_echoes',        outfit: '#2e1a0d', skin: '#b08868' },
  ];
  for (const n of FOUR) {
    const group = buildGroup({
      bodyType: 'legend',
      outfitColor: n.outfit,
      skinColor: n.skin,
      emissive: true,
    });
    const outPath = path.join(HEROES_DIR, `${n.id}.glb`);
    await exportGLB(group, outPath);
    const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`  ✓ ${path.basename(outPath)} (${kb} KB) — bespoke`);
    total++;
  }

  console.log(`\n${total} .glb files written to ${HEROES_DIR}`);
}

main().catch((err) => {
  console.error('bake-hero-glbs failed:', err);
  process.exit(1);
});
