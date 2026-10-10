// server/tests/backup-retention.test.js
//
// Prod 2026-10-10 19:42:50Z: runBackup logged backup_db_captured (8.9GB,
// sqlite online backup) and backup_complete for
// server/data/backups/2026-10-10, and seconds later that directory did not
// exist. The only thing left was a JSON state backup,
// backup-2026-09-30T05-23-44-388Z.json.
//
// _BACKUP_RETENTION_DAYS is 1. The cleanup did
// readdirSync(BACKUP_DIR).sort() and rm -rf'd names until one remained.
// BACKUP_DIR is shared with createBackup's backup-*.json / auto-*.json
// files. Digits sort before letters, so the YYYY-MM-DD directory just
// written is the oldest name whenever any JSON backup exists, and retention
// deletes it. The status endpoint looked for top-level
// concord-YYYYMMDD_HHMMSS.db(.gz), which runBackup never writes
// (it writes <date>/concord.db.gz), so it could not report the snapshot
// even when retention left it alone.
//
// Run: node --test server/tests/backup-retention.test.js

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../lib/detectors/command-injection-detector.js";
import {
  pruneDatedDbBackups,
  pruneJsonStateBackups,
  summarizeDatedDbBackups,
} from "../lib/backup-retention.js";

const tmpDirs = [];

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-retention-"));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function writeGz(dir, date, contents) {
  const day = path.join(dir, date);
  fs.mkdirSync(day, { recursive: true });
  const gz = path.join(day, "concord.db.gz");
  fs.writeFileSync(gz, contents);
  fs.writeFileSync(path.join(day, "state.json"), "{}");
  return gz;
}

/** The retention loop runBackup used to run, copied so the fixture is proven to self-delete. */
function legacyMixedRetention(dir, retentionDays) {
  const backups = fs.readdirSync(dir).sort();
  while (backups.length > retentionDays) {
    const oldest = backups.shift();
    fs.rmSync(path.join(dir, oldest), { recursive: true, force: true });
  }
}

describe("dated DB retention does not delete the backup it just wrote", () => {
  it("a stray JSON backup plus a new dated dir used to rm -rf the dated backup", () => {
    const legacy = makeDir();
    const fixed = makeDir();
    const jsonName = "backup-2026-09-30T05-23-44-388Z.json";
    for (const dir of [legacy, fixed]) {
      writeGz(dir, "2026-10-10", "db-bytes");
      fs.writeFileSync(path.join(dir, jsonName), "{}");
    }

    // Digits sort before letters, so the directory just written is first
    // and retention 1 shifts it off.
    assert.deepEqual(fs.readdirSync(legacy).sort(), ["2026-10-10", jsonName]);

    legacyMixedRetention(legacy, 1);
    assert.equal(fs.existsSync(path.join(legacy, "2026-10-10")), false);
    assert.equal(fs.existsSync(path.join(legacy, jsonName)), true);

    pruneDatedDbBackups(fixed, { retentionDays: 1, protectName: "2026-10-10" });
    assert.equal(fs.readFileSync(path.join(fixed, "2026-10-10", "concord.db.gz"), "utf8"), "db-bytes");
    assert.equal(fs.existsSync(path.join(fixed, "2026-10-10", "state.json")), true);
    assert.equal(fs.readFileSync(path.join(fixed, jsonName), "utf8"), "{}");
  });

  it("still drops dated directories past the retention window", () => {
    const dir = makeDir();
    writeGz(dir, "2026-10-08", "drop-a");
    writeGz(dir, "2026-10-09", "drop-b");
    writeGz(dir, "2026-10-10", "keep");
    fs.writeFileSync(path.join(dir, "auto-100.json"), "{}");
    fs.writeFileSync(path.join(dir, "backup-2026-09-30T05-23-44-388Z.json"), "{}");

    const result = pruneDatedDbBackups(dir, { retentionDays: 1, protectName: "2026-10-10" });
    assert.deepEqual(result.deleted, ["2026-10-08", "2026-10-09"]);
    assert.equal(fs.readFileSync(path.join(dir, "2026-10-10", "concord.db.gz"), "utf8"), "keep");
    assert.equal(fs.existsSync(path.join(dir, "auto-100.json")), true);
    assert.equal(fs.existsSync(path.join(dir, "backup-2026-09-30T05-23-44-388Z.json")), true);
  });

  it("does not delete the directory this run just wrote when a later date name also exists", () => {
    const dir = makeDir();
    writeGz(dir, "2026-10-10", "just-wrote");
    writeGz(dir, "2026-10-11", "later-name");
    fs.writeFileSync(path.join(dir, "backup-old.json"), "{}");

    pruneDatedDbBackups(dir, { retentionDays: 1, protectName: "2026-10-10" });
    assert.equal(fs.readFileSync(path.join(dir, "2026-10-10", "concord.db.gz"), "utf8"), "just-wrote");
    assert.equal(fs.readFileSync(path.join(dir, "2026-10-11", "concord.db.gz"), "utf8"), "later-name");
    assert.equal(fs.existsSync(path.join(dir, "backup-old.json")), true);
  });

  it("leaves flat files and non-date names in the shared folder", () => {
    const dir = makeDir();
    writeGz(dir, "2026-10-09", "old");
    writeGz(dir, "2026-10-10", "new");
    fs.writeFileSync(path.join(dir, "concord-20261010_194250.db.gz"), "flat");
    fs.writeFileSync(path.join(dir, "notes.txt"), "n");

    pruneDatedDbBackups(dir, { retentionDays: 1, protectName: "2026-10-10" });
    assert.equal(fs.existsSync(path.join(dir, "2026-10-09")), false);
    assert.equal(fs.readFileSync(path.join(dir, "concord-20261010_194250.db.gz"), "utf8"), "flat");
    assert.equal(fs.readFileSync(path.join(dir, "notes.txt"), "utf8"), "n");
  });

  it("is a no-op when the backup directory does not exist", () => {
    const missing = path.join(os.tmpdir(), `backup-retention-missing-${process.pid}`);
    assert.deepEqual(
      pruneDatedDbBackups(missing, { retentionDays: 1, protectName: "2026-10-10" }),
      { deleted: [], kept: [] },
    );
    assert.deepEqual(pruneJsonStateBackups(missing, 3), { deleted: [] });
  });
});

