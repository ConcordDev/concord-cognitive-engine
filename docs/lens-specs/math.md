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
- [ ] `[L]` Symbolic computation — algebraic simplification, derivatives, integrals, equation solving (CAS)
- [ ] `[M]` Step-by-step solutions — show the working, not just the answer
- [ ] `[M]` Natural-language query parsing — "integral of x^2 from 0 to 5" → computation
- [ ] `[M]` Rich function plotting — interactive 2D/3D graphs with zoom, multiple curves
- [ ] `[S]` Unit conversion & dimensional analysis
- [ ] `[M]` Number theory / discrete math tools — factorization, primes, combinatorics, sequences
- [ ] `[S]` Equation/inequality solver with multiple roots and domains
- [ ] `[M]` LaTeX-rendered math input editor

## Parity
~40% of Wolfram Alpha's surface. Solid numerical tooling — stats, matrices, polynomials, regression — but missing symbolic computation (CAS), step-by-step solutions, natural-language queries, and interactive plotting that make Wolfram Alpha a universal math engine.
