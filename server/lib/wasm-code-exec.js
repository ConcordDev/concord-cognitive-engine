// server/lib/wasm-code-exec.js
// Founder/sovereign WASM sandboxed code execution via the pod job queue.
//
// The actual security boundary is the pod-side launcher
// (/opt/concord-wasm/run-wasm-sandbox.sh). This module is the server-side
// gate + audit + wiring. Fail-closed: every non-empty path writes exactly one
// audit line, and no caller can bypass the role or kill-switch checks.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { podJobs } from "./pod-jobs.js";

export const CODE_EXEC_ROLES = Object.freeze(["founder", "sovereign"]);

/** True iff the caller's role is explicitly founder or sovereign. No internal/system bypass. */
export function isCodeExecRole(ctx) {
  const role = ctx?.actor?.role;
  return role === "founder" || role === "sovereign";
}

/**
 * Kill switch + pod-jobs dependency.
 *   CONCORD_WASM_EXEC_ENABLED = "0" | "false" | "off"  -> false
 *   otherwise default ON, but only when CONCORD_POD_JOBS === "1".
 */
export function wasmExecEnabled(env = process.env) {
  const v = env?.CONCORD_WASM_EXEC_ENABLED;
  if (v === "0" || v === "false" || v === "off") return false;
  return env?.CONCORD_POD_JOBS === "1";
}

export const WASM_LANGUAGES = Object.freeze({
  python: Object.freeze(["python", "py", "python3"]),
  wat: Object.freeze(["wat", "wasm-text"]),
});

/** Normalize a caller-supplied language string to "python" | "wat" | null. */
export function normalizeWasmLanguage(lang) {
  const s = String(lang ?? "").toLowerCase().trim();
  if (!s) return null;
  for (const [canonical, aliases] of Object.entries(WASM_LANGUAGES)) {
    if (aliases.includes(s)) return canonical;
  }
  return null;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function isoNow() {
  return new Date().toISOString();
}

function baseResult(overrides = {}) {
  return {
    supported: true,
    sandbox: "wasm",
    stdout: "",
    stderr: "",
    exitCode: -1,
    ...overrides,
  };
}

function defaultAuditPath(env = process.env) {
  if (env?.CONCORD_CODE_EXEC_AUDIT) return env.CONCORD_CODE_EXEC_AUDIT;
  const here = fileURLToPath(import.meta.url);
  const serverDir = path.resolve(here, "..", "..");
  return path.join(serverDir, "data", "code-exec-audit.jsonl");
}

/**
 * Append a single JSONL audit entry. Never puts raw code/stdout/stderr in the
 * entry. Never throws; permissions errors are swallowed after best-effort chmod.
 */
export function appendCodeExecAudit(entry, { env = process.env } = {}) {
  try {
    const line = JSON.stringify(entry) + "\n";
    const target = defaultAuditPath(env);
    fs.appendFileSync(target, line, { mode: 0o600 });
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      /* best-effort */
    }
  } catch {
    /* audit must never break execution */
  }
}

/**
 * Run sandboxed code via the pod-side WASM launcher.
 *
 * Fail-closed order:
 *   1. role gate (founder/sovereign only)
 *   2. kill switch / pod-jobs enabled
 *   3. empty code short-circuit (no audit)
 *   4. length cap
 *   5. language normalization
 *   6. enqueue to pod worker
 *   7. result shaping + audit
 */
