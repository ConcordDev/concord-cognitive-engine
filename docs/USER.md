# Player Guide — Concord & Concordia

Concord is a cognitive operating system. Concordia is the world inside it. This is what you can do as a player after the Phase 1-6 substrate ships.

---

## The Four Quiet Scores

Every action you take silently moves four metrics. You don't level them; they drift.

| Metric | What raises it | What it gates |
|---|---|---|
| `ecosystem_score` | Restoration, gentle harvest, planting, tracking | Fauna respawn, goddess "warm" tone |
| `concord_alignment` | Council votes, peaceful resolution, attribution | Faction trust, summit invitations |
| `concordia_alignment` | Beat-realisation, shrine offerings, pilgrim acts | Goddess phases, rare quest unlocks |
| `refusal_debt` | Killing, beat-rejection, overharvest, oath-breaking | Compound-refusal phases (Sovereign endgame) |

---

## Combat & Skills

### Five Bars

You have **HP**, **MP**, **Stamina**, **Focus**, and **Mana**. Different skills cost different combinations.

### Element × Environment (the bender table)

Casting in the right environment amplifies your skill. Frost in cold cells: 1.5×. Fire on a sunny dry day: 1.4×. Lightning in a storm: 1.6×. Out-of-element casts halve. Your cast also writes back to the environment — fire warms +0.5°C × magnitude (10 min TTL), water humidifies, lightning thunders + flashes light. The next caster reads your environment.

### Pain → Repair → Stat Growth

Damage you take routes into a per-region pain ledger (head/torso/arms/legs/systemic). Every ~5 min the repair-cycle reads the ledger and converts pain into XP across endurance / strength / agility / vitality / focus, plus a temporary `damage_resist` buff.

### Skill Evolution

Every 10 levels of XP on a skill, you can commit a revision. The revision mutates the recipe within a coherence-bounded envelope: name shifts, damage tunes up, new side-effects emerge. Your skill DTU's `revision_num` increments.

### Glyph Spells (Phase 5d)

Compose new spells from the base-6 glyph palette in the `/lenses/world` glyph composer. Pick 2-5 components; the composer folds them via the Refusal Algebra and returns a new spell with element + damage + range + costs. Mint it as a recipe DTU; it then plugs into evolution (Phase 1) and the marketplace (Phase 1.5).

---

## Knowledge Moves Through the World

### NPC Marketplace (Phase 1.5)

NPCs at level ≥25 with ≥3 revisions of a recipe list it for sale. NPCs from one faction buy archetype-complementary recipes from another faction. The marketplace is **populated by NPCs**, not just players.

### Mentorship

Pay an NPC a fee proportional to their skill depth (25 + 8 × revision). They teach you across 3 sessions, capped at mentor depth − 1. You can never surpass your teacher via lessons alone.

### Demonstration

When you cast an evolved skill in combat, every NPC within 50m records the demonstration. The next time those NPCs evolve their own version of that skill, the LLM composer biases the new name and shape toward **your** lineage. The royalty cascade then pays you on whatever those NPCs sell.

---

## NPCs Are Specific

Every NPC carries (Phase 2):
- A **persistent grudge** (e.g., "Vael cheated me at the salt market two summers past. It festers still.")
- A **current preoccupation** driven by their faction's strategy phase
- A **desire for THIS player** matched to your metric profile

Kill an NPC and every NPC in their faction gains a `killed_by_player` grudge. Save someone and grudges across the region soften.

When an NPC dies (Phase 5b), their interiority transfers to an heir: grudges, preoccupations, desires, recipes (citation), and wealth. The heir carries the dead's memory forward. A tomb appears at the death site with the NPC's last words.

---

## NPCs Live a Day (Phase 4a)

Every NPC has a deterministic 24h schedule split into 8 three-hour blocks. They sleep / train / craft / gather / trade / commune / patrol at specific places. Their schedule is biased by their preoccupation: war-phase NPCs train more, sleep less; mourning NPCs walk to the temple at dusk.

