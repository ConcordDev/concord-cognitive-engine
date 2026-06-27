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

## Failing lenses (score < 5/7) — weakest first (priority queue)

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
| narrative-walk | 3/7 | pending | | by-design reader (NO-BACKEND-CALL) — verify |
| announcements | 3/7→5/7 | **done** | a62bae5 | dedicated `announcements` domain (list/get public, post admin-gated); fixed dangling `lens.announcements.*` manifest refs + error-swallow UX defect (now honest error+retry vs empty); 16 server + 4 UX-state tests |
| housing | 3/7→5/7 | **done** | def0ff4 | dedicated `housing` domain; fixed dangling lens.housing.* manifest refs; furniture place/persist tests; 4 UX states |
| training-room | 3/7→4/7 | **done** | 55df001 | fixed frame-data wrong-column/no_skill defect (#21); real frame tests; 4 UX states |
| achievements | 3/7 | **done** | 75031b3 | dedicated `achievements` domain; unlock-idempotency + reward-once behavioral tests; 4 UX states; wired |
| lfg | 3/7→5/7 | **done** | 55df001 | dedicated `lfg` domain; fixed parties expires_at NOT-NULL crash; single-open-per-world tests; 4 UX states |
| quests | 3/7→4/7 | **done** | 55df001 | dedicated `quests` domain; fixed lens mis-wire (was hitting goals.list); accept→complete→reward-once tests; 4 UX states |
| ops-telemetry | 3/7 | pending | | dashboard — likely by-design |
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
| repair-telemetry | 4/7 | pending | | dashboard — likely by-design |
| code-quality | 4/7→5/7 | **done** | batch11 | fixed phantom `lens.code-quality.*` manifest refs + fail-closed numeric guards + 4 UX states. CORRECTION: it was NOT saved-class — code-quality.js is already bridged into MACROS by domains/detectors.js's codeQualityAdapter (single shim, correct params); the agent's internal-shim rewrite double-wrapped params + my registration duplicated it, both reverted. 15 server + 4 UX-state tests |
| cognition | 4/7→5/7 | **done** | batch9 | SAVED-CLASS: `domains/cognition.js` used legacy `registerLensAction` (3-arg) AND was NEVER imported → every cognition.{compareModes,recommendMode,exportTrace,listExports,getExport,deleteExport,driftAlerts} hit `unknown_macro`, leaving the ModeRecommender/ModeComparison/TraceExports + drift timeline dead-wired. Rewrote 7 macros to canonical `register` 2-arg (no duplicated logic; same compute) + fail-CLOSED `badNumericField` on depth/limit; fixed phantom `lens.cognition.*` manifest macro refs → real `cognition.*` ids; four-UX-state contract on TraceExports (loading role=status / error role=alert+Retry / empty / populated). 19 server + 4 UX-state tests; assassin clean (0 violations, 9 macros). Per-user in-memory ledger — no publicReadDomains entry (auth-gated lens). REQUIRES server.js register line (reported, not committed). |
| crisis-ops | 4/7→6/7 | **done** | batch9 | reader/ops over the real `crisis` domain (lens-id≠domain); fixed phantom `lens.crisis-ops.*` → real crisis.{active_for_player,timeline,declare,resolve,map}; added real `crisis.declare` + IncidentReportPanel (artifact CRUD persistence); FIXED a unit bug (world-crisis.js writes started_at in MS but read macros assume seconds → ~1000× off age/urgency); 12 server + 6 UX-state tests; assassin clean (17 macros) |
| death-insurance | 4/7→5/7 | **done** | batch9 | SAVED-CLASS (BIG): `domains/insurance.js` (1777 LOC, 65 macros) was legacy registerLensAction + NEVER imported → dead-wired BOTH /lenses/death-insurance AND /lenses/insurance. Rewrote to canonical register via a shim + wired in server.js (no collision with inline write_contract/revoke/list_for_user); claim-on-death splits the real sparks pool exactly; 67 server + 5 UX-state tests; scoped assassin 0 violations across 76 macros |
| dx-platform | 4/7→5/7 | **done** | batch11 | SAVED-CLASS (15 macros, legacy + never imported → DxWorkbench dead-wired); rewrote to canonical register via shim + wired in server.js; index→chat / diff→detector-findings round-trips; 16 server + 4 UX-state tests; assassin 0/15 |
| expedition-journal | 4/7→5/7 | **done** | batch11 | SAVED-CLASS (13 macros, legacy + never imported); rewrote to canonical register via shim + wired in server.js; XP-awarded-once + badge cascade (pathfinder/grand-explorer) round-trips; 19 server + 7 UX-state tests; assassin 0/13 |
| ghost-tracker | 4/7→6/7 | **done** | batch10 | maps to the real already-registered `ghost-hunt` domain (spectral-residue hunt over drift_alerts); fixed phantom `lens.ghost-tracker.*` → real ghost-hunt.*; added real ghost-hunt.create (mints a kind:ghost_residue Spectral Dossier DTU) + Saved Dossiers rail; 22 server + 9 UX-state tests; assassin 0/8 |
| lattice | 4/7 | pending | | lattice dashboard |
| mesh | 4/7→5/7 | **done** | batch11 | SAVED-CLASS (19 macros, legacy + never imported → MeshTopology/Messaging/Signal/Queue/Channels dead-wired); rewrote to canonical register via shim + wired in server.js (disjoint from inline mesh.{status,topology,channels,…} — no collision); store-and-forward offline→retry→delivered + PSK channel round-trips; 18 server + 4 UX-state tests; assassin 0/29 |
| ops | 4/7 | pending | | ops dashboard |
| sandbox | 4/7→5/7 | **done** | batch10 | SAVED-CLASS (14 combat-feel macros, legacy + never imported). Rewrote to canonical register via shim + wired in server.js (names distinct from inline B2B sandbox.provision/kill/list — no collision); real telemetry/replay round-trips; 14 server + 5 UX-state tests; assassin 0/19 |
| sentinel | 4/7 | pending | | sentinel dashboard |
| sessions | 4/7→5/7 | **done** | batch9 | removed a DUPLICATE manifest entry + repointed phantom `lens.sessions.*` → real sessions.{list_mine,get,start,advance,search}; page was already wired (intel stale); added fail-closed numeric guards; 12 (32 w/ parity) server + 6 UX-state tests; assassin clean (13 macros). (vitest.config.ts include glob extended to app/** for the co-located page test — 1 file, harmless) |
| society | 4/7→5/7 | **done** | batch10 | SAVED-CLASS (16 World Bank wb-* macros, legacy + never imported). Rewrote to canonical register + wired in server.js + publicReadDomains (anon-safe WB data reads); FIXED a 2nd bug (DataExplorer macro() read `ok` off the wrong envelope wrapper → rendered nothing); URL-path-injection guard on indicator codes; 20 server + 5 UX-state tests; assassin 0/16 |
| system | 4/7 | pending | | system dashboard |
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
