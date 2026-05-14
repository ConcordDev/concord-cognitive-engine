// server/domains/foundry.js
//
// Foundry — no-code game-builder lens (#66). Macro surface.
//
// Phase 1 (this commit): the System Registry read surface — the
// Foundry canvas pulls the catalog + per-system config schemas from
// here to render the component palette and config panels.
//
// Later phases extend this file: Phase 2 adds foundry.{create,update,
// get,list,delete,validate} (worldspec persistence), Phase 3 adds
// foundry.publish, Phase 5 adds foundry.preview, Phase 6 adds
// foundry.compose_rule.

import {
  SYSTEM_REGISTRY,
  CATEGORY_LABELS,
  getSystem,
  listSystems,
  systemsByCategory,
  getConfigSchema,
  validateSystemSelection,
} from "../lib/foundry/system-registry.js";

export default function registerFoundryMacros(register) {
  /**
   * foundry.systems — the full composable-system catalog. The Foundry
   * canvas renders its palette straight off this.
   * input: { category? } — optional category filter (world|character|
   *         combat|npc|economy|social)
   * output: { ok, count, categories, systems } — `systems` is flat,
   *         `categories` is the grouped+labelled view.
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
   * foundry.system_schema — the config schema for one system (the shape
   * the ConfigPanel renders). Also returns the system's metadata so the
   * panel can show deps/conflicts/status inline.
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
   * foundry.validate_systems — dependency + conflict + config check on a
   * system selection, without persisting anything. The canvas calls this
   * live as the user adds/removes components; Phase 2's foundry.validate
   * wraps it for the full worldspec.
   * input: { systems: [{ id, config? }] }
   * output: { ok, errors, warnings, resolved }
   */
  register("foundry", "validate_systems", (_ctx, input = {}) => {
    const systems = (input && input.systems) || [];
    const result = validateSystemSelection(systems);
    return { ok: result.ok, errors: result.errors, warnings: result.warnings, resolved: result.resolved };
  });
}
