# Design North-Star — the feel Concordia is reaching for

Four framing lessons (Bethesda, High-on-Life, ARK, proper MMO stealth) plus the recurring
**multiplayer tax** that ties them together. Each is mostly *affirmation* — Concordia already
has the substrate — sharpened into **acceptance bars + invariants** on Tracks B/E/F. The
strategy/taste stays the human's; the engineering + instrumentation make the feel a written
target the gates hold themselves to.

**The recurring meta-point:** every source game got its feel "for free" because it's
single-player. Concordia is **real-time multiplayer + a real economy**, which strips away the
crutches (the pause button, the license to be janky, free local netcode, imperfect-AI-only
stealth). The cost of every lesson below is the same: **server-authority + client prediction +
reconciliation** — the same desync axis **Track E1** now measures
(`concord_combat_*_rejected` + `ConcordDesyncSpike`). Get prediction right and it feels local;
the E1 counters tell you when reconciliation is drifting.

---

## 1. The Bethesda feel — curiosity, go-anywhere, emergent world, minimal-HUD/deep-menus

**What it is.** (1) Core fantasy "go anywhere, be anyone" — the world is a place you inhabit,
not a level you clear ("see that mountain, you can climb it"). (2) The **compass discovery
loop** — undiscovered markers → "I'll just check that one icon" → three hours; discovery →
acquisition → progression at your pace, no FOMO. (3) **Minimal HUD, deep menus** — health/
stamina fade in only on change; the depth lives in menus you *pause into* (the Pip-Boy rhythm).
(4) **Systemic emergence (Radiant AI)** — NPCs have schedules + wants; simple systems combine
into "I have a story." (5) Lived-in world + ownership. (6) Jank-as-charm (single-player pass).

**Two crutches Concordia DOESN'T get — and already answers:**
- **No pause.** Bethesda's stop-time→live-in-menu→unpause is impossible in a shared world.
  → **Concord Link's Glance → Summon → Sanctum** (Track B2) is the substitute: depth-on-demand
  without freezing the world. **B2 acceptance bar:** Glance shows almost nothing (resource bars
  fade in on change + crosshair); depth lives in the Summon/Sanctum panels.
- **No license to be janky.** MP + real economy → jank = exploits/desync/lost money.
  → **The L0–L5 gates + Track C/E verification** buy the freedom-feel without the jank-tax.

**Two hard-won Radiant-AI lessons → two invariants:**
- **Invariant 1 — safeguard the emergence.** Radiant AI NPCs committed impulsive crimes + broke
  quests until safeguards were added. **Track B1 Temperament P4–P7** (proportionality ceiling,
  surrender/arrest states, assistance-gate + depth-caps, the two CI gates) **IS** that guardrail
  on the scheme/secret/hook/nemesis sim so emergence can't grief the player or soft-lock a quest.
- **Invariant 2 — keep emergence invisible.** "Every Radiant-AI improvement makes it less
  noticeable." The emergent sim must surface as **world-flavor** (NPC dialogue, ambient activity
  tags, overheard scheme bids, faction-war banners), **not a debug/telemetry feed**. The
  `EmergentEventFeed` / cold-watcher / liveness dashboards are **operator surfaces, not player
  UI** — keep them separate. New player-facing emergent surfaces get the "reads as life or as a
  system readout?" check; prefer the former.

**Concordia's edge:** the emergent NPC sim (schemes, secrets, hooks, nemesis, dreams,
forward-sim, temperament, faction strategy) is **Radiant AI dialed past 11** — deeper autonomous
NPC life than Bethesda ever shipped. That's the superpower, *if* the two invariants hold.

**Compass discovery loop = the retention hook (Track F2):** Concordia's equivalents already
exist — lore mysteries (the impossible-print, the Voss question), quest markers, lattice-born
quests, the self-moving sim's new events. F2's "reason to return" surface leans into them as
undiscovered markers that keep generating breadcrumbs; F1's cold-watcher measures whether the
discovery→acquisition→progression loop actually pulls, not just DAU.

---

## 2. High-on-Life — movement fluidity

