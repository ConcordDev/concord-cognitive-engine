# REMAINING-WORK AUDIT — completed 2026-10-28 (GLM pass + Step-1 completion)

**Status: AUDIT COMPLETE (Step 1 of MUSE-HANDOFF-SEC-2, "After the known
list"). This file supersedes the partial GLM audit of 2026-10-28.** Every row
below was verified against the real code on `main` at **02910bbb** (the
remote main HEAD at audit time; all Workstream-B and SEC work is in open PRs,
none merged), not against notes. Open PRs #1704–#1727 were accounted for: a
row fixed only in an open, unmerged PR is **partial — "fix in flight PR
#NNNN"**, never done.

Method: four parallel read-only passes — (1) re-confirmation of GLM sections
A+B row by row; (2) stub/mock/placeholder remainder triage (8,857 fresh grep
lines hand-classified) plus re-confirmation of sections C/D/E/F; (3) docs
backlogs (168 docs inventoried), lens-spec capability maps (all 257; every
reproducible count claim re-run), and the ConKay solver/engine table (73
solver files inventoried); (4) INC-73/74 + the 21 unchecked INCs, the open
GitHub issues, and the leftover roadmap docs.

**Verdict vocabulary (per SEC-2 Step 1):** every row carries claim, source
(file:line), verdict (open / done / partial / obsolete), evidence (file:line
or PR), location (Off-Mac / Mac-only), size (S/M/L), priority (P1–P4, plus
the fix-queue tier below). UNVERIFIED is used only where the evidence does
not exist in this repo (Mac-only claim sources, live-host state, commits
outside the shallow audit clone) — those rows say exactly what would verify
them and are listed for zuko, not guessed.

## Headline results

- **GLM's A/B rows all reproduce.** Of the 59 OPEN/PARTIAL rows in sections
  A+B, re-verification found **40 still open, 19 partial, 0 done in main,
  1 unverifiable** (B#33). Four rows are partial solely because their fixes
  sit in open PRs: A#2 → #1708, A#38 → #1710, B#1 → #1711, B#2 → #1717.
- **The stub/mock/placeholder remainder is almost entirely benign.** Of
  ~8,857 grep lines beyond GLM's triage, exactly **one** new user-facing
  stub exists (S-NEW-1, media thumbnail) plus two obsolete leftovers
  (S-NEW-2/3). The bulk is input `placeholder=` attributes (6,475), Tailwind
  classes, SQL bind vars, pay-stub/T-stub domain terms, detector vocabulary,
  and "No mock data" honesty comments. There are **zero** genuine FIXME
  comments in own code.
- **Lens specs understate the code.** 21 capability-map count claims are
  stale (code grew past the maps; only automotive overstates) and 7
  "unsurfaced" claims are for features now wired. All 21+7 are docs fixes,
  not missing features. 56 count claims match exactly.
- **The only genuinely open solver gap is ConKay's long-term limit-state
  family:** `corrosion.galvanic` (K1, confirming GLM) plus the sibling
  `fatigue` and generic `corrosion` applicability domains (K2, new). Every
  other named solver/engine exists; the external bridges (CalculiX, Cantera,
  OCC, OpenFOAM recorded runs) are Mac/pod runnability checks, not code gaps.
- **Named docs backlogs are mostly self-closed or superseded**
  (FEATURE_UPGRADE, GAP_CLOSURE Tracks 3–4, ORPHANED_SYSTEMS, WAVE4,
  LENS_COMPLETION_LEDGER). Live residue: the macro-depth program (D1/D3/D14
  — its counts are May–July snapshots) and the honest depth floor (B#30 /
  issue #850: headline artifact says 0.999, honest grader says 0.689 with
  525 stub + 1,631 functional of 9,835 macros).
- **24 unchecked INCs have no claim anywhere in the repo** — their claims
  live only in the Mac-only `~/.zuko/CONCORD_USABILITY_LOG.md`. Four
  unchecked INCs turned out done, pinned by in-repo behavioural tests
  (INC-73, INC-109, INC-116, INC-122). INC-144's claim is known (pod
  research jobs stop early) but is a live-pod behaviour.
- **GitHub has exactly 6 open issues** — §G's list was complete: three
  nightly-gate failures (#1663, #1530, #1529, all still open), the overdue
  CodeQL re-audit (#949; suppression ledger still dated 2026-05-11), the
  depth-floor help-wanted (#850, partial), and #1127 whose body is empty.

## Corrections to the GLM audit

1. HANDOFF-2's PRs #1683–#1692 are **squash-merged in main**, not "in
   flight" (D-H2).
2. INC-126 is stronger than reported: the wave-2 schema also covers the
   schedule/status/precip parts GLM left unchecked
   (`lens-input-schemas-wave2.js:425`) (E-126).
3. PR #1714 does **not** fix INC-86 (srs sub-deck orphaning) — it is
   frontend-only (E-86).
4. INC-84's fix is in flight as PR #1712 (E-84).
5. DTUExportButton's population grew: 122 uses, 31 with `data={{}}`
   (GLM: 108/30) (C-G1).
6. A#29's knowledge-extension stub count drifted 10 → **11**.
7. Several GLM "DONE" verdicts in §E (INC-94a group, 127, 128, 142) rest on
   commits outside the shallow audit clone and could not be independently
   re-verified — marked UNVERIFIED, not contradicted (E-94a, E-127, E-128,
   E-142).
8. B#1 (WorldOsSurface mock citations): one pass reported no PR touches
   it; the worktree-level pass found the removal in PR #1711's branch.
   Verdict here follows the worktree evidence: partial, fix in flight
   #1711.

---

# RANKED FIX QUEUE (Step 2 works this top-down, one item per PR)

Order per SEC-2 Step 2: security first, then fake-success/fake-content and
data-integrity, then broken features, then missing features/solvers, then
polish. Items already in flight are listed so nobody re-opens them. Lane
notes say who owns the item — SEC items belong to the SEC sequence
(MUSE-HANDOFF-SEC-2), not to FIX-ALL.

## Tier 1 — Security / access control

| Q | Item | Rows | Size | Lane |
|---|---|---|---|---|
| Q1 | SEC Fix 7 `lens.update` social bypass — after the forum-interactions feature PR; then Fix 10 (depends on 7); Fix 9 persona legacy; Fix 8b export filter if not already open | D-T3, D-T2 (Fix 8 in flight #1727) | M each | SEC sequence |
| Q2 | Fly-mode capability gate (any authenticated user can request "fly") | A#5 | M | FIX-ALL |
| Q3 | 2FA implementation (TOTP enrolment + login second step) | A#9 | M | FIX-ALL |
| Q4 | CSAM provider wiring (Thorn/PhotoDNA/Cloudflare + NCMEC path) — provider account is Ramaj's call, see Needs Ramaj | A#16 | M | FIX-ALL + Ramaj |

**Q4 DONE (2026-10-28)** — founder chose **WebPurify** (not Thorn/PhotoDNA/Cloudflare) and it is wired in the Q4 PR: `webpurifyImageCheck` (AIM) in providers.js, `csamHashMatch` dispatches to it, screenForPublish passes only already-public image URLs at published+ scopes. Caveat in the PR: "Camera Shield open tokens" could not be identified as a published API from public sources, so no second endpoint was fabricated — the WebPurify key is the operative credential; a Camera Shield token/endpoint from Ramaj drops in as a small follow-up.
| Q5 | Foundry publish moderation hook — route through concord-moderate instead of the stub floor checks | A#32 | S | FIX-ALL |
| Q6 | Fitness beacon-status leaks position + full track after the beacon ended (anyone with the shareToken) | E-88 | S | FIX-ALL |
| Q7 | Daily lens: guard `javascript:` URLs in media fields | E-85 (partial row) | S | FIX-ALL |
| Q8 | CodeQL exclusion re-audit + suppression-ledger refresh (issue #949) | GH-949 | M | FIX-ALL |

## Tier 2 — Fake success / fake content / data integrity

| Q | Item | Rows | Size | Lane |
|---|---|---|---|---|
| Q9 | Studio durable jobs write stub audio buffers as completed artifacts — **fix in flight PR #1708** (merge, don't re-fix) | A#2, S-COV-1 | L | In flight |
| Q10 | World lore `lore_stub` returned with ok:true — **fix in flight PR #1710** | A#38, S-COV-2 | S | In flight |
| Q11 | WorldOsSurface fabricated citations (`@engineer_jane`) — **fix in flight PR #1711**; a real per-DTU citation lookup remains unwired afterwards | B#1 | M | In flight |
| Q12 | Art "Featured Artwork" hard-coded fake cards — **fix in flight PR #1717** | B#2 | S | In flight |
| Q13 | Agent-loop returns `"dispatched"` when no dispatcher ran | A#33 | S | FIX-ALL |
| Q14 | DEMO tiers still declared on 6 lenses (law, realestate, insurance, automotive, defense, telecommunications) — make real or honestly re-tier | C-G2 | L | FIX-ALL |
| Q15 | SIM_GRADE_A tiers: creator + forecast (and ~45 total) — wire native handlers or honestly re-tier | C-G3, C8 | L | FIX-ALL |
| Q16 | DTUExportButton exports empty `data={{}}` from 31 call sites | C-G1 | S | FIX-ALL |
| Q17 | Travel place-save flips a global `saved` flag on the shared place record (cross-user corruption) | E-81 | S | FIX-ALL |
| Q18 | Events seat-assign removes the guest from all tables before the table-full check (failed assign loses the seat) | E-80 | S | FIX-ALL |
| Q19 | SRS deck-delete orphans sub-decks (PR #1714 does not fix this) | E-86 | S | FIX-ALL |
| Q20 | Pets delete cascade misses photos / appointments / lostProfiles | E-87 | S | FIX-ALL |
| Q21 | Cooking: counted pantry quantities never subtracted; full qty pushed to shopping list | E-91 | S | FIX-ALL |
| Q22 | Meditation: re-completing a course day inflates the session count | E-92 | S | FIX-ALL |
| Q23 | Agriculture field-update accepts acreage −50 / 5e9 (no bounds) | E-96 | S | FIX-ALL |
| Q24 | Travel trip end-before-start still clamped instead of rejected | E-82 | S | FIX-ALL |
| Q25 | LoRa mesh fragment headers carry `dtuHash "00000000"` — fragmentDTU never passes the hash | B#17 | S | FIX-ALL |
| Q26 | Media thumbnail endpoint returns a JSON path note, never image bytes (frontend already works around via /stream) | B#19, S-NEW-1 | M | FIX-ALL |
| Q27 | Macro-depth headline artifact (0.999) contradicts the honest grader (0.689) — regenerate / promote the honest artifact | B#30 | M | FIX-ALL |
| Q28 | Money-guard INC group (114/121/123/131/133): re-run each repro as a test, then close | E-114 | M | FIX-ALL |

## Tier 3 — Broken features

| Q | Item | Rows | Size | Lane |
|---|---|---|---|---|
| Q29 | Studio artifacts written by durable jobs have no read path (reads are a TODO; artifacts.js reads a different table) | A#1 | M | FIX-ALL |
| Q30 | reasoning/execute never calls the real selectBrain (503 when STATE not injected) | A#37 | S | FIX-ALL |
| Q31 | Studio BouncePanel publishes a 220 Hz placeholder tone instead of a real mix render | B#3 | L | FIX-ALL |
| Q32 | callMcpSafe returns `not_implemented_inline` for dtu_list / federation_peers | B#20 | M | FIX-ALL |
| Q33 | cslProofsRun returns `not_loaded` for every obligation | B#21 | M | FIX-ALL |
| Q34 | embeddingSearch returns recent rows regardless of query | B#22 | L | FIX-ALL |
| Q35 | Production-grade lens CI gate is soft-fail AND no workflow invokes it | B#29 | L | FIX-ALL |
| Q36 | Core E2E job is `continue-on-error: true` — failures cannot block a merge | B#31 | S | FIX-ALL |
| Q37 | Nightly gates failing: CI #1529, audits #1530, adversarial audit #1663 — read the failing runs, fix or ratchet with a reason | GH-1529/1530/1663 | M | FIX-ALL (verify via GitHub Actions) |
| Q38 | Whiteboard embed `previewImage` is typed and populated but never rendered | B#12 | M | FIX-ALL |
| Q39 | PM2 frontend app block lacks restart defaults its sibling apps have | B#18 | S | FIX-ALL |
| Q40 | Emergent lens proposals are produced but never persisted/queued/applied — no consumer exists | A#24 | L | FIX-ALL |
| Q41 | Computer-use launches an ephemeral browser per action (no session/login persistence) | A#36 | M | FIX-ALL |

## Tier 4 — Missing features / solvers

| Q | Item | Rows | Size | Lane |
|---|---|---|---|---|
| Q42 | ConKay long-term limit states: `corrosion.galvanic` solver + `fatigue` and generic `corrosion` applicability domains | K1, K2, A#15 | L | FIX-ALL |
| Q43 | Knowledge-extension stubs: 11 domains store fields without validating (only `materials` is real) | A#29 | L | FIX-ALL |
| Q44 | Assembly-mates Euler stub — solve driven-part orientation instead of zeroing off-axis angles | A#27 | M | FIX-ALL |
| Q45 | ERP BOM costs are rate stubs — accept a real vendor price source (import) instead of hard-coded $/kg | A#28, B#27 | M | FIX-ALL |
| Q46 | Melody generation `not_yet_wired` in creative domain | A#7 | M | FIX-ALL |
| Q47 | Marketing email engagement tracking (opened/clicked always null) | A#8 | M | FIX-ALL |
| Q48 | Per-entity reflection tracking for agent reasoning traces | A#13 | M | FIX-ALL |
| Q49 | Repair network is local-only stub — activate the specced sync protocol behind its env vars | A#25 | M | FIX-ALL |
| Q50 | Prosthetics: slice a real mesh for G-code; telemetry is synthetic by design (printer side is Mac/pod) | A#30, B#26 | M | FIX-ALL (part Mac) |
| Q51 | evo-asset detail_maps pass runs only with injected vision/image deps — wire real deps | A#31 | M | FIX-ALL |
| Q52 | Survival disease recovery is a stub rule | A#35 | M | FIX-ALL |
| Q53 | Federation pod peering is protocol-only (no HTTP) — federation transport completion | A#23 | L | FIX-ALL |
| Q54 | Insurance claim photo attach ("coming soon" disabled button) | B#4 | M | FIX-ALL |
| Q55 | MobileCompanion Marketplace / Royalties quick actions are dead `comingSoon` buttons | B#5 | S | FIX-ALL |
| Q56 | Cinematic camera transport is inert-by-construction (THREE camera never moves) | B#6 | M | FIX-ALL |
| Q57 | Whiteboard multi-select + ⌘A (needs the multi-selection model first) | B#7 | M | FIX-ALL |
| Q58 | Formant shift in the DAW pitch DSP | B#8 | M | FIX-ALL |
| Q59 | Media collections panel is static copy — wire real collections data/actions | B#9 | M | FIX-ALL |
| Q60 | JetBrains plugin is scaffold-only (placeholder rows, no LSP listener) | B#16, B#10 | M | FIX-ALL |
| Q61 | World creator has only 3 templates | B#32 | M | FIX-ALL |
| Q62 | Research "Analyze library": `evaluate-source` / `find-gaps` / `match-questions` still genuinely unsurfaced (already recorded by the L15a batch) | Lens-spec pass §2b note | M | FIX-ALL — **done 2026-10-28**: `AnalyzeLibrarySection` added to ResearchLibraryPanel (collapsible sibling of Highlights, same pattern): coverage gaps (find-gaps, optional topic), question→source matching (match-questions, click a match to open the reference), and per-source credibility (evaluate-source over the loaded references, signals shown as chips). Backend errors surface as-is (empty library → "references required"). 4 vitest pins in ResearchLibraryPanel.test.tsx (Mac-run) |
| Q63 | Macro-depth behavioural tests for the ~364 important-untested macros (the depth program; issue #850) | D1, D3, D14, GH-850 | L | FIX-ALL (program) |

**Q63 TRANCHE 1 DONE (2026-10-28) — the program's instrument is restored; the program itself continues (row stays partial).** The depth grader (`scripts/grade-macro-depth.mjs`) was **never committed** — `git log --all` for the path was empty while its test + both backlog docs referenced it, so grade-macro-depth.test.js failed on a clean tree and no count could be regenerated. The grader is rebuilt from the surviving spec (pinned test invariants + the STUB_UPGRADE_BACKLOG rubric/weights) and the pinned suite passes 4/4. **New baseline at the chain tip: 9,826 macros graded; default weighted 0.690, honest weighted 0.654 (honest totals: 504 stub / 7,482 functional / 237 utility / 1,603 production-grade).** Not comparable to the May series (0.898 at HEAD 6483307 over 8,442 macros) — different tree and rebuilt heuristics, stated in the script header. Known deliberate undercount: domain-harness invocations (registrar-capture `call()` helpers) are real invocations but not yet credited, so honest is a floor. Remaining program work (the ~120 priority behavioral tests from DEPTH_IMPORTANT_BACKLOG) stays queued under this row + GH-850.
| Q64 | ZSTD compression id reserved but unimplemented (falls back to gzip silently) | B#23 | S | FIX-ALL |

**Q64 DONE (2026-10-28)** — the audit's premise expired: Zstd IS in Node core zlib since v22.15 (verified on the current runtime), so id 3 is now implemented for real — `zstdCompressSync`/`zstdDecompressSync` behind a `ZSTD_AVAILABLE` feature-detect; selectAlgorithm picks Zstd for generic binary ≥64KB (gzip/brotli policy otherwise unchanged), decompress decodes id 3 properly and throws an honest 'runtime lacks Zstd' error on pre-22.15 Node instead of silently gunzipping. 4 new tests; suite 35/35 locally.
| Q65 | OpenStax coverage is a fixed 16-book subset with deferred indexing | B#25 | M | FIX-ALL |

**Q65 DONE (2026-10-28) — split verdict.** (a) The lookup tool's 16-book `DEFAULT_BOOKS` set is **deliberate, documented STEM scope** (openstax-lookup.js header: 'science, engineering and math references' for a chat/ConKay fact tool) with honest lazy indexing (`pending` note) — not a stub; left as designed. (b) The corpus-ingest pull was a real defect: every cycle fetched catalog page 1 + chapters 1–3 forever (its 'round-robin' comment was false), so books 21+/chapters 4+ were unreachable while the daily budget burned on repeats. Fixed with a rotating window (`_openstaxCursor` + pure `_nextOpenStaxWindow`): chapter window +3/cycle wrapping at the longest TOC, catalog offset +20 when a page is fully consumed, wrapping after a short final page; window exposed in getCorpusIngestStatus. 6 new tests + openstax-lookup suite 12/12 locally.
| Q66 | 50-capabilities roadmap: remaining ~30 rows never individually verified — verify, then queue what's real | D6 | L | Audit follow-up |

**Q66 VERIFIED (2026-10-28)** — every roadmap claim re-checked against the tree. **Build-progress DONE items (20): all real** — 34/34 named libs/domains present (cognitive-fingerprint, cognitive-replay, goal-decomposition + decomp, long-horizon-planner + planner, shadow-council, contribution-quests + contrib, music-resonance + musicres, license-revocation + licensing, hypervector + ethics-his + his, maker-checker + orchestrate, governance-sim, invariant-geometry + invgeo, signal-tomography + tomography, robotics-persistence, haptic-encode + haptic, scene-export + scenebridge, style-transfer + styletx, conkay-affect, federation-mesh + fedmesh, rnd) and 10/10 migrations (339–348); macro spot-checks pass (`rnd.run`, `metacog.fingerprint`, `literary.resonance_graph`; shadow-council consumed by reason.js/orchestrate.js). **Matrix rows (50): 43/45 cited files exist** (several at corrected roots — `server/emergent/` not `lib/emergent/`, glyph-spells + dtu-portability are domains not libs; the matrix's shorthand paths are loose, the files are real). Two exceptions: **#42** council-session-cycle is real but consolidated into `server/emergent/concordia-cycles.js:119` (no standalone file); **#25** Sensor Fusion's cited mobile file is **absent from this repo entirely** (no concord-mobile/ tree) — UNVERIFIED here, needs the mobile repo/Mac. Wiring spot-checks: hypothesis-engine now has 10 server.js refs (Tier-0 wiring landed; the matrix's ⚙️ is stale in the good direction); **ghost-threads still 0 refs** — its retire/merge-into-LRL decision is the one genuine remainder, queued as Q78. D6 below is done with those two caveats.
| Q77 | Command-center paging via Web Push (`server/lib/push.js`) — SMS/Twilio declined by founder decision 2026-10-28 | A#6 | M | FIX-ALL (added 2026-10-28) |
| Q78 | Ghost Threads (#1): still 0 server.js refs; matrix says retire in favor of LRL resonance or merge its surfacing UI onto literary_resonance_edges — decide + execute | D6/Q66 | S | FIX-ALL (added 2026-10-28) |

**Q78 VERDICT CORRECTED (2026-10-28) — Ghost Threads is LIVE; do NOT retire.** The '0 server.js refs' premise was a grep artifact: server.js reaches the module three other ways. (1) `server/emergent/index.js:837-841` imports its full API and re-exports it in the emergent namespace (:3370-3373), and server.js imports that index (`initEmergent`, server.js:157). (2) `server/domains/output-hooks.js` — registered from server.js as the Phase J4 macro surface — wraps `server/lib/output-hooks.js`, which calls `findRelevantInsights()` on output passes. (3) `server/emergent/dream-cycle.js:130` dynamically imports `runGhostThread` for its Phase-3 CONNECT step. Deleting it would break all three. The matrix's retire/merge recommendation is **rejected on evidence**; LRL resonance and Ghost Threads coexist (resonance graph vs cross-domain insight surfacing). Q78 closed as verified-live, no code change — same pattern as Q75's Foundry verdict correction.

**Q77 DONE (2026-10-28)** — `pageViaPush` in commandcenter.js wraps `lib/push.js#sendPush` (best-effort, fire-and-forget, globalThis test hook mirroring emitOrgRealtime's). Wired at both page points: alert-rule fire (pages resolved on-call for org scope, rule owner for solo scope) and incident open (pages the stamped onCallAt). The two stale 'SMS not implemented' comments now record the founder decision. 5 new tests in command-center-web-push-paging.test.js.

## Tier 5 — Polish / docs

| Q | Item | Rows | Size | Lane |
|---|---|---|---|---|
| Q67 | Lens-spec maps: correct the 21 stale counts + 7 stale "unsurfaced" dispositions (one docs-only PR) | L1–L21, U1–U7 | S | FIX-ALL |

**Q67 DONE** — corrected in the Q67 docs PR (branch `docs/lens-spec-count-corrections`, stacked on the audit PR #1730); rows L1–L21 and U1–U7 below are marked done.
| Q68 | `offline.*` spec prose downgrade decision (mergeResolve / replicationPush/Pull / syncCheckpoint / backoffSchedule) | D5 | S | Needs Ramaj (wording call) |

**Q68 DONE (2026-10-28)** — founder approved the downgrade; executed in the Q68 docs PR: a Scope paragraph in `docs/lens-specs/offline-capability-map.md` pins the sync to personal local synchronization (browser IndexedDB ⇄ the server's in-memory per-user state), with matching scoping in `offline.md` and the FEATURE_UPGRADE row marked executed. D5 below is done.
| Q69 | guidance.js: project explicit columns for the 19 `SELECT *` TODOs | A#3 | S | FIX-ALL |

**Q69 DONE (2026-10-28) — split verdict, verified per call site.** 7 of the 19 sites projected to exactly the columns their consumers read (3 events queries — incl. `request_id`, caught on re-read; guided-publish listing; 3 preview-action reads). The other 12 are **deliberate** `SELECT *`, now documented in place instead of carrying the auto-fix TODO: 10 entity-graph/API pass-throughs (the whole row IS the response) and 2 undo snapshots (`previousState` must carry every column or undo restores lose data — projecting them would have been a data-integrity regression). A#3 + S-COV-4 done.
| Q70 | csl-core per-macro lock hook is reserved-but-unconsulted — wire or remove the dead hook | A#4 | S | FIX-ALL |

**Q70 DONE (2026-10-28) — REMOVED, not wired.** Wiring it in would break Sprint 33's pinned unconditional-waiting semantics (documented twice in csl-core.js itself); its only claimed caller, server/tests/csl-lock.test.js, **does not exist** — zero references anywhere. Method + TODO deleted; _lockedRunMacro docblock records the removal and the reason. csl-proofs 21/21 green before and after. A#4 + S-COV-5 below are done.
| Q71 | Add the missing `ds.skeleton` design token and migrate Skeleton.tsx | B#11 | S | FIX-ALL |

**Q71 DONE (2026-10-28)** — `skeleton` token added to design-system.ts (`animate-pulse bg-lattice-border/50`, the exact classes the component already used, so rendering is unchanged) and exported on `ds`; components/ui/Skeleton.tsx now reads `ds.skeleton` and the TODO is gone. 1 new token pin in design-system.test.ts.
| Q72 | Tower interior: header promises a spiral staircase the builder never makes | B#13 | M | FIX-ALL |

**Q72 DONE (2026-10-28)** — `buildSpiralStaircase` added to interior-decor.ts (stone newel + helical stone steps, one full turn over 92% of room height, wooden balusters + landing) and wired into the tower case; the standing torch moved to the opposite corner so the stair sweep is clear. Header promise no longer says 'mock'. 1 new vitest pin (steps climb >4m).
| Q73 | WebSpeech fallback returns a synthetic lip-flap envelope (Piper path is real) | B#14 | S | FIX-ALL |

**Q73 DONE (2026-10-28)** — the sine flap is replaced by `createSpeechActivityEnvelope` in piper-stream.ts: an event-driven speech-activity level (utterance start/boundary/end) that fabricates no amplitude; 0 while silent, steady 0.3 while speaking without boundary events, 0.75 decaying on word boundaries. Interface + consumer comments now describe both paths honestly. 4 new vitest pins.
| Q74 | Autoloop dead `run()` stub + its dead import in guard.mjs | B#28 | S | FIX-ALL |

**Q74 DONE** — stub and dead import removed together, exactly as the stub's own doc comment instructed ("Whoever next cleans up guard.mjs's dead import should delete this stub in the same commit"). Verified: guard.mjs never called `run()`; no other autoloop script imports it (loop/next/status/verify all use `runArgv`).
| Q75 | Dead code cleanup: foundry "stub" badge branch (can no longer be true), uncalled `phase2Stub()` | S-NEW-2, S-NEW-3 | S | FIX-ALL |

**Q75 DONE** — `phase2Stub()` removed (S-NEW-3). The foundry half was **corrected on fuller evidence** (S-NEW-2): the `stub` status is designed catalog machinery (registry design comment + palette/canvas badges + ConfigPanel explainer + compiler advisory), not a dead branch — retained; see the corrected S-NEW-2 row.
| Q76 | Gemini/Mistral free-tier RPM defaults are unverified placeholders (env-overridable) | B#24 | S | FIX-ALL |

**Q76 DONE (2026-10-28)** — verified against the providers' own publications: Google's rate-limits doc (updated 2026-10-26) defers to the per-project AI Studio table, which lists gemini-3.6-flash (the exact conscious/vision model) at **5 RPM** free — google defaults corrected 15 → 5. Mistral publishes **no** public free-tier RPM (console-only, verified) — its 10 RPM default is kept as a documented fail-closed choice with the override path named in the file header. B#24 below is done.

## For zuko (Mac-only — no PRs; from the rows below)

- **Pod / host state:** pod down since 2026-10-26 (F-POD), off-site backup
  stale since 2026-10-20 (F-BKP), disk 93% (F-DISK), swap ~80% + the
  unattributed hourly stall (F-SWAP, E-100) — all live-host state, none
  re-verifiable from a checkout.
- **Live checks backlog:** F-SHA (live FE SHA), F-LIVE (#1660 WHO,
  #1662/#1665 food, #1658 restart persistence, browser console errors),
  C5-6 (crypto/timeline empty export), C10-12 (browser proofs), D-P1b,
  D-P4 (harness readback), D-Z2.
- **Deploy scripts:** D-Z1 — ROLLED_BACK markers absent from
  deploy-be.sh / locked-deploy.sh (scripts are Mac-only; the audit's
  zero-hit finding stands unconfirmed from here).
- **Mac-only claim sources:** the 24 UNVERIFIED INCs (claims live in
  `~/.zuko/CONCORD_USABILITY_LOG.md`), INC-144 (live pod behaviour),
  E-94a group live retest, TRIAGE.md items (D-T4), CONCURRENCY_WHATS_LEFT
  canonical file (D7), LENS-SWEEP-LEFTOVERS / CHAT-COCKPIT / AURA-ROADMAP
  (absent from the repo — confirmed by tree search).
- **External engines on the pod:** K3 (real OpenFOAM run), K5 (CalculiX
  binary), K7 (Cantera), K8 (OCC certification files), B#15 (Unity
  `concordia:cmd` receiver — Unity work), B#33 (hub cities, cited code not
  locatable from this checkout), B#34 (AURA raid roster runtime binding).

## Needs Ramaj (decisions, listed per Step 2)

1. **CSAM provider (A#16):** which provider (Thorn / PhotoDNA /
   Cloudflare) and its credentials — the code path cannot be finished
   without an account.
   **RESOLVED 2026-10-28:** WebPurify API core + Camera Shield open tokens for production credentials; non-blocking for local text/offline; cloud payload strictly isolated to public user-generated attachments in the social and marketplace hubs. Wiring proceeds as the Q4 fix item.
2. **SMS paging (A#6):** Twilio (or another provider) account, or decline
   the feature and mark command-center paging out of scope.
   **RESOLVED 2026-10-28:** DECLINED — no Twilio/SMS. Command-center paging routes through the existing Web Push architecture (`server/lib/push.js`) at zero runtime cost. Implementation added to the queue as Q77.
3. **Issue #1127 "AEITHERFIX":** the body is empty (`### `) — close it or
   say what it was meant to track.
   **RESOLVED 2026-10-28:** closed as obsolete/duplicate with a comment recording the decision (GitHub state_reason `not_planned` — `duplicate` requires naming a duplicate target and the issue has no content to duplicate). Open issues drop from 6 to 5.
4. **offline.\* prose (D5/Q68):** approve downgrading the four spec
   helpers' "live cloud sync" wording to match the implementation.
   **RESOLVED 2026-10-28:** approved and executed — see Q68 above.

---

---

# ROW TABLES

The four verification passes follow, verbatim. Row IDs are the join keys for the ranked queue above.

---

## Pass 1 — GLM sections A + B re-confirmation

# Re-confirmation — Audit Sections A + B (GLM r01 / r02)

**Date:** 2026-10-28 · **Tree:** `~/workspace/handoff3/wt-audit` @ main `02910bbb` (read-only; no repo code edited, no PRs opened)
**Source:** `~/workspace/user/files/REMAINING-WORK-AUDIT-2026-10-28.md`, sections A (46 rows) and B (44 rows)

## Method

- Every OPEN and PARTIAL row in A (22 + 4) and B (23 + 10) was re-verified against the current code in wt-audit by grepping the cited file/function/component by content (line numbers drift; current lines are cited in Evidence). B#34 (the audit's one UNVERIFIED B row) was also attempted and is included as a 60th row for completeness.
- wt-audit is a sparse checkout; rows whose files live outside the sparse dirs were verified via `git grep` / `git show HEAD:<path>` in the same checkout (marked *(git-only)* in Evidence).
- Open-PR accounting: a row fixed only in an open, unmerged PR is **partial** with evidence "fix in flight: PR #NNNN". PR worktrees checked: `wt-fix-studio` (#1708), `wt-fix-lore` (#1710), `wt-fix-art` (#1717), `wt-fix-cal` (#1712), and the lens-batch worktrees `wt-l1`–`wt-l16b` (#1704–#1726).
- DONE requires the fix to be present in wt-audit (main) itself, with a code citation. **No A or B row is done in main.**

## Counts (59 required rows + B#34)

| Section | Rows checked | open | partial | done | obsolete | UNVERIFIED |
|---|---|---|---|---|---|---|
| A — Server markers | 26 | 20 | 6 | 0 | 0 | 0 |
| B — Frontend/other markers | 34 (incl. #34) | 20 | 13 | 0 | 0 | 1 |
| **Total** | **60** | **40** | **19** | **0** | **0** | **1** |

Headline findings: A#29's stub count drifted 10 → 11. A#2's "zero-byte" buffers are zero-*filled* `Buffer.alloc(1024)`/`Buffer.alloc(512)` placeholder audio stored as completed artifacts. B#30 is worse than claimed: the honest grader file shows 525 stub + 1,631 functional of 9,835 macros (weighted 0.689), not "~30 shallow macros", while the headline artifact still reads 0.999.

Top-15 cross-reference (items sourced from A/B): #3 Studio stubs = A#2 (partial, #1708); #5 Fake content = B#1 (partial, #1711), B#2 (partial, #1717), A#38 (partial, #1710); #6 Fake success = A#33 (open), A#38 (partial); #10 Media thumbnail = B#19 (open); #11 CSAM stub = A#16 (open); #14 2FA = A#9 (open). Top-15 #4 (DTUExportButton) and #9 (DEMO tiers) come from section C, not A/B, and are out of this file's scope.

## Section A — Server code markers (GLM r01)

| ID | Claim | Source | Verdict | Evidence | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| A#2 | Studio render/vocal/master write stub buffers | durable.js:688-700, 791, 827 | partial | Still in main: `server/durable.js:695` `Buffer.alloc(1024); // Stub artifact — replaced when real audio worker processes the job`; :791 `Buffer.alloc(512)` (vocal); :827 `Buffer.alloc(1024)` (master). Fix in flight: PR #1708 (`wt-fix-studio`, uncommitted `M server/durable.js` + new test; diff vs its HEAD 160 lines) removes all three stubs and fails jobs honestly — unmerged | Off-Mac | L | P1 |
| A#3 | 19 SELECT * TODOs in guidance.js | guidance.js (no line in audit) | done (Q69, 2026-10-28 — 7 projected, 12 documented-deliberate) | `server/guidance.js`: `grep -c "SELECT \*"` = 19; matching `// TODO: project explicit columns` at lines 153, 259, 265, 272, 277, 285, 296, 300, 303, 310, 328, 413, 526, 573, 585, 648, 691, 700, 713 | Off-Mac | S | P4 |
| A#4 | csl-core per-macro lock not implemented | csl-core (no line in audit) | done (Q70, 2026-10-28 — hook removed) | `server/lib/csl-core.js:74` `// TODO: read macro metadata from MACROS registry when available`; :64-68 `_isLockedMacro()` "NOT currently consulted by _lockedRunMacro … reserved hook for future per-macro selective locking" | Off-Mac | S | P4 |
| A#5 | Fly-mode capability gate missing | server.js:11522 | open | `server/server.js:11523` `// TODO(Phase 3b): "fly" has no real capability gate yet … any authenticated user can currently request it` (mount/vehicle modes at :11512ff are gated; fly is not) | Off-Mac | M | P1 |
| A#6 | SMS/Twilio paging not implemented | (no line in audit) | done (Q77, 2026-10-28 — SMS declined by founder decision; paging via Web Push) | `server/domains/commandcenter.js:517` `// Real SMS/phone paging (Twilio etc.) is intentionally NOT implemented here — that requires an external provider + account credentials`; repeated :1251. No twilio file anywhere under `server/` | Mac-only | M | P3 |
| A#7 | Melody generation not_yet_wired | creative.js:64 | open | `server/domains/creative.js:64` `return { ok: false, reason: "not_yet_wired", error: "Melody generation is not yet implemented." }` (image/text kinds wired; melody is not) | Off-Mac | M | P3 |
| A#8 | Email engagement tracking missing | marketing.js:828 | open | `server/domains/marketing.js:828` `note: "engagement tracking not implemented"`, with `opened: null, clicked: null` on the send result at :826-827 | Off-Mac | M | P3 |
| A#9 | 2FA not implemented | settings.js:524 | open | `server/domains/settings.js:524-538`: "Two-factor auth is not implemented (no TOTP/WebAuthn enrolment exists and the login flow has no second step)"; :538 `twoFactorAvailable: false` | Off-Mac | M | P1 |
| A#13 | Per-entity reflection tracking missing | agent-runtime.js:448 | open | `server/lib/agent-runtime.js:448` `note: "Reflection is in-memory per session. Per-entity tracking not implemented; see agent_reasoning_traces table."` | Off-Mac | M | P3 |
| A#15 | corrosion.galvanic solver missing | conkay/verification/coverage.js:50 | open | `server/lib/conkay/verification/coverage.js:52` lists `"corrosion.galvanic"` under "Long-term limit states (not yet implemented…)"; `server/tests/conkay-design-graph.test.js:199-200` asserts status `"not computed"` / `/no corrosion.galvanic solver/`; no solver file under `server/lib/conkay/` | Off-Mac | M | P3 |
| A#16 | CSAM/NCMEC content-safety provider stub | content-safety/providers.js:52 | done (Q4, 2026-10-28 — WebPurify wired; see Q4 note) | `server/lib/content-safety/providers.js:52` `return { ok: false, reason: "provider_unimplemented" };` in `csamHashMatch()` — Thorn/PhotoDNA/Cloudflare wiring and NCMEC report path are only a comment at :49-51 even with `CONCORD_CSAM_PROVIDER` set | Mac-only | M | P1 |
| A#24 | Emergent proposals have no consumer | (no line in audit) | open | `server/emergent/lens-integration.js:313-330`: mutations return an inline `proposal: { type: "lens_action", … }` with `executed: false, requiresGovernance: true`, returned to the caller only; grep across `server/` finds no persistence/queue/apply/consume path (only an `emergentProposals: 0` metrics counter at :1073) | Off-Mac | L | P3 |
| A#25 | Repair network stub | (no line in audit) | open | `server/emergent/repair-network.js:5` `Currently a stub — local-only mode with the sync protocol specced and ready for activation via env vars.` | Off-Mac | M | P3 |
| A#27 | Assembly-mates Euler stub | (no line in audit) | open | `server/lib/conkay/assembly-mates.js:128` `// Euler stub: clear rotations that would twist off the free axis.` — `align_axis` zeroes the driven part's off-axis Euler angles (:129-137) instead of solving orientation | Off-Mac | M | P2 |
| A#28 | ERP BOM stub costs | (no line in audit) | open | `server/lib/conkay/erp-bom.js:180` cost source is `'vendor_override_stub'` / `'mass_x_material_rate_stub'`; :210 note "ERP-shaped BOM export LIVE — … vendor stubs, CSV+JSON, rollup cost stub." | Off-Mac | M | P2 |
| A#29 | Knowledge-extension stubs (10 claimed) | (no line in audit) | open | `server/lib/conkay/knowledge/extensions/index.js:44-75`: `STUBS` map registered with `status: "stub"` — count is now **11** (chemistry, fluids, recipes, engineering, math, electronics, biology, energy, agriculture, geology, software); only `materials` is real; stub fields "stored but not validated yet" (:37) | Off-Mac | L | P3 |
| A#30 | Bioprint telemetry stub | (no line in audit) | open | `server/lib/conkay/verticals/prosthetics.js:124` `/** Emit medical-printer-flavored G-code + extrusion telemetry stub. */`; output :211-214 `honesty: { stub: true, note: 'Extrusion telemetry STUB from synthetic toolpath — not live printer feedback', fda: false }` | Off-Mac | M | P3 |
| A#31 | evo-asset detail_maps unwired | (no line in audit) | open | `server/lib/evo-asset/scheduler.js:104` `(c) detail_maps still needs callImageGen, wired to an async()=>null stub in this build — OUT OF SCOPE, deferred as before.`; pass at :134-141 runs only if `deps.callVision && deps.callImageGen` are injected | Off-Mac | M | P3 |
| A#32 | Foundry publish moderation stub | (no line in audit) | open | `server/lib/foundry-publisher.js:46-47` `// 2. Lightweight content sanity — moderation hook is a stub for now; real wiring routes through concord-moderate (Phase C absorbed lib).` Only hand-rolled floor checks run (:133-134) | Off-Mac | S | P1 |
| A#33 | agent-loop fake "dispatched" | agent-loop.js:53 | open | `server/lib/inference/agent-loop.js:53` `return JSON.stringify({ tool: call.name, status: "dispatched", note: "no_dispatcher_configured" });` — tool result claims dispatch when no dispatcher ran (the separate `server/lib/runtime/agent-loop.js` is a different module) | Off-Mac | S | P1 |
| A#35 | Survival disease recovery stub | (no line in audit) | open | `server/lib/survival-engine.js:216` `// recovery if currently low. (Stub recovery — real version would key …` inside the disease tick that sets `recovered_at` (:208-221) | Off-Mac | M | P3 |
| A#38 | World lore_stub returned with ok:true | routes/world-narrative.js:128-139 | partial | Still in main: `server/routes/world-narrative.js:128-139`, :133 `id: "lore_stub"` inside `return res.json({ ok: true, lore: { id: "lore_stub", text: "The Oracle is consulting the ancient records…" } })`. Fix in flight: PR #1710 (`wt-fix-lore`, uncommitted `M server/routes/world-narrative.js` + new `server/tests/world-narrative-lore.test.js`) replaces it with `res.status(503).json({ ok: false, status: "unavailable", reason: "lore_generation_unavailable", lore: null })` — unmerged | Off-Mac | S | P1 |
| A#1 | Studio artifacts read path (partial in audit) | (no line in audit) | partial | Still partial: writes exist (`server/durable.js` render/vocal/master INSERTs into `artifacts`), but `server/durable.js:290-291` `Reads of those rows are a TODO — tracked separately, would need a new endpoint or a unified table.`; `routes/artifacts.js` reads a different table (`route_artifacts`) | Off-Mac | ~M | P2 |
| A#23 | Federation transport (partial in audit) | (no line in audit) | partial | Still partial: real signed ActivityPub delivery exists (`server/lib/federation-outbox.js:101-159`, `signRequest`), and `server/lib/federation-mesh.js` makes real peer HTTP consults — but pod peering is protocol-only: `server/emergent/federation-peering.js:11-13` `NOTE: This module does NOT make actual HTTP calls. It defines the protocol and state management.` | Off-Mac | ~L | P3 |
| A#36 | Computer-use session reuse (partial in audit) | (no line in audit) | partial | Still partial: `server/lib/tools/computer-use-tool.js:114-118` `// In full impl, get browser from sandbox manager. For now: launch ephemeral browser for action.` + `playwright.chromium.launch(...)` / `newContext()` per call — no session/cookie/login persistence between actions | Off-Mac | ~M | P3 |
| A#37 | reasoning/execute selectBrain wiring (partial in audit) | (no line in audit) | partial | Still partial: `server/routes/reasoning.js:84-91` `// Minimal stub — full wiring requires selectBrain from server.js context.` — pulls `STATE?.BRAIN?.[brainRole]` / `STATE?.infer`, returns 503 `Brain not available for standalone reasoning` when not injected; never calls the real `selectBrain` (`server/lib/inference/router.js:44`) | Off-Mac | ~S | P2 |

## Section B — Frontend/other code markers (GLM r02)

| ID | Claim | Source | Verdict | Evidence | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| B#1 | WorldOsSurface mock citations shown as real | WorldOsSurface.tsx:4665 | partial | Still in main: `concord-frontend/components/world/WorldOsSurface.tsx:4665` `// Generate mock citations for demo`; :4671 `citedCreator: '@engineer_jane'` (plus `@materials_lab`, `@civil_sara`) set on every building click. Fix in flight: PR #1711 World redesign (`wt-l6`, uncommitted `M …/WorldOsSurface.tsx`) deletes the fabricated-citation block, replacing it with `setCitations([])` + an honest-state comment — unmerged; a real per-DTU citation lookup remains unwired | Off-Mac | M | P1 |
| B#2 | ArtMarketDesk fake "Featured Artwork" cards | ArtMarketDesk.tsx:600-612 | partial | Still in main: `concord-frontend/components/art/ArtMarketDesk.tsx:575` "Featured Artwork", :601 `// Placeholder cards`, :608 8 hard-coded titles `['Neon Dreams', 'Digital Horizons', … 'Fractal Mind']`. Fix in flight: PR #1717 (`wt-fix-art`, uncommitted diff + `tests/art-featured-empty.test.tsx`) deletes the cards for an honest "No artwork featured yet" empty state — unmerged | Off-Mac | S | P1 |
| B#3 | BouncePanel publishes 220 Hz placeholder tone | (no line in audit) | open | `concord-frontend/components/studio/BouncePanel.tsx:20-32` `bouncePlaceholder()` — "4-second sine-wave placeholder", `osc.frequency.value = 220`; publish flow :88-103 still ingests it (honest disclosure tooltip added, but no real mix render) | Off-Mac | L | P2 |
| B#4 | Insurance claim photos "coming soon" | (no line in audit) | open | `concord-frontend/components/insurance/ClaimTracker.tsx:91-92` disabled button `aria-label="Attach photos (coming soon)"` / "Attach photos (soon)" | Off-Mac | M | P3 |
| B#5 | MobileCompanion Marketplace/Royalties buttons dead | (no line in audit) | open | `concord-frontend/components/world-lens/MobileCompanion.tsx:53-54` `{ id:'qa-5', label:'Marketplace', comingSoon:true }`, `{ id:'qa-6', label:'Royalties', comingSoon:true }` | Off-Mac | S | P3 |
| B#6 | Cinematic timeline transport unwired | (no line in audit) | open | `concord-frontend/components/world-lens/CameraControls.tsx:294-308` "nothing yet moves the actual THREE.js camera… transport is inert-by-construction"; panel `title="Cinematic camera movement isn't wired yet"`; all transport buttons `disabled` | Off-Mac | M | P3 |
| B#7 | Whiteboard select-all (⌘A) missing | (no line in audit) | open | `concord-frontend/components/whiteboard/WhiteboardStudio.tsx:782` `// ⌘A intentionally not implemented yet — single-element selection model would need to extend to multi-select first`. (The L8 worktree `wt-l8` touches this file only for its greeting heading — not the ⌘A handler.) | Off-Mac | M | P3 |
| B#8 | Formant shift not implemented | (no line in audit) | open | `concord-frontend/lib/daw/dsp/pitch/core.ts:9` "Formant shift is not implemented"; also `components/studio/daw/PitchEditor.tsx:6` and `PitchCorrectCard.tsx:215` "Formant shift is not on this device" | Off-Mac | M | P3 |
| B#9 | Media collections static | (no line in audit) | open | `concord-frontend/components/photography/MediaCollectionsPanel.tsx:5` `/** Media-gallery collections stub — Lightroom albums live under Catalog. */`; the whole 15-line component renders only static copy + `{photoCount} photos in library` — no collections data or actions | Off-Mac | M | P3 |
| B#11 | Skeleton token missing | (no line in audit) | done (Q71, 2026-10-28) | `concord-frontend/components/ui/Skeleton.tsx:36-41` "design-system.ts doesn't yet carry a dedicated skeleton/shimmer token… TODO: migrate to `ds.skeleton`…"; fallback `SKELETON_BASE = 'animate-pulse bg-lattice-border/50'` still used | Off-Mac | S | P4 |
| B#15 | Unity bridge `concordia:cmd` has no receiver | (no line in audit) | open | Sender exists: `concord-frontend/lib/conkay/unity-bridge.ts:3` "Honest LIVE stub: browser → Unity WebGL iframe postMessage path", :187 `win.postMessage(msg, …)`. Receiver absent: `git grep "concordia:cmd" -- "*.cs" "*.jslib"` = 0 hits across all 201 Unity C# files *(git-only)* | Mac-only | L | P2 |
| B#16 | JetBrains placeholder rows | (no line in audit) | open | *(git-only)* `concord-jetbrains/src/main/kotlin/ai/concord/jetbrains/toolwindow/ConcordToolWindowFactory.kt:66` `// Placeholder rows demonstrating shape. Real rows are pushed by an LSP listener attached in a follow-up commit`; :97 placeholder LSP status check; `concord-jetbrains/README.md` "Status: Scaffold only (v0.1)" | Off-Mac | M | P3 |
| B#17 | LoRa contentHash zeroed | (no line in audit) | open | `server/lib/concord-mesh.js:327` `const dtuHash = opts.dtuHash ? opts.dtuHash.slice(0,8) : "00000000"`; `fragmentDTU` at :418-422 calls `createMeshPacket(chunks[i], null, { sequence, total, fragmented:true })` **without** `dtuHash` — every fragment header hash is `"00000000"` (per-fragment `fragmentHash` at :426 does exist) | Off-Mac | S | P2 |
| B#19 | /api/media/:id/thumbnail returns JSON, not image bytes | routes/media.js:523 | open | `server/routes/media.js:509` `router.get("/:id/thumbnail", …)`; :523-529 `// In production, serve the actual image file` + `res.json({ ok:true, mediaId, thumbnail, note:"In production, this returns an actual image with proper Content-Type" })` | Off-Mac | M | P2 |
| B#20 | callMcpSafe placeholder | (no line in audit) | open | `server/lib/agent-runtime.js:414-418` `async function callMcpSafe(…)` — "For Phase 1 we just return a placeholder noting the call shape", `return { status:"not_implemented_inline", … }`; callers at :134 (`dtu_list`) and :283 (`federation_peers`) still receive the stub | Off-Mac | M | P2 |
| B#21 | cslProofsRun returns not_loaded | (no line in audit) | open | `server/lib/mcp-tools.js:1146` `cslProofsRun`; :1153-1156 `// Return placeholder results.` → `status:"not_loaded", note:"Proof obligations require csl-proof-obligations.js to be loaded in the same process"` for every obligation | Off-Mac | M | P2 |
| B#22 | embeddingSearch placeholder | (no line in audit) | open | `server/lib/mcp-tools.js:1268` `embeddingSearch`; :1275-1284 `// Return the metadata of recent embeddings as a placeholder` — returns recent `embeddings_e5` rows regardless of query, `note:"Semantic search requires the embedding model loaded in-process"` | Off-Mac | L | P2 |
| B#23 | COMPRESSION_ZSTD unimplemented | dtu-compression.js:30 | done (Q64, 2026-10-28) | `server/lib/dtu-compression.js:30` `export const COMPRESSION_ZSTD = 3; // Placeholder — not in Node.js core`; `selectAlgorithm` never selects it and `compress()` falls back to gzip for unknown algorithms | Off-Mac | S | P3 |
| B#24 | Gemini/Mistral RPM placeholders | (no line in audit) | done (Q76, 2026-10-28) | `server/lib/platform-providers-budget.js:29-33` "Gemini and Mistral's exact current free-tier RPM were NOT independently verified… deliberately conservative placeholders"; defaults still placeholder values :56-57 `"google:conscious": 15`, :59-60 `"mistral:conscious": 10` (env-overridable) | Off-Mac | S | P3 |
| B#28 | Autoloop dead run() stub | (no line in audit) | done (Q74) | *(git-only)* `scripts/autoloop/lib.mjs:88-114` `@deprecated Inert compatibility stub — DO NOT call… export function run() { throw new Error("lib.mjs#run() was removed 2026-07-25 (command-injection fix) — use runArgv…") }`, kept only because `scripts/autoloop/guard.mjs` still has the dead `import { run }` | Off-Mac | S | P4 |
| B#29 | CI production-grade gate not strict | (no line in audit) | open | `concord-frontend/scripts/validate-production-grade-lens.ts:38` "Soft-fail by default (logs failures, exits 0)"; :156-157 soft-fail exit 0, `--strict` opt-in. Worse: no workflow invokes it — `git grep validate-production-grade` hits only `concord-frontend/package.json:28-29` and the script itself, no `.github/workflows/*` caller *(git-only)* | Off-Mac | L | P2 |
| B#32 | Only 3 world templates | (no line in audit) | open | `server/domains/world-creator.js:56` `const TEMPLATES = {` contains exactly 3 entries — :57 `forest_realm`, :68 `desert_outpost`, :79 `urban_sprawl` — served by the `templates` action :111-118. PR #1710 does not touch this file | Off-Mac | M | P3 |
| B#33 | 4 of 5 hub cities still status stub | (no line in audit) | UNVERIFIED | Could not locate the cited code in wt-audit: no 5-city status table in `server/lib/world-seeder.js` (`SEED_CITIES` = 4 blueprints + 2 aliases, no status field), `content/world/concordia-hub/*` (no "stub" hits), `ConcordiaHub.tsx`/`UrbanHub.tsx`, or `git grep "status:'stub'"` (hits are foundry/knowledge-extensions only). The Unity `apps/` tree is sparse-excluded/git-only and not searchable at file level here, consistent with the audit's Mac-only tag — not guessed | Mac-only | L | P3 |
| B#10 | Extension installer link (partial in audit) | (no line in audit) | partial | `concord-frontend/app/lenses/dx-platform/page.tsx:124,129` both ExtCard hrefs present (VS Code marketplace + `https://plugins.jetbrains.com/plugin/concord-dx`); VS Code side is real (repo `concord-vscode/` + dx-extension CI *(git-only)*), but the JetBrains plugin is scaffold-only (see B#16), so its installer link has no published plugin behind it | Off-Mac | ~S | P2 |
| B#12 | Whiteboard embed preview (partial in audit) | (no line in audit) | partial | Embeds are enriched and listed in `concord-frontend/components/whiteboard/WhiteboardCollabPanel.tsx:423-460`, and `EmbedRec.previewImage?: string` exists at :28 — but `previewImage` is never rendered anywhere in the whiteboard components (grep: only the type declaration); list shows icon/title/description/kind only | Off-Mac | ~M | P3 |
| B#13 | Tower staircase (partial in audit) | (no line in audit) | done (Q72, 2026-10-28) | `concord-frontend/lib/world-lens/interior-decor.ts:17` still promises "tower → spiral staircase mock + window slit + standing torch", but the `case 'tower'` implementation at :402-417 builds only a standing torch + window-slit glow — no staircase. Other archetypes (market/restaurant) did get real-mesh upgrades | Off-Mac | ~M | P4 |
| B#14 | WebSpeech envelope (partial in audit) | (no line in audit) | done (Q73, 2026-10-28) | Real Piper path computes a true amplitude envelope (`concord-frontend/lib/voice/piper-stream.ts:115-160`), but the Web Speech fallback at :205-212 still returns a synthetic flap: `getEnvelopeAt: () => 0.4 + 0.4 * Math.abs(Math.sin(seconds * 8))` | Off-Mac | ~S | P4 |
| B#18 | Supervisor restart defaults (partial in audit) | (no line in audit) | partial | `ecosystem.config.cjs:290-293` backend PM2 app has full defaults (`max_restarts:10, min_uptime:'30s', restart_delay:5000, exp_backoff_restart_delay:200`) and the Godot app :363-367 likewise, but the `concord-frontend` app block (:331 ff.) has only `max_memory_restart:'1G'` — no `max_restarts`/`min_uptime`/`restart_delay`/`autorestart` | Off-Mac | ~S | P3 |
| B#25 | OpenStax stubs (partial in audit) | (no line in audit) | done (Q65, 2026-10-28) | Lookup is now real (`server/lib/openstax-lookup.js`, 263 lines: archive fetch, per-book JSONL cache, scored search), but coverage is a fixed subset — :26-33 only 16 `DEFAULT_BOOKS` / 7 `SUBJECT_BOOKS` groups — and uncached books defer (:259-262 returns `pending` + "Still indexing N OpenStax book(s)"); corpus ingest (`server/emergent/corpus-ingest.js:96-118`) still caps at catalog `limit=20`, 3 chapters/book, 2,400-char summary | Off-Mac | ~M | P3 |
| B#26 | Prosthetics G-code (partial in audit) | (no line in audit) | partial | `server/lib/conkay/verticals/prosthetics.js:140` `/** Emit medical-printer-flavored G-code + extrusion telemetry stub. */` — G-code is genuinely generated (per-layer circular toolpath, written + hashed), but synthetic-geometry only (parametric socket, not a sliced patient mesh); telemetry self-declares `honesty: { stub:true, … }` (same module as A#30) | Off-Mac | ~M | P3 |
| B#27 | ERP (partial in audit) | (no line in audit) | partial | `server/lib/conkay/erp-bom.js:9` `/** Stub unit costs ($/kg) for rollup — NOT live vendor pricing. */` (hard-coded `MATERIAL_COST_USD_PER_KG`); :180 `costBasis: … 'mass_x_material_rate_stub' / 'vendor_override_stub'`; :210 "ERP-shaped BOM export LIVE — … vendor stubs, rollup cost stub. NOT SAP/Oracle." Export works; costs/vendors are stubs (same root as A#28) | Off-Mac | ~M | P2 |
| B#30 | Macro-depth floor / shallow macros (partial in audit) | (no line in audit) | partial | Grader now has an honest mode (`scripts/grade-macro-depth.mjs:637-638` *(git-only)* honest weights `{stub:0.0, functional:0.4, utility:0.6}` vs default `{0.2/0.6/1.0}`), but the shipped headline artifact still flatters: `audit/macro-depth.json` `weightedScore: 0.999` (2026-09-30) while `audit/macro-depth-honest.json` (2026-10-16) reads `weightedScore: 0.689` with **525 stub + 1,631 functional of 9,835 macros** — the shallow tail is far larger than the ~30 claimed | Off-Mac | ~L | P2 |
| B#31 | E2E continue-on-error (partial in audit) | (no line in audit) | partial | Infra tier is intentionally non-blocking (`concord-frontend/playwright-infra.config.ts:15` "marked continue-on-error so the gate stays informational… The core E2E job… is blocking"), but the core job isn't: *(git-only)* `.github/workflows/ci.yml:852` `e2e-core:` … `continue-on-error: true` (and `e2e-infra:` :1133 likewise) — core E2E failures still cannot block a merge | Off-Mac | ~S | P2 |
| B#34 | AURA raid roster (UNVERIFIED in audit) | (no line in audit) | partial | Design slice exists and self-reports complete — *(git-only)* `apps/concordia-living-world/unity-client/Assets/Concordia/Generated/NativeBible/slices/S23_raid_roster_coherence/SLICE_REPORT.md` "STATUS: COMPLETE… Nine seats… four quests", `RAIDS.json` present. But by its own honesty gaps it is text/design only ("Winning the clock spawns nothing until that floor exists", "No live play session was run. This slice is text"), and no code consumes it (`git grep "S23_raid\|RAIDS.json\|raid_roster" -- "*.js" "*.ts" "*.tsx" "*.cs"` = 0 hits). Runtime/Unity binding absent; upgraded from UNVERIFIED to partial on the design-slice evidence only | Mac-only | ~L | P3 |

## Rows that could not be verified

- **B#33 only.** The cited hub-city status code could not be located anywhere searchable in wt-audit (see its Evidence). It is marked UNVERIFIED, not guessed open or done. All other 59 rows were located and verified by content grep in the current tree or in a named open-PR worktree.
- Note on method limits: files outside the sparse checkout were checked via git object reads, not a working-tree walk; a file that exists only on the Mac (not committed) cannot be seen from here at all.

---

## Pass 2 — Stub/mock/placeholder remainder + sections C/D/E/F re-confirmation

# Stubs/Mock/Placeholder Triage (remainder) + Re-confirmation of Audit Sections C/D/E/F

Read-only audit, 2026-10-28. Checkout: `~/workspace/handoff3/wt-audit` at main `02910bbb`
(shallow clone, 173 commits — pre-window commits cannot be verified locally and are
marked UNVERIFIED rather than trusted). Source audit:
`~/workspace/user/files/REMAINING-WORK-AUDIT-2026-10-28.md`.
Open PRs at time of check: #1704–#1726 (Workstream B batches + lens fixes) and
#1727 (SEC Fix 8, DTU macros). A row fixed only in an open PR is PARTIAL
"fix in flight PR #NNNN".

## Method — Area 1

Fresh greps over `server/` + `concord-frontend/`, excluding `node_modules`, test
dirs and `*.test.*`. My unique-line counts (method differs from the audit's
499 stub/mock + 956 placeholder figures; these are my numbers, stated as mine):
stub **499**, mock **256**, placeholder **7,791** (of which `placeholder=`
**6,475**, `placeholder:` **277**, other **1,081**), TODO **356**, FIXME **31**,
"coming soon" **11**, `not_yet_wired` **1** — **8,857 unique lines total**.
Every non-comment, non-detector hit was hand-classified; comment hits were
classified by category with spot reads.

Headline result: **exactly one genuinely new user-facing stub** (S-NEW-1, media
thumbnail). Everything else remaining is benign terminology/tooling, honest
unavailable states, or already covered by audit sections A/B.

---

## Area 1a — NEW real open stubs / obsolete leftovers (individual rows)

| ID | Claim | Source | Verdict | Evidence (file:line or PR) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| S-NEW-1 | `GET /api/media/:id/thumbnail` never serves an image: `generateThumbnail` only fabricates a path string and the route returns JSON with note "In production, this returns an actual image with proper Content-Type" | This triage (not in audit A/B) | open | server/lib/media-dtu.js:837-848 (`dtu.thumbnail = thumbnails/${mediaType}/${mediaId}.jpg`, no bytes written); server/routes/media.js:509-530 (returns `{thumbnail: path, note: …}`); frontend already works around it via `/stream` — concord-frontend/components/animation/AnimationReferenceImages.tsx:15-19 | Off-Mac | S | P2 |
| S-NEW-2 | Foundry ConfigPanel renders a "stub" badge via a condition that can no longer be true — dead UI branch | This triage | done (benign, no work — CORRECTED at Q75: the `stub` status is designed catalog machinery, not a dead branch; the audit's one-component read missed the registry design comment at system-registry.js:29 (`'stub' — does NOT exist yet; built in Phase 7… the catalog is the single source of truth and Phase 7 just flips the flag`), the compiler advisory at system-registry.js:756, and the matching badges in ComponentPalette.tsx:110 and FoundryCanvas.tsx:461 plus the ConfigPanel explainer at :152. Zero of 36 systems currently use the state because Phase 7 shipped; the machinery stays for future systems) | concord-frontend/components/foundry/ConfigPanel.tsx:129 vs server/lib/foundry/system-registry.js: 0 of 36 systems carry `status:'stub'` (all "available // Phase 7 — built"); the skip mechanism at server/lib/foundry/compiler.js:60-61 therefore always yields `skippedStubs: []` | Off-Mac | S | P3 |
| S-NEW-3 | `phase2Stub()` in agent-runtime is dead code (defined, zero callers); the layers it named are read by real readers in `rtSnapshot` | This triage | done (Q75 — function + banner removed; grep confirms zero references) | server/lib/agent-runtime.js:353 (definition; repo-wide grep finds no other reference); honest shape anyway — returns `{status:"unavailable"}` | Off-Mac | S | P3 |

## Area 1b — Benign aggregates (counts are lines from my grep; examples are exact)

| ID | Claim | Source | Verdict | Evidence (file:line or PR) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| S-BEN-1 | `placeholder=` HTML input attributes — UI hint text, not fake data: 6,475 lines | This triage | done (benign, no work) | e.g. concord-frontend/components/agriculture/ImageryPanel.tsx:52 `placeholder="Field ID"`; concord-frontend/components/srs/SrsWorkbench.tsx:953 `placeholder="Front image URL"` | Off-Mac | — | — |
| S-BEN-2 | Tailwind `placeholder-*` styling classes + CSS `::placeholder` rules inside the non-attribute remainder: ~596 class lines + 24 lines in globals.css | This triage | done (benign) | concord-frontend/app/globals.css:602 `.chat-input::placeholder`; classNames e.g. concord-frontend/app/admin/wires/page.tsx:255 `placeholder-zinc-500` | Off-Mac | — | — |
| S-BEN-3 | `placeholder:` config keys = form-field hint text in domain field schemas: 277 lines | This triage | done (benign) | server/domains/ops.js:212-215 (`{ name: "summary", placeholder: "1-2 sentence summary…" }`) | Off-Mac | — | — |
| S-BEN-4 | SQL `?` bind-parameter variables named `placeholders`: ~157 lines | This triage | done (benign) | server/domains/dreams.js:491-493; server/domains/sessions.js:632; server/economy/storage.js:161-163 | Off-Mac | — | — |
| S-BEN-5 | Template `{{variable}}` placeholders and placeholder-substitution logic in the template/custom-DTU engines | This triage | done (benign) | server/domains/custom.js:160-164 | Off-Mac | — | — |
| S-BEN-6 | "stub" = pay stub (payroll domain term) across accounting/hr: ~45 lines | This triage | done (benign) | server/domains/hr.js:821 `computeStub(emp, …)`; server/domains/accounting.js:2742-2743 pay-run `stubs.push({…})`; concord-frontend/components/hr/HrPayrollPanel.tsx | Off-Mac | — | — |
| S-BEN-7 | "Stu" substring false positives — Studio bucket helper `ensureStuBucket`: 61 lines in one file | This triage | done (benign) | server/domains/studio.js:1004 `function ensureStuBucket(state, key, userId)` | Off-Mac | — | — |
| S-BEN-8 | "T-stub" = AISC steel-connection engineering term (real solver, returns `notComputed` honestly when inputs are missing): ~25 lines | This triage | done (benign) | server/lib/conkay/physics/solvers/bolted-joint.js:1300,1315-1337; server/lib/conkay/compiler/design-ir.js:117-119 | Off-Mac | — | — |
| S-BEN-9 | Detector/tooling code that *finds* stubs/mocks/placeholders (its own vocabulary dominates the hits): stub 58 + mock 50 + placeholder 64 + TODO 30 lines under `server/lib/detectors/` alone, plus audit scripts (52 stub lines under scripts/) | This triage | done (benign) | server/lib/detectors/macro-stub-detector.js (36 stub lines); server/lib/detectors/fake-data-detector.js (32 mock lines); server/scripts/audit-lens-backends.js | Off-Mac | — | — |
| S-BEN-10 | Comment-start lines: 179 of 499 stub lines and 182 of 256 mock lines are comments; the mock comments are overwhelmingly "No mock data" honesty assertions | This triage | done (benign) | e.g. concord-frontend/components/cooking/CookMode.tsx:6 "no mock data"; server/domains/understanding.js:15 "No seed / demo / mock data" | Off-Mac | — | — |
| S-BEN-11 | "mock" in code = mockup (domain term), internal probe/benchmark mocks, and mock-detection rules: all non-comment mock code hits | This triage | done (benign) | server/domains/construction.js:232 submittal type `"mockup"`; server/lib/synthetic-journey-probe.js:133 `makeMockRes()`; concord-frontend/lib/lenses/product-lens-gate.ts:133-136 `no_mock_imports` gate | Off-Mac | — | — |
| S-BEN-12 | TODO hits are product data, not debt: task-status enums (`todo/doing/done`), the code lens's own TODO-scanner feature, and autofix marker strings: bulk of 356 lines | This triage | done (benign) | server/domains/cobuild.js:203 `byStatus todo/doing/done`; server/domains/code.js:2192-2203 TODO/FIXME tracker regex; server/lib/autofix/select-star.js:9 `TODO_MARKER` | Off-Mac | — | — |
| S-BEN-13 | FIXME: **zero** genuine FIXME comments in own code — all 31 lines are scanner regexes or tracker UI labels | This triage | done (benign) | server/domains/code-quality.js:229-231; concord-frontend/components/code/ProblemsPanel.tsx:85 "No TODO / FIXME comments found." | Off-Mac | — | — |
| S-BEN-14 | Honest-unavailable stub shapes: unconfigured messaging platforms get a stub adapter that returns `ok:false` with the reason and an `_stub` flag; computer-use returns `ok:false` errors when disabled/Playwright missing; ConKay tool-authoring shape stubs are never invoked (validator shape-check only) | This triage | done (benign) | server/lib/messaging/adapter-interface.js:45-65; server/lib/tools/computer-use-tool.js:97-110; server/lib/conkay-tool-authoring.js:104-123 ("stub bodies are never invoked") | Off-Mac | — | — |
| S-BEN-15 | "Coming soon" hits not in A/B: civic-bonds page shows an honest disabled state behind the `CONCORD_CIVIC_BONDS` kill-switch (feature off, stated plainly — not a fake); event-router "Coming soon" toast is an unreachable fallback (qa-5/qa-6 render disabled in the panel) | This triage | done (benign) | concord-frontend/app/lenses/civic-bonds/page.tsx:361-364; concord-frontend/lib/event-router.ts:60-61,98 | Off-Mac | — | — |
| S-BEN-16 | Image "placeholder" UI = honest empty-image fallbacks (icon shown only when no `imageUrl` exists) | This triage | done (benign) | concord-frontend/components/realestate/RealtorShell.tsx:135-142; concord-frontend/components/social/SocialCommerceTag.tsx:57-64; concord-frontend/components/photos/PhotoLightboxModal.tsx:101 "Honest degrade — never fabricate a placeholder image." | Off-Mac | — | — |
| S-BEN-17 | Test-fixture string `test_signature_placeholder` inside the lens-compliance self-test (structural encode check, not user data) | This triage | done (benign) | server/economy/lens-compliance.js:331 | Off-Mac | — | — |

## Area 1c — Already-covered hits re-confirmed in main (cite A/B row; status updated for open PRs)

| ID | Claim | Source | Verdict | Evidence (file:line or PR) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| S-COV-1 | A#2 — studio durable jobs return stub audio buffers | Audit A#2 | partial | Still in main: server/durable.js:695,791 (`Buffer.alloc(1024/512) // Stub artifact`); fix in flight PR #1708 (server/durable.js + server/tests/studio-durable-honest-jobs.test.js) | Off-Mac | M | P1 |
| S-COV-2 | A#38 — world narrative `lore_stub` returned while generation warms up | Audit A#38 | partial | Still in main: server/routes/world-narrative.js:129-133 (`id: "lore_stub"`); fix in flight PR #1710 (server/routes/world-narrative.js) | Off-Mac | S | P1 |
| S-COV-3 | B#1 — WorldOsSurface generates mock citations (`@engineer_jane`) | Audit B#1 | open | Still in main, no PR touches it: concord-frontend/components/world/WorldOsSurface.tsx:4665-4671 ("Generate mock citations for demo") | Off-Mac | S | P0 |
| S-COV-4 | A#3 — 19 `SELECT *` TODO markers in guidance.js | Audit A#3 | done (Q69, 2026-10-28) | grep count for server guidance.js TODO lines = 19, matches audit exactly (file: server/domains/guidance.js) | Off-Mac | S | P2 |
| S-COV-5 | A#4 — csl-core per-macro lock TODO (read macro metadata from MACROS registry) | Audit A#4 | done (Q70, 2026-10-28) | server/lib/csl-core.js:74 TODO inside `_isLockedMacro`, which its own docblock (:66-72) says is NOT consulted by `_lockedRunMacro` — reserved hook | Off-Mac | S | P2 |
| S-COV-6 | A#5 — Concordia "fly" mode has no capability gate | Audit A#5 | open | server/server.js:11523 `TODO(Phase 3b): "fly" has no real capability gate yet` | Off-Mac | M | P1 |
| S-COV-7 | A#7 — creative melody `not_yet_wired` (the tree's only `not_yet_wired` hit) + B#3 studio BouncePanel "coming soon", B#4 insurance ClaimTracker, B#5 MobileCompanion, B#6 world CameraControls cinematic | Audit A#7, B#3-6 | open | server/domains/creative.js:64; concord-frontend/components/studio/BouncePanel.tsx:91,103; concord-frontend/components/insurance/ClaimTracker.tsx:91; concord-frontend/components/world-lens/MobileCompanion.tsx:26,311; concord-frontend/components/world-lens/CameraControls.tsx:302 — all still present in main | Off-Mac | M | P1 |
| S-COV-8 | A#13/A#33 — agent-runtime phase layers + agent-loop "no dispatcher" stub | Audit A#13, A#33 | open | server/lib/inference/agent-loop.js:52 comment "No dispatcher available — return informative stub"; agent-runtime readers as in A#13 | Off-Mac | M | P1 |
| S-COV-9 | A#27/A#28/A#29 — ConKay covered stubs: assembly-mates Euler stub, ERP-BOM stub costs, knowledge-extension STUBS (stored, not validated, with warning emitted) | Audit A#27-29 | open | server/lib/conkay/assembly-mates.js:128; server/lib/conkay/erp-bom.js:180 (`vendor_override_stub`/`mass_x_material_rate_stub`); server/lib/conkay/knowledge/extensions/index.js:37,45,75 | Off-Mac | M | P2 |
| S-COV-10 | B#11 — Skeleton `ds.skeleton` token TODO; B#26 — prosthetics extrusion telemetry stub (self-labelled) | Audit B#11, B#26 | partial | concord-frontend/components/ui/Skeleton.tsx:38 TODO (token doesn't exist yet — honest); server/lib/conkay/verticals/prosthetics.js:212 `honesty: { stub: true, note: 'Extrusion telemetry STUB…' }` — labelled in payload, still synthetic | Off-Mac | S | P2 |

---

## Section C — REOPEN_QUEUE re-confirmation

| ID | Claim | Source | Verdict | Evidence (file:line or PR) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| C1 | World fakes (SEED_SNAP_TEMPLATES, fake DSL, fake camera) | Audit C#1 | done | SEED_SNAP_TEMPLATES absent (only a removal comment + test asserting undefined: concord-frontend/lib/world-lens/snap-build-templates.ts:53-56); concord-frontend/components/world/ConcordDSLEditor.tsx:28-29 `DSL_NOT_SUPPORTED`; MobileCompanion.tsx:428 "Neither exists yet… Both now say so plainly". The DSL compiler itself remains an open feature (per audit). | Off-Mac | L | — |
| C2-4 | Healthcare / Legal / Aviation tiers now REAL_FREE; "Simulated DUATS" removed | Audit C#2-4 | done | concord-frontend/lib/lenses/manifest.ts:1495 (healthcare REAL_FREE), :1726 (legal), :1919 (aviation); "Simulated DUATS" absent from tree | Off-Mac | — | — |
| C5-6 | Crypto / Timeline empty export | Audit C#5-6 | UNVERIFIED | Audit cited no evidence; REOPEN_QUEUE source is Mac-only (~/.zuko/…) and not in the repo; no export code located in concord-frontend/components/crypto/*.tsx greps | Mac-only | S | P3 |
| C8 | Engineering/HVAC/Trades tiers | Audit C#8 | partial | manifest.ts:3141 engineering REAL_FREE, :3387 hvac REAL_FREE, :1523 trades REAL_FREE; but :4546 creator SIM_GRADE_A and :5502 forecast SIM_GRADE_A | Off-Mac | M | P2 |
| C9 | Food recipe delete wired | Audit C#9 | done | concord-frontend/components/food/RecipeLibrary.tsx:240-244 calls `food.recipe-delete` | Off-Mac | — | — |
| C10-12 | Browser proofs | Audit C#10-12 | UNVERIFIED | Require a live browser; out of scope for this read-only pass | Mac-only | S | P3 |
| C-G1 | DTUExportButton used with empty data | Audit G1 | open | 122 `<DTUExportButton` JSX uses in frontend, 31 with literal `data={{}}` (audit said 30 of 108 — population grew); concord-frontend/components/lens/DTUExportButton.tsx:67,79 disables only while exporting, not on empty data | Off-Mac | S | P1 |
| C-G2 | DEMO tiers remain on 6 lenses | Audit G2 | open | Exactly the audit's 6, all in concord-frontend/lib/lenses/manifest.ts: law:1027, realestate:1774, insurance:2039, automotive:2616, defense:2954, telecommunications:4331 | Off-Mac | L | P0 |
| C-G3 | SIM_GRADE_A tiers | Audit G3 | partial | All 9 audit-named lenses still SIM_GRADE_A (sim, ethics, game, lab, logistics, creative, manufacturing, creator, forecast); manifest carries ~45 SIM_GRADE_A entries total — wider than the audit's list | Off-Mac | L | P1 |

## Section D — Phase plans / triage / handoffs re-confirmation

| ID | Claim | Source | Verdict | Evidence (file:line or PR) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| D-T1 | TRIAGE merged list (#1654, #1661, #1671, #1676, #1678, #1679, #1682, #1690, #1693, #1697) | Audit D | done | All 10 verified in wt-audit git log: a09f64fa, 7a7614d3, fda637cf, ded8bbf9, 6426e088, 2007acac, 499fd3f6, 32a6d106, 4208344f, a079b8d7 | Off-Mac | — | — |
| D-T2 | TRIAGE still-unmerged: SEC-DTU-MUTATE | Audit D | partial | Fix in flight PR #1727 (fix/sec-dtu-macros, SEC Fix 8), open at check time | Off-Mac | M | P0 |
| D-T3 | TRIAGE still-unmerged: LENS-UPDATE / PERSONA-LEGACY / OWNERLESS | Audit D | open | Mapped to SEC Fix 7 / Fix 9 / Fix 10 in MUSE-HANDOFF-SEC-2; no PRs exist yet (open-PR list #1704-#1727 contains none of them); Fix 10 depends on Fix 7, forum feature PR must precede Fix 7 | Off-Mac | M | P0 |
| D-T4 | TRIAGE still-unmerged: AUTOMATION / GRAPH-SYNC / PODCAST / TRAVEL / ROUTE-OVERRIDE | Audit D | UNVERIFIED | TRIAGE.md itself is not in this repo (Mac-only ~/.zuko source); no open PR and no merged commit in the shallow history carries these names. TRAVEL plausibly = SEC-TRAVEL = INC-81 (still open in code, see E-81). WEBHOOK: see D-T5 | Mac-only | M | P1 |
| D-T5 | TRIAGE still-unmerged: WEBHOOK global map | Audit D | partial | #1690 merged (32a6d106 "integrations webhook HMAC meta owner-scoped; verifyWebhookSignature no longer echoes expected signature") addresses webhook owner-scoping; whether it closes the TRIAGE "global map" item is UNVERIFIED (TRIAGE.md not in repo) | Off-Mac | M | P1 |
| D-P2 | Phase 2: chem #1638, logger #1639, dispatcher TypeError masking narrowed | Audit D | done | git log dc2d263c (#1638), dfbb3f5a (#1639); server/lib/lens-action-dispatch.js:49-54 `invalidInputFromThrow` narrows to TypeError only | Off-Mac | — | — |
| D-P3 | Phase 3: brain refusals | Audit D | done | git log 89fac95e (#1641) | Off-Mac | — | — |
| D-P1 | Phase 1: arXiv | Audit D | done | git log 2e13e06c (#1645) | Off-Mac | — | — |
| D-P1b | Phase 1 C2 items (astronomy NasaLivePanel, civic-bonds 400/403, urban-planning, dtus re-probe) | Audit D | UNVERIFIED | Audit itself marks these live-check/Mac-only; no local evidence either way | Mac-only | S | P2 |
| D-P4 | Phase 4 harness readback fix (~/.zuko/harness) | Audit D | UNVERIFIED | Mac-only path, not in repo | Mac-only | S | P2 |
| D-P5 | Phase 5 repair loop #1612 merged | Audit D | done | git log 142a8bb6 (#1612). Its post-deploy live checks remain open/Mac-only per audit — not re-verified here | Off-Mac | — | — |
| D-H2 | MUSE-HANDOFF-2 tasks 1–8 (PRs #1683–#1692) "IN FLIGHT" | Audit D | done | All ten PR numbers appear as squash-merged commit subjects in main history: #1683 f71bf31e, #1684 afa3e4e9, #1685 e72b8c8a, #1686 046c0497, #1687 673daf50, #1688 feb55ad6, #1689 4c964675, #1690 32a6d106, #1691 b8936d1b, #1692 31ac4719 — audit's "in flight" is superseded | Off-Mac | — | — |
| D-Z1 | HANDOFF-2 Z1 deploy auto-rollback (ROLLED_BACK markers in deploy-be.sh / locked-deploy.sh) | Audit D | UNVERIFIED | Neither script exists in this checkout (Mac-only deploy scripts); cannot confirm or refute the audit's zero-hit finding from the repo | Mac-only | M | P1 |
| D-Z2 | HANDOFF-2 Z2 (p5 test feed records, SearXNG :8888, 238-lens browser check, restricted-outlet migration) | Audit D | UNVERIFIED | Live/Mac-only items; restricted-outlet migration part is consistent with merged #1692 (31ac4719) but the rest needs the live host | Mac-only | M | P2 |
| D-H3 | HANDOFF-3 status (Workstream B lens batches; SEC pipeline) | Audit D + plan files | partial | All named B batches L1–L16 are open PRs #1704–#1726 (incl. L15b #1724, L16a #1725, L16b #1726); SEC started (#1727 = Fix 8); AUDIT/FIX-ALL not yet landed. Nothing merged — remote main is still 02910bbb | Off-Mac | L | P0 |

## Section E — Old INC backlog re-confirmation (only rows the audit verified)

| ID | Claim | Source | Verdict | Evidence (file:line or PR) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| E-78 | Socket chat turns not persisted | Audit E | done | Spot-check matches audit: server/lib/chat/socket-session.js hydration at :25-30 (audit cited :28,67, commit 645a6700b) | Off-Mac | — | — |
| E-94a | Authz holes INC-94a,101,102,103,104,108,117,118,120 "DONE in code" via #1303 (350cba49e) | Audit E | UNVERIFIED | Commit 350cba49e is outside this shallow clone's 173-commit window ("unknown revision"); cannot independently confirm. Audit's own caveat stands: close in notes only after a live retest | Mac-only | M | P1 |
| E-114 | Overpay/fake-paid money bugs INC-114,121,123,131,133 "PARTIAL→likely DONE" via money-guards (#1488) | Audit E | partial | Consistent in code: server/domains/accounting.js:7 and server/domains/finance.js:58 import `assertPayable` from server/lib/money-guards.js (audit also lists masonry/plumbing/trades/veterinary importers). Each INC still needs its repro retest (per audit) | Off-Mac | M | P1 |
| E-126 | Pricebook negative cost; schedule/status/precip parts unchecked by audit | Audit E | partial | Stronger than audit found: server/lib/lens-input-schemas-wave2.js:424 `"pricebook-save": { "unitCost": "num>=0" }` **and** :425 `"schedule-add"` covers durationDays `num>=0`, precipChancePct `num:0..100`, status enum, startDate `date` (masonry). Schema-level coverage of all named parts; enforcement/repro not re-run here | Off-Mac | S | P2 |
| E-127 | Song playback DONE (#1308, #1309 + 10 commits) | Audit E | UNVERIFIED | Cited PRs/commits predate the shallow clone window; no local evidence either way | Mac-only | — | P3 |
| E-128 | Chat workflows DONE (cd098a151) | Audit E | UNVERIFIED | cd098a151 is outside the shallow window ("unknown revision") | Mac-only | — | P3 |
| E-142 | Research report hedging DONE (#1371) | Audit E | UNVERIFIED | #1371 predates the shallow window; no local evidence either way | Mac-only | — | P3 |
| E-100 | Memory-starvation outage PARTIAL (hourly stall unattributed; swap ~80%) | Audit E | UNVERIFIED | Live-host state (swap/stall) is not checkable from this checkout; audit's PARTIAL stands unconfirmed | Mac-only | M | P1 |
| E-80 | events seat-assign removes the guest from all tables before the table-full check | Audit E | open | server/domains/events.js:563-567 — removal loop at :563-566 runs before the full check at :567 | Off-Mac | S | P1 |
| E-81 | travel place-save uses a global `saved` flag on the shared place record (SEC-TRAVEL) | Audit E | open | server/domains/travel.js:599-605 `place-save` sets `place.saved` on the shared record; :537 place-add initialises the same global flag; :563 `savedOnly` filter reads it (per-user only via `addedBy`). No SEC-TRAVEL PR is open | Off-Mac | S | P1 |
| E-82 | travel trip end-before-start not rejected | Audit E | partial | server/domains/travel.js trip-create :381; durationDays still `Math.max(1, …)` clamp (~:393); no end≥start order check (schema date validation exists per audit, wave2:623) | Off-Mac | S | P2 |
| E-84 | calendar end-before-start not rejected | Audit E | partial | No order check in main's server/domains/calendar.js; fix in flight PR #1712 (server/domains/calendar.js + server/tests/calendar-event-range.test.js — adds `invalidEventRange` rejecting end<start, and end==start for non-all-day, on create + override paths; diff verified) | Off-Mac | S | P1 |
| E-85 | daily: `javascript:` URLs not guarded (dates part validated) | Audit E | partial | No `javascript:` guard anywhere in server/domains/daily.js (grep = 0 hits); media URLs pass only through `dyClean` (daily.js ~:171, :222). Dates validated per audit (wave2:170,559) | Off-Mac | S | P1 |
| E-86 | srs deck-delete orphans sub-decks | Audit E | open | server/domains/srs.js:216-226 deck-delete splices only the target deck and filters only its own cards (`c.deckId !== params.id`); decks carry `parentId` (create :178-187; tree :644-647 roots = `!parentId`), so child decks are orphaned/invisible. **PR #1714 does NOT fix this** — its files are frontend-only; its srs map note covers orphaned *cards*, not sub-decks. A descendant-cascade helper exists in the same file (:401-409, study-next) | Off-Mac | S | P1 |
| E-87 | pet-delete cascade misses photos/appointments/lostProfiles | Audit E | open | server/domains/pets.js pet-delete :608, cascade :614-616 deletes 9 maps but not `s.photos` (:1390), `s.appointments` (:1457), `s.lostProfiles` (:1633+) | Off-Mac | S | P1 |
| E-88 | fitness beacon-status by shareToken returns position + full track after the beacon ended | Audit E | open | server/domains/fitness.js:2002-2030 — shareToken path has no ended/stopped check | Off-Mac | S | P1 |
| E-91 | cooking: counted pantry items never subtracted when cooking | Audit E | open | server/domains/cooking.js:532-549 — uncounted items handled (qty===null → not needed) but counted quantities are never decremented; full ingredient qty is pushed to the shopping list | Off-Mac | S | P2 |
| E-92 | meditation: re-completing a course day inflates session count | Audit E | open | server/domains/meditation.js:484 dedupes `completedDays`, but the session push at :488 is unconditional | Off-Mac | S | P2 |
| E-96 | agriculture field-update accepts acreage −50 / 5e9 (no range check) | Audit E | open | server/domains/agriculture.js field-update :790; acreage assignment :803 `f.acreage = Number(params.acreage)` with no bounds | Off-Mac | S | P2 |

## Section F — Ops re-confirmation

All F items are live-host/Mac-only state. None can be re-verified from this
checkout; verdicts below carry the audit's status and are marked UNVERIFIED
(not independently confirmed), except F-152 where code evidence exists.

| ID | Claim | Source | Verdict | Evidence (file:line or PR) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| F-POD | Pod down since 2026-10-26 | Audit F | UNVERIFIED (open per audit) | Live-host state; no evidence available in this checkout | Mac-only | — | P0 |
| F-BKP | Off-site backup stale since 2026-10-20 | Audit F | UNVERIFIED (open per audit) | Live-host state; no evidence available in this checkout | Mac-only | — | P0 |
| F-DISK | Disk 93% used (~15 GB free) | Audit F | UNVERIFIED (open per audit) | Mac disk state; not checkable from the VM checkout | Mac-only | — | P1 |
| F-SWAP | Swap ~80% | Audit F | UNVERIFIED (open per audit) | Live-host state; tied to E-100 | Mac-only | — | P1 |
| F-SHA | Live FE SHA not confirmed | Audit F | UNVERIFIED | Requires live-site check | Mac-only | S | P2 |
| F-LIVE | Pending live checks (#1660 WHO, #1662/#1665 food, #1658 restart persistence, browser console errors) | Audit F | UNVERIFIED | Require the live site / a browser; out of scope for this read-only pass | Mac-only | S | P2 |
| F-152 | INC-152 factual accuracy | Audit F | partial | The labelling half is merged in code: #1689 (4c964675, in main history) "low-confidence label on socket paths + small-model fact guard (INC-152)". Answer factual accuracy itself remains open per audit and needs live probing | Off-Mac | M | P1 |

---

## Verdict counts

**Area 1 (stubs/mock/placeholder/TODO/FIXME remainder):**
- New real open stubs: **1 open** (S-NEW-1), **2 obsolete** (S-NEW-2, S-NEW-3)
- Benign aggregate rows: **17** (S-BEN-1…17), covering the overwhelming bulk of
  8,857 hit lines
- Already-covered rows re-confirmed: **10** (S-COV-1…10): 2 partial (fix in
  flight #1708, #1710), 7 open, 1 partial-labelled (S-COV-10)

**Area 2 re-confirmations:**
- C: 9 rows — done 3 (C1, C2-4, C9), partial 2 (C8, C-G3), open 2 (C-G1, C-G2),
  UNVERIFIED 2 (C5-6, C10-12)
- D: 15 rows — done 6 (D-T1, D-P2, D-P3, D-P1, D-P5, D-H2), partial 3 (D-T2,
  D-T5, D-H3), open 1 (D-T3), UNVERIFIED 5 (D-T4, D-P1b, D-P4, D-Z1, D-Z2)
- E: 19 rows — done 1 (E-78), partial 5 (E-114, E-126, E-82, E-84, E-85),
  open 8 (E-80, E-81, E-86, E-87, E-88, E-91, E-92, E-96), UNVERIFIED 5
  (E-94a, E-127, E-128, E-142, E-100)
- F: 7 rows — partial 1 (F-152), UNVERIFIED 6 (all live-host state)

**Notable corrections to the audit:**
1. D-H2: HANDOFF-2 PRs #1683–#1692 are merged, not "in flight".
2. E-126: the wave2 schema covers the schedule/status/precip parts the audit
   left unchecked (lens-input-schemas-wave2.js:425).
3. E-86: PR #1714 does **not** fix the sub-deck orphaning (frontend-only PR).
4. E-84: fix is in flight as PR #1712 (audit predates it).
5. C-G1: population grew — 122 uses / 31 `data={{}}` (audit: 108 / 30).
6. Several audit "DONE" verdicts in E (94a group, 127, 128, 142) rest on
   commits outside this shallow clone and could not be independently
   re-verified here — marked UNVERIFIED, not contradicted.

---

## Pass 3 — Docs backlogs, lens-spec claims, ConKay solver table

# Audit — Docs backlogs, lens-spec claims, ConKay solver table (SEC-2 Step 1, uncovered areas)

- **Base:** `main` at 02910bbb, checkout `~/workspace/handoff3/wt-audit`. Read-only; no code edited.
- **Source audit:** `~/workspace/user/files/REMAINING-WORK-AUDIT-2026-10-28.md`, NOT COVERED section (docs backlogs; lens-spec claims; solver/engine table).
- **Verdict vocabulary:** open / done / partial / obsolete. Where a claim could not be checked in the time/method available it is marked **UNVERIFIED** in the Claim column rather than guessed (per instructions; the prescribed Verdict column values are used for checked rows).
- **Method (lens specs):** script re-counted `registerLensAction("<lens>", …)` in `server/domains/<lens>.js` and in `server/server.js`, and compared any `grep -c 'registerLensAction…'` claim printed in the map (scope taken from the claim line itself). A second pass extracted backticked action names on lines claiming unsurfaced/never-called/no-UI and grepped the frontend tree for them. Count rows below are only lenses where a stated count disagrees with the recount.
- **Method (docs):** all 168 top-level `docs/*.md` inventoried; the 47 plan/audit/backlog/ledger-type docs with open-work markers were classified, the named NOT-COVERED docs read in full, and at least one checkable claim per such doc spot-verified in code.
- **Method (ConKay):** every solver file in `server/lib/conkay/physics/solvers/` (73 files) inventoried with its registered solver id + domain; docs-named engines (OpenFOAM CFD, CalculiX FEA, Cantera, OCC, FEniCSx, MEEP, beam-frame FEA) checked for a real implementation file; `server/lib/conkay/verification/coverage.js` applicability domains checked against the registered solver domains.

---

## 1. Docs backlogs (aggregate per doc)

| ID | Claim | Source (file:line) | Verdict | Evidence (file:line) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| D1 | STUB_UPGRADE_BACKLOG: 15 macros remain `tier=stub` (incl. `council.evaluate/voices`, `cache.clear`, `sandbox.kill`); ~2,132 functional-tier macros missing try/catch is the real 0.102 weighted-depth gap | docs/STUB_UPGRADE_BACKLOG.md:1-30 | partial (grader restored 2026-10-28 — current stub tier = 504 honest / 444 default, superseding the stale May count of 15) | Aggregate is dated HEAD `6483307` (2026-05-23) in the doc itself (:13) — five months stale; the depth-grader regeneration it prescribes was not re-run here, so current tier counts are UNVERIFIED. Its two headline spec-mismatch claims are separately obsolete (D2) | Off-Mac | M | P2 |
| D2 | STUB_UPGRADE headline mismatches: `code.liveshare-*` is polling-only (no WebSocket/CRDT); `healthcare.telehealth-create` has no video client | docs/STUB_UPGRADE_BACKLOG.md:88-93 | obsolete | `server/lib/yjs-realtime.js` exists (Y.js CRDT over Socket.IO); `concord-frontend/components/healthcare/TelehealthVideoCall.tsx` exists; `server/lib/webrtc-signalling.js` exists. FEATURE_UPGRADE_BACKLOG.md:33-34 records both as shipped 2026-05-24 | Off-Mac | S | P3 |
| D3 | DEPTH_IMPORTANT_BACKLOG: 3,704 of 8,915 graded macros untested; ~364 important (51 money / 86 compute / 42 gameplay / ~185 external), realistic target ~120 behavioral tests | docs/DEPTH_IMPORTANT_BACKLOG.md:5-19 | partial (grader restored + counts regenerated 2026-10-28 — see Q63; honest baseline 0.654 over 9,826 macros) | Counts derive from `audit/macro-depth-honest.json` at an unstated HEAD; spot sample only: named macros exist (e.g. `council.simulate-budget` is registered in server.js and now also wired via the domain `budget-simulate` action, CouncilChamber.tsx:1030). Whether the top-40 still lack behavioral tests is UNVERIFIED per-macro | Off-Mac | L | P1 |
| D4 | FEATURE_UPGRADE_BACKLOG: headline prose-vs-impl gaps (Live Share, telehealth, collab CRDT, social workflow, feed ranking, anon E2E) | docs/FEATURE_UPGRADE_BACKLOG.md:28-40 | done | The doc itself marks every headline item Shipped/Verified-shipped; spot-verified for Live Share + telehealth (D2 evidence) and feed ranking macros `rank-for-you`/`record-interaction` are the doc's cited disposition. Remaining body is 21 auto-detected mismatches the doc itself triages mostly as detector false positives (:45-70) | Off-Mac | S | P3 |
| D5 | FEATURE_UPGRADE residual: `offline.*` sync helpers' spec prose may overstate "live cloud sync" (path-B downgrade candidates: mergeResolve, replicationPush/Pull, syncCheckpoint, backoffSchedule) | docs/FEATURE_UPGRADE_BACKLOG.md:64-66 | done (Q68, 2026-10-28) | Doc leaves these as downgrade candidates with no recorded decision; no code change needed — a prose decision in `docs/lens-specs/offline*.md`. Per-spec wording not re-read here, so which specs overstate is UNVERIFIED | Off-Mac | S | P3 |
| D6 | CONCORD_50_CAPABILITIES_ROADMAP: ~70% of 50 capabilities already exist; job is connecting + LRL-as-hub + 1–2 orchestrators; connective core then built (rnd #21, LRL hub, fingerprint #5, replay #3, decomp #10, planner #14, shadow council #12, quests #36, musicres #43, licensing revocation #37…) | docs/CONCORD_50_CAPABILITIES_ROADMAP.md:9-13, 20-60 | done (Q66 verified 2026-10-28 — see Q66 note; #25 unverifiable in this repo, #1 remainder = Q78) | Spot-verified DONE items exist as real domains: `server/domains/rnd.js`, `decomp.js`, `planner.js`, `contrib.js`, `musicres.js`, `licensing.js` all present. The remaining ~30 capability rows were not individually re-verified (UNVERIFIED beyond the spot sample) | Off-Mac | L | P2 |
| D7 | CONCURRENCY_WHATS_LEFT: dual-instance go-live status + remaining concurrency work | docs/CONCURRENCY_WHATS_LEFT.md:1-12 | open | The in-repo file is only a pointer: canonical status lives at `~/.zuko/remaining-work/CONCURRENCY_WHATS_LEFT.md` (Mac-only, not in this checkout), with "2026-09-09 Mac status: dual-instance go-live in progress / LIVE". Cannot be verified from this repo — Mac-only follow-up | Mac-only | M | P2 |
| D8 | GAP_CLOSURE Track 3: 49 lens dirs have a page but no `lens-registry.ts` entry (unreachable from palette/sidebar); gate floor 50 → target 0 | docs/GAP_CLOSURE_PLAN.md:30-60 | done | Recount this pass: `concord-frontend/lib/lens-registry.ts` carries 275 literal lens ids and **all 49** named orphans (forge, foundry, kingdoms, social, society, tournaments, markets, staking, … tools) are present, e.g. `forge` at lens-registry.ts:3180 and `social` at :3208 | Off-Mac | S | P3 |
| D9 | GAP_CLOSURE Track 4: four T-series polish bugs fixed in code; remaining work is a regression test per fix | docs/GAP_CLOSURE_PLAN.md:12-26 | done | `server/tests/polish-regression.test.js` exists; SFX alias map present in `concord-frontend/components/world-lens/SoundscapeEngine.tsx`; the four fixes are the doc's own verified table | Off-Mac | S | P3 |
| D10 | GAP_CLOSURE Tracks 1–2 + dead-wired modules (remaining tracks beyond the excerpts verified above) | docs/GAP_CLOSURE_PLAN.md:62-135 | partial | Track 3's own text already notes the CLAUDE.md-flagged dead files (`CombatMotorBridge.tsx`/`ReflexBridge.tsx`) no longer exist. Tracks 1–2 claims were not spot-verified in this pass — UNVERIFIED | Off-Mac | M | P2 |
| D11 | ORPHANED_SYSTEMS: 56 orphan frontend components, 54 orphan lib/hooks modules, 116 orphan DB tables (26%) | docs/ORPHANED_SYSTEMS.md:47-60 | obsolete | The doc's own status header (:3-9, 2026-05-13) states the 18-phase wiring pass closed every game-relevant orphan below and the 113 remaining table "orphans" are grep noise via macro indirection; the summary table is the pre-pass mechanical sweep, kept "for archaeological purposes" | Off-Mac | S | P3 |
| D12 | WAVE4_INVENTORY: 259 deferred items across 194 lenses (63 lenses fully closed) — the consolidated "still missing" list | docs/WAVE4_INVENTORY.md:1-25 | done | The doc's own execution header (:27-60) records Wave 4 execution COMPLETE (2026-07-17) and both acknowledged-open ENGINEERING rows closed 2026-07-18; spot-verified: `server/tests/integration/quest-authored-bridge.test.js` (the quests closure) exists. Residual rows are the doc's documented-close set (external/policy-gated, with reasons) — not buildable work | Off-Mac | M | P3 |
| D13 | LENS_COMPLETION_LEDGER: per-lens flawless-pass loop; 46 failing lenses (score <5/7) as the priority queue | docs/LENS_COMPLETION_LEDGER.md:1-35 | done | The queue header itself reads "✅ CLOSED 2026-06-27 (all 46 through the gate)" with per-lens commit/batch evidence in the table below it. Later sections of the 748-line ledger were not re-audited row-by-row — UNVERIFIED beyond the failing-lens queue | Off-Mac | M | P3 |
| D14 | DEPTH_BALANCE_PLAN + DEPTH_FLEET_PLAN: depth-score balancing / fleet execution plans (453 + 103 lines, open-work markers throughout) | docs/DEPTH_BALANCE_PLAN.md:1-60; docs/DEPTH_FLEET_PLAN.md:1-40 | partial (counts regenerated 2026-10-28 — see Q63) | Both are execution plans for the same macro-depth program as D1/D3; their aggregate scores predate the current tree and were not regenerated here — UNVERIFIED as current counts; treat D1/D3 as the canonical backlog rows for that program | Off-Mac | M | P2 |
| D15 | Remaining plan/audit docs with open-work markers (47 docs classified, incl. NEXT_ARC_PLAN, CONCORDIA_PLAN, DETECTOR_DEBT_TRIAGE, LIVE_OPS_PUNCHLIST_2026-07-07, BROWSER_DURABILITY_AUDIT with 31 unchecked boxes) | docs/*.md (inventory this pass) | partial | Classified and counted, not claim-verified: these are predominantly Concordia/game and detector/ops plans, several explicitly historical (dated audits 2026-05-02/05-10). Each needs its own claim pass before any row can be called open or done — UNVERIFIED in this pass | Off-Mac | L | P2 |


---

## 3. ConKay solver / engine table

Inventory basis: 73 files in `server/lib/conkay/physics/solvers/`, each registering one or more solver ids in `server/lib/conkay/physics/registry.js`; external-engine bridges under `server/lib/conkay/{fea,cfd,em,chem,cad}`. "Real" = a substantive implementation file exists with a registered solver id / bridge (existence + registration verified; numerical correctness not re-derived).

| ID | Claim | Source (file:line) | Verdict | Evidence (file:line) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| K1 | `corrosion.galvanic` — galvanic corrosion limit state for bolted joints | docs: REMAINING-WORK-AUDIT §A #15; code: server/lib/conkay/verification/coverage.js:50-52 | open | coverage.js:50-52 lists it under "Long-term limit states (not yet implemented; listed so the gap is visible)"; no solver in `physics/solvers/` registers a corrosion domain, and `joint-bolt-screening.js:630` states "no fatigue, no corrosion" in its screening disclaimer. Confirms the prior audit | Off-Mac | M | P1 |
| K2 | `fatigue` domain (Bolt/Actuator applicability) and generic `corrosion` domain (Bolt/Plate) have solvers | server/lib/conkay/verification/coverage.js:33-34, 55 | open | Same method as K1: no solver file registers `fatigue` or `corrosion` domains (grep over all 73 solver files); coverage() will report them as "no <domain> solver yet" (coverage.js:104). Not previously flagged in the source audit | Off-Mac | M | P2 |
| K3 | aero.cfd — OpenFOAM drag for cad.body | docs/CONKAY-AERO-CFD.md:1-20 | partial | Real recorded-run solver: `server/lib/conkay/physics/solvers/aero-cfd.js` + case machinery in `server/lib/conkay/cfd/` (openfoam-case.js, force-coeffs.js, gci.js, mesh-study.js, validation.js). By design it never runs OpenFOAM in-process — it reports a **recorded** run's result, and the doc itself states (CONKAY-AERO-CFD.md:202) "Not verified against a real OpenFOAM" — a live run is pod/Mac-only | Mac-only | M | P2 |
| K4 | FEA — frame/beam structure (`structure.frame`), 3D solid FEA (`fea.solid3d`), bone-stance FEA, bracket/beam members | HANDOFF-3 A4 solver list; docs/CONKAY_SPATIAL_NEXT_GEN_SPEC.md | done | `physics/solvers/frame-structure.js` (518 lines, id `structure.frame`), `solid-stress.js` (id `fea.solid3d`), `fea-bone-stance-stress.js` (663 lines), `structural-members.js` (id `beam.fea`), `bracket-plate.js` all present and registered; shared beam-frame solver at `server/lib/simulation/fea-solver.js` | Off-Mac | — | P3 |
| K5 | CalculiX external FEA bridge | docs/CONKAY.md / solver table (prior audit: "FEA/CFD/thermal/Cantera/OCC etc.") | partial | Bridge exists: `server/lib/conkay/fea/calculix.js` + `calculix_kernel.py`. Whether a CalculiX binary is installed/runnable is environment-dependent — UNVERIFIED from this checkout (no run attempted, per read-only scope) | Mac-only | S | P3 |
| K6 | Thermal: motor thermal, brake thermal, conduction, coolant loop / cooling opening | HANDOFF-3 A4 solver list | done | `physics/solvers/electrical-motor-thermal.js` (id `electrical.motor-thermal`), `brake-thermal.js` (id `thermal.brake-stop`), `cooling-opening.js` (id `fluid.cooling-opening`), `coolant-loop.js`, plus `server/lib/conkay/thermal/{conduction.js,brake-stop.js}` and `fluids/{pipe-flow.js,cooling-opening.js,coolant-loop.js}` | Off-Mac | — | P3 |
| K7 | Chemistry — reacting chemistry / Cantera equilibrium | docs solver table; coverage notes | partial | In-process solver real: `physics/solvers/reacting-chemistry.js` registers `chem.equilibrium`/`chem.ignition`/`chem.flameSpeed`. Cantera bridge exists at `server/lib/conkay/chem/cantera.js`; whether it runs against an installed Cantera is UNVERIFIED from this checkout | Off-Mac | S | P3 |
| K8 | OCC (OpenCascade) CAD kernel — B-rep body, STEP, drawings | docs/CONKAY_UNITY_BRIDGE.md:1-9, 144 | partial | Real bridge: `server/lib/conkay/occ-bridge.js` + Python kernels `server/lib/conkay/cad/conkay_body_occ.py`, `conkay_drawing_occ.py`, `conkay_show_occ.py`, `tub_fit_occ.py`. The doc's "SOLID WORLD CERTIFIED / INDUSTRIAL_CLASS CERTIFIED" claims rest on Mac-side cert files (`~/.zuko/remaining-work/conkay-solid-world-cert.json`) not in this repo — certification claim UNVERIFIED here; code existence verified | Mac-only | M | P2 |
| K9 | Electromagnetics — FDTD + magnetostatics; external FEniCSx / MEEP kernels | docs/FRONTIER_ENGINES.md (engine list) | done | `physics/solvers/em-fdtd.js` (id `em.fdtd`), `em-magnetostatic.js` (id `em.magnetostatic`); external kernels `server/lib/conkay/em/fenicsx.js` + `fenicsx_magnetostatic_kernel.py`, `meep.js` + `meep_kernel.py` (external-binary runnability UNVERIFIED, as K5) | Off-Mac | — | P3 |
| K10 | Remaining named solver families in the registry: aero.shape/drag, mass.* (budget/cg/inertia), vehicle.* (acceptance, assembly, gearing, traction), package.* (occupant-fit, tub-fit, interference via packaging.js), dynamics.* (forward/inverse/RNEA/parameter-id), gait.* + kinematics.*, materials.* (stiffness/CTE/conduction/viscoelastic/compatibility), electrical.* (budget/battery), stability.*, joint.* (11 bolted-joint limit states in bolted-joint.js, 1,383 lines) | docs/CONKAY*.md; HANDOFF-3 A4 list | done | All present as files in `physics/solvers/` with registered ids (full 73-file inventory in the working notes for this audit; e.g. `aero-shape.js` id `aero.shape`, `mass-properties.js` id `mass.cg`, `vehicle-acceptance.js`, `packaging.js` id `package.occupant-fit`, `bolted-joint.js` registering shear/bearing/tearout/tension/combined/gross/net/block-shear/bolt-group/slip-critical/prying) | Off-Mac | — | P3 |
| K11 | Frontier Engines: "ten computational engines, shipped 2026-07-24", each with an explicit HONEST_BOUNDARY / claimTier | docs/FRONTIER_ENGINES.md:1-26 | partial | The doc's framing is self-limiting by design (walls are stated as permanent, not gaps). The ten engines were not individually re-verified against their test files in this pass — UNVERIFIED beyond the EM/FEA/chemistry spot rows above (K4/K7/K9) | Off-Mac | M | P3 |


---

## 2. Lens-spec capability maps — count verification (257 maps)

**Summary line:** 257 maps checked. 77 printed a reproducible `grep -c 'registerLensAction("<lens>"'` count claim. Of those, **55 claims match** the recount exactly (accounting, admin, agriculture, all, answers, app-maker, auction, aviation, billing, bio, black-market, bounties, bridge, chem, command-center, construction, cooking, crafting, debate, debug, defense, disputes, diy, dtus, fitness, forestry, forge, fractal, geology, hypothesis, import, inference, integrations, logistics, meta, neuro, ocean, organ, pets, productivity, resonance, sandbox, self, sentinel, sponsorship, sports, srs, system, tick, tournaments, trades, veterinary, whiteboard, worldmodel — plus deities, whose claim is for the singular registered domain `deity`: claimed 14, actual 14 in `server/domains/deities.js`). **21 claims disagree** (rows L1–L21 below; all are stale counts — the code grew or shrank after the map was written; none indicates missing code). **181 maps print no grep-c count claim** and so have no count to disagree with; their prose claims were not line-verified in this pass (the source audit's 1,155 claim lines remain largely UNVERIFIED — see closing note).

| ID | Claim | Source (file:line) | Verdict | Evidence (file:line) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| L1 | analytics: 30 domain macros | docs/lens-specs/analytics-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 32 `registerLensAction("analytics"` in server/domains/analytics.js | Off-Mac | S | P3 |
| L2 | anon: 14 domain macros | docs/lens-specs/anon-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 16 in server/domains/anon.js | Off-Mac | S | P3 |
| L3 | art: 71 domain macros | docs/lens-specs/art-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 73 in server/domains/art.js | Off-Mac | S | P3 |
| L4 | attention: 21 domain macros | docs/lens-specs/attention-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 22 in server/domains/attention.js | Off-Mac | S | P3 |
| L5 | automotive: 58 domain macros | docs/lens-specs/automotive-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 54 in server/domains/automotive.js (map overstates by 4 — registrations were removed/consolidated after the map) | Off-Mac | S | P3 |
| L6 | board: 37 domain macros | docs/lens-specs/board-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 36 in server/domains/board.js | Off-Mac | S | P3 |
| L7 | collab: 25 domain macros; "1/25 never referenced in frontend" (`presenceState`) | docs/lens-specs/collab-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 34 in server/domains/collab.js (+3 more `registerLensAction("collab"` in server/server.js). The 1/25 unsurfaced fraction is likewise stale | Off-Mac | S | P3 |
| L8 | commonsense: 15 domain macros | docs/lens-specs/commonsense-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 20 in server/domains/commonsense.js | Off-Mac | S | P3 |
| L9 | council: 28 domain + 4 server.js lens registrations + 8 `register("council")` = "40 macro registrations, 39 distinct names" | docs/lens-specs/council-capability-map.md:4-9 | done (stale claim; corrected by Q67) | Recount: 40 in server/domains/council.js alone, 4 `registerLensAction("council"` in server/server.js, and 12 `register("council"` lines in server/server.js — actual surface is materially larger than the map's total on every subcount | Off-Mac | S | P3 |
| L10 | docs: 42 domain macros | docs/lens-specs/docs-capability-map.md:3 | done (stale claim; corrected by Q67) | Recount: 43 in server/domains/docs.js | Off-Mac | S | P3 |
| L11 | education: 68 domain macros | docs/lens-specs/education-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 72 in server/domains/education.js | Off-Mac | S | P3 |
| L12 | fork: 17 domain macros | docs/lens-specs/fork-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 18 in server/domains/fork.js | Off-Mac | S | P3 |
| L13 | hr: 63 domain macros | docs/lens-specs/hr-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 64 in server/domains/hr.js | Off-Mac | S | P3 |
| L14 | marketing: 64 domain macros | docs/lens-specs/marketing-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 66 in server/domains/marketing.js | Off-Mac | S | P3 |
| L15 | marketplace: 56 domain macros | docs/lens-specs/marketplace-capability-map.md:15 | done (stale claim; corrected by Q67) | Recount: 59 in server/domains/marketplace.js (+6 in server/server.js) | Off-Mac | S | P3 |
| L16 | metalearning: 19 domain macros | docs/lens-specs/metalearning-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 20 in server/domains/metalearning.js | Off-Mac | S | P3 |
| L17 | paper: 37 domain macros (+3 register / +4 lens registrations in server.js) | docs/lens-specs/paper-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 41 in server/domains/paper.js; server.js subcounts not re-verified for this row | Off-Mac | S | P3 |
| L18 | projects: 98 domain macros | docs/lens-specs/projects-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 99 in server/domains/projects.js | Off-Mac | S | P3 |
| L19 | quantum: 13 domain macros | docs/lens-specs/quantum-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 17 in server/domains/quantum.js | Off-Mac | S | P3 |
| L20 | realestate: 55 domain macros | docs/lens-specs/realestate-capability-map.md:9 | done (stale claim; corrected by Q67) | Recount: 56 in server/domains/realestate.js | Off-Mac | S | P3 |
| L21 | services: 31 domain macros | docs/lens-specs/services-capability-map.md:4 | done (stale claim; corrected by Q67) | Recount: 33 in server/domains/services.js | Off-Mac | S | P3 |

### 2b. Lens-spec "unsurfaced" claims that the frontend now contradicts

Method: 100 table rows across the maps carry an UNSURFACED claim not self-marked fixed on the same line; 95 of the named actions string-match somewhere in the frontend — but most of those rows are the map's own before/after history (the same row's disposition column reads "→ WIRED THIS PASS / DESIGNED / Fixed this pass"), so they are **not** discrepancies. The rows below are the ones whose map disposition still says *still unsurfaced / genuine gap* while a lens-scoped frontend caller now exists (each hand-verified, not just string-matched):

| ID | Claim | Source (file:line) | Verdict | Evidence (file:line) | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| U1 | chat `branches-list`/`branch-delete` "Still unsurfaced — genuine scoped gap"; `branch-fork`'s consuming component "is never mounted anywhere" | docs/lens-specs/chat-capability-map.md:38-39 | done (stale claim; corrected by Q67) | `concord-frontend/components/chat/SyncedBranchesSection.tsx:31` calls `branches-list`, :43 calls `branch-delete`; `BranchForkButton.tsx:52` calls `branch-fork`; both are mounted in `ChatWorkspacePanel.tsx:2618` (BranchForkButton) and :3053 (SyncedBranchesSection) | Off-Mac | S | P3 |
| U2 | careers `ladder` "Still unsurfaced (see checklist item 6)" | docs/lens-specs/careers-capability-map.md:22 | done (stale claim; corrected by Q67) | `concord-frontend/app/lenses/careers/page.tsx:127` calls `lensRun('careers', 'ladder', { trackId })` | Off-Mac | S | P3 |
| U3 | travel `trip-update` + `itinerary-update` "UNSURFACED (no caller anywhere)"; `budget-set` "UNSURFACED entirely — no component anywhere called this" | docs/lens-specs/travel-capability-map.md:34, 39, 54 | done (stale claim; corrected by Q67) | `concord-frontend/components/travel/TripWorkspace.tsx:313` (`trip-update`), :357 (`itinerary-update`), :533 (`budget-set`); the travel page header (app/lenses/travel/page.tsx:25) itself notes the budget-set form | Off-Mac | S | P3 |
| U4 | fitness `gps-track` "genuinely missing UI"; `beacon-list` and `plan-session-move` BACKEND-CAPABLE-BUT-UNSURFACED | docs/lens-specs/fitness-capability-map.md:143, 150, 156 | done (stale claim; corrected by Q67) | `concord-frontend/components/fitness/StravaActivitiesPanel.tsx:153` (`gps-track`), `StravaBeaconPanel.tsx:91` (`beacon-list`), `StravaPlanPanel.tsx:127` (`plan-session-move`) | Off-Mac | S | P3 |
| U5 | fashion `vision` "UNSURFACED — no frontend caller anywhere pre-rebuild" (no wired disposition recorded) | docs/lens-specs/fashion-capability-map.md:39 | done (stale claim; corrected by Q67) | `concord-frontend/components/fashion/FashionClosetPanel.tsx:100` calls `lensRun('fashion', 'vision', { imageUrl })` | Off-Mac | S | P3 |
| U6 | law `draft` / `cite` "UNSURFACED" / BACKEND-CAPABLE-BUT-UNSURFACED | docs/lens-specs/law-capability-map.md:75-76, 186 | done (stale claim; corrected by Q67) | `concord-frontend/components/law/CaseFiles.tsx:206` (action `draft`) and :226 (action `cite`), pinned by `concord-frontend/tests/components/CaseFilesDraftsCitations.test.tsx:114,131` | Off-Mac | S | P3 |
| U7 | council budget variance simulation (`simulate-budget`) BACKEND-CAPABLE-BUT-UNSURFACED, "scoped future build task"; `council.audit` derived trail likewise unsurfaced | docs/lens-specs/council-capability-map.md:85 (and the audit row in the same checklist) | done (stale claim; corrected by Q67) | Simulation is wired as the domain action `budget-simulate` in `concord-frontend/components/council/CouncilChamber.tsx:1030` (with results + error state at :1676-1690), superseding the server.js macro; the audit trail's formula is wired via `computeProcessCompleteness` (`concord-frontend/lib/council/council-audit.ts`, used at CouncilChamber.tsx:1754) — a documented port, because the macro itself expects `data.votes` as an array while Proposals store a Record | Off-Mac | S | P3 |

**Not discrepancies (checked, map still accurate):** research `evaluate-source`/`find-gaps`/`match-questions` were absent from the frontend at audit time (genuinely missing "Analyze library" feature, already recorded by the L15a batch) — **surfaced 2026-10-28 by Q62**; chat `project-get` remains unsurfaced and redundant by design; atlas `live_geocode`/`directions` are marked UNSURFACED-BY-DESIGN in their own map. The remaining ~93 historical unsurfaced rows were not individually re-verified beyond the string-match pass — UNVERIFIED at row level.

---

## Summary counts (this audit)

| Area | Checked | Open | Partial | Done | Obsolete | UNVERIFIED (in-row) |
|---|---:|---:|---:|---:|---:|---:|
| 1. Docs backlogs (D1–D15) | 168 docs inventoried; 47 plan-type classified; 15 aggregate rows | 2 (D5, D7) | 6 (D1, D3, D6, D10, D14, D15) | 5 (D4, D8, D9, D12, D13) | 2 (D2, D11) | portions of D1/D3/D6/D10/D13/D15 |
| 2. Lens-spec counts (L1–L21 + summary) | 257 maps; 77 grep-c claims | 0 | 0 | 56 claims match (incl. deities) | 21 claims stale | 181 maps have no count claim; ~1,155 prose claim lines not line-verified |
| 2b. Lens-spec unsurfaced (U1–U7) | 100 candidate rows; 7 hand-verified discrepancies | 0 | 0 | — | 7 | ~93 historical rows string-matched only |
| 3. ConKay solvers (K1–K11) | 73 solver files inventoried | 2 (K1 corrosion.galvanic, K2 fatigue/corrosion domains) | 5 (K3, K5, K7, K8, K11) | 4 (K4, K6, K9, K10) | 0 | external-binary runnability (K5/K7/K8/K9), OCC certification (K8) |

**Headline findings:**
1. The only genuinely **open** code item in these three areas is the ConKay long-term limit-state family: `corrosion.galvanic` (K1, confirming the source audit) plus the sibling `fatigue` and generic `corrosion` applicability domains (K2, new) — coverage.js lists them, no solver registers those domains.
2. Every lens-spec discrepancy found is **stale documentation, not missing code**: 21 understated/overstated macro counts and 7 "unsurfaced" claims for features that are now wired. The maps systematically *understate* the current surface (code grew after Wave 3).
3. The named docs backlogs are mostly **self-closed or superseded** (FEATURE_UPGRADE, GAP_CLOSURE Tracks 3–4, ORPHANED_SYSTEMS, WAVE4, LENS_COMPLETION_LEDGER); the live residue is the macro-depth program (D1/D3/D14 — counts from May–July snapshots, need a grader re-run to be current), the offline-prose downgrade decision (D5), and the Mac-only concurrency status (D7).

---

## Pass 4 — Unchecked INCs, GitHub issues, leftover docs

# Audit — Unchecked INCs, GitHub issues, leftover docs (2026-10-28)

Read-only pass against `~/workspace/handoff3/wt-audit` (main at 02910bbb, shallow + sparse checkout — `.github/` and some `docs/` paths are in the HEAD tree but not materialised; those were read via `git show HEAD:<path>` / `git ls-tree`). Source file: `~/workspace/user/files/REMAINING-WORK-AUDIT-2026-10-28.md` §E "Not checked" list, §G, and its NOT COVERED section.

Method for INCs: `git grep -i -E "INC[- ]0?<n>([^0-9]|$)"` and a second pass with `INC[_ ]<n>` over **all tracked files** in wt-audit. The original INC claims live in the STATUS-20261019 / usability log, which is **not in the repo** (no STATUS-20261019 file in the HEAD tree; the usability log is the Mac-only `~/.zuko/CONCORD_USABILITY_LOG.md`). Where no in-repo claim exists, the verdict is UNVERIFIED — no claim has been invented.

## 1. Unchecked INCs (§E + INC-73/74)

| ID | Claim | Source | Verdict | Evidence | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| INC-73 | Black-market purchase reveals the payload but never an account id; route takes identity only from the authenticated session | In-repo test header (BACKLOG W2 item, per source audit §E NOT COVERED) | done | `server/tests/inc-73-black-market-redaction.test.js:1` (claim) and `:41` (describe block, behavioural assertions); implementation `server/lib/black-market.js` — `projectSoldListing` (listing projection omits `buyer_id`, ~line 170) and `projectRevealedMessage` (`senderLabel` = "a traveller from <world>", lines 192–203) | Off-Mac | S | Low (done) |
| INC-74 | Claim not found in repo | Source audit §E NOT COVERED ("INC-73 and INC-74 (BACKLOG W2) have no commits referencing them"); BACKLOG W2 itself is not in the repo (no file, `git grep "BACKLOG W2"` = 0 hits) | UNVERIFIED | `git grep -i "INC[- ]0?74"` over all tracked files in wt-audit = 0 hits (both `INC-74` and `INC_74` patterns) | Mac-only (claim source) | — | Low |
| INC-05 | Claim not found in repo (source audit groups INC-05 with ops/backup items) | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?5"` = 1 hit only: `docs/CONCORDIA_ASSET_STUDIO_PLAN.md:7` "(Inc 5)" — that is Concordia Asset Studio *increment* 5, a different "Inc", not the usability-log INC-05 | Mac-only | — | Low |
| INC-79 | Claim not found in repo | Source audit §E "Not checked" list (grouped ops/backup, Mac-only) | UNVERIFIED | `git grep -i "INC[- ]0?79"` over all tracked files = 0 hits | Mac-only | — | Low |
| INC-83 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?83"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-89 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?89"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-90 | Claim not found in repo | Source audit §E "Not checked" list (grouped ops/backup, Mac-only) | UNVERIFIED | `git grep -i "INC[- ]0?90"` over all tracked files = 0 hits | Mac-only | — | Low |
| INC-94b | Claim not found in repo (the §E table verified 94a authz holes as DONE in code; 94b was left unchecked) | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]?94b"` over all tracked files = 0 hits; note the §E-cited fix commit 350cba49e (#1303) is not present in this shallow clone (`git log 350cba49e` = unknown revision), so 94a's evidence could not be re-checked in-tree either | Mac-only (claim source) | — | Low |
| INC-95 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?95"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-97 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?97"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-99 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?99"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-105 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?105"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-106 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?106"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-107 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?107"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-109 | Trades `invoices-record-payment` must refuse a payment amount above the invoice balance (overpay) | In-repo test name | done | `server/tests/money-guards.test.js:100` — "trades invoices-record-payment refuses an amount above the balance (INC-109)": asserts `amount_exceeds_balance` for 1e9 on an $80 invoice, success at $80, "invoice already paid" after; exercises the real domain actions via the money-guards harness (`server/lib/money-guards.js` family, cf. source audit §E on #1488) | Off-Mac | S | Low (done) |
| INC-112 | Claim not found in repo; source audit notes commit cd098a151 "may cover it" | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?112"` over all tracked files = 0 hits; commit cd098a151 is not present in this shallow clone (`git cat-file -t cd098a151` = "Not a valid object name"), so the possible coverage could not be confirmed in-tree | Mac-only (claim source) | — | Low |
| INC-113 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?113"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-115 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?115"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-116 | A party cannot unilaterally close a two-party dispute (closing outcomes are mediator/admin, or the claimant withdrawing their own claim; an offer is accepted only by the other party; case-advance cannot jump to a terminal status; evidence URLs http(s) only) | In-repo test header | done | `server/tests/INC-116-authz.test.js:1` (claim) and `:43` (describe "INC-116 dispute close authority" — respondent's `no_refund` resolve refused with /mediator or admin/, claimant refund refused, claimant withdraw allowed); tests run against the real `server/domains/disputes.js` actions | Off-Mac | S | Low (done) |
| INC-119 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?119"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-122 | Masonry must refuse a bogus change-order status and must not reuse invoice numbers | In-repo test name | done | `server/tests/money-guards.test.js:134` — "masonry refuses a bogus change-order status and does not reuse invoice numbers (INC-121, INC-122)": asserts `invalid_status` for `zz_bogus`, idempotent re-sign, and invoice numbering across a delete; real domain actions via the money-guards harness | Off-Mac | S | Low (done) |
| INC-124 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?124"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-125 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?125"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-130 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?130"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-135 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?135"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |
| INC-144 | Pod-brain research jobs stop early (0 subgoals, single source) | Source audit Top 15 #12 and §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?144"` over all tracked files = 0 hits; source audit itself states "No commit references it. Mac-only to verify" — the behaviour is a live pod/runtime property, not checkable from this code tree | Mac-only | M | Medium |
| INC-146 | Claim not found in repo | Source audit §E "Not checked" list | UNVERIFIED | `git grep -i "INC[- ]0?146"` over all tracked files = 0 hits | Mac-only (claim source) | — | Low |

## 2. GitHub issues (§G)

Open-issue list retrieved 2026-10-28 via `github call-read-tool list_issues` (state OPEN): **exactly 6 open issues total** — #1663, #1530, #1529, #1127, #949, #850 — i.e. the §G list is complete, no additional open issues exist.

| ID | Claim | Source | Verdict | Evidence | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| #1663 | Nightly Adversarial Audit composite gate failing — "Run failed (schedule)… Fix the failure or ratchet the baseline with a reason. A later passing run closes this issue." | GitHub issue #1663 (github-actions, label `nightly-failure`, created 2026-10-28T10:58:49Z) | open | Issue state OPEN (list_issues, 2026-10-28); body cites failed run 40675590198 on commit 7a7614d36; workflow exists in HEAD tree (`.github/workflows/adversarial-audit.yml`, via `git ls-tree`) but a code tree cannot show a passing scheduled run — no in-tree evidence the gate has passed since | Off-Mac (verify via GitHub Actions) | M | High |
| #1530 | Nightly audits failing — same auto-filed pattern ("A later passing run closes this issue") | GitHub issue #1530 (github-actions, label `nightly-failure`, created 2026-10-27T06:31:25Z) | open | Issue state OPEN (list_issues, 2026-10-28); body cites failed run 40455545163 on commit 610dd7828; workflow `.github/workflows/audits.yml` exists in HEAD tree; no passing-run evidence in code | Off-Mac (verify via GitHub Actions) | M | High |
| #1529 | Nightly CI failing — same auto-filed pattern | GitHub issue #1529 (github-actions, label `nightly-failure`, created 2026-10-27T05:04:58Z, 1 comment, updated 2026-10-28T10:55:52Z) | open | Issue state OPEN (list_issues, 2026-10-28); body cites failed run 40450958311 on commit 610dd7828; workflow `.github/workflows/ci.yml` exists in HEAD tree; no passing-run evidence in code | Off-Mac (verify via GitHub Actions) | M | High |
| #1127 | "AEITHERFIX" — no claim stated | GitHub issue #1127 (user salemmannequinn-netizen, created 2026-10-11T03:11:53Z) | done (closed 2026-10-28 per founder decision — obsolete/duplicate; comment on the issue records it) | Issue state OPEN, but its body is only `### ` (empty — retrieved in full via list_issues); `git grep -i "aeither"` over all tracked files in wt-audit = 0 hits, so there is no in-repo referent to verify against | Off-Mac | — | Low |
| #949 | CodeQL exclusions are 113 days past their last re-audit (limit 90): re-run the survey for each suppressed category, confirm the allowlist in `docs/security/codeql-suppressions.md` hasn't grown, update the ledger's "Last updated" date, re-run `server/tests/platinum-codeql-drift.test.js` | GitHub issue #949 (github-actions, labels security/codeql-re-review/platinum-gate, created 2026-09-01T13:19:13Z) | open | Issue state OPEN; HEAD `.github/workflows/codeql.yml` still carries the 12 `exclude:` entries the issue counts (lines 116, 127, 129, 142, 144, 155, 162, 169, 175, 180, 187, 200, via `git show HEAD:`); ledger `docs/security/codeql-suppressions.md:6` still reads "**Last updated:** 2026-05-11" — before the issue was filed, so no re-audit has been recorded; drift test does exist (`server/tests/platinum-codeql-drift.test.js`, 28,936 bytes in tree) | Off-Mac | M | Medium |
| #850 | Honest macro-depth help wanted: floor at 0.688, climbing toward a ~0.73–0.85 ceiling; ~70% of non-trivial macros on a real behavioural test, the rest only shape/smoke | GitHub issue #850 (user ConcordDev, created 2026-07-06T14:45:48Z) | partial | Issue state OPEN; in-tree floor figure is unchanged since before the issue: `CLAUDE.md:23` and `CLAUDE.md:57–59` cite honest floor **0.688** (update dated 2026-06-08, ~21 depth-fleet waves, ~70% of non-utility macros behaviourally tested); `docs/DEPTH_FLEET_PLAN.md` (Status table + guard: 982 behavioural tests / 83 files, self-maintaining backlog queue) is the live resumption plan; `docs/CONKAY_HONEST_HOLOGRAM_PLAN.md:16` says the floor "plateaued" at 0.688 with practical ceiling ~0.71–0.72; source audit §B row 30 (PARTIAL) notes ~30 functional macros still shallow — target band not reached in any in-tree number | Off-Mac | L | Medium |

## 3. Leftover docs (§NOT COVERED)

The source audit lists these under `~/.zuko/remaining-work` — i.e. its own text already places them outside the repo. Verified absent from wt-audit:

| ID | Claim | Source | Verdict | Evidence | Loc | Size | Priority |
|---|---|---|---|---|---|---|---|
| LENS-SWEEP-LEFTOVERS | Leftover lens-sweep work items (contents not in repo — cannot extract claims) | Source audit §NOT COVERED ("~/.zuko/remaining-work LENS-SWEEP-LEFTOVERS… If they're Mac-only, list them for zuko") | UNVERIFIED | No file with this name in the HEAD tree (`git ls-tree -r HEAD` — 0 matches for `*LEFTOVERS*`/`leftover`); `git grep "LENS-SWEEP-LEFTOVERS"` over HEAD = 0 hits; working-tree `find -iname "*LENS-SWEEP-LEFTOVERS*"` = 0 | Mac-only | — | Low |
| CHAT-COCKPIT | Chat-cockpit spec/leftovers (contents not in repo — cannot extract claims; cf. source audit §D-era note that the cockpit pattern is what the lens north-star deprecates, `docs/lens-northstar/NORTHSTAR.md` in other checkouts) | Source audit §NOT COVERED | UNVERIFIED | No file with this name in the HEAD tree (`git ls-tree -r HEAD` — 0 matches for `cockpit`, case-insensitive); `git grep "CHAT-COCKPIT"` over HEAD = 0 hits | Mac-only | — | Low |
| AURA-ROADMAP | Aura roadmap (contents not in repo — cannot extract claims) | Source audit §NOT COVERED | UNVERIFIED | No file with this name in the HEAD tree (`git ls-tree -r HEAD` — `docs/` contains only `docs/AURA_VISUAL_FIDELITY.md` for Aura; the Unity `.Aura/` plan files under `apps/concordia-living-world/` are a different artefact set, none named AURA-ROADMAP); `git grep "AURA-ROADMAP"` over HEAD = 0 hits | Mac-only | — | Low |

## Summary counts

- **Rows total: 37** (28 INCs + 6 GitHub issues + 3 leftover docs)
- **done: 4** — INC-73, INC-109, INC-116, INC-122 (each pinned by a behavioural test in-repo that exercises the real domain code)
- **partial: 1** — #850 (depth floor documented at 0.688 with a live sweep plan; target band 0.73–0.85 not reached in any in-tree figure)
- **open: 4** — #1663, #1530, #1529 (nightly gates still OPEN, filed 2026-10-27/28), #949 (CodeQL re-audit overdue; ledger still dated 2026-05-11)
- **UNVERIFIED: 28** — 24 INCs with no claim findable in the repo (their claims live in the Mac-only STATUS-20261019/usability log; INC-144's claim is known from the source audit but is a live-pod behaviour), #1127 (issue body empty, no in-repo referent), and the 3 leftover docs (absent from the repo, Mac-only `~/.zuko/remaining-work` per the source audit itself)
- **obsolete: 0**
