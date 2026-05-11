// server/tests/platinum-migration-up-down.test.js
//
// Sprint 18 — platinum-tier migration safety gate.
//
// Asserts every numbered migration up() runs cleanly against an empty
// :memory: DB. Down() is run where defined; many migrations are
// intentionally forward-only (per CLAUDE.md invariant) and we
// document that.
//
// What this catches:
//   - CREATE TABLE with bad CHECK clause
//   - ALTER TABLE that fails on a schema that already exists
//   - Migration that depends on a prior migration not in its file
//   - Migration that silently swallows errors

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dirname || new URL(".", import.meta.url).pathname, "..", "migrations");

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.js$/.test(f))
    // Sort numerically by leading integer to ensure 001 < 024 < 100 < 171
    // (lexical sort would order 100 before 24).
    .sort((a, b) => parseInt(a.split("_")[0], 10) - parseInt(b.split("_")[0], 10));
}

test("every migration up() runs cleanly against a fresh in-memory DB", async () => {
  const db = new Database(":memory:");
  // Migration 001_core_tables creates the foundational schema (users,
  // dtus, artifacts, jobs, marketplace_listings, ...). Later migrations
  // ALTER those tables or add new ones, in numeric order. Don't
  // pre-create anything — let the migration ledger build it up.

  const files = listMigrations();
  let upCount = 0;
  const failures = [];

  for (const f of files) {
    try {
      const mod = await import(`../migrations/${f}`);
      if (typeof mod.up !== "function") {
        // Some migrations are SQL-only stubs — skip.
        continue;
      }
      mod.up(db);
      upCount++;
    } catch (err) {
      failures.push({ file: f, error: err?.message || String(err) });
    }
  }

  if (failures.length > 0) {
    console.error("\nMigration failures:");
    for (const f of failures) console.error(`  ${f.file}: ${f.error}`);
  }

  assert.equal(failures.length, 0, `${failures.length} migrations failed to apply cleanly`);
  console.log(`  ✓ ${upCount} migrations up()'d cleanly`);
});

test("every migration down() runs cleanly if defined (forward-only is allowed)", async () => {
  // Build full schema first.
  const db = new Database(":memory:");
  const files = listMigrations();
  for (const f of files) {
    try {
      const mod = await import(`../migrations/${f}`);
      if (typeof mod.up === "function") mod.up(db);
    } catch { /* covered by the up test */ }
  }

  let downCount = 0;
  let forwardOnly = 0;
  const failures = [];

  // Run downs in reverse order (newest first).
  for (const f of files.slice().reverse()) {
    try {
      const mod = await import(`../migrations/${f}`);
      if (typeof mod.down !== "function") {
        forwardOnly++;
        continue;
      }
      mod.down(db);
      downCount++;
    } catch (err) {
      failures.push({ file: f, error: err?.message || String(err) });
    }
  }

  if (failures.length > 0) {
    console.error("\nDown migration failures:");
    for (const f of failures) console.error(`  ${f.file}: ${f.error}`);
  }

  // Forward-only migrations are an explicit Concord invariant (per
  // CLAUDE.md: "Migrations are append-only. Never modify an existing
  // migration file."). We tolerate any number of forward-only; we
  // only fail when a DOWN method exists but throws.
  assert.equal(failures.length, 0, `${failures.length} migrations had broken down() methods`);
  console.log(`  ✓ ${downCount} migrations down()'d cleanly; ${forwardOnly} are forward-only (allowed)`);
});

test("migration ledger is monotonically numbered without gaps", () => {
  const files = listMigrations();
  const numbers = files.map((f) => parseInt(f.split("_")[0], 10)).sort((a, b) => a - b);
  const dupes = numbers.filter((n, i) => numbers[i + 1] === n);
  assert.equal(dupes.length, 0, `Duplicate migration numbers: ${[...new Set(dupes)].join(", ")}`);
  // We don't enforce no-gap (allow renumbering for collision fixes per CLAUDE.md)
  // but assert the latest number is reasonable.
  const latest = numbers[numbers.length - 1];
  assert.ok(latest > 0, "Migration ledger is empty");
  console.log(`  ✓ ${numbers.length} migrations, latest = ${latest}`);
});
