# Concordia Polish Audit (2026-05-29)

> **✅ RESOLUTION STATUS (re-verified against code 2026-06-02).** This is a dated
> audit; its Tier-0 findings were real on 2026-05-29 and the body below is kept
> as the record. The headline Tier-0 defects have since been **fixed** — verified
> in code, not prose:
> - **Code puzzles unsolvable** → fixed (`programming-puzzle.js#_normalizeInstr` maps `{op,a,b}`→`{dst,src,to}`).
> - **Station/HUD audio silent** → fixed (`SoundscapeEngine.tsx#resolveSfxId` + `SFX_ALIASES`).
> - **NPC dialogue LLM-or-nothing** → fixed (`npc-dialogue-fallback.js#composeDeterministicDialogue`).
> - **PvP combat has no server-authoritative feel** → fixed 2026-06-02 (the socket `combat:attack` path now emits `combat:impact` via `derivePvpSeverity`/`pvpMomentumFromDamage` in `impact-feel.js`).
>
> Re-audit any remaining item against code before treating it as live. For
> current counts use `npm run check-doc-claims`.

Goal: a code-grounded map of where Concordia falls short of AAA polish, so the
"outpolish the games we borrow from" push has concrete targets. Every item below
was **verified against actual code** (not CLAUDE.md prose) by five parallel audits:
combat feel, juice/feedback, minigames, NPC simulation, lens parity. File:line
references are to the working tree at this commit.

Severity: 🔴 broken (ships non-functional) · 🟠 unplayable/major seam · 🟡 feel gap ·
🔵 invisible simulation · ⚪ untuned.

---

## Tier 0 — 🔴 Broken (shipping defects)

### T0.1 Code puzzles are unsolvable through the UI (field-shape mismatch)
The editor emits `{ op, a, b }` (`concord-frontend/components/world/CodePuzzleEditor.tsx:59,77`),
the route passes the body straight through (`server/server.js:49375`), but the VM
reads `instr.dst / instr.src / instr.to` (`server/lib/programming-puzzle.js:92-117`).
So operands are `undefined`, every program is a no-op, and **no code puzzle can be
completed** — including the 12 just added (the content test proved them solvable via
the VM's field shape, which the UI doesn't speak).
**Fix:** map `a→dst`, `b→src`, add a `to` field for JMP/JEZ — in the editor or as a
route adapter. One small change.

### T0.2 The Phase Z7 station/HUD sound layer is entirely silent (id mismatch)
`lib/concordia/juice.ts` dispatches underscored SFX ids (`ui_menu_open`, `ui_success`,
`ui_failure`, `ui_milestone`, `ui_discovery`, + 16 component-specific ids). `SoundscapeEngine`'s
`SFX_MAP` contains only hyphenated keys (`ui-click`…) and `triggerSFX` does a raw
`SFX_MAP[sfxId]` lookup with no normalization (`components/world-lens/SoundscapeEngine.tsx:827,856`).
**Result:** opening any of the 11 station overlays, planting, crafting, minting,
hacking, karaoke, mahjong, trivia, brawl invites → zero sound.
**Fix:** an alias/normalize table in `triggerSFX` (underscore↔hyphen) + register the
missing ids. Highest ROI in the codebase.

### T0.3 PvP combat has no server-authoritative feel
The momentum→poise→stagger→`combat:impact`→hitstop/knockback/wince chain is emitted
**only** on the NPC HTTP route (`server/routes/worlds.js:2271`). The socket PvP path
(`server/server.js:8273`, `cityPresence.applyAttack`) emits `combat:attack:ack`/`combat:hit`
only — player-vs-player falls back to GameJuice's `damage>25` heuristic, so it has no
poise, no momentum, no server-driven stagger.
**Fix:** run the `combat-impact.js`→`impact-feel.js` chain in the socket `combat:attack`
handler and emit `combat:impact` for player targets.

---

## Tier 1 — 🟠 Unplayable interactions / honesty seams

### T1.1 Primary NPC dialogue is LLM-or-nothing
`POST /:worldId/npcs/:npcId/dialogue` always calls the LLM (`routes/worlds.js:1094`,
no `CONCORD_*_LLM` gate). The fallback when Ollama is down/slow is `interactResult.greeting`
— a random pick from **12 hardcoded lines, 2 per mood** (`server/lib/npc-relations.js:267-274`),
with no body content. On any box without a fast LLM (the default-experience risk), every
NPC collapses to "Mmhm." / "Make it quick." The rich grounding (routine activity, grudge/
desire/preoccupation, reputation) is loaded into scope and fed only to the LLM, discarded
on fallback.
**Fix:** a `composeDeterministicDialogue(npc, player, ctx)` keyed by archetype + mood +
the already-loaded asymmetry context + current activity, called as the fallback at
`routes/worlds.js:1097` and `:1220`.

