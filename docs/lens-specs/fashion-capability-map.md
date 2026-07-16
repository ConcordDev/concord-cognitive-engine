# Fashion Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/fashion.js` (1048 LOC) in full — no inline
> `registerLensAction("fashion", ...)` calls exist in `server.js` and no
> delegate libraries in `server/lib/` for this domain; the file above is the
> entire backend surface. Classification follows the Frontend Rebuild
> Program's distinction: **DESIGNED** / **GENERIC-STRIP-ONLY** /
> **UNSURFACED**.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("fashion"' server/domains/fashion.js`

## Backend surface — 49 macros, all real (no stubs)

Two tiers, both real: (A) 4 legacy stateless "compute sandbox" macros
(`styleProfile`, `outfitSuggest`, `trendAnalysis`, `costPerWear`) that
operate on a caller-supplied `artifact.data` payload (no persistence of
their own) plus 1 real vision macro (`vision`, genuine LLaVA/Qwen2.5-VL
call via `callVision`/`callVisionUrl`); (B) 44 `STATE.fashionLens`-backed
macros (per-user `Map`s: `items`, `outfits`, `wearLog`, `packing`,
`lookbooks`, `styleProfiles`, `challenges`, `capsules`, plus a shared
`communityPosts` array) forming a genuine "Stylebook 2026 parity — digital
closet" (the code's own header comment): wardrobe items with real
background-removal (remove.bg when configured, honest CSS flat-lay-mask
fallback when not), outfits, a wear calendar, packing lists, lookbooks,
closet analytics, live Open-Meteo weather, weather+occasion-scored AI
outfit generation over the user's real wardrobe, a 5-question style quiz
that produces recommendations from real closet gaps, declutter/resale
flagging with a depreciation-curve estimate + real channel listing
handoff (Depop/Vinted/Poshmark/eBay/local), a community outfit-share feed
(like/save/browse), capsule-wardrobe planning + a real `#30wears`
challenge tracker (progress reads real `timesWorn`), and a `feed` macro
that ingests real costume/fashion objects from The Metropolitan Museum of
Art Open Access API as DTUs.

| Macro | Real result shape (key fields) | Classification (before this rebuild) |
|---|---|---|
| `vision` | freeform LLaVA/Qwen2.5-VL description of a garment photo | **UNSURFACED** — no frontend caller anywhere pre-rebuild |
| `styleProfile` | wardrobe color/category breakdown from caller-supplied `wardrobe[]` | **DESIGNED (raw-JSON-button)** — old page's 4-button action panel; superseded by `style-quiz-submit`/`style-profile-get` |
| `outfitSuggest` | top/bottom/outerwear combos from caller-supplied `wardrobe[]` | **DESIGNED (raw-JSON-button)** — superseded by `ai-outfit-generate` |
| `trendAnalysis` | category/hotness breakdown from caller-supplied `trends[]` (no live trend source exists) | **DESIGNED (raw-JSON-button)** — no live backing data; honestly re-scoped this rebuild |
| `costPerWear` | per-item $/wear + value rating from caller-supplied `items[]` | **DESIGNED (raw-JSON-button)** — superseded by `wear-insights`/`closet-stats`/inline `itemView.costPerWear` |
| `item-add`/`item-list`/`item-update`/`item-delete`/`item-wear` | real per-user wardrobe CRUD + wear logging | **DESIGNED** — `FashionClosetPanel` (pre-existing, kept) |
| `item-remove-bg` | real remove.bg cutout or honest CSS flat-lay-mask flag | **DESIGNED** — `FashionClosetPanel` (pre-existing, kept) |
| `outfit-create`/`outfit-list`/`outfit-detail`/`outfit-delete`/`outfit-wear` | real per-user outfit CRUD + wear logging + real cost totals | **DESIGNED** — `FashionOutfitsPanel` (pre-existing, kept) |
| `calendar-log`/`calendar-view` | real wear-by-date log | **DESIGNED** — `FashionCalendarPanel` (pre-existing, kept) |
| `packing-create`/`packing-list`/`packing-add-item`/`packing-detail` | real per-user packing lists | **DESIGNED** — `FashionPlanPanel` (pre-existing, kept; bulk "add outfit's items" wired this rebuild) |
| `lookbook-create`/`lookbook-list`/`lookbook-add-outfit` | real per-user lookbook curation | **DESIGNED** — `FashionPlanPanel` (pre-existing, kept) |
| `closet-stats`/`wear-insights`/`fashion-dashboard` | real closet value, cost-per-wear, dead-stock analytics | **DESIGNED** — `FashionPlanPanel` + `FashionClosetSection` dashboard strip (pre-existing, kept) |
| `weather-forecast` | real live Open-Meteo current + 7-day forecast | **DESIGNED** — `FashionAIStylistPanel` (pre-existing, kept) |
| `ai-outfit-generate` | real weather+occasion-scored outfits from the user's actual wardrobe | **DESIGNED** — `FashionAIStylistPanel` (pre-existing, kept) |
| `style-quiz-questions`/`style-quiz-submit`/`style-profile-get` | real 5-question quiz → profile + closet-gap recommendations | **DESIGNED** — `FashionStyleQuizPanel` (pre-existing, kept) |
| `declutter-suggestions`/`resale-list-item`/`resale-unlist-item`/`resale-listings` | real depreciation-curve resale flags + external-channel listing handoff | **DESIGNED** — `FashionResalePanel` (pre-existing, kept) |
| `social-share-outfit`/`social-feed`/`social-like`/`social-save`/`social-delete` | real community outfit feed with like/save | **DESIGNED** — `FashionSocialPanel` (pre-existing, kept) |
| `capsule-create`/`capsule-list`/`capsule-toggle-item`/`capsule-delete` | real capsule-wardrobe planner | **DESIGNED** — `FashionCapsulePanel` (pre-existing, kept) |
| `challenge-enroll`/`challenge-unenroll`/`challenge-list` | real `#30wears` progress tracker off real `timesWorn` | **DESIGNED** — `FashionCapsulePanel` (pre-existing, kept) |
| `feed` | real Met Museum Open Access costume-object ingestion as DTUs | **DESIGNED** — `LensFeedButton` (pre-existing, kept) |

**Two macros were unsurfaced or under-surfaced pre-rebuild; both wired this session:**
- `vision` had **zero** frontend callers anywhere in the codebase. Wired
  into `FashionClosetPanel`'s add-item form as an "Analyze photo" button —
  it shows the model's real freeform description as read-only help text
  the user can use to fill in category/color/brand themselves. It does
  **not** auto-fill structured fields: the macro's real return shape is
  `{ ok, content: string }` (unstructured prose), and parsing that into
  structured fields would itself be a fabrication risk (regex-guessing
  fields from prose and silently writing them in). Showing the real text
  verbatim, unedited, is the honest wiring.
- `trendAnalysis` had a UI (the old page's raw-JSON action button) but no
  honest framing — the old panel presented "Trend Analysis" as if a live
  trend feed existed. There is no live trend-data source anywhere in the
  backend (confirmed: the macro's own early-return message is `"Add trend
  data to analyze fashion direction"` when the caller supplies nothing).
  Rebuilt as `FashionTrendSandboxPanel` (new "Trends" tab) with structured
  line-item inputs (name / category / popularity / trending toggle,
  matching the `supplychain-capability-map.md` precedent of replacing
  raw-JSON-paste with structured fields) and an explicit banner: "No live
  trend feed is connected... nothing is fabricated."

**`styleProfile`, `outfitSuggest`, and `costPerWear` are retired from the
UI as superseded**, not deleted from the backend (per this program's rule
of never rewriting the macro/wiring layer): each has a materially better,
already-real replacement already wired through `FashionClosetSection`'s
tabs (`style-quiz-submit`+`style-profile-get`, `ai-outfit-generate`,
`wear-insights`+`closet-stats` respectively) that operates on the user's
real, persistent wardrobe instead of a one-shot caller-supplied JSON blob.
The macros remain registered and callable via `/api/lens/run` for any
other caller; this rebuild simply stops presenting them as the primary UI.

## 1.5 Reference-parity checklist

**Reference apps:** [Whering](https://whering.co.uk/) (9M+ user "social
wardrobe & styling app") and [Stylebook](https://www.stylebookapp.com/)
(the longest-running iOS closet-organization app, 90+ features) — both
named directly in the backend code's own comments ("Stylebook 2026 parity
— digital closet", "2026 PARITY BACKLOG — Whering / Stylebook feature
gaps"). Researched via web search, 2026-07-09 (Whering feature set,
Stylebook feature set, and a head-to-head comparison).

**Parity statement:** the only difference should be community size (9M
users vs. Concord's own user base) and the absence of a retailer
product-catalog integration (Whering's 100M+-item shopping database +
Chrome extension) — real digital closet cataloguing, outfit building,
wear tracking, cost-per-wear analytics, AI weather-aware outfit
suggestions, capsule/sustainability tracking, and resale flagging should
all be designed, real-data features here, exactly as the reference apps
provide them.

| # | Checklist item (Whering / Stylebook) | Disposition | Justification |
|---|---|---|---|
| 1 | Digital closet catalog (photograph/add items) | **ALREADY REAL** | `item-add`/`item-list`/`item-update`/`item-delete` — real per-user wardrobe |
| 2 | Auto background removal on item photos | **ALREADY REAL** | `item-remove-bg` — real remove.bg integration, honest CSS flat-lay-mask fallback when no API key is configured (never fabricates a cutout) |
| 3 | Retailer product-catalog add (100M+ item DB) + browser extension | **GENUINELY MISSING — SCOPED FUTURE BUILD** | No shopping-catalog connector exists; would need a new external product-search integration (e.g. a licensed catalog API) — a real backend connector project, out of scope for a frontend rebuild |
| 4 | Outfit builder (assemble looks from closet items) | **ALREADY REAL** | `outfit-create`/`outfit-list`/`outfit-detail`/`outfit-delete`/`outfit-wear` |
| 5 | Visual drag-and-resize outfit collage canvas | **GENUINELY MISSING — HONEST, DEFERRED** | Concord's outfit builder is a real, functional tag-select UI (`FashionOutfitsPanel`), not a drag/resize visual canvas like Whering's "Dress Me" — cosmetic-interaction gap only, not a data/capability gap; flagged as a future presentation-layer enhancement, not a fake |
| 6 | AI outfit suggestion aware of weather + occasion | **ALREADY REAL** | `ai-outfit-generate` + `weather-forecast` (real live Open-Meteo) — `FashionAIStylistPanel` |
| 7 | Cost-per-wear tracking | **ALREADY REAL** | `itemView.costPerWear` (computed on every read), `closet-stats`, `wear-insights` |
| 8 | Wear-rate / times-worn tracking | **ALREADY REAL** | `item-wear` increments real `timesWorn`; surfaced across Closet, Plan, and Capsule tabs |
| 9 | Wear calendar (schedule/log what was worn by date) | **ALREADY REAL** | `calendar-log`/`calendar-view` — `FashionCalendarPanel` |
| 10 | Packing lists that auto-populate from an outfit's items | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS SESSION** | `packing-add-item` only ever took a single `itemId`; no backend "add outfit" shortcut existed. Wired client-side in `FashionPlanPanel` — a "add a whole outfit's items" control loops the real per-item macro across every item in a chosen outfit; no backend change needed |
| 11 | Lookbooks / curated outfit collections | **ALREADY REAL** | `lookbook-create`/`lookbook-list`/`lookbook-add-outfit` — `FashionPlanPanel` |
| 12 | Wardrobe stats/analytics dashboard | **ALREADY REAL** | `closet-stats`, `wear-insights`, `fashion-dashboard` — the `FashionClosetSection` header strip + `FashionPlanPanel` insights section |
| 13 | Personal style quiz → profile + recommendations | **ALREADY REAL** | `style-quiz-questions`/`style-quiz-submit`/`style-profile-get` — recommendations are derived from the user's real closet gaps, not generic advice; arguably deeper than either reference app's onboarding quiz |
| 14 | Wishlist (save desired external items with price/link) | ~~**GENUINELY MISSING (was FAKED pre-rebuild) → FAKE REMOVED, HONESTLY DEFERRED**~~ **CLOSED (2026-07-12, `a7850695`)** | See "What this rebuild changed" §2 below — real `fashion.wishlist-add`/`wishlist-list`/`wishlist-remove`/`wishlist-convert-to-item` macros now exist, backed by a real per-user `STATE.fashionLens.wishlist` substrate (the same Map-per-user pattern `items`/`outfits`/`capsules` already use — this domain has no DB tables at all, so no migration was needed), plus a real `FashionWishlistPanel` (structured name/price/link/note fields) mounted as a new tab. `wishlist-convert-to-item` reuses the exact item-construction function `item-add` calls, so a converted entry becomes a first-class closet item through the same code path. |
| 15 | Moodboards (pin inspiration images to a canvas) | ~~**GENUINELY MISSING — SCOPED FUTURE BUILD**~~ **CLOSED (2026-07-16, `957e0387`)** | New `moodboard-create`/`list`/`update`/`delete`/`add-item`/`remove-item` macros, modeled on the `wishlist-*` family rather than `lookbook-*`: a moodboard pin is a freeform external reference (image URL + note), not a pointer to another first-class Concord entity the way a lookbook's `outfitIds` are. Pins are embedded directly on their board object (not a separate top-level Map), so deleting a board can never leave a dangling item reference. `imageUrl` is validated (http(s):// or data:image/...) and honestly rejected otherwise. Pins carry a numeric x/y position on a bounded 1000×1000 virtual canvas (auto-cascaded when omitted) — the honest minimal version of "canvas," not a drag-and-drop engine. New `FashionMoodboardPanel.tsx`, mirroring `FashionWishlistPanel.tsx`'s structure, mounted as a new "Moodboards" tab in `FashionClosetSection.tsx`. `SaveAsDtuButton`'s "save inspiration" capability was left un-integrated with moodboards — it's an aggregate action over the whole `FashionFeed` post list, and individual posts don't currently parse an image field from Reddit's API, so a per-post "Pin to moodboard" action would need a larger, out-of-scope restructure. 18 new backend tests, 12 new frontend tests. |
| 16 | Social — friends' closets / clone an item from a friend's closet / share outfits | **CLOSED (2026-07-16, `0ab4494d`)** | `social-share-outfit`/`social-feed`/`social-like`/`social-save` give a real global community feed — `FashionSocialPanel`. `social-feed` now accepts a `friendsOnly` param filtering to confirmed friends via the real friend graph (`server/lib/friendships.js#listFriends`, the same primitive `timeline.js`'s friends-tier privacy gate already uses); no db handle fails closed to an empty feed. New `social-clone-item` macro creates a wholly independent item in the caller's closet via `buildWardrobeItem` (its third caller) — never mutates the source. New "Friends only" toggle + per-item "Clone to my closet" button. |
| 17 | Resale / marketplace integration for unworn items | **ALREADY REAL (different, deliberate scope)** | `declutter-suggestions` (real depreciation-curve estimate) + `resale-list-item`/`resale-unlist-item`/`resale-listings` — a real listing **handoff** to external channels (Depop/Vinted/Poshmark/eBay/local), not an embedded checkout/payment flow. This is an honest, deliberate scope difference (Concord doesn't process resale payments), not a gap to close |
| 18 | Capsule wardrobe planning | **ALREADY REAL** | `capsule-create`/`capsule-list`/`capsule-toggle-item`/`capsule-delete` — `FashionCapsulePanel` |
| 19 | `#30wears`-style sustainability wear-pledge tracking | **ALREADY REAL** | `challenge-enroll`/`challenge-unenroll`/`challenge-list` — progress reads real `timesWorn`, not a fabricated counter |
| 20 | Laundry/availability status (clean / dirty / at cleaner / lent out) | ~~**GENUINELY MISSING — HONEST, DEFERRED**~~ **CLOSED (2026-07-12, `d4cb7951`)** | See "Wave 4 gap-closure — laundry/availability status" below. A real `laundryStatus` field now exists on every closet item (`clean`/`dirty`/`at_cleaner`/`lent_out`, defaulting to `clean` including for back-compat reads of pre-existing items), settable via the existing `item-update` macro (exactly the small, well-scoped addition this row originally called for — no new macro), with a real "what can I wear right now" status filter on `item-list` and in `FashionClosetPanel`. |
| 21 | AI-assisted item tagging from a photo (auto-detect category/color) | **UNSURFACED → WIRED THIS SESSION (honest form)** | `fashion.vision` existed with zero callers. Wired as a real, human-in-the-loop "Analyze photo" helper (see macro table above) rather than auto-filling fields from unstructured model prose |

**Coverage summary:** 13 of 21 checklist items already real before this
session (10 pre-existing + 3 newly counted as real on closer read); 3
wired/fixed this session (`vision` surfaced, packing-list bulk-add,
honest trend sandbox); 2 fakes/gaps removed, honestly re-scoped, then
**closed for real** in the 2026-07-12 Wave 4 gap-closure pass (wishlist
and laundry/availability status — see below); 3 honestly flagged as
scoped future builds (retailer catalog, moodboards, friends-scoped
social graph); 1 honestly flagged as a deliberate, non-blocking scope
difference (resale is a listing handoff, not embedded checkout); 1
honestly flagged as a cosmetic-only gap (drag canvas vs. tag-select
outfit builder). **0 items were left with a silent "maybe"
disposition.**

## What this rebuild changed

### 1. Two disconnected "wardrobes" resolved to one real one

The old `app/lenses/fashion/page.tsx` had a "Wardrobe" tab built on
`useLensData<FashionItem>('fashion', 'garment', { seed: [] })` — the
generic per-user artifact CRUD system (`/api/lens/fashion?type=garment`).
This is **real, persisted data** (not fabricated), but it is a
**completely separate item list** from the real `item-add`/`item-list`
wardrobe that `FashionClosetPanel` (mounted via the already-existing
`FashionClosetSection`, itself bolted awkwardly above the old page body)
reads and writes. A user adding an item via the old "Add Item" button
populated a wardrobe that never appeared in the Closet tab, and vice
versa. Neither surface was fake, but presenting two disconnected "your
wardrobe" data stores side-by-side was a genuine confusion/honesty
problem — a user had no way to know which one was "real."

**Resolution:** the old `useLensData('fashion', 'garment')` wardrobe,
its stats strip, its category-distribution bar, and its own
add/search/filter/grid/list UI were retired entirely. The real
`item-*` substrate (already correctly wired through `FashionClosetPanel`
inside `FashionClosetSection`) is now the **one** wardrobe.

### 2. Fabricated, non-persisted "Outfits" and "Wishlist" tabs removed

The old page also had `const [outfits, setOutfits] = useState<OutfitCombo[]>([])`
and `const [wishlist, setWishlist] = useState<{name,price,link}[]>([])` —
**pure client-side React state with zero API calls**. Creating an outfit
or a wishlist item there rendered full persistence-implying chrome (star
ratings, item counts, running totals) but vanished on page refresh. This
is the fabricated-persistence-presented-as-real pattern this program's
fake-data detector targets.

**Resolution:**
- The fake "Outfits" tab was deleted. The real `outfit-create`/
  `outfit-list`/`outfit-detail`/`outfit-delete`/`outfit-wear` substrate
  (already wired via `FashionOutfitsPanel`, with real cost totals
  computed from real item costs) is the one Outfits surface.
- ~~The fake "Wishlist" tab was deleted outright. **No real backend
  wishlist concept exists anywhere in `fashion.js`** — confirmed by full
  read of the file; there is no `wishlist` Map, table, or macro. Rather
  than reimplement the same local-state fakery under nicer styling, this
  is disposed as checklist item #14 above: an honest, explicit, scoped
  future build (not attempted this session), not a rebuilt fake.~~

  **CLOSED (2026-07-12, `a7850695`, Wave 4 gap-closure pass).** The
  deferred build named above shipped for real, following this domain's
  existing in-memory-STATE convention exactly (this domain has no DB
  tables of its own at all — `items`/`outfits`/`wearLog`/`packing`/
  `lookbooks`/`styleProfiles`/`challenges`/`capsules` are all per-user
  `Map`s under `globalThis._concordSTATE.fashionLens`, persisted via the
  shared `saveFashionState()` debounce — so "wishlist_items table" from
  the original deferred-build note was aspirational phrasing for a
  DB-backed domain; the real fix adds a `wishlist` Map to that same
  substrate, no migration involved):
  - `server/domains/fashion.js` — four new macros: `wishlist-add`
    (name required; optional non-negative `price`, `link`, `note`,
    `category`), `wishlist-list` (per-user, newest-first, returns a real
    `totalValue` sum), `wishlist-remove`, and `wishlist-convert-to-item`
    (finds the wishlist entry, builds a real closet item via the
    **same** `buildWardrobeItem()` constructor `item-add` calls —
    extracted as a shared helper specifically so this wouldn't become a
    second, parallel item-creation implementation — accepts optional
    `category`/`cost`/`brand`/`color`/`photo` overrides on top of the
    wishlist entry's own fields, then removes the wishlist entry).
  - `concord-frontend/components/fashion/FashionWishlistPanel.tsx` —
    new; a real designed panel (not a JSON-paste textarea, not a generic
    action list) with structured add-entry fields (name/price/link/
    note/category), a card list per entry showing price + a real
    clickable link + note, a remove action, and an inline "Bought it —
    move to closet" convert flow (category + cost fields, pre-filled
    from the entry, calling `wishlist-convert-to-item`).
  - `concord-frontend/components/fashion/FashionClosetSection.tsx` —
    new "Wishlist" tab (Heart icon) mounting the panel.
  - Tests: 8 new backend cases in
    `server/tests/fashion-domain-parity.test.js` (add validation —
    missing name, negative price; add/list/remove round-trip; per-user
    isolation; unknown-id remove fails honestly; convert-to-item
    produces a real item in the same `item-list` substrate `item-add`
    writes to, honors overrides, and an unknown-id convert both fails
    and creates nothing) — 32/32 passing in the file (24 pre-existing +
    8 new), 0 regressions. 7 new frontend cases in
    `FashionWishlistPanel.test.tsx` (render with data, empty state, add
    flow via the structured form, missing-name validation rejection
    with no macro call, remove flow, convert flow calling
    `wishlist-convert-to-item`, honest backend-error surfacing) — 7/7
    passing.

### 3. Legacy scaffold trio and dark realtime surface retired

`ManifestActionBar`, `AutoActionStrip`, `RecentMineCard`,
`CrossLensRecentsPanel`, `UniversalActions`, and `LensFeaturePanel` were
removed — generic macro-button-wall scaffold superseded by the designed
tab surface. `useRealtimeLens('fashion')` / `LiveIndicator` /
`RealtimeDataPanel` were also removed: `fashion` has no entry in
`hooks/useRealtimeLens.ts`'s `DOMAIN_EVENTS` map, so the "live" indicator
was permanently dark (`isLive` always false) — decorative dead chrome,
not a real-time surface, removed rather than kept as inert decoration.

### 4. Two real external feeds kept, clarified

`FashionFeed` (a live Reddit r/malefashionadvice /r/femalefashionadvice
/r/streetwear /r/fashion /r/sewing top-posts feed, client-fetched, with
`SaveAsDtuButton`) and `LensFeedButton` (the real Met Museum Open Access
costume-object ingestion via the `feed` macro) are two genuinely distinct
real data sources — both kept, placed side-by-side below the main
workbench with a clearer label ("Met Museum costume archive" vs. the
community-discussion feed) so it's clear they're different things, not a
duplicate.

### 5. Unsurfaced/under-surfaced macros wired

- `fashion.vision` wired into `FashionClosetPanel`'s add-item form
  ("Analyze photo") — see macro table above for the honesty rationale
  (shows real freeform model output, doesn't auto-fill fields from it).
- Packing-list bulk-add-from-outfit wired client-side in
  `FashionPlanPanel` (loops the real `packing-add-item` macro over an
  outfit's real `itemIds` — no backend change).
- `trendAnalysis` re-scoped from a raw-JSON action button into a
  structured-input, honestly-labeled sandbox tool (`FashionTrendSandboxPanel`,
  new "Trends" tab).

### 6. Manifest copy corrected

`lib/lenses/manifest.ts`'s fashion entry (`emptyState`, `firstRunGuide`,
`actions`) described macros that never existed in `fashion.js`
(`seasonalRotation`, `donateList`, `styleAnalysis`, `wardrobeValue`,
`colorPalette`) — stale placeholder copy shown directly to users via
`FirstRunTour` and `DepthBadge`'s empty state. Corrected to name real,
currently-registered macros (`ai-outfit-generate`, `closet-stats`,
`declutter-suggestions`, `style-quiz-submit`) and describe what they
actually do.

## Files touched

- `concord-frontend/app/lenses/fashion/page.tsx` — full rewrite (thin
  chrome around the real `FashionClosetSection` app; retired the fake
  wardrobe/outfits/wishlist and the legacy scaffold trio)
- `concord-frontend/components/fashion/FashionClosetSection.tsx` —
  controllable active tab (for page-level keyboard shortcuts), added the
  "Trends" tab
- `concord-frontend/components/fashion/FashionTrendSandboxPanel.tsx` —
  new; honest structured-input trend-analysis sandbox
- `concord-frontend/components/fashion/FashionClosetPanel.tsx` — wired
  `fashion.vision` "Analyze photo" helper into the add-item form
- `concord-frontend/components/fashion/FashionPlanPanel.tsx` — wired
  "add a whole outfit's items" bulk action into packing lists
- `concord-frontend/lib/lenses/manifest.ts` — corrected the fashion
  entry's `actions`/`emptyState`/`firstRunGuide` to name real macros
- `docs/lens-specs/fashion-capability-map.md` — this document

**Not touched** (pre-existing, real, kept as-is): `FashionOutfitsPanel.tsx`,
`FashionCalendarPanel.tsx`, `FashionAIStylistPanel.tsx`,
`FashionStyleQuizPanel.tsx`, `FashionSocialPanel.tsx`,
`FashionResalePanel.tsx`, `FashionCapsulePanel.tsx`, `FashionFeed.tsx`,
`server/domains/fashion.js` (no macro/wiring-layer changes — per this
program's rule, and CLAUDE.md's, of rebuilding the UI layer without
rewriting working backend wiring).

## Verification

- `npx eslint` on all touched files: clean (0 errors, 0 warnings).
- `npx tsc --noEmit -p .` (full project): 0 errors.
- `grep -rl 'fashion' concord-frontend/tests/`: only
  `tests/lens-e2e/lens-list.ts` (an auto-generated smoke-test lens-id
  list, not a fashion-specific assertion file) — no test updates needed.
- No `<div onClick>` in any touched/added file — every interactive
  element is a real `<button>` (verified by grep).
- No `Math.random()` in any render path in the fashion component tree.
- Every step-1.5 checklist item above has an explicit disposition; none
  left silent.

## Wave 4 gap-closure (2026-07-12) — real wishlist substrate + UI

Closed checklist item #14 (see the table above and "What this rebuild
changed" §2 for the full detail). No migration was needed — this domain
has no DB tables at all; it persists per-user data as `Map`s under
`globalThis._concordSTATE.fashionLens`, and the new `wishlist` Map
follows that exact, pre-existing convention.

### Files touched

- `server/domains/fashion.js` — extracted `buildWardrobeItem(params)` as
  a shared constructor (`item-add` now calls it instead of inlining the
  same object-construction logic); added `wishlist` to
  `getFashionStateExt()`'s Map initializer; four new macros:
  `wishlist-add`, `wishlist-list`, `wishlist-remove`,
  `wishlist-convert-to-item`.
- `server/tests/fashion-domain-parity.test.js` — 8 new cases under a new
  `describe("fashion.wishlist", ...)` block (validation, round-trip,
  per-user isolation, convert-to-item with and without overrides,
  unknown-id failure paths).
- `concord-frontend/components/fashion/FashionWishlistPanel.tsx` *(new)*
  — structured add form (name/price/link/note/category), card list with
  a real clickable link, remove action, inline "Bought it — move to
  closet" convert flow.
- `concord-frontend/components/fashion/FashionWishlistPanel.test.tsx`
  *(new)* — 7 cases (render, empty state, add, validation rejection,
  remove, convert, honest error surfacing).
- `concord-frontend/components/fashion/FashionClosetSection.tsx` — new
  "Wishlist" tab (Heart icon) wired between Outfits and AI Stylist;
  imports the new panel.
- `docs/lens-specs/fashion-capability-map.md` — this document.
- `docs/WAVE4_INVENTORY.md` — matching row updated to CLOSED.

### Verification (this pass)

- `node --check server/domains/fashion.js` — passes.
- `cd server && npx eslint domains/fashion.js tests/fashion-domain-parity.test.js`
  — 0 errors, 0 warnings.
- `cd server && node --test tests/fashion-domain-parity.test.js` — 32/32
  passing (24 pre-existing + 8 new wishlist cases), 0 regressions from
  the `buildWardrobeItem` extraction.
- `cd concord-frontend && npx vitest run components/fashion/FashionWishlistPanel.test.tsx`
  — 7/7 passing.
- `cd concord-frontend && npx eslint components/fashion/FashionWishlistPanel.tsx components/fashion/FashionWishlistPanel.test.tsx components/fashion/FashionClosetSection.tsx`
  — 0 errors, 0 warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` (full project) — 0
  errors.

## Wave 4 gap-closure (2026-07-12, `d4cb7951`) — laundry/availability status

Closed checklist item #20 (see the table above). Confirmed genuinely
missing before starting (`git log --oneline -10 -- server/domains/fashion.js
concord-frontend/components/fashion/` showed only the unrelated wishlist
commit `a7850695`; `grep -n "CLOSED" docs/lens-specs/fashion-capability-map.md`
had no hit on the laundry row). Followed this row's own original
scoping exactly: extended the existing `item-update` macro rather than
adding a new one, and added a status filter to `FashionClosetPanel`
rather than a separate laundry dashboard page.

### What shipped

- `server/domains/fashion.js`:
  - `LAUNDRY_STATUSES = ["clean", "dirty", "at_cleaner", "lent_out"]`.
  - `buildWardrobeItem()` now stamps `laundryStatus: "clean"` on every
    new item (so `item-add` and `wishlist-convert-to-item`, which both
    call this shared constructor, get the field for free).
  - `itemView()` defaults `laundryStatus` to `"clean"` for any stored
    item where the field is missing or invalid — real back-compat for
    items that existed before this field was introduced, not a silent
    crash or an `undefined` leaking to the client.
  - `item-update` gained a `laundryStatus` param, validated **before**
    any other field is mutated (an invalid value rejects the whole call
    with `{ ok: false, error: "invalid laundryStatus (must be one of
    clean, dirty, at_cleaner, lent_out)" }` and leaves the item
    completely unchanged — no partial update) and case-insensitive on
    input.
  - `item-list` gained a `laundryStatus` filter param (same pattern as
    the existing `category`/`season` filters), the backend half of
    "what can I wear right now."
- `concord-frontend/components/fashion/FashionClosetPanel.tsx`:
  - A real status `<select>` on every closet item card (labelled per
    item for accessibility), colour-coded per status, that calls
    `fashion.item-update` with the real `laundryStatus` param on
    change (optimistic local update, then a real refresh — not a
    client-only toggle).
  - A "What can I wear" filter row (Any status / Clean / Dirty / At
    cleaner / Lent out) that re-queries `item-list` with the
    `laundryStatus` param, narrowing the same grid the category filter
    already narrows — reuses the existing filter-row pattern rather
    than inventing a parallel UI concept.
- Tests: 7 new backend cases in
  `server/tests/fashion-domain-parity.test.js` under a new
  `describe("fashion.item laundry status", ...)` block (defaults to
  clean on add; back-compat default for an item missing the field;
  update sets and persists a valid status; all four documented statuses
  are accepted; case-insensitivity; an invalid status is rejected with
  no partial update applied; `item-list` filters correctly by status) —
  39/39 passing in the file (32 pre-existing + 7 new), 0 regressions. 6
  new frontend cases in `FashionClosetPanel.test.tsx` (selector renders
  per item defaulting to Clean, all four options present; a
  non-default status from the backend renders correctly; changing the
  selector calls `item-update` with the real param and the UI reflects
  the confirmed value; a rejected update surfaces the real backend
  error text; the status filter re-queries `item-list` and narrows the
  grid; "Any status" clears the filter) — 6/6 passing.

### Files touched

- `server/domains/fashion.js` — `LAUNDRY_STATUSES` constant,
  `laundryStatus` on `buildWardrobeItem()`/`itemView()`, `item-update`
  validation + set, `item-list` filter.
- `server/tests/fashion-domain-parity.test.js` — new
  `describe("fashion.item laundry status", ...)` block, 7 cases.
- `concord-frontend/components/fashion/FashionClosetPanel.tsx` —
  laundry status selector per item, "what can I wear" filter row,
  header comment updated.
- `concord-frontend/components/fashion/FashionClosetPanel.test.tsx`
  *(new)* — 6 cases.
- `docs/lens-specs/fashion-capability-map.md` — this document.
- `docs/WAVE4_INVENTORY.md` — matching row updated to CLOSED.

### Verification (this pass)

- `node --check server/domains/fashion.js` — passes.
- `cd server && npx eslint domains/fashion.js tests/fashion-domain-parity.test.js`
  — 0 errors, 0 warnings.
- `cd server && node --test tests/fashion-domain-parity.test.js` — 39/39
  passing (32 pre-existing + 7 new laundry-status cases), 0 regressions.
- `cd concord-frontend && npx vitest run components/fashion/FashionClosetPanel.test.tsx`
  — 6/6 passing.
- `cd concord-frontend && npx eslint components/fashion/FashionClosetPanel.tsx components/fashion/FashionClosetPanel.test.tsx`
  — 0 errors, 0 warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` (full project) — 0
  errors.
