# Concordia: make the world lens play up to (then beyond) its claims

## Context

The user's standing question — "what's still honestly thin?" — was pressure-tested against the
*running code*, not the docs. The headline finding: **the world lens is the strongest surface in the
platform, but its two marquee MMO claims (EVE-style faction autonomy, CK3-style NPC scheming) are the
*least* true in actual play** — both are fully built in the DB + sockets + frontend, yet dark because of
a single missing wire each. Combat's signature impact model is dead code. Several real systems run
invisibly. And a handful of CLAUDE.md / audit claims contradict the code they describe.

This plan makes Concordia actually *play* up to its claims end-to-end (T0–T2), then adds the authored
depth to exceed the floor (T3). Everything real, UI↔backend connected, no stubs, no fake/demo data, no
deferrals. Pre-existing bugs found along the way are in scope.

---

## Implementation status (live)

Branch `claude/lens-population-depth-DVcsF` — 7 commits, **161/161 tests green across touched areas, pushed.**

### ✅ DONE (tested + committed + pushed)
- **T1.3 ⭐ scheme cold-start** — `deriveSchemeSubstrateFromNarrative` in `npc-asymmetry.js` translates
  authored `narrative_context` (secret/weaponise_at/fear/current_goal → stress; archetype/weaponise_at →
  paranoid|cruel coping) + `relationships` (hostile types → ≤-50 opinion edges) into the scheme-gate inputs.
  Schemes now fire along authored rivalries with **zero gameplay**. `scheme-cold-start.test.js` 4/4.
- **T1.1 faction seed** — `seedFactionStrategyState` in `embodied/faction-strategy.js`, called by
  content-seeder after the kingdom pass; seeds a strategy row + relations from `rival_factions`/
  `allied_factions` (rival tension mild −0.2 so the DECLARE_WAR collision branch can fire). EVE wars now
  surface via the real emit path. `faction-strategy-seed.test.js` 4/4.
- **T1.2 asymmetry dialogue** — live `/dialogue` endpoint composes asymmetry + four-axis metrics and spreads
  `asymmetryLines` into `promptLines`; `oracleDialogueTreeComposer` renders grudge/preoccupation/desire.
  Secret-omission invariant guarded. `asymmetry-dialogue-injection.test.js` 5/5.
- **T1.4a momentum stagger** — new `lib/combat-impact.js` (computeImpactMomentum, impactKinematics from
  frame-data swing time + tier, poiseBudget, resolvePoiseStagger — deterministic, no RNG);
  `triggerStaggerFromImpact` in combat-polish.js; worlds.js NPC-hit path stags by momentum-vs-poise.
  `combat-impact-stagger.test.js` 11/11 (incl. no-`Math.random`).
- **T1.5 creature feed** — loader reads `creatures.json` **and** normalized `bestiary.json`; authored real
  baselines for the 4 empty worlds (concordia-hub / concord-link-frontier / lattice-crucible /
  sovereign-ruins). `creature-baseline-feed.test.js` 4/4 — every world grounds ≥1.
- **T1.6 evo offline floor** — committed `content/evo-seed/` CC0 primitive meshes + `bootstrapLocalSeed`
  (runs first/unconditional); empty-registry startup warn. `evo-asset-offline-floor.test.js` 4/4.
- **BUG A** — `getSkillTreeForActor` reads real `player_skill_levels`; legacy `skill_revisions` query guarded
  by a column check (was querying non-existent columns → threw in prod). `skill-tree-real-schema.test.js` 3/3.

### ⏳ REMAINING
- **T1.4b** client impact feel + reflex from the shared momentum (impact-resolver.ts, ImpactMomentumBridge,
  ReflexBridge wiring) — frontend, build/type-check verify only.
- **T3.1 / T3.1b** per-skill descriptors + mastery (on the BUG A fix) + fighting-styles-shown + PD-motor
  fluidity + new `combat.skill_mastery` route — frontend + thin backend.
- **T2.1** consume `weaponise_at` · **T2.2** inheritance UI · **T2.3** scheme barge-in route · **T2.4**
  emergent-module reconciliation audit script (backend-testable).
- **T3.2** content authoring into engine-read fields — **partially supplied by the user (see below)**.
- **T3.3** zone architecture (skybox/silhouette) · **T3.4** mahjong re-weight + restaurant tip adoption
  (backend-testable) · **T0** doc corrections (land with the code that makes each claim true).

### 📥 Authored content delivered by the user (to wire under T3.2)
Two finished artifacts, ready to slot into the seed pipeline:
1. **Hub history** (8 events: The Ground She Made Hers, The Ring of Doors, The Night Someone Tried, Embassy
   Era, Concordant Web, The Voss Question, The Lamplighter, The Ninth Refusal). Shape matches the lore-event
   contract (`id/title/type/era/description/significance/factions_involved`) → write to
   `content/world/concordia-hub/lore.json` (or merge into the existing hub lore) so `seedLore` ingests it.
   Several events name the engine-relevant factions (`anti_sovereign_movement`, `luminary_industries`,
   `crimson_court`, `grid_authority`, `delgado_syndicate`, `verdant_veil`, `the_three_pillars`,
   `scholars`) and NPCs (Elias Voss, Vesper Kane, Seraphine Voss, Jax Rivera, Mama Iron Rose, Thorne
   Blackroot, Zero Nakamura, Nyx Torres, Lyra Silentchant) — these are the rivalry/relationship hooks T1.1 +
   T1.3 consume, so authoring matching `factions.json` `rival_factions`/`allied_factions` + NPC
   `relationships`/`narrative_context` makes them light up the EVE + scheme engines on boot.
2. **The Eight Refusals codex** — a cross-world worldbuilding document mapping each of the 9 sub-worlds to a
   Refusal (death→sovereign-ruins, harvest→tunya, hostility→fantasy, consequence→crime, numbers→cyber,
   dome→concord-link-frontier, win→superhero, the-eighth→lattice-crucible, the-ninth→the hub itself).
   New content kind — store as a cross-world codex (e.g. `content/codex/eight-refusals.json`) + a seed pass
   that mints it as citable DTU(s) so it surfaces in lore/atlas lenses and grounds oracle dialogue. The
   codex also pins the canonical cross-world threads (the Voss dynasty, Zero↔Nyx, Elias↔Vesper, the Third
   Keeper) that T3.2 NPC `relationships` should mirror so schemes/wars trace the authored lines.

The full content of both artifacts is captured verbatim in **`## Authored content (verbatim)`** at the end
of this plan.

---

### Verified claim-vs-reality map (all confirmed firsthand against source)

| System | Claim | Reality | Root cause |
|---|---|---|---|
| Faction autonomy (EVE) | "factions war while you sleep, you see it anywhere" | **DARK** — 0 wars ever fire on fresh boot | `ensureFactionState` never called by seeder; `faction_strategy_state` empty → cycle does 0 work |
| NPC feelings in dialogue (CK3) | grudges/preoccupations/desires drive dialogue | **WIRED-NOT-USED** — computed + inspectable, dropped before the LLM prompt | live `/dialogue` endpoint never reads asymmetry into `promptLines`; oracle template omits the fields |
| NPC schemes fire from authored content (CK3) | NPCs plot under their dialogue based on who they are | **DARK from content** — ~0 schemes fire from authored interiority | `seedNPCAsymmetry` ignores `narrative_context` + `relationships`; sets stress 30 / no coping / neutral opinions, so `proposeScheme` gate (coping∈{paranoid,cruel} OR (stress≥60 AND opinion≤−50)) never trips |
| Impact model (BDO) | "procedural biomechanics → bone-mass × angular-velocity impact resolution" | **CLAIM DESCRIBES A SYSTEM THAT ISN'T IN THE COMBAT PATH** — resolution is a frame-data engine (per-weapon startup/active/recovery, parry/dodge windows, stamina, grapple, stance, server-authoritative) and **stagger is a probability roll `stagger_chance: 0.18–0.35`**, not a computed momentum transfer. No mass/angular/velocity/momentum/impulse/knockback terms in either server or frontend resolution. `computeImpactMomentum` exists in `combat-motor-driver.ts` but is dead; `reflex-layer.ts` exists (200 LOC) but its wince is fed by `finalDamage/100`; `physics.js` is the physics *lens* sim tool, not the melee resolver |
| Secret weaponisation | `weaponise_at` triggers betrayals | **DEAD STORAGE** — written, never read | no consumer |
| NPC inheritance | heirs inherit traits | **INVISIBLE** — inheritance runs, nothing surfaces it | no UI/notification |
| Per-skill combat | 67 skills with distinct feel/mastery | **TIER-GENERIC** — VFX is tier(5)+element(7), 0 per-skill | no per-skill descriptor layer |
| Quest density | ~140 authored quests | ~54 authored + procedural; uneven across 9 worlds | thin worlds under-authored |
| Zone identity | 9 genre-distinct worlds | color/atmosphere real; **no skybox/architecture/GLB silhouette** | renderer themes palette only |
| Creature grounding | authored creature baselines per world | **SILENT FLAGSHIP GAP** — loader reads only `creatures.json` (`procedural-creature.js:105`); only 4/9 worlds have it; **tunya's data is in `bestiary.json`** so the flagship world spawns ungrounded generic creatures despite authored content sitting right there; 5 worlds silently empty | filename mismatch + missing files, swallowed by a silent catch |
| Evo asset engine | self-evolving CC0 asset substrate that runs continuously | **STARVES SILENTLY OFFLINE** — pipeline is real + wired (bootstrap at start, tick ~5min), but all feed is external CC0 fetch (PolyHaven/AmbientCG/OS3A), "graceful-on-failure returns empty" (`source-loaders.js:9-10`). On a box without egress to those hosts, `evo_assets` seeds empty → engine produces zero, no error/test/log | network-gated feed with no committed offline floor |

**Genuinely solid (the floor to build on):** 6 run-modes are real playable loops; NPC daily schedules
(~95% Animal-Crossing, visible activity tags); scheme-resolution overhear toasts; tombs/last-words;
eavesdrop bubbles; festivals + seasons fire and surface; combat biomechanics + lock-on + 7-action menu +
4m station router all mounted in `app/lenses/world/page.tsx`. Confirmed by a second walk: **84 heartbeats
are actually registered and ticking** in server.js (incl. the full Concordia-relevant set — routine/travel/
ambition, npc-vs-npc combat, kingdom-decree, war-skirmish, world-boss, festival, season, aging, migration,
faction-strategy, npc-scheme); the **royalty cascade is a real implementation** (rate = initial / 2^gen,
depth-capped 50, cycle detection, license/citation gating, cross-world lineage, parity tests) — not a stub;
the **renderer is substantial** (`ConcordiaScene.tsx` ~1,669 lines of r3f/Rapier across 126 lens components);
and the **content layer is genuinely decoupled** — drop a `factions.json`/`npcs.json` in and the seeder +
heartbeats consume it with no code edit. That decoupling is what makes "more content → richer engines"
mechanically true (modulo the T1.1 + T1.3 wires). The binding constraint has shifted from *building*
systems to *feeding* them and *proving the marquee emergent moments fire for a cold-booted stranger*.

**The verified moat (lead the pitch here):** every productive verb mints the *same* primitive — `executeCraft`
validates resources + skills, deducts inventory, and creates an **output DTU**; cooking and the 1,836-line
music DAW domain do the same. A cooked dish, a forged blade, and a composed song are all DTUs — fungible,
tradeable, citable, flowing through the identical 50-generation royalty cascade. In a normal game crafting is
a closed loot loop; here the crafting output is the same economic object as a published essay. That
cross-activity fungibility is real in the code and is the integration nobody else has. Breadth gives ~20+
verbs each ~150 LOC deep — thin against any specialist title judged per-verb — so the win condition is the
*loop* (cook → cited in a recipe → remixed into a tavern scene → royalties cascade back 50 generations), not
the verbs in isolation.

**Quality bar:** the user's standard is *done, complete, beyond-AAA* — not "shippable stub." For combat
specifically that means the momentum/realism the pitch claims must become *real and shown*, not downgraded
away (see the rebuilt combat section). A doc-only "describe it honestly as frame-data combat" is the interim
truth; the deliverable is to *build* the momentum resolution so the claim becomes true.

---

## T0 — Doc / claim corrections (fix what contradicts the code)

These are wrong *in the repo's own docs*, contradicting the code or generated audits. Correct them so the
record matches reality.

- **`CLAUDE.md` mahjong line** — says "No outlier yaku detected … No re-weighting recommended." The
  generated `audit/balance/mahjong-yaku.json` says the opposite (iipeiko 2.06×, pinfu 0.28×, ittsuu 0.04×
  mean → "consider re-weighting"). Fix the line to match the audit; this T0 item pairs with the T3 mahjong
  re-weight below (we will actually re-weight, then the line becomes true).
- **`CLAUDE.md` restaurant tips** — "got sim-evidenced new defaults" is false; `server/lib/restaurant.js:17-19`
  still ships 0.30/0.10 while `audit/balance/restaurant-tips.json` recommends 0.20/0.15. We *adopt* the
  recommended values (real change, sim-backed) and then the claim is true.
- **`CLAUDE.md` combat impact** — the invariant prose states impact resolution *is* bone-mass × angular-velocity
  "at contact frame." Today the resolution is frame-data + a `stagger_chance` dice roll with **zero momentum
  terms** — the claim describes a system that isn't in the combat path. The deliverable (T1.4a/b) *builds*
  the momentum resolution to the beyond-AAA bar so the claim becomes true; the doc should additionally
  describe the real frame-data timing layer it composes with (frame-perfect windows govern *whether* contact
  lands; momentum governs *what it does*). Interim-honest phrasing only if code somehow doesn't land; the
  plan's intent is to make the claim true, not downgrade it.
- **"Concord Rising" festival** — referenced in narrative but absent from `content/festivals/`. Either
  author the festival JSON (preferred, see T3 calendar) or remove the name. We author it.
- **Quest count** — replace any "~140 authored quests" language with the honest split (authored vs
  procedural) once T3 quest authoring lands; update to the real post-T3 number.

