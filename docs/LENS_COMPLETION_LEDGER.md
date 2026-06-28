# Lens Completion Ledger

**Started 2026-06-26.** The source-of-truth resume point for the per-lens "flawless pass" loop
(`docs/...` plan → "PER-LENS FLAWLESS LOOP"). The loop reads this to know what's left; it is
durable across sessions/restarts.

## The DONE gate (a lens is "complete" only when ALL pass)
1. **Backend real** — every macro the lens calls has a *behavioral* test (asserts the actual value/
   round-trip, not just shape) + a `content/contracts/overrides/<domain>.<macro>.json` invariant.
2. **Wired** — `verify-lens-backends` WIRED; no unregistered callers.
3. **No fake data** — grep gate clean (no mock/placeholder/coming-soon/fabricated rows in the mounted path).
4. **Four UX states** — empty / loading / error / populated + basic a11y, pinned by a vitest.
5. **Feature depth** — `score-lenses` ≥ target, **OR** a justified note that the missing capability is
   by-design-absent (a dashboard/reader lens legitimately has no editor/export — NOT padded with fakes).
6. **Connectors (if any)** — real two-way on `connectorFetch`.
7. **Green** — server `node --test` + `vitest run` + `tsc --noEmit` for touched files.

## Methodology note (honesty)
`score-lenses` (7 capability bits: artifact/persist/editor/engine/pipeline/export/dtu) is a RANKING
signal, not the definition of done. Many low scorers are dashboards/readers where the missing bits are
*appropriate*. For each lens the loop decides per-bit: build it REAL if the lens genuinely needs it, or
record "by-design absent" with a reason. No bit is ever satisfied with fake/placeholder UI.

## Status legend
`pending` · `in-progress` · `done` (passed the gate; commit sha noted) · `by-design` (gate met; some
score bits justified-absent)

## Failing lenses (score < 5/7) — weakest first (priority queue)  ✅ CLOSED 2026-06-27 (all 46 through the gate)

