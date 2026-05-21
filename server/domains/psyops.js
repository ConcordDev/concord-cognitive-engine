// server/domains/psyops.js
//
// Psyops lens — anomaly-detection / threat-intelligence console.
// The base lens (3 macros in server.js: psyops.scan_skill_divergence,
// psyops.list_alerts, psyops.quarantine) covers ONE signal — NPC
// skill-revision divergence. This module adds the operator workflow
// layer a real SIEM/anomaly console needs, all per-user persistent:
//
//   • Multi-signal anomaly detection (economy / content / network)
//   • Alert triage workflow (assign / investigate / resolve / dismiss)
//   • Alert detail + evidence drill-down
//   • Configurable detection rules per signal
//   • Incident timeline correlation (group related alerts)
//   • Quarantine review + audited release
//   • Critical-alert operator notifications
//
// All state lives in globalThis._concordSTATE.psyopsLens, keyed by
// userId. Every handler returns { ok, result? , error? } and never
// throws. No mock/seed data — anomalies are computed from real
// numeric inputs the caller supplies (signal samples), and the
// statistical scan is genuine (mean / stddev / z-score).

function getState() {
  const STATE = globalThis._concordSTATE;
  if (!STATE) return null;
  if (!STATE.psyopsLens) STATE.psyopsLens = {};
  const s = STATE.psyopsLens;
  for (const k of ["alerts", "rules", "incidents", "notifications", "quarantineLog"]) {
    if (!(s[k] instanceof Map)) s[k] = new Map();
  }
  return s;
}

function saveState() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
  }
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "anon";
}

// Default detection rules — each rule defines a sigma threshold for a
// signal class. Cloned per user on first access so edits are isolated.
const DEFAULT_RULES = [
  { signal: "skill_divergence", label: "NPC skill-revision divergence", sigma: 2.5, enabled: true, critical: 4.0 },
  { signal: "economy", label: "Wallet / transaction anomaly", sigma: 3.0, enabled: true, critical: 4.5 },
  { signal: "content", label: "Content-generation burst", sigma: 2.5, enabled: true, critical: 4.0 },
  { signal: "network", label: "Network / request-rate anomaly", sigma: 3.0, enabled: true, critical: 5.0 },
];

const SIGNALS = ["skill_divergence", "economy", "content", "network"];
const STATUSES = ["open", "assigned", "investigating", "resolved", "dismissed"];

function statsOf(samples) {
  const n = samples.length;
  if (n === 0) return { n: 0, mean: 0, stddev: 1 };
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance) || 1;
  return { n, mean, stddev };
}

