// server/lib/notebook.js
//
// V1.2 Wave E grounding audit — cross-domain reproducible notebooks
// (migration 384_cross_domain_notebooks.js).
//
// Real per-domain "lab notebook" logs already exist and are genuinely real
// (they are NOT reimplemented or duplicated here):
//   - server/domains/chem.js    notebook-add/list/delete   (in-memory Map)
//   - server/domains/bio.js     notebook-create/list/…     (in-memory Map)
//   - server/domains/science.js notebook-add/update/…      (in-memory Map)
//   - server/domains/lab.js     notebook-create/…           (SQL, org-scoped)
// None of them compose across domains, and none of them carry real
// reproducibility (re-invoking the SAME macro call and comparing outputs)
// or real DTU lineage. This module is the composition layer: a notebook is
// a durable, user-owned container of "cells", where a cell is a REAL
// macro-call record — the actual (domain, action, input) the user asked
// for, dispatched through the SAME internal macro-invocation mechanism
// every other cross-macro caller in this codebase uses (`ctx.macro.run`,
// see server.js:15477/15666 `makeCtx`/`makeInternalCtx` — the identical
// pattern `server/lib/forge-marketplace.js#listForgeAppOnMarketplace` and
// dozens of `ctx.macro.run(...)` call sites in server.js already use to
// call one macro from inside another) — never a parallel dispatcher.
//
// Honesty invariants (this module, not just the domain wrapper):
//   - A cell's `output_json` is the REAL macro result, verbatim. Never a
//     fabricated or guessed value.
//   - `output_dtu_id` is populated ONLY when the macro's own result
//     genuinely carries a resolvable DTU id (see `extractDtuId` below) —
//     an honest `null` is correct and expected for most macro calls.
//   - `replayCell` re-invokes the EXACT SAME (domain, action, input) an
//     earlier cell recorded, and its `matched` verdict is a REAL
//     canonical-JSON equality check against that cell's REAL recorded
//     output — never an assumed/guessed match. A macro call that throws,
//     or a domain/action that no longer exists, is recorded as an honest
//     failure (`ok:false`, real error message), never a fabricated
//     success.
//
// `ctx.macro.run` only reaches macros registered via `register()` (the
// `MACROS` map) — NOT `registerLensAction()` handlers (the `LENS_ACTIONS`
// map, e.g. the math-domain CAS). This is an existing, documented split in
// this codebase (see server.js's `runMcpTool` comment at the MCP-tool
// dispatch site) — `runMacro`/`ctx.macro.run` alone cannot see LENS_ACTIONS
// handlers. A notebook cell can therefore compose any `register()`-based
// macro (the majority of the ~9,600 macro pairs in this codebase — dtu.*,
// verify.*, economy.*, and hundreds of domain files), but not a
// LENS_ACTIONS-only one. This is a real, honestly-documented limitation,
// not a bug in this module.

import crypto from "node:crypto";
import { canonicalStringify } from "./dtu-portability.js";
import { registerCitation } from "../economy/royalty-cascade.js";
import { readAndHydrateDtu } from "./dtu-shadow-hydrate.js";

const TITLE_MAX_LEN = 200;
const DESCRIPTION_MAX_LEN = 2000;

function newNotebookId() {
  return `nb_${crypto.randomUUID().slice(0, 16)}`;
}
function newCellId() {
  return `nbc_${crypto.randomUUID().slice(0, 16)}`;
}

