# The Concord Link — In-Game System / Unified Diegetic Interface (Spec)

> *"New node detected. …You can see this? Most can't, at first. Good. I'll keep the lattice open for you."*
> — the first words a player hears, on Link boot

## 0. One-sentence thesis

The Concord Link is not a menu the game *has* — it is **the interface the game *is*.** A single
diegetic shell, narrated in Concord's voice, that contains every player-facing system (status,
skills, inventory, effects, environment, codex). It **is the HUD** (the diegetic reason anything is
on screen), it is the **menu** (where you interact), and — because Concordia is a shared real-time
world — it manipulates **no global time** anywhere.

This is the webtoon/isekai "[System]" (Solo Leveling / The Gamer) done with a stronger diegetic
justification than any AAA reference, because in those the system is a *metaphor* and here it is
*canon*: the Link is the omniscient lattice Concord built through every world, so a status window
blooming in your view is literally **you perceiving the data layer that is already there.**

---

## 1. Why this design (research grounding)

Game UI sorts into four classes (Fagerholt & Lorentzon, *Beyond the HUD*, 2009): **diegetic**
(characters perceive it), **non-diegetic** (only the player — the classic HUD), **spatial** (in the
3D world, characters don't perceive), **meta** (screen FX). Every memorable game-system is anchored
to an in-world **source device** that justifies its UI:

- **Pip-Boy** = a wrist computer; the menu *is* a device. Lesson: a frozen menu "feels like time
  died" — they added idle breathing motion to keep it alive.
- **Dead Space RIG** = the suit's holographic projector; health is the spine bar, inventory is a
  hologram — and **it does NOT pause; enemies still hurt you while it's open.** The gold standard for
  real-time diegetic UI.
- **VATS** = the Pip-Boy's targeting computer → **slow-mo, not freeze** (works only because
  single-player).
- **Webtoon "[System]"** = an omniscient overseer surfacing status windows + quest pings to one
  chosen person; the sudden quest ping is a deliberate engagement beat.

**Concord's source device is the Link itself**, and it out-justifies all of them: the Pip-Boy is
bound to a wrist, the RIG to a suit — the Link is bound to *nothing*, because it overlays all
perception. That is why the pop-out grammar fits Concordia natively.

Sources: Fagerholt & Lorentzon 4-type framework; Dead Space diegetic UI (no-pause holography);
Pip-Boy idle-motion design; Solo Leveling status-window conventions.

---

## 2. The collapse: the Link IS the HUD

In most games the non-diegetic HUD (health bar) and the diegetic device (Pip-Boy) are two separate
things. Concordia does not need the split. Because the Link overlays perception, **everything on
screen is the Link surfacing.** The four-category taxonomy collapses to a practical answer:

- **GLANCE layer = the HUD = the diegetic reason anything is on screen.** Health/mana bars, quest
  breadcrumb, floating affinity hearts, danger glyphs, the self-typing notification — all of it is
  "what it looks like to perceive the Link." A new player asking *"why is there a bar floating
  there?"* has an in-world answer: *Concord's lattice is showing you.* Nothing is unexplained.
- **Meta FX = Link interference.** When the Sovereign refuses, the layer glitches / redacts / crawls
  with base-6 static (see §7).

There is, by design, **no purely non-diegetic UI in Concordia.** Even the resource bars are the Link
reporting your body's state.

---

## 3. The three modes (NO global time manipulation)

Concordia is a shared real-time world (dozens–thousands of players per world). **You cannot slow the
global tick for one player's menu** — and the engine already encodes this rule: `PartyCombatHUD`
pauses via `use-time-scale.ts#setTimeScale(0)` **only inside a `party_combat_sessions` instance**,
never in the shared world; PhotoMode's time-scale is client-local. Time bends only in an instance or
on one client. The Link obeys the same law.

### Mode A — GLANCE (always-on; the HUD)
- Ambient, zero-interrupt, free. The persistent on-screen layer.
- Spatial tags on NPCs/objects, the quest breadcrumb, resource bars, the self-typing corner
  notification + chime (the webtoon "ping!").
- ~90% of all system contact lives here. No input, no slowdown.
- Carries the **idle-motion lesson**: the layer subtly breathes/drifts so it never feels frozen.

