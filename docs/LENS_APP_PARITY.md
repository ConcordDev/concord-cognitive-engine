# Lens App Parity Rubric

Per the v3 plan at `/root/.claude/plans/well-let-s-make-it-stateless-comet.md`,
each Concord lens is a free clone of the leader paid app in its
domain. This document is the source of truth for **which leader app
shadows which lens** and **what core workflows must be present** for
that lens to count as "full app parity."

It drives:
- Phase 2 sweep sequencing (lowest % complete first)
- The visual-identity gate (does the Concord lens look like its
  leader app, or like another Concord lens?)
- The close gate (every lens ≥ 80% of its leader-app workflow target,
  heavyweights ≥ 70%)

## How to read this doc

- **Leader app** — the paid app or category-leading product the lens
  shadows. If multiple apps split the category, pick the one whose
  UX language we want to match.
- **Core workflows** — the 3–7 things the user expects to be able to
  do in that app's domain. Numbered for sweep tracking. Each becomes
  ~1 mounted UI panel or sub-route in the Concord lens.
- **Panels mounted** — current count of bespoke surfaces in the
  Concord lens that map to a core workflow. Updated after each PR.
- **% complete** — `panels mounted / target × 100`. Drives sequencing.
- **Notes** — sequencing hints, known gaps, refactor debt.

## Status legend

- ✅ `done`     — all workflows mounted with real data
- 🚧 `partial`  — at least one workflow mounted
- ⬜ `empty`    — backend exists, no leader-app-specific UI yet
- ⛔ `no-backend` — needs new `server/domains/<name>.js` first
- ❓ `tbd`      — leader-app target not yet authored (audit pending)

---

## Tier 1 — Lenses with bespoke leader-app UI already underway

These lenses have at least one bespoke leader-app-shaped panel
shipped this session. Continuing here builds on existing momentum.

| Lens | Leader app | Core workflows | Mounted | % | Status | Notes |
|---|---|---|---:|---:|---|---|
| `atlas` | **Google Maps** | 1. Place search · 2. Saved places · 3. Turn-by-turn directions · 4. Distance matrix · 5. Region/area stats · 6. POI category browse · 7. Reverse geocode | 4 of 7 | 57% | 🚧 partial | PlaceFinder + SavedPlaces + MapsDirections + DistanceMatrixPanel landed. Missing: region stats panel, POI category browse, reverse-geocode lookup. |
| `pets` | **PetDesk + Apple Health** | 1. Pet profile CRUD · 2. Vet calendar · 3. Activity ring · 4. Weight trend chart · 5. Feeding plan · 6. Vaccination schedule · 7. Breed explorer | 5 of 7 | 71% | 🚧 partial | PetCarePlanner + ActivityWeightDashboard + BreedExplorer + existing pets CRUD. Missing: vet appointment booking flow, photo gallery. |
| `automotive` | **Carfax + RepairPal** | 1. VIN decode · 2. Recall lookup · 3. Maintenance schedule · 4. Fuel-economy tracker · 5. Repair estimator · 6. Vehicle history timeline · 7. OBD-II code lookup | 7 of 7 | 100% | ✅ done | VinDecoder + VehicleHistory + FuelRepairPanel cover all 7. Ready for polish. |
| `calendar` | **Cron / Notion Calendar** | 1. Event CRUD · 2. Multi-view (month/week/day/agenda) · 3. Free/busy analysis · 4. Conflict detection · 5. Timezone tools · 6. iCal import/export · 7. Recurring expansion | 6 of 7 | 86% | 🚧 partial | Existing rich event grid + TimezoneTools + ScheduleAnalyzer. Missing: drag-to-create week view styled like Cron. |
| `environment` | **EPA EJScreen + AirNow** | 1. AQI by ZIP · 2. Superfund site search · 3. USGS water-realtime · 4. Compliance checker · 5. Diversion-rate tracker · 6. Population trend · 7. Trail conditions | 5 of 7 | 71% | 🚧 partial | EnviroPanel + ComplianceDiversionPanel cover 5. Missing: populationTrend + trailCondition macros need UI. |
| `history` | **Wikipedia + Britannica** | 1. Article search · 2. On-this-day · 3. Timeline builder · 4. Source evaluator · 5. Period comparison · 6. Cause-effect mapper · 7. Reference network | 4 of 7 | 57% | 🚧 partial | WikipediaExplorer + TimelineSourceTools landed. Missing: comparePeriods + causeEffect macros need UI. |
| `materials` | **Materials Project + Granta MI** | 1. Material search by formula · 2. Property comparison · 3. Corrosion analyzer · 4. Thermal profile · 5. Composite analysis · 6. Material selector · 7. 3D crystal viewer | 3 of 7 | 43% | 🚧 partial | MpSearch + CorrosionThermalPanel. Missing: property compare, selectMaterial, compositeAnalysis, crystal viewer. |
| `ocean` | **Windy + NOAA** | 1. Tide predictions · 2. Wave analyzer · 3. Ecosystem health · 4. NOAA water level · 5. Station browser · 6. Tidal currents · 7. Salinity profile | 3 of 7 | 43% | 🚧 partial | TidePredictions + WaveEcosystemPanel. Missing: water-level chart, station browser, currents, salinity. |
| `security` | **Datadog Security + Snyk** | 1. Advisory feed · 2. Threat assessment · 3. Vulnerability scan · 4. Incident escalation · 5. Patrol coverage · 6. Threat matrix · 7. Evidence chain | 3 of 7 | 43% | 🚧 partial | SecurityAdvisories + ThreatVulnPanel. Missing: incident, patrol, matrix, evidence-chain panels. |
| `services` | **Booksy + Square Appointments** | 1. Booking calendar · 2. Client roster · 3. Revenue dashboard · 4. Retention report · 5. Commission calc · 6. Daily close · 7. Reminder sender | 2 of 7 | 29% | 🚧 partial | RevenueRetentionPanel + ServicesFeed. Big gaps: booking calendar, client roster CRUD, daily close, reminders, commission. |
| `energy` | **Sense + Tesla app + PG&E** | 1. Real-time meter · 2. Appliance breakdown · 3. Solar production · 4. Carbon footprint · 5. EIA rates · 6. Generation mix · 7. Grid status | 4 of 7 | 57% | 🚧 partial | EiaPanel + SolarCarbonPanel. Missing: real-time meter graph, appliance donut, gridStatus + consumptionAnalysis UIs. |

