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
art: 0/71 macros never referenced in the frontend
```

Before this pass, 8 macros were unreferenced or reachable only through a
non-functional stub: `vision`, `artwork-rename`, `layer-clear`,
`stroke-commit-pressure`, `selection-lasso`, `timelapse-frame`,
`stroke-batch`, `symmetry-mirror-stroke`. The last two (`stroke-batch`,
`symmetry-mirror-stroke`) were closed in a later pass — see "Findings —
real gaps, fixed" below; they were originally left deferred (documented
in the now-superseded "Findings — deferred, documented rationale"
section this doc used to carry).

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

### `stroke-batch` — bulk copy/paste — REAL GAP (fixed, 2026-07-16, Wave 4 gap-closure)

Originally deferred: a bulk-insert variant of `stroke-commit` for
importing/pasting many strokes at once, with no UI action (paste, bulk
import) that would ever produce a batch to commit. **Fix:** `ArtCanvas.tsx`
now has a real copy/paste flow built on the existing marquee/lasso
selection mechanism. Selecting strokes and clicking **Copy** snapshots
their real stroke data client-side (nothing to persist yet — there's
nothing server-side to do until a paste happens); clicking **Paste**
serializes the clipboard strokes and posts them through `stroke-batch`,
offset by 24px in x/y so the pasted copies are visibly distinct from the
strokes they were copied from rather than silently stacking on top. The
Paste button is disabled with an empty clipboard (no wasted round-trip).
`stroke-batch` was already fully covered server-side
(`server/tests/art-domain-parity.test.js`, `server/tests/depth/art-behavior.test.js`)
— this closed only the missing UI producer, with no backend changes.

### `symmetry-mirror-stroke` — REAL GAP (fixed, 2026-07-16, Wave 4 gap-closure)

Originally deferred: a Procreate-style symmetry/mandala drawing mode, real
and unwired, with true live-during-stroke mirroring judged out of scope
for the pass's time budget. **Fix, honestly scoped:** guide state
(previously private to `ProStudioPanel`) is lifted to `ArtCanvas`, which is
the component that needs to know whether a symmetry guide is active at the
moment a stroke commits. `ArtCanvas`'s `commit()` now calls
`symmetry-mirror-stroke` with the real committed `strokeId` whenever a
mirror-shaped guide (`vertical`/`horizontal`/`quadrant`/`radial` — never
the perspective guides, which the macro itself rejects) is active, then
reloads so the server-persisted mirrors render. This is deliberately
**post-commit mirroring of an already-persisted stroke**, not true
live-during-stroke rendering — the macro's own design is post-commit (it
takes a `strokeId`, not live point data), so a full live-preview-while-
drawing mirror mode remains a separately-scoped, larger feature; what's
fixed here is that drawing with an active symmetry guide now genuinely
produces real, persisted mirrored strokes instead of doing nothing.
`symmetry-mirror-stroke` was already fully covered server-side — this
closed only the missing caller, with no backend changes.

## Verify gate

- `npx eslint components/art/ArtCanvas.tsx components/art/ProStudioPanel.tsx` — 0 errors/warnings.
- `npx tsc --noEmit -p .` — 0 errors attributable to these files.
- `node scripts/lens-unsurfaced.mjs --lens art` — `0/71 macros never referenced in the frontend`.
- `npx vitest run tests/components/ArtCanvasSymmetryClipboard.test.tsx` — 5/5 passing.
- `node scripts/verify-lens-backends.mjs` — `art` reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `art`: `tier: "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.731`.