function safeParse(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function notebookRow(db, notebookId) {
  return db.prepare(`
    SELECT id, owner_user_id AS ownerUserId, title, description,
           created_at AS createdAt, updated_at AS updatedAt
    FROM notebooks WHERE id = ?
  `).get(notebookId);
}

function cellRow(db, cellId) {
  const r = db.prepare(`
    SELECT id, notebook_id AS notebookId, position, domain, action,
           input_json AS inputJson, output_json AS outputJson, ok, error,
           output_dtu_id AS outputDtuId, replay_of_cell_id AS replayOfCellId,
           executed_at AS executedAt
    FROM notebook_cells WHERE id = ?
  `).get(cellId);
  return r ? hydrateCell(r) : null;
}

function hydrateCell(r) {
  return {
    id: r.id,
    notebookId: r.notebookId,
    position: r.position,
    domain: r.domain,
    action: r.action,
    input: safeParse(r.inputJson, {}),
    output: safeParse(r.outputJson, null),
    ok: !!r.ok,
    error: r.error || null,
    outputDtuId: r.outputDtuId || null,
    replayOfCellId: r.replayOfCellId || null,
    executedAt: r.executedAt,
  };
}

/**
 * Pure heuristic: does a macro result genuinely carry a resolvable DTU id?
 * Only recognizes well-known, unambiguous field shapes actually produced by
 * real macros in this codebase (`dtu.create` → `{ ok, dtu:{id,...} }`,
 * `forge_marketplace.mint` / `conkay.*` / `dreams.*` → `{ ok, dtuId }`, and
 * the same two shapes nested one level under `.result` for macros that wrap
 * their payload). Deliberately does NOT collapse a multi-id shape (e.g.
 * `{ dtuIds: [...] }`, used by the free-API ingestion macros) to a single
 * id — picking one would be an arbitrary, dishonest choice; `null` is the
 * honest answer for those.
 *
 * Exported so the domain layer + tests can assert this heuristic directly.
 */
export function extractDtuId(output) {
  if (!output || typeof output !== "object") return null;
  const direct =
    (typeof output.dtuId === "string" && output.dtuId) ||
    (output.dtu && typeof output.dtu === "object" && typeof output.dtu.id === "string" && output.dtu.id) ||
    null;
  if (direct) return direct;
  const nested = output.result && typeof output.result === "object" ? output.result : null;
  if (nested) {
    if (typeof nested.dtuId === "string") return nested.dtuId;
    if (nested.dtu && typeof nested.dtu === "object" && typeof nested.dtu.id === "string") return nested.dtu.id;
  }
  return null;
}

/** Best-effort lookup of a parent DTU for the optional citation feature,
 *  checking the live in-memory STATE.dtus map first (most DTUs minted via
 *  `dtu.create` live only there), then falling back to
 *  `readAndHydrateDtu` (server/lib/dtu-shadow-hydrate.js, Wave C) — the
 *  established reader for a DTU that only exists as a raw SQL `dtus` row
 *  (e.g. minted by a macro that writes SQL directly rather than through
 *  `dtu.create`). Returns null, never guesses, when neither source has the
 *  id — the caller reports an honest `parent_not_found`. */
function resolveParentDtu(db, dtusMap, dtuId) {
  if (!dtuId) return null;
  if (dtusMap && typeof dtusMap.get === "function") {
    const d = dtusMap.get(dtuId);
    if (d) return d;
  }
  return readAndHydrateDtu(db, dtuId);
}

/** Create a named notebook (a container for cross-domain macro-call cells). */
export function createNotebook(db, userId, title, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const uid = String(userId || "").trim();
  const trimmedTitle = String(title || "").trim().slice(0, TITLE_MAX_LEN);
  if (!uid) return { ok: false, reason: "no_user" };
  if (!trimmedTitle) return { ok: false, reason: "missing_title" };
  const description = String(opts.description || "").trim().slice(0, DESCRIPTION_MAX_LEN);

  const id = newNotebookId();
  try {
    db.prepare(`
      INSERT INTO notebooks (id, owner_user_id, title, description) VALUES (?, ?, ?, ?)
    `).run(id, uid, trimmedTitle, description);
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, notebook: notebookRow(db, id) };
}

/** List a user's notebooks, newest-updated first, with a cheap cell count. */
export function listNotebooks(db, userId, opts = {}) {
  if (!db || !userId) return [];
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const rows = db.prepare(`
    SELECT id, title, description, created_at AS createdAt, updated_at AS updatedAt
    FROM notebooks WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT ?
  `).all(String(userId), limit);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");
  const counts = db.prepare(`
    SELECT notebook_id AS nid, COUNT(*) AS n FROM notebook_cells WHERE notebook_id IN (${ph}) GROUP BY notebook_id
  `).all(...ids);
  const cmap = new Map(counts.map((c) => [c.nid, c.n]));
  return rows.map((r) => ({ ...r, cellCount: cmap.get(r.id) || 0 }));
}

/** Fetch a notebook + all its real cells, in position order. Ownership-
 *  checked — never returns another user's notebook. */
export function getNotebook(db, userId, notebookId) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId) return { ok: false, reason: "no_user" };
  if (!notebookId) return { ok: false, reason: "missing_notebook_id" };

  const row = notebookRow(db, notebookId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.ownerUserId !== String(userId)) return { ok: false, reason: "not_owned" };

  const cellRows = db.prepare(`
    SELECT id, notebook_id AS notebookId, position, domain, action,
           input_json AS inputJson, output_json AS outputJson, ok, error,
           output_dtu_id AS outputDtuId, replay_of_cell_id AS replayOfCellId,
           executed_at AS executedAt
    FROM notebook_cells WHERE notebook_id = ? ORDER BY position ASC
  `).all(notebookId);

  return { ok: true, notebook: row, cells: cellRows.map(hydrateCell) };
}

