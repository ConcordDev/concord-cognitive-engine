# Artistry Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/artistry.js` (1,113 LOC) in full — the file's own header
> comment ("Behance / ArtStation parity — social-portfolio core") is the
> grounding for the reference-parity research below, independently verified
> via WebSearch (2026-07-09), not trusted from the comment alone.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("artistry"' server/domains/artistry.js`

## Backend surface — 31 macros, all real (no stubs)

Two tiers: (A) 4 stateless "compute sandbox" macros that operate on a
caller-supplied `artifact.data` payload (no persistence of their own); (B) 27
`STATE.artistryLens`-backed macros (per-user `Map`s: `projects`, `follows`,
`comments`, `appreciations`, `collections`, `profiles`, `jobs`, `galleries`)
that form a genuine Behance/ArtStation-parity social portfolio platform.

| Macro | Real result shape (key fields) | Classification (before this rebuild) | Classification (after) |
|---|---|---|---|
| `colorPaletteAnalysis` | HSL palette harmony/contrast/temperature analysis | GENERIC-STRIP-ONLY — wired to a button with NO params (see finding below), practically dead | DESIGNED — `CreativeTools` Color Palette tool, structured swatch input |
| `compositionScore` | rule-of-thirds + quadrant-balance + coverage scoring | GENERIC-STRIP-ONLY — same dead-param pattern | DESIGNED — `CreativeTools` Composition Score tool, structured element-box input |
| `styleClassify` | art-historical style classifier from tags/attributes | GENERIC-STRIP-ONLY — same dead-param pattern | DESIGNED — `CreativeTools` Style Classify tool, structured attribute input |
| `mediaInventory` | art-supplies inventory with cost totals + reorder alerts | GENERIC-STRIP-ONLY — same dead-param pattern | DESIGNED — `CreativeTools` Media Inventory tool, structured supply-row input |
| `projectCreate`/`Update`/`Delete`/`List`/`View` | multi-image case-study projects (images, process steps, tools, tags, discipline, published, views) | DESIGNED — `ProjectStudio.tsx` | DESIGNED — unchanged, kept (already real) |
| `follow`/`unfollow`/`followGraph`/`personalizedFeed` | follow graph + feed (falls back to discovery-by-appreciation when following nobody) | DESIGNED — `CommunityNetwork.tsx` (mounted under "Network" tab) | DESIGNED — promoted to the page's default landing tab, relabeled "Feed" (see finding below) |
| `commentAdd`/`appreciate` | like/heart + comment on a project | DESIGNED — `ProjectStudio.tsx` detail modal | DESIGNED — unchanged |
| `commentList` | full comment list for a project | UNSURFACED — no direct caller; `projectView` already embeds the full comment list inline, so a standalone `commentList` call would be a redundant fetch | **Not a gap.** `projectView`'s `result.comments` already IS `commentList`'s data for the one place comments are shown. Documented rather than silently left off. |
| `commentDelete` | delete your own comment (server enforces `c.userId === actor`) | UNSURFACED — zero callers anywhere in the app | **WIRED THIS SESSION** — `ProjectStudio.tsx` now shows a delete icon on every comment; a non-owner attempt is honestly rejected (toast), never hidden client-side (the page has no reliable client-side "is this my comment" signal without extra plumbing) |
| `collectionCreate`/`List`/`Save`/`Items` | Pinterest-style save-to-board | DESIGNED — `Collections.tsx` | DESIGNED — unchanged |
| `profileUpdate`/`profileGet` | portfolio profile (headline/bio/location/avatar/banner/disciplines/hire-availability/links/layout) + aggregate stats | DESIGNED — `PortfolioProfile.tsx`, but `profileGet`'s stats were never surfaced anywhere else | DESIGNED — `PortfolioProfile.tsx` unchanged, **and** `profileGet` promoted to the page's header KPI strip (Projects/Views/Appreciations/Followers/Following) via `useMacroDispatchFeedback`, matching the Finance/News/mentorship flagship pattern |
| `search`/`tagCloud` | tag + discipline + text search across published projects | DESIGNED — `DisciplineSearch.tsx` | DESIGNED — unchanged |
| `jobPost`/`List`/`Apply`/`Close` | commission/job board | DESIGNED — `JobBoard.tsx` | DESIGNED — unchanged |
| `galleryCreate`/`List`/`Items` | Behance-style curated "served" galleries | DESIGNED — `CuratedGalleries.tsx` | DESIGNED — unchanged |

**29 of 31 macros were already DESIGNED before this rebuild** (all 7
`components/artistry/*.tsx` panel components read in full before touching
anything are genuinely real, macro-wired, and honest — no seeded/mock data).
The finding this rebuild's capability audit surfaced was different: the 4
stateless "compute sandbox" macros were reachable only through a button that
called them with **no parameters at all** (see below), and the page's
"Assets"/"Marketplace"/"Studio" tabs presented an entirely different,
misfiled backend as if it were part of this lens.

## The two real findings

### Finding 1 — misfiled backend presented as this lens's asset system

`concord-frontend/lib/api/client.ts:1334` defines `apiHelpers.artistry` with
`assets`/`blobs`/`genres`/`assetTypes`/`stats`/`studio.*`/`distribution.*`/
`marketplace.{beats,stems,samples,art,splits}`/`collab.*`/`ai.*`, all backed
by real, functioning routes at `server/server.js:72041` onward
(`app.post('/api/artistry/assets', ...)` etc — confirmed by reading the
route bodies, not just the route table). This is a genuine **DAW / music-
production / distribution / marketplace / collab-jam backend** — built-in
synth/effect racks (`BUILT_IN_INSTRUMENTS`, `BUILT_IN_EFFECTS`), BPM/key/
scale asset fields, vocal pitch-correction, LUFS mastering, release
distribution + streaming + a SECOND separate follow/feed graph, beat/stem/
sample-pack marketplace with royalty splits, and AI chord/melody/drum/
genre-coach suggestions.

This is **not this lens's Behance-parity substrate**, and it is **not
actually specific to `artistry` either** — the same `apiHelpers.artistry.*`
calls are made from FOUR other lens pages: `app/lenses/art/page.tsx`
(`assets.list({type:'artwork'})`, `marketplace.art.list/create`,
`marketplace.purchase` — this is the lens that legitimately owns the
"artwork" slice of this shared system), `app/lenses/marketplace/page.tsx`
(`marketplace.{beats,stems,samples,art}`), `app/lenses/collab/page.tsx`
(`blobs.upload`, `studio.projects.list`, `collab.sessions.create`), and
`app/lenses/feed/page.tsx` (`collab.sessions.join`). So `/api/artistry/*` is
a real, working, cross-lens creative-commerce/DAW backend — misfiled under
`/api/artistry/*` in its URL namespace, but **already correctly owned and
presented by the `art` lens** for the one slice (`type: 'artwork'`
assets + the `marketplace/art` listings, whose `artType: 'cover-art'`
default confirms it's meant as artwork-for-a-release, legitimately
co-owned with music — not a random mistake).

Presenting the identical assets/marketplace/studio data a **second time**
under the `artistry` lens's own tabs (which is what the pre-rebuild page
did) mislabeled a shared, already-elsewhere-owned system as this lens's
primary surface, while the REAL Behance-parity substrate (`projects`,
`follow`, `collections`, etc.) sat in tabs 2–8. A user filling out the old
"Upload Asset" modal on this page was really posting into the DAW asset
system that the `art` lens already presents correctly — not into their
Behance-style portfolio at all.

