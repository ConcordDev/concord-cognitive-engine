/**
 * Tier-2 contract test for the Phase 2 IntegrationRegistry.
 *
 * Honesty contract:
 *   - every DEMO lens declares paywallReason
 *   - no DEMO lens claims a real-API `sources` list
 *   - every REAL_FREE lens declares at least one source
 *   - tier values are confined to the 4-way enum
 *   - lookups are alias-tolerant (foo-bar ⇄ foo_bar)
 *
 * Run: node --test server/tests/integration-registry.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  REGISTRY, TIER, getIntegration, getTier, coverageSummary,
} from "../lib/integration-registry.js";

describe("IntegrationRegistry — shape", () => {
  it("TIER is a 4-way enum", () => {
    assert.deepEqual(Object.keys(TIER).sort(), ["DEMO", "REAL_FREE", "REAL_LIVE", "SIM_GRADE_A"]);
  });

  it("every registry entry has a valid tier", () => {
    const valid = new Set(Object.values(TIER));
    for (const [key, entry] of Object.entries(REGISTRY)) {
      assert.ok(valid.has(entry.tier), `${key}: tier '${entry.tier}' not in enum`);
    }
  });
});

describe("IntegrationRegistry — honesty contract", () => {
  it("every DEMO lens declares a paywallReason", () => {
    for (const [key, entry] of Object.entries(REGISTRY)) {
      if (entry.tier === TIER.DEMO) {
        assert.ok(
          typeof entry.paywallReason === "string" && entry.paywallReason.length > 0,
          `DEMO lens '${key}' missing paywallReason — would silently hide the gap from users`,
        );
      }
    }
  });

  it("no DEMO lens claims a real-API source", () => {
    for (const [key, entry] of Object.entries(REGISTRY)) {
      if (entry.tier === TIER.DEMO && Array.isArray(entry.sources)) {
        assert.equal(entry.sources.length, 0, `DEMO lens '${key}' must not list sources`);
      }
    }
  });

  it("every REAL_FREE lens declares >=1 source", () => {
    for (const [key, entry] of Object.entries(REGISTRY)) {
      if (entry.tier === TIER.REAL_FREE) {
        assert.ok(Array.isArray(entry.sources) && entry.sources.length > 0,
          `REAL_FREE lens '${key}' must declare at least one source`);
      }
    }
  });

  it("REAL_LIVE entries either declare sources OR liveFromSubstrate=true", () => {
    for (const [key, entry] of Object.entries(REGISTRY)) {
      if (entry.tier === TIER.REAL_LIVE) {
        const hasSources = Array.isArray(entry.sources) && entry.sources.length > 0;
        const fromSubstrate = entry.liveFromSubstrate === true;
        assert.ok(hasSources || fromSubstrate,
          `REAL_LIVE lens '${key}' must declare either sources[] or liveFromSubstrate=true`);
      }
    }
  });
});

describe("IntegrationRegistry — lookups", () => {
  it("getIntegration handles direct ids", () => {
    const r = getIntegration("pharmacy");
    assert.ok(r);
    assert.equal(r.tier, TIER.REAL_FREE);
  });

  it("getIntegration is alias-tolerant (kebab ⇄ snake)", () => {
    const a = getIntegration("ux-suite");
    const b = getIntegration("ux_suite");
    assert.ok(a);
    assert.ok(b);
    assert.equal(a.tier, b.tier);
  });

  it("getTier convenience returns just the tier", () => {
    assert.equal(getTier("chat"), TIER.REAL_LIVE);
    assert.equal(getTier("astronomy"), TIER.REAL_FREE);
    assert.equal(getTier("legal"), TIER.DEMO);
    assert.equal(getTier("nonsense-no-such-lens"), null);
  });
});

describe("IntegrationRegistry — coverage", () => {
  it("coverageSummary returns the count breakdown", () => {
    const s = coverageSummary();
    assert.equal(typeof s.total, "number");
    assert.ok(s.total > 200, `expected >200 lens entries, got ${s.total}`);
    assert.equal(
      (s.REAL_LIVE || 0) + (s.REAL_FREE || 0) + (s.SIM_GRADE_A || 0) + (s.DEMO || 0),
      s.total,
    );
  });

  it("DEMO count is small — the platform is mostly real or simulated, not demoware", () => {
    const s = coverageSummary();
    const demoRatio = (s.DEMO || 0) / s.total;
    assert.ok(demoRatio < 0.10, `DEMO ratio ${(demoRatio * 100).toFixed(1)}% too high; check registry`);
  });
});
