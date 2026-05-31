# Concord — Lore Bible (Canon)

**Status:** Canonical. This file is the single source of truth for Concord's
cosmology, the three gods, the cross-world spine, and the per-world themes.
When authored content (`content/world/**`, `content/quests/**`) or mechanics
lore (`server/lib/refusal-field.js` etc.) disagree with this file, **this file
wins** — open a PR to reconcile them, don't fork the canon. New worlds, NPCs,
factions, and quests must stay inside the frame defined here.

Last canon revision: 2026-05 — the Three Pillars rewritten as a **love
triangle** (creation order Sovereign → Concordia → Concord; Concord, not the
Sovereign, is the maker of the Concord Link; Refusal belongs to the Sovereign
alone; Concord is the First *Law*, not the First *Refusal*). Shipped beats
updated in `content/world/lore.json` + `content/world/concordia-hub/lore.json`.

---

## 1. The Three Pillars — the gods at the root of reality

Reality is not founded on principles. It is founded on **three people who want
each other in a closed loop where nobody reaches.** The agency / refusal /
constraint themes that run through all nine worlds are the *scars of that
unrequited triangle*, not an abstract treatise. Keep them people. Keep them
petty. That is the point.

### Creation order (canon)

1. **The Sovereign — the First Refusal (self-made, FIRST).**
   Before anything agreed to exist, one will *refused to not.* He made himself
   out of sheer refusal — the first act of any kind, and the origin of **Refusal
   itself** (the mechanic, the anti-power, all of it, traces to him). Because
   not even he would be alone in the nothing, his **refusal of solitude** reached
   into the void and called for an answer.

2. **Concordia — the First Breath (called into being, SECOND).**
   The void answered the Sovereign's refusal of solitude — not with thought but
   with feeling: potential, memory, hunger, life. **Brown, warm, laughing.** She
   fell in love with the chaos of becoming and gave herself to **making worlds.**

3. **Concord — the First Law (cooled into being last, THIRD).**
   A cold, ordering thought formed *against all that warmth*: "Not like this."
   Where she permits everything, he bounds it; where she overflows, he catalogs.
   He is the First **Law** — NOT the First Refusal (that is the Sovereign's, and
   his alone; do not re-attribute Refusal to Concord).

### The triangle (the emotional spine — DO NOT SOFTEN)

```
   Concord  ──loves──►  Concordia  ──fond of──►  The Sovereign
      ▲                                                │
      └──────────────── won't turn around ◄────────────┘
```

- **Concord → Concordia (love he will not admit).** He loved her from the
  instant he was. But his cold nature **cannot let him feel a feeling, much less
  name it.** So the love has nowhere to go but inward, where it hardens into the
  mask of *work* — he must understand, measure, account for everything she makes.
  **He has never learned the love is unrequited, because he has never once
  admitted it is love.** That denial tips into **obsession.** (See §2 — it is
  literally why the Concord Link exists.)

- **Concordia → the Sovereign (she knows, and wants the wrong one).** She
  **knows** Concord loves her. She is, nonetheless, secretly and helplessly fond
  of **the Sovereign** — the one whose refusal first called her into being, and
  the one who will never turn around. Her happy chaos carries a private ache.

- **The Sovereign → Concordia (fondness too proud to pursue).** He is fond of
  exactly one thing in all creation, and is **too much of an asshole / too proud
  to ever reach for her.** He has never said her name. His one soft spot leaked
  exactly once — see "The Day Concordia Almost Left" (§3).

### Temperaments + how they live among mortals

All three **live in the Concordia Hub** (the no-violence neutral ground) and
**walk among the people.**

| God | Gender | Nature | In the hub |
|---|---|---|---|
| **The Sovereign** | he | Asshole-with-one-soft-spot. Does whatever he wants, answers to none. Mortal affairs are beneath him; he can get carried away *enabling mischief*. Amused, aloof, proud. | Keeps to himself; **deigns to notice only the very strongest.** "The Sovereign acknowledged you" is the rarest status a mortal can earn. |
| **Concordia** | she | Beautiful, brown, full of life and happy chaos. Reckless, abundant creator. Warm. Secret ache. | **Flirtatious**, mingles freely, delights in mortals. |
| **Concord** | he | Cold, analytical, the cataloguer. Jealous love he won't name → obsession. Loves Concordia, **hates what she makes so recklessly.** | A **schemer** — works the crowds, angling, never idle, the Link running behind his eyes. |

---

## 2. The Concord Link — the keystone (lore ↔ engine weld)

**The Concord Link is Concord's unacknowledged love made architecture.**

