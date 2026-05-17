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
| `atlas` | **Google Maps** | 1. Place search · 2. Saved places · 3. Turn-by-turn directions · 4. Distance matrix · 5. Region/area stats · 6. POI category browse · 7. Reverse geocode · 8. Share / act sheet (DM, research, publish, guide, embed) | 6 of 8 | 75% | 🚧 partial | PlaceFinder + SavedPlaces + MapsDirections + DistanceMatrixPanel + PlaceShareSheet landed. POI category browse exists inside PlaceFinder; region stats remaining gap. |
| `pets` | **PetDesk + Apple Health** | 1. Pet profile CRUD · 2. Vet calendar · 3. Activity ring · 4. Weight trend chart · 5. Feeding plan · 6. Vaccination schedule · 7. Breed explorer · 8. Vet action drawer (book / record / refill / emergency / lost-found / walk) | 7 of 8 | 88% | ✅ done | PetCarePlanner + ActivityWeightDashboard + BreedExplorer + existing pets CRUD + PetActionDrawer with 6 real-backend actions. Photo gallery remaining polish. |
| `automotive` | **Carfax + RepairPal** | 1. VIN decode · 2. Recall lookup · 3. Maintenance schedule · 4. Fuel-economy tracker · 5. Repair estimator · 6. Vehicle history timeline · 7. OBD-II code lookup | 7 of 7 | 100% | ✅ done | VinDecoder + VehicleHistory + FuelRepairPanel cover all 7. Ready for polish. |
| `calendar` | **Cron / Notion Calendar** | 1. Event CRUD · 2. Multi-view (month/week/day/agenda) · 3. Free/busy analysis · 4. Conflict detection · 5. Timezone tools · 6. iCal import/export · 7. Recurring expansion · 8. Event action rail (mint / publish / invite / remind / agent-prep / conflicts / export) | 8 of 8 | 100% | ✅ done | Existing rich event grid + TimezoneTools + ScheduleAnalyzer + EventActionRail with 7 real-backend actions inside the event modal. |
| `environment` | **EPA EJScreen + AirNow** | 1. AQI by ZIP · 2. Superfund site search · 3. USGS water-realtime · 4. Compliance checker · 5. Diversion-rate tracker · 6. Population trend · 7. Trail conditions · 8. AirNow action stack (mint / DM alert / publish / agent / CSV) | 6 of 8 | 75% | 🚧 partial | EnviroPanel + ComplianceDiversionPanel + AirQualityActionStack. populationTrend + trailCondition remain. |
| `history` | **Wikipedia + Britannica** | 1. Article search · 2. On-this-day · 3. Timeline builder · 4. Source evaluator · 5. Period comparison · 6. Cause-effect mapper · 7. Reference network · 8. Article action panel (cite / DM / study-guide / publish / connect) | 5 of 8 | 63% | 🚧 partial | WikipediaExplorer + TimelineSourceTools + HistoryArticleActions tab-stack inside the article sidebar. comparePeriods + causeEffect remain. |
| `materials` | **Materials Project + Granta MI** | 1. Material search by formula · 2. Property comparison · 3. Corrosion analyzer · 4. Thermal profile · 5. Composite analysis · 6. Material selector · 7. 3D crystal viewer · 8. Material action sheet (spec / quote / compare / publish / engineering agent) | 5 of 8 | 63% | 🚧 partial | MpSearch + CorrosionThermalPanel + MaterialActionMenu. Compare-side-by-side wired through the action sheet using materials.mp-material. selectMaterial UI + crystal viewer remain. |
| `ocean` | **Windy + NOAA** | 1. Tide predictions · 2. Wave analyzer · 3. Ecosystem health · 4. NOAA water level · 5. Station browser · 6. Tidal currents · 7. Salinity profile · 8. Tide action stack (mint / DM brief / publish / agent window / CSV) | 4 of 8 | 50% | 🚧 partial | TidePredictions + WaveEcosystemPanel + TideActionStack. water-level chart + station browser + currents + salinity remain. |
| `security` | **Datadog Security + Snyk** | 1. Advisory feed · 2. Threat assessment · 3. Vulnerability scan · 4. Incident escalation · 5. Patrol coverage · 6. Threat matrix · 7. Evidence chain · 8. Advisory action sheet (incident / escalate / patch plan / post-mortem / exposure agent) | 4 of 8 | 50% | 🚧 partial | SecurityAdvisories + ThreatVulnPanel + AdvisoryActionMenu. Patrol + threat-matrix + evidence-chain UIs remain. |
| `services` | **Booksy + Square Appointments** | 1. Booking calendar · 2. Client roster · 3. Revenue dashboard · 4. Retention report · 5. Commission calc · 6. Daily close · 7. Reminder sender · 8. Booking action dock (confirm / remind / complete / no-show / invoice / rebook) · 9. End-of-day close modal | 6 of 9 | 67% | 🚧 partial | RevenueRetentionPanel + ServicesFeed + BookingActionDock + EndOfDayClose. Booking-actions, reminders, daily-close, invoice all wired through real DM + DTU paths. Client roster CRUD + Cron-shape booking calendar remaining. |
| `energy` | **Sense + Tesla app + PG&E** | 1. Real-time meter · 2. Appliance breakdown · 3. Solar production · 4. Carbon footprint · 5. EIA rates · 6. Generation mix · 7. Grid status · 8. EIA action stack (mint / DM household / publish / agent / CSV) | 5 of 8 | 63% | 🚧 partial | EiaPanel + SolarCarbonPanel + EnergyActionStack. Real-time meter graph + appliance donut + gridStatus UI remain. |

