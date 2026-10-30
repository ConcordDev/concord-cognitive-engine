// Ghost fleet safety: its 5-minute economy timer must not run a second cycle next to the governor's, and the
// in-flight guard on its HLM pass must exist. Source pins cover server.js; the behaviour is tested directly.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as economy from "../emergent/entity-economy.js";

test("runEconomicCycle: a caller with skipIfRecentMs skips after a recent cycle; plain callers always run", () => {
  const a = economy.runEconomicCycle();
  assert.equal(a.ok, true);
  assert.notEqual(a.skipped, "recent_cycle");
  const fleet = economy.runEconomicCycle({ skipIfRecentMs: 50 * 60_000 });
  assert.equal(fleet.skipped, "recent_cycle", "the fleet timer skips right after the governor's cycle");
  const governor = economy.runEconomicCycle();
  assert.notEqual(governor.skipped, "recent_cycle", "governor / manual calls are never skipped");
  assert.equal(governor.tick, a.tick + 1, "only real cycles advance the tick (UBI cadence unchanged)");
});

test("server.js: the fleet economy timer passes the guard and the HLM pass has an in-flight flag", () => {
  const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(src, /econ\.runEconomicCycle\(\{ skipIfRecentMs: 50 \* 60_000 \}\)/);
  assert.match(src, /let _hlmRunning = false;[\s\S]{0,400}if \(_hlmRunning\) return;[\s\S]{0,400}finally \{ _hlmRunning = false; \}/);
  // the governor heartbeat call stays unguarded
  assert.match(src, /try \{ entityEconMod\.runEconomicCycle\(\); \}/);
});
