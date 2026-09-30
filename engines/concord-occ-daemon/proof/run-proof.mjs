// Concurrency Refactor Phase 2 proof — warm OCC daemon vs cold execFile.
//
// Simulates occ-bridge.js under a burst: N feature-rebuild-class OCC jobs fired
// back-to-back. Measures, from Node's side:
//   - total wall time
//   - max concurrent python processes (the "stacking" the audit flagged)
//   - max Node event-loop lag during the burst
//
//   node engines/concord-occ-daemon/proof/run-proof.mjs
//
// Writes ~/.zuko/remaining-work/conkay-occ-daemon-proof.json

import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const execFileP = promisify(execFile);
const execP = promisify(exec);

const HOME = os.homedir();
const PYTHON = path.join(HOME, ".zuko", "venvs", "cad-occ", "bin", "python");
const CLI = path.join(HOME, ".zuko", "venvs", "cad-occ", "bin", "conkay_occ_cli.py");
const SOCK =
  process.env.CONCORD_OCC_DAEMON_SOCK ||
  path.join(HOME, "concord", "run", "concord-occ-daemon.sock");

const N = 8; // burst size
const TMP = path.join(os.tmpdir(), "occ-proof");
fs.mkdirSync(TMP, { recursive: true });

// A real OCC job: sketch a rectangle, extrude, fillet — the feature_rebuild path.
function jobPayload(i) {
  return {
    partId: `proof_${i}`,
    features: [
      { op: "box", params: { dx: 10 + i, dy: 8, dz: 4 } },
      { op: "fillet", params: { radius: 0.5 } },
    ],
    out: path.join(TMP, `proof_${i}.step`),
    name: `proof_${i}`,
    include_mesh: false,
  };
}

function daemonCall(cmd, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ cmd, payload, timeoutMs: 60000 });
    const req = http.request(
      { socketPath: SOCK, path: "/v1/occ", method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (res) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve(JSON.parse(Buffer.concat(c).toString()))); },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function countPythonProcs() {
  try {
    const { stdout } = await execP(`pgrep -f conkay_occ_cli | wc -l`);
    return parseInt(stdout.trim(), 10) || 0;
  } catch { return 0; }
}

function startLagSampler() {
  const want = 20;
  let last = performance.now();
  let max = 0;
  const t = setInterval(() => {
    const now = performance.now();
    const lag = now - last - want;
    if (lag > max) max = lag;
    last = now;
  }, want);
  return { stop: async () => { await new Promise((r) => setTimeout(r, 60)); clearInterval(t); return Math.round(max); } };
}

async function measure(label, fireAll) {
  await new Promise((r) => setTimeout(r, 300));
  let maxProcs = 0;
  const procWatch = setInterval(async () => {
    const c = await countPythonProcs();
    if (c > maxProcs) maxProcs = c;
  }, 40);
  const lag = startLagSampler();
  const t0 = performance.now();
  const results = await fireAll();
  const wallMs = Math.round(performance.now() - t0);
  const maxLagMs = await lag.stop();
  clearInterval(procWatch);
  const ok = results.filter((r) => r && r.ok).length;
  console.log(`  ${label}: wall=${wallMs}ms  ok=${ok}/${N}  maxConcurrentPython=${maxProcs}  maxEventLoopLag=${maxLagMs}ms`);
  return { wallMs, ok, total: N, maxConcurrentPython: maxProcs, maxLagMs };
}

async function main() {
  let daemonUp = false;
  try {
    const h = await new Promise((resolve, reject) => {
      const req = http.request({ socketPath: SOCK, path: "/v1/health", method: "GET" }, (res) => {
        const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve(JSON.parse(Buffer.concat(c).toString())));
      });
      req.on("error", reject); req.end();
    });
    daemonUp = h?.ok === true;
  } catch { daemonUp = false; }
  if (!daemonUp) { console.error("FAIL: occ-daemon not reachable at", SOCK); process.exit(1); }

  console.log(`Concord OCC daemon proof — burst of ${N} feature-rebuild jobs\n`);

  // COLD: what occ-bridge.js did — execFile a fresh python+OCP per job, in parallel
  const cold = await measure("COLD execFile per job (pre-refactor)", async () =>
    Promise.all(
      Array.from({ length: N }, (_, i) =>
        execFileP(PYTHON, [CLI, "feature_rebuild", JSON.stringify(jobPayload(i))], {
          timeout: 60000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PYTHONUNBUFFERED: "1" },
        })
          .then(({ stdout }) => { const l = String(stdout).trim().split("\n").filter((x) => x.startsWith("{")); return JSON.parse(l[l.length - 1] || "{}"); })
          .catch((e) => ({ ok: false, error: String(e).slice(0, 120) })),
      ),
    ),
  );

  // WARM: via the daemon — one process, serialised
  const warm = await measure("WARM via occ-daemon (post-refactor)", async () =>
    Promise.all(Array.from({ length: N }, (_, i) => daemonCall("feature_rebuild", jobPayload(i)).catch((e) => ({ ok: false, error: String(e).slice(0, 120) })))),
  );

  const result = {
    phase: "2",
    audit_finding: "OCC execFile 60s stacking",
    generated: new Date().toISOString(),
    host: os.hostname(),
    socket: SOCK,
    burst: N,
    cold_execfile: cold,
    warm_daemon: warm,
    process_stacking_eliminated: cold.maxConcurrentPython > warm.maxConcurrentPython,
    notes: [
      "COLD spawns one python+OCP (~0.7s import) per job, all at once → process stacking + memory spike.",
      "WARM routes every job through one long-lived process; OCC work serialised (kernel is not reentrant).",
      "maxConcurrentPython for WARM should be ~0 (the daemon's python isn't matched by the conkay_occ_cli pgrep).",
    ],
    verdict:
      warm.ok === N && cold.maxConcurrentPython > warm.maxConcurrentPython
        ? "PASS — daemon serves the whole burst with no per-job process spawn; cold path stacked " + cold.maxConcurrentPython + " python procs"
        : "REVIEW — see numbers",
  };

  const outDir = path.join(HOME, ".zuko", "remaining-work");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "conkay-occ-daemon-proof.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(`\n${result.verdict}\n→ ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
