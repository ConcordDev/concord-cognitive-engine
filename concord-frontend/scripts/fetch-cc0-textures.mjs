#!/usr/bin/env node
/**
 * fetch-cc0-textures — DEPRECATED / OPTIONAL escape hatch.
 *
 * ⚠️  Before running this, prefer Concord's own content engine:
 *
 *     art lens → texture DTU → evo_assets (kind='texture')
 *                            → resolved at runtime via
 *                              GET /api/evo-asset/resolve
 *                            → consumed by pbr-loader.ts
 *
 * Player-authored textures flow through that pipeline with full
 * royalty-cascade lineage tracking; LLaVA validates aesthetic
 * consistency; evo-asset scheduler refines on the heartbeat tick;
 * marketplace votes canon. That's the actual content treadmill.
 *
 * This script is a one-shot bootstrap that pulls a curated CC0
 * material pack from AmbientCG into public/textures/<kind>/ — useful
 * when (a) the lens engine hasn't yet produced any texture DTU for a
 * given material kind, AND (b) the procedural fallback in
 * procedural-texture.ts is too stylized for a particular scene.
 *
 * If you're reaching for this script as a default, you're probably
 * sidestepping the content engine. The substrate is designed so that
 * authored DTUs > CC0 pack > procedural fallback, in that priority
 * order, automatically. See lib/world-lens/pbr-loader.ts.
 *
 *     node scripts/fetch-cc0-textures.mjs
 *
 * Source: AmbientCG. All textures are CC0 (public domain) — no
 * attribution required by license, but we ship one in
 * public/textures/README.md for honesty.
 *
 * Idempotent: re-running only fetches files that are missing on disk.
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'public', 'textures');

/**
 * Mapping of our procedural kinds → AmbientCG asset id. Each asset
 * provides Color, NormalGL, Roughness, AmbientOcclusion. We pull the
 * 1K versions to keep repo size bounded; bump to 2K for crisper
 * close-ups if you have the budget.
 *
 * If AmbientCG slugs change, update here. The script is resilient to
 * partial failures: any missing channel falls back to procedural.
 */
const PACK = {
  stone:   { slug: 'Rock030',         res: '1K-JPG' },
  wood:    { slug: 'Wood048',         res: '1K-JPG' },
  brick:   { slug: 'Bricks074',       res: '1K-JPG' },
  cloth:   { slug: 'Fabric039',       res: '1K-JPG' },
  metal:   { slug: 'Metal034',        res: '1K-JPG' },
  leather: { slug: 'Leather011',      res: '1K-JPG' },
  thatch:  { slug: 'Ground039',       res: '1K-JPG' },
  dirt:    { slug: 'Ground054',       res: '1K-JPG' },
};

const CHANNELS = [
  { dst: 'color.jpg',     suffix: '_Color.jpg' },
  { dst: 'normal.jpg',    suffix: '_NormalGL.jpg' },
  { dst: 'roughness.jpg', suffix: '_Roughness.jpg' },
  { dst: 'ao.jpg',        suffix: '_AmbientOcclusion.jpg' },
];

const BASE_URL = 'https://ambientCG.com/get?file=';

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function fetchOne(url, dest) {
  if (await exists(dest)) {
    return { ok: true, skipped: true };
  }
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return { ok: false, status: res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    return { ok: true, skipped: false, size: buf.length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function fetchKind(kind, { slug, res }) {
  const dir = join(PUBLIC_DIR, kind);
  const results = [];
  for (const ch of CHANNELS) {
    const file = `${slug}_${res}${ch.suffix}`;
    const url = `${BASE_URL}${encodeURIComponent(file)}`;
    const dest = join(dir, ch.dst);
    const r = await fetchOne(url, dest);
    results.push({ kind, channel: ch.dst, ...r });
  }
  return results;
}

async function writeReadme() {
  const path = join(PUBLIC_DIR, 'README.md');
  const content = `# Authored PBR textures

This directory holds CC0 (public-domain) PBR texture sets. They are
pulled from AmbientCG by \`scripts/fetch-cc0-textures.mjs\` and
preferred over the procedural canvas fallback when present.

## Source

All textures: https://ambientcg.com — CC0 Public Domain.

No attribution required, but we cite the source for honesty.

## Layout

\`\`\`
public/textures/
  stone/   color.jpg  normal.jpg  roughness.jpg  ao.jpg
  wood/    …
  brick/   …
  cloth/   …
  metal/   …
  leather/ …
  thatch/  …
  dirt/    …
\`\`\`

## Refresh

\`\`\`bash
node scripts/fetch-cc0-textures.mjs
\`\`\`

Re-running only fetches files that aren't already on disk. To force a
re-pull, delete the folder first.
`;
  await mkdir(PUBLIC_DIR, { recursive: true });
  await writeFile(path, content);
}

async function main() {
  console.log('[fetch-cc0-textures] starting…');
  await writeReadme();
  const all = [];
  for (const [kind, info] of Object.entries(PACK)) {
    process.stdout.write(`[fetch-cc0-textures] ${kind.padEnd(8)} `);
    const res = await fetchKind(kind, info);
    const ok = res.filter((r) => r.ok && !r.skipped).length;
    const skip = res.filter((r) => r.skipped).length;
    const fail = res.filter((r) => !r.ok).length;
    console.log(`ok=${ok} skipped=${skip} fail=${fail}`);
    all.push(...res);
  }
  const okTotal = all.filter((r) => r.ok).length;
  const failTotal = all.filter((r) => !r.ok).length;
  console.log(`[fetch-cc0-textures] done. ${okTotal} ok / ${failTotal} fail / ${all.length} total`);
  if (failTotal > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[fetch-cc0-textures] FATAL:', err);
  process.exit(2);
});
