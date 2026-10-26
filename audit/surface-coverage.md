# Surface Coverage Audit

_Generated 2026-10-26T15:09:46.435Z · FLOOR=1_

**172 surfaces** · **20 shipped player-verbs** · **floor violations (score<1): 0** (target 0)

Score distribution: 0/4→34 · 1/4→103 · 2/4→12 · 3/4→18 · 4/4→5

## Top gap queue (player-frequency × channels-missing)

| rank | surface | cat | score | freq | missing |
|---|---|---|---|---|---|
| 1 | `player:move` | movement | 2/3 | 5000 | visual |
| 2 | `combat:stagger` | combat | 3/4 | 300 | legibility |
| 3 | `combat:dodge` | combat | 3/4 | 300 | legibility |
| 4 | `combat:block` | combat | 3/4 | 250 | legibility |
| 5 | `fishing:caught` | minigame | 1/4 | 70 | visual, audio, animation |
| 6 | `fishing:cast` | minigame | 3/4 | 80 | visual |
| 7 | `world:building-state` | world_state | 2/3 | 70 | legibility |
| 8 | `social:ping` | social | 2/3 | 40 | legibility |
| 9 | `combat:dodge:ack` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 10 | `combat:block:ack` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 11 | `combat:telegraph` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 12 | `companion:deployed` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 13 | `timeline:post` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 14 | `concord-link:delivered` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 15 | `walker:dispatched` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 16 | `npc:conversation-bid` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 17 | `beat:offered` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 18 | `world:region-spawned` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 19 | `world:aerial-traffic` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 20 | `whiteboard:scene-update` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 21 | `whiteboard:cursor` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 22 | `whiteboard:vote-cast` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 23 | `collab:participant-joined` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 24 | `collab:participant-left` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 25 | `message:saved` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 26 | `message:unsaved` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 27 | `message:reacted` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 28 | `message:voice-registered` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 29 | `voice:peer-joined` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |
| 30 | `voice:peer-left` | socket_event | 0/4 | 8 | visual, audio, animation, legibility |

## Floor violations (shipped verbs scoring < 1/4)

_none — floor satisfied_

## Full manifest (4-channel scores + file:line proof)

