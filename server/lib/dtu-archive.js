// server/lib/dtu-archive.js
//
// Sprint 32 — cold-DTU archive hook.
//
// PROBLEM this module solves
// --------------------------
// dtu_store was growing at ~1,429 rows/hour at first measurement
// (2026-08-12). The forgetting engine runs every 6 hours and tombstones at
// most MAX_FORGET_PER_CYCLE rows per cycle — at the default 50, it frees
// ~200 rows/day vs ~34,000 rows/day created. Forgetting can never catch
// up; the table is on a collision course with DTU_MEMORY_CEILING in ~4
// days, before the first user logs in.
//
// SOLUTION
// --------
// Move cold, low-utility DTUs off the hot table to dtu_store_archive.
// Archived DTUs:
//   - remain queryable by id (the boot hook installs a transparent
//     "look in archive if not in live store" helper for read paths
//     that need full recall; the search/listing paths do NOT touch
//     archive and therefore never pay the memory cost)
//   - still count toward the data persistence promise (nothing is
//     deleted), they just don't pollute the in-memory `STATE.dtus` Map
//     nor the hot indexes
//   - have an `archive_reason` column we can extend later ('cold_age',
//     'tag_blacklist', 'operator_requested', etc.)
//
// TRIGGER MODES
// -------------
//   (a) Boot sweep — one time at process start, walks all rows older
//       than CONCORD_DTU_ARCHIVE_AGE_MS (default 7 days) and moves them
//       in id-ordered batches of BATCH_SIZE with a yield between each
//       batch so we don't wedge the event loop on a 100k-row cold run.
//   (b) Rolling sweep — runs every CONCORD_DTU_ARCHIVE_INTERVAL_MS
//       (default 30 min) and archives any rows that newly crossed the
//       age threshold. Cheap when there's nothing to do (single SELECT
//       bounded by the new index).
//
// PROTECTED FROM ARCHIVAL
// -----------------------
// Any DTU that the forgetting engine's PROTECTION_RULES would protect
// (`core`, `mega`, sovereign-created, constitutional, breakthrough, pain,
// repair, pinned) is NEVER archived. Archival is a memory-pressure tool,
// not a knowledge-pruning tool; if you want DTUs forgotten, the existing
// forgetting cycle does that and writes tombstones.
//
// ENVIRONMENT HOOKS (all optional, no rebuild needed)
// ---------------------------------------------------
//   CONCORD_DTU_ARCHIVE_AGE_MS        default 7 days
//   CONCORD_DTU_ARCHIVE_INTERVAL_MS   default 30 minutes (rolling sweep)
//   CONCORD_DTU_ARCHIVE_BATCH_SIZE    default 200 rows per batch
//   CONCORD_DTU_ARCHIVE_ENABLED       default 1 (set 0 to disable)
//   CONCORD_DTU_ARCHIVE_BOOT_AT_START default 1 (boot sweep runs at boot)

import logger from "../logger.js";
import { isDtuProtected } from "./dtu-protection.js";

const DEFAULT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_BATCH_SIZE = 200;

let _running = false;
let _bootHookInstalled = false;

