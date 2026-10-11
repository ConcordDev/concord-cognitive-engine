// Prod: every boot rewrote server/data/backups/<date>/concord.db.gz in place.
// createWriteStream truncated the previous good gzip at the start of a ~7
// minute write, so a crash left a corrupt backup and a deploy restart always
// copied the full live DB. These tests pin the replacement:
//   temp + fsync + gzip test + rename, N dated copies only after verify,
//   boot skip inside the interval, low-disk skip on the admin status payload.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { stripComments } from "../lib/detectors/command-injection-detector.js";
import { pruneJsonStateBackups, summarizeDatedDbBackups } from "../lib/backup-retention.js";
import {
  applyDbBackupRetention,
  assessDbBackupDisk,
  cleanStaleDbBackupTemps,
  dbBackupKeepCount,
  dbBackupStartupIntervalMs,
  diskBudgetForDbBackup,
  evaluateStartupBackup,
  finalizeVerifiedGzip,
  publishConsistentGzip,
  recordDbBackupRunStatus,
} from "../lib/db-snapshot-backup.js";

const tmpDirs = [];

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-snapshot-backup-"));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function writeRealGz(dir, date, payload, mtime) {
  const day = path.join(dir, date);
  fs.mkdirSync(day, { recursive: true });
  const gz = path.join(day, "concord.db.gz");
  fs.writeFileSync(gz, zlib.gzipSync(Buffer.from(payload)));
  if (mtime) fs.utimesSync(gz, mtime, mtime);
  return gz;
}

describe("interrupted write leaves the previous backup intact", () => {
  it("a crash after the temp is written and before rename does not touch concord.db.gz", async () => {
    const dir = makeDir();
    const day = path.join(dir, "2026-10-11");
    fs.mkdirSync(day);
    const finalPath = path.join(day, "concord.db.gz");
    const previous = zlib.gzipSync(Buffer.from("previous-good-backup"));
    fs.writeFileSync(finalPath, previous);
    fs.writeFileSync(path.join(day, "state.json"), "{}");

    const source = path.join(dir, "snap.db");
    fs.writeFileSync(source, Buffer.from("new-snapshot-bytes"));
    const tmpPath = path.join(day, "concord.db.gz.tmp-424242");

    await assert.rejects(
      () => publishConsistentGzip({
        sourcePath: source,
        finalPath,
        tmpPath,
        beforeRename: () => { throw new Error("killed mid-publish"); },
      }),
      /killed mid-publish/,
    );

    assert.deepEqual(fs.readFileSync(finalPath), previous);
    assert.equal(fs.existsSync(tmpPath), true);
    assert.equal(fs.readFileSync(path.join(day, "state.json"), "utf8"), "{}");

    const partial = path.join(day, "concord.db.gz.tmp-99999999");
    fs.writeFileSync(partial, Buffer.from([0x1f, 0x8b, 0x08]));
    assert.deepEqual(fs.readFileSync(finalPath), previous);

    const cleaned = await cleanStaleDbBackupTemps(dir, { pidAlive: () => false });
    assert.ok(cleaned.deleted.some((name) => name.includes("concord.db.gz.tmp-99999999")));
    assert.ok(cleaned.deleted.some((name) => name.includes("concord.db.gz.tmp-424242")));
    assert.equal(fs.existsSync(partial), false);
    assert.equal(fs.existsSync(tmpPath), false);
    assert.deepEqual(fs.readFileSync(finalPath), previous);
  });

  it("a failed gzip verify deletes the temp and leaves the previous backup", async () => {
    const dir = makeDir();
    const day = path.join(dir, "2026-10-11");
    fs.mkdirSync(day);
    const finalPath = path.join(day, "concord.db.gz");
    const previous = zlib.gzipSync(Buffer.from("still-good"));
    fs.writeFileSync(finalPath, previous);
    const bad = path.join(day, "concord.db.gz.tmp-111");
    fs.writeFileSync(bad, Buffer.from("not-a-gzip-and-not-empty"));

    await assert.rejects(() => finalizeVerifiedGzip(bad, finalPath), /backup gzip verify failed/);
    assert.deepEqual(fs.readFileSync(finalPath), previous);
    assert.equal(fs.existsSync(bad), false);
  });

  it("a verified publish then replaces the previous bytes and stamps the gzip", async () => {
    const dir = makeDir();
    const day = path.join(dir, "2026-10-11");
    fs.mkdirSync(day);
    const finalPath = path.join(day, "concord.db.gz");
    fs.writeFileSync(finalPath, zlib.gzipSync(Buffer.from("previous-good-backup")));
    const source = path.join(dir, "snap.db");
    fs.writeFileSync(source, Buffer.from("new-snapshot-bytes"));
    const tmpPath = path.join(day, `concord.db.gz.tmp-${process.pid}`);

    await publishConsistentGzip({ sourcePath: source, finalPath, tmpPath });

    assert.equal(zlib.gunzipSync(fs.readFileSync(finalPath)).toString(), "new-snapshot-bytes");
    assert.equal(fs.existsSync(tmpPath), false);
    const stamp = JSON.parse(fs.readFileSync(`${finalPath}.verified`, "utf8"));
    assert.equal(stamp.ok, true);
    assert.equal(stamp.size, fs.statSync(finalPath).size);
  });
});