**Disposition: dropped from this lens's primary surface.** No backend
change (this is real, working, cross-lens architecture — not something to
delete). No change to `lib/api/client.ts` or `server/server.js`, and no
change to `art`/`marketplace`/`collab`/`feed`, which keep their existing,
correct calls into this system untouched. `app/lenses/artistry/page.tsx` no
longer imports `apiHelpers` or queries `assets`/`marketplace.art`/
`studio.projects` at all. Flagged here as a scoped future **backend-scoped**
fix (rename the route namespace, e.g. `/api/creative-commerce/*` or
`/api/daw/*`, and update the 5 call sites) — out of scope for a
frontend-only lens rebuild per the governing program doc.

The **Excalidraw drawing canvas** (`@excalidraw/excalidraw`, real, not fake)
that shared the old "Studio" tab with the DAW project list was kept — it's a
genuine sketch tool, unrelated to the misfiled DAW backend. It's now its own
"Sketchpad" tab, decoupled from the `studio.projects` list, with an honest
disclosure that the canvas is session-local only (no macro persists sketch
state — this was always true, the old page just never said so).

### Finding 2 — the 4 compute macros were wired to a dead no-op

`useLensData<Record<string,unknown>>('artistry','artwork',{seed:[]})` seeded
an empty generic artifact list, and `handleArtistryAction` read
`artistryItems[0]?.id` as the macro's target — which was always `undefined`
because the seed was always empty. Every click on Color Palette / Composition
Score / Style Classify / Media Inventory called its macro with **no
`artifact.data` at all**, so in practice these four buttons only ever
returned the macros' own honest "no data provided" fallback message
(`{ ok: true, result: { message: "No palette data provided...", ... } }`) —
a real response, but a permanently-empty one; the buttons could never
actually analyze anything.

