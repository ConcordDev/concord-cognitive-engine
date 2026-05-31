# Temperament, Restraint & Capture Engine — Plan Spec

**Status:** Plan spec for the working instance to execute. Not yet built.
**Kill-switch:** `CONCORD_TEMPERAMENT` (off == today's archetype-only behavior).
**Author context:** Synthesized from two code audits (NPC-hostility state +
the use-of-force/temperament substrate) and two web-research passes (NPC
temperament/aggression across WoW/Skyrim/RDR2/F.E.A.R./Nemesis; real-world NIJ
use-of-force doctrine + Graham v. Connor + Ready or Not). 2026-05-31.

> Design principle: **No fair if the world can't defend itself.** A world that
> can only KILL has one verb of consequence. This spec gives the world hands —
> and the wisdom to know when *not* to use them: warn, subdue, arrest, ransom,
> and judge. The result is a world that defends itself with more nuance, memory,
> mercy, and proportionality than any shipped open-world game.

---

## THE ONE-LINE PROBLEM (audit-verified)

Concordia has the deepest NPC nervous system of any game benchmarked — stress +
coping traits, grudges, opinions, faction war/truce, grief→radicalization, CK3
hooks, crime/trespass, nemesis traits — and **NONE of it can make an NPC raise a
hand.** Hostility is **100% archetype-proximity** (`npc-simulator.js`
`AGGRO_PROFILE`), **0% emotional/social state.** The nervous system and the
trigger finger are orthogonal. **Every input is BUILT; none is wired to
violence.** This spec connects them, adds the graded escalation ladder, the
use-of-force restraint system, and the kill-vs-capture consequence.

Build shape (research + audit agree): ONE new lib `server/lib/npc-temperament.js`
+ a `temperament-cycle` heartbeat, **MODULATING (not replacing)** `npc-simulator`.

---

## PART 1 — THE DISPOSITION GATE (why + how-hot)

The Skyrim 4-orthogonal-knob model, fed by inputs you already track.

### Per-NPC static profile (mostly already in your data)
```
aggression  ∈ {unaggressive, aggressive, very_aggressive, frenzied}  // ← AGGRO_PROFILE.aggro maps here
confidence  ∈ {cowardly, cautious, average, brave, foolhardy}        // fight-vs-flee
assistance  ∈ {helps_nobody, helps_allies, helps_friends_allies}     // group spread
traits      : { hates:[...], fears:[...] }                           // ← npc_nemesis
```

### `disposition(npc, target)` — reads the EXISTING (dormant) state, returns a level
```
base = factionReaction[npc.faction][target.faction]   // ally|friend|neutral|enemy
       ← READ faction_relations (mig 117). MATRIX GATES whether the rest counts:
         ally/friend → only frenzied attacks; neutral → very_aggressive+; enemy → aggressive+

disposition = base
  + reputationTerm(criminal_rep, is_wanted, player metrics)   // ← READ criminal_rep / world-crime (two-meter, Part 4)
  + trespassTerm(in npc's land_claim & !permitted)            // ← READ land_claim trespass events
  + authorityTerm(npc.isGuard ? suspicion + target.bounty : 0)
  + stressTerm(getStress(npc))                                // ← READ npc_stress (coping trait = wildcard)
  + grudgeTerm(grudge severity vs target)                     // ← READ npc-asymmetry grudges
  + opinionTerm(character_opinions npc→target, ≤-50 = "hates")// ← READ npc-opinions
  + emotionTerm(grief/fear/anger accumulators)                // ← READ npc-family grief, radicalized flag
  × traitBias(nemesis hates/fears amplify specific triggers)  // ← READ npc_nemesis

→ DISPOSITION LEVEL: friendly | neutral | wary | warning | hostile | lethal
→ FEEDS npc-simulator: effectiveAggro = clamp(profile.aggro × (1 + dispositionMod), 0, 1)
  (modulate, don't replace — the archetype stays the floor)
```

### Key rules (research's load-bearing principles)
- **Matrix gates provocation:** an `ally` reaction needs frenzied to attack AT ALL.
  Faction reaction decides WHETHER triggers count; aggression decides HOW EASILY.
- **Personality amplifies:** an NPC that `hates` a trait over-weights that trigger
  (nemesis). Same situation, different NPC, different outcome = "feels alive."
- The grieving farmer finally comes at you. The radicalized kin attacks. The
  paranoid NPC over-escalates. All emergent from reading state that already exists.

### CK3 hooks integration (already blocks schemes — extend to combat)
A strong hook the TARGET holds over the NPC → caps disposition (can't go hostile;
leveraged). A hook the NPC holds over the target → emboldens. Reuse
`hooks.js#blocksHostileAction`, extend from schemes to attacks.

---

## PART 2 — THE ESCALATION LADDER (graded, never binary — the GTA-cop fix)

Audit confirmed: current FSM is `idle→alerted→pursuing→attacking` (binary, no
warning, no de-escalation). Replace with the graded ladder.

```
NEUTRAL ──disp≥t_wary──▶ WARY (noticed, watching, tracks target)
        ──disp≥t_warn──▶ WARNING  ── emit bark: "back off" / "you're not welcome here"
                                     / bluff-charge (animals) / "stop right there" (guards)
                                     ↑ DE-ESCALATION WINDOW (Part 3)
        ──disp≥t_threat─▶ THREATENING ── weapon drawn, posture, FINAL warning
        ──disp≥attackThr▶ HOSTILE (engage)
HOSTILE ──outmatched & confidence low / fear trigger──▶ FLEEING
ANY ──provocation stops for Δt──▶ DECAY one rung down  (holster/retreat/leave-zone/defuse)
```

- **BARKS externalize state** (the F.E.A.R. lesson — cheapest "intelligence"):
  EVERY rung transition emits a bark. The bark IS the player-facing signal the
  NPC is DECIDING, not tripwiring. Wire to the world-audio synth (synthesized
  voice/grunt) + a floating-text/feed tell (legibility channel). One transition =
  one bark = read intent.
- **BIDIRECTIONAL** (RDR2 antagonize/defuse): escalation goes BOTH ways. Player
  verbs that SUBTRACT disposition: holster weapon, back out of the zone,
  defuse/yield emote, comply with command, pay bounty. The warning rungs are a
  real choice, not a cutscene.

---

## PART 3 — GRADED RESTRAINT / USE-OF-FORCE (the Ready-or-Not layer)

Real NIJ use-of-force doctrine + Graham v. Connor + Ready or Not. The thing GTA's
cop never does: force PROPORTIONAL to resistance, with surrender/arrest/de-escalation
as first-class states. Maps onto Concord's server-authoritative combat
(`_validateDamageCap` / `_validateCombatReach` / `combat:impact`).

### 3A — FORCE LADDER (6 tiers — what the actor DOES)
```
F0 PRESENCE     — seen/armed, deters. No contact.            (NIJ 1; EOF "Show")
F1 COMMAND      — shout/warn "comply or X", builds pressure. (NIJ 2; EOF "Shout")
F2 SOFT CONTROL — grabs/holds/joint-locks/shoves. Low injury.(NIJ 3 soft; EOF "Shove")
F3 HARD CONTROL — strikes/takedowns. Moderate injury.        (NIJ 3 hard)
F4 LESS-LETHAL  — taser/beanbag/pepperball/spray/flashbang →
                  INCAPACITATED (down, not dead, arrestable). (NIJ 4)
F5 LETHAL       — aimed lethal. Kills. Last resort.          (NIJ 5; EOF "Shoot")
```

### 3B — RESISTANCE LADDER (5 tiers — what the TARGET is doing)
```
R0 COMPLIANT          — obeys, no resistance.
R1 PASSIVE RESISTANCE — won't comply, won't fight (limp, won't move).
R2 ACTIVE RESISTANCE  — pulls away / flees / tenses, no harm intent.
R3 ACTIVE AGGRESSION  — attacking, non-lethal means.
R4 DEADLY AGGRESSION  — lethal threat (weapon / lethal force).
```

### 3C — PROPORTIONALITY TABLE (authorization matrix — re-eval EVERY tick)
"One notch above resistance," threat-jump allowed. The heart of restraint.
```
R0 Compliant   → authorized F0–F1 (then arrest). F2+ = EXCESSIVE (heavy penalty)
R1 Passive     → authorized F2.   F3+ generally excessive (moderate)
R2 Active      → authorized F2–F3 (+F4 to stop flight). F5 excessive (moderate)
R3 Aggression  → authorized F3–F4. F5 only if escalating to R4 (light)
R4 Deadly      → authorized F4–F5 (threat-jump to F5 OK). Lethal fully justified (none)
```
- **BIDIRECTIONAL** (the de-escalation duty courts/doctrine require, games omit):
  `authorizedCeiling = ladderFor(currentResistance)`, RECOMPUTED each combat tick
  (exactly like the per-tick `_validateDamageCap`). Resistance DROPS → ceiling
  drops; force above it (striking a now-compliant target) flips the action to
  EXCESSIVE.
- **THREAT-JUMP:** R4 or sudden hostile act authorizes immediate F5. "If someone is
  firing at you, you may immediately shoot" — you don't climb every rung.
- **WARNING_SHOTS_ALLOWED:** doctrine TOGGLE (police permits; strict military ROE
  forbids).

### 3D — COMPLIANCE / SURRENDER / ARREST (first-class STATES, not HP afterthoughts)
```
 FIGHTING ─(command pressure/fear)─▶ WAVERING ─▶ SURRENDERING ─(zip-tie)─▶ ARRESTED ✓ safe
    │                                    │ ▲
    │                          betray if NOT secured in BETRAY_WINDOW_S
    │                                    │ │
    ├─(less-lethal F4)─▶ INCAPACITATED ──┘ (zip-tie) ─▶ ARRESTED ✓
    └─(lethal F5)─▶ DEAD  (terminal — scored as PARTIAL FAILURE)
```

**MORALE/SURRENDER check** (RoN model — run on each threat event):
```
surrenderScore = base_fear
  + W_outnumbered  * (allies_visible / enemies_visible)
  + W_weapon_aimed * (gun pointed at target)
  + W_flashed      * disorientation_level        // flashbang/stinger
  + W_leader_down  * (their leader subdued)
  + W_allies_down  * (downed allies witnessed)    // ⚠ flips sign past threshold (hardening)
  + W_surprised    * (attacked from behind/unaware)
  - W_morale       * confidence
if surrenderScore > SURRENDER_THRESHOLD → SURRENDERING
```
Two signature nonlinearities (keep both — they make it tense):
- "Outnumbered + surprised from behind → **ALWAYS surrenders**" (hard override).
- **HARDENING:** witnessing MASS ally death with killer in view RAISES aggression
  (survivors dig in) — flip `W_allies_down` past `ALLY_DEATH_HARDEN_THRESHOLD`.
  Prevents the "kill one to break all" exploit; creates emergent last-stands.

**PROVISIONAL SURRENDER — the betray timer** (RoN "drops gun, picks it back up"): a
SURRENDERING target NOT secured within `BETRAY_WINDOW_S`, given an opening/weapon
proximity, can transition BACK to FIGHTING. This makes restraint a RISK, not a free
win. Securing = the arrest action → locks to ARRESTED.

**ARREST ACTION:** requires proximity + target ∈ {SURRENDERING, INCAPACITATED} +
(ideally) rear/covered approach. On success → ARRESTED (permanently safe;
escortable/loadable/transportable — ties into Part 5's carry→mount/vehicle→jail
loop). Mirror RoN: "order them to walk to extraction → auto-restrained → marked safe."

### 3E — CONSEQUENCE MODEL (makes restraint the OPTIMAL play, not just an option)
(a) Per-action legitimacy — **Graham v. Connor's 3 factors** as a live rubric:
```
actionLegitimacy = f(
  crimeSeverity,            // Graham 1 — how dangerous is this target/objective
  immediateThreat,         // Graham 2 — target's current R-level
  activeResistanceOrFlight // Graham 3 — resisting/fleeing right now?
)
if forceTier > authorizedCeiling(resistance):              flag EXCESSIVE_FORCE
if target ∈ {COMPLIANT,SURRENDERING,INCAPACITATED,unaware}
   and forceTier ≥ F3:                                     flag UNAUTHORIZED_FORCE (severe)
```
Judged "objective reasonableness" — perspective of the moment, totality of
circumstances. Applies to NPC enforcers AND the player.

(b) Encounter scoring (RoN's grading, generalized):
```
+max   arrest (target taken alive)
+      report downed/arrested + evidence to "TOC" (objective check-in BANKS the points)
+      non-lethal incap → arrest
+bonus de-escalated surrender (no force fired)
~/+    justified lethal (target was R4)
–heavy unjustified lethal (R0–R2, or AFTER surrender)
–heavy excessive force on compliant/surrendered
–heavy collateral harm to non-combatants (child-refusal-field makes minors immune)
```
RANK GATE (the "S-rank"): top grade requires ZERO unjustified lethal + all targets
arrested-or-justified + all check-ins reported. Lethality is PERMITTED but scored as
partial failure — that asymmetry is the whole design lever.

### 3F — NPC-SIDE SYMMETRY (every game skips this — makes the world consistent)
- Guards default F0–F1 (presence + "Stop! Drop it!"), climb ONLY as the PLAYER's
  resistance rises. A complying player → ARRESTED (jail/fine/escort — recoverable),
  NOT instakilled. NPC law = a GRADED threat, not a binary kill-switch.
- **"SUBDUE AND REMOVE" is the default faction doctrine** (bouncer/animal-control:
  win condition is "the subject can no longer harm anyone," NOT "the subject is
  dead"). Lethal INTENT is a TRAIT of specific hostile archetypes, not universal.
- NPC-vs-NPC runs the SAME morale/surrender model → emergent fights produce
  PRISONERS, ROUTS, and SURRENDERS, not just corpses. (Feeds Part 5's ransom economy.)

### 3G — TUNABLE DIALS (ship untuned, playtest later — BALANCE_DIALS convention)
```
SURRENDER_THRESHOLD               BETRAY_WINDOW_S
W_outnumbered W_weapon_aimed W_flashed W_leader_down W_allies_down W_surprised W_morale
ALLY_DEATH_HARDEN_THRESHOLD        EXCESSIVE_FORCE_PENALTY
UNJUSTIFIED_LETHAL_PENALTY         WARNING_SHOTS_ALLOWED  (doctrine toggle)
ARREST_RANGE_M                     ARREST_REQUIRES_REAR_APPROACH
```

---

## PART 4 — AUTHORITY / CRIME (two-meter machine — wire the dormant substrate)

Audit: `world-crime`, `criminal_rep`, `is_wanted`, bounty, witnesses all BUILT;
guards don't read them. Wire the ESO/RDR2 two-meter model:
```
HEAT   (fast):  fills on perception of your crime, decays on no-contact.
                drives the guard's immediate suspicion FSM (idle→suspicious→search→alert).
BOUNTY (slow):  persistent wanted scalar, named thresholds:
                clean → wanted → notorious(seek arrest) → fugitive(kill on sight).
WITNESS CHAIN:  a witness who sees a crime → runs to report → raises bounty.
                silence/intimidate the witness before they report → aborts the chain.
                (child witnesses covered by the child-refusal-field — can't be harmed.)
ARREST GATE:    guard at THREATENING offers arrest dialogue (pay / jail / yield / resist).
                RESISTING is the hard flip to HOSTILE. Comply → JAIL (not death).
RESPONDER TIER: repeat/severe crime escalates WHO responds (local guard → elite → faction army).
```

---

## PART 5 — KILL vs CAPTURE vs SUBDUE (the win-state branch — the ransom economy)

The disposition FSM's HOSTILE→[win] terminus. The decision the faction/guard/
grudge-holder makes. THIS is "the world wants you alive."

### The value calculation (emergent, not scripted)
```
On winning an engagement against a DOWNED target:
  value_alive = ransom_value + leverage(hooks/secrets) + interrogation + recruitment
  value_dead  = threat_removed + grudge_satisfaction + loot
  decision by WHO won:
    authority    → PROPORTIONAL to crime (subdue minor, lethal only for deadly) [Part 3]
    faction-war  → CAPTURE high-value targets (a dead lord is worth nothing; a captured
                   one is ransom/hostage/leverage) — wire `ransom` as a faction-strategy
                   GOAL; capture-alive becomes the OPTIMAL move against high-value
                   targets, emergently.
    grudge/personal → usually KILL (it's emotional, not economic)
  → SUBDUE (downed/unconscious state) or KILL
```

### The DOWNED/unconscious STATE (the one genuinely-new combat primitive)
```
Combat outcome gets a THIRD band:
  hp ≤ 0 & lethal_intent                    → DEAD
  hp ≤ subdue_threshold & non-lethal_intent → DOWNED/UNCONSCIOUS (not dead)
DOWNED entity state: can't act, can be interacted with, has a revive timer / can be
finished / can be bound. Reuse pain_signals + status_effects + the combat resolver
(it's a new band on an existing resolver, not a new system).
```

### The capture/transport loop (verbs on top — mostly wire existing systems)
```
SUBDUE  → downed state (new)
INTERACT-WHILE-DOWN → loot / interrogate (yields secret→hook) / bind-hogtie / revive / finish
CARRY   → pick up the body (on back; movement-penalized)
LOAD    → place on a MOUNT or VEHICLE (← the mount/vehicle dead-wires being closed;
          this gives them a new payload type + a reason to exist beyond travel)
TRANSPORT → haul to destination
DELIVER → JAIL (bounty turn-in) / RANSOM (faction hostage) / RESCUE (ally) / RITUAL
ESCAPE/RESCUE branches: a captured PLAYER isn't a reload — it's a SITUATION (cell,
  ransom demand sent to your faction, escape minigame, rescue, trade, rot). Losing
  becomes content, not a respawn.
```

### Careers integration (the bounty hunter)
Capture-alive pays MORE than kill → bounty hunter is a profession (careers system).
The capture→transport loop IS the bounty-hunter job's active gameplay. Faction
"ransom collector" is a role.

---

## PART 6 — SOCIAL SPREAD & LORE WELD

### Group aggression (Skyrim assistance + witness chain — partly built)
```
on (enterCombat | death | crimeWitnessed):
  broadcast combat-event(attacker, victim, faction) within socialRadius
  each recipient: shouldJoin = assistance covers relation(victim)
                            && reaction(self, attacker) ≠ ally
                            && passes confidence gate
  joiners re-broadcast as kin-grief (BOUNDED by depth/radius cap — no whole-map cascade)
  guards → route to alarm, summon reinforcements, escalate responder tier
```
Reuse: `_callForHelp` (built) + `cascadeFamilyAndAlly` (built). Add the assistance
gate + depth cap.

### The lore weld (it's thematically CORE, not bolted on)
Concordia is built on REFUSAL and CONSENT. Kill-vs-spare-vs-capture is the cosmology
made mechanical (see `docs/LORE_BIBLE.md`):
- The Sovereign refuses death → non-lethal/restraint is ALIGNED with the world's
  metaphysics. Sparing has weight; killing has weight.
- `ecosystem_score` / `concord_alignment` / `refusal_debt` TRACK lethality choices.
- The hub is violence-impossible (zone refusal — already built); the temperament
  engine respects zone rules (sanctuary → force capped at F0/no escalation past warning).
- Child-refusal-field: under-18s can't be harmed OR captured (abduction = harm; the
  field's "no harm to/from" covers both). Intent-layer guard, CK3 pattern.

---

## HOW THE PARTS CONNECT
- **Part 1 (disposition)** decides WHETHER and HOW HOT → sets the actor's starting force tier.
- **Part 2 (escalation ladder)** IS the climb up the FORCE ladder; F1 COMMAND = the
  WARNING rung; barks announce each tier (F.E.A.R.); de-escalation verbs walk it back down.
- **Part 3 (restraint)** governs PROPORTIONALITY + the surrender/arrest states.
- **Part 4 (authority)** is the two-meter crime machine driving guard disposition.
- **Part 5 (kill-vs-capture)** is the WIN-STATE branch: SURRENDERING/INCAPACITATED →
  the capture/carry/load-on-mount-or-vehicle/transport/jail-or-ransom loop.
- **Part 6 (spread + lore)** bounds contagion and welds the whole thing to the cosmology.

---

## REUSE vs BUILD

**REUSE (audit-verified BUILT, just disconnected):**
`faction_relations`, `AGGRO_PROFILE`, `npc_stress` + coping traits, `npc-asymmetry`
grudges, `character_opinions`, `npc_nemesis` traits, `npc-family` grief/radicalization,
`world-crime` + `criminal_rep` + `is_wanted` + witnesses, `land-claim` trespass events,
`hooks.js` leverage, `_callForHelp`, `cascadeFamilyAndAlly`, `world_zones`,
bounty/escrow, mounts + vehicles, careers (bounty-hunter), `pain_signals` +
`status_effects` + combat resolver, `_validateDamageCap` (the per-tick ceiling pattern
= the proportionality re-eval), `combat:impact` poise/stagger, the world-audio synth
(barks/commands), `EmergentEventFeed` (legibility).

**BUILD (the genuinely-new, small):**
1. `npc-temperament.js`: the `disposition()` gate (connects all the above to aggro).
2. The graded escalation FSM (replace binary) + bark emission + de-escalation verbs.
3. The force↔resistance proportionality table + per-tick ceiling check.
4. The surrender/arrest state machine + morale check + betray timer.
5. The legitimacy rubric (Graham 3-factor) + encounter scoring + rank gate.
6. Less-lethal weapon → INCAPACITATED band; the DOWNED/unconscious combat band (3rd outcome).
7. The capture/carry/load/transport/deliver verb loop (wires mount/vehicle/jail).
8. The kill-vs-capture value function (reads faction ransom-goal / crime / grudge).
9. The two-meter authority wire (guards READ heat+bounty) + arrest gate.
10. `temperament-cycle` heartbeat + the assistance-gate + depth-cap on spread.
11. NPC-side default "subdue and remove."

**CI GATES (the "no GTA cop" regressions):**
- No NPC instant-attacks without passing the disposition gate (graded escalation).
- No force tier > `authorizedCeiling` without a flagged legitimacy exception.

---

## VERIFICATION
- **Headless:** `disposition()` returns correct level per (faction×stress×grudge×crime);
  FSM transitions on thresholds + decays on no-provocation; force≤resistance
  proportionality holds; surrender check fires on outnumber/flash/leader-down; betray
  timer re-arms unsecured surrender; capture-vs-kill picks by motive; downed-state band
  fires at threshold not 0-hp; legitimacy flags excessive/unjustified force.
- **Live-probe:** a grieving farmer escalates to attack; a war-faction guard CAPTURES a
  high-value player for ransom; a guard SUBDUES a pickpocket but kills a murderer; an NPC
  WARNS before attacking; surrender→arrest→jail works; a routed enemy surrenders; carry a
  body onto a mount; excess force on a compliant target tanks your score.
- **Cold-watcher (the feel):** does the warning rung READ as a decision? Does getting
  captured feel like a SITUATION, not a fail? Does proportionality feel fair? Does
  surrender-then-betray feel tense, not cheap?

---

## BUILD ORDER (fold into the master plan)
1. `npc-temperament.js` + `disposition()` (Part 1) — the keystone wire. Kill-switch off.
2. Graded escalation FSM + barks + de-escalation (Part 2).
3. Two-meter authority wire + arrest gate (Part 4) — guards finally read crime.
4. Proportionality table + surrender/arrest state machine + betray timer (Part 3).
5. DOWNED/unconscious band + capture/transport loop (Part 5) — wires mount/vehicle/jail.
6. Legitimacy rubric + scoring + the CI gates (Part 3E).
7. Social-spread assistance-gate + depth-cap (Part 6) + lore-weld zone/child respects.

Phases 1–3 light up "the world defends itself with intent + warning"; 4–5 add the
restraint + capture economy; 6 bounds it and welds it to canon. Each ships behind the
kill-switch with its own tests, same cadence as the rest of the project.

---

## THE PAYOFF (one line)
Every input for a world-class temperament-and-restraint engine is already built —
Concordia has a richer NPC nervous system than Skyrim, RDR2, F.E.A.R., or the Nemesis
system, and a server-authoritative per-tick damage validator that IS the use-of-force
proportionality check, in a world whose god literally refuses death. Connect it with
ONE disposition gate + a graded ladder + a force↔resistance restraint system + a
kill-vs-capture branch, and the world defends itself with more nuance, memory, mercy,
and proportionality than any open-world game shipped: the grieving kin finally swings,
the war-faction captures you alive for ransom, the guard tackles the thief but executes
the killer, every NPC warns before it attacks, overkill costs you, and getting captured
is a situation — not a respawn. The nervous system finally reaches the hands, and the
hands have the wisdom to know when not to use them.
