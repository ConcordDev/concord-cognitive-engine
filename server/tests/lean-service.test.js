// Brief F: Lean check service (pod), shared source policy, backend client. No real Lean is needed: the
// service test runs the real service.mjs against a fake `lake` that prints canned Lean output.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { leanSourceIssues, theoremNames, axiomsVerdict } from "../lib/lean-service/policy.js";
import { checkLean, leanUrl, DEFAULT_LEAN_URL } from "../lib/verify-gate/lean-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const GOOD = "theorem add_comm' (a b : Nat) : a + b = b + a := by omega";

test("policy accepts a plain theorem and rejects sorry, admit, axioms, IO, #eval, macros, bad imports", () => {
  assert.deepEqual(leanSourceIssues(GOOD), []);
  assert.deepEqual(leanSourceIssues("import Mathlib.Tactic\ntheorem t : 1 + 1 = 2 := by norm_num"), []);
  for (const [src, why] of [
    ["theorem t : 1 = 2 := by sorry", /sorry/], ["theorem t : 1 = 2 := by admit", /admit/],
    ["axiom bad : 1 = 2\ntheorem t : 1 = 2 := bad", /axiom/], ["theorem t : True := trivial\n#eval IO.println \"x\"", /#eval|IO/],
    ["run_cmd Lean.logInfo \"x\"\ntheorem t : True := trivial", /elaboration/], ["macro \"x\" : tactic => `(tactic| rfl)\ntheorem t : 1 = 1 := by x", /macros/],
    ["import Lean.Meta\ntheorem t : True := trivial", /imports Lean\.Meta/], ["def f := 1", /no theorem/], ["", /empty/],
    ["theorem t : True := by native_decide", /native_decide/], ["unsafe def f := 1\ntheorem t : True := trivial", /unsafe/],
  ]) assert.ok(leanSourceIssues(src).some((i) => why.test(i)), `${src} -> ${leanSourceIssues(src)}`);
});

test("comments and strings cannot trigger or hide the policy", () => {
  assert.deepEqual(leanSourceIssues("-- no sorry here\n/- axiom -/\ntheorem t : True := trivial"), []);
  assert.ok(leanSourceIssues("theorem t : True := by\n  /- sorry -/ sorry").includes("uses sorry"));
});

test("theorem names and axiom reports are read correctly", () => {
  assert.deepEqual(theoremNames("theorem a : True := trivial\nlemma b.c : True := trivial\nprivate theorem d : True := trivial"), ["a", "b.c", "d"]);
  assert.deepEqual(axiomsVerdict("'a' depends on axioms: [propext, Classical.choice, Quot.sound]\n'b' does not depend on any axioms"), { ok: true, extra: [], seen: 2 });
  const bad = axiomsVerdict("'a' depends on axioms: [propext, sorryAx]");
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.extra, ["sorryAx"]);
});

test("client: verified, failed, rejected locally without any request, pending when unreachable or busy", async () => {
  const mk = (status, body) => async () => ({ status, ok: status < 300, json: async () => body });
  assert.equal((await checkLean(GOOD, { fetchImpl: mk(200, { ok: true, elapsed_ms: 5 }) })).status, "verified");
  const f = await checkLean(GOOD, { fetchImpl: mk(200, { ok: false, errors: ["error: unsolved goals"] }) });
  assert.deepEqual([f.status, f.errors[0]], ["failed", "error: unsolved goals"]);
  let called = false;
  const rej = await checkLean("theorem t : 1 = 2 := by sorry", { fetchImpl: async () => { called = true; } });
  assert.deepEqual([rej.status, called], ["rejected", false]);
  assert.equal((await checkLean(GOOD, { fetchImpl: async () => { throw new Error("ECONNREFUSED"); } })).status, "pending");
  assert.equal((await checkLean(GOOD, { fetchImpl: mk(429, { ok: false }) })).status, "pending");
  assert.equal((await checkLean(GOOD, { fetchImpl: mk(200, { ok: false, timed_out: true, errors: ["timed out after 30s"] }) })).status, "pending");
  assert.equal((await checkLean(GOOD, { fetchImpl: mk(200, { ok: false, rejected: ["uses sorry"] }) })).status, "rejected");
});

test("client config: default is the tunnel on 11437, CONCORD_LEAN_URL overrides", () => {
  assert.equal(DEFAULT_LEAN_URL, "http://127.0.0.1:11437");
  assert.equal(leanUrl({}), DEFAULT_LEAN_URL);
  assert.equal(leanUrl({ CONCORD_LEAN_URL: "http://pod:9/" }), "http://pod:9");
});

