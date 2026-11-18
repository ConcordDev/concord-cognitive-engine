// server/lib/conkay/replay/harness.js
//
// SXC-23 — the walker replay harness. Every solver ticket ships
// docs/conkay/solvers/<id>.md carrying a replay request and an
// expected envelope; this harness EXTRACTS those replays,
// EXECUTES them against the live registry (through openDesign,
// the ConKay chat / MCP execution path), and CHECKS the stated
// expectations. The walker runs it post-fix via
// server/scripts/conkay-replay.mjs; the pin
// (tests/conkay-replay-harness.test.js) runs it in CI.
//
// Replay forms found in the docs (all three handled):
//   A. IR-form JSON — a design fragment {nodes, edges} whose
//      node props carry the solver's graphProp key.
//   B. solver_id-form JSON — {solver_id, inputs}; normalized to
//      a one-node design under the solver's graphProp key.
//   C. Fixture form — no JSON block (orc.iterate: the Sentinel
//      IR is a programmatic fixture); the harness builds the
//      props from the demo module, named FIXTURE below.
//
// The universal contract per replay:
//   1. the named envelope exists (runId <solver>@<node>);
//   2. its status equals the status the doc declares (the first
//      PASS/WARN/FAIL token of the Expected paragraph);
//   3. its inputs preserve the replay's SUPPLIED values exactly
//      (SC-05): every supplied leaf value must come back
//      unchanged. A solver may ADD defaulted keys (its declared
//      defaults, e.g. contingencyFraction: 0) or normalize a
//      nested structure through its own input handling (an IR
//      design prop softens: node fields move under props) —
//      additions and restructurings are reported in the check
//      detail, but a supplied value that CHANGES or vanishes
//      from an echoed structure fails the replay. A supplied
//      TOP-LEVEL key the solver does not echo at all (a
//      declared contract — e.g. orc.edit-commands echoes only
//      the command text; the design it edited returns in
//      outputs) is reported as NOT-ECHOED and pinned to a
//      known set, so a new silent drop fails CI until a human
//      classifies it;
//   4. every simple backticked equality in the Expected
//      paragraph — outputs.<path> == <number|string|boolean|null>
//      — holds against the envelope's outputs.
// Expectations the grammar cannot reduce (contains, sums-back,
// names, >=, set literals) are REPORTED per doc as UNREDUCED
// fragments — never silently skipped. The pin holds the
// unreduced set to exactly the known set: new unreduced prose
// fails CI until a human classifies it (SXC-25's discipline).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSolver } from "../physics/registry.js";
import { openDesign, softenDesignIR } from "../index.js";
import { canonical } from "../iterate/receipt.js";
import { buildSentinelM1IR, DESIGN_VARIABLES } from "../demos/sentinel-m1.js";

const FIXTURES = {
  "orc.iterate": () => ({ design: buildSentinelM1IR(), variables: DESIGN_VARIABLES }),
};

function getPath(obj, path) {
  const segs = [];
  for (const part of path.split(".")) {
    const m = part.match(/^([A-Za-z0-9_]+)((?:\[\d+\])*)$/);
    if (!m) return undefined;
    segs.push(m[1]);
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) segs.push(Number(idx[1]));
  }
  let cur = obj;
  for (const s of segs) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[s];
  }
  return cur;
}

function parseLiteral(text) {
  const t = text.trim();
  if (t === "null") return { ok: true, value: null };
  if (t === "true") return { ok: true, value: true };
  if (t === "false") return { ok: true, value: false };
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return { ok: true, value: Number(t) };
  const str = t.match(/^"([^"]*)"$/);
  if (str) return { ok: true, value: str[1] };
  return { ok: false };
}

