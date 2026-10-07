/**
 * ConKay beam V&V corpus runner.
 *
 * Loads server/tests/vv/beam-corpus.json and asserts every closed-form
 * expectation against fea-solver.js#runFEA within maxRelativeError.
 *
 * Honesty (STACK_REALITY): oracles are Euler–Bernoulli / statics textbook
 * formulas already pinned by fea-frame-element / fea-reactions / engineering
 * FEA scene tests — NOT commercial-solver or solid-FEA parity.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runFEA } from "../../lib/simulation/fea-solver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(__dirname, "beam-corpus.json"), "utf8"));

function relErr(got, expected) {
  const scale = Math.max(1, Math.abs(expected));
  return Math.abs(got - expected) / scale;
}

function assertGate(got, expected, label, maxRel) {
  const err = relErr(got, expected);
  assert.ok(
    err <= maxRel,
    `${label}: got ${got}, expected ${expected}, relErr=${err} > gate ${maxRel}`,
  );
}

function findDisp(result, nodeId) {
  const d = result.displacements.find((x) => String(x.nodeId) === String(nodeId));
  assert.ok(d, `displacement for node ${nodeId}`);
  return d;
}

function findReaction(result, nodeId, dof) {
  const r = result.reactions.find(
    (x) => String(x.nodeId) === String(nodeId) && x.dof === dof,
  );
  assert.ok(r, `reaction ${nodeId}.${dof}`);
  return r;
}

function findById(list, id) {
  return list.find((x) => String(x.id) === String(id) || String(x.memberId) === String(id));
}

test("beam V&V corpus metadata is honest (closed-form, not commercial parity)", () => {
  assert.equal(corpus.version, 1);
  assert.ok(corpus.maxRelativeError > 0 && corpus.maxRelativeError <= 1e-3);
  assert.match(String(corpus.honesty), /closed-form|Euler|textbook/i);
  assert.ok(Array.isArray(corpus.cases));
  assert.ok(corpus.cases.length >= 8 && corpus.cases.length <= 16);
});

test("beam V&V corpus: all cases pass max relative error gate via runFEA", () => {
  const maxRel = corpus.maxRelativeError;
  const failures = [];

  for (const c of corpus.cases) {
    const result = runFEA(c.model);
    assert.equal(result.ok, true, `${c.id}: runFEA ok`);
    const expect = c.expect || {};

    for (const e of expect.displacements || []) {
      const d = findDisp(result, e.nodeId);
      const got = d[e.field];
      assert.equal(typeof got, "number", `${c.id}: ${e.nodeId}.${e.field} numeric`);
      const err = relErr(got, e.value);
      if (err > maxRel) {
        failures.push(`${c.id} disp ${e.nodeId}.${e.field}: got=${got} expect=${e.value} relErr=${err}`);
      }
    }

    for (const e of expect.reactions || []) {
      const r = findReaction(result, e.nodeId, e.dof);
      const err = relErr(r.force, e.value);
      if (err > maxRel) {
        failures.push(`${c.id} react ${e.nodeId}.${e.dof}: got=${r.force} expect=${e.value} relErr=${err}`);
      }
    }

    for (const e of expect.memberForces || []) {
      const mf = findById(result.memberForces, e.memberId);
      assert.ok(mf, `${c.id}: memberForce ${e.memberId}`);
      const got = mf[e.field];
      const err = relErr(got, e.value);
      if (err > maxRel) {
        failures.push(`${c.id} force ${e.memberId}.${e.field}: got=${got} expect=${e.value} relErr=${err}`);
      }
    }

    for (const e of expect.stresses || []) {
      const st = findById(result.stresses, e.memberId);
      assert.ok(st, `${c.id}: stress ${e.memberId}`);
      const got = st[e.field];
      const err = relErr(got, e.value);
      if (err > maxRel) {
        failures.push(`${c.id} stress ${e.memberId}.${e.field}: got=${got} expect=${e.value} relErr=${err}`);
      }
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
});

for (const c of corpus.cases) {
  test(`beam V&V case: ${c.id}`, () => {
    const result = runFEA(c.model);
    assert.equal(result.ok, true);
    const maxRel = corpus.maxRelativeError;
    for (const e of c.expect?.displacements || []) {
      assertGate(findDisp(result, e.nodeId)[e.field], e.value, `${c.id}.${e.field}`, maxRel);
    }
    for (const e of c.expect?.reactions || []) {
      assertGate(findReaction(result, e.nodeId, e.dof).force, e.value, `${c.id}.${e.dof}`, maxRel);
    }
    for (const e of c.expect?.memberForces || []) {
      const mf = findById(result.memberForces, e.memberId);
      assertGate(mf[e.field], e.value, `${c.id}.${e.field}`, maxRel);
    }
    for (const e of c.expect?.stresses || []) {
      const st = findById(result.stresses, e.memberId);
      assertGate(st[e.field], e.value, `${c.id}.${e.field}`, maxRel);
    }
  });
}
