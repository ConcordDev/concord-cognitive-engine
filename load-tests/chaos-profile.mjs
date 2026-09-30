#!/usr/bin/env node
// load-tests/chaos-profile.mjs
//
// Spawns a throwaway Concord instance with V8's CPU profiler (`--cpu-prof`) on a
// scratch port + DB, storms it with the combinatorial mix, SIGINTs it (flushes
// the profile), then prints the top self-time functions — the ranked ledger of
// where the single thread actually spends its time under load.
//
//   node load-tests/chaos-profile.mjs            # 200 conc, 20s
//   CONC=400 DUR=30 node load-tests/chaos-profile.mjs
//
// Writes ~/.zuko/remaining-work/concord-cpu-profile-top.json + the raw .cpuprofile.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;
const CONC = Number(process.env.CONC || 200);
const DUR_MS = Number(process.env.DUR || 20) * 1000;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "concord-prof-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`profiled instance → :${PORT}, scratch DB in ${TMP}`);
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(PORT),
    DB_PATH: path.join(TMP, "concord.db"),
    STATE_PATH: path.join(TMP, "state.json"),
    JWT_SECRET: "chaos-profile-not-a-secret-but-long-enough-32chars-xxxxxx",
    SESSION_SECRET: "chaos-profile-session-secret-also-long-enough-xxxxxxxx",
    ADMIN_PASSWORD: "ChaosProfileAdmin!12345",
    ALLOWED_ORIGINS: `http://127.0.0.1:${PORT}`,
    CONCORD_NO_LISTEN: "false",
    // keep the sidecars out of it so the profile is pure in-process cost
    CONCORD_DTU_SIDECAR: "0",
    CONCORD_OCC_DAEMON_DISABLE: "1",
    CONCORD_DISABLE_GHOST_FLEET: "true",
    CONCORD_TRACE_DEBUG: "false",
  };
  const child = spawn("node", ["--cpu-prof", `--cpu-prof-dir=${TMP}`, "--cpu-prof-name=chaos.cpuprofile", path.join(REPO, "server/server.js")], {
    env, cwd: path.join(REPO, "server"), stdio: ["ignore", "pipe", "pipe"],
  });
  let booted = false;
  child.stdout.on("data", (d) => { if (/Server started in production mode|listening on|Concord Started/i.test(String(d))) booted = true; });
  child.stderr.on("data", (d) => { if (/Server started in production mode|Concord Started/i.test(String(d))) booted = true; });

  let lastErr = "";
  child.stderr.on("data", (d) => { lastErr = String(d).slice(-400); });
  for (let i = 0; i < 150 && !booted; i++) {
    await sleep(1000);
    try { const r = await fetch(`${BASE}/api/system/health`, { signal: AbortSignal.timeout(2000) }); if (r.status) booted = true; } catch {}
  }
  if (!booted) { child.kill("SIGKILL"); throw new Error("profiled instance did not boot in 150s. last stderr: " + lastErr); }
  console.log("booted. seeding ~3000 DTUs …");

  // register + login
  const reg = await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "chaos", email: "chaos@x.dev", password: "Chaos!12345x", dateOfBirth: "1990-01-01" }) }).then((r) => r.json()).catch(() => ({}));
  let token = reg.token;
  if (!token) {
    const lj = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "chaos", password: "Chaos!12345x" }) }).then((r) => r.json()).catch(() => ({}));
    token = lj.token;
  }
  const H = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  for (let b = 0; b < 30; b++) {
    await Promise.all(Array.from({ length: 100 }, (_, i) => fetch(`${BASE}/api/lens/run`, {
      method: "POST", headers: H,
      body: JSON.stringify({ domain: "dtu", name: "create", input: { title: `chaos dtu ${b * 100 + i}`, content: "x".repeat(400), tags: ["chaos"] } }),
    }).catch(() => {})));
  }
  console.log("seeded. storming …");

  // storm
  const mix = [
    { domain: "dtu", name: "list", input: { limit: 50 } },
    { domain: "dtu", name: "stats", input: {} },
    { domain: "accounting", name: "trialBalance", input: {} },
    { domain: "goals", name: "list", input: {} },
    { domain: "astronomy", name: "apod", input: {} },
  ];
  let running = true;
  const worker = async () => {
    while (running) {
      const m = mix[(Math.random() * mix.length) | 0];
      await fetch(`${BASE}/api/lens/run`, { method: "POST", headers: H, body: JSON.stringify(m), signal: AbortSignal.timeout(30000) }).then((r) => r.arrayBuffer()).catch(() => {});
    }
  };
  const workers = Array.from({ length: CONC }, () => worker());
  await sleep(DUR_MS);
  running = false;
  await Promise.allSettled(workers);
  console.log("storm done. flushing profile …");

  // SIGINT → node writes the .cpuprofile
  child.kill("SIGINT");
  for (let i = 0; i < 30; i++) { await sleep(500); if (!isAlive(child)) break; }
  if (isAlive(child)) child.kill("SIGKILL");
  await sleep(500);

  const prof = path.join(TMP, "chaos.cpuprofile");
  if (!fs.existsSync(prof)) {
    const found = fs.readdirSync(TMP).find((f) => f.endsWith(".cpuprofile"));
    if (found) fs.renameSync(path.join(TMP, found), prof);
  }
  if (!fs.existsSync(prof)) throw new Error("no .cpuprofile written");

  // ---- rank self-time by function ----
  const p = JSON.parse(fs.readFileSync(prof, "utf8"));
  const nodeById = new Map(p.nodes.map((n) => [n.id, n]));
  const selfSamples = new Map(); // nodeId -> count
  for (const id of p.samples) selfSamples.set(id, (selfSamples.get(id) || 0) + 1);
  const byFn = new Map();
  for (const [id, cnt] of selfSamples) {
    const n = nodeById.get(id); if (!n) continue;
    const cf = n.callFrame;
    const key = `${cf.functionName || "(anonymous)"}  ${shorten(cf.url)}:${cf.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) || 0) + cnt);
  }
  const total = p.samples.length;
  const ranked = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
    .map(([fn, cnt]) => ({ pct: +((cnt / total) * 100).toFixed(1), samples: cnt, fn }));

  console.log(`\n─── top self-time (of ${total} samples, ${CONC} concurrent) ───`);
  for (const r of ranked) console.log(`  ${String(r.pct).padStart(5)}%  ${r.fn}`);

  // category rollup
  const cat = { sqlite: 0, jsonParse: 0, jsonStringify: 0, crypto: 0, gc: 0, regexp: 0, node_internal: 0, concord: 0, other: 0 };
  for (const [fn, cnt] of byFn) {
    const l = fn.toLowerCase();
    if (/better.?sqlite|\.prepare|\.get\b|\.run\b|\.all\b|db\./.test(l)) cat.sqlite += cnt;
    else if (/json.*parse|parse.*json/.test(l)) cat.jsonParse += cnt;
    else if (/json.*stringify|stringify/.test(l)) cat.jsonStringify += cnt;
    else if (/hash|hmac|crypto|jwt|sign|verify|pbkdf|scrypt|bcrypt/.test(l)) cat.crypto += cnt;
    else if (/\bgc\b|garbage|scavenge|mark.?compact/.test(l)) cat.gc += cnt;
    else if (/regexp|\.test\b|\.exec\b|\.match\b/.test(l)) cat.regexp += cnt;
    else if (/node:internal|internal\//.test(l)) cat.node_internal += cnt;
    else if (/server\.js|server\/lib|server\/domains|server\/routes/.test(l)) cat.concord += cnt;
    else cat.other += cnt;
  }
  console.log(`\n─── category rollup (self-time %) ───`);
  for (const [k, v] of Object.entries(cat).sort((a, b) => b[1] - a[1])) console.log(`  ${String(+((v / total) * 100).toFixed(1)).padStart(5)}%  ${k}`);

  const outDir = path.join(os.homedir(), ".zuko/remaining-work");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "concord-cpu-profile-top.json"), JSON.stringify({ concurrency: CONC, totalSamples: total, top: ranked, categories: Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, +((v / total) * 100).toFixed(1)])) }, null, 2) + "\n");
  fs.copyFileSync(prof, path.join(outDir, "concord-chaos.cpuprofile"));
  console.log(`\n→ ${path.join(outDir, "concord-cpu-profile-top.json")}  (+ .cpuprofile)`);

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
function isAlive(c) { try { process.kill(c.pid, 0); return true; } catch { return false; } }
function shorten(u) { return String(u || "").replace(/^.*\/concord-cognitive-engine\//, "").replace(/^node:/, "node:").replace(/^file:\/\//, ""); }
main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
