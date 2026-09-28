// server/lib/asset-gen/organic/providers.js
//
// Node → scripts/organic_gen_cli.py bridge. Same shape as
// lib/conkay/occ-bridge.js: execFile a venv Python with a JSON payload, read
// ONE JSON object back. The HF token is read from the environment or from
// ~/.zuko/secrets/huggingface.env at call time and passed only through the
// child's environment — never logged, never put on argv.

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../../scripts/organic_gen_cli.py");
const DEFAULT_PYTHON = path.join(os.homedir(), ".zuko", "venvs", "concord-gen", "bin", "python");
const SECRETS_FILE = path.join(os.homedir(), ".zuko", "secrets", "huggingface.env");
const TIMEOUT_MS = 10 * 60 * 1000;

export function resolvePython() {
  return process.env.CONCORD_GEN_PYTHON || DEFAULT_PYTHON;
}

const fsp = fs.promises;

export async function readHfToken() {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
  try {
    const line = (await fsp.readFile(SECRETS_FILE, "utf8")).split("\n").find((l) => l.startsWith("HF_TOKEN="));
    return line ? line.slice("HF_TOKEN=".length).trim() : null;
  } catch {
    return null;
  }
}

/** Run one CLI command; always resolves to a result object, never throws. */
export async function runGenCli(command, payload, { timeoutMs = TIMEOUT_MS } = {}) {
  const python = resolvePython();
  try { await fsp.access(python); } catch { return { ok: false, reason: "no_python_env", python }; }
  const token = await readHfToken();
  const env = { ...process.env, PYTHONUNBUFFERED: "1" };
  if (token) env.HF_TOKEN = token;
  return new Promise((resolve) => {
    execFile(python, [CLI, command, JSON.stringify(payload)], { env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // The result is the last JSON line; anything a library prints first is ignored.
        const line = String(stdout || "").trim().split("\n").reverse().find((l) => l.startsWith("{"));
        if (line) {
          try { return resolve({ ...JSON.parse(line), authenticated: !!token }); } catch { /* fall through */ }
        }
        resolve({
          ok: false,
          reason: err?.killed ? "timeout" : "cli_failed",
          error: String(err?.message || stderr || "no output").slice(0, 400),
        });
      });
  });
}

// ── local-gpu: Concord's own generation pod (engines/concord-gen-pod) ────────
// Reached over an SSH tunnel (CONCORD_GEN_URL, default 127.0.0.1:7870). Tried
// first; the Hugging Face path is only a fallback for when the pod is off or
// lacks the weights for a step — never for a real generation error, which is
// reported as-is.
const GEN_URL = () => (process.env.CONCORD_GEN_URL || "http://127.0.0.1:7870").replace(/\/$/, "");

async function localHealth() {
  try {
    // 3000ms used to be enough, but it produced a real, costly false
    // negative (2026-09-25): the gen server's /health handler never touches
    // the generation lock, but under sustained concurrent load (an
    // unattended batch loop hammering /concept while an interactive /mesh
    // call is also in flight) CPython's GIL can starve the /health thread
    // for several seconds at a time — the pod was genuinely up and serving,
    // this check just lost the race. That false "unreachable" fed straight
    // into generateMesh()'s local_gpu_unreachable fallback and silently
    // burned real HF ZeroGPU quota instead of using the pod that was right
    // there. 15s gives the health thread room to get scheduled under load
    // while still failing fast if the pod is actually down.
    const r = await fetch(`${GEN_URL()}/health`, { signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function localPost(route, body, timeoutMs) {
  try {
    const r = await fetch(`${GEN_URL()}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    return await r.json();
  } catch (err) {
    return { ok: false, reason: err?.name === "TimeoutError" ? "timeout" : "local_gpu_unreachable", error: String(err?.message || err) };
  }
}

const FALLBACK_REASONS = new Set(["local_gpu_unreachable", "weights_missing"]);

export async function generateConcept(payload) {
  if (await localHealth()) {
    // A warm FLUX call is ~6s; a cold load has been observed to take up to
    // ~20 minutes when the pod's network-mounted /workspace is under disk
    // contention (e.g. right after a heavy TRELLIS mesh batch) — both 5 and
    // 10 minutes have been hit in practice (2026-09-24/25), each time
    // aborting a request the server-side load was still going to complete
    // successfully seconds to minutes later. This does not fall back to the
    // HF CLI path on expiry ("timeout" isn't in FALLBACK_REASONS), so a low
    // value only wastes the wait and forces a retry, it never protects
    // anything.
    const r = await localPost("/concept", { prompt: payload.prompt, seed: payload.seed ?? 0, width: payload.width, height: payload.height }, 25 * 60 * 1000);
    if (r.ok) {
      await fsp.writeFile(payload.out, Buffer.from(r.png_b64, "base64"));
      return { ok: true, provider: r.provider, path: payload.out, format: "png", seconds: r.seconds };
    }
    if (!FALLBACK_REASONS.has(r.reason)) return r;
  }
  return runGenCli("concept", payload, { timeoutMs: 3 * 60 * 1000 });
}

export async function generateMesh(payload) {
  if (await localHealth()) {
    const image_b64 = (await fsp.readFile(payload.image)).toString("base64");
    const r = await localPost("/mesh", { image_b64, seed: payload.seed ?? 0 }, 20 * 60 * 1000);
    if (r.ok) {
      await fsp.writeFile(payload.out, Buffer.from(r.glb_b64, "base64"));
      return { ok: true, provider: r.provider, path: payload.out, faces: r.faces, seconds: r.seconds };
    }
    if (!FALLBACK_REASONS.has(r.reason)) return r;
  }
  return runGenCli("mesh", payload);
}

export { localHealth };
