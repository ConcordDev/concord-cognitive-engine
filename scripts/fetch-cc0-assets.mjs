#!/usr/bin/env node
// scripts/fetch-cc0-assets.mjs
//
// Pulls CC0 / free-license 3D models, textures, and HDRIs from public
// sources into `content/world/_shared/{models,textures,hdris}/` so the
// evo-asset bootstrap can seed them on next server boot.
//
// USAGE
//   node scripts/fetch-cc0-assets.mjs              # default: polyhaven + ambientcg + os3a
//   node scripts/fetch-cc0-assets.mjs --all        # also fetch Quaternius packs
//   node scripts/fetch-cc0-assets.mjs --source=polyhaven --limit=100
//
// LEGALITY
//   - Poly Haven: CC0, no attribution required. https://polyhaven.com/license
//   - AmbientCG:  CC0, no attribution required. https://ambientcg.com/license
//   - OS3A:       Mixed licenses; manifest itself notes each. We only
//                 fetch entries marked CC0 / public-domain.
//   - Quaternius: CC0, no attribution required. https://quaternius.com/
//   - Kenney:     CC0, no attribution required. https://kenney.nl/license
//
// All sources verified CC0 (public domain) at time of writing. If a
// source changes its license, this fetcher should NOT be used to pull
// new content without re-verifying.

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const ROOT = path.resolve(new URL(import.meta.url).pathname, "..", "..");
const TARGET_ROOT = path.join(ROOT, "content", "world", "_shared");
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (k) => {
  const a = args.find(x => x.startsWith(`${k}=`));
  return a ? a.split("=", 2)[1] : null;
};
const ALL = hasFlag("--all");
const ONLY = getArg("--source");
const LIMIT_OVERRIDE = Number(getArg("--limit")) || null;

const ENABLE = {
  polyhaven: !ONLY || ONLY === "polyhaven",
  ambientcg: !ONLY || ONLY === "ambientcg",
  os3a:      !ONLY || ONLY === "os3a",
  quaternius: ALL || ONLY === "quaternius",
};

const stats = { polyhaven: 0, ambientcg: 0, os3a: 0, quaternius: 0, errors: 0 };

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
async function downloadTo(url, destPath) {
  if (fs.existsSync(destPath)) return "exists";
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  mkdirp(path.dirname(destPath));
  const tmp = destPath + ".part";
  const f = fs.createWriteStream(tmp);
  await pipeline(r.body, f);
  fs.renameSync(tmp, destPath);
  return "downloaded";
}
function log(...a) { process.stderr.write(a.join(" ") + "\n"); }

// ── Poly Haven (REST API, CC0) ─────────────────────────────────────────
async function fetchPolyHaven(limit = 30) {
  if (!ENABLE.polyhaven) return;
  log(`[polyhaven] fetching up to ${limit} CC0 models + 20 HDRIs…`);
  const modelsDir = path.join(TARGET_ROOT, "models", "polyhaven");
  const hdrisDir  = path.join(TARGET_ROOT, "hdris", "polyhaven");
  mkdirp(modelsDir); mkdirp(hdrisDir);

  // Models
  try {
    const r = await fetch("https://api.polyhaven.com/assets?type=models", { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`assets list ${r.status}`);
    const manifest = await r.json();
    const ids = Object.keys(manifest).slice(0, limit);
    for (const id of ids) {
      try {
        const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { signal: AbortSignal.timeout(15_000) })).json();
        const url = files?.gltf?.["1k"]?.gltf?.url || files?.blend?.["1k"]?.glb?.url;
        if (!url) continue;
        const ext = url.endsWith(".gltf") ? ".gltf" : ".glb";
        const dest = path.join(modelsDir, `${id}${ext}`);
        const action = await downloadTo(url, dest);
        if (action === "downloaded") { stats.polyhaven++; log(`  + ${id}${ext}`); }
      } catch (e) { stats.errors++; log(`  ! ${id}: ${e.message}`); }
    }
  } catch (e) { log(`[polyhaven] models error: ${e.message}`); }

  // HDRIs
  try {
    const r = await fetch("https://api.polyhaven.com/assets?type=hdris", { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`hdris list ${r.status}`);
    const manifest = await r.json();
    const ids = Object.keys(manifest).slice(0, 20);
    for (const id of ids) {
      try {
        const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { signal: AbortSignal.timeout(15_000) })).json();
        const url = files?.hdri?.["1k"]?.hdr?.url || files?.hdri?.["2k"]?.hdr?.url;
        if (!url) continue;
        const dest = path.join(hdrisDir, `${id}.hdr`);
        const action = await downloadTo(url, dest);
        if (action === "downloaded") { stats.polyhaven++; log(`  + ${id}.hdr`); }
      } catch (e) { stats.errors++; }
    }
  } catch (e) { log(`[polyhaven] hdris error: ${e.message}`); }
}

// ── AmbientCG (REST API, CC0) ──────────────────────────────────────────
async function fetchAmbientCG(limit = 50) {
  if (!ENABLE.ambientcg) return;
  log(`[ambientcg] fetching up to ${limit} PBR materials…`);
  const dir = path.join(TARGET_ROOT, "textures", "ambientcg");
  mkdirp(dir);
  try {
    const r = await fetch(`https://ambientcg.com/api/v2/full_json?type=Material&limit=${limit}`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`list ${r.status}`);
    const data = await r.json();
    const items = Array.isArray(data?.foundAssets) ? data.foundAssets : [];
    for (const item of items) {
      const id = item.assetId;
      if (!id) continue;
      try {
        const dl = item.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads?.[0]?.downloadLink;
        if (!dl) continue;
        const dest = path.join(dir, `${id}.zip`);
        const action = await downloadTo(dl, dest);
        if (action === "downloaded") { stats.ambientcg++; log(`  + ${id}.zip`); }
      } catch (e) { stats.errors++; }
    }
  } catch (e) { log(`[ambientcg] error: ${e.message}`); }
}

