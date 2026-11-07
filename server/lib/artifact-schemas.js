/**
 * Artifact Schema Registry — defines expected structure for lens action output.
 *
 * Schemas used by quality-gate.js for structural validation.
 * Each schema defines required fields, types, ranges, and vocabulary references.
 */

const ARTIFACT_SCHEMAS = new Map();

let _loaded = false;

export function registerSchema(domain, action, schema) {
  ARTIFACT_SCHEMAS.set(`${domain}.${action}`, schema);
}

export function getArtifactSchema(domain, action) {
  return ARTIFACT_SCHEMAS.get(`${domain}.${action}`)
    || ARTIFACT_SCHEMAS.get(`${domain}.*`)
    || null;
}

export function listArtifactSchemas() {
  return [...ARTIFACT_SCHEMAS.entries()].map(([key, schema]) => {
    const dot = key.indexOf(".");
    return { domain: key.slice(0, dot), action: key.slice(dot + 1), schema };
  });
}

export function getSchemaCount() {
  return ARTIFACT_SCHEMAS.size;
}

// Lazy loader — called once on first access or explicitly at startup
export async function loadSchemas() {
  if (_loaded) return;
  _loaded = true;
  await import("./artifact-schemas/food-schemas.js");
  await import("./artifact-schemas/fitness-schemas.js");
  await import("./artifact-schemas/finance-schemas.js");
  await import("./artifact-schemas/healthcare-schemas.js");
  await import("./artifact-schemas/legal-schemas.js");
  await import("./artifact-schemas/music-schemas.js");
  await import("./artifact-schemas/realestate-schemas.js");
  await import("./artifact-schemas/education-schemas.js");
  await import("./artifact-schemas/trades-schemas.js");
  await import("./artifact-schemas/insurance-schemas.js");
}

// Auto-load schemas on import (non-blocking, resolves before any getArtifactSchema call in practice)
const _initPromise = loadSchemas();
export { _initPromise as schemasReady };