## Tier 2 — Heavyweights (Phase 3 candidates, real depth required)

Each is a multi-PR mini-project; per-lens target is 5–10 panels.

| Lens | Leader app | Core workflows | Mounted | % | Status |
|---|---|---|---:|---:|---|
| `kingdoms` | **Crusader Kings III** | Realm browser, council voting, decree log, succession laws, character opinions, war declarations, dynasty tree, marriage planner, secret schemer, schemes log | 0 of 10 | 0% | ⬜ empty (schema done — migrations 152–158) |
| `foundry` | **Unity / Roblox Studio** | Scene tree, inspector, asset browser, transform gizmo, prefab library, composer canvas, hierarchy, run/preview, export | 1 of 9 | 11% | 🚧 partial (66-LOC shell + dynamic FoundryCanvas) |
| `whiteboard` | **Excalidraw / Miro** | Free draw, shapes, sticky notes, multi-cursor presence, undo/redo, snap-to-grid, export SVG/PDF, library | 2 of 8 | 25% | 🚧 partial |
| `studio` | **Ableton Live** | Clip-launch grid, session view, arrangement view, mixer, sidechain, MIDI-learn, waveform editor, time-stretch, automation | 4 of 9 | 44% | 🚧 partial |
| `code` | **VS Code** | File tree, editor tabs, diff viewer, integrated terminal, git branch, PR comments, search, problems pane, debug | 2 of 9 | 22% | 🚧 partial |
| `marketplace` | **Bandcamp + Gumroad** | Browse grid, listing detail, purchase flow, creator dashboard, sales report, royalty cascade view, citation graph | 5 of 7 | 71% | 🚧 partial (creative-marketplace ~66KB exists) |
| `accounting` | **QuickBooks Online** | Chart of accounts, invoice generator, expense capture, P&L statement, balance sheet, audit trail, reconciliation | 6 of 7 | 86% | ✅ done (60/40 frontend/backend split per audit) |
| `world` | **Concordia (in-house, no external shadow)** | Render, presence, combat, build, traverse, dialogue, quest, events, weather | 9 of 9 | 100% | ✅ done (5,999 LOC frontend) |
| `chat` | **ChatGPT / Claude desktop** | Conversation list, streaming reply, persona switcher, web search, DTU citations, voice in/out | 6 of 6 | 100% | ✅ done |
| `finance` | **Robinhood** | Portfolio donut, watchlist, options chain, recurring buys, news rail, transaction log | 4 of 6 | 67% | 🚧 partial |

