# Progression Matrix — the two leveling axes, formalized

**Status: reviewed 2026-07-23.** Every claim below was verified against live source at
the cited file:line; the XP-curve formula is pinned by `server/tests/skill-engine-xp-curve.test.js`.
Balance-review status of each constant lives in `docs/BALANCE_DIALS.md` § "Progression Matrix".

Concord has **two intentionally-separate leveling systems**. They use different
tables, different curves, different caps, and different reward surfaces. This is a
deliberate design, not a consolidation target — **do not unify them**:

- **System A** — the mechanical action-skill track: what your character *does*
  (combat, crafting, gathering, the five somatic stats). Feeds combat/craft
  bonuses, character level, talent points, mastery tiers.
- **System B** — the DTU/authored-skill mastery track: what a creator's *authored
  skills* (skill DTUs) have earned through use across the platform. Feeds mastery
  badges and marketplace signal. Long-tail, uncapped.

---

## System A — action-skill track

**Table:** `player_skill_levels` — UNIQUE `(user_id, skill_type, native_world_type)`
(migration `064_crafting_and_skills.js`).

**Entry point:** `gainSkillXP(db, userId, skillType, worldType, xpGain, opts)` —
`server/lib/skills/skill-engine.js:228`.

**The curve (pinned by `tests/skill-engine-xp-curve.test.js`):**
- A fresh skill seeds `level 1, xp 0, xp_to_next 100` (`skill-engine.js:233-237`).
- Level-up loop: `xp_to_next = 100 * level` (`skill-engine.js:260-266`) — flat,
  linear-in-level, **not** exponential. L→L+1 costs `100×L`.
- Closed form: cumulative cost L1→LN = `50·N·(N−1)` (e.g. exactly 4,500 XP reaches
  level 10).
- **Hard cap `MAX_LEVEL = 100`** (`skill-engine.js:229`). At cap, XP is **not
  discarded**: it routes into the account-wide ascension track
  (`skill-engine.js:248-254`, the D30 fix).

**Per level gained, two independent rewards fire (both best-effort try/catch —
tables are optional on minimal builds):**
1. **+1 character level** → `awardCharacterLevel` (`server/lib/skills/character-level.js:19`,
   requires `opts.worldId`). Each character level grants `UPGRADES_PER_LEVEL = 2`
   spendable bar-upgrade points; each point spent = `+UPGRADE_AMOUNT = 10` to one
   resource bar max: `hp / mana / stamina / bio_power / perception`
   (`character-level.js:8-9,59`). **These resource bars are NOT the stat skills** —
   see below.
2. **+1 talent point** → `grantTalentPoints` (`server/lib/talents.js:40`; feature
   F2.3). Spent in `TALENT_TREE` (`talents.js:14-28`): 3 branches
   (might/arcane/fortitude) with real combat effects folded into damage calc.

