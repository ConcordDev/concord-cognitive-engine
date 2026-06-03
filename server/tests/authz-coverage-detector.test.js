// tests/authz-coverage-detector.test.js
//
// Proves the authz detector asserts the REAL invariant of this codebase's
// centralized-gate auth model — and crucially that it does NOT regress to the
// per-route false-positive model that flagged 40+ globally-gated routes. Pins:
//   • gate present + routes after the mount → no per-route findings (the false
//     positive we explicitly fixed).
//   • gate REMOVED from a monolith → one critical (the regression sentinel).
//   • a mutating route registered BEFORE the mount → high (escapes the gate).
//   • each non-infra write-auth bypass path → high (baseline pins them; a NEW
//     bypass blocks for review).
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runAuthzCoverageDetector,
  globalWriteGateMountLine,
  parseWriteAuthBypass,
} from "../lib/detectors/authz-coverage-detector.js";

async function tmpRepoWithServer(serverJs) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "authz-"));
  await mkdir(path.join(dir, "server"), { recursive: true });
  await writeFile(path.join(dir, "server", "server.js"), serverJs, "utf8");
  return dir;
}
const ids = (r) => r.findings.map((f) => f.id);

// A minimal server.js with the global write-auth gate and N routes after it.
function gatedServer(extraRoutes = "", bypass = `["/health", "/api/auth/login"]`) {
  const lines = [
    `const WRITE_AUTH_PUBLIC_PATHS = ${bypass};`,
    `function productionWriteAuthMiddleware(req, res, next) {`,
    `  if (req.user?.id) return next();`,
    `  return res.status(401).json({ ok: false, code: "PROD_WRITE_AUTH" });`,
    `}`,
    `app.use(productionWriteAuthMiddleware);  // global mount`,
  ];
  // 20 routes after the mount so the monolith heuristic engages.
  for (let i = 0; i < 22; i++) lines.push(`app.post("/api/x${i}", (req, res) => res.json({}));`);
  lines.push(extraRoutes);
  return lines.join("\n");
}

describe("authz-coverage detector — pure helpers", () => {
  it("finds the global gate mount line (wiring, not the definition)", () => {
    const src = "function productionWriteAuthMiddleware(){}\nx\napp.use(productionWriteAuthMiddleware);";
    assert.equal(globalWriteGateMountLine(src), 3);
  });
  it("parses the write-auth bypass allowlist", () => {
    assert.deepEqual(parseWriteAuthBypass(`const WRITE_AUTH_PUBLIC_PATHS = ["/a", "/b/c"];`), ["/a", "/b/c"]);
    assert.equal(parseWriteAuthBypass(`no allowlist here`), null);
  });
});

describe("authz-coverage detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("does NOT emit per-route findings when routes are behind the global gate (the fixed false positive)", async () => {
    dir = await tmpRepoWithServer(gatedServer());
    const r = await runAuthzCoverageDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(ids(r).includes("authz_gap_unguarded_mutation"), false, "must not flag globally-gated routes");
    assert.equal(ids(r).includes("authz_central_gate_ok"), true, "should confirm the gate covers the routes");
    const gateOk = r.findings.find((f) => f.id === "authz_central_gate_ok");
    assert.ok(gateOk.evidence.gated >= 22, "all post-mount routes counted as gated");
  });

  it("FIRES critical when a route-dense monolith has LOST its global write gate", async () => {
    // Same routes, but no productionWriteAuthMiddleware anywhere.
    const routes = Array.from({ length: 25 }, (_, i) => `app.post("/api/x${i}", (req,res)=>res.json({}));`).join("\n");
    dir = await tmpRepoWithServer(routes);
    const r = await runAuthzCoverageDetector({ root: dir });
    const crit = r.findings.filter((f) => f.severity === "critical");
    assert.equal(crit.length, 1, "missing global gate on a monolith = one critical");
    assert.equal(crit[0].id, "authz_global_write_gate_missing");
  });

  it("FIRES high on a mutating route registered BEFORE the gate mounts", async () => {
    // A route ABOVE the productionWriteAuthMiddleware mount escapes it.
    const early = [
      `app.post("/api/early-escape", (req,res)=>res.json({}));  // before the gate`,
      gatedServer(),
    ].join("\n");
    dir = await tmpRepoWithServer(early);
    const r = await runAuthzCoverageDetector({ root: dir });
    const before = r.findings.filter((f) => f.id === "authz_route_before_global_gate");
    assert.ok(before.length >= 1, "pre-mount route must be flagged");
    assert.equal(before[0].severity, "high");
  });

  it("flags each non-infra write-auth bypass (baseline pins them; a new one blocks)", async () => {
    dir = await tmpRepoWithServer(gatedServer("", `["/health", "/api/auth/login", "/api/chat", "/api/lens"]`));
    const r = await runAuthzCoverageDetector({ root: dir });
    const bypass = r.findings.filter((f) => f.id === "authz_write_auth_bypass");
    const paths = bypass.map((f) => f.evidence.bypassPath).sort();
    assert.deepEqual(paths, ["/api/chat", "/api/lens"], "infra paths excluded; real bypasses flagged");
    assert.ok(bypass.every((f) => f.severity === "high"));
  });
});
