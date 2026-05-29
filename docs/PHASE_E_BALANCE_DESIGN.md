# Phase E — Balance & Design (research-grounded)

Source: 5-angle deep-research pass (isekai/LN, Bethesda RPGs, manhwa progression-fantasy,
unmet player desires, proven game-feel numbers). Every recommendation cites the finding
that drives it. This turns Concordia's first-draft dials + open design decisions into
defensible values. **Core constraint (user pin): no level cap — skills grow forever via
use + evolution, and authored NPCs level constantly too.**

---

## 0. The one law all five angles agree on: power must never outrun stakes

This was the single most-corroborated finding — it surfaced *independently* in four of the
five research angles:
- **Isekai**: OP-MC-with-no-stakes is the #1 fan criticism; the genre's critical peaks
  (Mushoku Tensei, Re:Zero, Bookworm) all keep high/earned growth but preserve a "can fail
  at the frontier" margin.
- **Bethesda**: Oblivion's 1:1 level-scaling (bandits in glass armor) made the player level
  up but never *feel* stronger — the canonical scaling failure.
- **Manhwa**: Solo Leveling's most-cited flaw is that once the MC is overpowered, "battles
  carry almost no emotional weight" and the plot "spirals into boredom"; readers cite Jeju
  Island as the peak precisely because tension was highest there.
- **Player wishlists**: the recurring ask is progression that's *earned through skill, not
  time* (anti-Skinner-box).

**Implication for Concordia's no-cap design — RELATIVE scaling, not 1:1:**
- The player SHOULD feel godlike against the *common* world (the isekai power fantasy is
  real and good — let trash mobs get curb-stomped; that's the dopamine).
- A roster of **authored/named NPCs scales at-or-above the player** to remain the stakes
  layer. This is the New-Vegas-faction-rival × isekai-rival hybrid, and it's exactly what
  the user's "authored characters level constantly too" pin already encodes.
- **Recommended scaling rates** (the decisive dial — matters more than the XP curve shape):
  - Common/ambient NPCs: scale to roughly **70–85%** of player power tier (player outgrows
    them → power fantasy preserved).
  - Named/authored rivals + world bosses: scale to **100–110%** of player tier (always a
    credible threat → stakes preserved).
- Schedule deliberate "you lose / barely win / are out-thought" beats (Re:Zero, Jeju) via
  world bosses, crises, and named-rival encounters — the close calls are what players
  remember. Sources: gamerant.com/best-isekai-anime-overpowered-main-characters-op-mc/,
  screenrant.com/starfield-skyrim-comparison, cbr.com/solo-leveling-criticisms-flaws-problems/,
  massivelyop.com/2025/07/03/massively-overthinking-is-vertical-progression-still-sustainable.

---

## 1. Combat feel — concrete ms windows (verdict: already close; minor tuning)

Proven ranges (Celeste, Street Fighter 6, Smash, SF2, Vlambeer *Art of Screenshake*):
| Window | Proven value | Concordia current | Verdict |
|---|---|---|---|
| Coyote time | ~83ms (Celeste 5f); range 80–150ms | **120ms** | ✅ keep (generous end of range) |
| Jump buffer | 100–150ms (6–9f) | **130ms** | ✅ keep (dead center) |
| Input buffer | 3–6 frames (~50–110ms); SF6 ~5f | **110ms** | ⚠️ top of range — test **~90ms** to avoid over-buffering specials |
| Hitstop (light) | ~50ms | impact-feel mapped | set light ≈ **50ms** |
| Hitstop (heavy/crit) | ~150–200ms (SF2 ~167ms) | ~80ms heavy currently | ⬆️ **bump heavy → ~150ms** to sell weight |
| Kill freeze | ~20ms + screenshake + knockback (Vlambeer) | 200ms kill + juice | ✅ have shake+knockback; the additive stack is correct |

- **The Skyrim-"floaty"-combat cautionary baseline is the thing you've already solved:**
  damage numbers alone never create feel — flinch/stagger + impact cues do. Concordia's
  momentum-stagger (poise vs momentum) + reflex wince + DamageBillboard + knockbackKinematic
  is precisely the hit-react loop Bethesda is faulted for missing. *Protect this; it's a
  differentiator.* Sources: celeste.ink/wiki/Tech, maddythorson.medium.com/celeste-forgiveness,
  streetfighter.fandom.com/wiki/Buffer, critpoints.net (hitstop), neogaf.com Skyrim-melee threads,
  theengineeringofconsciousexperience.com (Art of Screenshake).

---

## 2. Progression curve — the no-cap reframe

- **Research default is accelerating cost (cubic `L³`, Pokémon Medium-Fast → 1M XP @ L100;
  RuneScape doubles every ~7 levels).** Concordia's `1+sqrt(exp/2)` → `xpForLevel(L)=2(L−1)²`,
  i.e. per-level cost grows only ~linearly — **gentler late-game than cubic.**
- **With no cap, curve shape is secondary** — absolute level is decoupled from challenge by
  the relative-scaling in §0. So the sqrt curve's fast-early feel (tested, mastery thresholds
  reachable) is fine to keep. The decisive dial is the NPC-scaling rate, not `XP_CURVE_C`.
