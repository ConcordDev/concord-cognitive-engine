// Check each step's result in code before it counts as done (CKPT-11).
import { validateAgainstSchema } from "./schema-validate.js";
import { getToolSpec } from "./tool-spec.js";
import { guardNumericTrace } from "../chat/numeric-trace.js";
import { verifyAttestation } from "../receipts/attest.js";
import { verifyClaim } from "../reason-verify.js";

export const STUB_RE = /\b(mock(ed)?|placeholder|not implemented|coming soon|lorem ipsum|stub(bed)?|todo|sample data|fake)\b/i;
const ID_KEY_RE = /(^|[a-z])id$|Id$|^key$|^url$/;
const STUB_FIELD_RE = /^(note|message|status)$/i;

/** Dotted path into an object; array indexes allowed; never throws. */
export function pathGet(obj, path) {
  try {
    let cur = obj;
    for (const part of String(path || "").split(".").filter(Boolean)) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[part];
    }
    return cur;
  } catch { return undefined; }
}

function maybeJson(v) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try { return JSON.parse(t); } catch { return v; }
  }
  return v;
}

function hasIdField(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 3) return false;
  for (const [k, v] of Object.entries(node)) {
    if (ID_KEY_RE.test(k) && v !== null && v !== undefined && v !== "") return true;
    if (v && typeof v === "object" && hasIdField(v, depth + 1)) return true;
  }
  return false;
}

function stubInNamedField(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 3) return false;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string" && STUB_FIELD_RE.test(k) && STUB_RE.test(v)) return true;
    if (v && typeof v === "object" && stubInNamedField(v, depth + 1)) return true;
  }
  return false;
}

const isEmpty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)
  || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

function dtuIdsIn(node, out = new Set(), depth = 0) {
  if (!node || depth > 4) return out;
  if (typeof node === "string") { for (const m of node.matchAll(/\bdtu_[A-Za-z0-9_-]{4,}\b/g)) out.add(m[0]); return out; }
  if (typeof node === "object") for (const v of Object.values(node)) dtuIdsIn(v, out, depth + 1);
  return out;
}

/**
 * @returns {Promise<{ pass: boolean, checks: object[], errorClass?: string }>}
 */
export async function verifyStep(a) {
  const checks = [];
  let errorClass;
  const spec = getToolSpec(a.call?.tool) || null;
  const risk = spec?.risk || "read";
  const payload = maybeJson(a.result?.result);
  const add = (kind, pass, detail, extra = {}) => { checks.push({ kind, pass, ...(detail ? { detail } : {}), ...extra }); return pass; };
  const guarded = async (kind, fn, extra) => {
    try { const r = await fn(); add(kind, r.pass, r.detail, extra); } catch (e) { add(kind, false, String(e?.message || e), extra); }
  };

  // 1. ok
  await guarded("ok", async () => ({ pass: a.result?.ok === true }));

  // 2. not_stub
  await guarded("not_stub", async () => {
    const write = risk === "write" || risk === "high";
    const text = JSON.stringify(payload ?? null).slice(0, 4000);
    const stubbed = (write && STUB_RE.test(text)) || stubInNamedField(payload);
    const noId = write && !hasIdField(payload);
    if (stubbed || noId) errorClass = "fake_success";
    return { pass: !stubbed && !noId, detail: stubbed ? "stub wording in the result" : noId ? "a write returned no identifier" : undefined };
  });

  for (const e of a.step?.expects || []) {
    const { kind } = e;
    const base = { path: e.path };
    if (kind === "ok") continue;
    if (kind === "not_stub") continue;
    if (kind === "schema") {
      await guarded("schema", async () => {
        const schema = e.schema || spec?.outputSchema;
        if (!schema) return { pass: true };
        const r = validateAgainstSchema(schema, payload);
        return { pass: r.ok, detail: r.ok ? undefined : r.errors.map((x) => `${x.path}:${x.code}`).join(", ") };
      }, base);
    } else if (kind === "nonempty") {
      await guarded("nonempty", async () => ({ pass: !isEmpty(maybeJson(pathGet(payload, e.path))), detail: `${e.path} is empty` }), base);
    } else if (kind === "range") {
      await guarded("range", async () => {
        const v = pathGet(payload, e.path);
        const okNum = typeof v === "number" && Number.isFinite(v) && (e.min === undefined || v >= e.min) && (e.max === undefined || v <= e.max);
        return { pass: okNum, detail: okNum ? undefined : `${e.path} is ${v}` };
      }, base);
    } else if (kind === "numeric_trace") {
      await guarded("numeric_trace", async () => {
        const text = ["text", "answer", "summary"].map((k) => payload?.[k]).find((x) => typeof x === "string");
        if (!text) return { pass: true };
        const g = guardNumericTrace(text, [{ tool: "run_compute", ok: true, result: payload }]);
        return { pass: g.untraced.length === 0, detail: g.untraced.length ? `untraced: ${g.untraced.join(", ")}` : undefined };
      });
    } else if (kind === "receipt") {
      await guarded("receipt", async () => {
        const receipt = payload?.receipt ?? a.result?.raw?.receipt;
        if (!receipt || typeof receipt !== "object") return { pass: false, detail: "no receipt" };
        if (!receipt.signature) return { pass: !!(receipt.digest || receipt.hash), detail: receipt.digest || receipt.hash ? undefined : "unsigned receipt with no digest" };
        const v = verifyAttestation(receipt);
        if (v.valid) return { pass: true };
        if (receipt.signature.signature == null && receipt.signature.reason) return { pass: true, detail: `unsigned: ${receipt.signature.reason}` };
        return { pass: false, detail: v.reason };
      });
    } else if (kind === "judge") {
      await guarded("judge", async () => {
        const ids = [...dtuIdsIn(payload)];
        const r = await (a.deps?.verifyClaim || verifyClaim)(a.db, { claim: e.claim, citationIds: ids, requesterId: a.run?.userId, useCouncil: false, useProof: false });
        const bad = !r || r.ok === false || (r.unresolved && r.unresolved.length) || r.verdict === "fabricated_citation" || r.verdict === "unverified";
        return { pass: !bad, detail: bad ? `claim not supported (${r?.verdict || r?.reason || "unknown"})` : undefined };
      });
    } else {
      add(kind, true, "unknown check");
    }
  }
  const pass = checks.every((c) => c.pass);
  return pass ? { pass, checks } : { pass, checks, errorClass: errorClass || "verify_failed" };
}
