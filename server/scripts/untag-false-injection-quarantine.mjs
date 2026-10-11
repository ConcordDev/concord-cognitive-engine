#!/usr/bin/env node
/**
 * Remove false `quarantine:injection-review` tags left by the threat-level
 * case bug (scanner returns "none", the gate compared to "NONE").
 *
 * Dry-run by default. Prints how many DTUs would lose the tag and writes
 * nothing. `--apply` rewrites dtu_store and requires CONCORD_ADMIN_CONFIRM=1.
 * Idempotent. Do not run against production without owner approval.
 *
 *   node server/scripts/untag-false-injection-quarantine.mjs
 *   CONCORD_ADMIN_CONFIRM=1 node server/scripts/untag-false-injection-quarantine.mjs --apply
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyInjectionUntag } from "../lib/dtu-injection-untag.js";

const apply = process.argv.includes("--apply");
if (apply && process.env.CONCORD_ADMIN_CONFIRM !== "1") {
  console.error("Refusing --apply without CONCORD_ADMIN_CONFIRM=1 (admin-only). Dry-run is the default.");
  process.exit(2);
}

const { default: Database } = await import("better-sqlite3");

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(here, "..", "data", "concord.db");
const db = new Database(dbPath);
try {
  const result = applyInjectionUntag(db, { apply });
  console.log(JSON.stringify({
    dryRun: result.dryRun,
    remove: result.remove.length,
    keep: result.keep.length,
    applied: result.applied,
    dbPath,
  }));
} finally {
  db.close();
}