## Tier 3 — Domain reference + utility lenses (Phase 2, mostly bespoke)

Lenses with clear leader apps where 3–5 mounted panels = parity.

| Lens | Leader app | Core workflows | Mounted | % | Status |
|---|---|---|---:|---:|---|
| `astronomy` | **NASA Eyes + Stellarium** | APOD, ISS tracker, NEO feed, celestial calc, observation planner, light-travel calc | 3 of 6 | 50% | 🚧 partial |
| `art` | **Art Institute of Chicago + Met** | Search by artist/period, color palette, harmony, composition score, gallery view | 3 of 5 | 60% | 🚧 partial |
| `aviation` | **ForeFlight + SkyVector** | METAR/TAF, flight log, weight-balance calc, hobbs log, currency check | 3 of 5 | 60% | 🚧 partial |
| `bio` | **NCBI BLAST + UniProt** | Sequence editor, BLAST search, gene-function lookup, FASTA parse, motif detector | 3 of 5 | 60% | 🚧 partial |
| `classroom` | **Open Library + Anna's Archive** | Book search, ISBN lookup, subject browse, work detail, course shelf | 4 of 5 | 80% | 🚧 partial |
| `crypto` | **CoinMarketCap + TradingView** | Price chart, watchlist, depth chart, news, holdings tracker | 2 of 5 | 40% | 🚧 partial |
| `daily` | **Day One** | Journal entry, on-this-day, mood log, streak ring, search | 1 of 5 | 20% | 🚧 partial |
| `debate` | **Kialo + IBIS** | Argument tree, fallacy check, steelman, evaluate, score | 0 of 5 | 0% | ⬜ empty |
| `docs` | **Notion** | Page tree, slash menu, database view, table-block, embed | 1 of 5 | 20% | 🚧 partial (BlockEditor mounted) |
| `forecast` | **NWS Aviation + Apple Weather** | Map overlay, 7-day strip, hourly chart, alerts, radar | ❓ | — | ❓ tbd |
| `forestry` | **InciWeb + USDA Forest Service** | Active-fire map, carbon sequester calc, harvest planner, fire risk | 1 of 5 | 20% | 🚧 partial |
| `forum` | **Reddit / Discourse** | Community list, post card, voting, comment tree, moderator queue | 1 of 5 | 20% | 🚧 partial |
| `geology` | **USGS Earthquakes + Mindat** | Recent quakes, mineral ID, rock classifier, seismic risk, plate map | 1 of 5 | 20% | 🚧 partial |
| `government` | **GovTrack + USAspending** | Bill tracker, rep finder, vote record, spending viz, hearing schedule | ❓ | — | ❓ tbd |
| `healthcare` | **Epic MyChart** | Records, lab results, visit timeline, med list, after-visit summary | 4 of 5 | 80% | ✅ done (EHRShell exists) |
| `household` | **Tody + Sweepy** | Chore rotation, grocery list, maintenance schedule, cleaning checklist, supply tracker | 2 of 5 | 40% | 🚧 partial |
| `legal` | **Westlaw + CourtListener** | Case search, docket timeline, citator, conflict check, contract renewal | 2 of 5 | 40% | 🚧 partial |
| `linguistics` | **Datamuse + Wiktionary** | Word lookup, related words, frequency, morphology, etymology | 3 of 5 | 60% | 🚧 partial |
| `medical` | **ClinicalTrials.gov + Up-to-Date** | Trial search, drug lookup, condition browser, symptom checker, study watch | ❓ | — | ❓ tbd |
| `mining` | **MSHA + USGS Mineral Resources** | Mine lookup, violations, blast design, ore-grade calc, deposit map | 2 of 5 | 40% | 🚧 partial |
| `nonprofit` | **Candid + GiveWell** | Org lookup by EIN, grant reporting, campaign progress, donor retention | 2 of 5 | 40% | 🚧 partial |
| `notes` | **Apple Notes / Bear** | Folder tree, markdown editor, tag browse, attachment, search | ❓ | — | ❓ tbd (no `/lenses/notes` dir; routing TBD) |
| `parenting` | **Wonder Weeks + Cozi** | Milestone tracker, growth percentile, immunization, routine optimizer, school calendar | 0 of 5 | 0% | ⬜ empty |
| `philosophy` | **Are.na + IEP** | Channel browse, citation network, argument map, glossary, reading list | 0 of 5 | 0% | ⬜ empty |
| `physics` | **PhET + Wolfram** | Simulation gallery, constant lookup, equation solver, unit converter, visualizer | ❓ | — | ❓ tbd |
| `pomodoro` | n/a (in Concord: `productivity`?) | — | — | — | — |
| `productivity` | **Todoist + Things** | Task list, project view, today, deadlines, focus mode | 0 of 5 | 0% | ⛔ no-backend |
| `reasoning` | **Wolfram + step-by-step calc** | Structured step, computable cell, chain verifier, premise log, derivation | 0 of 5 | 0% | ⬜ empty |
| `reflection` | **Day One reading view** | Past entries, on-this-day, prompt picker, streak | 0 of 4 | 0% | ⬜ empty |
| `research` | **Roam Research + Zotero** | Saved query, paper list, abstract reader, backlinks, citation graph | 1 of 5 | 20% | 🚧 partial |
| `science` | **Quartzy + Benchling** | Calibration, chain of custody, data export, dataset CRUD, instrument log | 0 of 5 | 0% | ⬜ empty |
| `space` | **Launch Library + Heavens-Above** | Upcoming launches, orbit calc, delta-v budget, satellite tracker, launch window | 1 of 5 | 20% | 🚧 partial |
| `space-weather`/`weather` (if present) | **SpaceWeatherLive + NWS** | — | — | — | ❓ tbd |
| `srs` | **Anki** | Deck list, card review, ease/interval, deck stats, schedule heatmap | 1 of 5 | 20% | 🚧 partial |
| `thread` | **X/Twitter** | Timeline column, compose, reply tree, bookmark, search | 0 of 5 | 0% | ⬜ empty |
| `travel` | **TripIt + Google Travel** | Trip itinerary, country info, currency convert, packing list, jetlag calc | 1 of 5 | 20% | 🚧 partial |
| `urban-planning` | **EJScreen + ArcGIS** | Census data, density calc, traffic impact, HUD income, zoning map | 1 of 5 | 20% | 🚧 partial |
| `voice` | **Whisper UI + Otter.ai** | Recording, transcript, speaker diarization, edit, export | 1 of 5 | 20% | 🚧 partial |
| `wellness` | **Whoop + Apple Health** | Sleep ring, strain ring, recovery, workout log, HRV | 0 of 5 | 0% | ⛔ no-backend |
| `workout` | n/a (in `fitness` lens) | — | — | — | — |