| surface | v | a | an | leg | proof |
|---|---|---|---|---|---|
| `player:move` | ⬜ | ✅ | ✅ | ▫ | a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:62 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:27 |
| `combat:stagger` | ✅ | ✅ | ✅ | ⬜ | v:concord-frontend/components/world/AdaptiveMusicBridge.tsx:203 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:154 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:363 |
| `combat:dodge` | ✅ | ✅ | ✅ | ⬜ | v:concord-frontend/components/world/CombatVFXBridge.tsx:98 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:141 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:632 |
| `combat:block` | ✅ | ✅ | ✅ | ⬜ | v:concord-frontend/components/chat/MessageRenderer.tsx:91 · a:concord-frontend/components/meditation/SoundscapePlayer.tsx:252 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:64 |
| `fishing:caught` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `fishing:cast` | ⬜ | ✅ | ✅ | ✅ | a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:222 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:78 · l:concord-frontend/components/world/EmergentEventFeed.tsx:40 |
| `world:building-state` | ✅ | ✅ | ▫ | ⬜ | v:concord-frontend/components/world/BuildingCollapseVFX.tsx:6 · a:concord-frontend/components/world/WorldAudioBridge.tsx:18 |
| `social:ping` | ✅ | ✅ | ▫ | ⬜ | v:concord-frontend/components/world/AdaptiveScoreBridge.tsx:7 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:259 |
| `combat:dodge:ack` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `combat:block:ack` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `combat:telegraph` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `companion:deployed` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `timeline:post` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `concord-link:delivered` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `walker:dispatched` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `npc:conversation-bid` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `beat:offered` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `world:region-spawned` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `world:aerial-traffic` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `whiteboard:scene-update` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `whiteboard:cursor` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `whiteboard:vote-cast` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `collab:participant-joined` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `collab:participant-left` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `message:saved` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `message:unsaved` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `message:reacted` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `message:voice-registered` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `voice:peer-joined` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `voice:peer-left` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `voice:signal` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `npc:heir-rose` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `npc:stress-break` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `npc:migrated` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `npc:funeral` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `npc:wedding` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `creature:born` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `combat:chronicle` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `scheme:overheard` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `conkay:verdict` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `productivity:reminder-fired` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `forecast:alert-triggered` | ⬜ | ⬜ | ⬜ | ⬜ | — |
| `combat:dodge:perfect` | ✅ | ⬜ | ⬜ | ⬜ | v:concord-frontend/components/world/CombatVFXBridge.tsx:232 |
| `combat:parry:perfect` | ✅ | ⬜ | ⬜ | ⬜ | v:concord-frontend/components/world/CombatVFXBridge.tsx:233 |
| `world:clock` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/concordia-hud/HUDContextProvider.tsx:311 |
| `quest:new` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/QuestTracker.tsx:144 |
| `player:effect-applied` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/concordia/hud/ActiveEffectsBar.tsx:5 |
| `quest:lattice-born` | ✅ | ⬜ | ⬜ | ⬜ | v:concord-frontend/components/world/CinematicTriggerBridge.tsx:45 |
| `npc:perception-update` | ✅ | ⬜ | ⬜ | ⬜ | v:concord-frontend/components/world/NpcPerceptionBridge.tsx:6 |
| `macro:started` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/conkay/conkayHudStore.ts:10 |
| `macro:stage` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/conkay/conkayHudStore.ts:153 |
| `macro:completed` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/conkay/conkayHudStore.ts:10 |
| `combat:polish` | ✅ | ⬜ | ⬜ | ✅ | v:concord-frontend/components/world/AdaptiveMusicBridge.tsx:197 · l:concord-frontend/components/world/CombatPolishHUD.tsx:14 |
| `entity:death` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `body:instantiated` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `body:destroyed` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `agent:insights` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `forgetting:cycle_complete` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `dream:captured` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `lattice:meta:derived` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `lattice:meta:convergence` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `attention:allocation` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `combat:npc-combo-evolved` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `companion:level-up` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `kingdom:decree-enacted` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `kingdom:contested` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `faction-war:clash` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `minigame:complete` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `weather:update` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:event:scheduled` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `faction-war:tick` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `faction-war:kill` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `dtu:promoted` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `pain:wound_created` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `pain:wound_healed` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `qualia:policy` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:invariant-warning` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `faction:truce-sought` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `faction:strategy-move` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `npc:economy-batch` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `social:shadows-synced` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `boss:phase-enter` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `boss:state` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `combat:death` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `combat:hero_kill` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `concordia:lethal-hit` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `house:visitor-arrived` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `mount:hungry` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `mount:loyalty-low` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `nemesis:defeated` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `spouse:reaction` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `npc:combat-resolved` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `npc:level-up` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `npc:quest-accepted` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `npc:quest-completed` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `player:corpse-dropped` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `player:corpse-recovered` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `quest:accepted` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `event:reward` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `scheme:intervened` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `scheme:deception` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `weaponise:fired` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `skill:tier-witnessed` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `stealth:detected` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `tournament:bracket-advanced` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `tournament:complete` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `ghost-hunt:residue-confronted` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `fishing:bite` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:building-placed` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:building-removed` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:building-spawned` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:legendary-achievement` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:npc-alert` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:player-arrived` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:weather` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:npc-bark` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:npc-attack` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:npc-spared` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:racing-started` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:basketball-started` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `mount:behavior` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:node-update` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:loot-node` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:broadcast` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:boss-spawn` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `scheme:player_assassinated` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `plague:resolved` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `faction:collapse-cascade` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `scheme:cross_world` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `creature:predation` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `career:shift` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:npc-event` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `secret:weaponised` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `agent:value-drift` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:viability` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `realm:governance-adjusted` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `lattice:claim-verified` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `pain:avoidance_created` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `royalty:cross-world` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `npc:prop-interaction` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `app:created` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `forge:template:created` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `forge:template:generated` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `forge:template:published` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:gathering-detected` | ⬜ | ⬜ | ⬜ | ✅ | l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `combat:combo-evolved` | ✅ | ⬜ | ⬜ | ✅ | v:concord-frontend/components/world-lens/ComboEvolvedBridge.tsx:4 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `companion:tame-success` | ✅ | ⬜ | ⬜ | ✅ | v:concord-frontend/components/world/EmergentJuiceBridge.tsx:76 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:refusal-field` | ✅ | ⬜ | ⬜ | ✅ | v:concord-frontend/components/world/CinematicTriggerBridge.tsx:50 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `dream:composed` | ✅ | ⬜ | ⬜ | ✅ | v:concord-frontend/components/world/EmergentJuiceBridge.tsx:90 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `prediction:realised` | ✅ | ⬜ | ⬜ | ✅ | v:concord-frontend/components/world/EmergentJuiceBridge.tsx:86 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `combat:chain` | ✅ | ⬜ | ⬜ | ✅ | v:concord-frontend/components/world/CombatVFXBridge.tsx:199 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `npc:activity-batch` | ⬜ | ⬜ | ✅ | ✅ | a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:1943 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `kingdom:founded` | ✅ | ✅ | ⬜ | ✅ | v:concord-frontend/components/world/AdaptiveScoreBridge.tsx:23 · a:concord-frontend/lib/concordia/adaptive-score.ts:38 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `kingdom:fallen` | ✅ | ✅ | ⬜ | ✅ | v:concord-frontend/components/world/AdaptiveScoreBridge.tsx:24 · a:concord-frontend/lib/concordia/adaptive-score.ts:40 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:crisis` | ✅ | ✅ | ⬜ | ✅ | v:concord-frontend/components/world/AdaptiveScoreBridge.tsx:20 · a:concord-frontend/lib/concordia/adaptive-score.ts:30 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:crisis-resolved` | ✅ | ✅ | ⬜ | ✅ | v:concord-frontend/components/world/AdaptiveScoreBridge.tsx:21 · a:concord-frontend/lib/concordia/adaptive-score.ts:35 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `faction:war-declared` | ✅ | ✅ | ⬜ | ✅ | v:concord-frontend/components/world/AdaptiveScoreBridge.tsx:19 · a:concord-frontend/lib/concordia/adaptive-score.ts:28 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `faction:alliance-formed` | ✅ | ✅ | ⬜ | ✅ | v:concord-frontend/components/world/AdaptiveScoreBridge.tsx:22 · a:concord-frontend/lib/concordia/adaptive-score.ts:36 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `npc:scheme-resolved` | ✅ | ✅ | ⬜ | ✅ | v:concord-frontend/components/world/AdaptiveMusicBridge.tsx:207 · a:concord-frontend/lib/concordia/adaptive-score.ts:42 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `refusal:compound-threshold` | ✅ | ✅ | ⬜ | ✅ | v:concord-frontend/components/world/AdaptiveScoreBridge.tsx:26 · a:concord-frontend/lib/concordia/adaptive-score.ts:32 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `world:season-transition` | ✅ | ⬜ | ▫ | ✅ | v:concord-frontend/components/world-lens/SkyWeatherRenderer.tsx:18 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `combat:attack` | ✅ | ✅ | ✅ | ✅ | v:concord-frontend/components/world/CombatVFXBridge.tsx:212 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:153 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:1828 · l:concord-frontend/components/world/DamageBillboard.tsx:55 |
| `combat:hit` | ✅ | ✅ | ✅ | ✅ | v:concord-frontend/components/world/AdaptiveMusicBridge.tsx:200 · a:concord-frontend/components/world/WorldAudioBridge.tsx:18 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:1828 · l:concord-frontend/components/world/DamageBillboard.tsx:55 |
| `combat:impact` | ✅ | ✅ | ✅ | ✅ | v:concord-frontend/components/world/CombatVFXBridge.tsx:212 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:153 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:1659 · l:concord-frontend/components/world/DamageBillboard.tsx:55 |
| `combat:kick` | ✅ | ✅ | ✅ | ✅ | v:concord-frontend/components/world/CombatVFXBridge.tsx:212 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:153 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:1828 · l:concord-frontend/components/world/DamageBillboard.tsx:55 |
| `minigame:scored` | ✅ | ✅ | ▫ | ✅ | v:concord-frontend/components/world/DamageBillboard.tsx:8 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:222 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `combat:grab` | ✅ | ✅ | ✅ | ✅ | v:concord-frontend/components/world/CombatVFXBridge.tsx:212 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:153 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:1828 · l:concord-frontend/components/world/DamageBillboard.tsx:55 |
| `concordia:emote` | ✅ | ✅ | ✅ | ▫ | v:concord-frontend/components/world/NpcPerceptionBridge.tsx:64 · a:concord-frontend/components/audio-rooms/RoomStage.tsx:47 · a:concord-frontend/components/world-lens/AvatarSystem3D.tsx:428 |
| `dtu:created` | ✅ | ✅ | ▫ | ✅ | v:concord-frontend/lib/concordia/juice.ts:105 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:222 · l:concord-frontend/components/guidance/ActivityFeed.tsx:57 |
| `quest:rewards_granted` | ✅ | ✅ | ▫ | ✅ | v:concord-frontend/components/fractal/FractalRenderer.tsx:240 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:222 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
| `marketplace:purchase` | ✅ | ✅ | ▫ | ✅ | v:concord-frontend/components/world-lens/LevelUpJuiceBridge.tsx:74 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:120 · l:concord-frontend/components/world-lens/LevelUpJuiceBridge.tsx:74 |
| `evo:asset-promoted` | ✅ | ✅ | ▫ | ✅ | v:concord-frontend/components/world-lens/LevelUpJuiceBridge.tsx:161 · a:concord-frontend/components/world-lens/SoundscapeEngine.tsx:122 · l:concord-frontend/components/world/EmergentEventFeed.tsx (feed) |
