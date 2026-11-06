// server/domains/maker.js
//
// Macro surface for the Maker lens's Bench (`/lenses/maker`).
//
// Review finding F5 (unscoped-shared-store-rendering): the Bench used to
// read app-maker's project store directly, so every object a user ever
// built in App Maker rendered here too, unlabelled, next to real makes.
// This domain gives the Bench its own table (migration 496) — a make can
// never be an app-maker project again, so there is nothing foreign left
// to label.
//
// Review findings F2 (name-only shell, no model) and F3 (no edit/rename/
// delete): `spec` is the one body field the review's floor asks for
// ("spec plus one body field beats the full Crafting field set left
// unbuilt") and `update` gives the Bench a real rename/edit path.
//
// All macros are owner-scoped: a make is readable/writable only by the
// user_id that created it.

import crypto from "node:crypto";
import { actorId as authzActorId } from "../lib/lens-authz.js";

function actorId(ctx) {
  return authzActorId(ctx);
}

function makeId() {
  return `make_${crypto.randomUUID().slice(0, 16)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clampStr(v, n) {
  if (v === undefined || v === null) return "";
  return String(v).slice(0, n);
}

function projectRow(row) {
  return {
    id: row.id,
    name: row.name,
    spec: row.spec || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default function registerMakerMacros(register) {
  /**
   * maker.create — start a new make. input: { name, spec? }
   */
  register("maker", "create", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const name = clampStr(input.name, 120).trim();
    if (!name) return { ok: false, reason: "no_name" };
    const spec = clampStr(input.spec, 4000).trim();
    const id = makeId();
    const ts = nowIso();
    try {
      db.prepare(
        `INSERT INTO maker_pieces (id, user_id, name, spec, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, userId, name, spec, ts, ts);
      return { ok: true, make: { id, name, spec, createdAt: ts, updatedAt: ts } };
    } catch (e) {
      return { ok: false, reason: e?.message || "create_failed" };
    }
  }, { note: "start a new make on the bench" });

  /**
   * maker.list — the calling user's own makes, newest first.
   */
  register("maker", "list", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    try {
      const rows = db
        .prepare(`SELECT * FROM maker_pieces WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500`)
        .all(userId);
      return { ok: true, makes: rows.map(projectRow) };
    } catch (e) {
      return { ok: true, makes: [], reason: e?.message };
    }
  }, { note: "list the calling user's makes" });

  /**
   * maker.update — rename and/or edit the spec of a make the caller owns.
   * input: { id, name?, spec? } — at least one of name/spec required.
   */
  register("maker", "update", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const id = clampStr(input.id, 64);
    if (!id) return { ok: false, reason: "no_id" };
    const hasName = input.name !== undefined;
    const hasSpec = input.spec !== undefined;
    if (!hasName && !hasSpec) return { ok: false, reason: "nothing_to_update" };
    const name = hasName ? clampStr(input.name, 120).trim() : null;
    if (hasName && !name) return { ok: false, reason: "no_name" };
    const spec = hasSpec ? clampStr(input.spec, 4000).trim() : null;
    try {
      const existing = db.prepare(`SELECT * FROM maker_pieces WHERE id = ? AND user_id = ?`).get(id, userId);
      if (!existing) return { ok: false, reason: "not_found" };
      const nextName = hasName ? name : existing.name;
      const nextSpec = hasSpec ? spec : existing.spec;
      const ts = nowIso();
      db.prepare(`UPDATE maker_pieces SET name = ?, spec = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(nextName, nextSpec, ts, id, userId);
      return { ok: true, make: { id, name: nextName, spec: nextSpec, createdAt: existing.created_at, updatedAt: ts } };
    } catch (e) {
      return { ok: false, reason: e?.message || "update_failed" };
    }
  }, { note: "rename or edit the spec of a make" });

  // ─── F5 fix return (2026-11-05): the displaced pre-build records ──
  // Before this domain existed, the Bench read/wrote through
  // app-maker's project store (projectCreate with a name only — no
  // template, no origin stamp). The build severed that read, so those
  // records still sit in STATE.appMakerLens.projects, invisible to
  // maker.list. They carry NO discriminator from genuine App Maker
  // projects (field-for-field identical), so no automatic migration
  // can honestly tell a make from an app — the owner is the only
  // discriminator. reclaimables names the caller's unreclaimed
  // app-maker projects on the Bench (origin carried); reclaim copies
  // ONE into maker_pieces at the owner's act and stamps the source
  // project so it is never re-offered. The project itself is not
  // deleted or altered in App Maker beyond that marker — no app
  // content (pages, workflows) can be destroyed by a reclaim.
  function appMakerProjects(userId) {
    const s = globalThis._concordSTATE?.appMakerLens;
    if (!s || !(s.projects instanceof Map)) return [];
    return s.projects.get(userId) || [];
  }

  /**
   * maker.reclaimables — the caller's app-maker projects not yet
   * imported onto the bench.
   */
  register("maker", "reclaimables", async (ctx) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const projects = appMakerProjects(userId)
      .filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim() && !p.reclaimedAsMake)
      .map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt || null }));
    return { ok: true, projects };
  }, { note: "the caller's pre-Bench records still sitting in App Maker" });

  /**
   * maker.reclaim — import one of the caller's app-maker projects
   * onto the bench as a make. input: { projectId }
   */
  register("maker", "reclaim", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const projectId = clampStr(input.projectId, 128);
    if (!projectId) return { ok: false, reason: "no_project" };
    const proj = appMakerProjects(userId).find((p) => p && p.id === projectId);
    if (!proj) return { ok: false, reason: "not_found" };
    if (proj.reclaimedAsMake) return { ok: false, reason: "already_reclaimed" };
    const name = clampStr(proj.name, 120).trim();
    if (!name) return { ok: false, reason: "no_name" };
    const id = makeId();
    const ts = nowIso();
    try {
      db.prepare(
        `INSERT INTO maker_pieces (id, user_id, name, spec, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, userId, name, "", ts, ts);
    } catch (e) {
      return { ok: false, reason: e?.message || "reclaim_failed" };
    }
    proj.reclaimedAsMake = id;
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
    }
    return { ok: true, make: { id, name, spec: "", createdAt: ts, updatedAt: ts } };
  }, { note: "import one of the caller's App Maker records onto the bench as a make" });

  /**
   * maker.delete — remove a make the caller owns.
   */
  register("maker", "delete", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const id = clampStr(input.id, 64);
    if (!id) return { ok: false, reason: "no_id" };
    try {
      const info = db.prepare(`DELETE FROM maker_pieces WHERE id = ? AND user_id = ?`).run(id, userId);
      if (info.changes < 1) return { ok: false, reason: "not_found" };
      return { ok: true, deleted: id };
    } catch (e) {
      return { ok: false, reason: e?.message || "delete_failed" };
    }
  }, { note: "remove a make from the bench" });
}
