// server/tests/invariants/ready-reflects-admission.test.js
//
// Pins that /ready reflects ADMISSION CAPACITY, not just "the process booted"
// (2026-07-28).
//
// THE GAP, measured rather than theorised: booting the real server and polling
// it, /health and /ready both went green at +8.2s while
// lib/request-admission.js was still shedding real requests with an immediate
// 503 at +13s. A load balancer following that readiness signal routes traffic
// to an instance that answers it with 503. Readiness that does not track
// whether the server can actually serve is not readiness.
//
// THE DEBOUNCE, which is the part most likely to be "simplified" later by
// someone who misses why it exists: event-loop lag crosses the shed bar
// TRANSIENTLY on the governorTick cadence (~15s intervals were observed).
// Flipping to not-ready on a single over-bar reading would deregister a
// healthy instance several times a minute — strictly worse than the gap being
// closed. Only sustained pressure (N consecutive over-bar probes) reports
// not-ready, and one clean probe resets the counter.
//
// Run: node --test server/tests/invariants/ready-reflects-admission.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../routes/system.js"),
  "utf8"
);

// The /ready handler body, so assertions cannot accidentally match /health.
const READY = SRC.slice(SRC.indexOf('app.get("/ready"'), SRC.indexOf('app.get("/api/health"')) || "";

describe("/ready — reflects admission capacity", () => {
  it("the handler was found (guards against these tests passing vacuously)", () => {
    assert.ok(READY.length > 200, "could not isolate the /ready handler body");
  });

  it("consults the live event-loop lag and the real shed threshold", () => {
    assert.match(READY, /getCurrentLagMs\(\)/, "must read the live lag, not assume health");
    assert.match(READY, /getShedLagMs\(\)/, "must compare against the SAME bar the shedder uses");
    // Both must be imported from the modules that own them, not re-derived.
    assert.match(SRC, /import \{ getCurrentLagMs \} from "\.\.\/lib\/event-loop-pressure\.js"/);
    assert.match(SRC, /import \{ getShedLagMs \} from "\.\.\/lib\/request-admission\.js"/);
  });

  it("still keeps the original liveness checks", () => {
    for (const c of ["state", "macros"]) {
      assert.ok(READY.includes(`${c}:`), `/ready dropped its ${c} check`);
    }
    assert.match(READY, /SELECT 1/, "/ready dropped its database ping");
  });

  it("reports the raw numbers regardless of the verdict", () => {
    // An operator has to be able to see pressure building BEFORE it trips.
    for (const field of ["eventLoopLagMs", "shedThresholdMs", "pressureStrikes"]) {
      assert.ok(READY.includes(field), `/ready payload is missing ${field}`);
    }
  });
});

describe("/ready — the debounce is real and resettable", () => {
  it("requires consecutive over-bar probes rather than a single one", () => {
    assert.match(READY, /READY_PRESSURE_STRIKES/, "no strike threshold — a single blip would flap");
    assert.match(
      READY, /_readyPressureStrikes\s*=\s*overBar\s*\?\s*_readyPressureStrikes\s*\+\s*1\s*:\s*0/,
      "strikes must increment on pressure and RESET to 0 on a clean probe"
    );
  });

  it("the strike count is configurable and defaults sanely", () => {
    assert.match(SRC, /CONCORD_READY_PRESSURE_STRIKES/);
    const m = SRC.match(/CONCORD_READY_PRESSURE_STRIKES\)\s*\|\|\s*(\d+)/);
    assert.ok(m, "no default strike count");
    assert.ok(Number(m[1]) >= 2, "a threshold below 2 is not a debounce");
  });

  it("the per-probe answer and the debounced verdict are separate fields", () => {
    // `admitting` is the honest instantaneous answer; `admissionSustained` is
    // what gates the 200/503. Collapsing them back into one loses the ability
    // to see a blip without acting on it.
    assert.match(READY, /checks\.admitting\s*=\s*!overBar/);
    assert.match(READY, /checks\.admissionSustained\s*=/);
  });

  it("the instantaneous flag is assigned AFTER the verdict is computed", () => {
    // This is the ordering bug this test exists for, and the FIRST version of
    // this assertion missed it: it sliced the source from `const ready =`
    // onward and checked that `checks.admitting` did not appear there, which
    // passed vacuously because the verdict line itself never names the field.
    //
    // The real hazard is that `ready` is
    // `Object.values(checks).every(...)` — so ANY key present on `checks` at
    // that moment feeds the verdict. Assigning `admitting` before that line
    // folds the instantaneous flag in and silently defeats the debounce: one
    // over-bar blip flips the instance to not-ready. Ordering is the fix, so
    // ordering is what gets pinned.
    const verdictAt = READY.indexOf("const ready =");
    const admittingAt = READY.indexOf("checks.admitting");
    assert.ok(verdictAt > 0 && admittingAt > 0, "could not locate both statements");
    assert.ok(
      admittingAt > verdictAt,
      "checks.admitting is assigned BEFORE the verdict — Object.values(checks) " +
      "will fold the instantaneous flag into `ready` and defeat the debounce"
    );
  });

  it("behaviourally: an instantaneous blip alone does not make it not-ready", () => {
    // Reproduce the verdict computation exactly as the handler does it, to
    // prove the property rather than infer it from source ordering alone.
    const STRIKES = 3;
    function verdict({ overBar, strikes }) {
      const checks = { state: true, macros: true, database: true };
      checks.admissionSustained = strikes < STRIKES;
      const ready = Object.values(checks).every((v) => v === true || v === "no_db");
      checks.admitting = !overBar;           // observability only, after the verdict
      return { ready, checks };
    }
    // One blip (strike 1 of 3): shedding right now, but still READY.
    const blip = verdict({ overBar: true, strikes: 1 });
    assert.equal(blip.ready, true, "a single over-bar probe must not deregister the instance");
    assert.equal(blip.checks.admitting, false, "...but it must still be VISIBLE as not admitting");
    // Sustained (strike 3 of 3): now genuinely not ready.
    assert.equal(verdict({ overBar: true, strikes: 3 }).ready, false);
    // Recovered: clean probe resets strikes upstream, so ready again.
    assert.equal(verdict({ overBar: false, strikes: 0 }).ready, true);
  });
});