describe("JSON state rotation does not touch dated DB directories", () => {
  it("deletes only excess .json files and leaves <date>/concord.db.gz in place", () => {
    const dir = makeDir();
    writeGz(dir, "2026-10-10", "db");
    fs.mkdirSync(path.join(dir, "backup-not-a-file.json"));
    fs.writeFileSync(path.join(dir, "backup-not-a-file.json", "inner.txt"), "x");
    for (const name of ["auto-1.json", "auto-2.json", "backup-a.json", "backup-b.json"]) {
      fs.writeFileSync(path.join(dir, name), name);
    }

    const result = pruneJsonStateBackups(dir, 2);
    // Lexical order, same as the previous rotation: auto-* sorts before backup-*.
    assert.deepEqual(result.deleted, ["auto-1.json", "auto-2.json"]);
    assert.equal(fs.existsSync(path.join(dir, "backup-a.json")), true);
    assert.equal(fs.existsSync(path.join(dir, "backup-b.json")), true);
    assert.equal(fs.readFileSync(path.join(dir, "2026-10-10", "concord.db.gz"), "utf8"), "db");
    assert.equal(fs.readFileSync(path.join(dir, "2026-10-10", "state.json"), "utf8"), "{}");
    assert.equal(fs.readFileSync(path.join(dir, "backup-not-a-file.json", "inner.txt"), "utf8"), "x");
  });
});

