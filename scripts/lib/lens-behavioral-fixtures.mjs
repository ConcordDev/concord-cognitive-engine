// Minimal deterministic fixtures for Class-B lens behavioral verification.
// Merged with harness FIXTURES — domain.action keys only where {} is insufficient.

import { buildDefaultInput, FIXTURES } from "../contracts/harness.mjs";

/** @type {Record<string, object>} */
export const LENS_BEHAVIORAL_FIXTURES = {
  "hlr.trace": { traceId: "hlr_trace_does_not_exist_zzz" },
  "sentinel.triage.open": {
    artifact: { data: {} },
    threatId: "fixture-threat-1",
    title: "Behavioral fixture threat",
    severity: "medium",
  },
  "sentinel.monitor.create": {
    artifact: { data: {} },
    name: "fixture-monitor",
    severityThreshold: "high",
    intervalMinutes: 60,
  },
  "sentinel.scan.rule.add": {
    artifact: { data: {} },
    pattern: "fixture-rule",
    severity: "low",
  },
  "sentinel.query.export": {
    artifact: { data: {} },
    results: [{ id: "r1", score: 0.9, label: "fixture" }],
    query: "fixture query",
    format: "json",
  },
  "shield.scan": {
    artifact: { data: {} },
    target: "127.0.0.1",
    depth: "quick",
  },
  "shield.report": {
    artifact: { data: {} },
    threatId: "fixture-threat-1",
    format: "summary",
  },
  "chem.balanceReaction": {
    artifact: { data: {} },
    equation: "H2 + O2 -> H2O",
  },
  "math.symbolicCompute": {
    artifact: { data: {} },
    expression: "x+0",
    operation: "simplify",
  },
};

export function buildLensBehavioralInput(domain, action) {
  const key = `${domain}.${action}`;
  if (LENS_BEHAVIORAL_FIXTURES[key]) {
    return { ...LENS_BEHAVIORAL_FIXTURES[key] };
  }
  return buildDefaultInput(domain, action);
}

export function listDocumentedFixtures() {
  return {
    harness: Object.keys(FIXTURES),
    lens: Object.keys(LENS_BEHAVIORAL_FIXTURES),
  };
}