export async function runWasmCodeExec(
  ctx,
  { code, language, timeoutMs } = {},
  { queue = podJobs, env = process.env, audit = appendCodeExecAudit, via = "lens" } = {}
) {
  const actorId = ctx?.actor?.userId ?? ctx?.actor?.id ?? "anon";
  const role = ctx?.actor?.role ?? null;

  function auditEntry(decision, extras = {}) {
    const sCode = String(code ?? "");
    const entry = {
      ts: isoNow(),
      via,
      actorId: String(actorId),
      role,
      language: extras.language ?? null,
      ...(sCode ? { codeSha256: sha256Hex(sCode), codeBytes: sCode.length } : {}),
      decision,
      ok: extras.ok ?? false,
      exitCode: extras.exitCode ?? -1,
      timedOut: extras.timedOut ?? false,
      durationMs: extras.durationMs ?? null,
      bytesOut: extras.bytesOut ?? null,
      error: extras.error ?? null,
    };
    audit(entry, { env });
  }

  // a/b. Role gate — founder/sovereign ONLY. Never fall through to the queue.
  if (!isCodeExecRole(ctx)) {
    auditEntry("denied", { error: "role" });
    return {
      ok: false,
      error: "code_exec_forbidden",
      status: 403,
      result: baseResult({
        supported: false,
        stderr: "Sandboxed code execution is limited to founder/sovereign accounts.",
      }),
    };
  }

  // c. Kill switch / pod-jobs dependency.
  if (!wasmExecEnabled(env)) {
    auditEntry("disabled");
    return {
      ok: false,
      error: "code_exec_disabled",
      result: baseResult({
        supported: false,
        stderr: "Sandboxed code execution is switched off (CONCORD_WASM_EXEC_ENABLED=0 or pod jobs off).",
      }),
    };
  }

  // d. Empty code short-circuit — no audit.
  const sCode = String(code ?? "");
  if (!sCode.trim()) {
    return {
      ok: true,
      result: baseResult({ exitCode: 0 }),
    };
  }

  if (sCode.length > 20000) {
    auditEntry("error", { error: "code_too_long" });
    return {
      ok: false,
      error: "code_too_long",
      result: baseResult({
        stderr: "Code exceeds 20000 character limit.",
      }),
    };
  }

  // e. Language normalization.
  const lang = normalizeWasmLanguage(language || "python");
  if (!lang) {
    auditEntry("error", { language: String(language || "").toLowerCase(), error: "code_exec_language_unsupported" });
    return {
      ok: false,
      error: "code_exec_language_unsupported",
      result: baseResult({
        stderr: 'Language unsupported. Supported: python, wat.',
      }),
    };
  }

  // f/g. Compute limits + enqueue to the pod worker.
  const timeoutS = clamp(Math.ceil((Number(timeoutMs) || 10000) / 1000), 1, 30);
  const memMb = lang === "python" ? 256 : 64;
  const codeSha256 = sha256Hex(sCode);

  const r = await queue.enqueue(
    "exec",
    {
      language: lang,
      code: sCode,
      timeoutS,
      memMb,
      actor: String(actorId),
      role,
      codeSha256,
    },
    { timeoutMs: (timeoutS + 20) * 1000 }
  );

  // h. Queue error or malformed result shape.
  if (!r.ok || typeof r.result !== "object" || r.result === null || typeof r.result.stdout !== "string") {
    const detail = r.error || r.result?.error || "pod_result_malformed";
    auditEntry("error", { language: lang, codeSha256, codeBytes: sCode.length, error: detail });
    return {
      ok: false,
      error: "code_exec_unavailable",
      detail,
      result: baseResult({
        stderr: `Sandbox unavailable: ${detail}`,
      }),
    };
  }

  // i. Successful pod result — shape and audit.
  const res = r.result;
  const ok = !!res.ok;
  const exitCode = typeof res.exitCode === "number" ? res.exitCode : -1;
  const timedOut = !!res.timedOut;
  const durationMs = typeof res.durationMs === "number" ? res.durationMs : null;
  const bytesOut = typeof res.stdout === "string" ? res.stdout.length : 0;

  auditEntry("ran", {
    language: lang,
    codeSha256,
    codeBytes: sCode.length,
    ok,
    exitCode,
    timedOut,
    durationMs,
    bytesOut,
    error: ok ? null : (timedOut ? "code_exec_timeout" : "code_exec_failed"),
  });

  return {
    ok,
    error: ok
      ? undefined
      : (timedOut ? "code_exec_timeout" : "code_exec_failed"),
    result: {
      supported: true,
      sandbox: "wasm",
      language: lang,
      stdout: res.stdout,
      stderr: res.stderr || "",
      exitCode,
      timedOut,
      durationMs,
    },
  };
}

/**
 * End-to-end self-test of the wired path. Requires a fake queue that simulates
 * the sandbox answers (tests supply one). Returns { at, ok, checks:[{name,pass,detail}] }.
 */
