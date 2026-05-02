# Multi-World Skill System — Cross-World Effectiveness + Themed Worlds

The user described a multi-world structure where Concordia is the hub, and players travel to themed worlds (superhero, crime, fantasy, cyber, ...) where the skills they learned in one world have varying effectiveness based on the world's metaphysical / technological / biological alignment. A wizard's magic is dampened in a cyber world. A hacker can't hack in a fantasy world. As skill level rises, a master retains more effectiveness even in misaligned worlds.

This commit ships the substrate for that, plus scaffolds three new themed worlds.

## What's new

### Server-side substrate

| File | Purpose |
|---|---|
| `server/lib/skill-domains.js` | Canonical `SKILL_DOMAINS` enum (22 domains: swordsmanship, magic, gun, hacking, bio_powers, stealth, etc.) + `NEUTRAL_AFFINITY` fallback |
| `server/lib/cross-world-effectiveness.js` | `registerWorldMeta(meta)` (called by seeder), `effectivenessMultiplier({ domain, worldId, level, maxLevel })`, `scaleByEffectiveness(base, args)`, `explainEffectiveness(args)` for diagnostic UI / NPC dialogue |

**Effectiveness formula:**
```
floor      = 0.10 + 0.40 × min(1, level / maxLevel)
affinity   = world.skill_affinity[domain] ?? world.skill_affinity.default ?? 0.7
multiplier = max(floor, affinity)
effective  = base × multiplier
```

So a level-1 wizard in cyber world: `max(0.10, 0.10) = 0.10x` (10% magic — basically can't cast). A level-100 wizard in cyber world: `max(0.50, 0.10) = 0.50x` (half-strength — still useful). A level-100 wizard in fantasy: `max(0.50, 1.0) = 1.0x` (full power).

### World meta files (skill_affinity tables)

| File | World | Theme | Description |
|---|---|---|---|
| `content/world/_meta.json` | **concordia** | fantasy | Hub. Default 0.85 across the board so it doesn't penalize anyone returning to base. Strong on swordsmanship/diplomacy/crafting; weak on guns/hacking. |
| `content/world/superhero/meta.json` | **superhero** | modern | Bio powers 1.0; tech/hacking 0.85; magic **0.05** (no metaphysical substrate to channel). |
| `content/world/crime/meta.json` | **crime** | noir | Stealth/gun/weapon-attachments/martial-arts/driving 1.0. Weapon-attachment skill goes deeper here than anywhere else (caliber, recoil, suppressors, etc — sub-skills planned). Magic 0.05, bio_powers 0.3. |
| `content/world/fantasy/meta.json` | **fantasy** | fantasy | Magic/alchemy/swordsmanship/archery/crafting 1.0. **No firearms exist** — gun/weapons_modern/weapon_attachments/driving/piloting all 0.0. Hacking 0.0. Bio_powers 0.4. |
| `content/world/cyber/meta.json` | **cyber** | cyberpunk | Hacking/tech/engineering/weapon_attachments/infiltration/piloting 1.0. Magic 0.10 (trace residue rumored to leak in via emergent-substrate cracks). Bio_powers 0.50 (dampened by anti-meta countermeasures). |

### Content scaffolding

Each new themed world has `factions.json` (empty array), `npcs.json` (empty array), and `lore.json` (empty history) — ready for canonical characters when the user provides them. The substrate's emergent NPC system fills these worlds with archetype-spawned NPCs in the meantime.

### Content-seeder extension

Now also loads `_meta.json` (Concordia hub) and each subdir's `meta.json`, calling `registerWorldMeta()` for each. The seeder's return now includes `worlds: <count>` so boot logs show all loaded worlds.

## Smoke test results

```
seed result: { factions: 6, npcs: 12, lore: 12, quests: 18, worlds: 5 }
known worlds: [ 'concordia', 'crime', 'cyber', 'fantasy', 'superhero' ]

  magic        in fantasy    (lvl   1) → 1.00x
  magic        in fantasy    (lvl 100) → 1.00x
  magic        in cyber      (lvl   1) → 0.10x
  magic        in cyber      (lvl 100) → 0.50x
  hacking      in cyber      (lvl  50) → 1.00x
  hacking      in fantasy    (lvl  50) → 0.30x
  gun          in crime      (lvl  50) → 1.00x
  gun          in fantasy    (lvl  50) → 0.30x
  bio_powers   in superhero  (lvl  50) → 1.00x
  bio_powers   in crime      (lvl  50) → 0.30x
```

Lvl-50 floor is 0.30, so any skill in a hostile world tops out below that times the affinity. Magic in cyber goes 0.10 → 0.20 → 0.30 → 0.40 → 0.50 across levels 1, 25, 50, 75, 100 — the user's requested "effectiveness in other worlds increases with skill level" comes out exactly right.

## What's wired vs what's not

**Wired:** the registry, the calculator, the meta files, the seeder loading them. Any callsite can now ask `effectivenessMultiplier({ domain, worldId, level })` and get a correct answer.

**Not wired yet (callsite integration):** combat damage calculations, NPC ability resolution, and player skill displays don't currently consult this. To complete the loop, downstream phases need to:
1. Tag each skill / ability with a `domain` (magic, gun, etc.)
2. In the damage/action resolver, look up the player's current world and call `scaleByEffectiveness(baseDamage, { domain, worldId, level })`
3. Add a HUD readout (`explainEffectiveness` already returns a player-readable note like *"cyber actively dampens magic"* — drop into the skill panel)

Each of those is a focused 1-day pass. The substrate is ready.

## Open follow-ups

- **Per-world weapon-attachment sub-skills** — user specifically called out that crime world goes deeper than superhero on gun mastery (caliber, recoil, suppressors, attachment combinations). Implement as a `weapon_attachments_<sub>` domain family or a sub-skill tree under the parent domain.
- **Travel mechanic** — players currently associate with a world via city-presence. Need a travel UI / portal that updates the player's current world, recalculates effective stats, and triggers the appropriate world-load.
- **Authored canonical NPCs** for crime / fantasy / cyber — empty arrays today; user provides characters → they drop straight into each world's `npcs.json`.
- **Cross-world XP rules** — should XP earned in one world fully transfer? Skills deepen in their home world but soft-cap elsewhere. Open question for the user.
