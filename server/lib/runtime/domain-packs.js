// server/lib/runtime/domain-packs.js
//
// P4 — Domain packs: bundled mission templates + spawn policies for
// autonomous runtime operation.

import { expandTemplate } from "../mission-templates.js";

export const DOMAIN_PACKS = Object.freeze({
  fleet_ops: {
    id: "fleet_ops",
    title: "Fleet Operations",
    description: "Health verification, sentinel sweep, economic safety checks.",
    templates: ["fleet_health", "watch_detect", "experience_consolidate"],
    spawnPolicy: { periodicFleet: true, onSentinelWarn: true },
    defaultPlanner: "template",
  },
  research_loop: {
    id: "research_loop",
    title: "Research Loop",
    description: "Proactive predictions → research filter → opportunity pipeline.",
    templates: ["proactive_research", "opportunity_pipeline"],
    spawnPolicy: { onProactivePrediction: true },
    defaultPlanner: "dynamic",
  },
  security_watch: {
    id: "security_watch",
    title: "Security Watch",
    description: "Incident detection, trace correlation, initiative monitoring.",
    templates: ["watch_detect", "initiative_monitor"],
    spawnPolicy: { onSentinelWarn: true, onInitiativeSubmitted: true },
    defaultPlanner: "template",
  },
  coding_audit: {
    id: "coding_audit",
    title: "Coding Audit",
    description: "Repo graph index + symbol dependency scan + fleet verify.",
    templates: ["coding_audit", "coding_loop_closed", "fleet_health"],
    spawnPolicy: { onCodingSignal: true, operatorOnly: false },
    defaultPlanner: "deterministic",
  },
  pce_excellence: {
    id: "pce_excellence",
    title: "PCE Empirical Excellence",
    description: "ConcordBench against real tree + failure→pattern learning loop.",
    templates: ["pce_excellence_cycle", "coding_loop_closed", "swe_harness"],
    spawnPolicy: { onBenchRegression: true, periodicExcellence: true },
    defaultPlanner: "deterministic",
  },
  incident_ops: {
    id: "incident_ops",
    title: "Incident Operations",
    description: "Incident detect → classify → trace → record.",
    templates: ["incident_response", "watch_detect"],
    spawnPolicy: { onIncidentOpen: true },
    defaultPlanner: "template",
  },
  opportunity_ops: {
    id: "opportunity_ops",
    title: "Opportunity Pipeline",
    description: "Scan and triage opportunity signals.",
    templates: ["opportunity_pipeline"],
    spawnPolicy: { onOpportunityOpen: true },
    defaultPlanner: "dynamic",
  },
});

export function getDomainPack(packId) {
  return DOMAIN_PACKS[packId] || null;
}

export function listDomainPacks() {
  return Object.values(DOMAIN_PACKS);
}

/**
 * Expand a domain pack into a mission plan (first template in pack by default).
 */
export function expandDomainPack(packId, opts = {}) {
  const pack = getDomainPack(packId);
  if (!pack) return { ok: false, reason: "unknown_pack" };
  const templateName = opts.template || pack.templates[0];
  const expanded = expandTemplate(templateName, opts.spawnContext || {});
  if (!expanded) return { ok: false, reason: "template_expand_failed", template: templateName };
  return {
    ok: true,
    domainPack: packId,
    template: templateName,
    title: opts.title || `${pack.title}: ${expanded.title}`,
    goal: opts.goal || expanded.goal,
    steps: expanded.steps,
    planner: pack.defaultPlanner,
  };
}

export function pickPackForSignal(signal) {
  const type = typeof signal === "string" ? signal : signal?.type;
  const level = typeof signal === "object" ? signal?.level : null;
  if (type === "incident" || type === "incident_response") return "incident_ops";
  if (type === "opportunity") return "opportunity_ops";
  if (type === "sentinel" && (level === "warn" || level === "critical")) return "security_watch";
  if (type === "proactive" || type === "predict") return "research_loop";
  if (type === "initiative") return "security_watch";
  if (type === "coding" || type === "coding_loop") return "coding_audit";
  if (type === "periodic" || type === "scheduled") return "fleet_ops";
  return "fleet_ops";
}