export async function wasmExecSelfTest({ queue = podJobs, env = process.env, audit = appendCodeExecAudit } = {}) {
  const at = isoNow();
  if (!wasmExecEnabled(env)) {
    return { at, ok: false, skipped: "disabled", checks: [] };
  }

  const founder = { actor: { userId: "system:wasm-selftest", role: "founder" } };
  const member = { actor: { userId: "system:wasm-selftest-member", role: "member" } };
  const owner = { actor: { userId: "system:wasm-selftest-owner", role: "owner" } };
  const run = (code, language, timeoutMs) =>
    runWasmCodeExec(founder, { code, language, timeoutMs }, { queue, env, audit, via: "selftest" });

  const checks = [];

  const r1 = await run("print(6*7)", "python");
  checks.push({
    name: "founder_runs_python",
    pass: r1.ok && r1.result?.stdout?.trim() === "42",
    detail: r1,
  });

  const r2 = await runWasmCodeExec(member, { code: "print(1)", language: "python" }, { queue, env, audit, via: "selftest" });
  checks.push({
    name: "member_refused",
    pass: !r2.ok && r2.error === "code_exec_forbidden",
    detail: r2,
  });

  const r3 = await runWasmCodeExec(owner, { code: "print(1)", language: "python" }, { queue, env, audit, via: "selftest" });
  checks.push({
    name: "owner_refused",
    pass: !r3.ok && r3.error === "code_exec_forbidden",
    detail: r3,
  });

  const r4 = await run(
    "import os\nprint(len(os.environ))\nprint(any(k.startswith(\"CONCORD\") for k in os.environ))",
    "python"
  );
  const out4 = r4.result?.stdout || "";
  checks.push({
    name: "no_env_secrets",
    pass: r4.ok && out4.trim().split(/\r?\n/).join("|") === "0|False",
    detail: r4,
  });

  const r5 = await run(
    "import socket\ntry:\n    socket.create_connection((\"1.1.1.1\",53),2)\n    print(\"NET_LEAK\")\nexcept Exception:\n    pass\ntry:\n    socket.getaddrinfo(\"example.com\",80)\n    print(\"NET_LEAK\")\nexcept Exception:\n    print(\"NET_BLOCKED\")",
    "python"
  );
  const out5 = r5.result?.stdout || "";
  checks.push({
    name: "no_network",
    pass: r5.ok && out5.includes("NET_BLOCKED") && !out5.includes("NET_LEAK"),
    detail: r5,
  });

  const r6 = await run(
    "import os\ntry:\n    open(\"/etc/shadow\")\n    print(\"FS_LEAK\")\nexcept Exception:\n    pass\ntry:\n    os.listdir(\"/workspace/concord-backups\")\n    print(\"FS_LEAK\")\nexcept Exception:\n    pass\ntry:\n    os.listdir(\"/workspace\")\n    print(\"FS_LEAK\")\nexcept Exception:\n    pass\ntry:\n    open(\"/workspace/x-escape\", \"w\")\n    print(\"FS_LEAK\")\nexcept Exception:\n    print(\"FS_BLOCKED\")",
    "python"
  );
  const out6 = r6.result?.stdout || "";
  checks.push({
    name: "no_host_fs",
    pass: r6.ok && out6.includes("FS_BLOCKED") && !out6.includes("FS_LEAK"),
    detail: r6,
  });

  const r7 = await run("while True:\n    pass", "python", 2000);
  checks.push({
    name: "timeout_enforced",
    pass: r7.result?.timedOut === true,
    detail: r7,
  });

  const watCode = `(module
    (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
    (memory (export "memory") 1)
    (data (i32.const 8) "WAT_OK\\n")
    (func (export "_start")
      (i32.store (i32.const 0) (i32.const 8))
      (i32.store (i32.const 4) (i32.const 7))
      (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 20)))
    )
  )`;
  const r8 = await run(watCode, "wat");
  checks.push({
    name: "wat_runs",
    pass: r8.ok && r8.result?.stdout?.trim() === "WAT_OK",
    detail: r8,
  });

  for (const c of checks) {
    const d = c.detail || {};
    c.detail = { ok: !!d.ok, error: d.error || null, stdout: String(d.result?.stdout ?? "").slice(0, 200), timedOut: !!d.result?.timedOut, durationMs: d.result?.durationMs ?? null };
  }
  const pass = checks.every((c) => c.pass);
  return { at, ok: pass, checks };
}