**What makes it fluid.** (1) The verbs **chain** — slide→jump→jetpack-boost→grapple→land-into-
slide, nothing resets you to zero. (2) **Momentum preservation** — speed carries between actions
(the opposite — every action snapping to walk-speed — is what feels janky; momentum is sacred).
(3) Tight, low-latency, zero-floatiness controls (input delay + mushy accel is the #1 feel
killer). (4) **Squanch fusion: gun = traversal = combat, ONE verb set** — no mode-switch between
moving and fighting. (5) **Invisible forgiveness** — coyote time, generous air control, grapple
snap-to-anchor (catches the nearby point; feel, not precision). (6) Camera/FOV juice (FOV widens
with speed, slide tilt, motion lines — half the speed sensation is a visual trick). (7) Levels
built to be flowed-through.

**Where Concordia stands.** Already has the verbs: `lib/concordia/traversal-kinematics.ts`
(dash/i-frames/momentum/slide), `flight-physics.ts`, the move-system (flight/super-speed/
ice-slide/web-swing/blink/wall-run), and **the kinematics layer already tracks momentum** — so
"don't reset to walk-speed across transitions" is a **tuning job, not a rebuild**. The Squanch
fusion is **native** (the move-system composes one verb set into movement AND combat —
fire⊕flight = fire-flight — deeper than HoL bolted on). The juice layer (`GameJuice` +
`concordia:flight-state`) exists to wire speed-FOV/tilt to.

**To add:** the forgiveness layer (coyote time, air control, web-swing snap-to-anchor) — cheap,
huge feel payoff.

**The catch that's Concordia's alone:** HoL's fluidity was free (single-player, zero netcode).
MP demands **client-side prediction + server reconciliation** (avatar moves instantly client-
side, quietly reconciles to the authoritative server). Get it wrong and the *same* movement code
feels laggy/rubber-bandy — and it's the **same desync axis E1 measures**. Build the prediction
layer as part of the world-lens/Concord-Link arc (Track B); treat a desync-spike as the signal
it regressed.

---

## 3. ARK — the mount isn't a vehicle, it's a relationship you earned

**The pillars.** (1) **Taming = earned, with stakes** ("your dinos are your life") — attachment
comes from the earning, not the purchase. (2) **Imprinting — the killer feature** — raise a baby
with care sessions → +stats, and bonus when the imprinter rides it; the creature remembers who
raised it. (3) **Saddles = crafted gear progression** (quality tiers, blueprints, platform
saddles = a mobile base). (4) **Role diversity** (Damage/Farmer/Supporter/Utility). (5) **The
Mantis trick** — role changes by what it holds (pick = harvester, sword = combat).

**Where Concordia stands — and can do it BETTER (generative, not hand-authored).** The bones
exist: `bond_event`/`bond_state` + mount-care; `creature-crossbreeding` + bloodlines + the
inheritance/dynasty substrate; `mount_gear`/saddles + the crafting engine (`resolveCraft` +
resource properties → generative blueprint tiers); the species taxonomy + adaptation engine
(roles **emerge** from adaptation + breeding, not a fixed roster); cross-world potency (a mount
fit-to-context, great in its biome, weak elsewhere — better than ARK's "bigger = better"
treadmill); the move-system (the Mantis trick — a mount carrying a move loadout = harvester vs
combat). **Imprinting done better:** a bred+raised+imprinted creature that carries your lineage
and fights better for **you specifically** is a creatable, tradeable, **royalty-bearing DTU
asset** — ties the retention hook to the creator economy. ARK never had that.

**The universal principle (the real lesson):** *deep, earned, persistent relationships with game
entities are the strongest retention hook there is.* Imprinting is one instance; Concordia
already runs others — courtship→spouse→`spouse-reactivity`, the `npc_nemesis` graph, NPC schemes/
hooks. The **compounding-attachment engine** is "earned persistent relationships across mounts +
NPCs + creatures + lineage assets at once." Concordia is the rare thing built to run all of them.

**Two ARK things NOT to copy — both already guarded in this plan:**
- The tame/breed **grind** → use the **fidelity dial** (delegate/sim vs. play) so it's a journey,
  not tranq-and-wait tedium.
