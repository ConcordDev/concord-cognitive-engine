# Fractal Lens — Capability Map (Frontend Rebuild Program, Wave 2 batch 6)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("fractal"' server/domains/fractal.js` → 15

## Reference apps + parity target

- **Real fractal explorers** (e.g. the classic Mandelbrot/Julia explorer
  lineage — XaoS, Fractint, and their modern WebGL descendants) — real
  zoom/pan escape-time rendering, palette control, deep-zoom sequences,
  and orbit/parameter inspection, not decorative pre-rendered art.
- **Box-counting / Hurst-exponent fractal-analysis tools** (the
  research-grade side of the category — fractal dimension estimation on
  real point sets or time series, self-similarity/motif detection,
  Lempel-Ziv/Shannon complexity measurement).
- **Parity target** (owner's framing): the only difference between the
  fractal lens and a real escape-time explorer + fractal-analysis
  toolkit combined should be which fractal families and analysis
  methods are wired — every dimension estimate, similarity score, and
  rendered pixel should trace to the real escape-time math running
  server- or client-side, never a placeholder number.

## Checklist — reference-app features vs. Concord fractal

| Feature | Bucket | Disposition |
|---|---|---|
| Interactive escape-time renderer (Mandelbrot/Julia/Burning-Ship/Tricorn/Multibrot), click/scroll-zoom, drag-pan | ALREADY REAL | `FractalRenderer` — client-side chunked, non-blocking escape-time compute |
| Palette control (multiple color-stop schemes) | ALREADY REAL | `fractal.paletteFor` → LUT-driven canvas coloring |
| Orbit inspector (click a point, see its escape-time trajectory) | ALREADY REAL | `fractal.orbit` → `OrbitPlot` SVG trace |
| Save/load/import/export view presets | ALREADY REAL | `fractal.savePreset`/`listPresets`/`deletePreset`/`importPreset`/`exportPreset` → Presets panel |
| High-resolution image export + render history | ALREADY REAL | `fractal.recordRender`/`listRenders` → 1920×1080 PNG export + Export History |
| Deep-zoom path animation between two views | ALREADY REAL | `fractal.zoomPath` → Zoom Anim button |
| 3D Mandelbulb viewer | ALREADY REAL | `fractal.mandelbulb` → depth-composited z-slice canvas |
| Fractal-dimension estimation (box-counting / Hurst exponent) on a real point set or signal | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `fractal.fractalDimension` had zero UI (a fake "Patterns" library where users hand-typed a `depth`/`complexity` number stood in its place) — **fixed this rebuild**, new "Analyze Current View" panel |
| Self-similarity / repeating-motif detection across scales | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `fractal.selfSimilarity` had zero UI — **fixed this rebuild**, same panel |
| Structural complexity measurement (Lempel-Ziv, Shannon entropy, multi-scale entropy) | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `fractal.complexityMeasure` had zero UI — **fixed this rebuild**, same panel |
| Real-world fractal/generative-art tooling discovery | ALREADY REAL | `FractalRepos` (GitHub topic search) |

Every checklist item now resolves to ALREADY REAL. The only 3 real gaps
(dimension / self-similarity / complexity) are fixed this rebuild — no
GENUINELY MISSING items remain, and nothing needed relabeling.

## What this rebuild fixed

1. **Removed a fully fabricated Patterns/Nodes/Generators/Iterations/
   Exports CRUD system.** Five tabs backed by a disconnected
   `useLensData('fractal', <type>, ...)` generic store: a user hand-typed
   a `depth`, `iterations`, `complexity`, `symmetry`, `formula` etc. as
   free text with no computation behind any of it, and the "Activate"
   button per row called a generic `generate` action with no real
   fractal-domain macro behind it. None of these fields were ever
   verified against the actual escape-time math — a textbook instance of
   the "fabricated data presented as live" pattern this rebuild program
   exists to close. The one real, deeply-built component underneath it
   (`FractalRenderer`, already wired to 10 of the domain's 15 macros —
   palette/orbit/presets/render-history/zoom-path/mandelbulb) was mounted
   below the fake library, effectively hidden behind it as a footnote.
2. **Removed the generic catalog fallback + the generic per-item action
   row** that stood in front of the real renderer (a "Lens Features &
   Capabilities" listing plus a compact generic action strip keyed off
   whichever fake item happened to be first in the list) — both
   redundant once the real macro surface has real designed homes.
3. **New "Analyze Current View" panel** (inside `FractalRenderer`, next
   to the 3D Mandelbulb viewer) wires the 3 previously-unsurfaced
   macros against REAL data sampled from the live view — never a
   decorative or user-typed number:
   - **Dimension**: re-samples a 96×96 escape-time grid of exactly
     what's on screen, extracts the actual set/escaped boundary pixels
     (edge-detected against 4-neighbors), and box-counts them via
     `fractal.fractalDimension` — an honest fractal-dimension estimate
     of the currently-displayed boundary, not a fixed number.
   - **Self-Similarity**: takes a center scanline of the same
     escape-time grid as a 1-D signal and runs `fractal.selfSimilarity`
     for real cross-scale motif/correlation detection.
   - **Complexity**: same scanline through `fractal.complexityMeasure`
     for real Lempel-Ziv + Shannon-entropy scoring.
   All three results are invalidated (cleared, not left stale) the
   moment the user pans/zooms/changes fractal type or parameters, so a
   reading always describes the view it was computed from.
4. **Reorganized the page** around the single real renderer + the new
   analysis panel + the real GitHub-tooling discovery feed — no tabs
   left standing for data that was never real.

## Left alone (already real)

`FractalRenderer`'s canvas/pointer interactions, palette LUT, orbit
inspector, presets (save/load/import/export), render history, deep-zoom
animation, 3D Mandelbulb viewer, and `FractalRepos` — all pre-existing,
already wired against real `fractal.*` macros or real external data
(GitHub topic search).

## Verification

- `npx eslint app/lenses/fractal/page.tsx components/fractal/*.tsx` — clean, 0 errors / 0 warnings.
- `npx tsc --noEmit -p .` — 0 errors project-wide (run together with quantum + neuro).
- No lens-specific vitest file exists for fractal (`find . -iname "*fractal*test*"` → none) — nothing to run; flagged here per the rebuild-loop instructions rather than silently skipped.
- `node scripts/verify-lens-backends.mjs` — fractal stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — fractal: `tier: "polished"`, `isGenericScaffold: false` (was `functional` / `isGenericScaffold: true` before this rebuild).
