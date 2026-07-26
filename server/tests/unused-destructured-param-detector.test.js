/**
 * Bidirectional pinning tests for UnusedDestructuredParamDetector.
 *
 * Seeded from a real bug (fixed during conductor verification):
 *   function analyticISI({ tau_m, V_rest, V_reset, V_th, R, refractory }, I) {
 *     const drive = R * I;
 *     const gap = V_th - V_rest;
 *     return tau_m * Math.log(drive / (drive - gap));   // <- V_reset, refractory dropped
 *   }
 * (`server/lib/simulation/spiking-network.js`.) The function destructured a
 * full neuron-params object — reads as general/complete — but silently
 * dropped `V_reset` and `refractory` from the computation, so a caller with
 * a distinct reset potential or nonzero refractory period got a confidently
 * wrong ISI with no warning. The live file is now fixed, so the fixtures
 * below are a synthetic reproduction of the same shape, not the real file.
 *
 * Run: cd server && node --test tests/unused-destructured-param-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runUnusedDestructuredParamDetector } from "../lib/detectors/unused-destructured-param-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `unused-param-test-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

const REPORT_SHAPE = ["id", "ok", "summary", "findings", "durationMs"];
function assertReportShape(r) {
  assert.ok(typeof r === "object" && r !== null);
  for (const k of REPORT_SHAPE) assert.ok(k in r, `missing key: ${k}`);
  assert.equal(typeof r.ok, "boolean");
  assert.ok(Array.isArray(r.findings));
}
function realFindings(r) {
  return r.findings.filter((f) => f.severity !== "info");
}

// The exact historical bug shape, reproduced synthetically (the real file is
// fixed): a full neuron-params object destructured, but two of the six bound
// names (V_reset, refractory) never appear in the computation.
const BUGGY_ISI = `// synthetic reproduction of the pre-fix analyticISI bug
export function analyticISI({ tau_m, V_rest, V_reset, V_th, R, refractory }, I) {
  const drive = R * I;
  const gap = V_th - V_rest;
  return tau_m * Math.log(drive / (drive - gap));
}
`;

// The house fix: every destructured name is used in the corrected formula.
const FIXED_ISI = `// synthetic reproduction of the post-fix analyticISI
export function analyticISI({ tau_m, V_rest, V_reset = V_rest, V_th, R, refractory = 0 }, I) {
  const drive = R * I;
  const gap = V_th - V_rest;
  const fromReset = drive - (V_reset - V_rest);
  return tau_m * Math.log(fromReset / (drive - gap)) + refractory;
}
`;

const CLEAN_FILE = `export function add(a, b) {
  return a + b;
}
`;

describe("UnusedDestructuredParamDetector — positive: reproduces the analyticISI bug shape", () => {
  it("flags V_reset and V_reset+refractory as unused_destructured_param (medium)", async () => {
    const dir = withFixture({ "server/lib/simulation/synthetic-spiking.js": BUGGY_ISI });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(r.ok, true);
      const findings = realFindings(r);
      const params = findings.map((f) => f.evidence.param).sort();
      assert.deepEqual(params, ["V_reset", "refractory"]);
      for (const f of findings) {
        assert.equal(f.id, "unused_destructured_param");
        assert.equal(f.severity, "medium");
        assert.match(f.location, /synthetic-spiking\.js/);
        assert.equal(f.evidence.function, "analyticISI");
      }
    } finally { teardown(dir); }
  });

  it("flags an arrow function assigned to a const the same way", async () => {
    const dir = withFixture({
      "server/lib/foo.js": `export const scale = ({ base, factor, unused }) => {
  return base * factor;
};
`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      const findings = realFindings(r);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].evidence.param, "unused");
      assert.equal(findings[0].evidence.function, "scale");
    } finally { teardown(dir); }
  });
});

describe("UnusedDestructuredParamDetector — negative: the corrected version is quiet", () => {
  it("does NOT flag the fixed analyticISI (every bound name used)", async () => {
    const dir = withFixture({ "server/lib/simulation/synthetic-spiking-fixed.js": FIXED_ISI });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(r.ok, true);
      assert.equal(realFindings(r).length, 0, `expected zero findings, got: ${JSON.stringify(realFindings(r))}`);
    } finally { teardown(dir); }
  });

  it("returns zero findings on a clean tree with no destructured params at all", async () => {
    const dir = withFixture({ "server/lib/plain.js": CLEAN_FILE });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.id, "unused-destructured-param");
      assert.equal(realFindings(r).length, 0);
    } finally { teardown(dir); }
  });
});

describe("UnusedDestructuredParamDetector — anti-noise: superficially similar but correct shapes", () => {
  it("does NOT flag a rest/spread sibling even though it's never referenced by name", async () => {
    const dir = withFixture({
      "server/lib/rest.js": `export function summarize({ total, ...meta }) {
  return total;
}
`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "a ...rest sibling must never be required to be independently used");
    } finally { teardown(dir); }
  });

  it("does NOT flag a name prefixed with underscore (the documented opt-out convention)", async () => {
    const dir = withFixture({
      "server/lib/underscore.js": `export function process({ _legacy, value }) {
  return value * 2;
}
`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "an underscore-prefixed binding documents intentional non-use");
    } finally { teardown(dir); }
  });

  it("does NOT flag a binding returned via object shorthand (return { id, label })", async () => {
    const dir = withFixture({
      "server/lib/passthrough.js": `export function makeThing({ id, label }) {
  return { id, label };
}
`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "shorthand-return re-uses the identifier — that's real usage");
    } finally { teardown(dir); }
  });

  it("does NOT flag React props destructured with a rest spread used in JSX", async () => {
    const dir = withFixture({
      "concord-frontend/components/Button.tsx": `export function Button({ label, ...rest }) {
  return <button {...rest}>{label}</button>;
}
`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "label is used via JSX interpolation, rest via JSX spread");
    } finally { teardown(dir); }
  });

  it("does NOT analyze a type-only arrow signature with no function body", async () => {
    const dir = withFixture({
      "concord-frontend/lib/types.ts": `export type Handler = ({ a, b }: { a: number; b: string }) => void;
`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "a bodiless type alias signature must not be analyzed");
    } finally { teardown(dir); }
  });
});

describe("UnusedDestructuredParamDetector — annotation opt-out", () => {
  it("respects @unused-param-ok in the file's first 5 lines", async () => {
    const dir = withFixture({
      "server/lib/simulation/optout.js": `// @unused-param-ok: legacy, tracked in TICKET-456\n` + BUGGY_ISI,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "file-level annotation suppresses every finding");
    } finally { teardown(dir); }
  });
});

describe("UnusedDestructuredParamDetector — report shape + robustness", () => {
  it("returns canonical DetectorReport shape and never throws on an empty tree", async () => {
    const dir = withFixture({ "README.md": "nothing here" });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.ok, true);
      assert.equal(realFindings(r).length, 0);
    } finally { teardown(dir); }
  });
});
