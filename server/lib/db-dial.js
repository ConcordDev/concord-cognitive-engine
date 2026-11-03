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