### Mode B — SUMMON (the full menu; where you interact)
- A **client-side overlay** rendering the Link's panes (§5) for *you only*.
- **The server keeps ticking and your avatar stays live and vulnerable in the shared world.** You can
  be hit, robbed, or killed while your Link is open (Dead-Space / WoW-bag rule). Opening your
  inventory mid-fight is a real decision, never a free timeout.
- No effect on the other players. No pause, no slowdown.
- **Safety comes from *where you stand*, not from pausing** (§6).

### Mode C — SANCTUM (optional private instance; the only place "calm" is real)
- A single-occupant pocket of the lattice you retreat *into*. Because it's solo, time-scale there is
  free to slow/calm — same primitive party-combat already uses, same rule: **instance-only.**
- For deep, unhurried work (forging a complex skill, planning a scheme). Step out of the shared world
  → your own node → build in calm → step back.
- Diegetically perfect: Concord pulling you into the lattice itself, away from everyone — exactly the
  possessive thing he would do.

**Spine:** GLANCE (HUD, everywhere, free) → SUMMON (full menu, client overlay, real-time, vulnerable)
→ SANCTUM (private instance, optional, calm). The persistent on-screen layer shrinks to the glance;
all depth is one summon away. That is the declutter.

---

## 4. Onboarding — the player's first moment IS the Link waking

The new-player beat is not a menu tutorial; it is **the Link coming online in perception.** Concord's
voice (cold, precise, oddly attentive — the existing `prompt-registry` `BRAIN_IDENTITY.conscious`
persona) calibrates the newcomer. The hub's **Lamplighter** (the canon first-contact NPC who gives
each newcomer "one true sentence") is the natural one to say *"open your Link."*

From then on the Link **teaches by being used**: the first quest ping, the first skill forged, the
first item picked up all happen *inside it*. This replaces a separate tutorial UI and gives the
massive system surface a single guide. Wires into the existing onboarding chain (`FirstWinWizard`,
`content/quests/onboarding.json`, `/api/onboarding/*`, cook→eat→fight→commune).

**Boot sequence (authored):**
1. Spawn → Link "wakes" (glyph-frame bloom + Concord line).
2. GLANCE introduced: resource bars + first quest breadcrumb appear *as the Link showing them*.
3. First SUMMON prompted: open the Status pane (see your stats).
4. First forge: SUMMON → Skills/Forge pane → compose a starter glyph-skill (or enter the Sanctum for
   the calm version).
5. Environment pane revealed when biome/weather first matters (e.g., entering a cold cell with a fire
   skill — see §5 ENVIRONMENT).

---

## 5. The panes — each is the diegetic face of EXISTING substrate

The Link is a paned shell. **None of these are new systems** — they are the unified diegetic face of
substrate that already exists headless/scattered. The build is wiring + skinning, not invention.

