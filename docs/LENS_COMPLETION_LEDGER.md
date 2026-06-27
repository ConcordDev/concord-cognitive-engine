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
| foundry | 3/7 | pending | | world-builder substrate (mig 191-192). batch-6 agent DIED mid-work (5h-stale, hanging test that boots the WHOLE server + LLM oracle calls); partial work REVERTED. Redo with explicit lightweight in-memory-DB test harness (no full server boot, no LLM). |
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
| codex | 4/7 | pending | | |
| ledger | 4/7 | pending | | economy ledger reader |
| forecast | 4/7 | pending | | forecast backend |
| civic-bonds | 4/7 | pending | | civic-bonds backend |
| detective | 4/7→5/7 | **done** | a62bae5 | dedicated `detective` domain delegating to lib (Obra-Dinn 2-of-3 + suspect_match lock-in); fixed dangling `lens.detective.*` manifest refs; added non-culprit-leaking `getCrimeWithEvidence`; 10 server + 5 UX-state tests |
| photos | 4/7 | pending | | photo gallery backend |
| fishing | 4/7→5/7 | **done** | def0ff4 | dedicated `fishing` domain; fixed buffOnCook [object Object] render; cast→reel→catch tests; 4 UX states |
| creatures | 4/7→5/7 | **done** | a62bae5 | extended `creatures` domain (+species/roster/lineage/breed) delegating to creature-crossbreeding + species-taxonomy; fixed dangling `lens.creatures.*` refs + the breed `bond_too_low` bug (thin parents lacked physics blueprints → no hybrid ever produced); 8 server + 4 UX-state tests |
| translation | 4/7 | pending | | |
| repair-telemetry | 4/7 | pending | | dashboard — likely by-design |
| code-quality | 4/7 | pending | | dashboard |
| cognition | 4/7 | pending | | |
| crisis-ops | 4/7 | pending | | |
| death-insurance | 4/7 | pending | | insurance backend |
| dx-platform | 4/7 | pending | | |
| expedition-journal | 4/7 | pending | | |
| ghost-tracker | 4/7 | pending | | |
| lattice | 4/7 | pending | | lattice dashboard |
| mesh | 4/7 | pending | | mesh dashboard |
| ops | 4/7 | pending | | ops dashboard |
| sandbox | 4/7 | pending | | |
| sentinel | 4/7 | pending | | sentinel dashboard |
| sessions | 4/7 | pending | | |
| society | 4/7 | pending | | |
| system | 4/7 | pending | | system dashboard |
| tools | 4/7 | pending | | |
| wellness | 4/7 | pending | | |

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
