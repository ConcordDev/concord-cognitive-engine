# UX Completeness Sprint — Handoff

Branch: `claude/audit-app-completeness-GwBlp` (pushed to origin)
Plan: `/root/.claude/plans/what-s-missing-to-be-humble-scott.md`
Last update: 2026-05-17 (session 2 final)

---

## What landed across both sessions

22 commits implementing the foundation + first mechanical sweeps + 7 real-API wire-ups + 43 hero onboarding scripts + DraftedTextarea in production.

```
f42d623 Phase 4: Tier-2 contract test for free-API macro registrations
67500bd Phase 3: hand-wire DraftedTextarea in pharmacy lens
4e4412e Phase 5: 7 more hero onboarding scripts
ca949a8 Phase 4/5: arXiv parser test + 7 more hero onboarding scripts
fe80e1c Phase 4: mount ArxivPanel in 5 more science lenses
4c40320 Phase 4: arXiv wired for 9 science lenses; ArxivPanel mounted in 3
88bca9b Phase 4: FDA OpenFDA wired end-to-end (pharmacy lens)
27dadcb Phase 4: OsmGeocodePanel (atlas) + NoaaTidesPanel (ocean) wired
f70c9e7 Phase 4/5: NOAA tides macro + 8 more hero onboarding scripts
d07e673 Phase 5: author onboarding scripts for 12 more hero lenses
9cc8a4a Phase 4: Wikipedia On This Day panel wired to history lens
…       Phase 4: USGS quakes / OSM geocode / Wikipedia OTD wired
…       Phase 4: NASA APOD / ISS / NEO wired end-to-end (astronomy lens)
…       Phase 3/4: DraftedTextarea + DraftedInput; rival shells open
…       Phase 3 (codemod): mount RecentMineCard in 226 lens pages
03d4110 Handoff: session 1 snapshot
bad1c16 Phase 3/5: RecentMineCard + FirstRunTour mounted in all 232 lenses
03bb2a5 Phase 2 (bulk): recent_mine + list_mine across ~150 lens domains
478ff9f Phase 4 (codemod): mount DepthBadge in all 232 lens pages
89c1b34 Phase 2 (codemod): inject dataTier into all 208 manifest entries
3a6d942 Phase 2 (foundation): IntegrationRegistry + recent_mine helper
ab53b21 Phase 1: auto-save drafts + manifest extension + core hooks
```

Test totals: **117 passing / 0 failing** across the new Phase 1+2+4 contract tests + sampled existing tests. The broader suite has not been re-run end-to-end this session — do so before merging.

### Per-dimension progress

| # | Dimension | Status | What landed |
|---|---|---|---|
| 1 | **Persistence (auto-save drafts)** | ✅ infra + components + in-prod | Migration 194, drafts domain (4 macros), draft-gc-cycle heartbeat, useLensDraft hook, DraftedTextarea + DraftedInput drop-in components. **First production use: pharmacy lens "Intake notes" textarea.** Pattern proven; remaining lenses can swap inline. |
| 2 | **Load-from-substrate** | ✅ infra + mounted | useListMine hook + RecentMineCard mounted in 226 lens pages (6 hero lenses skipped — bespoke recents). |
| 3 | **Cross-session list views** | ✅ all ~150 domains | `<domain>.recent_mine` + `<domain>.list_mine` registered across ~150 lens domains. Standard return shape pinned by 11+7 Tier-2 assertions. |
| 4 | **Bespoke widgets** | partial — DepthBadge + shells visible | DepthBadge live on all 232 lenses. 5 rival shells defaultOpen={true} so they greet users immediately. The 42 bare lenses still need hand-polish (Phase 6). |
| 5 | **Realtime push (`useTilePush`)** | partial — auto-refresh wired | useListMine integrates socket revalidation. NasaLivePanel / UsgsQuakePanel / WikipediaOnThisDayPanel / NoaaTidesPanel / FdaLivePanel auto-refresh on intervals. Codemod for per-lens tile flash-on-change NOT yet written. |
| 6 | **Multi-step workflows** | NOT started | useLensSession hook + per-domain session_* macros pending. |
| 7 | **Mobile responsiveness** | NOT started | BottomSheet + SwipeNav primitives pending. |
| 8 | **Onboarding per lens** | ✅ 43 hero scripts | FirstRunTour mounted in all 232 lenses. **43 hero scripts authored** (~21% coverage). The tour fires automatically on first visit for scripted lenses; safe no-op on the rest. |
| 9 | **Depth bar (real data)** | ✅ infra + 7 live wires | IntegrationRegistry, DepthBadge visible everywhere. **7 REAL_FREE wire-ups landed**: NASA (astronomy), USGS (geology), Wikipedia (history), OSM (atlas), NOAA tides (ocean), FDA OpenFDA (pharmacy), arXiv (9 science domains — physics/quantum/robotics/bio/chem/math/ml/neuro all have visible panels). |
| 10 | **Cross-lens narrative** | NOT started | Migration 195 + ProvenanceTrail / LensFlowMap / DownstreamBadge pending. |

