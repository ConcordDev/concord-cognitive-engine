# MMO/RPG Completeness Audit — Concordia

**Date:** 2026-06-26 · **Branch:** `claude/mmo-rpg-design-research-p74zna`

This document does three things:
1. Defines the **21-pillar framework** for what makes an MMO/RPG *complete and playable*, grounded in
   external research (GDC, Raph Koster, MMO postmortems, and design breakdowns of WoW/FFXIV/GW2/ESO/
   OSRS/Genshin/New World/Lost Ark). Full citations in `docs/research/MMO_RPG_GENRE_RESEARCH.md` (the research pass
   that backs this doc; ~80 sources).
2. **Scores Concordia** against each pillar (Solid / Partial / Thin / Missing) with concrete file paths.
3. Tracks the **completion work** done in this initiative and the remaining backlog.

The headline finding: **Concordia is already a feature-deep MMO/RPG**, not a demo. Production-grade
combat, 8-tier progression, a creator-royalty economy, 40+ NPC-simulation modules, authored + procedural
quests, factions/parties/marriage, 5 world-zone types + seasons + housing/land-claims, dungeons/raids/
world-bosses, 12+ minigames, 6 interactive stations, and a Three.js render stack with procedural
animation. "Completion" here means **closing genre-standard UX gaps, fixing verified defects, and
guaranteeing wiring integrity** — not rebuilding the game.

---

## The 21 pillars — what "complete & playable" requires

For each pillar: the completeness bar + the retention driver (condensed from the research pass).

| # | Pillar | Completeness bar (research) | Retention driver |
|---|---|---|---|
| 1 | Core loop / game-feel | Tight, legible do→feedback→reward→repeat loop; responsive controls + juice | The motor of retention; viscerality confirms impact |
| 2 | Character systems | Class/archetype identity, primary+derived stats, build customization, a "paper doll" | Legible mastery ladder; meaningful build choices = identity |
| 3 | Progression & power curve | Controlled growth vs. a content curve; *perceived* growth via visible numbers | Primary session-to-session hook; gate content behind the curve |
| 4 | Itemization & loot | Rarity ladder w/ per-ilvl stat budget, drop tables, color language | Dopamine engine; over-rewarding collapses rarity meaning |
| 5 | Crafting & professions | Gather→refine→produce, recipes, quality tiers, *relevant* outputs | Parallel progression + economic engine + social interdependence |
| 6 | Economy (sinks/faucets) | Balanced faucets + sinks (repair, AH cut, luxury, consumption) | Without sinks: inflation cliff devalues the reward loop |
| 7 | World & exploration | Meaningful POI density, landmarks, tunable navigation aids | "Density outperforms volume" (New World); world-as-endgame (GW2) |
| 8 | Quests & narrative | Main spine + side/dynamic content, clear quest-state UX, variety | Dynamic events + agency-before-lore drive investment |
| 9 | NPCs & living world | Schedules, routines, roles, ecological coherence | World worth returning to *between* content drops |
| 10 | Social systems | Friends, guilds w/ benefit, parties, chat, LFG | Strongest barrier-to-exit; social graph must live in-game |
| 11 | Group & endgame content | Dungeons/raids/world-bosses at tiered difficulty | Retains the committed cohort; must exist *at launch* |
| 12 | Endgame/retention cadence | Predictable releases + daily/weekly repeatables | 4–6 wk cadence ≈ +25–35% D90 retention |
| 13 | Death & consequence | A calibrated cost + clear respawn | Loss aversion makes gains meaningful; tune to audience |
| 14 | Player expression | Cosmetics/transmog, mounts, pets, housing editor | Horizontal retention; never invalidates; monetization-safe |
| 15 | UX/UI/QoL | HUD (health/resource/action/minimap/target/buffs), tooltips, QoL | Friction layer; addon ecosystems reveal what should be native |
| 16 | Onboarding/NPE | Guided first session, fast first-win, agency before lore | Day-1 retention is decided here |
| 17 | Multiplayer infra | Authoritative server, interest mgmt, sharding, anti-cheat | Invisible when right, fatal when wrong |
| 18 | Accessibility & input | Remap, text size, colorblind, subtitles, controller | Remap/text/colorblind/subtitles capture most of the benefit |
| 19 | Audio/visual polish | Art direction, telegraphs, hit confirms, reactive music, juice | Polish *is* viscerality; underpolish reads as cheap |
| 20 | Live-ops/community | Content pipeline, seasons, events, responsive community loop | Live-ops *is* the retention strategy for a service game |
| 21 | Performance | Stable FPS in dense scenes, fast loads, graceful degradation | Gates everything else; stutter drives rage-quits |

