// tests/depth/math-polynomial-roots-general-behavior.test.js — REAL behavioral
// tests for `math.polynomialRootsGeneral` (the arbitrary-degree Durand-Kerner
// root-finder that closes docs/WAVE4_INVENTORY.md row 241 — the general
// polynomial root-finder gap `polynomialAnalysis` itself documents via its
// "Root-finding for degree > 4 not implemented" note).
//
// Every expected root below was hand-verified BEFORE this file was written
// (per CLAUDE.md's "compute-don't-guess" discipline): each test polynomial
// is either solved by hand (quadratic formula / simple factoring) or built
// by literally multiplying out known linear/quadratic factors, so the
// expected values are not something an LLM "remembers" — they're derived.
//
// Contract reminder (see _harness.js): lens.run unwraps a handler's
// { ok, result } → the OUTER `result`. A SUCCESS field is `r.result.<field>`;
// a handler REFUSAL ({ok:false,error}, no `result` key) is NOT unwrapped →
// `r.result.ok === false` + `r.result.error`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

/** Find the root in `roots` closest to (re, im) and assert it matches within eps. */
function assertHasRoot(roots, re, im, eps = 1e-5) {
  const match = roots.find((r) => Math.abs(r.re - re) < eps && Math.abs(r.im - im) < eps);
  assert.ok(match, `expected a root near ${re}${im >= 0 ? "+" : ""}${im}i in ${JSON.stringify(roots)}`);
  return match;
}

