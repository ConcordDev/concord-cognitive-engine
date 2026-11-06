// server/lib/db-dial.js
//
// DBX-3 — the guarded dial-out for Database external connections
// (§8, allowed-with-safeguards). Two layers:
//
//   testRemotePostgres(target, opts) — the composed path the lens
//     uses: validate the target through the SSRF guard
//     (validateDbTarget: port allowlist, private/reserved refusal,
//     pinned IP), then dial the PINNED address. Credentials arrive
//     already decrypted by the caller (the vault lives in the domain);
//     this module never sees stored ciphertext and never logs secrets.
//
//   dialPostgres(target, opts) — the dial itself, against a host taken
//     as given (the composed path passes the guard's pinned IP, with
//     the original hostname as TLS servername). Split out so the wire
//     behaviour is testable against a local stub with the real `pg`
//     driver — the guard (correctly) refuses loopback, so no test may
//     route a stub through it.
//
// Every outcome is a plain result object with an honest stage:
//   guard       — the SSRF guard refused; nothing was contacted.
//   connect     — TCP/transport failed or timed out.
//   auth        — the server answered but refused the credentials
//                 (SQLSTATE 28xxx) or the database (3D000).
//   protocol    — connected, but the session could not be proven
//                 (the SELECT 1 probe failed for a non-auth reason).
//   ok          — handshake + auth + SELECT 1 all succeeded.
// `remoteContacted` is true only once a dial was actually attempted.

import { validateDbTarget } from "./ssrf-guard.js";

export const DB_DIAL_DEFAULT_TIMEOUT_MS = 5000;

async function defaultClientFactory(config) {
  const { default: pg } = await import("pg");
  return new pg.Client(config);
}

function classifyPgError(err) {
  const code = typeof err?.code === "string" ? err.code : "";
  if (code.startsWith("28") || code === "3D000") return "auth";
  return null;
}

/**
 * Dial a Postgres server and prove the session with SELECT 1.
 * @param {{host: string, port: number, user?: string, password?: string,
 *          database?: string, servername?: string, ssl?: boolean,
 *          timeoutMs?: number}} target — host is dialed as given.
 * @param {{clientFactory?: Function}} [opts] — injectable for tests.
 */
export async function dialPostgres(target, opts = {}) {
  const timeoutMs = target.timeoutMs ?? DB_DIAL_DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const config = {
    host: target.host,
    port: target.port,
    user: target.user || undefined,
    password: target.password || undefined,
    database: target.database || undefined,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  };
  if (target.ssl) {
    // TLS with SNI on the original hostname while dialing the pinned IP.
    config.ssl = { rejectUnauthorized: true, servername: target.servername || target.host };
  }
  let client;
  try {
    client = await (opts.clientFactory || defaultClientFactory)(config);
  } catch (err) {
    return { connected: false, stage: "connect", remoteContacted: false, error: `client setup failed: ${err?.message || err}` };
  }
  try {
    await client.connect();
  } catch (err) {
    try { await client.end(); } catch { /* already dead */ }
    const stage = classifyPgError(err) || "connect";
    return { connected: false, stage, remoteContacted: true, code: err?.code || undefined, error: err?.message || String(err), latencyMs: Date.now() - started };
  }
  try {
    const probe = await client.query("SELECT 1 AS ok");
    const version = await client.query("SHOW server_version");
    return {
      connected: true,
      stage: "ok",
      remoteContacted: true,
      latencyMs: Date.now() - started,
      probeRows: probe?.rowCount ?? null,
      serverVersion: version?.rows?.[0]?.server_version || null,
    };
  } catch (err) {
    const stage = classifyPgError(err) || "protocol";
    return { connected: false, stage, remoteContacted: true, code: err?.code || undefined, error: err?.message || String(err), latencyMs: Date.now() - started };
  } finally {
    try { await client.end(); } catch { /* closing is best-effort */ }
  }
}

