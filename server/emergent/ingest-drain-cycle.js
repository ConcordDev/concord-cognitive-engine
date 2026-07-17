// server/emergent/ingest-drain-cycle.js
//
// WAVE4 — real scheduled drain of due connector-backed ingest schedules.
//
// server/domains/ingest.js already models the full ELT surface (catalog /
// connections / schedules / mappings / sync-run log / dedup / webhooks) —
// including a real, computed `nextRunAt` per schedule (`ingest.scheduleSync`)
// and a `due` flag (`ingest.listSchedules`). What was missing: nothing ever
// actually walked due schedules on a cadence — `ingest.runSync` only fires
// when a human (or the lens UI) hand-supplies `records[]`. This heartbeat is
// that drain: it finds schedules whose `nextRunAt` has passed and, for the
// subset backed by a real OAuth connector (gmail / slack / google-sheets /
// github — the four `auth: "oauth"` entries in ingest.js's
// CONNECTOR_CATALOG), pulls live data through the existing per-user
// connector readers in server/lib/connector-client.js and advances the
// connection's cursor + the sync-run log exactly the way a manual
// `ingest.runSync` call would.
//
// Honesty (hard invariant — CLAUDE.md "honest by construction"):
//   - A schedule is reported `drained` ONLY when a real connector reader
//     returned real records (possibly zero — an empty real pull is still
//     an honest drain, not a skip). There is no synthetic/mock data path
//     anywhere in this file.
//   - A schedule whose connector has no wired reader — the two
//     `auth: "credentials"` connectors (postgres, s3 — arbitrary DB/object-
//     store egress with user-supplied host/bucket credentials) or an
//     `auth: "api-key"` connector (stripe, rest-api) — is SKIPPED with a
//     specific, honest reason. It is never marked drained, and its
//     unsupported status is never silently swallowed.
//   - A schedule with a missing connection, an incomplete OAuth handshake,
//     or a connector-reader failure (no token / provider error / blocked
//     URL — whatever connector-client.js's SSRF-guarded chokepoint
//     returned) is likewise recorded with that real reason string, never
//     papered over as success.
//   - The heartbeat NEVER throws. Every schedule is drained inside its own
//     try/catch, and the whole cycle is wrapped again — a malformed
//     schedule record, an absent STATE, or a connector exception all
//     degrade to an honest per-schedule skip/error instead of stopping the
//     governor tick (per CLAUDE.md: "a module crash must never stop the
//     tick").
//   - Work is bounded per cycle (CONCORD_INGEST_DRAIN_BATCH, default 25
//     schedules) so a large backlog can't turn one tick into an unbounded
//     fan-out of outbound HTTP calls; the oldest-overdue schedules drain
//     first so the backlog empties fairly across ticks.
//
// GATED / documented, not silently dropped: the `postgres` and `s3` catalog
// connectors need a per-source credential driver (a pooled pg client, an S3
// SDK client, secret handling beyond the OAuth-token table connector-client
// already has) to drain for real — a materially different, larger unit than
// "reuse the existing OAuth readers". Those schedules are skipped every
// cycle with reason `gated_credential_driver_required:<connectorId>` so the
// ingest lens can show an honest "needs a credential driver, not yet wired"
// state instead of a silent no-op or a fabricated success. `stripe` and
// `rest-api` are api-key connectors (not OAuth) and are likewise skipped
// with `unsupported_auth_model:<auth>:<connectorId>` — closing that gap is a
// separate, smaller unit (an api-key HTTP reader) intentionally left out of
// this OAuth-focused drain.
//
// Webhook-push schedules: nothing in the catalog today declares
// `auth: "webhook"`, so this branch is presently unreachable in production
// — but it exists so the mechanism is honest by construction rather than
// silently absent. A push-driven source is never *pulled* (that would be
// fabricating a poll against something that only pushes); instead the cycle
// reports the real count of records the webhook endpoint already received
// since the schedule's last check (`ingest.pushRecord` already did the
// real ingestion at push time — this just surfaces an honest count on the
// schedule).

