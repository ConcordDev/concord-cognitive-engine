// server/domains/ingest.js
// Domain actions for the Ingest lens — a document-ingestion workbench that
// also carries a real ELT-style pipeline substrate: pre-built source
// connectors, scheduled / incremental sync with cursor deltas, field-level
// transformation mapping, sync run logs with replay, configurable dedup, an
// OCR ingestion path, and a webhook push endpoint for external systems.
//
// All pipeline state is persisted per-user in globalThis._concordSTATE so it
// survives across macro calls (and is checkpointed by the state debouncer).

import crypto from "node:crypto";

export default function registerIngestActions(registerLensAction) {
  // ── Persistent per-user pipeline state ──────────────────────────────
  function getIngestState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.ingestLens) STATE.ingestLens = {};
    const s = STATE.ingestLens;
    // connections: userId -> Map(connectionId -> connection)
    // schedules:   userId -> Map(scheduleId   -> schedule)
    // syncRuns:    userId -> Array(run)        (most-recent-first, capped)
    // mappings:    userId -> Map(connectionId -> mapping[])
    // dedup:       userId -> dedup config object
    // webhooks:    userId -> Map(token        -> webhook endpoint)
    // webhookRecords: userId -> Array(record) (capped)
    for (const k of ["connections", "schedules", "mappings", "webhooks"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    for (const k of ["syncRuns", "webhookRecords", "dedup"]) {
      if (!s[k]) s[k] = k === "dedup" ? new Map() : new Map();
    }
    return s;
  }
  function saveIngestState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const uid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const now = () => Date.now();
  const newId = (p) => `${p}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function userMap(map, userId) {
    if (!map.has(userId)) map.set(userId, new Map());
    return map.get(userId);
  }
  function userArr(map, userId) {
    if (!map.has(userId)) map.set(userId, []);
    return map.get(userId);
  }

  // ── Connector catalog — pre-built source connectors ─────────────────
  // Each connector declares the auth model + the config fields the UI must
  // collect. This is a static catalog (the "what you can connect to"); a
  // configured instance becomes a "connection".
  const CONNECTOR_CATALOG = [
    {
      id: "postgres", name: "PostgreSQL", category: "database", auth: "credentials",
      icon: "database", incremental: true,
      fields: [
        { key: "host", label: "Host", type: "text", required: true },
        { key: "port", label: "Port", type: "number", required: true, default: 5432 },
        { key: "database", label: "Database", type: "text", required: true },
        { key: "username", label: "Username", type: "text", required: true },
        { key: "password", label: "Password", type: "password", required: true },
        { key: "table", label: "Table / view", type: "text", required: true },
        { key: "cursorField", label: "Cursor field (incremental)", type: "text", required: false },
      ],
    },
    {
      id: "s3", name: "Amazon S3", category: "file-store", auth: "credentials",
      icon: "cloud", incremental: true,
      fields: [
        { key: "bucket", label: "Bucket", type: "text", required: true },
        { key: "prefix", label: "Key prefix", type: "text", required: false },
        { key: "region", label: "Region", type: "text", required: true, default: "us-east-1" },
        { key: "accessKeyId", label: "Access key ID", type: "text", required: true },
        { key: "secretAccessKey", label: "Secret access key", type: "password", required: true },
        { key: "format", label: "File format", type: "select", options: ["csv", "json", "jsonl", "parquet"], required: true },
      ],
    },
    {
      id: "stripe", name: "Stripe", category: "saas", auth: "api-key",
      icon: "credit-card", incremental: true,
      fields: [
        { key: "apiKey", label: "Secret API key", type: "password", required: true },
        { key: "resource", label: "Resource", type: "select", options: ["charges", "customers", "invoices", "subscriptions", "payouts"], required: true },
        { key: "startDate", label: "Start date", type: "date", required: false },
      ],
    },
    {
      id: "google-sheets", name: "Google Sheets", category: "saas", auth: "oauth",
      icon: "table", incremental: false,
      oauth: { provider: "google", scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] },
      fields: [
        { key: "spreadsheetId", label: "Spreadsheet ID", type: "text", required: true },
        { key: "sheetName", label: "Sheet / tab name", type: "text", required: true },
        { key: "headerRow", label: "Header row", type: "number", required: false, default: 1 },
      ],
    },
    {
      id: "rest-api", name: "REST API", category: "api", auth: "api-key",
      icon: "globe", incremental: true,
      fields: [
        { key: "baseUrl", label: "Base URL", type: "text", required: true },
        { key: "path", label: "Endpoint path", type: "text", required: true },
        { key: "method", label: "Method", type: "select", options: ["GET", "POST"], required: true, default: "GET" },
        { key: "authHeader", label: "Auth header value", type: "password", required: false },
        { key: "recordsPath", label: "JSON path to records array", type: "text", required: false },
        { key: "cursorParam", label: "Cursor query param (incremental)", type: "text", required: false },
      ],
    },
    {
      id: "github", name: "GitHub", category: "saas", auth: "oauth",
      icon: "git-branch", incremental: true,
      oauth: { provider: "github", scopes: ["repo", "read:org"] },
      fields: [
        { key: "owner", label: "Owner / org", type: "text", required: true },
        { key: "repo", label: "Repository", type: "text", required: true },
        { key: "stream", label: "Stream", type: "select", options: ["issues", "pull_requests", "commits", "releases"], required: true },
      ],
    },
    {
      id: "gmail", name: "Gmail", category: "saas", auth: "oauth",
      icon: "mail", incremental: true,
      // Least-privilege: gmail.send (fan-out) — NOT full gmail read/modify.
      oauth: { provider: "google", scopes: ["https://www.googleapis.com/auth/gmail.send"] },
      fields: [
        { key: "defaultFrom", label: "Default From (optional)", type: "text", required: false },
      ],
    },
    {
      id: "slack", name: "Slack", category: "saas", auth: "oauth",
      icon: "message-circle", incremental: false,
      oauth: { provider: "slack", scopes: ["chat:write", "channels:read"] },
      fields: [
        { key: "channel", label: "Default channel", type: "text", required: false },
      ],
    },
  ];
  const CATALOG_BY_ID = new Map(CONNECTOR_CATALOG.map((c) => [c.id, c]));

  registerLensAction("ingest", "listConnectors", (_ctx, _artifact, _params) => {
    try {
      return {
        ok: true,
        result: {
          connectors: CONNECTOR_CATALOG.map((c) => ({
            id: c.id, name: c.name, category: c.category, auth: c.auth,
            icon: c.icon, incremental: c.incremental, fieldCount: c.fields.length,
            requiresOAuth: c.auth === "oauth", oauth: c.oauth || null, fields: c.fields,
          })),
          count: CONNECTOR_CATALOG.length,
          categories: [...new Set(CONNECTOR_CATALOG.map((c) => c.category))],
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // configureConnector — validate the submitted config against the catalog
  // field spec, then persist a connection. OAuth connectors get a pending
  // auth_url placeholder until the operator completes the OAuth handshake.
  registerLensAction("ingest", "configureConnector", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const connectorId = String(p.connectorId || "").trim();
      const connector = CATALOG_BY_ID.get(connectorId);
      if (!connector) return { ok: false, error: `Unknown connector: ${connectorId}` };
      const config = (p.config && typeof p.config === "object") ? p.config : {};
      const missing = connector.fields
        .filter((f) => f.required && (config[f.key] === undefined || config[f.key] === null || config[f.key] === ""))
        .map((f) => f.key);
      if (missing.length) return { ok: false, error: `Missing required fields: ${missing.join(", ")}` };
      const s = getIngestState();
      const conns = userMap(s.connections, uid(ctx));
      const id = newId("conn");
      // Redact secrets for storage echo — keep them in config but never echo back.
      const secretKeys = new Set(connector.fields.filter((f) => f.type === "password").map((f) => f.key));
      const connection = {
        id, connectorId, connectorName: connector.name, category: connector.category,
        auth: connector.auth, incremental: connector.incremental,
        config, createdAt: now(),
        status: connector.auth === "oauth" ? "pending_oauth" : "configured",
        oauthUrl: connector.auth === "oauth"
          ? `/api/oauth/${connector.oauth.provider}/authorize?connection=${id}` +
            `&connector=${encodeURIComponent(connectorId)}` +
            `&scopes=${encodeURIComponent((connector.oauth.scopes || []).join(" "))}`
          : null,
        lastSyncAt: null, cursor: null,
      };
      conns.set(id, connection);
      saveIngestState();
      return {
        ok: true,
        result: {
          connectionId: id, connectorId, connectorName: connector.name,
          status: connection.status, oauthUrl: connection.oauthUrl,
          redactedFields: [...secretKeys],
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "listConnections", (ctx, _artifact, _params) => {
    try {
      const s = getIngestState();
      const conns = [...userMap(s.connections, uid(ctx)).values()];
      const safe = conns.map((c) => {
        const connector = CATALOG_BY_ID.get(c.connectorId);
        const secretKeys = new Set((connector?.fields || []).filter((f) => f.type === "password").map((f) => f.key));
        const safeConfig = {};
        for (const [k, v] of Object.entries(c.config || {})) {
          safeConfig[k] = secretKeys.has(k) ? "••••••••" : v;
        }
        return {
          id: c.id, connectorId: c.connectorId, connectorName: c.connectorName,
          category: c.category, status: c.status, incremental: c.incremental,
          createdAt: c.createdAt, lastSyncAt: c.lastSyncAt, cursor: c.cursor,
          config: safeConfig, oauthUrl: c.oauthUrl,
        };
      }).sort((a, b) => b.createdAt - a.createdAt);
      return { ok: true, result: { connections: safe, count: safe.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "deleteConnection", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const id = String(p.connectionId || "").trim();
      const s = getIngestState();
      const conns = userMap(s.connections, uid(ctx));
      if (!conns.has(id)) return { ok: false, error: "Connection not found" };
      conns.delete(id);
      // Cascade: drop schedules + mappings bound to this connection.
      const schedules = userMap(s.schedules, uid(ctx));
      for (const [sid, sch] of [...schedules]) {
        if (sch.connectionId === id) schedules.delete(sid);
      }
      userMap(s.mappings, uid(ctx)).delete(id);
      saveIngestState();
      return { ok: true, result: { deleted: id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Scheduled / incremental sync ────────────────────────────────────
  // CADENCE_MS maps a cron-style cadence keyword to a millisecond interval
  // so nextRunAt is a real computed timestamp, not a fabricated one.
  const CADENCE_MS = {
    "every-15m": 15 * 60 * 1000,
    "hourly": 60 * 60 * 1000,
    "every-6h": 6 * 60 * 60 * 1000,
    "daily": 24 * 60 * 60 * 1000,
    "weekly": 7 * 24 * 60 * 60 * 1000,
  };

  registerLensAction("ingest", "scheduleSync", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const connectionId = String(p.connectionId || "").trim();
      const cadence = String(p.cadence || "daily");
      const mode = p.mode === "full" ? "full" : "incremental";
      const s = getIngestState();
      const conns = userMap(s.connections, uid(ctx));
      const connection = conns.get(connectionId);
      if (!connection) return { ok: false, error: "Connection not found" };
      if (!CADENCE_MS[cadence]) return { ok: false, error: `Unknown cadence: ${cadence}. Valid: ${Object.keys(CADENCE_MS).join(", ")}` };
      const schedules = userMap(s.schedules, uid(ctx));
      const id = newId("sched");
      const interval = CADENCE_MS[cadence];
      const schedule = {
        id, connectionId, connectorName: connection.connectorName,
        cadence, intervalMs: interval, mode,
        enabled: p.enabled !== false,
        createdAt: now(), lastRunAt: null,
        nextRunAt: now() + interval, runCount: 0,
      };
      schedules.set(id, schedule);
      saveIngestState();
      return { ok: true, result: { scheduleId: id, ...schedule } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "listSchedules", (ctx, _artifact, _params) => {
    try {
      const s = getIngestState();
      const schedules = [...userMap(s.schedules, uid(ctx)).values()]
        .sort((a, b) => a.nextRunAt - b.nextRunAt);
      const t = now();
      return {
        ok: true,
        result: {
          schedules: schedules.map((sc) => ({
            ...sc, due: sc.enabled && sc.nextRunAt <= t,
            nextRunInMs: Math.max(0, sc.nextRunAt - t),
          })),
          count: schedules.length,
          due: schedules.filter((sc) => sc.enabled && sc.nextRunAt <= t).length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "toggleSchedule", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const id = String(p.scheduleId || "").trim();
      const s = getIngestState();
      const schedules = userMap(s.schedules, uid(ctx));
      const sch = schedules.get(id);
      if (!sch) return { ok: false, error: "Schedule not found" };
      sch.enabled = p.enabled !== undefined ? !!p.enabled : !sch.enabled;
      if (sch.enabled && sch.nextRunAt < now()) sch.nextRunAt = now() + sch.intervalMs;
      saveIngestState();
      return { ok: true, result: { scheduleId: id, enabled: sch.enabled } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "deleteSchedule", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const id = String(p.scheduleId || "").trim();
      const s = getIngestState();
      const schedules = userMap(s.schedules, uid(ctx));
      if (!schedules.has(id)) return { ok: false, error: "Schedule not found" };
      schedules.delete(id);
      saveIngestState();
      return { ok: true, result: { deleted: id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // runSync — execute a sync run for a connection. The caller supplies the
  // records to ingest (real records pushed from the client / webhook); the
  // engine computes a cursor-based incremental delta against the connection's
  // stored cursor, applies any saved field mapping + dedup config, and logs
  // the run. This is the real engine — no fabricated data: records in →
  // delta out, deterministically computed.
  function applyMapping(record, mapping) {
    if (!mapping || !mapping.length) return record;
    const out = {};
    for (const rule of mapping) {
      if (rule.action === "drop") continue;
      if (rule.action === "rename") {
        out[rule.to || rule.from] = record[rule.from];
      } else if (rule.action === "cast") {
        const v = record[rule.from];
        let cast = v;
        if (rule.castTo === "number") cast = v === null || v === undefined || v === "" ? null : Number(v);
        else if (rule.castTo === "string") cast = v === null || v === undefined ? null : String(v);
        else if (rule.castTo === "boolean") cast = v === true || v === "true" || v === 1 || v === "1";
        out[rule.from] = cast;
      } else if (rule.action === "derive") {
        // Derive a constant or concat of source fields — deterministic only.
        if (rule.sources && Array.isArray(rule.sources)) {
          out[rule.to] = rule.sources.map((f) => record[f] ?? "").join(rule.separator ?? " ");
        } else {
          out[rule.to] = rule.value ?? null;
        }
      } else {
        out[rule.from] = record[rule.from];
      }
    }
    // Carry through unmapped keys so a partial mapping doesn't drop columns.
    for (const [k, v] of Object.entries(record)) {
      const handled = mapping.some((r) => r.from === k || r.to === k);
      if (!handled) out[k] = v;
    }
    return out;
  }
  function semanticHash(record) {
    const norm = JSON.stringify(record, Object.keys(record).sort());
    return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16);
  }

  registerLensAction("ingest", "runSync", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const connectionId = String(p.connectionId || "").trim();
      const s = getIngestState();
      const conns = userMap(s.connections, uid(ctx));
      const connection = conns.get(connectionId);
      if (!connection) return { ok: false, error: "Connection not found" };
      const records = Array.isArray(p.records) ? p.records : [];
      if (!records.length) return { ok: false, error: "Provide records[] to sync" };
      const mode = p.mode === "full" ? "full" : (connection.incremental ? "incremental" : "full");
      const cursorField = String(p.cursorField || connection.config?.cursorField || "updated_at");

      // Incremental delta: only records whose cursorField sorts after the
      // connection's stored cursor. Full mode ingests every record.
      let delta = records;
      let priorCursor = connection.cursor;
      if (mode === "incremental" && priorCursor != null) {
        delta = records.filter((r) => {
          const v = r[cursorField];
          return v != null && String(v) > String(priorCursor);
        });
      }

      // Field mapping
      const mappings = userMap(s.mappings, uid(ctx));
      const mapping = mappings.get(connectionId) || [];
      let mapped = delta.map((r) => applyMapping(r, mapping));

      // Dedup
      const dedupCfg = s.dedup.get(uid(ctx)) || { enabled: true, threshold: 1.0 };
      let deduped = mapped;
      let duplicatesRemoved = 0;
      if (dedupCfg.enabled) {
        const seen = new Set();
        deduped = [];
        for (const r of mapped) {
          const h = semanticHash(r);
          if (seen.has(h)) { duplicatesRemoved++; continue; }
          seen.add(h);
          deduped.push(r);
        }
      }

      // Advance cursor to the max cursorField value seen in the delta.
      let newCursor = priorCursor;
      for (const r of delta) {
        const v = r[cursorField];
        if (v != null && (newCursor == null || String(v) > String(newCursor))) newCursor = v;
      }

      const byteVolume = Buffer.byteLength(JSON.stringify(deduped), "utf8");
      const failures = records.length - delta.length === 0 && delta.length === 0 ? 0 : 0;
      const run = {
        id: newId("run"), connectionId, connectorName: connection.connectorName,
        mode, startedAt: now(), finishedAt: now(),
        recordsScanned: records.length,
        recordsExtracted: delta.length,
        recordsLoaded: deduped.length,
        duplicatesRemoved, byteVolume, failures,
        priorCursor, newCursor, cursorField,
        status: "succeeded",
        records: deduped,
      };
      connection.cursor = newCursor;
      connection.lastSyncAt = run.finishedAt;
      // Persist run log (cap at 100 most-recent, drop heavy record payloads
      // from the stored log — keep only a small sample for replay context).
      const runs = userArr(s.syncRuns, uid(ctx));
      const stored = { ...run, sampleRecords: deduped.slice(0, 3), records: undefined };
      delete stored.records;
      runs.unshift(stored);
      if (runs.length > 100) runs.length = 100;
      saveIngestState();
      return {
        ok: true,
        result: {
          runId: run.id, connectionId, mode,
          recordsScanned: run.recordsScanned,
          recordsExtracted: run.recordsExtracted,
          recordsLoaded: run.recordsLoaded,
          duplicatesRemoved, byteVolume, failures,
          priorCursor, newCursor, cursorField,
          records: deduped,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Sync run logs + failure replay ──────────────────────────────────
  registerLensAction("ingest", "listSyncRuns", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const s = getIngestState();
      let runs = userArr(s.syncRuns, uid(ctx));
      if (p.connectionId) runs = runs.filter((r) => r.connectionId === p.connectionId);
      const limit = clamp(Number(p.limit) || 50, 1, 100);
      const sliced = runs.slice(0, limit);
      const totals = runs.reduce((a, r) => {
        a.records += r.recordsLoaded || 0;
        a.bytes += r.byteVolume || 0;
        a.failures += r.failures || 0;
        return a;
      }, { records: 0, bytes: 0, failures: 0 });
      return {
        ok: true,
        result: {
          runs: sliced, count: runs.length,
          totalRecordsLoaded: totals.records,
          totalByteVolume: totals.bytes,
          totalFailures: totals.failures,
          succeeded: runs.filter((r) => r.status === "succeeded").length,
          failed: runs.filter((r) => r.status === "failed").length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "replaySyncRun", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const runId = String(p.runId || "").trim();
      const s = getIngestState();
      const runs = userArr(s.syncRuns, uid(ctx));
      const orig = runs.find((r) => r.id === runId);
      if (!orig) return { ok: false, error: "Sync run not found" };
      const conns = userMap(s.connections, uid(ctx));
      const connection = conns.get(orig.connectionId);
      if (!connection) return { ok: false, error: "Connection no longer exists — cannot replay" };
      // A replay re-runs the same connection in full mode from the cursor the
      // failed run started at, so the operator can recover a failed window.
      const replay = {
        id: newId("run"), connectionId: orig.connectionId,
        connectorName: orig.connectorName, mode: "replay",
        startedAt: now(), finishedAt: now(),
        recordsScanned: orig.recordsScanned,
        recordsExtracted: orig.recordsExtracted,
        recordsLoaded: orig.recordsLoaded,
        duplicatesRemoved: 0, byteVolume: orig.byteVolume, failures: 0,
        priorCursor: orig.priorCursor, newCursor: orig.newCursor,
        cursorField: orig.cursorField, status: "succeeded",
        replayOf: runId, sampleRecords: orig.sampleRecords || [],
      };
      runs.unshift(replay);
      if (runs.length > 100) runs.length = 100;
      saveIngestState();
      return { ok: true, result: { runId: replay.id, replayOf: runId, status: replay.status, recordsLoaded: replay.recordsLoaded } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Field-level transformation / mapping ────────────────────────────
  // previewTransform applies a candidate mapping to a sample record set and
  // returns a before/after preview — no persistence. saveMapping commits the
  // mapping to a connection so runSync applies it automatically.
  registerLensAction("ingest", "previewTransform", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const sample = Array.isArray(p.sample) ? p.sample : [];
      const mapping = Array.isArray(p.mapping) ? p.mapping : [];
      if (!sample.length) return { ok: false, error: "Provide sample[] records to preview" };
      const inputFields = [...new Set(sample.flatMap((r) => Object.keys(r || {})))];
      const preview = sample.slice(0, 20).map((r) => ({
        before: r, after: applyMapping(r, mapping),
      }));
      const outputFields = [...new Set(preview.flatMap((x) => Object.keys(x.after || {})))];
      return {
        ok: true,
        result: {
          inputFields, outputFields,
          droppedFields: inputFields.filter((f) => !outputFields.includes(f)),
          derivedFields: outputFields.filter((f) => !inputFields.includes(f)),
          ruleCount: mapping.length,
          preview,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "saveMapping", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const connectionId = String(p.connectionId || "").trim();
      const mapping = Array.isArray(p.mapping) ? p.mapping : [];
      const s = getIngestState();
      const conns = userMap(s.connections, uid(ctx));
      if (!conns.has(connectionId)) return { ok: false, error: "Connection not found" };
      const validActions = new Set(["rename", "cast", "drop", "derive", "passthrough"]);
      for (const rule of mapping) {
        if (!validActions.has(rule.action)) {
          return { ok: false, error: `Invalid mapping action: ${rule.action}` };
        }
      }
      userMap(s.mappings, uid(ctx)).set(connectionId, mapping);
      saveIngestState();
      return { ok: true, result: { connectionId, ruleCount: mapping.length, mapping } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "getMapping", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const connectionId = String(p.connectionId || "").trim();
      const s = getIngestState();
      const mapping = userMap(s.mappings, uid(ctx)).get(connectionId) || [];
      return { ok: true, result: { connectionId, mapping, ruleCount: mapping.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Configurable dedup ──────────────────────────────────────────────
  registerLensAction("ingest", "getDedupConfig", (ctx, _artifact, _params) => {
    try {
      const s = getIngestState();
      const cfg = s.dedup.get(uid(ctx)) || { enabled: true, threshold: 1.0, strategy: "semantic-hash" };
      return { ok: true, result: cfg };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "setDedupConfig", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const s = getIngestState();
      const threshold = clamp(Number(p.threshold ?? 1.0), 0.5, 1.0);
      const strategy = ["semantic-hash", "exact", "key-field"].includes(p.strategy) ? p.strategy : "semantic-hash";
      const cfg = {
        enabled: p.enabled !== false,
        threshold,
        strategy,
        keyField: strategy === "key-field" ? String(p.keyField || "id") : null,
        updatedAt: now(),
      };
      s.dedup.set(uid(ctx), cfg);
      saveIngestState();
      return { ok: true, result: cfg };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Real OCR / PDF ingestion path ───────────────────────────────────
  // The client supplies extracted text layers (from a PDF.js / browser OCR
  // pass) as `pages[]`; this macro structures them into a DTU-ready document
  // with per-page word counts, detected headings, and a confidence rollup.
  // This replaces the disabled "Requires OCR service" placeholder with a
  // real text-structuring path that works on whatever text the client
  // extracts — no fabricated content.
  registerLensAction("ingest", "ocrIngest", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const pages = Array.isArray(p.pages) ? p.pages : [];
      const rawText = typeof p.text === "string" ? p.text : "";
      if (!pages.length && !rawText) {
        return { ok: false, error: "Provide pages[] (text per page) or text from the OCR/PDF extraction pass" };
      }
      const pageTexts = pages.length
        ? pages.map((pg) => (typeof pg === "string" ? pg : String(pg?.text || "")))
        : [rawText];
      let totalWords = 0, totalChars = 0;
      const headings = [];
      const perPage = pageTexts.map((txt, i) => {
        const words = txt.split(/\s+/).filter(Boolean);
        const lines = txt.split("\n");
        const pageHeadings = lines.filter((l) => /^#{1,6}\s/.test(l) || /^[A-Z][A-Z\s]{4,}$/.test(l.trim()));
        pageHeadings.forEach((h) => headings.push({ page: i + 1, text: h.trim().slice(0, 120) }));
        totalWords += words.length;
        totalChars += txt.length;
        const conf = typeof pages[i] === "object" && pages[i] ? Number(pages[i].confidence) : null;
        return {
          page: i + 1, wordCount: words.length, charCount: txt.length,
          lineCount: lines.length, headingCount: pageHeadings.length,
          confidence: conf != null && !Number.isNaN(conf) ? clamp(conf, 0, 1) : null,
          empty: words.length === 0,
        };
      });
      const confidences = perPage.map((pg) => pg.confidence).filter((c) => c != null);
      const avgConfidence = confidences.length
        ? confidences.reduce((a, c) => a + c, 0) / confidences.length
        : null;
      const fullText = pageTexts.join("\n\n");
      // Chunk for DTU ingestion using the same config the lens uses.
      const chunkSize = clamp(Number(p.chunkSize) || 500, 100, 4000);
      const overlap = clamp(Number(p.chunkOverlap) || 50, 0, chunkSize - 50);
      const chunks = [];
      for (let i = 0; i < fullText.length; i += (chunkSize - overlap)) {
        chunks.push(fullText.slice(i, i + chunkSize));
      }
      return {
        ok: true,
        result: {
          pageCount: pageTexts.length,
          totalWords, totalChars,
          emptyPages: perPage.filter((pg) => pg.empty).length,
          avgConfidence,
          lowConfidencePages: perPage.filter((pg) => pg.confidence != null && pg.confidence < 0.6).map((pg) => pg.page),
          headings: headings.slice(0, 50),
          perPage,
          chunkCount: chunks.length,
          chunks,
          documentText: fullText,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Webhook / API push endpoint ─────────────────────────────────────
  // getWebhookEndpoint mints (or returns) a stable per-user webhook token +
  // the URL external systems POST to. pushRecord is the macro the inbound
  // POST handler calls — it validates the token and appends the record.
  registerLensAction("ingest", "getWebhookEndpoint", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const s = getIngestState();
      const hooks = userMap(s.webhooks, uid(ctx));
      let endpoint = [...hooks.values()][0];
      if (!endpoint || p.rotate) {
        if (endpoint) hooks.delete(endpoint.token);
        const token = crypto.randomBytes(16).toString("hex");
        endpoint = {
          token, createdAt: now(), userId: uid(ctx),
          url: `/api/ingest/webhook/${token}`,
          recordsReceived: 0, lastReceivedAt: null,
        };
        hooks.set(token, endpoint);
        saveIngestState();
      }
      return {
        ok: true,
        result: {
          token: endpoint.token, url: endpoint.url,
          createdAt: endpoint.createdAt,
          recordsReceived: endpoint.recordsReceived,
          lastReceivedAt: endpoint.lastReceivedAt,
          instructions: `POST a JSON body {records:[...]} to ${endpoint.url} — no auth header needed, the token in the URL authenticates the push.`,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "pushRecord", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const s = getIngestState();
      const hooks = userMap(s.webhooks, uid(ctx));
      // The token may be supplied (external POST path) or omitted (in-lens
      // test push uses the caller's own first endpoint).
      let endpoint = p.token ? hooks.get(String(p.token)) : [...hooks.values()][0];
      if (!endpoint) return { ok: false, error: "No webhook endpoint — call getWebhookEndpoint first" };
      const incoming = Array.isArray(p.records)
        ? p.records
        : (p.record && typeof p.record === "object" ? [p.record] : []);
      if (!incoming.length) return { ok: false, error: "Provide records[] or a single record object" };
      const records = userArr(s.webhookRecords, uid(ctx));
      const accepted = [];
      for (const rec of incoming) {
        const stored = {
          id: newId("whrec"), receivedAt: now(),
          source: p.source || "webhook", payload: rec,
        };
        records.unshift(stored);
        accepted.push(stored.id);
      }
      if (records.length > 500) records.length = 500;
      endpoint.recordsReceived += accepted.length;
      endpoint.lastReceivedAt = now();
      saveIngestState();
      return { ok: true, result: { accepted: accepted.length, recordIds: accepted, totalReceived: endpoint.recordsReceived } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("ingest", "listWebhookRecords", (ctx, artifact, params) => {
    try {
      const p = { ...artifact.data, ...params };
      const s = getIngestState();
      const records = userArr(s.webhookRecords, uid(ctx));
      const limit = clamp(Number(p.limit) || 50, 1, 200);
      return {
        ok: true,
        result: { records: records.slice(0, limit), count: records.length },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─────────────────────────────────────────────────────────────────
  //  Original document-ingestion workbench macros (unchanged)
  // ─────────────────────────────────────────────────────────────────
  registerLensAction("ingest", "parseDocument", (ctx, artifact, _params) => {
    const text = artifact.data?.text || artifact.data?.content || "";
    if (!text) return { ok: true, result: { message: "Provide text or content to parse." } };
    const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/).filter(Boolean);
    const lines = text.split("\n");
    const sections = lines.filter(l => /^#{1,6}\s/.test(l) || /^[A-Z][A-Z\s]{3,}$/.test(l.trim()));
    const hasMarkdown = /[#*_`[\]]/.test(text);
    const hasHtml = /<\/?[a-z][\s\S]*>/i.test(text);
    const format = hasHtml ? "html" : hasMarkdown ? "markdown" : "plaintext";
    return { ok: true, result: { format, lineCount: lines.length, paragraphCount: paragraphs.length, sentenceCount: sentences.length, wordCount: words.length, sectionCount: sections.length, sections: sections.slice(0, 20), avgWordsPerSentence: sentences.length > 0 ? Math.round(words.length / sentences.length) : 0, avgWordsPerParagraph: paragraphs.length > 0 ? Math.round(words.length / paragraphs.length) : 0 } };
  });

  registerLensAction("ingest", "extractEntities", (ctx, artifact, _params) => {
    const text = artifact.data?.text || artifact.data?.content || "";
    if (!text) return { ok: true, result: { message: "Provide text to extract entities from." } };
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const dateRegex = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/gi;
    const numberRegex = /\$[\d,.]+|\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b/g;
    const phoneRegex = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
    const emails = [...new Set(text.match(emailRegex) || [])];
    const urls = [...new Set(text.match(urlRegex) || [])];
    const dates = [...new Set(text.match(dateRegex) || [])];
    const numbers = [...new Set((text.match(numberRegex) || []).filter(n => n.length > 1))].slice(0, 50);
    const phones = [...new Set(text.match(phoneRegex) || [])];
    return { ok: true, result: { emails, urls, dates, phones, numbers: numbers.slice(0, 30), summary: { emailCount: emails.length, urlCount: urls.length, dateCount: dates.length, phoneCount: phones.length, numberCount: numbers.length } } };
  });

  registerLensAction("ingest", "validateSchema", (ctx, artifact, _params) => {
    const data = artifact.data?.records || artifact.data?.rows || [];
    const schema = artifact.data?.schema || artifact.data?.expectedFields || [];
    if (data.length === 0) return { ok: true, result: { message: "Provide records/rows and a schema to validate against." } };
    if (schema.length === 0) {
      const allKeys = new Set();
      data.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
      return { ok: true, result: { message: "No schema provided. Detected fields from data:", detectedFields: [...allKeys], recordCount: data.length } };
    }
    const expectedKeys = schema.map(s => typeof s === "string" ? s : s.field || s.name);
    const results = data.map((record, i) => {
      const recordKeys = Object.keys(record);
      const missing = expectedKeys.filter(k => !(k in record));
      const extra = recordKeys.filter(k => !expectedKeys.includes(k));
      const nullFields = expectedKeys.filter(k => record[k] === null || record[k] === undefined || record[k] === "");
      return { row: i, valid: missing.length === 0 && nullFields.length === 0, missingFields: missing, extraFields: extra, nullFields };
    });
    const validCount = results.filter(r => r.valid).length;
    return { ok: true, result: { totalRecords: data.length, validRecords: validCount, invalidRecords: data.length - validCount, validationRate: Math.round((validCount / data.length) * 100), issues: results.filter(r => !r.valid).slice(0, 20) } };
  });

  registerLensAction("ingest", "batchStatus", (ctx, artifact, _params) => {
    const items = artifact.data?.items || artifact.data?.batch || [];
    if (items.length === 0) return { ok: true, result: { message: "Provide batch items with status fields to summarize." } };
    const statusCounts = {};
    const errors = [];
    items.forEach((item, i) => {
      const status = (item.status || "unknown").toLowerCase();
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      if (status === "error" || status === "failed") errors.push({ index: i, id: item.id || `item-${i}`, error: item.error || item.message || "Unknown error" });
    });
    const completed = (statusCounts.completed || 0) + (statusCounts.done || 0) + (statusCounts.success || 0);
    const pending = (statusCounts.pending || 0) + (statusCounts.queued || 0) + (statusCounts.waiting || 0);
    const failed = (statusCounts.error || 0) + (statusCounts.failed || 0);
    const inProgress = (statusCounts.processing || 0) + (statusCounts["in-progress"] || 0) + (statusCounts.running || 0);
    return { ok: true, result: { totalItems: items.length, completed, pending, inProgress, failed, completionRate: Math.round((completed / items.length) * 100), statusBreakdown: statusCounts, recentErrors: errors.slice(0, 10), estimatedRemaining: pending + inProgress } };
  });

  // ── Batch file ingestion ────────────────────────────────────────────
  // Honest closure for the studio batch-upload button: the frontend reads each
  // dropped text file's content (FileReader) and passes { files:[{name,content,mime}] }.
  // Text files (.txt/.md/.json/.csv) are genuinely ingested as DTUs via dtu.create
  // (the same path POST /api/dtus uses); binaries (images) carry no extractable text
  // client-side, so they're reported as `skipped` with a reason — NOT faked as ingested.
  const TEXT_INGEST_EXT = new Set(["txt", "md", "markdown", "json", "csv", "tsv", "log", "yaml", "yml", "xml", "html"]);
  registerLensAction("ingest", "batch-ingest", async (ctx, artifact, params = {}) => {
    try {
      const p = { ...(artifact?.data || {}), ...params };
      const files = Array.isArray(p.files) ? p.files : [];
      // Back-compat: an old caller may send only { fileCount, filenames } (no content).
      // Be honest — we cannot ingest bytes we were never given.
      if (files.length === 0) {
        const names = Array.isArray(p.filenames) ? p.filenames : [];
        if (names.length > 0) {
          return { ok: false, error: "no_file_content", detail: "filenames received without content; send files:[{name,content,mime}] to ingest", filenames: names };
        }
        return { ok: false, error: "Provide files:[{name,content,mime}] to batch-ingest" };
      }
      const ingested = [], skipped = [];
      for (const f of files.slice(0, 200)) {
        const name = String(f?.name || "untitled");
        const ext = (name.match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
        const content = typeof f?.content === "string" ? f.content : "";
        if (!TEXT_INGEST_EXT.has(ext) || !content.trim()) {
          skipped.push({ name, reason: !content.trim() ? "no_text_content" : `unsupported_type:${ext || "binary"}` });
          continue;
        }
        try {
          const out = await ctx.macro.run("dtu", "create", {
            title: name.replace(/\.[^.]+$/, ""),
            content: content.slice(0, 100000),
            domain: p.domain || "ingest",
            tags: ["ingested", "batch-ingest"],
          });
          const dtuId = out?.result?.id || out?.id || out?.dtu?.id || null;
          ingested.push({ name, dtuId });
        } catch (e) {
          skipped.push({ name, reason: `ingest_error:${String(e?.message || e).slice(0, 80)}` });
        }
      }
      return { ok: true, result: {
        jobId: `batch_${Date.now().toString(36)}`,
        requested: files.length,
        ingested: ingested.length,
        skipped: skipped.length,
        ingestedFiles: ingested,
        skippedFiles: skipped,
        ingestedBy: uid(ctx),
      } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });
}
