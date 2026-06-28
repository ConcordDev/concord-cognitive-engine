# MMO / RPG Game-Design Completeness Research

Research compiled June 2026 to inform completion of a large MMO/RPG. Draws on GDC talks, Raph Koster, game-design wikis, MMO postmortems, retention/live-service analyses, and design breakdowns of WoW, FFXIV, GW2, ESO, OSRS, Genshin, New World, Lost Ark. All URLs in the Sources section.

---

# PART 1 — The Completeness Framework (21 Pillars)

For each pillar: (a) what "complete & playable" requires, (b) what specifically drives playability + retention.

## 1. Core Loop / Game-Feel
**(a) Complete & playable:** A clearly-defined, tight core loop — the repeatable "do action → get feedback → get reward → spend reward to do action again" cycle that the player runs hundreds of times. The loop must be legible (player can predict roughly how long one iteration takes and what they gain) and the moment-to-moment "feel" must be responsive. Steve Swink frames game feel as *"real-time control of virtual objects in a simulated space, with interactions emphasised by polish"* — responsiveness (minimal delay from intent→input→action→feedback), intuitiveness, and viscerality.
**(b) Playability/retention drivers:** The core loop is the *motor of retention*: a layered model has a Base Layer (the loop), a Retention Layer that drives players back through it, and a Superfan Layer giving long-term goals to repeat it. Every action wants confirmation feedback — hit-stop, screen-shake, sound, animation — that confirms severity and impact ("juice"). New World's failure is the cautionary case: shallow action combat means "the fun runs out quicker" because little emergent gameplay is possible, so the loop must either be deep or be backed by everything else. Sources: gamedesignskills (core loops), gamesbrief (core loop motor of retention), gamedesignskills (game feel), Swink/Medium, New World postmortems.

## 2. Character Systems
**(a) Complete & playable:** Class/archetype identity, stats (primary + derived), abilities, and a build-customization layer (talents/specs/skill trees) that lets a player express intent. The "paper doll" (equipped items + derived attributes) is the canonical surface. Players must be able to read their own power and understand *why* a change helps.
**(b) Playability/retention drivers:** Koster's theory is the spine — fun is a byproduct of learning and mastering patterns, so character systems must offer a legible mastery ladder (new skills to learn, new patterns to recognize). Meaningful build choices create identity and replay; cookie-cutter "one correct build" kills it. FFXIV's "any job on one character" and ESO's unlimited professions reduce alt friction and increase per-character investment. Sources: Koster Theory of Fun summaries, Wowpedia character info, FFXIV/ESO crafting threads.

## 3. Progression & Power Curve
**(a) Complete & playable:** A controlled growth rate for player power (levels, stats, gear, abilities) matched against an enemy/content power curve so threat keeps pace. The XP curve sets pacing — a steep/exponential curve makes each level momentous; a shallow curve gives rapid early progression. Players must *perceive* growth via visible numbers, new abilities, UI feedback, and unlocked content.
**(b) Playability/retention drivers:** Progression is the most measurable form of "am I getting stronger?" and is the primary session-to-session hook. The pitfall: scaling enemy power as a band-aid so "nothing really changes from one number to the next" — players notice when growth is illusory. Gate content behind the curve to keep the threat level rising. Horizontal progression (GW2 masteries/cosmetics) is a viable alternative to the gear treadmill that avoids invalidating old gear. Sources: Game-Wisdom/Bycer power curves, Grasp RPG stat curves, GW2 horizontal-progression wiki/forums.

## 4. Itemization & Loot
**(a) Complete & playable:** A rarity ladder (common → uncommon → rare → epic → legendary) with a stat *budget per rarity/item-level* so items of equal ilvl scale to equal stats; loot tables tuned to drop sources; and clear visual/feedback language (color-coding) for rarity. Higher rarity = more affixes / better budget, not just bigger numbers.
**(b) Playability/retention drivers:** Loot is a primary dopamine engine and the most direct expression of progression. Strong distribution keeps the power curve fair and gives a sense of achievement; "smart loot" (drops biased to your class/spec) reduces frustration. Legendaries gated behind the hardest content sustain aspiration. Over-rewarding (everything is epic) collapses the meaning of rarity. Sources: gamedeveloper five-tips, draftbrowns loot insights, mmo-champion stat-budget thread, TV Tropes color-coded tiers.

## 5. Crafting & Professions
**(a) Complete & playable:** Gathering professions → refining → production professions, with recipes, skill-up progression, quality tiers, and useful outputs (gear, consumables, housing items). Either "you are everything you need" (accessible) or interdependent specialization (SWG-style) — both valid, but the choice is foundational.
**(b) Playability/retention drivers:** Crafting is a parallel progression track and a major economic engine. The genre "spent its first decade building community through mandatory interdependence and its second decade dismantling it for accessibility" — interdependence creates social/economic bonds (retention) at the cost of convenience. FFXIV's crafting is a beloved minigame in its own right with endgame crafted gear commanding real market value; ESO's unlimited professions reward investment. Crafted gear must be *relevant* (BiS or near-BiS, or consumables raiders need) or crafting becomes vestigial. Sources: mmorpg.gg crafting list, mmoedge, FFXIV/ESO threads, Bakharev social-systems piece.

## 6. Economy (Sinks / Faucets)
**(a) Complete & playable:** Balanced faucets (currency *sources*: mob kills, quests, dungeon completions) and sinks (currency *removal*: repair bills, AH cut, vendor luxury items, training costs, mounts, housing). Item sinks (binding, consumption, durability loss) matter as much as gold sinks. Economic health is about *velocity* (how fast money changes hands), not just total supply.
**(b) Playability/retention drivers:** Without adequate sinks, hoarding and inflation create an "economic cliff" for new players and devalue earned currency, eroding the reward loop. WoW's AH cut (5–15%) and repair bills are among its biggest sinks; OSRS distinguishes money sinks from item sinks (luxury items, high-alch). Negative feedback (diminishing returns, scaling costs, progressive taxes, caps) prevents runaway inequality. A healthy economy makes trading and crafting feel meaningful — a broken one collapses several other pillars. Sources: Wowpedia/Wikipedia gold sink, OSRS sink wiki, Medium economy design, Machinations GDC three pillars.