If you walk into a workshop district at craft hours, NPCs are visibly there forging. The combat soundscape, structural stress, and ambient temperature all shift based on what NPCs are doing nearby.

---

## NPCs Have an Economy (Phase 4b)

NPCs at their workplaces actually produce, consume, and trade resources. Per-world `regional_scarcity` rolls up from the last hour of flows and modulates marketplace prices. Kill a faction's gatherers and watch their crafters' inputs dry up. Flood a region with surplus weapons and prices crash.

---

## Land Claims (Phase 5a)

Claim a circular plot of land. Within it, only you (and your invited co-owners) can build. Maintenance bonds tick down daily; expired claims revert to open territory. Outsiders entering your claim trigger a `claim:trespass` event.

Macros to know:
- `land_claims.claim {worldId, x, z, radiusM}` — claim 5-200m radius
- `land_claims.invite {claimId, userId, role}` — co_owner / guest / tax_collector
- `land_claims.topup {claimId, amount}` — top up the maintenance bond

---

## Personal Beats (Phase 3)

The substrate watches you. Every ~25 min, the forward-sim brain composes anticipations about what you'll do next. The personal-beat scheduler picks the highest-confidence × novelty one and surfaces it as a card from the goddess: *"Something stirs in the eastern grove tomorrow."*

You **carry** it (concordia_alignment +0.05), **refuse** it (refusal_debt +0.02), or **dismiss** it. The realisation cascades into the underlying prediction, which feeds the next pass of NPC asymmetry, which changes what NPCs offer you next time.

---

## The World Has Seasons (Phase 5c)

Six seasons (spring / summer / monsoon / harvest / frost / deep_winter), 7 real-world days each → 42-day Concordia year. Seasons silently bias env signals (cold winters chill cells), modulate gather-node yield (deep_winter herb yield is 0.2×), and emit annual events.

---

## The World Reacts to the Substrate (Phases 4c + 5e)

The lattice's drift-monitor watches the cognitive corpus for six failure modes (goodhart / memetic_drift / capability_creep / self_reference / echo_chamber / metric_divergence). When one rises to warning severity, two things happen:

1. A 3-step quest spawns on an archetype-matched NPC ("A haunted glade" for memetic drift on a mystic).
2. A literal procedurally-generated region appears in the world (haunted_glade / corrupt_market / hollow_chamber / overgrown_wild / silent_field). The region biases env signals within its radius.

When you complete the quest, the region decays — the world has self-corrected.

---

## Endgame — The Sovereign + The Dome

At level 20,000, the Sovereign holds court. The Mass Raid is a four-phase boss: Court (duels) → Procession (coalition NPCs friendly-fire-immune) → Reckoning (combat at scale) → Eternal (the dome closes; compound refusal goes critical). If your `concordia_alignment` is high, the dome falls outward. Refusal-heavy paths see it close in.

---

## Lens Tour (the 203-window OS)

You can do all of this in the `/lenses/world` lens. But Concord has 202 other lenses for everything else — chat, code, music, healthcare, accounting, council voting, atlas, marketplace. Same DTU substrate underneath. Same royalty cascade. Same federation.

Run `npm run score-lenses` (server-side) to see implementation completeness per lens.

---

## Cross-lens Discovery (Phase 6c)

Search across the entire DTU corpus from any lens with the `/lenses/discovery` surface. Title + meta + creator filters; respects scope='personal' privacy. Trending tab shows DTUs with high recent citation activity.

---

## Take Your Stuff Elsewhere (Phase 6b)

Your DTU corpus is yours. The `dtu_portability.export` macro packs everything into a transportable envelope with SHA-256 integrity hashes. Import into another Concord instance — the royalty cascade keeps paying because citation IDs and parent_creator_ids transfer along.

---

## Mobile

`concord-mobile` is a real React Native + Expo app, not a webview. BLE, WiFi P2P, NFC, geolocation, SQLite local store all native. The mobile macro client (`src/api/macro-client.ts`) wraps every Phase 1-6 surface; you can invoke beats, land claims, glyph spells, discovery, knowledge trade, and DTU portability from a mobile component without re-implementing fetch/auth/retry.