- **Loss as a griefing surface** (ARK mounts die/get stolen → attachment via possible loss, but
  in a MP real-economy that's a griefing/exploit vector — see `USERBUG_TAXONOMY.md`) → **gate
  it:** no mount loss in the no-violence hub; Temperament/Refusal restraints in safe zones
  (Track B1 P4–P7 + `world-zones` sanctuary). Stakes with guardrails — the same safeguard + E2
  economy-anomaly spine.

---

## 4. Proper MMO stealth = information control, not invisibility

**Why single-player stealth is deep.** Light/shadow as a **gradient** (Thief's light gem →
MGSV/Dishonored/Last-of-Us detection meter from light + distance + movement); **sound** (noise =
movement speed × surface, observers listen); line-of-sight + cover; **alert states as a
gradient** (unaware → suspicious/searching → alerted/hunting → lost/return — the "searching"
phase is where the tension lives). It works *only because the AI's knowledge is restricted.*

**Why MMO stealth collapses.** The moment the observer is human, MMOs throw away imperfect
information and fall back to "invisible + a detection stat" → either **oppressive** (free ganks,
rogue overpopulation) or **useless** (a see-invis counter-stat arms race). It degrades to binary,
losing every gradient. The immersion-break: "a ninja turns invisible in front of you and walks
behind you."

**The design thesis — information control, not invisibility.** You don't vanish; you control
what others can *perceive* about you, and every observer (human or NPC) gets a **gradient of
partial information + the agency to investigate.** The pillars:
1. **Gradient detection from real factors, not a stat** — light, noise (speed × surface),
   distance, line-of-sight, observer facing/attention — a perception check *per observer* from
   the actual situation.
2. **Partial-information reveal, not binary** — the server sends graded signals: far + cover =
   nothing; closer = a footstep cue; closer still = a silhouette/shimmer; in light or moving fast
   = revealed. Footprints + last-known-position give the target something to chase. Asymmetric-
   info done *right*.
3. **Social stealth — the MMO-native superpower** — blend into a crowd, disguise, impersonate a
   faction (AC/Hitman). Stealth that's *better* in an MMO, not worse.
4. **Meaningful cost + commitment** — slow, resource-draining (a stealth gauge), punishing if
   caught. High-risk/high-reward, not a spammable escape.
5. **Counterplay for the observer** — tells (a guard "looks twice"), search/investigate,
   perception skills, reveal tools. A real-time **duel of attention**, both sides playing.

**Why Concordia is freakishly well-positioned.** The reason nobody builds proper MMO stealth is
the foundation — **per-cell simulation of light and sound** — is expensive and almost no MMO has
it. Concordia does:
- **Embodied signals (Layer 7)** simulate `sight_os.illumination` (light) + `sonic_os.ambient_db`
  (sound) **per 50m cell** — the Thief light-gem + the noise gradient, natively. The hard part,
  already running.
- **`stealth-perception.js`** — a real stealth-perception system (a backstab gate on perception
  vs stealth). **Step-zero fix SHIPPED:** it was querying the wrong table and returning skill 0
  for everyone; now reads the authoritative `player_skill_levels` (`tests/stealth-perception.js`).
- **Footprints + tracking** (`FootprintLayer`, `tracking_skill_xp`, skill-gated) = the
  partial-info / last-known-position layer.
- **Temperament's escalation ladder** (NEUTRAL → WARY → WARNING → HOSTILE) = the alert-state
  gradient (unaware→suspicious→alerted).
- **The detective lens** = the observer's investigation/deduction agency.
- **Wardrobe/appearance + factions + NPC crowds** = the social-blending/disguise substrate.
- **`world-crime.js`** (heist, lockpick, trespass) = the stealth-action context.

**The honest hard parts.** (a) **Netcode/anti-cheat is the crux** — for PvP stealth the server
must decide *per-observer* what to reveal and **not send full position to clients who shouldn't
see it** (or wallhacks defeat it). Same server-authority + prediction problem as movement (§2);
PvE-vs-NPC is the easier first target (the AI's imperfect info is real). (b) **Balance** —
cost/commitment tuned so stealth isn't a gank-fest or useless (stealth-ganking is a griefing
vector — `USERBUG_TAXONOMY.md`). (c) Step zero was the broken skill lookup — DONE.

**One-liner:** server-authoritative gradient perception (light/sound/distance/facing) +
partial-information reveal (tells, footprints, last-known-position) + social blending +
real cost + observer counterplay (the detective layer) — a duel of attention, not
invisible-vs-see-invis. Concordia is the rare engine that can run it, because the per-cell
light/sound sim — the thing that makes stealth real — is already simulating.

---

## 5. The synthesis

The architecture that makes Concordia *unique* (one substrate; tool + world fused; emergent
self-generating sim; per-cell light/sound; self-improving/self-healing systems) is the same
architecture that lets it **out-do the source games** on feel — *provided* the multiplayer tax
is paid (server-authority + prediction, measured by E1) and the two emergence invariants hold
(safeguard it; keep it invisible). The strategy and taste are the human's; the engineering and
the instrumentation make the feel a target the gates enforce.
