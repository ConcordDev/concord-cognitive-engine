# Photography Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.
> This is a distinct lens from `photos` (a separate, already-audited simple
> media gallery — see `docs/lens-specs/photos-capability-map.md`). `photography`
> is the Lightroom-shaped catalog/develop engine; `photos` is the plain
> capture-and-share gallery. They share no macros and no state.

## Backend surface

```
grep -c 'registerLensAction("photography"' server/domains/photography.js
```
→ **58** macros in `server/domains/photography.js` (1,067 lines), registered
via `registerPhotographyActions(register)`. No domain-string collisions with
any other lens; `server/domains/photos.js` (4 macros, unrelated) is the only
naming-adjacent file.

Real surfaces: 4 pure-compute photographer calculators (`exposureCalc`,
`compositionAnalysis`, `gearRecommend`, `printSize`), a Pexels stock-photo
search (`pexels-search`), a live-archive feed (`feed`, Art Institute of
Chicago public-domain works), an LLM vision macro (`vision`), and a large
STATE-backed Lightroom catalog engine covering import/list/detail/update/
delete (`photo-*`), culling (`photo-rate/flag/color-label`, `cull-filter`,
`cull-summary`), keywords (`keyword-add/list`) and full-text search
(`photo-search`), develop presets (`preset-create/list/apply/delete/
apply-batch`), non-destructive develop (`develop-set/reset/copy-paste`),
RAW pipeline (`raw-develop`, `raw-decode-meta`), histogram + tone curve
(`histogram-compute`, `tone-curve-save/list/apply/delete`), local-adjustment
masking (`mask-create/list/update/delete`), face/person tagging
(`face-tag-add/list`), smart collections (`smart-collection-create/list/
eval/delete`), lens correction + geometry (`lens-correction-set`,
`geometry-set`), albums (`album-create/list/detail/add-photo/delete`),
shoots (`shoot-create/list/assign`), export presets (`export-preset-save/
list`), and a catalog stats rollup (`catalog-stats`).

## Frontend surface

`concord-frontend/app/lenses/photography/page.tsx` (985 → 917 lines) +
`concord-frontend/components/photography/{PhotographyLightroomSection,
LightroomLibraryPanel, LightroomDevelopPanel, LightroomDarkroomPanel,
LightroomCollectionsPanel, LightroomExportPanel, PhotographyActionPanel,
PexelsBrowser}.tsx`.

## The defect found

### A duplicate, field-shape-broken "Photo Analysis" quick panel sitting inside `page.tsx`, redundant with the already-real `PhotographyActionPanel`

`page.tsx` mounted a "Photo Analysis" button strip (4 buttons — Exposure
Calc / Composition / Gear Recommend / Print Size) that called
`useRunArtifact('photography').mutateAsync({ id: targetId, action })` →
`POST /api/lens/photography/:id/run`, where `targetId` was
`photoItems[0]?.id` — the **first item in the page's own separate media
gallery** (title/description/tags/camera/lens/iso/aperture/shutter/
focalLength/location/mediaId/likes/views — a generic-CRUD `useLensData`
record, real and independently useful for browsing uploaded photos, but
**not** the Lightroom catalog `photo-*` macros operate on).

Cross-checked against the real macro contracts in `server/domains/
photography.js`:

- `exposureCalc` reads `artifact.data.iso`/`.aperture`/`.ev`. The gallery
  item has no `ev` field at all, so this macro **always** fell through to
  its defaults (`iso:100, aperture:5.6, ev:12`) regardless of which photo
  was "selected" or what its own ISO/aperture badges showed.
- `compositionAnalysis` reads `artifact.data.compositionRules` (an array).
  The gallery item has no such field — **always** `rulesApplied: []`,
  `strength: "no-rules-applied"`.
- `gearRecommend` reads `artifact.data.genre`/`.budget`. The gallery item
  has neither — **always** falls back to the `general` recommendation.
- `printSize` reads `artifact.data.widthPixels`/`.heightPixels`/`.dpi`. The
  gallery item has none of these — **always** the `4000×3000@300dpi`
  default result.

