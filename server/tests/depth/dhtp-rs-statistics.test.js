// server/tests/depth/dhtp-rs-statistics.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mean,
  median,
  stdev,
  confidenceInterval95,
  pairedDifferences,
  buildStatisticalReport,
} from "../../lib/runtime/dhtp-rs-statistics.js";

describe("dhtp-rs-statistics", () => {
  it("computes mean, median, stdev", () => {
    const v = [0.8, 0.9, 0.7, 0.85];
    assert.ok(Math.abs(mean(v) - 0.8125) < 0.001);
    assert.equal(median(v), 0.825);
    assert.ok(stdev(v) > 0);
  });

  it("computes 95% CI", () => {
    const ci = confidenceInterval95([0.9, 0.88, 0.92, 0.91, 0.89]);
    assert.ok(ci.low < ci.mean);
    assert.ok(ci.high > ci.mean);
    assert.equal(ci.n, 5);
  });

  it("computes paired differences on matching trial keys", () => {
    const runsByCondition = {
      dhtp_packet: [
        { ok: true, probeId: "fleet_health", trialIndex: 0, evaluation: { composite: 0.9 } },
        { ok: true, probeId: "fleet_health", trialIndex: 1, evaluation: { composite: 0.85 } },
      ],
      matched_budget_raw: [
        { ok: true, probeId: "fleet_health", trialIndex: 0, evaluation: { composite: 0.8 } },
        { ok: true, probeId: "fleet_health", trialIndex: 1, evaluation: { composite: 0.82 } },
      ],
    };
    const paired = pairedDifferences(runsByCondition, "dhtp_packet", "matched_budget_raw");
    assert.equal(paired.n, 2);
    assert.ok(paired.meanDelta > 0);
  });

  it("builds full statistical report", () => {
    const report = buildStatisticalReport({
      conditions: ["dhtp_packet", "matched_budget_raw"],
      runsByCondition: {
        dhtp_packet: [{ ok: true, live: { ok: true }, evaluation: { composite: 0.9 } }],
        matched_budget_raw: [{ ok: true, live: { ok: true }, evaluation: { composite: 0.8 } }],
      },
    });
    assert.ok(report.byCondition.dhtp_packet);
    assert.ok(report.paired.dhtp_packet_minus_matched_budget_raw);
  });
});
