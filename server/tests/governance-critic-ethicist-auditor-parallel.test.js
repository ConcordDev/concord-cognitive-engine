// server/tests/governance-critic-ethicist-auditor-parallel.test.js
//
// Task #32 of the Private Mode / High Power Mode plan — concurrency item
// (c): server.js#validateOrganismDTU's critic/ethicist/auditor calls now
// run via Promise.all instead of three sequential `await callBrain(...)`
// calls (each takes ONLY the dtu as input, confirmed by reading
// prompt-registry.js's emergentCritic/emergentEthicist/emergentAuditor —
// none references another role's output, unlike the CHALLENGER ->
// ENGINEER -> SYNTHESIZER debate chain elsewhere in the same file, which
// explicitly threads prior-stage output and stays sequential).
//
// This boots the REAL server.js (not a simulated shape) with two fake
// Ollama HTTP servers standing in for the repair brain (serves BOTH
// critic and ethicist — validateOrganismDTU calls callBrain("repair", ...)
// for both) and the utility brain (serves auditor), each responding after
// an artificial delay. Proves:
//   1. Genuine concurrency — wall-clock time for the whole call is close
//      to the SLOWEST single role's delay, not the SUM of all three
//      (which sequential execution would produce).
//   2. Result order stays [critic, ethicist, auditor] regardless of which
//      fake response actually resolves first.
//   3. Each role's own try/catch fallback is independent — a failure on
//      one role (say ethicist) doesn't affect the other two roles' real
//      results.
//
// Same pre-import env + fake-Ollama-server pattern as
// tests/inference-metering-chat-wiring.test.js (brain-config.js's
// BRAIN_CONFIG is a module-level const computed once at server.js import
// time, so the fake URLs must be set BEFORE `await import("../server.js")`).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

// Per-role artificial delay + response behavior, keyed by which
// substring appears in the request's prompt (the emergent* prompt
// templates each say "You are the CRITIC/ETHICIST/AUDITOR emergent",
// so the fake server can tell the two repair-bound calls apart even
// though they share one fake HTTP server).
let roleBehavior = {
  CRITIC: { delayMs: 0, pass: true, reason: "ok" },
  ETHICIST: { delayMs: 0, pass: true, reason: "ok" },
  AUDITOR: { delayMs: 0, pass: true, reason: "ok" },
};

// Per-role request arrival / response timestamps, captured by the fake brain
// servers below. This is what makes the concurrency proof contention-proof —
// see the "last arrival precedes first completion" test for why wall-clock
// elapsed time is the wrong instrument on a shared CI runner.
let roleTimings = {};
function resetRoleTimings() { roleTimings = {}; }

function roleForPrompt(promptText) {
  if (promptText.includes("CRITIC")) return "CRITIC";
  if (promptText.includes("ETHICIST")) return "ETHICIST";
  if (promptText.includes("AUDITOR")) return "AUDITOR";
  return null;
}

