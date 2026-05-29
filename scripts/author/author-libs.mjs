#!/usr/bin/env node
// scripts/author/author-libs.mjs
//
// Offline driver for the TOP-LEVEL minigame libs (content/<file>.json), as opposed
// to the world-scoped author-content.mjs. Generates schema-valid records, gates them
// through the validators, and idempotently merges new records (by id) into the lib
// file the seeder reads. Dry-run by default; pass --write to persist.
//
//   node scripts/author/author-libs.mjs --type crop --count 13
//   node scripts/author/author-libs.mjs --type crop --count 13 --write
//
// Curator workflow: dry-run → eyeball the sample → --write → review git diff → commit.
//
// NOTE: hacking + code puzzles are hand-authored (player-facing skill challenges) and
// live directly in content/hacking-puzzles.json / code-puzzles.json. They are NOT
// generated here; this driver only generates `crop`. The gate validators + the
// content-libs test still pin their validity + solvability.

import { join } from "path";
import { readJSON, writeJSON, asArray, CONTENT } from "./lib.mjs";
import { gateBatch } from "./validate-gate.mjs";
import { generateCrops } from "./generators.mjs";

function parseArgs(argv) {
  const a = { type: "crop", count: 13, write: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--type") a.type = argv[++i];
    else if (t === "--count") a.count = parseInt(argv[++i], 10) || 13;
    else if (t === "--write") a.write = true;
  }
  return a;
}

// type → { file, generate(existing, count) }
const TYPES = {
  crop: {
    file: "crops.json",
    generate: (existing, count) => generateCrops(existing, count),
  },
};

export function runAuthorLib(args) {
  const spec = TYPES[args.type];
  if (!spec) throw new Error(`unsupported --type ${args.type} (have: ${Object.keys(TYPES).join(", ")})`);

  const targetPath = join(CONTENT, spec.file);
  const existing = asArray(readJSON(targetPath, []), null);
  const knownIds = new Set(existing.map((x) => x?.id).filter(Boolean));
  const candidates = spec.generate(existing, args.count);
  const { valid, rejected } = gateBatch(args.type, candidates, knownIds);

  const merged = [...existing, ...valid];
  const summary = {
    type: args.type, file: spec.file,
    generated: candidates.length, valid: valid.length, rejected: rejected.length,
    existingInFile: existing.length, mergedTotal: merged.length,
    write: args.write,
    rejectReasons: rejected.reduce((m, r) => ((m[r.reason] = (m[r.reason] || 0) + 1), m), {}),
    sample: valid.slice(0, 3),
  };
  if (args.write && valid.length) writeJSON(targetPath, merged);
  return { summary, valid, rejected, merged };
}

// CLI entry (skip when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const { summary } = runAuthorLib(args);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.write) console.log("\n(dry-run — pass --write to persist; then review the git diff before committing)");
}
