#!/usr/bin/env node
// scripts/author/census.mjs
//
// Content census — counts authored content per world + minigame lib against the
// curated-but-full targets, and reports gaps. CI-able: `--ci` exits non-zero if
// any surface is below target (so content can't silently regress).
//
//   node scripts/author/census.mjs           # human report
//   node scripts/author/census.mjs --ci       # fail build on any below-target

import { join } from "path";
import { loadBible, listWorlds, readJSON, asArray, CONTENT } from "./lib.mjs";

// Only consumer-verified, FILE-DRIVEN content gets a target. Deliberately
// excludes code-defined surfaces that earlier audits mis-flagged as content
// gaps: fauna species (loot-tables.js BIOME_SPECIES, not creatures.json) and
// mahjong yaku (minigame-resolvers.js + mahjong/yaku-detect.js, not JSON).
const WORLD_TARGETS = { npcs: 30, factions: 8 };
const LIB_TARGETS = {
  // filename → target. Filenames match what content-seeder.js / farming.js read.
  "crops.json": 18,                 // read by lib/farming.js
  "hacking-puzzles.json": 30,       // seeded by content-seeder
  "code-puzzles.json": 20,          // seeded by content-seeder
  "trivia-questions.json": 30,      // seeded
  "karaoke-songs.json": 25,         // seeded
  "hidden-object-scenes.json": 12,  // seeded (already stocked; real filename)
};

function worldRow(world) {
  const b = loadBible(world);
  const dir = world === "concordia-hub" ? CONTENT + "/world" : join(CONTENT, "world", world);
  const creatures = asArray(readJSON(join(dir, "creatures.json"), []), "creatures").length;
  return { world, npcs: b.npcs.length, factions: b.factions.length, lore: b.lore.length, creatures };
}

export function census() {
  const worlds = listWorlds().map(worldRow);
  const libs = Object.entries(LIB_TARGETS).map(([file, target]) => {
    const n = asArray(readJSON(join(CONTENT, file), []), null).length;
    return { file, count: n, target, ok: n >= target };
  });
  const worldGaps = [];
  for (const w of worlds) {
    for (const [k, target] of Object.entries(WORLD_TARGETS)) {
      if ((w[k] ?? 0) < target) worldGaps.push(`${w.world}.${k}: ${w[k] ?? 0}/${target}`);
    }
  }
  const libGaps = libs.filter((l) => !l.ok).map((l) => `${l.file}: ${l.count}/${l.target}`);
  return { worlds, libs, worldGaps, libGaps, ok: worldGaps.length === 0 && libGaps.length === 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = census();
  console.log("=== Per-world ===");
  for (const w of r.worlds) console.log(`  ${w.world.padEnd(22)} NPCs ${String(w.npcs).padStart(3)} | creatures ${String(w.creatures).padStart(2)} | factions ${String(w.factions).padStart(2)} | lore ${w.lore}`);
  console.log("=== Minigame libs ===");
  for (const l of r.libs) console.log(`  ${l.ok ? "ok " : "GAP"} ${l.file.padEnd(24)} ${l.count}/${l.target}`);
  console.log(`\nWorld gaps: ${r.worldGaps.length} | Lib gaps: ${r.libGaps.length} | overall ${r.ok ? "AT TARGET" : "BELOW TARGET"}`);
  if (process.argv.includes("--ci") && !r.ok) {
    console.error("\nCensus below target:\n  " + [...r.worldGaps, ...r.libGaps].join("\n  "));
    process.exit(1);
  }
}
