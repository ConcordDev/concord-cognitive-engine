# Concordia — Depth & Balance Plan (audit-grounded)

**Branch:** `claude/concordia-depth-balance-audit-k0osH`
**Date:** 2026-05-29
**Method:** Direct codebase audit (5 parallel agents) + 6-game depth-benchmark web research.
**Docs were treated as stale and verified against running code** — every claim below was
grep/read-confirmed against the working tree, and several long-standing doc claims (including
CLAUDE.md's own "honesty" section) turned out wrong in **both** directions.

---

## Execution status (this session, branch `claude/concordia-depth-balance-audit-k0osH`)

Shipped + tested + pushed, in sequence:
- **§1 doc truth-fixes** — corrected 6 stale CLAUDE.md/doc claims (Live Share CRDT, telehealth WebRTC,
  combat scaffolds, weaponise_at, creature loader, music audio graph).
- **D1** — retired two redundant dead combat scaffolds (`CombatMotorBridge`/`ReflexBridge`); confirmed
  the momentum-feel chain already ships via `ImpactMomentumBridge`. (momentum test 8/8)
- **D2** — server-side defensive enforcement: dodge i-frames whiff NPC hits, held block halves damage,
  `combat:block` now engages the block window. (5/5)
- **E2** — combat-feel tune: input buffer 110→90ms, heavy hitstop 115→150ms. (19/19)
- **D3** — NPC player-state reactivity in dialogue (four-axis "what I sense about you"). (6/6)
- **E1** — relative NPC scaling mechanism (the "one law"), env-gated default-off. (7/7, +41/41 regr.)
- **D4** — procedural NPCs now seed the scheme/asymmetry substrate (the 74+ procgen NPCs can scheme). (2/2, +21/21)
- **D7** — Zachtronics percentile histograms for programming puzzles, surfaced in the editor. (8/8)

Found **already shipped** during audit (no work needed): D3 NPC-memory injection (T1.2), D4
schedules + ctOS scannable profiles (recent P2), E4 gift-preference multipliers (`gifting.js`),
scheme overhear/barge-in (T2.3), `weaponise_at` consumption (T2.1).

**Remaining (large items, specced below):** D4 #3/#5 (gear + quest-gating secrets), D5 (CK3 hooks
substrate — new migration+lib), D6 (run-mode payout-on-loss audit), D8 (music wire-up), E0
(frontend-dial infra), E3 (evolution drama + rank ladder), E4 spouse-reactivity, E5 (minigame dials),
C-series (content authoring: tunya lore, festivals/fauna per world, per-world quests).

---

## Execution status (continuation session, branch `claude/audit-findings-remaining-BkcKy`)

Verified against code first (docs treated as stale, per the meta-finding). Two stale
plan claims caught and corrected up front: **D8's "AI-playlist not wired to the LLM" is
WRONG** — `music.ai-playlist` (`server/domains/music.js:1195`) already calls `ctx.llm.chat`
with a deterministic keyword fallback; and the `weaponise_triggers` table the prior agent
thought absent is real (mig 261). Trust the code.

- **D5 — CK3 hooks: SHIPPED.** New migration `277_npc_hooks.js` + `server/lib/hooks.js`
  (grant/upgrade, secret→hook generation with corroboration-promotes-to-strong, weak=single-use
  coercion / strong=passive hostile-scheme block + success bonus, spend, coerce, **inheritance**
  — hooks over a dead NPC re-point to the heir and held hooks pass on, decay sweep, trait summary).
  Wired into: `proposeScheme`/`proposePlayerScheme` (strong-hook block returns `reason:'hooked'` +
  success-pct bonus), `interveneInScheme` (new `blackmail` branch spends a held hook to force a
  scheme to `abandoned`), `onNpcDeath` (hook inheritance), the two secret-discovery macros
  (`secrets.discover`/`surveillance_roll` now yield a hook + new `secrets.hooks_held`), a new
  `GET /api/npc/:npcId/hooks` endpoint surfaced in `NPCTraitInspector.tsx` ("you hold a … hook" /
  "they hold a … hook over you"), and a `hook-decay-sweep` heartbeat (freq 240, global). Contract
  test `tests/hooks.test.js` 22/22; 0 regressions across the 108 scheme/secrets/legacy tests.
