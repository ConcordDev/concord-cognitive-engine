# Animation Tracks — Godot 4

Godot 4 animation design for the Three Pillars + key NPCs + cascade events.

## 1. Pillar Idle Animations

- **Sovereign** (`sovereign_idle`): No movement. Just denial. Subtle hood tilt when "noticing" (-2° to 2°). 1.5s loop. Quietest animation in the game.
- **Concordia** (`concordia_idle`): Subtle sway, like wind through long grass. 2s loop. Hand occasionally rises to brush back hair.
- **Concord** (`concord_idle`): Typing motion. Robes like code lines shifting. 1.8s loop. Brief glance toward Concordia at turn 14.

## 2. Pillar Transitions

- **turn_toward_player(trigger, target)**: 1.2s, 360° turn. Sovereign won't do this — that's his refusal.
- **turn_away(trigger)**: 0.8s, 180° turn-back. Sovereign's signature.
- **look_at_each_other(trigger)**: 2.4s, Concord → Concordia → Sovereign chain. Rare; only on Cascade day.

## 3. NPC Animations

- **Keeper sweeping** (`keeper_sweep`): 4s loop. Broom on stone. Moss-encoded sleeve message occasionally catches the light.
- **Maren reading** (`maren_read`): 7s loop. Book on knee. Page turn every 1.2s.
- **Isa Velt annotating** (`isa_annotate`): 6s loop. Quill on parchment. Bites lip when stuck.
- **Kiren tracking** (`kiren_track`): 5s loop. Crouches, examines print, marks tablet.

## 4. Player Animations

- `player_idle` (1.5s loop, breath cycle)
- `player_walk` (0.8s loop, footstep cadence)
- `player_refuse` (1.2s, palm raised, head shake)
- `player_offer` (1.5s, arms extended, slight bow)
- `player_observe` (1.0s, hands cupped, leaning)

## 5. Combat Animations

- `refusal_parry` (0.6s, weapon deflected, ring of light)
- `breath_dodge` (0.5s, body slides, no footsteps)
- `law_strike` (0.7s, law-glyph erupts from hand)
- `cascade_burst` (1.4s, world tears, all three Pillars react)

## 6. Cascade Event Animation

- `cascade_open` (3.0s, sky tears, ground shudders)
- `cascade_react_pillars` (2.0s, Sovereign turns fully away, Concord covers eyes, Concordia opens arms)
- `cascade_close` (2.5s, sky seals, ground stills)

## 7. Founding Day Staging

12-step march:
1. Keeper rings the door-bell (8s)
2. 8 embassies open in sequence (4s each, 32s total)
3. Three Pillars visible (always visible)
4. Maren reads (5s)
5. Isa Velt files (3s)
6. Kiren lists (3s)
7. Orin names the foal (4s)
8. Banner unfurls (2s)
9. Concordia laughs (1.5s)
10. Concord hesitates (1s)
11. Sovereign does not turn (1s)
12. Lights, then dark (3s)

## Animation Signal Triggers

- `animation_finished(name)` — emit when each animation completes
- `cascade_started` — drive cascade_open + cascade_react_pillars in parallel
- `seen_signature_event` — bump refusal meter
- `world_entered` — trigger player_idle
- `combat_initiated` — trigger attack animation
- `combat_refused` — trigger breath_dodge (non-damaging)
