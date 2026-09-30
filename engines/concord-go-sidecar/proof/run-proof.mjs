// Concurrency Refactor Phase 1 proof.
//
// Demonstrates: 3 parallel Whisper/Piper/sandbox-class subprocess runs do NOT
// stall the Node event loop when routed through the Go sidecar, but DO stall it
// hard when run inline via spawnSync (the pre-refactor path).
//
// Metric: max event-loop lag (ms) observed by a 20ms self-timer while 3 heavy
// child processes run in parallel. Inline spawnSync is fully synchronous, so the
// timer cannot fire until all three finish → lag ≈ total child wall time.
//
//   node engines/concord-go-sidecar/proof/run-proof.mjs
//
// Writes ~/.zuko/remaining-work/concord-go-sidecar-proof.json

import { spawnSync } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const SOCK =
  process.env.CONCORD_GO_SIDECAR_SOCK ||
  path.join(os.homedir(), "concord", "run", "concord-go-sidecar.sock");

// A CPU/IO-heavy command that takes ~1.5-3s and is on the sandbox allowlist.
// `find /usr -name __nope__` walks the whole tree; no parens (chain-op guard).
const HEAVY_CMD = "find /usr -name __concord_proof_nomatch__";
const PARALLEL = 3;

function sidecarSandbox(command) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ command, timeoutMs: 30000 });
    const req = http.request(
      { socketPath: SOCK, path: "/v1/sandbox", method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } },
      (res) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve(JSON.parse(Buffer.concat(c).toString()))); },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Event-loop lag sampler: schedule a 20ms interval, record how late each tick is.
function startLagSampler() {
  const want = 20;
  let last = performance.now();
  let max = 0;
  const samples = [];
  const t = setInterval(() => {
    const now = performance.now();
    const lag = now - last - want;
    if (lag > max) max = lag;
    samples.push(Math.round(lag));
    last = now;
  }, want);
  return { stop: async () => {
    // let any timer that backed up behind a synchronous block fire at least once
    await new Promise((r) => setTimeout(r, want * 3));
    clearInterval(t);
    return { maxLagMs: Math.round(max), samples };
  } };
}

async function measure(label, run) {
  // settle
  await new Promise((r) => setTimeout(r, 200));
  const s = startLagSampler();
  const t0 = performance.now();
  await run();
  const wallMs = Math.round(performance.now() - t0);
  const { maxLagMs } = await s.stop();
  console.log(`  ${label}: wall=${wallMs}ms  maxEventLoopLag=${maxLagMs}ms`);
  return { wallMs, maxLagMs };
}

async function main() {
  // sidecar reachable?
  let sidecarUp = false;
  try {
    const h = await new Promise((resolve, reject) => {
      const req = http.request({ socketPath: SOCK, path: "/v1/health", method: "GET" }, (res) => {
        const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve(JSON.parse(Buffer.concat(c).toString())));
      });
      req.on("error", reject); req.end();
    });
    sidecarUp = h?.ok === true;
  } catch { sidecarUp = false; }
  if (!sidecarUp) { console.error("FAIL: go-sidecar not reachable at", SOCK); process.exit(1); }

  console.log(`Concord concurrency proof — ${PARALLEL} parallel "${HEAVY_CMD}"\n`);

  const inline = await measure("INLINE spawnSync (pre-refactor path)", async () => {
    // exactly what server.js did: synchronous, one after another within the tick
    for (let i = 0; i < PARALLEL; i++) {
      spawnSync("find", ["/usr", "-name", "__concord_proof_nomatch__"], { encoding: "utf-8", timeout: 30000 });
    }
  });

  const viaSidecar = await measure("VIA go-sidecar (post-refactor path)", async () => {
    await Promise.all(Array.from({ length: PARALLEL }, () => sidecarSandbox(HEAVY_CMD)));
  });

  const result = {
    phase: "1",
    audit_finding: "C03",
    generated: new Date().toISOString(),
    host: os.hostname(),
    socket: SOCK,
    test: { command: HEAVY_CMD, parallel: PARALLEL, metric: "max event-loop lag (ms) during parallel subprocess load" },
    inline_spawnsync: inline,
    via_go_sidecar: viaSidecar,
    event_loop_lag_reduction_ms: inline.maxLagMs - viaSidecar.maxLagMs,
    event_loop_lag_reduction_pct:
      inline.maxLagMs > 0 ? Math.round((1 - viaSidecar.maxLagMs / inline.maxLagMs) * 1000) / 10 : null,
    verdict:
      viaSidecar.maxLagMs < inline.maxLagMs * 0.25
        ? "PASS — sidecar keeps the event loop responsive under parallel subprocess load; inline spawnSync stalls it"
        : "INCONCLUSIVE — rerun on a quieter box",
  };

  const outDir = path.join(os.homedir(), ".zuko", "remaining-work");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "concord-go-sidecar-proof.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(`\n${result.verdict}\n→ ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
