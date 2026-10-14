// Signal gather — same sources as incident-engine.py tool_incident_watch.
// Read-only opens; failures degrade to [].

import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const SHARE = join(homedir(), ".local/share/concord");
export const DEFAULT_SENTINEL_DB = join(SHARE, "sentinel.db");
export const DEFAULT_TRACE_DB = join(SHARE, "trace-fabric.db");
export const DEFAULT_BROWSER_DB = join(SHARE, "browser_organ.db");
export const DEFAULT_INCIDENT_DB = join(SHARE, "incident-engine.db");

function openRo(path) {
  if (!existsSync(path)) return null;
  try {
    return new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

export function readSentinelAlerts(sinceMinutes = 10, dbPath = DEFAULT_SENTINEL_DB) {
  const conn = openRo(dbPath);
  if (!conn) return [];
  try {
    const rows = conn
      .prepare(
        `SELECT id, observed_at, source, severity, message, delivered_via, trace_id
         FROM sentinel_alerts
         WHERE datetime(created_at, 'localtime') > datetime('now', 'localtime', ?)
         ORDER BY id DESC LIMIT 30`,
      )
      .all(`-${sinceMinutes} minutes`);
    return rows.map((r) => ({
      source: "sentinel_alert",
      kind: r.source,
      severity: r.severity,
      message: r.message,
      trace_id: r.trace_id,
    }));
  } catch {
    return [];
  } finally {
    conn.close();
  }
}

export function readTraceFabricErrors(sinceMinutes = 10, dbPath = DEFAULT_TRACE_DB) {
  const conn = openRo(dbPath);
  if (!conn) return [];
  try {
    const cutoff = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
    const rows = conn
      .prepare(
        `SELECT id, trace_id, source_event, tool_name, observed_at, payload_json
         FROM trace_correlation
         WHERE source_event = 'tool_call_completed' AND observed_at > ?
         LIMIT 30`,
      )
      .all(cutoff);
    const out = [];
    for (const r of rows) {
      let payload;
      try {
        payload = JSON.parse(r.payload_json);
      } catch {
        continue;
      }
      if (payload?.reason_code === "replay_detected" || payload?.verification_pass === false) {
        out.push({
          source: "trace_fabric_error",
          kind:
            payload.reason_code === "replay_detected"
              ? "f0_idempotency_cache_miss"
              : "trace_fabric_error",
          tool_name: r.tool_name,
          trace_id: r.trace_id,
          payload,
        });
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    conn.close();
  }
}

export function checkBrowserOrganStaleness(dbPath = DEFAULT_BROWSER_DB) {
  const conn = openRo(dbPath);
  if (!conn) return null;
  try {
    const row = conn.prepare("SELECT MAX(observed_at) AS last_obs FROM observations").get();
    if (!row?.last_obs) {
      return { kind: "browser_organ_observation_stale", reason: "no_observations" };
    }
    const lastObs = new Date(String(row.last_obs).replace("Z", "+00:00"));
    const age = (Date.now() - lastObs.getTime()) / 1000;
    if (!Number.isFinite(age)) {
      return { kind: "browser_organ_observation_stale", reason: "parse_failed" };
    }
    if (age > 1800) {
      return {
        kind: "browser_organ_observation_stale",
        age_seconds: age,
        last_observed: row.last_obs,
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    conn.close();
  }
}

/** Build the same all_signals list the Python organ builds. */
export function gatherWatchSignals(sinceMinutes = 10, paths = {}) {
  const signals = [
    ...readSentinelAlerts(sinceMinutes, paths.sentinelDb || DEFAULT_SENTINEL_DB),
    ...readTraceFabricErrors(sinceMinutes, paths.traceDb || DEFAULT_TRACE_DB),
  ];
  const stale = checkBrowserOrganStaleness(paths.browserDb || DEFAULT_BROWSER_DB);
  if (stale) {
    signals.push({
      source: "browser_organ_observation_stale",
      kind: "browser_organ_observation_stale",
      ...stale,
    });
  }
  return signals;
}
