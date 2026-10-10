#!/usr/bin/env node
// Operator tool. Not imported by server boot and not run by any heartbeat.
//
// Restores consolidation products that the cold archiver moved, and fixes
// megas that pipelineCommitDTU downgraded to regular:
//   - dtu_store_archive rows with tier mega/hyper are copied back into
//     dtu_store (plain JSON `data`, original tier) and removed from the archive.
//   - live dtu_store rows that are still regular, titled "MEGA —" / "HYPER —"
//     (or "MEGA:" / "HYPER:"), and tagged tier_downgraded are re-tiered and
//     the downgrade tag is stripped.
//
// Idempotent. Default is dry-run: print counts, write nothing.
//
//   node server/scripts/restore-archived-tiers.mjs [--dry-run] [--apply] [--db path]
//
// --apply is required to write. A second --apply reports zeros.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unpackDtuData } from "../lib/dtu-at-rest.js";

const LIVE_COLS = [
  "id", "title", "tier", "scope", "tags", "source", "created_at", "updated_at",
  "data", "content_hash", "compressed_size", "rights_id",
  "owner_user_id", "visibility", "privacy", "federation_tier",
  "location_regional", "location_national", "kind",
];

function tableExists(db, name) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
}

function tableCols(db, name) {
  return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name));
}

export function parseTags(tags) {
  if (Array.isArray(tags)) return tags.filter(t => typeof t === "string");
  if (typeof tags === "string") {
    const s = tags.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.filter(t => typeof t === "string");
      } catch { /* not JSON */ }
    }
    return s.split(",").map(t => t.trim()).filter(Boolean);
  }
  return [];
}

export function tierFromTitle(title) {
  const t = String(title || "").trim();
  if (/^HYPER\b/i.test(t)) return "hyper";
  if (/^MEGA\b/i.test(t)) return "mega";
  return null;
}

