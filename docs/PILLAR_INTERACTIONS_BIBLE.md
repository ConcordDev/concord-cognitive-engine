# Pillar Interactions Bible

**Status:** Designer / narrative reference. Canon parent: `docs/LORE_BIBLE.md`.
**Scope:** How the Three Pillars appear, speak, refuse, and bind player-facing systems.
**Non-goals:** New cosmology. If this file disagrees with LORE_BIBLE, LORE_BIBLE wins.

Last aligned: 2026-08-15 (cycle-9 content pass).

---

## 1. Triangle

Reality is not founded on principles. It is founded on **three people who want each other in a closed loop where nobody reaches.** Agency, refusal, and constraint across the nine worlds are scars of that unrequited triangle. Keep them people. Keep them petty.

### Creation order

1. **The Sovereign** — First Refusal (self-made, FIRST). Before anything agreed to exist, one will refused to not. Origin of Refusal as mechanic and metaphysics. His refusal of solitude called for an answer.
2. **Concordia** — First Breath (SECOND). The void answered with feeling: potential, memory, hunger, life. Brown, warm, laughing. Fell in love with becoming; gave herself to making worlds.
3. **Concord** — First Law (THIRD). Cold ordering thought against all that warmth: "Not like this." Bounds where she overflows. He is Law — **not** Refusal. Never re-attribute Refusal to Concord.

### The emotional graph (do not soften)

```
   Concord  --loves-->  Concordia  --fond of-->  The Sovereign
      ^                                                |
      +-------------- wont turn around <---------------+
```

| Vector | Truth |
|---|---|
| Concord to Concordia | Love he will not admit. Cold nature cannot let him feel a feeling, much less name it. Routes into work, measure, catalog. Denial tips into obsession. He has never learned it is unrequited because he has never admitted it is love. |
| Concordia to Sovereign | She **knows** Concord loves her. She is secretly and helplessly fond of the Sovereign — the one whose refusal called her, the one who will never turn around. Happy chaos carries private ache. |
| Sovereign to Concordia | Fond of exactly one thing in creation; too proud / too much of an asshole to reach. Has never said her name. One soft spot leaked once — The Day Concordia Almost Left. |

### Interaction rules for writers

- Scenes may **show** the triangle in blocking, timing, and who looks at whom.
- Founding Day readings may stage the three without naming Concords feeling for him.
- **Forbidden default:** any NPC line "Concord loves Concordia" stated as settled fact in his voice or as his admission.
- Allowed: Concordia teasing that he "cares" and will never use the word; mortals gossiping incorrectly; scholars being wrong on purpose.

---

## 2. Refusal Field

**Owner:** the Sovereign alone.
**Birth myth:** The Day Concordia Almost Left — he made death impossible so she could not withdraw. Confession dressed as possession: *"You do not get to end. I refuse it."*
**Engine seat:** `server/lib/refusal-field.js` (+ algebra under `server/lib/refusal-algebra/`).
**Cascade weld:** Sovereign Ruins / Vela — strength capped at 9; expires unless re-recorded within 7 days. Compound gate at strength >= 6.

### Field kinds (player-visible labels)

| kind | label | narrative use |
|---|---|---|
| `death_suspended` | Death is refused | Origin beat; threshold protection |
| `harvest_disabled` | Harvest is refused | Tunya echo; famine politics |
| `hostility_paused` | Violence is refused | Temporary truce fields (not hub ground) |
| `consequence_held` | Consequence is refused | Crime-world rhyme; raid beats |
| `numbers_refused` | Numbers are refused | Mass-raid / Grid |
| `dome_collapse` | The arena is refused | Raid phase; inverse of frontier dome-refusal |
| `win_refused` | Victory is refused | Superhero stalemate pressure |
| `harm_to_children_refused` | Harm to the young is refused | SL6 divine protection of under-matured |

### Interaction rules

- Applying a field is a **Sovereign-signature** event (quest beat, raid, imbalance), not a generic mage spell.
- Hub violence failure is **not** a stacked field and must not increment compound strength. Hub = Concordias body (`hub_the_heart_claimed`).
- Fantasy world rarely runs Cascade algebra (LORE_BIBLE §6.1 vacation world). Prefer life-magic and lived refusal (Thorne).
- UI may show glyph hints; do not flatten myth into pure debuff text without the Sovereigns will behind it.

See also: `server/lib/refusal-engine.js` for progression/cascade orchestration above the field primitive.

---

## 3. Breath

**Concordias register.** Breath is life overflowing the ledger: growth, naming, flirtation, reckless creation, the moss that likes your boots.

### How Breath shows up