- **D6 — run-mode payout-on-loss + risk-scaled spikes: SHIPPED.** Audit finding: roguelite
  already paid a half-currency on death, but **horde/extraction paid nothing on a loss** and no
  mode tied payout to the difficulty gradient. Added shared `run-difficulty.js#grantRunMeta`
  (banks into the single `roguelite_meta_currency` Hades gem bank — per the CLAUDE.md invariant)
  + `lootMultFor`. Roguelite payout now × tier loot-mult **floored at 1.0** (default/finder never
  reduced — finder's seeded 0.5 mult would have halved the default path; heroic/mythic amplify).
  Horde `endHorde` now pays wave×8 + kills×0.25 on **every** end (death included — the run IS the
  reward, wave reached is the risk gradient). Extraction `extract` pays flat 10 + 6/item; death
  pays a 1/item consolation so a wipe still advances meta. New `extractionDanger` (final-stretch
  DbD dread, reuses `horror-dread` radii) surfaced at `GET /api/extraction/:runId/danger`.
  Contract test `tests/run-mode-payout.test.js` 12/12; roguelite/horde/extraction regressions green.
- **E3 — skill-evolution drama + faction E→S rank ladder: SHIPPED.** Fixed the missing
  `skill:evolution-available` emit (the EvolutionModal listened but nothing fired it) + a
  deterministic "Arise" `skill:evolved` beat; faction `rankLetterFor`/`tierToRank` (E→S, level-
  independent) + `reputation:rank-up` on upward crossing; juice-bridge listeners. 8/8.
- **E4 — spouse reactivity: SHIPPED.** `lib/spouse-reactivity.js` — a married NPC reacts to the
  player's factions/kills/schemes/death (deterministic off the spouse's faction+opinions), shifts
  affinity, estranges past threshold; wired into the NPC-kill path + `romance.spouse_react` macro.
  9/9. (Gift preferences — the Stardew half — were already shipped.)
- **D4 #3 — procedural NPC gear: SHIPPED.** Verified the spawner never called `seedStarterGear`;
  wired it into `persistGeneratedNpc` (level-scaled) so procedural NPCs are visually distinct AND
  drop loot on death via the existing kill-path generator. 3/3. (Reused the existing gear economy,
  not a parallel system.)
- **E5 — restaurant Diner-Dash combo: SHIPPED.** Batching combo (quick consecutive serves build a
  tip multiplier, caps at 5, breaks on a late/0-tip serve or lapsed window) + dashboard combo flash;
  visible patience countdown already existed. 4/4.

### Polish-audit items folded in (docs/POLISH_AUDIT.md from main — verified against code first)
- **T0.1 (🔴) code puzzles unsolvable: FIXED.** Editor `{op,a,b}` vs VM `{dst,src,to}` mismatch made
  every program a no-op; added a backward-compatible `_normalizeInstr` adapter. 8/8.
- **T0.2 (🔴) station/HUD audio silent: FIXED.** 38 underscored juice sfx ids never matched the
  hyphenated SFX_MAP; added `SFX_ALIASES` + `resolveSfxId` routed through trigger/spatial SFX.
- **T1.1 NPC dialogue LLM-or-nothing: FIXED.** `composeDeterministicDialogue` — grounded, mood-keyed
  fallback from the same context, no secret leak; wired as the route default. 7/7.
- **T1.2 trivia unwinnable: FIXED.** `getAnswerChoices` (answer + distractor DTUs) → kiosk is now a
  multiple-choice picker; correctness path unchanged. 6/6.
- **T1.5 hacking cosmetic tree: FIXED.** `hintForStep`/`getHint`/`nextHint` turn it into a guided
  trail (the lead, never the literal command); terminal shows "» lead: …". 8/8.
- **T3.2 scheme overhear had no client listener: FIXED.** `SchemeOverhearBargeIn` surfaces
  `scheme:overheard` with Expose / Blackmail (D5 hook) / Ignore. tsc clean.
- **Verified STALE (no work needed — audit/docs wrong, code already does it):** D8 `music.ai-playlist`
  is already LLM-wired with a deterministic fallback (`domains/music.js:1195`); **T3.1** faction-
  strategy already emits `faction:{war-declared,alliance-formed,truce-sought}` and `StrategicWarBanner`
  + `EmergentEventFeed` consume them (mounted in the world lens); **C-series** every world already has
  10–33 lore items (seeder reads `lore.json.history`) — tunya has 33, not "5". The meta-finding holds:
  the docs are stale in both directions; trust the code.

---

## 0. Thesis

