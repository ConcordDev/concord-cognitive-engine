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
import { compileWorldspec, buildConcordLinkAnchor } from "../lib/foundry/compiler.js";
import { listTemplates, getTemplate } from "../lib/foundry/templates.js";
import {
  composeRuleDeterministic, validateRule, buildRulePrompt, parseRuleFromLLM,
} from "../lib/foundry/rules.js";

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

    // Worldspec source priority: an explicit worldspec, then a
    // templateId (Phase 6), then a blank slate. Templates are
    // normalized like any other spec so a stale template can't
    // corrupt anything.
    let worldspec;
    if (input && input.worldspec) {
      worldspec = normalizeWorldspec(input.worldspec);
    } else if (input && input.templateId) {
      const tpl = getTemplate(input.templateId);
      if (!tpl) return { ok: false, reason: "unknown_template", templateId: input.templateId };
      worldspec = normalizeWorldspec(tpl.worldspec);
    } else {
      worldspec = emptyWorldspec();
    }

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

  // ===== Phase 3 — Publish pipeline (overlay model) ==========================

  /**
   * foundry.publish — compile a draft worldspec into a real `worlds`
   * row. The hybrid model's "overlay" half: the published game IS a
   * first-class worlds row, driven by compiled rule_modulators /
   * physics_modulators rather than an authored content directory.
   *
   * Hard-gated: the worldspec must validate (errors block) and have at
   * least one non-stub system. Stub systems persist in the spec but
   * don't activate until Phase 7 flips their status.
   *
   * input: { id }
   * output: { ok, publishedWorldId, world, activatedSystems, skippedStubs, contentSeeds }
   */
  register("foundry", "publish", (ctx, input = {}) => {
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
      return { ok: false, reason: "already_published", publishedWorldId: row.published_world_id };
    }

    let rawSpec;
    try { rawSpec = JSON.parse(row.worldspec_json); }
    catch { rawSpec = emptyWorldspec(); }
    const validation = validateWorldspec(rawSpec);
    if (!validation.ok) {
      return { ok: false, reason: "worldspec_invalid", errors: validation.errors, warnings: validation.warnings };
    }
    const worldspec = validation.normalized;
    if (worldspec.systems.length === 0) {
      return { ok: false, reason: "no_systems", hint: "select at least one system before publishing" };
    }

    const compiled = compileWorldspec(worldspec);
    const worldId = `world-${randomUUID()}`;
    const now = Date.now();

    const publishTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO worlds
          (id, name, universe_type, description, physics_modulators, rule_modulators, created_by, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(
        worldId,
        row.name,
        worldspec.theme.universeType,
        row.description || worldspec.theme.displayName || "",
        JSON.stringify(compiled.physics_modulators),
        JSON.stringify(compiled.rule_modulators),
        creatorId,
      );

      // Concord Link anchor — best-effort; a missing table must not
      // abort the publish (the world is still valid without an anchor).
      if (compiled.concordLinkAnchor) {
        try {
          const a = buildConcordLinkAnchor(worldId, row.name, compiled.concordLinkAnchor);
          db.prepare(`
            INSERT INTO concord_link_anchors
              (id, world_id, name, access_method, description, location, controlled_by_faction, stability)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET access_method = excluded.access_method, stability = excluded.stability
          `).run(a.id, a.world_id, a.name, a.access_method, a.description, a.location, a.controlled_by_faction, a.stability);
        } catch (_e) { /* anchor table optional in some contexts */ }
      }

      db.prepare(`
        UPDATE foundry_worlds
        SET status = 'published', published_world_id = ?, updated_at = ?
        WHERE id = ?
      `).run(worldId, now, id);
    });

    try { publishTx(); }
    catch (e) { return { ok: false, reason: "publish_failed", error: String(e?.message || e) }; }

    const updated = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    return {
      ok: true,
      publishedWorldId: worldId,
      world: rowToWorld(updated),
      activatedSystems: compiled.activatedSystems,
      skippedStubs: compiled.skippedStubs, // stub systems — activate once Phase 7 ships
      contentSeeds: compiled.contentSeeds.map((c) => c.key), // declared; deep seeding is promote-tier
    };
  });

  /**
   * foundry.unpublish — take a published Foundry world back to draft.
   * The overlay `worlds` row is deleted if nobody has visited it, or
   * archived (status='archived') if it has visits — so live worlds
   * people have used are never silently destroyed. The Concord Link
   * anchor is removed best-effort.
   * input: { id }
   */
  register("foundry", "unpublish", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const creatorId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!creatorId) return { ok: false, reason: "no_actor" };
    const id = String((input && input.id) || "");
    if (!id) return { ok: false, reason: "missing_id" };

    const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.creator_id !== creatorId) return { ok: false, reason: "not_owner" };
    if (row.status !== "published" || !row.published_world_id) {
      return { ok: false, reason: "not_published" };
    }

    const worldId = row.published_world_id;
    let disposition = "deleted";
    const unpublishTx = db.transaction(() => {
      const w = db.prepare(`SELECT total_visits FROM worlds WHERE id = ?`).get(worldId);
      if (w && Number(w.total_visits) > 0) {
        db.prepare(`UPDATE worlds SET status = 'archived' WHERE id = ?`).run(worldId);
        disposition = "archived";
      } else if (w) {
        db.prepare(`DELETE FROM worlds WHERE id = ?`).run(worldId);
        disposition = "deleted";
      } else {
        disposition = "world_already_gone";
      }
      try { db.prepare(`DELETE FROM concord_link_anchors WHERE world_id = ?`).run(worldId); }
      catch (_e) { /* anchor table optional */ }
      db.prepare(`
        UPDATE foundry_worlds
        SET status = 'draft', published_world_id = NULL, updated_at = ?
        WHERE id = ?
      `).run(Date.now(), id);
    });

    try { unpublishTx(); }
    catch (e) { return { ok: false, reason: "unpublish_failed", error: String(e?.message || e) }; }

    const updated = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    return { ok: true, disposition, formerWorldId: worldId, world: rowToWorld(updated) };
  });

  // ===== Phase 5 — Live 3D preview ===========================================

  /**
   * foundry.preview — compile the current draft into a throwaway
   * `worlds` row (status='preview') the 3D renderer can load by id.
   * ConcordiaScene is hardwired to load-a-world-by-id, so the preview
   * IS a real (transient) world. Reuses an existing preview row when
   * one is already attached — never accumulates more than one per
   * foundry world. The foundry-preview-cleanup heartbeat sweeps any
   * that go stale (~2h).
   *
   * Forgiving by design: unlike publish this does NOT hard-gate on
   * validation — the compiler skips unknown/stub systems gracefully,
   * so you can preview a half-built world. Only an empty selection is
   * rejected (nothing to render).
   * input: { id }
   * output: { ok, previewWorldId, universeType, activatedSystems }
   */
  register("foundry", "preview", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const creatorId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!creatorId) return { ok: false, reason: "no_actor" };
    const id = String((input && input.id) || "");
    if (!id) return { ok: false, reason: "missing_id" };

    const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.creator_id !== creatorId) return { ok: false, reason: "not_owner" };

    let rawSpec;
    try { rawSpec = JSON.parse(row.worldspec_json); }
    catch { rawSpec = emptyWorldspec(); }
    const worldspec = normalizeWorldspec(rawSpec);
    if (worldspec.systems.length === 0) {
      return { ok: false, reason: "no_systems", hint: "add a system before previewing" };
    }

    const compiled = compileWorldspec(worldspec);
    const nowSec = Math.floor(Date.now() / 1000);
    const physJson = JSON.stringify(compiled.physics_modulators);
    const ruleJson = JSON.stringify(compiled.rule_modulators);
    const previewName = `${row.name} (preview)`;

    // Reuse an attached preview row if it still exists; else mint one.
    let previewWorldId = row.preview_world_id;
    const existing = previewWorldId
      ? db.prepare(`SELECT id FROM worlds WHERE id = ? AND status = 'preview'`).get(previewWorldId)
      : null;

    try {
      if (existing) {
        db.prepare(`
          UPDATE worlds
          SET name = ?, universe_type = ?, physics_modulators = ?, rule_modulators = ?, created_at = ?
          WHERE id = ?
        `).run(previewName, worldspec.theme.universeType, physJson, ruleJson, nowSec, previewWorldId);
      } else {
        previewWorldId = `preview-${randomUUID()}`;
        db.prepare(`
          INSERT INTO worlds
            (id, name, universe_type, description, physics_modulators, rule_modulators, created_by, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'preview', ?)
        `).run(
          previewWorldId, previewName, worldspec.theme.universeType,
          `Foundry live preview of ${row.name}.`, physJson, ruleJson, creatorId, nowSec,
        );
        db.prepare(`UPDATE foundry_worlds SET preview_world_id = ? WHERE id = ?`).run(previewWorldId, id);
      }
    } catch (e) {
      return { ok: false, reason: "preview_failed", error: String(e?.message || e) };
    }

    return {
      ok: true,
      previewWorldId,
      universeType: worldspec.theme.universeType,
      activatedSystems: compiled.activatedSystems,
      skippedStubs: compiled.skippedStubs,
    };
  });

  // ===== Phase 6 — templates + NL rules ======================================

  /**
   * foundry.templates — the game-template catalog. Each is a pre-filled
   * worldspec; foundry.create accepts a templateId to start from one.
   * input: {} — no args
   */
  register("foundry", "templates", () => {
    const templates = listTemplates();
    return { ok: true, count: templates.length, templates };
  });

  /**
   * foundry.compose_rule — translate a natural-language game rule into a
   * structured rule. Tries the conscious brain first; on any failure or
   * unparseable output it falls back to a deterministic keyword parse —
   * the macro ALWAYS returns a usable rule (brain-offline is not an
   * error here, same posture as the dream/forward-sim engines).
   *
   * If `id` is given, the composed rule is appended to that foundry
   * world's worldspec.rules[] and persisted. Otherwise the rule is just
   * returned for the canvas to hold client-side.
   * input: { naturalLanguage, id? }
   * output: { ok, rule, composedBy, warnings, saved? }
   */
  register("foundry", "compose_rule", async (ctx, input = {}) => {
    const nl = String((input && input.naturalLanguage) || "").trim();
    if (!nl) return { ok: false, reason: "missing_natural_language" };
    if (nl.length > 500) return { ok: false, reason: "rule_too_long" };

    // Try the LLM path; fall back to deterministic on any hiccup.
    let rule = null;
    try {
      if (ctx?.llm?.enabled && typeof ctx.llm.chat === "function") {
        const r = await ctx.llm.chat({
          system: "You convert plain-language game rules into strict JSON. Reply with JSON only.",
          messages: [{ role: "user", content: buildRulePrompt(nl) }],
          temperature: 0.2,
          maxTokens: 300,
          timeoutMs: 20000,
        });
        const text = r && (r.content || r.message?.content || r.text);
        if (r && r.ok !== false && text) rule = parseRuleFromLLM(nl, text);
      }
    } catch {
      rule = null; // deterministic fallback below
    }
    if (!rule) rule = composeRuleDeterministic(nl);

    const validated = validateRule(rule);
    if (!validated.ok) return { ok: false, reason: "rule_invalid", warnings: validated.warnings };
    rule = validated.rule;

    // Optionally persist onto a stored foundry world.
    let saved = false;
    const id = input && input.id ? String(input.id) : null;
    if (id) {
      const db = ctx?.db;
      const creatorId = ctx?.actor?.userId || ctx?.actor?.id;
      if (db && creatorId) {
        const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
        if (!row) return { ok: false, reason: "not_found" };
        if (row.creator_id !== creatorId) return { ok: false, reason: "not_owner" };
        let spec;
        try { spec = JSON.parse(row.worldspec_json); }
        catch { spec = emptyWorldspec(); }
        const normalized = normalizeWorldspec(spec);
        normalized.rules = [...normalized.rules, rule].slice(-200);
        db.prepare(`UPDATE foundry_worlds SET worldspec_json = ?, updated_at = ? WHERE id = ?`)
          .run(JSON.stringify(normalized), Date.now(), id);
        saved = true;
      }
    }

    return { ok: true, rule, composedBy: rule.composedBy, warnings: validated.warnings, saved };
  });

  /**
   * foundry.preview_end — tear down a foundry world's preview row.
   * Called when the builder closes the preview panel. Idempotent.
   * input: { id }
   */
  register("foundry", "preview_end", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const creatorId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!creatorId) return { ok: false, reason: "no_actor" };
    const id = String((input && input.id) || "");
    if (!id) return { ok: false, reason: "missing_id" };

    const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.creator_id !== creatorId) return { ok: false, reason: "not_owner" };
    if (!row.preview_world_id) return { ok: true, alreadyClear: true };

    try {
      db.prepare(`DELETE FROM worlds WHERE id = ? AND status = 'preview'`).run(row.preview_world_id);
      db.prepare(`UPDATE foundry_worlds SET preview_world_id = NULL WHERE id = ?`).run(id);
    } catch (e) {
      return { ok: false, reason: "preview_end_failed", error: String(e?.message || e) };
    }
    return { ok: true };
  });
}