function readPayload(data) {
  try {
    const text = unpackDtuData(data);
    if (typeof text !== "string" || !text.trim()) return null;
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function archivedTier(row) {
  const col = String(row.tier || "").toLowerCase();
  if (col === "mega" || col === "hyper") return col;
  const payload = readPayload(row.data);
  const fromBody = String(payload?.tier || "").toLowerCase();
  if (fromBody === "mega" || fromBody === "hyper") return fromBody;
  return null;
}

function isDowngraded(row) {
  const tier = String(row.tier || "regular").toLowerCase();
  if (tier === "mega" || tier === "hyper") return null;
  if (!parseTags(row.tags).includes("tier_downgraded")) return null;
  return tierFromTitle(row.title);
}

function emptyCounts() {
  return {
    archiveMega: 0,
    archiveHyper: 0,
    downgradedMega: 0,
    downgradedHyper: 0,
    alreadyLive: 0,
    restored: 0,
    retiered: 0,
  };
}

export function inspectArchivedTiers(db) {
  const counts = emptyCounts();
  if (!db) return counts;
  if (tableExists(db, "dtu_store_archive")) {
    const rows = db.prepare(`SELECT id, title, tier, data FROM dtu_store_archive`).all();
    const liveTier = tableExists(db, "dtu_store")
      ? db.prepare(`SELECT tier FROM dtu_store WHERE id = ?`)
      : null;
    for (const row of rows) {
      const tier = archivedTier(row);
      if (!tier) continue;
      const live = liveTier?.get(row.id);
      const liveIsHigh = live && (String(live.tier).toLowerCase() === "mega" || String(live.tier).toLowerCase() === "hyper");
      if (liveIsHigh) {
        counts.alreadyLive++;
        continue;
      }
      if (tier === "hyper") counts.archiveHyper++;
      else counts.archiveMega++;
    }
  }
  if (tableExists(db, "dtu_store")) {
    const rows = db.prepare(`SELECT id, title, tier, tags FROM dtu_store`).all();
    for (const row of rows) {
      const tier = isDowngraded(row);
      if (tier === "mega") counts.downgradedMega++;
      else if (tier === "hyper") counts.downgradedHyper++;
    }
  }
  return counts;
}

function restoreOne(db, row, liveCols) {
  const tier = archivedTier(row);
  if (!tier) return "skip";
  const live = db.prepare(`SELECT id, tier FROM dtu_store WHERE id = ?`).get(row.id);
  const liveTier = String(live?.tier || "").toLowerCase();
  if (live && (liveTier === "mega" || liveTier === "hyper")) {
    db.prepare(`DELETE FROM dtu_store_archive WHERE id = ?`).run(row.id);
    return "already";
  }
  const payload = readPayload(row.data);
  const tags = parseTags(payload?.tags ?? row.tags).filter(t => t !== "tier_downgraded");
  if (payload) {
    payload.tier = tier;
    payload.tags = tags;
  }
  const dataText = payload ? JSON.stringify(payload) : "{}";
  const now = new Date().toISOString();
  const values = {
    id: row.id,
    title: payload?.title || row.title || "",
    tier,
    scope: row.scope || payload?.scope || "global",
    tags: JSON.stringify(tags),
    source: (typeof row.source === "string" && row.source) || payload?.source || "system",
    created_at: row.created_at || payload?.createdAt || now,
    updated_at: now,
    data: dataText,
    content_hash: row.content_hash || null,
    compressed_size: Buffer.byteLength(dataText),
    rights_id: row.rights_id || null,
    owner_user_id: row.owner_user_id || null,
    visibility: row.visibility || payload?.visibility || null,
    privacy: row.privacy || payload?.privacy || null,
    federation_tier: row.federation_tier || null,
    location_regional: row.location_regional || null,
    location_national: row.location_national || null,
    kind: row.kind || null,
  };
  const cols = LIVE_COLS.filter(c => liveCols.has(c));
  const sql = `INSERT OR REPLACE INTO dtu_store (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  db.prepare(sql).run(...cols.map(c => values[c] ?? null));
  db.prepare(`DELETE FROM dtu_store_archive WHERE id = ?`).run(row.id);
  return "restored";
}

function retierOne(db, row) {
  const tier = isDowngraded(row);
  if (!tier) return false;
  const full = db.prepare(`SELECT id, title, tier, tags, data FROM dtu_store WHERE id = ?`).get(row.id);
  if (!full) return false;
  const tags = parseTags(full.tags).filter(t => t !== "tier_downgraded");
  const payload = readPayload(full.data);
  if (payload) {
    payload.tier = tier;
    payload.tags = tags;
    if (payload.meta && typeof payload.meta === "object") {
      payload.meta.retieredFromDowngradeAt = new Date().toISOString();
    }
  }
  const dataText = payload ? JSON.stringify(payload) : full.data;
  db.prepare(`UPDATE dtu_store SET tier = ?, tags = ?, data = ?, updated_at = ? WHERE id = ?`)
    .run(tier, JSON.stringify(tags), dataText, new Date().toISOString(), full.id);
  return true;
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {{ apply?: boolean }} [opts]
 * @returns {object} counts. dryRun true writes nothing.
 */
export function restoreArchivedTiers(db, { apply = false } = {}) {
  const before = inspectArchivedTiers(db);
  const result = { dryRun: !apply, ...before };
  if (!apply) return result;

  const liveCols = tableExists(db, "dtu_store") ? tableCols(db, "dtu_store") : new Set();
  const tx = db.transaction(() => {
    if (tableExists(db, "dtu_store_archive") && tableExists(db, "dtu_store")) {
      const rows = db.prepare(`SELECT * FROM dtu_store_archive`).all();
      for (const row of rows) {
        const outcome = restoreOne(db, row, liveCols);
        if (outcome === "restored") result.restored++;
      }
    }
    if (tableExists(db, "dtu_store")) {
      const rows = db.prepare(`SELECT id, title, tier, tags FROM dtu_store`).all();
      for (const row of rows) {
        if (retierOne(db, row)) result.retiered++;
      }
    }
  });
  tx();
  return result;
}

export function formatRestoreReport(result) {
  const mode = result.dryRun ? "dry-run" : "apply";
  return [
    `restore-archived-tiers: ${mode}`,
    `  archive_mega: ${result.archiveMega}`,
    `  archive_hyper: ${result.archiveHyper}`,
    `  downgraded_mega: ${result.downgradedMega}`,
    `  downgraded_hyper: ${result.downgradedHyper}`,
    `  already_live: ${result.alreadyLive}`,
    `  restored: ${result.restored}`,
    `  retiered: ${result.retiered}`,
  ].join("\n");
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) return null;
  return process.argv[i + 1];
}

function defaultDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return path.join(path.dirname(new URL(import.meta.url).pathname), "..", "data", "concord.db");
}

export function isCliMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCliMain()) {
  const apply = process.argv.includes("--apply");
  const dbPath = argValue("--db") || defaultDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`restore-archived-tiers: database not found: ${dbPath}`);
    process.exit(1);
  }
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath);
  try {
    const result = restoreArchivedTiers(db, { apply });
    console.log(formatRestoreReport(result));
  } finally {
    db.close();
  }
}