## Tier 2 — Heavyweights (Phase 3 candidates, real depth required)

Each is a multi-PR mini-project; per-lens target is 5–10 panels.

| Lens | Leader app | Core workflows | Mounted | % | Status |
|---|---|---|---:|---:|---|
| `kingdoms` | **Crusader Kings III** | Realm browser, council voting, decree log, succession laws, character opinions, war declarations, dynasty tree, marriage planner, secret schemer, schemes log + realm command panel | 5 of 11 | 45% | 🚧 partial — schema done (migrations 152–158); RealmActionPanel surfaces 7 macros (list / my_realm / decree / loyalty / 3 takeover paths) + mint/DM/publish/agent. Dynasty tree + character opinions + schemes log remain. |
| `foundry` | **Unity / Roblox Studio** | Scene tree, inspector, asset browser, transform gizmo, prefab library, composer canvas, hierarchy, run/preview, export, foundry workbench | 6 of 10 | 60% | 🚧 partial — 66-LOC shell + FoundryCanvas + FoundryActionPanel (list/create/validate/preview/foundry-publish + mint/DM/public-DTU/next-edits-agent). Scene tree + inspector + transform gizmo remain. |
| `whiteboard` | **Excalidraw / Miro** | Free draw, shapes, sticky notes, multi-cursor presence, undo/redo, snap-to-grid, export SVG/PDF, library + session workbench | 5 of 9 | 56% | 🚧 partial — WhiteboardActionPanel (template-load / save / vote / share + mint/DM/publish/retro-agent). Native canvas + multi-cursor + free-draw remain. |
| `studio` | **Ableton Live** | Clip-launch grid, session view, arrangement view, mixer, sidechain, MIDI-learn, waveform editor, time-stretch, automation, session workbench | 5 of 10 | 50% | 🚧 partial — existing AudioEditor/AutomationView/MasteringPanel/StudioWorkbench + StudioActionPanel (project/track/effect/render/timeline + actions). Arrangement view + sidechain + MIDI-learn remain. |
| `code` | **VS Code** | File tree, editor tabs, diff viewer, integrated terminal, git branch, PR comments, search, problems pane, debug + code review panel | 5 of 10 | 50% | 🚧 partial — CodeActionPanel (complexity / deps / coverage / snapshot / snippet + mint/DM/publish-gist/refactor-agent). Diff viewer + integrated terminal + git surfaces remain. |
| `marketplace` | **Bandcamp + Gumroad** | Browse grid, listing detail, purchase flow, creator dashboard, sales report, royalty cascade view, citation graph + listing workbench | 7 of 8 | 88% | ✅ done — creative-marketplace ~66KB + MarketplaceActionPanel (score/price/metrics + mint/DM/go-live/copy-agent). Citation graph remains. |
| `accounting` | **QuickBooks Online** | Chart of accounts, invoice generator, expense capture, P&L statement, balance sheet, audit trail, reconciliation | 6 of 7 | 86% | ✅ done (60/40 frontend/backend split per audit) |
| `world` | **Concordia (in-house, no external shadow)** | Render, presence, combat, build, traverse, dialogue, quest, events, weather | 9 of 9 | 100% | ✅ done (5,999 LOC frontend) |
| `chat` | **ChatGPT / Claude desktop** | Conversation list, streaming reply, persona switcher, web search, DTU citations, voice in/out | 6 of 6 | 100% | ✅ done |
| `finance` | **Robinhood + YNAB** | Portfolio donut, watchlist, options chain, recurring buys, news rail, transaction log + money workbench | 5 of 7 | 71% | ✅ done — MarketsPulse + FinanceActionPanel (net-worth / envelopes / tax / retirement-MC / subs + mint/DM/publish/top-move-agent). Options chain remains. |

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
| `debate` | **Kialo + IBIS** | Argument tree, fallacy check, steelman, evaluate, score, branch-via-DTU, publish review | 4 of 7 | 57% | 🚧 partial — DebateActionPanel surfaces all 4 debate macros (fallacy, steelman, score, evaluate) + branch + snapshot + publish. Standalone Kialo-tree visualizer remains. |
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
| `parenting` | **Wonder Weeks + Cozi** | Milestone tracker, growth percentile, immunization, routine optimizer, school calendar, journey publish, agent brief | 4 of 7 | 57% | 🚧 partial — ChildBriefPanel surfaces milestoneCheck + routineOptimizer + mint + DM + publish (anonymized) + agent. Immunization tracker + school calendar remain. |
| `philosophy` | **Are.na + IEP** | Channel browse, citation network, argument map, glossary, reading list, dialectic synthesis, ethics 6-pack | 4 of 7 | 57% | 🚧 partial — DilemmaPanel surfaces all 4 philosophy macros (argumentMap, thoughtExperiment, dialecticSynthesis, ethicalFramework) + mint + DM + publish + agent. Reading list browser remains. |
| `physics` | **PhET + Wolfram** | Simulation gallery, constant lookup, equation solver, unit converter, visualizer | ❓ | — | ❓ tbd |
| `pomodoro` | n/a (in Concord: `productivity`?) | — | — | — | — |
| `productivity` | **Todoist + Things** | Task list, project view, today, deadlines, focus mode | 0 of 5 | 0% | ⛔ no-backend |
| `reasoning` | **Wolfram + step-by-step calc** | Structured step, computable cell, chain verifier, premise log, derivation, validate, cross-check | 5 of 7 | 71% | 🚧 partial — ArgumentWorkbench surfaces all 4 reasoning macros (logicValidate, argumentMap, fallacyDetect, premiseExtract) + mint + DM + publish + agent cross-check. Step-by-step interactive cell remains. |
| `reflection` | **Day One reading view** | Past entries, on-this-day, prompt picker, streak, insights extract, growth metrics, habit tracking | 5 of 7 | 71% | 🚧 partial — JournalActionPanel composer + 3 reflection macros + agent prompt picker + mint + DM + publish. Past-entry browser via existing ReflectionFeed; on-this-day remains. |
| `research` | **Roam Research + Zotero** | Saved query, paper list, abstract reader, backlinks, citation graph | 1 of 5 | 20% | 🚧 partial |
| `science` | **Quartzy + Benchling** | Calibration, chain of custody, data export, dataset CRUD, instrument log, protocol validate, replication agent | 5 of 7 | 71% | 🚧 partial — ExperimentActionPanel surfaces 4 science macros (calibration, validate, dataQuality, custody) + mint + DM + publish + replication agent. Instrument log + dataset CRUD remain. |
| `space` | **Launch Library + Heavens-Above** | Upcoming launches, orbit calc, delta-v budget, satellite tracker, launch window | 1 of 5 | 20% | 🚧 partial |
| `space-weather`/`weather` (if present) | **SpaceWeatherLive + NWS** | — | — | — | ❓ tbd |
| `srs` | **Anki** | Deck list, card review, ease/interval, deck stats, schedule heatmap | 1 of 5 | 20% | 🚧 partial |
| `thread` | **X/Twitter** | Timeline column, compose, reply tree, bookmark, search, node pin/branch, agent synthesize | 3 of 7 | 43% | 🚧 partial — ThreadNodeActions surfaces 5 per-node actions (pin / branch / DM / publish / agent synthesize). Timeline column + dedicated compose flow + reply-tree visual remain. |
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
| `grounding` | **fact-check workbench** (rubric mis-typed as Insight Timer; actual lens is epistemic grounding) | Fact check, source credibility, decompose, mint, DM, publish, counter-evidence agent | 6 of 7 | 86% | ✅ done — ClaimVerificationPanel surfaces all 3 grounding macros plus the mint/DM/publish/agent quartet. |
| `expert-mode` | **MasterClass** | Video player, chapter list, workbook tab, notes panel | 0 of 4 | 0% | ⬜ empty |
| `fitness` | **Hevy / Strong** | Workout log, exercise picker, set-by-set table with last-session compare, RIR slider, body-weight chart, progression calc, PR publish | 6 of 7 | 86% | ✅ done — WorkoutLogger + ActivityRings + HeartRateZones + SleepRecovery + WorkoutPlanner + WorkoutFinishPanel (7-action surface with progression / save / mint / DM / PR publish / next-workout agent). |
| `sports` | **ESPN Fantasy + Strava** | Activity log, league standings, training plan, gear tracker, injury risk, race report publish | 5 of 6 | 83% | ✅ done — ActivityActionPanel surfaces 4 sports macros (performanceStats, trainingPlan, injuryRisk, teamAnalysis) + mint + DM + publish + race-plan agent. |

