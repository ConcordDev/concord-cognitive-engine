// Signed receipt for every finished cockpit step (CKPT-15).
import { attestReceipt, canonicalJson, sha256Hex } from "../receipts/attest.js";

const hashOf = (x) => sha256Hex(canonicalJson(x === undefined ? null : x));

/** @returns the attested receipt (signed, or unsigned with a reason when no key is loaded) */
export function makeStepReceipt({ run, step, call, result, checks }) {
  const body = {
    kind: "cockpit.step.v1",
    runId: run.id,
    stepId: step.id,
    seq: step.seq,
    tool: call?.tool || "done",
    argsHash: hashOf(call?.args ?? {}),
    resultHash: hashOf(result?.result ?? null),
    ok: result?.ok === true,
    checks: (checks || []).map((c) => ({ ...c })),
    idempotencyKey: step.idempotencyKey || null,
    provider: result?.provider ?? null,
    model: result?.model ?? null,
  };
  return attestReceipt(body);
}