describe("retention keeps N dated copies and waits for a verified publish", () => {
  it("does not delete the oldest until the new backup is verified, and never touches JSON or backups-legacy", () => {
    const dir = makeDir();
    for (const [date, body] of [["2026-10-08", "a"], ["2026-10-09", "b"], ["2026-10-10", "c"]]) {
      const day = path.join(dir, date);
      fs.mkdirSync(day);
      fs.writeFileSync(path.join(day, "concord.db.gz"), body);
      fs.writeFileSync(path.join(day, "state.json"), "{}");
    }
    fs.writeFileSync(path.join(dir, "backup-2026-09-30T05-23-44-388Z.json"), "{}");
    fs.writeFileSync(path.join(dir, "auto-1.json"), "{}");
    fs.mkdirSync(path.join(dir, "backups-legacy"));
    fs.writeFileSync(path.join(dir, "backups-legacy", "concord.db.gz"), "legacy");
    fs.writeFileSync(path.join(dir, "backups-legacy", "concord.db.gz.tmp-1"), "legacy-tmp");

    const held = applyDbBackupRetention(dir, { keep: 2, protectName: "2026-10-10", verified: false });
    assert.equal(held.skipped, "not_verified");
    assert.deepEqual(held.deleted, []);
    assert.equal(fs.readFileSync(path.join(dir, "2026-10-08", "concord.db.gz"), "utf8"), "a");

    const pruned = applyDbBackupRetention(dir, { keep: 2, protectName: "2026-10-10", verified: true });
    assert.equal(pruned.skipped, null);
    assert.deepEqual(pruned.deleted, ["2026-10-08"]);
    assert.equal(fs.existsSync(path.join(dir, "2026-10-08")), false);
    assert.equal(fs.readFileSync(path.join(dir, "2026-10-09", "concord.db.gz"), "utf8"), "b");
    assert.equal(fs.readFileSync(path.join(dir, "2026-10-10", "concord.db.gz"), "utf8"), "c");
    assert.equal(fs.readFileSync(path.join(dir, "2026-10-10", "state.json"), "utf8"), "{}");
    assert.equal(fs.readFileSync(path.join(dir, "backup-2026-09-30T05-23-44-388Z.json"), "utf8"), "{}");
    assert.equal(fs.readFileSync(path.join(dir, "backups-legacy", "concord.db.gz"), "utf8"), "legacy");
    assert.equal(fs.readFileSync(path.join(dir, "backups-legacy", "concord.db.gz.tmp-1"), "utf8"), "legacy-tmp");
  });

  it("defaults to keeping 2 dated copies and honors CONCORD_DB_BACKUP_KEEP", () => {
    assert.equal(dbBackupKeepCount({}), 2);
    assert.equal(dbBackupKeepCount({ CONCORD_DB_BACKUP_KEEP: "4" }), 4);
    assert.equal(dbBackupKeepCount({ CONCORD_DB_BACKUP_KEEP: "0" }), 2);
    assert.equal(dbBackupKeepCount({ CONCORD_DB_BACKUP_KEEP: "" }), 2);
  });

  it("startup cleanup removes dead-pid temps only, including inside a date dir", async () => {
    const dir = makeDir();
    const day = path.join(dir, "2026-10-11");
    fs.mkdirSync(day);
    const good = zlib.gzipSync(Buffer.from("keep"));
    fs.writeFileSync(path.join(day, "concord.db.gz"), good);
    fs.writeFileSync(path.join(day, "state.json"), "{}");
    fs.writeFileSync(path.join(day, "concord.db.gz.tmp-7"), "live");
    fs.writeFileSync(path.join(day, "concord.db.gz.tmp-8"), "dead");
    fs.writeFileSync(path.join(dir, "backup-keep.json"), "{}");
    fs.mkdirSync(path.join(dir, "backups-legacy"));
    fs.writeFileSync(path.join(dir, "backups-legacy", "concord.db.gz.tmp-8"), "do-not-touch");

    const cleaned = await cleanStaleDbBackupTemps(dir, { pidAlive: (pid) => pid === 7 });
    assert.deepEqual(cleaned.deleted, ["2026-10-11/concord.db.gz.tmp-8"]);
    assert.equal(fs.readFileSync(path.join(day, "concord.db.gz.tmp-7"), "utf8"), "live");
    assert.equal(fs.existsSync(path.join(day, "concord.db.gz.tmp-8")), false);
    assert.deepEqual(fs.readFileSync(path.join(day, "concord.db.gz")), good);
    assert.equal(fs.readFileSync(path.join(day, "state.json"), "utf8"), "{}");
    assert.equal(fs.readFileSync(path.join(dir, "backup-keep.json"), "utf8"), "{}");
    assert.equal(fs.readFileSync(path.join(dir, "backups-legacy", "concord.db.gz.tmp-8"), "utf8"), "do-not-touch");

    pruneJsonStateBackups(dir, 5);
    assert.equal(fs.readFileSync(path.join(dir, "backup-keep.json"), "utf8"), "{}");
  });
});

