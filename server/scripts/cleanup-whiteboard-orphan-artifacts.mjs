#!/usr/bin/env node
// Dry-run cleanup for whiteboard lens artifacts left behind when a board
// was deleted. Default is read-only. Pass --apply to delete the orphan
// rows from SQLite.
//
// This does not start the server and does not talk to production. Point
// --db at a copy. A process that already has the database open keeps its
// in-memory artifacts until it restarts, so run --apply while that
// process is stopped.
//
//   node server/scripts/cleanup-whiteboard-orphan-artifacts.mjs --db /path/to/concord.db
//   node server/scripts/cleanup-whiteboard-orphan-artifacts.mjs --db /path/to/concord.db --apply

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyOrphanBoardArtifacts } from "../lib/whiteboard-board-artifacts.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dbFlag = args.indexOf("--db");
const dbPath = dbFlag >= 0 && args[dbFlag + 1]
  ? args[dbFlag + 1]
  : (process.env.DB_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "concord.db"));

function parseRow(row) {
  let obj = {};
  try { obj = JSON.parse(row.data || "{}"); }
  catch { obj = {}; }
  if (!obj || typeof obj !== "object") obj = {};
  if (!obj.id && row.id) obj.id = row.id;
  if (!obj.ownerId && (row.owner_id || row.owner_user_id)) obj.ownerId = row.owner_id || row.owner_user_id;
  if (!obj.title && row.title) obj.title = row.title;
  if (row.domain && !obj.domain) obj.domain = row.domain;
  if (row.type && !obj.type) obj.type = row.type;
  return obj;
}

function loadAll(db, sql, fallbackSql) {
  try { return db.prepare(sql).all(); }
  catch {
    if (!fallbackSql) return [];
    try { return db.prepare(fallbackSql).all(); }
    catch { return []; }
  }
}

// Prefer the JSON kind over the kind column. A stale or empty kind column
// must not make a live board look missing, or --apply would delete its shadow.

const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
try {
  const boardRows = loadAll(
    db,
    "SELECT id, owner_user_id, title, data FROM dtu_store",
    "SELECT id, data FROM dtu_store",
  );
  const artifactRows = loadAll(
    db,
    "SELECT id, domain, type, owner_id, title, data FROM lens_artifact_store WHERE domain = 'whiteboard' AND type = 'board'",
    null,
  );
  const boards = boardRows.map(parseRow).filter((b) => (b.machine?.kind || b.kind) === "whiteboard");
  const artifacts = artifactRows.map(parseRow);
  const { orphans, kept } = classifyOrphanBoardArtifacts(artifacts, boards);
  const boardKept = kept.filter((k) => k.reason !== "not_a_board_artifact");

  console.log(`db: ${dbPath}`);
  console.log(`mode: ${apply ? "apply" : "dry-run"}`);
  console.log(`board artifacts: ${artifacts.length}`);
  console.log(`orphans: ${orphans.length}`);
  for (const { artifact, reason } of orphans) {
    console.log(`  ${artifact.id}\t${reason}\t${JSON.stringify(artifact.title || "")}`);
  }
  console.log(`kept board artifacts: ${boardKept.length}`);
  for (const { artifact, reason } of boardKept) {
    console.log(`  ${artifact.id}\t${reason}\t${JSON.stringify(artifact.title || "")}`);
  }

  if (!apply) {
    console.log("no rows deleted");
  } else if (orphans.length === 0) {
    console.log("deleted: 0");
  } else {
    const del = db.prepare("DELETE FROM lens_artifact_store WHERE id = ? AND domain = 'whiteboard' AND type = 'board'");
    const removed = db.transaction((rows) => {
      let n = 0;
      for (const { artifact } of rows) n += del.run(String(artifact.id)).changes;
      return n;
    })(orphans);
    console.log(`deleted: ${removed}`);
  }
} finally {
  db.close();
}
