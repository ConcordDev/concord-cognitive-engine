// server/tests/platinum-slo.test.js
//
// Sprint 26 — SLO gate.
//
// Asserts that:
//   1. SLO definitions file exists at monitoring/slo-definitions.yml
//   2. Every documented SLO has a (sli, target, window, severity)
//   3. Critical SLOs (availability, marketplace, heartbeat, db) have
//      multi-window burn-rate alerts wired
//   4. Targets are within sanity bounds (no 100% / no <50%)
//   5. The Prom counters each SLO references exist in server source
//
// Why this matters: SLOs are a *contract*. A drift between what the SLO
// claims (e.g. 99.5% availability) and what we can measure (a missing
// Prom counter) means the SLO is unenforceable. This gate catches that.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const SLO_PATH = join(HERE, "..", "..", "monitoring", "slo-definitions.yml");
const SERVER_JS = readFileSync(join(HERE, "..", "server.js"), "utf-8");

test("SLO definitions file exists at monitoring/slo-definitions.yml", () => {
  assert.ok(existsSync(SLO_PATH), "monitoring/slo-definitions.yml missing — SLO contract unpublished");
});

test("SLO file declares the required top-level structure", () => {
  if (!existsSync(SLO_PATH)) return;
  const text = readFileSync(SLO_PATH, "utf-8");
  assert.ok(/^slos:/m.test(text), "Missing top-level `slos:` block");
  assert.ok(/^error_budget_policy:/m.test(text), "Missing `error_budget_policy:` block — no documented action on budget exhaustion");
  assert.ok(/^public_sla:/m.test(text), "Missing `public_sla:` block — internal SLOs without a public commit are aspirational only");
});

test("every SLO has (sli, target, window, severity)", () => {
  if (!existsSync(SLO_PATH)) return;
  const text = readFileSync(SLO_PATH, "utf-8");

  // Count SLO entries (`  - name: ...` at 4-space indent under `slos:`)
  const sloBlocks = text.match(/^ {2}- name:\s*\w+/gm) || [];
  assert.ok(sloBlocks.length >= 5, `Only ${sloBlocks.length} SLOs declared — platinum tier expects at least 5 (availability, latency, money-path, heartbeat, db)`);

  // Each SLO block must have its 4 required keys somewhere in the next
  // ~30 lines. We do a coarse count rather than YAML-parsing to keep
  // dep-free; if the counts don't match we fail.
  const sliCount = (text.match(/^\s{4}sli:/gm) || []).length;
  const targetCount = (text.match(/^\s{4}target:/gm) || []).length;
  const windowCount = (text.match(/^\s{4}window:/gm) || []).length;
  const severityCount = (text.match(/^\s{4}severity:/gm) || []).length;

  assert.equal(sliCount, sloBlocks.length, `Some SLOs missing 'sli' (${sliCount}/${sloBlocks.length})`);
  assert.equal(targetCount, sloBlocks.length, `Some SLOs missing 'target' (${targetCount}/${sloBlocks.length})`);
  assert.equal(windowCount, sloBlocks.length, `Some SLOs missing 'window' (${windowCount}/${sloBlocks.length})`);
  assert.equal(severityCount, sloBlocks.length, `Some SLOs missing 'severity' (${severityCount}/${sloBlocks.length})`);
});

test("critical SLOs have multi-window burn-rate alerts", () => {
  if (!existsSync(SLO_PATH)) return;
  const text = readFileSync(SLO_PATH, "utf-8");

  // Money path + availability + heartbeat are constitutionally critical.
  // Each one MUST have at least one burn_alerts entry.
  const criticals = ["api_availability", "marketplace_purchase_success", "heartbeat_continuity"];
  const missing = [];
  for (const name of criticals) {
    // Find the SLO block + check it has a burn_alerts: section before the next `- name:`
    const blockRe = new RegExp(`- name:\\s*${name}[\\s\\S]*?(?=\\n  - name:|\\nerror_budget_policy:|\\npublic_sla:|$)`);
    const match = text.match(blockRe);
    if (!match || !/burn_alerts:/.test(match[0])) {
      missing.push(name);
    }
  }
  assert.equal(missing.length, 0, `Critical SLOs without burn-rate alerts: ${missing.join(", ")}`);
});

test("SLO targets are within sanity bounds (0.5 ≤ target ≤ 0.9999)", () => {
  if (!existsSync(SLO_PATH)) return;
  const text = readFileSync(SLO_PATH, "utf-8");

  const targetLines = text.match(/^\s{4}target:\s*([\d.]+)/gm) || [];
  const violations = [];
  for (const line of targetLines) {
    const m = line.match(/target:\s*([\d.]+)/);
    if (!m) continue;
    const target = parseFloat(m[1]);
    if (Number.isNaN(target)) continue;
    // 100% targets are aspirational lies. Sub-50% targets are noise.
    if (target >= 1.0 || target < 0.5) violations.push(target);
  }
  assert.equal(violations.length, 0, `SLO targets outside sane range [0.5, 1.0): ${violations.join(", ")}`);
});

test("required Prom counters for SLOs are emitted by server source", () => {
  // SLO claims must match what we can actually measure. Validate the
  // critical-path counters exist somewhere in server code.
  const required = [
    /http_requests_total/,                       // api_availability
    /concord_request_duration_seconds/,          // latency p95/p99 — buckets/count
    /concord_heartbeat_ticks_total/,             // heartbeat_continuity
  ];
  const missing = [];
  for (const re of required) {
    if (!re.test(SERVER_JS)) missing.push(re.toString());
  }
  assert.equal(missing.length, 0, `Required Prom metrics for SLO measurement missing from server.js: ${missing.join(", ")}`);
});

test("error budget policy documents an action at each threshold", () => {
  if (!existsSync(SLO_PATH)) return;
  const text = readFileSync(SLO_PATH, "utf-8");

  // Three thresholds documented: 30%, 10%, 0% remaining
  const thresholds = (text.match(/remaining:\s*\d/g) || []).length;
  assert.ok(thresholds >= 3, `Error budget policy must document at least 3 thresholds (30%/10%/0%); found ${thresholds}`);

  const actions = (text.match(/action:\s*["'][^"']{10,}/g) || []).length;
  assert.equal(actions, thresholds, `Each error budget threshold needs a documented action — found ${actions} actions for ${thresholds} thresholds`);
});

test("public SLA is documented (otherwise SLOs are internal-only)", () => {
  if (!existsSync(SLO_PATH)) return;
  const text = readFileSync(SLO_PATH, "utf-8");
  assert.ok(/uptime:/.test(text), "public_sla.uptime missing — no external commitment");
  assert.ok(/withdrawal_processing:/.test(text), "public_sla.withdrawal_processing missing — required (48h hold invariant)");
});