---

## Concordia scorecard (verified against code)

| # | Pillar | Score | Evidence (file paths) |
|---|---|---|---|
| 1 | Core loop / game-feel | **Solid** | `lib/combat-impact.js`, `lib/combat/impact-feel.js`, `components/world-lens/CombatInputController.tsx`; gather/craft/quest loops wired |
| 2 | Character systems | **Solid** (+ new sheet) | `lib/skills/character-level.js` (`player_resource_bars`), `lib/skill-progression.js`; **new** `CharacterSheetPanel.tsx` surfaces the paper-doll |
| 3 | Progression & power curve | **Solid** | 8 mastery tiers `lib/skills/skill-mastery.js`, `lib/skill-evolution.js`, no-cap character levels |
| 4 | Itemization & loot | **Solid** (durability gap) | `lib/loot-generator.js`, `lib/resources.js`, `lib/craft-resolve.js`; **gap:** gear durability/repair (backlog) |
| 5 | Crafting & professions | **Solid** | `lib/craft-resolve.js`, `lib/craft-chains.js`, `lib/tool-tree.js`, `lib/glyph-spells.js` |
| 6 | Economy (sinks/faucets) | **Solid** | `economy/royalty-cascade.js`, `lib/auctions.js`, `economy/withdrawals.js`, `lib/npc-marketplace.js` |
| 7 | World & exploration | **Solid** | `lib/world-zones.js`, `lib/seasons.js`, `lib/procgen-regions.js`, `lib/land-claims.js`; **fixed:** minimap player marker |
| 8 | Quests & narrative | **Solid** | `lib/quests/quest-engine.js`, `lib/lattice-quest-composer.js`, `content/quests/`; **fixed:** respond-path deterministic fallback |
| 9 | NPCs & living world | **Solid** | 40+ `lib/npc-*.js` modules (routines/economy/schemes/nemesis/legacy); **fixed:** NPC ambient barks now have a receiver |
| 10 | Social systems | **Solid** | `lib/parties.js`, `lib/lfg.js`, `lib/friend-presence.js`, `lib/marriage.js`, `lib/player-trade.js` (trade UI exists) |
| 11 | Group & endgame content | **Solid** | `lib/dungeon-instance.js`, `lib/world-bosses.js`, `lib/sovereign/raid-event.js`, `lib/party-combat.js` |
| 12 | Endgame/retention cadence | **Solid** | `lib/achievement-engine.js` (38), `lib/weekly-objectives.js`, `emergent/personal-beat-scheduler.js`, seasonal achievements (no battle pass by design) |
| 13 | Death & consequence | **Solid** | `lib/player-corpse.js`, `lib/npc-legacy.js`, `lib/avatar-scars.js` |
| 14 | Player expression | **Solid** (+ real customizer) | `lib/player-housing.js`, `lib/mounts.js`, `CompanionRosterPanel.tsx`; **fixed:** CharacterCustomizer now uses a real `appearance.options` catalog (no fabricated data) |
| 15 | UX/UI/QoL | **Partial → improving** | Inventory/quests/settings/map exist; **new:** character sheet, ability-cooldown HUD, target nameplate; **gaps:** durability bars, in-world AH browse |
| 16 | Onboarding/NPE | **Solid** | `OnboardingTutorial.tsx`, `FirstWinWizard`, `content/quests/onboarding.json` |
| 17 | Multiplayer infra | **Solid** | spatial chunking, anti-cheat (`_validateCombatReach`/`_validateDamageCap`), shard protocol; **fixed:** unknown-macro masking |
| 18 | Accessibility & input | **Solid** | `components/accessibility/*`, `useGamepad`, subtitles/screen-reader bridge; **fixed:** `player:low-health` a11y event now emitted |
| 19 | Audio/visual polish | **Partial** | procedural animation + VFX strong; **gaps (POLISH_AUDIT):** light-attack hitstop, whiff SFX, recorded audio assets |
| 20 | Live-ops/community | **Solid** | world-event scheduler, festivals, announcements, drift→quest pipeline |
| 21 | Performance | **Solid** | LOD/draw budgets, SSGI/PCSS presets, heartbeat overrun telemetry |

