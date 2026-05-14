// server/domains/foundry.js
//
// Foundry — no-code game-builder lens (#66). Macro surface.
//
// Phase 1 — System Registry read surface (foundry.systems /
//   system_schema / validate_systems).
// Phase 2 — Worldspec persistence: foundry.{create,update,get,list,
//   delete,validate} backed by the foundry_worlds table (migration 191).
//
// Later phases extend this file: Phase 3 adds foundry.publish, Phase 5
// adds foundry.preview, Phase 6 adds foundry.compose_rule.

import { randomUUID } from "node:crypto";

import {
  SYSTEM_REGISTRY,
  CATEGORY_LABELS,
  getSystem,
  listSystems,
  systemsByCategory,
  getConfigSchema,
  validateSystemSelection,
} from "../lib/foundry/system-registry.js";
import {
  emptyWorldspec,
  normalizeWorldspec,
  validateWorldspec,
} from "../lib/foundry/worldspec.js";

// ── Row <-> API shape ───────────────────────────────────────────────────────
function rowToWorld(row) {
  if (!row) return null;
  let worldspec;
  try { worldspec = JSON.parse(row.worldspec_json); }
  catch { worldspec = emptyWorldspec(); }
  return {
    id: row.id,
    creatorId: row.creator_id,
    name: row.name,
    description: row.description || "",
    worldspec,
    status: row.status,
    publishedWorldId: row.published_world_id || null,
    previewWorldId: row.preview_world_id || null,
    promoted: !!row.promoted,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default function registerFoundryMacros(register) {
  // ===== Phase 1 — System Registry read surface ==============================

  /**
   * foundry.systems — the full composable-system catalog. The Foundry
   * canvas renders its palette straight off this.
   * input: { category? } — optional category filter
   */
  register("foundry", "systems", (_ctx, input = {}) => {
    const category = input && input.category ? String(input.category) : null;
    if (category && !CATEGORY_LABELS[category]) {
      return { ok: false, reason: "unknown_category", category };
    }
    const systems = listSystems(category ? { category } : {});
    return {
      ok: true,
      count: systems.length,
      total: SYSTEM_REGISTRY.length,
      categories: systemsByCategory(),
      systems,
    };
  });

  /**
   * foundry.system_schema — the config schema + metadata for one system.
   * input: { id }
   */
  register("foundry", "system_schema", (_ctx, input = {}) => {
    const id = input && input.id ? String(input.id) : null;
    if (!id) return { ok: false, reason: "missing_id" };
    const sys = getSystem(id);
    if (!sys) return { ok: false, reason: "unknown_system", id };
    return {
      ok: true,
      id,
      displayName: sys.displayName,
      description: sys.description,
      category: sys.category,
      worldScope: sys.worldScope,
      status: sys.status,
      activation: sys.activation,
      dependsOn: sys.dependsOn,
      conflictsWith: sys.conflictsWith,
      configSchema: getConfigSchema(id),
    };
  });

  /**
   * foundry.validate_systems — dependency/conflict/config check on a bare
   * system selection (no worldspec envelope). The canvas calls this live.
   * input: { systems: [{ id, config? }] }
   */
  register("foundry", "validate_systems", (_ctx, input = {}) => {
    const systems = (input && input.systems) || [];
    const result = validateSystemSelection(systems);
    return { ok: result.ok, errors: result.errors, warnings: result.warnings, resolved: result.resolved };
  });

  // ===== Phase 2 — Worldspec persistence =====================================

  /**
   * foundry.create — start a new draft game/world.
   * input: { name, description?, worldspec? }
   * The worldspec is normalized (defaults filled, unknown keys dropped);
   * validation is advisory at create time and hard-gated at publish.
   */
  register("foundry", "create", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const creatorId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!creatorId) return { ok: false, reason: "no_actor" };

    const name = String((input && input.name) || "").trim();
    if (!name) return { ok: false, reason: "missing_name" };
    if (name.length > 200) return { ok: false, reason: "name_too_long" };
    const description = String((input && input.description) || "").slice(0, 2000);

    const worldspec = input && input.worldspec
      ? normalizeWorldspec(input.worldspec)
      : emptyWorldspec();

    const id = `fw_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const now = Date.now();
    try {
      db.prepare(`
        INSERT INTO foundry_worlds
          (id, creator_id, name, description, worldspec_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
      `).run(id, creatorId, name, description, JSON.stringify(worldspec), now, now);
    } catch (e) {
      return { ok: false, reason: "create_failed", error: String(e?.message || e) };
    }
    const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    return { ok: true, world: rowToWorld(row) };
  });

  /**
   * foundry.update — patch a draft/published world's name, description,
   * or worldspec. Creator-scoped. Publishing is a separate macro (Phase
   * 3) — updating the worldspec of a published world does NOT re-publish
   * it; the live world keeps its current config until republish.
   * input: { id, name?, description?, worldspec? }
   */
  register("foundry", "update", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const creatorId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!creatorId) return { ok: false, reason: "no_actor" };
    const id = String((input && input.id) || "");
    if (!id) return { ok: false, reason: "missing_id" };

    const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.creator_id !== creatorId) return { ok: false, reason: "not_owner" };

    const sets = [];
    const params = [];
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) return { ok: false, reason: "missing_name" };
      if (name.length > 200) return { ok: false, reason: "name_too_long" };
      sets.push("name = ?"); params.push(name);
    }
    if (input.description !== undefined) {
      sets.push("description = ?"); params.push(String(input.description).slice(0, 2000));
    }
    if (input.worldspec !== undefined) {
      sets.push("worldspec_json = ?"); params.push(JSON.stringify(normalizeWorldspec(input.worldspec)));
    }
    if (sets.length === 0) return { ok: false, reason: "nothing_to_update" };

    sets.push("updated_at = ?"); params.push(Date.now());
    params.push(id);
    try {
      db.prepare(`UPDATE foundry_worlds SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    } catch (e) {
      return { ok: false, reason: "update_failed", error: String(e?.message || e) };
    }
    const updated = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    return { ok: true, world: rowToWorld(updated) };
  });

  /**
   * foundry.get — load one foundry world. Creator-scoped for now;
   * published-world discovery for non-creators lands with the publish
   * pipeline.
   * input: { id }
   */
  register("foundry", "get", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const creatorId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!creatorId) return { ok: false, reason: "no_actor" };
    const id = String((input && input.id) || "");
    if (!id) return { ok: false, reason: "missing_id" };

    const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.creator_id !== creatorId) return { ok: false, reason: "not_owner" };
    return { ok: true, world: rowToWorld(row) };
  });

  /**
   * foundry.list — the caller's foundry worlds, newest-updated first.
   * input: { limit? }
   */
  register("foundry", "list", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const creatorId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!creatorId) return { ok: false, reason: "no_actor" };
    const limit = Math.min(Math.max(Number(input && input.limit) || 50, 1), 200);

    const rows = db.prepare(`
      SELECT * FROM foundry_worlds WHERE creator_id = ?
      ORDER BY updated_at DESC LIMIT ?
    `).all(creatorId, limit);
    return { ok: true, count: rows.length, worlds: rows.map(rowToWorld) };
  });

  /**
   * foundry.delete — remove a foundry world. Creator-scoped. Published
   * worlds are blocked: deleting one would orphan the live `worlds` row.
   * Unpublish (Phase 3) before delete.
   * input: { id }
   */
  register("foundry", "delete", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const creatorId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!creatorId) return { ok: false, reason: "no_actor" };
    const id = String((input && input.id) || "");
    if (!id) return { ok: false, reason: "missing_id" };

    const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.creator_id !== creatorId) return { ok: false, reason: "not_owner" };
    if (row.status === "published" && row.published_world_id) {
      return { ok: false, reason: "world_published", hint: "unpublish before deleting" };
    }
    db.prepare(`DELETE FROM foundry_worlds WHERE id = ?`).run(id);
    return { ok: true, deleted: id };
  });

  /**
   * foundry.validate — full worldspec validation: envelope shape +
   * system dependency/conflict/config graph. Accepts either a stored
   * world ({ id }) or a bare worldspec ({ worldspec }). The Foundry
   * canvas calls this before enabling the Publish button.
   * input: { id } | { worldspec }
   * output: { ok, errors, warnings, normalized }
   */
  register("foundry", "validate", (ctx, input = {}) => {
    const db = ctx?.db;
    let worldspec = input && input.worldspec;
    if (!worldspec && input && input.id) {
      if (!db) return { ok: false, reason: "no_db" };
      const creatorId = ctx?.actor?.userId || ctx?.actor?.id;
      if (!creatorId) return { ok: false, reason: "no_actor" };
      const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(String(input.id));
      if (!row) return { ok: false, reason: "not_found" };
      if (row.creator_id !== creatorId) return { ok: false, reason: "not_owner" };
      try { worldspec = JSON.parse(row.worldspec_json); }
      catch { worldspec = emptyWorldspec(); }
    }
    if (!worldspec) return { ok: false, reason: "missing_worldspec_or_id" };

    const result = validateWorldspec(worldspec);
    return {
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
      normalized: result.normalized,
    };
  });
}
