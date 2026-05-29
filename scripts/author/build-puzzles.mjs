#!/usr/bin/env node
// scripts/author/build-puzzles.mjs
//
// Merges the hand-authored hacking + code puzzles (from the *-specs.mjs modules)
// into content/hacking-puzzles.json + content/code-puzzles.json. Every record is
// gate-validated, every hacking solution path is checked navigable against its tree,
// and every code puzzle's test cases are derived from a verified reference program —
// so a broken design fails here, never in production. Idempotent (merge-by-id).
// Dry-run by default; pass --write to persist.
//
//   node scripts/author/build-puzzles.mjs
//   node scripts/author/build-puzzles.mjs --write

import { join } from "path";
import { readJSON, writeJSON, asArray, CONTENT } from "./lib.mjs";
import { gateBatch } from "./validate-gate.mjs";
import { buildNewHackingPuzzles, checkNavigable } from "./hacking-puzzle-specs.mjs";
import { buildNewCodePuzzles } from "./code-puzzle-specs.mjs";

function mergeInto(file, type, built, extraCheck) {
  const targetPath = join(CONTENT, file);
  const existing = asArray(readJSON(targetPath, []), null);
  const knownIds = new Set(existing.map((x) => x?.id).filter(Boolean));
  const knownNames = new Set(existing.map((x) => x?.name).filter(Boolean));
  const { valid, rejected } = gateBatch(type, built, knownIds);
  // The seeder dedupes puzzles by NAME — enforce unique names too.
  const errors = [...rejected];
  const accepted = [];
  for (const p of valid) {
    if (knownNames.has(p.name)) { errors.push({ item: p, reason: "duplicate_name" }); continue; }
    if (extraCheck) {
      const c = extraCheck(p);
      if (!c.ok) { errors.push({ item: p, reason: c.reason }); continue; }
    }
    knownNames.add(p.name);
    accepted.push(p);
  }
  return { targetPath, existing, merged: [...existing, ...accepted], accepted, errors };
}

export function runBuildPuzzles({ write = false } = {}) {
  const hack = mergeInto("hacking-puzzles.json", "hacking", buildNewHackingPuzzles(), checkNavigable);
  const code = mergeInto("code-puzzles.json", "code", buildNewCodePuzzles(), null);

  if (write) {
    if (hack.accepted.length) writeJSON(hack.targetPath, hack.merged);
    if (code.accepted.length) writeJSON(code.targetPath, code.merged);
  }
  return {
    hacking: { added: hack.accepted.length, total: hack.merged.length, errors: hack.errors },
    code: { added: code.accepted.length, total: code.merged.length, errors: code.errors },
    write,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const write = process.argv.includes("--write");
  const r = runBuildPuzzles({ write });
  console.log(JSON.stringify({
    hacking: { added: r.hacking.added, total: r.hacking.total, errors: r.hacking.errors.map((e) => ({ id: e.item?.id, reason: e.reason })) },
    code: { added: r.code.added, total: r.code.total, errors: r.code.errors.map((e) => ({ id: e.item?.id, reason: e.reason })) },
    write,
  }, null, 2));
  if (!write) console.log("\n(dry-run — pass --write to persist; then review the git diff before committing)");
  const anyErr = r.hacking.errors.length || r.code.errors.length;
  if (anyErr) process.exit(1);
}
