// Resonance build — FE source pins (node:test; the sandbox has no FE
// toolchain, so these pin the wiring in source).
import { test } from 'vitest';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const page = read("app/lenses/resonance/page.tsx");
const pairsPanel = read("components/resonance/PairsPanel.tsx");
const ui = read("components/resonance/resonance-ui.tsx");
const workbench = read("components/resonance/CrossDomainWorkbench.tsx");

test("S-RES-1: auto-scan drives the recording scan mutation on its interval", () => {
  assert.ok(page.includes("setInterval(() => scanMutation.mutate(), 15000)"));
  assert.ok(page.includes("if (!autoScan) return;"));
});

test("S-RES-2: the Pairs panel pages the full set and shows the distribution", () => {
  assert.ok(pairsPanel.includes("pairsOffset: offset"));
  assert.ok(pairsPanel.includes("pairsPage"));
  assert.ok(pairsPanel.includes("scoreDistribution"));
  assert.ok(pairsPanel.includes("of {pairsFound}"));
  assert.ok(ui.includes("Members:"), "pair cards surface member DTU ids");
});

test("S-RES-7: the dead Analysis chrome is retired from the lens surface", () => {
  assert.ok(!page.includes("ActionsPanel"));
  assert.ok(!page.includes("label: 'Analysis'"));
});

test("S-RES-4/5: Workbench pairs carry edit/delete, alerts clear in two steps", () => {
  assert.ok(workbench.includes("'updatePair'"));
  assert.ok(workbench.includes("'deletePair'"));
  assert.ok(workbench.includes("Delete this pair?"));
  assert.ok(workbench.includes("Pair deleted"));
  assert.ok(workbench.includes("Clear acknowledged alerts?"));
  assert.ok(workbench.includes("Cleared ${cleared} acknowledged"));
});

test("S-RES-8: graph nodes are selectable with a detail readout", () => {
  assert.ok(workbench.includes("setSelectedNode"));
  assert.ok(workbench.includes("mean resonance"));
});
