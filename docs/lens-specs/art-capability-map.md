# art — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("art"' server/domains/art.js` → 71

## Reference app + parity target

**Procreate / Krita (2026 shape)**, plus **Met Museum Open Access / Art
Institute of Chicago** for the reference-art browsing side. This lens had
already been through a prior rebuild wave: 12 components, 4,346 LOC, 72%
bespoke, a real layered canvas (`ArtCanvas.tsx`) and a genuine pro toolset
(`ProStudioPanel.tsx`: filters, stylus dynamics, free-angle rotation,
selection refinement, guides, timelapse, gradient/pattern fills). This
audit's job was finding what was disconnected inside an otherwise mature
lens, not building from scratch.

## `node scripts/lens-unsurfaced.mjs --lens art` (after fix)

```
art: 2/71 macros never referenced in the frontend
  stroke-* (1): stroke-batch
  symmetry-* (1): symmetry-mirror-stroke
```

Before this pass, 8 macros were unreferenced or reachable only through a
non-functional stub: `vision`, `artwork-rename`, `layer-clear`,
`stroke-commit-pressure`, `selection-lasso`, `timelapse-frame`,
`stroke-batch`, `symmetry-mirror-stroke`.

## Findings — genuinely broken (fabricated-looking) features, fixed

### Timelapse recording never captured a frame — REAL DEFECT (fixed)

`ProStudioPanel.tsx`'s Timelapse tab had working Start/Stop buttons and a
scrubber UI, but `art.timelapse-frame` (the macro that actually appends a
frame) was never called from anywhere. Every recording session finished
with `frameCount: 0` — the feature looked complete (real buttons, real
scrubber, real backend macro) but silently did nothing. **Fix:** threaded
the live `<canvas>` element down into `ProStudioPanel` and added an
interval effect that captures a downscaled JPEG snapshot every 4s while
`tlRecording` is true, calling `timelapse-frame` for real.

### Lasso selection was a stub that told the user to do something impossible — REAL DEFECT (fixed)

`ProStudioPanel.tsx` had a `lassoFromSelection` handler whose entire body
was `flash('Draw a freehand lasso on the canvas, or use Magic Wand.')` —
it never drew anything, and no code anywhere called `selection-lasso`.
The lens *offered* freehand lasso as a real capability but the described
path didn't exist. **Fix:** added a real `lasso` tool to `ArtCanvas.tsx`'s
toolbar — freehand dashed-outline capture on the actual canvas, committed
on pointer-up via `selection-lasso` with the traced polygon, setting the
real selection from the server's point-in-polygon match.

## Findings — real gaps, fixed

### Pressure-sensitive strokes never used real pressure — REAL GAP (fixed)

`toPoint()` never read `PointerEvent.pressure`; every stroke went through
plain `stroke-commit` with a flat line width, so `art.stroke-commit-pressure`
(a genuine variable-width ribbon macro) was dead. **Fix:** `toPoint` now
captures pressure; a real stylus stroke (pointerType `pen` with pressure
that actually varies, not a mouse's flat 0.5) commits through
`stroke-commit-pressure`, and `drawElement`'s replay path renders true
per-segment width for `pressure: true` strokes.

### `artwork-rename` — REAL GAP (fixed)

No UI anywhere let a user rename a saved artwork after creation. **Fix:**
the canvas header title is now a click-to-rename field wired to
`artwork-rename`.

### `layer-clear` — REAL GAP (fixed)

Deleting individual strokes existed; wiping an entire layer's strokes in
one action (distinct from deleting the layer itself) did not. **Fix:**
added a "Clear" button to each layer's expanded controls.

### `vision` — REAL GAP (fixed)

`callVision`/`callVisionUrl` (LLaVA-class vision model) were wired for
this domain but nothing ever sent the canvas to it. **Fix:** added an "AI
Critique" button that snapshots the live canvas and requests a real
critique (composition/color/technique), with an honest "vision brain
unavailable" failure state — never a fabricated critique.

## Findings — deferred, documented rationale

- **`stroke-batch`** — a bulk-insert variant of `stroke-commit` for
  importing/pasting many strokes at once. The live drawing path commits
  one continuous stroke per pointer-down/up cycle, which is the correct
  granularity for real-time drawing; there's no current UI action (paste,
  bulk import) that would produce a batch of strokes to commit at once.
  Genuinely missing, but not a defect in what exists today.
- **`symmetry-mirror-stroke`** — a Procreate-style live symmetry/mandala
  drawing mode. Real, valuable, and unwired, but implementing it properly
  (mirroring a stroke across the active guide axis in real time as the
  user draws) is a live-rendering feature on par in scope with the lasso
  fix, not a small wiring gap — deferred rather than half-built under this
  pass's time budget.

## Verify gate

- `npx eslint components/art/ArtCanvas.tsx components/art/ProStudioPanel.tsx` — 0 errors/warnings.
- `npx tsc --noEmit -p .` — 0 errors attributable to these files.
- `node scripts/verify-lens-backends.mjs` — `art` reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `art`: `tier: "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.731`.
