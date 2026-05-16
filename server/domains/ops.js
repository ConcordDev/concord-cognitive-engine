// server/domains/ops.js
// Domain actions for the ops lens — PagerDuty shape. 4 macros over
// on-call schedule, escalation, runbook lookup, and post-mortem.

export default function registerOpsActions(registerLensAction) {
  /**
   * pageOnCall — return the current on-call person for a rotation.
   *   artifact.data.rotation = [{ user, startHour, endHour }] (24h cycle)
   *   params.now (ISO, default now)
   */
  registerLensAction("ops", "pageOnCall", (_ctx, artifact, params = {}) => {
    const rotation = artifact.data?.rotation || [];
    if (rotation.length === 0) return { ok: true, result: { message: "No rotation defined.", current: null } };
    const now = params.now ? new Date(params.now) : new Date();
    const hour = now.getUTCHours();
    const slot = rotation.find((r) => {
      const sh = parseInt(r.startHour, 10);
      const eh = parseInt(r.endHour, 10);
      if (sh <= eh) return hour >= sh && hour < eh;
      return hour >= sh || hour < eh;
    }) || rotation[0];
    return {
      ok: true,
      result: { atUtc: now.toISOString(), currentUtcHour: hour, current: slot.user, slot, rotationSize: rotation.length },
    };
  });

  /**
   * runbookLookup — find runbook entries matching an alert signature.
   *   artifact.data.runbooks = [{ alertPattern, steps: [string], owner }]
   *   params.alert (string)
   */
  registerLensAction("ops", "runbookLookup", (_ctx, artifact, params = {}) => {
    const runbooks = artifact.data?.runbooks || [];
    const alert = (params.alert || "").toLowerCase();
    if (!alert) return { ok: false, reason: "alert required" };
    const matches = runbooks.filter((r) => alert.includes(String(r.alertPattern || "").toLowerCase()));
    if (matches.length === 0) return { ok: true, result: { matches: 0, suggestion: "no runbook — log + escalate" } };
    return {
      ok: true,
      result: {
        matches: matches.length,
        topMatch: matches[0],
        allMatches: matches.map((m) => ({ alertPattern: m.alertPattern, owner: m.owner, stepCount: (m.steps || []).length })),
      },
    };
  });

  /**
   * postmortemDraft — generate a 5-section post-mortem skeleton.
   *   params.title, params.incidentId, params.severity, params.startedAt, params.resolvedAt, params.affected
   */
  registerLensAction("ops", "postmortemDraft", (_ctx, _artifact, params = {}) => {
    const title = params.title || "Incident post-mortem";
    const incidentId = params.incidentId || `inc-${Date.now()}`;
    const startedAt = params.startedAt || new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const resolvedAt = params.resolvedAt || new Date().toISOString();
    const durationMin = Math.round((new Date(resolvedAt).getTime() - new Date(startedAt).getTime()) / 60000);
    return {
      ok: true,
      result: {
        title, incidentId,
        severity: params.severity || "sev3",
        affected: params.affected || "unspecified",
        startedAt, resolvedAt, durationMin,
        sections: [
          { name: "summary", placeholder: "1-2 sentence summary of what happened, when, who was paged, scope of impact." },
          { name: "timeline", placeholder: "UTC timestamps of: detect → page → mitigate → resolve. Include the human pager + their action at each step." },
          { name: "impact", placeholder: "Quantify user impact (requests dropped, $ revenue, customers affected). State explicit zero if nothing." },
          { name: "root_cause", placeholder: "5-whys; root cause + contributing factors. Don't conflate triggering event with cause." },
          { name: "action_items", placeholder: "Owners + due dates. Prefer 1-2 high-leverage AIs over 10 small ones. Each AI must prevent THIS class of incident, not a one-off." },
        ],
      },
    };
  });

  /**
   * escalationCheck — check if an incident has breached escalation thresholds.
   *   params.severity, params.minutesOpen
   */
  registerLensAction("ops", "escalationCheck", (_ctx, _artifact, params = {}) => {
    const sev = params.severity || "sev3";
    const minutesOpen = parseFloat(params.minutesOpen) || 0;
    const thresholds = { sev1: 5, sev2: 15, sev3: 60, sev4: 240 };
    const threshold = thresholds[sev] ?? 60;
    const breached = minutesOpen >= threshold;
    return {
      ok: true,
      result: {
        severity: sev,
        minutesOpen,
        thresholdMinutes: threshold,
        breached,
        recommendation: breached
          ? `Escalate now — ${sev} has been open ${minutesOpen}m (threshold ${threshold}m). Page the engineering lead.`
          : `Within window (${minutesOpen}m of ${threshold}m). Continue triage; re-check in ${Math.max(1, Math.round((threshold - minutesOpen) / 2))}m.`,
      },
    };
  });
}