import logger from "../logger.js";
import {
  getIngestState,
  saveIngestState,
  userMap,
  userArr,
  CATALOG_BY_ID,
  now,
  newId,
} from "../domains/ingest.js";
import {
  readGmailMessages,
  readSlackMessages,
  readGoogleSheet,
  readGitHubIssues,
} from "../lib/connector-client.js";

const DEFAULT_BATCH = 25;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // fallback cadence if a schedule is missing intervalMs

// ── Per-connector pull functions ────────────────────────────────────────
// Each takes (db, userId, connection, schedule) and returns either
//   { ok:true, scanned, extracted, records, cursorField, newCursor }
// or
//   { ok:false, reason }
// — the same shape ingest.js's runSync computes by hand from client-
// supplied records, just sourced from a real connector pull instead.

async function pullGmail(db, userId, connection, schedule) {
  const cfg = connection.config || {};
  const res = await readGmailMessages(db, userId, { maxResults: 50, q: cfg.query || undefined });
  if (!res.ok) return { ok: false, reason: res.reason || "connector_error" };
  const messages = Array.isArray(res.messages) ? res.messages : [];
  const cursorField = "internalDate";
  const full = schedule.mode === "full" || connection.cursor == null;
  const delta = full
    ? messages
    : messages.filter((m) => m.internalDate != null && String(m.internalDate) > String(connection.cursor));
  let newCursor = connection.cursor;
  for (const m of delta) {
    if (m.internalDate != null && (newCursor == null || String(m.internalDate) > String(newCursor))) newCursor = m.internalDate;
  }
  return { ok: true, scanned: messages.length, extracted: delta.length, records: delta, cursorField, newCursor };
}

async function pullSlack(db, userId, connection, schedule) {
  const cfg = connection.config || {};
  const channel = cfg.channel;
  if (!channel) return { ok: false, reason: "missing_channel_config" };
  const full = schedule.mode === "full";
  const res = await readSlackMessages(db, userId, channel, {
    limit: 100,
    oldest: full ? undefined : (connection.cursor || undefined),
  });
  if (!res.ok) return { ok: false, reason: res.reason || "connector_error" };
  const messages = Array.isArray(res.messages) ? res.messages : [];
  let newCursor = connection.cursor;
  for (const m of messages) {
    if (m.ts != null && (newCursor == null || String(m.ts) > String(newCursor))) newCursor = m.ts;
  }
  // Slack's `oldest` param already did the incremental filtering
  // server-side on a non-full run, so everything returned IS the delta.
  return { ok: true, scanned: messages.length, extracted: messages.length, records: messages, cursorField: "ts", newCursor };
}

async function pullGoogleSheet(db, userId, connection, _schedule) {
  const cfg = connection.config || {};
  if (!cfg.spreadsheetId) return { ok: false, reason: "missing_spreadsheet_config" };
  const range = cfg.sheetName ? `${cfg.sheetName}!A1:ZZ10000` : "A1:ZZ10000";
  const res = await readGoogleSheet(db, userId, cfg.spreadsheetId, range);
  if (!res.ok) return { ok: false, reason: res.reason || "connector_error" };
  const rows = Array.isArray(res.values) ? res.values : [];
  // Google Sheets is `incremental:false` in the catalog by design — every
  // drain is a full snapshot re-read of the configured range, not a delta.
  const records = rows.map((row, i) => ({ row: i, values: row }));
  return { ok: true, scanned: records.length, extracted: records.length, records, cursorField: null, newCursor: connection.cursor };
}

async function pullGitHub(db, userId, connection, schedule) {
  const cfg = connection.config || {};
  if (!cfg.owner || !cfg.repo) return { ok: false, reason: "missing_repo_config" };
  const stream = cfg.stream || "issues";
  if (stream !== "issues") {
    // The catalog UI offers pull_requests/commits/releases streams, but
    // connector-client.js only exposes a GitHub issues reader today — an
    // honest gap, not a fabricated pull.
    return { ok: false, reason: `stream_not_implemented:${stream}` };
  }
  const repo = `${cfg.owner}/${cfg.repo}`;
  const res = await readGitHubIssues(db, userId, repo, { state: "all", perPage: 100 });
  if (!res.ok) return { ok: false, reason: res.reason || "connector_error" };
  const issues = Array.isArray(res.issues) ? res.issues : [];
  const cursorField = "number";
  const full = schedule.mode === "full" || connection.cursor == null;
  const delta = full
    ? issues
    : issues.filter((i) => i.number != null && Number(i.number) > Number(connection.cursor));
  let newCursor = connection.cursor;
  for (const i of delta) {
    if (i.number != null && (newCursor == null || Number(i.number) > Number(newCursor))) newCursor = i.number;
  }
  return { ok: true, scanned: issues.length, extracted: delta.length, records: delta, cursorField, newCursor };
}