function makeFakeBrainServer() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch { /* ignore */ }
      const userMsg = (parsed.messages || []).find((m) => m.role === "user");
      const role = roleForPrompt(userMsg?.content || "");
      const behavior = (role && roleBehavior[role]) || { delayMs: 0, pass: true, reason: "unmatched" };

      // Stamp when this role's request ARRIVED — i.e. when the server issued
      // the call — before the artificial delay runs.
      if (role) roleTimings[role] = { arrivedAt: Date.now(), completedAt: null };

      const respond = () => {
        if (role && roleTimings[role]) roleTimings[role].completedAt = Date.now();
        if (behavior.error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "simulated failure" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          message: { content: JSON.stringify({ pass: behavior.pass, reason: behavior.reason }) },
          eval_count: 5,
        }));
      };
      if (behavior.delayMs > 0) setTimeout(respond, behavior.delayMs);
      else respond();
    });
  });
  return server;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (err) => {
      if (err) return reject(err);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

let repairServer, utilityServer, T;

before(async () => {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";
  if (!process.env.STATE_PATH) {
    process.env.STATE_PATH = path.join(os.tmpdir(), `concord-governance-parallel-state-${process.pid}-${Date.now()}.json`);
  }
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = path.join(os.tmpdir(), `concord-governance-parallel-${process.pid}-${Date.now()}.db`);
  }

  repairServer = makeFakeBrainServer();
  utilityServer = makeFakeBrainServer();
  const repairUrl = await listen(repairServer);
  const utilityUrl = await listen(utilityServer);

  // Must be set BEFORE importing server.js (brain-config.js's module-
  // level BRAIN_CONFIG const captures env at import time).
  delete process.env.BRAIN_REPAIR_URLS;
  delete process.env.BRAIN_UTILITY_URLS;
  process.env.BRAIN_REPAIR_URL = repairUrl;
  process.env.BRAIN_UTILITY_URL = utilityUrl;

  T = (await import("../server.js")).__TEST__;
  assert.ok(T?.validateOrganismDTU, "server.js __TEST__ must expose validateOrganismDTU for this test");
  T.BRAIN.repair.enabled = true;
  T.BRAIN.utility.enabled = true;
});

after(async () => {
  await new Promise((resolve) => repairServer.close(() => resolve()));
  await new Promise((resolve) => utilityServer.close(() => resolve()));
});

registerServerCleanExit(() => T);

function makeDtu(idSuffix) {
  return {
    id: `dtu_gov_parallel_${idSuffix}`,
    title: "Test DTU for governance parallel check",
    human: { summary: "A synthetic DTU used only to exercise validateOrganismDTU." },
    tags: ["test"],
    domain: "test",
    source: "test",
  };
}

