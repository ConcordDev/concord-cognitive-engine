// server/lib/conkay/knowledge/extensions/index.js
//
// Discipline extensions. An entity carries `extensions: { <discipline>: {...} }`.
// Each discipline registers a JSON Schema (validated with json-schema-lite)
// and, optionally, extra rules. "materials" is implemented; the others are
// registered as stubs that list the fields the spec asks for, so a record can
// already carry them, but they are not validated yet: validateExtensions
// reports that as a warning, never as a pass.

import { validateAgainst } from "../json-schema-lite.js";
import { materialsExtension } from "./materials.js";

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
const STUBS = {
  chemistry: {
    description: "Chemical substances and reactions. Solvers planned: atom and charge balance, limiting reactant, concentration conversion, equilibrium, reaction energy. Unverified predictions kept separate.",
    plannedFields: ["identifiers (CAS, PubChem CID, InChIKey)", "formula", "structure", "purity", "concentration", "phase", "stoichiometry", "products", "conditions", "kinetics", "thermodynamics", "compatibility", "hazards"],
  },
  fluids: {
    description: "Fluids, mixtures and fuels; sources NIST Chemistry WebBook, REFPROP.",
    plannedFields: ["composition", "basis", "density", "viscosity", "vapor pressure", "Cp", "thermal conductivity", "phase behavior", "compressibility", "flash point", "T/P dependence"],
  },
  recipes: {
    description: "Recipes. Scaling is not linear when heat transfer, mixing, evaporation or safety changes; culinary-tested vs lab-tested vs calculated are distinct statuses.",
    plannedFields: ["quantities", "yield", "serving size", "sequence", "time", "temperature", "equipment", "substitutions", "storage", "allergens", "nutrition", "tested_as (culinary|lab|calculated)"],
  },
  engineering: {
    description: "Engineered objects (bridges to the #1032 design graph and #1037 component library).",
    plannedFields: ["geometry", "materials", "dimensions", "tolerances", "joints", "mass properties", "loads", "boundary conditions", "operating envelope", "manufacturing", "service life", "standards"],
  },
  math: {
    description: "Formulas and algorithms. Every formula executable and tested against known solutions before it drives a decision.",
    plannedFields: ["equations", "variable definitions", "units", "assumptions", "domain of validity", "initial/boundary conditions", "solver requirements", "tolerances", "reference cases", "error bounds"],
  },
  electronics: { description: "Electronics (extensibility placeholder).", plannedFields: [] },
  biology: { description: "Biological systems (extensibility placeholder).", plannedFields: [] },
  energy: { description: "Energy systems (extensibility placeholder).", plannedFields: [] },
  agriculture: { description: "Agriculture (extensibility placeholder).", plannedFields: [] },
  geology: { description: "Geology (extensibility placeholder).", plannedFields: [] },
  software: { description: "Software (extensibility placeholder).", plannedFields: [] },
};

registerExtension("materials", materialsExtension);
for (const [name, s] of Object.entries(STUBS)) registerExtension(name, { status: "stub", ...s });
