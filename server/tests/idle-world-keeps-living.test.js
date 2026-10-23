// Pins the 2026-10-23 fix: with no one online, governorTick still runs the
// heartbeat registry (the world simulation) and advances the tick counter;
// only the heavy cognitive work stays paused. Before, the idle gate returned
// before the registry, so seasons, festivals, flocks, faction strategy,
// decay sweeps and NPC conversations all stopped whenever nobody was on.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("the idle branch dispatches the heartbeat registry before returning", () => {
  const gate = src.indexOf('if (reason !== "boot" && presenceIdle.isIdle()) {');
  assert.ok(gate > 0, "idle gate present");
  const ret = src.indexOf('return { ok: true, skipped: "idle_no_users", registry };', gate);
  assert.ok(ret > gate, "idle return reports what the registry did");
  const branch = src.slice(gate, ret);
  assert.match(branch, /_dispatchHeartbeatRegistry\("idle", \{ skipCosts: \["cpu"\] \}\)/);
  assert.match(branch, /STATE\.__bgTickCounter = \(STATE\.__bgTickCounter \|\| 0\) \+ 1/, "tick counter advances while idle");
  assert.match(branch, /shouldPauseBackgroundOrchestration\(\) === false/, "same low-memory guard as the active path");
  assert.match(branch, /g\.breaker\.state === "open"/, "respects the background breaker");
  assert.doesNotMatch(branch, /runMacro\("system","(autogen|dream|evolution)"/, "heavy cognitive work stays off while idle");
});

test("registry dispatch is one shared module-level function", () => {
  assert.equal((src.match(/async function _dispatchHeartbeatRegistry\(/g) || []).length, 1);
  assert.ok(src.indexOf("async function _dispatchHeartbeatRegistry(") < src.indexOf("async function governorTick("));
});