// catalog connectorId -> reader. Only the wired OAuth connectors have an
// entry; anything else falls through to the honest "unsupported" branch in
// drainSchedule(). Exported (not just used internally) so tests can inject
// stubs via `opts.readers` without touching real network/token plumbing.
export const DEFAULT_READERS = {
  gmail: pullGmail,
  slack: pullSlack,
  "google-sheets": pullGoogleSheet,
  github: pullGitHub,
};

/** Classify why a connection's source can't be drained by this cycle. */
function classifyUnsupported(connectorId, catalogConnector) {
  if (!catalogConnector) return `connector_catalog_entry_missing:${connectorId}`;
  if (catalogConnector.category === "database" || catalogConnector.category === "file-store") {
    return `gated_credential_driver_required:${catalogConnector.id}`;
  }
  if (catalogConnector.auth !== "oauth") {
    return `unsupported_auth_model:${catalogConnector.auth}:${catalogConnector.id}`;
  }
  return `unsupported_oauth_connector:${catalogConnector.id}`;
}

/**
 * Drain a single due schedule. Never throws — every failure path returns a
 * `{ status, reason, recordCount }` result instead. `status` is one of:
 *   'drained'       — a real connector pull happened, cursor advanced, a
 *                      sync-run log entry (mode:'scheduled') was written.
 *   'push_reviewed' — a webhook-push-backed schedule; reports the real
 *                      count of records already received via push, no pull
 *                      attempted (there is nothing to poll).
 *   'skipped'       — the source isn't drainable by this cycle (missing
 *                      connection, incomplete OAuth handshake, or a
 *                      connector this cycle doesn't wire — see
 *                      classifyUnsupported).
 *   'error'         — a wired connector reader ran and returned a real
 *                      failure (no token / provider error / blocked URL /
 *                      threw).
 */
async function drainSchedule(db, ingestState, userId, schedule, readers) {
  const conns = userMap(ingestState.connections, userId);
  const connection = conns.get(schedule.connectionId);
  const catalogConnector = connection ? CATALOG_BY_ID.get(connection.connectorId) : null;

  if (!connection) {
    return { status: "skipped", reason: "connection_missing", recordCount: 0 };
  }
  if (connection.status === "pending_oauth") {
    return { status: "skipped", reason: "oauth_not_completed", recordCount: 0 };
  }
  if (catalogConnector?.auth === "webhook") {
    const records = userArr(ingestState.webhookRecords, userId);
    const since = schedule.lastRunAt || schedule.createdAt || 0;
    const arrived = records.filter((r) => r && r.receivedAt > since);
    return { status: "push_reviewed", reason: null, recordCount: arrived.length };
  }

  const reader = readers[connection.connectorId];
  if (!reader) {
    return { status: "skipped", reason: classifyUnsupported(connection.connectorId, catalogConnector), recordCount: 0 };
  }

  let pull;
  try {
    pull = await reader(db, userId, connection, schedule);
  } catch (err) {
    pull = { ok: false, reason: `reader_threw:${String(err?.message || err).slice(0, 120)}` };
  }
  if (!pull || !pull.ok) {
    return { status: "error", reason: (pull && pull.reason) || "connector_error", recordCount: 0 };
  }

  // Real drain — advance the connection cursor and log a sync run in the
  // exact same shape ingest.js#runSync writes, so a scheduled drain and a
  // manual one are indistinguishable in the sync-run log and schedule
  // state (the only difference is `mode: "scheduled"`).
  const priorCursor = connection.cursor;
  connection.cursor = pull.newCursor;
  connection.lastSyncAt = now();

  const runs = userArr(ingestState.syncRuns, userId);
  const run = {
    id: newId("run"),
    connectionId: connection.id,
    connectorName: connection.connectorName,
    mode: "scheduled",
    startedAt: now(),
    finishedAt: now(),
    recordsScanned: pull.scanned,
    recordsExtracted: pull.extracted,
    recordsLoaded: pull.extracted,
    duplicatesRemoved: 0,
    byteVolume: Buffer.byteLength(JSON.stringify(pull.records || []), "utf8"),
    failures: 0,
    priorCursor,
    newCursor: pull.newCursor,
    cursorField: pull.cursorField,
    status: "succeeded",
    scheduleId: schedule.id,
    sampleRecords: (pull.records || []).slice(0, 3),
  };
  runs.unshift(run);
  if (runs.length > 100) runs.length = 100;

  return { status: "drained", reason: null, recordCount: pull.extracted, runId: run.id };
}

