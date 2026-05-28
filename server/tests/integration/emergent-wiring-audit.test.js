/**
 * T2.4 — emergent-module reconciliation audit (CI guard).
 *
 * Runs scripts/audit-emergent-wiring.mjs and asserts zero orphaned cycle
 * handlers. An "orphan" is an emergent module that exports a run/tick/sweep
 * cycle handler that nothing schedules (server.js heartbeat, governorTick,
 * another emergent module, a route, or a domain). This is the Layer-12 class
 * of bug (a module declares itself a heartbeat but is never registered) — this
 * test fails the moment one is reintroduced.
 *
 * Run: node --test tests/integration/emergent-wiring-audit.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "../../../scripts/audit-emergent-wiring.mjs");

describe("T2.4 — emergent-module reconciliation", () => {
  it("has zero orphaned cycle handlers", () => {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    const m = out.match(/ORPHAN\s+:\s+(\d+)/);
    assert.ok(m, "audit output did not include an ORPHAN count");
    const orphans = Number(m[1]);
    if (orphans !== 0) {
      // Surface the offending list in the failure message.
      const list = out.slice(out.indexOf("ORPHANED")).split("\nWrote")[0];
      assert.fail(`Expected 0 orphaned emergent cycle handlers, found ${orphans}:\n${list}`);
    }
    assert.equal(orphans, 0);
  });

  it("population-migration-cycle is registered (the orphan T2.4 wired)", () => {
    const out = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    assert.ok(!out.includes("population-migration-cycle.js"),
      "population-migration-cycle should be wired, not listed as an orphan");
  });
});
