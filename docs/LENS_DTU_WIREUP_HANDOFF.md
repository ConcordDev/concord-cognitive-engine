# Lens DTU Wire-Up — Handoff

**Status at handoff:** 41 of 184 lenses converted with bespoke real-data panels +
`SaveAsDtuButton` (PRs #544–#585, all merged to `main`). 143 remain.

This doc exists so the next session (any agent or a human) can pick up the work
without re-discovering the pattern. The pattern is mechanical; only the choice
of API + the panel layout per lens needs judgement.

---

## The pattern (one PR per lens)

Every converted lens follows the same six-step recipe. Don't deviate without a
specific reason — the consistency is the value.

### 1. Branch

```bash
git checkout main && git pull
git checkout -b claude/<lens>-lens-dtu-wireup-$(date +%s)
```

### 2. Author the bespoke panel

Create `concord-frontend/components/<lens>/<ComponentName>.tsx` — a ~80–150 LOC
client component that:

- Hits **one** real public API (free, no key needed) OR one Concord-internal
  endpoint (`/api/lens/run` macro or REST route). Pool below.
- Renders 2–4 KPI cards on top + a list/grid of result rows below.
- Polls with `useQuery` from `@tanstack/react-query`. 60s `refetchInterval` is
  the default — bump to 30s for fast-moving feeds, 5 min for slow ones.
- Embeds a `<SaveAsDtuButton …>` in the header so the user can snapshot the
  live view as an unowned-public-data ORIGINAL DTU.

Use `concord-frontend/components/dreams/DreamConvergences.tsx` as the
canonical reference (96 LOC, both a Concord-internal macro path and Save-as-DTU
embed). For an external-API example use any recent component under
`concord-frontend/components/crypto/`, `concord-frontend/components/crisis-ops/`,
or `concord-frontend/components/creator/`.

#### SaveAsDtuButton — the required call shape

```tsx
<SaveAsDtuButton
  compact
  apiSource="<kebab-case-source-id>"       // "coingecko", "fema-disasters", "concord-dream"
  apiUrl="<full URL hit, with params>"     // optional but recommended for provenance
  title={`<scannable title — include a count or date>`}
  content={`<human-readable body, plain text or md>`}
  extraTags={['<domain tag>', '<source tag>', 'concord']}
  rawData={{ /* the parsed JSON the panel just rendered */ }}
/>
```

`apiSource` lands as the DTU's top-level `source` field; `rawData` is preserved
in `meta.rawSnapshot` so a future reader can re-derive the panel.

### 3. Mount in the page

Edit `concord-frontend/app/lenses/<lens>/page.tsx`:

```tsx
import { <ComponentName> } from '@/components/<lens>/<ComponentName>';
```

Then, immediately before the closing `</LensShell>` (or `</div>` if the page
doesn't wrap in `LensShell`):

```tsx
<section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
  <<ComponentName /> />
</section>
```

Don't touch the existing lens content. The new panel is purely additive.

### 4. Local checks

```bash
cd concord-frontend
npx tsc --noEmit
npx eslint app/lenses/<lens>/page.tsx components/<lens>/<ComponentName>.tsx
```

Fix any errors. Both must be clean before commit.

### 5. Commit + push + PR + squash-merge

```bash
git add concord-frontend/components/<lens>/ concord-frontend/app/lenses/<lens>/page.tsx
git commit -m "$(cat <<'EOF'
<lens> lens: bespoke <one-line description> + Save-as-DTU

<2–3 sentences: what the panel polls, cadence, what the Save-as-DTU snapshots>
EOF
)"
git push -u origin <branch-name>
```

Then via MCP:

```
mcp__github__create_pull_request  (title matches commit subject)
mcp__github__merge_pull_request   (merge_method: "squash")
```

### 6. Move on to the next lens

One PR per lens. Don't batch — small PRs review fast and revert cleanly.

---

## Real-data API pool (free, no key required for most)

| Source | Base URL | Good for |
|---|---|---|
| GitHub | `https://api.github.com` (`/repos`, `/search/repositories`, `/gists/public`, `/advisories`, `/repos/{o}/{r}/releases`) | code · repos · releases · CVEs · gists |
| Wikipedia | `https://en.wikipedia.org/api/rest_v1/page/summary/<title>` | encyclopedic reference for any topic |
| Wikimedia Commons | `https://commons.wikimedia.org/w/api.php` | media · imagery |
| Reddit JSON | `https://www.reddit.com/r/<sub>/top.json?t=day&limit=25` | community feeds, news |
| Stack Exchange | `https://api.stackexchange.com/2.3` | Q&A across 170+ sites |
| HN Algolia | `https://hn.algolia.com/api/v1/search?query=…&tags=story` | hacker news search/trending |
| USGS | `https://earthquake.usgs.gov/fdsnws/event/1/query` | earthquakes, hazards |
| NOAA | `https://api.weather.gov/`, `https://api.tidesandcurrents.noaa.gov/` | weather, tides, climate |
| FEMA | `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries` | disaster declarations |
| NVD | `https://services.nvd.nist.gov/rest/json/cves/2.0` | CVEs |
| CoinGecko | `https://api.coingecko.com/api/v3` | crypto prices, market data |
| Project Gutenberg | `https://gutendex.com` | public-domain books |
| ZenQuotes | `https://zenquotes.io/api/quotes` | quotes (already used by `daily` lens) |
| OSHA / data.gov | `https://data.gov` | federal datasets (used by `construction` lens) |

### Concord-internal endpoints (use when an external API is awkward)

Many lenses already have a backing macro or REST route — call those directly
instead of inventing a public-API mapping. Useful starting points:

- `POST /api/lens/run` with `{ domain, name, input }` — covers ~800 macros
- `GET /api/system/health`, `/api/perf/metrics`
- `GET /api/economy/{status,balance,fees}`, `/api/wallet/balance`
- `GET /api/brain/status`, `/api/agents`, `/api/attention`, `/api/affect`
- `GET /api/creator/{leaderboard,trending-citations}`
- `GET /api/council/voices`
- `GET /api/crafting`, `/api/concord-link/*`
- `GET /api/black-market`, `/api/faction-war/active`
- World macros: `POST /api/worlds/:worldId/...` for in-world data

When in doubt, grep `server/domains/<lens>.js` for an exported macro that
matches the lens's purpose and call it through `/api/lens/run`.

---

## Remaining lenses (143)

In alphabetical order — work through these top-to-bottom unless a specific lens
is requested out-of-order:

```
death-insurance · debate · debug · deities · desert · disputes · diy · docs ·
dreams · dtus · dx-platform · education · electrical · emergency-services ·
engineering · entity · ethics · event-timeline · events · expedition-journal ·
experience · expert-mode · export · fashion · federation · feed · film-studios ·
finance · fitness · food · forecast · forge · forum · foundry · fractal · game ·
game-design · genesis · ghost-tracker · global · goals · goddess · graph ·
grounding · home-improvement · hvac · hypothesis · import · inference · ingest ·
inheritance · insurance · integrations · invariant · kingdoms · lab · lattice ·
law · law-enforcement · legacy · lock · logistics · maker · manufacturing ·
marketing · marketplace · masonry · math · mentorship · mesh · message · meta ·
metacognition · metalearning · ml · neuro · news · observe · offline · ops ·
organ · parenting · personas · philosophy · physics · platform · plumbing ·
privacy · productivity · projects · psyops · quantum · questmarket · queue ·
reasoning · reflection · repos · research · resonance · robotics · root ·
sandbox · schema · science · security · self · sentinel · services · settings ·
sim · sponsorship · srs · staking · studio · sub-worlds · suffering ·
supplychain · sync · system · telecommunications · temporal · thread · tick ·
timeline · tools · tournaments · trades · transfer · ux-suite · veterinary ·
voice · vote · wallet · welding · wellness · whiteboard · world · world-creator ·
worldmodel
```

> **Note:** `dreams` already shipped as PR #585 (the most recent merge before
> this handoff). If a lens in this list already has a panel file under
> `concord-frontend/components/<lens>/`, double-check before reconverting —
> the list was generated before the final pre-handoff PRs landed.

---

## Conventions worth keeping

- **Don't touch the existing page content.** The bespoke panel is additive,
  mounted at the bottom inside its own `<section>`.
- **One PR per lens.** Don't batch multiple lenses into one PR — small PRs
  review fast and revert cleanly if something regresses.
- **No new test files required.** These are presentational panels; the
  `SaveAsDtuButton` itself is already covered. If a panel grows non-trivial
  logic (sorting, derived KPIs, etc.) add a vitest case under
  `concord-frontend/components/<lens>/__tests__/`.
- **Use `useQuery`, not raw `fetch` + `useEffect`.** Polling, dedupe, error
  state, and unmount cleanup are handled.
- **Keep panel imports minimal.** `lucide-react` icons, `@tanstack/react-query`,
  `@/lib/api/client`, `@/components/dtu/SaveAsDtuButton`. No new heavy deps.
- **Match the visual language.** `border-zinc-800 bg-zinc-950/40 p-4`,
  `text-xs / text-[10px] / font-mono` for metadata, accent colours per
  domain (purple for dream/cognitive, cyan for system, emerald for ecology,
  amber for caution).
- **Failure mode is a one-liner.** `{query.isError && <div …>API unreachable.</div>}`
  — don't build a full error-boundary tree per panel.

---

## Recent merged reference PRs (best-in-class examples)

| PR | Lens | API | Why it's a good template |
|---|---|---|---|
| #585 | dreams | concord-internal `dream.convergences` + `dream.count` | dual-macro fetch, KPIs + list, compact Save-as-DTU |
| #584 | database | GitHub search filtered by topic | external API with query string, topic-tagged Save |
| #581 | crypto | CoinGecko `/coins/markets` | KPI strip + live ticker, currency formatting |
| #580 | crisis-ops | FEMA disaster declarations | federal data, geographic facet |
| #578 | creator | concord-internal `creator.leaderboard` + `creator.trending-citations` | dual-source merge into one panel |
| #572 | construction | OSHA / data.gov | safety-domain dataset search |
| #571 | command-center | concord-internal `system.health` + `perf.metrics` | KPI-heavy ops dashboard pattern |

Reading any one of these end-to-end (component + page diff + commit message)
is the fastest way to internalise the pattern.
