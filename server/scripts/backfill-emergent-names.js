#!/usr/bin/env node
// server/scripts/backfill-emergent-names.js
// Name all unnamed emergents. Safe to re-run — skips already-named emergents.
//
// Usage: node server/scripts/backfill-emergent-names.js

import Database from "better-sqlite3";
import { nameEmergent, persistEmergentName } from "../emergent/naming.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DB_PATH = process.env.DATABASE_PATH || resolve(fileURLToPath(import.meta.url), "../../data/concord.db");

async function sleep(ms) {
  return new Promise(r => { setTimeout(r, ms); });
}

async function main() {
  let db;
  try {
    db = new Database(DB_PATH);
  } catch (e) {
    console.error("Cannot open database:", e.message);
    process.exit(1);
  }

  // Ensure table exists (migration may not have run in all environments)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS emergent_identity (
      emergent_id TEXT PRIMARY KEY,
      given_name TEXT,
      naming_origin TEXT,
      naming_metadata TEXT,
      current_focus TEXT,
      last_active_at INTEGER,
      identity_locked INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  // Find all emergents with no given_name (or not in identity table)
  // In this system, emergents are in-memory — we can only backfill those
  // that have an entry in emergent_identity with null given_name,
  // or read from the emergent state file if it exists.
  const unnamed = db.prepare(
    "SELECT emergent_id FROM emergent_identity WHERE given_name IS NULL"
  ).all();

  console.log(`Found ${unnamed.length} unnamed emergents in identity table.`);

  for (const { emergent_id } of unnamed) {
    try {
      const { name, method } = await nameEmergent({ id: emergent_id }, db);
      persistEmergentName(emergent_id, name, method, db);
      console.log(`  Named ${emergent_id} → ${name} (${method})`);
      await sleep(500); // rate-limit inference calls
    } catch (e) {
      console.warn(`  Failed to name ${emergent_id}: ${e.message}`);
    }
  }

  console.log("Backfill complete.");
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