// ---- the real service process against a fake `lake` ----------------------------------------------------
const work = mkdtempSync(join(tmpdir(), "lean-svc-test-"));
const bin = join(work, "bin"); const proj = join(work, "proj");
let child; const PORT = 18000 + Math.floor(Math.random() * 1000);
after(() => { try { child?.kill("SIGKILL"); } catch { /* gone */ } rmSync(work, { recursive: true, force: true }); });

async function startService(lakeScript, env = {}) {
  const fs = await import("node:fs");
  fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  writeFileSync(join(bin, "lake"), lakeScript); chmodSync(join(bin, "lake"), 0o755);
  child = spawn(process.execPath, [join(here, "../lib/lean-service/service.mjs")], {
    env: { ...process.env, LEAN_SERVICE_PORT: String(PORT), LEAN_PROJECT_DIR: proj, LEAN_BIN_DIR: bin, LEAN_QUEUE_MAX: "1", LEAN_MAX_TIMEOUT_S: "2", ...env },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`, { headers: env.LEAN_SERVICE_TOKEN ? { authorization: `Bearer ${env.LEAN_SERVICE_TOKEN}` } : {} })).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("service did not start");
}
const post = (src, extra = {}, headers = {}) => fetch(`http://127.0.0.1:${PORT}/check`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ lean_source: src, ...extra }) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("service: accepts a proof with standard axioms, rejects sorry/axioms/forbidden source, kills a runaway", async () => {
  // fake lake: `lake env lean FILE` -> prints axiom reports for the theorem names found in the file; hangs on "LOOP"
  await startService(`#!/bin/bash
f="$3"
if grep -q LOOP "$f"; then sleep 30; fi
if grep -q SORRYAX "$f"; then echo "'t' depends on axioms: [propext, sorryAx]"; echo "warning: declaration uses 'sorry'"; exit 0; fi
if grep -q BADPROOF "$f"; then echo "Claim.lean:1:0: error: unsolved goals"; exit 1; fi
for n in $(grep -oE '^theorem [A-Za-z_]+' "$f" | cut -d' ' -f2); do echo "'$n' depends on axioms: [propext, Classical.choice, Quot.sound]"; done
exit 0
`);
  const ok = await post("theorem t : 1 + 1 = 2 := by omega");
  assert.equal(ok.body.ok, true, JSON.stringify(ok.body));
  const sorried = await post("theorem t : True := trivial -- SORRYAX");
  assert.equal(sorried.body.ok, false);
  const failed = await post("theorem t : True := trivial -- BADPROOF");
  assert.equal(failed.body.ok, false);
  assert.match(failed.body.errors[0], /unsolved goals/);
  const rej = await post("theorem t : 1 = 2 := by sorry");
  assert.equal(rej.body.ok, false);
  assert.deepEqual(rej.body.rejected, ["uses sorry"]);
  const t0 = Date.now();
  const runaway = await post("theorem t : True := trivial -- LOOP", { timeout_s: 1 });
  assert.equal(runaway.body.timed_out, true);
  assert.ok(Date.now() - t0 < 5000, "the runaway job was killed at its timeout");
  assert.equal((await post(GOOD)).body.ok, true, "the service keeps working after a kill");
});

test("service: a full queue answers 429; the real client turns that into pending", async () => {
  const slow = post("theorem t : True := trivial -- LOOP", { timeout_s: 2 });
  await new Promise((r) => setTimeout(r, 200));
  const queued = post("theorem u : True := trivial -- LOOP", { timeout_s: 1 });
  await new Promise((r) => setTimeout(r, 200));
  const full = await post(GOOD);
  assert.equal(full.status, 429);
  const viaClient = await checkLean("theorem v : True := trivial", { url: `http://127.0.0.1:${PORT}`, timeoutS: 1 });
  assert.equal(viaClient.status, "pending");
  await Promise.all([slow, queued]);
});

test("service: a bearer token is enforced when configured", async () => {
  child.kill("SIGKILL"); await new Promise((r) => setTimeout(r, 300));
  await startService("#!/bin/bash\nfor n in $(grep -oE '^theorem [A-Za-z_]+' \"$3\" | cut -d' ' -f2); do echo \"'$n' depends on axioms: [propext]\"; done\n", { LEAN_SERVICE_TOKEN: "s3cret", LEAN_QUEUE_MAX: "4" });
  assert.equal((await post(GOOD)).status, 401);
  assert.equal((await post(GOOD, {}, { authorization: "Bearer s3cret" })).body.ok, true);
});