## Tier 6 — Backend-creation lenses (Phase 4)

UI sketches exist but `server/domains/<name>.js` does not. Backend
first, then leader-app-shaped UI.

| Lens | Leader app | Status |
|---|---|---|
| `observe` | **Datadog** | ✅ done — domain (serviceLog / incidentTrack / alertSummary / sloCheck) + ObserveActionPanel (8 actions). Live-tested. |
| `ops` | **PagerDuty** | ✅ done — domain (pageOnCall / runbookLookup / postmortemDraft / escalationCheck) + OpsActionPanel (8 actions). Live-tested. |
| `wellness` | **Whoop** | ✅ done — domain (sleepScore / strainLog / recoveryReport / hrvTrend) + WellnessActionPanel (8 actions). Live-tested. |
| `productivity` | **Todoist** | ✅ done — domain (taskCreate / projectFilter / focusBlock / dailySummary) + ProductivityActionPanel (8 actions). Live-tested. |
| `cri` | crisis-response info | 🚧 partial — existing 3 macros + page; no bespoke action panel yet. |

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

### Tier 7 authored sweep (current session)

The action-panel pattern shipped per Tier-7 lens is uniform: 4 lens-
specific macros + the universal mint / DM / publish / agent quartet =
8 buttons, paired with bespoke result tiles and a trailing agent-reply
panel. Every panel surfaces real domain backends — zero seed/mock
data, all server macros via `apiHelpers.lens.runDomain`.

