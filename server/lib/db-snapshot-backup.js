// Atomic publish for runBackup's <YYYY-MM-DD>/concord.db.gz.
//
// The gzip used to be opened with createWriteStream on the final path, which
// truncates the previous good backup at the start of a ~7 minute write. A
// crash in that window left a corrupt file and nothing else. Publish now
// writes concord.db.gz.tmp-<pid> in the same directory, fsyncs, gzip-tests,
// then renames over the final name. Dated-dir retention (PR #1079) still
// refuses to touch JSON backups or backups-legacy, and it runs only after
// that rename has verified.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import {
  DATED_DB_DIR_RE,
  DB_BACKUP_RUN_STATUS_FILE,
  pruneDatedDbBackups,
  listDatedDbBackups,
} from "./backup-retention.js";

export const DB_BACKUP_DISK_MULTIPLIER = 1.3;
export const DB_BACKUP_KEEP_DEFAULT = 2;
export const DB_BACKUP_STARTUP_INTERVAL_HOURS_DEFAULT = 6;

/** concord.db.gz.tmp-<pid>, snapshot temps, and the status-file temp. */
const TMP_FILE_RE = /^(?:concord\.db\.gz(?:\.verified)?|\.concord\.db\.snapshot|\.db-backup-status\.json)\.tmp-\d+$/;
const UNSUFFIXED_SNAPSHOT = ".concord.db.snapshot";
const STALE_UNSUFFIXED_SNAPSHOT_MS = 3 * 60 * 60 * 1000;

export function dbBackupKeepCount(env = process.env) {
  const raw = env.CONCORD_DB_BACKUP_KEEP;
  if (raw == null || String(raw).trim() === "") return DB_BACKUP_KEEP_DEFAULT;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DB_BACKUP_KEEP_DEFAULT;
  return n;
}

export function dbBackupStartupIntervalMs(env = process.env) {
  const raw = env.CONCORD_DB_BACKUP_STARTUP_INTERVAL_HOURS;
  if (raw == null || String(raw).trim() === "") return DB_BACKUP_STARTUP_INTERVAL_HOURS_DEFAULT * 60 * 60 * 1000;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return DB_BACKUP_STARTUP_INTERVAL_HOURS_DEFAULT * 60 * 60 * 1000;
  return hours * 60 * 60 * 1000;
}

function formatByteCount(n) {
  if (!Number.isFinite(n)) return String(n);
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const rounded = i === 0 ? String(Math.round(v)) : v.toFixed(2);
  return `${rounded} ${units[i]}`;
}

/**
 * Free space on the backup filesystem must cover DB size × 1.3 before a
 * snapshot starts. `freeBytes` of Infinity means statfs was unavailable.
 */
export function diskBudgetForDbBackup(dbBytes, freeBytes, multiplier = DB_BACKUP_DISK_MULTIPLIER) {
  const db = Number(dbBytes);
  const free = Number(freeBytes);
  const needBytes = Number.isFinite(db) && db > 0 ? Math.ceil(db * multiplier) : 0;
  const base = { dbBytes: db, freeBytes: free, needBytes, multiplier };
  if (needBytes > 0 && !(free >= needBytes)) {
    return {
      ...base,
      ok: false,
      skipped: true,
      reason: "low_disk",
      message: `low disk: free ${formatByteCount(free)} < required ${formatByteCount(needBytes)} (db ${formatByteCount(db)} × ${multiplier}); backup skipped`,
    };
  }
  return { ...base, ok: true, skipped: false, reason: null, message: null };
}

export async function assessDbBackupDisk(dbPath, backupDir, deps = {}) {
  const stat = deps.stat || fs.promises.stat;
  const statfs = deps.statfs || fs.promises.statfs;
  let dbBytes = 0;
  try {
    dbBytes = (await stat(dbPath)).size;
  } catch {
    dbBytes = 0;
  }
  let freeBytes = Infinity;
  try {
    const st = await statfs(backupDir);
    freeBytes = Number(st.bavail) * Number(st.bsize);
  } catch {
    // statfs unavailable: do not invent a low-disk skip.
  }
  return diskBudgetForDbBackup(dbBytes, freeBytes);
}

