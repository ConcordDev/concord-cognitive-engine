// server/domains/foundry.js
//
// Foundry — no-code game-builder lens (#125). Macro surface.
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
import {
  foundryState,
  validateBlueprint, normalizeBlueprint,
  BLUEPRINT_NODE_KINDS, BLUEPRINT_EVENT_TYPES, BLUEPRINT_ACTION_TYPES,
  validateAsset, ASSET_KINDS,
  normalizeMultiplayer, MATCHMAKING_MODES,
  summarizeAnalytics,
  COLLAB_ROLES,
} from "../lib/foundry/builder-extras.js";

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) before it can
// silently clamp through a Math.min/max bound. A caller that PASSES a numeric
// field at all must pass a finite, non-negative one — an absent field is fine
// (the macro uses its default). Returns null when clean, or the offending key.
// (Mirrors the fail-CLOSED guard in server/domains/literary.js.)
function badNumericField(input, keys) {
  if (!input || typeof input !== "object") return null;
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

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
    const badNum = badNumericField(input, ["limit"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
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

  // ===== Phase 8 — Roblox-Studio-parity builder extensions ===================
  //
  // The seven net-new features below close the Foundry feature-gap vs
  // Roblox Studio / GameMaker. Each macro is creator-scoped against the
  // foundry_worlds row and never throws — try/catch wraps every body.
  // Auxiliary state (blueprints, playtests, assets, ratings, analytics,
  // collaborators) lives in foundryState() (globalThis._concordSTATE);
  // foundry_worlds rows remain the source of truth for the worldspec.

  /** Resolve + creator-or-collaborator-gate a foundry world. */
  function loadWorldForBuilder(ctx, id, { needWrite = false } = {}) {
    const db = ctx?.db;
    if (!db) return { error: { ok: false, reason: "no_db" } };
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!userId) return { error: { ok: false, reason: "no_actor" } };
    if (!id) return { error: { ok: false, reason: "missing_id" } };
    const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(String(id));
    if (!row) return { error: { ok: false, reason: "not_found" } };
    const isOwner = row.creator_id === userId;
    let role = isOwner ? "owner" : null;
    if (!isOwner) {
      const collab = foundryState().collaborators.get(row.id);
      role = collab && collab.has(userId) ? collab.get(userId).role : null;
      if (!role) return { error: { ok: false, reason: "not_owner" } };
      if (needWrite && role !== "editor") return { error: { ok: false, reason: "viewer_cannot_edit" } };
    }
    return { db, userId, row, role, isOwner };
  }

  // ── 1. Visual scripting / blueprint editor ────────────────────────────────

  /**
   * foundry.blueprint_kinds — the node-kind / event / action vocabulary
   * the blueprint editor renders its node palette from.
   */
  register("foundry", "blueprint_kinds", () => ({
    ok: true,
    nodeKinds: BLUEPRINT_NODE_KINDS,
    eventTypes: BLUEPRINT_EVENT_TYPES,
    actionTypes: BLUEPRINT_ACTION_TYPES,
  }));

  /**
   * foundry.blueprint_get — load a world's visual-script graph.
   * input: { id }
   */
  register("foundry", "blueprint_get", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id);
      if (r.error) return r.error;
      const bp = foundryState().blueprints.get(r.row.id) || { nodes: [], edges: [], updatedAt: 0 };
      return { ok: true, blueprint: bp, validation: validateBlueprint(bp) };
    } catch (e) { return { ok: false, reason: "blueprint_get_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.blueprint_save — persist a visual-script graph for a world.
   * Normalizes + validates; an invalid graph still saves (warnings are
   * advisory) but a graph with no nodes is rejected.
   * input: { id, nodes, edges }
   */
  register("foundry", "blueprint_save", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id, { needWrite: true });
      if (r.error) return r.error;
      const normalized = normalizeBlueprint({ nodes: input.nodes, edges: input.edges });
      if (normalized.nodes.length === 0) return { ok: false, reason: "empty_blueprint" };
      const validation = validateBlueprint(normalized);
      const record = { ...normalized, updatedAt: Date.now() };
      foundryState().blueprints.set(r.row.id, record);
      return { ok: true, blueprint: record, validation };
    } catch (e) { return { ok: false, reason: "blueprint_save_failed", error: String(e?.message || e) }; }
  });

  // ── 2. In-builder playtest mode + hot-reload ──────────────────────────────

  /**
   * foundry.playtest_start — open an iterate-loop playtest session over
   * a draft. Compiles the current spec, mints/reuses a preview world,
   * and records a session the canvas hot-reloads against. Distinct from
   * foundry.preview (a passive render) — a playtest tracks a revision
   * counter so the builder knows when a hot-reload landed.
   * input: { id }
   */
  register("foundry", "playtest_start", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id, { needWrite: true });
      if (r.error) return r.error;
      const { db, row, userId } = r;
      let rawSpec;
      try { rawSpec = JSON.parse(row.worldspec_json); } catch { rawSpec = emptyWorldspec(); }
      const worldspec = normalizeWorldspec(rawSpec);
      if (worldspec.systems.length === 0) return { ok: false, reason: "no_systems" };
      const compiled = compileWorldspec(worldspec);
      const nowSec = Math.floor(Date.now() / 1000);
      const physJson = JSON.stringify(compiled.physics_modulators);
      const ruleJson = JSON.stringify(compiled.rule_modulators);
      const ptName = `${row.name} (playtest)`;
      let previewWorldId = row.preview_world_id;
      const existing = previewWorldId
        ? db.prepare(`SELECT id FROM worlds WHERE id = ? AND status = 'preview'`).get(previewWorldId)
        : null;
      if (existing) {
        db.prepare(`UPDATE worlds SET name = ?, universe_type = ?, physics_modulators = ?, rule_modulators = ?, created_at = ? WHERE id = ?`)
          .run(ptName, worldspec.theme.universeType, physJson, ruleJson, nowSec, previewWorldId);
      } else {
        previewWorldId = `preview-${randomUUID()}`;
        db.prepare(`INSERT INTO worlds (id, name, universe_type, description, physics_modulators, rule_modulators, created_by, status, created_at) VALUES (?,?,?,?,?,?,?,'preview',?)`)
          .run(previewWorldId, ptName, worldspec.theme.universeType, `Foundry playtest of ${row.name}.`, physJson, ruleJson, userId, nowSec);
        db.prepare(`UPDATE foundry_worlds SET preview_world_id = ? WHERE id = ?`).run(previewWorldId, row.id);
      }
      const sessionId = `pt_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
      const session = {
        sessionId, foundryWorldId: row.id, previewWorldId, builderId: userId,
        revision: 1, startedAt: Date.now(), reloadedAt: Date.now(),
        activatedSystems: compiled.activatedSystems,
      };
      foundryState().playtests.set(sessionId, session);
      return { ok: true, session };
    } catch (e) { return { ok: false, reason: "playtest_start_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.playtest_reload — hot-reload an open playtest: recompile the
   * current spec onto the live preview world and bump the revision.
   * input: { sessionId }
   */
  register("foundry", "playtest_reload", (ctx, input = {}) => {
    try {
      const sessionId = String((input && input.sessionId) || "");
      if (!sessionId) return { ok: false, reason: "missing_session_id" };
      const session = foundryState().playtests.get(sessionId);
      if (!session) return { ok: false, reason: "session_not_found" };
      const r = loadWorldForBuilder(ctx, session.foundryWorldId, { needWrite: true });
      if (r.error) return r.error;
      const { db, row } = r;
      let rawSpec;
      try { rawSpec = JSON.parse(row.worldspec_json); } catch { rawSpec = emptyWorldspec(); }
      const worldspec = normalizeWorldspec(rawSpec);
      const compiled = compileWorldspec(worldspec);
      db.prepare(`UPDATE worlds SET universe_type = ?, physics_modulators = ?, rule_modulators = ? WHERE id = ? AND status = 'preview'`)
        .run(worldspec.theme.universeType, JSON.stringify(compiled.physics_modulators), JSON.stringify(compiled.rule_modulators), session.previewWorldId);
      session.revision += 1;
      session.reloadedAt = Date.now();
      session.activatedSystems = compiled.activatedSystems;
      return { ok: true, session };
    } catch (e) { return { ok: false, reason: "playtest_reload_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.playtest_end — close a playtest session + tear down its
   * preview world. Idempotent.
   * input: { sessionId }
   */
  register("foundry", "playtest_end", (ctx, input = {}) => {
    try {
      const sessionId = String((input && input.sessionId) || "");
      if (!sessionId) return { ok: false, reason: "missing_session_id" };
      const session = foundryState().playtests.get(sessionId);
      if (!session) return { ok: true, alreadyClear: true };
      const db = ctx?.db;
      if (db && session.previewWorldId) {
        try {
          db.prepare(`DELETE FROM worlds WHERE id = ? AND status = 'preview'`).run(session.previewWorldId);
          db.prepare(`UPDATE foundry_worlds SET preview_world_id = NULL WHERE id = ? AND preview_world_id = ?`)
            .run(session.foundryWorldId, session.previewWorldId);
        } catch (_e) { /* preview row already gone */ }
      }
      foundryState().playtests.delete(sessionId);
      return { ok: true, ended: sessionId };
    } catch (e) { return { ok: false, reason: "playtest_end_failed", error: String(e?.message || e) }; }
  });

  // ── 3. Asset library ──────────────────────────────────────────────────────

  /** foundry.asset_kinds — the importable asset-kind vocabulary. */
  register("foundry", "asset_kinds", () => ({ ok: true, kinds: ASSET_KINDS }));

  /**
   * foundry.asset_import — register a 3D model / sprite / audio / texture
   * by URL into a world's asset library.
   * input: { id, kind, name, url, tags? }
   */
  register("foundry", "asset_import", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id, { needWrite: true });
      if (r.error) return r.error;
      const v = validateAsset(input);
      if (!v.ok) return { ok: false, reason: "invalid_asset", errors: v.errors };
      const assetId = `fa_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
      const asset = {
        id: assetId, foundryWorldId: r.row.id, kind: String(input.kind),
        name: String(input.name).trim().slice(0, 160), url: String(input.url).trim(),
        tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).slice(0, 40)).slice(0, 12) : [],
        importedBy: r.userId, importedAt: Date.now(),
      };
      foundryState().assets.set(assetId, asset);
      return { ok: true, asset };
    } catch (e) { return { ok: false, reason: "asset_import_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.asset_list — a world's asset library, newest-first.
   * input: { id, kind? }
   */
  register("foundry", "asset_list", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id);
      if (r.error) return r.error;
      const kindFilter = input && input.kind ? String(input.kind) : null;
      const assets = [...foundryState().assets.values()]
        .filter((a) => a.foundryWorldId === r.row.id && (!kindFilter || a.kind === kindFilter))
        .sort((a, b) => b.importedAt - a.importedAt);
      return { ok: true, count: assets.length, assets };
    } catch (e) { return { ok: false, reason: "asset_list_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.asset_remove — delete an imported asset. Creator/editor only.
   * input: { id, assetId }
   */
  register("foundry", "asset_remove", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id, { needWrite: true });
      if (r.error) return r.error;
      const assetId = String((input && input.assetId) || "");
      const asset = foundryState().assets.get(assetId);
      if (!asset || asset.foundryWorldId !== r.row.id) return { ok: false, reason: "asset_not_found" };
      foundryState().assets.delete(assetId);
      return { ok: true, removed: assetId };
    } catch (e) { return { ok: false, reason: "asset_remove_failed", error: String(e?.message || e) }; }
  });

  // ── 4. Multiplayer lobby + matchmaking config ─────────────────────────────

  /** foundry.matchmaking_modes — the matchmaking-mode vocabulary. */
  register("foundry", "matchmaking_modes", () => ({ ok: true, modes: MATCHMAKING_MODES }));

  /**
   * foundry.multiplayer_get — a world's current multiplayer/lobby config.
   * input: { id }
   */
  register("foundry", "multiplayer_get", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id);
      if (r.error) return r.error;
      let spec;
      try { spec = JSON.parse(r.row.worldspec_json); } catch { spec = emptyWorldspec(); }
      return { ok: true, multiplayer: normalizeMultiplayer(spec && spec.multiplayer) };
    } catch (e) { return { ok: false, reason: "multiplayer_get_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.multiplayer_set — write a world's multiplayer/lobby/match-
   * making config into the worldspec. The compiler picks it up at
   * publish; the value is clamped to safe bounds on write.
   * input: { id, enabled?, minPlayers?, maxPlayers?, matchmaking?,
   *          lobbyCountdownSec?, teamCount?, fillBots? }
   */
  register("foundry", "multiplayer_set", (ctx, input = {}) => {
    try {
      const badNum = badNumericField(input, ["minPlayers", "maxPlayers", "lobbyCountdownSec", "teamCount"]);
      if (badNum) return { ok: false, reason: `invalid_${badNum}` };
      const r = loadWorldForBuilder(ctx, input && input.id, { needWrite: true });
      if (r.error) return r.error;
      const { db, row } = r;
      let spec;
      try { spec = JSON.parse(row.worldspec_json); } catch { spec = emptyWorldspec(); }
      const normalized = normalizeWorldspec(spec);
      const mp = normalizeMultiplayer({
        enabled: input.enabled, minPlayers: input.minPlayers, maxPlayers: input.maxPlayers,
        matchmaking: input.matchmaking, lobbyCountdownSec: input.lobbyCountdownSec,
        teamCount: input.teamCount, fillBots: input.fillBots,
      });
      if (mp.minPlayers > mp.maxPlayers) return { ok: false, reason: "min_exceeds_max" };
      const next = { ...normalized, multiplayer: mp };
      db.prepare(`UPDATE foundry_worlds SET worldspec_json = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(next), Date.now(), row.id);
      return { ok: true, multiplayer: mp };
    } catch (e) { return { ok: false, reason: "multiplayer_set_failed", error: String(e?.message || e) }; }
  });

  // ── 5. Games marketplace (discovery + ratings) ────────────────────────────

  /**
   * foundry.marketplace — discover published Foundry games. Lists every
   * foundry world with status='published' joined to its live worlds row,
   * with the aggregate rating folded in. Sortable by recency, rating, or
   * play count.
   * input: { sort?: 'recent'|'rating'|'plays', limit?, q? }
   */
  register("foundry", "marketplace", (ctx, input = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const badNum = badNumericField(input, ["limit"]);
      if (badNum) return { ok: false, reason: `invalid_${badNum}` };
      const limit = Math.min(Math.max(Number(input && input.limit) || 40, 1), 120);
      const q = input && input.q ? String(input.q).toLowerCase().trim() : null;
      const rows = db.prepare(`
        SELECT fw.id, fw.name, fw.description, fw.creator_id, fw.published_world_id,
               fw.updated_at, w.total_visits
        FROM foundry_worlds fw
        LEFT JOIN worlds w ON w.id = fw.published_world_id
        WHERE fw.status = 'published' AND fw.published_world_id IS NOT NULL
      `).all();
      const ratings = foundryState().ratings;
      const analytics = foundryState().analytics;
      let games = rows.map((row) => {
        const rmap = ratings.get(row.id);
        const stars = rmap ? [...rmap.values()].map((x) => x.stars) : [];
        const avgRating = stars.length ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 100) / 100 : 0;
        const bucket = analytics.get(row.id);
        const plays = (bucket && Array.isArray(bucket.plays) ? bucket.plays.length : 0) + (Number(row.total_visits) || 0);
        return {
          id: row.id, name: row.name, description: row.description || "",
          creatorId: row.creator_id, publishedWorldId: row.published_world_id,
          updatedAt: row.updated_at, avgRating, ratingCount: stars.length, plays,
        };
      });
      if (q) games = games.filter((g) => g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q));
      const sort = input && input.sort ? String(input.sort) : "recent";
      if (sort === "rating") games.sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount);
      else if (sort === "plays") games.sort((a, b) => b.plays - a.plays);
      else games.sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, count: games.length, games: games.slice(0, limit) };
    } catch (e) { return { ok: false, reason: "marketplace_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.rate — rate a published Foundry game 1–5 stars with an
   * optional review. One rating per user per game (re-rating overwrites).
   * The creator cannot rate their own game.
   * input: { id, stars, review? }
   */
  register("foundry", "rate", (ctx, input = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const userId = ctx?.actor?.userId || ctx?.actor?.id;
      if (!userId) return { ok: false, reason: "no_actor" };
      const id = String((input && input.id) || "");
      if (!id) return { ok: false, reason: "missing_id" };
      const row = db.prepare(`SELECT * FROM foundry_worlds WHERE id = ?`).get(id);
      if (!row) return { ok: false, reason: "not_found" };
      if (row.status !== "published") return { ok: false, reason: "not_published" };
      if (row.creator_id === userId) return { ok: false, reason: "cannot_rate_own_game" };
      const stars = Math.round(Number(input && input.stars));
      if (!Number.isFinite(stars) || stars < 1 || stars > 5) return { ok: false, reason: "invalid_stars" };
      const review = String((input && input.review) || "").slice(0, 600);
      const ratings = foundryState().ratings;
      let rmap = ratings.get(id);
      if (!rmap) { rmap = new Map(); ratings.set(id, rmap); }
      rmap.set(userId, { stars, review, at: Date.now() });
      const all = [...rmap.values()].map((x) => x.stars);
      const avg = Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 100) / 100;
      return { ok: true, avgRating: avg, ratingCount: all.length, yourStars: stars };
    } catch (e) { return { ok: false, reason: "rate_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.ratings — the rating breakdown + recent reviews for a game.
   * input: { id }
   */
  register("foundry", "ratings", (ctx, input = {}) => {
    try {
      const id = String((input && input.id) || "");
      if (!id) return { ok: false, reason: "missing_id" };
      const rmap = foundryState().ratings.get(id);
      const entries = rmap ? [...rmap.entries()] : [];
      const stars = entries.map(([, v]) => v.stars);
      const avg = stars.length ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 100) / 100 : 0;
      const histogram = [1, 2, 3, 4, 5].map((s) => ({ stars: s, count: stars.filter((x) => x === s).length }));
      const reviews = entries
        .filter(([, v]) => v.review)
        .map(([uid, v]) => ({ userId: uid, stars: v.stars, review: v.review, at: v.at }))
        .sort((a, b) => b.at - a.at)
        .slice(0, 25);
      return { ok: true, avgRating: avg, ratingCount: stars.length, histogram, reviews };
    } catch (e) { return { ok: false, reason: "ratings_failed", error: String(e?.message || e) }; }
  });

  // ── 6. Game analytics dashboard ───────────────────────────────────────────

  /**
   * foundry.track_play — record a play / completion / session event for
   * a published game. Called by the world runtime when a player enters,
   * finishes, or leaves. Open (any authed user can be tracked) — the
   * dashboard read below is creator-scoped.
   * input: { id, event: 'play'|'completion'|'session', durationSec? }
   */
  register("foundry", "track_play", (ctx, input = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const userId = ctx?.actor?.userId || ctx?.actor?.id;
      if (!userId) return { ok: false, reason: "no_actor" };
      const badNum = badNumericField(input, ["durationSec"]);
      if (badNum) return { ok: false, reason: `invalid_${badNum}` };
      const id = String((input && input.id) || "");
      if (!id) return { ok: false, reason: "missing_id" };
      const row = db.prepare(`SELECT id, status FROM foundry_worlds WHERE id = ?`).get(id);
      if (!row) return { ok: false, reason: "not_found" };
      const event = String((input && input.event) || "play");
      if (!["play", "completion", "session"].includes(event)) return { ok: false, reason: "invalid_event" };
      const analytics = foundryState().analytics;
      let bucket = analytics.get(id);
      if (!bucket) { bucket = { plays: [], completions: [], sessions: [] }; analytics.set(id, bucket); }
      const now = Date.now();
      if (event === "play") bucket.plays.push({ userId, at: now });
      else if (event === "completion") bucket.completions.push({ userId, at: now });
      else bucket.sessions.push({ userId, at: now, durationSec: Math.max(0, Number(input.durationSec) || 0) });
      // Trim each ring to a sane upper bound.
      for (const k of ["plays", "completions", "sessions"]) {
        if (bucket[k].length > 20000) bucket[k] = bucket[k].slice(-20000);
      }
      return { ok: true, event, recorded: true };
    } catch (e) { return { ok: false, reason: "track_play_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.analytics — the analytics dashboard for one of the caller's
   * games: total plays, unique players, completion rate, day-1
   * retention, avg session length, and a 7-day play sparkline.
   * input: { id }
   */
  register("foundry", "analytics", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id);
      if (r.error) return r.error;
      const bucket = foundryState().analytics.get(r.row.id) || { plays: [], completions: [], sessions: [] };
      return { ok: true, worldId: r.row.id, summary: summarizeAnalytics(bucket) };
    } catch (e) { return { ok: false, reason: "analytics_failed", error: String(e?.message || e) }; }
  });

  // ── 7. Collaborative multi-builder editing ────────────────────────────────

  /** foundry.collab_roles — the collaborator-role vocabulary. */
  register("foundry", "collab_roles", () => ({ ok: true, roles: COLLAB_ROLES }));

  /**
   * foundry.collab_add — grant another user editor/viewer access to a
   * foundry world. Owner only. The grantee can then load + (if editor)
   * edit the same draft.
   * input: { id, userId, role: 'editor'|'viewer' }
   */
  register("foundry", "collab_add", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id);
      if (r.error) return r.error;
      if (!r.isOwner) return { ok: false, reason: "owner_only" };
      const granteeId = String((input && input.userId) || "").trim();
      if (!granteeId) return { ok: false, reason: "missing_user_id" };
      if (granteeId === r.userId) return { ok: false, reason: "cannot_add_self" };
      const role = COLLAB_ROLES.includes(input && input.role) ? input.role : "editor";
      const collabs = foundryState().collaborators;
      let cmap = collabs.get(r.row.id);
      if (!cmap) { cmap = new Map(); collabs.set(r.row.id, cmap); }
      cmap.set(granteeId, { role, addedAt: Date.now(), addedBy: r.userId });
      return { ok: true, collaborator: { userId: granteeId, role } };
    } catch (e) { return { ok: false, reason: "collab_add_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.collab_remove — revoke a collaborator's access. Owner only.
   * input: { id, userId }
   */
  register("foundry", "collab_remove", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id);
      if (r.error) return r.error;
      if (!r.isOwner) return { ok: false, reason: "owner_only" };
      const granteeId = String((input && input.userId) || "").trim();
      const cmap = foundryState().collaborators.get(r.row.id);
      if (!cmap || !cmap.has(granteeId)) return { ok: false, reason: "not_a_collaborator" };
      cmap.delete(granteeId);
      foundryState().presence.get(r.row.id)?.delete(granteeId);
      return { ok: true, removed: granteeId };
    } catch (e) { return { ok: false, reason: "collab_remove_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.collab_list — the collaborator roster + live presence for a
   * world. Presence is anyone who pinged in the last 90s. Readable by
   * the owner or any collaborator.
   * input: { id }
   */
  register("foundry", "collab_list", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id);
      if (r.error) return r.error;
      const cmap = foundryState().collaborators.get(r.row.id);
      const collaborators = cmap
        ? [...cmap.entries()].map(([uid, v]) => ({ userId: uid, role: v.role, addedAt: v.addedAt, addedBy: v.addedBy }))
        : [];
      const pmap = foundryState().presence.get(r.row.id);
      const cutoff = Date.now() - 90_000;
      const online = pmap
        ? [...pmap.entries()].filter(([, v]) => v.at >= cutoff).map(([uid, v]) => ({ userId: uid, node: v.node, at: v.at }))
        : [];
      return { ok: true, owner: r.row.creator_id, collaborators, online };
    } catch (e) { return { ok: false, reason: "collab_list_failed", error: String(e?.message || e) }; }
  });

  /**
   * foundry.collab_ping — heartbeat the caller's editing presence on a
   * world (which node/pane they're on). Owner or collaborator. The
   * collab panel polls collab_list to render co-editor cursors.
   * input: { id, node? }
   */
  register("foundry", "collab_ping", (ctx, input = {}) => {
    try {
      const r = loadWorldForBuilder(ctx, input && input.id);
      if (r.error) return r.error;
      const pres = foundryState().presence;
      let pmap = pres.get(r.row.id);
      if (!pmap) { pmap = new Map(); pres.set(r.row.id, pmap); }
      pmap.set(r.userId, { node: String((input && input.node) || "").slice(0, 80), at: Date.now() });
      return { ok: true, pinged: true };
    } catch (e) { return { ok: false, reason: "collab_ping_failed", error: String(e?.message || e) }; }
  });
}
