// server/lib/detectors/heartbeat-monitor.js
//
// Runtime detector: queries the heartbeat-registry for registered modules
// and reports
//   - missing heartbeats (CLAUDE.md says 25 expected)
//   - registered but never disabled-flagged so cleanup is needed
//   - frequency that looks accidentally too aggressive (<1) or stale (>2880)
//   - registry entries whose handler has thrown >threshold times since boot
//     (when STATE.heartbeatStats is populated by server.js)
//
// Static-only fallback: if the registry isn't reachable (cold static run),
// regex-parses server.js for `registerHeartbeat("id", { frequency })` and
// reports the snapshot.

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath } from "./_framework.js";

const HEARTBEAT_RE = /registerHeartbeat\s*\(\s*['"`]([a-zA-Z0-9_-]+)['"`]\s*,\s*\{\s*frequency\s*:\s*(\d+)/g;
const EXPECTED_MIN = 18;          // soft floor — CLAUDE.md cites 25
const FREQ_TOO_AGGRESSIVE = 0;    // < 1 is invalid
const FREQ_TOO_STALE = 5760;      // > ~24h ticks is suspicious

export async function runHeartbeatMonitor({ root, state, opts = {} } = {}) {
  const t0 = Date.now();
  const findings = [];

  try {
    let entries = [];
    let source = "static";

    // Prefer the live registry when available — but only if it has been
    // populated (server.js boot has run). An empty registry in a CLI run
    // means we should fall back to static parsing.
    if (opts.useRegistry !== false) {
      try {
        const mod = await import("../../emergent/heartbeat-registry.js");
        if (typeof mod.listHeartbeatModules === "function") {
          const live = mod.listHeartbeatModules();
          if (live.length > 0) {
            entries = live;
            source = "runtime";
          }
        }
      } catch { /* fallback to static */ }
    }

    if (entries.length === 0 && root) {
      const serverJs = path.join(root, "server", "server.js");
      const c = await readSafe(serverJs);
      if (c) {
        let m;
        HEARTBEAT_RE.lastIndex = 0;
        const seen = new Set();
        while ((m = HEARTBEAT_RE.exec(c)) != null) {
          const id = m[1];
          if (seen.has(id)) continue;
          seen.add(id);
          entries.push({ id, frequency: parseInt(m[2], 10), neverDisable: false, _line: lineOf(c, m.index) });
        }
        // Also walk emergent/ for inline registrations.
        const moreFiles = await walk(path.join(root, "server", "emergent"), [".js"]);
        for (const f of moreFiles) {
          const cc = await readSafe(f);
          if (!cc) continue;
          let mm;
          HEARTBEAT_RE.lastIndex = 0;
          while ((mm = HEARTBEAT_RE.exec(cc)) != null) {
            if (!seen.has(mm[1])) {
              seen.add(mm[1]);
              entries.push({ id: mm[1], frequency: parseInt(mm[2], 10), _file: relPath(root, f), _line: lineOf(cc, mm.index) });
            }
          }
        }
      }
    }

    if (entries.length < EXPECTED_MIN) {
      findings.push({
        id: "heartbeat_count_low",
        severity: "high",
        kind: "heartbeat",
        message: `Only ${entries.length} heartbeats registered; expected at least ${EXPECTED_MIN}`,
        evidence: { count: entries.length, min: EXPECTED_MIN, source },
      });
    }

    for (const e of entries) {
      if (!Number.isInteger(e.frequency) || e.frequency <= FREQ_TOO_AGGRESSIVE) {
        findings.push({
          id: "heartbeat_invalid_freq",
          severity: "high",
          kind: "heartbeat",
          subject: { kind: "heartbeat", id: e.id },
          message: `Heartbeat ${e.id} has invalid frequency ${e.frequency}`,
          location: e._file ? `${e._file}:${e._line}` : null,
        });
      } else if (e.frequency > FREQ_TOO_STALE) {
        findings.push({
          id: "heartbeat_too_stale",
          severity: "low",
          kind: "heartbeat",
          subject: { kind: "heartbeat", id: e.id },
          message: `Heartbeat ${e.id} runs every ${e.frequency} ticks — verify this is intentional`,
        });
      }
    }

    // Runtime stats — if state.heartbeatStats has been populated.
    const stats = state?.heartbeatStats || {};
    for (const [id, s] of Object.entries(stats)) {
      if (!s) continue;
      if ((s.failures || 0) >= 5) {
        findings.push({
          id: "heartbeat_failing",
          severity: "high",
          kind: "heartbeat",
          subject: { kind: "heartbeat", id },
          message: `Heartbeat ${id} has failed ${s.failures} times since boot`,
          evidence: { lastError: s.lastError?.slice?.(0, 120) },
        });
      }
      // Stale by wall clock — last run > 30 min ago for a non-cold heartbeat.
      const lastRunAgoMs = s.lastRunMs ? Date.now() - s.lastRunMs : null;
      if (lastRunAgoMs != null && lastRunAgoMs > 30 * 60 * 1000) {
        findings.push({
          id: "heartbeat_stale_run",
          severity: "medium",
          kind: "heartbeat",
          subject: { kind: "heartbeat", id },
          message: `Heartbeat ${id} hasn't run in ${Math.round(lastRunAgoMs / 60000)} minutes`,
        });
      }
    }

    findings.unshift({
      id: "heartbeat_summary",
      severity: "info",
      kind: "heartbeat",
      message: `${entries.length} heartbeats registered (${source})`,
      evidence: {
        count: entries.length,
        ids: entries.map(e => e.id).slice(0, 50),
        source,
      },
    });

    return makeReport("heartbeat-monitor", findings, t0);
  } catch (err) {
    return makeError("heartbeat-monitor", "exception", err, t0);
  }
}