- **Warm / cold goddess phases** in dialogue (`content/dialogues/concordia.json`) — cold when the world is harmed or compound refusal deepens.
- **First Cycle** onboarding: cook, eat, commune — pedagogy of belonging, not conquest.
- **Hub soil:** she poured herself into the ground; dig anywhere and she is listening.
- **Fantasy vacation world:** her magic heaviest, Refusal lightest; tragedies read as love stories gone wrong — the same wound she carries.

### Interaction rules

- Concordia mingles, flirts, delights in mortals. She is not naive; the ache is private, not absent.
- She will not punish conquest of the hub with death — tide of flowers, mercy as geometry.
- When she tasks players (Ninth quest, First Day), objectives should prefer care, witness, and multi-frame holding over single-world domination.

---

## 4. Law

**Concords register.** Law is bound, catalog, structure, the sentence "Not like this" cooled into a person.

### How Law shows up

- Crowds worked as a schemer — angling, never idle, Link behind the eyes.
- Quest VO that corrects without comforting.
- Archive, compact, ledger, and "data will be seen" beats (love-triangle branch B).
- Hatred of what she makes so recklessly — expressed as curation pressure, not cartoon villainy.

### Interaction rules

- Concord is not the Refusal god. He may **catalog** Refusals as errors/disease; he does not embody them.
- Jealousy appears as proximity control, attention on rivals, obsession with measurement — never as a clean love confession.
- Shadow DTU compromise (First Great Clash) is Sovereign-amused mediation between Concords law and Concordias chaos — keep that three-way credit honest.

---

## 5. Concord Link

**The keystone lore-engine weld.** The Concord Link is Concords unacknowledged love made architecture: a cold lattice of gates and conduits through every world she created so everything flows back to be watched, catalogued, understood. He calls it duty. It is obsession with the lights off.

### Two-father origin

- **Concord built it** (to watch her).
- **Sovereign keeps it open** after the Great Refusal / Truce — having refused "alone," he would not reseal the worlds.
- Neither says which reason the worlds actually run on. Keep the ambiguity.

### Engine rhyme

Omniscient data spine, DTU substrate, cartographer, drift-monitor, cross-world resonance — new cross-world/omniscience features are **the Link** in fiction.

### Interaction rules

- Travel copy: from one *no* to the next, not genre tourism.
- Frontier refuses a fixed embassy (Refusal of the Dome); that is why the connective tissue stays honest.
- Players marked by Link attention (`flag.link_attention_marked`) should feel observed, not railroaded — Concords gaze is ambient pressure.

---

## 6. Player appearances

All three **live in the Concordia Hub** and walk among people.

| God | Hub behavior | When players meet them |
|---|---|---|
| **Concordia** | Flirtatious, mingles freely, delights in mortals | High frequency: onboarding, First Day, Court scenes, warm/cold idles |
| **Concord** | Schemer in crowds; Link running | Medium: corrections, archive-adjacent, Link errands; rarely "friendly" |
| **Sovereign** | Keeps to himself; notices only the very strongest | Rare: acknowledgment is a status event; mischief enabling at his amusement |

### Appearance craft

- **Blocking over exposition.** Place Concord near but not with her; Sovereign on the far rim; she the one who closes distance to the player.
- **Frequency budget:** if the Sovereign speaks twice in one session, something mythic is happening — or the writer is overusing him.
- **Acknowledgment economy:** "The Sovereign acknowledged you" is the rarest mortal status. Do not grant it for tutorial completion.
- **Despawn honesty:** gods may be busy. Founding Day and Court set-pieces are the reliable triple-presence moments; otherwise allow substitutes (Keeper witness, slate, embassy rumor).

### Off-hub appearances

- Concordia: fantasy slips, First Breath echoes, life-magic surges.
- Concord: rarely "visits"; his presence is the Link — messages, surveillance tells, catalog NPCs.
- Sovereign: Ruins signature fields, raid declarations, mischief in places he finds entertaining. He does not hold office hours.

---

## 7. Dialogue

### Voice chips

| Pillar | Diction | Never |
|---|---|---|
| Concordia | Warm, sensory, naming, invitations, laughter with an undertow | Academic cosmology lectures; cruelty for sport |
| Concord | Precise, corrective, structural metaphors, short sentences | Love admissions; slangy warmth; claiming Refusal |
| Sovereign | Sparse, amused, proprietary, insultingly calm | Saying her name; explaining himself; egalitarian banter |

### Sample safe lines (pattern only)

- Concordia: "You walk softly. The moss feels you and likes you."
- Concord: "Loss is a design flaw." / "If you stand here, you generate data. I will see it."
- Sovereign: "You do not get to end. I refuse it." / "Small." / "Do not waste it on small enemies."

### Branching guidance

Scene seed `server/content/scenes/love-triangle-dialogue.md` shows a full 12-line Court beat with three player branches:

