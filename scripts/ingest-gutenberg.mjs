#!/usr/bin/env node
/**
 * Project Gutenberg ingestion — Literary Resonance Lattice (LRL) Phase 1.
 *
 * Resumable mirror: fetches a curated Tier-1 manifest of high-resonance
 * public-domain works, strips the Gutenberg boilerplate, and feeds each through
 * server/lib/literary-ingest.js#ingestWork (structure-aware chunk → DTU mint →
 * BM25 + best-effort embedding). Idempotent: already-ingested works are skipped,
 * so re-running resumes where it stopped (or after a crash).
 *
 * Usage:
 *   node scripts/ingest-gutenberg.mjs              # ingest the full Tier-1 manifest
 *   node scripts/ingest-gutenberg.mjs --max=5      # first N works
 *   node scripts/ingest-gutenberg.mjs --db=/path/concord.db
 *   node scripts/ingest-gutenberg.mjs --self-test  # offline: ingest one bundled passage
 *
 * LIVE SERVER: do NOT run this against the database a running backend has open
 * (second writer + migrations under a live server). It refuses the default live
 * path server/data/concord.db. On a live deploy use the admin route instead:
 *   POST /api/admin/literary-ingest/gutenberg   (owner/admin; GET for progress)
 * which runs the same manifest through the same ingestWork() inside the server.
 * This script remains a dev/offline tool for a non-live database (--db=...).
 *
 * Sovereignty: reads from the public mirror only; writes locally; no telemetry.
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { runMigrations } from "../server/migrate.js";
import { ingestWork } from "../server/lib/literary-ingest.js";
import { GUTENBERG_MANIFEST as MANIFEST, fetchGutenbergText as fetchText, stripGutenbergBoilerplate as stripBoilerplate } from "../server/lib/literary-gutenberg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// better-sqlite3 lives in server/node_modules — resolve from there.
const require = createRequire(path.join(__dirname, "..", "server", "package.json"));
const Database = require("better-sqlite3");

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=")[1] : d;
};
const MAX = Number(getArg("max", Infinity));
const SELF_TEST = args.includes("--self-test");
const DB_PATH = getArg("db", process.env.DB_PATH || path.join(__dirname, "..", "server", "data", "concord.db"));

const SELF_TEST_TEXT = `
CHAPTER I. The Question

To be, or not to be, that is the question:
Whether 'tis nobler in the mind to suffer
The slings and arrows of outrageous fortune,
Or to take arms against a sea of troubles,
And by opposing end them.
${"Thus conscience does make cowards of us all, and the native hue of resolution is sicklied o'er with the pale cast of thought. ".repeat(30)}
`;

// Refuse the live database: the running backend owns it (second writer + migrations
// under a live server are not allowed). Use the admin route there instead.
const LIVE_DB = path.resolve(__dirname, "..", "server", "data", "concord.db");
function sameFile(a, b) {
  const live = (p) => path.resolve(p).split(path.sep).slice(-3).join("/") === "server/data/concord.db";
  try { return fs.realpathSync(a) === fs.realpathSync(b) || live(a); } catch { return path.resolve(a) === path.resolve(b) || live(a); }
}

async function main() {
  if (sameFile(DB_PATH, LIVE_DB)) {
    console.error(
      "[gutenberg] refusing to open the live database " + LIVE_DB + ".\n" +
      "  A running backend owns it. Use the admin route instead:\n" +
      "    POST /api/admin/literary-ingest/gutenberg   (owner/admin session; GET for progress)\n" +
      "  This script is for a non-live database: pass --db=/path/to/other.db",
    );
    process.exit(2);
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const origLog = console.log;
  console.log = () => {}; // quiet the per-migration chatter
  await runMigrations(db);
  console.log = origLog;

  if (SELF_TEST) {
    const r = await ingestWork(
      db,
      { gutenbergId: "selftest", title: "Self Test", author: "Concord", era: "test", genre: "drama", themes: ["test"], pdVerified: 1 },
      SELF_TEST_TEXT,
      { doEmbed: false },
    );
    console.log(`[self-test] ${JSON.stringify(r)}`);
    db.close();
    return;
  }

  const works = MANIFEST.slice(0, Number.isFinite(MAX) ? MAX : MANIFEST.length);
  console.log(`[gutenberg] ingesting up to ${works.length} works → ${DB_PATH}\n`);
  let ingested = 0, skipped = 0, failed = 0, chunks = 0;

  for (const w of works) {
    const sid = `gut_${w.gutenbergId}`;
    const existing = db.prepare("SELECT chunk_count FROM literary_sources WHERE id = ?").get(sid);
    if (existing && existing.chunk_count > 0) {
      console.log(`  ⤼ skip   ${w.title} (already ingested, ${existing.chunk_count} chunks)`);
      skipped += 1;
      continue;
    }
    process.stdout.write(`  … fetch  ${w.title} (PG ${w.gutenbergId}) `);
    const fetched = await fetchText(w.gutenbergId);
    if (!fetched) {
      console.log("✗ unavailable");
      failed += 1;
      continue;
    }
    const body = stripBoilerplate(fetched.text);
    const res = await ingestWork(db, { ...w, url: fetched.url, license: "public_domain", pdVerified: 1 }, body, {});
    if (res.ok && !res.skipped) {
      console.log(`✓ ${res.chunks} chunks${res.embedded ? `, ${res.embedded} embedded` : ""}`);
      ingested += 1; chunks += res.chunks;
    } else if (res.skipped) {
      console.log("⤼ already ingested"); skipped += 1;
    } else {
      console.log(`✗ ${res.error || "ingest failed"}`); failed += 1;
    }
  }

  console.log(`\n[gutenberg] done — ${ingested} ingested (${chunks} chunks), ${skipped} skipped, ${failed} failed`);
  db.close();
}

main().catch((e) => { console.error("[gutenberg] fatal:", e?.message || e); process.exit(1); });