### T1.2 Trivia is unplayable as a quiz
Correctness is `citedDtuId === answer_dtu_id` exact string match (`server/lib/trivia.js:64`);
the UI asks the player to type a raw DTU id (`TriviaKioskPanel.tsx:115-121`). No human
can know the answer id → effectively unwinnable.
**Fix:** multiple-choice picker (3-4 candidate DTU titles incl. the answer) or DTU
search/autocomplete.

### T1.3 healthcare/telehealth poses as video with no disclosure
`server/domains/healthcare.js:1790-1833` returns `roomProvider:"concord-webrtc"` +
`joinToken` but there is no concord-webrtc signaling server; a real URL appears only if
`DAILY_API_KEY` is set. The frontend has zero `getUserMedia`/`<video>` code. Without the
key, "telehealth" produces an un-joinable record and **nothing in the UI says so**
(crypto, by contrast, discloses its simulation). Highest credibility risk.
**Fix:** disclose in-UI when no provider key is configured, or wire a real WebRTC path.

### T1.4 "Real-time multiplayer" lenses are single-user
- **code/Live Share** (`server/domains/code.js:2153-2208`): last-write-wins full-content
  snapshots on a polled op-log; no OT/CRDT. Concurrent edits to a file are last-poll-wins.
- **whiteboard** (`whiteboard/page.tsx:157,163`): persists a blob via `useLensData`; mounts
  a "Live" badge but `whiteboard:update` is never emitted (`event-shapes.js:464` only lists
  it) → no collaboration. The defining feature of a whiteboard is absent.
**Fix:** either ship real multiplayer (Yjs CRDT already exists for CollabDoc — reuse it)
or drop the "Live"/multiplayer framing.

### T1.5 Hacking terminal tree is cosmetic
`attemptCommand` is pure full-command-line string equality against an authored sequence
(`server/lib/hacking.js:63-64`); the server never parses commands or consults the tree.
Exploring the filesystem gives no guidance toward the solution — the fiction (penetrate a
system) and mechanic (memorize a command list) don't match.
**Fix:** make the solution path-derived — `cat` a file whose text reveals the next host,
then `connect` to it — so tree content carries the puzzle.

---

## Tier 2 — 🟡 Combat & game-feel gaps

