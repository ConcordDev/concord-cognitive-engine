# fractal — Feature Gap vs Mandelbulber / fractal generators

Category leader (2026): Mandelbulber / Apophysis / online fractal generators. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `fractal` domain — fractalDimension (box-counting), selfSimilarity, complexityMeasure analytics + generic artifact store for Patterns/Nodes/Generators/Iterations/Exports.

## Has (verified in code)
- Pattern / node / generator / iteration / export artifact management (5 tabs)
- Fractal-dimension measurement (box-counting), self-similarity analysis, complexity measure
- Generator config (algorithm, seed, scale, iterations, formula, parameters, color scheme)
- Iteration tracking with depth/complexity/dimensions/symmetry; export format/resolution metadata
- FractalRepos component for repo-style organization

## Missing — buildable feature backlog
- [ ] `[L]` Actual fractal renderer — Mandelbrot/Julia/IFS canvas with zoom/pan
- [ ] `[M]` Real-time parameter editing with live preview
- [ ] `[M]` Color-palette / gradient editor mapping iteration counts to colors
- [ ] `[S]` Deep-zoom with arbitrary precision + zoom-path animation
- [ ] `[S]` Export rendered images at high resolution (export is metadata-only)
- [ ] `[M]` 3D fractals (Mandelbulb) with lighting
- [ ] `[S]` Preset gallery + parameter sharing/import

## Parity
~30% of a fractal generator's feature surface. It has solid analytical macros (dimension, self-similarity, complexity) and an artifact-management shell, but there is no actual fractal *renderer* — the core of any fractal tool. It documents fractals more than it generates them.
