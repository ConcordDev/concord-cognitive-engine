# Canonical Multi-World Content + Cross-World Relationship Graph

The user provided 6 canonical characters (2 each for fantasy, crime, cyber) to drop into the world dirs that the previous commit had scaffolded as empty. Plus a critical architectural directive: NPCs and emergents from any world can travel and communicate (diplomacy / subterfuge) with characters in other worlds.

## What this commit ships

### 6 canonical NPCs authored to schema

**Fantasy world** — `content/world/fantasy/npcs.json`:
- **Thorne Blackroot** — corrupted forest guardian; life-death duality magic; bone-bead consciousness anchors; secret former-apprentice relationship
- **Lady Seraphine Voss** — vampire duchess; blood manipulation, illusions, mist/bat swarm, singing rapier; House Voss patient long-game

**Crime world** — `content/world/crime/npcs.json`:
- **Jax "The Ghost" Rivera** — ex-special-forces; phase shift, shadow blend, marksmanship; senior survivor of the unit Vesper Kane personally sold out; confirmed Luminary as his blood target
- **Mama "Iron Rose" Delgado** — syndicate matriarch in her 50s; information dominance, wealth-and-connections, custom shotgun "The Rose"; back-channel ally of Vesper that she will betray when it's worth more

**Cyber world** — `content/world/cyber/npcs.json`:
- **Kael "Zero" Nakamura** — uploaded consciousness; mainframe dominion, digital clones, infrastructure manipulation, predictive modeling; secret: he's no longer sure which clone is the original
- **Nyx "Blackout" Torres** — ex-corporate-enforcer; EMP blasts, supercharged cybernetic melee, localized blackouts; her cybernetic arms are scar tissue from involuntary corporate enforcer mods she refuses to remove

### 6 new factions (2 per world)

| World | Factions |
|---|---|
| Fantasy | wildwood_circle (Thorne's order), house_voss (Seraphine's bloodline) |
| Crime | ghost_network (Jax's assassin network), iron_rose_syndicate (Mama's empire) |
| Cyber | zero_collective (Kael's processes), blackout_resistance (Nyx's insurgency) |

Each faction has motto, goal, values, fears, controlled_districts, rival_factions, dialogue_style, reputation_currency, and faction_state with current tensions — same schema as Concordia's existing factions.

### Lore events per world

**Fantasy** (5 events): Root Curse → Voss Ascension → First Masquerade Disappearances → Three Refusals → Quiet Grove. Three carry `hidden_truth` for branch conditions.

**Crime** (5 events): Unit Betrayal → Iron Rose Consolidation → First Truce → Voss Envoy → Drone Swarm Aftermath. Three carry hidden_truth.

**Cyber** (6 events): The Upload → Augmented Children Program → First Blackout → First Sparing → Voss Consultation → Resistance Correspondence. Two carry hidden_truth.

### 19 cross-world relationships forming a graph

Per the user's architectural directive, the canonical NPCs are now interconnected across worlds. Smoke test counts **19 cross-world relationship edges**. Examples:

- **Vesper Kane** ↔ Mama Delgado (transactional back-channel) ↔ Jax Rivera (blood target) ↔ Kael Nakamura (former corporate sponsor turned threat) ↔ Seraphine Voss (respectful distance, both consider the other most dangerous in any reality)
- **Elias Voss** ↔ Nyx Torres (resistance correspondence via Concordia hub dead-drop) ↔ Jax Rivera (potential ally on the Vesper investigation) ↔ Kael Nakamura (Kael fascinated by Elias's biological rewrite as a parallel of his own digital one; Elias has not responded)
- **Seraphine Voss** ↔ Mama Delgado (annual letters, calling each other "cousin") ↔ Kael Nakamura (transactional intel back-channel after a 4-day in-person consultation in The Grid)
- **Thorne Blackroot** ↔ Nyx Torres (one cryptic riddle about wolves and walls; she framed it)

These relationships are stored in each NPC's `relationships` array with `CROSS-WORLD` notes — emergent systems can detect cross-world ties by comparing the `world_id` field on the source and target NPCs.

## Smoke test verification

```
seed: { factions: 12, npcs: 18, lore: 28, quests: 18, worlds: 5 }
worlds: [ 'concordia', 'crime', 'cyber', 'fantasy', 'superhero' ]

concordia  : 10 npcs — archivist_maren, scribe_tollan, lorekeeper_yshe,
             warden_voss, captain_rael, factor_cade, broker_sael, cipher_venn,
             wanderer_kael, gatekeeper_orin
crime      : 2 npcs — jax_rivera, mama_delgado
cyber      : 2 npcs — zero_nakamura, nyx_torres
fantasy    : 2 npcs — thorne_blackroot, seraphine_voss
superhero  : 2 npcs — enforcer_elias, luminary_vesper

cross-world relationships: 19
```

All four new worlds load cleanly. Concordia's existing 10 NPCs are preserved.

## What's now wired vs what's not

**WIRED end-to-end:**
- Content seeder loads all 5 worlds + their factions / NPCs / lore
- Cross-world skill effectiveness multipliers (previous commit) operate on each loaded world's `skill_affinity`
- NPC `relationships` arrays carry cross-world references, queryable by emergent systems
- The faction event scheduler (Tier 3 deferral 12) will roll lore events per world automatically every ~50min

**NOT YET WIRED — the cross-world travel substrate the user just specified:**

The user said "all of these npcs and emergents are allowed to travel and communicate with the other characters in other worlds whether it's diplomacy or subterfuge." The data model already supports this (NPCs have `world_id`; relationships can reference any world). What's needed for a full implementation:

1. **Cross-world envoy / message system** — NPCs send messages or dispatch agents across worlds. Could land as a small `lib/cross-world-envoy.js` that emits events like `concordia:npc-envoy-arrived` when an NPC's agent shows up in another world. Server-side scheduler dispatches based on faction goals + active relationships.

2. **NPC travel mechanic** — currently NPCs are anchored to their `worldId` via `world_npcs` table. Need a transit route (DTU? presence record?) that lets an NPC temporarily appear in another world with a `traveling_from` field. Faction event scheduler can roll travel events as a sub-event type.

3. **Cross-world quest emergence** — `quest-emergence.js` currently scopes to the NPC's home world. Extend to emit quests where the giver is in one world and the target is in another ("The Enforcer's blood-target evidence is buried in a Voss masquerade ball — go to the fantasy world").

These three are a focused 1-2 day pass on top of what's now in. The data is ready; the runtime plumbing is the missing piece.

## Substrate state

| Item | Status |
|---|---|
| 5 worlds with meta + skill_affinity | ✅ Wired |
| 18 canonical NPCs across 5 worlds | ✅ Loaded |
| 12 factions with state + tensions | ✅ Loaded |
| 28 lore events with hidden_truths | ✅ Loaded |
| Cross-world relationship graph (19 edges) | ✅ Authored, queryable |
| Cross-world skill effectiveness | ✅ Calculator ready, callsite integration pending |
| Cross-world NPC travel + envoys | ⏸ Data ready, runtime plumbing pending |
| Cross-world quest emergence | ⏸ Quest emergence still single-world |
| Authored canonical characters for crime / fantasy / cyber | ✅ 2 each, can grow with more user input |

The substrate is now richer than most shipped games' lore bibles. Every cross-world relationship is a quest hook that the existing emergent systems can metabolize the moment the runtime plumbing lands.