describe("startup within the interval skips", () => {
  it("skips when the newest verified backup is younger than the interval", async () => {
    const dir = makeDir();
    const now = Date.parse("2026-10-11T22:34:00.000Z");
    const gz = writeRealGz(dir, "2026-10-11", "fresh-db", new Date(now - 60 * 60 * 1000));
    const decision = await evaluateStartupBackup(dir, { now, intervalMs: 6 * 60 * 60 * 1000 });
    assert.equal(decision.skip, true);
    assert.equal(decision.reason, "fresh_verified_backup");
    assert.equal(decision.filename, "2026-10-11/concord.db.gz");
    assert.equal(fs.existsSync(`${gz}.verified`), true);

    let gzipTests = 0;
    const again = await evaluateStartupBackup(dir, {
      now,
      intervalMs: 6 * 60 * 60 * 1000,
      verify: async () => { gzipTests += 1; return { ok: false, detail: "should-not-run" }; },
    });
    assert.equal(gzipTests, 0);
    assert.equal(again.skip, true);
    assert.equal(again.verifiedBy, "stamp");
  });

  it("does not skip when the newest verified backup is older than the interval", async () => {
    const dir = makeDir();
    const now = Date.parse("2026-10-11T22:34:00.000Z");
    writeRealGz(dir, "2026-10-11", "stale-db", new Date(now - 7 * 60 * 60 * 1000));
    const decision = await evaluateStartupBackup(dir, { now, intervalMs: 6 * 60 * 60 * 1000 });
    assert.equal(decision.skip, false);
    assert.equal(decision.reason, "older_than_interval");
  });

  it("does not skip a corrupt backup even when its mtime is inside the interval", async () => {
    const dir = makeDir();
    const now = Date.parse("2026-10-11T22:34:00.000Z");
    const day = path.join(dir, "2026-10-11");
    fs.mkdirSync(day);
    const gz = path.join(day, "concord.db.gz");
    fs.writeFileSync(gz, Buffer.from("truncated-not-gzip"));
    const when = new Date(now - 20 * 60 * 1000);
    fs.utimesSync(gz, when, when);
    const decision = await evaluateStartupBackup(dir, { now, intervalMs: 6 * 60 * 60 * 1000 });
    assert.equal(decision.skip, false);
    assert.equal(decision.reason, "unverified");
  });

  it("skips on an older verified copy when a newer file is corrupt", async () => {
    const dir = makeDir();
    const now = Date.parse("2026-10-11T22:34:00.000Z");
    const older = writeRealGz(dir, "2026-10-10", "good-copy", new Date(now - 2 * 60 * 60 * 1000));
    fs.writeFileSync(`${older}.verified`, JSON.stringify({ ok: true, size: fs.statSync(older).size }));
    const day = path.join(dir, "2026-10-11");
    fs.mkdirSync(day);
    const bad = path.join(day, "concord.db.gz");
    fs.writeFileSync(bad, Buffer.from("nope"));
    const when = new Date(now - 60 * 1000);
    fs.utimesSync(bad, when, when);

    const decision = await evaluateStartupBackup(dir, { now, intervalMs: 6 * 60 * 60 * 1000 });
    assert.equal(decision.skip, true);
    assert.equal(decision.filename, "2026-10-10/concord.db.gz");
  });

  it("defaults the boot interval to 6h and lets the env override it", () => {
    assert.equal(dbBackupStartupIntervalMs({}), 6 * 60 * 60 * 1000);
    assert.equal(dbBackupStartupIntervalMs({ CONCORD_DB_BACKUP_STARTUP_INTERVAL_HOURS: "2" }), 2 * 60 * 60 * 1000);
    assert.equal(dbBackupStartupIntervalMs({ CONCORD_DB_BACKUP_STARTUP_INTERVAL_HOURS: "0" }), 0);
    assert.equal(dbBackupStartupIntervalMs({ CONCORD_DB_BACKUP_STARTUP_INTERVAL_HOURS: "" }), 6 * 60 * 60 * 1000);
  });
});