| Lens | Panel | Surfaced macros | Status |
|---|---|---|---|
| nonprofit | NonprofitActionPanel | donorRetention · grantReporting · campaignProgress · search-orgs | ✅ shipped |
| insurance | InsuranceActionPanel | coverageGap · lossRatioReport · renewalAlert · riskScore | ✅ shipped |
| linguistics | LinguisticsActionPanel | dictionary-lookup (Free Dictionary) · datamuse-words · textAnalysis · sentimentAnalysis | ✅ shipped |
| chem | ChemActionPanel | molecular-weight · calc-molarity · calc-ph · calc-dilution | ✅ shipped |
| bio | BioActionPanel | sequence-analyze · primer-design · align-pairwise · restriction-map | ✅ shipped |
| physics | PhysicsActionPanel | kinematics-1d · projectile · convert-units · constants | ✅ shipped |
| neuro | NeuroActionPanel | frequencyAnalysis (FFT) · connectivityAnalysis · erpAnalysis · sim-signal | ✅ shipped |
| ml | MlActionPanel | modelEvaluate · featureImportance · datasetProfile · hyperparameterSuggest | ✅ shipped |
| robotics | RoboticsActionPanel | kinematicsCalc · pathPlan · sensorFusion · batteryLife | ✅ shipped |
| aviation | AviationActionPanel | airport-lookup (FAA) · weather-metar · perf-takeoff · perf-landing | ✅ shipped |
| pharmacy | PharmacyActionPanel | drug-label (OpenFDA) · drugInteractionCheck · adverse-events (FAERS) · dosageCalculator | ✅ shipped |
| mental-health | MentalHealthActionPanel | crisis-hotlines · cdc-mental-health-stats · moodTracker · journalPrompt | ✅ shipped |
| photography | PhotographyActionPanel | exposureCalc · compositionAnalysis · gearRecommend · printSize | ✅ shipped |
| voice | VoiceActionPanel | transcriptAnalyze · speakerDiarize · sentimentScore · keywordSpot | ✅ shipped |
| supplychain | SupplyChainActionPanel | leadTimeAnalysis · inventoryOptimize · supplierScore · demandForecast | ✅ shipped |
| manufacturing | ManufacturingActionPanel | oeeCalculate · bomCost · safetyRate · scheduleOptimize | ✅ shipped |
| telecommunications | TelecommunicationsActionPanel | networkCapacity · signalQuality · coverageMap · costPerLine | ✅ shipped |
| retail | RetailActionPanel | reorderCheck · pipelineValue · customerLTV · slaStatus | ✅ shipped |
| healthcare | HealthcareActionPanel | symptom-triage · providers-search (CMS NPI) · medications-list · rx-price-compare | ✅ shipped |
| agriculture | AgricultureActionPanel | weather-for-field (open-meteo) · rotationPlan · waterSchedule · predict-yield | ✅ shipped |
| astronomy | AstronomyActionPanel | apod · iss-current-location · near-earth-objects · celestialPosition | ✅ shipped |
| automotive | AutomotiveActionPanel | vin-decode (NHTSA vPIC) · recall-lookup (NHTSA) · maintenanceSchedule · diagnosticLookup | ✅ shipped |
| calendar | CalendarActionPanel | detectConflicts · findAvailability · scheduleOptimize · ical-export | ✅ shipped |
| analytics | AnalyticsActionPanel | funnelAnalysis · cohortAnalysis · detectAnomalies · trendForecast | ✅ shipped |
| classroom | ClassroomActionPanel | ol-search · ol-subject · ol-work · ol-isbn (Open Library) | ✅ shipped |
| defense | DefenseActionPanel | threatAssessment · readinessScore · incidentResponse · usaspending-dod-contracts | ✅ shipped |
| emergency-services | EmergencyServicesActionPanel | triageAssess (START) · dispatchOptimize · incidentLog · resourceReadiness | ✅ shipped |
| law-enforcement | LawEnforcementActionPanel | caseAnalysis · patrolOptimize · incidentReport · crimeStats | ✅ shipped |
| construction | ConstructionActionPanel | takeoffEstimate · criticalPath · safetyCompliance · progressReport | ✅ shipped |
| engineering | EngineeringActionPanel | toleranceAnalysis · stressAnalysis · bom · unitConvert | ✅ shipped |
| audit | AuditActionPanel | complianceCheck · trailAnalysis · riskScore · samplingPlan | ✅ shipped |
| marketing | MarketingActionPanel | campaignROI · abTestAnalysis · funnelOptimize · audienceSegment | ✅ shipped |
| education | EducationActionPanel | gradeCalculation · progressTrack · lesson-plan-generate · quiz-from-text | ✅ shipped |
| forum | ForumActionPanel | threadAnalysis · moderationQueue · communityHealth · topicClustering | ✅ shipped |
| mentorship | MentorshipActionPanel | matchScore · progressTrack · feedbackSummary · developmentPlan | ✅ shipped |
| society | SocietyActionPanel | wb-indicator · wb-country · wb-compare · wb-common-indicators | ✅ shipped |
| creative | CreativeActionPanel | shotListGenerate · assetOrganize · budgetTrack · distributionChecklist | ✅ shipped |
| accounting | AccountingActionPanel | trialBalance · profitLoss · invoiceAging · budgetVariance | ✅ shipped |
| atlas | AtlasActionPanel | nominatim-geocode · nominatim-reverse · overpass-poi · distanceMatrix | ✅ shipped |
| commonsense | CommonsenseActionPanel | conceptnet-edges · conceptnet-relatedness · plausibilityCheck · analogyMapping | ✅ shipped |
| collab | CollabActionPanel | sessionAnalytics (Gini) · contributionScore · detectConsensus · balanceWorkload | ✅ shipped |
| cooking | CookingActionPanel | usda-search (FoodData Central) · scaleRecipe · nutritionEstimate · substitution | ✅ shipped |
| (plus the Tier-1/Tier-3/Tier-5/Tier-6 panels shipped earlier in the session — see git log on `claude/ship-trade-ui-widgets-hLpjG` for the full chain.) | | | |