// ── Read-only query path (DBX-4) ───────────────────────────────────────────
//
// Defence in depth, two independent layers:
//   1. classifyReadOnlyStatement — a client-side gate: one statement,
//      and only a statement that cannot write (SELECT, a WITH whose
//      body carries no write verb, EXPLAIN of a gated inner statement,
//      SHOW). String literals and comments are scanned through, so a
//      ';' or the word DELETE inside a quoted value is data, not code.
//   2. The server enforces it anyway: every remote query runs inside
//      BEGIN TRANSACTION READ ONLY … ROLLBACK, so a gate miss still
//      cannot write — Postgres itself refuses.
// The gate exists for honest, immediate errors (and to keep obvious
// writes from ever reaching the wire); the transaction is the proof.

const WRITE_VERBS = ["INSERT", "UPDATE", "DELETE", "MERGE", "CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE", "COPY", "CALL", "DO", "VACUUM", "REINDEX", "CLUSTER", "REFRESH", "LOCK", "SET", "RESET"];

function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") { out += "'"; i += 2; continue; }
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === "'") { inString = true; out += ch; i += 1; continue; }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function hasSemicolonOutsideStrings(sql) {
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'") {
        if (sql[i + 1] === "'") { i += 1; continue; }
        inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === ";") return true;
  }
  return false;
}

/**
 * Classify a statement for the remote read-only path.
 * @returns {{ ok: true, kind: "SELECT"|"EXPLAIN"|"SHOW" } |
 *           { ok: false, code: string, error: string }}
 */
export function classifyReadOnlyStatement(sql) {
  if (typeof sql !== "string") return { ok: false, code: "empty_statement", error: "sql required" };
  const stripped = stripSqlComments(sql).trim().replace(/;+\s*$/, "").trim();
  if (!stripped) return { ok: false, code: "empty_statement", error: "sql required" };
  if (hasSemicolonOutsideStrings(stripped)) {
    return { ok: false, code: "multiple_statements", error: "Remote queries run one statement at a time — remove the extra statement after the semicolon." };
  }
  const firstWord = (stripped.match(/^[A-Za-z]+/) || [""])[0].toUpperCase();
  const refuse = (verb) => ({ ok: false, code: "statement_not_read_only", error: `Remote queries are read-only in this slice: ${verb} is a write. Run SELECT, EXPLAIN, or SHOW statements against a remote connection.` });
  if (firstWord === "SELECT") return { ok: true, kind: "SELECT" };
  if (firstWord === "SHOW") return { ok: true, kind: "SHOW" };
  if (firstWord === "WITH") {
    // A data-modifying CTE hides its verb in the body — scan whole words.
    const words = new Set((stripped.toUpperCase().match(/[A-Z]+/g) || []));
    for (const verb of WRITE_VERBS) if (words.has(verb)) return refuse(verb);
    return { ok: true, kind: "SELECT" };
  }
  if (firstWord === "EXPLAIN") {
    // EXPLAIN (options) VERB inner / EXPLAIN ANALYZE inner — gate the
    // inner statement with the same rules (one level is enough: an
    // inner EXPLAIN is itself read-only against a gated SELECT).
    let rest = stripped.slice("EXPLAIN".length).trim();
    if (rest.startsWith("(")) {
      const close = rest.indexOf(")");
      if (close < 0) return { ok: false, code: "statement_not_read_only", error: "Remote queries are read-only in this slice: that EXPLAIN form is not supported." };
      rest = rest.slice(close + 1).trim();
    }
    rest = rest.replace(/^(ANALYZE|VERBOSE|COSTS|BUFFERS|SETTINGS|SUMMARY|FORMAT\s+\w+)\s+/i, "").trim();
    const inner = classifyReadOnlyStatement(rest);
    if (!inner.ok) return inner;
    return { ok: true, kind: "EXPLAIN" };
  }
  if (WRITE_VERBS.includes(firstWord) || firstWord) return refuse(firstWord || "That statement");
  return { ok: false, code: "empty_statement", error: "sql required" };
}

export const REMOTE_RESULT_CAP = 1000;

/**
 * Execute one gated statement against a host taken as given (the
 * composed path below passes the guard's pinned IP). Always runs
 * inside a READ ONLY transaction that is rolled back.
 */
