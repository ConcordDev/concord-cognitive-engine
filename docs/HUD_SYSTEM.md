# HUD System — Concordia

Full HUD design for the Concordia player experience.

## Layout

```
+-----------------------------------------------------------+
| [REFUSAL]  [DIVINITY ALIGNMENT]  [CASCADE COUNTDOWN]      |
|                                                           |
|                              |                            |
|                              |   FACTION REPUTATION       |
|       GAME WORLD             |   - Concordia Hub: 50       |
|       (centered)             |   - Cyber: 0                |
|                              |   - Crime: 0                |
|                              |   - Fantasy: 0              |
|                              |   - Frontier: 0             |
| [PARTY STATUS]               |   - Superhero: 0           |
| - Maren (NPC)                |   - Tunya: 0               |
| - Isa Velt (NPC)             |   - Ruins: 0               |
| - 0/3 player slots           |                            |
|                              |                            |
+-----------------------------------------------------------+
| [WEAPON] [TOOL] [OFFERING] [RITUAL]                       |
+-----------------------------------------------------------+
```

## Each HUD Element

### Top Bar (left): Refusal Meter
- **Data source**: Sovereign's signature events for this player
- **Update frequency**: Real-time
- **Visual**: Vertical bar, dark slate, fills with cool blue light up to 100. "Refusal" label glows at 50+.

### Top Bar (center): Divinity Alignment
- **Data source**: Player's `divinity` value (-1..0..+1)
- **Update frequency**: Per-frame
- **Visual**: Horizontal 3-way bar:
  - Left (cool blue): Sovereign's notice
  - Center (warm brown): Concordia's breath
  - Right (slate gray): Concord's law
- **Ticks**: 0, 25, 50, 75, 100. Character icon at dominant end.

### Top Bar (right): Cascade Countdown
- **Data source**: Active Cascade event in current world
- **Update frequency**: 1Hz
- **Visual**: Circular dial, fills clockwise. Days remaining inside. "CASCADE" flashes red at 0.

### Bottom: Hotbar (4 slots)
- **Slot 1 - Weapon**: Primary damage source
- **Slot 2 - Tool**: Gathering, building, navigation
- **Slot 3 - Offering**: Tribute / quest items / lore objects
- **Slot 4 - Ritual**: Major world-changing actions (refusal, cascade, founding-day)
- **Visual**: Square slots (64px), item icon centered, number badge bottom-right

### Right Side: Faction Reputation
- **8 embassies** (Cyber, Crime, Fantasy, Frontier, Superhero, Tunya, Ruins, Lattice-Crucible)
- **3 factions** (Citizens, Observers, Witnesses)
- **Visual**: Vertical list, points-labeled bars (0–100). Color-coded by world.

### Left Side: Party Status
- **Active NPCs**: List of NPCs in current world with "talking-to" indicator
- **Player slots**: 0/3 filled for multi-player
- **Visual**: Avatar + name + status icon

### Inventory Drawer
- **Trigger**: Bottom-right button
- **Visual**: Full-screen drawer, 4x6 grid, drag-to-hotbar

### Notification Queue
- **Events**: Founding Day, Cascade events, NPC greetings, refusal events
- **Visual**: Top-of-screen overlay, 3 lines max, fade after 5s

## Player Health / Death Suspended

- **Health bar**: Below divinity alignment, top-left corner
- **Death suspension**: When HP hits 0, Sovereign's signature fires
  - Player is "death suspended" (HP stays at 1)
  - Cannot take damage for 7 days
  - "Refusal Meter" glows red

## Divinity Alignment Detail

The 3-way bar maps to player behavior:
- **Concordia's breath higher** (warm): Player has been kind, planted, paid respect
- **Concord's law higher** (slate): Player has cataloged, organized, followed rules
- **Sovereign's notice higher** (cool): Player has caused harm, refused narrative, accepted a stake

## Cascade Countdown Detail

- **Cap**: 9 contributions
- **Duration**: 7 days from last contribution
- **Fired state**: Sky tear animation, all three Pillars react
- **After fired**: World marked with permanent scar

## Faction Reputation Detail

Each embassy has its own score (0-100). Crossing 50 unlocks quests. Crossing 80 unlocks unique dialogue. Factions:
- **Citizens**: locals who work the embassy
- **Observers**: travelers who pass through
- **Witnesses**: those who were there when a refusal was spoken

## Hotbar Detail

Hotbar items have weight and rarity. Player can:
- 1: equip/unequip
- 2: link to active quest
- 3: trade with NPC
- 4: drop on ground

## Notification Detail

Notification kinds:
- `founding_day_event` — major narrative beat
- `cascade_event` — world-changing
- `refusal_signature` — Sovereign spoke
- `npc_greeting` — first meeting
- `world_entered` — entered new world
- `cascade_warning` — 1 day remaining

## Visual Style

- **Color palette**: Warm browns (Concordia), cool blues (Sovereign), slate grays (Concord)
- **Typography**: Serif headings, monospace data
- **Iconography**: Geometric shapes for categories, hand-drawn details for items
- **Animation**: Subtle fade-outs, gentle pulses, no aggressive flashing
