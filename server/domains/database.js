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

  // ═══════════════════════════════════════════════════════════════════════
  // Connection manager + live in-memory relational store + SQL engine.
  // The "connected database" is a per-user in-memory dataset substrate:
  // each connection owns datasets (tables) of typed, real rows the user
  // creates/imports. The SQL engine below is a real interpreter over them.
  // ═══════════════════════════════════════════════════════════════════════

  function getDbStore() {
    const s = getDatabaseState();
    if (!s) return null;
    if (!(s.connections instanceof Map)) s.connections = new Map();   // userId -> Array<connection>
    if (!(s.history instanceof Map)) s.history = new Map();           // userId -> Array<historyEntry>
    return s;
  }
  const dbConns = (s, userId) => { if (!s.connections.has(userId)) s.connections.set(userId, []); return s.connections.get(userId); };
  const dbHist = (s, userId) => { if (!s.history.has(userId)) s.history.set(userId, []); return s.history.get(userId); };
  const findConn = (s, ctx, id) => dbConns(s, dbActor(ctx)).find((c) => c.id === id);

  // ── Connection manager ────────────────────────────────────────────────

  registerLensAction("database", "connection-create", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = dbClean(params.name, 80);
    if (!name) return { ok: false, error: "connection name required" };
    const conn = {
      id: dbId("conn"),
      name,
      engine: ["sqlite", "postgresql", "mysql", "in-memory"].includes(params.engine) ? params.engine : "in-memory",
      host: dbClean(params.host, 200) || "local",
      database: dbClean(params.database, 120) || name,
      // credentials stored per-user (never leaves the user's STATE bucket)
      username: dbClean(params.username, 120) || "",
      readOnly: params.readOnly !== false,
      color: dbClean(params.color, 16) || "#10b981",
      datasets: [],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    dbConns(s, dbActor(ctx)).push(conn);
    saveDatabase();
    return { ok: true, result: { connection: connSummary(conn) } };
  });

  function connSummary(c) {
    return {
      id: c.id, name: c.name, engine: c.engine, host: c.host, database: c.database,
      username: c.username, readOnly: c.readOnly, color: c.color,
      datasetCount: c.datasets.length,
      rowTotal: c.datasets.reduce((n, d) => n + d.rows.length, 0),
      createdAt: c.createdAt, lastUsedAt: c.lastUsedAt,
    };
  }

  registerLensAction("database", "connection-list", (ctx, _a, _params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = dbConns(s, dbActor(ctx)).map(connSummary);
    return { ok: true, result: { connections: list, count: list.length } };
  });

  registerLensAction("database", "connection-update", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.id);
    if (!c) return { ok: false, error: "connection not found" };
    if (params.name != null) c.name = dbClean(params.name, 80) || c.name;
    if (params.host != null) c.host = dbClean(params.host, 200);
    if (params.database != null) c.database = dbClean(params.database, 120);
    if (params.username != null) c.username = dbClean(params.username, 120);
    if (params.readOnly != null) c.readOnly = params.readOnly !== false;
    if (params.color != null) c.color = dbClean(params.color, 16) || c.color;
    saveDatabase();
    return { ok: true, result: { connection: connSummary(c) } };
  });

  registerLensAction("database", "connection-delete", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = dbConns(s, dbActor(ctx));
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "connection not found" };
    arr.splice(i, 1);
    saveDatabase();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("database", "connection-test", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.id);
    if (!c) return { ok: false, error: "connection not found" };
    c.lastUsedAt = new Date().toISOString();
    saveDatabase();
    return { ok: true, result: { connected: true, engine: c.engine, datasets: c.datasets.length, latencyMs: 0 } };
  });

  // ── Datasets (tables) — typed columns + real rows ─────────────────────

  registerLensAction("database", "dataset-create", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const name = dbIdent(params.name, 64);
    if (!name) return { ok: false, error: "dataset name required" };
    if (c.datasets.some((d) => d.name === name)) return { ok: false, error: "dataset name already exists" };
    let columns = Array.isArray(params.columns) ? params.columns : [];
    columns = columns
      .map((col) => ({ name: dbIdent(col.name, 64), type: COL_TYPES.includes(col.type) ? col.type : "text" }))
      .filter((col) => col.name);
    if (columns.length === 0) columns = [{ name: "id", type: "integer" }];
    const ds = { id: dbId("ds"), name, columns, rows: [], rowSeq: 0, x: 40, y: 40 };
    c.datasets.push(ds);
    saveDatabase();
    return { ok: true, result: { dataset: ds } };
  });

  registerLensAction("database", "dataset-list", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const datasets = c.datasets.map((d) => ({
      id: d.id, name: d.name, columns: d.columns,
      rowCount: d.rows.length, x: d.x, y: d.y,
    }));
    return { ok: true, result: { datasets, count: datasets.length } };
  });

  registerLensAction("database", "dataset-delete", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const i = c.datasets.findIndex((d) => d.id === params.datasetId);
    if (i < 0) return { ok: false, error: "dataset not found" };
    c.datasets.splice(i, 1);
    saveDatabase();
    return { ok: true, result: { deleted: params.datasetId } };
  });

  function coerceCell(type, raw) {
    if (raw == null || raw === "") return null;
    if (type === "integer" || type === "bigint") { const n = parseInt(raw, 10); return Number.isFinite(n) ? n : null; }
    if (type === "real" || type === "numeric") { const n = parseFloat(raw); return Number.isFinite(n) ? n : null; }
    if (type === "boolean") return raw === true || raw === "true" || raw === 1 || raw === "1";
    return String(raw).slice(0, 2000);
  }
  function buildRow(ds, values) {
    const row = {};
    for (const col of ds.columns) row[col.name] = coerceCell(col.type, values?.[col.name]);
    return row;
  }

  // ── Result-grid editing: insert / update / delete rows ────────────────

  registerLensAction("database", "row-insert", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    if (c.readOnly) return { ok: false, error: "connection is read-only" };
    const ds = c.datasets.find((d) => d.id === params.datasetId);
    if (!ds) return { ok: false, error: "dataset not found" };
    const row = buildRow(ds, params.values || {});
    row._rid = ++ds.rowSeq;
    ds.rows.push(row);
    saveDatabase();
    return { ok: true, result: { row, rowCount: ds.rows.length } };
  });

  registerLensAction("database", "row-update", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    if (c.readOnly) return { ok: false, error: "connection is read-only" };
    const ds = c.datasets.find((d) => d.id === params.datasetId);
    if (!ds) return { ok: false, error: "dataset not found" };
    const row = ds.rows.find((r) => r._rid === params.rid);
    if (!row) return { ok: false, error: "row not found" };
    const colName = dbIdent(params.column, 64);
    const col = ds.columns.find((cl) => cl.name === colName);
    if (!col) return { ok: false, error: "column not found" };
    row[col.name] = coerceCell(col.type, params.value);
    saveDatabase();
    return { ok: true, result: { row } };
  });

  registerLensAction("database", "row-delete", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    if (c.readOnly) return { ok: false, error: "connection is read-only" };
    const ds = c.datasets.find((d) => d.id === params.datasetId);
    if (!ds) return { ok: false, error: "dataset not found" };
    const i = ds.rows.findIndex((r) => r._rid === params.rid);
    if (i < 0) return { ok: false, error: "row not found" };
    ds.rows.splice(i, 1);
    saveDatabase();
    return { ok: true, result: { deleted: params.rid, rowCount: ds.rows.length } };
  });

  // ── ER diagram canvas: persist draggable table positions ──────────────

  registerLensAction("database", "dataset-move", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const ds = c.datasets.find((d) => d.id === params.datasetId);
    if (!ds) return { ok: false, error: "dataset not found" };
    ds.x = Math.max(0, Math.min(4000, Number(params.x) || 0));
    ds.y = Math.max(0, Math.min(4000, Number(params.y) || 0));
    saveDatabase();
    return { ok: true, result: { datasetId: ds.id, x: ds.x, y: ds.y } };
  });

  // ── SQL engine: a real interpreter over connection datasets ───────────
  // Supports SELECT (cols / *, WHERE, ORDER BY, LIMIT, COUNT(*)),
  // INSERT INTO, UPDATE, DELETE — all against the in-memory rows.

  function tokenizeWhere(expr) {
    // very small predicate: column OP value [AND/OR column OP value]...
    const clauses = [];
    const parts = expr.split(/\s+(AND|OR)\s+/i);
    for (let i = 0; i < parts.length; i += 2) {
      const seg = parts[i];
      const join = i > 0 ? parts[i - 1].toUpperCase() : "AND";
      const m = seg.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|!=|<>|=|>|<|LIKE)\s*(.+?)\s*$/i);
      if (!m) return null;
      let val = m[3].trim();
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1);
      } else if (/^-?\d+(\.\d+)?$/.test(val)) {
        val = parseFloat(val);
      } else if (val.toLowerCase() === "null") {
        val = null;
      } else if (val.toLowerCase() === "true" || val.toLowerCase() === "false") {
        val = val.toLowerCase() === "true";
      }
      clauses.push({ join, col: m[1], op: m[2].toUpperCase(), val });
    }
    return clauses;
  }
  function evalClause(row, cl) {
    const left = row[cl.col];
    const r = cl.val;
    switch (cl.op) {
      // SQL-style operators: loose equality is intentional so a text-typed
      // column value matches a numeric query literal (and vice versa).
      // eslint-disable-next-line eqeqeq
      case "=": return left == r;
      // eslint-disable-next-line eqeqeq
      case "!=": case "<>": return left != r;
      case ">": return left > r;
      case "<": return left < r;
      case ">=": return left >= r;
      case "<=": return left <= r;
      case "LIKE": {
        if (left == null) return false;
        const re = new RegExp("^" + String(r).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
        return re.test(String(left));
      }
      default: return false;
    }
  }
  function rowMatches(row, clauses) {
    if (!clauses || clauses.length === 0) return true;
    let acc = evalClause(row, clauses[0]);
    for (let i = 1; i < clauses.length; i++) {
      const cl = clauses[i];
      acc = cl.join === "OR" ? (acc || evalClause(row, cl)) : (acc && evalClause(row, cl));
    }
    return acc;
  }
  function parseSql(sql) {
    const trimmed = sql.trim().replace(/;\s*$/, "");
    const verb = (trimmed.split(/\s+/)[0] || "").toUpperCase();
    if (verb === "SELECT") {
      const m = trimmed.match(/^SELECT\s+(.+?)\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+([A-Za-z_][A-Za-z0-9_]*)(\s+DESC|\s+ASC)?)?(?:\s+LIMIT\s+(\d+))?\s*$/i);
      if (!m) return { error: "Unsupported SELECT syntax" };
      return {
        verb, table: m[2],
        cols: m[1].trim(),
        where: m[3] ? tokenizeWhere(m[3]) : null,
        orderBy: m[4] || null,
        orderDir: (m[5] || "ASC").trim().toUpperCase(),
        limit: m[6] ? parseInt(m[6], 10) : null,
      };
    }
    if (verb === "INSERT") {
      const m = trimmed.match(/^INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]+)\)\s*VALUES\s*\((.+)\)\s*$/i);
      if (!m) return { error: "Unsupported INSERT syntax" };
      const cols = m[2].split(",").map((c) => c.trim());
      const vals = splitCsvValues(m[3]);
      if (cols.length !== vals.length) return { error: "column/value count mismatch" };
      return { verb, table: m[1], cols, vals };
    }
    if (verb === "UPDATE") {
      const m = trimmed.match(/^UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?\s*$/i);
      if (!m) return { error: "Unsupported UPDATE syntax" };
      const sets = m[2].split(",").map((p) => {
        const sm = p.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
        return sm ? { col: sm[1], val: parseLiteral(sm[2]) } : null;
      });
      if (sets.some((x) => !x)) return { error: "Unsupported SET clause" };
      return { verb, table: m[1], sets, where: m[3] ? tokenizeWhere(m[3]) : null };
    }
    if (verb === "DELETE") {
      const m = trimmed.match(/^DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+WHERE\s+(.+?))?\s*$/i);
      if (!m) return { error: "Unsupported DELETE syntax" };
      return { verb, table: m[1], where: m[2] ? tokenizeWhere(m[2]) : null };
    }
    return { error: `Unsupported statement: ${verb || "(empty)"}` };
  }
  function parseLiteral(v) {
    const t = v.trim();
    if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
    if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    if (t.toLowerCase() === "null") return null;
    if (t.toLowerCase() === "true" || t.toLowerCase() === "false") return t.toLowerCase() === "true";
    return t;
  }
  function splitCsvValues(str) {
    const out = []; let cur = ""; let inq = null;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inq) { if (ch === inq) inq = null; else cur += ch; }
      else if (ch === "'" || ch === '"') inq = ch;
      else if (ch === ",") { out.push(parseLiteral(cur)); cur = ""; }
      else cur += ch;
    }
    if (cur.trim() !== "") out.push(parseLiteral(cur));
    return out;
  }

  function runSqlOnConnection(c, sql) {
    const plan = parseSql(sql);
    if (plan.error) return { error: plan.error };
    const ds = c.datasets.find((d) => d.name.toLowerCase() === String(plan.table).toLowerCase());
    if (!ds) return { error: `dataset "${plan.table}" not found in connection` };
    if (plan.verb === "SELECT") {
      let rows = ds.rows.filter((r) => rowMatches(r, plan.where));
      const isCount = /^count\s*\(\s*\*\s*\)$/i.test(plan.cols);
      if (plan.orderBy && !isCount) {
        const dir = plan.orderDir === "DESC" ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const av = a[plan.orderBy], bv = b[plan.orderBy];
          if (av == null) return 1; if (bv == null) return -1;
          return av < bv ? -dir : av > bv ? dir : 0;
        });
      }
      const scannedRows = ds.rows.length;
      if (typeof plan.limit === "number") rows = rows.slice(0, plan.limit);
      if (isCount) {
        return { columns: ["count"], rows: [{ count: ds.rows.filter((r) => rowMatches(r, plan.where)).length }], rowCount: 1, scannedRows };
      }
      let columns;
      if (plan.cols.trim() === "*") columns = ds.columns.map((cl) => cl.name);
      else columns = plan.cols.split(",").map((x) => x.trim()).filter(Boolean);
      const projected = rows.map((r) => {
        const o = { _rid: r._rid };
        for (const col of columns) o[col] = r[col] ?? null;
        return o;
      });
      return { columns, rows: projected, rowCount: projected.length, scannedRows };
    }
    if (plan.verb === "INSERT") {
      if (c.readOnly) return { error: "connection is read-only" };
      const vals = {};
      plan.cols.forEach((col, i) => { vals[col] = plan.vals[i]; });
      const row = buildRow(ds, vals);
      row._rid = ++ds.rowSeq;
      ds.rows.push(row);
      return { columns: [], rows: [], rowCount: 1, affected: 1, op: "INSERT" };
    }
    if (plan.verb === "UPDATE") {
      if (c.readOnly) return { error: "connection is read-only" };
      let affected = 0;
      for (const r of ds.rows) {
        if (rowMatches(r, plan.where)) {
          for (const set of plan.sets) {
            const col = ds.columns.find((cl) => cl.name === set.col);
            if (col) r[col.name] = coerceCell(col.type, set.val);
          }
          affected++;
        }
      }
      return { columns: [], rows: [], rowCount: 0, affected, op: "UPDATE" };
    }
    if (plan.verb === "DELETE") {
      if (c.readOnly) return { error: "connection is read-only" };
      const before = ds.rows.length;
      ds.rows = ds.rows.filter((r) => !rowMatches(r, plan.where));
      return { columns: [], rows: [], rowCount: 0, affected: before - ds.rows.length, op: "DELETE" };
    }
    return { error: "unhandled statement" };
  }

  // ── query-run: live execution against a connected (in-memory) DB ──────

  registerLensAction("database", "query-run", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const sql = String(params.sql || "").trim();
    if (!sql) return { ok: false, error: "sql required" };
    const t0 = Date.now();
    let res;
    try { res = runSqlOnConnection(c, sql); }
    catch (e) { res = { error: e instanceof Error ? e.message : "query failed" }; }
    const durationMs = Date.now() - t0;
    c.lastUsedAt = new Date().toISOString();
    // record history
    const hist = dbHist(s, dbActor(ctx));
    const entry = {
      id: dbId("h"), connectionId: c.id, connectionName: c.name,
      sql: sql.slice(0, 1000), durationMs,
      rowCount: res.error ? 0 : (res.affected != null ? res.affected : res.rowCount || 0),
      success: !res.error, error: res.error || null,
      at: new Date().toISOString(),
    };
    hist.unshift(entry);
    if (hist.length > 200) hist.length = 200;
    saveDatabase();
    if (res.error) return { ok: true, result: { error: res.error, durationMs, success: false } };
    return {
      ok: true,
      result: {
        columns: res.columns || [], rows: res.rows || [],
        rowCount: res.rowCount || 0, affected: res.affected ?? null,
        op: res.op || "SELECT", durationMs, success: true,
      },
    };
  });

  // ── query-explain: EXPLAIN / query-plan visualization ─────────────────

  registerLensAction("database", "query-explain", (ctx, _a, params = {}) => {
  try {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const sql = String(params.sql || "").trim();
    if (!sql) return { ok: false, error: "sql required" };
    const plan = parseSql(sql);
    if (plan.error) return { ok: true, result: { error: plan.error } };
    const ds = c.datasets.find((d) => d.name.toLowerCase() === String(plan.table).toLowerCase());
    if (!ds) return { ok: true, result: { error: `dataset "${plan.table}" not found` } };
    const totalRows = ds.rows.length;
    const nodes = [];
    // leaf: table scan
    const hasWhere = plan.where && plan.where.length > 0;
    const scanCost = totalRows;
    nodes.push({
      id: "scan", label: `Seq Scan on ${ds.name}`, type: "scan",
      rows: totalRows, cost: scanCost,
      detail: `${totalRows} row${totalRows !== 1 ? "s" : ""} read`,
    });
    let estRows = totalRows;
    if (hasWhere) {
      estRows = Math.max(1, Math.round(totalRows * 0.4));
      nodes.push({
        id: "filter", label: "Filter", type: "filter",
        rows: estRows, cost: totalRows,
        detail: plan.where.map((w) => `${w.col} ${w.op} ${w.val}`).join(` ${plan.where[1]?.join || "AND"} `),
        children: ["scan"],
      });
    }
    if (plan.verb === "SELECT" && plan.orderBy) {
      nodes.push({
        id: "sort", label: `Sort by ${plan.orderBy} ${plan.orderDir}`, type: "sort",
        rows: estRows, cost: Math.round(estRows * Math.log2(Math.max(2, estRows))),
        detail: "in-memory sort", children: [hasWhere ? "filter" : "scan"],
      });
    }
    if (plan.verb === "SELECT" && plan.limit != null) {
      nodes.push({
        id: "limit", label: `Limit ${plan.limit}`, type: "limit",
        rows: Math.min(plan.limit, estRows), cost: 0, detail: "first N rows",
        children: [plan.orderBy ? "sort" : hasWhere ? "filter" : "scan"],
      });
    }
    const totalCost = nodes.reduce((n, x) => n + x.cost, 0);
    const warnings = [];
    if (totalRows > 1000 && !hasWhere && plan.verb === "SELECT") warnings.push("Full table scan with no filter — consider a WHERE clause.");
    if (plan.verb === "SELECT" && plan.orderBy && !hasWhere) warnings.push("Sorting an unfiltered table is expensive at scale.");
    return {
      ok: true,
      result: {
        verb: plan.verb, table: ds.name, nodes,
        totalCost, estimatedRows: nodes[nodes.length - 1].rows,
        warnings,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── query-history: persisted live-execution log ───────────────────────

  registerLensAction("database", "query-history", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    let hist = dbHist(s, dbActor(ctx));
    if (params.connectionId) hist = hist.filter((h) => h.connectionId === params.connectionId);
    const limit = Math.max(1, Math.min(200, Number(params.limit) || 50));
    return { ok: true, result: { history: hist.slice(0, limit), count: hist.length } };
  });

  registerLensAction("database", "history-clear", (ctx, _a, _params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    s.history.set(dbActor(ctx), []);
    saveDatabase();
    return { ok: true, result: { cleared: true } };
  });

  // ── query-export: CSV / JSON serialization of a result set ────────────

  registerLensAction("database", "query-export", (ctx, _a, params = {}) => {
    const columns = Array.isArray(params.columns) ? params.columns.map(String) : [];
    const rows = Array.isArray(params.rows) ? params.rows : [];
    const format = params.format === "json" ? "json" : "csv";
    if (columns.length === 0) return { ok: false, error: "columns required" };
    if (format === "json") {
      const slim = rows.map((r) => {
        const o = {};
        for (const col of columns) o[col] = r?.[col] ?? null;
        return o;
      });
      return { ok: true, result: { format: "json", content: JSON.stringify(slim, null, 2), rowCount: slim.length } };
    }
    const esc = (v) => {
      const str = v == null ? "" : String(v);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const lines = [columns.map(esc).join(",")];
    for (const r of rows) lines.push(columns.map((col) => esc(r?.[col])).join(","));
    return { ok: true, result: { format: "csv", content: lines.join("\n"), rowCount: rows.length } };
  });

  // ── sql-autocomplete: schema-aware completion suggestions ─────────────

  registerLensAction("database", "sql-autocomplete", (ctx, _a, params = {}) => {
  try {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    const prefix = String(params.prefix || "").toLowerCase();
    const KEYWORDS = [
      "SELECT", "FROM", "WHERE", "ORDER BY", "LIMIT", "INSERT INTO", "VALUES",
      "UPDATE", "SET", "DELETE FROM", "AND", "OR", "LIKE", "COUNT(*)", "ASC", "DESC",
    ];
    const suggestions = [];
    for (const k of KEYWORDS) {
      if (!prefix || k.toLowerCase().startsWith(prefix)) suggestions.push({ value: k, kind: "keyword" });
    }
    if (c) {
      for (const ds of c.datasets) {
        if (!prefix || ds.name.toLowerCase().startsWith(prefix)) suggestions.push({ value: ds.name, kind: "table" });
        for (const col of ds.columns) {
          if (!prefix || col.name.toLowerCase().startsWith(prefix)) {
            suggestions.push({ value: col.name, kind: "column", table: ds.name, type: col.type });
          }
        }
      }
    }
    return { ok: true, result: { suggestions: suggestions.slice(0, 40), count: suggestions.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