Files: `CLAUDE.md` (several lines), and the code/content changes that *make* the corrected claims true live
in T1/T3.

---

## T1 — Light up the dark wires (small diffs, makes the headline claims true in play)

### T1.1 — Seed faction strategy state (turns the EVE layer on)

**Root cause:** `seedFactions()` in `server/lib/content-seeder.js:144` only does `_authoredFactions.set(id, obj)`
(in-memory). The cycle `server/emergent/faction-strategy-cycle.js` reads **all** `faction_strategy_state`
rows globally where `next_move_at <= now` — finds none → `{ ok:true, advanced:0 }` forever.

**Fix (reuse existing pattern):** the seeder already calls `seedKingdomsFromFactions(db, factions)` at
`content-seeder.js:621` inside the post-seed DB pass. Add a sibling `seedFactionStrategyState(db, factions)`
that, for each authored faction, calls `ensureFactionState(db, faction.id, opts)`
(`server/lib/embodied/faction-strategy.js:50`, idempotent, INSERTs stance/momentum/next_move_at=now).

To make the autonomy *feel* like EVE rather than a cold start, derive real initial conditions from the
authored faction data instead of all-neutral defaults:
- **Initial stance** from authored faction posture (e.g. militant/expansionist lore → `expand`; isolationist
  → `isolation`; default `consolidate`). Read whatever stance/disposition fields `factions.json` carries;
  fall back to `consolidate`.
- **Initial relations** via `setRelation(db, a, b, {score, kind})` (`faction-strategy.js`) seeded from any
  authored rivalries/alliances in `factions.json` (e.g. `rivals: [...]`, `allies: [...]`). Seed tension
  (−0.4 `tension`) for rivals, +0.4 `truce`/`alliance` for allies. Inspect the JSON shape first; if no such
  fields exist, seed a small deterministic rivalry web from same-world faction pairs so wars can emerge,
  AND add the authored fields to a couple of flagship rivalries (e.g. the Sandrun/Medici example) so the
  named conflicts in lore actually ignite.

Verify the cycle's emit→feed path is intact end-to-end (audit says it is): `applyMove` DECLARE_WAR →
`faction:war-declared` socket → `EmergentEventFeed.tsx:50-52` → mounted at `world/page.tsx:4691`.

### T1.2 — Inject NPC asymmetry into the dialogue the player actually sees (CK3 layer)

**Two prongs — the data is computed but dropped at *both* prompt boundaries:**

**Prong A — live endpoint (the one the world-lens NPC click hits):**
`server/routes/worlds.js:962` `/dialogue`. It already calls `seedNPCAsymmetry` (~line 977) and builds a
`promptLines` array (~line 1046+) but never reads asymmetry back. After the seed + routine block, call
`composeAsymmetryContext(db, npcId, playerId, playerMetrics)` (`server/lib/npc-asymmetry.js`) and append
its three fields to `promptLines`:
- `persistent_grudge` → "You hold a grudge: {…}. Let it color your tone without stating it outright."
- `current_preoccupation` → "You are preoccupied with: {…}."
- `desire_for_this_player` → "You want something from this player: {…}. Surface it if the moment fits."
Pull `playerMetrics` from the four-axis metrics already available in this route (reputation/opinion are
fetched here; wire the metrics the same way `findOfferedDesire` expects).

**Prong B — oracle template (quest dialogue + structured trees):**
`server/lib/prompt-registry.js:566` `oracleDialogueTreeComposer` only reads `name/personality/role`.
`narrative-bridge.js:177-194` already populates `npcTraits.persistent_grudge / current_preoccupation /
desire_for_this_player`. Add three lines to the template that render those fields when present.

**Invariant guard:** asymmetry fields are grudges/preoccupations/desires — NOT `narrative_context.secret`.
They are safe to inject. Do **not** add secrets to any prompt (narrative-bridge.js:184/:220 canary scan
stays authoritative). Add a contract test asserting asymmetry reaches the prompt AND secrets never do.

### T1.3 — Translate authored NPC interiority into the numbers the scheme engine reads (CK3 schemes) ⭐ HIGHEST-LEVERAGE

**This is the single best move in the plan.** It converts the hardest-pitched moment — a stranger
overhearing a scheme resolve nearby in their first 30 minutes — from true-in-principle to observable on a
fresh boot, and it makes every NPC authored afterward (T3.2) pay into the engine immediately instead of
sitting as flavor.

