// server/domains/observe.js
// Domain actions for the observe lens — Datadog Security / observability
// shape. 4 macros over service/incident/alert/SLO concepts.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerObserveActions(registerLensAction) {
  /**
   * serviceLog — summarise a service's recent log entries.
   *   artifact.data.entries = [{ ts, level, message, service }]
   *   params.windowMinutes (default 60)
   */
  registerLensAction("observe", "serviceLog", (_ctx, artifact, params = {}) => {
    const entries = artifact.data?.entries || [];
    if (entries.length === 0) return { ok: true, result: { message: "No log entries.", count: 0 } };
    const win = parseInt(params.windowMinutes, 10) || 60;
    const cutoff = Date.now() - win * 60 * 1000;
    const recent = entries.filter((e) => new Date(e.ts || 0).getTime() >= cutoff);
    const byLevel = {};
    for (const e of recent) {
      const lvl = (e.level || "info").toUpperCase();
      byLevel[lvl] = (byLevel[lvl] || 0) + 1;
    }
    const errorRate = recent.length > 0 ? Math.round(((byLevel.ERROR || 0) / recent.length) * 10000) / 100 : 0;
    const topService = (() => {
      const c = {};
      for (const e of recent) { const s = e.service || "unknown"; c[s] = (c[s] || 0) + 1; }
      return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
    })();
    return { ok: true, result: { windowMinutes: win, count: recent.length, byLevel, errorRate, topService } };
  });

  /**
   * incidentTrack — open an incident artifact entry.
   *   params.title, params.severity (sev1..sev4), params.affectedService
   */
  registerLensAction("observe", "incidentTrack", (_ctx, artifact, params = {}) => {
    const incidents = artifact.data?.incidents || [];
    const sev = ["sev1", "sev2", "sev3", "sev4"].includes(params.severity) ? params.severity : "sev3";
    const incident = {
      id: `inc-${Date.now()}`,
      title: params.title || "Untitled incident",
      severity: sev,
      affectedService: params.affectedService || "unknown",
      status: "open",
      openedAt: new Date().toISOString(),
      timeline: [{ at: new Date().toISOString(), event: "opened" }],
    };
    incidents.push(incident);
    artifact.data = { ...artifact.data, incidents };
    return { ok: true, result: { incident, total: incidents.length } };
  });

  /**
   * alertSummary — group alerts by service + severity.
   *   artifact.data.alerts = [{ severity, service, fired_at, resolved_at? }]
   */
  registerLensAction("observe", "alertSummary", (_ctx, artifact, _params) => {
    const alerts = artifact.data?.alerts || [];
    if (alerts.length === 0) return { ok: true, result: { message: "No alerts in window.", total: 0 } };
    const now = Date.now();
    const firing = alerts.filter((a) => !a.resolved_at);
    const resolved = alerts.filter((a) => a.resolved_at);
    const meanResolveMin = resolved.length > 0
      ? Math.round(resolved.reduce((s, a) => s + (new Date(a.resolved_at).getTime() - new Date(a.fired_at).getTime()) / 60000, 0) / resolved.length)
      : null;
    const byService = {};
    for (const a of alerts) {
      const s = a.service || "unknown";
      if (!byService[s]) byService[s] = { firing: 0, resolved: 0 };
      if (a.resolved_at) byService[s].resolved++; else byService[s].firing++;
    }
    return {
      ok: true,
      result: { total: alerts.length, firingNow: firing.length, resolved: resolved.length, meanResolveMin, byService, generatedAt: new Date(now).toISOString() },
    };
  });

  /**
   * sloCheck — check an SLO target against recent uptime.
   *   params.targetPct (e.g. 99.9), params.actualPct, params.windowDays
   */
  registerLensAction("observe", "sloCheck", (_ctx, _artifact, params = {}) => {
    const target = parseFloat(params.targetPct) || 99.9;
    const actual = parseFloat(params.actualPct);
    if (!Number.isFinite(actual)) return { ok: false, reason: "actualPct required" };
    const windowDays = parseInt(params.windowDays, 10) || 30;
    const errorBudgetPct = (100 - target);
    const burnRate = (100 - actual) / errorBudgetPct;
    const status = actual >= target ? "healthy" : burnRate > 2 ? "critical" : burnRate > 1 ? "burning" : "watch";
    return {
      ok: true,
      result: {
        targetPct: target, actualPct: actual, windowDays,
        errorBudgetPct: Math.round(errorBudgetPct * 1000) / 1000,
        burnRate: Math.round(burnRate * 100) / 100,
        status,
        remainingBudgetMinutes: Math.max(0, Math.round((target - (100 - actual)) / 100 * windowDays * 24 * 60)),
      },
    };
  });

  // Persistent monitored-entity substrate (services, alerts, SLOs).
  registerLensSubstrate(registerLensAction, "observe", {
    noun: "monitor", idPrefix: "mon",
    kinds: ["service", "alert", "slo", "dashboard"],
    statuses: ["healthy", "watch", "burning", "critical"],
  });
}
