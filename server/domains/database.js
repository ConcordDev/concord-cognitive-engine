// server/domains/database.js
export default function registerDatabaseActions(registerLensAction) {
  registerLensAction("database", "schemaAnalysis", (ctx, artifact, _params) => {
    const tables = artifact.data?.tables || [];
    if (tables.length === 0) return { ok: true, result: { message: "Add tables with columns to analyze schema." } };
    const analyzed = tables.map(t => {
      const cols = t.columns || [];
      const hasPK = cols.some(c => c.primaryKey || c.pk);
      const hasFK = cols.some(c => c.foreignKey || c.fk || c.references);
      const indexed = cols.filter(c => c.indexed || c.index).length;
      return { table: t.name, columns: cols.length, hasPrimaryKey: hasPK, hasForeignKeys: hasFK, indexedColumns: indexed, nullableColumns: cols.filter(c => c.nullable !== false).length, issues: (!hasPK ? ["Missing primary key"] : []).concat(indexed === 0 && cols.length > 3 ? ["No indexes on large table"] : []) };
    });
    const totalIssues = analyzed.reduce((s, t) => s + t.issues.length, 0);
    return { ok: true, result: { tables: analyzed, totalTables: tables.length, totalColumns: analyzed.reduce((s, t) => s + t.columns, 0), totalIssues, healthScore: Math.max(0, 100 - totalIssues * 15), normalizationTip: tables.length > 10 ? "Consider denormalization for read-heavy tables" : "Schema size is manageable" } };
  });
  registerLensAction("database", "queryOptimize", (ctx, artifact, _params) => {
    const query = artifact.data?.query || "";
    if (!query) return { ok: true, result: { message: "Provide a SQL query to analyze." } };
    const upper = query.toUpperCase();
    const issues = [];
    if (upper.includes("SELECT *")) issues.push({ issue: "SELECT * usage", fix: "Specify needed columns explicitly", severity: "medium" });
    if (!upper.includes("WHERE") && (upper.includes("UPDATE") || upper.includes("DELETE"))) issues.push({ issue: "UPDATE/DELETE without WHERE", fix: "Add WHERE clause to prevent full-table modification", severity: "critical" });
    if (upper.includes("LIKE '%") || upper.includes("LIKE \"%")) issues.push({ issue: "Leading wildcard in LIKE", fix: "Use full-text search instead — leading wildcards prevent index usage", severity: "high" });
    if ((upper.match(/JOIN/g) || []).length > 3) issues.push({ issue: "Multiple JOINs (>3)", fix: "Consider breaking into subqueries or using CTEs", severity: "medium" });
    if (!upper.includes("LIMIT") && upper.includes("SELECT")) issues.push({ issue: "No LIMIT clause", fix: "Add LIMIT to prevent unbounded result sets", severity: "low" });
    if (upper.includes("ORDER BY") && !upper.includes("INDEX")) issues.push({ issue: "ORDER BY may lack index", fix: "Ensure ORDER BY columns are indexed", severity: "medium" });
    return { ok: true, result: { query: query.slice(0, 200), issues, issueCount: issues.length, grade: issues.length === 0 ? "A" : issues.some(i => i.severity === "critical") ? "F" : issues.length <= 2 ? "B" : "C" } };
  });
  registerLensAction("database", "migrationPlan", (ctx, artifact, _params) => {
    const changes = artifact.data?.changes || [];
    if (changes.length === 0) return { ok: true, result: { message: "Describe schema changes to generate migration plan." } };
    const steps = changes.map((c, i) => {
      const type = (c.type || "alter").toLowerCase();
      const risk = type === "drop" ? "high" : type === "rename" ? "medium" : type === "add" ? "low" : "medium";
      return { step: i + 1, operation: type, table: c.table, column: c.column, description: c.description || `${type} ${c.column || ""} on ${c.table}`, risk, reversible: type !== "drop", rollback: type === "add" ? `DROP COLUMN ${c.column}` : type === "drop" ? "Restore from backup" : `Reverse ${type}` };
    });
    const highRisk = steps.filter(s => s.risk === "high").length;
    return { ok: true, result: { steps, totalChanges: steps.length, highRiskChanges: highRisk, recommendation: highRisk > 0 ? "Take backup before migrating — contains destructive changes" : "Migration is safe to proceed", estimatedDowntime: highRisk > 0 ? "1-5 minutes" : "Zero (online migration)" } };
  });
  registerLensAction("database", "indexRecommendation", (ctx, artifact, _params) => {
    const tables = artifact.data?.tables || [];
    const queries = artifact.data?.queries || [];
    const recommendations = [];
    for (const q of queries) {
      const upper = (q.query || q || "").toUpperCase();
      const whereMatch = upper.match(/WHERE\s+(\w+)/);
      const orderMatch = upper.match(/ORDER BY\s+(\w+)/);
      const joinMatch = upper.match(/JOIN\s+\w+\s+ON\s+\w+\.(\w+)/);
      if (whereMatch) recommendations.push({ column: whereMatch[1].toLowerCase(), reason: "Used in WHERE clause", type: "B-tree" });
      if (orderMatch) recommendations.push({ column: orderMatch[1].toLowerCase(), reason: "Used in ORDER BY", type: "B-tree" });
      if (joinMatch) recommendations.push({ column: joinMatch[1].toLowerCase(), reason: "Used in JOIN condition", type: "B-tree" });
    }
    const unique = [...new Map(recommendations.map(r => [r.column, r])).values()];
    return { ok: true, result: { recommendations: unique, queriesAnalyzed: queries.length, suggestedIndexes: unique.length, estimatedSpeedup: unique.length > 0 ? `${unique.length * 20}-${unique.length * 50}% faster queries` : "Queries already optimized" } };
  });

  // ─── dbdiagram.io / DrawSQL-shape schema designer (per-user) ─────────

  function getDatabaseState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.databaseLens) STATE.databaseLens = {};
    if (!(STATE.databaseLens.schemas instanceof Map)) STATE.databaseLens.schemas = new Map(); // userId -> Array
    return STATE.databaseLens;
  }
  function saveDatabase() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const dbId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const dbActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const dbClean = (v, max = 120) => String(v == null ? "" : v).trim().slice(0, max);
  const dbIdent = (v, max = 64) => dbClean(v, max).replace(/[^A-Za-z0-9_]/g, "_");
  const dbSchemas = (s, userId) => { if (!s.schemas.has(userId)) s.schemas.set(userId, []); return s.schemas.get(userId); };
  const COL_TYPES = ["integer", "bigint", "text", "varchar", "boolean", "real", "numeric", "timestamp", "date", "uuid", "json"];

  registerLensAction("database", "schema-create", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = dbClean(params.name, 120);
    if (!name) return { ok: false, error: "schema name required" };
    const schema = { id: dbId("sc"), name, tables: [], relations: [], createdAt: new Date().toISOString() };
    dbSchemas(s, dbActor(ctx)).push(schema);
    saveDatabase();
    return { ok: true, result: { schema } };
  });

  registerLensAction("database", "schema-list", (ctx, _a, _params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const schemas = dbSchemas(s, dbActor(ctx)).map((sc) => ({
      id: sc.id, name: sc.name, tableCount: sc.tables.length,
      columnCount: sc.tables.reduce((n, t) => n + t.columns.length, 0), relationCount: sc.relations.length,
    }));
    return { ok: true, result: { schemas, count: schemas.length } };
  });

  registerLensAction("database", "schema-detail", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = dbSchemas(s, dbActor(ctx)).find((x) => x.id === params.id);
    if (!sc) return { ok: false, error: "schema not found" };
    return { ok: true, result: { schema: sc } };
  });

  registerLensAction("database", "schema-delete", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = dbSchemas(s, dbActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "schema not found" };
    arr.splice(i, 1);
    saveDatabase();
    return { ok: true, result: { deleted: params.id } };
  });

  function findSchema(s, ctx, id) { return dbSchemas(s, dbActor(ctx)).find((x) => x.id === id); }

  registerLensAction("database", "table-add", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = findSchema(s, ctx, params.schemaId);
    if (!sc) return { ok: false, error: "schema not found" };
    const name = dbIdent(params.name, 64);
    if (!name) return { ok: false, error: "table name required" };
    if (sc.tables.some((t) => t.name === name)) return { ok: false, error: "table name already exists" };
    const table = {
      id: dbId("tbl"), name,
      columns: [{ id: dbId("col"), name: "id", type: "integer", pk: true, nullable: false, fk: false, references: null }],
    };
    sc.tables.push(table);
    saveDatabase();
    return { ok: true, result: { table } };
  });

  registerLensAction("database", "table-delete", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = findSchema(s, ctx, params.schemaId);
    if (!sc) return { ok: false, error: "schema not found" };
    const i = sc.tables.findIndex((t) => t.id === params.tableId);
    if (i < 0) return { ok: false, error: "table not found" };
    const removed = sc.tables[i].name;
    sc.tables.splice(i, 1);
    sc.relations = sc.relations.filter((r) => r.fromTable !== removed && r.toTable !== removed);
    saveDatabase();
    return { ok: true, result: { deleted: params.tableId } };
  });

  registerLensAction("database", "column-add", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = findSchema(s, ctx, params.schemaId);
    if (!sc) return { ok: false, error: "schema not found" };
    const table = sc.tables.find((t) => t.id === params.tableId);
    if (!table) return { ok: false, error: "table not found" };
    const name = dbIdent(params.name, 64);
    if (!name) return { ok: false, error: "column name required" };
    if (table.columns.some((c) => c.name === name)) return { ok: false, error: "column name already exists" };
    const column = {
      id: dbId("col"), name,
      type: COL_TYPES.includes(params.type) ? params.type : "text",
      pk: params.pk === true,
      nullable: params.nullable !== false,
      fk: params.fk === true,
      references: dbClean(params.references, 130) || null,
    };
    table.columns.push(column);
    saveDatabase();
    return { ok: true, result: { column } };
  });

  registerLensAction("database", "column-delete", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = findSchema(s, ctx, params.schemaId);
    if (!sc) return { ok: false, error: "schema not found" };
    const table = sc.tables.find((t) => t.id === params.tableId);
    if (!table) return { ok: false, error: "table not found" };
    const i = table.columns.findIndex((c) => c.id === params.columnId);
    if (i < 0) return { ok: false, error: "column not found" };
    table.columns.splice(i, 1);
    saveDatabase();
    return { ok: true, result: { deleted: params.columnId } };
  });

  registerLensAction("database", "relation-add", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = findSchema(s, ctx, params.schemaId);
    if (!sc) return { ok: false, error: "schema not found" };
    const fromTable = dbIdent(params.fromTable, 64);
    const toTable = dbIdent(params.toTable, 64);
    if (!sc.tables.some((t) => t.name === fromTable) || !sc.tables.some((t) => t.name === toTable)) {
      return { ok: false, error: "both tables must exist in the schema" };
    }
    const relation = {
      id: dbId("rel"),
      fromTable, fromColumn: dbIdent(params.fromColumn, 64),
      toTable, toColumn: dbIdent(params.toColumn, 64) || "id",
      kind: ["one_to_one", "one_to_many", "many_to_many"].includes(params.kind) ? params.kind : "one_to_many",
    };
    sc.relations.push(relation);
    saveDatabase();
    return { ok: true, result: { relation } };
  });

  registerLensAction("database", "relation-delete", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = findSchema(s, ctx, params.schemaId);
    if (!sc) return { ok: false, error: "schema not found" };
    const i = sc.relations.findIndex((r) => r.id === params.relationId);
    if (i < 0) return { ok: false, error: "relation not found" };
    sc.relations.splice(i, 1);
    saveDatabase();
    return { ok: true, result: { deleted: params.relationId } };
  });

  // schema-export-sql — generate CREATE TABLE DDL from the visual schema.
  registerLensAction("database", "schema-export-sql", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = findSchema(s, ctx, params.id);
    if (!sc) return { ok: false, error: "schema not found" };
    const lines = [];
    for (const table of sc.tables) {
      lines.push(`CREATE TABLE ${table.name} (`);
      const colDefs = table.columns.map((c) => {
        let def = `  ${c.name} ${c.type.toUpperCase()}`;
        if (c.pk) def += " PRIMARY KEY";
        if (!c.nullable && !c.pk) def += " NOT NULL";
        return def;
      });
      lines.push(colDefs.join(",\n"));
      lines.push(");");
      lines.push("");
    }
    for (const r of sc.relations) {
      lines.push(`ALTER TABLE ${r.fromTable} ADD FOREIGN KEY (${r.fromColumn}) REFERENCES ${r.toTable}(${r.toColumn});`);
    }
    return { ok: true, result: { sql: lines.join("\n").trim(), tableCount: sc.tables.length } };
  });

  registerLensAction("database", "schema-dashboard", (ctx, _a, _params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const schemas = dbSchemas(s, dbActor(ctx));
    return {
      ok: true,
      result: {
        schemas: schemas.length,
        totalTables: schemas.reduce((n, sc) => n + sc.tables.length, 0),
        totalRelations: schemas.reduce((n, sc) => n + sc.relations.length, 0),
      },
    };
  });
}