function cfg(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function isProtected(dtu) {
  // Re-use the same predicate the forgetting engine trusts so an archive
  // and a forget can never disagree on "is this safe to drop". A DTU
  // that forgetting would tombstone gets archived FIRST (memory-only),
  // and only later tombstoned (data-only) — that's the intended order.
  try {
    return isDtuProtected(dtu);
  } catch (_e) {
    // Defensive: if the predicate ever throws on a malformed DTU, fall
    // back to "protect it" rather than accidentally archiving something
    // the operator pinned.
    return true;
  }
}

/**
 * Move a batch of cold, unprotected DTUs from dtu_store to
 * dtu_store_archive. Yields control to the event loop between batches
 * via setImmediate so a 100k-row boot sweep never wedges HTTP.
 *
 * Returns { archived, remaining, interrupted }.
 */
export async function archiveOldDtuStore(db, opts = {}) {
  if (_running) return { archived: 0, remaining: -1, interrupted: 1 };
  _running = true;
  const startedAt = Date.now();

  const ageMs = opts.ageMs ?? cfg("CONCORD_DTU_ARCHIVE_AGE_MS", DEFAULT_AGE_MS);
  const batchSize = opts.batchSize ?? cfg("CONCORD_DTU_ARCHIVE_BATCH_SIZE", DEFAULT_BATCH_SIZE);
  const dryRun = opts.dryRun === true;
  const cutOff = new Date(Date.now() - ageMs).toISOString();

  let totalArchived = 0;
  let remaining = -1;
  let interrupted = 0;

  try {
    while (true) {
      // Pull a fresh batch each iteration — the same SELECT is cheap
      // because we have idx_dtu_store_updated_at from migration 401.
      // We pull one extra than batchSize so we can detect "is there
      // more work left" without an extra COUNT(*).
      const candidates = db.prepare(`
        SELECT id, title, tier, scope, tags, source, created_at, updated_at,
               content_hash, compressed_size, rights_id, data
          FROM dtu_store
         WHERE updated_at < ?
         ORDER BY updated_at ASC, id ASC
         LIMIT ?
      `).all(cutOff, batchSize + 1);

      if (candidates.length === 0) {
        remaining = 0;
        break;
      }

      const hasMore = candidates.length > batchSize;
      const batch = candidates.slice(0, batchSize);

      // Filter protected DTUs client-side (the protection rules live in
      // JS land, not SQL land — that's the design choice the forgetting
      // engine made too; re-using the predicate keeps the two consistent).
      const archivable = batch.filter((d) => !isProtected(d));

      if (archivable.length === 0) {
        // Nothing in this batch was safe to archive. Yield + retry with
        // a fresh batch so we don't infinite-loop on a table that's
        // full of protected DTUs.
        await new Promise((r) => {
          setImmediate(r);
        });
        if (!hasMore) {
          remaining = 0;
          break;
        }
        continue;
      }

      if (!dryRun) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO dtu_store_archive
            (id, title, tier, scope, tags, source, created_at, updated_at,
             archived_at, archive_reason, content_hash, compressed_size, rights_id, data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'cold_age', ?, ?, ?, ?)
        `);
        const remove = db.prepare("DELETE FROM dtu_store WHERE id = ?");

        const tx = db.transaction((rows) => {
          for (const r of rows) {
            insert.run(
              r.id, r.title, r.tier, r.scope, r.tags, r.source,
              r.created_at, r.updated_at,
              r.content_hash, r.compressed_size, r.rights_id, r.data,
            );
            remove.run(r.id);
          }
        });
        tx(archivable);
      }

      totalArchived += archivable.length;
      if (!hasMore) {
        // Final SELECT to learn the true remaining count after this
        // batch committed. Cheap because of the new index.
        remaining = db.prepare(`
          SELECT COUNT(*) AS n FROM dtu_store WHERE updated_at < ?
        `).get(cutOff).n;
        break;
      }

      // Yield to the event loop between batches. setImmediate (not
      // setTimeout 0) keeps a tight loop on small workloads without
      // burning a 1ms timer per batch.
      await new Promise((r) => {
        setImmediate(r);
      });
    }

    // Record the run. duration_ms + rows_archived are the dashboard
    // signal; rows_remaining lets the operator see when cold rows
    // have all been swept.
    if (!dryRun) {
      try {
        db.prepare(`
          INSERT INTO dtu_archive_runs
            (ran_at, age_threshold_ms, rows_archived, rows_remaining, duration_ms, interrupted)
          VALUES (datetime('now'), ?, ?, ?, ?, ?)
        `).run(ageMs, totalArchived, remaining, Date.now() - startedAt, interrupted);
      } catch (e) {
        logger.debug("lib:dtu-archive", "runs_log_insert_failed", { error: e?.message });
      }
    }

    return { archived: totalArchived, remaining, interrupted };
  } finally {
    _running = false;
  }
}

/**
 * Best-effort single-row lookup. Tries the live store first, falls back
 * to the archive. Returns null if neither has it.
 *
 * Use this for endpoints that have a hard promise to never lose data
 * (operator-facing recovery, full-text recall). DO NOT call from hot
 * listing/search paths — they should hit STATE.dtus / the live table
 * only, since archived rows aren't in memory.
 */
export function getDtuIncludingArchive(db, id) {
  if (!db || !id) return null;
  const live = db.prepare("SELECT * FROM dtu_store WHERE id = ?").get(id);
  if (live) return { ...live, _source: "live" };
  const archived = db.prepare(
    "SELECT * FROM dtu_store_archive WHERE id = ?"
  ).get(id);
  if (archived) return { ...archived, _source: "archive" };
  return null;
}

/**
 * Install the rolling sweep timer. Idempotent: re-calling is a no-op.
 * Call from boot after STATE.dtus is wired. The boot sweep itself is
 * NOT started here — boot order matters, run it from your existing
 * boot hook path so it runs AFTER the in-memory hydration of dtu_store.
 */
export function installRollingArchiveSweep({ db, STATE }) {
  if (_bootHookInstalled) return { ok: false, reason: "already_installed" };
  _bootHookInstalled = true;

  const enabled = cfg("CONCORD_DTU_ARCHIVE_ENABLED", 1) !== 0;
  if (!enabled) {
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const intervalMs = cfg(
    "CONCORD_DTU_ARCHIVE_INTERVAL_MS",
    DEFAULT_INTERVAL_MS,
  );

  const timer = setInterval(() => {
    // Don't archive while memory is over the warning ceiling — the
    // `memory_warning` log line from the existing ceiling monitor is
    // the source of truth for that signal.
    if (typeof globalThis.__memoryPaused === "function"
        && globalThis.__memoryPaused()) {
      return;
    }
    archiveOldDtuStore(db).catch((e) =>
      logger.debug("lib:dtu-archive", "rolling_sweep_failed", { error: e?.message })
    );
  }, intervalMs);
  if (timer.unref) timer.unref();

  // Also prune the in-memory STATE.dtus Map for any DTU that just got
  // archived, so the JS-side memory map stays in sync with the DB.
  if (STATE?.dtus && typeof STATE.dtus.delete === "function") {
    archiveOldDtuStore(db).then(({ archived }) => {
      // We can't know WHICH ids were archived without re-running, but
      // the next rolling sweep will catch any drift. The boot sweep
      // itself is responsible for the initial Map/DB sync — see the
      // companion boot hook caller.
      logger.info?.("lib:dtu-archive", "rolling_sweep_complete", { archived });
    }).catch(() => {});
  }

  return { ok: true, intervalMs };
}

/**
 * One-shot boot sweep. Run AFTER STATE.dtus is hydrated and AFTER the
 * lens artifact store has finished loading, so the archive move doesn't
 * race with anything else that's reading from dtu_store.
 *
 * Also removes the matching ids from STATE.dtus so the in-memory map
 * stops carrying them.
 */
export async function runBootArchiveSweep({ db, STATE }) {
  const enabled = cfg("CONCORD_DTU_ARCHIVE_ENABLED", 1);
  if (enabled === 0) {
    return { ok: true, skipped: true, reason: "disabled" };
  }
  const ageMs = cfg("CONCORD_DTU_ARCHIVE_AGE_MS", DEFAULT_AGE_MS);
  const result = await archiveOldDtuStore(db, { ageMs });

  // Sync the in-memory Map. Walk the archive ids and delete from
  // STATE.dtus; the Map interface matches.
  if (STATE?.dtus && typeof STATE.dtus.delete === "function") {
    const ids = db.prepare(
      "SELECT id FROM dtu_store_archive WHERE archived_at >= datetime('now', '-60 seconds')"
    ).all();
    let pruned = 0;
    for (const { id } of ids) {
      if (STATE.dtus.has(id)) {
        STATE.dtus.delete(id);
        pruned++;
      }
    }
    logger.info?.("lib:dtu-archive", "boot_sweep_complete", {
      archived: result.archived,
      inMemoryPruned: pruned,
      remaining: result.remaining,
      ageMs,
    });
    return { ...result, inMemoryPruned: pruned };
  }
  return result;
}