export default function registerPsyopsActions(registerLensAction) {
  // ─── Configurable detection rules ────────────────────────────────
  function userRules(s, userId) {
    if (!s.rules.has(userId)) {
      s.rules.set(userId, DEFAULT_RULES.map((r) => ({ ...r })));
    }
    return s.rules.get(userId);
  }

  registerLensAction("psyops", "rules_list", (ctx, _artifact, _params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      return { ok: true, result: { rules: userRules(s, actorId(ctx)) } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("psyops", "rules_update", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const signal = String(params.signal || "");
      if (!SIGNALS.includes(signal)) return { ok: false, error: "unknown signal" };
      const rules = userRules(s, actorId(ctx));
      const rule = rules.find((r) => r.signal === signal);
      if (!rule) return { ok: false, error: "rule not found" };
      if (params.sigma !== undefined) {
        const sg = Number(params.sigma);
        if (!Number.isFinite(sg) || sg <= 0 || sg > 10) return { ok: false, error: "sigma must be 0–10" };
        rule.sigma = sg;
      }
      if (params.critical !== undefined) {
        const cr = Number(params.critical);
        if (!Number.isFinite(cr) || cr <= 0 || cr > 12) return { ok: false, error: "critical must be 0–12" };
        rule.critical = cr;
      }
      if (params.enabled !== undefined) rule.enabled = !!params.enabled;
      saveState();
      return { ok: true, result: { rule } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ─── Multi-signal anomaly detection ──────────────────────────────
  // Caller supplies real signal samples: { signal, samples:[{entityId,value}] }.
  // We compute genuine z-scores against the sample population and file
  // alerts on any entity exceeding the rule's sigma threshold.
  registerLensAction("psyops", "scan_signal", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const signal = String(params.signal || "");
      if (!SIGNALS.includes(signal)) return { ok: false, error: "unknown signal" };
      const rule = userRules(s, userId).find((r) => r.signal === signal);
      if (!rule || !rule.enabled) return { ok: false, error: "rule disabled or missing" };
      const raw = Array.isArray(params.samples) ? params.samples : [];
      const samples = raw
        .map((x) => ({ entityId: String(x?.entityId || ""), value: Number(x?.value) }))
        .filter((x) => x.entityId && Number.isFinite(x.value));
      if (samples.length < 2) return { ok: false, error: "need >=2 valid samples" };
      const values = samples.map((x) => x.value);
      const { mean, stddev } = statsOf(values);
      if (!s.alerts.has(userId)) s.alerts.set(userId, []);
      const list = s.alerts.get(userId);
      const fresh = [];
      for (const x of samples) {
        const sigma = (x.value - mean) / stddev;
        if (sigma >= rule.sigma) {
          const severity = sigma >= rule.critical ? "critical" : sigma >= rule.sigma + 1 ? "high" : "medium";
          const alert = {
            id: uid("al"),
            signal,
            entityId: x.entityId,
            value: x.value,
            cohortMean: Number(mean.toFixed(3)),
            cohortStddev: Number(stddev.toFixed(3)),
            sigmaAbove: Number(sigma.toFixed(3)),
            severity,
            status: "open",
            assignee: null,
            notes: [],
            incidentId: null,
            quarantined: false,
            evidence: {
              cohortSize: samples.length,
              ruleSigma: rule.sigma,
              criticalSigma: rule.critical,
              percentile: Number(((values.filter((v) => v <= x.value).length / values.length) * 100).toFixed(1)),
            },
            detectedAt: Date.now(),
          };
          list.unshift(alert);
          fresh.push(alert);
          if (severity === "critical") {
            if (!s.notifications.has(userId)) s.notifications.set(userId, []);
            s.notifications.get(userId).unshift({
              id: uid("ntf"),
              alertId: alert.id,
              signal,
              entityId: x.entityId,
              sigmaAbove: alert.sigmaAbove,
              message: `CRITICAL ${signal} anomaly on ${x.entityId} — ${alert.sigmaAbove}σ above baseline`,
              acknowledged: false,
              createdAt: Date.now(),
            });
          }
        }
      }
      saveState();
      return {
        ok: true,
        result: {
          signal, scanned: samples.length, mean: Number(mean.toFixed(3)),
          stddev: Number(stddev.toFixed(3)), newAlerts: fresh,
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ─── Alert list (this module's per-user alerts) ──────────────────
  registerLensAction("psyops", "alerts_list", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      let list = (s.alerts.get(actorId(ctx)) || []).slice();
      if (params.signal && SIGNALS.includes(String(params.signal))) {
        list = list.filter((a) => a.signal === params.signal);
      }
      if (params.status && STATUSES.includes(String(params.status))) {
        list = list.filter((a) => a.status === params.status);
      }
      if (params.severity) list = list.filter((a) => a.severity === params.severity);
      const counts = { open: 0, assigned: 0, investigating: 0, resolved: 0, dismissed: 0, critical: 0 };
      for (const a of s.alerts.get(actorId(ctx)) || []) {
        if (counts[a.status] !== undefined) counts[a.status] += 1;
        if (a.severity === "critical") counts.critical += 1;
      }
      const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 500);
      return { ok: true, result: { alerts: list.slice(0, limit), counts, total: list.length } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ─── Alert detail + evidence drill-down ──────────────────────────
  registerLensAction("psyops", "alert_detail", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const alertId = String(params.alertId || "");
      const alert = (s.alerts.get(userId) || []).find((a) => a.id === alertId);
      if (!alert) return { ok: false, error: "alert not found" };
      const incident = alert.incidentId
        ? (s.incidents.get(userId) || []).find((i) => i.id === alert.incidentId) || null
        : null;
      // Related alerts: same signal + entity, distinct id.
      const related = (s.alerts.get(userId) || []).filter(
        (a) => a.id !== alert.id && (a.entityId === alert.entityId || a.signal === alert.signal),
      ).slice(0, 10);
      return { ok: true, result: { alert, incident, related } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ─── Alert triage workflow ───────────────────────────────────────
  registerLensAction("psyops", "alert_triage", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const alert = (s.alerts.get(userId) || []).find((a) => a.id === String(params.alertId || ""));
      if (!alert) return { ok: false, error: "alert not found" };
      const action = String(params.action || "");
      if (action === "assign") {
        alert.assignee = String(params.assignee || userId);
        alert.status = "assigned";
      } else if (action === "investigate") {
        alert.status = "investigating";
        if (!alert.assignee) alert.assignee = userId;
      } else if (action === "resolve") {
        alert.status = "resolved";
        alert.resolvedAt = Date.now();
      } else if (action === "dismiss") {
        alert.status = "dismissed";
        alert.resolvedAt = Date.now();
      } else {
        return { ok: false, error: "action must be assign|investigate|resolve|dismiss" };
      }
      const note = String(params.note || "").trim();
      if (note) {
        alert.notes.push({ by: userId, action, text: note, at: Date.now() });
      } else {
        alert.notes.push({ by: userId, action, text: `marked ${alert.status}`, at: Date.now() });
      }
      saveState();
      return { ok: true, result: { alert } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ─── Incident timeline correlation ───────────────────────────────
  registerLensAction("psyops", "incident_create", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const alertIds = Array.isArray(params.alertIds) ? params.alertIds.map(String) : [];
      const userAlerts = s.alerts.get(userId) || [];
      const linked = userAlerts.filter((a) => alertIds.includes(a.id));
      if (linked.length === 0) return { ok: false, error: "no valid alerts to correlate" };
      const incident = {
        id: uid("inc"),
        title,
        summary: String(params.summary || "").trim(),
        status: "active",
        alertIds: linked.map((a) => a.id),
        severity: linked.some((a) => a.severity === "critical")
          ? "critical"
          : linked.some((a) => a.severity === "high") ? "high" : "medium",
        createdBy: userId,
        createdAt: Date.now(),
      };
      for (const a of linked) a.incidentId = incident.id;
      if (!s.incidents.has(userId)) s.incidents.set(userId, []);
      s.incidents.get(userId).unshift(incident);
      saveState();
      return { ok: true, result: { incident } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("psyops", "incident_list", (ctx, _artifact, _params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const incidents = (s.incidents.get(userId) || []).map((inc) => {
        const alerts = (s.alerts.get(userId) || []).filter((a) => inc.alertIds.includes(a.id));
        // Timeline: each linked alert as a chronological event.
        const timeline = alerts
          .map((a) => ({
            id: a.id, label: `${a.signal} · ${a.entityId}`, time: a.detectedAt,
            tone: a.severity === "critical" ? "bad" : a.severity === "high" ? "warn" : "info",
            detail: `${a.sigmaAbove}σ above baseline`,
          }))
          .sort((x, y) => x.time - y.time);
        return { ...inc, alertCount: alerts.length, timeline };
      });
      return { ok: true, result: { incidents } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("psyops", "incident_close", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const incident = (s.incidents.get(userId) || []).find((i) => i.id === String(params.incidentId || ""));
      if (!incident) return { ok: false, error: "incident not found" };
      incident.status = "closed";
      incident.resolution = String(params.resolution || "").trim();
      incident.closedAt = Date.now();
      saveState();
      return { ok: true, result: { incident } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ─── Quarantine + audited release ────────────────────────────────
  registerLensAction("psyops", "quarantine_entity", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const alert = (s.alerts.get(userId) || []).find((a) => a.id === String(params.alertId || ""));
      if (!alert) return { ok: false, error: "alert not found" };
      if (alert.quarantined) return { ok: false, error: "already quarantined" };
      alert.quarantined = true;
      alert.quarantinedAt = Date.now();
      const reason = String(params.reason || "").trim() || "operator action";
      if (!s.quarantineLog.has(userId)) s.quarantineLog.set(userId, []);
      s.quarantineLog.get(userId).unshift({
        id: uid("qlog"), alertId: alert.id, entityId: alert.entityId,
        action: "quarantine", reason, by: userId, at: Date.now(),
      });
      saveState();
      return { ok: true, result: { alert } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("psyops", "quarantine_release", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const alert = (s.alerts.get(userId) || []).find((a) => a.id === String(params.alertId || ""));
      if (!alert) return { ok: false, error: "alert not found" };
      if (!alert.quarantined) return { ok: false, error: "not quarantined" };
      const reason = String(params.reason || "").trim();
      if (!reason) return { ok: false, error: "release reason required (audited)" };
      alert.quarantined = false;
      alert.releasedAt = Date.now();
      if (!s.quarantineLog.has(userId)) s.quarantineLog.set(userId, []);
      s.quarantineLog.get(userId).unshift({
        id: uid("qlog"), alertId: alert.id, entityId: alert.entityId,
        action: "release", reason, by: userId, at: Date.now(),
      });
      saveState();
      return { ok: true, result: { alert } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("psyops", "quarantine_log", (ctx, _artifact, _params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      return { ok: true, result: { log: s.quarantineLog.get(actorId(ctx)) || [] } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ─── Critical-alert notifications ────────────────────────────────
  registerLensAction("psyops", "notifications_list", (ctx, _artifact, _params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const list = s.notifications.get(actorId(ctx)) || [];
      return {
        ok: true,
        result: { notifications: list, unacknowledged: list.filter((n) => !n.acknowledged).length },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  registerLensAction("psyops", "notification_ack", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const list = s.notifications.get(userId) || [];
      const all = params.all === true;
      let acked = 0;
      for (const n of list) {
        if (all || n.id === String(params.notificationId || "")) {
          if (!n.acknowledged) { n.acknowledged = true; n.acknowledgedAt = Date.now(); acked += 1; }
        }
      }
      if (acked === 0 && !all) return { ok: false, error: "notification not found" };
      saveState();
      return { ok: true, result: { acknowledged: acked } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });
}