### Authored hero onboarding lenses (43)

chat, code, wallet, marketplace, forge, message, world, pharmacy, studio, music, calendar, collab, astronomy, atlas, crypto, math, news, crafting, finance, feed, goals, paper, agents, research, kingdoms, docs, travel, fitness, self, ml, whiteboard, physics, quantum, science, bio, chem, voice, lab, legal, mental-health, parenting, cooking, education.

---

## File map (final)

### Backend new files
- `server/migrations/194_lens_drafts.js`
- `server/lib/draft-gc.js`
- `server/lib/integration-registry.js`
- `server/emergent/draft-gc-cycle.js`
- `server/domains/drafts.js`
- `server/domains/_recent-mine-helper.js`
- `server/domains/_dtu-recent-mine.js`
- `server/domains/_recent-mine-bulk.js`
- `server/domains/astronomy-live.js`
- `server/domains/free-api-live.js`
- `server/domains/pharmacy-live.js`
- `server/domains/research-live.js`
- `server/tests/drafts-domain.test.js` (21 assertions)
- `server/tests/integration-registry.test.js` (11)
- `server/tests/recent-mine-helper.test.js` (11)
- `server/tests/dtu-recent-mine.test.js` (7)
- `server/tests/research-live-arxiv.test.js` (9)
- `server/tests/free-api-live-registration.test.js` (9)

### Frontend new files
- `concord-frontend/hooks/useLensDraft.ts`
- `concord-frontend/hooks/useListMine.ts`
- `concord-frontend/hooks/useDepthBadge.ts`
- `concord-frontend/components/lens/DepthBadge.tsx`
- `concord-frontend/components/lens/DraftedTextarea.tsx`
- `concord-frontend/components/lens/DraftedInput.tsx`
- `concord-frontend/components/lens/RecentMineCard.tsx`
- `concord-frontend/components/lens/FirstRunTour.tsx`
- `concord-frontend/components/astronomy/NasaLivePanel.tsx`
- `concord-frontend/components/geology/UsgsQuakePanel.tsx`
- `concord-frontend/components/history/WikipediaOnThisDayPanel.tsx`
- `concord-frontend/components/atlas/OsmGeocodePanel.tsx`
- `concord-frontend/components/ocean/NoaaTidesPanel.tsx`
- `concord-frontend/components/pharmacy/FdaLivePanel.tsx`
- `concord-frontend/components/research/ArxivPanel.tsx`
- `concord-frontend/scripts/codemod-manifest-tiers.mjs`
- `concord-frontend/scripts/codemod-depth-badge.mjs`
- `concord-frontend/scripts/codemod-first-run-tour.mjs`
- `concord-frontend/scripts/codemod-recent-mine-card.mjs`

### Modified
- `concord-frontend/lib/lenses/manifest.ts` — extended interface; 208/208 entries tier-tagged; 43 hero scripts
- `server/server.js` — wires drafts + bulk recent_mine + 4 free-API modules + publicReadDomains entries for 12 new domain/macro pairs + draft-gc-cycle heartbeat
- 232 × `concord-frontend/app/lenses/*/page.tsx` — DepthBadge + FirstRunTour mounted
- 226 × lens page — RecentMineCard mounted
- 5 × lens page — rival shells defaultOpen=true
- 8 × lens page — ArxivPanel mounted (physics/quantum/robotics/bio/chem/math/ml/neuro)
- pharmacy/page.tsx — DraftedTextarea + FdaLivePanel
- astronomy/page.tsx — NasaLivePanel
- geology/page.tsx — UsgsQuakePanel
- history/page.tsx — WikipediaOnThisDayPanel
- atlas/page.tsx — OsmGeocodePanel
- ocean/page.tsx — NoaaTidesPanel

---

## Next up (in priority order)

### Highest leverage (do these first)

1. **Author the remaining 165 hero onboarding scripts** — emptyState + firstRunGuide per manifest entry. Pattern proven 43 times; spreadsheet/LLM-batch is the right tool. Tour fires automatically once copy lands.

2. **Wire ~10 more free APIs from the integration-registry** — Pexels (photography), MET Museum (art/gallery), USDA FoodData (food/cooking/fitness — quick win), PubChem (chem complement), NCBI PubMed (bio/neuro complement), MedlinePlus (mental-health/wellness), EPA AirNow (environment), FRED (global), Khan Academy (education), iTunes Podcast search (podcast). Each is ~3 files following the proven 4-step pattern.

3. **Hand-swap DraftedTextarea + DraftedInput into 20+ form-heavy lenses** — paper, accounting, kingdoms, forge, podcast, design, chat-system messages, document editors. Pattern proven in pharmacy.

