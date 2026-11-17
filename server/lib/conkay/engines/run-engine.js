/**
 * runEngine / runProcessKernel — SXE-00 (ConKay solver catalogue, Wave 0).
 *
 * The only way a solver reaches an external engine. Contract:
 *
 *   - The request is schema-validated BEFORE anything spawns; a malformed
 *     request is refused, never passed through.
 *   - An absent engine is NOT_COMPUTED `engine_unavailable:<id>` with the
 *     manifest's install hint — never a fallback number labelled as the
 *     engine's result.
 *   - A crashed/timed-out engine is FAIL `engine_failed:<id>:<detail>`;
 *     garbled stdout (unparseable, or failing the op's result schema —
 *     including a non-finite number) is rejected the same way.
 *   - A result declaring `converged: false` is NOT_COMPUTED
 *     `engine_not_converged` and carries its residuals.
 *   - Results are cached by kernel-script hash + canonical request, so
 *     the same request against the same kernel bytes is the same run;
 *     changing the kernel script is a new run.
 *   - Provenance on every result: engine id + pinned version + kernel hash.
 *   - Resource caps are enforced on the child: wall-time timeout, thread
 *     caps via env, and a bounded scratch directory.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEngine } from "./manifest.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;

const cache = new Map();
const kernelHashCache = new Map();

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Stable stringify: object keys sorted recursively, so key order never changes a cache key. */
export function canonicalRequest(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalRequest).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalRequest(value[k])}`).join(",")}}`;
}

export function resolveEngineBinary(entry, env = process.env) {
  const candidate = env[entry.envVar] || entry.defaultPath;
  return candidate && existsSync(candidate) ? candidate : null;
}

export function kernelHash(entry) {
  let st;
  try {
    st = statSync(entry.kernel);
  } catch {
    return null;
  }
  const hit = kernelHashCache.get(entry.kernel);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.hash;
  let hash = null;
  try {
    hash = sha256(readFileSync(entry.kernel));
  } catch {
    hash = null;
  }
  kernelHashCache.set(entry.kernel, { mtimeMs: st.mtimeMs, size: st.size, hash });
  return hash;
}

function typeOk(value, type) {
  switch (type) {
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return value != null && typeof value === "object" && !Array.isArray(value);
    default: return true;
  }
}

/** Validate `obj` against a {field: type} spec; returns a list of violations. */
export function validateAgainstSpec(obj, spec, label) {
  const violations = [];
  if (!spec) return violations;
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
    return [`${label}: must be an object`];
  }
  for (const [field, type] of Object.entries(spec)) {
    if (!(field in obj)) violations.push(`${label}.${field}: missing (expected ${type})`);
    else if (!typeOk(obj[field], type)) violations.push(`${label}.${field}: expected ${type}`);
  }
  return violations;
}

function baseResult(entry, hash) {
  return {
    provenance: entry
      ? { engine: entry.id, version: entry.version, kernelHash: hash ?? null }
      : { engine: null, version: null, kernelHash: null },
    failures: [],
  };
}