export async function fsyncFile(filePath) {
  const fh = await fs.promises.open(filePath, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function fsyncDirectory(dir) {
  let fh;
  try {
    fh = await fs.promises.open(dir, "r");
    await fh.sync();
  } catch {
    // A directory fsync can fail on platforms that don't allow it. The rename
    // itself is still atomic on the same filesystem.
  } finally {
    await fh?.close();
  }
}

/** Full gzip CRC check. Rejects a truncated or non-gzip payload. */
export async function gzipTest(filePath) {
  await pipeline(
    fs.createReadStream(filePath),
    zlib.createGunzip(),
    new Writable({
      write(_chunk, _enc, cb) { cb(); },
    }),
  );
}

async function readVerifiedStamp(gzipPath) {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(`${gzipPath}.verified`, "utf8"));
    if (!parsed || parsed.ok !== true || typeof parsed.size !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeVerifiedStamp(gzipPath, size) {
  const stampPath = `${gzipPath}.verified`;
  const tmp = `${stampPath}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, JSON.stringify({
    ok: true,
    size,
    verifiedAt: new Date().toISOString(),
  }));
  await fsyncFile(tmp);
  await fs.promises.rename(tmp, stampPath);
}

/**
 * fsync, require size > 0, gzip-test, then atomic rename onto finalPath.
 * `beforeRename` is a test hook: a throw there leaves finalPath untouched.
 * A failed gzip test deletes the temp so a bad payload does not linger.
 */
export async function finalizeVerifiedGzip(tmpPath, finalPath, options = {}) {
  let st;
  try {
    st = await fs.promises.stat(tmpPath);
  } catch (err) {
    throw new Error(`backup gzip temp missing: ${err.message}`);
  }
  if (!st.isFile() || !(st.size > 0)) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    throw new Error("backup gzip empty");
  }
  await fsyncFile(tmpPath);
  try {
    await gzipTest(tmpPath);
  } catch (err) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    throw new Error(`backup gzip verify failed: ${err.message}`);
  }
  if (options.beforeRename) await options.beforeRename();
  await fs.promises.rename(tmpPath, finalPath);
  await fsyncDirectory(path.dirname(finalPath));
  await writeVerifiedStamp(finalPath, st.size).catch(() => {});
}

/** Stream source → gzip temp → verified rename. Same-dir rename is atomic. */
export async function publishConsistentGzip({ sourcePath, finalPath, tmpPath, beforeRename } = {}) {
  await pipeline(
    fs.createReadStream(sourcePath),
    zlib.createGzip({ level: 6 }),
    fs.createWriteStream(tmpPath),
  );
  await finalizeVerifiedGzip(tmpPath, finalPath, { beforeRename });
}

export async function isVerifiedPublishedGzip(filePath) {
  let st;
  try {
    st = await fs.promises.stat(filePath);
  } catch {
    return { ok: false, detail: "missing" };
  }
  if (!st.isFile() || !(st.size > 0)) return { ok: false, detail: "empty" };
  const stamp = await readVerifiedStamp(filePath);
  if (stamp && stamp.size === st.size) return { ok: true, by: "stamp", size: st.size };
  try {
    await gzipTest(filePath);
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
  await writeVerifiedStamp(filePath, st.size).catch(() => {});
  return { ok: true, by: "gzip_test", size: st.size };
}

function pidFromTmpName(name) {
  const m = /\.tmp-(\d+)$/.exec(name);
  if (!m) return null;
  const pid = Number(m[1]);
  return Number.isInteger(pid) ? pid : null;
}

function defaultPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but we can't signal it.
    return err?.code === "EPERM";
  }
}

async function removeStaleFile(dir, name, { pidAlive, now, deleted, prefix }) {
  const full = path.join(dir, name);
  if (TMP_FILE_RE.test(name)) {
    const pid = pidFromTmpName(name);
    if (pid != null && pidAlive(pid)) return;
    await fs.promises.rm(full, { force: true }).catch(() => {});
    deleted.push(prefix ? `${prefix}/${name}` : name);
    return;
  }
  if (name !== UNSUFFIXED_SNAPSHOT) return;
  let st;
  try {
    st = await fs.promises.stat(full);
  } catch {
    return;
  }
  if (!st.isFile()) return;
  if (now - st.mtimeMs < STALE_UNSUFFIXED_SNAPSHOT_MS) return;
  await fs.promises.rm(full, { force: true }).catch(() => {});
  deleted.push(prefix ? `${prefix}/${name}` : name);
}

/**
 * Drop leftover temps from dead pids. A live pid's temp is a backup still
 * in flight (rolling restart) and is left alone. Never walks backups-legacy
 * or any non-date directory other than the backup root itself.
 */
export async function cleanStaleDbBackupTemps(backupDir, deps = {}) {
  const pidAlive = deps.pidAlive || defaultPidAlive;
  const now = deps.now ?? Date.now();
  let entries;
  try {
    entries = await fs.promises.readdir(backupDir, { withFileTypes: true });
  } catch {
    return { deleted: [] };
  }
  const deleted = [];
  for (const ent of entries) {
    if (ent.name === "backups-legacy") continue;
    if (ent.isFile()) {
      await removeStaleFile(backupDir, ent.name, { pidAlive, now, deleted, prefix: "" });
      continue;
    }
    if (!ent.isDirectory() || !DATED_DB_DIR_RE.test(ent.name)) continue;
    const dayDir = path.join(backupDir, ent.name);
    let inner;
    try {
      inner = await fs.promises.readdir(dayDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of inner) {
      if (!child.isFile()) continue;
      await removeStaleFile(dayDir, child.name, { pidAlive, now, deleted, prefix: ent.name });
    }
  }
  return { deleted };
}

/**
 * Skip the boot backup when the newest verified snapshot is younger than
 * `intervalMs`. An unstamped file is gzip-tested once (the pre-fix writer
 * could leave a truncated concord.db.gz) and then stamped so the next boot
 * does not re-read a multi-GB gzip. The scheduled runBackup is not this path.
 */
export async function evaluateStartupBackup(backupDir, { now = Date.now(), intervalMs, verify = isVerifiedPublishedGzip } = {}) {
  const windowMs = Number(intervalMs);
  const listed = await listDatedDbBackups(backupDir);
  if (!listed.length) return { skip: false, reason: "no_backup", intervalMs: windowMs };
  const ordered = [...listed].sort((a, b) => b.mtimeMs - a.mtimeMs);
  let gzipTested = false;
  for (const item of ordered) {
    const gzPath = path.join(backupDir, item.filename);
    const stamp = await readVerifiedStamp(gzPath);
    let verdict;
    if (stamp) {
      let st;
      try { st = await fs.promises.stat(gzPath); } catch { continue; }
      if (st.isFile() && st.size > 0 && stamp.size === st.size) verdict = { ok: true, by: "stamp" };
    }
    // Stamp miss (truncated in-place rewrite, or crash before the stamp was
    // written): gzip-test the newest such file once, not the whole history.
    if (!verdict && !gzipTested) {
      gzipTested = true;
      verdict = await verify(gzPath);
    }
    if (!verdict?.ok) continue;
    const ageMs = now - item.mtimeMs;
    if (ageMs < windowMs) {
      return {
        skip: true,
        reason: "fresh_verified_backup",
        ageMs,
        intervalMs: windowMs,
        filename: item.filename,
        verifiedBy: verdict.by || "verified",
      };
    }
    return {
      skip: false,
      reason: "older_than_interval",
      ageMs,
      intervalMs: windowMs,
      filename: item.filename,
    };
  }
  return { skip: false, reason: "unverified", intervalMs: windowMs };
}

/**
 * Dated-dir retention. No-op until the new gzip has been verified and
 * renamed, so a failed or in-flight backup cannot delete the previous copy.
 * pruneDatedDbBackups only removes YYYY-MM-DD directories.
 */
export function applyDbBackupRetention(backupDir, { keep = DB_BACKUP_KEEP_DEFAULT, protectName = null, verified = false } = {}) {
  if (!verified) return { deleted: [], kept: [], skipped: "not_verified" };
  const result = pruneDatedDbBackups(backupDir, { retentionDays: keep, protectName });
  return { ...result, skipped: null };
}

export async function recordDbBackupRunStatus(backupDir, status) {
  await fs.promises.mkdir(backupDir, { recursive: true });
  const finalPath = path.join(backupDir, DB_BACKUP_RUN_STATUS_FILE);
  const tmpPath = path.join(backupDir, `${DB_BACKUP_RUN_STATUS_FILE}.tmp-${process.pid}`);
  await fs.promises.writeFile(tmpPath, JSON.stringify(status));
  await fsyncFile(tmpPath);
  await fs.promises.rename(tmpPath, finalPath);
}