---

## Completion work — this initiative

### Verified defects fixed (each with a test)
- **P0 — unknown-macro masking** (`server/server.js` `/api/lens/run`): unregistered `(domain,action)` was
  routed to the utility brain and returned as `{ok:true, source:"utility-brain"}`, masking typo'd/dead
  macros as real results (root cause of PLAYTEST #3/#11/#25/#27). Now fails fast with `unknown_macro`;
  brain catch-all preserved behind explicit opt-in. *(e2e tests)*
- **dtu.create phantom-success data loss** (#32): the `pipelineCommitDTU` result was ignored, so a
  pipeline-rejected commit still returned `{ok:true, dtu}` while the row never persisted → `dtu.get`
  "not found". Now propagates the real outcome. *(e2e round-trip test)*
- **player:low-health** phantom listener: the world page subscribed but nothing emitted it. Now emitted
  on the NPC-attack victim path below 30% HP. *(wired receiver↔emitter)*
- **Minimap** hardcoded `playerPosition={{x:0,y:0}}` → real avatar position in the buildings' scene frame.
- **maintenance-gates** detector emitted `{title,detail,file}` → rendered as `undefined — undefined`,
  hiding a real schema-drift critical. Now canonical `{id,message,location}`. *(regression test)*
- **CharacterCustomizer fake data**: fabricated wardrobe options replaced with a real `appearance.options`
  macro (renderer enums from `lib/world-lens/character-schema.ts` + owned outfits). *(11 server + 6 vitest)*
- **NPC `/dialogue/respond`** flat-stub fallback (#1): added `composeDeterministicResponse` — per-choice
  in-character replies grounded in archetype/job/faction/quest; wired at both fallback points. *(5 tests)*

### Features added (genre-standard QoL gaps)
- **Character Sheet** panel (vitals/skills/derived power, upgrade-point spend) on the existing
  `/api/crafting/character/:worldId` backend.
- **Ability Cooldown HUD** (radial sweeps, ready/desaturated states) on `world.combat-prefs-*`.
- **Target Nameplate** (focused-enemy name + live health + lock mode) on lock-on + NPC health + combat events.
- **Orphan socket emits + dead CustomEvents** wired to real receivers (NPC barks, node/loot updates,
  combat juice, etc.) — see commit history.

### Verification (this initiative)
- Full-frontend `tsc --noEmit` → **exit 0** (Wave A HUDs mounted in the world page + all wiring).
- New e2e tests (unknown-macro fail-fast, dtu.create round-trip) + the full `tests/e2e/api-routes.test.js`
  → **38/38 pass** against spawned servers.
- Touched-area server tests (combat-anti-cheat, npc-dialogue-fallback, maintenance-immune, appearance-domain)
  → **44/44**; Wave A vitest → **11/11**; CharacterCustomizer vitest → **6/6**.
- `node scripts/verify-lens-backends.mjs` → **258 WIRED / 0 broken / 0 PARTIAL** (2 by-design).

### Remaining backlog (verified-real, prioritized)
- **Gear durability + repair** end-to-end (migration + wear hooks + repair NPC sink + durability bars).
  Research: tie decay to *death* not per-ability (WoW "Block Tax" anti-pattern); broken = no stats.
- **Schema-drift batch** (~105 sites, `scripts/verify-schema-drift.mjs`): mostly try/catch-swallowed; the
  maintenance-gates critical is now honest about it. Ratchet the floor toward 0.
- **POLISH_AUDIT feel seams**: light-attack hitstop, whiff SFX, recorded audio assets, lock-on camera.
- **In-world auction/marketplace browse + price-check** (backend `lib/auctions.js` exists; surface it).
- **Untuned balance constants** (`docs/BALANCE_DIALS.md`, Phase-D first-draft set): pin to researched values.

> Notes on stale findings: several PLAYTEST_FINDINGS_PLAN §6 items (e.g. the auth-mount R4/R6/R8 set)
> are **stale** — `requireAuth` is a hybrid that handles both direct + factory call styles, so the
> film-studio/billing mounts work. Verify §6 items against current code before acting; do not fix
> non-bugs.

---

## Phase 2 — Verification engine + hardening + topology (this initiative, cont.)

Beyond the game-completeness pass above, this initiative added a self-auditing verification layer and
closed real infrastructure gaps (see `docs/INVARIANT_ENGINE.md`, `docs/DEPLOYMENT_TOPOLOGY.md`):

- **Orchestrated Invariant Engine** — auto-derived contracts for **2,599 macros** (445 domain files from
  the live registry), an adversarial runner (`macro-assassin`: seed / NaN-Infinity-injection fuzz /
  invariant proof against the **real `runMacro`**), a live runtime wrapper, and a ratcheted CI gate
  (`audit:adversarial` + `.github/workflows/adversarial-audit.yml`). First run drove **2,574 macros
  adversarially → 0 hard crashes**, baseline **11 violations** (mostly heavy-macro timeouts) after fixing
  the one real bug it caught (`hypothesis.get` null return). Honest: not "all 9,600 flawless" — a working
  verifier that ratchets violations toward 0 per commit.
- **Adversarial hardening (real gaps closed)** — `sanitizeVector` + world-bounds teleport wired into the
  position-ingestion choke point (closed a real exploit: a `NaN` coordinate bypassed the anti-cheat speed
  gate), JSON-depth guard, socket-event token bucket on `combat:attack`, per-entity TOCTOU locks on
  craft/trade/gather. 41 adversarial tests.
- **New game features** — gear durability/repair; Character Sheet / Ability Cooldown HUD / Target
  Nameplate; event-UI consolidated into `WorldEventBoard`; in-world auction browse; mount summon/stamina
  HUD. (Friends, player-trade, housing, companion roster were already wired — left intact.)
- **Deployment topology** — recommendation: keep client-side render (WebGPU opt-in already scaffolded),
  reserve the RunPod Blackwell GPU for the 5-brain cognition; pixel streaming spec'd as an optional
  flagged tier (needs a dedicated render GPU). GPU-cognition claims audited: LLM inference is real/
  maximized; GPU-accelerated JS macros + GPU invariant-eval are category errors (documented, not faked).

**Closeout gates (green):** lens-wiring 258 WIRED / 0 broken · detector ratchet 0 new high/critical ·
invariant baseline 0 hard crashes · all per-feature test suites pass (gear 16, hardening 41, Wave-A 11,
game-tails 21, invariant-eval 9, dialogue 12, appearance 11, e2e api-routes 38). Advisory doc-claims
drift (CLAUDE.md structural counts grew with the new domain/migration) is surfaced by the non-blocking
`check-doc-claims` monitor — expected, not a regression.

## Reproduction

- Genre research + per-gap implementation patterns: `docs/research/MMO_RPG_GENRE_RESEARCH.md`
- Wiring-integrity audit: `docs/research/WIRING_INTEGRITY_AUDIT.md`
- Lens wiring: `node scripts/verify-lens-backends.mjs` (258 WIRED / 0 broken)
- Detectors: `cd server && node scripts/run-detectors.js`