## Progress tracking

| Tier | Lenses | Avg % complete | Updated |
|---|---:|---:|---|
| Tier 1 (active) | 11 | 72% | 2026-05-16 |
| Tier 2 (heavyweights) | 10 | ~71% | 2026-05-16 |
| Tier 3 (reference/utility) | ~36 | ~38% | 2026-05-16 |
| Tier 4 (trade calcs) | 8 | 100% | 2026-05-16 |
| Tier 5 (session loops) | 5 | ~80% | 2026-05-16 |
| Tier 6 (backend-creation) | 5 | ~80% | 2026-05-16 |
| Tier 7 (Concord-native) | ~150 | ~42% authored (≥80% each) | 2026-05-17 |

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
- **Action-surface pivot landed 2026-05-16** (8 commits, this session):
  every sub-100% Tier-1 lens now ships a bespoke leader-app-shaped
  action surface that DOES things (mints DTUs, sends DMs, publishes
  to federation, kicks agents, schedules jobs) on top of its existing
  compute panels — the v3 path-A action-app classification. All
  side-effects wire already-built backends; no new server code.
  Lift by lens:
  - calendar     86 → 100% (EventActionRail, 7 actions inside modal)
  - services     29 →  67% (BookingActionDock 6 + EndOfDayClose 4)
  - atlas        57 →  75% (PlaceShareSheet 5-pane modal)
  - pets         71 →  88% (PetActionDrawer 6-action right drawer)
  - history      57 →  63% (HistoryArticleActions 5-pane sidebar)
  - environment  71 →  75% (AirQualityActionStack 5 over live AirNow)
  - materials    43 →  63% (MaterialActionMenu 5-pane modal)
  - security     43 →  50% (AdvisoryActionMenu 5-pane modal)
  - ocean        43 →  50% (TideActionStack 5 over live NOAA tides)
  - energy       57 →  63% (EnergyActionStack 5 over live EIA rates)
  Tier 1 avg 65 → 72%. Pattern is now established and reusable for
  every other lens with an existing leader-app data fetch.
