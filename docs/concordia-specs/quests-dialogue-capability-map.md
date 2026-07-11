# Quests & NPC Dialogue / Social-Sim — Capability Map

Audited 2026-07-11. Scope: quest design/writing depth + NPC dialogue and
social-simulation depth (grudges/desires/preoccupations, schemes, hooks,
legacy/death) inside Concordia. Read-only audit — no code or content was
changed. Benchmarked against The Witcher 3 (quest design: specific,
morally-grey, consequences that land) and CK3/RDR2 (NPC behavioral depth:
NPCs that feel like they have lives, not vending machines).

Prior audits consulted: `docs/MMO_RPG_COMPLETENESS_AUDIT.md`,
`docs/POLISH_AUDIT.md`. Both were re-verified against current code rather
than trusted; findings below note where they held up and where this pass
found something neither had flagged.

---

## 1. Summary verdict

**The prose is genuinely Witcher-3-grade. The choice mechanics behind it are
almost entirely inert.** This is the single most important finding of this
audit and it cuts against the celebratory tone of the source docs, which
praised "moral_branch" content without checking whether anything reads it.

- **Quest writing quality: strong, specific, morally grey.** The main story
  arc (`content/quests/main-arc.json`) and several side arcs
  (`impossible-print.json`, `sealed-record.json`, `brackish-trust.json`) read
  as real authored fiction — named characters with competing legitimate
  interests, ambiguous villains, consequences that ripple across factions.
  This is not fetch-quest-with-a-costume; it is comparable in prose quality
  to a solid Witcher 3 side-quest chain, occasionally better than its
  weaker side content.
- **The moral-choice mechanism itself is unwired.** `moral_branch` — the
  field that carries the "meaningful choices with different outcomes" the
  writing is built around — is authored into 11 quest files (main-arc,
  onboarding, sealed-record, faction-quests, brackish-trust, and four
  sub-world quests) and is **read by zero lines of server or frontend
  code** outside the JSON files themselves. `reputation_change`, the payload
  that would apply a branch's consequence, has the same status: authored
  extensively, consumed nowhere. See §3 for the trace.
- **Dialogue system: a well-designed three-tier architecture, but the
  bottom tier (which most NPCs, most of the time, actually use) is a small
  fixed template pool that becomes visibly repetitive at the game's own
  NPC population scale.** The tiering itself — authored tree > salience-gated
  LLM > deterministic template — is smart, cost-aware engineering (see §4).
  But only 15 NPCs across the entire game have authored dialogue trees, and
  the procedural NPC spawner alone can produce ~8 NPCs × ~66 factions ≈
  500+ generic NPCs whose routine dialogue draws from an 18-line pool (6
  moods × 3 lines each). The flagship main-arc's five key supporting
  characters (Maren, Rael, Cade, Sael, Voss) are *not* among the 15 —
  their casual "walk up and talk" barks are template or LLM, not authored.
- **Asymmetry (grudges/desires/preoccupations) does surface in dialogue
  text**, which is real and good — but the entire game draws from **5
  grudge templates, 5 desire templates, 7 preoccupation templates**, with
  zero content-author overrides despite the code being built to accept them
  (`content/world/*.json` grudge/desire/preoccupation override slots exist
  and are unused). At 136+ authored NPCs and hundreds of procedural ones,
  this pool will read as formulaic within an hour of play.
- **Quest structural variety is real but narrower than it first appears.**
  21 distinct objective *types* exist, and several chains (impossible-print,
  the lattice-born quest templates) genuinely use investigation/synthesis
  structure rather than fetch-kill-deliver. But the *mechanism* for
  presenting a branching choice to the player doesn't exist (see above), so
  "moral dilemma" as a quest structure is authored-only, not playable.

**Bottom line:** if judged purely on the words a writer put in JSON files,
this clears the Witcher 3 bar in places. If judged on what a player actually
experiences moving through the world, it does not — the signature mechanic
(meaningful branching consequence) never fires, and the NPC population a
player spends the most time around (procedural, untitled) speaks in a loop
of familiar lines within the first play session.