## 7. World & Exploration
**(a) Complete & playable:** A traversable world with *meaningful density* of points of interest, landmarks, secrets, vistas, and reasons to deviate from the path. Navigation aids (map, compass, waypoints) that don't fully replace exploration. Verticality, biomes, and hand-crafted landmarks layered over procedural fill.
**(b) Playability/retention drivers:** New World's core lesson: *"meaningful density outperforms raw content volume"* — vast empty tracts between generic landmarks read as emptiness regardless of map size. GW2 ties exploration to reward (map completion, vistas, hidden jumping puzzles) and meta-events so the world itself is endgame. The tension: "GPS" minimaps and waypoint-following can take focus away from the world; the best games (RDR2) let players tune navigation aids. Sources: Bakharev world-design piece, New World postmortems, GW2 endgame wiki, resetera minimap threads.

## 8. Quests & Narrative
**(a) Complete & playable:** A main narrative spine, regional/side content, and clear quest-state UX (objectives, trackers, turn-in). Variety beyond "kill 10 / fetch 5." Pacing that respects player time. Either authored linear story or systemic dynamic events — ideally both.
**(b) Playability/retention drivers:** GW2's dynamic events replace exclamation-mark quests: players are *notified of nearby events* (no spawn-camping), events cascade with real world consequences (defeat the dredge army → push into their base; fail → they fort up in your territory), and promote cooperation over competition. Authored narrative drives emotional investment but can backfire — FFXIV's lengthy A Realm Reborn (~50h) is a documented *onboarding barrier* even though the story is the franchise's emotional payoff. The fix: front-load agency and gameplay, back-load lore. Sources: GW2 dynamic-event wiki/overview, Kaylriene NPE critique, FFXIV onboarding threads.

