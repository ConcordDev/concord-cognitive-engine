// server/lib/chat/tool-recipes/index.js
//
// Registry + deterministic executor for chat tool recipes (see recipes.js).
//   listRecipes(query?)  -> the recipes that match, each with its input schema
//   runRecipe(id, inputs) -> { ok, recipe, steps, checks, passed, result, receipt }
// Inputs are validated and converted to SI first (numbers are SI; tagged values
// like "60 mm" or {value, unit} are converted). A recipe never invents a missing
// required input: it returns the missing names so the agent can ask or retry.

import { RECIPES } from "./recipes.js";
import { toSI } from "../compute-si.js";
import { independentRecompute, referenceMatch } from "./verify.js";
import { canonicalJson, sha256Hex } from "../../receipts/attest.js";

export const RECIPE_VERSION = "1.0.0";

const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function schemaOf(r) {
  return Object.fromEntries(Object.entries(r.inputs).map(([k, d]) => [k, {
    required: !!d.required,
    ...(d.dim ? { unit: d.unit, accepts: "number in SI, or a quantity like \"60 mm\" / {value, unit}" } : { type: d.type }),
    description: d.desc,
  }]));
}

export function listRecipes(query = "") {
  const q = words(query);
  const scored = RECIPES.map((r) => {
    const hay = new Set([...r.keywords, ...words(r.title), ...words(r.id)]);
    const hits = q.filter((w) => hay.has(w) || [...hay].some((h) => h.startsWith(w) && w.length > 2)).length;
    return { r, hits };
  });
  const rows = (q.length ? scored.filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits) : scored).map((s) => s.r);
  return rows.map((r) => ({ id: r.id, title: r.title, inputs: schemaOf(r) }));
}

function resolveInputs(recipe, raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const values = {}; const missing = []; const bad = [];
  for (const [name, def] of Object.entries(recipe.inputs)) {
    const v = src[name];
    if (v === undefined || v === null || v === "") { if (def.required) missing.push(name); continue; }
    if (def.dim) {
      const n = toSI(v, def.dim);
      if (n == null || !(n > 0)) bad.push(`${name}=${JSON.stringify(v)} (expected a positive ${def.dim} in ${def.unit} or a unit-tagged value)`);
      else values[name] = n;
    } else if (def.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) bad.push(`${name}=${JSON.stringify(v)} (expected a number)`); else values[name] = n;
    } else if (def.type === "array") {
      if (Array.isArray(v) && v.length) values[name] = v.map(String); else bad.push(`${name} (expected a non-empty list)`);
    } else values[name] = String(v);
  }
  return { values, missing, bad };
}

export function runRecipe(id, rawInputs) {
  const recipe = RECIPES.find((r) => r.id === String(id || "").trim());
  if (!recipe) return { ok: false, error: `unknown recipe "${id}"`, recipes: listRecipes().map((r) => r.id) };
  const { values, missing, bad } = resolveInputs(recipe, rawInputs);
  if (missing.length || bad.length) {
    return { ok: false, recipe: recipe.id, error: [missing.length ? `missing: ${missing.join(", ")}` : null, bad.length ? `invalid: ${bad.join("; ")}` : null].filter(Boolean).join("; "), inputSchema: schemaOf(recipe) };
  }
  let out;
  try { out = recipe.run(values); } catch (e) { return { ok: false, recipe: recipe.id, error: `recipe failed: ${String(e?.message || e)}` }; }
  if (out.error) return { ok: false, recipe: recipe.id, error: out.error, steps: out.steps || [], inputSchema: schemaOf(recipe) };
  // Verify against reality: recompute independently, and compare with the reference corpus when a case matches.
  const independent = independentRecompute(recipe.id, values, out.result);
  const reference = referenceMatch(recipe.id, values, out.result);
  const checks = [...out.checks, ...independent.map((c) => ({ ...c, name: `independent:${c.name}` }))];
  if (reference.matched) checks.push({ name: `reference:${reference.caseId}`, pass: reference.pass, detail: reference.pass ? `matches the textbook case (${reference.source})` : `disagrees with the textbook case: ${JSON.stringify(reference.mismatches)}` });
  const passed = checks.every((c) => c.pass);
  const verified = independent.length > 0 && independent.every((c) => c.pass) && (!reference.matched || reference.pass);
  const receipt = { recipe: recipe.id, version: RECIPE_VERSION, units: "SI", inputs: values, steps: out.steps, checks, verification: { independent, reference, verified }, result: out.result, passed, generatedAt: new Date().toISOString() };
  receipt.digest = `sha256:${sha256Hex(Buffer.from(canonicalJson({ ...receipt, generatedAt: undefined })))}`;
  const failed = checks.filter((c) => !c.pass).map((c) => c.name);
  return {
    ok: true,
    recipe: recipe.id,
    title: recipe.title,
    system: "SI",
    passed,
    verified,
    checks,
    result: out.result,
    steps: out.steps,
    receipt,
    note: failed.length
      ? `Failed checks: ${failed.join(", ")}. Say so plainly; do not report this as passing or verified.`
      : (verified ? "All checks passed and an independent recomputation agrees." : "All declared checks passed; no independent recomputation exists for this recipe."),
  };
}

export { RECIPES };