**Disposition: wired this session.** New `components/artistry/CreativeTools.tsx`
gives each of the 4 macros a real structured input (the same
`field | field | field` line-input idiom already established elsewhere in
this lens — `ProjectStudio`'s images/processSteps, `PortfolioProfile`'s
links, and the supplychain/mentorship precedents): a color-swatch list
(`hex|weight`) for palette analysis, a canvas-size + element-box list
(`x|y|width|height|weight`) for composition scoring, medium/era/technique/
subject + tag inputs for style classification, and a supply-row list
(`name|category|quantity|unit|unitCost|reorderThreshold`) for media
inventory. Each tool dispatches via `useMacroDispatchFeedback` (honest
loading/error/done) and renders the macro's real computed fields (harmony
score, dominant hue, rule-of-thirds/balance/coverage sub-scores, style
classification + confidence, category breakdown + reorder alerts) — nothing
invented client-side.

## 1.5 Reference-parity checklist

**(a) Reference apps:** [Behance](https://www.behance.net) (Adobe's creative
portfolio network — the industry-standard "show your work" platform) and
[ArtStation](https://www.artstation.com) (the games/VFX/concept-art-focused
peer, stronger on jobs and curated "front page" galleries). The domain
file's own header comment names both explicitly; independently confirmed via
WebSearch (2026-07-09), not trusted from the comment alone.

**(b) Parity statement:** the only difference between Concord's artistry
lens and Behance/ArtStation should be catalog size and the absence of a
human curation team for the front-page galleries (Concord's galleries are
user-curated, not editorially curated by platform staff) — the core
mechanics (project case studies, appreciation, following, collections, job
board, discipline search, curated showcases) should all be real, designed,
data-backed features here, exactly as they are on the reference apps.

**(c) Researched checklist** (Behance + ArtStation feature sets, via
WebSearch 2026-07-09):

