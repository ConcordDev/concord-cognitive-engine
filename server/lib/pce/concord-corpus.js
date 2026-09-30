// server/lib/pce/concord-corpus.js
//
// Seed Pattern IR from Concord architectural knowledge (learn, don't copy).

import { registerPattern } from "./pattern-ir.js";

export const CONCORD_CORPUS_PATTERNS = [
  {
    pattern_id: "concord.authenticated_api_endpoint",
    intent: "authenticated api endpoint route handler",
    category: "api",
    license: "Concord-internal",
    confidence: 0.92,
    structural_shape: {
      transforms: [],
      note: "Use existing auth middleware + route registration pattern",
    },
    behavioral_contract: {
      invariants: ["unauthenticated request rejected", "authorized request reaches handler"],
    },
    verification: { testPattern: "auth" },
    provenance: { source: "concord_corpus", extraction: "abstracted" },
  },
  {
    pattern_id: "concord.migration_add_column",
    intent: "add database migration column",
    category: "database",
    license: "Concord-internal",
    confidence: 0.95,
    structural_shape: {
      transforms: [{
        primitive: "CREATE_FILE",
        args: {
          filePath: "server/migrations/NNN_description.js",
          content: "export function up(db) {\n  db.exec(`ALTER TABLE ...`);\n}\n",
        },
      }],
    },
    verification: { testPattern: "migration" },
    provenance: { source: "concord_corpus" },
  },
  {
    pattern_id: "concord.add_named_export",
    intent: "add named export function to module",
    category: "refactoring",
    license: "Concord-internal",
    confidence: 0.88,
    structural_shape: {
      transforms: [{
        primitive: "SEARCH_REPLACE",
        args: { filePath: null, search: null, replace: null },
      }],
    },
    verification: { testPattern: "export" },
    provenance: { source: "concord_corpus" },
  },
  {
    pattern_id: "concord.mission_internal_tool",
    intent: "add mission runtime internal tool handler",
    category: "runtime",
    license: "Concord-internal",
    confidence: 0.9,
    structural_shape: { transforms: [] },
    verification: { testPattern: "mission" },
    provenance: { source: "concord_corpus" },
  },
  {
    pattern_id: "concord.depth_behavior_test",
    intent: "add behavioral depth test for macro or module",
    category: "testing",
    license: "Concord-internal",
    confidence: 0.93,
    structural_shape: {
      transforms: [{
        primitive: "CREATE_FILE",
        args: {
          filePath: "server/tests/depth/feature-behavior.test.js",
          content: "import { describe, it } from 'node:test';\nimport assert from 'node:assert/strict';\n",
        },
      }],
    },
    verification: { testPattern: "behavior" },
    provenance: { source: "concord_corpus" },
  },
];

export function seedConcordCorpus(db) {
  if (!db) return { ok: false, reason: "no_db" };
  const seeded = [];
  for (const p of CONCORD_CORPUS_PATTERNS) {
    const r = registerPattern(db, { ...p, status: "active" });
    if (r.ok) seeded.push(p.pattern_id);
  }
  return { ok: true, seeded, count: seeded.length };
}