export async function runProcessKernel(entry, op, request, opts = {}) {
  const started = Date.now();
  const hash = kernelHash(entry);
  const done = (r) => ({ ...baseResult(entry, hash), runtimeMs: Date.now() - started, ...r });

  if (!entry.ops.includes(op)) {
    return done({ status: "FAIL", reason: `engine_unknown_op:${entry.id}:${op}`,
      failures: [`op "${op}" is not declared in the manifest for engine ${entry.id}`] });
  }
  const opSpec = entry.opSchemas?.[op] || {};
  const reqViolations = validateAgainstSpec(request, opSpec.request, "request");
  if (reqViolations.length) {
    return done({ status: "FAIL", reason: `engine_request_invalid:${entry.id}`,
      failures: reqViolations });
  }

  const binary = resolveEngineBinary(entry, opts.env ?? process.env);
  if (!binary) {
    return done({ status: "NOT_COMPUTED", reason: `engine_unavailable:${entry.id}`,
      failures: [`engine ${entry.id} is not installed. ${entry.installHint}`] });
  }
  if (hash == null) {
    return done({ status: "FAIL", reason: `engine_failed:${entry.id}:kernel script unreadable: ${entry.kernel}`,
      failures: [`kernel script unreadable: ${entry.kernel}`] });
  }

  const timeoutMs = opts.timeoutMs ?? entry.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const threads = entry.footprint?.threads ?? 1;
  const scratch = mkdtempSync(join(tmpdir(), `conkay-engine-${entry.id}-`));
  try {
    const child = spawn(binary, [entry.kernel], {
      cwd: scratch,
      env: {
        PATH: process.env.PATH || "",
        OMP_NUM_THREADS: String(threads),
        OPENBLAS_NUM_THREADS: String(threads),
        MKL_NUM_THREADS: String(threads),
        CONKAY_ENGINE_ID: entry.id,
        CONKAY_ENGINE_SCRATCH: scratch,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = await new Promise((resolve) => {
      let stdout = "", stderr = "", settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({ timeout: true, stdout, stderr });
      }, timeoutMs);
      child.stdout.on("data", (d) => { if (stdout.length < MAX_STDOUT_BYTES) stdout += d; });
      child.stderr.on("data", (d) => { if (stderr.length < 64 * 1024) stderr += d; });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ spawnError: err, stdout, stderr });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
      child.stdin.end(JSON.stringify({ op, request }));
    });

    if (out.timeout) {
      return done({ status: "FAIL", reason: `engine_failed:${entry.id}:timeout after ${timeoutMs}ms`,
        failures: [`engine ${entry.id} exceeded the ${timeoutMs}ms wall-time cap`] });
    }
    if (out.spawnError) {
      return done({ status: "FAIL", reason: `engine_failed:${entry.id}:${out.spawnError.message}`,
        failures: [String(out.spawnError.message)] });
    }
    if (out.code !== 0) {
      const firstLine = (out.stderr || "").split("\n").find((l) => l.trim())?.trim() || `exit ${out.code}`;
      return done({ status: "FAIL", reason: `engine_failed:${entry.id}:${firstLine}`,
        failures: [firstLine] });
    }
    let parsed;
    try {
      parsed = JSON.parse(out.stdout);
    } catch {
      return done({ status: "FAIL", reason: `engine_failed:${entry.id}:garbled stdout (not JSON)`,
        failures: ["engine stdout was not valid JSON; result rejected"] });
    }
    const resViolations = validateAgainstSpec(parsed, opSpec.result, "result");
    if (resViolations.length) {
      return done({ status: "FAIL", reason: `engine_failed:${entry.id}:result failed schema validation`,
        failures: resViolations });
    }
    if (parsed && parsed.converged === false) {
      return done({ status: "NOT_COMPUTED", reason: `engine_not_converged:${entry.id}`,
        outputs: parsed, failures: [],
        warnings: [`engine ${entry.id} did not converge; residuals: ${JSON.stringify(parsed.residuals ?? null)}`] });
    }
    return done({ status: "PASS", outputs: parsed });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function runEngine(engineId, op, request, opts = {}) {
  const entry = getEngine(engineId);
  if (!entry) {
    return { status: "NOT_COMPUTED", reason: `engine_unavailable:${engineId}`,
      failures: [`engine ${engineId} has no manifest entry`],
      provenance: { engine: engineId, version: null, kernelHash: null }, runtimeMs: 0 };
  }
  const hash = kernelHash(entry);
  const key = `${entry.id}@${entry.version}:${hash ?? "nokernel"}:${sha256(canonicalRequest({ op, request }))}`;
  if (!opts.fresh && cache.has(key)) {
    return { ...cache.get(key), cached: true };
  }
  const result = await runProcessKernel(entry, op, request, opts);
  if (result.status === "PASS") cache.set(key, result);
  return result;
}

/** Health: run the manifest's healthOp through the same contract. */
export async function engineHealth(engineId, opts = {}) {
  const entry = getEngine(engineId);
  if (!entry) return { id: engineId, present: false, healthy: false, reason: "no manifest entry" };
  const binary = resolveEngineBinary(entry, opts.env ?? process.env);
  if (!binary) return { id: engineId, present: false, healthy: false, reason: `engine_unavailable:${engineId}` };
  const r = await runEngine(engineId, entry.healthOp, {}, { ...opts, fresh: true });
  return { id: engineId, present: true, healthy: r.status === "PASS", status: r.status, reason: r.reason ?? null };
}

export function _clearEngineCache() {
  cache.clear();
}