describe("low-disk skip is reported in admin backup status", () => {
  it("free space below db × 1.3 is a skip; 1.3× exactly is enough", async () => {
    const tight = diskBudgetForDbBackup(1000, 1299);
    assert.equal(tight.ok, false);
    assert.equal(tight.skipped, true);
    assert.equal(tight.reason, "low_disk");
    assert.equal(tight.needBytes, 1300);
    assert.match(tight.message, /low disk/);
    assert.match(tight.message, /backup skipped/);
    assert.equal(diskBudgetForDbBackup(1000, 1300).ok, true);
    assert.equal(diskBudgetForDbBackup(3, 3).ok, false);
    assert.equal(diskBudgetForDbBackup(3, 4).needBytes, 4);

    const dir = makeDir();
    const db = path.join(dir, "concord.db");
    fs.writeFileSync(db, Buffer.alloc(1000));
    const budget = await assessDbBackupDisk(db, dir, {
      statfs: async () => ({ bavail: 1299, bsize: 1 }),
    });
    assert.equal(budget.ok, false);
    assert.equal(budget.needBytes, 1300);
    assert.equal(budget.dbBytes, 1000);

    await recordDbBackupRunStatus(dir, {
      result: "skipped",
      reason: "low_disk",
      message: budget.message,
      needBytes: budget.needBytes,
      freeBytes: budget.freeBytes,
      dbBytes: budget.dbBytes,
      at: "2026-10-11T22:34:00.000Z",
    });
    fs.writeFileSync(path.join(dir, "backup-state.json"), "{}");

    const summary = await summarizeDatedDbBackups(dir);
    assert.equal(summary.skippedLowDisk, true);
    assert.equal(summary.lastRun.result, "skipped");
    assert.equal(summary.lastRun.reason, "low_disk");
    assert.match(summary.lastRun.message, /low disk/);
    assert.equal(summary.lastRun.needBytes, 1300);
    assert.equal(summary.lastRun.dbBytes, 1000);
    assert.equal(fs.readFileSync(path.join(dir, "backup-state.json"), "utf8"), "{}");

    await recordDbBackupRunStatus(dir, {
      result: "ok",
      reason: null,
      message: null,
      at: "2026-10-11T23:00:00.000Z",
    });
    const cleared = await summarizeDatedDbBackups(dir);
    assert.equal(cleared.skippedLowDisk, false);
    assert.equal(cleared.lastRun.result, "ok");
  });
});

describe("server.js wires atomic publish, boot skip, and the scheduled tick", () => {
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

  it("runBackup publishes via a pid temp, checks disk, and snapshots with the online backup API", () => {
    const body = fnBody("async function runBackup()", "backup_complete");
    assert.ok(body.includes("concord.db.gz.tmp-${process.pid}"));
    assert.ok(body.includes("finalizeVerifiedGzip(gzipPath, finalGzipPath)"));
    assert.match(body, /assessDbBackupDisk\(DB_PATH, backupDir\)/);
    assert.match(body, /reason: "low_disk"/);
    assert.match(body, /recordDbBackupRunStatus\(BACKUP_DIR/);
    assert.match(body, /backupDatabaseOffLoop\(DB_PATH, snapPath\)/);
    assert.match(body, /fs\.createWriteStream\(gzipPath\)/);
    assert.doesNotMatch(body, /_db\.backup\(/);
    assert.match(body, /if \(dbGzipVerified\)/);
  });

  it("boot is gated and the scheduled interval still calls runBackup", () => {
    const startup = fnBody("async function _backupOnStartup()", "const _backupTick");
    assert.match(startup, /cleanStaleDbBackupTemps\(BACKUP_DIR\)/);
    assert.match(startup, /evaluateStartupBackup\(BACKUP_DIR/);
    assert.match(startup, /dbBackupStartupIntervalMs\(\)/);
    assert.match(RAW, /const _BACKUP_INTERVAL_MS = 24 \* 60 \* 60 \* 1000/);
    assert.match(RAW, /dbBackupKeepCount\(\)/);
    assert.match(RAW, /setInterval\(_backupTick, _BACKUP_INTERVAL_MS\)/);
    assert.match(RAW, /Promise\.resolve\(runBackup\(\)\)\.catch\(/);
    assert.match(RAW, /Promise\.resolve\(_backupOnStartup\(\)\)\.catch\(/);
    const tick = fnBody("const _backupTick = () => {", "setInterval(_backupTick");
    assert.match(tick, /runBackup\(\)/);
    assert.doesNotMatch(tick, /evaluateStartupBackup/);
  });
});
