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

### D5 — CK3 "hooks": information as a spendable asset — DONE
**Done:** new `npc_hooks` substrate (migration **277**) + `server/lib/npc-hooks.js`:
- per-(holder,target) hook `{strength: weak|strong, source, source_secret_id, uses_left, expires_at}`,
  holder/target either player or NPC. **weak** = single-use coercion (spent on use); **strong** =
  unlimited use AND passively **blocks** the target from hostile action against the holder.
- `grantHook` (idempotent on holder+target+secret), `getActiveHooks`, `hasBlockingHook`, `spendHook`
  (weak depletes, strong never), `expireHooks` GC, `grantHookFromSecret` (strength scales with secret
  discovery_difficulty — deep secrets = strong leverage), `inheritHooks`.
- **Wired into the existing substrate (5 points):** `discoverSecret` grants the player a hook over the
  secret's subject; `weaponiseSecret` spends it (weak consumed, strong persists); `seedFromAuthored`
  gives each holder NPC a hook over their secret's subject (NPC blackmail leverage); `proposeScheme`
  now (a) returns `blocked_by_hook` when the target holds a strong hook over the plotter [CK3 passive
  block] and (b) treats a held hook as motive (bypasses the disposition gate + biases to blackmail);
  `onNpcDeath` calls `inheritHooks` so leverage outlives the person ("a hook over a dead man's son
  still bites" — both held hooks → heir and hooks-over-deceased → heir).
- Player surface: `hooks.mine` macro (leverage you hold). Privacy invariant intact (hooks store only
  `source_secret_id`, never the secret body — the secret-leakage test stays green).
- Env dials: `CONCORD_HOOK_TTL_S` (default 0 = no expiry), `CONCORD_HOOK_STRONG_DIFFICULTY` (default 8).
- Tests: `npc-hooks.test.js` 16/16; touched-lib regression (secrets/schemes/legacy) 79/79.
**Borrowed signal:** CK3 hooks/secrets — "information itself is a currency"; satisfied end-to-end.

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
