// tests/macro-usage-detector.test.js
//
// Bidirectional pin for macro-usage-detector: a macro registered in
// server/server.js with zero static callers, no open dispatcher, and no
// lens-manifest reach must be flagged macro_zero_calls; the same macro with
// a real caller (via runMacro(...) OR a { domain, name } lens-run payload
// shape) must NOT be. A macro only reachable via a dispatcher/manifest gets
// a graded downgrade instead of macro_zero_calls, resolved further by
// runtime telemetry (macro_runtime_live when it actually fired recently,
// silently counted as a retirement candidate when it never fired at all).
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMacroUsageDetector } from "../lib/detectors/macro-usage-detector.js";

async function tmpRepo(filesMap = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mud-"));
  await mkdir(path.join(dir, "server"), { recursive: true });
  await mkdir(path.join(dir, "concord-frontend"), { recursive: true });
  for (const [rel, content] of Object.entries(filesMap)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

async function writeTelemetry(dir, rows) {
  const p = path.join(dir, "audit", "detectors", "macro-telemetry.jsonl");
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

describe("macro-usage detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS macro_zero_calls for a server.js-registered macro with no static callers, no dispatcher, no manifest", async () => {
    dir = await tmpRepo({
      "server/server.js": `register("demo", "create", (ctx) => {});\n`,
    });
    const r = await runMacroUsageDetector({ root: dir });
    assert.equal(r.ok, true);
    const hit = r.findings.find((f) => f.id === "macro_zero_calls" && f.evidence?.domain === "demo");
    assert.ok(hit, "demo.create with zero reach must be flagged");
    assert.equal(hit.severity, "low");
    assert.equal(hit.fixHint, "verify_dynamic_dispatch_or_remove");
  });

  it("does NOT flag macro_zero_calls when a real runMacro(...) caller exists", async () => {
    dir = await tmpRepo({
      "server/server.js": `register("demo", "create", (ctx) => {});\n`,
      "server/lib/caller.js": `runMacro("demo", "create", {});\n`,
    });
    const r = await runMacroUsageDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "macro_zero_calls" && f.evidence?.domain === "demo");
    assert.equal(hit, undefined, "a real static caller must clear macro_zero_calls");
    const summary = r.findings.find((f) => f.id === "macro_usage_summary");
    assert.equal(summary.evidence.dead, 0);
  });

  it("FLAGS macro_runtime_live when a dispatcher-reachable macro fired within the live telemetry window", async () => {
    dir = await tmpRepo({
      "server/server.js": `register("demo", "create", (ctx) => {});\n`,
      "server/lib/open-dispatch.js": `// @macro-dispatcher\nrunMacro(domainVar, nameVar, {});\n`,
    });
    await writeTelemetry(dir, [
      { generatedAt: new Date().toISOString(), key: "demo.create", total: 3, lastFiredAt: Date.now(), sources: {} },
    ]);
    const r = await runMacroUsageDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "macro_runtime_live" && f.evidence?.domain === "demo");
    assert.ok(hit, "a macro that fired recently under an active dispatcher must be reported as runtime-live");
    assert.equal(hit.severity, "info");
    assert.equal(hit.kind, "semantic");
    assert.equal(hit.evidence.fireCount, 3);
    const zeroHit = r.findings.find((f) => f.id === "macro_zero_calls" && f.evidence?.domain === "demo");
    assert.equal(zeroHit, undefined, "dispatcher-reachable macros must never also be reported as zero-calls");
  });

  it("does NOT flag macro_zero_calls OR macro_runtime_live when telemetry shows the macro fired but NOT within the live window (retirement-candidate path, summary-only)", async () => {
    dir = await tmpRepo({
      "server/server.js": `register("demo", "create", (ctx) => {});\n`,
      "server/lib/open-dispatch.js": `// @macro-dispatcher\nrunMacro(domainVar, nameVar, {});\n`,
    });
    const now = Date.now();
    await writeTelemetry(dir, [
      // Another key fired recently so telemetryActive is true...
      { generatedAt: new Date().toISOString(), key: "other.thing", total: 1, lastFiredAt: now, sources: {} },
      // ...but demo.create itself last fired 60 days ago — outside the 30-day window.
      { generatedAt: new Date().toISOString(), key: "demo.create", total: 5, lastFiredAt: now - 60 * 86_400_000, sources: {} },
    ]);
    const r = await runMacroUsageDetector({ root: dir });
    const zeroHit = r.findings.find((f) => f.id === "macro_zero_calls" && f.evidence?.domain === "demo");
    const liveHit = r.findings.find((f) => f.id === "macro_runtime_live" && f.evidence?.domain === "demo");
    assert.equal(zeroHit, undefined, "dispatcher-reachable macros are never zero_calls");
    assert.equal(liveHit, undefined, "a macro that fired outside the window is not runtime-live");
    const summary = r.findings.find((f) => f.id === "macro_usage_summary");
    assert.equal(summary.evidence.retirementCandidate, 1, "it must be counted as a retirement candidate in the summary");
  });

  it("does NOT flag AND does NOT count as runtime-live/retirement-candidate when there is no telemetry file at all (unknown liveness, silently reachable)", async () => {
    dir = await tmpRepo({
      "server/server.js": `register("demo", "create", (ctx) => {});\n`,
      "server/lib/open-dispatch.js": `// @macro-dispatcher\nrunMacro(domainVar, nameVar, {});\n`,
    });
    const r = await runMacroUsageDetector({ root: dir });
    const zeroHit = r.findings.find((f) => f.id === "macro_zero_calls" && f.evidence?.domain === "demo");
    const liveHit = r.findings.find((f) => f.id === "macro_runtime_live" && f.evidence?.domain === "demo");
    assert.equal(zeroHit, undefined);
    assert.equal(liveHit, undefined);
    const summary = r.findings.find((f) => f.id === "macro_usage_summary");
    assert.ok(summary.evidence.dispatcherReach >= 1, "dispatcher-reach must still be counted");
    assert.equal(summary.evidence.runtimeLive, 0);
    assert.equal(summary.evidence.retirementCandidate, 0, "with no telemetry at all, it is neither live nor a retirement candidate");
  });

  it("does NOT flag macro_zero_calls for a macro reachable only via the lens-manifest (no dispatcher needed)", async () => {
    dir = await tmpRepo({
      "server/server.js": `register("demo2", "create", (ctx) => {});\n`,
      "server/lib/lens-manifest.js": `export const MANIFEST = [{ domain: 'demo2', actions: ['create'] }];\n`,
    });
    const r = await runMacroUsageDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "macro_zero_calls" && f.evidence?.domain === "demo2");
    assert.equal(hit, undefined, "manifest reach alone must suppress macro_zero_calls");
    // No actual dispatcher file exists — the per-file dispatcher_reach
    // finding is a distinct concept and must not fire from manifest reach.
    assert.equal(r.findings.filter((f) => f.id === "dispatcher_reach").length, 0);
  });

  it("FLAGS dispatcher_reach once per real open-dispatcher file", async () => {
    dir = await tmpRepo({
      "server/server.js": `register("demo", "create", (ctx) => {});\n`,
      "server/lib/open-dispatch.js": `// @macro-dispatcher\nrunMacro(domainVar, nameVar, {});\n`,
    });
    const r = await runMacroUsageDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "dispatcher_reach");
    assert.ok(hit, "a real @macro-dispatcher file must produce a dispatcher_reach finding");
    assert.equal(hit.severity, "info");
    assert.equal(hit.evidence.domainVar, "domainVar");
    assert.equal(hit.evidence.nameVar, "nameVar");
    assert.ok(hit.location.startsWith("server/lib/open-dispatch.js:"));
  });

  it("counts usage from a runMacro(...) call inside a /tests/ path file (usage scanning is NOT test-excluded, unlike registration scanning)", async () => {
    // Detector-specific edge case: `isTest` only gates whether a file's
    // register(...) calls populate the `declared` map — RUN_MACRO_RE and
    // LENS_RUN_BODY_RE scan every walked file regardless of path, so a
    // caller living under server/tests/ still counts as real usage.
    dir = await tmpRepo({
      "server/server.js": `register("demo3", "create", (ctx) => {});\n`,
      "server/tests/usage.js": `runMacro("demo3", "create", {});\n`,
    });
    const r = await runMacroUsageDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "macro_zero_calls" && f.evidence?.domain === "demo3");
    assert.equal(hit, undefined, "a test-file caller still counts as a real static usage");
  });

  it("counts usage from a { domain, name } lens-run payload shape, not just runMacro(...) calls", async () => {
    dir = await tmpRepo({
      "server/server.js": `register("demo4", "create", (ctx) => {});\n`,
      "concord-frontend/lib/caller.ts":
        `fetch("/api/lens/run", { body: JSON.stringify({ domain: "demo4", name: "create", input: {} }) });\n`,
    });
    const r = await runMacroUsageDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "macro_zero_calls" && f.evidence?.domain === "demo4");
    assert.equal(hit, undefined, "a { domain, name } payload shape counts as usage even without runMacro(...)");
  });

  it("does NOT flag (or even discover) a macro registered ONLY in server/domains/*.js — declaration scanning is intentionally server.js-only", async () => {
    // Not a bug: this mirrors the documented project-wide convention (see
    // domain-reachability-detector.js's header) that domains/ reachability
    // is a SEPARATE, dedicated concern from other detectors' scope. A macro
    // registered only inside a domains/ file never enters this detector's
    // `declared` map at all, so it produces neither a zero_calls finding
    // nor any other per-macro finding here — whether that domain file is
    // even wired up is domain-reachability-detector's job, not this one's.
    dir = await tmpRepo({
      "server/server.js": `// no register() calls in server.js at all\n`,
      "server/domains/demo5.js": `register("demo5", "create", (ctx) => {});\n`,
    });
    const r = await runMacroUsageDetector({ root: dir });
    const anyDemo5 = r.findings.filter((f) => f.evidence?.domain === "demo5");
    assert.equal(anyDemo5.length, 0, "a domains/-only registration must not appear as a declared macro in this detector");
    const summary = r.findings.find((f) => f.id === "macro_usage_summary");
    assert.equal(summary.evidence.declared, 0);
  });
});