/** Extract one doc's replay + expectations. Pure; exported for testing. */
export function extractReplay(docText) {
  const heading = docText.match(/^## Replay request[^\n]*$/m);
  let section = "";
  if (heading) {
    const start = heading.index + heading[0].length;
    const rest = docText.slice(start);
    const next = rest.match(/^## /m);
    section = next ? rest.slice(0, next.index) : rest;
  }
  const jsonMatch = section.match(/```json\n([\s\S]*?)```/);
  let request = null;
  if (jsonMatch) {
    try { request = JSON.parse(jsonMatch[1]); } catch { request = null; }
  }
  const form = request == null ? "fixture-or-none" : Array.isArray(request.nodes) ? "ir" : request.solver_id ? "solver_id" : "unknown";

  // Expectations live in the prose after the JSON block (or the
  // whole section for the fixture form).
  const prose = jsonMatch ? section.slice(section.indexOf(jsonMatch[0]) + jsonMatch[0].length) : section;
  const statusMatch = prose.match(/\b(PASS|WARN|FAIL)\b/);
  const declaredStatus = statusMatch ? statusMatch[1] : null;
  const runIdMatch = prose.match(/`([a-z0-9._-]+@[A-Za-z0-9_-]+)`/);

  const equalities = [];
  const unreduced = [];
  for (const frag of prose.matchAll(/`([^`]+)`/g)) {
    const text = frag[1].replace(/\s+/g, " ").trim();
    const eq = text.match(/^outputs\.([A-Za-z0-9_.[\]]+)\s*==\s*(.+)$/);
    if (eq) {
      const lit = parseLiteral(eq[2]);
      if (lit.ok) { equalities.push({ path: eq[1], expected: lit.value }); continue; }
    }
    if (/\b(outputs|inputs)\./.test(text) && !runIdMatch?.[1]?.startsWith(text)) unreduced.push(text);
  }
  return { request, form, declaredStatus, declaredRunId: runIdMatch ? runIdMatch[1] : null, equalities, unreduced };
}

function runDesign(design) {
  const softened = softenDesignIR(design);
  if (!softened || !softened.ir) return { error: `soften failed: ${JSON.stringify(softened?.errors ?? softened).slice(0, 300)}` };
  const opened = openDesign(softened.ir);
  if (!opened.ok) return { error: `openDesign failed: ${JSON.stringify(opened.errors)}` };
  return { results: opened.session.results() };
}

/** Execute one extracted replay and check the universal contract. */
export function runReplay(solverId, extracted) {
  const checks = [];
  const fail = (kind, detail) => checks.push({ kind, detail, ok: false });
  const pass = (kind, detail) => checks.push({ kind, detail, ok: true });

  let design = null;
  let expectedInputs = null;
  let expectedRunId = extracted.declaredRunId;

  if (extracted.form === "ir") {
    design = { design: { id: `replay-${solverId}`, name: "replay" }, nodes: extracted.request.nodes, edges: extracted.request.edges ?? [] };
    const solver = getSolver(solverId);
    const node = (extracted.request.nodes || []).find((n) => n.props && solver && n.props[solver.graphProp] !== undefined);
    if (!node) { fail("extract", `no node carries ${solver?.graphProp ?? "?"} props`); return { checks, notEchoed: [] }; }
    expectedInputs = node.props[solver.graphProp];
    expectedRunId = expectedRunId ?? `${solverId}@${node.id}`;
  } else if (extracted.form === "solver_id") {
    const solver = getSolver(extracted.request.solver_id);
    if (!solver) { fail("extract", `unknown solver ${extracted.request.solver_id}`); return { checks, notEchoed: [] }; }
    expectedInputs = extracted.request.inputs;
    design = { design: { id: `replay-${solverId}`, name: "replay" }, nodes: [{ id: "N1", kind: "Part", name: "replay", props: { [solver.graphProp]: extracted.request.inputs } }], edges: [] };
    expectedRunId = expectedRunId ?? `${solverId}@N1`;
  } else if (FIXTURES[solverId]) {
    const solver = getSolver(solverId);
    expectedInputs = FIXTURES[solverId]();
    design = { design: { id: `replay-${solverId}`, name: "replay" }, nodes: [{ id: "N1", kind: "Assembly", name: "replay", props: { [solver.graphProp]: expectedInputs } }], edges: [] };
    expectedRunId = expectedRunId ?? `${solverId}@N1`;
  } else {
    fail("extract", "no JSON replay block and no fixture binding");
    return { checks, notEchoed: [] };
  }

  const { results, error } = runDesign(design);
  if (error) { fail("execute", error); return { checks, notEchoed: [] }; }
  const env = results.find((e) => e.runId === expectedRunId) ?? results.find((e) => e.solver === solverId);
  if (!env) { fail("envelope", `no envelope for ${expectedRunId}; got ${results.map((e) => e.runId).join(", ") || "none"}`); return { checks, notEchoed: [] }; }
  pass("envelope", env.runId);

  if (extracted.declaredStatus) {
    if (env.status === extracted.declaredStatus) pass("status", env.status);
    else fail("status", `declared ${extracted.declaredStatus}, envelope is ${env.status}`);
  } else fail("status", "the doc declares no status");

  const supplied = expectedInputs ?? {};
  const broken = [];
  const additions = [];
  const notEchoed = Object.keys(supplied).filter((k) => !(k in (env.inputs ?? {})));
  const preserve = (sup, got, path) => {
    if (sup === null || typeof sup !== "object") {
      if (canonical(sup) !== canonical(got)) broken.push(path);
      return;
    }
    if (got === null || typeof got !== "object") { broken.push(path); return; }
    if (Array.isArray(sup)) {
      if (!Array.isArray(got) || got.length !== sup.length) { broken.push(path); return; }
      sup.forEach((v, i) => preserve(v, got[i], `${path}[${i}]`));
      return;
    }
    for (const k of Object.keys(sup)) {
      if (!(k in got)) {
        // A supplied key may legitimately move under a nested
        // props object when an IR-shaped input softens; search
        // one level of nesting before calling it dropped.
        const nested = Object.values(got).find((v) => v && typeof v === "object" && !Array.isArray(v) && k in v);
        if (nested) preserve(sup[k], nested[k], `${path}.${k}`);
        else broken.push(`${path}.${k}`);
      } else preserve(sup[k], got[k], `${path}.${k}`);
    }
    for (const k of Object.keys(got)) if (!(k in sup)) additions.push(`${path}.${k}`);
  };
  const echoedSupplied = Object.fromEntries(Object.entries(supplied).filter(([k]) => !notEchoed.includes(k)));
  preserve(echoedSupplied, env.inputs ?? {}, "inputs");
  if (broken.length === 0) {
    pass("echo", additions.length ? `supplied values preserved exactly; additions visible: ${[...new Set(additions)].slice(0, 4).join(", ")}${additions.length > 4 ? ", …" : ""}` : "inputs echo exactly");
  } else {
    fail("echo", `supplied values changed or dropped at: ${broken.slice(0, 4).join(", ")}`);
  }

  for (const eq of extracted.equalities) {
    const actual = getPath(env.outputs, eq.path);
    if (canonical(actual) === canonical(eq.expected)) pass("equality", `outputs.${eq.path} == ${JSON.stringify(eq.expected)}`);
    else fail("equality", `outputs.${eq.path}: expected ${JSON.stringify(eq.expected)}, got ${JSON.stringify(actual)}`);
  }
  return { checks, notEchoed };
}

/** Run every solver doc in a directory. Returns the full report. */
export function runAll(docsDir) {
  const files = readdirSync(docsDir).filter((f) => f.endsWith(".md")).sort();
  const rows = [];
  for (const file of files) {
    const solverId = file.replace(/\.md$/, "");
    const text = readFileSync(join(docsDir, file), "utf8");
    if (!/^## Replay request/m.test(text)) {
      rows.push({ doc: file, solver: solverId, form: "none", status: "FAIL", checks: [{ kind: "extract", detail: "no Replay request section", ok: false }], unreduced: [] });
      continue;
    }
    const extracted = extractReplay(text);
    const { checks, notEchoed } = runReplay(solverId, extracted);
    rows.push({
      doc: file,
      solver: solverId,
      form: extracted.form === "fixture-or-none" ? (FIXTURES[solverId] ? "fixture" : "none") : extracted.form,
      status: checks.every((c) => c.ok) ? "PASS" : "FAIL",
      checks,
      unreduced: extracted.unreduced,
      notEchoed: notEchoed ?? [],
    });
  }
  return rows;
}

export default { extractReplay, runReplay, runAll };