Breadth is done. The platform has the *mechanics* of CK3 + Skyrim + Hades + Tarkov + Diner Dash +
Zachtronics + ctOS running on one DTU/royalty substrate — unprecedented for one developer. The gap is
**depth-per-feature**: it loses to each source game on feel and polish.

The web research converged on **three universal, low-cost depth levers**, and they map almost 1:1 onto
state Concordia *already stores but doesn't surface*:

1. **Feedback density** — hit-stop graded by severity, graded hurt-reactions, percentile histograms.
   Pure presentation layers over verbs already built.
2. **Information asymmetry as the depth engine** — CK3 hooks/secrets, Tarkov/DbD hidden info, ctOS
   scannable facts. Where state exists (opinions, grudges, secrets, schemes), the gap is *surfacing it
   as spendable leverage or a visible signal*, not building new simulation.
3. **Persistent, inheritable consequences** — losable kits, hooks that outlive their holder, NPC memory
   of the player.

This plan does not chase per-verb parity with specialist titles (unwinnable). It deepens the **feedback,
leverage, and consequence loops** that are cheap to add and that the substrate uniquely supports.

---

## 1. Meta-finding: the docs are stale in BOTH directions — trust the code

The single most important audit result: **CLAUDE.md's own self-corrections are themselves out of date.**
Decisions must be made against code, not against any doc (including the prior `CONCORDIA_PLAN.md`).

| Doc claim (CLAUDE.md / prior plan) | Code reality (verified) | Evidence |
|---|---|---|
| `code/Live Share` is "a polling op-log, not a real-time CRDT" | **Real Yjs CRDT** — `Y.Text` bindings, Socket.IO sync | `server/lib/yjs-realtime.js`; `attachYjsSync` @ `server.js:7810` |
| `healthcare/telehealth` is "scheduling + optional Daily.co, not a video client" | **Real WebRTC client** — `simple-peer` + signalling relay; Daily.co is fallback | `components/healthcare/TelehealthVideoCall.tsx`, `server/lib/webrtc-signalling.js` |
| Combat momentum model is "dead code" / reflex layer "never instantiated" | **Mounted & wired** — but disconnected mid-chain (see D1) | `ReflexBridge.tsx:29` `new ReflexLayer()`; `CombatMotorBridge`/`ReflexBridge` mounted @ `world/page.tsx:4848,4850`; `ImpactMomentumBridge` @ `CombatBridges.tsx:761` |
| `weaponise_at` is "dead storage, never read" | **Consumed** (T2.1 landed) | `server/lib/embodied/weaponise-triggers.js`, `emergent/npc-scheme-cycle.js` |
| Creature loader "only reads creatures.json; tunya grounds zero" | **Reads `bestiary.json` too** (T1.5 landed); tunya now grounds via bestiary | `server/lib/procedural-creature.js:157-161` |
| Music EQ/crossfade is "a severe stub, zero GainNode code" | **Audio graph exists** (13 GainNode/biquad/crossfade/AudioContext refs) — depth uncertain, verify at runtime | `concord-frontend/lib/music/player.ts` |

**Action (cheap, do first):** correct these six lines in CLAUDE.md / retire the stale prior-plan
claims. A wrong honesty-doc is worse than no honesty-doc — it sends the next session chasing
already-solved problems.

---

## 2. Corrected depth scorecard (verified)

| System | Verified depth | Gap to close |
|---|---|---|
| Combat — momentum/poise/impact-feel/env-bending/terrain-stagger/anti-cheat | **DEEP & live** | none on resolution |
| Combat — biomechanics → motor → reflex → bone animation | **Wired but disconnected mid-chain** | **D1 (highest combat ROI)** |
| Combat — frame-data parry/dodge windows | **Derived, not enforced server-side** | **D2** |
| NPC simulation backend (schemes/grudges/secrets/nemesis/factions/dynasty) | **DEEP** | surface as leverage (D3) |
| Procedural NPCs (post P2/P3 density work) | **Floor** — personality + density, but 0 schedules / 0 load-bearing secrets / 0 relationships / 0 gear / 0 scannable profile | **D4** |
| Information-as-currency (CK3 hooks) | **Absent** — secrets/opinions exist, no spendable hook asset | **D5** |
| Run modes (roguelite/horde/extraction/horror/time-loop) | **Real loops**, untuned | **E-series + D6** |
| Puzzles (programming/hacking) | **Real VM, pass/fail only** | **D7 (histograms)** |
| Music lens | CRDT/WebRTC neighbors are real; **ingestion/AI-playlist/collab-playlist unwired**; EQ/crossfade verify | **D8** |
| Content density | tunya lore (5), festivals hub-only, fauna hub-only, quests sparse per-world | **C-series** |
| Balance dials | Phase E *designed*, values **not applied**; frontend polls not env-tunable | **E-series** |