describe("math — polynomialRootsGeneral (Durand-Kerner, arbitrary degree)", () => {
  it("x^2 - 5x + 6 → roots {2, 3}, both real, both converged", async () => {
    // Hand-verified: (x-2)(x-3) = x^2 - 5x + 6.
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [1, -5, 6] } });
    assert.equal(r.result.degree, 2);
    assert.equal(r.result.method, "durand-kerner");
    assert.equal(r.result.roots.length, 2);
    assert.equal(r.result.allConverged, true);
    const a = assertHasRoot(r.result.roots, 2, 0);
    const b = assertHasRoot(r.result.roots, 3, 0);
    assert.equal(a.isReal, true);
    assert.equal(b.isReal, true);
    assert.equal(a.converged, true);
    assert.equal(b.converged, true);
    // sorted ascending by real part
    assert.ok(r.result.roots[0].re <= r.result.roots[1].re);
  });

  it("x^3 - 6x^2 + 11x - 6 → roots {1, 2, 3}", async () => {
    // Hand-verified: (x-1)(x-2)(x-3) = x^3 - 6x^2 + 11x - 6.
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [1, -6, 11, -6] } });
    assert.equal(r.result.degree, 3);
    assert.equal(r.result.roots.length, 3);
    assert.equal(r.result.allConverged, true);
    assertHasRoot(r.result.roots, 1, 0);
    assertHasRoot(r.result.roots, 2, 0);
    assertHasRoot(r.result.roots, 3, 0);
    assert.ok(r.result.roots.every((rt) => rt.isReal));
  });

  it("x^4 - 1 → roots {1, -1, i, -i} — 2 real, 2 complex, all converged (genuine complex-root correctness)", async () => {
    // Hand-verified: x^4 - 1 = (x-1)(x+1)(x-i)(x+i).
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [1, 0, 0, 0, -1] } });
    assert.equal(r.result.degree, 4);
    assert.equal(r.result.roots.length, 4);
    assert.equal(r.result.allConverged, true);
    const realRoots = r.result.roots.filter((rt) => rt.isReal);
    const complexRoots = r.result.roots.filter((rt) => !rt.isReal);
    assert.equal(realRoots.length, 2);
    assert.equal(complexRoots.length, 2);
    assertHasRoot(r.result.roots, 1, 0);
    assertHasRoot(r.result.roots, -1, 0);
    assertHasRoot(r.result.roots, 0, 1);
    assertHasRoot(r.result.roots, 0, -1);
    // complex roots come as a conjugate pair
    near(complexRoots[0].im, -complexRoots[1].im);
  });

  it("x^4 + 1 → all 4 roots complex (the classic 'no real roots' case)", async () => {
    // Hand-verified: roots are the primitive 8th roots of unity e^{i(2k+1)π/4},
    // i.e. (±√2/2 ± √2/2 i) — none of them real.
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [1, 0, 0, 0, 1] } });
    assert.equal(r.result.degree, 4);
    assert.equal(r.result.roots.length, 4);
    assert.equal(r.result.allConverged, true);
    assert.equal(r.result.roots.filter((rt) => rt.isReal).length, 0);
    const s = Math.SQRT1_2;
    assertHasRoot(r.result.roots, s, s);
    assertHasRoot(r.result.roots, s, -s);
    assertHasRoot(r.result.roots, -s, s);
    assertHasRoot(r.result.roots, -s, -s);
  });

  it("degree-5 (x-1)(x-2)(x-3)(x-4)(x-5) → roots {1,2,3,4,5}", async () => {
    // Hand-multiplied out (and cross-checked by a standalone Node script
    // before writing this test): x^5 -15x^4 +85x^3 -225x^2 +274x -120.
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [1, -15, 85, -225, 274, -120] } });
    assert.equal(r.result.degree, 5);
    assert.equal(r.result.roots.length, 5);
    assert.equal(r.result.allConverged, true);
    for (const expected of [1, 2, 3, 4, 5]) assertHasRoot(r.result.roots, expected, 0);
    assert.ok(r.result.roots.every((rt) => rt.isReal));
  });

  it("complex-conjugate degree-3 case: (x-1)(x-(2+3i))(x-(2-3i)) → {1, 2+3i, 2-3i}", async () => {
    // Hand-multiplied: (x-2-3i)(x-2+3i) = (x-2)^2 + 9 = x^2 -4x +13.
    // (x-1)(x^2-4x+13) = x^3 -4x^2+13x -x^2+4x-13 = x^3 -5x^2+17x-13.
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [1, -5, 17, -13] } });
    assert.equal(r.result.degree, 3);
    assert.equal(r.result.allConverged, true);
    assertHasRoot(r.result.roots, 1, 0);
    assertHasRoot(r.result.roots, 2, 3);
    assertHasRoot(r.result.roots, 2, -3);
  });

  it("leading zero coefficients are stripped, not rejected: [0,1,-5,6] behaves like [1,-5,6]", async () => {
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [0, 1, -5, 6] } });
    assert.equal(r.result.degree, 2);
    assert.equal(r.result.leadingZerosStripped, 1);
    assertHasRoot(r.result.roots, 2, 0);
    assertHasRoot(r.result.roots, 3, 0);
  });

  it("a repeated (double) root — known slow-convergence case, but Durand-Kerner does converge here", async () => {
    // (x-2)^2(x-3) = x^3 - 7x^2 + 16x - 12. Empirically (verified via a
    // standalone prototype before this file was written) this converges
    // within the 500-iteration budget, but takes far more iterations
    // (~388) than a well-separated-roots case (~10-25) — the real,
    // documented Durand-Kerner slow-convergence signature for repeated
    // roots, even though it does not fail outright here.
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [1, -7, 16, -12] } });
    assert.equal(r.result.degree, 3);
    assertHasRoot(r.result.roots, 2, 0, 1e-4);
    assertHasRoot(r.result.roots, 3, 0, 1e-4);
    assert.ok(r.result.iterations > 50, `expected a slow convergence (iterations=${r.result.iterations})`);
  });

  it("a triple root — documented limitation: does NOT converge within tolerance (honest converged:false)", async () => {
    // (x-2)^3 = x^3 - 6x^2 + 12x - 8. Empirically verified (standalone
    // prototype, before writing this test) this hits the 500-iteration cap
    // without any root's step size dropping below the convergence epsilon —
    // the classic Durand-Kerner failure mode for a root of multiplicity 3.
    // The macro MUST report this honestly (converged:false), not paper over
    // it with a confident-looking exact "2".
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [1, -6, 12, -8] } });
    assert.equal(r.result.degree, 3);
    assert.equal(r.result.allConverged, false);
    assert.ok(r.result.roots.some((rt) => rt.converged === false));
    assert.ok(typeof r.result.note === "string" && r.result.note.length > 0);
    // Even without full convergence, the estimates should still land close
    // to the true root (the method degrades gracefully, it doesn't diverge).
    for (const rt of r.result.roots) near(rt.re, 2, 1e-2);
  });

  it("validation: empty coefficient array is honestly rejected", async () => {
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("No coefficients"));
  });

  it("validation: the all-zero polynomial is honestly rejected (infinitely many roots, not well-posed)", async () => {
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [0, 0, 0] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("zero polynomial"));
  });

  it("validation: non-finite coefficients are rejected", async () => {
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [1, NaN, 2] } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("finite"));
  });

  it("a constant (degree-0) non-zero polynomial has no roots", async () => {
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [5] } });
    assert.equal(r.result.degree, 0);
    assert.deepEqual(r.result.roots, []);
  });

  it("degree-1 linear polynomial 2x - 10 → root {5}", async () => {
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: [2, -10] } });
    assert.equal(r.result.degree, 1);
    assert.equal(r.result.roots.length, 1);
    near(r.result.roots[0].re, 5);
    assert.equal(r.result.roots[0].isReal, true);
    assert.equal(r.result.allConverged, true);
  });

  it("validation: degree exceeding the supported maximum is rejected", async () => {
    const coeffs = [1, ...new Array(61).fill(0)]; // degree 61
    const r = await lensRun("math", "polynomialRootsGeneral", { data: { coefficients: coeffs } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("exceeds the supported maximum"));
  });
});
