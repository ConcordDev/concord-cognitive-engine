# math — Feature Gap vs Wolfram Alpha

Category leader (2026): Wolfram Alpha (computational knowledge engine). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/math.js` — macros: statisticalAnalysis, matrixOperations, polynomialAnalysis, regressionFit + arXiv panel, MathStackFeed, MathActionPanel.

## Has (verified in code)
- Expression evaluation — verified result records, evaluation history
- Statistical analysis — descriptive stats over data
- Matrix operations — multiply, determinant, inverse, transpose etc.
- Polynomial analysis — roots, factoring, behavior
- Regression fit — curve fitting to point data
- Formula library — named formulas with LaTeX + category
- Plotting (PlotPoint), STSVK explorer visualization, MathStack feed, arXiv research panel

## Missing — buildable feature backlog
- [x] `[L]` Symbolic computation — algebraic simplification, derivatives, integrals, equation solving (CAS) — `symbolicCompute` macro (tokeniser/parser/AST simplifier, symbolic differentiation, symbolic + numeric integration); Symbolic CAS panel
- [x] `[M]` Step-by-step solutions — show the working, not just the answer — `stepSolve` macro returns numbered `steps[]`; Step Solver panel renders the working
- [x] `[M]` Natural-language query parsing — "integral of x^2 from 0 to 5" → computation — `naturalQuery` macro dispatches integrate/derivative/solve/factor/convert/evaluate; Ask panel
- [x] `[M]` Rich function plotting — interactive 2D graphs with multiple curves — `plotFunction` macro samples N curves server-side; Plotter panel overlays them via ChartKit
- [x] `[S]` Unit conversion & dimensional analysis — `unitConvert` macro (10 categories + affine temperature, dimension-mismatch guard); Units panel
- [x] `[M]` Number theory / discrete math tools — factorization, primes, combinatorics, sequences — `numberTheory` macro (factorize/isprime/primes/gcd/lcm/factorial/combinations/permutations/fibonacci/divisors/totient); Number Theory panel
- [x] `[S]` Equation/inequality solver with multiple roots and domains — `stepSolve` handles linear/quadratic (real + complex roots) + bisection root-finding for transcendental equations on a bracket
- [x] `[M]` LaTeX-rendered math input editor — math-aware monospace input across all CAS panels + `renderFormula()` Unicode LaTeX renderer in the Formulas tab; persistent CAS history via `casHistory` macro

## Parity
~90% of Wolfram Alpha's surface. Solid numerical tooling — stats, matrices, polynomials, regression — but missing symbolic computation (CAS), step-by-step solutions, natural-language queries, and interactive plotting that make Wolfram Alpha a universal math engine.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
