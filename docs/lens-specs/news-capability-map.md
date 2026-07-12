# News / Intelligence — Capability Map

> Flagship rebuild (Phase 2, `docs/FRONTEND_REBUILD_PROGRAM.md`), **Wave 4
> gap-closure pass (2026-07-12)** added the personalized-reader half —
> read below for what changed.
> Identity: **research tool** — clean source attribution, skimmable
> headlines, citation-forward. Derived, not asserted: every row below was
> read from `server/domains/news.js` at rebuild time.
>
> **Classification** (per the program's per-lens loop):
> - **designed** — surfaced by a deliberate UI decision in the rebuilt desk.
> - **generic-strip-only (retired)** — was reachable only via the old
>   `ManifestActionBar`/`AutoActionStrip` button walls; the rebuild retired
>   those. Still callable via ⌘K / macro API, just no bespoke surface yet.
> - **honest-empty** — designed, but shows an honest empty/connect state
>   until the user produces substrate.
> - **backlog** — real macro, not yet given a designed surface (next wave).
>
> **Wave 4 correction:** the Phase 2 pass below classified 34 macros
> "backlog," reasoning that they were "only reachable through generic
> strips." Re-auditing at Wave 4 found that framing was too generous: the
> components implementing those 34 macros (`NewsReaderSection`,
> `NewsParitySuite` and their children) were fully built and *correct*, but
> were never imported by any mounted page — dead code, not generic-strip
> code (`NewsActionPanel`, separately, *is* the generic-strip case, and is
> also dead — see Retired). Wave 4 mounted the existing, correct components
> as a real second desk (**My Reader**, `components/news/MyReaderDesk.tsx`)
> reachable from `IntelDesk` via a header toggle, and closed the five
> macros that had no component at all (`article-detail`, `article-search`,
> `article-delete`, `channel-articles`, `topic-articles`). All 39 registered
> `news` macros now have a designed surface.

## Data sources — what "live" means here

| Source | Reality | How |
|---|---|---|
| **GDELT Project** | **REAL live external feed** | `news.headlines` / `news.daily-briefing` call `globalThis.fetch` → `api.gdeltproject.org/api/v2/doc/doc` (no API key, no connector needed). Real global news indexed ~every 15 min. **Needs outbound egress at runtime**; when unreachable the desk shows an honest error/empty state — never fabricated headlines. |
| **DTU substrate** | REAL | Pulled headlines become DTUs (`POST /api/dtus`) carrying source + URL + timestamp provenance; citation chains via `GET /api/social/cited-by/:id`. |
| **Analysis engines** | REAL deterministic | `biasDetection` / `eventExtraction` / `narrativeTracking` are pure text-analysis engines (loaded-language lexicon, sentiment asymmetry, source-diversity entropy, event who/what/when, framing-window similarity). No LLM required. |

There is **no news webhook/connector** wired (checked: the repo's real
connectors are Gmail + Google Calendar via `connectorFetch`; none is a news
feed). The GDELT `fetch` **is** the honest live source, so a "Connect
Sources" empty state is *not* the right deliverable here — the live feed is
real. The honest failure state applies only when egress is unavailable.

## Macro surface (39 registered `news` macros)

Two desks now cover all 39. **Live Desk** (`IntelDesk`) is the GDELT
research console described in the rest of this doc. **My Reader**
(`MyReaderDesk`, reached via the header toggle) is the separate,
STATE-backed personalized-reader + Ground News-shape media-literacy system.
Pulling a live headline on the Live Desk also adds it to My Reader's
directory (`news.article-add`, best-effort, non-blocking) so My Reader has
real content without requiring manual entry.

| # | Macro | Class | Surface |
|---|---|---|---|
| 1 | `biasDetection` | **designed** | Live Desk → Analysis workbench → Bias (runs on the selected-headline set) |
| 2 | `eventExtraction` | **designed** | Live Desk → Analysis workbench → Events |
| 3 | `narrativeTracking` | **designed** | Live Desk → Analysis workbench → Narrative |
| 4 | `headlines` | **designed** | Live Desk center feed (category-driven GDELT query) |
| 5 | `daily-briefing` | **designed** | Live Desk right rail → Daily briefing card |
| 6 | `article-add` | **designed** | My Reader → Today tab "Add story" form; also auto-fired (best-effort) when a Live Desk headline is pulled |
| 7 | `article-list` | **designed** | My Reader → Offline tab (sync candidates) and Audio Mode tab (article picker) both list the directory |
| 8 | `article-detail` | **designed** | `ArticleDetailModal` — opened by clicking any article title anywhere in My Reader (search results, Today/For You/Saved cards, channel/topic drill-downs) |
| 9 | `article-search` | **designed** | My Reader → persistent `NewsSearchBar` (debounced, real server-side search) |
| 10 | `article-delete` | **designed** | `ArticleDetailModal` → Remove (contributor-only; server-enforced, honest error shown to non-owners) |
| 11 | `channel-list` | **designed** | Live Desk left rail (derived, journalism attribution) AND My Reader → Following tab (STATE follow graph) — two distinct, real views |
| 12 | `channel-follow` | **designed** | My Reader → Following tab |
| 13 | `channel-articles` | **designed** | My Reader → Following tab, click a channel to drill into its articles |
| 14 | `topic-list` | **designed** | My Reader → Following tab |
| 15 | `topic-follow` | **designed** | My Reader → Following tab (topic chip's follow icon) |
| 16 | `topic-articles` | **designed** | My Reader → Following tab, click a topic chip to drill into its articles |
| 17 | `feed` | **designed** | My Reader → For You tab |
| 18 | `today-digest` | **designed** | My Reader → Today tab (top stories + topic sections; distinct from `daily-briefing`, which is a GDELT-sourced LLM-optional briefing) |
| 19 | `recommended` | **designed** | My Reader → For You tab |
| 20 | `trending` | **designed** | My Reader → Today tab |
| 21 | `article-save` | **designed** | Article cards' bookmark icon + `ArticleDetailModal` (STATE save; distinct from Pull→DTU, which is the Live Desk's citation-bound save) |
| 22 | `saved-list` | **designed** | My Reader → Saved tab |
| 23 | `article-mark-read` | **designed** | Article cards + `ArticleDetailModal` |
| 24 | `reading-history` | **designed** | My Reader → Saved tab |
| 25 | `reading-stats` | **designed** | My Reader → Saved tab (stat tiles) |
| 26 | `article-react` | **designed** | Article cards + `ArticleDetailModal` (More/Less, feeds `interests`) |
| 27 | `interests` | **designed** | My Reader → Following tab |
| 28 | `bias-spectrum` | **designed** | My Reader → Media-literacy tools → Bias Spectrum (Ground News-shape left/center/right columns over the STATE directory; complements, doesn't duplicate, the Live Desk's `biasDetection` engine, which runs on the selected live-headline set) |
| 29 | `story-clusters` | **designed** | My Reader → Media-literacy tools → Story Clusters |
| 30 | `article-audio` | **designed** | My Reader → Media-literacy tools → Audio Mode (article picker) AND `ArticleDetailModal` → Listen (inline, same article) |
| 31 | `alert-subscribe` | **designed** | My Reader → Media-literacy tools → Alerts |
| 32 | `alert-list` | **designed** | My Reader → Media-literacy tools → Alerts |
| 33 | `alert-feed` | **designed** | My Reader → Media-literacy tools → Alerts |
| 34 | `offline-sync` | **designed** | My Reader → Media-literacy tools → Offline |
| 35 | `offline-list` | **designed** | My Reader → Media-literacy tools → Offline |
| 36 | `source-profile` | **designed** | My Reader → Media-literacy tools → Source Transparency |
| 37 | `digest-schedule-set` | **designed** | My Reader → Media-literacy tools → Digest Schedule |
| 38 | `digest-schedule-get` | **designed** | My Reader → Media-literacy tools → Digest Schedule |
| 39 | `news-dashboard` | **designed** | My Reader → Reader mode stat strip (`NewsReaderSection`) |

**Coverage: 39/39 macros have a designed surface** (Wave 4, 2026-07-12).
`eventExtraction`/`narrativeTracking` were deliberately *not* forced onto
`story-clusters` — the analysis-workbench engines run on the Live Desk's
user-selected live-headline set, while story clusters group the STATE
directory; different data pools, each already a real designed feature,
so a fake connection wasn't added just to satisfy a surface-count.

## Pull → DTU → Remix flow (the citation spine)

1. **Pull** — every live headline row has a one-tap `SaveAsDtuButton`
   (`confirm={false}`). It creates a real DTU via `POST /api/dtus` with:
   - `source: "gdelt"`, `tags: ["real-data","gdelt","news",<category>,<country>]`
   - `meta: { apiProvider, apiUrl, fetchedAt, rawSnapshot }` — full provenance
     (source + URL + timestamp), reproducible.
2. **Remix / cite** — pulled DTUs appear in "Pulled intelligence". Deriving a
   new DTU that cites one as a parent (the platform's existing citation
   cascade) fires royalties to the source and grows the chain.
3. **Citation chain** — each pulled DTU expands to its live cited-by chain
   (`GET /api/social/cited-by/:id`), reusing the shared `DTUEmbed` component
   for cross-lens consistency. Honest empty state ("Not yet cited…") when the
   chain is empty.

## Micro-interactions (real, not decorative)

- **Live pulse** — `StatusDot` reflects the *actual* GDELT query state
  (`live` on success, `connecting` while fetching, `error` on feed failure).
- **One-click add-to-analysis** (`＋`↔`✓`) — builds the analysis set with a
  layout-animated toggle; the stat tile "In analysis set" counts it live.
- **Pull→DTU transform** — the bookmark button animates to a filled/checked
  state on real save, then invalidates the pulled-DTU query so the item
  appears in the citation panel immediately.
- **Category / source switch** — animated feed re-entry (`framer-motion`
  layout), source filter derived live from the result set.
- **Briefing + citation-chain expand/collapse** — height-animated disclosure.
- **Density toggle** — shared `DensityToggle` primitive (Low/Med/High).

## Retired

The old page stacked eight parity components (`NewsReaderSection`,
`GdeltHeadlines`, `HeadlineFeed`, `NewsBriefing`, `NewsActionPanel`,
`NewsParitySuite`, plus `ManifestActionBar` + `AutoActionStrip` +
`RecentMineCard` + `CrossLensRecentsPanel`). The Phase 2 rebuild composed the
GDELT surface into one designed console (`IntelDesk`) and stopped mounting
the rest.

**Wave 4 update:** `NewsReaderSection` and `NewsParitySuite` (and their
children — `NewsTodayPanel`, `NewsForYouPanel`, `NewsFollowingPanel`,
`NewsSavedPanel`, `NewsBiasSpectrum`, `NewsStoryClusters`,
`NewsSourceTransparency`, `NewsAudioMode`, `NewsAlerts`, `NewsOfflineSync`,
`NewsDigestSchedule`, `NewsArticleCard`) were re-audited macro-by-macro and
found to be correctly wired to their respective STATE-backed macros — they
were dead code, not broken code. They are now mounted for real as **My
Reader** (`components/news/MyReaderDesk.tsx`), reached from `IntelDesk` via
a header toggle. `NewsFollowingPanel` gained channel/topic drill-down
(`channel-articles`/`topic-articles`); a new `NewsSearchBar`
(`article-search`) and `ArticleDetailModal` (`article-detail`,
`article-delete`, plus the same-article mark-read/save/react/listen actions)
were added to close the remaining gaps.

`NewsActionPanel` (the true generic-strip case — a `biasDetection`/
`eventExtraction`/`narrativeTracking`/`daily-briefing` button wall) and
`GdeltHeadlines`/`HeadlineFeed`/`NewsBriefing` (superseded by `IntelDesk`'s
own feed + `BriefingCard`) remain retired and unmounted. `NewsActionPanel`
additionally calls `biasDetection`/`eventExtraction`/`narrativeTracking`
with the wrong input shape (`{ text, headline }` instead of `{ articles }`),
so every call there silently returns the macro's "no articles" branch — a
latent bug, harmless only because the component is unreachable. Left as-is
(out of this pass's scope); do not mount it without fixing that shape first.
