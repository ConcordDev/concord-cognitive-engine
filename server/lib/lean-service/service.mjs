#!/usr/bin/env node
// server/lib/lean-service/service.mjs
//
// Lean 4 check service. Runs on the GPU pod next to the Lean + Mathlib install, NOT on the Mac.
//   POST /check  { lean_source, timeout_s }  ->  { ok, errors, warnings, elapsed_ms, rejected? }
//   GET  /health ->  { ok, queued, running, leanProject }
//
// Safety: refuses sources the shared policy rejects (sorry/admit/axioms/IO/#eval/...), compiles inside the
// Mathlib project with a hard wall-clock kill and a memory cap, one job at a time with a short queue, each job
// in its own temp dir that is removed afterwards. It binds 127.0.0.1 only (reach it through the SSH tunnel) and
// requires a bearer token when LEAN_SERVICE_TOKEN is set. It is not an OS sandbox: run it as an unprivileged
// user on a box that holds nothing else of value (the pod).
//
// Env: LEAN_SERVICE_PORT (11437), LEAN_PROJECT_DIR (/root/lean/concord_verify), LEAN_SERVICE_TOKEN,
//      LEAN_MAX_TIMEOUT_S (120), LEAN_QUEUE_MAX (8), LEAN_MEM_KB (8388608), LEAN_BIN_DIR (~/.elan/bin).

import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leanSourceIssues, theoremNames, axiomsVerdict } from "./policy.js";

const PORT = Number(process.env.LEAN_SERVICE_PORT || 11437);
const PROJECT = process.env.LEAN_PROJECT_DIR || "/root/lean/concord_verify";
const TOKEN = process.env.LEAN_SERVICE_TOKEN || "";
const MAX_TIMEOUT_S = Number(process.env.LEAN_MAX_TIMEOUT_S || 120);
const QUEUE_MAX = Number(process.env.LEAN_QUEUE_MAX || 8);
const MEM_KB = Number(process.env.LEAN_MEM_KB || 8 * 1024 * 1024);
const BIN_DIR = process.env.LEAN_BIN_DIR || `${process.env.HOME || "/root"}/.elan/bin`;

let running = false;
const queue = [];

function runLean(file, timeoutS) {
  return new Promise((resolve) => {
    // ulimit -v bounds memory; `timeout` is not relied on: we kill the whole process group ourselves.
    const child = spawn("bash", ["-c", `ulimit -v ${MEM_KB}; exec lake env lean "$LEAN_FILE"`], {
      cwd: PROJECT, detached: true,
      env: { PATH: `${BIN_DIR}:/usr/bin:/bin`, HOME: process.env.HOME || "/root", LEAN_FILE: file, LANG: "C.UTF-8" },
    });
    let out = ""; let timedOut = false;
    const cap = (d) => { if (out.length < 200_000) out += d; };
    child.stdout.on("data", cap); child.stderr.on("data", cap);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }, timeoutS * 1000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, timedOut }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e.message), timedOut: false, spawnError: true }); });
  });
}

async function check(source, timeoutS) {
  const t0 = Date.now();
  const issues = leanSourceIssues(source);
  if (issues.length) return { ok: false, errors: [], rejected: issues, elapsed_ms: Date.now() - t0 };
  const names = theoremNames(source);
  const full = `${source}\n${names.map((n) => `#print axioms ${n}`).join("\n")}\n`;
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), "lean-check-"));
    const file = join(dir, "Claim.lean");
    await writeFile(file, full, "utf8");
    const r = await runLean(file, timeoutS);
    const errors = r.out.split("\n").filter((l) => /error:/.test(l)).slice(0, 20);
    const warnings = r.out.split("\n").filter((l) => /warning:/.test(l)).slice(0, 20);
    if (r.timedOut) return { ok: false, errors: [`timed out after ${timeoutS}s`], warnings, elapsed_ms: Date.now() - t0, timed_out: true };
    if (r.spawnError) return { ok: false, errors: [r.out], warnings, elapsed_ms: Date.now() - t0, unavailable: true };
    const ax = axiomsVerdict(r.out);
    const usesSorry = /declaration uses 'sorry'|sorryAx/.test(r.out);
    const ok = r.code === 0 && errors.length === 0 && !usesSorry && ax.ok && (names.length === 0 || ax.seen > 0);
    return {
      ok, errors: ok ? [] : (errors.length ? errors : [usesSorry ? "proof uses sorry" : ax.ok ? "no axiom report; not accepted" : `non-standard axioms: ${ax.extra.join(", ")}`]),
      warnings, axioms: { ok: ax.ok, extra: ax.extra }, elapsed_ms: Date.now() - t0,
    };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function pump() {
  if (running || !queue.length) return;
  running = true;
  const job = queue.shift();
  check(job.source, job.timeoutS).then(job.resolve, (e) => job.resolve({ ok: false, errors: [String(e?.message || e)], elapsed_ms: 0 })).finally(() => { running = false; pump(); });
}

const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

const server = http.createServer((req, res) => {
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { ok: false, error: "unauthorized" });
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, queued: queue.length, running, leanProject: PROJECT });
  if (req.method !== "POST" || req.url !== "/check") return send(res, 404, { ok: false, error: "not found" });
  let body = ""; let tooBig = false;
  req.on("data", (d) => { body += d; if (body.length > 64_000) { tooBig = true; req.destroy(); } });
  req.on("end", () => {
    if (tooBig) return;
    let j;
    try { j = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: "invalid JSON" }); }
    if (typeof j.lean_source !== "string") return send(res, 400, { ok: false, error: "lean_source required" });
    if (queue.length >= QUEUE_MAX) return send(res, 429, { ok: false, error: "queue full", queued: queue.length });
    const timeoutS = Math.min(MAX_TIMEOUT_S, Math.max(1, Number(j.timeout_s) || 30));
    new Promise((resolve) => { queue.push({ source: j.lean_source, timeoutS, resolve }); pump(); }).then((r) => send(res, 200, r));
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`lean-check listening on 127.0.0.1:${PORT} project=${PROJECT}`));
