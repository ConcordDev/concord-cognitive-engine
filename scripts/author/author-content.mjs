#!/usr/bin/env node
// scripts/author/author-content.mjs
//
// Offline content-authoring driver. Generates schema-valid, bible-grounded
// content for a world, gates it through the validators, and idempotently merges
// new records into the auto-discovered content files the seeder reads. Dry-run
// by default; pass --write to persist. Deterministic + reproducible.
//
//   node scripts/author/author-content.mjs --world tunya --type npc --count 20
//   node scripts/author/author-content.mjs --world tunya --type npc --count 20 --write
//
// Curator workflow: dry-run → eyeball the sample → --write → review git diff → commit.

import { join } from "path";
import { loadBible, readJSON, writeJSON, asArray, existingIds, WORLD_DIR } from "./lib.mjs";
import { gateBatch } from "./validate-gate.mjs";
import { generateNpcs, generateFactions } from "./generators.mjs";

function parseArgs(argv) {
  const a = { type: "npc", count: 12, write: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--world") a.world = argv[++i];
    else if (t === "--type") a.type = argv[++i];
    else if (t === "--count") a.count = parseInt(argv[++i], 10) || 12;
    else if (t === "--level") { const [lo, hi] = (argv[++i] || "").split("-").map(Number); a.levelRange = [lo || 2, hi || 30]; }
    else if (t === "--write") a.write = true;
  }
  return a;
}

// type → { target(world), key, bibleKey, generate(bible, count, opts) }
// `bibleKey` is the bible array the new records dedupe against (npcs vs factions).
const TYPES = {
  npc: {
    target: (world) => join(WORLD_DIR, world === "concordia-hub" ? "" : world, "npcs-extra.json"),
    key: "npcs",
    bibleKey: "npcs",
    generate: (bible, count, opts) => generateNpcs(bible, count, opts),
  },
  faction: {
    target: (world) => join(WORLD_DIR, world === "concordia-hub" ? "" : world, "factions-extra.json"),
    key: "factions",
    bibleKey: "factions",
    generate: (bible, count, opts) => generateFactions(bible, count, opts),
  },
};

export function runAuthor(args) {
  const spec = TYPES[args.type];
  if (!spec) throw new Error(`unsupported --type ${args.type} (have: ${Object.keys(TYPES).join(", ")})`);
  if (!args.world) throw new Error("--world is required");

  const bible = loadBible(args.world);
  // Stable sequence from 0 so re-runs are idempotent (the gate dedupes ids that
  // are already present). `--count` is the pipeline-NPC sequence length for the
  // world; extending it later adds only the new tail.
  const candidates = spec.generate(bible, args.count, { startIndex: 0, levelRange: args.levelRange });

  const targetPath = spec.target(args.world);
  const existing = asArray(readJSON(targetPath, []), spec.key);
  const bibleItems = bible[spec.bibleKey] || [];
  const known = existingIds([...bibleItems, ...existing]);
  const { valid, rejected } = gateBatch(args.type, candidates, known);

  const merged = [...existing, ...valid];
  const summary = {
    world: args.world, type: args.type,
    generated: candidates.length, valid: valid.length, rejected: rejected.length,
    existingInFile: existing.length, mergedTotal: merged.length,
    bibleCount: bibleItems.length, targetPath,
    write: args.write,
    rejectReasons: rejected.reduce((m, r) => ((m[r.reason] = (m[r.reason] || 0) + 1), m), {}),
    sample: valid.slice(0, 3).map((n) => ({ id: n.id, name: n.name, job: n.job, level: n.level, bio: n.narrative_context?.bio })),
  };
  if (args.write && valid.length) writeJSON(targetPath, merged);
  return { summary, valid, rejected, merged };
}

// CLI entry (skip when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const { summary } = runAuthor(args);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.write) console.log("\n(dry-run — pass --write to persist; then review the git diff before committing)");
}