// ── OS3A (GitHub-hosted manifest, mixed licenses — filter CC0) ────────
async function fetchOS3A(limit = 50) {
  if (!ENABLE.os3a) return;
  log(`[os3a] fetching up to ${limit} community models…`);
  const dir = path.join(TARGET_ROOT, "models", "os3a");
  mkdirp(dir);
  try {
    const r = await fetch("https://raw.githubusercontent.com/toxsam/open-source-3D-assets/main/list.json", { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`list ${r.status}`);
    const list = await r.json();
    if (!Array.isArray(list)) return;
    const cc0Items = list.filter(i => {
      const lic = (i.license || "").toLowerCase();
      return lic.includes("cc0") || lic.includes("public domain") || lic.includes("unlicense");
    }).slice(0, limit);
    for (const item of cc0Items) {
      const id = item.id || item.name;
      const url = item.url || item.download;
      if (!id || !url) continue;
      try {
        const dest = path.join(dir, `${id}.glb`);
        const action = await downloadTo(url, dest);
        if (action === "downloaded") { stats.os3a++; log(`  + ${id}.glb`); }
      } catch (e) { stats.errors++; }
    }
  } catch (e) { log(`[os3a] error: ${e.message}`); }
}

// ── Quaternius (CC0 stylized packs — no API, hardcoded pack URLs) ──────
//
// Quaternius doesn't expose a JSON API but ships individual ZIP packs at
// stable URLs on `quaternius.com/packs/`. List below maintained manually
// from https://quaternius.com — re-verify CC0 status if new packs added.
const QUATERNIUS_PACKS = [
  // Stylized nature, characters, props — high-leverage seeds for procgen
  { id: "ultimate-stylized-nature",   url: "https://quaternius.com/packs/UltimateStylizedNaturePack.zip" },
  { id: "ultimate-stylized-character", url: "https://quaternius.com/packs/ultimatestylizedcharacter.zip" },
  { id: "ultimate-modular-character",  url: "https://quaternius.com/packs/UltimateModularCharacters.zip" },
  { id: "low-poly-survival",           url: "https://quaternius.com/packs/SurvivalPack.zip" },
  { id: "low-poly-fantasy-rpg",        url: "https://quaternius.com/packs/FantasyRPGPack.zip" },
  { id: "low-poly-medieval-village",   url: "https://quaternius.com/packs/MedievalVillagePack.zip" },
  { id: "low-poly-animated-animals",   url: "https://quaternius.com/packs/AnimatedAnimals.zip" },
  { id: "low-poly-modular-dungeons",   url: "https://quaternius.com/packs/ModularDungeon.zip" },
];

async function fetchQuaternius() {
  if (!ENABLE.quaternius) return;
  log(`[quaternius] fetching ${QUATERNIUS_PACKS.length} CC0 packs (large; can take a while)…`);
  const dir = path.join(TARGET_ROOT, "models", "quaternius", "_zips");
  mkdirp(dir);
  for (const pack of QUATERNIUS_PACKS) {
    try {
      const dest = path.join(dir, `${pack.id}.zip`);
      const action = await downloadTo(pack.url, dest);
      if (action === "downloaded") { stats.quaternius++; log(`  + ${pack.id}.zip`); }
    } catch (e) { stats.errors++; log(`  ! ${pack.id}: ${e.message}`); }
  }
  log(`[quaternius] downloaded — extract each ZIP under ${dir} or set QUATERNIUS_DIR to that path before next server boot.`);
}

// ── Run ────────────────────────────────────────────────────────────────
mkdirp(TARGET_ROOT);
mkdirp(path.join(TARGET_ROOT, "models"));
mkdirp(path.join(TARGET_ROOT, "textures"));
mkdirp(path.join(TARGET_ROOT, "hdris"));

const t0 = Date.now();
await fetchPolyHaven(LIMIT_OVERRIDE || 30);
await fetchAmbientCG(LIMIT_OVERRIDE || 50);
await fetchOS3A(LIMIT_OVERRIDE || 50);
await fetchQuaternius();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

log("\n=== CC0 FETCH COMPLETE ===");
log(`Poly Haven:  ${stats.polyhaven} new files`);
log(`AmbientCG:   ${stats.ambientcg} new files`);
log(`OS3A:        ${stats.os3a} new files`);
log(`Quaternius:  ${stats.quaternius} new ZIPs (need extraction)`);
log(`Errors:      ${stats.errors}`);
log(`Elapsed:     ${elapsed}s`);
log("\nNext steps:");
log(`  1. (Optional) Extract Quaternius ZIPs: ${path.join(TARGET_ROOT, "models", "quaternius", "_zips")} → set QUATERNIUS_DIR env`);
log(`  2. Restart the server. Bootstrap will register everything under content/world/_shared/.`);
log(`  3. Browse the registry: curl http://localhost:5050/api/lens/run -d '{"domain":"evo","name":"asset-stats"}'`);
