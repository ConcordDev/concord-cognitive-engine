# Temperament, Restraint & Capture — Build Plan (execution)

Companion to `docs/TEMPERAMENT_ENGINE_SPEC.md`. The spec is the *design*; this is
the *code-verified execution order*. Every claim below was checked against the
working tree first (trust the code over the spec); the corrections section lists
where the spec was wrong.

**Kill-switch:** `CONCORD_TEMPERAMENT` (unset/`0` == today's archetype-only
behavior, byte-identical). Every phase ships behind it with its own contract
test and 0 regressions — same cadence as the Layer 7–13 / Phase A–F work.

---

## Audit ground truth (verified 2026-05-31)

**Built-but-dormant — the spec's reuse claims hold:**

| Substrate | File / table | Reader reused |
|---|---|---|
| Archetype-only hostility | `server/lib/npc-simulator.js` `AGGRO_PROFILE`; FSM `idle→alerted→pursuing→attacking`; only emotional gate is `effectiveAggro = isWanted ? 0.9 : profile.aggro` (`:123`) | the modulation point |
| Stress + 5 coping traits | `npc-stress.js#getStress` / `npc_stress` (mig 152): drink/reckless/paranoid/withdraw/cruel | `stressTerm` |
| Grudges (severity 1–10) | `npc_grudges` (mig 128), `(npc_id,target_kind,target_id,severity,resolved_at)` | `grudgeTerm` + floor |
| Opinions (−100..+100) | `character_opinions` (mig 153), score; ≤−50 = "hates" | `opinionTerm` |
| Family grief→radicalization | `world_npcs.grief_level` / `radicalized` (thr 0.70) | `emotionTerm` + floor |
| Hooks leverage | `hooks.js#blocksHostileAction(db,{plotterKind,plotterId,targetKind,targetId})` — exact signature to extend from schemes to combat | hook cap |
| Faction relations | `embodied/faction-strategy.js#getRelation(db,a,b)` → `{score,kind}` | `factionTerm` |
| Help broadcast | `npc-simulator.js#_callForHelp`, `npc-opinions.js#cascadeFamilyAndAlly` | Part 6 spread |
| Zones | `world-zones.js` `ZONE_KINDS`, `combatRuleFor`, sanctuary `noAggro:true` | Part 6 lore-weld |
| Crime/bounty/witness | `world-crime.js` `recordTheft`/`detectiveTick`/`guardTick`, `arrest_records`, `is_wanted`/`bounty`/`criminal_rep` | Part 4 |

**Corrections the code forced (spec was wrong / imprecise):**

1. **`npc_nemesis` is a relationship graph (9 kinds: rival/mentor/family_enemy/…),
   NOT a "hates/fears trait" list.** Part 1's `traitBias` must read nemesis edge
   kind+intensity, not nonexistent trait columns. *(Deferred past Phase 1 —
   grudge+opinion already cover the per-target signal.)*
2. **`is_conscious` is NOT a downed flag** — it's a persistent classification
   (`is_conscious=0` = autonomous killable world-NPC; `npc-simulator.js:5`). Part 5's
   DOWNED band needs a **new** `world_npcs.combat_state` column, never a repurpose.
3. **No "heat" fast-meter exists** — only `bounty` (slow). Part 4 = *add* HEAT.
4. **`guardTick` is read-only** — returns `{wantedNearby,recentCrimes}`, drives no
   graded response. Spec's "guards don't read crime" is true in effect.
5. **faction-strategy has no `ransom`/`capture` move** (moves: EXPAND/WAR/ALLIANCE/
   TRUCE/FORTIFY/RAID/WITHDRAW/REBUILD). Part 5's ransom goal is genuinely new.
6. **Combat has exactly one outcome band: DEAD** (`npc-consequences.js:55 is_dead=1`).
   No incapacitated/downed path today.

**Conventions:** highest migration **314** (next 315); ESM (`export function`);
table-guarded try/catch readers; `node:test` + in-memory `better-sqlite3` contract
tests; dials documented in `docs/BALANCE_DIALS.md`.

---

## Phase order (each = kill-switch off by default + contract test + 0 regressions)

1. **Keystone — `npc-temperament.js` + `disposition()`** ✅ *shipped.* Reads the
   dormant emotional/social state and modulates `effectiveAggro` in
   `npc-simulator.js`. Off == archetype-only. The headline payoff: a *radicalized /
   severely-grudging* pacifist (farmer, base aggro 0.0) can finally raise a hand;
   a hook the target holds over the NPC stays its emotional escalation. Test:
   `tests/npc-temperament.test.js` (20/20).