function nextPosition(db, notebookId) {
  const r = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM notebook_cells WHERE notebook_id = ?`).get(notebookId);
  return r.next;
}

function insertCell(db, { notebookId, domain, action, input, macroResult, replayOfCellId }) {
  const id = newCellId();
  const ok = macroResult.threw ? false : (macroResult.value?.ok !== false);
  const outputValue = macroResult.threw ? null : (macroResult.value ?? null);
  const error = macroResult.threw
    ? String(macroResult.error?.message || macroResult.error || "macro_call_threw")
    : (ok ? null : String(outputValue?.error || outputValue?.reason || "macro_returned_not_ok"));
  const outputDtuId = ok ? extractDtuId(outputValue) : null;

  db.prepare(`
    INSERT INTO notebook_cells
      (id, notebook_id, position, domain, action, input_json, output_json, ok, error, output_dtu_id, replay_of_cell_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, notebookId, nextPosition(db, notebookId), domain, action,
    JSON.stringify(input ?? {}), JSON.stringify(outputValue),
    ok ? 1 : 0, error, outputDtuId, replayOfCellId || null,
  );
  db.prepare(`UPDATE notebooks SET updated_at = unixepoch() WHERE id = ?`).run(notebookId);
  return cellRow(db, id);
}

/**
 * Execute a REAL macro call and record it as a new cell.
 *
 * `macroRun` is the caller's live `ctx.macro.run` (or any function with the
 * same `(domain, action, input) => Promise<result>` shape) — this module
 * never invents its own dispatcher, it only wraps whatever the caller's
 * real macro runtime already is.
 *
 * Optional `opts.citeParentDtuId`: when the call produced a genuine
 * `output_dtu_id` AND the caller explicitly names an existing DTU it wants
 * cited as this cell's source, register a REAL citation via the same
 * `registerCitation` the rest of the platform's royalty cascade uses. This
 * is never inferred/auto-guessed from cell adjacency — only an explicit,
 * caller-declared citation intent is honored. Best-effort: a citation
 * failure (consent not granted, parent not found, …) is reported in
 * `citation` but never blocks or corrupts the cell record itself.
 */