**Root cause (confirmed firsthand + second walk):** `proposeScheme` (`server/lib/npc-schemes.js:53-58`)
fires only when `coping_trait ∈ {paranoid, cruel}` **OR** (`stress ≥ 60` **AND** `opinion ≤ −50`).
`getStress` defaults to **30**. Critically, those stress/opinion rows **accrue from gameplay** (combat,
scheme exposure) — **not** from authored content. So in exactly the scenario Concordia is built for — small
player base, NPCs meant to *generate* the activity — the scheme engine **boots cold** and warms slowly only
through npc-vs-npc combat. The boot seeder `seedNPCAsymmetry` (`server/lib/npc-asymmetry.js:127`) sets every
NPC to default stress, no coping trait, a generic sha1-picked archetype grudge, and `"default"`
preoccupation — and it **never reads `npc.narrative_context` or `npc.relationships`**. Result: all authored
interiority (Zero unsure which clone is original; Thorne's curse from a beloved apprentice) is invisible to
the gate; even 200 authored NPCs propose ~0 plots at cold start. The CK3 marquee moment is the *least* likely
thing a fresh stranger sees.

**Fix (~40 LOC, in/beside `seedNPCAsymmetry`):** a translation pass that derives the gate inputs from
authored fields the schema already carries:
- **stress** — from the weight/intensity of `narrative_context.fear` / `.secret` / `.current_goal`
  (existential fear or a dark secret → seed stress in the 55–75 band; mild → keep ~30). Use the existing
  `bumpStress` (`npc-stress.js`, already imported as `_bumpStress`) so it flows through the real substrate.
- **coping_trait** — map personality + fear archetype to `paranoid`/`cruel`/etc. (identity-doubt/secret-
  bearer → `paranoid`; vengeance/curse → `cruel`). This is the single highest-leverage edge: a coping
  wildcard alone trips the gate.
- **opinion-edges** — for each entry in `npc.relationships` that names a real rival NPC, write a
  `character_opinions` row with `score ≤ −50` toward that target (use `recordOpinionEvent`/the opinions
  substrate, `npc-opinions.js`). This creates the hate-edges *between the actual authored rivals* so schemes
  fire along the lines the author drew (Zero↔clone, Thorne↔apprentice) rather than hash-picked strangers.
- Keep it deterministic + idempotent (same boot → same derived numbers) and respect the secret-omission
  invariant (these numbers are derived from `secret` but the secret text itself never enters a prompt).

Payoff: this is what makes "richer content → richer engine" true for the scheme cycle. Combined with T1.1,
all three content-consuming engines (faction strategy, kingdom, NPC scheme) light up from authored JSON.

**Engine-payoff reconciliation (honest framing for T3.2 content work):** at HEAD, of the three engines that
*scale with authored content*, only the **kingdom** engine actually runs (its seed,
`seedKingdomsFromFactions`, is wired at `content-seeder.js:621`). The **faction strategy** engine's
content-sensitivity (pickMove reading `values`/`fears`/`rival_factions`/`allied_factions` + leader coping
trait) is real but gated dark by the unseeded `faction_strategy_state` (T1.1). The **scheme** engine is
gated dark by the missing narrative_context translation (this T1.3). So authoring more content (T3.2) pays
off in 1 engine today and 3 after T1.1 + T1.3 land — do the two wires first, then author into the fields
the engines read.

### T1.4 — Beyond-AAA combat: real momentum resolution + fighting styles shown + fluidity (replaces the dice-roll stagger)

The bar here is *done/complete/beyond-AAA*, not "wire the dead function." The existing frame-data engine is
genuinely good and stays (per-weapon startup/active/recovery, parry/dodge windows, stamina/"gas", grapple,
stance, server-authoritative netcode — that's how real fighting games work). What's missing vs the pitch and
the bar: (a) **stagger is a probability roll**, not physics; (b) **the momentum model is dead**; (c) **the
fighting style / move a player chooses isn't visibly distinct**; (d) transitions are clip swaps, not
motor-driven, so it doesn't *feel* fluid. Covered in full in the **Combat-depth design section below** —
summary: make a shared, server-authoritative momentum model the spine of resolution (real poise-vs-momentum
stagger replacing `stagger_chance`), drive feel + reflex from it, render each fighting style and player move
as visibly distinct + readable, and replace clip-swaps with PD-motor transitions for fluidity.

### T1.5 — Creature baseline feed fix (un-starve the procedural creature generator)

`server/lib/procedural-creature.js:105` reads only `content/world/<world>/creatures.json` for the authored
baselines it grounds generated creatures against; missing files hit a silent catch → empty array → generic
ungrounded creatures. Reality: only `crime/cyber/fantasy/superhero` have `creatures.json`; **tunya (the
flagship) has its data in `bestiary.json`** and 4 more worlds (concordia-hub, concord-link-frontier,
lattice-crucible, sovereign-ruins) have neither. Fix both halves:
- **Loader:** read `creatures.json` **and** `bestiary.json` (merge), so tunya's existing authored bestiary
  grounds generation immediately. Normalize the two shapes to the baseline contract the generator expects.
- **Content:** author real creature baselines for the worlds that have none (concordia-hub, concord-link
  -frontier, lattice-crucible, sovereign-ruins) — small, but real authored anchors, not placeholders.
- Add a per-world coverage test asserting every world resolves ≥1 creature baseline.

### T1.6 — Evo asset offline seed floor (so the engine is never silently starved)

The evo pipeline (`server/lib/evo-asset/` — `source-loaders.js`, `scheduler.js`, `quality-gate-bridge.js`,
`registry.js`) is real and wired: `bootstrapAllSources` at startup, `runEvolutionTick` every ~5 min selects
interaction-scored candidates → quality-gated evolution → version promotion. But **all feed is external CC0
fetch** (PolyHaven/AmbientCG/OS3A GitHub) and "graceful-on-failure returns empty." On a box without egress
to those hosts at boot, `evo_assets` seeds empty and the engine produces zero with no error/test/log — passes
every test, ships dead.
- **Durable fix:** commit a small **seed asset pack into the repo** (a handful of CC0-licensed
  meshes/textures with proper attribution + a manifest) and a `bootstrapLocalSeed(db)` loader that registers
  them idempotently at startup *before* the network loaders. The registry is then never empty fully offline;
  network bootstrap becomes *enrichment on top of a guaranteed floor*, not the only source.
- **Observability:** log the post-bootstrap `evo_assets` count at startup, and add a startup warn if the
  registry is empty after all loaders. Add a test asserting `bootstrapLocalSeed` populates ≥N rows with the
  network loaders stubbed (proves offline floor).
- **Verify on the live deployment now:** `SELECT COUNT(*) FROM evo_assets;` — if 0, it's been starving
  silently; the seed pack fixes it permanently.

---

## T2 — Surface the invisible (make real simulation legible to the player)

### T2.1 — Consume `weaponise_at` (dead storage → real betrayal)

`server/domains/secrets.js` writes `secrets.weaponised_at/weaponised_against` but nothing reads it. Wire a
real consumer:
- In the NPC scheme cycle / dialogue path, when a holder NPC has a weaponisable secret against a target
  the player is interacting with (or against the player), trigger the existing scheme `blackmail`/`rumour`
  kind via `proposeScheme` (`server/lib/npc-schemes.js`) and/or surface a dialogue line. Set
  `weaponised_at` on use so it fires once.
- Emit the existing `secret:weaponised` socket and surface it through `NPCSchemeOverhearTip` (extend its
  flavor to name the betrayal type). This makes `weaponise_at` load-bearing.

### T2.2 — Surface NPC inheritance (heirs visibly carry the dead forward)

Inheritance runs in `server/lib/npc-legacy.js` (`inheritGrudges/Preoccupations/Desires/Recipes/Wealth`) but
nothing tells the player. Real surfaces:
- **Tomb modal** (`TombsOverlay.tsx`, already polls `npc_legacy.tombs_for_world` + `npc_legacy.get`): the
  `get` macro already returns `heirs_json` + `inherited_preoccupations_json`. Render an "Heirs carry forward"
  block listing each heir + the specific trait inherited ("inherited {grudge} from {deceased}").
- **Trait inspector** (`NPCTraitInspector.tsx`): when an NPC is an heir, add a provenance line on the
  relevant grudge/preoccupation ("inherited from {deceased name}"). Requires `npc_inheritance_links` to be
  queryable per-heir — add a read path (`npc_legacy.inheritance_for_heir`, the lib already has
  `getInheritanceForHeir`).
- **Notification** on heir activation: when `onNpcDeath` creates inheritance links, emit a one-shot
  `npc:heir-rose` socket that surfaces a brief toast (reuse the `NPCSchemeOverhearTip` toast pattern).

### T2.3 — Richer scheme overhear + barge-in (the "stumble into a scheme" claim)

Today `NPCSchemeOverhearTip` shows sparse flavor; eavesdrop has no proximity gate and no interaction.
- **Context:** include plotter/target archetype + faction + scheme kind in the `npc:scheme-resolved` /
  `npc:conversation-bid` payloads so the toast/bubble can say *who* and *why* ("Sandrun smith ↔ Medici
  guard: a debt that ends in a knife"). Keep secrets out.
- **Proximity gate on eavesdrop:** `EavesdropBubble.tsx` currently renders all conversations — gate to
  `window.__concordiaPlayerPos` within a tuned radius (mirror `NPCSchemeOverhearTip`'s 30m).
- **Barge-in (new interaction, real):** clicking an active eavesdrop bubble within range POSTs a new
  `/api/worlds/:worldId/schemes/:id/intervene` route that branches the scheme outcome (expose / abet /
  ignore) via `npc-schemes.js` state machine, shifts relevant opinions/relations, and emits the resolution.
  This turns the dormant "barge-in is a separate sprint" comment into a shipped loop.

### T2.4 — Emergent-module reconciliation (registered-cycle / support-lib / orphan)

**Why:** `server/emergent/` holds **~190 modules** but only **84 heartbeats register and tick** in
server.js. Many of the other ~106 are legitimately support libs (imported by cycles, not themselves ticked),
but some may be orphans — "exists as a file" silently drifting from "runs in the tick loop." Past ~150
modules nobody holds the split in their head, and integration-density (the actual moat) is exactly what
rots first and quietest. One-time audit that pays forward.

**Do:** write `scripts/audit-emergent-wiring.mjs` that classifies every `server/emergent/` file as
**registered-cycle** (handler passed to `registerHeartbeat` or ticked inline in `governorTick`),
**support-lib** (imported by a registered cycle / route / lib, never ticked itself), or **orphan** (imported
by nothing live). Emit `audit/emergent-wiring.json` + a short markdown table. Per orphan, decide
per-module: wire it via the documented orchestrator pattern (CLAUDE.md "wire-the-unwired": lazy-import +
try/catch + return `{ ok, reason }` + `registerHeartbeat`) if it's a real cycle, or annotate it as a
support-lib with a one-line header comment so future audits don't re-flag it. No deletions without
confirming dead. Add the script to the repro-command set in `docs/AUDIT_INVENTORY.md`.

---

## T3 — Authored depth (exceed the floor)

### T3.1 — Per-skill combat depth (VFX + animation accents + mastery curves)

Covered in the **Combat-depth design section appended below**. Data-driven per-skill descriptor layered on
the existing tier/element/style systems so all ~67 skills differentiate without bespoke per-skill animation
files, with mastery milestones tied to the real server skill-XP track.

### T3.2 — Content density for the thin worlds (authored into engine-read fields)

**Do this AFTER T1.1 + T1.3** so the content actually feeds the engines instead of sitting dead. Author into
the exact fields the engines consume (verified contract):

- **Factions** (feeds faction-strategy + kingdom engines): thin worlds sit at 5–8 factions; tunya has 14 —
  real headroom. Author additional factions per thin world with *distinct relation graphs*, populating the
  fields pickMove biases off: `values`, `fears`, `rival_factions`, `allied_factions`, and a leader NPC whose
  coping trait is set (via T1.3 translation). More factions with distinct rivalries = more emergent
  war/alliance/consolidate permutations every cycle + one more kingdom per leader.
- **NPCs** (feeds scheme engine via T1.3): author NPCs with rich `narrative_context` (`fear`/`secret`/
  `current_goal`) and a `relationships` array naming real rival/ally NPCs by id — these are the inputs the
  T1.3 pass turns into stress/coping/opinion-edges, so authored interiority becomes live scheming.
- **Quests** (feeds quest/beat/forward-sim cascades): author real multi-step chains (moral branches, named
  NPCs) for under-served worlds. Current: `content/quests/main-arc.json`, `onboarding.json`,
  `faction-quests.json` + `content/quests/sub-worlds/` (21 files / 7 worlds). Verify per-world counts first;
  author a 5–7 step main chain + 2–3 side quests per thin world via the existing `seedQuestFile` path
  (`content-seeder.js:529`). Update the T0 quest count to the real post-authoring total.

Validation is permissive (only id/name required), so the risk was never rejection — it's authoring into
fields no engine reads. Authoring into the contract above avoids that.

### T3.3 — Zone architecture beyond color-grading

`concordia-theme.ts` already differentiates palette/fog/light/particles/weather per world but the code itself
flags "no skybox texture, no sun disk, no GLB hero meshes." Add genuine per-world silhouette so cyber reads
as neon-vertical and crime as noir-lowrise:
- **Per-world skybox/gradient dome** + sun disk driven by the existing theme object (extend the theme
  schema with skybox params; render in `ConcordiaScene`).
- **Per-world building style:** drive building mesh selection/material from world theme (the renderer already
  spawns buildings; add a style key per theme — neon-tower / noir-brick / ruins-marble / frontier-timber).
  Use procedural/material variation first (real, no asset-pipeline dependency); GLB hero meshes where a few
  authored landmarks per world add identity (the plaza, the forge, the Court).
- Ensure structural-stress / combat destructibility (Layer 7.5) still applies to the new building styles.

### T3.4 — Mahjong yaku re-weight + restaurant tip adoption (close the T0 loop with real tuning)

- **Mahjong:** apply the re-weighting the sim recommends for the three outlier yaku (rebalance their point
  values toward the mean-frequency target), re-run `server/tests/sim/balance-mahjong-yaku.test.js`, confirm
  outliers fall within 0.5×–2× of mean, then the corrected CLAUDE.md line is true.
- **Restaurant:** adopt `fast 0.20 / ok 0.15` from `audit/balance/restaurant-tips.json` in
  `server/lib/restaurant.js:17-19`; keep env overrides; update `balance-env-overrides` test if it pins old
  defaults.

---

## Combat-depth design section (T1.4 impact/reflex + T3.1 per-skill depth)

**Two combat paths exist and both must be wired:** (1) HTTP `/api/worlds/:worldId/combat/attack`
(`routes/worlds.js`) emits `combat:polish`/`combat:stagger`/`concordia:lethal-hit` with full `skillData`;
(2) socket `combat:attack` (`server.js:8113`) emits the broadest client signal `combat:hit` at
**`server.js:8342`** (consumed by `ReflexBridge`, `CombatVFXBridge`, `LethalHitBridge`). `combat:hit`
currently carries **no element, no skillId, no momentum** — that's the seam to enrich.

**Resolution is server-authoritative and momentum-free today.** Stagger/poise live in
`server/lib/combat-polish.js` as fixed `stagger_chance` per style (0.18–0.35), scaled by
`server/lib/mount-combat-overlay.js` multipliers; frame data is `server/lib/combat-frame-data.js`; netcode is
`server/lib/combat-netcode.js`; `server/lib/physics.js` is the physics-lens integrator, **not** the melee
resolver. The momentum model (`computeImpactMomentum`) is frontend-only and dead. So the beyond-AAA rebuild
needs a **shared momentum model usable on the authoritative server**, not just a frontend feel layer.

### T1.4a — Real momentum-driven stagger (replace the probability roll), server-authoritative

- **New `server/lib/combat-impact.js`** — a server-side momentum model mirroring the (corrected) client
  `impactKinematics`/`computeImpactMomentum` from one shared spec: derive `boneMass` (Dempster ratios ×
  actor mass × body scale), `angularVelocity` (from the strike's frame-data startup→active profile in
  `combat-frame-data.js` + skill tier amplitude), `leverArmM` (reach segment), → momentum scalar. Keep the
  *math* identical to the client so server and client agree (export the curve constants from one module
  consumed both sides, or pin them in `event-shapes.js`-adjacent shared constants).
- **Replace `stagger_chance` with a poise budget.** In `combat-polish.js`, stagger becomes deterministic
  physics: each combatant has a **poise/stability budget** (function of mass, current stance, remaining
  stamina/"gas", and whether they're bracing/blocking). A hit **staggers when transferred momentum exceeds
  the recipient's current poise**, with severity = overflow magnitude (graze → flinch → rocked → knockdown).
  No `Math.random()`. Mount overlay becomes a **mass/poise modifier** (heavier mount = more poise to break
  and more momentum delivered) instead of a `stagger_chance_mul`. Poise regenerates over recovery frames.
- **Hit region + angle matter:** momentum applied off-center (flank/back) or to a planted vs mid-stride
  stance breaks poise more — real, readable, and exploitable by players (flanking, catching mid-commit).
- Keep the frame-data timing windows (parry/dodge/active) exactly as-is — they gate *whether* contact
  happens; momentum governs *what the contact does*. The two compose: a parried hit transfers near-zero
  momentum; a counter on a mid-recovery opponent transfers full.
- Update `server/tests/combat-frame-data.test.js` + add `combat-impact` + poise-stagger contract tests
  (deterministic: same inputs → same stagger outcome, no RNG).

### Pre-existing bugs found (in scope per "fix pre-existing errors")

- **BUG A (load-bearing, prerequisite for mastery):** `server/lib/skill-tree-engine.js:78-85` queries
  `skill_revisions` by `owner_user_id` + `skill_id` — columns that **don't exist** (migration 126 schema is
  `author_kind`/`author_id`/`recipe_dtu_id`/`revision_num`/`level_at_revision`). The player branch throws
  `no such column`. Player skill levels actually live in `player_skill_levels` (mig 064:
  `user_id`/`skill_type`/`level`/`xp`) + `player_skill_affinity` (192). Fix this first; per-skill mastery
  reads from these real tables.
- **BUG B:** `combat:hit` (`server.js:8342`) never sets `element`, so `CombatVFXBridge.normalizeElement`
  falls back to `'physical'` on the socket path — element bursts never fire there. Enrich the emit.
- **BUG C (cosmetic):** `PHASE_DURATION_MS.peak` has no matching `style.stiffnessCurve.peak` key;
  `tickCombatExecution:119` already remaps it. Leave as-is or tidy.

### T1.4b — client feel + reflex driven by the shared momentum

The server (T1.4a) now ships the authoritative momentum scalar on `combat:hit`/`combat:polish`; the client
**consumes it** for feel and reflex (and may recompute locally for prediction, using the *same* shared curve
so they never diverge). This makes `computeImpactMomentum` live on both sides.

- **Bone-mass + angular-velocity source (real, reuse shipping tables):** add
  `impactKinematics(action, tier, body)` to `combat-biomechanics.ts` → `{ boneMass, angularVelocity,
  leverArmM }`. `boneMass` = Dempster 1955 segment ratio (already cited in the file header) × actor mass ×
  `BODY_SCALES[body].mass` (forearm+hand ≈ 0.022, shank+foot ≈ 0.061). `angularVelocity` = euler delta of
  the striking joint between drive→peak poses (the generators already produce these) / (`PHASE_DURATION_MS
  .impact + .peak`), scaled by `amplitudeFor(tier)`. `leverArmM` = reach segment × `BODY_SCALES[body].reach`.
  No invented numbers beyond published Dempster ratios.
- **New pure module `lib/concordia/impact-resolver.ts`:** calls `impactKinematics` → `computeImpactMomentum`
  (the call site that makes the dead fn live), maps momentum to four channels via a documented curve —
  `hitPauseMs = clamp(m*28,0,200)`, `knockback = clamp(m*1.4,0,7)`, `reflexIntensity = clamp(m/4,0,1)`,
  `billboardScale = 1 + clamp(m/4,0,1)*0.6`, severity bands → hit/heavy/crit/kill. Server `serverDamage`
  stays the *displayed* number; momentum drives *feel* (decoupled by design — anti-cheat cap untouched).
- **New bridge `components/world/ImpactMomentumBridge.tsx`** (mounted in `CombatPolishLayer`): subscribes
  `combat:hit`, runs `resolveImpact`, re-dispatches the **existing** window events so nothing downstream
  changes shape — `concordia:hit-pause`, `concordia:knockback`, `concordia:damage-billboard`, plus new
  `concordia:reflex-impact`. 120ms per-target de-dupe guard against the `combat:polish` `rocked` path.
- **Reflex wince ← momentum + region:** mirror server `regionForElement` (`server/lib/embodied/pain.js`) as
  a pure client const. `ReflexBridge.tsx` subscribes `concordia:reflex-impact`, sets `lastHitRef.magnitude`
  from momentum intensity (replacing `finalDamage/100`), threads `hitRegion`. `reflex-layer.ts` `wince`
  becomes region-aware with a `stagger_yaw` escalation above intensity 0.7.
- **Player vs NPC victim, one scalar:** `ImpactMomentumBridge` routes by `targetId === localPlayer`. Player
  → reflex-layer pose-broker overlay (per-frame); NPC → existing `concordia:hit-reaction` clip path
  (`AvatarSystem3D.tsx:1163`, already plays flinch/stagger/crit_recoil). Avoids a `ReflexLayer` per NPC.
- **Integration risk to confirm:** `AvatarSystem3D:1858-1870` freezes the target mixer during hit-pause
  (desired). Verify the reflex pose overlay (pose-broker) is **not** gated by the same `hitPauseUntilRef`
  map, or the wince won't render during the freeze.

### T3.1 — data-driven per-skill depth (all ~67 skills, no bespoke clip files)

- **New `lib/concordia/skill-descriptors.ts`**, keyed by `SKILL_CATALOG` keys. Each descriptor is a layered
  overlay over the existing tier+element+style base: `{ baseAction (attack-light/heavy/kick/grapple),
  element, styleHint, vfx{paletteOverride, trailColor, accentParticle}, animationAccents{windupBias,
  followBias, leverArmM, boneMassMul}, mastery }`. Differentiation by composition: 5 base × 7 element × 5
  style = 175 base permutations; per-skill palette/accent/lever/mass bias makes each named skill distinct
  without 67 animation files.
- **Reuse points:** `getComboVfx(tier, descriptor?)` merge overload; `element-vfx` `spawn(...overrideSpec?)`
  SPEC merge; `BiomechClipOpts.accents` so per-skill windup scales without a new generator; `impactKinematics`
  reads `leverArmM`/`boneMassMul`.
- **Reaching the render:** `handleCombatAnim` (`AvatarSystem3D:1314`) gains optional `skillKey`;
  `CombatBridges.dispatchCombatAnim` adds it; server resolves via a new deterministic
  `skillKeyForSkill(skillData)` helper (beside skill-tree-engine.js, unit-tested) shipped on
  `combat:hit` + `combat:polish`.
- **Mastery milestones — real, tied to skill XP:** `SkillMasteryCurve.milestones[] = { atLevel, unlocks
  (riposte/feint/finisher/chain_extend/guard_break), biomechHook{ addPhaseAccent: recoil_tail/offhand_
  counter/double_tap, anticipationDeltaMs, followThroughDeltaMs } }`. Milestones map onto **existing** phase
  flags: level-30 `finisher` forces `hasFullKinematicChain=true` below tier 5; `feint` inserts a fake-
  anticipation pose; `offhand_counter` forces `hasOffHandCounter`. Added as optional params to
  `generatePunchPoses`/`generateKickPoses`.
- **Mastery data source (real):** PLAYER → `player_skill_levels` (level/xp by `skill_type`) +
  `player_skill_affinity` + `skill_revisions(author_kind='player')`; NPC → `skill_revisions(author_kind=
  'npc')` + `npc_skill_acquisitions`. Surface via new `GET /api/combat/skill-mastery/:skillKey` (or
  `combat.skill_mastery` macro) → `{ level, xp, revisionNum, unlockedMilestones[] }`. Feel works offline
  from the tier already on `combat:hit`; the fetch only gates milestone affordances. `nextViableMoves`
  (`combat-motor-driver.ts:172`) gets a milestone-aware overload (riposte after parry, longer chains on
  `chain_extend`) feeding both player input affordances and NPC AI move selection.

### T3.1b — fighting styles + player moves actually shown, and fluid

The directive: the style and the move a player makes must be *visible and readable*, and combat must *feel*
fluid — not clip-swap + dice-roll. Concrete:
- **Styles render distinctly.** The 5 `style-sets.ts` styles (karate/muay-thai/wing-chun/capoeira/classical
  -swordwork) already carry stiffness curves + limb priorities but are barely surfaced. Drive each combatant's
  visible animation from their active style: stance idle, guard posture, and the per-style accent on every
  strike (a capoeira kick reads different from a muay-thai knee) via the biomechanics `accents` + the
  `skill-descriptors` `styleHint`. An opponent can *read* the style on sight → real mind-game depth.
- **Moves are telegraphed + legible.** Heavy/committed moves get a visible windup (the frame-data startup
  window made *visual* via the anticipation pose), so parry/dodge timing is learnable from animation, not
  memorized ms. Mastery moves (riposte/feint/finisher/guard_break) play distinct, recognizable animations
  when they fire — the player sees their unlock express.
- **Fluidity via motor-driven transitions.** Replace hard clip swaps with the existing PD `JointMotorSystem`
  (`combat-motor-driver.ts`) blending between poses, so chains, recoveries, and momentum knockback/follow
  -through interpolate continuously. Momentum from T1.4a drives knockback distance, stagger recovery arc, and
  reflex wince amplitude — one physical scalar, continuous, no popping. Recipient poise-break plays a
  graded crumple (flinch → rocked → knockdown) scaled by overflow, not a binary stagger animation.
- **NPC fighters use it too** — NPC archetypes pick a style + express it, so watching two NPCs fight (the
  npc-vs-npc combat cycle that warms the scheme engine) is itself legible and good-looking.

### Combat file manifest

**New:** `server/lib/combat-impact.js` (server-authoritative momentum model + shared curve constants),
`impact-resolver.ts`, `skill-descriptors.ts`, `ImpactMomentumBridge.tsx`, server `skillKeyForSkill` helper +
skill-mastery route/macro.
**Edit (server resolution):** `combat-polish.js` (replace `stagger_chance` with momentum-vs-poise stagger +
poise budget/regen + emit momentum), `mount-combat-overlay.js` (stagger_chance_mul → mass/poise modifier),
`combat-frame-data.js` (expose startup→active profile to the momentum model), `combat-netcode.js` (carry
momentum/poise in the authoritative resolution), `server.js:8342` (enrich `combat:hit` with element/skillId/
momentum/poise — fixes BUG B), `skill-tree-engine.js` (BUG A fix), `event-shapes.js` (new optional
`combat:hit` fields).
**Edit (client feel/anim):** `combat-biomechanics.ts` (export `impactKinematics`, accents + milestone flags),
`combat-motor-driver.ts` (milestone overload + PD-motor transition blending; `computeImpactMomentum` now
called), `reflex-layer.ts` (region-aware, momentum-driven graded crumple), `ReflexBridge.tsx`,
`CombatBridges.tsx` (skillKey + mount bridge + style), `CombatVFXBridge.tsx` (palette), `DamageBillboard.tsx`
(honor scale), `AvatarSystem3D.tsx` (skillKey + accents + per-style stance/idle/guard rendering; verify
reflex/hit-pause gating), `combo-vfx.ts` (merge overload), `element-vfx.ts` (override spec).

### Combat verification

`node --test` (server, authoritative): **poise-stagger is deterministic** — same (momentum, poise, stance)
→ same stagger severity, and a **grep/AST test asserting no `Math.random()`/`stagger_chance` remains in the
resolution path**; `combat-impact` momentum matches the client curve for shared fixtures (server/client
agreement); **BUG A regression** (player skill tree returns rows from `player_skill_levels`, no throw);
`combat:hit` carries element/skillId/momentum/poise (BUG B). Vitest: `resolveImpact` momentum/severity bands;
grep-test that `computeImpactMomentum` now has an importer; descriptor completeness (every `SKILL_CATALOG`
key has a descriptor). jsdom integration: `combat:hit` → bridge dispatches all feel-events with the
*server-provided* momentum; NPC → hit-reaction, player → reflex. Manual (`run`/`verify` skill): (1) fists vs
`elemental_fire` vs `archery` show distinct palette/windup/wince; (2) the **5 fighting styles read visibly
distinct** (stance + strike accent); (3) a heavy hit to a low-poise/flanked target **knocks down**, a parried
hit transfers ~0 momentum (no stagger), proving physics not dice; (4) a mastery move plays its distinct
animation at the unlock level; (5) transitions blend (no clip pop).

---

## Sequencing

0. **T1.3 scheme cold-start seed FIRST** ⭐ — single highest leverage: makes the marquee "overhear a scheme"
   moment observable on a fresh boot and makes all later authored NPCs pay into the engine immediately.
1. **T1.1 faction seed** + **T1.2 asymmetry dialogue** — turn the EVE claim + the CK3 dialogue tone true;
   highest play-impact per line, independently verifiable.
   - **Fresh-boot / feed integrity (do alongside T1.1/T1.3 — same "looks healthy, produces zero" class):**
     **T1.5 creature baseline feed** (loader reads `bestiary.json` too; author the 4 empty worlds) +
     **T1.6 evo offline seed floor** (committed seed pack so `evo_assets` is never empty offline). These are
     pure starvation fixes — cheap, high-insurance, and they make the "more content → richer engines" story
     hold on a real RunPod box, not just in principle.
2. **T2.4 emergent-module reconciliation** — early one-time audit so the rest of the work (and future work)
   builds on a known registered/support/orphan map.
3. **BUG A fix** (skill-tree-engine column mismatch) → **T1.4 + T3.1 combat** as one coherent change
   (impact model + reflex + per-skill depth + mastery).
4. **T2** surfacing (inheritance, weaponise_at, barge-in) — depends on nothing in T1/combat.
5. **T3.2 content** (author into engine-read fields, *after* T1.1+T1.3 so it pays into all 3 engines) /
   **T3.3 zones** / **T3.4 balance**.
6. **T0 doc corrections** land *with* the code that makes each claim true (not before).

## Verification (end-to-end, real)

- **Faction:** boot a fresh DB (`npm run migrate` + seed), confirm `faction_strategy_state` is non-empty;
  fast-forward the cycle (call `runFactionStrategyCycle` directly in a test with `next_move_at` in the past)
  and assert a `faction:war-declared` payload is emitted; in the running app, watch `EmergentEventFeed`
  surface it. New test under `server/tests/integration/`.
- **Scheme cold-start (marquee):** boot a fresh DB, seed authored worlds, run the translation pass, then
  run `npc-scheme-cycle` a few times with **zero player gameplay** and assert ≥1 scheme reaches a terminal
  phase along an *authored* rivalry edge (e.g. the Zero/clone or Thorne/apprentice pair) → `npc:scheme-
  resolved` emitted. This is the "does a cold-booted stranger see it" test. New `server/tests/integration/`.
- **Asymmetry:** contract test asserting `composeAsymmetryContext` fields appear in the `/dialogue`
  `promptLines` AND in `oracleDialogueTreeComposer` output; plus the secret-omission canary still passes.
  Manually: seed a grudge, talk to the NPC in the world lens, confirm the tone reflects it.
- **Reconciliation (T2.4):** `node scripts/audit-emergent-wiring.mjs` runs clean and every `server/emergent/`
  file lands in exactly one of registered-cycle / support-lib / orphan; orphans are either wired or annotated.
- **Creature feed (T1.5):** per-world test asserts every one of the 9 worlds resolves ≥1 creature baseline
  (tunya now grounds from `bestiary.json`); no world spawns ungrounded.
- **Evo floor (T1.6):** test with network loaders stubbed asserts `bootstrapLocalSeed` leaves `evo_assets`
  non-empty and `runEvolutionTick` has candidates; on live, `SELECT COUNT(*) FROM evo_assets > 0`.
- **Combat:** see combat-depth section's verification (unit test `computeImpactMomentum` is called in the
  hit path; reflex pose offsets fire on victim; per-skill descriptor resolves for all 67 skills).
- **T2:** tomb modal shows heirs + inherited trait; barge-in route changes a scheme outcome (integration
  test); `weaponise_at` gets stamped when consumed.
- **T3:** quest seed counts per world increase to target; zone screenshots differ in silhouette (use the
  `run`/`verify` skills to launch the world lens per world); mahjong sim shows no outliers; restaurant sim
  defaults adopted.
- **Suite:** `npm test` (server) + `npm run test:run` (frontend) green; no new TypeScript errors
  (`npm run type-check`); `npm run validate-routes` for the new `/schemes/:id/intervene` route.

---

## Authored content (verbatim)

Delivered by the user during implementation. Preserved here as source-of-truth; to be wired under T3.2.
Wiring targets: artifact 1 → `content/world/concordia-hub/lore.json` (via `seedLore`); artifact 2 →
`content/codex/eight-refusals.json` + a codex seed pass that mints citable DTU(s). Both also drive T3.2
faction `rival_factions`/`allied_factions` + NPC `relationships`/`narrative_context` so the named figures
(Voss dynasty, Zero↔Nyx, Elias↔Vesper, Thorne, Lyra, the Third Keeper) light up the T1.1 war + T1.3 scheme
engines on boot.

### Artifact 1 — Concordia Hub history (lore events)

```json
{
  "world_name": "Concordia — The Hub",
  "world_description": "The heart of all realities. A walled world-city the size of a country, where the Concord Link surfaces as eight permanent gates — one for each world it binds. Under the Concordant Law it is the only true neutral ground in existence: any soul may enter, none may conquer it, and only the three pillars hold permanent authority. Everyone else, however powerful in their own world, walks the hub as a guest. The eight figures who shape every reality keep embassies along the Ring of Doors; their rivalries, debts, and quiet wars braid through the markets, the temple of the twelve hours, and the lantern paths at dawn. The Sovereign watches, amused. Concord catalogs. Concordia, who poured herself into the ground here, wishes for more silence and less politics — and gets neither.",
  "history": [
    { "id": "hub_the_heart_claimed", "title": "The Ground She Made Hers", "type": "founding", "era": "The Great Refusal", "description": "When Concordia poured her entire being into the ground beneath the Sovereign's feet and declared the world hers, the soil did not simply hold him — it held everything. Where her life-force pooled deepest, a city began to grow on its own: streets that arranged themselves around the eight points where the Concord Link had torn the sky, walls that rose to keep no one out but to mark what was sacred. This is the bedrock of the hub. Dig far enough beneath any district and you reach the same thing: her, listening.", "significance": "The hub is not built on Concordia — it is built OF her. This is why no weapon forged in any world has ever broken its walls, and why the dead are quieter here than anywhere else.", "factions_involved": ["the_three_pillars", "verdant_veil"] },
    { "id": "hub_the_ring_of_doors", "title": "The Ring of Doors", "type": "founding", "era": "The Great Refusal", "description": "After the Truce, the eight surviving gates of the Concord Link did not close. The Sovereign refused to let them — having once refused the very concept of 'alone,' he would not now reseal the worlds from each other. The Concordant Law set the terms: each world would maintain one embassy at its gate, staffed by its own and answerable to no pillar. The gates were arranged in a ring around the old battlefield, which was left unpaved. They still call it the Unburned Court, though nothing there ever burned.", "significance": "Establishes the eight-embassy structure and names the central plaza. The Unburned Court is the one place in the hub where the Concordant Law is read aloud each Founding Day.", "factions_involved": ["the_three_pillars", "scholars", "iron_wardens", "merchant_collective", "shadow_network"] },
    { "id": "hub_the_one_conquest_attempt", "title": "The Night Someone Tried", "type": "catastrophe", "era": "Year 38", "description": "Once — only once — a coalition of three embassies attempted to seize the Unburned Court and declare a hub government. They held it for four hours. Then the ground spoke. Not the Sovereign, not Concord. Concordia herself rose through the flagstones as a wall of root and bloom and took back nothing by force — she simply made the Court impossible to stand on, growing it faster than boots could find purchase, until the conspirators were carried out on a tide of flowers. No one died. No one was punished. The message was the mercy: you cannot own the heart, and she will not even dignify the attempt with anger.", "significance": "Why no faction has tried to conquer the hub in over fifty years. The 'tide of flowers' is now a hub idiom for a plan that fails gently and absolutely.", "factions_involved": ["the_three_pillars"] },
    { "id": "hub_the_embassy_era", "title": "The Embassy Era Begins", "type": "power_shift", "era": "Year 40 to Year 91", "description": "With conquest off the table, the eight worlds learned to fight the only way the hub allows: with leverage, secrets, marriages, debts, and trade. Each embassy became an instrument of its world's ambition. The Crimson Court embassy (fantasy) trades in blackmail dressed as etiquette. The Grid embassy (cyber) runs the hub's data spine and quietly reads everything that crosses it. The Syndicate embassy (crime) launders not money but reputation. The frontier keeps no embassy at all — the walkers say the road is their door — which the other seven find either insulting or enviable.", "significance": "Defines the hub as a city of soft power. Combat is rare here; the weapons are information and obligation. This is the social substrate the NPC scheme engine runs hottest against.", "factions_involved": ["crimson_court", "grid_authority", "delgado_syndicate", "frontier_freenodes"] },
    { "id": "hub_concordant_web_now", "title": "The Concordant Web (Present)", "type": "current_state", "era": "Year 91 (Present)", "description": "Eight figures move through the hub at once, and every one of them wants something from another. Elias Voss runs the Anti-Sovereign Movement from a basement two streets from the Sovereign's own tower. Vesper Kane funds half the hub's charities and owns the debt of the other half. Lady Seraphine Voss and Elias share a name, a bloodline neither will discuss, and an apparatus of mutual surveillance. Jax Rivera takes contracts from all eight and loyalty from none. Mama Iron Rose holds her people together across realities by never sleeping in the same world twice. Thorne Blackroot comes only at night, to the one grove the hub keeps for him. Kael 'Zero' Nakamura studies the Sovereign's refusal the way a man studies a god he intends to replace. Nyx 'Blackout' Torres organizes against Zero from inside the same embassy that employs him.", "significance": "The live present-tense state of hub politics. Every name here is an authored NPC; every relationship is a scheme waiting to be seeded. This event is the dialogue hook for hub-spawned narrative.", "factions_involved": ["anti_sovereign_movement", "luminary_industries", "crimson_court", "grid_authority", "delgado_syndicate"] },
    { "id": "hub_the_voss_question", "title": "The Voss Question", "type": "mystery", "era": "Year 91", "description": "There are Vosses in four worlds. House Voss rules secrets in the fantasy realm; the Voss Consultation steers the Grid's elite; a Voss envoy brokered the underworld's first truce; and Elias and Seraphine carry the name into the hub itself. The Scholars' embassy keeps a sealed genealogy that purports to trace all of them to a single ancestor who walked the Concord Link before the Truce — before, by every other record, the Link existed. No one who has read the genealogy will say what the ancestor's first name was. Two who asked to read it have since declined to discuss the matter at all.", "significance": "Canonizes the cross-world Voss dynasty as a deliberate thread, not a coincidence. The sealed genealogy is a recurring quest object usable in any world that has a Voss.", "factions_involved": ["scholars", "crimson_court", "anti_sovereign_movement"] },
    { "id": "hub_lamplighter_eastern_path", "title": "The Lamplighter Keeps Walking", "type": "mystery", "era": "Year 0 (?) to Year 91", "description": "Before dawn, someone walks the eastern lantern path lighting lamps that are already lit. The Lamplighter has done this for as long as the hub has existed — longer than any single person could live, and the temple records hint the lineage was once two people sharing one lantern and one name. They speak to no one except, very rarely, a newcomer who has just arrived through a gate and does not yet know where anything is. To those, the Lamplighter gives one true sentence about the hub, and is never seen by them twice.", "significance": "The hub's intimate-scale anchor and a natural first-contact NPC for newly-arrived players. The 'one true sentence' is the cleanest place to teach a stranger what Concordia is.", "factions_involved": ["verdant_veil"] },
    { "id": "hub_the_ninth_refusal", "title": "The Refusal That Is the Hub", "type": "revelation", "era": "The Great Refusal", "description": "The Verdant Veil codified Eight Refusals, and Lyra Silentchant, keeper of the second hour, has refused to teach a ninth. The keepers of the upper grove believe she is wrong to withhold it. They are also wrong about why. The ninth refusal was never hers to teach, because it is not spoken — it is stood upon. To live in the hub at all, to enter through any gate and put down a single coin in a market that belongs to no world, is to refuse the thing every other refusal cannot help but commit: the refusal to let one's own refusal win. The hub is the ninth refusal, made of ground instead of words. Lyra has not taught it because it cannot be taught. It can only be walked into. The Third Keeper, who walked into the goddess and was not seen again, may have been the first to understand this.", "significance": "The thematic keystone that ties the hub to the Refusal spine, the secret eighth refusal, and the Third Keeper mystery. The hub is not the absence of the Refusals — it is the one that holds the other eight in balance.", "factions_involved": ["verdant_veil", "the_three_pillars"] }
  ]
}
```

### Artifact 2 — The Eight Refusals codex (cross-world)

```json
{
  "codex_name": "The Eight Refusals",
  "codex_description": "The load-bearing idea of the universe. Concord is structure; Concordia is life; the Sovereign is the will that says 'no' to any order imposed on either. That 'no' is a Refusal — the act of standing against a law that the world insists is final. The Verdant Veil keepers codified eight of them twelve years after the Founding Compact. What the keepers did not write down, because it took the keepers themselves a generation to see, is that each Refusal had already built itself a world. The Concord Link did not connect eight arbitrary realities. It connected the eight places where a single Refusal had become a whole way of being — and the cost of that Refusal had become the world's wound. To travel the Link is to walk from one 'no' to the next. To stand in the hub is to hold all eight without letting any of them win.",
  "the_three_pillars_on_refusal": {
    "concord": "Believes refusal is error — a structure failing to accept a more correct structure. Catalogs every Refusal precisely, the way one catalogs a disease.",
    "concordia": "Believes refusal is the only proof that something is alive, because only the living can say no. Grieves every Refusal anyway, because each one costs the refuser something she made.",
    "the_sovereign": "Is refusal. Does not believe in it; embodies it. The Eight are not his doctrine — they are eight people who learned to do, at the scale of a world, the thing he does by existing."
  },
  "refusals": [
    { "id": "refuse_death", "name": "The Refusal of Death", "world_id": "sovereign-ruins", "the_no": "We will not allow our ending to be final.", "incarnation": "Concordia's sister-city, the first place where refusal became possible at the scale of a city — and the first place where that capacity exhausted itself. They refused to die. The Refusal Cascade was the moment the whole city said 'no' to its own ending at once.", "the_cost": "A world that refuses death cannot bury anything. The ruins are not abandoned; they are unable to finish dying. Everything there is still, technically, ongoing.", "central_figure": "The keepers of the Refusal Glyph", "thread": "The Court Unburned in the ruins shares its name with the Unburned Court in the hub — the same act, attempted once at city scale and once at the scale of all realities." },
    { "id": "refuse_harvest", "name": "The Refusal of Harvest", "world_id": "tunya", "the_no": "We will not be reaped — not by Earth's fate, not by the soil, not by Kree.", "incarnation": "Seven arks refused humanity's harvest by extinction and crossed a wormhole to a planet that could feed them. The Verdant Veil keepers refuse the harvest spiritually; the Second Drought was the soil refusing back.", "the_cost": "A world that refuses to be harvested must also refuse to harvest fully, or become the thing it fled. Tunya's agriculture is a permanent negotiation with a land that remembers being asked for too much.", "central_figure": "The Verdant Veil and the keepers of the upper grove", "thread": "Tunya is where the Eight Refusals were originally codified. It is the spine's birthplace — the only world that knows it is a Refusal." },
    { "id": "refuse_hostility", "name": "The Refusal of Hostility", "world_id": "fantasy", "the_no": "I will not meet the thing that is destroying me by becoming it.", "incarnation": "The Sundering. Thorne Blackroot carries a curse he could turn outward and win with — and refuses, every day, to become the weapon he was meant to stop. The realm's Three Refusals are the public form of this private war.", "the_cost": "A world that refuses hostility loses ground continuously to those who don't. The forests go quiet around Thorne because restraint, held long enough, looks exactly like defeat.", "central_figure": "Thorne Blackroot", "thread": "Lady Seraphine Voss runs the Crimson Court here — the Voss bloodline's fantasy-world seat, and the thread that ties this world to the hub's Voss Question." },
    { "id": "refuse_consequence", "name": "The Refusal of Consequence", "world_id": "crime", "the_no": "What we do will not catch up to us.", "incarnation": "A grounded city built entirely on the proposition that an action can be severed from its result — the Ghost who leaves no trace, the syndicate that launders not money but cause and effect itself. This is the one world that does not know the cosmology exists. It refuses consequence so completely that it has refused even the knowledge of the Refusals.", "the_cost": "A world where nothing lands is a world where nothing heals. Every wound in the crime world is still open, because closing one would mean admitting the act that made it.", "central_figure": "Jax 'The Ghost' Rivera and Mama 'Iron Rose' Delgado", "thread": "When the Concord Link first bled into this world, no one had a frame for it — making the crime world the universe's horror story: the place where the cosmic becomes uncanny precisely because it is unwelcome. The Voss Envoy who brokered its first truce was the first outside force it could not erase." },
    { "id": "refuse_numbers", "name": "The Refusal of Numbers", "world_id": "cyber", "the_no": "I will not be counted — not reduced to data, not summed into a single mind.", "incarnation": "The Grid. Kael 'Zero' Nakamura uploaded himself to become a city-sized self-correcting mind, which is the ultimate harvest of selves into one number. Nyx 'Blackout' Torres refuses it — organizes the uncounted. The terrible joke is in his name: Zero is the number that refuses to be one.", "the_cost": "To refuse being counted, you must eventually refuse to count yourself. Zero no longer knows which clone is his original, and hasn't for six months. He has refused the number that would tell him.", "central_figure": "Nyx 'Blackout' Torres (refuser) against Kael 'Zero' Nakamura (the counting)", "thread": "Zero studies the Sovereign's refusal mechanic in the hub — a counter trying to learn the one thing that cannot be counted. The Voss Consultation steers the Grid's elite from the shadows." },
    { "id": "refuse_dome", "name": "The Refusal of the Dome", "world_id": "concord-link-frontier", "the_no": "We will not be enclosed. The road is our door; the mesh is our wall.", "incarnation": "The territory between the cities, where the federation does its actual work — peer-to-peer routing, walker journeys, freenodes. It is the only world that keeps no embassy in the hub, because to claim a fixed seat would be to accept a dome. The frontier refuses walls so thoroughly it refuses even the protection of one.", "the_cost": "No dome means no shelter. The frontier's people are free and exposed in the same breath; trust between cities is only as strong as the last handshake on an open road.", "central_figure": "The walkers and the freenodes", "thread": "The frontier is the literal connective tissue between all eight worlds — the Refusal that exists in the space between the others. Its 'refusal of enclosure' is why the Concord Link's gates never closed." },
    { "id": "refuse_win", "name": "The Refusal of the Win", "world_id": "superhero", "the_no": "I will not take the final victory, because the one who wins this becomes the thing worth fighting.", "incarnation": "A metropolis where Concord's emergent layer rewrites people into the powerful, and two poles — the Enforcer fighting up from the bottom, the Luminary ruling from above behind a hero's face — meet at dawn again and again. Neither is allowed to win, because victory for either is tyranny. The endless battle is the Refusal.", "the_cost": "A war that refuses to end is still a war. The city pays in a permanent dawn it can never get past — every sunrise is the same sunrise.", "central_figure": "Elias Voss (the Enforcer) against Vesper Kane (the Luminary)", "thread": "Elias Voss carries the Voss name into the Anti-Sovereign Movement in the hub. The bloodline that rules secrets in fantasy fights tyranny in the superhero world — the same blood, opposite refusals." },
    { "id": "refuse_the_eighth", "name": "The Eighth Refusal", "world_id": "lattice-crucible", "the_no": "[taught only to the keeper of the second hour]", "incarnation": "The Crucible — the world the lattice-orchestrator cycles into existence, where drift events are not flavor but the federation's own drift-monitor surfacing as terrain. It is the world that refuses to be a closed, finished system. Its weather is the universe noticing itself. This is why the eighth Refusal is secret: it is the Refusal to be complete, and a thing that refuses completion cannot be written down, only kept open.", "the_cost": "A system that refuses to close can never rest. The Crucible re-cycles, re-drifts, never settles. To hold the eighth Refusal is to never be finished — which is also why Lyra Silentchant will not teach a ninth. There is no ninth to teach. There is only the open door.", "central_figure": "Lyra Silentchant, keeper of the second hour", "thread": "The Crucible makes the game's own infrastructure diegetic — the one place where the system that runs the universe is the universe. This is the spine's most original point and its furthest edge." }
  ],
  "the_ninth": {
    "name": "The Refusal That Is the Hub",
    "the_no": "I refuse to let my own refusal win.",
    "explanation": "Lyra has not taught a ninth Refusal because the ninth is not spoken — it is stood upon. Each of the Eight, held alone, becomes its own tyranny: refuse death and you cannot bury; refuse consequence and you cannot heal; refuse the win and you cannot stop. The hub is the ground where all eight are held at once and none is allowed to complete. To live there is to perform the ninth Refusal with your feet. The Third Keeper, who walked into the goddess and was not seen again, was the first to understand that the hub is not a place between the Refusals — it is the act of refusing to choose among them. Concordia made it of her own body for exactly this reason."
  }
}
```

### Wiring notes for T3.2 (when this content lands)
- **Lore** → merge artifact 1's `history[]` into `content/world/concordia-hub/lore.json`; the existing
  `seedLore` pass (content-seeder) ingests it. Validate with the lore validator (id/title/description).
- **Codex** → `content/codex/eight-refusals.json`; add a small idempotent seed pass that mints it as a
  `kind='codex'` (or `lore`) DTU so it's citable and surfaces in the atlas/lore lenses + grounds oracle
  dialogue. Per-world `world_id` lets each world's lens pull its own Refusal entry.
- **Engine payoff** → to make the named figures actually scheme/war on boot (T1.1 + T1.3), the matching
  `factions.json` must carry `rival_factions`/`allied_factions` (e.g. anti_sovereign_movement ↔
  luminary_industries; grid_authority ↔ the uncounted) and the NPCs must carry `relationships`
  (Zero↔Nyx `ideological_nemesis`/`estranged_fork`; Elias↔Vesper `deliberate_threat`; Seraphine↔Elias
  `wary_respect`) + `narrative_context.secret`/`weaponise_at` (the Voss genealogy, Zero's lost original,
  Iyatte's son). Those are exactly the fields the shipped T1.1/T1.3 passes read.

---

# Phase E — Genre deepening to undeniable

**Framing.** The bar is not "other studios" — it's *the depth a player expects when they sit down to a
combat game, a strategy game, a life-sim, a roguelite.* Concordia is one developer spanning all of them at
once; the goal is that no player of any single genre can dismiss its slice, and the **intersection** (your
song → someone's spell → someone's quest, royalties cascading 50 generations) is unprecedented. Every target
below is grounded in web research (cited in the appendix) with an explicit *not-dismissible* vs *undeniable*
bar. Items already shipped this session are marked ✅.

## E0 — The Hour-1 dismissal gaps (CORRECTED after per-title grep audit)

⚠️ **Correction (per-title audit, supersedes the original adversarial pass):** a careful per-title grep
found that **most of the original "Hour-1 gaps" are already built** — the adversarial pass and a stale
`concordia-theme.ts` comment were wrong. Verify-don't-assume. Corrected status:

| # | Item | Real status (grep-verified) |
|---|---|---|
| 1 | Skybox / sky dome | ✅ **ALREADY EXISTS** — `lib/world-lens/sky-shader.ts` (procedural Rayleigh/Mie `SkyDome`), wired in `ConcordiaScene`. NOT a gap. |
| 2 | Player nameplates | ✅ **ALREADY EXISTS** — `AvatarSystem3D.tsx:1553 createNameTag` (name + profession + emblem). NOT a gap. |
| 3 | Boss health-bar / phase HUD | ✅ **DONE THIS SESSION** (E0#3 shipped — `BossHealthBar.tsx` + `boss-hud.js` + ordering bug fix). |
| 4 | Visible affinity meter | ✅ **ALREADY EXISTS (courted NPCs)** — `CourtshipProgressOverlay.tsx`. Gap only for non-courted NPCs. |
| 5 | Attack telegraphs / tells | ⚠️ **PARTIAL** — `combat:telegraph` → `BodyLanguageOverlay.tsx` exists but is a generic light/heavy windup, not a *typed* readable tell. Real remaining work. |
| 6 | Quest markers on map / 3D | ✅ **ALREADY EXISTS** — `QuestMarker3D.tsx` + `QuestWaypointBeacon.tsx`, mounted. NOT a gap. |

Also confirmed already-present (were wrongly listed as gaps): chat channels (`ChatSystem.tsx`), daily quests +
reset (`xp-hooks.js`), leaderboards (`getLeaderboard`), dye/cosmetics (`cosmetics.js`), difficulty tiers +
boss lockouts (`world-bosses.js`). **Net: of 6 original Hour-1 gaps, 1 was real (boss HUD, now shipped),
1 is partial (typed telegraphs), 4 were false.** Phase E's true first-priority work is the deepening
buckets below, not "make it look like a real game" — it already does.

## E1 — Action combat → undeniable (vs Souls/Sekiro/BDO/GoW)

**Verified:** BDO is action/no-tab ✓; Souls stagger is poise-based not RNG ✓; AAA impact is *hybrid*
(authored hitstun for light hits + momentum impulse for heavy) — and the research flagged Concordia's
momentum-at-contact model as **more advanced than most AAA**, which already use authored animations only.

14-mechanic depth checklist (research-derived). Current state:
- ✅ real-time input (E/F/R/Q), lock-on (soft+hard), stamina ("gas"), frame data (`combat-frame-data.js`),
  **momentum-vs-poise stagger (T1.4a, deterministic, graded flinch/rocked/knockdown)**.
- ⏳ **i-frame dodge windows** (startup→invuln→recovery), **parry timing windows** surfaced + rewarding,
  **hyperarmor** on heavy attacks, **animation canceling** (cancel whiff into dodge at ≥50%), **input
  buffering** (4–6 frames), **hitstop + screenshake on the client** (momentum→`concordia:hit-pause`/
  knockback/wince — T1.4b), **per-skill VFX + weapon-class movesets** (67 skills tier-generic today — T3.1),
  **boss phases + health-bar HUD + arena tells** (E0#3 + content), **attack telegraphs** (E0#5),
  **distinct impact audio** per weapon/hit class.
- **Not-dismissible:** i-frames + stamina + frame data + hitstun + poise + lock-on + impact audio (have most).
- **Undeniable:** + hitstop, parry windows, hyperarmor, anim-cancel, input buffer, momentum knockback (have),
  per-skill movesets, boss phases, telegraphs, audio coupling. **This is the single biggest "is it a real
  action game" lever** — finish T1.4b + T3.1 + E0#3/#5.

## E2 — Strategy / intrigue → undeniable (vs CK3/EVE)

**Verified:** CK3 NPCs inherit grudges (50% to relatives) and act on them ✓; EVE sovereignty + markets shift
offline ✓. CK3 intrigue mechanic list (research): hooks (strong/weak), secrets-as-leverage, schemes
(murder/seduce/befriend/discredit/fabricate), **agents recruited into schemes**, scheme power vs resistance,
stress, dread, lifestyle perks, scheme discovery → reputation crash.

Current: ✅ faction wars fire (T1.1), ✅ schemes fire cold-start from authored interiority (T1.3),
grudges/preoccupations/desires (asymmetry). Gaps:
- **Player participation** — today you *watch* schemes/wars; CK3/EVE let you *join/influence*. Build:
  player can join an NPC scheme as agent, back a faction in a war, or expose a scheme (extends the T2.3
  barge-in route into a full intrigue-action surface).
- **Intrigue legibility UI** — a secrets ledger + hooks panel + **faction-relations map/graph** showing
  stance + war state (today only a war banner). This is what makes the EVE/CK3 layer *perceivable*.
- **Secrets-as-leverage + hooks** — `weaponise_at` consumption (T2.1) is the seed; add hooks (a favor that
  blocks a target's hostile action) + scheme discovery → reputation cascade (dread/tyranny).
- **Not-dismissible:** persistent offline change + grudges + one feedback loop (✅ have). **Undeniable:**
  3+ autonomous systems the player can *see and influence* + cascading consequences + a relations UI.

## E3 — Life-sim / romance → undeniable (vs Stardew/Animal Crossing/BG3)

Gaps (all MAJOR/CRITICAL per audit): **visible affinity meter** (E0#4), **gift system + per-NPC
preferences** (loved/liked/disliked → affinity delta; zero `gift` in `romance.js` today), **romance heart
events** (scripted scenes at affinity milestones), **marriage depth** (spouse moves in / helps / dialogue
shifts — Stardew bar), **daily-return loop** (crops/energy/dailies + decay so non-engagement costs
something), festivals tie-in (✅ festivals fire; hook NPC behavior + gifting to them).
- **Not-dismissible:** 10+ NPCs w/ individual dialogue (✅ 128) + affinity-via-gift+daily + 2-season calendar
  (✅ seasons). **Undeniable:** gift preferences + heart events + marriage consequence + affinity decay +
  4 activity trees each 5 deep.

## E4 — Run-modes → undeniable (deepen the 6 real-but-thin loops, ~150 LOC each)

Per-sub-genre research checklists. The loops exist (roguelite/horde/extraction/horror/time-loop/brawl); they
need depth: **build diversity** (10–15 viable builds; synergy engine), **meta-progression** (permanent
unlocks per 3–5 runs), **difficulty tiers** (player-activated, change enemy types not just numbers), **run
variance + fair RNG** (deterministic core + randomized encounters), **visible progression**, and the
"one-more-run" clarity ("I died because I misplayed, not RNG"). Extraction needs loot-economy stakes +
scarcity + audio-positioning; horror needs role asymmetry + comeback mechanics; horde needs linear visible
scaling + class synergy; time-loop needs knowledge-as-currency persistence.
- **Not-dismissible:** win/loss + randomized content + predictable scaling + 2 builds + meta-progression +
  15–45min runs. **Undeniable:** the full per-genre checklist (300+ build combos for the Hades-style one, 5
  difficulty tiers, etc.).

## E5 — MMO / social surfaces (vs WoW/FFXIV)

Missing, mostly UI/ENG: **player nameplates** (E0#2), **party UI** (member list + HP bars + buff icons; today
`PartyCombatHUD` is tactical-only), **chat channels** (local/party/faction/trade — today only DMs + sockets),
**LFG role selection** (board is flat text), **guild progression + perks UI** (orgs exist, no tiers),
**leaderboards**, **daily quests + reset timer** (no daily-return hook), **full world map + quest markers**
(E0#6). Not-dismissible: nameplates + party UI + a chat channel + world map. Undeniable: + guild
progression + daily loop + LFG roles + leaderboards.

## E6 — World / rendering (vs RDR2/Elden Ring)

**Skybox/sky dome** (E0#1), **per-region architecture** (today color-graded sameness; needs distinct
building meshes/silhouette per world — extends T3.3), **character appearance customization UI** (avatars
generated, no barber/tailor; wardrobe overlay coded in `OutfitBuilder` but not surfaced), **weather VFX**
(signal substrate tracks weather; no visible rain/snow particles), **transmog/dye picker** (Phase BA3
overlay exists, no UI). Not-dismissible: skybox + visible weather + day-night. Undeniable: + per-region
architecture + appearance customization + dyes.

## E7 — Economy / marketplace depth + the moat made legible

Marketplace gaps: **price-history graphs**, **order book** (buy/sell spread), **buy-order queue**, regional
pricing. **The moat (lead here):** research confirms cross-activity fungibility + a 50-gen royalty cascade is
*genuinely rare* (closest analogues — Second Life ownership, Roblox/UEFN revenue-share — each lack half of
it; Dreams proved forced-remix-without-pay fails). The work: make the loop **visible and rewarding** — a
creation→citation→royalty trail surfaced in-UI, creator analytics, and the onboarding beat that *shows* a
cooked dish become a tradeable DTU someone cites. Not-dismissible: 30% creator share + transparent discovery
+ fast cashout + public genealogy. Undeniable: the cascade + cross-activity fungibility + personal/private
scopes (already designed) surfaced legibly.

## E8 — Game-feel / juice + audio + FTUE (cross-cutting polish that sells everything)

- **Juice (7-technique checklist):** screenshake, hit-flash/tint, hitstop (✅ pause primitives exist),
  particles, audio layering, floating damage numbers (✅ `DamageBillboard`), micro-animations. Stack 3–5 on
  every important moment (crit/kill/level-up). Wire per-skill VFX (T3.1) + screenshake (missing) + spatial
  audio panning (missing, ~4h, +20% perceived immersion).
- **Audio (40–60 file minimum):** biome music loops, terrain-aware footsteps, UI SFX, ambient bed, combat
  SFX with pitch variation, **music state transitions** (calm→combat→boss — missing), music ducking on
  dialogue (✅ SoundscapeEngine). Solo-dev strategy: procedural ambient + committed CC0 SFX + opt-in TTS/LLM
  NPC voice. *Silent lenses are the biggest "unfinished" tell.*
- **FTUE (first 30 min):** 80% bounce if no value in 3 min. Template: action <30s, first victory <10 min,
  one permanent choice by 15 min, one mechanic per ~3 min via progressive disclosure, skip on all dialogue,
  challenge curve not flat. ✅ cook→eat→fight→commune chain exists; add: **show the moat** (mint→cite→royalty)
  in the first session, the Lamplighter first-contact (now authored), avatar customization at min 5, a
  visible social signal by min 15.

## E9 — Content density to target (now pays into 3 engines)

Honest calibration (cited): **quests 54 → 100 (not-dismissible) → 300+ narrative-gated (undeniable)** — FFXIV
density comes from *every quest being a story-gate + dungeon + cutscene*, not raw count; **NPCs 128 already
clear the bar; 66 factions exceed even undeniable.** So the work is quests + *depth per NPC/faction*, not
more factions. Author across all 9 worlds into the **engine-read fields** (`rival_factions`/`allied_factions`
+ NPC `relationships`/`narrative_context`) so wars (T1.1) + schemes (T1.3) + kingdoms light up dense on boot.
The hub history + Eight Refusals codex (✅ this session) is the template; replicate per world. Add romance
content (heart events) for E3.

## E10 — Balance + playtest pass (prove it holds up)

All ~25 Phase-D dials are first-draft; mahjong yaku has real outliers (sim-confirmed); restaurant tips
recommended but unadopted. Do the real tuning (T3.4) + a genuine end-to-end playtest pass per genre, then
bake observed values. Undeniable requires the numbers be *played*, not guessed.

## Phase E sequencing

1. **E0 Hour-1 gaps** (skybox, nameplates, boss HUD, affinity meter, attack telegraphs, quest markers) — the
   "feels real" gate; mostly small ENG; do first.
2. **E1 combat** (T1.4b client feel + T3.1 per-skill + boss phases + telegraphs) — biggest "real game" lever.
3. **E8 juice/audio/FTUE** — sells every genre; cheap, high perceived-quality.
4. **E2 intrigue + E3 life-sim depth** (player participation + intrigue UI; affinity meter + gifts + heart
   events) — turns the watched simulation into played systems.
5. **E5 MMO surfaces + E6 world/rendering** (party UI, chat, per-region architecture, customization).
6. **E4 run-mode depth + E7 economy/moat-legibility.**
7. **E9 content density (all 9 worlds into engine-read fields) + E10 balance/playtest.**

## Claims verification appendix (research-backed, cited)

| Claim I made | Verdict | Source |
|---|---|---|
| BDO = action combat, no tab-target | ✅ TRUE | en.wikipedia.org/wiki/Black_Desert_Online; blackdesertblog |
| Souls stagger is poise-based, not a dice roll | ✅ TRUE | screenrant Elden Ring poise; fextralife |
| AAA computes impact from frame-data + hit-reactions (not momentum) | ✅ TRUE (hybrid) — Concordia's momentum model is *ahead* of most | researchgate hit-reaction IK; toptal rigid-body |
| FFXIV: 513 MSQ + Island Sanctuary as separate life-sim layer | ✅ TRUE | ffxiv.consolegameswiki MSQ; Island Sanctuary wiki |
| CK3 NPCs inherit grudges and act on them | ✅ TRUE (50% opinion to relatives + Vengefulness AI) | ck3.paradoxwikis AI_modding; primagames intrigue |
| EVE sovereignty + markets change while offline | ✅ TRUE | wiki.eveuniversity Sovereignty; EVE economy refs |
| Cross-activity fungibility + 50-gen royalty cascade is rare | ✅ TRUE — closest analogues each lack half | Roblox DevEx; UEFN; Second Life; Dreams critique |
| Content honest calibration: 54 quests is below bar; 128 NPCs / 66 factions above | ✅ — quests are the gap, not factions | FFXIV/Witcher/Skyrim/Stardew counts (cited in research) |

Full source lists (60+ cited URLs across combat, strategy/life-sim, UGC/feel/onboarding/audio) are in the
research agent transcripts; key ones inlined per claim above.

## Top-15 dismissal gaps (ranked; from adversarial audit)

Tier 1 (bounce in hour 1): 1 skybox · 2 player nameplates · 3 boss HP/phase HUD · 4 affinity meter ·
5 attack telegraphs. Tier 2 (hours 1–4): 6 quest markers on map · 7 per-region architecture · 8 party UI
(HP/buffs) · 9 NPC gift system. Tier 3 (engagement): 10 skill-tree UI · 11 market price graphs · 12
difficulty tiers (normal/heroic/mythic) · 13 world music state transitions · 14 party-voice integration ·
15 daily quests + reset. (Each has file-evidence + complexity estimate in the audit; several overlap Phase E
subsections above.) NB a few audit items are partially addressed by shipped session work (scheme
participation → T2.3; affinity surfacing → E0#4/E3) — verify before building.

---

## Per-title benchmark audit (34 titles, grep-verified) — results

Four parallel agents researched each title's signature mechanics (cited) and grepped Concordia for
HAS/PARTIAL/MISSING. Per-title coverage (rough, file-evidenced):

- **Action:** Souls ~5/9 · Sifu ~3.5/8 (best-matched) · BDO ~2.5/8 · GoW ~2.5/8 · Sekiro ~1.5/8 · DMC/Bayo ~1.5/8.
- **Run-modes:** lifecycle ✅ everywhere, depth ~0–4/7 — shallow on in-run variety + multiplayer.
- **MMO/RPG/life-sim:** RDR2 ~5.5/7 · Stardew ~5.5/8 · Skyrim ~5/7 · ACNH ~5/8 · RuneScape ~4.5/7 ·
  Witcher ~4/7 · WoW ~3.5/7 · FFXIV ~3.5/7 · Diablo ~2.5/7 · BG3 ~2/7 (worst-matched, by design — combat
  is action, not turn-based d20).
- **UGC:** **ahead of all six** (Roblox/Fortnite/Minecraft/SecondLife/Core/Dreams) on royalty/fungibility/
  consent — **and NOT behind on fiat cash-out** (the audit's one claimed deficit was wrong): Concord Coin is
  a 1:1 USD-pegged token with Stripe checkout (mint) + Stripe Connect payout (withdraw), confirmed in
  `economy/{stripe,coin-service,withdrawals}.js`. So Concordia is not behind the UGC field on any major axis.

**The genuine, grep-confirmed gaps (deduped, ranked) — supersede/refine the E1–E10 targets:**
1. **Gifts + heart-events + spouse behavior** (life-sim universal; `romance.js` has only "Interact +/-") — highest impact, cheap. → E3.
2. **Itemization & build agency** — no item affixes/sockets/set bonuses; no player-allocated skill/talent tree (the SkillTree UI is academic-only). → new work, fold into E1/E6.
3. **Combat expressivity** — **i-frame dodge is built (`combat-state.js#grantIFrames`) but the `combat:dodge` handler never calls it** (small wiring fix, big payoff); + anim-cancel/input-buffer, hyperarmor, execution moves, per-skill VFX. → E1/T1.4b/T3.1.
4. **Run-mode depth** — in-run build/draft layer (boons/relics/mutations), item synergy, multiplayer-in-runs, wire `difficulty.js` + meta-currency catalog to runs. → E4.
5. **Grouped instanced PvE** — dungeons/raids w/ scripted mechanics + role matchmaking. → E5.
6. ~~Fiat cash-out~~ — **NOT a gap (audit error, corrected).** Already built: 1:1 USD-pegged Concord Coin,
   Stripe checkout mint + Stripe Connect payout withdraw (`economy/{stripe,coin-service,withdrawals}.js`).
   The audit agent read `withdrawals.js` alone and missed it. → no F7.2 work needed.

**Confirmed where Concordia LEADS (verified in code):** 50-gen perpetual derivative royalties +
cross-activity DTU fungibility + server-enforced consent (ahead of every UGC platform); momentum-poise
stagger (ahead of most AAA combat); RDR2-grade honor/bounty/hunting, BG3-grade environmental combo
chemistry, Skyrim-grade radiant quests — all present. Breadth (sky/nameplates/quest-markers/chat/dailies/
leaderboards/auctions/dye/festivals/farming/fishing/mounts) is real and was under-credited by the earlier
adversarial pass.

---

# Phase F — Implementation backlog (execution-ready, file-anchored)

This is the **canonical execution order** that operationalizes the audit. It supersedes the aspirational
prose of E1–E10 and the remaining T2/T3 items by turning the 6 grep-confirmed gap buckets into concrete,
sequenced tickets, each with the exact existing function/file to REUSE (pinned by a read-only insertion-point
audit). Sequenced by impact ÷ effort. Quick wins first.

**Status legend:** ✅ done · ⏳ remaining. Every "reuse" anchor below is verified to exist in the tree.

## Sprint F1 — Quick wins (tiny diffs, outsized payoff)

| Ticket | Build | Reuse / anchors | Verify |
|---|---|---|---|
| **F1.1 i-frame dodge wiring** ⭐ | The live `combat:dodge` socket handler acks but never grants invuln. Add: on dodge, call `grantIFrames(userId, 350)` (500ms on perfect dodge). | Handler `server/server.js:8548`; `grantIFrames(actorId,durationMs)` `combat-state.js:114`; `applyHitToState` already whiffs hits while `now < iframeUntil` (`combat-state.js:48`); perfect-dodge window via `attemptDodge` `combat-polish.js:325`. ~3-line change. | node test: grant i-frames → `applyHitToState` returns `iframed:true`, zero damage, within window. |
| **F1.2 Gift system** ⭐ | New `server/domains/gifting.js` → `romance.give_gift`: consume item → affinity delta by NPC preference. Author `gift_preferences` into `npcs.json`. Surface in `NPCActionMenu` + courtship lens. | Inventory-consume pattern `craft-engine.js:114`; affinity write `romance-engine.js#courtInteraction:39` (base `COURT_AFFINITY_DELTA=0.05` :19 → gift uses 0.10–0.20 × pref); inventory schema `migrations/050`; prefs loaded by `content-seeder.js`. | test: give preferred item → affinity↑ + item consumed; disliked → affinity↓; missing item → rejected. |
| **F1.3 Typed attack telegraphs** | Upgrade the generic light/heavy windup to *typed* perilous tells (thrust/sweep/grab → forced counter), the one real remaining E0 item. | `combat:telegraph` emit `server.js:8318` → `BodyLanguageOverlay.tsx`; add a `perilKind` to the payload + counter gate. | manual: telegraph shows typed icon; wrong counter fails, right counter negates. |

## Sprint F2 — Build agency & itemization (ARPG/MMO day-1 dopamine)

| Ticket | Build | Reuse / anchors | Verify |
|---|---|---|---|
| **F2.1 Item affixes** | Migration: `player_inventory.affixes_json` (or `item_affixes` table). Loot roll assigns prefix/suffix stat rolls; **damage calc reads them** (must touch both or gear is a no-op — flagged). | Loot `ecosystem/loot-tables.js:13`; `computeDamage(...enchantmentBonus)` `combat/damage-calculator.js:49` (line 59 is the injection point); equip `combat/loadout.js:39`. | test: equip flaming-affix weapon → fire damage component rises in `computeDamage`. |
| **F2.2 Set bonuses** | `getEquipmentSetBonuses(db,userId)` in `loadout.js`: count equipped items sharing `set_id`; ≥2 → apply bonus multiplier in `computeDamage`. | `getLoadout(db,userId)` `loadout.js:39`; reads F2.1 affixes. | test: equip 2 of a set → bonus applied; 1 → not. |
| **F2.3 Player talent tree** | Migrations `player_talent_points` + `player_talent_allocations`. New `server/domains/talents.js` (`get_allocations`, `spend_point`). Earn 1 point per level via the XP hook. New `/lenses/character` talent tab (the existing `education/SkillTree.tsx` is academic-only). | `SKILL_CATALOG` + `getSkillTreeForActor` `skill-tree-engine.js:21/77`; level source `player_skill_levels` (mig 064); earn-hook `xp-hooks.js:20` (flag: locate the live level-up gain site). | test: level-up grants a point; spend → allocation persists + affects skill tree read. |

## Sprint F3 — Combat expressivity (Souls/BDO/DMC feel)

| Ticket | Build | Reuse / anchors |
|---|---|---|
| **F3.1 Hyperarmor** | Heavy attacks ignore incoming stagger during active frames (poise-attacker side). | flag in `combat-impact.js`/`combat-polish.js#triggerStaggerFromImpact`; frame data `combat-frame-data.js`. |
| **F3.2 Execution moves** | Backstab/positional crit (offAxis already computes harder poise break → add crit-damage execution); posture-break deathblow; stun→grab finisher (link `rocked` → `attemptGrapple`). | `combat-impact.js` offAxis; `attemptGrapple` `combat-polish.js:477`; rocked state. |
| **F3.3 Anim-cancel + input buffering** | Cancel windows (≥50% recovery) + 4–6-frame input buffer. | frontend `CombatInputController.tsx`; frame data cancel windows in `combat-frame-data.js`. |
| **F3.4 Per-skill VFX + mastery** | The data-driven `skill-descriptors.ts` overlay (already specced in the Combat-depth section / T3.1) so 67 skills differentiate; mastery from `player_skill_levels`. | T3.1 design (plan lines ~497); `element-vfx.ts`, `combo-vfx.ts`, `CombatVFXBridge.tsx`. |
| **F3.5 T1.4b client feel** | Wire momentum → hitstop/knockback/reflex on the client (impact-resolver + ImpactMomentumBridge). | T1.4b design (plan ~464); server already emits momentum (T1.4a ✅). |

## Sprint F4 — Run-mode depth (replayability)

| Ticket | Build | Reuse / anchors |
|---|---|---|
| **F4.1 Shared in-run draft** | Generalize horde's deterministic pick-1-of-3 into `server/lib/run-draft.js` (+ `run_draft_picks`, `draft_options` tables); wire boon/relic drafts into roguelite + extraction; effects **applied**, not descriptive strings; add synergy combos. | `_rollUpgrades` `horde-mode.js:84` (drop-in generalize); run state `roguelite.js:27`/`extraction.js:35` (add `run_picks_json`). |
| **F4.2 Difficulty + meta wired to runs** | Wire `difficulty.js` tiers (currently world-boss-only) + author a meta-currency→run-modifier catalog so unlocks change runs. | `difficulty.js`; `roguelite_meta_currency` + `purchaseUnlock` `roguelite.js:115`. |
| **F4.3 Multiplayer in runs** (larger) | Co-op / PvPvE session for extraction + horde; the real source of Tarkov/DRG/DbD tension. Scope after F4.1/F4.2. | parties `parties.js`; horror asymmetry `horror.js` as the template. |

## Sprint F5 — Grouped instanced PvE

| Ticket | Build | Reuse / anchors |
|---|---|---|
| **F5.1 Instanced dungeon/raid** | Session-scoped encounter with scripted boss mechanics + role-matched group; the missing WoW/FFXIV "run". | boss phases `combat/boss-phases.js` + boss HUD (✅); parties `parties.js`; LFG `LFGBoardPanel.tsx` (add role fill); lockouts `world-bosses.js`. |

## Sprint F6 — Relationship & life-sim completion

| Ticket | Build | Reuse / anchors |
|---|---|---|
| **F6.1 Heart-events** | Scripted scenes at affinity milestones (the emotional payoff after F1.2 gifts). | quest-engine + dialogue trees; affinity thresholds `romance-engine.js`. |
| **F6.2 Spouse behavior** | Wed → spouse follows/helps + dialogue shift + lives in house. | `romance-engine.js#wed`; `npc-routines.js`; `player-housing.js`; companion roster. |
| **F6.3 Husbandry + collection** | Barn/coop daily-produce loop; museum/collection catalog (ACNH completionist hook). | creatures/`procedural-creature.js`; fishing/creature catalogs. |

## Sprint F7 — Economy depth + governance decision

| Ticket | Build | Reuse / anchors |
|---|---|---|
| **F7.1 Marketplace depth** | Price-history graphs + order-book/depth display (the real marketplace gaps; trending/storefront/dashboard already exist). | `auctions.js` (`recentBids:209`); `marketplace/page.tsx`. |
| **F7.2 Fiat cash-out** | ✅ **ALREADY BUILT — the audit was wrong (corrected after a direct check).** Concord Coin is a **1:1 USD-pegged token** (`economy/coin-service.js`): Stripe checkout mints coins (`economy/stripe.js#createCheckoutSession` + `handleWebhook` `checkout.session.completed` → `mintCoins`); withdrawal burns coins and pays out via **Stripe Connect** (`requestWithdrawal`→`approveWithdrawal`→`processWithdrawal` in `economy/withdrawals.js` + 48h hold; `stripe.js` `transfer.paid`/`transfer.failed` webhooks reconcile/refund). Anti-exploit: `economy/emergent-accounts.js` blocks NPC/system funds from becoming fiat — real user-earned coin cashes out. **NOT a gap.** The earlier UGC audit read `withdrawals.js` in isolation and missed `stripe.js`+`coin-service.js`. | `economy/{stripe,coin-service,withdrawals,emergent-accounts}.js` — already wired. |

## Phase F sequencing + reconciliation with T2/T3/E

Execution order: **F1 → F2 → F3 → F4 → F5 → F6 → F7.** Interleave the still-pending earlier tickets where
they fit: **T2.1 weaponise_at / T2.2 inheritance UI / T2.3 scheme barge-in / T2.4 reconciliation audit** sit
alongside F3–F5 (intrigue legibility); **T3.2 content authoring across the 9 worlds** (faction
`rival_factions` + NPC `narrative_context`/`relationships`) runs continuously since it now pays into the
shipped T1.1/T1.3 engines; **T3.3 zones / T3.4 balance / T0 doc corrections** land with their related sprints.
F3.4/F3.5 are the same work as T3.1/T1.4b — do them once, under F3.

**Pre-flight flags (from the insertion-point audit):** (a) affixes are a no-op unless loot-roll AND
`computeDamage` are touched together; (b) talent-point earning needs the live level-up gain site located;
(c) run-draft on a live DB needs a migration + backfill (horde already persists picks). Each ticket carries
a node-test before it's called done; frontend tickets type-check against the known 31-error baseline.

---

# Phase G — Full-dimension audit & grand strategy

**Purpose.** We measured genres + feel and found Concordia far closer to AAA than assumed. Phase G audits
*every remaining dimension of a game*, so the backlog reflects the WHOLE game. **The dominant finding:
Concordia is consistently MORE complete than its own docs (CLAUDE.md understates what's shipped), and the
real gaps are "built-but-unwired / documented-but-unenforced / untuned," not "missing systems."** That
reframes the grand strategy: the path to AAA is mostly *connection + commitment + tuning*, not construction.

## G-scorecard (grep-verified coverage by dimension)

| Dimension | Coverage | One-line read |
|---|---:|---|
| Emergence / simulation | ~95% | Ahead of the field (faction wars, schemes, 84 cycles) |
| Creator economy | ~90% | Ahead of all UGC + real Stripe fiat rail |
| Juice / feedback | ~88% | Past indie bar |
| Stability / error-isolation | ~85% | Best-in-class (heartbeat isolation, memory watchdog, WAL, shards, backup) |
| Rendering | ~85% | Real GI/PCSS/SSGI/post pipeline, LOD+instancing wired |
| Audio | ~82% | AAA *structure*, fidelity-capped (procedural synth, no recorded assets) |
| Animation (as a system) | ~80% | Novel fully-wired procedural stack; reads slightly uncanny vs mocap |
| Performance | ~80% | Instancing/LOD/culling/adaptive-quality all wired |
| UX / onboarding / FTUE | ~75% | Excellent progressive onboarding; full settings split/unmounted from world |
| Art direction | ~70% | Direction coherent; **asset execution weak** (primitive crowd bodies, one building gen) |
| Narrative / writing quality | ~70% | Authored lore/dialogue AAA-tier but thin in volume; runtime 3B-LLM dialogue + no VA drag it |
| Movement feel | ~66% | Substrate solid; "forgiveness layer" missing |
| Combat feel | ~63% | Offense ~90% (elite) / defense ~25% (built-but-unwired) |
| Netcode | ~50% | Server-auth solid; **no client-side combat prediction** (caps feel) |
| Accessibility | ~40% | Comprehensive UI shell **wired to nothing** (two disconnected stores) |
| Horror-tension feel | ~28% | Below the Lethal-Company bar; primitives exist unwired |
| Progression / build · Balance · Retention · Polish/finish · Social | _pending_ | (final agent running) |

## G1 — Art / animation / rendering (~85/80/70%)

Render pipeline is strong and **wired** (`ConcordiaScene.tsx:441-893`: tone-map/bloom/PCSS/reflection-probes/
SSGI/volumetric-clouds/auto-exposure/motion-blur/LUT); animation is a novel fully-wired procedural stack
(`gait-synthesis.ts`, `fabrik-ik.ts`, `combat-biomechanics.ts`, `ragdoll.ts`, `facial-blend-shapes.ts`,
`lip-sync.ts`, `secondary-physics.ts`); LOD+instancing are *consumed*; UI is a real shared design system.
**CLAUDE.md stale:** ~60 hero GLBs DO ship (`public/meshes/heroes/`). Biggest liability: default/crowd
avatars are box/cylinder primitives + procedural textures + one reskinned building generator — the
"half-committed realism" prototype tell.
- **G1.1 ⭐ Commit a hard cel-shade + ink-outline art direction** uniformly to the primitive crowd (shader/
  material work, ~no asset budget) — turns the #1 liability into a deliberate Sable/BOTW style. *Single biggest visual win.*
- **G1.2** CC0 GLB crowd bodies into archetype slots (loader wired) + CC0 PBR pack into `public/textures/`
  (`pbr-loader.ts` tier-2 auto-picks up) + 2–3 bespoke landmark meshes/world.
- **G1.3** (minor) TAA, true sun disk/skybox.

## G2 — Performance / netcode / stability (~80/50/85%)

Perf + stability are AAA-shaped and wired; **netcode is the weak dimension** and carries the combat-feel cap.
Two real bugs surfaced:
- **G2.1 ⭐ Client-side combat prediction** — combat input→feedback is a full socket round-trip (no local
  swing/hitstop), breaking the ≤16ms feel bar. Fix: predicted swing/hitstop/VFX locally on input in
  `CombatInputController.tsx:288`, reconcile on authoritative `combat:hit`. Client-only; server already
  authoritative on damage. **Highest feel-per-hour in the plan.**
- **G2.2 BUG — `CONCORD_MAX_SHADOWS` unenforced** — documented cap (50000) never read; `STATE.shadowDtus`
  grows unbounded → OOM/scale risk. Fix: LRU-trim on `.set` (mirror `memory-pressure.js:241-261`). Tiny.
- **G2.3 BUG — `MAX_OLD_SPACE_SIZE` default mismatch** (`memory-pressure.js:17` 3584 vs 32768 deploy) →
  premature shedding or dead watchdog. One-line + stale comment.
- **G2.4** (polish) presence broadcast 10Hz→20Hz; cache per-building bounding spheres; occlusion cull.

## G3 — Narrative / UX / accessibility (~70/75/40%)

Authored writing is **genuinely AAA-tier** (Eight Refusals codex, hub lore, 22 authored dialogue files in
`content/dialogues/`, mystery quest arcs) — but thin in *volume*: most of the 16 hub NPCs have no authored
`dialogue` tree, so the majority of clicked conversations fall to **runtime Qwen-3B LLM** (`oracle-brain.js#
writeDialogueTree`) — voice drift + thin fallback prose; secret-omission is correctly enforced (safe ≠ good).
Onboarding is excellent progressive disclosure (`onboarding.json` cook→eat→fight→commune, `OnboardingTutorial`,
`FirstWinWizard`). **Accessibility is the worst-wired dimension found all session:**
- **G3.1 ⭐ BUG — accessibility options apply to NOTHING.** Two disconnected stores: the settings page fires
  `concord:a11y-changed` → `event-router.ts:144` only shows a *toast*; real consumers read a Zustand store the
  page never writes. Colorblind / text-scale / high-contrast have **zero DOM application**; reduced-motion
  never reaches the 3D world. Fix: bridge the stores (~1 file) + apply 3 visual settings to DOM (~30 lines in
  `Providers`) + gate GameJuice/weather/particles on `effectiveReducedMotion`. *Correctness bug masquerading
  as a feature.*
- **G3.2** Settings/AccessibilityPanel (7 tabs, real depth) **not mounted in the world lens** (a different
  `HUDSettingsPanel` is) — violates the "world lens is canonical" invariant. Mount the full panel.
- **G3.3** Author dialogue trees for the remaining hub NPCs (data, not code — reuse the `content/dialogues/`
  pattern) + demote LLM to a labeled "improvised" fallback. Lifts narrative volume + consistency.
- **G3.4** Subtitle renderer (consume `subtitleFontSize` + existing `speaker` field, TLOU2-style labels);
  gamepad remap + write keybinds through to `CombatInputController`. No authored VA (accept browser TTS or
  out-of-scope).

## G4 — Progression / balance / retention / polish / social (~65/30/55/60/50%)

The dimension that quantifies the thesis. Findings:
- **Progression ~65%** — skill XP is real (`player_skill_levels`, `skill-progression.js`) but the curve is
  *logarithmic* (`1 + log10(1+exp/10)`) — it flattens with investment, the opposite of power-fantasy pacing;
  talent allocation is missing (tree is display-only); itemization (affixes/sets) absent.
- **Balance ~30%** — ~25 first-draft dials; mahjong yaku outliers logged-not-shipped; **restaurant sim is
  degenerate** (`expiredRatio:0` in all 27 cells → the time-pressure axis is untested) + its recommendation
  unadopted. Infrastructure exists; findings aren't shipped.
- **Retention ~55%** — D1/D7 loops strong (daily/weekly quests wired to `DailyRituals`, seasons, festivals,
  world-boss lockouts) but **no D30 endgame loop** (no paragon/prestige/NG+/escalating ladder). The royalty
  economy is the de-facto long-term hook but isn't framed as endgame.
- **Polish/finish ~60%** — AAA-shape QA discipline (870+ server test files, never-throw heartbeats, lint-zero
  CI) but a real built-but-unwired backlog: **`attemptParry` + `attemptDodge` have ZERO non-test callers**
  (dodge/block socket handlers only echo `:ack`); **`awardOrgXp` has ZERO non-test callers — guild leveling
  literally cannot gain a point**; `weapon-trail.ts` consumed by nothing.
- **Social ~50%** — parties/guilds(roles/alliances/treasury)/LFG-with-roles/chat/voice/auctions all real and
  wired; guild *progression* dead (above); no auto-matchmaking (which research says is actually better for
  social bonds).

## ⭐ The grand strategy — quantified thesis + four-sprint campaign

**Quantified across every dimension: ~80% of the distance to AAA is "disconnected or untuned," not
"missing."** Of the verified gap: **~55% disconnected** (wiring — both ends built, the connection never
made), **~25% untuned** (values not pinned), **~20% genuinely missing** (needs design+build). Overall
"finish %" vs the AAA bar ≈ **58%**, but the *system bank* behind it is far deeper than 58% — the deficit is
overwhelmingly the last connection, not absent capability. The proof is a guild-leveling system with a
migrated table, a tuned quadratic curve, and level-up logic that **cannot earn a single XP** because nothing
calls the hook.

This reframes everything into **four sprints, ordered by perceived-quality-per-hour:**

### Sprint 1 — CONNECTION (the ~55%; days, not months; highest ROI in the whole plan)
Wire the built-but-unwired. Each is a handful of lines connecting two existing ends:
- **Combat-polish reactions** — `server.js:8548/8588` dodge/block handlers call `attemptDodge`/`attemptParry`
  (+ riposte/i-frame/perfect-dodge slow-mo) instead of bare `:ack`. *Lights up the entire defensive feel loop
  (combat feel 25%→~80%).* (= F1.1 / F3 / G2.1 converge here.)
- **Client-side combat prediction** (G2.1) — predicted swing/hitstop/VFX locally in `CombatInputController`,
  reconcile on `combat:hit`. Closes the ≤16ms feel gap.
- **Accessibility store bridge** (G3.1) — `event-router.ts:144` writes the store + apply 3 visual settings to
  DOM + gate world juice on reduced-motion. Turns a whole dead panel live.
- **Guild XP** (G4) — call `awardOrgXp` from treasury/recruit/boss-kill. Revives the guild progression layer.
- **Weapon trails** (G1/feel) — mount `weapon-trail.ts`. **Camera-punch** — add the listener in
  `ConcordiaScene` (event already dispatched). **SFX pitch variation** (feel ~1h).
- **2 real bugs** — `CONCORD_MAX_SHADOWS` LRU-trim (G2.2, scale/OOM), heap-default fix (G2.3).

### Sprint 2 — COMMITMENT (the single biggest *visible* win; ~shader work, no asset budget)
- **G1.1 hard cel-shade + ink-outline art direction**, applied uniformly incl. the primitive crowd — converts
  the #1 prototype tell into a deliberate Sable/BOTW style. Plus the cheap asset drops (CC0 GLB crowd bodies,
  one PBR pack, 2–3 landmark meshes/world).

### Sprint 3 — TUNING (the ~25%; pin the numbers)
- Adopt the logged balance recommendations (restaurant tip cell, mahjong yaku re-weight); **fix the degenerate
  restaurant sim** (TTL/pressure path is dead) then re-run; playtest-pin the ~25 first-draft dials (T3.4).
- Re-shape the XP curve from logarithmic toward a power-fantasy ramp.

### Sprint 4 — CONSTRUCTION (the genuine ~20% missing; real design+build)
- **Player talent allocation** (F2.3) · **itemization: affixes + sets** (F2.1/F2.2) · **a D30 endgame loop**
  (escalating ladder above world bosses; frame royalties as endgame) · **gifts/heart-events/spouse** (F6) ·
  **run-mode in-run build variety** (F4) · **horror-tension wiring** (route ghost through HRTF + tension stem
  + terror-radius heartbeat — mostly Sprint-1-style wiring of existing primitives) · authored dialogue trees
  for the remaining NPCs (G3.3, data not code).

### Reconciliation with Phase F
Phase F's tickets slot into these sprints: F1/F3 combat → Sprint 1; F2 itemization/talents → Sprint 4; F4
run-depth → Sprint 4; F6 relationships → Sprint 4; F7.1 marketplace polish → Sprint 3/4. Phase G *adds*: the
connection-sprint wiring set, the art-direction commitment, accessibility wiring, the two scale bugs, client
prediction, the XP-curve reshape, and the D30 endgame as a named design gap. **Execution order is the four
sprints above** — Connection first (it's where 55% of the gap dies cheapest and is the biggest felt jump).

### The honest headline
Concordia is **~58% "finished" against AAA but holds a far deeper system bank than that implies** — measured
across ~20 dimensions it leads on emergence/economy, is competitive on rendering/animation/juice/audio/
stability, and its real deficits are concentrated in *connection + commitment + tuning*. The grand strategy
is therefore not "build the missing 40% of a game" — it's **"connect and commit what's already built, tune
the numbers, then construct a focused ~20%"** (talents, itemization, endgame, relationships). That is a
months-scale finishing campaign for one developer, not a multi-year build.