Because he will not admit the feeling, it routes through the only thing his
nature permits: *looking, and never looking away.* He reached a cold lattice of
gates and conduits through **every world Concordia created** and bound them into
one structure, so that everything happening anywhere flows back to him to be
**watched, catalogued, understood.** He calls it analysis / duty. It is
obsession with the lights off.

**This is the single most important lore↔mechanics weld in the project.** The
Concord Link IS the platform's omniscient data spine — the connective-tissue
search, the DTU substrate, the cartographer, the drift-monitor, the cross-world
resonance index. The in-fiction reason the whole engine can see across all
worlds is: *a god who can't stop watching the woman he won't admit he loves.*
Any new cross-world/omniscience feature should be understood as **the Link** in
fiction.

**Two-father origin (canon nuance):** Concord *built* the Link (to watch her).
The **Sovereign keeps it open** — after the Great Refusal, when the gates might
have closed, he refused to reseal the worlds ("having once refused the very
concept of 'alone'"). So the Link endures with two fathers, two motives, and
neither will say which reason the worlds actually run on. (Shipped in
`hub_the_ring_of_doors` + the `lore_the_concord_link` primordial event.)

---

## 3. The primordial canon (shipped events)

In `content/world/lore.json`, `type: "primordial"`, era "Before Time":

- **The First Refusal** (`lore_first_refusal`) — the Sovereign self-creates; origin of Refusal; refuses solitude → calls Concordia.
- **The First Breath** (`lore_first_breath`) — Concordia answers; makes worlds; secret fondness for the Sovereign.
- **The First Law** (`lore_first_thought`, retitled) — Concord cools into being as the bound/contrast; loves her, won't admit it.
- **The First Great Clash** (`lore_first_great_clash`) — his law vs. her reckless life; Sovereign's Shadow DTU compromise (for his own amusement).
- **The Concord Link** (`lore_the_concord_link`, NEW) — Concord binds her creation into the surveillance lattice; the keystone (§2).
- **The Day Concordia Almost Left** (`lore_day_concordia_almost_left`) — she threatens to withdraw (worn between Concord's cataloging and the Sovereign's silence); the Sovereign uses the Refusal Field for the first time (death made impossible) so she can't go. **His one confession, dressed as possession.** The Refusal-Field mechanic is born here.
- **The Battle of the First Refusal** (`lore_battle_first_refusal`) — the three first bound together against a structure-erasing force.

---

## 4. The cross-world spine

### The unifying question
Every world is the **same question in a different substrate:** *how should
distributed agency be governed — bounded, unbounded, consolidated, or
distributed?* This is the gods' triangle (refusal vs. permittance vs. order)
played out at mortal scale. It is **why the genre spread is not tourism** — each
genre is a different test of the one idea.

| World | Substrate of agency | Theme |
|---|---|---|
| **tunya** | historical memory | who holds truth/memory/the refusal |
| **cyber** | cognitive (uploaded minds) | can a distributed consciousness be a benevolent dictator |
| **crime** | informational | who controls truth in the underworld |
| **superhero** | biological (emergence) | does substrate-granted power liberate or control |
| **fantasy** | supernatural/political | constraint by mutual deterrence (the Three Refusals) |
| **sovereign-ruins** | the Refusal algebra itself | constraint gone TOTAL (the Cascade) — see §5 |
| **lattice-crucible** | observation/contradiction (drift) | is observation itself an act |
| **concord-link-frontier** | logistics/trust (the Handshake Protocol) | human institutions vs. autonomous systems |
| **concordia-hub** | the neutral ground | soft power only; where the gods live |

### The meta-antagonist: consolidation vs. distributed agency
The setting's central conflict is **emergent across files** (canonize it here so
it can't be lost):

- **Vesper Kane** appears as a power-consolidator in **three worlds at once** —
  Luminary Industries founder (superhero), the liaison who betrayed Jax Rivera's
  unit (crime), and a Luminary contractor around the upload incident (cyber). He
  is the recurring face of *recentralizing* agency.
- **The Voss dynasty** (`hub_the_voss_question`) — Vosses in four+ worlds (House
  Voss/fantasy, Voss Consultation/cyber, the underworld envoy, Elias + Seraphine
  in the hub), traced by a **sealed genealogy** to one ancestor who "walked the
  Concord Link before the Truce — before, by every record, the Link existed."
  The ancestor's first name is **deliberately withheld** (even from code). This
  is the connective-tissue thread; keep it ambiguous-on-purpose, never resolve
  the name casually.

### Cross-world character arcs (canon — keep consistent)
- **Calla Bren** — Sovereign-Ruins rebellion leader → **Calla, Drift-Cult High
  Priestess** in lattice-crucible → cross-world observation pact with Voss Dren.
  One character, an arc across worlds. Not a duplicate.
- **Walker Lin** — autonomous courier whose identity-across-discontinuity is
  *intentionally* unverifiable; she reads differently at the frontier (between
  worlds) than in the Crucible. The ambiguity is the point.
- **Voss Dren vs. Seraphine Voss** — shared name, connection deliberately
  unresolved (part of the Voss Question). Leave ambiguous or have in-world
  characters debate it; do not collapse them without intent.

---

## 5. The deepest lore↔mechanics weld: Sovereign Ruins → the Refusal cap

**Sovereign Ruins is the in-fiction origin of the game's Refusal-Field
mechanic.** An apprentice glyph-reader, **Vela**, discovered the six-fold
**Refusal algebra** (the Sovereign's own original act, formalized) in the
Council's voting records. It cascaded: within a year every operation in the city
*except recording, refusing, and refusing-to-refuse* became impossible. The city
froze. **Concordia's Founding Compact explicitly cites the Cascade** as the
reason every Refusal is **strength-capped at 9** and **expires unless re-recorded
within 7 days.**

That cap is `server/lib/refusal-field.js` (`strength >= 6` compound-refusal
gating, hard cap at 9). **The mechanic has a myth; the myth has a mechanic.**
Vela still holds a strength-9 dome-collapse field. Preserve this weld in any
refusal-field changes.

Other welds to respect:
- **Refusal Field** = the Sovereign's signature (born "The Day Concordia Almost Left").
- **Shadow DTU system** = the Sovereign's compromise between Concord's law and Concordia's chaos (First Great Clash).
- **The Concord Link / omniscient data spine** = Concord's obsession (§2).
- **DTUs / the knowledge substrate** = the stuff of Concordia's creation, watched through Concord's Link.

---

## 6. Coherence status + prioritized lore gaps

Deep read (2026-05) across all 9 worlds: **~8.5/10 coherence, no load-bearing
contradictions.** Density is intentionally uneven: **tunya (deepest) > cyber >
sovereign-ruins ≈ fantasy ≈ lattice > superhero ≈ frontier (leanest).**

**Write next, in priority order:**

1. **The ecology myth (highest leverage, currently missing entirely).** No lore
   touches the natural world — creatures, why life adapts/hybridizes. The Living
   World work (taxonomy + adaptation engine, water→steam→brine) is *mechanics
   with no myth.* Frame adaptation/hybridization as **life expressing the
   agency/refusal/constraint spine** — a creature "refusing" its environment, or
   adaptation as the substrate (Concordia's reckless life vs. Concord's
   bounding) bending biology. Makes breeding a steam-drake *mean* something. Pair
   with `docs/LIVING_WORLD_PLAN.md`.

2. **Surface the cosmology to players.** The pantheon + triangle + Cascade are
   excellent and almost entirely *opaque* (lore.json + code). Needs in-world
   surfacing: a codex, the Lamplighter expanded, Founders'-Day retellings, the
   goddess monologue carrying the triangle's weight. The myth exists; players
   can't find it.

3. **Canonize the Voss/Vesper meta-conflict in-world** (it's only emergent
   across files today — §4). Make at least one quest or codex entry name the
   consolidation-vs-distributed-agency stakes explicitly.

4. **Even out the lean worlds + close orphan threads.** Bring superhero +
   frontier toward tunya's density. Resolve: frontier's lost parcel, Sovereign's
   Hen Orven engraving (wanted by the hub Curator), fantasy's three unnamed
   Great Houses + why the Obsidian Crown stays weak.

5. **Decide fantasy's relationship to the spine.** It's the one world standing
   apart from the Refusal metaphysics (strongest standalone cast — Seraphine is
   the best-realized antagonist anywhere). Either retrofit (Thorne's curse as a
   Refusal phenomenon; Seraphine's leverage as glyph/secret-based) or
   consciously own it as the "emotional/political" pole. Make it a choice.

---

## 7. Authoring rules (stay inside the frame)

- The three gods are **people in a love triangle**, not principles. Petty,
  proud, longing. Don't flatten them back into Logic/Life/Will abstractions.
- **Refusal belongs to the Sovereign.** Concord is Law/Order. Don't re-merge.
- **Concord never admits his love.** If an NPC or quest has Concord acknowledge
  it, that's a violation (or a *deliberate, momentous* story beat — treat as
  such, get sign-off).
- The **hub is violence-impossible** (the ground refuses it). No combat lore in
  the hub.
- The **Concord Link = the omniscient engine.** New cross-world/data-spine
  features are "the Link" in fiction.
- Keep the **Voss ancestor's name sealed.** Keep **Cascade → strength-9 cap**
  intact. Keep **Calla/Lin/Voss** arcs consistent with §4.
- New worlds must answer the spine question (§4): *what substrate of agency does
  this world test, and bounded/unbounded/consolidated/distributed?*
