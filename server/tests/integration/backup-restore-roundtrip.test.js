/**
 * Backup → restore round-trip integration test.
 *
 * Exercises the actual scripts/backup.sh and scripts/restore.sh against a
 * temp file DB. Asserts that:
 *   - backup.sh produces a compressed snapshot
 *   - restore.sh writes back a DB whose row counts match the original
 *   - PRAGMA integrity_check returns "ok"
 *
 * Why it matters: DEPLOYMENT.md flagged this as untested. A backup that
 * doesn't round-trip is no backup. This is the cheapest end-to-end gate
 * that catches regressions in either script (compression flags, integrity
 * check thresholds, env-var name drift).
 *
 * Run: node --test tests/integration/backup-restore-roundtrip.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dir, "../../scripts");

let WORK_DIR;
let DATA_DIR;
let DB_PATH;
let BACKUP_DIR;

before(() => {
  WORK_DIR   = mkdtempSync(path.join(tmpdir(), "concord-backup-test-"));
  DATA_DIR   = path.join(WORK_DIR, "data");
  DB_PATH    = path.join(DATA_DIR, "db", "concord.db");
  BACKUP_DIR = path.join(DATA_DIR, "backups");
});

after(() => {
  try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch (_) { /* intentional */ }
});

function runScript(scriptName, extraArgs = "") {
  const env = {
    ...process.env,
    DATA_DIR,
    DB_PATH,
  };
  return execSync(
    `bash ${path.join(SCRIPTS_DIR, scriptName)} ${extraArgs}`.trim(),
    { env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function seedDb() {
  // Build a minimal DB with two tables and a known row count so we can
  // verify the restore preserves data. PRAGMA integrity_check happens
  // inside the scripts.
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_ledger (
      id TEXT PRIMARY KEY, type TEXT, amount REAL, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, title TEXT, created_at TEXT
    );
  `);
  const insLedger = db.prepare(`INSERT INTO economy_ledger (id, type, amount, created_at) VALUES (?, ?, ?, ?)`);
  const insDtu    = db.prepare(`INSERT INTO dtus (id, title, created_at) VALUES (?, ?, ?)`);
  for (let i = 0; i < 5; i++) {
    insLedger.run(`ledger_${i}`, "TEST_TX", i * 10, new Date().toISOString());
  }
  for (let i = 0; i < 3; i++) {
    insDtu.run(`dtu_${i}`, `Test DTU ${i}`, new Date().toISOString());
  }
  db.close();
}

function rowCount(table) {
  const db = new Database(DB_PATH);
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
  finally { db.close(); }
}

describe("backup.sh → restore.sh round-trip", () => {
  it("backup produces a compressed snapshot in BACKUP_DIR", () => {
    // Set up: ensure DB dir exists, seed it.
    execSync(`mkdir -p "${path.dirname(DB_PATH)}"`);
    seedDb();
    assert.equal(rowCount("economy_ledger"), 5);
    assert.equal(rowCount("dtus"), 3);

    // Run backup
    const out = runScript("backup.sh");
    assert.ok(out.includes("[Backup] Done"), `backup output should report Done: ${out}`);

    // Verify compressed file exists
    const backups = readdirSync(BACKUP_DIR).filter(f => f.endsWith(".db.gz"));
    assert.ok(backups.length >= 1, `expected ≥1 .db.gz in ${BACKUP_DIR}, got ${backups}`);
  });

  it("restore from latest backup produces a DB whose row counts match the original", () => {
    // Drop the live DB (simulating data loss)
    execSync(`rm -f "${DB_PATH}" "${DB_PATH}.pre-restore"`);
    assert.ok(!existsSync(DB_PATH));

    // Restore latest
    const out = runScript("restore.sh");
    assert.ok(out.includes("[Restore] Done"), `restore output should report Done: ${out}`);
    assert.ok(existsSync(DB_PATH), "restored DB file must exist at DB_PATH");

    // Row counts match
    assert.equal(rowCount("economy_ledger"), 5);
    assert.equal(rowCount("dtus"), 3);
  });

  it("restored DB passes PRAGMA integrity_check", () => {
    const db = new Database(DB_PATH);
    try {
      const result = db.prepare(`PRAGMA integrity_check`).get();
      assert.equal(result.integrity_check, "ok");
    } finally {
      db.close();
    }
  });

  it("restore moves the current DB to .pre-restore (rollback safety)", () => {
    // Build a fresh DB shape so we don't collide with PKs from prior tests.
    const db = new Database(DB_PATH);
    db.exec(`DROP TABLE IF EXISTS economy_ledger`);
    db.exec(`CREATE TABLE economy_ledger (id TEXT PRIMARY KEY, type TEXT, amount REAL, created_at TEXT)`);
    db.prepare(`INSERT INTO economy_ledger (id, type, amount, created_at) VALUES (?, ?, ?, ?)`).run("post_x", "X", 999, new Date().toISOString());
    db.close();

    // Sleep so the backup timestamp (1-second granularity) doesn't collide
    // with the prior test's backup file. Without this, gzip refuses to
    // overwrite and the script exits non-zero.
    execSync("sleep 1.1");
    runScript("backup.sh");

    // Mutate: write garbage so we can confirm restore rolls it back
    const db2 = new Database(DB_PATH);
    db2.prepare(`INSERT INTO economy_ledger (id, type, amount, created_at) VALUES (?, ?, ?, ?)`).run("garbage_1", "G", 0, new Date().toISOString());
    db2.close();

    runScript("restore.sh");

    // .pre-restore artifact should now exist (the live DB existed when
    // restore overwrote it, so restore moved it aside for rollback).
    assert.ok(
      existsSync(`${DB_PATH}.pre-restore`),
      "restore must move the live DB to .pre-restore for rollback",
    );
  });
});