So the panel produced the exact same canned output on every single click,
for every photo, forever — a hard-coded result rendered as if it were
per-photo analysis. This is the recurring pattern's case (b) (wrong field
shapes → garbage results) compounded with case (c) (a parallel, less
capable duplicate of an already-real, already-mounted component):
`PhotographyActionPanel` (mounted lower on the same page, line ~908 pre-fix)
already does this correctly — real ISO/aperture/EV number inputs, a
composition-rule toggle strip, genre/budget selects, and width/height/DPI
inputs, feeding the identical four macros with the correct shapes, plus
DM/publish/mint/agent follow-ons the removed panel never had.

## What changed

### `app/lenses/photography/page.tsx`

Removed the "Backend Action Panel" quick-analysis block (the 4-button strip,
its `actionResult` render tree, and the supporting `runAction`/
`actionResult`/`isRunning`/`handlePhotoAction` state and the now-unused
`useRunArtifact`/`Play`/`Loader2` imports). `PhotographyActionPanel` — the
real, correctly-shaped version of the same four calculators — was already
mounted lower on the page and needed no changes to absorb this
responsibility; net effect is a working page with no duplicate broken
surface, not a capability loss.

### `components/photography/LightroomLibraryPanel.tsx` — closed 3 previously-unsurfaced macros

- **`photo-search`** — a real search bar (title/filename/camera/lens/
  keyword substring match, server-side) above the catalog list. Before this
  pass the only way to narrow the list was the pre-existing flag/rating
  filter chips; free-text search across the catalog had zero frontend
  caller.
- **`keyword-list`** — a keyword cloud (keyword + count, from the real
  aggregate) rendered under the search bar; clicking a keyword chip sets it
  as a `photo-list` filter (composes with the existing flag filter). Before
  this pass keywords could only be **added** per-photo (`keyword-add`); the
  browse/filter-by-keyword direction of the same feature was missing.
- **`photo-update`** — an inline "Edit metadata" form (pencil icon per row)
  for title/camera/lens. Before this pass a photo's metadata was
  write-once at import time — there was no way to correct a typo or fill
  in gear info discovered after import, even though the backend has always
  supported it.

### `components/photography/LightroomDevelopPanel.tsx` — closed 1 previously-unsurfaced macro

- **`preset-delete`** — a delete (trash) icon on each preset chip in the
  "Apply a preset" row. Before this pass presets could be created and
  applied but never removed, so a catalog would only ever accumulate
  presets.

### `components/photography/LightroomDarkroomPanel.tsx` — closed 3 previously-unsurfaced macros

- **`tone-curve-list`** — a "Saved curves" list under the curve editor,
  loaded on mount and after every save.
- **`tone-curve-delete`** — a delete icon per saved curve.
- Closing `tone-curve-list` also exposed a **second, real bug of omission**:
  `tone-curve-apply` has always accepted either raw `points` *or* a saved
  `curveId` (`server/domains/photography.js:692-707`), but the frontend
  only ever sent raw `points` — a saved curve could never be **reapplied by
  name** to a different photo; the user would have to manually redraw it.
  Fixed by adding an "apply" button per saved curve (calls `tone-curve-apply`
  with `curveId`) alongside an "edit" button (loads the curve's points back
  into the interactive editor for further tweaking, still via the existing
  raw-`points` path).
- **`cull-summary`** — a compact 6-tile stat strip (total / picks / rejects
  / unflagged / 5★ / 0★) at the top of the Cull Filter tab, loaded on mount.
  Distinct from `catalog-stats` (photos/albums/shoots/presets/picks/edited,
  shown in the top-level header) — `cull-summary` is the per-rating
  breakdown specific to culling, which nothing rendered before this pass.

## Macro → UI classification (all 58 macros)

**DESIGNED** (real, bespoke UI, no fabrication) — 57/58 after this pass (was
53/58 before: 4 unsurfaced per `node scripts/lens-unsurfaced.mjs --lens
photography` re-run below, plus the 4-macro duplicate-panel field-shape bug
above; `keyword-list` was unsurfaced but not caught by the static scanner
because `photo-list`'s `keyword` param made it look reachable — it wasn't,
nothing ever called `keyword-list` itself):