- **Adopt the manhwa layered cadence** instead of fixating on the curve:
  - **Raw level = the frequent small number** (sqrt is fine — keep XP gains legible/visible).
  - **Skill-evolution every ~10 levels = the periodic big spike.** Dramatize it: the
    water-gun→pressure-jet→hydro-pump transform should fire as a named, screenshot-worthy
    "Arise"-style beat via LevelUpJuiceBridge — the reveal IS the reward (Solo Leveling
    job-change/awakening ceremonies).
  - **A public rank ladder decoupled from level = the social/stakes axis** (isekai guild
    ranks: everyone starts E-rank *regardless of level*; rank earned via deeds/endorsements).
    You have faction reputation — surface it as an explicit E→S grade so even a maxed player
    still has something to *prove* when entering a new faction/region.
- **Keep `detectGrinding` on.** It directly implements the most-requested anti-Skinner-box
  ask (mastery from meaningful use, not repetition). Sources:
  bulbapedia.bulbagarden.net/wiki/Experience, oldschoolrunescape.fandom.com/wiki/Experience,
  gamedeveloper.com "How to define XP thresholds", solo-leveling.fandom.com/wiki/System,
  tsukimichi.fandom.com/wiki/Adventurer's_Guild.

---

## 3. Visible system HUD — the addiction surface

Manhwa progression-fantasy gives a directly portable spec: the addictive loop is a
**constantly-visible numeric HUD with four surfaces — stat window, quest/notification feed,
inventory, skill tree** — plus a *dependable* effort→growth contract (effort reliably
converts to growth; stalled/random progression breaks it). Concordia has the surfaces;
Phase E work is presentation: make XP/skill/level deltas always legible, and make the
evolution beats dramatic. Sources: solo-leveling.fandom.com/wiki/System, samerrabadi.com,
royalroad.com/forums/thread/136644.

---

## 4. Run-mode session pacing (verdict: already in the sweet spot)

- Proven target **25–35 min** (Hades), with **persistent payout on every run, win OR lose**
  (Hades advances story each run so a loss still "paid out"). Concordia: horror **25 min** ✅,
  time-loop **30 min** ✅ — both already in range. Keep.
- **Ensure every run-mode (roguelite/horde/extraction) grants persistent meta-progress even
  on a loss** (you have roguelite meta-currency/unlocks — verify horde/extraction also pay
  out on death). This is the "failure-feels-fair" contract.
- **Risk-scaled burst growth**: tie run XP/loot to the difficulty tier so audacity yields
  outsized spikes (Solo Leveling "one dangerous dungeon jumps you multiple levels"). Maps to
  your run-difficulty tiers. Sources: twoaveragegamers.com/best-roguelikes-short-sessions,
  steamcommunity.com Hades discussions, goodnovel.com (burst leveling).

---

## 5. Courtship / relationships — earned, not a heart-meter grind

- Stardew benchmark: **fixed points-per-tier (250/heart)**, **small per-interaction gains**
  (talk +20 = 1/12th heart, forcing repeated presence not one-shot grinding), and
  **preference/exclusivity multipliers** (loved gift +80, birthday ×8, dance = full heart) so
  progress reads as *knowing the person*, not optimizing a bar.
- The named failure mode (from player wishlists) is **romance-as-shallow-heart-meter**; the
  ask is romance as **"a complicating story force with shared stakes"** (BioWare benchmark:
  "the character is bigger than the love story").
