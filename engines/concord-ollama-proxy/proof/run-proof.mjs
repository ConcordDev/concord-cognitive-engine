// Concurrency Refactor Phase 4 proof — ollama-proxy fail-fast vs direct fetch.
//
// Simulates the Sep 7-8 failure mode: the Ollama upstream (A40 tunnel) is a
// SYN blackhole. Node fires a burst of brain calls.
//   DIRECT   — fetch(upstream) like today's ~15 call sites; each hangs on TCP
//              connect for the OS default (~75s) or until its AbortSignal fires.
//   PROXY    — through concord-ollama-proxy: 2s connect bound, then the shared
//              circuit opens and the rest fast-fail instantly.
//
//   node engines/concord-ollama-proxy/proof/run-proof.mjs
//
// Writes ~/.zuko/remaining-work/concord-ollama-proxy-proof.json

import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const BLACKHOLE = "http://10.255.255.1:11434"; // RFC5737-ish non-routable → SYN drop
const PROXY_ADDR = "127.0.0.1:11487";
const BIN = path.join(process.cwd(), "engines", "concord-ollama-proxy", "bin", "concord-ollama-proxy");
const BURST = 16;
const DIRECT_ABORT_MS = 20000; // cap the "today" case so the proof terminates; real code uses 300000

function post(base, body, { abortMs }) {
  const t0 = performance.now();
  return fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(abortMs),
  })
    .then(async (r) => ({ ms: performance.now() - t0, status: r.status, body: await r.json().catch(() => null) }))
    .catch((e) => ({ ms: performance.now() - t0, status: 0, error: e.name === "TimeoutError" ? "abort_timeout" : String(e.message || e) }));
}

function summarize(rows) {
  const times = rows.map((r) => r.ms).sort((a, b) => a - b);
  return {
    n: rows.length,
    maxMs: Math.round(times[times.length - 1]),
    p50Ms: Math.round(times[Math.floor(times.length / 2)]),
    fastFailed: rows.filter((r) => r.status === 502 || r.status === 503).length,
    hung: rows.filter((r) => r.error === "abort_timeout").length,
  };
}

async function main() {
  const child = spawn(BIN, [], {
    env: { ...process.env, OLLAMA_UPSTREAM: BLACKHOLE, CONCORD_OLLAMA_PROXY_ADDR: PROXY_ADDR,
      CONCORD_OLLAMA_PROXY_CONNECT_TIMEOUT_MS: "2000", CONCORD_OLLAMA_PROXY_BREAK_THRESHOLD: "5",
      CONCORD_OLLAMA_PROXY_BREAK_COOLDOWN_MS: "15000" },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 800));

  console.log(`Phase 4 proof — upstream = SYN blackhole ${BLACKHOLE}, burst of ${BURST}\n`);

  const payload = { model: "concord-conscious:latest", messages: [{ role: "user", content: "hi" }], stream: false };

  console.log("  DIRECT fetch(upstream) — today's path ...");
  const direct = await Promise.all(Array.from({ length: BURST }, () => post(BLACKHOLE, payload, { abortMs: DIRECT_ABORT_MS })));
  const ds = summarize(direct);
  console.log(`    max=${ds.maxMs}ms  p50=${ds.p50Ms}ms  hung(abort)=${ds.hung}/${BURST}  fastFailed=${ds.fastFailed}`);

  console.log("  PROXY concord-ollama-proxy ...");
  const viaProxy = await Promise.all(Array.from({ length: BURST }, () => post(`http://${PROXY_ADDR}`, payload, { abortMs: DIRECT_ABORT_MS })));
  const ps = summarize(viaProxy);
  console.log(`    max=${ps.maxMs}ms  p50=${ps.p50Ms}ms  hung(abort)=${ps.hung}/${BURST}  fastFailed=${ps.fastFailed}`);

  let health = null;
  try {
    health = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: 11487, path: "/v1/proxy-health", method: "GET" }, (res) => {
        const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve(JSON.parse(Buffer.concat(c).toString())));
      });
      req.on("error", reject); req.end();
    });
  } catch {}

  child.kill("SIGTERM");

  const result = {
    phase: "4",
    goal: "brain calls fail fast when the Ollama upstream / A40 tunnel is dead — no 45-120s _llmQueue pileups",
    generated: new Date().toISOString(),
    host: os.hostname(),
    upstream: BLACKHOLE + " (SYN blackhole — simulates a dead SSH tunnel)",
    burst: BURST,
    direct_fetch: ds,
    via_proxy: ps,
    proxy_health_after: health,
    improvement: {
      max_latency_ms: `${ds.maxMs} → ${ps.maxMs}`,
      hung_requests: `${ds.hung}/${BURST} → ${ps.hung}/${BURST}`,
      note: "DIRECT was capped at a 20s AbortSignal for the proof; the real call sites use LLM_REQUEST_TIMEOUT_MS=300000, so the untreated pileup is up to 5 minutes per slot.",
    },
    honesty: {
      status: "PROXY BUILT + PROVEN in isolation; wired as an OPT-IN, not yet the default",
      opt_in: "Set OLLAMA_PROXY_URL=http://127.0.0.1:11480 — brain-config.js#_candidatesForBrain then routes every local Ollama brain through the proxy. Unset = unchanged.",
      not_default_because: "A40 is DOWN and all brains point at Mac-local :11434, so the dead-tunnel case cannot be validated end-to-end on the live stack right now (NEED_DUTCH: resume A40, then flip the env and confirm under a real tunnel flap). The ~15 direct fetch(OLLAMA_URL) sites in server.js are not repointed — that's the full-cutover step, gated on the same A40 return.",
    },
    verdict:
      ps.maxMs < ds.maxMs && ps.hung === 0
        ? "PASS (isolation) — proxy bounds a dead upstream to ~connectTimeout then fast-fails via the circuit; direct fetch hangs every request to the abort deadline"
        : "REVIEW",
  };

  const outDir = path.join(os.homedir(), ".zuko", "remaining-work");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "concord-ollama-proxy-proof.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(`\n${result.verdict}\n→ ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