| # | Finding | Location | Fix |
|---|---|---|---|
| T2.1 | **No hitstop on light attacks** — the most common hit (`targetMs = heavy\|\|crit ? 80 : 0`) is weightless | `GameJuice.tsx:162` | give light hits ~30-45ms hitstop |
| T2.2 | **No whiff/swing SFX** — missed swings are silent; sound only on landed `combat:hit` | `CombatInputController.tsx` (dispatchAction) | local swing-whoosh on attack/kick |
| T2.3 | **Lock-on doesn't move the camera** — sets `lockedTargetId` for auto-target only; reticle is a yaw approximation that visibly drifts | `LockOnController.tsx:152-165` | subscribe camera to `lockedTargetPos`; project reticle through real camera matrix |
| T2.4 | **`CombatMotorBridge` is dead** — wrong event source, empty poses, unbound skeleton, output consumed by nothing; runs a per-frame rAF loop | `components/world/CombatMotorBridge.tsx`, mounted `page.tsx:4848` | wire to skeleton or delete |
| T2.5 | **`ReflexBridge` is dead** — emits nothing; `falling`/`slip` hardcoded false | `components/world/ReflexBridge.tsx`, mounted `page.tsx:4850` | wire `contribute()`/emit or delete |
| T2.6 | **`AnimationManager.tsx` (444 LOC) animates nothing** — `setTimeout` then flips a boolean; never touches the mixer | `AnimationManager.tsx:195-199` | delete or connect to mixer |
| T2.7 | ✅ **DONE (2026-06).** Shake is now one trauma authority — `lib/concordia/screen-trauma.ts` (the Eiserloh model). `ConcordiaScene` constructs one `createTraumaShake` for the 3D camera (world-unit amplitudes) instead of its own inline noise+math; `GameJuice`'s 2D HUD shake (a separate, legitimate render target) scales by the shared `traumaForSeverity` curve. One model, one severity map, two surfaces. (The `combat:hit`/`combat:impact` double-fire dedupe is a separate, still-open concern.) | `ConcordiaScene.tsx`, `GameJuice.tsx`, `screen-trauma.ts` | (done) |
| T2.8 | ❌ **STALE — already shipped.** A combat-wired camera FOV punch exists: `ConcordiaScene.tsx` consumes `concordia:camera-punch` (FOV kick via `cameraPunchRef.fov`), dispatched live from `CombatBridges.tsx:529,742` on crit/kill, with regression test `tests/combat-prediction-camera-punch.test.ts`. The "no FOV punch" claim is contradicted by the code. | `ConcordiaScene.tsx`, `CombatBridges.tsx:529,742` | (none — already done) |
| T2.9 | **Shared 250ms attack cooldown drops chained inputs** — a kick within 250ms of a light attack is silently dropped server-side after the client predicted it → visible desync | `server.js:8188` | per-action-type cooldowns / combo window |
| T2.10 | ✅ **DONE (2026-06).** Dodge/parry cancel window wired. `CombatInputController` now tracks each offensive action's recovery window (`lastOffenseRef`) and gates a defensive (Q/F) press through `cancelState` — it commits to the swing's active frames, then cancels the recovery once ≥`CANCEL_THRESHOLD` (50%) through; before the window opens the press waits in `pendingDefensiveRef` and the 50ms tick flushes it the instant it does (250ms grace), so the escape stays responsive without aborting a committed swing on frame 1. No live commitment → dodges fire instantly as before. | `CombatInputController.tsx`, `combat-input-buffer.ts` | (done) |
| T2.11 | **GameJuice "screen shake" shakes an empty transparent div** (2D HUD path); only in-scene combat gets real shake. (T2.7 aligned its magnitude to the shared severity curve, but the 2D overlay is still a transparent div — a visible vignette/letterbox is the remaining polish.) | `GameJuice.tsx:277-287,347-354` | add visible vignette to the 2D shake overlay |
| T2.12 | **No recorded audio assets** — 0 `.mp3/.wav/.ogg` in `public/`; 100% oscillator synthesis (caps the audio ceiling hard) | — | add recorded foley/SFX/music bed |
| T2.13 | ⚠️ **PARTIAL — positions ARE interpolated.** The poll IS 10s (`page.tsx:2621` `setInterval(loadNPCs, 10_000)`), but NPC meshes lerp toward the polled target each frame (`AvatarSystem3D.tsx:2730` `mesh.position.lerp(targetPos, npcInterpFactor)`), so they glide rather than teleport. The remaining concern is poll *latency* (a 10s-stale target), not stepped motion. | `page.tsx:2621`, `AvatarSystem3D.tsx:2730` | optional: shorten poll or push position deltas over socket |

---

## Tier 3 — 🔵 Simulation that runs but the player can't see

| # | System | State | Location | Fix |
|---|---|---|---|---|
| T3.1 | **Faction-strategy (CK3 stances)** | fully dark — macros exist, no `.tsx` consumer, no socket emit | `server.js:585`; `faction_strategy.recent_moves` macro; `embodied/faction-strategy.js#applyMove` | "Realm Politics" event-log panel + `faction:move` emit on war/alliance |
| T3.2 | **`scheme:overheard` barge-in** | ❌ **STALE — already shipped.** `SchemeOverhearBargeIn.tsx` subscribes to `scheme:overheard` and surfaces an Expose / Blackmail (D5 hook) / Ignore toast; mounted at `app/lenses/world/page.tsx:5179`. The "no client listens / 0 consumers" claim is contradicted. | `SchemeOverhearBargeIn.tsx`, mounted `page.tsx:5179` | (none — already done) |
| T3.3 | **Scarcity economy** | NPCs trade with scarcity pricing, but **no price the player pays ever moves**; `priceForRecipeWithScarcity` is NPC↔NPC only; `WalkerArbitrageMap` is read-only | `npc-marketplace.js:88`; `WalkerArbitrageMap.tsx` | wire scarcity into a player buy route, or add buy/sell to the arbitrage map |

(Routines, nemesis, dreams, forward-sim are the model done right: heartbeat → DB →
poll/socket → mounted HUD. Copy that pattern for the three above.)

---

## Tier 4 — ⚪ Untuned constants (the real "Phase E" surface, enumerated)

**Combat:** `CombatInputController.tsx:308-310` (baseDamage 18/10, handMul, finisherMul),
`:63` HOLD_THRESHOLD 220ms, `:193` DOUBLE_TAP 280ms; `combat-impact.js:101` BASE_POISE 13,
`:50` SWING_ARC 2.4, frame defaults; `impact-feel.js:33-36` SEVERITY_FEEL table (pause/
knockback/knockMs — "tuned against the old heuristic," not playtested); `server.js:8188`
250ms attack / `:8634` 400ms dodge; `LockOnController.tsx:38-39` radius 25 / cone 60°.

