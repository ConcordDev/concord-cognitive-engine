/**
 * Pins the CI guard on macro telemetry (lib/detectors/macro-telemetry.js).
 *
 * The macro-telemetry JSONL is a DEPLOYMENT-usage signal: the macro-usage
 * detector upgrades a macro to "fired at runtime — live" when it appears
 * there. In CI, the only thing firing macros is the audit's own gates
 * (macro-assassin fuzzes ~13k macros in-process), so a flush during a CI
 * job fabricates "production liveness" for macros nothing real ever
 * called — and makes the detector-budget gate fail nondeterministically:
 * it trips exactly when the assassin gate outlives the 5-minute flush
 * interval (observed 2026-07-06: main's run finished the gate in 277s and
 * passed at 170 findings; the same tree on a slower PR runner crossed the
 * flush line and failed at 305 vs the 210 threshold).
 *
 * Bidirectional pin:
 *  - under CI without the explicit opt-in, startTelemetry must no-op
 *    (nothing is written, flush stays inert);
 *  - with CONCORD_MACRO_TELEMETRY=1 (or outside CI) it must still
 *    genuinely record + flush — the guard must not kill real telemetry.
 *
 * Run: node --test tests/macro-telemetry-ci-guard.test.js
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  recordInvocation,
  startTelemetry,
  _resetForTest,
  flush,
} from "../lib/detectors/macro-telemetry.js";

let tmpRoot;
const savedCi = process.env.CI;
const savedOptIn = process.env.CONCORD_MACRO_TELEMETRY;

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "concord-tel-ci-guard-"));
});

after(async () => {
  _resetForTest();
  if (savedCi === undefined) delete process.env.CI; else process.env.CI = savedCi;
  if (savedOptIn === undefined) delete process.env.CONCORD_MACRO_TELEMETRY; else process.env.CONCORD_MACRO_TELEMETRY = savedOptIn;
  await rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  _resetForTest();
});

const jsonlPath = () => path.join(tmpRoot, "audit", "detectors", "macro-telemetry.jsonl");

describe("macro telemetry CI guard", () => {
  it("under CI without opt-in: startTelemetry no-ops and flush writes nothing", async () => {
    process.env.CI = "true";
    delete process.env.CONCORD_MACRO_TELEMETRY;

    startTelemetry(tmpRoot);
    recordInvocation("guard", "alpha", {});
    const r = await flush();

    assert.equal(r.written, 0, "flush must be inert when telemetry never started");
    assert.equal(existsSync(jsonlPath()), false, "no JSONL may be created during a CI run");
  });

  it("under CI with CONCORD_MACRO_TELEMETRY=1: telemetry genuinely records and flushes", async () => {
    process.env.CI = "true";
    process.env.CONCORD_MACRO_TELEMETRY = "1";

    startTelemetry(tmpRoot);
    recordInvocation("guard", "beta", {});
    const r = await flush();

    assert.equal(r.written, 1, "opt-in must restore real flush behaviour");
    const rows = (await readFile(jsonlPath(), "utf-8")).trim().split("\n").map(JSON.parse);
    assert.ok(rows.some((l) => l.key === "guard.beta"), "recorded invocation must land in the JSONL");
  });

  it("outside CI: telemetry works with no opt-in required", async () => {
    delete process.env.CI;
    delete process.env.CONCORD_MACRO_TELEMETRY;
    // Fresh dir so the previous test's rows don't satisfy the assertion.
    const localRoot = await mkdtemp(path.join(tmpdir(), "concord-tel-ci-guard-prod-"));
    try {
      startTelemetry(localRoot);
      recordInvocation("guard", "gamma", {});
      const r = await flush();
      assert.equal(r.written, 1, "non-CI (deployment) telemetry must be unaffected by the guard");
    } finally {
      await rm(localRoot, { recursive: true, force: true });
    }
  });
});
