import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../routes/chat-agent-stream.js"), "utf8");

// The ROUTE-on end-to-end sequence needs a live brain; CI pins the wiring: the cockpit turn sits behind the
// ROUTE flag, runs before the old loop, sends one token + done with cockpitRunId, and falls through on null.
test("the cockpit turn is flag-gated, ahead of the old loop, and falls through on null", () => {
  const iFlag = src.indexOf('cockpitFlag("ROUTE")');
  const iLoop = src.indexOf("await runAgentLoop({");
  assert.ok(iFlag > 0 && iFlag < iLoop);
  assert.ok(src.includes("turn?.handled"));
  assert.ok(/send\("done",[^)]*cockpitRunId/.test(src));
  assert.ok(src.includes("chatProgress: (e) => send(e.type, e)"));
});