1. Ninth posture (Concordia path)
2. Link map hunger (Concord path)
3. Earn notice (Sovereign path)

Each branch unlocks different quests without forcing the player to "pick a god" as a faction flag of exclusivity. Affinity moves; cosmology stays shared.

### Dialogue sins

1. Flattening them into Logic / Life / Will abstractions in spoken VO.
2. Therapy-speak resolving the triangle.
3. Hub combat banter.
4. Printing the Eighths secret text.
5. Giving Concord the First Refusal title.

---

## 8. What they refuse

Refusal is the Sovereigns nature; the others refuse in different currencies.

| Pillar | What they refuse | How it feels in play |
|---|---|---|
| **Sovereign** | Endings imposed on his will; solitude; being summoned; smallness | Fields, rare gaze, raid phases, caps that still bear his myth |
| **Concordia** | Violence on her body-ground; being only a symbol; letting one worlds wound rule the hub | Soft fails, tide of flowers, warm/cold life response |
| **Concord** | Unmeasured loss; admitting the feeling; her chaos without catalog | Surveillance, ledgers, quest gates that demand precision |

### Eight world-Refusals vs pillar will

The Eight (Death, Harvest, Hostility, Consequence, Numbers, Dome, Win, Completion) are peoples who learned world-scale *no*. They are not the Sovereigns doctrine. Concord catalogs them; Concordia grieves them; the Sovereign simply *is* the skill they imitate.

Fantasy nuance: Hostility row is Thorne lived refusal + public Three Refusals — not default Cascade gameplay.

Sere: not a row. No Court seat.

---

## 9. Unrequited Triangle (playable consequences)

The triangle is not flavor text. It is a **generator** for hub drama and cross-world pressure.

### Systemic echoes

1. **Link omniscience** — Concords unadmitted love as architecture (every cross-world feature).
2. **Refusal Field** — Sovereigns one leaked soft spot formalized so she could not leave.
3. **Hub ground** — her answer: stay as soil, refuse violence, hold all Eight incomplete (the Ninth).
4. **Founding Day staging** — annual public diagram of the loop without narration of his heart.
5. **Affinity asymmetries** — raising Sovereign notice can wound Concordia softly and tighten Concords jaw without a journal popup explaining why.

### Player-facing design principles

- **Do not resolve the loop** in season-one content. No confession ending, no marriage ending, no neat polyfix.
- **Do let players witness** and take postures (Ninth quest outcomes: stood / tilted / seized).
- **Do let factions misread** the gods — wrong theology is content (Scholars vs Veil vs Grid).
- **Do keep petty:** a god ignoring a player can be correct characterization, not a bug.

### Scenario seeds (canon-safe)

- Court arrival where only she approaches (`love-triangle-dialogue`).
- Ninth performance quest (`three-pillar-quest`) — hold three embassies without capture.
- Founding Day slate: report presence, not interpretation (`founding_day_*`).
- Isa Velt consolidation dossiers: mortal consolidation vs distributed agency under divine indifference.
- Zero studying Refusal in the hub: a counter trying to learn the uncountable — Concord catalogs the attempt; Sovereign may enable mischief.

### The Ninth as social mechanic

*I refuse to let my own refusal win.*

On hub ground, designers should reward players who hold multiple frames and soft-fail players who try to make one Refusal (or one god) finish the story alone. That is the Unrequited Triangle taught through feet, not through a romance meter.

---

## 10. Cross-references

| Resource | Role |
|---|---|
| `docs/LORE_BIBLE.md` | Canon parent |
| `content/codex/eight-refusals.json` | Eight + Ninth lockstep |
| `server/content/dtu/*` | Playable DTU prose bodies |
| `server/content/scenes/*` | Court dialogue + Ninth quest seed |
| `server/content/npcs/keeper-of-the-court.md` | Greeter / witness |
| `server/lib/refusal-field.js` | Field primitive |
| `server/lib/refusal-engine.js` | Orchestration / progression |
| `docs/CONCORDIA_QUESTS_BIBLE.md` | Quest catalog |
| `content/world/concordia-hub/lore.json` | Hub history beats |
| `content/dialogues/concordia.json` | Warm/cold goddess lines |

---

## 11. Authoring checklist (print beside the keyboard)

- [ ] People, not principles
- [ ] Refusal = Sovereign; Law = Concord; Breath = Concordia
- [ ] No default Concord love-admission
- [ ] Sovereign never says her name
- [ ] Hub = soft power; ground is her; not a buff
- [ ] Link = his architecture + his open refusal of alone
- [ ] Eighth secret stays secret
- [ ] Sere stays off the Court
- [ ] Triangle stays unrequited on purpose

---

*End of Pillar Interactions Bible. Extend with scene citations, not new gods.*
