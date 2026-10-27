// The read replica (CONCORD_READ_REPLICA=1) must not run the primary's
// background work: embedding backfill (vectors can't be stored on a read-only
// DB), Ollama model pulls, or the minor-agent scheduler. server.js is too heavy
// to boot in a unit test on this host, so pin the gates in source.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("semantic backfill is skipped on a read replica", () => {
  const fn = src.slice(src.indexOf("function startSemanticBackfill("), src.indexOf("function startSemanticBackfill(") + 600);
  assert.match(fn, /_isReadReplicaEnv\(\)[\s\S]*reason: "read_replica"[\s\S]*return false/);
});

test("brain model pulls are skipped on a read replica", () => {
  assert.match(src, /!modelPresent && _isReadReplicaEnv\(\)[\s\S]{0,400}brain_model_pull_skipped/);
});

test("minor-agent scheduler does not start on a read replica", () => {
  assert.match(src, /if \(!_isReadReplicaEnv\(\)\) _unrefInTest\(setTimeout\(async \(\) => \{\s*try \{\s*const emergentsMap = STATE\?\.__emergent\?\.emergents;\s*await minorAgentScheduler\.initialize/);
});

test("_isReadReplicaEnv accepts 1/true only", () => {
  const start = src.indexOf("function _isReadReplicaEnv()");
  const body = src.slice(start, src.indexOf("\n}\n", start) + 3);
  // eslint-disable-next-line no-new-func
  const f = new Function("process", body + "\nreturn _isReadReplicaEnv();");
  assert.equal(f({ env: { CONCORD_READ_REPLICA: "1" } }), true);
  assert.equal(f({ env: { CONCORD_READ_REPLICA: "TRUE" } }), true);
  assert.equal(f({ env: { CONCORD_READ_REPLICA: "0" } }), false);
  assert.equal(f({ env: {} }), false);
});