---

## 3. Depth workstreams (D-series), priority-ordered

Each item: **finding (file:line) → depth target → borrowed-game signal → effort**. Effort is
S (<½ day) / M (1–2 days) / L (multi-day).

### D1 — Combat feel: SHIPPED (already wired) → retire redundant dead scaffolds — DONE
**Audit reversal (the value of trusting code over docs):** the combat *feel* chain is **already
fully wired** and was mis-described as broken. `ImpactMomentumBridge.tsx` (mounted via
`CombatBridges`/`CombatPolishLayer`) subscribes `combat:hit`, runs the live momentum model
(`impact-resolver.ts` → `computeImpactMomentum` — the supposedly-"dead" function is live, pinned by
`tests/impact-momentum-live.test.ts`), and dispatches **momentum-graded** `concordia:hit-pause` +
`concordia:knockback` + `concordia:hit-reaction` for **any target including the local player**, which
`AvatarSystem3D`'s `handleHitReaction` (`:1184`) renders as severity-scaled flinch/stagger/crit clips
+ directional knockback. The 556-LOC biomechanics also drives attack animation via the
`concordia:combat-anim` → `buildBiomechClipMap` clip path (`AvatarSystem3D:1357-1382`). So graded
hurt-reactions — the #1 web-research lever — already ship.
**What was actually wrong:** two **redundant superseded scaffolds** ran dead per-frame rAF loops
producing zero output — `CombatMotorBridge` emitted `concordia:combat-pose-targets` (0 consumers,
verified) and `ReflexBridge` computed a `ReflexLayer` it never emitted *and* subscribed the wrong
`combat:stagger` (terrain/building) event so its stagger branch could never trip.
**Done:** retired both bridge components (unmounted from `world/page.tsx`, files deleted); kept the
live momentum *function* + libs (`combat-motor-driver.ts`/`reflex-layer.ts`/`impact-resolver.ts`,
still used by `ragdoll-imbalance.ts` + the momentum test). Net: removed two dead rAF loops + a latent
wrong-event bug; `ImpactMomentumBridge` is now the unambiguous single source of truth for momentum
feel. No feel regression (the graded reaction already shipped through it). Momentum test still 8/8.
**Borrowed signal:** Skyrim/Sekiro graded hurt-reactions — *already satisfied*; the real remaining
combat-depth gap is the *mechanic* in D2, not feel.

### D2 — Enforce frame-data parry/dodge windows server-side — M
**Finding:** `combat-frame-data.js` derives `parry_window_ms`/`dodge_window_ms`/`active_ms` per skill,
exposed read-only at `/api/combat/frame-data/:skillId`, but the attack path in `routes/worlds.js`
**does not gate on them** — a hit lands regardless of whether the defender's parry/dodge window was
open. So "frame-perfect parry/dodge" is currently decorative.
**Target:** in the combat-attack resolution, when the defender has an active parry/dodge action whose
window overlaps contact, zero/scale the transferred momentum (parry → near-zero momentum + attacker
recovery-punish window; dodge → miss). Compose with D1's momentum model: windows gate *whether*
contact lands, momentum governs *what it does*. Deterministic, server-authoritative, no RNG.
**Borrowed signal:** Sekiro/Elden Ring two-layer model + guard-counter payoff.

### D3 — Surface NPC interiority as visible signal (the "they see me" loop) — player-state read DONE; remainder partly pre-existing
**Audit:** much of D3 was already wired — **memory IS surfaced**: the live `/dialogue` endpoint
injects asymmetry (grudge/preoccupation/desire via `composeAsymmetryContext`, T1.2) + reputation tier +
opinion into the LLM prompt; **scheme intersections** already name who/why via the T2.3 scheme-overhear
+ barge-in work. The genuine remaining gap was **player-state reactivity** — `playerMetrics`
(four-axis) was *fetched but only used for desire-matching*, never surfaced as something the NPC reacts
to.
**Done:** new pure helper `server/lib/npc-player-read.js#describePlayerStateForNpc(metrics, {max,
notorious})` turns the four-axis standing (refusal_debt / concordia_alignment / ecosystem_score /
concord_alignment) into up to 2 qualitative "what I sense about you" prompt lines (no raw numbers,
secrets excluded); wired into `/dialogue` (one shared `getMetrics` fetch now feeds both asymmetry and
the read). Contract test 6/6. Thresholds logged in BALANCE_DIALS as playtest fodder.
**Deferred (lower value / not blocking):** suspicion-on-follow state machine (needs a new follow
detector); a per-NPC `scannable_profile` belongs with D4's procedural-NPC pass.
**Borrowed signal:** RDR2 "NPCs react to your current state" — *now satisfied for standing*.