---

## 2. Quest content — detailed findings

### 2.1 Main arc: genuinely strong (`content/quests/main-arc.json`)

Seven-quest chain, "Cracks in the Compact" → "A New Compact". Real Witcher-3
shape:
- **Setup/complication/resolution structure per quest**, not just per arc.
  E.g. `the_shadow_archive`: setup (Maren tests trust with a decoy package),
  complication (the dossier names a Warden commander but isn't conclusive),
  resolution hooks the next quest.
- **A villain with a coherent, sympathetic motive.** Commander Voss's
  closing line in `the_reckoning`: *"I was thirty-four years old... I
  believed that what I was protecting was worth more than what I was
  destroying... I am no longer certain that the thing I was protecting
  exists."* This is not a mustache-twirler; the quest gives him a real
  defense and three different resolutions (condemn / partial truth / full
  truth with mercy), each with distinct, plausible faction-reputation
  fallout.
- **Choices with actually different textual outcomes**, e.g.
  `the_merchants_dilemma`'s branch: agreeing to a managed disclosure keeps
  the Merchant Collective's legitimacy at a prestige cost; going public
  triggers "market panic," fractures the Collective, and costs the player
  Cade's trust while gaining Scholar reputation. This is Witcher-3-shaped
  writing — no branch is a strictly-better version of another.
- **Named-character throughlines**: Maren's arc closes on "*I do not know
  what I want next... It was the first time you had seen her smile*" — an
  actual character beat, not a stat delta.

Quality is undercut only by the mechanical gap in §3 — none of this branch
data is ever shown to a player as a choice, so the writing exists for a
reader (or a future implementer) but not yet for the player.

### 2.2 Faction quests: solid, formulaic in places (`faction-quests.json`)

Eight quests across four factions (Scholars/Wardens/Merchants/Shadow
Network). Individually well-written — e.g. `faction_network_2` ("The
Handler's Question") has a real morally-interesting offer (become an
informant on the other factions in exchange for standing access) with a
`cipher_venn_personal` reputation consequence either way. But structurally
these are more conventional: talk_to → reach_location → gather/deliver →
talk_to, four objectives per quest, twice each. The moral interest is almost
entirely carried by the prose and the (unwired — see §3) branch, not by
objective-type variety.

### 2.3 Investigation-structured side content: the strongest structural
variety in the game (`impossible-print.json`, `southern-arc-mystery.json`,
`nesha-old-seam.json`)

`impossible-print.json` is a genuine 4-quest convergent investigation: three
independent witnesses (a ranger's tracking log, a stablemaster's exhausted
horses, a courier's off-schedule portal) each contribute one clue; a fourth
quest brings all three together and the *synthesis itself* — not combat, not
delivery — unlocks a procedurally generated region. This is closer to a
Witcher 3 Skellige investigation than to a fetch quest, even though its
individual objective types (`reach_location`, `observe`, `deliver`) are the
same primitive types used everywhere else. Structural variety here comes
from *sequencing and cross-referencing*, not from new mechanics — a valid
design approach, and it works.

`sealed-record.json` closes with a genuine three-way branch
(deliver-to-Iyatte / return-to-Asbir / sell-to-Medici) whose consequences are
described as reaching across two kingdoms and "a generation" — the most
ambitious branch-consequence writing in the corpus. Also unwired (§3).

### 2.4 Onboarding: appropriately different in register
(`content/quests/onboarding.json`)

The First Cycle tutorial arc (cook → eat → fight → commune) is written in a
mythic register appropriate to a tutorial-as-creation-myth
("*Everything that grows here remembers who touched it*"), with real
mechanical payoff (permanent buffs, a "Combat Flow DTU" seeded from the
player's first three attacks, a global-DTU-influence modifier). This is
good, purposeful writing distinct from the main arc's noir-political voice —
evidence the writer(s) can hold multiple registers, not just one house
style.

### 2.5 Sub-world quest chains: consistent quality, smaller scope

21 quest files across 7 sub-worlds (crime, cyber, fantasy, sovereign-ruins,
superhero, lattice-crucible, concord-link-frontier), ~100-140 lines each,
1-3 quests per chain. Spot-checked several — quality is consistent with the
hub content (named characters, situational specificity) but scope is
smaller (most are single- or double-quest arcs, not multi-quest campaigns).
Not a defect — appropriate for secondary-world content — but worth noting
these don't carry the same narrative weight as the hub's main arc.

### 2.6 Quest objective-type variety (quantified)

```
44 talk_to        15 deliver          5 any_of        2 stealth_traverse   1 tool           1 defeat
36 reach_location  12 gather           4 macro         2 minigame_complete 1 time_window     1 craft
                    10 interact        3 travel                            1 tame            1 cook
                     7 talk_to_npc     7 observe                           1 rsvp_event      1 consume
                                                                            1 fishing_caught  1 attend_event
```
21 distinct objective types exist. `talk_to`/`reach_location`/`deliver`/
`gather` dominate (107 of ~155 objectives, ~69%), which is the expected
skeleton of any RPG quest content, but there's real variety in the tail:
`any_of` (branching completion, used for onboarding minigame choice and for
Brackish's kind/sharp approach), `stealth_traverse`, `tame`,
`fishing_caught`, `minigame_complete`. This is honest mid-tier variety —
better than a pure fetch-quest generator, well short of Witcher 3's per-quest
bespoke mechanics (card games, potion brewing puzzles, tracking minigames
each built once).

---

## 3. REAL MECHANICAL DEFECT — `moral_branch` / `reputation_change` are
authored but never consumed

This is a defect, not a design judgment, and is the most consequential
finding of this audit.

**Trace:**
1. 11 quest content files author a `moral_branch` object (`description`,
   `options[]`, each option with `trigger`, `consequence` prose, and a
   `reputation_change` map): `main-arc.json`, `onboarding.json`,
   `sealed-record.json`, `faction-quests.json`, `brackish-trust.json`, plus
   `seraphine-heir.json`, `iron-hex-redemption.json`, `silver-identity.json`,
   `ghost-7-trace.json`, `dahlia-ledger.json`, `southern-arc-mystery.json`.
2. `server/lib/content-seeder.js#seedQuestFile` (line ~504) constructs the
   in-memory quest via `createQuest(quest.title, { description, difficulty,
   domain, estimatedTime, steps, breadcrumbs, prerequisites, followUp, tags,
   rewards, authoredId })` — **`moral_branch` is not in that forwarded
   object.** It survives only inside `_authoredQuests.get(id).raw`, an
   in-memory cache.
3. `grep -rn "moral_branch" server/ concord-frontend/` (excluding the
   content JSON files) returns **zero results**. Same for `moralBranch`.
   Same for `reputation_change` outside `content/quests/`.
4. `server/emergent/quest-engine.js` (the in-memory engine `createQuest`
   belongs to) has no branch/choice concept at all — `completeStep` only
   handles objective progress, breadcrumb release, and reward grant.
   `server/lib/quests/quest-engine.js` (the *separate*, DB-table-backed
   engine that actually serves `/api/worlds/:worldId/quests/active` via
   `world_quests`/`quest_objectives`/`player_quests`) also has no
   branch/choice concept.
5. No frontend component (`QuestPanel.tsx`, `QuestTracker.tsx`,
   `WorldQuestLogPanel.tsx`) renders a branch-choice UI or POSTs a branch
   selection anywhere.

**What this means concretely:** every one of those beautifully-written
three-way dilemmas (condemn/partial-truth/mercy for Voss; deliver/return/sell
for the sealed record; kind/sharp for Brackish) is currently presented to
the player as **prose only** — the `description` field of the quest reads
naturally, and the flavor text a player sees is whatever the *default*
completion path produces, because nothing ever asks the player to pick.
`reputation_change` — the actual mechanical stakes of the choice — never
applies to any faction/NPC standing in the database. The Witcher-3-grade
writing is real; the Witcher-3-grade consequence system it was written for
does not exist in the runtime.

Two contrasting, correctly-wired systems worth noting so this isn't read as
"the whole quest engine is fake":
- **Breadcrumbs are real and wired.** `quest.breadcrumbs` *is* forwarded to
  `createQuest`, and `completeStep` in `server/emergent/quest-engine.js`
  (lines ~346-381) actually releases them as DTUs on the configured
  schedule. The lore-reveal mechanism works; the choice mechanism doesn't.
- **`any_of` objectives partially substitute for branch presentation** in a
  few quests (`brackish-trust.json`'s `obj_brackish2_approach`,
  `onboarding.json`'s minigame choice) — these use the *objective*
  `type: "any_of"` to let the player pick a path, and that field IS read by
  the objective-progress system. This is a real, working choice mechanism,
  just a much thinner one than `moral_branch` (binary target selection, not
  a narrated dilemma with independent consequence text per option) — and
  the two systems (`moral_branch` vs `any_of` objectives) look like they
  were meant to converge and never did.

**Triage: ENGINEERING.** No external data dependency — this needs a
mechanism: (a) a way for the dialogue/quest-completion UI to present
`moral_branch.options` as an actual choice at the right story beat, (b) a
route that records the player's `trigger` selection against the quest
instance, (c) a handler that applies `reputation_change` through the
existing faction-reputation / character-opinion write paths (both already
exist and are used elsewhere — `character_opinions`,
`player_faction_reputation_cache`). This is substantial but bounded
engineering work, not content authoring — the content already exists and is
good; it just needs a runtime that reads it.

---

## 4. NPC dialogue system — architecture and depth

### 4.1 The three-tier architecture is a genuinely good design

`server/routes/worlds.js` (`POST /:worldId/npcs/:npcId/dialogue`, ~line
1069) resolves dialogue in this priority order:

1. **Authored dialogue tree** (`content/dialogues/*.json`, loaded via
   `getAuthoredDialogue`) — wins over everything if present.
2. **LLM-generated**, but *only if the exchange is salient*
   (`npc-dialogue-salience.js`) — a deliberate cost/quality tradeoff:
   hostile, grieving, fearful/suspicious moods, an active grudge/desire/
   preoccupation, a quest to offer, grief, a strong opinion, or a conscious
   NPC all wake the LLM; a routine, calm greeting does not.
3. **Deterministic template compose** (`npc-dialogue-fallback.js`) — used
   both as the true LLM-down fallback *and*, by design, as the primary
   output for every non-salient exchange (i.e., most exchanges with most
   NPCs most of the time).

This is well-engineered: it correctly identifies that constant LLM calls for
every "hello" are wasteful, and it's honest about it in its own comments
("today EVERY player↔NPC exchange calls the LLM; that is the broken half of
the cost story... a village chatters for free; the brain wakes only when the
exchange actually matters" — `npc-dialogue-salience.js:3-11`). The prior
POLISH_AUDIT T1.1 finding ("dialogue LLM-or-nothing, fixed via
`composeDeterministicDialogue`") **is still correctly wired** — verified
live in `routes/worlds.js:1198-1213` and `:1283-1285` (fallback composed
before the LLM call, and used whenever the LLM path is skipped or fails to
parse). No regression found.

### 4.2 But the bottom tier is the one most NPCs actually use, and it's thin

Quantified:
- **15 NPCs** have authored dialogue trees (`content/dialogues/*.json`, 23
  files, 296 total conversation nodes) — verified list: `blackroot_thorne`,
  `coalition_enforcer`, `coalition_luminary`, `concord_first_thought`,
  `concordia_first_breath`, `delgado_iron_rose`, `high_chancellor_xochi_
  aekon`, `high_healer_aerasi_medici`, `high_mason_torrek_masond`,
  `nakamura_zero`, `rivera_jax`, `sovereign_first_refusal`,
  `torres_blackout`, `voss_seraphine`, `wanderer_kael`.
- **136 authored NPCs total** across 9 sub-worlds (`grep -h '"name"'
  content/world/*/npcs.json | wc -l`) — i.e. **121 of the 136 named,
  authored NPCs have no bespoke dialogue tree** and fall to LLM-when-salient
  / template-otherwise.
- **The main arc's five key non-player characters — Maren, Rael, Cade,
  Sael, Voss — are not in the 15.** The flagship story's supporting cast
  speaks through quest breadcrumbs (one-shot reveal text, works fine) and
  generic dialogue (template/LLM) for every other interaction. This is a
  real gap: the best-written characters in the game have no distinctive
  idle voice.
- **Procedural NPCs are additive and uncapped by the authored pool.**
  `server/emergent/procedural-npc-spawner.js`: `FACTION_TARGET = 8` per
  faction per world (env `CONCORD_FACTION_TARGET_POPULATION`), and per
  CLAUDE.md there are ~66 authored factions — so the procedural population
  alone can reach several hundred NPCs, **all of whom draw dialogue from the
  same 18-line deterministic pool** (or the salience-gated LLM, whose
  1-shot generation is itself unconstrained by any authored voice — see
  §4.3) — plus the same 5/5/7 grudge/desire/preoccupation template pool
  (§4.4).

**Concretely, what a player experiences:** talk to 10 "neutral" mood NPCs
and you will hear one of only 3 lines ("You need something?" / "I'm {act},
but I can spare a word. Speak." / "State your business and I'll hear it."),
deterministically keyed by `hash(npcId|mood) % 3` — so it's not randomized
per-visit (a plus: the same NPC is always consistent), but across a
population of hundreds of NPCs, roughly a third will share each line. This
is functional and never breaks immersion outright (no "Mmhm."-style
collapse — the T1.1 fix genuinely improved on that), but it does not clear
the CK3/RDR2 bar of "NPCs that feel like they have their own lives" at the
population scale the game actually spawns.

### 4.3 LLM-path prompt quality (salient exchanges)

The salient-exchange prompt (`routes/worlds.js:1228-1249`) is well
constructed: it feeds archetype, faction, job, current task/schedule phase,
grief level, criminal reputation, the four-axis player-state read
(`npc-player-read.js`, "what you sense about this person"), and the
asymmetry lines (grudge/preoccupation/opinion/desire) with an explicit
instruction not to recite the grudge/desire verbatim ("let it color your
tone; do not recite it verbatim" / "surface it only if the moment fits").
This is a genuinely good prompt-engineering pattern — it constrains the LLM
toward showing rather than telling, and away from secret-leakage (the
grudge/desire text passed is already player-safe prose, never
`narrative_context.secret`). It is the strongest LLM-content-quality control
point found in this audit.

### 4.4 Asymmetry (grudges/desires/preoccupations): mechanism is real, pool
is small

`npc-asymmetry.js#composeAsymmetryContext` correctly surfaces grudge/
preoccupation/desire narrative text into both the LLM prompt and the
deterministic fallback's subtext ("*They haven't forgotten
{grudge kind}.*"), gated so raw secrets never leak (verified — only `.kind`
labels reach the deterministic path, full narrative-but-non-secret prose
reaches the LLM prompt). This is a real, working "NPCs remember what you did
to them" system — the mechanism itself is sound.

But the templates are exactly 5 grudge / 5 desire / 7 preoccupation entries
(`server/lib/npc-asymmetry.js:88-112`, `DEFAULT_TEMPLATES`), and the code's
own comment says *"Minimal in-code fallbacks. Content authors override these
via content/world/*.json"* — **`grep -rl "grudge_templates\|desire_
templates\|preoccupation_templates" content/` returns nothing.** No world
ever overrode the defaults. Every grudge in the entire game is one of:
cheated at the salt market / dismissed research before the council /
undercut a deal / walked out of a circle uninitiated / "crossed me" (the
archetype-generic fallback). At population scale this is the same
repetition problem as §4.2, one level deeper in the system.

Similarly small: `composeLastWords` (`npc-legacy.js`) has 5/5/4/3/3 lines
per death-cause category (combat/ageing/starvation/refusal_dome/unknown),
and `composeOverheardSnippet` (`scheme-overhear.js`) has 6 snippets total
for every overheard scheme in the game. Individually well-written
("*Tell my brother the lock was never broken*" is a good line), collectively
thin for a system meant to make death and intrigue feel personal across
hundreds of NPCs.

### 4.5 Hooks (CK3-style leverage) — mechanically real, narratively opaque

`server/lib/hooks.js` is a real, well-integrated mechanism (blocks hostile
actions, raises scheme success odds, single-use coercion, inherits on
death — all verified wired into `npc-schemes.js` and `npc-legacy.js` per
the CLAUDE.md invariants, not re-verified line-by-line here since it's a
mechanics claim, not a writing claim). What this audit adds: hooks are
generated from secret-discovery (`generateHookFromSecretDiscovery`) but
there is no dedicated narrative-text pool for *how a hook is invoked* in
dialogue beyond generic "blackmail" scheme-branch text — worth a follow-up
check by whoever owns the schemes/hooks mechanical audit, out of scope here
since it's more mechanism than dialogue-writing.

---

## 5. LLM-generated quest content — grounding quality

Two distinct LLM-quest paths exist:

### 5.1 `oracle-brain.js#generateQuestChain` — thin, ungrounded schema

The prompt (`prompt-registry.js:569-599`, `oracleQuestComposer`) passes only
`npcId`, faction name, reputation number, player level, and an optional
recent-council-policy line. It requests a rigid 3-step JSON shape:
`{ title, steps: [{ step, objective, failCondition, reward }] }`. This is
functionally a **fetch-quest generator template** — the schema has no slot
for a moral branch, no slot for a second character, no slot for
consequence text. Even a perfectly-prompted LLM cannot produce Witcher-3-
grade content through this schema because the schema itself only has room
for "do X, or you fail, and here's your reward." This is a **structural**
ceiling, not a prompting problem.

### 5.2 `lattice-quest-composer.js` — the more interesting design

The drift-monitor-fed "lattice-born quest" system (`QUEST_TEMPLATES`,
6 drift types → 6 quest concepts: an audited metric being gamed, a belief
with no traceable origin, a capability that outgrew its scope, a circular
argument, an echo chamber, a diverging pair of signals) is genuinely
clever — it turns Concord's own reflexive self-monitoring signals into
in-world investigate/confront/resolve quests, thematically consistent with
the platform's own "verification IS the product" identity. Each template
has 2-3 title options and 2 prompt options per step (investigate/confront/
resolve), picked deterministically from the drift alert's signature hash so
re-scanning the same drift never double-spawns. This is real structural
variety (not fetch/kill/deliver) and a good design idea distinct from
anything Witcher 3 does. **However**, per-template variety is still small
(2-3 titles × 2 prompts per step = a few dozen total surface strings across
all 6 drift kinds), and — like the asymmetry templates — there's no
observed per-world override mechanism exercised in content.

### 5.3 `writeDialogueTree` — has a real, sane fallback

`oracle-brain.js#writeDialogueTree`'s deterministic fallback
(`_buildFallbackDialogue`) is generic ("As a {role}, I see what others
miss...") but functional and coherent — a reasonable last resort, not
alarming. The LLM path (`oracleDialogueTreeComposer` prompt) does pass
name/personality/role/relationship/grudge/preoccupation/desire/cosmology,
similar in quality to the salience-gated dialogue prompt in §4.3.

**Triage:** the thin 3-step quest schema (§5.1) is **ENGINEERING** — widen
the JSON contract to admit an optional branch/second-character/consequence
block, mirroring what hand-authored `moral_branch` content already does (and
which needs its own runtime per §3 anyway — these two gaps should probably
be closed together). The template-pool narrowness (§4.4, §5.2) is
**CURATION** — the code already has the override slots; someone needs to
write 5-10x more grudge/desire/preoccupation/quest-template variants per
archetype/drift-kind and place them under `content/world/*.json` or
equivalent, which is authoring work, not a missing mechanism.

---

## 6. Prioritized gap list

| # | Finding | Triage | Severity |
|---|---|---|---|
| 1 | `moral_branch` / `reputation_change` authored in 11 quest files, never read by any server or frontend code — the signature "meaningful choices" mechanic is inert | **ENGINEERING** | High — this is the single biggest gap between "the writing is Witcher-3-grade" and "the game plays like Witcher 3" |
| 2 | Only 15/136+ authored NPCs (and a much larger procedural population) have bespoke dialogue trees; the main arc's 5 key supporting characters (Maren/Rael/Cade/Sael/Voss) are not among them | **CURATION** | Medium-high — the best-written characters have no idle voice distinct from generic NPCs |
| 3 | Grudge/desire/preoccupation template pools are 5/5/7 entries total for the entire game, with an unused content-override mechanism already built | **CURATION** | Medium — real system, thin content, will read as repetitive within normal play |
| 4 | Last-words (5/5/4/3/3) and scheme-overhear snippets (6 total) pools are similarly narrow | **CURATION** | Low-medium — smaller-impact systems (death/overhear are rarer events than greetings) |
| 5 | `oracleQuestComposer`'s JSON schema has no slot for a moral branch or second character — even a well-prompted LLM is capped at fetch-quest shape | **ENGINEERING** | Medium — should likely be fixed alongside #1 so LLM-generated quests can also carry real branches |
| 6 | Two independent, non-interoperating quest engines exist (`server/emergent/quest-engine.js`, in-memory, backs authored content; `server/lib/quests/quest-engine.js`, DB-table-backed, serves `/api/worlds/:worldId/quests/active`) — noted as an architecture observation, not confirmed broken; whoever owns #1 should check which engine the fix needs to target, or both | **ENGINEERING** (investigate) | Low-medium — not verified as user-facing broken, but worth flagging so a branch-choice fix doesn't get built against the wrong engine |
| 7 | Faction quest chains (§2.2) lean on prose to carry moral interest more than on structural variety — mostly conventional 4-objective chains | **CURATION** | Low — not a defect, just an opportunity; the impossible-print/sealed-record chains show the team can do better structural variety when they choose to |

---

## 7. Real mechanical defects (separate from design judgment)

Only one rises to "defect" as opposed to "shallow but working as designed":

- **`moral_branch`/`reputation_change` dead code path** — see §3 for the
  full trace. This is the one finding in this audit that is unambiguously a
  bug-shaped gap (content authored for a mechanism that was apparently
  planned but never built, or was built and then the wiring was lost) rather
  than a "could be deeper" judgment call. Flagging for the synthesis pass:
  this is not a small fix (needs a UI presentation point, a choice-recording
  route, and a reputation-application handler across at least one and
  possibly two quest engines) — it likely needs its own unit, not a
  drive-by patch.

Everything else in this report (template pool sizes, authored-dialogue
coverage ratio, LLM-quest schema narrowness) is working as built — the
systems do what their code says they do — but the *scale* at which they're
asked to operate (hundreds of procedural NPCs, many worlds) exceeds the
*content* that was authored to feed them. That is a CURATION gap, not a
mechanical one.
