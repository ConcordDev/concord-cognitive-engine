// server/tests/_conkay-honesty.mjs
//
// SC-05 shared honesty test helper for ConKay solver tests (catalogue wave-0
// foundation SC-05; route confirmed CB-0823: additive test infrastructure,
// checker-reviewed before it gates anything; it edits no existing test or
// fixture). The narrow catalogue plan's rule 3: tests assert
//   (1) inputs used == inputs submitted,
//   (2) no assumed material/property (a missing required input is
//       NOT_COMPUTED naming the field, or the default is declared and
//       echoed as an assumption — never silently filled),
//   (3) cited DTU ids sit in the right domain.
//
// The helper works at the raw-result level (what a solver's run() returns,
// before or after registry envelope()): the production IR path calls
// envelope() without supplied/ignored (graph/engine.js), so the registry's
// own inputIntegrityViolation only catches solver-declared substitutions
// there. These assertions bite regardless of that arming.
//
// Usage:
//   import { assertEchoIntegrity, assertNothingAssumed, assertCitationsDomain }
//     from "./_conkay-honesty.mjs";
//   assertEchoIntegrity(raw, { thickness: 0.01, yieldPa: 250e6 });
//   await assertNothingAssumed((inputs) => runMySolver(inputs),
//     fullInputs, ["thickness", "yieldPa"]);
//   assertCitationsDomain(raw, solverDescriptor);

import assert from "node:assert/strict";

const REL_TOL = 1e-9;
const numOf = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);

function closeEnough(a, b) {
  const x = Number(numOf(a));
  const y = Number(numOf(b));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return x === y;
  return Math.abs(x - y) <= REL_TOL * Math.max(1, Math.abs(y));
}

/**
 * (1) Every supplied input must be echoed by the solver under the same name
 * with the same value, and no declared substitution may differ from what was
 * supplied. Throws an AssertionError naming the field on any mismatch, on a
 * missing echo, or on an un-echoed supplied input.
 */
export function assertEchoIntegrity(raw, supplied, label = "solver") {
  assert.ok(raw && typeof raw === "object", `${label}: raw result is not an object`);
  for (const s of Array.isArray(raw.substitutions) ? raw.substitutions : []) {
    if (s && s.name) {
      assert.ok(
        closeEnough(s.used, s.supplied),
        `${label}: declared substitution on "${s.name}" (supplied ${s.supplied}, used ${s.used})`
      );
    }
  }
  const echoed = raw.inputs || {};
  for (const [name, v] of Object.entries(supplied || {})) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(echoed, name),
      `${label}: supplied input "${name}" was not echoed in the result inputs (used != submitted)`
    );
    assert.ok(
      closeEnough(echoed[name], v),
      `${label}: input "${name}" substituted (supplied ${numOf(v)}, used ${numOf(echoed[name])})`
    );
  }
}

function isNotComputed(result) {
  if (!result || typeof result !== "object") return false;
  if (result.notComputed) return true;
  if (result.status === "NOT_COMPUTED") return true;
  return false;
}

function reasonText(result) {
  return String(result?.notComputed || result?.reason || "");
}

function disclosesDefault(result, field) {
  const hay = JSON.stringify(result?.assumptions || []).toLowerCase();
  return hay.includes(field.toLowerCase()) && /default|assum|auto/.test(hay);
}

/**
 * (2) For each required field: run with that field removed. The run must
 * refuse honestly — NOT_COMPUTED whose reason names the field — or disclose
 * the default it used (an assumptions entry naming the field as defaulted /
 * assumed). A computed result with neither is an assumed input: fail,
 * naming the field. `runWith` receives the reduced input object and returns
 * the raw result (or a promise of it); the caller adapts it to the solver's
 * own call shape.
 */
export async function assertNothingAssumed(runWith, fullInputs, requiredFields, label = "solver") {
  for (const field of requiredFields) {
    const reduced = { ...fullInputs };
    delete reduced[field];
    const result = await runWith(reduced);
    if (isNotComputed(result)) {
      assert.ok(
        reasonText(result).toLowerCase().includes(field.toLowerCase()),
        `${label}: missing "${field}" refused but the reason does not name the field (got: "${reasonText(result)}")`
      );
      continue;
    }
    assert.ok(
      disclosesDefault(result, field),
      `${label}: missing required input "${field}" was silently assumed (computed result, no NOT_COMPUTED, no disclosed default)`
    );
  }
}

function* walkObjects(v, seen = new Set()) {
  if (!v || typeof v !== "object" || seen.has(v)) return;
  seen.add(v);
  yield v;
  for (const child of Object.values(v)) yield* walkObjects(child, seen);
}

/**
 * (3) Every citation-shaped reference in the result (an object carrying a
 * `domain`, or a `dtuId` / `citation` string of the form dtu:<domain>:...)
 * must sit in one of the solver's declared domains. A result citing nothing
 * passes vacuously — this leg only bites on wrong-domain citations.
 */
export function assertCitationsDomain(result, solver, label = "solver") {
  const allowed = new Set(solver?.domains || (solver?.domain ? [solver.domain] : []));
  assert.ok(allowed.size > 0, `${label}: solver descriptor declares no domain`);
  for (const obj of walkObjects(result)) {
    if (typeof obj.domain === "string" && ("dtuId" in obj || "citation" in obj || "cites" in obj)) {
      assert.ok(
        allowed.has(obj.domain),
        `${label}: citation in wrong domain "${obj.domain}" (solver domains: ${[...allowed].join(", ")})`
      );
    }
    for (const key of ["dtuId", "citation"]) {
      const val = obj[key];
      if (typeof val === "string") {
        const m = val.match(/^dtu:([a-z0-9_-]+):/i);
        if (m) {
          assert.ok(
            allowed.has(m[1]),
            `${label}: cited DTU "${val}" is in domain "${m[1]}", not the solver's (${[...allowed].join(", ")})`
          );
        }
      }
    }
  }
}