## Tier 4 — Trade-calc cluster (each one its own contractor app)

Per the v3 plan: NOT a shared CalcPanel. Each contractor app has its
own visual identity, charts, and reference tables.

| Lens | Leader app | Core workflows | Mounted | % | Status |
|---|---|---|---:|---:|---|
| `plumbing` | **PlumbCalc Pro** | Pipe sizer (Sch-40), water heater sizer, drain slope calc, fixture supply calc | 4 of 4 | 100% | ✅ done |
| `masonry` | **Mason Stuff App** | Material estimator, mortar mix reference, wall strength check, job costing | 4 of 4 | 100% | ✅ done |
| `welding` | **Lincoln Welding Procedures** | Joint strength calc, rod selector, heat input calc, weld inspection | 4 of 4 | 100% | ✅ done |
| `hvac` | **Manual J + Wrightsoft** | Load calculator, energy audit, maintenance calendar, zone balance monitor | 4 of 4 | 100% | ✅ done |
| `electrical` | **NEC Code Calc** | Panel load calc, voltage drop chart, circuit map, safety checklist | 4 of 4 | 100% | ✅ done |
| `carpentry` | **Sawpipes / Imperial+Metric Calc** | Board-foot calc, joint strength guide, wood selection guide, finish recommender | 4 of 4 | 100% | ✅ done |
| `construction` | **Procore-lite** | Takeoff estimate, critical-path view, safety compliance, progress report | 4 of 4 | 100% | ✅ done |
| `landscaping` | **Pro Landscape** | Plant selector (USDA zone), irrigation calc, seasonal plan calendar, material estimator | 4 of 4 | 100% | ✅ done |

