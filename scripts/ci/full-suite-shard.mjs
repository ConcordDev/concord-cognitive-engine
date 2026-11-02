#!/usr/bin/env node
// scripts/ci/full-suite-shard.mjs
//
// Deterministic shard selection for the full-suite workflow. Lists the server test files exactly as
// `npm run test:main` globs them ('tests/**/*.test.js' and 'tests/**/*-tests.js'), then bin-packs them across N
// shards by file size (largest first, into the currently-lightest shard; ties by name) so shards are roughly
// balanced and every file lands in exactly one shard. Same input => same output on every runner.
//
//   node scripts/ci/full-suite-shard.mjs --root server --shards 12 --index 3     # files of shard 3 (1-based)
//   node scripts/ci/full-suite-shard.mjs --root server --shards 12 --check       # prove a full, disjoint cover
//
// File size is a weak proxy for runtime (server-booting tests are slow regardless of size); it is only a
// balancer. Per-shard timing shows up in the job summary so the split can be tuned from real data.

import fs from "node:fs";
import path from "node:path";

export function listTestFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
      else if (e.name.endsWith(".test.js") || e.name.endsWith("-tests.js")) out.push(p);
    }
  };
  const testsDir = path.join(root, "tests");
  if (fs.existsSync(testsDir)) walk(testsDir);
  return out.map((p) => path.relative(root, p).split(path.sep).join("/")).sort();
}

export function assignShards(files, shards, sizeOf = () => 1) {
  const bins = Array.from({ length: shards }, () => ({ load: 0, files: [] }));
  const ordered = files
    .map((f) => ({ f, size: Math.max(1, sizeOf(f)) }))
    .sort((a, b) => b.size - a.size || (a.f < b.f ? -1 : 1));
  for (const { f, size } of ordered) {
    let best = 0;
    for (let i = 1; i < shards; i++) if (bins[i].load < bins[best].load) best = i;
    bins[best].load += size;
    bins[best].files.push(f);
  }
  return bins.map((b) => b.files.sort());
}

function parseArgs(argv) {
  const a = { root: "server", shards: 12, index: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") a.root = argv[++i];
    else if (argv[i] === "--shards") a.shards = Number(argv[++i]);
    else if (argv[i] === "--index") a.index = Number(argv[++i]);
    else if (argv[i] === "--check") a.check = true;
  }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(a.shards) || a.shards < 1) { console.error("--shards must be a positive integer"); process.exit(2); }
  const files = listTestFiles(a.root);
  const bins = assignShards(files, a.shards, (f) => { try { return fs.statSync(path.join(a.root, f)).size; } catch { return 1; } });
  if (a.check) {
    const seen = new Set();
    for (const b of bins) for (const f of b) { if (seen.has(f)) { console.error(`DUPLICATE ${f}`); process.exit(1); } seen.add(f); }
    if (seen.size !== files.length) { console.error(`COVER MISMATCH ${seen.size} != ${files.length}`); process.exit(1); }
    console.log(`ok: ${files.length} files across ${a.shards} shards (${bins.map((b) => b.length).join("/")})`);
  } else {
    if (!Number.isInteger(a.index) || a.index < 1 || a.index > a.shards) { console.error("--index must be 1..shards"); process.exit(2); }
    if (bins[a.index - 1].length === 0) { console.error("empty shard"); process.exit(3); }
    process.stdout.write(bins[a.index - 1].join("\n") + "\n");
  }
}