| # | Checklist item (Behance / ArtStation) | Disposition | Notes |
|---|---|---|---|
| 1 | Project/case-study pages — multiple images, description, tools, process | ALREADY REAL | `projectCreate`/`projectView` — images with per-image captions + ordering, tools, tags, discipline, **and a dedicated "process steps" sequence** (Behance has no first-class process-step field; this is actually a bit deeper than the reference) |
| 2 | Appreciate / like a project | ALREADY REAL | `appreciate` — toggleable, wired in `ProjectStudio` + `CommunityNetwork` |
| 3 | Comment on a project | ALREADY REAL (now complete) | `commentAdd` was wired; `commentDelete` (delete your own comment) was UNSURFACED — **WIRED THIS SESSION** |
| 4 | Follow creators; personalized activity feed | ALREADY REAL | `follow`/`unfollow`/`followGraph`/`personalizedFeed` — with an honest discovery fallback (most-appreciated published work) when you follow nobody, matching Behance's "Discover" behavior for new accounts |
| 5 | Collections / "Save to board" | ALREADY REAL | `collectionCreate`/`collectionSave`/`collectionItems` — private or public boards, matches Behance's collection model |
| 6 | Portfolio/profile page with stats, bio, links, available-for-hire | ALREADY REAL | `profileGet`/`profileUpdate` — displayName/headline/bio/location/avatar/banner/disciplines/links/layout + aggregate stats; layout choice (grid/masonry/list) matches Behance's profile-layout options |
| 7 | Discipline / tag / keyword search | ALREADY REAL | `search` + `tagCloud` — text, discipline filter, tag filter, 3 sort orders |
| 8 | Job board / "Find work" (ArtStation-style) | ALREADY REAL | `jobPost`/`jobList`/`jobApply`/`jobClose` — commission/contract/freelance/full-time kinds, budget range, applications with quotes |
| 9 | Curated "front page" / staff-picked galleries | ALREADY REAL (honest scope difference) | `galleryCreate`/`galleryList`/`galleryItems` — any user can curate a themed gallery and mark it `featured`; Behance/ArtStation's front page is editorially curated by platform staff, which Concord has no staff-curation layer for. Not faked as "staff picks" anywhere in the UI. |
| 10 | Color/composition/style analysis tools for artists | GENUINELY MISSING ON THE REFERENCE APPS (Concord is ahead here) | Neither Behance nor ArtStation ships palette-harmony/rule-of-thirds/style-classification/supply-inventory tools; `colorPaletteAnalysis`/`compositionScore`/`styleClassify`/`mediaInventory` are a genuine Concord-original addition, not a parity gap — now properly surfaced as **Creative Tools**, an admittedly separate surface from the portfolio (never presented as if it's part of the Behance-parity core) |
| 11 | Direct messaging between creators | **CLOSED (2026-07-16, `37d23815`)** | Cloned from `alliance.js`'s cross-org DM primitive (same sorted-pair threadKey). Message shape mirrors this lens's own simpler comment shape; recipient validation adapted to an open-participation check (has this userId set a profile or created a project) since artistry has no closed membership to scan. Privacy enforced structurally — `dm-list` derives its key from the caller's own id, so a third party can never land on another pair's real thread. New Message action on following/follower rows + an `ArtistryDmPanel`. |
| 12 | Real image hosting / upload pipeline for project images | **CLOSED (2026-07-16, `08056272`)** | New artistry-native macros (`project-image-upload`/`-list`/`-download`/`-delete`), cloned from `travel.js`'s binary attachment trio — deliberately NOT built on the misfiled `apiHelpers.artistry.blobs` DAW facility (see Finding 1), whose own download route never returns the actual bytes. Uploaded images are referenced via a stable `artistry-img:<id>` scheme; `projectCreate`/`projectUpdate` now validate ownership of any such reference before accepting it. External URLs still work unchanged. `ProjectStudio` gains a real file-input plus a `ResolvedImage` component resolving references at every render site. |
| 13 | Analytics for creators (view trends over time, referral sources) | ~~GENUINELY MISSING~~ **CLOSED (2026-07-16, `951ea868`)** — new `analyticsSnapshot`/`analyticsHistory` macros. A new `computeArtistryStats()` is the single source of truth both `profileGet` and the snapshot logic call, so a stored trend point can never diverge from what `profileGet` shows on that day. One row per (user, UTC calendar day) — a same-day repeat updates the existing row rather than accumulating duplicates. `profileGet` auto-captures today's snapshot on owner load only (never on a visitor's), wrapped in a best-effort try/catch so a snapshot failure can never break profile loading. New `AnalyticsTrendChart.tsx` reuses the existing shared `ChartKit` component. Referral-source breakdown remains genuinely deferred — no referrer field exists anywhere in this domain to trend. |
| 14 | Notification feed (new follower, new comment, new appreciation) | GENUINELY MISSING | No notification macro/table in this domain. Concord has a platform-wide notification system elsewhere (out of this lens's scope) — not investigated further here since wiring an existing platform notification feed into this lens (if warranted) is a cross-cutting concern, not a lens-specific gap. |

**(d) Coverage:** 9 of 14 checklist items ALREADY REAL (one — analysis
tools — is actually AHEAD of the reference apps), 1 was
backend-capable-but-unsurfaced and is now wired (`commentDelete`), 4
genuinely missing and explicitly scoped/deferred (DMs, native image upload,
creator analytics trends, notifications) with reasons given for each rather
than silently gapped.

## What this rebuild changed

1. **Killed the dead compute-macro wiring** (Finding 2) — replaced the
   always-empty-artifact button strip with `CreativeTools.tsx`, giving all 4
   stateless macros real structured inputs and honest per-tool
   loading/error/result rendering via `useMacroDispatchFeedback`.
2. **Dropped the misfiled DAW/marketplace/studio surface** (Finding 1) — no
   more `apiHelpers.artistry.assets/marketplace/studio` calls, no more
   "Upload Asset" modal that silently posted into the wrong (if real)
   backend. The Excalidraw sketch canvas was kept, decoupled, and honestly
   labeled session-local. No backend or cross-lens changes.
3. **Retired the generic-scaffold dependency**
   (`isGenericScaffold: true` per `audit/ux-polish-honest.json`): removed
   `ManifestActionBar`, `AutoActionStrip`, `RecentMineCard`,
   `CrossLensRecentsPanel`, `UniversalActions`, `LensFeaturePanel`, and the
   `useRealtimeLens`/`LiveIndicator`/`RealtimeDataPanel` trio (confirmed via
   `grep artistry hooks/useRealtimeLens.ts` — zero matches, this domain has
   no `DOMAIN_EVENTS` entry, so `isLive` was always `false`; a permanently-
   dark "live" indicator was removed rather than kept as decoration, per the
   supplychain/mentorship precedent).
4. **Promoted `profileGet` to a real header KPI strip** (Projects / Views /
   Appreciations / Followers / Following), dispatched via
   `useMacroDispatchFeedback` for an honest loading/running/done/error
   lifecycle, using the new `StatTile`/`StatTileGrid` UI primitives —
   matching the Finance/News/mentorship flagship pattern.
5. **Merged the redundant "Feed" tab into the real Feed.** The pre-rebuild
   page's default "Feed" tab rendered generic cross-lens `useLensDTUs`
   content (DTUs tagged to the `artistry` lens broadly) — a DIFFERENT,
   weaker concept than the real Behance-style personalized activity feed
   that `CommunityNetwork.tsx` already implements via the `personalizedFeed`
   + `followGraph` macros (which was previously buried under a "Network"
   tab). Presenting two different things both called "your feed" side by
   side was confusing; `CommunityNetwork` (follow graph + real personalized
   feed with an honest discovery fallback) is now the single default landing
   tab, relabeled "Feed" — the macro-backed one wins.
6. **Wired `commentDelete`** — the one genuinely unsurfaced macro with real
   backend support and zero UI callers; see Finding notes above.
7. **New bespoke 9-tab page shell** (Feed / Projects / Profile / Collections
   / Discover / Jobs / Galleries / Creative Tools / Sketchpad) with `1`-`9`
   keyboard hotkeys + `r` to refresh the header stats, `DensityToggle`,
   `DTUExportButton`. All 7 pre-existing panel components
   (`ProjectStudio`, `PortfolioProfile`, `CommunityNetwork`, `Collections`,
   `DisciplineSearch`, `JobBoard`, `CuratedGalleries`) were confirmed real
   and macro-wired by reading them in full — **not rewritten**, only
   re-homed into the new shell. `WikimediaArt` (a real, sourced Wikimedia
   Commons pull, save-as-DTU wired) kept its footer placement, unchanged.

## Orphaned scaffolding found, not touched (out of scope)

Four components in `components/artistry/` are imported by **zero** files
anywhere in the app (confirmed via `grep -rl` across `**/*.tsx`):
`CommunityFeed.tsx` (a near-duplicate of the real, mounted
`CommunityNetwork.tsx` — same 5 macros, never wired into any page),
`ArtistryFeed.tsx`, `PreviewCard.tsx`, and `CrossPostModal.tsx` (all three
are props-driven presentational components typed against a
`lib/artistry/types.ts` "universal creative feed" shape — audio/image/video/
text/code/interactive/3d posts spanning multiple lenses — with no data
source or parent that ever renders them; they fetch nothing themselves).
None of these render anywhere today, so they present no honesty risk (no
fabricated data reaches a user) — flagged here for a future cleanup pass
rather than deleted, since deleting unreferenced files is outside a
frontend-rebuild unit's scope per the governing program doc and risks
colliding with unrelated in-flight work.

## Files touched

- `concord-frontend/app/lenses/artistry/page.tsx` — rewritten
- `concord-frontend/components/artistry/CreativeTools.tsx` — new
- `concord-frontend/components/artistry/ProjectStudio.tsx` — edited (wired `commentDelete`)
- `concord-frontend/tests/artistry-lens-states.test.tsx` — rewritten to match the new architecture
- No backend changes. No changes to `lib/api/client.ts`, `server/server.js`, or the `art`/`marketplace`/`collab`/`feed` lenses that share the misfiled DAW backend.