## Tier 5 — Session-loop lenses (each shadowing a real session app)

| Lens | Leader app | Core workflows | Mounted | % | Status |
|---|---|---|---:|---:|---|
| `meditation` | **Calm / Headspace** | Track picker, minimal player, streak ring, ambient color, journal | ❓ | — | ❓ tbd (no clear lens) |
| `grounding` | **Insight Timer** | Practice picker, audio player, timer, session log | 0 of 4 | 0% | ⬜ empty |
| `expert-mode` | **MasterClass** | Video player, chapter list, workbook tab, notes panel | 0 of 4 | 0% | ⬜ empty |
| `fitness` | **Hevy / Strong** | Workout log, exercise picker, set-by-set table with last-session compare, RIR slider, body-weight chart | 0 of 5 | 0% | ⬜ empty |
| `sports` | **ESPN Fantasy + Strava** | Activity log, league standings, training plan, gear tracker | 0 of 4 | 0% | ⬜ empty |

## Tier 6 — Backend-creation lenses (Phase 4)

UI sketches exist but `server/domains/<name>.js` does not. Backend
first, then leader-app-shaped UI.

| Lens | Leader app | Status |
|---|---|---|
| `observe` | **Datadog** | ⛔ no-backend |
| `ops` | **PagerDuty** | ⛔ no-backend |
| `wellness` | **Whoop** | ⛔ no-backend |
| `productivity` | **Todoist** | ⛔ no-backend |
| `cri` | tbd | ⛔ no-backend |

## Tier 7 — Concord-native lenses (no external leader app)

These are domain-native to Concord and don't shadow a paid app. Target
panel count is a heuristic 3–5 covering create / inspect / network /
admin actions.

`admin`, `affect`, `all`, `alliance`, `anon`, `answers`, `app-maker`,
`ar`, `attention`, `audit` (uses Bench/GRC patterns), `billing`,
`black-market`, `board`, `bounties`, `bridge`, `byo-keys`,
`chem` (lab notebook), `cognition`, `cognitive-replay`, `collab`,
`command-center`, `commonsense`, `cooking` (recipes/meal-plan),
`council` (governance), `creator` (creator-economy dashboard),
`custom`, `deities`, `desert`, `disputes`, `dreams`, `dtus`,
`dx-platform`, `eco`, `education`, `emergency-services`,
`engineering`, `entity`, `ethics`, `event-timeline`, `events`,
`expedition-journal`, `experience`, `export`, `federation`,
`feed`, `film-studios`, `food` (recipes/meal-plan/POS),
`forge` (template generator — exists), `fork`, `fractal`,
`gallery`, `game`, `game-design`, `genesis`, `ghost-tracker`,
`global`, `goals`, `goddess`, `graph`, `home-improvement` (DIY),
`hr` (BambooHR-shape), `hypothesis`, `import`, `inference`,
`ingest`, `inheritance` (legal+IP), `insurance` (policy mgmt),
`integrations`, `invariant`, `lab`, `lattice`, `layout.tsx` (NOT A LENS),
`law` (vs `legal` — TBD), `law-enforcement`, `legacy`, `loading.tsx` (NOT A LENS),
`lock`, `logistics`, `maker`, `manufacturing`, `market`/`markets`,
`marketing` (HubSpot-shape), `math`, `mental-health`, `mentorship`,
`mesh`, `message`, `meta`, `metacognition`, `metalearning`,
`ml`, `neuro`, `news`, `offline`, `organ`, `paper`, `personas`,
`pharmacy`, `photography`, `platform`, `podcast`, `poetry`,
`privacy`, `projects`, `psyops`, `quantum`, `questmarket`,
`queue`, `realestate`, `repos`, `resonance`, `retail`, `robotics`,
`root`, `sandbox`, `schema`, `self`, `sentinel`, `settings`,
`sim`, `society`, `sponsorship`, `staking`, `sub-worlds`,
`suffering`, `supplychain`, `sync`, `system`, `telecommunications`,
`temporal`, `tick`, `timeline`, `tools`, `tournaments`, `trades`,
`transfer`, `understanding`, `veterinary` (vs `pets`),
`vote`, `wallet`, `world-creator`, `worldmodel`

