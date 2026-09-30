// server/lib/pce/transform-primitives.js
//
// PCE-1 — deterministic transformation primitives with pre/post/rollback.

import crypto from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { isWithinRoot } from "../safe-path.js";
import { invalidateAstCache } from "./ast-cache.js";

export const PRIMITIVES = Object.freeze([
  "CREATE_FILE", "DELETE_FILE", "ADD_EXPORT", "ADD_IMPORT", "RENAME_SYMBOL",
  "SEARCH_REPLACE", "APPLY_PATTERN",
]);

function txId() {
  return `pce_tx_${crypto.randomUUID().slice(0, 12)}`;
}

function absPath(repoRoot, filePath) {
  const abs = join(repoRoot, filePath);
  if (!isWithinRoot(repoRoot, abs)) throw new Error("path_outside_repo");
  return abs;
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function logTransform(db, entry) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO pce_transform_log
        (id, mission_id, pattern_id, primitive, file_path, before_hash, after_hash, rollback_json, risk, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id || txId(),
      entry.missionId || null,
      entry.patternId || null,
      entry.primitive,
      entry.filePath || null,
      entry.beforeHash || null,
      entry.afterHash || null,
      entry.rollback ? JSON.stringify(entry.rollback) : null,
      entry.risk || "low",
      entry.status || "applied",
    );
  } catch { /* migration optional */ }
}

export function createFile({ db, repoRoot, filePath, content, missionId, patternId } = {}) {
  const abs = absPath(repoRoot, filePath);
  if (existsSync(abs)) return { ok: false, reason: "file_exists", filePath };
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  invalidateAstCache(db, repoRoot, [filePath]);
  const entry = {
    primitive: "CREATE_FILE",
    filePath,
    beforeHash: null,
    afterHash: hashContent(content),
    rollback: { op: "DELETE_FILE", filePath },
    missionId,
    patternId,
  };
  logTransform(db, entry);
  return { ok: true, primitive: "CREATE_FILE", filePath, rollback: entry.rollback };
}

export function deleteFile({ db, repoRoot, filePath, missionId } = {}) {
  const abs = absPath(repoRoot, filePath);
  if (!existsSync(abs)) return { ok: false, reason: "not_found", filePath };
  const prior = readFileSync(abs, "utf8");
  unlinkSync(abs);
  invalidateAstCache(db, repoRoot, [filePath]);
  logTransform(db, {
    primitive: "DELETE_FILE",
    filePath,
    beforeHash: hashContent(prior),
    rollback: { op: "CREATE_FILE", filePath, content: prior },
    missionId,
  });
  return { ok: true, primitive: "DELETE_FILE", filePath };
}

export function searchReplace({ db, repoRoot, filePath, search, replace, missionId, patternId } = {}) {
  const abs = absPath(repoRoot, filePath);
  const prior = readFileSync(abs, "utf8");
  if (!prior.includes(search)) {
    return { ok: false, reason: "search_not_found", filePath };
  }
  const next = prior.replace(search, replace);
  if (next === prior) return { ok: false, reason: "no_change", filePath };
  writeFileSync(abs, next, "utf8");
  invalidateAstCache(db, repoRoot, [filePath]);
  logTransform(db, {
    primitive: "SEARCH_REPLACE",
    filePath,
    beforeHash: hashContent(prior),
    afterHash: hashContent(next),
    rollback: { op: "SEARCH_REPLACE", filePath, search: replace, replace: search },
    missionId,
    patternId,
  });
  return { ok: true, primitive: "SEARCH_REPLACE", filePath, rollback: { op: "SEARCH_REPLACE", filePath, search: replace, replace: search } };
}

export function renameSymbol({ db, repoRoot, filePath, from, to, missionId } = {}) {
  if (!from || !to || from === to) return { ok: false, reason: "invalid_rename" };
  const abs = absPath(repoRoot, filePath);
  const prior = readFileSync(abs, "utf8");
  const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  if (!re.test(prior)) return { ok: false, reason: "symbol_not_found", filePath, from };
  const next = prior.replace(re, to);
  writeFileSync(abs, next, "utf8");
  invalidateAstCache(db, repoRoot, [filePath]);
  logTransform(db, {
    primitive: "RENAME_SYMBOL",
    filePath,
    beforeHash: hashContent(prior),
    afterHash: hashContent(next),
    rollback: { op: "RENAME_SYMBOL", filePath, from: to, to: from },
    missionId,
    risk: "medium",
  });
  return { ok: true, primitive: "RENAME_SYMBOL", filePath, rollback: { op: "RENAME_SYMBOL", filePath, from: to, to: from } };
}

export function addExport({ db, repoRoot, filePath, exportLine, missionId } = {}) {
  const abs = absPath(repoRoot, filePath);
  const prior = readFileSync(abs, "utf8");
  if (prior.includes(exportLine.trim())) return { ok: true, primitive: "ADD_EXPORT", skipped: true, filePath };
  const next = `${prior.trimEnd()}\n${exportLine}\n`;
  writeFileSync(abs, next, "utf8");
  invalidateAstCache(db, repoRoot, [filePath]);
  logTransform(db, {
    primitive: "ADD_EXPORT",
    filePath,
    beforeHash: hashContent(prior),
    afterHash: hashContent(next),
    rollback: { op: "SEARCH_REPLACE", filePath, search: `\n${exportLine}\n`, replace: "\n" },
    missionId,
  });
  return { ok: true, primitive: "ADD_EXPORT", filePath };
}

export function rollbackTransform({ db, repoRoot, rollback, missionId } = {}) {
  if (!rollback?.op) return { ok: false, reason: "invalid_rollback" };
  switch (rollback.op) {
    case "DELETE_FILE":
      return deleteFile({ db, repoRoot, filePath: rollback.filePath, missionId });
    case "CREATE_FILE":
      return createFile({ db, repoRoot, filePath: rollback.filePath, content: rollback.content, missionId });
    case "SEARCH_REPLACE":
      return searchReplace({
        db, repoRoot,
        filePath: rollback.filePath,
        search: rollback.search,
        replace: rollback.replace,
        missionId,
      });
    case "RENAME_SYMBOL":
      return renameSymbol({
        db, repoRoot,
        filePath: rollback.filePath,
        from: rollback.from,
        to: rollback.to,
        missionId,
      });
    default:
      return { ok: false, reason: "unknown_rollback_op", op: rollback.op };
  }
}

export function applyPrimitive(spec, ctx = {}) {
  const { primitive, args = {} } = spec;
  const base = { ...ctx, ...args };
  switch (primitive) {
    case "CREATE_FILE": return createFile(base);
    case "DELETE_FILE": return deleteFile(base);
    case "SEARCH_REPLACE": return searchReplace(base);
    case "RENAME_SYMBOL": return renameSymbol(base);
    case "ADD_EXPORT": return addExport(base);
    default:
      return { ok: false, reason: "unknown_primitive", primitive };
  }
}

export function applyTransformPlan(plan, ctx = {}) {
  const results = [];
  const rollbacks = [];
  for (const step of plan.steps || []) {
    const r = applyPrimitive(step, ctx);
    results.push(r);
    if (!r.ok) {
      for (const rb of rollbacks.reverse()) {
        rollbackTransform({ ...ctx, rollback: rb });
      }
      return { ok: false, reason: "transform_failed", failed: step, results };
    }
    if (r.rollback) rollbacks.push(r.rollback);
  }
  return { ok: true, results, rollbacks };
}
