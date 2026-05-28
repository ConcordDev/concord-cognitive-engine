/**
 * The standing wiring gate (CONCORDIA_PLAN Phase H meta-fix).
 *
 * Fails CI if any NEW exported gameplay-system function (attempt/award/grant/
 * trigger/resolve/advance/apply/consume/propose/seed*) has zero non-test
 * callers, or any documented CONCORD_* dial is never read. Pre-existing debt is
 * baselined in the script (tracked, not hidden); this test guards against
 * *new* connection-debt — the dominant historical failure mode.
 *
 * Run: node --test tests/integration/wiring-gate.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "../../../scripts/audit-wiring-gate.mjs");

describe("standing wiring gate", () => {
  it("has zero NEW zero-caller system functions and zero unread dials", () => {
    let out = "";
    let code = 0;
    try {
      out = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    } catch (e) {
      code = e.status ?? 1;
      out = (e.stdout || "") + (e.stderr || "");
    }
    const m = out.match(/NEW zero-caller system functions:\s+(\d+)/);
    assert.ok(m, `gate output missing NEW count:\n${out}`);
    if (Number(m[1]) !== 0) {
      const list = out.slice(out.indexOf("NEW built-but-unwired"));
      assert.fail(`New connection-debt detected — wire it or baseline with a reason:\n${list}`);
    }
    const u = out.match(/unread CONCORD_\* constants:\s+(\d+)/);
    assert.ok(u && Number(u[1]) === 0, `documented-but-unread constant detected:\n${out}`);
    assert.equal(code, 0, "gate should exit 0");
  });
});