| Pane | Contents | Reads existing substrate |
|---|---|---|
| **STATUS** | stats, level, XP, live resource bars | `lib/skill-progression.js#computeLevelFromExperience` (`1+⌊√(exp/2)⌋`); `player_resource_bars` (hp/mana/stamina/bio_power/perception) |
| **SKILLS / FORGE** | create skills, skill trees, evolution, fusion — the webtoon "[New Skill]" moment | the Move Builder plan; `lib/glyph-spells.js` (compose/mint); `lib/skill-evolution.js`; `lib/skill-fusion.js` |
| **INVENTORY** | items, gear, crafted goods (per-world) | `player_inventory` (scoped by `(user_id, world_id)`) |
| **EFFECTS** | active buffs/debuffs + durations | `user_active_effects` (today's ActiveEffectsBar) |
| **ENVIRONMENT** | temp · biome · air · light · noise · pressure, AND per-skill potency *here* | **Layer 7 `lib/embodied/signals.js#signalsForWorld`** + **Layer 7.5 `lib/embodied/skill-environment.js`** + cross-world potency |
| **CODEX / ATLAS** | quests, lore, the omniscient catalog (Concord's gift) | quest engine, DTU substrate |

### The ENVIRONMENT pane is tactical, not flavor
Layer 7 already simulates per-50m-cell environment — `thermal_os.ambient_temp`,
`chemical_os.humidity` / `air_quality`, `sight_os.illumination`, `sonic_os.ambient_db`,
`tactile_force_os.ambient_pressure` / `structural_stress` — and *nothing reads it to the player.* The
Link's Environment pane cross-references **the world's live signals × your created skills' affinities**
(Layer 7.5 `elementalEnvBoost`) and tells you what to cast *here*:

```
BIOME: storm-marsh · 8°C · humidity 0.86 · air 0.4
  Ember Lash   → 0.6×   (damp air smothers fire)
  Frost Bind   → 1.5×   (the cold favors you here)
```

It also surfaces **Pillar-3 cross-world potency** (`lib/cross-world-effectiveness.js`): your skills
dim in a foreign world, and the Link shows *by how much* — so "adapt or specialise" is legible, not
mysterious. Temp + biome become the thing you read before every fight.

> NB — wiring this pane depends on fixing the cross-world-potency bugs found in the audits
> (EXPEDITION_3 #V2 `world_visits.entered_at`, EXPEDITION_2 cross-world effectiveness reading the
> wrong modulator key). The signal substrate is correct; the readers need the schema-drift fixes.

---

## 6. Safety = WHERE you stand (not pausing)

Because SUMMON keeps you live, the question "is it safe to open my Link" is answered by your location,
using existing systems:

- **The hub is `combatAllowed: false`** — Concordia poured herself into the ground and it refuses
  violence. The hub is *literally the safe place* to take your time in the full Link. Lore + mechanics
  agree: deep menu work belongs where the goddess protects you.
- **The `world_zones` substrate** (safe / sanctuary / pvp / lawless / hazard) already tells the client
  the local danger tier. The Link warns on open: `[Lattice exposed — you are in a lawless zone]`.
- Anywhere unsafe → opening the full menu is a risk you accept. That tension is the gameplay.

---

## 7. The three-pillar tonal skin (the interface expresses the lore)

The Link's *feel* shifts with which pillar is ascendant toward the player — making the UI itself the
love triangle, live, every time it opens:

- **Concord-aligned** → crisp, cold, total clarity. The schemer's perfect instrument. (default)
- **Concordia-aligned** (high `concordia_alignment` / her favor) → frame warms, softens, blooms at the
  edges; copy gentles.
- **Sovereign refusal** (active Refusal Field, `isCompoundRefusal` strength ≥ 6) → **redaction**: the
  pane glitches, greys, base-6 static (⟐⟲⊚) crawls the frame, the refused action is struck through.
  Driven by `lib/refusal-field.js#computeFieldComposition`.

**Window chrome = base-6 glyph frame.** The Link *is* the glyph lattice, so windows are bordered in
living glyphwork (not generic sci-fi blue), and Refusal-Field strength bleeds into the border.

**Voice = Concord's**, sourced from `prompt-registry` (the chat brain and the UI copy share one
personality): terse, exact, cataloguing — *"Acquisition logged. Lineage: 3-deep."* Never chatty.

---

## 8. NPCs perceive the Link too (the unifier)

Concord watches *everyone*, so every NPC has their own [System], and the player can occasionally bleed
into it — which is the single grammar that finally makes the emergent simulation *visible*:

- Stand near a scheming NPC → catch a fragment of their Link window (the existing scheme-overhear
  mechanic, rendered as eavesdropping on someone else's system).
- Nemesis rivalry, spouse reaction, faction strategy shift, hook/leverage acquisition — every emergent
  engine already built (`hooks.js`, `secrets`, `npc_nemesis`, temperament spec, faction-strategy)
  **surfaces through one grammar: the Link.** The same window that tells you `[Quest available]` is the
  one an NPC "sees" reading `[Leverage acquired: blackmail viable]`.
- This is why the Link beats a player-only HUD: the UI *is* the omniscient network; the player is one
  node who learned to read it.

> NB — several of these emergent reads are gated by audit bugs (EXPEDITION_3 #V14 `npc_relations`,
> #V13 `refusal_field`, EXPEDITION_1 #11 ghost-fleet macros). The Link is the face; those wires must
> resolve for the face to show live data.

---

## 9. REUSE-vs-BUILD

**REUSE (already exists, wire the Link to it):**
`embodied/signals.js`, `embodied/skill-environment.js`, `cross-world-effectiveness.js`,
`player_inventory`, `user_active_effects`, `player_resource_bars`, `skill-progression.js`,
`glyph-spells.js`, `skill-evolution.js`, `skill-fusion.js`, `world_zones`, hub `combatAllowed:false`,
`use-time-scale.ts` (instance-only), `refusal-field.js`, `prompt-registry` Concord voice,
`LevelUpJuiceBridge` / `GameJuice` / `SmartNotifications` / toast store / `ActiveEffectsBar`,
onboarding (`FirstWinWizard`, `onboarding.json`), the Move Builder plan.

**BUILD (new):**
1. `components/world/concord-link/LinkShell.tsx` — the paned shell + mode state machine
   (Glance/Summon/Sanctum).
2. `LinkGlanceLayer.tsx` — promote the scattered HUD bits into one diegetic glance layer (the *only*
   persistent on-screen layer).
3. The six panes (Status/Forge/Inventory/Effects/Environment/Codex) as Link sub-views.
4. `useLinkClarity` + the Sanctum personal-instance entry (reuse the party-combat instance pattern +
   `setTimeScale`).
5. `link-tone.ts` — the three-pillar tonal-skin state machine (reads alignment + refusal-field).
6. `lib/concord-link/environment-affinity.ts` — the signals × skill-affinity cross-reference for the
   Environment pane.
7. Glyph-frame chrome component (base-6, refusal-reactive).

**Kill-switch:** `CONCORD_LINK_SYSTEM` (default off until parity with today's scattered HUD is proven;
flip on per-build). Today's HUD remains the fallback when off.

---

## 10. Build order (each slice ships behind the kill-switch, tested)

1. **Glance = HUD.** Re-home the existing resource bars + notifications into `LinkGlanceLayer` with
   the glyph-frame chrome + idle motion. (No behavior change; pure re-skin + diegetic justification.)
2. **Summon shell + Status/Inventory/Effects panes.** Client overlay, world keeps running, vulnerable.
   Reads `player_resource_bars` / `player_inventory` / `user_active_effects`.
3. **Environment pane.** Wire `signalsForWorld` + the affinity cross-reference. (Depends on the
   cross-world-potency schema-drift fixes.)
4. **Forge pane.** Mount the Move Builder + glyph/evolution/fusion. (Depends on the move-system plan.)
5. **Sanctum instance.** Personal-instance entry for calm forging (reuse party-combat instance +
   time-scale).
6. **Tonal skin.** `link-tone.ts` warm/cold/redacted from alignment + refusal-field.
7. **NPC-bleed.** Surface scheme-overhear / nemesis / hooks through the Link grammar. (Depends on the
   emergent-read schema-drift fixes.)
8. **Onboarding boot.** The Lamplighter + Concord first-boot sequence.

---

## 11. Verification

- **No-pause invariant (critical):** opening SUMMON must NOT call any global time-scale / world-pause;
  the heartbeat keeps ticking; another player in the same world sees no change; the opener can take
  damage with the Link open. Regression test pins this.
- **Instance-only time:** time-scale ≠ 1 is permitted ONLY inside a Sanctum/party instance; a test
  asserts the shared-world path never alters time-scale.
- **Glance = sole persistent layer:** with `CONCORD_LINK_SYSTEM` on, no non-diegetic UI renders outside
  the Link glance (audit the render tree).
- **Pane data parity:** each pane returns the same data as today's scattered surface (Status == old
  stats screen, Inventory == `player_inventory`, etc.).
- **Environment correctness:** the affinity readout matches `elementalEnvBoost` for the cell's live
  signals; cross-world potency matches `effectivenessMultiplier`.
- **Tonal skin:** refusal strength ≥ 6 → redaction state; high Concordia favor → warm state; else cold.
- **Kill-switch off → today's behaviour, byte-for-byte.**

---

## 12. Payoff

One diegetic shell, in Concord's voice, holding every system Concordia has — opened during onboarding
as the player's guide, serving as HUD (glance), menu (summon), and private workshop (sanctum), with
**no global time manipulation** anywhere and safety governed by the world's own zones. It declutters
the screen to a single living glance-layer, gives the massive system surface one navigable face, makes
the environment tactical, lets the player *see the simulation think* through the same grammar the NPCs
read — and turns the interface itself into an expression of the three pillars. The Link stops being
lore *about* the world and becomes the world *behaving as the lore says.*