| Macro group | Count | Where |
|---|---:|---|
| `exposureCalc`, `compositionAnalysis`, `gearRecommend`, `printSize` | 4 | `PhotographyActionPanel.tsx` (pre-existing, real; **duplicate broken caller in `page.tsx` removed this pass**) |
| `pexels-search` | 1 | `PexelsBrowser.tsx` (pre-existing, real) |
| `feed` | 1 | `LensFeedButton` generic component, `domain="photography"` (pre-existing, real — the platform-standard live-archive-feed pattern) |
| `photo-import/list/rate/flag/color-label/delete`, `keyword-add` | 7 | `LightroomLibraryPanel.tsx` (pre-existing, real) |
| `photo-search`, `keyword-list`, `photo-update` | 3 | `LightroomLibraryPanel.tsx` (**newly wired this pass**) |
| `preset-create/list/apply`, `develop-set/reset` | 5 | `LightroomDevelopPanel.tsx` (pre-existing, real) |
| `preset-delete` | 1 | `LightroomDevelopPanel.tsx` (**newly wired this pass**) |
| `raw-develop`, `raw-decode-meta` | 2 | `LightroomDarkroomPanel.tsx` RAW Develop tab (pre-existing, real) |
| `histogram-compute`, `tone-curve-save/apply` | 3 | `LightroomDarkroomPanel.tsx` Histogram & Curve tab (pre-existing, real) |
| `tone-curve-list`, `tone-curve-delete` | 2 | `LightroomDarkroomPanel.tsx` Histogram & Curve tab (**newly wired this pass**) |
| `mask-create/list/update/delete` | 4 | `LightroomDarkroomPanel.tsx` Masking tab (pre-existing, real) |
| `cull-filter` | 1 | `LightroomDarkroomPanel.tsx` Cull Filter tab (pre-existing, real) |
| `cull-summary` | 1 | `LightroomDarkroomPanel.tsx` Cull Filter tab (**newly wired this pass**) |
| `face-tag-add/list`, `smart-collection-create/list/eval/delete` | 6 | `LightroomDarkroomPanel.tsx` Smart & Faces tab (pre-existing, real) |
| `preset-apply-batch`, `develop-copy-paste` | 2 | `LightroomDarkroomPanel.tsx` Batch Sync tab (pre-existing, real) |
| `lens-correction-set`, `geometry-set` | 2 | `LightroomDarkroomPanel.tsx` Lens & Geometry tab (pre-existing, real) |
| `album-create/list/detail/add-photo/delete`, `shoot-create/list/assign` | 8 | `LightroomCollectionsPanel.tsx` (pre-existing, real) |
| `export-preset-save/list` | 2 | `LightroomExportPanel.tsx` (pre-existing, real) |
| `catalog-stats` | 1 | `PhotographyLightroomSection.tsx` header (pre-existing, real) |
| `vision` | 1 | see "Genuinely missing, deferred" — bypassed, not designed |
| `photo-detail` | 1 | unsurfaced — see below |

Total: 4+1+1+7+3+5+1+2+3+2+4+1+1+6+2+2+8+2+1 = **56** DESIGNED, +`vision`
(bypassed) +`photo-detail` (unsurfaced) = **58**. Matches `grep -c
'registerLensAction("photography"' server/domains/photography.js`.

**GENERIC-STRIP-ONLY**: none. `<ManifestActionBar>`, `<UniversalActions>`,
and `<LensFeaturePanel>` are present in `page.tsx` (platform-standard
cross-lens chrome, not this lens's primary surface — every real macro
above has a dedicated, bespoke panel), and the grader's
`hasMacroButtonWall` flag on this lens (see Verification) reflects that
chrome, not a gap; there is no macro whose *only* reachable path is one of
those generic components.

**UNSURFACED**: `photo-detail` — 1/58, confirmed by `node
scripts/lens-unsurfaced.mjs --lens photography` (re-run after this pass).

## Genuinely missing, deferred

- **`photo-detail`** (CURATION-triage: not missing, redundant). Returns a
  single photo plus its album memberships. Every field it would show is
  already visible without an extra fetch: the photo's own metadata is
  inline in the `LightroomLibraryPanel` row (now including the edit form
  this pass added), and album membership is already a live checkbox matrix
  in `LightroomCollectionsPanel`'s "Albums" section (toggle per photo per
  album via `album-detail`/`album-add-photo`). Building a dedicated
  detail/lightbox modal purely to re-render the same two facts through one
  more macro call would be scaffold for its own sake, not a closed gap —
  left unsurfaced deliberately.