| Lens | score | status | commit | notes |
|---|---:|---|---|---|
| reasoning-traces | 0/7→7/7 | **done** | batch5 | `reasoning` trace macros (traces/trace/run over the HLR engine, named export wired into server.js); real-trace round-trip tests; 4 UX states. (0/7 intel was stale — scorer already saw 7/7; `reasoning.create_chain` IS registered inline at server.js:13501, not a phantom) |
| literary | 1/7→7/7 | **done** | batch5 | behavioral tests on all 6 driven macros (search/semantic_graph/resonance/resonance_graph/annotate/stats); real GraphML/CSV/JSON export of the live resonance graph; annotate→DTU citation round-trip; +6 contract overrides; macro-assassin 4→0 (fixed poisoned-`limit` fail-open → fail-closed); 4 UX states |
| foundry | 3/7→5/7 | **done** | batch7 | REDO success (prior agent died on a full-server-boot hanging test). Wired the page-level macro loop (FoundryWorldsPanel + useLensData over real foundry.{list,create,get,delete}); fixed phantom `run`→`validate`; fail-closed guards on all numeric inputs. 16 server (0.29s, hermetic) + 5 UX-state tests; assassin clean across 40 macros |
| saved | 3/7→5/7 | **done** | batch6 | MAJOR fix: `saved` was UNREGISTERED + used legacy `registerLensAction` (invisible to runMacro) → every saved.* call hit `unknown_macro`; rewrote to canonical `register` 2-arg convention + wired in server.js. Fixed header crash (`stats.byState.unread` unguarded). 38 server + 4 UX-state tests |
| move-builder | 3/7→5/7 | **done** | batch5 | new `move-builder` domain (compose/mint/list/get/catalog over move-descriptor.js + ED budget); fixed the DEAD mint (page called `glyph_spells.mint` with wrong payload → always failed) + phantom `lens.move-builder.*` refs; 11 server + 5 UX-state tests |
| garage | 3/7→5/7 | **done** | batch5 | new `garage` domain (list/get/spawn/mine/mount/dismount/move over lib/world-vehicles.js); fixed 4 fabricated vehicle kinds the backend rejected with `bad_kind` (silent fail) + phantom `lens.garage.*` refs; 7 server + 6 UX-state tests |
| courtship | 3/7→4/7 | **done** | def0ff4 | dedicated `courtship` domain; fixed propose-threshold 0.60 vs server 0.70 mismatch + Child-column bug; 4 UX states |
| spectate | 3/7→5/7 | **done** | batch6 | new `spectate` domain (list/get/watch/bet/my_positions over spectator-mode + betting-markets + goddess-broadcaster libs); fixed phantom `lens.spectate.*` refs + "mock event ticker" stub; parimutuel bet escrow tests; 12 server + 7 UX-state tests |
| mail | 3/7 | **done** | 75031b3 | dedicated `mail` domain; send→inbox→claim single-tx behavioral tests; 4 UX states; wired |
| narrative-walk | 2/7 viewer | **done** | batch13 | confirmed self-contained authored-cinematic READER (NO-BACKEND-CALL correct, not a defect); fixed 2 real bugs (played by `id` but director resolves by `trigger` → 4/11 cinematics never played; `comment` vs `summary` field never rendered); removed phantom macros; 4 UX states + keyboard nav; 7 vitest. artifact/persist/engine/pipeline/export/dtu by-design-absent (a reader produces no exhaust) |
| announcements | 3/7→5/7 | **done** | a62bae5 | dedicated `announcements` domain (list/get public, post admin-gated); fixed dangling `lens.announcements.*` manifest refs + error-swallow UX defect (now honest error+retry vs empty); 16 server + 4 UX-state tests |
| housing | 3/7→5/7 | **done** | def0ff4 | dedicated `housing` domain; fixed dangling lens.housing.* manifest refs; furniture place/persist tests; 4 UX states |
| training-room | 3/7→4/7 | **done** | 55df001 | fixed frame-data wrong-column/no_skill defect (#21); real frame tests; 4 UX states |
| achievements | 3/7 | **done** | 75031b3 | dedicated `achievements` domain; unlock-idempotency + reward-once behavioral tests; 4 UX states; wired |
| lfg | 3/7→5/7 | **done** | 55df001 | dedicated `lfg` domain; fixed parties expires_at NOT-NULL crash; single-open-per-world tests; 4 UX states |
| quests | 3/7→4/7 | **done** | 55df001 | dedicated `quests` domain; fixed lens mis-wire (was hitting goals.list); accept→complete→reward-once tests; 4 UX states |
| ops-telemetry | 3/7 system | **done** | batch13 | REST dashboard over 8 real /api/admin/* routes (heartbeat/worker/brain/shard stats); fixed phantom `lens.ops-telemetry.*` manifest macros → macros:{}; 4 UX states + 403 AdminRequired + a11y tables; 7 vitest. persist/engine/pipeline/dtu by-design-absent (Grafana-analog) |
| auction | 4/7 | **done** | 75031b3 | dedicated `auctions` domain (delegates to lib); 4 UX states + a11y; behavioral tests + contract overrides; wired |
| careers | 4/7→5/7 | **done** | batch6 | fixed phantom `lens.careers.*` manifest refs → real `careers.{tracks,contracts,work,offer}`; honest disabled-by-config note (was misleading "coming soon"; system is ENABLED by default); work-shift credits real sparks, offer→accept persists contract; 11 server + 7 UX-state tests |
| codex | 4/7→5/7 | **done** | batch7 | reader over the real `lore` domain; fixed phantom `lens.codex.*` → real lore.{list,get,facets,spine}; hardened lore.list fail-open (poisoned limit clamped → now invalid_limit); real per-user bookmarks via artifact store; 15 server + 11 UX-state tests |
| ledger | 4/7→5/7 | **done** | batch7 | fixed real wiring bug (page read `r.data` not `r.data.result` → always rendered empty even with real anomalies); repointed phantom `lens.ledger.*` → real ledger.{anomalies,faction_economy,flow_summary}; CREDIT_ROW_PREDICATE no-double-credit regression test; 10 server + 5 UX-state tests |
| forecast | 4/7→5/7 | **done** | batch8 | wired page to real inline `forecast.*` macros (over lib/world-forecast.js); fixed phantom `lens.forecast.*` + a stale duplicate manifest entry; fixed silent-clamp fail-open in world-forecast.js (multiDay/hourly/accuracy/archive → invalid_* on poisoned input); 16 server + 5 UX-state tests |
| civic-bonds | 4/7→5/7 | **done** | batch8 | fixed real domain-name MISMATCH (manifest `civic-bonds` hyphen + phantom refs vs real backend `civic_bonds` underscore) → repointed to real civic_bonds.*; full bond lifecycle round-trip test (create→vote→pledge→fund 110%-gate→complete); 8 server + 7 UX-state tests |
| detective | 4/7→5/7 | **done** | a62bae5 | dedicated `detective` domain delegating to lib (Obra-Dinn 2-of-3 + suspect_match lock-in); fixed dangling `lens.detective.*` manifest refs; added non-culprit-leaking `getCrimeWithEvidence`; 10 server + 5 UX-state tests |
| photos | 4/7→5/7 | **done** | batch7 | new `photos` domain (list/get/world/share over lib/photo-gallery.js; share mints a kind='photo' DTU) + registered in server.js (publicRead: world only); fixed phantom `lens.photos.*` refs; 10 server + 4 UX-state tests |
| fishing | 4/7→5/7 | **done** | def0ff4 | dedicated `fishing` domain; fixed buffOnCook [object Object] render; cast→reel→catch tests; 4 UX states |
| creatures | 4/7→5/7 | **done** | a62bae5 | extended `creatures` domain (+species/roster/lineage/breed) delegating to creature-crossbreeding + species-taxonomy; fixed dangling `lens.creatures.*` refs + the breed `bond_too_low` bug (thin parents lacked physics blueprints → no hybrid ever produced); 8 server + 4 UX-state tests |
| translation | 4/7→5/7 | **done** | batch8 | SAVED-CLASS: legacy registerLensAction + NEVER imported → fully dead (unknown_macro). Rewrote to canonical register + wired in server.js; added a real deterministic offline language detector (translate/batch keep honest {ok:false} offline); 27 server + 5 UX-state tests |
| repair-telemetry | 4/7 by-design | **done** | batch12 | dashboard over the real `repair` domain; fixed phantom `lens.repair-telemetry.*` → real repair.{health_log,escalations,memory,resolve_escalation} + a fail-open (health_log poisoned limit → invalid_limit, assassin 1→0); persist/pipeline/dtu by-design-absent (read-only monitor); 18 server + 7 UX-state tests |
| code-quality | 4/7→5/7 | **done** | batch11 | fixed phantom `lens.code-quality.*` manifest refs + fail-closed numeric guards + 4 UX states. CORRECTION: it was NOT saved-class — code-quality.js is already bridged into MACROS by domains/detectors.js's codeQualityAdapter (single shim, correct params); the agent's internal-shim rewrite double-wrapped params + my registration duplicated it, both reverted. 15 server + 4 UX-state tests |
| cognition | 4/7→5/7 | **done** | batch9 | SAVED-CLASS: `domains/cognition.js` used legacy `registerLensAction` (3-arg) AND was NEVER imported → every cognition.{compareModes,recommendMode,exportTrace,listExports,getExport,deleteExport,driftAlerts} hit `unknown_macro`, leaving the ModeRecommender/ModeComparison/TraceExports + drift timeline dead-wired. Rewrote 7 macros to canonical `register` 2-arg (no duplicated logic; same compute) + fail-CLOSED `badNumericField` on depth/limit; fixed phantom `lens.cognition.*` manifest macro refs → real `cognition.*` ids; four-UX-state contract on TraceExports (loading role=status / error role=alert+Retry / empty / populated). 19 server + 4 UX-state tests; assassin clean (0 violations, 9 macros). Per-user in-memory ledger — no publicReadDomains entry (auth-gated lens). REQUIRES server.js register line (reported, not committed). |
| crisis-ops | 4/7→6/7 | **done** | batch9 | reader/ops over the real `crisis` domain (lens-id≠domain); fixed phantom `lens.crisis-ops.*` → real crisis.{active_for_player,timeline,declare,resolve,map}; added real `crisis.declare` + IncidentReportPanel (artifact CRUD persistence); FIXED a unit bug (world-crisis.js writes started_at in MS but read macros assume seconds → ~1000× off age/urgency); 12 server + 6 UX-state tests; assassin clean (17 macros) |
| death-insurance | 4/7→5/7 | **done** | batch9 | SAVED-CLASS (BIG): `domains/insurance.js` (1777 LOC, 65 macros) was legacy registerLensAction + NEVER imported → dead-wired BOTH /lenses/death-insurance AND /lenses/insurance. Rewrote to canonical register via a shim + wired in server.js (no collision with inline write_contract/revoke/list_for_user); claim-on-death splits the real sparks pool exactly; 67 server + 5 UX-state tests; scoped assassin 0 violations across 76 macros |
| dx-platform | 4/7→5/7 | **done** | batch11 | SAVED-CLASS (15 macros, legacy + never imported → DxWorkbench dead-wired); rewrote to canonical register via shim + wired in server.js; index→chat / diff→detector-findings round-trips; 16 server + 4 UX-state tests; assassin 0/15 |
| expedition-journal | 4/7→5/7 | **done** | batch11 | SAVED-CLASS (13 macros, legacy + never imported); rewrote to canonical register via shim + wired in server.js; XP-awarded-once + badge cascade (pathfinder/grand-explorer) round-trips; 19 server + 7 UX-state tests; assassin 0/13 |
| ghost-tracker | 4/7→6/7 | **done** | batch10 | maps to the real already-registered `ghost-hunt` domain (spectral-residue hunt over drift_alerts); fixed phantom `lens.ghost-tracker.*` → real ghost-hunt.*; added real ghost-hunt.create (mints a kind:ghost_residue Spectral Dossier DTU) + Saved Dossiers rail; 22 server + 9 UX-state tests; assassin 0/8 |
| lattice | 3/7 system | **done** | batch13 | REST dashboard (brain self-training MLOps console over /api/lattice/* + /api/brains/*) — NOT the meta-reasoning substrate. Fixed 4 real data-shape bugs (all 4 tabs read wrong shapes → permanently empty/broken) + phantom manifest macros/actions firing dead ManifestActionBar clicks; 4 UX states; 5 vitest. by-design-absent bits documented |
| mesh | 4/7→5/7 | **done** | batch11 | SAVED-CLASS (19 macros, legacy + never imported → MeshTopology/Messaging/Signal/Queue/Channels dead-wired); rewrote to canonical register via shim + wired in server.js (disjoint from inline mesh.{status,topology,channels,…} — no collision); store-and-forward offline→retry→delivered + PSK channel round-trips; 18 server + 4 UX-state tests; assassin 0/29 |
| ops | 4/7→5/7 | **done** | batch12 | SAVED-CLASS (22 PagerDuty-shape macros, legacy + never imported → IncidentConsole(920 LOC)+OpsActionPanel dead-wired); rewrote to canonical register via shim + wired in server.js; incident state-machine + escalation + MTTA/MTTR + blast-radius round-trips; 47 server + 4 UX-state tests; assassin 0/25 |
| sandbox | 4/7→5/7 | **done** | batch10 | SAVED-CLASS (14 combat-feel macros, legacy + never imported). Rewrote to canonical register via shim + wired in server.js (names distinct from inline B2B sandbox.provision/kill/list — no collision); real telemetry/replay round-trips; 14 server + 5 UX-state tests; assassin 0/19 |
| sentinel | 4/7→5/7 | **done** | batch12 | SAVED-CLASS (26 threat-console macros, legacy + never imported → page + 8 components dead-wired); rewrote to canonical register via shim + wired in server.js; triage open→list→detail + monitor round-trips; 35 server + 5 UX-state tests; assassin 0/26 |
| sessions | 4/7→5/7 | **done** | batch9 | removed a DUPLICATE manifest entry + repointed phantom `lens.sessions.*` → real sessions.{list_mine,get,start,advance,search}; page was already wired (intel stale); added fail-closed numeric guards; 12 (32 w/ parity) server + 6 UX-state tests; assassin clean (13 macros). (vitest.config.ts include glob extended to app/** for the co-located page test — 1 file, harmless) |
| society | 4/7→5/7 | **done** | batch10 | SAVED-CLASS (16 World Bank wb-* macros, legacy + never imported). Rewrote to canonical register + wired in server.js + publicReadDomains (anon-safe WB data reads); FIXED a 2nd bug (DataExplorer macro() read `ok` off the wrong envelope wrapper → rendered nothing); URL-path-injection guard on indicator codes; 20 server + 5 UX-state tests; assassin 0/16 |
| system | 4/7→5/7 | **done** | batch12 | SAVED-CLASS (14 telemetry macros, legacy + never imported → all realtime panels dead-wired). Rewrote to canonical register via shim + wired in server.js; DISJOINT from inline system.{analogize,autogen,cartograph,…} (no collision); metrics/logs/traces/dashboard round-trips; 18 server + 4 UX-state tests; assassin 0/22 |
| tools | 4/7→5/7 | **done** | batch10 | SAVED-CLASS (legacy registerLensAction + never imported → unknown_macro); rewrote 12 macros to canonical register via shim + wired in server.js; real e-sign create→sign→complete→verify round-trip + HMAC tamper-detection; 13 server + 10 UX-state tests; assassin 0/15 |
| wellness | 4/7→5/7 | **done** | batch8 | SAVED-CLASS: legacy registerLensAction + NEVER imported → fully dead. Rewrote 35 macros to canonical register + wired in server.js; real computed metrics (sleepScore/strainLog/recoveryReport/hrvTrend) + range-aware guards; 37 server + 5 UX-state tests |

## Passing lenses (score ≥ 5/7) — 217
Already pass the capability gate. The loop revisits them ONLY for the non-score gate dimensions
(behavioral tests + contract overrides + 4 UX states audit) after the failing queue is cleared. Not
enumerated here until reached.

## Progress log
- 2026-06-26: ledger created; 46 failing lenses ranked; loop started.
- 2026-06-27: batch 1 DONE (auction, mail, achievements) @ 75031b3. 43 left.
- 2026-06-27: batch 2 DONE (quests, lfg, training-room) @ 55df001 — 42 behavioral + 17 UX-state
  tests; surfaced + fixed 3 real bugs (parties expires_at crash, quests mis-wire, frame-data no_skill). 40 left.
- 2026-06-27: batch 3 DONE (housing, courtship, fishing) @ def0ff4 — 26 behavioral + 14 UX-state
  tests; +3 real bugs (courtship threshold mismatch, housing dangling macros, fishing object-render). 37 left. 6 bugs total.
- 2026-06-27: batch 4 DONE (detective, announcements, creatures) — 34 behavioral + 13 UX-state
  tests; +3 real bugs (detective dangling-macro + arrest_records→trial_records, announcements
  error-swallow UX defect, creatures breed `bond_too_low` no-hybrid bug); all 3 dangling `lens.*`
  manifest refs fixed. verify-lens-backends 258 WIRED / 0 broken. 34 left. 9 bugs total.
- 2026-06-27: batch 5 DONE (garage, move-builder, reasoning-traces, literary) — 36 server + 24 UX-state
  tests; +3 real bugs (garage 4 fabricated vehicle kinds silently rejected, move-builder DEAD mint
  wrong-payload, literary poisoned-`limit` fail-open). Wired garage/move-builder/reasoning-trace macros
  into server.js + publicReadDomains. Honesty note: a suspected reasoning `create_chain` phantom was a
  FALSE ALARM — it's registered inline at server.js:13501 (my grep was too narrow); verified before
  touching. verify-lens-backends 258 WIRED / 0 broken, macroDomains 526. 30 left. 12 bugs total.
- 2026-06-27: INVARIANT HARDENING @ 0fb0429 — the first full `macro-assassin --ratchet` run this session
  surfaced 27 NEW violations across the loop's batch-1..5 domains; fixed ALL 27 for real (no baselining):
  18 V2 `ok_true_on_poisoned_number` fail-opens → fail-closed `badNumericField` guards (range-aware
  `badSentiment` for courtship), 9 V1 `seed_expect_mismatch` → corrected contract fuzz_case expects to
  the live-DB+actor reality. Ratchet now GREEN (0 new vs the 11-known baseline; 10 residual are the
  pre-existing detectors/emergent TIMEOUT baseline). 129/129 domain tests green. LESSON: each batch's
  agents now self-run the assassin against their own domain before reporting (literary did → was clean).
- 2026-06-27: batch 6 — 3 DONE (saved, spectate, careers), 1 REVERTED (foundry). 61 server + 18 UX-state
  tests; +3 real bugs (saved fully UNREGISTERED+legacy-convention → unknown_macro, saved header crash,
  careers misleading "coming soon" → honest disabled-by-config). Hardening-by-construction held: all 3
  agents shipped fail-closed numeric guards + live-DB-accurate contracts (assassin self-checks clean).
  foundry's agent DIED mid-work (hanging full-server-boot test) → reverted, requeued with a lightweight-
  test instruction. verify-lens-backends 258 WIRED / 0 broken, macroDomains 527. 27 left. 15 bugs total.
- 2026-06-27: batch 7 DONE (foundry-redo, photos, ledger, codex) — 51 server + 25 UX-state tests; +3
  real bugs (ledger envelope-unwrap → always-empty, lore.list fail-open, all phantom manifest refs).
  foundry REDO succeeded via the lightweight-hermetic-test rule (16 tests in 0.29s, no boot — the dead
  agent's hang is gone). photos registered in server.js (publicRead: world). verify-lens-backends 258
  WIRED / 0 broken, macroDomains 528. 23 left. 18 bugs total.
- 2026-06-27: batch 8 DONE (forecast, civic-bonds, translation, wellness) — 88 server + 22 UX-state
  tests; +4 real bugs (forecast fail-open + phantom/dup manifest, civic-bonds hyphen/underscore domain
  mismatch, translation + wellness BOTH saved-class fully-dead legacy-convention-never-imported). Wired
  translation + wellness in server.js; added forecast + civic_bonds publicReadDomains read entries.
  ALSO caught + fixed 2 broader-suite regressions my OWN earlier batches introduced but per-lens vitests
  missed: manifest.test.ts (mandated the phantom lens.<domain>.* convention — RED since batch 6) and
  sere-frontend.test.ts (brittle anomalies regex broke on batch-7's typed lensRun<Anomalies>). Lesson:
  run the full frontend suite per batch, not just per-lens vitests. verify-lens-backends 258 WIRED / 0
  broken, macroDomains 528. 19 left. 22 bugs total.
- 2026-06-27: batch 9 DONE (cognition, crisis-ops, death-insurance, sessions) — 110 server + 21 UX-state
  tests; +3 real bugs (cognition + insurance BOTH saved-class fully-dead [insurance dead-wired TWO lenses
  + its 65-macro 1777-LOC domain], crisis-ops MS-vs-seconds unit bug). Wired cognition + insurance in
  server.js (insurance's 65 macros activated — scoped assassin 0 violations across 76). crisis-ops hit
  6/7. verify-lens-backends 258 WIRED / 0 broken, macroDomains 528. 15 left. 25 bugs total.
- 2026-06-27: batch 10 DONE (tools, sandbox, society, ghost-tracker) — 69 server + 29 UX-state tests;
  +4 real bugs (tools/sandbox/society ALL saved-class fully-dead legacy-never-imported; society 2nd bug
  = DataExplorer envelope-unwrap rendered nothing). Wired tools+sandbox+society in server.js + society
  WB-data publicReadDomains. ghost-tracker → real ghost-hunt domain, 6/7. verify-lens-backends 258 WIRED
  / 0 broken, macroDomains 528. 11 left. 29 bugs total. NOTE: the saved-class cluster (legacy
  registerLensAction + never-imported domain → silently dead) is the loop's single most common defect.
- 2026-06-27: batch 11 DONE (code-quality, dx-platform, expedition-journal, mesh) — 68 server + 19
  UX-state tests; +3 saved-class fully-dead domains wired (dx-platform/expedition-journal/mesh). CAUGHT
  an integration trap: code-quality was NOT saved-class (already bridged via detectors.js's
  codeQualityAdapter); the agent's internal-shim rewrite would have double-wrapped params + duplicate-
  registered — reverted the signature (kept guards/manifest/UX), dropped the redundant server.js line,
  fixed the test to mirror detectors.js's adapter. verify-lens-backends 258 WIRED / 0 broken. 7 left.
- 2026-06-27: batch 12 DONE (ops, sentinel, system, repair-telemetry) — 122 server + 20 UX-state tests;
  +3 saved-class fully-dead domains wired (ops 22 / sentinel 26 / system 14 macros) + 1 dashboard
  (repair-telemetry, +1 fail-open fix). system disjoint from 8 inline system.* (no collision). ops's
  IncidentConsole rewrite also cleared a transient tsc error. verify-lens-backends 258 WIRED / 0 broken.
  3 left (narrative-walk reader + ops-telemetry/lattice REST dashboards — batch 13 closes the queue).
- 2026-06-27: batch 13 DONE (narrative-walk, ops-telemetry, lattice) — the 3 dashboards/readers; 19
  vitest; +6 real bugs (narrative-walk play-by-trigger + comment-field; lattice 4 wrong-data-shape tabs).
  All backend-less or REST-backed (no new macros) → assassin unchanged from batch-12 GREEN. Relaxed
  manifest.test.ts to exempt REST-dashboard/reader lenses from the list/get-macro requirement (macros:{}).
  ★★★ FAILING QUEUE CLOSED ★★★ — all 46 lenses that scored <5/7 are now through the DONE gate (real
  ≥5/7, OR a dashboard/reader at <5/7 with every missing capability bit honestly by-design-absent). 0
  left in the failing queue. ~41 real production bugs fixed across the loop; the dominant defect was the
  SAVED-CLASS bug (legacy registerLensAction domain never imported → silently dead). Next: Phase 2 — the
  ~217 already-passing (≥5/7) lenses get the non-score gate audit (behavioral tests + contract overrides
  + 4-UX-state vitests) — the honest long tail.

## Latent-bug cleanup (2026-06-27, post-failing-queue)
The loop surfaced 3 "caller with a broken receiver" / robustness defects outside the lens lane; fixed:
- **lattice-orchestrator drift→HLR resolution was a DEAD CALLER** (TRIPLE bug): `runHLR` got an `input`
  field (it reads `topic`/`question` → failed `topic_or_question_required`), mode `constraint_check`
  (not a valid REASONING_MODES value → `invalid_mode`), and read `r.output.synthesizedConclusion`
  (it's TOP-LEVEL). So drift alerts NEVER produced reasoning conclusions for months. Fixed to
  `{question, mode:'deductive'}` + `r.synthesizedConclusion`; pinned by 2 regression tests in
  `server/tests/lattice-orchestrator.test.js` (10/10, incl. proof-the-old-shapes-fail).
- **verify.designScore threw on poisoned input** — `.slice`/`.join` on non-string title/tags/creti.
  Hardened to `String(...)`/`Array.isArray` coercion (3 identical sites in server.js).
- **emergent autogen-pipeline threw on non-string claims** — 4 `.toLowerCase()` on array elements that
  assumed strings; coerced to `String(c ?? "")`. Both throws were caught by the assassin dispatcher
  (HARD=0) but are real robustness gaps. 107/107 related tests green.

## Phase 2 — non-score gate audit of the ~217 PASSING lenses (started 2026-06-27)
The failing queue is CLOSED. Phase 2 hardens the already-passing (≥5/7, wired, working) lenses for the
*non-score* gate dimensions: a 4-UX-state vitest + a behavioral test + contract overrides for the macros
each drives + a no-fake pass. Lighter than the failing queue (no rewrites — these already work).

**Systemic scan (2026-06-27):** of 261 lens dirs, 233 already carry a lens-specific test reference; ~23
genuinely lack a dedicated UX-state vitest (excluding code-quality/cognition/dx-platform/foundry which
ARE covered under tests/components, and ux-suite which is by-design NO-BACKEND-CALL nav). Phase-2 backlog
(weakest-first, real-backend gameplay/economy first):
- **real-backend:** staking, crafting, deities, sub-worlds, personas, root
- **economy/world:** black-market, bounties, sponsorship, tournaments, kingdoms, inheritance, genesis,
  world-creator, worldmodel, federation, sub-worlds
- **cognitive/misc:** cognition*, understanding, meditation, self, cognitive-replay, gallery, goddess,
  maker  (*cognition already done in batch 9 — verify)

### Phase-2 batch 1 DONE (2026-06-27): staking, crafting, deities, sub-worlds
61 server + 25 UX-state tests. Even these ALREADY-PASSING lenses each carried a real defect — the audit
is clearly worthwhile:
- **staking**: 🔴 real money bug — `Number(Infinity) || 0` → Infinity passed the min-stake check, so an
  Infinity principal could be locked into a position. Fixed with a fail-closed `badNumericField` guard
  (open_stake + estimate_rewards). Also fixed a StakePositions panel that hung on "Loading…" forever on
  any error. 14 server + 6 vitest; assassin 0/5.
- **crafting**: phantom `lens.crafting.*` manifest refs → real `crafting.{list,counts}` + 4 UX states.
  13 server + 6 vitest; assassin 0/2.
- **deities** (lens-id≠domain `deity`): page swallowed all load errors (no loading/error/retry) → fixed.
  Documented the 5 shadow server.js register("deity") DB macros vs the state-Map domain handlers
  (LENS_ACTIONS wins on /api/lens/run). 20 server + 6 vitest; assassin 0/5.
- **sub-worlds** (lens-id≠domain `sub_worlds`): 3 defects — registered only into LENS_ACTIONS so
  runMacro/assassin saw 0 macros (fixed via a dual-bus mirror through globalThis._concordMACROS) +
  fail-open numerics + phantom manifest. 14 server + 7 vitest; assassin 0/15.
No server.js edits. ~19 Phase-2 lenses left in the recorded backlog.

### Phase-2 batch 2 DONE (2026-06-27): black-market, bounties, personas, root
92 server + UX-state tests. TWO real money/robustness bugs + an integration-trap correction:
- **bounties**: 🔴 real money bug — `bounties.create` was fail-OPEN on reward (`num()` clamps
  NaN/Infinity but a finite-absurd `1e308` slipped through → poolCc=1e308 credited fabricated CC on
  accept). Fixed with a fail-closed `badNumericField` guard (reward + milestone rewards). 18 server +
  6 vitest; assassin 0.
- **black-market**: money-conservation audited (sparks are a pure SINK — no credit/mint path,
  fail-closed pricing → NO money bug); added a conservation test pinning it. Fixed a swallowed-load-error
  UX defect (dead market looked like an empty one). 7 server + 8 vitest.
- **personas + root**: the agents diagnosed both as SAVED-CLASS "never imported, fully dead" — that was
  the CODE-QUALITY TRAP (a FALSE POSITIVE): both are already wired via `server/domains/index.js`
  (personas line 453, rootLens 469 → `server.js:41401 domainModules.forEach(mod => mod(registerLensAction))`).
  Grepping `domains/personas`/`domains/root` in server.js misses the index→forEach path. Caught at
  integration: added NO server.js registration (would have double-registered), and REVERTED root.js's
  canonical-register shim (it would have double-wrapped params + broken root when loaded via index.js's
  3-arg registerLensAction call) — keeping the agent's real wins: the fail-closed numeric guard, the
  honest UX error states, and the behavioral tests (harnesses fixed to mirror the real 3-arg LENS_ACTIONS
  dispatch). personas 20 server + 5 vitest; root 47 server + 4 vitest.
LESSON RE-CONFIRMED: before "wiring a dead domain," verify it isn't already loaded via domains/index.js's
domainModules.forEach (the 3rd registration path beyond direct server.js import + inline register).
~13 Phase-2 lenses left in the backlog.

### Phase-2 batch 3 DONE (2026-06-27): meditation, gallery, federation, sponsorship
107 server + 23 UX-state tests. All four wired via PATH 3 (`server/domains/index.js`
domainModules.forEach) — NO server.js registration / canonical-register shim added (trap avoided).
One real CC money-path bug + two robustness defects fixed:
- **sponsorship**: 🔴 real CC money-path fail-OPEN — `sponsorship.create` (server.js:76526, the
  DB-backed MACROS/runMacro path) guarded only `monthlyCc <= 0`, so a finite-absurd `1e308` persisted
  `monthly_cc=1e308` (a poisoned CC obligation) and `Infinity` coerced to NULL in the INTEGER NOT NULL
  column. Latent (no wallet charge reads it today) but on a stated CC path. Fixed in server.js with a
  fail-closed finite/range guard (`invalid_numeric:<field>`) before the INSERT; updated the contract
  override to declare the fields + poisoned-numeric fuzz cases (1e308 → ok:false). The lens's own
  in-memory LENS_ACTIONS path takes no user amount (tier-ladder priced) — already fail-closed. 24
  server + 7 vitest.
- **gallery**: fail-open NaN `x` in `gallery.virtual-room-place` (sibling `y` was guarded, `x` wasn't →
  `x:NaN` serialized to null, broke wall layout) → fail-closed `Number.isFinite ? clamp : 0.5`; plus a
  manifest mismatch (entry described "shared photos"/Camera; the lens is a multi-museum art gallery) →
  real keywords + Landmark icon. 14 server + 6 vitest + 8 overrides.
- **federation**: page swallowed all fetch failures (`.catch(()=>null)`) → silently-empty page on an
  unreachable node; added real loading/error/Retry top-level states. Backend already fail-closed. 20
  server (39 with the existing parity test) + 5 vitest + 5 overrides.
- **meditation**: no defect — numeric inputs already clamp into bounded ranges; added the missing
  behavioral test (30) + 4-UX-state surface (5 vitest) + 12 overrides. Committed @ 379975a.
Assassin ratchet GREEN (no new violations vs baseline); 258 WIRED; tsc 0; full frontend manifest+sere
green. ~9 Phase-2 lenses left in the backlog.

### Phase-2 batch 4 DONE (2026-06-27): tournaments, goddess, understanding, worldmodel
137 server + 23 UX-state tests. All four wired via PATH 3 (domains/index.js). Three fail-open
robustness fixes, the swallowed-fetch→silent-empty UX defect fixed in all four, AND a real
dual-registration wiring defect fixed at integration:
- **tournaments** (committed @ 4b643c6): pure in-memory (no wallet; computePayouts conserves the
  pool) — defense-in-depth fail-closed isSaneCc guards on prizePoolCc/payoutSplit. 26 server + 6
  vitest + 6 overrides.
- **goddess**: fixed swallowed-fetch (unreachable feed read as "goddess has not spoken" — a false
  empty). DUAL registration (path-3 domain for detail/archive/react/subscribe; server.js inline
  `recent`/`compose_now` MACROS). 24 server + 7 vitest + 5 overrides.
- **understanding**: fixed a `diff` fail-open (poisoned from/to → non-finite revision index) + a real
  DUAL-REGISTRATION WIRING DEFECT found at integration — the page's engine-facing Browse tab called
  `understanding.list`, but the notes-substrate LENS_ACTION shadows that name for /api/lens/run
  (dispatcher prefers LENS_ACTIONS), so Browse always got notes-shaped data and rendered empty. Fixed
  by adding a non-colliding `understanding.engine_list` MACROS alias (server.js) and pointing BrowseTab
  at it; the notes tab keeps `list`. 25 server (88 full understanding suite) + 4 vitest + 7 overrides.
- **worldmodel**: fixed a non-finite trajectory overflow (compounding growth → Infinity poisoned the
  trajectory/total) with a VALUE_CAP=1e12 magnitude clamp. No name shadowing (lens names disjoint from
  the 16 server.js MACROS). 22 server + 6 vitest + 5 overrides.
Assassin ratchet GREEN (no new violations vs baseline, incl. the new engine_list); 258 WIRED; tsc 0;
manifest+sere green. ~5 Phase-2 lenses left (genesis, inheritance, kingdoms, self, world-creator,
app-maker, cognitive-replay — child/REST-driven, need discovery).

### Phase-2 batch 5 DONE (2026-06-27): kingdoms, genesis, cognitive-replay, self
82 server + 30 UX-state tests. Four REST/path-3/mixed lenses. Two real fail-open backend fixes,
the swallowed-fetch UX defect fixed in all four, AND a real dead-caller (phantom-macro) cleanup:
- **kingdoms** (REST + macros): real fail-open treasury write — `adjustTreasury` (lib/kingdoms.js)
  did `UPDATE realms SET treasury=MAX(0,treasury+?)` with no finiteness check; poisoned
  Infinity/NaN/1e308 deltas (callers feed env/derived values via civic-bonds) would corrupt the
  realm treasury → fail-closed guard. In-game currency, not real CC. 14 server + 6 vitest.
- **genesis** (REST): real fail-open DoS — feed/graph/identity compute fns used
  `Math.min(parseInt(limit)||def, cap)`; a negative limit falls through to SQLite LIMIT (unbounded)
  → full-table return. Shared `clampLimit` floors at 1. 23 server + 6 vitest.
- **cognitive-replay** (path-3): swallowed chat.timeline fetch (offline read as "no activity"); real
  error/Retry across page + 7 children. 28 server + 8 vitest + 4 overrides.
- **self** (mixed): swallowed-fetch + empty-detection fixes (17 server + 6 vitest), THEN a real
  DEAD-CALLER cleanup at integration — the cross-substrate tabs called NON-EXISTENT macros
  (`fitness.status/metrics`, `sleep.*`, `mental_health.*`, `affect.status`, `journal.recent`,
  `atlas.recent_entries` — verified absent), swallowed into "empty" states (aspirational wiring the
  mandate forbids). Fixed: fitness→`fitness.activity-summary` + mood→`affect.trends` (both real,
  render real fields); sleep/journal → honest no-backend cross-lens CTA cards (dead queries removed).
  Grep-proof: zero phantom-macro calls remain. 17 server + 10 vitest.
Assassin ratchet GREEN (no new violations vs baseline); 258 WIRED; tsc 0; manifest+sere green.
~3 Phase-2 lenses left (inheritance, world-creator, app-maker — child-component-driven, need discovery).

### Phase-2 batch 6 DONE (2026-06-27): inheritance, world-creator, app-maker — NAMED BACKLOG CLOSED
80 server + 18 UX-state tests. Three child-component-driven lenses. One real money fix, two real
dead-caller (wrong-domain / phantom) fixes, swallowed-fetch fixed in all three:
- **inheritance** (DUAL registration; wealth/will TRANSFER money path): fixed 3 fail-open value
  writes in domains/inheritance.js (add_asset.valueCc, track_lock.priceCc, amend_lock.priceCc) +
  the server.js inline `inheritance.open_listing` heir-slot CC market write (poisoned
  heirSlotPriceCc → invalid_numeric; was an unguarded INSERT into a CC value column) with
  fail-closed badCc guards. Asset-value + escrow conservation pinned. 25 server + 6 vitest + 5 overrides.
- **world-creator** (mixed: world-creator.* macros + /api/anomalies + /api/worlds REST): fixed 2
  swallowed-fetch defects (anomalies public-fetch + DraftGallery draft-list dropped failures →
  misleading empty/perpetual-loading); real loading/error/Retry. No backend defect. 30 server + 6
  vitest + 4 overrides.
- **app-maker** (lens-id ≠ domain: backend domain is `app-maker` WITH hyphen, registered in
  domains/appmaker.js): fixed a real WRONG-DOMAIN DEAD CALLER — the page's action panel called the
  non-existent `'appmaker'` (no-hyphen) domain, so the Scaffold/UI-Complexity/Wireframe buttons all
  hit unknown_macro; repointed to the real `'app-maker'`. Also fixed swallowed loadApps failure.
  25 server (48 with parity) + 6 vitest + 3 overrides.
Assassin ratchet GREEN (no new violations vs baseline, incl. inheritance.open_listing); 258 WIRED;
tsc 0; manifest+sere green.

### Phase-2 batch 7 DONE (2026-06-27): film-studios, game-design, urban-planning — long-tail untested lenses
102 server + 15 UX-state tests. Three previously-UNtested lenses (no dedicated behavioral/UX-state
test before this pass), all path-3 with a HYPHENATED domain string registered from a non-hyphenated
file (filmstudios.js→'film-studios', gamedesign.js→'game-design', urbanplanning.js→'urban-planning').
Three real fail-open fixes + the swallowed-fetch UX defect fixed in all three:
- **film-studios**: 2 calculator fail-opens — budgetBreakdown + castAnalysis took `parseFloat(x)||0`
  which lets Infinity/1e400 through into non-finite breakdown amounts; finite/non-negative clamps.
  Also un-swallowed the discover query (`.catch(()=>[])` resolved success, hiding network failures).
  24 server + 5 vitest + 5 overrides.
- **game-design**: GameDesignSection.refreshGames had no try/catch → a failed game-list froze the
  section on the spinner forever; try/catch/finally + role=status/alert + Retry. 42 server + 5 vitest
  + 6 overrides.
- **urban-planning**: zoningAnalysis fail-open (`parseFloat(Infinity)||5000` → lotSize Infinity →
  maxBuildableSqFt Infinity); finite-guard. Also fixed a swallowed scenario-list failure hidden
  behind the empty CTA → dedicated loadError + Retry. 36 server + 5 vitest + 7 overrides.
Assassin ratchet GREEN (no new violations vs baseline); 258 WIRED; tsc 0; manifest+sere green.
27 lenses now through the non-score gate (batches 1–7); the loop continues into the remaining
untested long tail.

### Phase-2 batch 8 DONE (2026-06-27): death-insurance, codex, ledger, mental-health
86 server + 24 UX-state tests. Four lenses, three with lens-id≠domain or non-path-3 registration
(correctly re-diagnosed at the code, not the prompt). Two real caller↔receiver/silent-empty fixes:
- **death-insurance** (lens-id≠domain → 'insurance', dual-registration; money): NO defect — backend
  already fail-closed (badNumericField + verified payout conservation). Additive 11 server (3-way
  conservation 33/33/34=1000) + 6 vitest + 3 overrides.
- **codex** (lens-id≠domain → 'lore', canonical MACROS-registered, 2-arg, assassin-enumerated): NO
  defect (lensRun never throws → error path already correct). Additive 17 server + 7 vitest + 2
  overrides strengthened.
- **ledger** (MACROS-registered, 2-arg; read-only finance): fixed a real silent-empty defect — load()
  ignored the envelope ok/error, so a CLOSED ledger rendered as "record looks clean," lying to the
  auditor; now error+Retry. 14 server + 6 vitest. sere-frontend stays green.
- **mental-health** (path-3, 49 LENS_ACTIONS macros; fully-untested before this pass): fixed a real
  caller↔receiver payload-shape bug — MentalHealthActionPanel wrapped payloads as
  {artifact:{data:{entries}}} so the dispatch's virtualArtifact.data=input double-nested them →
  Mood/Journal buttons silently returned empty fallbacks in PRODUCTION; flattened to {entries}.
  Plus swallowed-fetch fix. 44 server + 5 vitest + 6 overrides (crisis-hotline data is real 988/CBT
  reference, not fabricated).
Assassin ratchet GREEN (no new violations vs baseline); 258 WIRED; tsc 0.
31 lenses now through the non-score gate (batches 1–8). The loop continues.

### Phase-2 batch 9 DONE (2026-06-27): accounting, agriculture, astronomy, carpentry, calendar
164 server + 22 UX-state tests. Five path-3 compute lenses (all prior had only a domain-parity test).
Three real fail-open fixes + two real silent-empty/dead-calculator wiring fixes:
- **accounting** (path-3; the "2 inline registers" were DTU schema-migration transformers, not macros):
  🔴 real LEDGER-CORRUPTION fail-open — je-post's balance guard let Infinity−Infinity=NaN pass the
  |debit−credit|>0.01 check, persisting Infinity into the journal and corrupting every later report;
  parseFloat(x)||0 also leaked Infinity into totals. finNum/finiteOrNull across 12 sites. 22 server +
  5 vitest + 5 overrides.
- **astronomy** (path-3; live_* in astronomy-live.js): fail-opens in celestialPosition/lightTravelTime/
  orbitalMechanics → finiteOr guard + eccentricity clamp + Kepler mass/semi-major>0 guards; live_*
  tested reject-without-fetch. 35 server + 4 vitest + 6 overrides.
- **carpentry**: real DEAD-CALCULATOR wiring bug — CarpentryShop double-wrapped input as
  {input:{artifact:{data}}} so the backend saw artifact.data={artifact:{data}} → every board-foot/
  joint/wood calculator silently returned the empty default and result cards rendered nothing in
  production; plus a wrong price field (pricePerBoardFoot vs pricePerBF) and result cards reading
  fields the backend never emits. All fixed in the caller. 20 server + 5 vitest + 6 overrides.
- **agriculture**: no defect (per-handler try/catch robust). 48 server + 4 vitest + 6 overrides.
- **calendar** (the 5 server.js inline blocks are also registerLensAction → LENS_ACTIONS, not MACROS):
  no defect (scheduleOptimize verified correct; connector paths reject-without-network). 39 server +
  4 vitest + 6 overrides.
Assassin ratchet GREEN (no new violations vs baseline); 258 WIRED; tsc 0.
NOTE (accurate coverage boundary): path-3 LENS_ACTIONS macros are NOT enumerated by the macro-assassin
(it drives the runMacro/MACROS registry only), so for path-3 lenses the behavioral test is the
load-bearing proof and the contract overrides are documented contracts (valid but not assassin-driven).
MACROS-registered lenses (e.g. codex/lore, ledger) ARE assassin-driven. A future harness enhancement
could add LENS_ACTIONS enumeration to fuzz the ~8k path-3 macros — a larger separate task.
36 lenses now through the non-score gate (batches 1–9). The loop continues.

### Phase-2 batch 10 DONE (2026-06-27): billing, chem, construction, cooking, automotive
138 server + 25 UX-state tests. Five path-3 compute lenses. A SYSTEMIC bug class surfaced —
the **double-wrapped-input dead-calculator** — found in 4 of the 5 (carpentry batch-9 was the first):
- **billing**: real money fail-open — invoiceCalculation/revenueRecognition/churnPrediction leaked
  Infinity/1e999 into subtotal/total/revenue (parseFloat||0 truthy + ×100 overflow); finNum guard
  across all numeric inputs. 32 server + 5 vitest + 6 overrides.
- **cooking**: double-wrapped-input dead-calculator — CookingActionPanel posted {artifact:{data}} →
  scaleRecipe/nutritionEstimate/substitution silently returned empty for every panel call; recipeData()
  unwrap. + recipes-scale Infinity clamp. 26 server + 5 vitest + 6 overrides.
- **construction**: same dead-calculator (ConstructionActionPanel + ProcorePanel, {input:{artifact:
  {data}}}, all 4 calculators) + takeoffEstimate/progressReport fail-opens + ganttSchedule Invalid-Date
  throw. 17 server + 5 vitest + 5 overrides.
- **automotive**: same dead-calculator (fuelEfficiency/repairEstimate/maintenanceSchedule) + 3 result-
  card field-mismatch sets (items→services, due→services, totalCost→totalFuelCost) + swallowed-fetch.
  32 server + 5 vitest + 6 overrides.
- **chem**: no live defect; reported a latent server.js shadowing-dup (molecularAnalysis/balanceReaction/
  solutionChemistry re-registered after domainModules.forEach — math-lens bug class; flagged, not a
  live frontend defect since the UI uses hyphenated names). 31 server + 5 vitest + 5 overrides.
Assassin ratchet GREEN; 258 WIRED; tsc 0.
**SYSTEMIC FINDING — double-wrapped-input dead-calculator:** *ActionPanel components that post
`{input:{artifact:{data}}}` or `{artifact:{data}}` cause the live /api/lens/run dispatch to double-nest
(virtualArtifact.data = body.input), so calculator macros read artifact.data.X === undefined and silently
return the empty/default result IN PRODUCTION while the lens "looks wired." Confirmed in carpentry,
cooking, construction, automotive. A proactive grep sweep for this pattern across all `components/**/
*ActionPanel.tsx` + `*Panel.tsx` should prioritize the remaining affected lenses. The robust fix is a
one-layer-unwrap normalizer in the domain handler (peels {artifact:{data}}, tolerates flat input).
41 lenses now through the non-score gate (batches 1–10). The loop continues.

### SYSTEMIC FIX + field-alignment re-audit (2026-06-28, post-batch-10)
The per-lens loop surfaced a systemic bug class AND a process gap; both fixed:
- **Root-cause dispatch fix (`aae953f`):** `server/lib/lens-input-normalize.js#peelRedundantArtifactWrapper`
  peels the redundant sole-key `{artifact:{data}}` wrapper at BOTH /api/lens/run dispatch sites. ~44
  *ActionPanel components (built from a shared template) double-wrapped their payload on top of the
  virtualArtifact the dispatch already builds, so every handler reading `artifact.data.X` saw undefined
  and silently returned the empty result in PRODUCTION while single-wrap tests passed. One guarded,
  idempotent fix cures the wrapper half for all of them. 10 unit tests + e2e 38/38 + HTTP dispatch 53/53.
- **Field-name mismatch class (per-lens):** the dispatch fix can't cover components that send/render the
  WRONG field names. astronomy (`e229edf`): celestialPosition sent `body`/read `result.alt` while the
  handler read `rightAscension`/returned `altitude` — fixed both ways + a real JPL/Hipparcos ephemeris
  for name→RA/Dec. Re-audit of the 5 batch-9/10 lenses (`18cb3fe`): **agriculture had 3 dead calculators**
  (rotationPlan/waterSchedule/predict-yield, wrong input+output fields → blank), **chem's periodic-table
  grid rendered blank** (handler didn't return symbol/atomicMass/group/period), **calendar had 3 blank
  renders**; accounting + billing were clean bills (+ contract tests).
- **PROCESS LESSON (folded into the standard prompt):** a behavioral test that drives the handler with
  the IDEAL shape passes while the COMPONENT is dead. Every per-lens agent MUST trace the component's
  EXACT call (wrapper + input field names + rendered output field names) and add a test driving that
  exact shape — not the documented ideal. This is how astronomy/agriculture/chem/calendar slipped through
  the first pass.
- Latent/deferred: the chem server.js shadow (molecularAnalysis/balanceReaction/solutionChemistry
  re-registered at server.js:41532 → page falls through to JSON render) needs a server.js shadow removal,
  weighed against the chem-behavior depth test — deferred, flagged.
41 lenses + the systemic dispatch fix. The loop continues.

### Phase-2 batch 11 DONE (2026-06-28): photography, engineering, manufacturing, pharmacy, welding
125 server + 24 UX-state tests, run with the IMPROVED component-exact-shape prompt (trace each
calculator's exact sent-input + rendered-output field names, test that exact shape). It paid off
massively — the field-mismatch + fail-closed class was rampant in the calculator-family lenses:
- **welding**: ALL FOUR calculators dead — WelderProcedures rendered tensileLoadKN/effectiveArea/
  recommendations[].electrode/heatInputJmm/items[].passed while the handler returns safeWorkingLoad/
  throatSize/recommended{rod}/heatInput/checklist[].status. Entire calculator surface blank in prod;
  all 4 interfaces+renders aligned + wFinite fail-closed guards. 20 server + 5 vitest + 4 overrides.
- **pharmacy**: 🔴 dosageCalculator printed 'Infinity mg' (lying dose) — fail-closed; + adverse-events
  blank card + drugInteractionCheck dead cards aligned. 24 server + 5 vitest + 5 overrides.
- **manufacturing**: 2 dead calculators (bomCost {bom}→{components}, scheduleOptimize {jobs}→
  {workOrders}) + a QualitySPC empty-state crash + safetyRate always-0 + 3 NaN leaks. 28 server +
  4 vitest + 6 overrides.
- **engineering**: fields aligned; 4 fail-closed gaps incl. a partMesh NON-FINITE Three.js geometry
  (renderer-corrupting) + toleranceChain '±Infinity' + bomRollup overflow + a swallowed-fetch spinner.
  35 server + 5 vitest + 6 overrides.
- **photography**: fields aligned (confirms the dispatch peel); exposureCalc '1/Infinitys' leak + a
  double 'f/' prefix fixed. 18 server + 5 vitest + 5 overrides.
Assassin ratchet GREEN (1 flaky system.history-snapshot timeout under post-restart load, clean on
re-run); 258 WIRED; tsc 0.
LESSON CONFIRMED: the calculator-family lenses (built from a shared *ActionPanel template) carry
widespread caller↔receiver FIELD-NAME drift that naive handler-shape tests miss entirely — welding had
its ENTIRE surface dead. The component-exact-shape audit is mandatory for this family.
46 lenses now through the non-score gate (batches 1–11). The loop continues.

### Phase-2 batch 12 DONE (2026-06-28): plumbing, hvac, electrical, masonry, neuro
107 server + 25 UX-state tests — the trade-calculator sweep, improved component-exact-shape prompt.
The field-mismatch + fail-closed class stayed rampant; two more ENTIRE-surface-dead lenses + a
safety-critical lying calculator:
- **hvac**: ENTIRE ManualJCalc surface dead (all 4 calcs rendered fields the handler never returned);
  aligned handler to the cards' canonical names + climate-enum + invalid-date fixes. 16 server + 5 vitest.
- **electrical**: 🔴 SAFETY — voltageDropCalc printed "Within acceptable limits" for a 30.7% drop
  (gauge-upgrade walked the ladder the WRONG way); boxFill fake-PASSed a too-small box; wireSize
  fabricated a 4/0 spec from garbage. Fields aligned; num() fail-closed sanitizer + the recommendation
  fix. 31 server + 5 vitest + 7 overrides.
- **neuro**: 2 dead surfaces (connectivityAnalysis connections→significantConnections; erpAnalysis dead
  on input shape AND output) + 2 Infinity clamps. 18 server + 5 vitest + 5 overrides.
- **masonry**: 1 dead calc (MaterialEstimator units→unitsNeeded/mortarBags→mortarBags80lb) + real
  recommendation + fail-closed. 21 server + 5 vitest + 4 overrides.
- **plumbing**: fields aligned; 4 fail-closed defects (Infinity rendered as 'Infinity"' + a fixtureCount
  non-array crash). 21 server + 5 vitest + 4 overrides.
Assassin ratchet GREEN; 258 WIRED; tsc 0. Running tally of the calculator-family sweep (batches 9-12):
welding + hvac entirely dead; manufacturing 2 + agriculture 3 + neuro 2 + masonry 1 dead calcs;
+ a lying-dose (pharmacy), a lying voltage-drop (electrical), a renderer-corrupting geometry
(engineering), 2 empty-state crashes, and a long tail of Infinity/NaN fail-opens. The shared
*ActionPanel/*Calc template propagated this widely — the component-exact-shape audit is mandatory.
51 lenses now through the non-score gate (batches 1–12). The loop continues.

**NAMED PHASE-2 BACKLOG CLOSED (2026-06-27):** all 6 batches done (24 lenses through the non-score
gate across batches 1–6). Real defects fixed across the run: 2 CC money bugs (sponsorship.create,
inheritance value/open_listing) + 1 in-game-currency treasury fail-open (kingdoms) + ~6 numeric
fail-opens (gallery, tournaments, understanding diff, worldmodel overflow, genesis negative-limit DoS,
inheritance ×3) + 3 dead-caller wiring fixes (understanding engine_list shadow, self phantom
cross-substrate macros, app-maker wrong-domain) + the swallowed-fetch→silent-empty UX anti-pattern
fixed in ~12 lenses. Ratchet GREEN every batch. The remaining ~230 lenses are the long tail of the
"all 258" loop — each already WIRED + smoke-covered; this pass hardened the highest-signal subset
(the failing queue + the named passing-but-thin/economy lenses).
