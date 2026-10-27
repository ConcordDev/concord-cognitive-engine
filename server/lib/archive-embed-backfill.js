// Slow, bounded archive embedding backfill.
//
// Ramaj, 2026-10-27: under 8% of dtu_store_archive had a vector, so archived
// knowledge (including 951 archived megas, none embedded) was invisible to
// semantic retrieval. The hot backfill only walks STATE.dtus. This walks the
// archive tables in small, time-budgeted slices with a persisted cursor:
//   phase 1  dtu_store_archive megas/hypers
//   phase 2  archived_dtus (consolidated members + megas)
//   phase 3  the rest of dtu_store_archive
// It runs under lowMemory on purpose (the local embedder is a worker thread;
// each slice is a few rows), and pauses itself when swap is nearly full.
import { execFile } from "node:child_process";
import { archiveRowToDtu } from "./archive-retrieval.js";

export const PHASES = Object.freeze([
  { name: "archive_consolidated", table: "dtu_store_archive", where: "tier IN ('mega','hyper')" },
  { name: "archived_dtus", table: "archived_dtus", where: "1=1" },
  { name: "archive_rest", table: "dtu_store_archive", where: "tier NOT IN ('mega','hyper','shadow') OR tier IS NULL" },
]);

// v2: the v1 cursor (#1548) skipped legacy rows whose id lived only in the
// table column; restart from the top.
const PROGRESS_TABLE = "archive_embed_progress_v2";

export function ensureProgressTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${PROGRESS_TABLE} (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    phase INTEGER NOT NULL DEFAULT 0,
    last_rowid INTEGER NOT NULL DEFAULT 0,
    embedded INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  )`);
  db.prepare(`INSERT OR IGNORE INTO ${PROGRESS_TABLE} (id, updated_at) VALUES (1, ?)`).run(new Date().toISOString());
}

export function readProgress(db) {
  ensureProgressTable(db);
  return db.prepare(`SELECT * FROM ${PROGRESS_TABLE} WHERE id = 1`).get();
}

function writeProgress(db, p) {
  db.prepare(`UPDATE ${PROGRESS_TABLE} SET phase=?, last_rowid=?, embedded=?, skipped=?, errors=?, done=?, updated_at=? WHERE id = 1`)
    .run(p.phase, p.last_rowid, p.embedded, p.skipped, p.errors, p.done ? 1 : 0, new Date().toISOString());
}

/** macOS swap free in MB (null when unknown). Cached briefly by the caller. */
export function readSwapFreeMb() {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") { resolve(null); return; }
    execFile("sysctl", ["-n", "vm.swapusage"], { timeout: 2000 }, (err, out) => {
      if (err) return resolve(null);
      const m = /free\s*=\s*([\d.]+)([MG])/i.exec(String(out));
      if (!m) return resolve(null);
      resolve(Number(m[1]) * (m[2].toUpperCase() === "G" ? 1024 : 1));
    });
  });
}

const yieldLoop = () => new Promise((r) => { setImmediate(r); });

/**
 * One slice. Returns { ok, embedded, skipped, errors, phase, done, paused? }.
 * @param {object} p
 * @param {import("better-sqlite3").Database} p.db
 * @param {(dtu: object) => Promise<string|void>} p.embedDTU
 * @param {(id: string) => boolean} p.hasEmbedding   live-cache check (#1534)
 * @param {number} [p.batch]
 * @param {number} [p.budgetMs]
 * @param {() => Promise<number|null>} [p.swapFreeMb]
 * @param {number} [p.minSwapFreeMb]
 * @param {() => number} [p.now]
 */
export async function runArchiveEmbedSlice({
  db, embedDTU, hasEmbedding, batch = 12, budgetMs = 1500,
  swapFreeMb = readSwapFreeMb, minSwapFreeMb = 500, now = Date.now, rescanMs = 6 * 3600_000, scanFactor = 16,
}) {
  let prog = readProgress(db);
  if (prog.done) {
    // Rescan every rescanMs for rows archived since (already-embedded rows
    // are skipped cheaply).
    const age = now() - Date.parse(prog.updated_at || 0);
    if (!(age >= rescanMs)) return { ok: true, done: true, embedded: 0, skipped: 0, errors: 0, phase: null };
    prog = { ...prog, phase: 0, last_rowid: 0, done: 0 };
  }
  const free = await swapFreeMb();
  if (free != null && free < minSwapFreeMb) {
    return { ok: true, paused: "swap_low", swapFreeMb: Math.round(free), embedded: 0, skipped: 0, errors: 0, phase: PHASES[prog.phase]?.name };
  }
  const t0 = now();
  let embedded = 0, skipped = 0, errors = 0;
  const p = { ...prog };
  while (now() - t0 < budgetMs) {
    const phase = PHASES[p.phase];
    if (!phase) { p.done = 1; break; }
    // Read ids first (cheap), parse only rows that still need a vector.
    const rows = db.prepare(`SELECT rowid AS rid, id FROM ${phase.table} WHERE rowid > ? AND (${phase.where}) ORDER BY rowid LIMIT ?`)
      .all(p.last_rowid, batch * scanFactor);
    if (rows.length === 0) { p.phase += 1; p.last_rowid = 0; continue; }
    const getRow = db.prepare(`SELECT * FROM ${phase.table} WHERE rowid = ?`);
    let tried = 0;
    for (const r of rows) {
      if (tried >= batch) break;
      p.last_rowid = r.rid;
      if (!r.id || hasEmbedding(r.id)) { skipped++; continue; }
      tried++;
      const dtu = archiveRowToDtu(getRow.get(r.rid));
      if (!dtu || !dtu.id || dtu.tier === "shadow") { skipped++; continue; }
      try {
        const st = await embedDTU(dtu);
        if (hasEmbedding(dtu.id)) embedded++;
        else if (st === "empty") skipped++;
        else errors++;
      } catch { errors++; }
      if (now() - t0 >= budgetMs) break;
    }
    await yieldLoop();
    // One batch per slice keeps the slice short even when embeds are fast.
    break;
  }
  p.embedded += embedded; p.skipped += skipped; p.errors += errors;
  writeProgress(db, p);
  return { ok: true, embedded, skipped, errors, phase: PHASES[p.phase]?.name || "done", done: !!p.done, ms: now() - t0 };
}

/**
 * Coverage numbers for status and the report.
 * @param {import("better-sqlite3").Database} db
 * @param {string} table  embedding table of the active model
 */
export function archiveCoverage(db, table) {
  const q = (sql) => db.prepare(sql).get().n;
  return {
    hot: q("SELECT COUNT(*) AS n FROM dtu_store"),
    hotEmbedded: q(`SELECT COUNT(*) AS n FROM ${table} e JOIN dtu_store s ON s.id = e.dtu_id`),
    archive: q("SELECT COUNT(*) AS n FROM dtu_store_archive"),
    archiveEmbedded: q(`SELECT COUNT(*) AS n FROM ${table} e JOIN dtu_store_archive a ON a.id = e.dtu_id`),
    archivedDtus: q("SELECT COUNT(*) AS n FROM archived_dtus"),
    archivedDtusEmbedded: q(`SELECT COUNT(*) AS n FROM ${table} e JOIN archived_dtus a ON a.id = e.dtu_id`),
  };
}
