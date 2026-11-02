// server/domains/database.js
import { guardAnonWrites } from "../lib/lens-authz.js";
export default function registerDatabaseActions(registerLensAction) {
  registerLensAction = guardAnonWrites(registerLensAction); // anonymous callers can read, not write (lib/lens-authz.js)
  // The analysis quartet reads its input from the artifact when one is
  // attached, or from params.input when a panel calls it directly (S8) —
  // same pure functions, two honest input paths.
  registerLensAction("database", "schemaAnalysis", (ctx, artifact, _params) => {
    const tables = (artifact?.data || _params?.input || {}).tables || [];
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
    const query = (artifact?.data || _params?.input || {}).query || "";
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
    const changes = (artifact?.data || _params?.input || {}).changes || [];
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
    const tables = (artifact?.data || _params?.input || {}).tables || [];
    const queries = (artifact?.data || _params?.input || {}).queries || [];
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

  // ── Renames (S10/F11): the lifecycle was missing its rename verbs.
  // Relations key tables and columns BY NAME, so renames cascade into
  // them — a rename that orphaned its relations would be S3's silent
  // wrong answer wearing a new coat.
  registerLensAction("database", "schema-rename", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = findSchema(s, ctx, params.id);
    if (!sc) return { ok: false, error: "schema not found" };
    const name = dbClean(params.name, 120);
    if (!name) return { ok: false, error: "schema name required" };
    if (dbSchemas(s, dbActor(ctx)).some((x) => x.id !== sc.id && x.name === name)) {
      return { ok: false, error: "schema name already exists" };
    }
    sc.name = name;
    saveDatabase();
    return { ok: true, result: { schema: sc } };
  });

  registerLensAction("database", "table-rename", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = findSchema(s, ctx, params.schemaId);
    if (!sc) return { ok: false, error: "schema not found" };
    const t = sc.tables.find((x) => x.id === params.tableId);
    if (!t) return { ok: false, error: "table not found" };
    const name = dbIdent(params.name, 64);
    if (!name) return { ok: false, error: "table name required" };
    if (sc.tables.some((x) => x.id !== t.id && x.name === name)) return { ok: false, error: "table name already exists" };
    const old = t.name;
    t.name = name;
    for (const r of sc.relations || []) {
      if (r.fromTable === old) r.fromTable = name;
      if (r.toTable === old) r.toTable = name;
    }
    saveDatabase();
    return { ok: true, result: { table: t } };
  });

  registerLensAction("database", "column-rename", (ctx, _a, params = {}) => {
    const s = getDatabaseState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sc = findSchema(s, ctx, params.schemaId);
    if (!sc) return { ok: false, error: "schema not found" };
    const t = sc.tables.find((x) => x.id === params.tableId);
    if (!t) return { ok: false, error: "table not found" };
    const col = t.columns.find((x) => x.id === params.columnId);
    if (!col) return { ok: false, error: "column not found" };
    const name = dbIdent(params.name, 64);
    if (!name) return { ok: false, error: "column name required" };
    if (t.columns.some((x) => x.id !== col.id && x.name === name)) return { ok: false, error: "column name already exists" };
    const old = col.name;
    col.name = name;
    for (const r of sc.relations || []) {
      if (r.fromTable === t.name && r.fromColumn === old) r.fromColumn = name;
      if (r.toTable === t.name && r.toColumn === old) r.toColumn = name;
    }
    saveDatabase();
    return { ok: true, result: { column: col } };
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

  // ── The platform DTU store as a read-only virtual dataset ─────────────
  // The Query Editor ships prefilled with a query over `dtus`; that table
  // is the platform's DTU store, not a user dataset. It resolves virtually
  // (read-only) on every connection, so the shipped query — and any SELECT
  // over dtus — runs against real rows. Writes are refused honestly.
  function virtualDtusDataset() {
    const STATE = globalThis._concordSTATE;
    const dtus = STATE?.dtus instanceof Map ? [...STATE.dtus.values()] : [];
    return {
      id: "dtus_virtual", name: "dtus", virtual: true,
      columns: [
        { name: "id", type: "text" }, { name: "title", type: "text" },
        { name: "tier", type: "text" }, { name: "tags", type: "text" },
        { name: "created_at", type: "timestamp" },
      ],
      rows: dtus.map((d, i) => ({
        _rid: i + 1,
        id: String(d?.id || ""),
        title: String(d?.title || d?.human?.summary || ""),
        tier: String(d?.tier || ""),
        tags: (Array.isArray(d?.meta?.tags) ? d.meta.tags : Array.isArray(d?.tags) ? d.tags : []).join(", "),
        created_at: String(d?.createdAt || d?.meta?.createdAt || ""),
      })),
      rowSeq: dtus.length,
    };
  }
  function resolveDataset(c, tableName) {
    const name = String(tableName || "").toLowerCase();
    const ds = c.datasets.find((d) => d.name.toLowerCase() === name);
    if (ds) return ds;
    if (name === "dtus") return virtualDtusDataset();
    return null;
  }
  // An explicit connectionId must resolve or the caller hears so; with no
  // id, the actor's first connection serves, and with no connection at all
  // an ephemeral workspace shell serves so the virtual dtus table (and the
  // Query Editor's shipped default query) still runs for a fresh account.
  function resolveConnection(s, ctx, connectionId) {
    if (connectionId) return findConn(s, ctx, connectionId) || null;
    const mine = dbConns(s, dbActor(ctx));
    if (mine.length > 0) return mine[0];
    return { id: "workspace", name: "Workspace", datasets: [], readOnly: false, ephemeral: true };
  }

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
      relations: [],
      indexes: [],
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
    // Datasets live in Concord's workspace store; host/database/username are labels.
    // This confirms the workspace copy is readable — it never contacts a remote server.
    return { ok: true, result: { connected: true, scope: "workspace", remoteContacted: false, engine: c.engine, datasets: c.datasets.length } };
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
    // A leading integer `id` is the dataset's primary key — the same
    // convention the Designer applies — recorded on the column so every
    // surface (Table Browser, Schema Map) can show it truthfully.
    if (columns[0].name === "id" && columns[0].type === "integer") columns[0].pk = true;
    const ds = { id: dbId("ds"), name, columns, rows: [], rowSeq: 0, x: 40, y: 40 };
    c.datasets.push(ds);
    if (!Array.isArray(c.relations)) c.relations = [];
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
      sizeBytes: Buffer.byteLength(JSON.stringify(d.rows)),
    }));
    return { ok: true, result: { datasets, count: datasets.length, relations: Array.isArray(c.relations) ? c.relations : [], indexes: Array.isArray(c.indexes) ? c.indexes : [] } };
  });

  registerLensAction("database", "dataset-delete", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const i = c.datasets.findIndex((d) => d.id === params.datasetId);
    if (i < 0) return { ok: false, error: "dataset not found" };
    const removedName = c.datasets[i].name;
    c.datasets.splice(i, 1);
    if (Array.isArray(c.relations)) {
      c.relations = c.relations.filter((r) => r.fromDataset !== removedName && r.toDataset !== removedName);
    }
    if (Array.isArray(c.indexes)) {
      c.indexes = c.indexes.filter((x) => x.dataset !== removedName);
    }
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
  // Strict coercion for writes (S3/F4): a non-empty value that cannot be
  // the column's type is an ERROR naming the column and the expected type
  // — never a silent NULL under a success banner. Empty stays NULL
  // (nullable semantics); text-family types accept any string form.
  function coerceCellStrict(type, raw) {
    if (raw == null || raw === "") return { value: null };
    if (type === "integer" || type === "bigint") {
      if (typeof raw === "number" && Number.isInteger(raw)) return { value: raw };
      const t = String(raw).trim();
      if (/^-?\d+$/.test(t)) return { value: parseInt(t, 10) };
      return { error: true };
    }
    if (type === "real" || type === "numeric") {
      if (typeof raw === "number" && Number.isFinite(raw)) return { value: raw };
      const t = String(raw).trim();
      if (/^-?\d+(\.\d+)?$/.test(t)) return { value: parseFloat(t) };
      return { error: true };
    }
    if (type === "boolean") {
      if (raw === true || raw === false) return { value: raw };
      const t = String(raw).trim().toLowerCase();
      if (t === "true" || t === "1") return { value: true };
      if (t === "false" || t === "0") return { value: false };
      return { error: true };
    }
    return { value: String(raw).slice(0, 2000) };
  }
  function buildRowChecked(ds, values) {
    const row = {};
    for (const col of ds.columns) {
      const raw = values?.[col.name];
      const c = coerceCellStrict(col.type, raw);
      if (c.error) return { error: `column "${col.name}" expects ${col.type}, got ${JSON.stringify(raw)}` };
      row[col.name] = c.value;
    }
    return { row };
  }

  // ── Result-grid editing: insert / update / delete rows ────────────────

  registerLensAction("database", "row-insert", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    if (c.readOnly) return { ok: false, error: "connection is read-only" };
    const ds = c.datasets.find((d) => d.id === params.datasetId);
    if (!ds) return { ok: false, error: "dataset not found" };
    const checked = buildRowChecked(ds, params.values || {});
    if (checked.error) return { ok: false, error: checked.error };
    const row = checked.row;
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
    const checked = coerceCellStrict(col.type, params.value);
    if (checked.error) return { ok: false, error: `column "${col.name}" expects ${col.type}, got ${JSON.stringify(params.value)}` };
    row[col.name] = checked.value;
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

  // ── Dataset relations (foreign keys between datasets, S4) ────────────
  // The Designer schemas have relation-add/relation-delete; datasets —
  // the objects the ER Diagram draws — had no relation store at all.
  // Relations live on the connection, validated against real datasets
  // and columns, and ride dataset-list so the ER can draw them.

  registerLensAction("database", "dataset-relation-add", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const from = c.datasets.find((d) => d.name === params.fromDataset);
    const to = c.datasets.find((d) => d.name === params.toDataset);
    if (!from || !to) return { ok: false, error: "both datasets must exist in the connection" };
    if (!from.columns.some((cl) => cl.name === params.fromColumn)) {
      return { ok: false, error: `column "${params.fromColumn}" does not exist on dataset "${from.name}"` };
    }
    if (!to.columns.some((cl) => cl.name === params.toColumn)) {
      return { ok: false, error: `column "${params.toColumn}" does not exist on dataset "${to.name}"` };
    }
    if (!Array.isArray(c.relations)) c.relations = [];
    if (c.relations.some((r) => r.fromDataset === from.name && r.fromColumn === params.fromColumn && r.toDataset === to.name && r.toColumn === params.toColumn)) {
      return { ok: false, error: "that relation already exists" };
    }
    const relation = {
      id: dbId("drel"),
      fromDataset: from.name, fromColumn: String(params.fromColumn),
      toDataset: to.name, toColumn: String(params.toColumn),
    };
    c.relations.push(relation);
    saveDatabase();
    return { ok: true, result: { relation } };
  });

  // Move a dataset (with its rows) to another of the actor's
  // connections (S6). Relations touching it stay behind and are pruned —
  // a relation cannot span connections.
  registerLensAction("database", "dataset-transfer", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const from = findConn(s, ctx, params.fromConnectionId);
    if (!from) return { ok: false, error: "source connection not found" };
    const to = findConn(s, ctx, params.toConnectionId);
    if (!to) return { ok: false, error: "target connection not found" };
    if (from.id === to.id) return { ok: false, error: "source and target are the same connection" };
    const i = from.datasets.findIndex((d) => d.id === params.datasetId);
    if (i < 0) return { ok: false, error: "dataset not found" };
    const ds = from.datasets[i];
    if (to.datasets.some((d) => d.name === ds.name)) {
      return { ok: false, error: `target connection already has a dataset named "${ds.name}"` };
    }
    from.datasets.splice(i, 1);
    if (Array.isArray(from.relations)) {
      from.relations = from.relations.filter((r) => r.fromDataset !== ds.name && r.toDataset !== ds.name);
    }
    if (Array.isArray(from.indexes)) {
      from.indexes = from.indexes.filter((x) => x.dataset !== ds.name);
    }
    to.datasets.push(ds);
    saveDatabase();
    return { ok: true, result: { datasetId: ds.id, name: ds.name, fromConnectionId: from.id, toConnectionId: to.id } };
  });

  // ── Indexes (S8): real per-connection index objects, built from the
  // dataset's actual key values; the size is the measured key payload.
  registerLensAction("database", "index-create", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const ds = c.datasets.find((d) => d.name === params.dataset);
    if (!ds) return { ok: false, error: `dataset "${params.dataset}" not found` };
    const column = String(params.column || "");
    if (!ds.columns.some((cl) => cl.name === column)) {
      return { ok: false, error: `column "${column}" does not exist on dataset "${ds.name}"` };
    }
    if (!Array.isArray(c.indexes)) c.indexes = [];
    const name = `idx_${ds.name}_${column}`;
    if (c.indexes.some((x) => x.name === name)) return { ok: false, error: `index "${name}" already exists` };
    const keys = ds.rows.map((r) => r[column] ?? null);
    const index = {
      id: dbId("idx"), name, dataset: ds.name, columns: [column],
      unique: false, type: "btree",
      sizeBytes: Buffer.byteLength(JSON.stringify(keys)),
      rowCount: ds.rows.length,
      createdAt: new Date().toISOString(),
    };
    c.indexes.push(index);
    saveDatabase();
    return { ok: true, result: { index } };
  });

  registerLensAction("database", "index-delete", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    if (!Array.isArray(c.indexes)) c.indexes = [];
    const i = c.indexes.findIndex((x) => x.id === params.indexId);
    if (i < 0) return { ok: false, error: "index not found" };
    c.indexes.splice(i, 1);
    saveDatabase();
    return { ok: true, result: { deleted: params.indexId } };
  });

  // ── CSV import (S7/F5): file or paste text lands as rows. A bad row
  // is reported by row number with its reason — never silently skipped
  // or nulled (S3's rule); the summary reconciles imported + rejected.
  function parseCsv(text) {
    const rows = [];
    let row = [], cur = "", inq = false;
    const src = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inq) {
        if (ch === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else inq = false; }
        else cur += ch;
      } else if (ch === '"') inq = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); cur = ""; rows.push(row); row = []; }
      else cur += ch;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  registerLensAction("database", "dataset-import-csv", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    if (c.readOnly) return { ok: false, error: "connection is read-only" };
    const csvText = String(params.csv || "");
    if (!csvText.trim()) return { ok: false, error: "csv required" };
    const parsed = parseCsv(csvText);
    if (parsed.length < 2) return { ok: false, error: "csv needs a header row and at least one data row" };
    const header = parsed[0].map((h) => dbIdent(h, 64));
    if (header.some((h) => !h)) return { ok: false, error: "csv header has an empty column name" };
    if (new Set(header).size !== header.length) return { ok: false, error: "csv header has duplicate column names" };
    const dataRows = parsed.slice(1).filter((r) => !(r.length === 1 && r[0].trim() === ""));
    if (dataRows.length === 0) return { ok: false, error: "csv has no data rows" };
    if (dataRows.length > 5000) return { ok: false, error: `import is limited to 5000 rows (got ${dataRows.length})` };

    let ds;
    if (params.datasetId) {
      ds = c.datasets.find((d) => d.id === params.datasetId);
      if (!ds) return { ok: false, error: "dataset not found" };
      for (const h of header) {
        if (!ds.columns.some((cl) => cl.name === h)) {
          return { ok: false, error: `csv column "${h}" does not exist on dataset "${ds.name}"` };
        }
      }
    } else {
      const name = dbIdent(params.name || "imported", 64);
      if (!name) return { ok: false, error: "dataset name required" };
      if (c.datasets.some((d) => d.name === name)) return { ok: false, error: "dataset name already exists" };
      const columns = header.map((h, j) => {
        const vals = dataRows.map((r) => (r[j] ?? "").trim()).filter((v) => v !== "");
        let type = "text";
        if (vals.length && vals.every((v) => /^-?\d+$/.test(v))) type = "integer";
        else if (vals.length && vals.every((v) => /^-?\d+(\.\d+)?$/.test(v))) type = "real";
        else if (vals.length && vals.every((v) => /^(true|false)$/i.test(v))) type = "boolean";
        return { name: h, type };
      });
      if (columns[0].name === "id" && columns[0].type === "integer") columns[0].pk = true;
      ds = { id: dbId("ds"), name, columns, rows: [], rowSeq: 0, x: 40, y: 40 };
      c.datasets.push(ds);
      if (!Array.isArray(c.relations)) c.relations = [];
    }

    let imported = 0;
    const errors = [];
    dataRows.forEach((r, i) => {
      const rowNo = i + 2; // header is row 1
      if (r.length !== header.length) {
        errors.push({ row: rowNo, error: `expected ${header.length} fields, got ${r.length}` });
        return;
      }
      const values = {};
      header.forEach((h, j) => { values[h] = r[j]; });
      const checked = buildRowChecked(ds, values);
      if (checked.error) { errors.push({ row: rowNo, error: checked.error }); return; }
      checked.row._rid = ++ds.rowSeq;
      ds.rows.push(checked.row);
      imported++;
    });
    saveDatabase();
    return {
      ok: true,
      result: {
        datasetId: ds.id, dataset: ds.name,
        imported, rejected: errors.length, totalRows: dataRows.length,
        errors: errors.slice(0, 20),
      },
    };
  });

  registerLensAction("database", "dataset-rename", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const ds = c.datasets.find((d) => d.id === params.datasetId);
    if (!ds) return { ok: false, error: "dataset not found" };
    const name = dbIdent(params.name, 64);
    if (!name) return { ok: false, error: "dataset name required" };
    if (c.datasets.some((d) => d.id !== ds.id && d.name === name)) return { ok: false, error: "dataset name already exists" };
    const old = ds.name;
    ds.name = name;
    // Relations and indexes key the dataset by name — cascade.
    for (const r of c.relations || []) {
      if (r.fromDataset === old) r.fromDataset = name;
      if (r.toDataset === old) r.toDataset = name;
    }
    for (const ix of c.indexes || []) {
      if (ix.dataset === old) {
        ix.dataset = name;
        if (ix.name === `idx_${old}_${ix.columns[0]}`) ix.name = `idx_${name}_${ix.columns[0]}`;
      }
    }
    saveDatabase();
    return { ok: true, result: { dataset: { id: ds.id, name: ds.name } } };
  });

  registerLensAction("database", "dataset-relation-delete", (ctx, _a, params = {}) => {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = findConn(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    if (!Array.isArray(c.relations)) c.relations = [];
    const i = c.relations.findIndex((r) => r.id === params.relationId);
    if (i < 0) return { ok: false, error: "relation not found" };
    c.relations.splice(i, 1);
    saveDatabase();
    return { ok: true, result: { deleted: params.relationId } };
  });

  // ── SQL engine: a real interpreter over connection datasets ───────────
  // Supports SELECT (cols / *, WHERE, ORDER BY, LIMIT, COUNT(*)),
  // INSERT INTO, UPDATE, DELETE — all against the in-memory rows.

  function tokenizeWhere(expr) {
    // very small predicate: column OP value [AND/OR column OP value]...
    // Columns may be table-qualified (t.col) for joined queries.
    const clauses = [];
    const parts = expr.split(/\s+(AND|OR)\s+/i);
    for (let i = 0; i < parts.length; i += 2) {
      const seg = parts[i];
      const join = i > 0 ? parts[i - 1].toUpperCase() : "AND";
      const m = seg.match(/^\s*((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|!=|<>|=|>|<|LIKE)\s*(.+?)\s*$/i);
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
  // Resolve a possibly-qualified column reference against a row view.
  // Joined rows carry a __tables map ({ tableName: row }) alongside the
  // merged flat view; a qualified ref reads its own table's row.
  function resolveCol(row, ref) {
    const dot = String(ref).indexOf(".");
    if (dot > 0 && row?.__tables) {
      const t = row.__tables[String(ref).slice(0, dot)];
      if (t) return t[String(ref).slice(dot + 1)];
    }
    return row?.[String(ref).slice(dot + 1)] ?? row?.[ref];
  }
  // Value of an ON-clause reference for a (left, right) row pair. A
  // qualified ref reads its named table; a bare ref reads the side whose
  // schema actually has the column (left wins ties).
  function joinRefValue(ref, leftDs, l, rightDs, r) {
    const dot = String(ref).indexOf(".");
    if (dot > 0) {
      const t = String(ref).slice(0, dot).toLowerCase();
      const col = String(ref).slice(dot + 1);
      return (t === rightDs.name.toLowerCase() ? r : l)[col];
    }
    if (!leftDs.columns.some((cl) => cl.name === ref) && rightDs.columns.some((cl) => cl.name === ref)) return r[ref];
    return l[ref];
  }
  function evalClause(row, cl) {
    const left = resolveCol(row, cl.col);
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
  // tokenizeWhere with a named failure: an unparseable predicate must
  // surface as an error (S3) — silently treating it as "match everything"
  // is a silent wrong answer.
  function tokenizeWhereChecked(expr) {
    const clauses = tokenizeWhere(expr);
    if (clauses) return { where: clauses };
    const parts = expr.split(/\s+(?:AND|OR)\s+/i);
    const segRe = /^\s*((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|!=|<>|=|>|<|LIKE)\s*(.+?)\s*$/i;
    const bad = parts.find((seg) => !segRe.test(seg));
    return { where: null, whereInvalid: true, whereBadSegment: bad ? bad.trim().slice(0, 60) : "" };
  }
  function parseSql(sql) {
    const trimmed = sql.trim().replace(/;\s*$/, "");
    const verb = (trimmed.split(/\s+/)[0] || "").toUpperCase();
    if (verb === "EXPLAIN") {
      const inner = trimmed.replace(/^EXPLAIN\s+/i, "");
      if (/^EXPLAIN\b/i.test(inner)) return { error: "Unsupported statement: EXPLAIN EXPLAIN" };
      const plan = parseSql(inner);
      if (plan.error) return plan;
      plan.explain = true;
      return plan;
    }
    if (verb === "SELECT") {
      // JOIN form first: FROM t1 [INNER|LEFT] JOIN t2 ON a.x = b.y
      const jm = trimmed.match(/^SELECT\s+(.+?)\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)\s+(INNER\s+|LEFT\s+)?JOIN\s+([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)\s*=\s*((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)(\s+DESC|\s+ASC)?)?(?:\s+LIMIT\s+(\d+))?\s*$/i);
      if (jm) {
        return {
          verb, table: jm[2],
          join: {
            kind: (jm[3] || "INNER").trim().toUpperCase() === "LEFT" ? "LEFT" : "INNER",
            table: jm[4], onLeft: jm[5], onRight: jm[6],
          },
          cols: jm[1].trim(),
          ...(jm[7] ? tokenizeWhereChecked(jm[7]) : { where: null }),
          orderBy: jm[8] || null,
          orderDir: (jm[9] || "ASC").trim().toUpperCase(),
          limit: jm[10] ? parseInt(jm[10], 10) : null,
        };
      }
      if (/\bJOIN\b/i.test(trimmed)) return { error: "Unsupported JOIN syntax", position: trimmed.toUpperCase().indexOf("JOIN") };
      const m = trimmed.match(/^SELECT\s+(.+?)\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)(\s+DESC|\s+ASC)?)?(?:\s+LIMIT\s+(\d+))?\s*$/i);
      if (!m) return { error: "Unsupported SELECT syntax" };
      return {
        verb, table: m[2],
        cols: m[1].trim(),
        ...(m[3] ? tokenizeWhereChecked(m[3]) : { where: null }),
        orderBy: m[4] || null,
        orderDir: (m[5] || "ASC").trim().toUpperCase(),
        limit: m[6] ? parseInt(m[6], 10) : null,
      };
    }
    if (verb === "INSERT") {
      const m = trimmed.match(/^INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]+)\)\s*VALUES\s+(.+)$/is);
      if (!m) return { error: "Unsupported INSERT syntax" };
      const cols = m[2].split(",").map((c) => c.trim());
      // One or more parenthesised value groups: (…), (…), … (S7/F9).
      const groups = splitValueGroups(m[3].trim());
      if (!groups) return { error: "Unsupported INSERT syntax" };
      const rowVals = [];
      for (const g of groups) {
        const vals = splitCsvValues(g);
        if (cols.length !== vals.length) return { error: "column/value count mismatch" };
        rowVals.push(vals);
      }
      return { verb, table: m[1], cols, rowVals, vals: rowVals[0] };
    }
    if (verb === "UPDATE") {
      const m = trimmed.match(/^UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?\s*$/i);
      if (!m) return { error: "Unsupported UPDATE syntax" };
      const sets = m[2].split(",").map((p) => {
        const sm = p.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
        return sm ? { col: sm[1], val: parseLiteral(sm[2]) } : null;
      });
      if (sets.some((x) => !x)) return { error: "Unsupported SET clause" };
      return { verb, table: m[1], sets, ...(m[3] ? tokenizeWhereChecked(m[3]) : { where: null }) };
    }
    if (verb === "DELETE") {
      const m = trimmed.match(/^DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+WHERE\s+(.+?))?\s*$/i);
      if (!m) return { error: "Unsupported DELETE syntax" };
      return { verb, table: m[1], ...(m[2] ? tokenizeWhereChecked(m[2]) : { where: null }) };
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
  // Split a VALUES payload into its parenthesised groups, honouring
  // quoted strings (which may contain commas and parentheses).
  function splitValueGroups(str) {
    const groups = [];
    let depth = 0, inq = null, cur = "";
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inq) { cur += ch; if (ch === inq) inq = null; continue; }
      if (ch === "'" || ch === '"') { inq = ch; cur += ch; continue; }
      if (depth === 0 && ch !== "(") continue; // separators between groups
      if (ch === "(") { depth++; if (depth > 1) return null; cur += ch; continue; }
      if (ch === ")") {
        depth--;
        if (depth < 0) return null;
        cur += ch;
        if (depth === 0) { groups.push(cur); cur = ""; }
        continue;
      }
      cur += ch;
    }
    if (inq || depth !== 0) return null;
    const inner = groups.map((g) => g.trim().replace(/^\(/, "").replace(/\)$/, ""));
    return inner.length ? inner : null;
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

  // Shared plan builder for the query-explain macro and for typed
  // EXPLAIN statements routed through query-run.
  function buildExplainResult(c, plan) {
    const ds = resolveDataset(c, plan.table);
    if (!ds) return { error: `dataset "${plan.table}" not found` };
    const totalRows = ds.rows.length;
    const nodes = [];
    const hasWhere = plan.where && plan.where.length > 0;
    nodes.push({
      id: "scan", label: `Seq Scan on ${ds.name}`, type: "scan",
      rows: totalRows, cost: totalRows,
      detail: `${totalRows} row${totalRows !== 1 ? "s" : ""} read`,
    });
    let estRows = totalRows;
    let lastId = "scan";
    if (plan.join) {
      const rightDs = resolveDataset(c, plan.join.table);
      if (!rightDs) return { error: `dataset "${plan.join.table}" not found` };
      nodes.push({
        id: "scan-right", label: `Seq Scan on ${rightDs.name}`, type: "scan",
        rows: rightDs.rows.length, cost: rightDs.rows.length,
        detail: `${rightDs.rows.length} row${rightDs.rows.length !== 1 ? "s" : ""} read`,
      });
      estRows = Math.max(1, Math.round(totalRows * Math.max(1, rightDs.rows.length) * 0.3));
      nodes.push({
        id: "join", label: `${plan.join.kind === "LEFT" ? "Left" : "Inner"} Join`, type: "join",
        rows: estRows, cost: totalRows + rightDs.rows.length,
        detail: `ON ${plan.join.onLeft} = ${plan.join.onRight}`,
        children: ["scan", "scan-right"],
      });
      lastId = "join";
    }
    if (hasWhere) {
      estRows = Math.max(1, Math.round(estRows * 0.4));
      nodes.push({
        id: "filter", label: "Filter", type: "filter",
        rows: estRows, cost: totalRows,
        detail: plan.where.map((w) => `${w.col} ${w.op} ${w.val}`).join(` ${plan.where[1]?.join || "AND"} `),
        children: [lastId],
      });
      lastId = "filter";
    }
    if (plan.verb === "SELECT" && plan.orderBy) {
      nodes.push({
        id: "sort", label: `Sort by ${plan.orderBy} ${plan.orderDir}`, type: "sort",
        rows: estRows, cost: Math.round(estRows * Math.log2(Math.max(2, estRows))),
        detail: "in-memory sort", children: [lastId],
      });
      lastId = "sort";
    }
    if (plan.verb === "SELECT" && plan.limit != null) {
      nodes.push({
        id: "limit", label: `Limit ${plan.limit}`, type: "limit",
        rows: Math.min(plan.limit, estRows), cost: 0, detail: "first N rows",
        children: [lastId],
      });
      lastId = "limit";
    }
    const totalCost = nodes.reduce((n, x) => n + x.cost, 0);
    const warnings = [];
    if (totalRows > 1000 && !hasWhere && plan.verb === "SELECT") warnings.push("Full table scan with no filter — consider a WHERE clause.");
    if (plan.verb === "SELECT" && plan.orderBy && !hasWhere) warnings.push("Sorting an unfiltered table is expensive at scale.");
    return {
      verb: plan.verb, table: ds.name, nodes,
      totalCost, estimatedRows: nodes[nodes.length - 1].rows,
      warnings,
    };
  }

  const RESULT_CAP = 1000;
  const SCAN_BUDGET = 2000000;
  function runSqlOnConnection(c, sql, opts = {}) {
    const plan = parseSql(sql);
    if (plan.error) return { error: plan.error, position: plan.position ?? 0 };
    if (plan.explain) {
      const ex = buildExplainResult(c, plan);
      if (ex.error) return { error: ex.error };
      return { columns: [], rows: [], rowCount: 0, op: "EXPLAIN", explain: ex };
    }
    const ds = resolveDataset(c, plan.table);
    if (!ds) return { error: `dataset "${plan.table}" not found in connection` };
    if (ds.virtual && plan.verb !== "SELECT") {
      return { error: `dataset "dtus" is read-only in the Database lens` };
    }
    // ── S3 validation: a referenced column that does not exist is an
    // error naming it — never a NULL column under a success banner (F4),
    // and an unparseable WHERE fails instead of matching everything.
    if (plan.whereInvalid) {
      return {
        error: `Unsupported WHERE clause near "${plan.whereBadSegment || ""}"`,
        position: plan.whereBadSegment ? sql.indexOf(plan.whereBadSegment) : sql.toUpperCase().indexOf("WHERE"),
      };
    }
    {
      const bare = new Set();
      const qualified = new Map();
      const addSchema = (d) => {
        qualified.set(d.name.toLowerCase(), new Set(d.columns.map((cl) => cl.name)));
        for (const cl of d.columns) bare.add(cl.name);
      };
      addSchema(ds);
      let joinDs = null;
      if (plan.join) { joinDs = resolveDataset(c, plan.join.table); if (joinDs) addSchema(joinDs); }
      const colError = (ref) => {
        const dot = ref.indexOf(".");
        if (dot > 0) {
          const t = ref.slice(0, dot).toLowerCase();
          return qualified.has(t) && qualified.get(t).has(ref.slice(dot + 1)) ? null : `column "${ref}" does not exist`;
        }
        return bare.has(ref) ? null : `column "${ref}" does not exist on dataset "${ds.name}"${joinDs ? ` or "${joinDs.name}"` : ""}`;
      };
      const posOf = (needle) => Math.max(0, sql.toLowerCase().indexOf(String(needle).toLowerCase()));
      if (plan.verb === "SELECT" && !/^count\s*\(\s*\*\s*\)$/i.test(plan.cols.trim())) {
        for (const spec of plan.cols.split(",").map((x) => x.trim()).filter(Boolean)) {
          if (spec === "*" || spec.endsWith(".*")) continue;
          const e = colError(spec);
          if (e) return { error: e, position: posOf(spec) };
        }
      }
      if (plan.where) {
        for (const cl of plan.where) {
          const e = colError(cl.col);
          if (e) return { error: e, position: posOf(cl.col) };
        }
      }
      if (plan.orderBy) {
        const e = colError(plan.orderBy);
        if (e) return { error: e, position: posOf(plan.orderBy) };
      }
      if (plan.verb === "INSERT") {
        for (const col of plan.cols) {
          if (!ds.columns.some((cl) => cl.name === col)) {
            return { error: `column "${col}" does not exist on dataset "${ds.name}"`, position: posOf(col) };
          }
        }
      }
    }
    // ── S5 destructive-SQL guard: an unscoped DELETE/UPDATE never runs
    // on first ask. The caller must re-send with confirmDestructive —
    // Safe-Mode style, with the connection read-only toggle as rung one.
    if ((plan.verb === "DELETE" || plan.verb === "UPDATE") && !plan.where && !opts.allowDestructive) {
      return {
        error: `${plan.verb} without a WHERE clause affects every row in "${ds.name}" (${ds.rows.length} row${ds.rows.length === 1 ? "" : "s"}). Confirm to run it.`,
        needsConfirm: true, destructive: plan.verb,
      };
    }
    if (plan.verb === "SELECT") {
      const isCount = /^count\s*\(\s*\*\s*\)$/i.test(plan.cols);
      // Candidate row views: the flat (merged) row plus a __tables map so
      // qualified references (t.col) read their own table's row.
      let views;
      let rightDs = null;
      if (plan.join) {
        rightDs = resolveDataset(c, plan.join.table);
        if (!rightDs) return { error: `dataset "${plan.join.table}" not found in connection` };
        views = [];
        const nullRight = {};
        for (const cl of rightDs.columns) nullRight[cl.name] = null;
        // Hash path when each ON ref resolves to one side's plain
        // column: index the right side once (keys stringified, which
        // matches the engine's loose numeric/text equality for cell
        // values). Ambiguous refs (a bare column present in both
        // tables) fall back to the nested loop below.
        const parseRef = (ref) => {
          const s = String(ref);
          const dot = s.indexOf(".");
          return dot > 0
            ? { table: s.slice(0, dot).toLowerCase(), col: s.slice(dot + 1) }
            : { table: null, col: s };
        };
        const sideOf = (ref) => {
          const { table, col } = parseRef(ref);
          if (table) {
            if (table === ds.name.toLowerCase()) return "L";
            if (table === rightDs.name.toLowerCase()) return "R";
            return null;
          }
          const inL = ds.columns.some((cl) => cl.name === col);
          const inR = rightDs.columns.some((cl) => cl.name === col);
          if (inL && !inR) return "L";
          if (inR && !inL) return "R";
          return null;
        };
        const sL = sideOf(plan.join.onLeft);
        const sR = sideOf(plan.join.onRight);
        const hashable = sL && sR && sL !== sR;
        if (hashable) {
          const leftCol = parseRef(sL === "L" ? plan.join.onLeft : plan.join.onRight).col;
          const rightCol = parseRef(sL === "L" ? plan.join.onRight : plan.join.onLeft).col;
          const index = new Map();
          for (const r of rightDs.rows) {
            const k = r[rightCol];
            if (k == null) continue;
            const key = String(k);
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(r);
          }
          for (const l of ds.rows) {
            const k = l[leftCol];
            const hits = k == null ? [] : index.get(String(k)) || [];
            for (const r of hits) {
              views.push({ ...l, ...r, _rid: l._rid, __tables: { [ds.name]: l, [rightDs.name]: r } });
            }
            if (hits.length === 0 && plan.join.kind === "LEFT") {
              views.push({ ...l, ...nullRight, _rid: l._rid, __tables: { [ds.name]: l, [rightDs.name]: nullRight } });
            }
          }
        } else {
          // Execution bound (F13 evidence): the nested loop may visit
          // at most SCAN_BUDGET row pairs before the statement aborts —
          // the in-memory engine's stand-in for a statement timeout.
          let visits = 0;
          for (const l of ds.rows) {
            let matched = false;
            for (const r of rightDs.rows) {
              if (++visits > SCAN_BUDGET) {
                return { error: `query aborted: join scan exceeded the ${SCAN_BUDGET}-row visit budget — narrow the join or add a filter` };
              }
              const lv = joinRefValue(plan.join.onLeft, ds, l, rightDs, r);
              const rv = joinRefValue(plan.join.onRight, ds, l, rightDs, r);
              // eslint-disable-next-line eqeqeq
              if (lv != null && rv != null && lv == rv) {
                matched = true;
                views.push({ ...l, ...r, _rid: l._rid, __tables: { [ds.name]: l, [rightDs.name]: r } });
              }
            }
            if (!matched && plan.join.kind === "LEFT") {
              views.push({ ...l, ...nullRight, _rid: l._rid, __tables: { [ds.name]: l, [rightDs.name]: nullRight } });
            }
          }
        }
      } else {
        views = ds.rows.map((r) => ({ ...r, __tables: { [ds.name]: r } }));
      }
      let rows = views.filter((v) => rowMatches(v, plan.where));
      const scannedRows = ds.rows.length + (rightDs ? rightDs.rows.length : 0);
      if (isCount) {
        return { columns: ["count"], rows: [{ count: rows.length }], rowCount: 1, scannedRows };
      }
      if (plan.orderBy) {
        const dir = plan.orderDir === "DESC" ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const av = resolveCol(a, plan.orderBy), bv = resolveCol(b, plan.orderBy);
          if (av == null) return 1; if (bv == null) return -1;
          return av < bv ? -dir : av > bv ? dir : 0;
        });
      }
      if (typeof plan.limit === "number") rows = rows.slice(0, plan.limit);
      // Projection. `*` = left table's columns then the joined table's;
      // `t.*` = that table's; `t.col` projects under its bare name. On a
      // bare-name collision the first spec wins (the merged view already
      // carries the right table's value for unqualified reads).
      const specs = plan.cols.trim() === "*"
        ? ["*"]
        : plan.cols.split(",").map((x) => x.trim()).filter(Boolean);
      const columns = [];
      const getters = [];
      const addCol = (name, get) => { if (!columns.includes(name)) { columns.push(name); getters.push(get); } };
      for (const spec of specs) {
        if (spec === "*") {
          for (const cl of [...ds.columns, ...(rightDs ? rightDs.columns : [])]) {
            addCol(cl.name, ((n) => (v) => v[n] ?? null)(cl.name));
          }
        } else if (spec.endsWith(".*")) {
          const tname = spec.slice(0, -2);
          const tds = rightDs && tname.toLowerCase() === rightDs.name.toLowerCase() ? rightDs : ds;
          for (const cl of tds.columns) {
            addCol(cl.name, ((tn, n) => (v) => v.__tables[tn]?.[n] ?? null)(tds.name, cl.name));
          }
        } else {
          const bare = spec.includes(".") ? spec.slice(spec.indexOf(".") + 1) : spec;
          addCol(bare, ((sp) => (v) => resolveCol(v, sp) ?? null)(spec));
        }
      }
      const projected = rows.map((v) => {
        const o = { _rid: v._rid };
        columns.forEach((col, i) => { o[col] = getters[i](v); });
        return o;
      });
      // Result cap (F13): rows past RESULT_CAP are counted, not shipped.
      const truncated = projected.length > RESULT_CAP;
      return {
        columns,
        rows: truncated ? projected.slice(0, RESULT_CAP) : projected,
        rowCount: projected.length,
        scannedRows,
        ...(truncated ? { truncated: true, cap: RESULT_CAP } : {}),
      };
    }
    if (plan.verb === "INSERT") {
      if (c.readOnly) return { error: "connection is read-only" };
      // Multi-row INSERT is all-or-nothing: every row is type-checked
      // before any row lands (statement semantics, S3's rule at scale).
      const built = [];
      for (let gi = 0; gi < plan.rowVals.length; gi++) {
        const vals = {};
        plan.cols.forEach((col, i) => { vals[col] = plan.rowVals[gi][i]; });
        const checked = buildRowChecked(ds, vals);
        if (checked.error) {
          return {
            error: plan.rowVals.length > 1 ? `row ${gi + 1}: ${checked.error}` : checked.error,
            position: sql.toLowerCase().indexOf(checked.error.match(/column "([^"]+)"/)?.[1]?.toLowerCase() || ""),
          };
        }
        built.push(checked.row);
      }
      for (const row of built) { row._rid = ++ds.rowSeq; ds.rows.push(row); }
      return { columns: [], rows: [], rowCount: built.length, affected: built.length, op: "INSERT" };
    }
    if (plan.verb === "UPDATE") {
      if (c.readOnly) return { error: "connection is read-only" };
      // Validate + coerce every SET before touching a row: an unknown
      // column or a wrong-typed value fails the whole statement (S3).
      const coerced = [];
      for (const set of plan.sets) {
        const col = ds.columns.find((cl) => cl.name === set.col);
        if (!col) return { error: `column "${set.col}" does not exist on dataset "${ds.name}"`, position: sql.toLowerCase().indexOf(set.col.toLowerCase()) };
        const chk = coerceCellStrict(col.type, set.val);
        if (chk.error) return { error: `column "${col.name}" expects ${col.type}, got ${JSON.stringify(set.val)}`, position: sql.toLowerCase().indexOf(col.name.toLowerCase()) };
        coerced.push({ name: col.name, value: chk.value });
      }
      let affected = 0;
      for (const r of ds.rows) {
        if (rowMatches(r, plan.where)) {
          for (const set of coerced) r[set.name] = set.value;
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
    const c = resolveConnection(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const sql = String(params.sql || "").trim();
    if (!sql) return { ok: false, error: "sql required" };
    const t0 = Date.now();
    let res;
    try { res = runSqlOnConnection(c, sql, { allowDestructive: params.confirmDestructive === true }); }
    catch (e) { res = { error: e instanceof Error ? e.message : "query failed" }; }
    const durationMs = Date.now() - t0;
    c.lastUsedAt = new Date().toISOString();
    if (res.needsConfirm) {
      // Not an execution: nothing ran, so nothing is written to history.
      return { ok: true, result: { success: false, needsConfirm: true, destructive: res.destructive, error: res.error, durationMs } };
    }
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
    if (res.error) return { ok: true, result: { error: res.position != null ? `${res.error} (at character ${res.position})` : res.error, position: res.position ?? null, durationMs, success: false } };
    return {
      ok: true,
      result: {
        columns: res.columns || [], rows: res.rows || [],
        rowCount: res.rowCount || 0, affected: res.affected ?? null,
        op: res.op || "SELECT", durationMs, success: true,
        ...(res.explain ? { explain: res.explain } : {}),
        ...(res.truncated ? { truncated: true, cap: res.cap } : {}),
      },
    };
  });

  // ── query-explain: EXPLAIN / query-plan visualization ─────────────────

  registerLensAction("database", "query-explain", (ctx, _a, params = {}) => {
  try {
    const s = getDbStore(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = resolveConnection(s, ctx, params.connectionId);
    if (!c) return { ok: false, error: "connection not found" };
    const sql = String(params.sql || "").trim();
    if (!sql) return { ok: false, error: "sql required" };
    const plan = parseSql(sql);
    if (plan.error) return { ok: true, result: { error: plan.error } };
    const ex = buildExplainResult(c, plan);
    if (ex.error) return { ok: true, result: { error: ex.error } };
    return { ok: true, result: ex };
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
