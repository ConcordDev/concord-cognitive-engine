// server/domains/commune.js
//
// Commune-template domain. The runtime registry lives in
// server/lib/commune-templates.js; this file exposes its surface as
// the macros the lens / quest-engine / npc-initiator can call.

import {
  addCommuneTemplate,
  getCommuneTemplate,
  listCommuneTemplates,
  validateCommuneTemplate,
  removeCommuneTemplate,
  COMMUNE_TRIGGERS,
  COMMUNE_LOCATION_TYPES,
  COMMUNE_RITUAL_STEP_KINDS,
} from "../lib/commune-templates.js";

/** Macro registry consumed by server.js#registerDomainMacros. */
export function registerCommune(register) {
  register("commune", "list", (_ctx, input = {}) => {
    return { ok: true, templates: listCommuneTemplates(input.filter || {}) };
  });

  register("commune", "get", (_ctx, input = {}) => {
    const tpl = getCommuneTemplate(input.id);
    if (!tpl) return { ok: false, error: "not_found" };
    return { ok: true, template: tpl };
  });

  register("commune", "create", (ctx, input = {}) => {
    const template = { ...input };
    if (ctx?.userId && !template.author_id) template.author_id = ctx.userId;
    return addCommuneTemplate(template);
  });

  register("commune", "validate", (_ctx, input = {}) => {
    return validateCommuneTemplate(input);
  });

  register("commune", "remove", (_ctx, input = {}) => {
    if (!input.id) return { ok: false, error: "id_required" };
    const removed = removeCommuneTemplate(input.id);
    return { ok: removed, error: removed ? undefined : "not_found" };
  });

  register("commune", "options", () => {
    return {
      ok: true,
      triggers: COMMUNE_TRIGGERS,
      locationTypes: COMMUNE_LOCATION_TYPES,
      ritualStepKinds: COMMUNE_RITUAL_STEP_KINDS,
    };
  });
}