### D4 — Procedural-NPC depth floor → mid (close the authored gap) — L
**Finding:** `server/lib/npc-generator.js` gives procedural NPCs personality vectors + density but
**0 schedules, 0 load-bearing secrets, 0 relationships, 0 gear, 0 quest hooks, 0 scannable profile**.
Authored NPCs carry ~25–35 rich fields. Many simulation systems (routines, asymmetry, schemes,
legacy) read authored fields and no-op on procedural NPCs.
**Target (in priority order — each is a deterministic generator pass keyed by NPC id):**
1. ~~**6-block schedule**~~ — **already landed** (recent P2 work + the user's "6 schedule blocks,
   sparks" pass) → procedural NPCs run the routine-cycle + show activity tags.
2. ~~**Scannable profile**~~ — **already landed** (recent P2 "ctOS profiles").
3. **Gear/apparel** from archetype pools → visual distinctness + lootable on death. ~250 LOC. *(open)*
4. **Seed asymmetry/scheme substrate** — **DONE.** The spawner (`procedural-npc-spawner.js`) now calls
   `seedNPCAsymmetry(db, npc)` on each created procedural NPC, deriving stress/coping from its generated
   `narrative_context` (secret/fear/goal) via T1.3's `deriveSchemeSubstrateFromNarrative`. Before this
   the deep scheme + asymmetry engines silently no-op'd on the 74+ procedural NPCs — they sat as flavour
   while only the authored cast ever plotted. Now the bulk of the population can scheme. Idempotent,
   guarded so a seed failure never kills the spawn loop. Wiring test 2/2; spawner regression 21/21.
5. *(stretch, open)* a small fraction get a **quest-gating secret** + 1–2 cross-world relationship edges
   so procedural NPCs can seed procedural content, not just flavor.
**Borrowed signal:** ctOS + RDR2 (routine + scannable fact + memory).
**Remaining for D4:** gear/apparel (#3) + the quest-gating-secret stretch (#5).

### D5 — CK3 "hooks": information as a spendable asset — M/L
**Finding:** Secrets and opinions are stored; `weaponise_at` fires a one-shot betrayal; but there is
**no hook primitive** — no held, spendable, expiring leverage. This is CK3's keystone depth mechanic
and the single highest-leverage *new* system the web research identified.
**Target:** add a per-(holder,target) `hook{strength: weak|strong, source_secret_id, expires_at,
uses_left}` record (new migration + lib). Spymaster/secret discovery *generates hook opportunities*;
weak hook = single-use coercion, strong hook = passively blocks the target from hostile action
(scheme/betrayal), both decay (~in-world decade). Wire hooks into: scheme proposal inputs, the
intervene route (expose-vs-blackmail branch), and — crucially — **inheritance** (`npc-legacy.js`): a
hook held over a dead NPC's heir still bites. Surface held hooks in the trait inspector.
**Borrowed signal:** CK3 hooks/secrets/agents — "information itself is a currency."
**Sequence:** builds on the already-deep secrets/opinions substrate; do after D3 so the surfacing
patterns exist.

### D6 — Run-mode payout-on-loss + risk-scaled spikes — S/M
**Finding (Phase E §4):** horror 30 min / time-loop 22 min are in the sweet spot, but verify
**every** run mode (roguelite/horde/extraction) grants persistent meta-progress **on a loss**, and tie
run XP/loot to difficulty tier so audacity yields outsized spikes.
**Target:** audit each mode's death/timeout path for a meta-currency/unlock payout; add risk-scaled XP
multiplier keyed to tier. **Add a terror-radius/dread escalation read** to extraction's final stretch
(DbD anticipation > jump-scare; horror already has `horror-dread.js` terror/chase radii — reuse).
**Borrowed signal:** Hades (loss still pays out) + Tarkov (the extract itself is the risk gradient).

### D7 — Zachtronics percentile histograms for puzzles — DONE
**Done:** `programming-puzzle.js` gained pure `percentileBeating` + `histogramBins` + DB-backed
`solutionHistogram(db, puzzleId, {userId})` (cycles + size distribution, the player's percentile on
each — "faster than N% of solvers" — plus the authored optimum). `submitSolution` now returns `stats`;
new `GET /api/code-puzzle/:puzzleId/stats`; `CodePuzzleEditor` shows the percentile on submit. Turns
pass/fail into an optimisation endgame (histograms, not leaderboards). Tests 8/8.
**(original)** — S/M
**Finding:** `programming-puzzle.js` (MAX_CYCLES=10k) and hacking puzzles track pass/fail only.
**Target:** after a passing solution, score on **orthogonal axes** (cycles / instruction-count /
something area-like) and show the player a **percentile histogram** vs the population of submitted
solutions ("you're in the 78th percentile on cycles"). The single most portable Zachtronics idea;
turns "it works" into an optimization endgame. Optional: a "watch it run" replay affordance.
**Borrowed signal:** Opus Magnum multi-axis scoring + percentile feedback (not leaderboards).

### D8 — Music lens: wire the unwired (or honestly scope it) — M
**Finding:** CRDT and WebRTC neighbors are genuinely deep, but in the music domain: **free-API
ingestion (Jamendo/Audius/iTunes) not wired, AI-playlist infra exists but no macro calls the LLM,
collaborative playlists are DB-schema-only.** EQ/crossfade audio graph **exists** (13 refs) — verify
whether it actually applies before declaring it a stub.
**Target:** pick the highest-value one (likely AI-playlist: infra already exists, just connect the
macro → LLM → frontend) and ship it front-to-back; for the rest, either wire or mark honestly as
roadmap in the spec (no "shipped" language over a stub).
**Borrowed signal:** n/a (parity cleanup, not depth-feel).

---

## 4. Balance pass (E-series) — apply the already-designed Phase E values

`docs/PHASE_E_BALANCE_DESIGN.md` is research-grounded and **designed**, but the values are largely
**not applied to code**. `docs/BALANCE_DIALS.md` + the full dial inventory below are the targets.

### E0 — Make frontend dials tunable (infra prerequisite) — M
**Finding:** ~20 `POLL_MS`/`TICK_MS`/`FRAME_THROTTLE_MS` constants are **hardcoded and not
env-overridable** — a balance pass on them currently requires a frontend rebuild.
**Target:** server-rendered constants endpoint (or build-time env injection) so polls/throttles become
tunable without a rebuild. Until then, any poll tuning is a code edit.

### E1 — Relative NPC scaling (the one law) — mechanism DONE (gated; enable = playtest step)
**Audit:** `entity-power.js` scaled NPCs by their **own grown level** (absolute), with **no
player-relative scaling** — so the §0 "one law" wasn't implemented.
**Done:** added `getPlayerCombatLevel` + `relativeScaledLevel(npcLevel, playerLevel, {named})` +
`RELATIVE_DIALS` to `entity-power.js` implementing the research bands (common capped at player×0.85 so
the player outgrows trash; named/boss floored to ~player×1.05 so they stay a credible threat; never
inflates weak trash nor nerfs an already-overlevelled boss). Wired into `/combat/npc-attack` (named =
boss type / authored-conscious / title-bearing archetype). **Env-gated by `CONCORD_RELATIVE_SCALING`,
default OFF** — the absolute living-world model stays default; flipping it on is the playtest-driven
tuning step (mirrors `CONCORD_ABSOLUTE_POWER`). Bands env-overridable (`CONCORD_REL_COMMON_LO/HI`,
`CONCORD_REL_NAMED_LO/HI`). Band-math + gating test 7/7; entity-power regression 41/41.
**Why gated, not on:** §0 is "the decisive dial" but the Phase E doc itself frames it as
playtest-driven; shipping the mechanism gated lets a playtest flip it without a code change, and keeps
default behaviour a strict no-op (zero regression risk).

### E2 — Combat-feel micro-tune — DONE
Per §1: input buffer `DEFAULT_BUFFER_MS` 110→**90ms** (`combat-input-buffer.ts`); heavy-tier
("rocked") hitstop `SEVERITY_FEEL.rocked.targetPauseMs` 115→**150ms** (`impact-feel.js`, toward the
SF2 ~167ms heavy benchmark) — note the old "80ms heavy" was the *replaced* GameJuice heuristic; the
impact-feel mapping already graded it. Coyote 120 / jump buffer 130 / kill-freeze kept. Tests:
input-buffer 6/6, impact-feel + balance-dials 13/13 (ordering invariants intact).

### E3 — Skill-evolution drama + rank ladder — M
Per §2–3: dramatize the ~per-10-level evolution as an "Arise"-style named beat via
`LevelUpJuiceBridge`; surface faction reputation as an explicit E→S rank ladder decoupled from level.

### E4 — Courtship: gift multipliers (DONE/pre-existing) + spouse reactivity (open) — M
**Audit:** the gift-preference multiplier part is **already shipped** — `server/lib/gifting.js` has
per-archetype + authored-override gift preferences, `giftReaction`, `GIFT_DELTA` (loved 0.15 / liked
0.10 / neutral 0.03 / disliked −0.05) + `REACTION_SENTIMENT`, wired via the `romance.give_gift` macro
through `courtInteraction`. That's the Stardew "knowing the person" model §5 asked for. `COURT_AFFINITY_
DELTA 0.05` (earned cadence) is intact.
**Open:** spouse **reactivity** — make the spouse a complicating force that reacts to the player's
faction choices / schemes / deaths (the "bigger than the love story" benchmark). Deeper feature; not
started.

### E5 — Run-mode + minigame dials — S
Adopt the playtest-fodder values once D6/D7 land. Restaurant tips already at 0.20/0.15 (T3.4). Diner
Dash batching-combo multiplier + visible patience timers are the satisfying-loop additions.

> **Full untuned-dial inventory** (verified file:line, current values) is captured in
> `docs/BALANCE_DIALS.md` and the audit appendix — restaurant TTL/tips, horror dread/terror/chase
> radii, time-loop 1320s, code-puzzle 10k cycles, roguelite 0.5×/1.25×/5, horde 1.0/1.25×, player-sign
> TTL/limits, corpse radius/loss, romance 0.05/0.60/0.85/0.30, theme-park 0.001/0.15, world-boss
> 24/48/72h, ~20 frontend polls. None are constitutional invariants — they're playtest targets.

---

## 5. Content pass (C-series) — feed the engines that scale with content

The content layer is decoupled (drop a JSON, the seeder + heartbeats consume it). Author into the
fields the engines actually read.

- **C1 — Tunya lore** (5 → ~12 items): the flagship world's lore is thinnest by far. Add creature-tied
  + faction-tied events. **C-priority #1.**
- **C2 — Festivals + fauna beyond hub:** both substrates exist only in `concordia-hub`. Author 1–2
  festivals and a fauna/fish set per major world.
- **C3 — Per-world quest chains:** quests are global/sparse (13 files). Author a 5–7 step chain + 2–3
  side quests for the thin worlds via the existing `seedQuestFile` path, into the
  forward-sim/beat-cascade fields.
- **C4 — Author into engine-read NPC fields:** as D4 lands, ensure new authored NPCs carry rich
  `narrative_context` + `relationships` (the scheme/faction engines consume them).
- **(not a gap)** Tunya creatures: census artifact — loader reads `bestiary.json`; tunya is grounded.

---

## 6. Recommended sequence

1. **Cheap truth-fixes first:** §1 doc corrections (S) — stop the next session re-solving solved
   problems.
2. **D1 + D2 + E2** — the combat-feel cluster. Highest single-domain ROI; D1 connects already-built
   depth, D2 makes windows real, E2 tunes the feel. Ship together.
3. **D3** — surface NPC memory/intersections (cheap reads, big perceived-life gain).
4. **E1** — relative scaling (the one law; gates whether anything feels threatening).
5. **D4** — procedural-NPC depth floor (schedule → scannable → gear → DB grudges).
6. **D5** — CK3 hooks (new system; builds on D3's surfacing + the deep secrets substrate).
7. **D6 / D7 / E3 / E4 / E5** — run-mode payout, puzzle histograms, evolution drama, courtship depth.
8. **C-series** — content density into the now-fully-lit engines.
9. **D8 + E0** — music wire-up + frontend-dial infra (parallelizable, lower urgency).

**Quality bar (user's standard): done/complete, beyond-AAA — no stubs, no fake data, no deferrals.**
Each D/E item ships with a contract test pinning the new behavior (deterministic where physics/state is
involved — no RNG in resolution paths).

---

## 7. Audit appendix — what was personally verified this pass

- Combat bridges mounted: `world/page.tsx:4848,4850`, `CombatBridges.tsx:761`. Motor fed empty poses
  (`CombatMotorBridge.tsx:54`); `concordia:combat-pose-targets` has **0 consumers** (grep).
- Live Share CRDT: `server/lib/yjs-realtime.js` present.
- Telehealth WebRTC: `components/healthcare/TelehealthVideoCall.tsx`, `server/lib/webrtc-signalling.js`.
- `weaponise_at` consumer: `server/lib/embodied/weaponise-triggers.js`.
- Creature loader merges bestiary: `server/lib/procedural-creature.js:157-161`.
- Music audio graph exists: `concord-frontend/lib/music/player.ts` (13 GainNode/biquad/crossfade refs).
- Content census + balance-dial file:line inventory: 5-agent audit (this branch).
- Recent landed work (git log): P2 NPC density →≥30/world, P3 content census (factions/crops/puzzles),
  NPC depth-floor regression fix, T-series game-plan completion — reconciled into the scorecard above.
</content>
</invoke>

---

## 8. Remaining after the 2026-05-29 continuation (for the next session)

All high- and medium-value D/E items + the verified-real polish-audit fixes are
**shipped, tested, and pushed** on `claude/audit-findings-remaining-BkcKy` (see the
execution-status section above and the CLAUDE.md "Recent shipped work" row).

**Genuinely still open (lower value, each non-blocking):**
- **D8 (music):** `ai-playlist` is wired (stale claim corrected) and the **collaborative-
  playlist edit path is now wired** (cross-user add/detail/list, `tests/music-collab-
  playlist.test.js`). Only **free-API ingestion** (Jamendo/Audius/iTunes) remains unwired —
  needs network egress; wire it end-to-end or mark roadmap (no "shipped" over a stub).
- **E0 (essentially DONE):** infra shipped (`/api/config/client` + `useClientConfig`); **20
  Concordia world-lens components migrated** — every world-lens poll / frame-throttle cadence is
  now server-tunable without a rebuild. Only **non-world surfaces remain** on hardcoded intervals
  (`components/crisis-ops/AlertsPanel.tsx`, `components/docs/usePagePresence.ts`) plus a couple of
  niche intervals (NemesisGlyphLayer's 8s discovery poll) — out of the Concordia HUD scope; migrate
  with the same one-line pattern + a new config key if desired.

> **Verifying frontend changes in this memory-constrained container:** the full-project
> `tsc --noEmit` OOMs (it globs all ~hundreds of components). Since everything prior already
> passed tsc, scope tsc to just the changed files: write a `concord-frontend/tsconfig.scoped.json`
> that `{ "extends": "./tsconfig.json", "include": [<changed files> + "next-env.d.ts" + "hooks/useClientConfig.ts"] }`
> (the `extends` keeps `@/` path aliases working), then
> `NODE_OPTIONS=--max-old-space-size=1536 npx tsc -p tsconfig.scoped.json --noEmit --skipLibCheck`.
> This checks only the changed files + their import graph — fits in memory, EXIT 0 = clean.
> Delete the scoped config after (it's an ad-hoc artifact). Every frontend change this
> session was verified this way.
- **POLISH_AUDIT Tier-2 combat feel — T2.7 + T2.1 SHIPPED; T2.8/T2.11 deferred.**
  - **T2.7 (done):** `lib/concordia/hit-pause.ts#requestHitPause` is the single deduped authority
    — GameJuice (legacy/PvP) and CombatBridges (impact-feel) both route through it, so one strike =
    one freeze (120ms window, first-wins). `tests/hit-pause.test.ts` 5/5.
  - **T2.1 (done):** light landed hits get a 35ms freeze (was 0 — weightless).
  - **T2.8 (FOV punch on crit/kill) + T2.11 (screen-shake) deferred:** the `concordia:camera-punch`
    consumer exists, but GameJuice has no local-userId and its crit/kill triggers aren't reliably
    player-scoped — dispatching blind would punch the camera on *witnessed* NPC crits (worse than
    now). Needs local-player gating + a playtest to tune; left for a focused in-app pass.
- **POLISH_AUDIT T3.3 (scarcity → player price):** wiring NPC↔NPC scarcity into a player
  buy price touches the constitutional marketplace-fee constants — needs governance care.

**Verified STALE (do NOT re-solve — the code already does it):** D8 ai-playlist,
T3.1 faction-strategy surfaced (StrategicWarBanner + EmergentEventFeed), C-series content
(10–33 lore items per world). The meta-finding stands: the docs are stale in BOTH
directions — verify against code before building.
