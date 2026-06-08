// server/lib/build-loop.js
//
// ConKay-as-Builder Phase 3 — the verifiable build loop. The thesis made real:
// "ConKay can do it" ALWAYS means "verifiably did it". The loop is:
//
//   make X → generate → write → RUN → LINT → VERIFY → (repair & retry) → done
//
// and its honesty invariant is structural: it CANNOT return `status:"done"`
// until the artifact actually ran (exitCode 0), lint/type-check is clean (zero
// error-severity diagnostics — real `tsc` from Phase 1), and verification passed
// (`reason.verify` when a factual claim is attached, else the structural ran+lint
// gate). A failing step becomes feedback for the next generation; exhausting the
// iteration budget returns `unverified`, never a claimed success.
//
// `generate` and `runMacro` are injected (DI) so the loop is deterministic +
// unit-testable without an LLM or live execution; in production `generate` is an
// LLM call and `runMacro` is the real dispatcher. The RUN step goes through
// `code.exec` (node:vm), which is gated off in prod by `CONCORD_CODE_EXEC_ENABLED`
// — when disabled the loop honestly returns `unrun` (it produced a candidate but
// could not verify it), which is exactly why Phase 4's microVM is required to
// safely enable autonomous running.

function asResult(r) {
  return r && typeof r === "object" ? (r.result || r) : r;
}

/**
 * @param {object} o
 * @param {string}   o.request       — the "make X" ask.
 * @param {Function} o.generate      — async (request, feedback) => string | { code }.
 * @param {Function} o.runMacro      — async (domain, name, input, ctx).
 * @param {object}   [o.ctx]         — ctx threaded to runMacro (ideally confined).
 * @param {string}   [o.projectId]   — workspace project to write into.
 * @param {string}   [o.path]        — file path to write.
 * @param {string}   [o.language]    — 'javascript' | 'typescript'.
 * @param {string}   [o.claim]       — optional factual claim to reason.verify.
 * @param {string[]} [o.citations]   — DTU ids backing the claim.
 * @param {number}   [o.maxIterations]
 * @returns {Promise<{ok:boolean,status:string,artifact?:object,evidence:object,iterations:number,history:object[],reason?:string}>}
 */
export async function runBuildLoop({
  request,
  generate,
  runMacro,
  ctx = {},
  projectId = "conkay-build",
  path = "build.js",
  language = "javascript",
  claim = null,
  citations = [],
  maxIterations = 3,
} = {}) {
  if (typeof generate !== "function") throw new Error("runBuildLoop: generate required");
  if (typeof runMacro !== "function") throw new Error("runBuildLoop: runMacro required");

  const history = [];
  let feedback = null;
  let best = null;
  const iters = Math.max(1, Math.min(Number(maxIterations) || 3, 8));

  for (let i = 1; i <= iters; i++) {
    const gen = await generate(request, feedback);
    const code = typeof gen === "string" ? gen : String(gen?.code || "");
    const step = { iteration: i, code, ran: false, lintClean: false, verified: false };
    best = step;

    if (!code.trim()) {
      step.reason = "empty_generation";
      feedback = "Your previous output was empty. Return only the code.";
      history.push(step);
      continue;
    }

    // ── write ──────────────────────────────────────────────────────────────
    await runMacro("code", "files-write", { projectId, path, content: code }, ctx);

    // ── run ────────────────────────────────────────────────────────────────
    const run = await runMacro("code", "exec", { code, language }, ctx);
    if (run && run.ok === false && run.error === "code_exec_disabled") {
      // Cannot verify what we cannot run → honest non-done outcome.
      step.runSkipped = true;
      step.reason = "exec_disabled";
      history.push(step);
      return {
        ok: false,
        status: "unrun",
        reason: "code execution is disabled in this environment (Phase 4 microVM isolation is required to run untrusted code safely)",
        artifact: { code, projectId, path, language },
        evidence: { ran: false, lintClean: false, verified: false, runSkipped: true },
        iterations: i,
        history,
      };
    }
    const runRes = asResult(run) || {};
    step.ran = runRes.exitCode === 0;
    step.stderr = String(runRes.stderr || "");
    if (!step.ran) {
      feedback = `Your code threw at runtime. Fix it.\n\nstderr:\n${step.stderr.slice(0, 1200)}`;
      history.push(step);
      continue;
    }

    // ── lint / type-check (real tsc from Phase 1 for TS/JS) ─────────────────
    const lint = await runMacro("code", "diagnostics", { projectId, path }, ctx);
    const problems = asResult(lint)?.problems || [];
    const errors = problems.filter((p) => p.severity === "error");
    step.lintClean = errors.length === 0;
    step.lintErrors = errors;
    if (!step.lintClean) {
      feedback = `Your code has type/lint errors. Fix them.\n\n${errors.map((e) => `L${e.line}: ${e.message}`).join("\n").slice(0, 1200)}`;
      history.push(step);
      continue;
    }

    // ── verify ───────────────────────────────────────────────────────────────
    if (claim) {
      const v = await runMacro("reason", "verify", { claim, citations }, ctx);
      const verdict = asResult(v)?.verdict || v?.verdict || "unverified";
      step.verdict = verdict;
      step.verified = verdict === "grounded" || verdict === "citations_resolve";
      if (!step.verified) {
        feedback = `Verification did not pass (verdict: ${verdict}). Ground the claim in real citations or correct it.`;
        history.push(step);
        continue;
      }
    } else {
      // No factual claim attached → the structural ran+lint gate IS the verify.
      step.verified = true;
    }

    // ── all gates passed → DONE (honestly) ───────────────────────────────────
    step.done = true;
    history.push(step);
    return {
      ok: true,
      status: "done",
      artifact: { code, projectId, path, language },
      evidence: { ran: true, lintClean: true, verified: true, verdict: step.verdict || "structural" },
      iterations: i,
      history,
    };
  }

  // Exhausted the budget without converging — NEVER claim success.
  return {
    ok: false,
    status: "unverified",
    reason: `did not converge within ${iters} iteration(s)`,
    artifact: best ? { code: best.code, projectId, path, language } : null,
    evidence: best ? { ran: best.ran, lintClean: best.lintClean, verified: best.verified } : { ran: false, lintClean: false, verified: false },
    iterations: iters,
    history,
  };
}

export default { runBuildLoop };
