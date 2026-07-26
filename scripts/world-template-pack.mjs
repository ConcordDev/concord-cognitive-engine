#!/usr/bin/env node
// scripts/world-template-pack.mjs
//
// Standalone CLI for server/lib/world-template-pack.js — package an
// EXISTING authored sub-world (content/world/<worldId>/) as a reusable,
// shareable template pack, and seed a new world under a different id
// from one. No server boot; pure fs work, same style as
// scripts/scaffold-world.mjs (which generates FRESH placeholder content
// but cannot round-trip an already-authored world — this script fills
// that gap).
//
// Usage:
//   node scripts/world-template-pack.mjs export <world-id> <output-file> [--root <path>]
//   node scripts/world-template-pack.mjs import <pack-file> <new-world-id> [--root <path>] [--force] [--dry-run]
//
//   export  reads content/world/<world-id>/ (every file, including
//           nested directories like quests/) and writes a single
//           versioned envelope JSON file to <output-file>. Every literal
//           occurrence of <world-id> in every file's content is replaced
//           with a placeholder token first, so the pack carries no
//           stale self-references to the source world.
//
//   import  verifies the pack's integrity hash, substitutes the
//           placeholder back to <new-world-id>, re-validates every
//           record through the REAL server/lib/content-seeder.js
//           validators (validateNpc/validateFaction/validateLoreEvent/
//           validateQuest), and only then writes
//           content/world/<new-world-id>/. Any validation failure
//           aborts before anything is written.
//
// Options:
//   --root <path>   Repo root to operate against. Defaults to the real
//                    repo (one directory up from this script). Tests
//                    MUST pass a temp directory here so the real repo's
//                    content/world/ tree is never touched by a test run.
//   --force          (import only) overwrite an existing
//                    content/world/<new-world-id>/ directory.
//   --dry-run        (import only) run every validation but write nothing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportWorldPack, importWorldPack } from "../server/lib/world-template-pack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

const WORLD_ID_RE = /^[a-z][a-z0-9-]*$/;

function usage() {
  return [
    "usage:",
    "  node scripts/world-template-pack.mjs export <world-id> <output-file> [--root <path>]",
    "  node scripts/world-template-pack.mjs import <pack-file> <new-world-id> [--root <path>] [--force] [--dry-run]",
  ].join("\n");
}

function parseArgs(argv) {
  const positional = [];
  const opts = { root: DEFAULT_ROOT, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") { opts.root = path.resolve(argv[++i] || ""); }
    else if (a === "--force") { opts.force = true; }
    else if (a === "--dry-run") { opts.dryRun = true; }
    else if (a.startsWith("--")) { throw new Error(`unknown option: ${a}`); }
    else positional.push(a);
  }
  return { positional, opts };
}

async function runExport(positional, opts) {
  const [worldId, outputFile] = positional;
  if (!worldId || !WORLD_ID_RE.test(worldId)) {
    console.error(`export: world-id "${worldId}" must be kebab-case matching ${WORLD_ID_RE}`);
    console.error(usage());
    process.exit(1);
  }
  if (!outputFile) {
    console.error("export: <output-file> is required");
    console.error(usage());
    process.exit(1);
  }

  const result = exportWorldPack(worldId, opts.root);
  if (!result.ok) {
    console.error(`export: failed — ${result.reason}${result.error && result.error !== result.reason ? ` (${result.error})` : ""}`);
    process.exit(1);
  }

  const outPath = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result.envelope, null, 2) + "\n", "utf8");
  console.log(`exported "${worldId}" (${result.envelope.counts.files} files) -> ${outPath}`);
}

async function runImport(positional, opts) {
  const [packFile, newWorldId] = positional;
  if (!packFile) {
    console.error("import: <pack-file> is required");
    console.error(usage());
    process.exit(1);
  }
  if (!newWorldId || !WORLD_ID_RE.test(newWorldId)) {
    console.error(`import: new-world-id "${newWorldId}" must be kebab-case matching ${WORLD_ID_RE}`);
    console.error(usage());
    process.exit(1);
  }

  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(path.resolve(packFile), "utf8"));
  } catch (err) {
    console.error(`import: could not read/parse pack file: ${err.message}`);
    process.exit(1);
  }

  const result = await importWorldPack(envelope, newWorldId, opts.root, { force: opts.force, dryRun: opts.dryRun });
  if (!result.ok) {
    console.error(`import: failed — ${result.reason}`);
    if (Array.isArray(result.problems)) {
      for (const p of result.problems) console.error(`  - ${p}`);
    }
    process.exit(1);
  }

  if (result.dryRun) {
    console.log(`import (dry-run): "${newWorldId}" would import cleanly —`, result.imported);
  } else {
    console.log(`imported "${newWorldId}" -> ${result.dir}`, result.imported);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  let parsed;
  try {
    parsed = parseArgs(argv.slice(1));
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exit(1);
    return;
  }

  if (command === "export") {
    await runExport(parsed.positional, parsed.opts);
  } else if (command === "import") {
    await runImport(parsed.positional, parsed.opts);
  } else {
    console.error(`unknown command: ${command || "(none)"}`);
    console.error(usage());
    process.exit(1);
  }
}

main();
