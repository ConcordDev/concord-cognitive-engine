#!/usr/bin/env node
/**
 * Remove demo marketplace listings inserted by the retired seedMarketplace()
 * boot seed (server/routes/frontier-part2.js).
 *
 * Matches only rows whose title is one of the five seed titles AND whose
 * owner is the user id "system" (or a null owner with seller_id "system").
 * Real user listings are never deleted, even when they reuse a seed title.
 *
 * Dry-run by default. Pass --apply to delete.
 *
 *   node server/scripts/purge-seed-marketplace-listings.mjs
 *   node server/scripts/purge-seed-marketplace-listings.mjs --apply
 *
 * SQLite path: DB_PATH, or server/data/concord.db when that file exists.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  purgeSeededSystemListings,
  purgeSeededSystemMarketplaceRows,
  SEEDED_SYSTEM_LISTING_TITLES,
} from "../routes/frontier-part2.js";

const apply = process.argv.includes("--apply");
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDb = path.join(here, "..", "data", "concord.db");
const dbPath = process.env.DB_PATH || defaultDb;

const memory = purgeSeededSystemListings({ apply });

let sqlite = { removed: [], applied: false, skipped: "db_missing" };
if (existsSync(dbPath)) {
  const db = new Database(dbPath, { fileMustExist: true, readonly: !apply });
  try {
    sqlite = purgeSeededSystemMarketplaceRows(db, { apply });
  } finally {
    db.close();
  }
}

const report = {
  apply,
  seedTitles: [...SEEDED_SYSTEM_LISTING_TITLES],
  dbPath: existsSync(dbPath) ? dbPath : null,
  memory,
  sqlite,
};
console.log(JSON.stringify(report, null, 2));