export async function executeRemoteQuery(target, sql, opts = {}) {
  const timeoutMs = target.timeoutMs ?? DB_DIAL_DEFAULT_TIMEOUT_MS;
  const cap = opts.cap ?? REMOTE_RESULT_CAP;
  const started = Date.now();
  const config = {
    host: target.host,
    port: target.port,
    user: target.user || undefined,
    password: target.password || undefined,
    database: target.database || undefined,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  };
  if (target.ssl) config.ssl = { rejectUnauthorized: true, servername: target.servername || target.host };
  let client;
  try {
    client = await (opts.clientFactory || defaultClientFactory)(config);
  } catch (err) {
    return { ok: false, stage: "connect", remoteContacted: false, error: `client setup failed: ${err?.message || err}` };
  }
  try {
    await client.connect();
  } catch (err) {
    try { await client.end(); } catch { /* already dead */ }
    return { ok: false, stage: classifyPgError(err) || "connect", remoteContacted: true, code: err?.code || undefined, error: err?.message || String(err) };
  }
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    let res;
    try {
      res = await client.query(sql);
    } finally {
      try { await client.query("ROLLBACK"); } catch { /* session is closing anyway */ }
    }
    const rows = Array.isArray(res?.rows) ? res.rows : [];
    const truncated = rows.length > cap;
    return {
      ok: true,
      remoteContacted: true,
      columns: (res?.fields || []).map((f) => f.name),
      rows: truncated ? rows.slice(0, cap) : rows,
      rowCount: typeof res?.rowCount === "number" ? res.rowCount : rows.length,
      command: res?.command || null,
      durationMs: Date.now() - started,
      ...(truncated ? { truncated: true, cap } : {}),
    };
  } catch (err) {
    return { ok: false, stage: classifyPgError(err) || "protocol", remoteContacted: true, code: err?.code || undefined, error: err?.message || String(err), durationMs: Date.now() - started };
  } finally {
    try { await client.end(); } catch { /* closing is best-effort */ }
  }
}

/**
 * The composed remote query: statement gate, SSRF guard, pinned dial.
 * @param {{host: string, port?: number, user?: string, password?: string,
 *          database?: string, ssl?: boolean, timeoutMs?: number}} target
 */
export async function runRemoteQuery(target, sql, opts = {}) {
  const gate = classifyReadOnlyStatement(sql);
  if (!gate.ok) return { ok: false, stage: "statement", remoteContacted: false, code: gate.code, error: gate.error };
  const port = target.port ?? 5432;
  const guard = await validateDbTarget(target.host, port, { lookup: opts.lookup });
  if (!guard.ok) return { ok: false, stage: "guard", remoteContacted: false, code: guard.code, error: guard.error };
  const executed = await executeRemoteQuery({
    host: guard.resolvedIp,
    port: guard.port,
    user: target.user,
    password: target.password,
    database: target.database,
    servername: guard.hostname,
    ssl: target.ssl,
    timeoutMs: target.timeoutMs,
  }, sql, { clientFactory: opts.clientFactory, cap: opts.cap });
  return { ...executed, kind: gate.kind, hostname: guard.hostname, resolvedIp: guard.resolvedIp, port: guard.port };
}

/**
 * The composed connection test: SSRF guard first, pinned dial second.
 * @param {{host: string, port?: number, user?: string, password?: string,
 *          database?: string, ssl?: boolean, timeoutMs?: number}} target
 * @param {{lookup?: Function, clientFactory?: Function}} [opts]
 */
export async function testRemotePostgres(target, opts = {}) {
  const port = target.port ?? 5432;
  const guard = await validateDbTarget(target.host, port, { lookup: opts.lookup });
  if (!guard.ok) {
    return { connected: false, stage: "guard", remoteContacted: false, code: guard.code, error: guard.error };
  }
  const dialed = await dialPostgres({
    host: guard.resolvedIp,
    port: guard.port,
    user: target.user,
    password: target.password,
    database: target.database,
    servername: guard.hostname,
    ssl: target.ssl,
    timeoutMs: target.timeoutMs,
  }, { clientFactory: opts.clientFactory });
  return { ...dialed, hostname: guard.hostname, resolvedIp: guard.resolvedIp, port: guard.port };
}