## 9. NPCs & Living World
**(a) Complete & playable:** NPCs with schedules, routines, roles, and reactions that make the world feel inhabited rather than static set-dressing. Ecology where creatures belong to and shape their environments. At minimum: daily schedules, ambient activity, and context-aware dialogue.
**(b) Playability/retention drivers:** "Creatures should be part of their environments and, at a glance, appear to belong" — ecological coherence sells immersion cheaply. The emergence pattern: give NPCs simple top-down rules that generate complex bottom-up outcomes (Ryzom's Atys). The modern realistic target is *hybrid*: hand-crafted narrative + procedural fill + AI-generated flavor/dialogue. Critically, the design problem is "not how to make every NPC smarter, but how to organize social behavior to stay scalable, steerable, interpretable." Living-world systems retain players by making the world worth returning to *between* content drops. Sources: gamedeveloper Living Worlds, firstmonday Ryzom, arxiv holodeck/CASCADE, Bakharev world-design.

## 10. Social Systems
**(a) Complete & playable:** Friends list, guilds/clans with mechanical benefit, party/group formation, chat channels, and grouping tools (LFG → automated matchmaking). The social graph must live *inside* the game.
**(b) Playability/retention drivers:** Social ties are the strongest retention/barrier-to-exit mechanic — "when the social layer moves outside the game, developers lose the ability to leverage social connections." Guild officers/leaders are far less inclined to quit. Guild anti-patterns: (1) guilds as cosmetic tags with no benefit, (2) mega-guild perk incentivization, (3) incumbency traps suppressing new-guild formation. The LFG spectrum (free-text spam → bulletin board → manual listings → cross-server auto-matchmaking) is "the genre's most consequential design axis for community health": automation adds convenience but erodes the friend-making that builds the social graph. Sources: Bakharev social-systems piece, SSRN guild/friend retention study, MassivelyOP barrier-to-exit, Kaylriene matchmaking.

## 11. Group & Endgame Content
**(a) Complete & playable:** Repeatable group content at multiple difficulty/commitment tiers — dungeons (5-man), raids (8–40), trials/world-bosses, and challenge ladders. Tuned difficulty curve from "pug-able" to "world-first." Loot/reward gating that justifies the effort.
**(b) Playability/retention drivers:** Endgame is what keeps the committed cohort. FFXIV stratifies into Savage (current-patch gear progression) and Ultimate (no-reward skill superbosses) — different audiences, both retained. WoW concentrates ~12 bosses current for ~9 months; FFXIV distributes fewer bosses on tighter 6-month cadence but adds extreme trials + alliance raids (~15 bosses over 9 months). New World's endgame failure ("end-game players had nothing to do") is the canonical loss case — group content must exist *at launch*, not be promised. Sources: FFXIV raid wiki/guides, mmo-champion endgame thread, EGM world-first, New World postmortems.

## 12. Endgame / Retention Cadence
**(a) Complete & playable:** A predictable rhythm of content releases (major patch → tier → seasonal event) plus daily/weekly repeatable activities that bridge the gaps. Reset timers that give a fresh checklist without demanding 24/7 play.
**(b) Playability/retention drivers:** Cadence directly moves retention numbers: live-service games shipping content every 4–6 weeks see *25–35% higher Day-90 retention* than 8–12 week cycles (at 40–60% higher dev cost). Daily/weekly lockouts (Lost Ark's Chaos Dungeons ×2, Guardian Raids ×2, Una's Tasks ×3 daily / ×3 weekly) create a "log in regularly" loop — but over-gated grind ("repetitive and mundane") drives churn, which is why Lost Ark itself cut grind. The art is a checklist that's satisfying, finite per session, and not punishing to miss. Sources: generalistprogrammer live-ops, Lost Ark daily-checklist/grind-cut articles, NoobFeed session loop.

## 13. Death & Consequence
**(a) Complete & playable:** A death mechanic that imposes *some* cost (corpse run, durability loss, XP debt, repair gold, item loss) calibrated to the game's risk/reward stakes. A clear respawn flow. Consistency so players can plan around risk.
**(b) Playability/retention drivers:** Death penalty is "the constant counterpoint of risk in the risk-vs-reward equation" — without potential loss, gains feel insignificant. Loss aversion makes a substantial penalty (EQ's XP debt) feel more meaningful than a pure time-tax (corpse run). But penalty must match audience: harsh penalties retain hardcore players and repel casuals; penalty-free death (modern WoW) maximizes accessibility at the cost of tension. Corpse runs reward skill (skilled players reclaim quickly; unskilled waste time). Tune to your stakes. Sources: Wolfshead death penalty, MassivelyOP death-penalty guide, Engadget MMO mechanics, MMORPG.com corpse-run debate.

## 14. Player Expression (Housing / Cosmetics / Mounts / Pets)
**(a) Complete & playable:** Cosmetic systems (transmog/dyes/skins), mounts (functional + collectible), pets/companions, and housing/decoration with a usable placement editor. These are *parallel* to power progression, not gated behind it.
**(b) Playability/retention drivers:** Expression is the backbone of *horizontal* retention — GW2 explicitly makes cosmetics (dyes, skins, legendary effects, mount skins, glider skins) an endgame in itself, giving non-numerical goals that never invalidate. Housing and collectibles create personal investment and "barrier to exit." Cosmetics are also the monetization-safe surface (sell skins, not power). ESO housing earns high marks for tiered/budgeted/culturally-themed options. The pitfall is a *frustrating editor* (FFXIV's restrictive placement is widely criticized) — the system must feel good to use. Sources: GW2 endgame wiki, ESO/FFXIV housing articles, MakePlace.

## 15. UX / UI / QoL
**(a) Complete & playable:** Legible core HUD (health/resource/action bars/minimap/target frame/buffs), inventory management, tooltips that explain stats, and quality-of-life conveniences (auto-sort, search, favorites, loadouts). Information density tuned so the player isn't overwhelmed or under-informed.
**(b) Playability/retention drivers:** UX is the friction layer — every unnecessary click compounds across thousands of sessions. WoW's mature UI is a benchmark (and its addon ecosystem — Plater, WeakAuras, Auctionator, TSM — reveals exactly which QoL gaps players will fix themselves, i.e. what should be native). The modern AH redesign (working search, favorites, no-addon undercutting) shows the trend: absorb the best community QoL into the base game. Poor UX doesn't churn players on day 1, it bleeds them over time. Sources: Wowpedia character info, AH UX articles, Plater/cooldown-manager addon docs.

## 16. Onboarding / New-Player Experience
**(a) Complete & playable:** A guided first session that teaches the core loop quickly, gets the player to "first win" fast, layers complexity gradually, and reaches *agency* before lore. Tutorialization for each major system, surfaced at the moment of first use.
**(b) Playability/retention drivers:** Day-1 retention is decided here. Both WoW and FFXIV are documented as "kind of bad at it" — FFXIV's ~50h ARR slog is a real funnel leak even though it pays off later. The fix is well-understood: front-load gameplay/agency, diversify content early (FFXIV unlocks PvP/Deep Dungeons by L30), and never make the first hour feel "more like watching a movie than playing." A confused new player never reaches the retention systems. Sources: Kaylriene NPE critique, FFXIV onboarding threads, toomuchgaming NPE.

## 17. Multiplayer Infrastructure
**(a) Complete & playable:** Authoritative server architecture, interest management / area-of-interest culling, zoning/sharding/regionalization for scale, stateless frontend proxies for connection handling, and netcode that hides latency (client prediction + reconciliation, anti-cheat validation).
**(b) Playability/retention drivers:** Infra is invisible when right and fatal when wrong — New World's launch is partly an infra/queue story. Split network thread from game-logic thread so I/O never blocks simulation. Interest management (per-entity area-of-interest) bounds the resource cost of dense areas. Sharding partitions the player base; zoning partitions the world; replication copies hot spaces. Regional servers reduce lag for geographically dispersed players. A laggy or unstable launch poisons word-of-mouth permanently. Sources: PRDeving MMO architecture series, Edgegap fleet manager, arxiv MMO/IoT scalability.

## 18. Accessibility & Input
**(a) Complete & playable:** Full control remapping, adjustable text size, colorblind modes/filters, adjustable subtitles/captions (size, color, background, speaker names, non-verbal sounds), hold-vs-toggle options, and difficulty/assist options. The Game Accessibility Guidelines (basic/intermediate/advanced) are the standard checklist.
**(b) Playability/retention drivers:** The four most-complained-about gaps are *remapping, text size, colorblindness, and subtitle presentation* — fixing these alone captures most of the audience benefit. Accessibility widens TAM and improves UX for *all* players (custom layouts, readable text). Diablo IV's 50+ accessibility features set the modern bar. These are increasingly table-stakes and platform-cert requirements, not optional polish. Sources: gameaccessibilityguidelines basic/full list, testdevlab, AbleGamers Includification, MS accessibility-for-games.

## 19. Audio / Visual Polish
**(a) Complete & playable:** Consistent art direction, readable VFX (telegraphs, hit confirms), responsive SFX on every interaction, ambient soundscape, music that reacts to state, and "juice" — screen-shake, hit-stop, particles, satisfying pops/chimes on rewards.
**(b) Playability/retention drivers:** Polish *is* viscerality (Swink) — it's how the game communicates impact and reward, and it's the difference between a loop that "feels good" and one that feels flat. "Juice" (screen-shake on hit, pop on pickup, button micro-animations) makes a game feel alive and reactive and directly amplifies the satisfaction half of the core loop. Audio confirms severity ("how badly you've been hurt"). Underpolished feedback makes even mechanically-sound systems feel cheap. Sources: gamedesignskills game feel, "Juice it or Lose it," Swink/Medium, gamedev juicy effects.

## 20. Live-Ops / Community
**(a) Complete & playable:** A post-launch content pipeline (seasons, events, battle passes, limited-time modes), community channels (patch notes, dev blogs, feedback loops), and the tooling to ship/hotfix without long downtime. Daily/weekly/seasonal reward tracks layered.
**(b) Playability/retention drivers:** Live-ops *is* the retention strategy for a service game — content cadence (above) plus the battle pass, now "the single most important monetization mechanic," layering daily/weekly/seasonal tasks into a structured reward path that gives "consistent reasons to return without overwhelming." Limited-time events create engagement spikes. Community responsiveness (acknowledging grievances — Lost Ark cutting grind, "we moved too fast" New World mea culpa) repairs trust. The retention loop: give a reason to log in, then offer paid acceleration that feels like the fastest satisfying path. Sources: generalistprogrammer live-ops, Fortnite battle-pass evolution, Adjust live-ops, New World interview.

## 21. Performance
**(a) Complete & playable:** Stable framerate in dense scenes, fast load/zone times, bounded memory, and graceful degradation under load. Server tick stability. Scalable settings for varied hardware.
**(b) Playability/retention drivers:** Performance gates *everything else* — a beautiful living world at 12fps in a capital city is unplayable. Architecturally this ties to infra: interest-management culling, lockless queues, thread separation, and LOD/culling on the client all keep dense multiplayer scenes (raids, world bosses, hub cities) responsive. Stutter and rubber-banding directly drive rage-quits; consistent performance is a silent retention multiplier. Sources: PRDeving lockless queues + architecture, Edgegap scaling.

---

# PART 2 — Implementation Patterns for Specific UI/System Gaps

Each: how genre leaders implement it + a concrete recommended approach (data needed, UX behavior, common pitfalls).

## 1. Character Sheet / Stats Panel
**How leaders do it:** WoW's character info frame is a "paper doll" — equipped items on a body silhouette plus a stats panel. The default UI under-shows stats, so the community built CharacterStatsClassic, Chonky Character Sheet (sectioned, reorderable, show/hide rows, diminishing-returns tooltips, class/spec stat priorities), and DejaClassicStats. This reveals exactly what players want: more derived stats, grouping, and contextual "is this good for my spec?" hints. Resistances appear as a magic-mitigation block.
**Recommended approach:**
- **Data:** primary stats (str/agi/int/sta or your equivalents); derived stats (crit %, haste/attack-speed, mastery, armor, dodge/parry/block, hit/expertise, spell power, weapon DPS, defense ratings); resistances per damage school; movement speed; computed offense (effective DPS) and defense (effective HP / mitigation %) summaries; full buff/debuff list with **remaining duration** and stack count.
- **UX:** sectioned, collapsible groups (Attributes / Offense / Defense / Resistances / Misc). Hover tooltips that translate rating→percentage and show diminishing-returns thresholds. A small "DPS" / "Armor" headline number so players get a one-glance power read. Optionally a stat-priority hint for the active spec. Live-update on gear swap/buff change.
- **Pitfalls:** showing raw ratings without the resulting % (players can't act on "320 crit rating"); not showing buff durations (the #1 thing nameplate/buff addons add); a flat unsorted wall of 30 stats. Don't make players install an addon to understand their own character.

## 2. Minimap / Compass HUD
**How leaders do it:** Minimap = corner map showing the player relative to the world and its inhabitants; compass = top-of-screen bar steering toward the next goal. Both carry POI/quest/custom markers ("blips"). RDR2 is the customization benchmark (off / on / compass-only / resize, changed without pausing). Common debate: GPS-style minimaps pull focus off the world.
**Recommended approach:**
- **Data per blip:** world position, type (self/party/NPC-friendly/NPC-hostile/POI/quest-objective/resource-node/vendor), icon, color, and a priority for culling. Quest objectives carry an on-edge clamped arrow when off-map.
- **UX:** circular or square minimap, rotate-with-player *or* fixed-north toggle (with a North marker). Cull by distance and by max-blip-count per category (priority-sorted) so dense hubs don't flood. Edge-clamp off-screen quest markers as directional arrows. Compass bar shows heading + clamped objective markers with distance. Provide a settings toggle for size/opacity/enable, ideally without pausing.
- **Pitfalls:** rendering every entity (perf + clutter — apply per-category caps and distance culling); markers that don't update smoothly (interpolate); over-reliance that turns the game into "follow the dot." Fog-of-war is optional and genre-dependent — discovery-gated maps (reveal as you explore) add exploration value; full-reveal maps prioritize convenience. For an exploration-forward design, lean discovery-reveal; for a convenience-forward design, full reveal with optional toggle.

## 3. Target Nameplate / Focused-Enemy Frame
**How leaders do it:** WoW nameplates float above units showing health, cast bar, and limited auras, letting players monitor many units without relying only on the target frame. Class-colored health bar with semi-transparent background, fill = current health %. Plater (the dominant addon) adds target-of-target above the bar ("T: [name]"), debuff/CC icons, and prominent highlighting of dangerous/encounter-critical casts. Midnight-era nameplates natively widened buff/debuff display and CC clarity.
**Recommended approach:**
- **Data:** unit name, current/max health (+ %), faction/hostility color, cast bar (spell name, cast progress, interruptible flag), active status effects (buffs/debuffs with icon + duration + stacks), and target-of-target (who this unit is attacking — critical for tanks/healers). Optional: classification (elite/boss), level, threat/aggro indicator.
- **UX:** focused target frame is larger and persistent (top-center or near player frame); nameplates are lightweight and many. Show **target-of-target** so a tank can see if the boss is on them. Show **debuff durations** as countdown text/sweep. Highlight interruptible casts distinctly (color + icon). Class/role-color the health fill.
- **Pitfalls:** omitting cast bars (combat becomes unreadable — players can't react to mechanics); omitting target-of-target (tanks can't confirm aggro); too many auras with no filtering (filter to "mine + dispellable + dangerous"); nameplates that overlap illegibly in packs (stacking/declutter logic).

## 4. Ability Cooldown Tracker
**How leaders do it:** WoW's Cooldown widget renders a "clock-like" radial sweep + leading-edge over the ability icon. For **charge-based** abilities the convention is precise: while recharging with 1+ charges available, *DrawSwipe is disabled but DrawEdge is enabled* — the icon is **not** shaded (a charge is usable) but still shows the clock edge counting toward the next charge. The **global cooldown** (GCD) is a short shared sweep across all abilities triggered by most actions. Wowhead documents a native Cooldown Manager; WeakAuras/TweaksUI add grids, charge text, and GCD sweeps.
**Recommended approach:**
- **Data per ability:** cooldown total + remaining, GCD remaining, charge count + max charges + per-charge recharge timer, usable/unusable flags (resource/range), and active-buff state.
- **UX:** radial sweep (dark overlay shrinking clockwise) over the icon with remaining-seconds text for long CDs. Render the short GCD sweep separately/subtly so it doesn't read as a full cooldown. For charges: show the **count badge** (e.g. "2"), keep the icon lit while any charge remains, and run the edge/swipe only for the *next* recharging charge. Desaturate when out of resource/range.
- **Pitfalls:** treating a recharging charged ability as fully on-cooldown (hides that a charge is ready); GCD sweep indistinguishable from real cooldowns (players misread availability); no remaining-time text on long CDs; not desaturating unusable abilities (false "ready" signal).

## 5. Gear Durability + Repair (the gold-sink balance)
**How leaders do it:** WoW: repair bills have existed since vanilla as "both a gold sink and a roleplaying feature." Durability decays from death and (historically) combat events. This created an asymmetry — Protection Warriors took *double* durability damage via Shield Block (the derided "Block Tax"), penalizing the very thing the spec exists to do. Patch 12.0.7 (2026) **removed combat-event durability damage entirely**, leaving death/time as the wear source, specifically to de-bias fast-weapon/shield users. "Broken" gear (0 durability) provides no stats until repaired. OSRS uses item degradation/charges (e.g. barrows armor, crystal gear) as both gold and item sinks rather than universal durability. ESO uses repair kits + vendor repair, lighter as a sink.
**Recommended approach:**
- **Data:** per-item current/max durability, decay events (death = large chunk; optionally light per-hit), repair cost formula (scales with item level + missing durability), and a "broken" threshold where stats disable.
- **UX:** durability bar in inventory/character panel; warning toast at ~20% and at 0%; one-click "Repair All" at vendors with cost preview; optional repair-kit/mobile-repair item; visual gear-damage cue at low durability.
- **Balance:** make decay *symmetric* across classes/specs — WoW's Block Tax is the textbook anti-pattern. Tie the *primary* decay to death (so repair cost scales with how much you're dying/failing — a skill-correlated sink) rather than to ability usage. Keep "broken = no stats" as a real consequence but never let it brick a player mid-content with no recourse. Size repair cost so it's a *noticeable but not punishing* gold sink (a meaningful fraction of dungeon income, not a wipe tax).
- **Pitfalls:** per-ability/per-block decay (asymmetric punishment); repair costs so high they gate participation; durability that never matters (vestigial sink); no warning before gear breaks.

## 6. Auction House / Marketplace UX
**How leaders do it:** WoW's modern native AH has working search, a non-dated interface, favorites (star next to search bar), and basic undercutting without addons. Power-user addons reveal the full feature set: **Auctionator** (drag item from bag → auto-show current market price → one-click undercut → post), advanced search operators (exact match, exclusion, and/or), green-check / red-cross cheapest indicators; **TSM** (operations/automation, price sources, batch posting). Key market mechanic: at equal price the *most recently posted* auction sells first, so retail's default undercut is *0 copper* — re-posting at match-price jumps you to the front of the queue.
**Recommended approach:**
- **Data:** listings (item, qty, unit price, total, seller, time-left), market price history / current-lowest per item, favorites list, your active auctions + their cheapest-status flag.
- **UX:** **Search:** text + filters (category, rarity, level range), exact/exclude operators, favorites for repeat checks. **Price-check:** show current lowest + recent average when posting (don't make the player guess). **Posting flow:** drag from bag → pre-fill suggested price (match or undercut by a tiny default) → set qty/stack/duration → confirm. **Manage:** list your auctions with a cheapest/undercut indicator (green check / red cross) and a one-click re-post. Buying: clear total-cost confirm, partial-stack purchase.
- **Pitfalls:** no price guidance (new players list at absurd prices and never sell); requiring an addon for basic competitiveness; a posting flow with too many clicks (kills volume sellers); not surfacing "you've been undercut." Decide your queue rule deliberately (recency-wins vs. price-wins changes undercut behavior). Bake in the AH cut as an economy sink (5–15%).

## 7. Player-to-Player Trade UI
**How leaders do it:** The universal pattern is a **two-side window with independent Ready/Confirm locks**: each player places items/currency on their side; each must click "Ready"; the trade only completes when *both* are ready. The critical anti-scam rule: **any change to either side resets both Ready states**, so a scammer can't swap the goods after you've confirmed. WoW added *timed confirmations* specifically to stop scripts that traded away all your gold; Roblox uses a confirmation pop-up + notification. Many games treat trades as final/irreversible (IdleMMO: no reimbursement for scams).
**Recommended approach:**
- **Data per side:** item slots + quantities, currency amount, ready/locked boolean, and a server-authoritative escrow that holds both sides until atomic swap.
- **UX:** side-by-side panels (yours / theirs), drag items in, set currency, then a two-stage **Ready → Confirm**. Display the *full* contents of the other side clearly (icon + name + qty + rarity color). **Lock-on-change:** mutating either side un-readies both and shows a "contents changed" flash. Optional short timer/second confirm for large-value trades (WoW pattern). Atomic, single-transaction swap on the server (both sides move or neither does).
- **Pitfalls:** not resetting ready-state on change (the classic bait-and-switch scam); non-atomic transfer (one side gives, server hiccups, items lost); tiny/ambiguous item display (players misread what they're getting); no value confirmation on large trades. Make it irreversible-but-safe: prevent the scam at the UI rather than promising refunds you can't honor at scale.

## 8. Mount Summon/Dismiss + Mount Stamina
**How leaders do it:** ESO — one key (H) to summon and to unsummon; mount **stamina** is the buffer absorbing hits before you're dismounted; mounts upgrade speed/stamina/capacity at a stablemaster (gold + 20h real-time per upgrade — a time + gold sink). GW2 — each mount type has its **own endurance bar** that fuels special movement (the endurance % is shared across mounts but *not* with the player's dodge endurance); dedicated mount-action keys (V/C) and an Engage skill. Quick mount/dismount animations (ESO/BDO/LOTRO) add immersion vs. mounts that just appear.
**Recommended approach:**
- **Data:** per-player mount roster, active mount, mount stamina/endurance (current/max, regen rate, drain per special action), mount stats (speed, capacity), and combat-dismount rules.
- **UX:** single toggle key to summon/dismiss with a short cast/animation (interruptible by damage). Mount stamina bar visible while mounted, separate from player stamina. Special movement (sprint/dash/glide/double-jump) drains mount stamina; regen on cooldown when not sprinting. Auto-dismount on combat or on stamina depletion in hostile context. Upgrade sink (gold + time) for speed/stamina/capacity.
- **Pitfalls:** instant pop-in mounts feel cheap (add a quick animation); sharing mount stamina with player dodge/stamina (confuses two resources — keep them separate like GW2); no visible stamina bar (players can't pace dashes); summoning allowed mid-combat as an escape exploit (gate it).

## 9. Companion / Pet Management UI
**How leaders do it:** Genshin separates *cosmetic pets* (gadgets that float around you, no gameplay effect) from *combat companions* (party characters) and *housing companions* (move characters into your realm to interact). Party-loadout tools (community party-builders analyze elements/constellations/weapons to suggest teams) reveal what a management UI should surface: per-companion stats, role, synergy, and a saveable loadout. The cleanest companion UX is a roster grid + active-slot loadout + per-companion detail/equip panel.
**Recommended approach:**
- **Data:** companion roster (id, species/type, level, role, stats, abilities, loyalty/mood, equipped gear/skin), active-slot assignments, and saveable loadouts.
- **UX:** roster grid (filter/sort by type/level/role); click → detail panel (stats, abilities, equip slots, rename, dismiss/summon, appearance). An **active-loadout** bar showing currently-summoned companion(s) with a one-click swap. If companions are combat-relevant, show their HP/abilities on the HUD and a simple stance/behavior toggle (passive/defensive/aggressive). Separate cosmetic pets from functional companions in the UI so players don't confuse them.
- **Pitfalls:** burying companion stats so players can't tell which is best; no saved loadouts (re-summoning friction); mixing cosmetic and functional pets in one confusing list; no behavior control for combat pets (they pull mobs / stand idle). Keep summon/dismiss one click; keep the detail panel one click deeper.

## 10. Housing Management + Decoration Preview
**How leaders do it:** WoW's upcoming system is the modern UX bar: decor **auto-aligns** to floor/wall/ceiling by type, keeps aligning around corners, has **collision** with other decor and structures (no clipping into walls), and uses **gimbals** (on-object 3D handles) to move/rotate on all three axes including free-floating in air. FFXIV uses a Move tool (X/Y/Z) + Rotate tool (X/Z axis) but is widely criticized as restrictive/outdated — players resort to the external MakePlace tool to preview/edit/share layouts. ESO earns high marks for tiered, budgeted, culturally-themed homes with generous item caps.
**Recommended approach:**
- **Data:** per-house item placements (item id, position x/y/z, rotation, surface-affinity, scale), item caps, ownership/permissions (visitors/editors), and a serializable layout (for sharing/snapshots).
- **UX:** an **edit mode** with on-object gimbals for translate/rotate (and optionally scale) on all 3 axes; **surface snapping** by decor type (rugs→floor, paintings→wall) with a free-float toggle; **collision** to prevent lost-in-wall items; a **ghost/preview** of placement before confirming; grid snap toggle; copy/duplicate; undo/redo; and save/share layout. Permission tiers for co-decorators.
- **Pitfalls:** the FFXIV trap — overly restrictive placement that forces external tools and frustrates the very players who love the feature; no collision (items vanish into geometry); no free-axis control (can't float/angle decor); no preview before commit; punishingly low item caps. Decoration is a *creative* system — the editor's *feel* is the feature; make placement smooth, snappy, and forgiving (undo is essential).

---

# Sources

## Part 1 — Framework
- Designing The Core Gameplay Loop — https://gamedesignskills.com/game-design/core-loops-in-gameplay/
- The Core Loop: a motor of retention (Gamesbrief) — https://www.gamesbrief.com/2019/05/the-core-loop-a-motor-of-retention/
- GDC Vault — Player Retention with Game Design in MMORPGs — https://www.gdcvault.com/play/1450/Player-Retention-with-Game-Design
- GDC Vault — MMO Retention: Learning from the First 25 Years — https://www.gdcvault.com/play/1012238/MMO-Retention-Learning-from-the
- GDC Vault — Building Sustainable Game Economies: Three Design Pillars (Machinations) — https://gdcvault.com/play/1028982/Building-Sustainable-Game-Economies-The
- A Theory of Fun for Game Design (Koster) summary — https://www.befreed.ai/book/a-theory-of-fun-for-game-design-by-raph-koster
- A Theory of Fun review (Liz England) — https://lizengland.com/blog/review-a-theory-of-fun-for-game-design-by-raph-koster/
- Power Curves in Game Design (Game Wisdom) — https://game-wisdom.com/critical/power-curves-game-design
- How Power Curves Work in Video Games (Bycer) — https://medium.com/@GWBycer/how-power-curves-work-in-video-games-3ab04517fb20
- RPG System Design: Experience, Levels & Stat Curves (Grasp) — https://paths.grasp.study/public-courses/cbd93ffc-1946-433a-bd46-0d9489cdaa7c/modules/edf7d6da-d14c-48bc-9f76-ba97e6a2d654/lessons/b92d0265-1035-4015-b800-421826f8ca4e
- Five tips for making better loot experiences — https://www.gamedeveloper.com/design/five-tips-for-making-better-loot-experiences-in-games
- Loot Generator Insights — https://draftbrowns.com/loot-generator-treasure-types-rarity-item-distribution
- Do items have a stat budget based on rarity? — https://www.mmo-champion.com/threads/1965786-Do-items-have-a-stat-budget-based-on-rarity
- Color-Coded Item Tiers (TV Tropes) — https://tvtropes.org/pmwiki/pmwiki.php/Main/ColorCodedItemTiers
- Gold sink (Wowpedia) — https://wowpedia.fandom.com/wiki/Gold_sink
- Gold sink (Wikipedia) — https://en.wikipedia.org/wiki/Gold_sink
- Sink (economy) — OSRS Wiki — https://oldschoolrunescape.fandom.com/wiki/Sink_(economy)
- Designing Game Economies: Inflation, Resource Management, Balance — https://medium.com/@msahinn21/designing-game-economies-inflation-resource-management-and-balance-fa1e6c894670
- So You Want to Build an MMO 8/18 — World Design & Level Architecture (Bakharev) — https://medium.com/@alexander.bakharev_16063/so-you-want-to-build-an-mmo-8-18-world-design-level-architecture-c07798d17f1c
- So You Want to Build an MMO 6/18 — Social Systems & Community Architecture (Bakharev) — https://medium.com/@alexander.bakharev_16063/so-you-want-to-build-an-mmo-6-18-social-systems-community-architecture-62ab56185d53
- New World Launch Post Mortem (Aggronaut) — https://aggronaut.com/2021/10/01/new-world-launch-post-mortem/
- What can we learn from New World MMO (MMORPG.com) — https://forums.mmorpg.com/discussion/509147/in-terms-of-the-philosophy-of-mmo-game-design-theory-what-can-we-learn-from-the-new-world-mmo
- New World interview: "we've made mistakes by moving too fast" — https://www.pcgamesn.com/new-world/interview-post-launch-scot-lane
- Endgame — Guild Wars 2 Wiki — https://wiki.guildwars2.com/wiki/Endgame
- GW2 Horizontal Progression and Reward Structures (forum) — https://en-forum.guildwars2.com/topic/111441-guild-wars-2-horizontal-progression-and-reward-structures/
- Dynamic event — Guild Wars 2 Wiki — https://wiki.guildwars2.com/wiki/Dynamic_event
- Dynamic Events Overview (ArenaNet) — http://gw2101.gtm.guildwars2.com/en/the-game/dynamic-events/dynamic-events-overview/
- FFXIV Savage & Ultimate Raid Guide (Dawntrail 2026) — https://accountshark.net/blog/ffxiv-savage-ultimate-raid-guide
- Raids — FFXIV Wiki — https://ffxiv.consolegameswiki.com/wiki/Raids
- Is it possible to enjoy FFXIV if I only like endgame (mmo-champion) — https://www.mmo-champion.com/threads/2622751
- How MMO Players Race for World First (EGM) — https://egmnow.com/if-youre-not-first-youre-last-how-mmo-players-race-for-world-first-clear/
- New Player Experience: WoW and FFXIV Are Kind Of Bad At It (Kaylriene) — https://kaylriene.com/2023/08/14/new-player-experience-is-important-but-wow-and-ffxiv-are-kind-of-bad-at-it/
- FFXIV New Player Experience (Too Much Gaming) — https://www.toomuchgaming.net/blog-news/final-fantasy-xiv-new-player-experience
- Living Worlds: The Ecology of Game Design — https://www.gamedeveloper.com/design/living-worlds-the-ecology-of-game-design
- Ryzom / Atys living world (First Monday) — https://firstmonday.org/ojs/index.php/fm/article/download/8127/7414
- Towards a Holodeck-style Simulation Game (arxiv) — https://arxiv.org/pdf/2308.13548
- CASCADE: Social Coordination with Controllable Emergence (arxiv) — https://arxiv.org/pdf/2604.03091
- Impacts of Guild & Friend Systems on Retention (SSRN) — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4606486
- How strong communities are barriers-to-exit (MassivelyOP) — https://massivelyop.com/2015/04/12/mmo-mechanics-is-a-strong-community-a-barrier-to-exit-mechanic/
- Matchmaking Systems and Social Breakdown in MMOs (Kaylriene) — https://kaylriene.com/2021/05/22/a-match-made-in-well-somewhere-matchmaking-systems-and-social-breakdown-in-mmos/
- The Death Penalty Mechanic and Loss Aversion (Wolfshead) — https://wolfsheadonline.com/the-death-penalty-mechanic-and-loss-aversion-in-mmo-design/
- Massively OP's guide to MMORPG death penalties — https://massivelyop.com/2016/03/05/massively-ops-guide-to-death-penalties/
- MMO Mechanics: Exploring death mechanics (Engadget) — https://www.engadget.com/2014-01-15-mmo-mechanics-exploring-death-mechanics.html
- Corpse Run vs. Penalty-Free Deaths (MMORPG.com) — https://www.mmorpg.com/columns/mmo-friday-fight-round-10-corpse-run-vs-penalty-free-deaths-2000133850
- Mount — Guild Wars 2 Wiki — https://wiki.guildwars2.com/wiki/Mount
- ESO Mounts Guide — https://mmonster.co/blog/eso-mounts-guide
- Live Operations Games: Complete Guide — https://generalistprogrammer.com/live-operations-games
- Fortnite's Battle Pass Evolution — https://explore.st-aug.edu/exp/fortnites-battle-pass-evolution-how-a-single-game-shaped-live-service-gaming
- The Session Loop That Defines Modern Live-Service Gaming 2026 (NoobFeed) — https://www.noobfeed.com/articles/session-loop-modern-live-service-gaming-in-2026
- Live-ops for mobile games (Adjust) — https://www.adjust.com/blog/what-is-live-ops/
- Lost Ark: Daily Checklist For Endgame Content (TheGamer) — https://www.thegamer.com/lost-ark-daily-checklist-endgame-content/
- Lost Ark is cutting back grind (PCGamesN) — https://www.pcgamesn.com/lost-ark/grind-year-two-new-content
- MMO Architecture: Optimizing Server Performance with Lockless Queues (PRDeving) — https://prdeving.wordpress.com/2025/01/02/mmo-architecture-optimizing-server-performance-with-lockless-queues/
- MMO Architecture: client connections, sockets, threads (PRDeving) — https://prdeving.wordpress.com/2023/10/13/mmo-architecture-client-connections-sockets-threads-and-connection-oriented-servers/
- How MMO Games' Architecture Scales with Edgegap — https://edgegap.com/blog/how-mmo-games-architecture-scales-with-a-smart-fleet-manager
- Game Feel: A Beginner's Guide — https://gamedesignskills.com/game-design/game-feel/
- Game Feel and Player Control: Lessons from Steve Swink (Medium) — https://medium.com/design-bootcamp/game-feel-and-player-control-lessons-from-steve-swink-beae0ea1987f
- Juice it or Lose it (GameJuice) — https://gamejuice.co.uk/resources/juice-it-or-lose-it
- A Survey of Game Feel (Pichlmair & Johansen, arxiv) — https://arxiv.org/pdf/2011.09201
- Basic — Game Accessibility Guidelines — https://gameaccessibilityguidelines.com/basic/
- Full list — Game Accessibility Guidelines — https://gameaccessibilityguidelines.com/full-list/
- Video Game Accessibility Testing (TestDevLab) — https://www.testdevlab.com/blog/video-game-accessibility-testing
- A Practical Guide to Game Accessibility (AbleGamers Includification) — https://accessible.games/wp-content/uploads/2018/11/AbleGamers_Includification.pdf

## Part 2 — UI / System Implementation
- CharacterStatsClassic (CurseForge) — https://www.curseforge.com/wow/addons/characterstatsclassic
- Chonky Character Sheet (CurseForge) — https://www.curseforge.com/wow/addons/chonky-character-sheet
- Character info — Wowpedia — https://wowpedia.fandom.com/wiki/Character_info
- Minimap — Game UI Database — https://www.gameuidatabase.com/index.php?scrn=135
- Compass — Game UI Database — https://www.gameuidatabase.com/index.php?scrn=165
- HUD Navigation System (Unity) — https://discussions.unity.com/t/hud-navigation-system-radar-compass-bar-indicators-minimap/699282
- Mini Map or Compass in Open World games? (ResetEra) — https://www.resetera.com/threads/mini-map-or-compass-in-open-world-games.1026444/
- Plater Name Plates — Target of Target (CurseForge) — https://www.curseforge.com/wow/addons/plater-name-plate-target-of-target-tot
- Nameplates — Warcraft Wiki — https://warcraft.wiki.gg/wiki/Nameplates
- WoW Midnight Nameplates Guide — https://boosting-ground.com/wow-boosting/guides/leveling-guides/wow-midnight-nameplates-settings-addons
- Cooldown (UIOBJECT_Cooldown) — Warcraft Wiki — https://warcraft.wiki.gg/wiki/UIOBJECT_Cooldown
- Cooldown Manager UI Guide — Wowhead — https://www.wowhead.com/guide/ui/cooldown-manager-setup
- Show cooldown for spell charges (WeakAuras issue) — https://github.com/WeakAuras/WeakAuras2/issues/2423
- Durability changes WoW patch 12.0.7 (Blizzard Watch, 2026) — https://blizzardwatch.com/2026/05/29/durability-changes-wow-patch-12-0-7-will-help-players-save-gold-repairs-especially-protection-warriors/
- Repair Bills Cheaper for Tanks and Melee (Icy Veins) — https://www.icy-veins.com/wow/news/repair-bills-are-about-to-get-a-lot-cheaper-for-tanks-and-melee/
- Durability — Wowpedia — https://wowpedia.fandom.com/wiki/Durability
- Patch 8.3 New Auction House Interface — https://www.mmo-champion.com/content/8908-Patch-8-3-PTR-New-Auction-House-Interface-and-Updates
- Auctionator vs Auctioneer vs TSM (Medium) — https://medium.com/@worldofwarcraftguides/auctionator-vs-auctioneer-vs-tradeskillmaster-best-auction-house-addon-in-2026-c9f824cfa6f7
- WoW Auction House Guide (Epiccarry) — https://epiccarry.com/blogs/wow-auction-house-guide/
- TSM Auctioning Operations — https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations
- Player Trade — Secure Trading Between Players (CurseForge) — https://www.curseforge.com/minecraft/mc-mods/player-trade
- Disable trade warning? (mmo-champion — WoW timed confirmations) — https://www.mmo-champion.com/threads/2099900-Disable-trade-warning
- Trading — IdleMMO Wiki — https://wiki.idle-mmo.com/economy-and-trading/trading
- Trading System — Roblox Support — https://en.help.roblox.com/hc/en-us/articles/203313310-Trading-System
- ESO mount guide: unlock, summon, improve (Digital Trends) — https://www.digitaltrends.com/gaming/how-to-use-mount-eso/
- Companion — Genshin Impact Wiki — https://genshin-impact.fandom.com/wiki/Companion
- List of All Available Pets — Genshin (Game8) — https://game8.co/games/Genshin-Impact/archives/337627
- Genshin Party Builder (GitHub) — https://github.com/man90es/Genshin-Party-Builder
- MakePlace — FFXIV Housing Simulator — https://makeplace.app/
- Housing decoration system needs adjustments (FFXIV forum) — https://forum.square-enix.com/ffxiv/threads/443461-Housing-decoration-system-needs-adjustments
- Azeroth Beautiful: A Look at Housing Interior Design (mmo-champion) — https://www.mmo-champion.com/content/13156-Azeroth-Beautiful-A-Look-at-Housing-Interior-Design
- FFXIV House Decorator's Guide (MMOGah) — https://www.mmogah.com/news/ffxiv/ffxiv-house-decorator-s-guide
- Homeless in an MMO Part 3 — ESO Housing (Medium) — https://medium.com/illumination-gaming/homeless-in-an-mmo-part-3-3306db110311
