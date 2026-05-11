#!/usr/bin/env node
// scripts/scaffold-world-kit.js
//
// Sprint 6 — World-kit scaffolder.
//
// Usage:
//   node scripts/scaffold-world-kit.js <worldId>
//     → reads content/world/<worldId>/meta.json for genre + skill_affinity
//     → writes any MISSING enrichment files to content/world/<worldId>/
//     → never overwrites (idempotent)
//
// Example:
//   node scripts/scaffold-world-kit.js cyber
//   → creates calendar.json, industries.json, naming_conventions.json,
//     apparel.json, bestiary.json, diplomatic_graph.json, schedules.json
//     (with placeholder strings the author fills in)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldWorld } from "../server/lib/world-kit-templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CONTENT_ROOT = path.join(REPO_ROOT, "content", "world");

function pickGenre(meta) {
  if (meta?.genre) return meta.genre;
  const wid = meta?.world_id || "";
  if (wid.includes("fantasy")) return "fantasy";
  if (wid.includes("cyber")) return "cyber";
  if (wid.includes("superhero")) return "superhero";
  if (wid.includes("crime")) return "crime";
  if (wid.includes("sovereign")) return "sovereign-ruins";
  if (wid.includes("lattice")) return "lattice-crucible";
  if (wid.includes("frontier")) return "concord-link-frontier";
  return "standard";
}

function pickDominantDomain(meta) {
  const aff = meta?.skill_affinity || {};
  let best = "default";
  let bestScore = 0;
  for (const [domain, score] of Object.entries(aff)) {
    if (domain === "default") continue;
    if (typeof score === "number" && score > bestScore) {
      bestScore = score;
      best = domain;
    }
  }
  return best;
}

function main() {
  const worldId = process.argv[2];
  if (!worldId) {
    console.error("usage: node scripts/scaffold-world-kit.js <worldId>");
    process.exit(1);
  }
  const dir = path.join(CONTENT_ROOT, worldId);
  if (!fs.existsSync(dir)) {
    console.error(`world directory not found: ${dir}`);
    process.exit(1);
  }

  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    console.error(`meta.json not found at ${metaPath} — scaffold meta first`);
    process.exit(1);
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch (err) {
    console.error(`failed to parse meta.json: ${err.message}`);
    process.exit(1);
  }

  const genre = pickGenre(meta);
  const dominantSkillDomain = pickDominantDomain(meta);

  const fsLike = {
    exists: (p) => fs.existsSync(p),
    writeFile: (p, contents) => fs.writeFileSync(p, contents, "utf8"),
  };

  const result = scaffoldWorld({
    worldId,
    genre,
    dominantSkillDomain,
    hints: meta.calendar_hints || {},
    fsLike,
    dir,
  });

  console.log(`\nWorld-kit scaffolder — ${worldId}`);
  console.log(`  genre:           ${genre}`);
  console.log(`  dominant domain: ${dominantSkillDomain}`);
  console.log(`  created (${result.created.length}):`);
  for (const f of result.created) console.log(`    + ${f}`);
  if (result.skipped.length) {
    console.log(`  skipped (already present, ${result.skipped.length}):`);
    for (const f of result.skipped) console.log(`    = ${f}`);
  }
  if (result.errors.length) {
    console.log(`  errors:`);
    for (const e of result.errors) console.log(`    ! ${e}`);
    process.exit(2);
  }
  console.log(`\nNext: fill in [AUTHOR] placeholders in the created files,`);
  console.log(`then restart the server — content-seeder ingests automatically.`);
}

main();
