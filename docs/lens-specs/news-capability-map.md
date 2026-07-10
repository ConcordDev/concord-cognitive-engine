# News / Intelligence — Capability Map

> Flagship rebuild (Phase 2, `docs/FRONTEND_REBUILD_PROGRAM.md`).
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

| # | Macro | Class | Surface in the rebuilt desk |
|---|---|---|---|
| 1 | `biasDetection` | **designed** | Analysis workbench → Bias (runs on the selected-headline set) |
| 2 | `eventExtraction` | **designed** | Analysis workbench → Events |
| 3 | `narrativeTracking` | **designed** | Analysis workbench → Narrative |
| 4 | `headlines` | **designed** | Center live feed (category-driven GDELT query) |
| 5 | `daily-briefing` | **designed** | Right rail → Daily briefing card |
| 6 | `article-add` | backlog | (manual article entry — internal STATE) |
| 7 | `article-list` | backlog | superseded by live GDELT feed for the primary view |
| 8 | `article-detail` | backlog | |
| 9 | `article-search` | backlog | (feed has client-side source filter; server search is backlog) |
| 10 | `article-delete` | backlog | |
| 11 | `channel-list` | honest-empty → **designed** (derived) | Left rail "Sources" is derived live from the current feed's source domains (the journalism attribution view); the STATE-backed channel-follow graph is backlog |
| 12 | `channel-follow` | backlog | |
| 13 | `channel-articles` | backlog | |
| 14 | `topic-list` | backlog | (categories cover the primary topic axis) |
| 15 | `topic-follow` | backlog | |
| 16 | `topic-articles` | backlog | |
| 17 | `feed` | backlog | personalized STATE feed — superseded by live GDELT for v1 |
| 18 | `today-digest` | backlog | (daily-briefing covers the digest surface) |
| 19 | `recommended` | backlog | |
| 20 | `trending` | backlog | |
| 21 | `article-save` | backlog | (pull→DTU is the canonical save; STATE save is backlog) |
| 22 | `saved-list` | backlog | superseded by "Pulled intelligence" (DTU-backed) |
| 23 | `article-mark-read` | backlog | |
| 24 | `reading-history` | backlog | |
| 25 | `reading-stats` | backlog | |
| 26 | `article-react` | backlog | |
| 27 | `interests` | backlog | |
| 28 | `bias-spectrum` | backlog | (workbench covers per-source bias; spectrum viz is backlog) |
| 29 | `story-clusters` | backlog | |
| 30 | `article-audio` | backlog | |
| 31 | `alert-subscribe` | backlog | |
| 32 | `alert-list` | backlog | |
| 33 | `alert-feed` | backlog | |
| 34 | `offline-sync` | backlog | |
| 35 | `offline-list` | backlog | |
| 36 | `source-profile` | backlog | (left-rail source counts are a lightweight profile; full profile is backlog) |
| 37 | `digest-schedule-set` | backlog | |
| 38 | `digest-schedule-get` | backlog | |
| 39 | `news-dashboard` | backlog | |

**Designed coverage this pass: 5 core macros + 1 derived (channel/source
attribution)** — the live feed, briefing, and all three media-literacy
engines. The long backlog tail (personalized STATE reader: follows, saves,
reading-history, alerts, digest scheduling, offline sync) is real but was
only ever reachable through generic strips; those are the ranked next-wave
surfaces, not fabricated features hidden behind dead buttons.

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
`RecentMineCard` + `CrossLensRecentsPanel`). The rebuild composes the same
real backend surface into one designed console; those component files remain
on disk (not deleted — some are imported elsewhere) but are no longer the
lens's front door.
