#!/usr/bin/env node
/**
 * sync-concordia-hub-kit.mjs — one Unburned Court pack, three presenters.
 *
 * Canonical GLBs live in content/concordia-assets/hub/ (git).
 * This copies them into:
 *   Unity  StreamingAssets/HubKit/     (player + WebGL, no AssetDatabase)
 *   Vite   apps/concordia-living-world/public/models/kenney/
 *   Godot / world-lens  concord-frontend/public/models/hub/
 *
 * First ingest (Mac kitchen with gitignored kenney-free):
 *   node scripts/sync-concordia-hub-kit.mjs
 *
 * Re-copy from committed content (CI / other machines, no kitchen):
 *   node scripts/sync-concordia-hub-kit.mjs
 *
 * Never copies Mixamo or the 118MB kenney-free tree.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANON = path.join(REPO, "content", "concordia-assets", "hub");
const UNITY = path.join(
  REPO,
  "apps",
  "concordia-living-world",
  "unity-client",
  "Assets",
  "StreamingAssets",
  "HubKit",
);
const VITE_KENNEY = path.join(
  REPO,
  "apps",
  "concordia-living-world",
  "public",
  "models",
  "kenney",
);
const WEB_HUB = path.join(REPO, "concord-frontend", "public", "models", "hub");

const KITCHEN_CANDIDATES = [
  process.env.CONCORDIA_KENNEY_ROOT,
  path.join(
    REPO,
    "apps",
    "concordia-living-world",
    "unity-client",
    "Assets",
    "Concordia",
    "Models",
    "kenney-free",
  ),
  "/Users/dutch/concord vs code/concord-cognitive-engine/apps/concordia-living-world/unity-client/Assets/Concordia/Models/kenney-free",
].filter(Boolean);

const KITCHEN_KENNEY = KITCHEN_CANDIDATES.find((p) => fs.existsSync(p)) || KITCHEN_CANDIDATES[KITCHEN_CANDIDATES.length - 1];

const KAYKIT_DIR = path.join(REPO, "concord-frontend", "public", "models", "building");

const STEMS = [
  "wall",
  "column",
  "weapon-sword",
  "banner",
  "tower-square-base",
  "crypt-small",
  "tent_detailedOpen",
  "tent_smallOpen",
  "tree_oak",
  "tree_default",
  "tree_simple",
  "tree_pineTallA",
  "plant_bush",
  "table",
  "chair",
  "barrel",
  "crate",
  "cart",
  "desk",
  "books",
  "bookcaseOpen",
  "bookcaseClosed",
  "campfire_stones",
  "campfire_logs",
  "crops_wheatStageB",
  "lantern",
  "lampRoundFloor",
  "character-skeleton",
  "road-straight",
  "loungeSofa",
  "kitchenStove",
  "burger-cheese",
  "apple",
  "bread",
  "cheese-cut",
  "detail-parasol-a",
  "chairDesk",
  "log_large",
  "flower_redA",
  "building-type-a",
  "building-type-b",
  "building-type-c",
  "building-type-d",
  "statue_head",
  "statue_obelisk",
  "coatRackStanding",
  "rock_smallA",
  "rock_smallB",
  "grass",
];

const KAYKIT = [
  { stem: "forge", file: "forge.glb" },
  { stem: "tower", file: "tower.glb" },
];

const ALIASES = [
  { from: "building-small-a", to: "building-type-a" },
  { from: "building-small-b", to: "building-type-b" },
  { from: "building-small-c", to: "building-type-c" },
  { from: "building-small-d", to: "building-type-d" },
  { from: "statue", to: "statue_head" },
  { from: "weapon-rack", to: "coatRackStanding" },
  { from: "trophy", to: "statue_obelisk" },
  { from: "market_crate", to: "crate" },
  { from: "market_barrel", to: "barrel" },
  { from: "building-garage", to: "building-type-d" },
  { from: "road-straight-lightposts", to: "road-straight" },
];

const PACK_PREF = [
  "web-seed",
  "nature",
  "fantasy-town",
  "mini-dungeon",
  "graveyard",
  "castle",
  "furniture",
  "city-suburban",
  "platformer",
];

function fail(reason, extra = {}) {
  process.stderr.write(JSON.stringify({ ok: false, reason, ...extra }) + "\n");
  process.exit(1);
}

function log(msg) {
  process.stderr.write(`[hub-kit] ${msg}\n`);
}

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  mkdir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function findKenney(stem) {
  const name = `${stem}.glb`;
  if (!fs.existsSync(KITCHEN_KENNEY)) return null;
  for (const pack of PACK_PREF) {
    const hit = walkNamed(path.join(KITCHEN_KENNEY, pack), name);
    if (hit) return hit;
  }
  return walkNamed(KITCHEN_KENNEY, name);
}

function walkNamed(dir, name) {
  if (!fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === name) return p;
    }
  }
  return null;
}

function glbMagicOk(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  return buf.toString("ascii") === "glTF";
}

function ingestFromKitchen() {
  if (!fs.existsSync(KITCHEN_KENNEY)) {
    fail("kenney_kitchen_missing", { kitchen: KITCHEN_KENNEY });
  }
  mkdir(CANON);
  const files = [];
  const missing = [];
  for (const stem of STEMS) {
    const src = findKenney(stem);
    if (!src) {
      missing.push(stem);
      continue;
    }
    if (!glbMagicOk(src)) fail("not_glb", { stem, src });
    const dest = path.join(CANON, `${stem}.glb`);
    copyFile(src, dest);
    files.push({
      stem,
      file: `${stem}.glb`,
      license: "CC0",
      author: "Kenney",
      source: path.relative(KITCHEN_KENNEY, src),
    });
  }
  for (const k of KAYKIT) {
    const src = path.join(KAYKIT_DIR, k.file);
    if (!fs.existsSync(src)) fail("kaykit_missing", { src });
    if (!glbMagicOk(src)) fail("not_glb", { stem: k.stem, src });
    copyFile(src, path.join(CANON, k.file));
    files.push({
      stem: k.stem,
      file: k.file,
      license: "CC0",
      author: "Kay Lousberg",
      source: `concord-frontend/public/models/building/${k.file}`,
    });
  }
  if (missing.length) fail("stems_missing", { missing });
  const manifest = {
    id: "unburned-court-hub-kit",
    title: "Unburned Court hub kit",
    note: "One piece. Shared by Unity, Godot, and the Vite KenneyField. Not the 118MB kenney-free tree.",
    files,
    aliases: ALIASES,
  };
  fs.writeFileSync(path.join(CANON, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

function loadCanonManifest() {
  const p = path.join(CANON, "MANIFEST.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function distribute(manifest) {
  mkdir(UNITY);
  mkdir(VITE_KENNEY);
  mkdir(WEB_HUB);
  const kenneyNames = new Set([
    "tree_oak.glb",
    "tree_simple.glb",
    "tree_default.glb",
    "tree_pineTallA.glb",
    "rock_smallA.glb",
    "rock_smallB.glb",
  ]);
  for (const entry of manifest.files) {
    const src = path.join(CANON, entry.file);
    if (!fs.existsSync(src)) fail("canon_file_missing", { file: entry.file });
    copyFile(src, path.join(UNITY, entry.file));
    copyFile(src, path.join(WEB_HUB, entry.file));
    if (kenneyNames.has(entry.file) || entry.author === "Kenney") {
      copyFile(src, path.join(VITE_KENNEY, entry.file));
    }
  }
  copyFile(path.join(CANON, "MANIFEST.json"), path.join(UNITY, "MANIFEST.json"));
  copyFile(path.join(CANON, "MANIFEST.json"), path.join(WEB_HUB, "MANIFEST.json"));
  copyFile(path.join(CANON, "ATTRIBUTION.md"), path.join(WEB_HUB, "ATTRIBUTION.md"));
}

function writeAttribution() {
  const text = `# Unburned Court hub kit — attribution

This folder is the **one starting piece**: the meshes the Unburned Court
needs so Unity / Godot / Three.js are not grey cubes. It is not the full
Kenney kitchen (~118MB, gitignored) and it is not Mixamo (~587MB, gitignored).

| Author | License | What |
|---|---|---|
| [Kenney](https://kenney.nl) | CC0 1.0 | Trees, walls, furniture, tents, roads, props |
| [Kay Lousberg](https://kaylousberg.com) (KayKit) | CC0 1.0 | \`forge.glb\`, \`tower.glb\` (already shipped in world-lens \`public/models/building/\`) |

Attribution is not required by CC0; it is recorded so the next pack can
follow the same provenance trail. Do not add paid/licensed meshes here.

Rebuild presenters from this folder:

    node scripts/sync-concordia-hub-kit.mjs
`;
  fs.writeFileSync(path.join(CANON, "ATTRIBUTION.md"), text);
}

function main() {
  mkdir(CANON);
  let manifest = loadCanonManifest();
  const canonComplete =
    manifest &&
    Array.isArray(manifest.files) &&
    manifest.files.every((f) => fs.existsSync(path.join(CANON, f.file)));
  if (!canonComplete) {
    log("ingesting from Kenney kitchen + KayKit landmarks");
    manifest = ingestFromKitchen();
    writeAttribution();
  } else {
    log("using committed content/concordia-assets/hub");
    if (!fs.existsSync(path.join(CANON, "ATTRIBUTION.md"))) writeAttribution();
  }
  distribute(manifest);
  const bytes = manifest.files.reduce((n, f) => n + fs.statSync(path.join(CANON, f.file)).size, 0);
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        id: manifest.id,
        files: manifest.files.length,
        aliases: manifest.aliases.length,
        bytes,
        dest: { unity: UNITY, viteKenney: VITE_KENNEY, webHub: WEB_HUB, canon: CANON },
      },
      null,
      2,
    ) + "\n",
  );
}

main();
