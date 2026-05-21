// Contract tests for server/domains/schema.js — schema validation, diff,
// evolution, plus the JSON-Schema-tooling parity macros: versioned
// registry, sample-data generation, migration codegen, conformance,
// ER visualization, and schema inference from JSON/SQL.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSchemaActions from "../domains/schema.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`schema.${name}`);
  if (!fn) throw new Error(`schema.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerSchemaActions(register); });

beforeEach(() => {
  // fresh per-user persistent state for each test
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

const USER_SCHEMA = {
  fields: {
    id: { type: "integer", required: true },
    email: { type: "string", required: true, pattern: "@" },
    age: { type: "integer", min: 0, max: 130 },
    role: { type: "string", enum: ["admin", "user", "guest"] },
  },
};

describe("schema.schemaValidate (pure-compute)", () => {
  it("flags type mismatch + missing required field", () => {
    const r = call("schemaValidate", ctxA, {
      data: { schema: USER_SCHEMA, records: [{ id: 1, age: "thirty", role: "wizard" }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.valid, false);
    assert.equal(r.result.summary.invalidRecords, 1);
  });

  it("passes a fully conforming record", () => {
    const r = call("schemaValidate", ctxA, {
      data: { schema: USER_SCHEMA, records: [{ id: 1, email: "a@b.com", age: 30, role: "admin" }] },
    }, {});
    assert.equal(r.result.valid, true);
  });
});

describe("schema.schemaDiff (pure-compute)", () => {
  it("classifies added/removed/breaking changes", () => {
    const r = call("schemaDiff", ctxA, {
      data: {
        schemaA: { fields: { a: { type: "string" }, b: { type: "string" } } },
        schemaB: { fields: { a: { type: "integer" }, c: { type: "string", required: true } } },
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.removed, 1);
    assert.equal(r.result.summary.added, 1);
    assert.equal(r.result.summary.backwardCompatible, false);
  });
});

describe("schema.schemaEvolution (pure-compute)", () => {
  it("computes transitions across versions", () => {
    const r = call("schemaEvolution", ctxA, {
      data: {
        versions: [
          { version: "1.0.0", schema: { fields: { a: { type: "string" } } } },
          { version: "1.1.0", schema: { fields: { a: { type: "string" }, b: { type: "string" } } } },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.totalVersions, 2);
    assert.equal(r.result.transitions.length, 1);
  });
});

describe("schema.registry (create / list / get / save-version / delete)", () => {
  it("creates a schema, lists it, fetches full history", () => {
    const created = call("registryCreate", ctxA, {
      name: "user_profile", description: "core user", schema: USER_SCHEMA,
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.version, "1.0.0");
    assert.equal(created.result.fieldCount, 4);

    const listed = call("registryList", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.schemas[0].name, "user_profile");

    const got = call("registryGet", ctxA, { id: created.result.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.versions.length, 1);
  });

  it("rejects a duplicate name and a missing name", () => {
    call("registryCreate", ctxA, { name: "dup", schema: USER_SCHEMA });
    const dup = call("registryCreate", ctxA, { name: "dup", schema: USER_SCHEMA });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "duplicate_name");
    const noName = call("registryCreate", ctxA, { schema: USER_SCHEMA });
    assert.equal(noName.ok, false);
  });

  it("auto-bumps semver on save-version (additive → minor, breaking → major)", () => {
    const c = call("registryCreate", ctxA, { name: "evolving", schema: { fields: { a: { type: "string" } } } });
    const minor = call("registrySaveVersion", ctxA, {
      id: c.result.id, schema: { fields: { a: { type: "string" }, b: { type: "string" } } },
    });
    assert.equal(minor.ok, true);
    assert.equal(minor.result.bump, "minor");
    assert.equal(minor.result.version, "1.1.0");

    const major = call("registrySaveVersion", ctxA, {
      id: c.result.id, schema: { fields: { a: { type: "integer" } } },
    });
    assert.equal(major.ok, true);
    assert.equal(major.result.bump, "major");
    assert.equal(major.result.breaking, true);
  });

  it("deletes a schema", () => {
    const c = call("registryCreate", ctxA, { name: "trash", schema: USER_SCHEMA });
    const del = call("registryDelete", ctxA, { id: c.result.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    assert.equal(call("registryList", ctxA, {}).result.count, 0);
  });
});

describe("schema.sampleGenerate", () => {
  it("produces valid records that pass schemaValidate", () => {
    const gen = call("sampleGenerate", ctxA, { schema: USER_SCHEMA, count: 8 });
    assert.equal(gen.ok, true);
    assert.equal(gen.result.records.length, 8);
    const validated = call("schemaValidate", ctxA, {
      data: { schema: USER_SCHEMA, records: gen.result.records },
    }, { strictMode: false });
    assert.equal(validated.result.valid, true);
  });

  it("generates from a registry schema by id", () => {
    const c = call("registryCreate", ctxA, { name: "samp", schema: USER_SCHEMA });
    const gen = call("sampleGenerate", ctxA, { id: c.result.id, count: 3 });
    assert.equal(gen.ok, true);
    assert.equal(gen.result.count, 3);
  });

  it("rejects an empty schema", () => {
    const r = call("sampleGenerate", ctxA, { schema: { fields: {} } });
    assert.equal(r.ok, false);
  });
});

describe("schema.migrationGenerate", () => {
  it("emits an SQL migration with up/down scripts", () => {
    const r = call("migrationGenerate", ctxA, {
      schemaA: { fields: { a: { type: "string" } } },
      schemaB: { fields: { a: { type: "string" }, b: { type: "integer" } } },
      dialect: "sql", table: "users",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.dialect, "sql");
    assert.equal(r.result.operationCount, 1);
    assert.match(r.result.script, /ALTER TABLE users ADD COLUMN b/);
  });

  it("flags breaking drop_column operations", () => {
    const r = call("migrationGenerate", ctxA, {
      schemaA: { fields: { a: { type: "string" }, gone: { type: "string" } } },
      schemaB: { fields: { a: { type: "string" } } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.breakingCount, 1);
    assert.equal(r.result.reversible, false);
  });

  it("emits a JSON-ops migration when dialect=json", () => {
    const r = call("migrationGenerate", ctxA, {
      schemaA: { fields: {} },
      schemaB: { fields: { a: { type: "string" } } },
      dialect: "json",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.dialect, "json");
    assert.doesNotThrow(() => JSON.parse(r.result.script));
  });
});

describe("schema.conformanceCheck", () => {
  it("reports per-field presence + type-mismatch stats", () => {
    const r = call("conformanceCheck", ctxA, {
      schema: USER_SCHEMA,
      records: [
        { id: 1, email: "a@b.com", age: 30 },
        { id: "bad", email: "c@d.com" },
        { id: 3, email: "e@f.com", age: 40, extra: true },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.recordCount, 3);
    assert.ok(r.result.conformanceRate <= 100);
    assert.equal(r.result.fieldStats.id.typeMismatchCount, 1);
    assert.deepEqual(r.result.undeclaredFields, ["extra"]);
  });

  it("rejects an empty dataset", () => {
    const r = call("conformanceCheck", ctxA, { schema: USER_SCHEMA, records: [] });
    assert.equal(r.ok, false);
  });
});

describe("schema.erDiagram", () => {
  it("builds nodes + reference edges from the registry", () => {
    call("registryCreate", ctxA, {
      name: "author", schema: { fields: { name: { type: "string", required: true } } },
    });
    call("registryCreate", ctxA, {
      name: "book", schema: { fields: { title: { type: "string" }, writtenBy: { type: "object", ref: "author" } } },
    });
    const r = call("erDiagram", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.entityCount, 2);
    assert.equal(r.result.relationCount, 1);
    assert.equal(r.result.danglingRefs.length, 0);
  });

  it("flags dangling refs to unknown entities", () => {
    const r = call("erDiagram", ctxA, {
      schemas: [{ name: "book", schema: { fields: { writtenBy: { type: "object", ref: "ghost" } } } }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.danglingRefs.length, 1);
  });
});

describe("schema.inferSchema", () => {
  it("infers a schema from JSON records", () => {
    const r = call("inferSchema", ctxA, {
      source: "json",
      records: [
        { id: 1, name: "alpha", active: true },
        { id: 2, name: "bravo", active: false },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "json");
    assert.equal(r.result.schema.fields.id.type, "integer");
    assert.equal(r.result.schema.fields.active.type, "boolean");
    assert.equal(r.result.schema.fields.id.required, true);
  });

  it("infers a schema from a SQL CREATE TABLE", () => {
    const r = call("inferSchema", ctxA, {
      source: "sql",
      ddl: "CREATE TABLE accounts (id INTEGER PRIMARY KEY, name VARCHAR(64) NOT NULL, balance REAL DEFAULT 0)",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.table, "accounts");
    assert.equal(r.result.schema.fields.id.type, "integer");
    assert.equal(r.result.schema.fields.name.type, "string");
    assert.equal(r.result.schema.fields.name.maxLength, 64);
    assert.equal(r.result.schema.fields.balance.type, "number");
  });

  it("rejects empty input", () => {
    assert.equal(call("inferSchema", ctxA, { source: "sql", ddl: "" }).ok, false);
    assert.equal(call("inferSchema", ctxA, { source: "json", records: [] }).ok, false);
  });
});