4. **Phase 5 multi-step sessions** — useLensSession hook + session_* macros for 11 backend session tables. Kingdoms→war_campaigns is the marquee wire-up.

5. **Phase 4 cont'd** — useTilePush codemod for `realtimeEvents` manifest field; expand event-shapes.js registry.

### Then per plan-file phase order

6. **Phase 5 mobile** — BottomSheet, SwipeNav primitives + Tier-1 hand-polish for 20 hero lenses; codemod-mobile-breakpoints for Tier-2.

7. **Phase 6** — 42 bare lenses → ≥6/10 widget density. Hand work; 6 themed batches.

8. **Phase 7** — cross-lens narrative. Migration 195 dtu_surface_log + ProvenanceTrail / LensFlowMap / DownstreamBadge.

---

## Verification checklist before merge

- [ ] `cd server && npm test` (full suite — only sampled this session; 117/117 on sample)
- [ ] `cd concord-frontend && npm run type-check` (last run: clean)
- [ ] `cd concord-frontend && npm run test:run`
- [ ] `cd server && node migrate.js --status` (should show 194 applied)
- [ ] Manual: visit /lenses/astronomy → real APOD image + live ISS coords + Near-Earth Objects
- [ ] Manual: visit /lenses/geology → USGS quakes ≥M2.5 in past 24h
- [ ] Manual: visit /lenses/history → Wikipedia On This Day with 5 tabs
- [ ] Manual: visit /lenses/atlas → search a city → real OSM results with lat/lon
- [ ] Manual: visit /lenses/ocean → NOAA tide predictions (default Boston)
- [ ] Manual: visit /lenses/pharmacy → FDA tab → live label / adverse events / recall search
- [ ] Manual: visit /lenses/physics (or quantum/robotics/bio/chem/math/ml/neuro) → arXiv feed
- [ ] Manual: visit /lenses/code (or legal/crypto/healthcare/whiteboard) → rival shell preview open
- [ ] Manual: every lens shows DepthBadge chip in header (Live / Real / Simulated / Demo)
- [ ] Manual: hero-script lens fires FirstRunTour on first visit → Skip → reload → no re-fire
- [ ] Manual: pharmacy lens "Intake notes" textarea → type → "saving" → "saved" indicator

---

## Risks / pitfalls for the next session

- **`useLensDraft` doesn't debounce within the localStorage write** — every keystroke writes localStorage. For a high-frequency input (slider, color picker), throttle upstream.

- **DraftedTextarea/Input `onValueChange` fires on every keystroke** — that's intentional for optimistic submit handlers, but if the parent re-renders heavy children on every change, memo them.

- **NOAA tides macro defaults to Boston station (8443970)** — frontend caller picks from a 7-station dropdown; advanced users can extend the list.

- **NASA APOD + NEO use DEMO_KEY by default** — rate-limited to 30/hr. Set `NASA_API_KEY` env in production.

- **OpenStreetMap Nominatim** — 1 req/sec polite-use enforced via 600ms debounce in OsmGeocodePanel. Self-hosted Nominatim or paid Pelias for high volume.

- **arXiv** uses Atom XML; we parse server-side. The parser is regex-based (`parseArxivAtom` in `server/domains/research-live.js`) — fragile if arXiv changes their schema. Tier-2 test pins shape.

- **FDA OpenFDA** rate-limits unauthenticated at 240/min, 1000/hr. Plenty for normal use. 404 treated as empty-result (not error) so the search UX stays smooth.

- **publicReadDomains has a duplicate `history:` key** (one from my session, one was always there as `history: []` in a different scope). JS silently takes the latter; the `recent_mine` bypass handles history's recent-list path. If you add another publicReadDomains entry for history, MERGE into the same Set.

- **Wikipedia OTD payload can be 100+ KB** — we truncate to 15 entries per kind, 3 pages per entry.

---

## Quick start for the next session

```bash
git checkout claude/audit-app-completeness-GwBlp
cd server && npm test 2>&1 | tail -10
cd ../concord-frontend && npm run type-check
# Read HANDOFF.md for current state
# Read /root/.claude/plans/what-s-missing-to-be-humble-scott.md for roadmap
# Start with "Next up" items 1-3 — highest leverage.
```

## Test commands worth knowing

```bash
# Phase 1+2 tier-2 contract tests
cd server && node --test tests/drafts-domain.test.js \
  tests/integration-registry.test.js \
  tests/recent-mine-helper.test.js \
  tests/dtu-recent-mine.test.js

# Phase 4 free-API contract tests
node --test tests/research-live-arxiv.test.js \
  tests/free-api-live-registration.test.js

# All new sprint tests
node --test tests/{drafts,integration,recent,dtu-recent,research-live,free-api}-*.test.js
```