- **Concordia mapping** (current: `COURT_AFFINITY_DELTA 0.05`/interaction, affinity 0..1,
  `MIN_AFFINITY_TO_PROPOSE 0.60`, heart-events at 0.3/0.6/0.85):
  - Keep the small per-interaction delta — ~12–20 interactions to court reads as earned.
  - **Add preference multipliers** (a loved/known gift should bump several× a generic one —
    you have the gift system; wire the multiplier).
  - The **heart-event scenes ARE the "earned intimacy" beats** — that's already the right
    shape; keep them gated behind affinity milestones.
  - **Make the spouse a complicating force, not a trophy**: your spouse-follows/helps
    behavior is the start — extend it so the spouse reacts to *your* choices (approves/
    disapproves of factions, schemes, deaths), the thing players say is missing.
  - Optional light **exclusivity**: juggling many courtships slows each (opportunity cost =
    meaning). Sources: stardewvalleywiki.com/Friendship, gamerant.com Stardew friendship,
    kotaku.com playersexual-romance, thekenpire.com (BioWare), nzlighter.wine, ricedigital.co.uk.

---

## 6. NPC depth & world reactivity — the competitive moat (protect, don't dilute)

Concordia's feature set reads as a checklist of "things players keep asking for and not
getting." Several are competitively moated:
- **Persistent per-NPC memory** (grudges/opinions/schemes/relationships) answers the #1
  cited reason worlds feel dead ("NPCs reset to factory settings 5s after any interaction").
  The fix players describe is *continuity, not smarter AI* — exactly your model.
- **The Nemesis System (enemies who remember & seek revenge) is the most-requested reactivity
  feature AND is patent-locked until 2036** (shipped in exactly one other game ever). Your
  `npc_nemesis` graph is a legally-distinct equivalent — lean into it as a headline feature.
- **NPC gossip / reputation propagation** (your social-NPC bridge + shadow DTUs) is a named
  ask.
- **Death/legacy/inheritance** (Crusader Kings / Wildermyth / Rogue Legacy — beloved,
  underused) = your npc-legacy/bloodline/dynasty.
- Everyone else under-delivers because reactivity hits **combinatorial explosion** (hand-
  authoring every consequence is financially prohibitive). Concordia's escape hatch is the
  DTU substrate + LLM brains generating *grounded* reactive content — the structural answer.
- **Bookworm/Tensura lessons**: systemic consequence (your actions ripple through economy/
  politics/class) is the deepest "worth living in"; and base/town-building structures must
  *meaningfully change capability*, not trickle cosmetic passives (a note for land-claims/
  factory/housing). Sources: dev.to/pranjal_raut (NPC memory), engadget.com (Nemesis patent),
  gdcvault.com Crusader Kings emergent stories, medium.com/@filiph (combinatorial explosion),
  cbr.com/best-isekai-anime-ascendance-of-a-bookworm, rpgfan.com Tensura review.

---

## 7. Exploration structure — keep authored-first (don't Starfield it)

- Bethesda's load-bearing pillar: **"see it → reach it" + hand-placed discovery density +
  environmental storytelling** (Skyrim staffed 8 dungeon designers vs Oblivion's 1).
- Starfield is the cautionary case: **procedural breadth + menu/loading-screen travel killed
  the exploration pull** ("a game about exploration, without exploration"; an insider design
  director blamed procedural generation for "samey" planets).
- **Concordia mapping**: your 9 authored sub-worlds are the meal; procgen-regions are
  seasoning. Keep authored density primary; never let procedural filler or load fragmentation
  become the main traversal. Reward the curious player who deviates with stumbled-upon
  authored content. Sources: gamesradar.com (Todd Howard mountain), pcgamer.com (Skyrim
  hand-crafted), n4g.com/Eurogamer (Starfield exploration), gamesradar.com (Nesmith on
  procedural).

---

## Priority order for the playtest-driven tuning pass
1. **Nail relative scaling (§0)** — the one law; everything else is secondary to "do I feel
   strong but still threatened by named characters."
2. **Combat feel micro-tune (§1)** — drop input buffer ~90ms, raise heavy hitstop ~150ms.
3. **Dramatize skill-evolution beats + surface the rank ladder (§2–3).**
4. **Verify every run-mode pays out on loss + risk-scaled XP (§4).**
5. **Add gift-preference multipliers + spouse reactivity (§5).**
6. **Protect the NPC-memory/nemesis moat; don't dilute under perf pressure (§6).**
