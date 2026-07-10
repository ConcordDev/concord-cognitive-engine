# Gallery Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("gallery"' server/domains/gallery.js
```
→ **34** macros in `server/domains/gallery.js` (968 lines), all real museum/
collection code — no scaffold, no stub. This is a real-museum-API +
personal-curation-tool lens: Cleveland Museum of Art Open Access (`cma-*`,
CC0, no key), Smithsonian Open Access (`si-search`, needs a free
`DATA_GOV_API_KEY`, fails **honestly** with the setup URL when unset —
`server/domains/gallery.js:115`), Art Institute of Chicago (`artist`, `feed`),
plus a full in-memory-STATE personal layer: saved collections, view history →
computed recommendations (weighted taste profile over artist/department/
culture, saved artworks weighted 2×), colour/style visual search (CMA
`cia_color` hex filter + technique keyword mapping), curated narrative
exhibits (ordered, wall-texted artwork panels, publishable), 2–4-way artwork
comparison with a structured attribute diff, cross-museum artist pages, a
gigapixel deep-zoom viewer (CMA print/full-res tiers), and an at-scale "view
in your room" virtual-room placer (normalized `[0,1]` wall coordinates,
metre-scaled artwork widths, 4 room presets).

**One additional real macro lives outside this file**, confirmed by checking
every other file that references the string `"gallery"`
(`grep -rl '"gallery"' server/domains/*.js server/server.js` →
`free-api-live.js`, `gallery.js`, `homeimprovement.js`):
- `server/domains/free-api-live.js:237` — `register("gallery",
  "live_met_search", metMuseumSearch, ...)`, a live MET Museum Open Access
  search shared verbatim with the `art` domain (`:236`, same handler
  function). Real fetch-and-map code, no synthetic fallback.
- `server/domains/homeimprovement.js` — its 3 `"gallery"` hits are a red
  herring: `hiList(s, "gallery", ...)` is an internal state-namespace key
  for a *home-improvement project's own photo gallery*, registered under
  the **`home-improvement`** domain (`registerLensAction("home-improvement",
  "gallery-list", ...)`), not a `gallery`-domain macro. Confirmed unrelated.

So the true macro count is **35**, not 34 — `node
scripts/lens-unsurfaced.mjs --lens gallery` only checks `server/domains/
gallery.js`, matching the filename, and can't see the cross-file
registration; independently verified via
`grep -rhoE '\b(register|registerLensAction)\("gallery",\s*"[a-zA-Z0-9_.-]+"' server/`.
`live_met_search` was already surfaced (see below), so this doesn't change
the fix count, only the true denominator.

No inline `registerLensAction("gallery"...)`/`register("gallery"...)` calls
exist directly in `server.js` (the domain is entirely file-registered).
`server/lib/lens-manifest.js`/`lens-features*.js` carry no gallery-specific
per-macro feature entries; the lens is declared only in `lens-registry.ts`.

## Reference apps

- **Google Arts & Culture** — the primary target; an almost 1:1 feature
  match. Its "Art Camera" gigapixel viewer = this lens's `deep-zoom`; its
  curated "Stories" (ordered, wall-texted artwork sequences) = `exhibit-*`;
  its "Pocket Gallery" AR wall-placement = `virtual-room-*`; its "Explore by
  color" = `visual-search`; its per-artist pages aggregating multiple
  partner museums = `artist`.
- **Artsy** — cross-institution artist pages + search-driven discovery,
  the closest analog for the `artist` macro's cross-museum aggregation.
- **iNaturalist-style "your stats"/history** (already the reference for the
  sibling `eco` lens) — the closest analog for `view-history` →
  `recommendations`' taste-profile pattern here.

Parity target, in the owner's framing: **the only difference should be
catalog size (3 real museum sources vs. Google's dozens of partners),
nothing else** — every one of Google Arts & Culture's headline mechanics
(deep zoom, curated stories, colour explore, AR room preview, artist pages)
has a real, working macro and UI panel already built in this lens.

## Classification (before this pass)

**Overwhelmingly strong, film-studios-shaped: a near-complete rebuild
already done, with exactly one real gap.** Read all of
`app/lenses/gallery/page.tsx` (299 lines) and all 10
`components/gallery/*.tsx` panels (1,791 lines total).
`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem\|hardcoded\|coming soon"` →
zero hits across the entire lens. Every panel (`CmaBrowser`,
`GalleryActionPanel`, `VisualSearch`, `DeepZoomViewer`, `ArtworkCompare`,
`ArtistPage`, `CuratedExhibits`, `VirtualRooms`, `Recommendations`,
`SavedCollections`) is a bespoke, well-designed component backed by a real
macro with honest empty/error states — no generic artifact-store detour, no
`<UniversalActions>`/`<LensFeaturePanel>` button wall anywhere in the tab
content (only the small optional AI-helper strip pattern used correctly).

The Browse tab additionally mounts an unrelated-but-legitimate feature: a
"Sigil gallery" backed by the `compression_art` domain (`server.js:76403-76433`,
DB-backed, deterministic shape descriptors derived from real MEGA/HYPER DTU
consolidation data — verified by reading the handler, not fabricated,
correctly out of scope for this rebuild since it's a different domain's
capability being cross-mounted, not a `gallery`-domain defect).

`node scripts/lens-unsurfaced.mjs --lens gallery` → `1/34 macros never
referenced in the frontend`: **`artwork-save`**. This is a real, serious
gap, not a cosmetic one — the exact "broken core loop" defect class from the
program doc:

- `collection-create`, `collection-list`, `collection-detail`,
  `collection-delete`, and `artwork-remove` were all wired
  (`SavedCollections.tsx`) — a user could create named collections, view
  them, delete them, and remove artworks from them.
- **But no surface anywhere in the lens ever called `artwork-save`** — the
  one macro that actually adds an artwork *into* a collection. Every museum
  browse/search surface (`CmaBrowser`, `GalleryActionPanel`,
  `VisualSearch`, `ArtistPage`, `Recommendations`) only offered
  `SaveAsDtuButton` (mints a private DTU — an unrelated substrate) or
  nothing at all. `SavedCollections.tsx`'s own empty-state copy — *"No
  artworks yet — save pieces from the museum browser above"* — pointed at
  an affordance that did not exist. A user could build the shelving but
  never put a single book on it. `si-search` was independently confirmed
  surfaced (`GalleryActionPanel`'s "Smithsonian" action), degrading
  honestly when `DATA_GOV_API_KEY` is unset.

## What changed

- **`concord-frontend/components/gallery/SaveToCollectionButton.tsx`
  (new)** — the reusable fix for the broken core loop. A compact
  folder-icon button that, on click, opens a portal-rendered picker modal
  (avoids clipping inside the scrollable result grids, following
  `SaveAsDtuButton`'s existing portal-modal pattern) listing the user's
  collections (lazy-fetched via `collection-list` on first open) with
  artwork counts, plus inline "+ new collection" creation
  (`collection-create` → immediately `artwork-save`s into the new
  collection). Calls `artwork-save` with the real per-artwork fields
  (`refId`, `title`, `artist`, `date`, `image`, `museum`) each surface
  already holds from its own search result. Treats the handler's
  `"artwork already in this collection"` error as an honest success state
  (already-saved), not a failure.
- **Wired into all 5 artwork-result surfaces in the lens** (every place a
  user can see an artwork card, they can now save it — matching Google Arts
  & Culture's "favorite from anywhere" pattern, not just one entry point):
  - `CmaBrowser.tsx` — added next to the existing `SaveAsDtuButton`, the
    literal surface `SavedCollections`'s empty-state copy already pointed
    at.
  - `GalleryActionPanel.tsx` — the CMA+Smithsonian search-workbench result
    grid. Its cards were a `<button>` used for row-selection; added the new
    button as an absolutely-positioned corner action, which required
    converting the outer element from `<button>` to a `<div role="button"
    tabIndex={0} onKeyDown=…>` (a literal `<button>` inside a `<button>` is
    invalid HTML and silently breaks the DOM) — keyboard activation
    (Enter/Space) preserved explicitly.
  - `VisualSearch.tsx` and `ArtistPage.tsx` — both used `<a href=… target=
    "_blank">` as the outer card element (open-source-record-in-new-tab).
    Same interactive-nesting problem in reverse (button inside anchor);
    restructured to a `<div>` wrapping the anchor around the image/title
    (preserving the click-to-open-source behavior) with the save button as
    a sibling corner overlay.
  - `Recommendations.tsx` — the "For you" grid used a `<button onClick=
    {recordView}>` card (clicking a recommendation records it into view
    history, refining the taste profile); same restructuring as
    `GalleryActionPanel`, preserving `recordView` on click/Enter/Space and
    adding the save action as a corner overlay.
  - **Left `DeepZoomViewer.tsx` and `ArtworkCompare.tsx` unwired** — these
    are single-artwork inspection/comparison tools, not browse/discovery
    surfaces; the artwork being deep-zoomed or compared was reached via an
    id typed by the user (often not yet in any collection-consumable
    shape), and neither page previously offered any per-item action beyond
    its core inspection UI. Judged out of scope for this fix — the defect
    was "you can never save anything, from anywhere you browse," which is
    now closed everywhere browsing/discovery actually happens.

## Verification

- `cd concord-frontend && npx eslint app/lenses/gallery/page.tsx components/gallery/SaveToCollectionButton.tsx components/gallery/CmaBrowser.tsx components/gallery/GalleryActionPanel.tsx components/gallery/VisualSearch.tsx components/gallery/ArtistPage.tsx components/gallery/Recommendations.tsx` — clean, exit 0.
- Manual type read-through in place of a full-project `tsc` (avoided here to
  not race the 5 sibling agents editing other lenses concurrently in the
  same working tree): every `artwork={{ ... }}` literal passed to
  `SaveToCollectionButton` was checked field-by-field against each
  surface's own result interface (`CmaBrowser`'s `Work`, `GalleryActionPanel`'s
  `Artwork`, `VisualSearch`'s `VisualWork`, `ArtistPage`'s `ArtistWork`,
  `Recommendations`'s `RecWork`) against `SaveableArtwork`'s shape
  (`title: string`, everything else optional `string | null | undefined`)
  — all assignable without a cast. `React.MouseEvent` is referenced as a
  bare type in the new file without importing the `React` namespace value,
  mirroring the exact same pattern already present and compiling in
  `DeepZoomViewer.tsx` in this same directory (the `@types/react` global
  `export as namespace React` makes this valid).
- Fabrication re-grep after the edit: `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/gallery/page.tsx components/gallery/*.tsx` → no hits (was 0 before, still 0 — this was never a fabrication defect, only an unreachable-macro defect).
- `node scripts/lens-unsurfaced.mjs --lens gallery` re-run after the edit →
  `0/34 macros never referenced in the frontend` (was `1/34`,
  `artwork-save`). The true 35th macro (`live_met_search`, registered in
  `free-api-live.js`) was already surfaced pre-existing via
  `MetMuseumPanel` in the Browse tab and required no change.
- `cd server && node --test tests/gallery-domain-parity.test.js tests/gallery-lens-macros.test.js tests/depth/gallery-behavior.test.js` → **46 pass / 0 fail** (17 suites). No backend files were touched by this pass (the gap was purely a missing frontend caller for an already-correct, already-tested macro), so no new backend test was needed.
- Did not touch `server/domains/gallery.js`, `server/domains/free-api-live.js`, `SavedCollections.tsx`, `DeepZoomViewer.tsx`, `ArtworkCompare.tsx`, `CuratedExhibits.tsx`, or `concord-frontend/components/art/MetMuseumPanel.tsx` — no gap found in any of them.
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
