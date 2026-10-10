// Retention for the two writers that share BACKUP_DIR.
//
// runBackup writes one YYYY-MM-DD/ directory per day (concord.db.gz plus
// state). createBackup writes backup-*.json / auto-*.json files in the same
// folder. Those are different artifacts and must be rotated separately.
//
// A single lexical readdir().sort() treats both as one list. Digit-leading
// date directories sort before letter-leading JSON names, so with
// _BACKUP_RETENTION_DAYS = 1 the directory just written is the first name
// and is rm -rf'd whenever any JSON backup is present. Prod 2026-10-10:
// backup_db_captured + backup_complete for server/data/backups/2026-10-10,
// then the directory was gone and only backup-2026-09-30T….json remained.

import fs from "node:fs";
import path from "node:path";

/** Date directories runBackup creates: `new Date().toISOString().split("T")[0]`. */
export const DATED_DB_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;

function readEntries(backupDir) {
  try {
    return fs.readdirSync(backupDir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/**
 * Keep the newest `retentionDays` YYYY-MM-DD directories. Every other
 * entry in the folder (JSON state backups, dotfiles, flat .db.gz names)
 * is left alone. `protectName` is the directory this run just wrote and
 * is never removed, even when a later-named directory would otherwise
 * be the sole survivor.
 */
export function pruneDatedDbBackups(backupDir, { retentionDays = 1, protectName = null } = {}) {
  const retention = Math.max(1, Math.floor(Number(retentionDays)) || 1);
  const entries = readEntries(backupDir);
  if (!entries) return { deleted: [], kept: [] };

  const dated = entries
    .filter((d) => d.isDirectory() && DATED_DB_DIR_RE.test(d.name))
    .map((d) => d.name)
    .sort();

  const keep = new Set(dated.slice(-retention));
  if (typeof protectName === "string" && DATED_DB_DIR_RE.test(protectName)) {
    keep.add(protectName);
  }

  const deleted = [];
  for (const name of dated) {
    if (keep.has(name)) continue;
    try {
      fs.rmSync(path.join(backupDir, name), { recursive: true, force: true });
      deleted.push(name);
    } catch {
      // One locked directory must not abort the rest of the prune or the backup.
    }
  }
  return { deleted, kept: [...keep].sort() };
}

/**
 * Rotate createBackup's JSON files only. Directories — including the
 * dated DB snapshots that share this folder — are never unlinked.
 * Order stays lexical, matching the previous rotation, so which JSON
 * files survive does not change.
 */
export function pruneJsonStateBackups(backupDir, maxCount) {
  const cap = Math.max(1, Math.floor(Number(maxCount)) || 1);
  const entries = readEntries(backupDir);
  if (!entries) return { deleted: [] };

  const files = entries
    .filter((d) => d.isFile() && d.name.endsWith(".json") && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  const deleted = [];
  while (files.length > cap) {
    const oldest = files.shift();
    const target = path.join(backupDir, oldest);
    try {
      const st = fs.lstatSync(target);
      if (!st.isFile()) continue;
      fs.unlinkSync(target);
      deleted.push(oldest);
    } catch {
      // Same per-file swallow the inline rotation used.
    }
  }
  return { deleted };
}

/**
 * Real DB snapshots runBackup writes: `<YYYY-MM-DD>/concord.db.gz`.
 * Newest calendar day first. Age comes from the gzip mtime, not from
 * midnight of the directory name (a backup taken at 19:42 is hours old,
 * not ~20h from UTC midnight).
 */
export async function listDatedDbBackups(backupDir) {
  let entries;
  try {
    entries = await fs.promises.readdir(backupDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const d of entries) {
    if (!d.isDirectory() || !DATED_DB_DIR_RE.test(d.name)) continue;
    const gzPath = path.join(backupDir, d.name, "concord.db.gz");
    let stat;
    try {
      stat = await fs.promises.stat(gzPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    out.push({
      filename: `${d.name}/concord.db.gz`,
      size: stat.size,
      date: d.name,
      mtime: stat.mtime.toISOString(),
      mtimeMs: stat.mtimeMs,
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

/** Payload for GET /api/admin/backup/status. Healthy means a real gzip younger than 26h. */
export async function summarizeDatedDbBackups(backupDir, now = Date.now()) {
  const listed = await listDatedDbBackups(backupDir);
  const last = listed[0] || null;
  const hoursSinceBackup = last ? (now - last.mtimeMs) / 3600000 : Infinity;
  const finite = Number.isFinite(hoursSinceBackup);
  return {
    totalBackups: listed.length,
    lastBackup: last ? last.date : null,
    hoursSinceLastBackup: finite ? Math.round(hoursSinceBackup) : Infinity,
    healthy: finite && hoursSinceBackup < 26,
    backups: listed.slice(0, 7).map(({ filename, size, date, mtime }) => ({ filename, size, date, mtime })),
  };
}