2. **Graded escalation ladder + barks + de-escalation verbs** (Part 2). ✅ *shipped.*
   `server/lib/temperament-ladder.js` layers the intent ladder
   (NEUTRAL→WARY→WARNING→THREATENING→HOSTILE +FLEEING) on the movement FSM:
   `targetRung` = min(disposition cap, proximity cap); `stepRung` forces a
   THREATENING (final-warning) tick before HOSTILE so an NPC always warns before
   it strikes; the attack path is gated on `isEngaged(rung)`; every up-transition
   emits a `world:npc-bark` socket event (F.E.A.R. legibility — verified);
   `applyDeescalation` maps holster/yield/comply/pay to rung drops (route wire in a
   later slice). Off by default. Test: `tests/temperament-ladder.test.js` (11 suites).
   *Follow-on:* frontend `world:npc-bark` subscription in `EmergentEventFeed` +
   the player-verb route for `applyDeescalation` (both browser-side, deferred).
3. **Two-meter authority** (Part 4). Add HEAT meter; wire `guardTick` to graded
   disposition + arrest gate (offer arrest at THREATENING, resist = flip to hostile).
4. **Proportionality table + surrender/arrest state machine + betray timer** (Part 3,
   mig 315). Force↔resistance ceiling re-eval per tick (mirrors `_validateDamageCap`);
   morale/surrender check (RoN-verified: non-lethal does morale damage, flash forces
   surrender, excessive-force penalty without a warning).
5. **DOWNED band (new `combat_state`) + capture/carry/load/transport loop** (Part 5).
   Third combat outcome; wires mount/vehicle payload + jail/ransom.
6. **Legitimacy rubric (Graham 3-factor) + encounter scoring + the 2 CI gates** (3E).
7. **Social-spread assistance-gate + depth-cap + zone/child lore-weld** (Part 6).

Phases 1–3 = "the world defends itself with intent + warning"; 4–5 = restraint +
capture economy; 6–7 = bound + weld to canon.

---

## Phase 1 — scope (this slice)

**New:** `server/lib/npc-temperament.js`
- `disposition(db, npc, target, opts)` → `{ mod, floor, hookCapped, level, terms }`.
  Pure read of `getStress` + `npc_grudges` + `character_opinions` + `getRelation`
  (npc targets) + `world_npcs.grief_level/radicalized` + `blocksHostileAction`. Every
  reader table-guarded → a minimal DB (missing tables) degrades to `{mod:0,floor:0}`.
- `effectiveAggroFor(baseAggro, isWanted, disp)` — the combine. Keeps the `isWanted`
  floor (0.9) unchanged; `max(baseAggro, emotionalFloor) × (1 + mod)`, clamped [0,1];
  a hook the target holds neutralises *emotional escalation* (full stand-down is Phase 4).
- `engagementProfile(baseProfile, effectiveAggro)` — a pacifist archetype lifted into
  hostility by emotion has `pursuitRadius=0`/`melee=0`, so grant minimal pursuit/melee
  above threshold so the FSM can physically act (radicalization swaps faction, not profile).
- `dispositionLevel(effectiveAggro)` → friendly|neutral|wary|warning|hostile|lethal
  (observability now; barks in Phase 2).
- `resolveAggro(db, npc, target, baseAggro, isWanted, opts)` — the one call the
  simulator makes: returns `{ effectiveAggro, level, profilePatch, disp }`.

**Wire:** `server/lib/npc-simulator.js` `updateNPCCombatAI` — compute `nearestPlayer`
once, then (only when `CONCORD_TEMPERAMENT` on) replace `effectiveAggro`/`profile`
via `resolveAggro`/`engagementProfile`. Off == the existing two lines, untouched.

**Dials** (added to `docs/BALANCE_DIALS.md`): `CONCORD_TEMP_W_{STRESS,GRUDGE,OPINION,
FACTION,EMOTION}`, `CONCORD_TEMP_GRUDGE_FLOOR_SEVERITY`, `CONCORD_TEMP_GRUDGE_FLOOR`,
`CONCORD_TEMP_RADICALIZED_FLOOR`, `CONCORD_TEMP_ENGAGE_THRESHOLD`.

**Test:** `server/tests/npc-temperament.test.js` — pins every term, the combine
(wanted floor, emotional floor lifts a pacifist, hook cap, clamps), the level
boundaries, `engagementProfile`, and `resolveAggro` end-to-end (radicalized farmer →
hostile+engaged; calm farmer → 0/friendly; admiring opinion de-escalates), plus the
graceful-degrade-on-missing-tables invariant.

---

## Verification
- **Headless:** `node --test server/tests/npc-temperament.test.js`.
- **Regression:** `cd server && npm test` — off-by-default means the suite is unchanged.
- **Live-probe (Phase 1):** boot with `CONCORD_TEMPERAMENT=1`; a farmer whose kin was
  killed (grief ≥0.7 → radicalized) now alerts+pursues; a farmer with a strong hook
  held over them by the player shows no emotional escalation. Off == farmers never swing.