/**
 * The heartbeat entry point. `ctx` is the standard heartbeat-registry
 * moduleCtx ({ state, db, tickCount, reason }); `opts.readers` lets tests
 * substitute stub connector readers so the cycle can be exercised without
 * real network egress or a real OAuth token table.
 */
export async function runIngestDrainCycle(ctx = {}, opts = {}) {
  try {
    const db = ctx?.db ?? null;
    const readers = opts.readers || DEFAULT_READERS;
    const ingestState = getIngestState();
    const nowTs = now();

    // Collect every due (enabled, nextRunAt <= now) schedule across every
    // user, oldest-overdue first, so a backlog drains fairly instead of
    // starving whichever user id happens to iterate last.
    const dueList = [];
    for (const [userId, schedules] of ingestState.schedules) {
      for (const schedule of schedules.values()) {
        if (!schedule || schedule.enabled === false) continue;
        if (typeof schedule.nextRunAt !== "number" || schedule.nextRunAt > nowTs) continue;
        dueList.push({ userId, schedule });
      }
    }
    if (dueList.length === 0) {
      return { ok: true, dueCount: 0, processed: 0, drained: 0, pushed: 0, skipped: 0, errored: 0 };
    }
    dueList.sort((a, b) => a.schedule.nextRunAt - b.schedule.nextRunAt);

    const batchSize = Math.max(1, Number(process.env.CONCORD_INGEST_DRAIN_BATCH) || DEFAULT_BATCH);
    const batch = dueList.slice(0, batchSize);

    let drained = 0, pushed = 0, skipped = 0, errored = 0;
    for (const { userId, schedule } of batch) {
      let outcome;
      try {
        outcome = await drainSchedule(db, ingestState, userId, schedule, readers);
      } catch (err) {
        outcome = { status: "error", reason: `drain_threw:${String(err?.message || err).slice(0, 120)}`, recordCount: 0 };
      }

      // Always advance cadence regardless of outcome — a schedule pointed
      // at a broken/unsupported source must not retry every single tick
      // forever; it gets its normal cadence like any other schedule, with
      // the real reason recorded for the operator to see and fix.
      schedule.lastRunAt = nowTs;
      schedule.runCount = (schedule.runCount || 0) + 1;
      schedule.nextRunAt = nowTs + (schedule.intervalMs || DEFAULT_INTERVAL_MS);
      schedule.lastDrainAt = nowTs;
      schedule.lastDrainStatus = outcome.status;
      schedule.lastDrainReason = outcome.reason || null;
      schedule.lastDrainRecordCount = outcome.recordCount || 0;

      if (outcome.status === "drained") drained++;
      else if (outcome.status === "push_reviewed") pushed++;
      else if (outcome.status === "error") errored++;
      else skipped++;
    }

    saveIngestState();
    return { ok: true, dueCount: dueList.length, processed: batch.length, drained, pushed, skipped, errored };
  } catch (err) {
    try { logger.warn("ingest-drain-cycle", "cycle_failed", { error: err?.message || String(err) }); } catch { /* logging best-effort */ }
    return { ok: false, reason: "cycle_threw", error: err?.message || String(err) };
  }
}
