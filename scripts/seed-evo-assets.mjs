#!/usr/bin/env node
// scripts/seed-evo-assets.mjs
//
// Standalone CLI that runs the local-authored asset scanner WITHOUT
// booting the full server. Useful when:
//   - You've just dropped a pile of new files into content/world/_shared/
//     and want them registered before your next dev cycle.
//   - You want to verify the scan would pick up everything you expect.
//   - You're operating an air-gapped Blackwell and want to confirm
//     the on-disk registry matches your hand-curated inventory.
//
// Opens the same SQLite DB the server uses (DB_PATH env or
// server/data/concord.db) and calls bootstrapAuthoredLocal directly.
//
// USAGE
//   node scripts/seed-evo-assets.mjs                  # default dir
//   node scripts/seed-evo-assets.mjs --dir=path/to/assets
//   node scripts/seed-evo-assets.mjs --kenney=/path/to/kenney-extracted
//   node scripts/seed-evo-assets.mjs --quaternius=/path/to/quaternius-extracted

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
process.chdir(ROOT);

const args = process.argv.slice(2);
const getArg = (k) => {
  const a = args.find(x => x.startsWith(`${k}=`));
  return a ? a.split("=", 2)[1] : null;
};
const overrideDir   = getArg("--dir");
const kenneyDir     = getArg("--kenney");
const quaterniusDir = getArg("--quaternius");

// Load better-sqlite3 + the same DB the server uses.
const { default: Database } = await import("better-sqlite3");
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "server", "data", "concord.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const {
  bootstrapAuthoredLocal,
  bootstrapKenneyFromDir,
  bootstrapQuaterniusFromDir,
} = await import(path.join(ROOT, "server", "lib", "evo-asset", "source-loaders.js"));

const t0 = Date.now();
console.error(`[seed] DB=${DB_PATH}`);

// Always run local-authored scan.
const authored = await bootstrapAuthoredLocal(db, overrideDir ? { dir: overrideDir } : {});
console.error(`[authored] found=${authored.found} registered=${authored.registered} skipped=${authored.skipped} byKind=${JSON.stringify(authored.byKind || {})}`);

if (kenneyDir) {
  const k = await bootstrapKenneyFromDir(db, kenneyDir);
  console.error(`[kenney]   found=${k.found} registered=${k.registered}`);
}
if (quaterniusDir) {
  const q = await bootstrapQuaterniusFromDir(db, quaterniusDir);
  console.error(`[quaternius] found=${q.found} registered=${q.registered}`);
}

// Final tally.
const total = db.prepare(`SELECT source, kind, COUNT(*) AS n FROM evo_assets GROUP BY source, kind ORDER BY source, kind`).all();
console.error(`\n=== evo_assets totals ===`);
for (const row of total) console.error(`  ${row.source.padEnd(12)} ${row.kind.padEnd(10)} ${row.n}`);
console.error(`\nElapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
db.close();