export async function addCell(db, userId, notebookId, { domain, action, input = {} } = {}, macroRun, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId) return { ok: false, reason: "no_user" };
  if (!notebookId) return { ok: false, reason: "missing_notebook_id" };
  if (typeof macroRun !== "function") return { ok: false, reason: "no_macro_runtime" };
  const d = String(domain || "").trim();
  const a = String(action || "").trim();
  if (!d || !a) return { ok: false, reason: "missing_domain_or_action" };

  const nb = notebookRow(db, notebookId);
  if (!nb) return { ok: false, reason: "notebook_not_found" };
  if (nb.ownerUserId !== String(userId)) return { ok: false, reason: "not_owned" };

  const macroResult = await (async () => {
    try {
      const value = await macroRun(d, a, input);
      return { threw: false, value };
    } catch (error) {
      return { threw: true, error };
    }
  })();

  const cell = insertCell(db, { notebookId, domain: d, action: a, input, macroResult });

  let citation = null;
  if (cell.outputDtuId && opts.citeParentDtuId) {
    const parentId = String(opts.citeParentDtuId);
    const parentDtu = resolveParentDtu(db, opts.dtus, parentId);
    const parentCreatorId = parentDtu?.ownerId || parentDtu?.creatorId || parentDtu?.owner_user_id || parentDtu?.creator_id || null;
    if (!parentDtu || !parentCreatorId) {
      citation = { ok: false, reason: "parent_not_found" };
    } else {
      try {
        citation = registerCitation(db, {
          childId: cell.outputDtuId,
          parentId,
          creatorId: String(userId),
          parentCreatorId,
          parentDtu,
          generation: 1,
        });
      } catch (e) {
        citation = { ok: false, reason: "citation_call_failed", error: String(e?.message || e) };
      }
    }
  }

  return { ok: true, cell, citation };
}

/**
 * Re-invoke the EXACT (domain, action, input) an earlier cell recorded,
 * record the new call as a fresh cell (`replayOfCellId` set), and return an
 * honest comparison against the original cell's REAL recorded output. Never
 * fabricates a "reproduced" verdict — `matched` is a real canonical-JSON
 * equality check, and a non-match reports which top-level keys actually
 * differ (best-effort description, not a guess).
 */
export async function replayCell(db, userId, notebookId, cellId, macroRun) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId) return { ok: false, reason: "no_user" };
  if (!notebookId || !cellId) return { ok: false, reason: "missing_ids" };
  if (typeof macroRun !== "function") return { ok: false, reason: "no_macro_runtime" };

  const nb = notebookRow(db, notebookId);
  if (!nb) return { ok: false, reason: "notebook_not_found" };
  if (nb.ownerUserId !== String(userId)) return { ok: false, reason: "not_owned" };

  const original = cellRow(db, cellId);
  if (!original || original.notebookId !== notebookId) return { ok: false, reason: "cell_not_found" };

  const macroResult = await (async () => {
    try {
      const value = await macroRun(original.domain, original.action, original.input);
      return { threw: false, value };
    } catch (error) {
      return { threw: true, error };
    }
  })();

  const newCell = insertCell(db, {
    notebookId, domain: original.domain, action: original.action, input: original.input,
    macroResult, replayOfCellId: original.id,
  });

  const originalFingerprint = canonicalStringify({ ok: original.ok, output: original.output });
  const newFingerprint = canonicalStringify({ ok: newCell.ok, output: newCell.output });
  const matched = originalFingerprint === newFingerprint;

  let diff = null;
  if (!matched) {
    const oldKeys = original.output && typeof original.output === "object" ? Object.keys(original.output) : [];
    const newKeys = newCell.output && typeof newCell.output === "object" ? Object.keys(newCell.output) : [];
    const allKeys = Array.from(new Set([...oldKeys, ...newKeys]));
    const changedFields = allKeys.filter((k) => {
      const a = original.output?.[k];
      const b = newCell.output?.[k];
      return canonicalStringify(a ?? null) !== canonicalStringify(b ?? null);
    });
    diff = {
      okChanged: original.ok !== newCell.ok,
      changedFields,
      original: { ok: original.ok, output: original.output },
      replay: { ok: newCell.ok, output: newCell.output },
    };
  }

  return {
    ok: true,
    originalCellId: original.id,
    cell: newCell,
    replay: { matched, diff },
  };
}

export default {
  createNotebook, listNotebooks, getNotebook, addCell, replayCell, extractDtuId,
};
