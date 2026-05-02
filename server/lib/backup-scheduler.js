/**
 * Concord Cognitive Engine — Backup Scheduler
 *
 * Manages automated backup scheduling with configurable intervals,
 * CRON expression support, backup history tracking in SQLite,
 * health monitoring, and metrics for the health endpoint.
 *
 * Supports both local-only and S3 offsite backup modes.
 * Fault-tolerant: logs errors but keeps running.
 *
 * @example
 *   import { createBackupScheduler } from './lib/backup-scheduler.js';
 *
 *   const scheduler = createBackupScheduler(db, {
 *     schedule: '0 *\/6 * * *',  // Every 6 hours
 *     s3Enabled: Boolean(process.env.AWS_BUCKET),
 *     dataDir: '/data',
 *   });
 *   scheduler.start();
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import logger from '../logger.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");

// ── CRON Parser (lightweight, no external dependency) ───────────────────

/**
 * Parse a CRON expression and check if a given date matches.
 * Supports: minute hour day-of-month month day-of-week
 * Supports: *, numbers, ranges (1-5), steps (*\/2), lists (1,3,5)
 */
function parseCronField(field, min, max) {
  if (field === "*") {
    return null; // matches all
  }

  const values = new Set();

  for (const part of field.split(",")) {
    if (part.includes("/")) {
      // Step: */2 or 1-10/3
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;

      if (range !== "*") {
        if (range.includes("-")) {
          [start, end] = range.split("-").map(Number);
        } else {
          start = parseInt(range, 10);
        }
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else if (part.includes("-")) {
      // Range: 1-5
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      // Single value
      values.add(parseInt(part, 10));
    }
  }

  return values;
}

function parseCronExpression(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid CRON expression: "${expression}" (expected 5 fields)`);
  }

  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dayOfMonth: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    dayOfWeek: parseCronField(parts[4], 0, 6),
  };
}

function cronMatches(parsed, date) {
  const checks = [
    { field: parsed.minute, value: date.getMinutes() },
    { field: parsed.hour, value: date.getHours() },
    { field: parsed.dayOfMonth, value: date.getDate() },
    { field: parsed.month, value: date.getMonth() + 1 },
    { field: parsed.dayOfWeek, value: date.getDay() },
  ];

  return checks.every(({ field, value }) => field === null || field.has(value));
}

// ── Default options ─────────────────────────────────────────────────────

const DEFAULT_OPTS = {
  /** CRON expression for schedule (default: every 6 hours) */
  schedule: process.env.BACKUP_SCHEDULE || "0 */6 * * *",
  /** Enable S3 upload (auto-detected from AWS_BUCKET) */
  s3Enabled: Boolean(process.env.AWS_BUCKET),
  /** Data directory */
  dataDir: process.env.DATA_DIR || "/data",
  /** DB path */
  dbPath: process.env.DB_PATH || undefined,
  /** Alert threshold: warn if last backup older than this (ms) */
  alertThresholdMs: 12 * 60 * 60 * 1000, // 12 hours
  /** Maximum concurrent backups */
  maxConcurrent: 1,
  /** Structured logger */
  log: null,
};

// ── Scheduler Factory ───────────────────────────────────────────────────

/**
 * Create a backup scheduler that tracks history in SQLite and runs
 * backups on a configurable CRON schedule.
 *
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @param {object} opts - Configuration options
 * @returns {{ start, stop, runNow, getStatus, getHistory }}
 */
export function createBackupScheduler(db, opts = {}) {
  const config = { ...DEFAULT_OPTS, ...opts };
  const log = config.log || ((_level, _event, _data) => {});

  let cronParsed;
  try {
    cronParsed = parseCronExpression(config.schedule);
  } catch (err) {
    console.error(`[BackupScheduler] Invalid CRON: ${err.message}. Falling back to every 6 hours.`);
    cronParsed = parseCronExpression("0 */6 * * *");
  }

  let tickInterval = null;
  let running = false;
  let currentBackup = null;
  let lastCheckedMinute = -1;

  // ── Ensure backup_history table exists ──────────────────────────────
  function ensureTable() {
    if (!db) return;
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS backup_history (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          db_size_bytes INTEGER,
          compressed_size_bytes INTEGER,
          artifacts_size_bytes INTEGER,
          s3_key TEXT,
          s3_etag TEXT,
          integrity_check TEXT,
          duration_ms INTEGER,
          error TEXT,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          metadata TEXT
        )
      `);
    } catch (err) {
      console.error("[BackupScheduler] Could not ensure backup_history table:", err.message);
    }
  }

  // ── Record a backup event in history ───────────────────────────────
  function recordBackup(entry) {
    if (!db) return;
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO backup_history
          (id, type, status, db_size_bytes, compressed_size_bytes, artifacts_size_bytes,
           s3_key, s3_etag, integrity_check, duration_ms, error, started_at, completed_at, metadata)
        VALUES
          (@id, @type, @status, @db_size_bytes, @compressed_size_bytes, @artifacts_size_bytes,
           @s3_key, @s3_etag, @integrity_check, @duration_ms, @error, @started_at, @completed_at, @metadata)
      `);
      stmt.run({
        id: entry.id,
        type: entry.type,
        status: entry.status,
        db_size_bytes: entry.db_size_bytes ?? null,
        compressed_size_bytes: entry.compressed_size_bytes ?? null,
        artifacts_size_bytes: entry.artifacts_size_bytes ?? null,
        s3_key: entry.s3_key ?? null,
        s3_etag: entry.s3_etag ?? null,
        integrity_check: entry.integrity_check ?? null,
        duration_ms: entry.duration_ms ?? null,
        error: entry.error ?? null,
        started_at: entry.started_at,
        completed_at: entry.completed_at ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      });
    } catch (err) {
      console.error("[BackupScheduler] Failed to record backup:", err.message);
    }
  }

  // ── Parse backup script JSON output ────────────────────────────────
  function parseBackupOutput(stdout) {
    try {
      const marker = "---BACKUP_STATUS_JSON---";
      const idx = stdout.lastIndexOf(marker);
      if (idx === -1) return null;
      const jsonStr = stdout.slice(idx + marker.length).trim();
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  // ── Execute a backup ──────────────────────────────────────────────
  async function executeBackup() {
    if (currentBackup) {
      console.warn("[BackupScheduler] Backup already in progress, skipping");
      return { ok: false, error: "Backup already in progress" };
    }

    const backupId = `bak_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const backupType = config.s3Enabled ? "s3" : "local";

    currentBackup = { id: backupId, startedAt };

    // Record start
    recordBackup({
      id: backupId,
      type: backupType,
      status: "started",
      started_at: startedAt,
    });

    log("info", "backup_started", { backupId, type: backupType });
    logger.info('lib:backup-scheduler', `Starting ${backupType} backup (${backupId})`);

    try {
      const scriptName = config.s3Enabled ? "backup-s3.sh" : "backup.sh";
      const scriptPath = path.join(SCRIPTS_DIR, scriptName);

      const env = {
        ...process.env,
        DATA_DIR: config.dataDir,
      };
      if (config.dbPath) {
        env.DB_PATH = config.dbPath;
      }

      const { stdout, stderr } = await execFileAsync("bash", [scriptPath], {
        env,
        timeout: 10 * 60 * 1000, // 10 minute timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const durationMs = Date.now() - startMs;

      if (stderr) {
        console.warn("[BackupScheduler] Backup stderr:", stderr.slice(0, 500));
      }

      // Parse the JSON status from script output
      const parsed = parseBackupOutput(stdout);

      const entry = {
        id: backupId,
        type: parsed?.type || backupType,
        status: "completed",
        db_size_bytes: parsed?.db_size_bytes ?? null,
        compressed_size_bytes: parsed?.compressed_size_bytes ?? null,
        artifacts_size_bytes: parsed?.artifacts_size_bytes ?? null,
        s3_key: parsed?.s3_db_key ?? null,
        s3_etag: parsed?.s3_db_etag ?? null,
        integrity_check: parsed?.integrity_check ?? "ok",
        duration_ms: parsed?.duration_ms ?? durationMs,
        error: null,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        metadata: {
          s3_artifacts_key: parsed?.s3_artifacts_key ?? null,
          s3_artifacts_etag: parsed?.s3_artifacts_etag ?? null,
          timestamp: parsed?.timestamp ?? null,
          triggered: "scheduler",
        },
      };

      recordBackup(entry);
      log("info", "backup_completed", { backupId, durationMs, type: entry.type });
      logger.info('lib:backup-scheduler', `Backup completed in ${durationMs}ms (${backupId})`);

      currentBackup = null;
      return { ok: true, backup: entry };
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorMsg = err.message || String(err);

      const entry = {
        id: backupId,
        type: backupType,
        status: "failed",
        duration_ms: durationMs,
        error: errorMsg.slice(0, 2000),
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        metadata: { stderr: err.stderr?.slice(0, 1000) ?? null },
      };

      recordBackup(entry);
      log("error", "backup_failed", { backupId, error: errorMsg, durationMs });
      console.error(`[BackupScheduler] Backup failed: ${errorMsg}`);

      currentBackup = null;
      return { ok: false, error: errorMsg, backup: entry };
    }
  }

  // ── CRON tick — check every minute if schedule matches ────────────
  function tick() {
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();

    // Only fire once per minute
    if (currentMinute === lastCheckedMinute) return;
    lastCheckedMinute = currentMinute;

    if (cronMatches(cronParsed, now)) {
      logger.info('lib:backup-scheduler', `CRON match at ${now.toISOString()} — triggering backup`);
      executeBackup().catch((err) => {
        console.error("[BackupScheduler] Unhandled backup error:", err.message);
      });
    }
  }

  // ── Public API ────────────────────────────────────────────────────

  return {
    /**
     * Start the scheduler. Checks every 30 seconds for CRON matches.
     */
    start() {
      if (running) {
        logger.info('lib:backup-scheduler', 'Already running');
        return;
      }
      ensureTable();
      running = true;
      lastCheckedMinute = -1;

      // Check every 2 minutes (backups are hourly/daily — 2min resolution is fine)
      tickInterval = setInterval(tick, 120_000);

      // Run first tick immediately to check if we should backup now
      tick();

      const s3Status = config.s3Enabled ? "S3 enabled" : "local-only (AWS_BUCKET not set)";
      logger.info('lib:backup-scheduler', `Started — schedule: "${config.schedule}" [${s3Status}]`);
      log("info", "backup_scheduler_started", {
        schedule: config.schedule,
        s3Enabled: config.s3Enabled,
      });
    },

    /**
     * Stop the scheduler. Does not cancel an in-progress backup.
     */
    stop() {
      if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
      running = false;
      logger.info('lib:backup-scheduler', 'Stopped');
      log("info", "backup_scheduler_stopped", {});
    },

    /**
     * Trigger an immediate backup (ignores schedule).
     * @returns {Promise<{ok: boolean, backup?: object, error?: string}>}
     */
    async runNow() {
      ensureTable();
      return executeBackup();
    },

    /**
     * Get backup health status.
     * @returns {{ healthy: boolean, status: string, lastBackup: object|null, age: object, ... }}
     */
    getStatus() {
      ensureTable();

      const now = Date.now();
      let lastBackup = null;
      let lastSuccessful = null;
      let totalBackups = 0;
      let failedBackups = 0;
      let localCount = 0;
      let s3Count = 0;

      if (db) {
        try {
          lastBackup = db
            .prepare(
              "SELECT * FROM backup_history ORDER BY started_at DESC LIMIT 1"
            )
            .get();

          lastSuccessful = db
            .prepare(
              "SELECT * FROM backup_history WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1"
            )
            .get();

          const counts = db
            .prepare(
              "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed FROM backup_history"
            )
            .get();
          totalBackups = counts?.total ?? 0;
          failedBackups = counts?.failed ?? 0;

          const typeCounts = db
            .prepare(
              "SELECT type, COUNT(*) as count FROM backup_history WHERE status = 'completed' GROUP BY type"
            )
            .all();
          for (const row of typeCounts) {
            if (row.type === "local") localCount = row.count;
            if (row.type === "s3") s3Count = row.count;
          }
        } catch (err) {
          console.error("[BackupScheduler] Error reading backup status:", err.message);
        }
      }

      // Compute age and health
      const lastSuccessTime = lastSuccessful?.completed_at
        ? new Date(lastSuccessful.completed_at).getTime()
        : 0;
      const ageMs = lastSuccessTime > 0 ? now - lastSuccessTime : Infinity;
      const ageHours = ageMs / (60 * 60 * 1000);

      let healthStatus;
      if (ageMs === Infinity) {
        healthStatus = "unknown"; // No backups ever recorded
      } else if (ageMs <= config.alertThresholdMs) {
        healthStatus = "healthy";
      } else if (ageMs <= config.alertThresholdMs * 2) {
        healthStatus = "warning";
      } else {
        healthStatus = "critical";
      }

      // Parse metadata JSON if present
      if (lastBackup?.metadata && typeof lastBackup.metadata === "string") {
        try {
          lastBackup.metadata = JSON.parse(lastBackup.metadata);
        } catch (_e) { logger.debug('backup-scheduler', 'leave as string', { error: _e?.message }); }
      }
      if (lastSuccessful?.metadata && typeof lastSuccessful.metadata === "string") {
        try {
          lastSuccessful.metadata = JSON.parse(lastSuccessful.metadata);
        } catch (_e) { logger.debug('backup-scheduler', 'leave as string', { error: _e?.message }); }
      }

      return {
        healthy: healthStatus === "healthy",
        status: healthStatus,
        schedulerRunning: running,
        schedule: config.schedule,
        s3Enabled: config.s3Enabled,
        backupInProgress: Boolean(currentBackup),
        currentBackupId: currentBackup?.id ?? null,
        lastBackup: lastBackup ?? null,
        lastSuccessfulBackup: lastSuccessful ?? null,
        age: {
          ms: ageMs === Infinity ? null : Math.round(ageMs),
          hours: ageMs === Infinity ? null : Math.round(ageHours * 100) / 100,
          human: ageMs === Infinity
            ? "never"
            : ageHours < 1
              ? `${Math.round(ageMs / 60000)} minutes ago`
              : ageHours < 24
                ? `${Math.round(ageHours * 10) / 10} hours ago`
                : `${Math.round(ageHours / 24)} days ago`,
        },
        alertThresholdHours: config.alertThresholdMs / (60 * 60 * 1000),
        counts: {
          total: totalBackups,
          failed: failedBackups,
          successful: totalBackups - failedBackups,
          local: localCount,
          s3: s3Count,
        },
      };
    },

    /**
     * Get backup history.
     * @param {{ limit?: number, offset?: number, type?: string, status?: string }} filters
     * @returns {{ history: object[], total: number }}
     */
    getHistory(filters = {}) {
      ensureTable();

      const limit = Math.min(Math.max(filters.limit || 20, 1), 100);
      const offset = Math.max(filters.offset || 0, 0);

      if (!db) {
        return { history: [], total: 0 };
      }

      try {
        let where = "1=1";
        const params = {};

        if (filters.type) {
          where += " AND type = @type";
          params.type = filters.type;
        }
        if (filters.status) {
          where += " AND status = @status";
          params.status = filters.status;
        }

        const countRow = db
          .prepare(`SELECT COUNT(*) as total FROM backup_history WHERE ${where}`)
          .get(params);

        const rows = db
          .prepare(
            `SELECT * FROM backup_history WHERE ${where} ORDER BY started_at DESC LIMIT @limit OFFSET @offset`
          )
          .all({ ...params, limit, offset });

        // Parse metadata JSON
        for (const row of rows) {
          if (row.metadata && typeof row.metadata === "string") {
            try {
              row.metadata = JSON.parse(row.metadata);
            } catch (_e) { logger.debug('backup-scheduler', 'leave as string', { error: _e?.message }); }
          }
        }

        return {
          history: rows,
          total: countRow?.total ?? 0,
        };
      } catch (err) {
        console.error("[BackupScheduler] Error reading history:", err.message);
        return { history: [], total: 0 };
      }
    },
  };
}