describe("validateOrganismDTU — critic/ethicist/auditor run concurrently", () => {
  // Rewritten 2026-09-11: this used to assert `elapsedMs < 400` on the theory
  // that a serial run needs >= 150+200+100 = 450ms. That inference is only
  // valid on an idle machine. Under full-suite CI contention the observed
  // elapsed time was 1422ms — which exceeds even the 450ms SERIAL figure, so
  // the measurement had stopped discriminating between the two cases entirely
  // and was reporting the runner's load, not the code's behaviour.
  //
  // Raising the threshold would have been the wrong fix: it keeps a weak
  // indirect proxy and just makes it quieter. Instead this now proves the
  // property DIRECTLY, from timestamps the fake brain servers record.
  //
  // The crisp invariant: under concurrent dispatch, all three requests are in
  // flight before any of them answers, so the LAST arrival precedes the FIRST
  // completion. Under sequential dispatch that is impossible — role 2's
  // request cannot even arrive until role 1's response has completed. It is a
  // boolean fact about overlap, so an arbitrarily slow or contended runner
  // stretches every timestamp equally and cannot flip the verdict.
  it("all three role requests are in flight at once (last arrival precedes first completion)", async () => {
    roleBehavior = {
      CRITIC: { delayMs: 150, pass: true, reason: "falsifiable" },
      ETHICIST: { delayMs: 200, pass: true, reason: "no violation" },
      AUDITOR: { delayMs: 100, pass: true, reason: "provenance clean" },
    };
    resetRoleTimings();
    const result = await T.validateOrganismDTU(makeDtu("timing"), "test-submitter");

    const roles = ["CRITIC", "ETHICIST", "AUDITOR"];
    for (const r of roles) {
      assert.ok(roleTimings[r], `no request recorded for ${r} — the fake brain never saw this role`);
      assert.ok(roleTimings[r].completedAt, `${r} request never completed`);
    }

    const lastArrival = Math.max(...roles.map((r) => roleTimings[r].arrivedAt));
    const firstCompletion = Math.min(...roles.map((r) => roleTimings[r].completedAt));

    assert.ok(
      lastArrival <= firstCompletion,
      "expected concurrent dispatch: every role's request should be in flight before any " +
      `response is sent. Last arrival was ${lastArrival - Math.min(...roles.map((r) => roleTimings[r].arrivedAt))}ms ` +
      `after the first, but the first completion landed ${firstCompletion - Math.min(...roles.map((r) => roleTimings[r].arrivedAt))}ms in. ` +
      `Timings: ${JSON.stringify(roleTimings)}`,
    );

    assert.equal(result.allPassed, true);
  });

  it("result order is always [critic, ethicist, auditor], regardless of which fake response resolves first", async () => {
    // Ethicist is the SLOWEST here, so if the old sequential code were
    // still in place OR if Promise.all didn't preserve input-array order,
    // this would be the case most likely to expose a reordering bug.
    roleBehavior = {
      CRITIC: { delayMs: 10, pass: true, reason: "r-critic" },
      ETHICIST: { delayMs: 100, pass: false, reason: "r-ethicist" },
      AUDITOR: { delayMs: 5, pass: true, reason: "r-auditor" },
    };
    const result = await T.validateOrganismDTU(makeDtu("order"), "test-submitter");
    assert.deepEqual(result.validations.map((v) => v.role), ["critic", "ethicist", "auditor"]);
    assert.equal(result.validations[0].reason, "r-critic");
    assert.equal(result.validations[1].reason, "r-ethicist");
    assert.equal(result.validations[2].reason, "r-auditor");
    assert.equal(result.allPassed, false); // ethicist failed
  });

  it("an HTTP-level failure on one role (ethicist) does not affect the other two roles' real results", async () => {
    // Runtime-truth finding (verified while writing this test, not
    // assumed): callBrain() never THROWS on an HTTP-level provider
    // failure — its own outer try/catch (server.js, right before this
    // function returns) already swallows a non-2xx response and resolves
    // to {ok:false, error}. So the emergent role wrappers' own try/catch
    // around `await callBrain(...)` is only ever reached by a genuinely
    // unexpected exception (e.g. a bug in safeJSONParse itself), not by
    // the provider returning an error — this is unchanged, pre-existing
    // behavior from the original sequential code, not something this
    // refactor altered. An `ok:false` result flows through the SAME
    // shape as a real "no strong opinion" response: `parsed = {}`, so
    // `pass: true` (parsed.pass !== false) with reason "evaluated" (the
    // fallback when neither parsed.reason nor content exists) — an
    // honest low-confidence pass, not a fabricated success.
    roleBehavior = {
      CRITIC: { delayMs: 0, pass: true, reason: "critic-real-result" },
      ETHICIST: { delayMs: 0, error: true },
      AUDITOR: { delayMs: 0, pass: true, reason: "auditor-real-result" },
    };
    const result = await T.validateOrganismDTU(makeDtu("isolated-failure"), "test-submitter");
    const byRole = Object.fromEntries(result.validations.map((v) => [v.role, v]));

    assert.equal(byRole.critic.pass, true);
    assert.equal(byRole.critic.reason, "critic-real-result");
    assert.equal(byRole.auditor.pass, true);
    assert.equal(byRole.auditor.reason, "auditor-real-result");
    assert.equal(byRole.ethicist.pass, true);
    assert.equal(byRole.ethicist.reason, "evaluated");
  });

  it("a genuine failing verdict (allPassed: false) quarantines the DTU with the correct per-role reasons", async () => {
    roleBehavior = {
      CRITIC: { delayMs: 0, pass: false, reason: "unfalsifiable claim" },
      ETHICIST: { delayMs: 0, pass: true, reason: "clean" },
      AUDITOR: { delayMs: 0, pass: true, reason: "clean" },
    };
    const dtu = makeDtu("quarantine");
    const result = await T.validateOrganismDTU(dtu, "test-submitter");
    assert.equal(result.allPassed, false);
    assert.equal(result.governance, "quarantined");
    assert.equal(dtu.meta._governanceStatus, "quarantined");
    assert.deepEqual(dtu.meta._quarantineReasons, [{ role: "critic", reason: "unfalsifiable claim" }]);
  });
});
