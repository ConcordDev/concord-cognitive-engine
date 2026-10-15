// server/tests/conkay-chat-orchestrator-car.test.js
//
// End to end, the brief's acceptance for the orchestrator: from the single prompt "Design a four-seat electric car
// that holds 180 mph", with no human steps, the electric car is designed (the top speed held on the iM-375's
// continuous power, the 295 km/h limiter binding, the Cd band reported, the tub-fit and traction-battery WARNs kept
// honest), deterministically across three runs (the same receipt hash). And a prompt the library cannot meet
// (400 mph) comes back proven infeasible with its binding constraint.
//
// Long: the first run solves the CAD body (OCC kernel, ~15 min on a laptop); later runs reuse the kernel's cache.
// Runs when CONKAY_ORCHESTRATOR_E2E=1 and the kernel's Python is present; otherwise skipped (not faked).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { designFromChat } from "../lib/conkay/chat/run.js";
import { kernelPythonPath } from "../lib/conkay/cad/body-kernel.js";

const PROMPT = "Design a four-seat electric car that holds 180 mph";
const enabled = process.env.CONKAY_ORCHESTRATOR_E2E === "1" && (() => { try { return fs.existsSync(kernelPythonPath()); } catch { return false; } })();

describe("orchestrator: the electric car from one prompt", { skip: enabled ? false : "set CONKAY_ORCHESTRATOR_E2E=1 with the OCC kernel installed (long: CAD body solves)" }, () => {
  let first;
  it("reaches the electric car with no human step", { timeout: 60 * 60 * 1000 }, async () => {
    first = await designFromChat(PROMPT);
    assert.equal(first.stage, "designed");
    assert.equal(first.outcome.kind, "all-pass");
    assert.equal(first.state.motorId, "motor.cascadia.im-375-dz");
    assert.equal(first.result.drive, "motor.cascadia.im-375-dz");
    assert.equal(first.result.topSpeed.limitedBy, "speed limiter (design choice)");
    assert.ok(Math.abs(first.result.topSpeed.mph - 183.3) < 0.2, `${first.result.topSpeed.mph}`);
    assert.ok(first.result.topSpeed.unlimitedMph > 180);
    const cd = first.result.cd;
    assert.ok(cd.low < cd.centre && cd.centre < cd.high, "the Cd is reported as a band");
    for (const w of ["package.tub-fit@VEH", "vehicle.traction-battery@VEH"]) assert.ok(first.result.warnings.includes(w), w);
    // the decision log: iteration 1 finds the top speed failing on the lighter drive unit and fixes it with the next one
    const it1 = first.log[0];
    assert.ok(it1.failing.includes("requirement.check@REQ_topSpeed"));
    assert.equal(it1.chosen.rule, "top-speed.next-drive-unit");
    assert.ok(it1.candidates.every((c) => Number.isFinite(c.gain) && Number.isFinite(c.dMassKg)));
  });
  it("is deterministic across three runs (the same receipt hash)", { timeout: 60 * 60 * 1000 }, async () => {
    const a = await designFromChat(PROMPT);
    const b = await designFromChat(PROMPT);
    assert.equal(a.receiptSha256, first.receiptSha256);
    assert.equal(b.receiptSha256, first.receiptSha256);
  });
  it("400 mph: proven infeasible at the build, the tyre library named as binding, the requirement change only offered", { timeout: 10 * 60 * 1000 }, async () => {
    const r = await designFromChat("Design a four-seat electric car that holds 400 mph");
    assert.equal(r.stage, "infeasible");
    assert.equal(r.outcome.kind, "proven-infeasible");
    assert.equal(r.outcome.binding[0].variable, "tyres");
    assert.ok(r.outcome.requirementOptions.every((o) => o.applied === false));
    assert.match(r.outcome.requirementOptions[0].option, /186 mph/);
  });
});