describe("GET /api/admin/backup/status sees <date>/concord.db.gz", () => {
  it("reports age and size of the real gzip and ignores flat concord-timestamp names", async () => {
    const dir = makeDir();
    const now = Date.parse("2026-10-10T19:42:50.000Z");
    const recent = writeGz(dir, "2026-10-10", "x".repeat(100));
    const older = writeGz(dir, "2026-10-09", "y".repeat(40));
    const recentWhen = new Date(now - 2 * 3600 * 1000);
    const olderWhen = new Date(now - 30 * 3600 * 1000);
    fs.utimesSync(recent, recentWhen, recentWhen);
    fs.utimesSync(older, olderWhen, olderWhen);
    fs.writeFileSync(path.join(dir, "backup-2026-09-30T05-23-44-388Z.json"), "{}");
    fs.writeFileSync(path.join(dir, "concord-20261010_194250.db.gz"), "not-the-real-backup");
    fs.mkdirSync(path.join(dir, "2026-10-08"));
    fs.writeFileSync(path.join(dir, "2026-10-08", "state.json"), "{}");

    const summary = await summarizeDatedDbBackups(dir, now);
    assert.equal(summary.totalBackups, 2);
    assert.equal(summary.lastBackup, "2026-10-10");
    assert.equal(summary.hoursSinceLastBackup, 2);
    assert.equal(summary.healthy, true);
    assert.deepEqual(summary.backups.map((b) => ({ filename: b.filename, size: b.size, date: b.date })), [
      { filename: "2026-10-10/concord.db.gz", size: 100, date: "2026-10-10" },
      { filename: "2026-10-09/concord.db.gz", size: 40, date: "2026-10-09" },
    ]);
    assert.equal(typeof summary.backups[0].mtime, "string");
  });

  it("a snapshot older than 26h is not healthy", async () => {
    const dir = makeDir();
    const now = Date.now();
    const gz = writeGz(dir, "2026-10-08", "stale");
    const when = new Date(now - 48 * 3600 * 1000);
    fs.utimesSync(gz, when, when);

    const summary = await summarizeDatedDbBackups(dir, now);
    assert.equal(summary.healthy, false);
    assert.equal(summary.hoursSinceLastBackup, 48);
    assert.equal(summary.lastBackup, "2026-10-08");
    assert.equal(summary.backups[0].size, "stale".length);
  });

  it("a missing backup directory is an empty unhealthy status", async () => {
    const summary = await summarizeDatedDbBackups(path.join(os.tmpdir(), `backup-retention-absent-${process.pid}`));
    assert.equal(summary.totalBackups, 0);
    assert.equal(summary.lastBackup, null);
    assert.equal(summary.healthy, false);
    assert.equal(summary.hoursSinceLastBackup, Infinity);
    assert.deepEqual(summary.backups, []);
  });
});

describe("server.js wires the shared-folder retention", () => {
  const RAW = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js"),
    "utf8",
  );
  const fnBody = (needle, endMarker) => {
    const start = RAW.indexOf(needle);
    assert.ok(start > 0, `${needle} not found`);
    const endAt = RAW.indexOf(endMarker, start);
    return stripComments(RAW.slice(start, endAt > start ? endAt : start + 8000));
  };

  it("runBackup prunes only via pruneDatedDbBackups and protects the directory it just wrote", () => {
    const body = fnBody("async function runBackup()", "backup_complete");
    assert.match(body, /pruneDatedDbBackups\(BACKUP_DIR,\s*\{/);
    assert.match(body, /retentionDays:\s*_BACKUP_RETENTION_DAYS/);
    assert.match(body, /protectName:\s*timestamp/);
    assert.doesNotMatch(body, /readdirSync\(BACKUP_DIR\)\.sort\(\)/);
    assert.doesNotMatch(body, /fs\.rmSync\(oldPath/);
  });

  it("createBackup rotates JSON files and does not list the shared directory itself", () => {
    const body = fnBody("async function createBackup(", "backup_created");
    assert.match(body, /const MAX_STATE_BACKUPS = _stateBackupRetentionCount\(\)/);
    assert.match(body, /pruneJsonStateBackups\(BACKUP_DIR,\s*MAX_STATE_BACKUPS\)/);
    assert.doesNotMatch(body, /readdirSync\(BACKUP_DIR\)/);
    assert.doesNotMatch(body, /rmSync\(/);
  });

  it("backup status summarizes dated concord.db.gz snapshots from BACKUP_DIR", () => {
    const body = fnBody('app.get("/api/admin/backup/status"', 'app.get("/api/admin/logs"');
    assert.match(body, /await summarizeDatedDbBackups\(BACKUP_DIR\)/);
    assert.doesNotMatch(body, /concord-\(\\d\{8\}_\\d\{6\}\)/);
    assert.doesNotMatch(body, /path\.join\(DATA_DIR,\s*['"]backups['"]\)/);
  });
});