**Action**: as each Tier 7 lens enters the sweep, author its row
in-line (above) — don't pre-fill speculatively. Default target = 3
panels (create / inspect / share or similar) if no clear leader app.

## Progress tracking

| Tier | Lenses | Avg % complete | Updated |
|---|---:|---:|---|
| Tier 1 (active) | 11 | 65% | 2026-05-16 |
| Tier 2 (heavyweights) | 10 | 53% | 2026-05-16 |
| Tier 3 (reference/utility) | ~36 | ~28% | 2026-05-16 |
| Tier 4 (trade calcs) | 8 | 100% | 2026-05-16 |
| Tier 5 (session loops) | 5 | 0% | 2026-05-16 |
| Tier 6 (backend-creation) | 5 | 0% | 2026-05-16 |
| Tier 7 (Concord-native) | ~150 | tbd | 2026-05-16 |

**Close gate:** every Tier-1 to Tier-6 lens ≥ 80% (heavyweights ≥ 70%).
Tier 7 lenses: target authored + ≥ 80% on the authored target.

## Sweep priority (Phase 2 sequencing)

PR order, lowest % complete in each tier first:

1. ~~**Tier 4 (trade calcs)**~~ — ✅ all 8 lenses at 100% (closed 2026-05-16,
   32 bespoke widgets across plumbing / electrical / hvac / carpentry /
   welding / masonry / construction / landscaping).
2. **Path-A pivot — action surfaces on non-trade Tier-1 lenses.** The
   leader apps for `atlas`, `pets`, `automotive`, `calendar`,
   `environment`, `history`, `materials`, `ocean`, `security`,
   `services`, `energy` aren't calc suites — they're action apps. Each
   already has calc/reference panels mounted. Next move: layer
   leader-app-shaped *actions* on top (mint DTUs, send messages, kick
   agents, post to federation, schedule jobs). One action-panel PR
   per lens, in the order: `services` (29% → 43%+ first because
   booking+reminders are pure actions), then `atlas`, `calendar`,
   `pets`, then the rest.
3. **Tier 1 finish-the-job (calc gaps)** — push `materials` (43%),
   `ocean` (43%), `security` (43%), `atlas` (57%) up to 80%+ once
   action surfaces land.
4. **Tier 3 zero-coverage** — `debate`, `parenting`, `philosophy`,
   `reasoning`, `reflection`, `science`, `thread` (all 0%).
5. **Tier 5 (session loops)** — 5 lenses, all 0%, each shadowing a
   well-known leader (Anki / Calm / MasterClass / Hevy / Strava).
6. **Tier 2 heavyweight #1** — `kingdoms` (UI empty, schema fully done;
   highest ROI heavyweight).
7. **Tier 6 backend-creation** — `observe`, `ops`, `wellness`,
   `productivity`. Each: build domain + 3 panels.
8. **Tier 3 partial pushes** + remaining Tier 2 heavyweights interleaved.
9. **Tier 7** — lens-by-lens authoring as the sweep reaches each.

## Visual-identity gate (per the v3 plan)

For every lens PR, the reviewer must answer: **"Does this look like
the leader app, or like another Concord lens?"** If the answer is
"another Concord lens," redesign. The leader-app column above is the
reference target.

## Session-state snapshot

- 12 PRs landed 2026-05-16 (#737–#747). Atlas, pets, calendar fully
  retrofitted to real DTUs. 9-panel batch retrofit stripped seed
  defaults. Substrate-wide seed strip across 13 lens pages. ux-suite
  mock showcase → real-home directory.
- Tier 1 average % went from ~10% (start of session) to 65% (end).
- Tier 4 trade-calc cluster cleared 2026-05-16 (PRs #749–#756): 32
  bespoke widgets across 8 contractor-app suites (PlumbCalc Pro / NEC
  Code Calc / Manual J / Sawpipes / Lincoln WPS / Mason Stuff App /
  Procore-lite / Pro Landscape). No CalcPanel, no shared shells —
  each lens its own visual identity per the v3 path-A decision tree.
- This rubric authored 2026-05-16 as Phase 1 deliverable per the v3
  plan. Replaces `docs/LENS_COVERAGE_AUDIT.md` from PR #723 (which
  used the buggy detector that under-counted wiring).