**Juice/audio:** `GameJuice.tsx:61-78,162-189` (durations, hit-pause 80/200, knockback 4/5/6);
`SoundscapeEngine.tsx:476` master 0.6, `:203` crossfade 400ms, `:217-219` panner rolloff,
`:240` tone gain 0.25, `:804` 32 cap; `element-vfx.ts:95` maxConcurrent 24.

**Poll intervals (~24 HUDs):** ranging 800ms–5min — `RestaurantDashboard 2000`, `MahjongTable 800`,
`SubmarineHUD 1000`, `ExtractionRunHUD 2000`, `TimeLoopHUD 2000`, `HorrorRoleHUDs 2500`,
`Courtship/Footprint/Climbing 30_000`, `DriftAlertToast 15_000`, `ForwardPredictions 300_000`,
`WorldHealthBadge/DreamReader 60_000`, etc. (full file:line list captured in audit notes).

**Minigames:** `programming-puzzle.js:12` MAX_CYCLES 10_000; `FarmTileEditor.tsx:29-30` GRID 5×5.

---

## Minigame depth ranking (worst → best)

1. **Code** — 🔴 broken (T0.1). 2. **Trivia** — 🟠 unplayable (T1.2). 3. **Hacking** — tree
cosmetic (T1.5). 4. **Karaoke** — pitch detection real, but scores **consistency not melody**
(`pitchAccuracyHz` = std-dev of your own pitches; `KaraokeMicrophone.tsx:120-122`); no target
contour in lyric files. 5. **Hidden-object** — works but **only minigame with no juice/SFX**
and no found-markers on the image (`HiddenObjectScenePanel.tsx`). 6. **Farming** — real growth,
but `watered_at` is written and never read (`farming.js:65` vs `advanceGrowth`) — watering is
dead; no growth animation. 7. **Mahjong** — deepest (real seeded wall + 3 NPC AIs + 14-tile
yaku decomposition in `server/lib/mahjong/`); risk is the **stale legacy checkbox route** still
exposed (`minigame-resolvers.js:140-161`, `/api/mahjong/resolve`). 8. **Restaurant** — tuned &
solid; missing miss-feedback + tip-amount popup.

---

## Stale CLAUDE.md claims corrected (verified)

- **Mahjong** — CLAUDE.md says "tiles aren't tracked / check off yaku you have." **Stale.** A
  real tile engine now exists (`server/lib/mahjong/session.js`, `yaku-detect.js`) and is what the
  UI uses. The checkbox path is superseded legacy code — should be retired.
- **Restaurant tips** — CLAUDE.md lists them as untuned. **Stale.** Tuned in T3.4 (`restaurant.js:15-22`,
  env-overridable).
- **Karaoke** — claim "real Web Audio pitch detection" is **TRUE** (real autocorrelation), but the
  scoring caveat above isn't documented.
- **Combat motor-driver / reflex-layer / AnimationManager** — CLAUDE.md cites all three as
  load-bearing; **all three are dead/disconnected** in the live path (T2.4-T2.6). Baked
  biomechanics clips are the real animation path; that part is true.
- **Lock-on "soft+hard"** — overstated; it's auto-target, no camera lock (T2.3).

---

## Genuinely solid (so the real ratio is clear)

accounting (real double-entry, 4012 LOC) · music (Krumhansl-Schmuckler key detection, BPM,
chords) · atlas (live tomography backend) · legal (date math, compliance, LLM contract analysis) ·
message (real DM store) · marketplace (real browse/pack/install) · NPC routines · nemesis graph ·
dreams · forward-sim · combat VFX (pooled particles, blood decals, weapon trails, footstep dust) ·
in-scene camera shake + FOV punch. The "rival-shape" lenses mostly do genuine domain work; the
roadmap-stub pattern is contained to `personas` exactly as documented.

Caveat: healthcare/legal/music/code store domain data in `globalThis._concordSTATE` (snapshot-
serialized), **not** the SQLite schema — functional, but lower durability/concurrency than the
DB-backed apps they pose as.

---

## Recommended fix sequence (highest ROI first)

1. **T0.1 + T0.2 + T0.3** — three small, unambiguous fixes that unbreak code puzzles, restore
   all station/HUD audio, and give PvP real feel. Do these first.
2. **T1.1** — deterministic dialogue composer (the #1 interaction; removes the LLM-off cliff).
3. **T1.2 / T1.5** — make trivia + hacking actually playable.
4. **T1.3 / T1.4** — disclose or fix the telehealth/multiplayer seams (credibility).
5. **T2.x feel pass** — light hitstop, whiff SFX, lock-on camera, kill the dead bridges, dedupe
   hitstop; this is the combat "vertical slice to beat Skyrim."
6. **T3.x** — surface faction politics, scheme overhears, and a transactable economy.
7. **T4 / Phase E** — playtest-tune the enumerated constants.