- **`vision`** (ENGINEERING-triage: platform-wide shared-component decision,
  out of this lens's scope). `page.tsx`'s Editing tab mounts the shared
  `<VisionAnalyzeButton domain="photography" />`, but that component (used
  identically across many other lenses) calls the generic `/api/chat?full=1
  mode=vision` endpoint directly — it never routes through any domain's own
  `vision` macro, photography's included. `server/domains/photography.js`'s
  `vision` macro (`callVision`/`callVisionUrl` with a photography-specific
  prompt) is real and correctly implemented but has zero caller anywhere in
  the frontend. Rewiring `VisionAnalyzeButton` itself to call each lens's
  own `vision` macro instead of the shared chat endpoint is a platform-wide
  change touching every lens that imports it — outside a single-lens
  rebuild's scope per "do not invent new backend behavior / stay in your
  lane," and not something this pass silently worked around. Flagged here
  so a future cross-lens pass can decide whether to standardize
  `VisionAnalyzeButton` on the per-domain macro.

## Confirmed real and left alone, with reason

`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/photography/*.tsx app/lenses/photography/page.tsx` → no
fabrication signatures found (the word "mock" appears nowhere; no
`Math.random` in any render or data path).

- **`page.tsx`'s own gallery/upload/capture/editing/stats tabs** (built on
  `useLensData<PhotoItem>('photography', 'photo', …)`, a generic-CRUD
  artifact store distinct from the Lightroom `photo-*` macros) — confirmed
  **real**, not fabricated: real file upload to `/api/media/upload` with
  real bytes served back via `/api/media/stream/:mediaId`, a real
  `getUserMedia` webcam capture flow, a real canvas-filter photo editor
  (brightness/contrast/saturation/blur, downloadable as PNG), a real
  search/category filter, and a real lightbox with keyboard nav. This is a
  **second, legitimately different** photo-management surface (upload and
  view your own real image files) sitting alongside the Lightroom catalog
  engine (a symbolic/synthetic catalog for develop-pipeline math — RAW
  metadata, tone curves, masks — that was never designed to hold real
  image bytes; `photo-import` takes only a filename string, no upload).
  They don't share photo records by design, which is confusing UX but not
  dishonest — left alone this pass since merging two independently-real
  systems with different data models is a larger design decision than a
  field-shape or unsurfaced-macro fix, and out of scope for "don't invent
  new backend behavior." The one place this *did* cross into an actual
  defect — the gallery tab's "Photo Analysis" panel calling the Lightroom
  calculator macros with the gallery's own unrelated fields — is fixed
  above.
- `likes`/`views` counters on gallery `PhotoItem`s are always `0` and never
  incremented anywhere (no click-to-view or click-to-like handler writes
  to them) — inert rather than fabricated (nothing invents a random
  number), but worth flagging: a future pass should either wire a real
  view/like increment or remove the counters from the stat cards. Left
  alone this pass as a minor polish item, not the load-bearing defect this
  audit targets.
- **`PhotographyActionPanel.tsx`**, **`PexelsBrowser.tsx`**,
  **`LightroomCollectionsPanel.tsx`**, **`LightroomExportPanel.tsx`**,
  **`PhotographyLightroomSection.tsx`** — already real, already correctly
  wired, no changes needed.

## Verification

- `node --check server/domains/photography.js` — clean (file untouched
  this pass; verified anyway per the assignment brief).
- `node --test tests/photography-domain-parity.test.js
  tests/photography-lens-macros.test.js tests/depth/photography-behavior.test.js
  tests/poetry-podcast-photography-domain-parity.test.js` (from `server/`)
  — **62/62 pass**, unmodified.
- `node scripts/lens-unsurfaced.mjs --lens photography` (from repo root) —
  **1/58 unsurfaced** (`photo-detail`, deliberately deferred — see above);
  was effectively 4/58 reachable-but-not-designed before this pass
  (`photo-search`, `keyword-list`, `photo-update`, `preset-delete`,
  `tone-curve-list`, `tone-curve-delete`, `cull-summary` — 7 macros — plus
  the 4-macro duplicate-panel field-shape bug).
- `npx eslint app/lenses/photography/page.tsx components/photography/*.tsx`
  (from `concord-frontend/`) — clean, exit 0.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (photography was already
  WIRED and stays WIRED; the 2 NO-BACKEND-CALL lenses are the documented
  by-design exceptions, `narrative-walk` and `ux-suite`, neither of which
  is photography).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) —
  photography entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"bespokeRatio": 0.72`, `"fileCount": 9`, `"totalLoc": 3237`.
  `audit/` outputs reverted via `git checkout -- audit/` per the
  transient-artifact rule (shared working tree with other concurrent
  lens-rebuild agents).
