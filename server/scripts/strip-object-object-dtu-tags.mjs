#!/usr/bin/env node
/**
 * List DTUs whose tags include the "[object object]" coercion string
 * (any letter case). Dry-run by default. `--apply` removes only that tag
 * and leaves every other tag and column untouched.
 *
 *   node server/scripts/strip-object-object-dtu-tags.mjs <sqlite-path>
 *   node server/scripts/strip-object-object-dtu-tags.mjs <sqlite-path> --apply
 *
 * Refuses a missing file so a typo cannot create an empty database.
 * This script does not run unless it is invoked.
 */
import { existsSync } from "node:fs";
import { stripObjectObjectTags } from "../lib/strip-object-object-dtu-tags.js";

const apply = process.argv.includes("--apply");
const dbPath = process.argv.slice(2).find((a) => a !== "--apply");
if (!dbPath) {
  console.error("usage: node server/scripts/strip-object-object-dtu-tags.mjs <sqlite-path> [--apply]");
  process.exit(2);
}
if (!existsSync(dbPath)) {
  console.error(`database not found: ${dbPath}`);
  process.exit(2);
}

const { default: Database } = await import("better-sqlite3");
const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
try {
  const result = stripObjectObjectTags(db, { apply });
  const mode = result.dryRun ? "dry-run (no writes)" : "applied";
  console.log(`[object object] tag: ${result.count} DTU(s), ${mode}`);
  for (const d of result.dtus) {
    console.log(`- ${d.table} ${d.id}${d.title ? `\t${d.title}` : ""}`);
  }
  console.log(JSON.stringify({ dryRun: result.dryRun, count: result.count, applied: result.applied }));
} finally {
  db.close();
}