- **Tier-3 zero-coverage cohort cleared 2026-05-16** (4 commits):
  all 7 lenses that previously had 0% rubric coverage (debate,
  parenting, philosophy, reasoning, reflection, science, thread) now
  ship bespoke leader-app workbenches. When no existing leader-app
  UI is present, the action panel IS the leader-app shell - it
  surfaces the previously-orphaned per-lens macros AND exposes the
  mint/DM/publish/agent quartet on top.
  Per-lens components: DebateActionPanel · ChildBriefPanel ·
  DilemmaPanel · ArgumentWorkbench · JournalActionPanel ·
  ExperimentActionPanel · ThreadNodeActions. Tier 3 avg 28 → 38%.
- **Tier-5 session-loops kicked off 2026-05-16**: fitness +
  sports + grounding all shipped action panels (fitness Hevy/Strong
  WorkoutFinishPanel · sports ESPN/Strava ActivityActionPanel ·
  grounding ClaimVerificationPanel — note: rubric mis-typed grounding
  as Insight Timer; the Concord lens is actually a fact-check
  workbench, re-classified accordingly). 3 of 5 Tier-5 done.
  Remaining: meditation (no domain/page yet — needs scaffolding),
  expert-mode (MasterClass shadow has domain + page).
- This rubric authored 2026-05-16 as Phase 1 deliverable per the v3
  plan. Replaces `docs/LENS_COVERAGE_AUDIT.md` from PR #723 (which
  used the buggy detector that under-counted wiring).
