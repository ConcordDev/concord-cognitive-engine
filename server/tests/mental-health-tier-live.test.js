// Tier + declaration tests for the mental-health lens build (S-MH-4).
//
// The declaration of record after the build: the lens's tracked
// substrate (mood / sleep / practice / gratitude, per-user STATE) is
// REAL_LIVE with liveFromSubstrate, and NIH MedlinePlus remains the
// declared source for the reference side (crisis/resource content),
// scoped to the resource browser — the scoping R3's first pass
// determined (F1: the old REAL_FREE/"Real" declaration mis-scoped the
// live substrate as static). Both registry keys (mental_health and
// mental-health) must agree; the manifest tier must match.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REGISTRY, TIER } from "../lib/integration-registry.js";
import registerMentalhealthActions from "../domains/mentalhealth.js";

const manifestSrc = readFileSync(
  new URL("../../concord-frontend/lib/lenses/manifest.ts", import.meta.url),
  "utf8",
);

describe("mental-health — declaration (S-MH-4)", () => {
  it("both registry keys declare REAL_LIVE from the user's own substrate", () => {
    for (const key of ["mental_health", "mental-health"]) {
      const entry = REGISTRY[key];
      assert.ok(entry, `registry entry '${key}' missing`);
      assert.equal(entry.tier, TIER.REAL_LIVE, `${key} tier`);
      assert.equal(entry.liveFromSubstrate, true, `${key} liveFromSubstrate`);
    }
  });

  it("MedlinePlus stays declared as the reference-side source on both keys", () => {
    for (const key of ["mental_health", "mental-health"]) {
      assert.ok(
        Array.isArray(REGISTRY[key].sources) && REGISTRY[key].sources.includes("nih.medlineplus"),
        `${key} must keep nih.medlineplus declared`,
      );
      assert.match(REGISTRY[key].note, /substrate/i, `${key} note must scope the substrate half`);
      assert.match(REGISTRY[key].note, /MedlinePlus/i, `${key} note must scope the reference half`);
    }
  });

  it("manifest dataTier for mental-health is REAL_LIVE", () => {
    const i = manifestSrc.indexOf("domain: 'mental-health'");
    assert.ok(i >= 0, "manifest entry present");
    const block = manifestSrc.slice(i, i + 1400);
    assert.match(block, /dataTier: 'REAL_LIVE'/);
    assert.doesNotMatch(block, /dataTier: 'REAL_FREE'/);
  });

  it("the substrate the declaration claims is actually registered", () => {
    const actions = new Map();
    registerMentalhealthActions((domain, name, fn) => {
      assert.equal(domain, "mental-health");
      actions.set(name, fn);
    });
    for (const name of [
      "mood-log", "mood-insights", "sleep-log", "session-log",
      "breathing-log", "gratitude-add", "wellness-dashboard",
      "wellness-score-tracked", "crisis-hotlines",
    ]) {
      assert.equal(typeof actions.get(name), "function", `missing mental-health.${name}`);
    }
  });
});