**Endgame overflow — ascension (D30):** `gainAscensionXp`
(`server/lib/ascension.js:34`), `ASCENSION_XP_PER_LEVEL = 500` flat
(`ascension.js:12`), 5 paragon nodes (`paragon_might/arcane/vigor/fortune/harvest`,
max rank 50, deliberately flat/no-prereq per the file's own header). Pinned by
`tests/integration/ascension-endgame.test.js`.

**Mastery tiers (T3.1, shipped):** `server/lib/skills/skill-mastery.js:30-37` —
tier `minLevel`s: novice 0 / apprentice 10 / adept 25 / expert 45 / master 70 /
grandmaster 95; input level clamped to 0–120 (`skill-mastery.js:52-56`). Each tier
carries `frameSpeed` (combat startup/recovery ×1.00→0.75), `potency` (×1.00→1.45),
`poiseBonus` (0→0.40), and a `finisher` unlock at expert+. Pinned by
`tests/integration/skill-mastery.test.js`.

### The five "stats" are System-A skills, not a stat sheet

There is **no** `player_stats` table. `strength / agility / vitality / endurance /
focus` are ordinary `player_skill_levels` rows, leveled through the same
`100×level` curve, fed by the pain/repair pipeline:

- `server/lib/embodied/pain.js:28-33` — `REGION_SKILL` map: head→focus,
  torso→vitality, arms→strength, legs→agility, systemic→endurance.
- `server/emergent/repair-cycle.js` (heartbeat, freq 20) — consumes pending
  `pain_signals` per user/region and awards
  `xp = round(totalIntensity × REGION_XP_PER_PAIN_UNIT)` with
  `REGION_XP_PER_PAIN_UNIT = 35` (`repair-cycle.js:34`), plus a short-lived
  `damage_resist` buff. Pinned by `tests/embodied-pain-repair.test.js`.

So "training your body by taking hits" is literally how the stat skills level.
New code wanting a character's strength should read the `strength` skill row —
not invent a stat table.

---

## System B — DTU/authored-skill mastery track

**Module:** `server/lib/skill-progression.js`. XP lives on the skill DTU row
itself (`dtus.total_experience` / `dtus.skill_level`), not in `player_skill_levels`.

**The curve:** `computeLevelFromExperience(totalExp) = 1 + sqrt(totalExp / XP_CURVE_C)`
with `XP_CURVE_C = 2` (`skill-progression.js:31,51-54`; env `CONCORD_XP_CURVE_C`).
The header comment (`:34-47`) documents why: this is the **D3 retune** replacing an
earlier `1 + log10(1 + exp/10)` curve so flat that level-5000 thresholds needed
~10^4999 XP — "effectively unreachable, decoration." Under sqrt: novice L10 ≈ 162 XP,
skilled L50 ≈ 4.8k, expert L100 ≈ 19.6k, master L200 ≈ 79k. **Uncapped** (unlike
System A's 100).

**Badges:** `MASTERY_THRESHOLDS` (`skill-progression.js:16-25`) — novice 10 →
adept 25 → skilled 50 (blue aura) → expert 100 (gold) → master 200 (platinum) →
legendary 500 (rainbow) → mythic 1000 (cosmic) → transcendent 5000 (void). Note
these are a *different* badge ladder from System A's `MASTERY_TIERS` — same word,
different axis, by design.

**Earn rates:** `EXPERIENCE_RATES` (`:7-14`): practice 1, cross_world_use 1.5,
teaching 3, meaningful_application 5, master_demonstration 8, hybrid_contribution 10.

**Anti-grind:** `verifyMeaningfulEvent` (`:190`) gates full-rate vs 10%;
`detectGrinding` (`:216`) zeroes XP when the last 20 events show <3 unique context
hashes; diminishing returns `1/(1+log10(level+1)×0.1)` at high level (`:92`).
Pinned by `tests/skill-progression.test.js`.

**Disambiguation:** `computeCreationQuality(skillLevel, toolQuality)`
(`skill-progression.js:56-68`) is a System-B-side quality formula and is **not**
the crafting resolver — the live crafting-quality kernel is
`server/lib/craft-resolve.js#resolveCraft` (see `docs/BALANCE_DIALS.md` for its
reviewed constants). Don't route crafting through `computeCreationQuality`.

---

## Progression-economy adjacents

- **Gear durability is death-tied by design** — `server/lib/gear-durability.js:1-24`
  header explicitly rejects WoW's per-hit "Block Tax": equipped gear loses
  `DEATH_DECAY = 20` per death (5 deaths break a fresh item), repair is a real
  CC gold-sink scaling with item level + missing fraction. This is a deliberate
  design choice, not a missing feature. Pinned by `tests/gear-durability.test.js`.
- **Known coarse proxy (tracked follow-up):** `server/lib/tool-tree.js#craftTool`
  approximates crafting skill as `min(100, playerToolTier × 20)` instead of reading
  the real `player_skill_levels` row — being fixed in the same pass that authored
  this doc (crafting-economy unit).

## Reproduction pointers

- Curve A: `node --test server/tests/skill-engine-xp-curve.test.js`
- Cap overflow → ascension: `node --test server/tests/integration/ascension-endgame.test.js`
- Curve B + anti-grind: `node --test server/tests/skill-progression.test.js`
- Stat-skill pipeline: `node --test server/tests/embodied-pain-repair.test.js`
- Mastery tiers: `node --test server/tests/integration/skill-mastery.test.js`
