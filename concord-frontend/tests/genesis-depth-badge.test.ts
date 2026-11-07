// Source pins for the Genesis tier flip. The behavioural proof is
// server-side (genesis-tier-live.test.js: registry + manifest agree on
// REAL_LIVE from the substrate; genesis-lens exercises the real router
// against the real tables). These pins assert the badge surface's shape:
// the scoped caption the flip requires — REAL_LIVE's generic caption
// claims an external source, which is false for the platform's own
// emergent substrate — and that the Simulated presentation is gone.

import { describe, it } from 'vitest';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, "..", rel), "utf8");

const manifest = read("lib/lenses/manifest.ts");
const badge = read("hooks/useDepthBadge.ts");

describe("Genesis tier flip — declaration", () => {
  it("the manifest entry declares REAL_LIVE", () => {
    const start = manifest.indexOf("domain: 'genesis',");
    assert.notEqual(start, -1);
    const block = manifest.slice(start, start + 1600);
    assert.ok(block.includes("dataTier: 'REAL_LIVE'"));
    assert.ok(!block.includes("dataTier: 'SIM_GRADE_A'"));
  });
});

describe("Genesis tier flip — the badge caption tells the substrate truth", () => {
  it("a scoped override stands for genesis", () => {
    assert.ok(badge.includes("genesis: {"));
    const start = badge.indexOf("genesis: {");
    const block = badge.slice(start, start + 500);
    assert.ok(block.includes("label: 'Live'"));
  });
  it("the caption claims neither a simulation nor an external feed", () => {
    const start = badge.indexOf("genesis: {");
    const block = badge.slice(start, start + 500);
    assert.ok(block.includes("not a simulation and not an external feed"));
    assert.ok(!/polled live from an external source/.test(block));
  });
});
