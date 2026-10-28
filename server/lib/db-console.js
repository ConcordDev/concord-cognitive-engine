// Database lens console (/api/db/*) — admin-only, read-only.
//
// SECURITY: /api/db/query used to db.prepare() arbitrary SQL from any
// signed-in user and .run() anything that did not start with SELECT/PRAGMA/
// EXPLAIN, i.e. any account could write to the primary SQLite DB. These
// routes are now gated to admin/owner/founder/sovereign (requireRole in
// server.js) and the query console only executes a single statement that
// SQLite itself reports as read-only and data-returning (stmt.readonly &&
// stmt.reader). Prefix matching is not used: "SELECT 1; DELETE ..." and
// "WITH x AS (...) DELETE ..." both defeat it.

export const DB_ADMIN_ROLES = Object.freeze(["owner", "admin", "founder", "sovereign"]);
export const DB_QUERY_MAX_ROWS = 1000;

// Macro-level guard for db.* macros (the HTTP routes are role-gated too;
// this is defence in depth for the generic macro dispatcher).
export function dbMacroDenied(ctx) {
  if (ctx?.internal === true || ctx?.actor?.internal === true) return null;
  const role = ctx?.actor?.role || "guest";
  if (DB_ADMIN_ROLES.includes(role)) return null;
  return { ok: false, error: "forbidden: admin role required" };
}

export function runReadOnlyQuery(db, rawQuery) {
  const q = String(rawQuery ?? "").trim();
  if (!q) return { status: 400, body: { ok: false, error: "query required" } };
  if (!db) return { status: 200, body: { ok: true, rows: [], columns: [], message: "No database connected. Set DATABASE_URL to enable." } };
  let stmt;
  try {
    // better-sqlite3 throws RangeError if the string holds >1 statement.
    stmt = db.prepare(q);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/more than one statement/i.test(msg)) {
      return { status: 400, body: { ok: false, error: "multiple_statements_not_allowed" } };
    }
    return { status: 400, body: { ok: false, error: msg } };
  }
  // ATTACH/DETACH/BEGIN/SAVEPOINT etc. can report readonly but never return
  // rows, so require both.
  if (stmt.readonly !== true || stmt.reader !== true) {
    return { status: 403, body: { ok: false, error: "read_only: only single read-only queries are allowed" } };
  }
  try {
    const rows = [];
    let truncated = false;
    for (const row of stmt.iterate()) {
      if (rows.length >= DB_QUERY_MAX_ROWS) { truncated = true; break; }
      rows.push(row);
    }
    const columns = stmt.columns().map((c) => c.name);
    return { status: 200, body: { ok: true, rows, columns, rowCount: rows.length, truncated } };
  } catch (e) {
    return { status: 400, body: { ok: false, error: String(e?.message || e) } };
  }
}

export function registerDbConsoleRoutes(app, { requireRole, getDb, runMacro, makeCtx }) {
  const gate = requireRole(...DB_ADMIN_ROLES);
  const viaMacro = (name, inputOf) => async (req, res) => {
    try { res.json(await runMacro("db", name, inputOf(req), makeCtx(req))); }
    catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  };
  app.get("/api/db/status", gate, viaMacro("status", () => ({})));
  app.post("/api/db/migrate", gate, viaMacro("migrate", () => ({})));
  app.post("/api/db/sync", gate, viaMacro("syncToPostgres", (req) => req.body || {}));
  app.post("/api/db/query", gate, (req, res) => {
    const out = runReadOnlyQuery(getDb(), req.body?.query);
    res.status(out.status).json(out.body);
  });
  app.get("/api/db/tables", gate, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ ok: true, tables: [] });
    try {
      const tables = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all();
      res.json({ ok: true, tables });
    } catch (e) { res.status(500).json({ ok: false, tables: [], error: String(e?.message || e) }); }
  });
  app.get("/api/db/indexes", gate, (req, res) => {
    const db = getDb();
    if (!db) return res.json({ ok: true, indexes: [] });
    try {
      const indexes = db.prepare("SELECT name, tbl_name as tableName, sql FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name").all();
      res.json({ ok: true, indexes });
    } catch (e) { res.status(500).json({ ok: false, indexes: [], error: String(e?.message || e) }); }
  });
}
