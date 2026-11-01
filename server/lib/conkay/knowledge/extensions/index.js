// server/lib/conkay/knowledge/extensions/index.js
//
// Discipline extensions. An entity carries `extensions: { <discipline>: {...} }`.
// Each discipline registers a JSON Schema (validated with json-schema-lite)
// and, optionally, extra rules. All twelve disciplines are implemented
// (materials + the eleven in disciplines.js, Q43/A#29): extension data
// is validated for real. The registry still supports "stub" entries for
// future disciplines — validateExtensions reports those as a warning,
// never as a pass.

import { validateAgainst } from "../json-schema-lite.js";
import { materialsExtension } from "./materials.js";
import { disciplineExtensions } from "./disciplines.js";

const registry = new Map();

/** Register (or replace) a discipline extension. */
export function registerExtension(name, ext) {
  if (!/^[a-z][a-z_]*$/.test(name)) throw new Error(`bad extension name "${name}"`);
  if (ext.status !== "stub" && !ext.schema) throw new Error(`extension "${name}" needs a schema`);
  registry.set(name, { name, ...ext });
}

export function getExtension(name) {
  return registry.get(name) || null;
}

export function listExtensions() {
  return [...registry.values()].map(({ name, status, description, plannedFields }) => ({ name, status, description, plannedFields: plannedFields || [] }));
}

/** Validate an entity's extensions. Returns { errors, warnings }. */
export function validateExtensions(entity) {
  const errors = [];
  const warnings = [];
  for (const [name, data] of Object.entries(entity?.extensions || {})) {
    const ext = registry.get(name);
    if (!ext) { errors.push(`extensions.${name}: no such discipline extension`); continue; }
    if (ext.status === "stub") { warnings.push(`extensions.${name}: "${name}" is a stub; its fields are stored but not validated yet`); continue; }
    errors.push(...validateAgainst(ext.schema, data, `$.extensions.${name}`));
    if (ext.rules) errors.push(...ext.rules(data, entity));
  }
  return { errors, warnings };
}

// The spec's discipline list (CONKAY-UNIVERSAL-KNOWLEDGE-LAYER-2026-10-09.md).
registerExtension("materials", materialsExtension);
for (const [name, ext] of Object.entries(disciplineExtensions)) registerExtension(name, ext);
