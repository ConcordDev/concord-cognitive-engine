# Concord Lens UI North Stars

**Purpose:** Single source of truth for Claude (and anyone) redesigning Concord lens UI.  
**Owner ask (2026-10-02):** Per-lens north pole — screenshot what it is today, then concept art for what it should be. Do one lens at a time. Chat is approved.

**Canonical folder (Mac):** `~/.zuko/lens-northstar/`  
**Also mirror:** `concord-web/docs/lens-northstar/` and box `/workspace/lens-northstar/`

When Claude usage is back: read this file first, open the matching `*-current.png` + `*-northstar-concept.*`, implement toward the concept without inventing new chrome.

---

## Shared design principles (all lenses)

Derived from approved Chat north star + Ramaj direction:

1. **Claude-clean, not cockpit.** Deep black empty canvas. Breathing room. No stacked dual chrome.
2. **One primary surface.** After the first interaction, still one clean thread/workspace — not panels multiplying.
3. **Thin left rail only.** Icons for Core workspaces; destinations collapse. No dense DTU trees in the main canvas.
4. **Floating composer / primary action** where the lens is conversational or generative (+ / mode pill / mic pattern for Chat; analogous primary CTA for other lenses).
5. **Teal as rare accent** (active nav, primary send/CTA). No status-bar clutter (brains / stalled / wallet) in the lens chrome.
6. **Serif personalized greeting** on empty states where it fits; sans for UI chrome.
7. **Absorbed sub-lenses** stay reachable via subtle tabs or ⌘K — not a second full UI stacked on top.
8. **Concept art is the north pole.** Live UI may lag; do not regress toward the cockpit baseline.

---

## Priority order (concentrated 25)

Ship north stars in this order. Full ~270 lenses stay reachable via Hub / ⌘K; they inherit principles until they get their own concept.

### Core 6 (`lib/lens-registry.ts` CORE_LENSES)

| # | Lens | Path | Status | Current shot | Concept |
|---|------|------|--------|--------------|---------|
| 1 | Chat | `/lenses/chat` | **APPROVED** 2026-10-02 | `01-chat-current.png` | `02-chat-northstar-concept.jpg` |
| 2 | Board | `/lenses/board` | **APPROVED** 2026-10-02 (kanban) | `03-board-current.png` | `04-board-northstar-concept.jpg` |
| 3 | Graph | `/lenses/graph` | **packed** 2026-10-02 | `15-graph-current.png` | `16-graph-northstar-concept.jpg` |
| 4 | Code | `/lenses/code` | **packed** 2026-10-02 | `27-code-current.png` | `28-code-northstar-concept.jpg` |
| 5 | Studio | `/lenses/studio` | **packed** 2026-10-02 | `35-studio-current.png` | `36-studio-northstar-concept.jpg` |
| 6 | World | `/lenses/world` | **packed** 2026-10-02 | `51-world-current.png` | `52-world-northstar-concept.jpg` |

#### Board absorbed (`CORE_LENSES.board.absorbedLensIds`)

Parent kanban approval does **not** cover these. Each has its own current + concept.

| Lens | Path | Status | Current | Concept |
|------|------|--------|---------|---------|
| Goals | `/lenses/goals` | **packed** 2026-10-02 | `05-goals-current.png` | `07-goals-northstar-concept.jpg` |
| Calendar | `/lenses/calendar` | **packed** 2026-10-02 | `06-calendar-current.png` | `08-calendar-northstar-concept.jpg` |
| Timeline | `/lenses/timeline` | **packed** 2026-10-02 | `09-timeline-current.png` | `10-timeline-northstar-concept.jpg` |
| Study (SRS) | `/lenses/srs` | **packed** 2026-10-02 | `11-srs-current.png` | `12-srs-northstar-concept.jpg` |
| Whiteboard | `/lenses/whiteboard` | **packed** 2026-10-02 | `13-whiteboard-current.png` | `14-whiteboard-northstar-concept.jpg` |

#### Graph absorbed (`CORE_LENSES.graph.absorbedLensIds`)

| Lens | Path | Status | Current | Concept |
|------|------|--------|---------|---------|
| Schema | `/lenses/schema` | **packed** 2026-10-02 | `17-schema-current.png` | `18-schema-northstar-concept.jpg` |
| Entity | `/lenses/entity` | **packed** 2026-10-02 | `19-entity-current.png` | `20-entity-northstar-concept.jpg` |
| Temporal | `/lenses/temporal` | **packed** 2026-10-02 | `21-temporal-current.png` | `22-temporal-northstar-concept.jpg` |
| Eco | `/lenses/eco` | **packed** 2026-10-02 | `23-eco-current.png` | `24-eco-northstar-concept.jpg` |
| Meta | `/lenses/meta` | **packed** 2026-10-02 | `25-meta-current.png` | `26-meta-northstar-concept.jpg` |

#### Code absorbed (`CORE_LENSES.code.absorbedLensIds`)

| Lens | Path | Status | Current | Concept |
|------|------|--------|---------|---------|
| Debug | `/lenses/debug` | **packed** 2026-10-02 | `29-debug-current.png` | `30-debug-northstar-concept.jpg` |
| Database | `/lenses/database` | **packed** 2026-10-02 | `31-database-current.png` | `32-database-northstar-concept.jpg` |
| Repos | `/lenses/repos` | **packed** 2026-10-02 | `33-repos-current.png` | `34-repos-northstar-concept.jpg` |

#### Studio absorbed (`CORE_LENSES.studio.absorbedLensIds`)

Live Studio nav labels Fractal as **Visuals**. One pair covers that route.

| Lens | Path | Status | Current | Concept |
|------|------|--------|---------|---------|
| Music | `/lenses/music` | **packed** 2026-10-02 | `37-music-current.png` | `38-music-northstar-concept.jpg` |
| Art | `/lenses/art` | **packed** 2026-10-02 | `39-art-current.png` | `40-art-northstar-concept.jpg` |
| Fractal (Visuals) | `/lenses/fractal` | **packed** 2026-10-02 | `41-fractal-current.png` | `42-fractal-northstar-concept.jpg` |
| Game | `/lenses/game` | **packed** 2026-10-02 | `43-game-current.png` | `44-game-northstar-concept.jpg` |
| Sim | `/lenses/sim` | **packed** 2026-10-02 | `45-sim-current.png` | `46-sim-northstar-concept.jpg` |
| AR | `/lenses/ar` | **packed** 2026-10-02 | `47-ar-current.png` | `48-ar-northstar-concept.jpg` |
| Podcast | `/lenses/podcast` | **packed** 2026-10-02 | `49-podcast-current.png` | `50-podcast-northstar-concept.jpg` |

### Destinations 19 (`lib/destinations.ts`)

**Work:** finance, accounting, healthcare, legal, projects, analytics, marketplace, trades  
**Create:** music, whiteboard, creator, crypto  
**Knowledge:** research, lab, frontier, calendar, agents  
**Comms:** message, social, council  

Whiteboard and Calendar are packed as Board absorbed. Music is packed once, under Studio (do not shoot it again as Create). Every other destination below is **packed** 2026-10-02.

| Lens | Path | Current | Concept |
|------|------|---------|---------|
| Finance | `/lenses/finance` | `53-finance-current.png` | `54-finance-northstar-concept.jpg` |
| Accounting | `/lenses/accounting` | `55-accounting-current.png` | `56-accounting-northstar-concept.jpg` |
| Healthcare | `/lenses/healthcare` | `57-healthcare-current.png` | `58-healthcare-northstar-concept.jpg` |
| Legal | `/lenses/legal` | `59-legal-current.png` | `60-legal-northstar-concept.jpg` |
| Projects | `/lenses/projects` | `61-projects-current.png` | `62-projects-northstar-concept.jpg` |
| Analytics | `/lenses/analytics` | `63-analytics-current.png` | `64-analytics-northstar-concept.jpg` |
| Marketplace | `/lenses/marketplace` | `65-marketplace-current.png` | `66-marketplace-northstar-concept.jpg` |
| Trades | `/lenses/trades` | `67-trades-current.png` | `68-trades-northstar-concept.jpg` |
| Creator | `/lenses/creator` | `69-creator-current.png` | `70-creator-northstar-concept.jpg` |
| Crypto | `/lenses/crypto` | `71-crypto-current.png` | `72-crypto-northstar-concept.jpg` |
| Research | `/lenses/research` | `73-research-current.png` | `74-research-northstar-concept.jpg` |
| Lab | `/lenses/lab` | `75-lab-current.png` | `76-lab-northstar-concept.jpg` |
| Frontier | `/lenses/frontier` | `77-frontier-current.png` | `78-frontier-northstar-concept.jpg` |
| Agents | `/lenses/agents` | `79-agents-current.png` | `80-agents-northstar-concept.jpg` |
| Messages | `/lenses/message` | `81-message-current.png` | `82-message-northstar-concept.jpg` |
| Social | `/lenses/social` | `83-social-current.png` | `84-social-northstar-concept.jpg` |
| Council | `/lenses/council` | `85-council-current.png` | `86-council-northstar-concept.jpg` |

### Chat absorbed (`CORE_LENSES.chat.absorbedLensIds`)

Chat itself stays **APPROVED** (`01` / `02`). Council is packed once, above, as the Comms destination (same route). These are the rest.

| Lens | Path | Status | Current | Concept |
|------|------|--------|---------|---------|
| Threads | `/lenses/thread` | **packed** 2026-10-02 | `87-thread-current.png` | `88-thread-northstar-concept.jpg` |
| Forum | `/lenses/forum` | **packed** 2026-10-02 | `89-forum-current.png` | `90-forum-northstar-concept.jpg` |
| Daily | `/lenses/daily` | **packed** 2026-10-02 | `91-daily-current.png` | `92-daily-northstar-concept.jpg` |
| Anonymous | `/lenses/anon` | **packed** 2026-10-02 | `93-anon-current.png` | `94-anon-northstar-concept.jpg` |
| Voice | `/lenses/voice` | **packed** 2026-10-02 | `95-voice-current.png` | `96-voice-northstar-concept.jpg` |
| Feed | `/lenses/feed` | **packed** 2026-10-02 | `97-feed-current.png` | `98-feed-northstar-concept.jpg` |
| News | `/lenses/news` | **packed** 2026-10-02 | `99-news-current.png` | `100-news-northstar-concept.jpg` |

---

## Chat (APPROVED) — north pole detail

### What it is today (baseline)
Dense multi-panel Chat cockpit: app sidebar + Chat DTU tree + sub-tabs (Threads/Forum/Daily/…) + Context/Overview toolbars + floating Agent Mode FAB + right utility strip. See `01-chat-current.png`.

### What it should be
- Empty deep-black canvas
- Personalized serif greeting (e.g. “Good afternoon, Ramaj”)
- 2–3 soft suggestion chips
- One clean message thread (user / assistant bubbles only)
- Floating bottom composer: `+` / mode pill / mic / send
- Thin icon rail; no DTU tree, no Agent Mode FAB, no right strip, no stacked Welcome/Assist chrome

See `02-chat-northstar-concept.jpg`.

### Implementation notes for Claude
- Prefer worktree `concord-web` branch `lens-chrome-consolidation` patterns already started (LensToolbar, WorkspaceTabs, ConKay Studio toggle).
- Identity answers must go through LLM (`llmUsed:true`); do not restore SYSTEM_IDENTITY early-return as the final reply.
- Live Mac failover may still serve older standalone FE — redeploy after UI lands.

---



## Board (`/lenses/board`) — **APPROVED** 2026-10-02 (kanban)

### What it is today
Kanban cockpit: Board/Goals/Calendar/Timeline/Study/Whiteboard tabs, DTU count, Ask about Board, stats cards, Workflow Analysis / Burndown, quick tour overlay, Agent · board FAB, right strip. See `03-board-current.png`.

### What it should be
- Same family as Chat: thin icon rail, black canvas, serif “What’s next, Ramaj”
- Minimal Board · Goals · Calendar segmented control
- Clean 3-lane kanban only
- Single floating “+ Add task”
- No stats row, analysis toolbar, tour popup, Agent FAB, or right strip

See `04-board-northstar-concept.jpg`.

## Goals (`/lenses/goals`)

**Status:** packed 2026-10-02  
**Current:** `05-goals-current.png`  
**Concept:** `07-goals-northstar-concept.jpg`

### Job of this lens
A short list of what matters this quarter, with honest progress.

### Keep
- Goal titles and a single progress bar each (real percent from the goals macros)
- Subtle Board · Goals · Calendar tabs

### Kill / hide by default
- Streak / XP / level / weekly-activity dashboard
- Challenges · Milestones · OKRs · Analytics · Autonomy · Feed secondary desks
- Agent FAB, Ask about Goals, DTU count, right utility strip

### Empty state
Serif “What matters this quarter, Ramaj” with 1–2 chips (Review OKRs / Set a weekly focus).

### Primary CTA / composer
Floating `+ New goal`

## Calendar (`/lenses/calendar`)

**Status:** packed 2026-10-02  
**Current:** `06-calendar-current.png`  
**Concept:** `08-calendar-northstar-concept.jpg`

### Job of this lens
A month (or week) of real events. One calendar.

### Keep
- Month grid + Day/Week/Month switch
- Event chips on the day they belong to
- Subtle Board · Goals · Calendar tabs

### Kill / hide by default
- Dual mini-calendar + density (Low/Medium/High) + Google+tasks / Booking / Conflicts / Timezones / Scheduler toolbars
- Agent FAB, Ask about Calendar, status bar

### Empty state
Serif “Your week, Ramaj” over a quiet grid.

### Primary CTA / composer
`+ Event`

## Timeline (`/lenses/timeline`)

**Status:** packed 2026-10-02  
**Current:** `09-timeline-current.png`  
**Concept:** `10-timeline-northstar-concept.jpg`

### Job of this lens
When Board work lands — a due-date swimlane of real tasks/milestones. This is a Board absorbed child, not a social network.

### Keep
- Horizontal lanes keyed to real Board/Goals items and due dates
- Subtle Board · Goals · Calendar · Timeline tabs

### Kill / hide by default
- Facebook-style composer, privacy chips, albums, memories, profile, Wikipedia “On this day”
- Agent FAB, Ask about Timeline, DTU count, right strip

### Empty state
Serif “When it lands, Ramaj” over empty lanes.

### Primary CTA / composer
`+ Add milestone`

## Study / SRS (`/lenses/srs`)

**Status:** packed 2026-10-02  
**Current:** `11-srs-current.png`  
**Concept:** `12-srs-northstar-concept.jpg`

### Job of this lens
One card at a time: spaced review of DTUs the user already saved. Space flips; 1–4 rates.

### Keep
- Prompt from a real DTU; Again / Hard / Good / Easy after reveal
- Due count
- Subtle Board family tabs with Study active

### Kill / hide by default
- Four stat tiles (Due Now / session / accuracy / queue) as the body
- Deck engine + GitHub repos stacked under the review card
- Duplicate “Add a DTU to review” buttons, Agent FAB, Ask about SRS

### Empty state
Serif “What do you still know, Ramaj” and a single add path.

### Primary CTA / composer
`+ Add to review` (DTU picker). Keyboard: Space, 1–4.

## Whiteboard (`/lenses/whiteboard`)

**Status:** packed 2026-10-02  
**Current:** `13-whiteboard-current.png`  
**Concept:** `14-whiteboard-northstar-concept.jpg`

### Job of this lens
An infinite sketch canvas. FigJam-quiet: tools on the left, cards on the board, nothing else.

### Keep
- Infinite canvas + a thin floating tool rail (pen, box, circle, line)
- Sticky notes / shapes that persist through the whiteboard macros

### Kill / hide by default
- Left “Board / Freeform / + New Board” column stacked on the canvas
- Analyze / Collab / Session / Tools inspector (Shape Detect, Optimize Layout, …)
- Whiteboard Workbench FAB, Agent FAB, Ask about Whiteboard, Cross-lens recents

### Empty state
Serif “Sketch it, Ramaj” on deep black; first stroke or `+ New board` starts.

### Primary CTA / composer
`+ New board`

## Graph (`/lenses/graph`)

**Status:** packed 2026-10-02  
**Current:** `15-graph-current.png`  
**Concept:** `16-graph-northstar-concept.jpg`

### Job of this lens
See how things connect. The canvas **is** the graph (Neo4j Bloom / Obsidian graph), not a stats dashboard in front of an empty grid.

### Keep
- Sparse force-directed nodes/edges from live DTU / graph macros
- Find-a-node search
- Subtle Graph · Schema · Entities tabs

### Kill / hide by default
- Explore / Maps / Mind map / Genome / Catalog perspective wall
- Nodes/Edges/Density/Avg Connections tiles, lattice legend, Graph DTUs tree
- Right tool strip, Agent FAB, “Waiting for graph data…” chrome, Ask about Graph

### Empty state
Serif “How it connects, Ramaj” and an empty field + search. Honest empty if the lattice has no nodes — do not fabricate a graph.

### Primary CTA / composer
`+ Add node`

### Absorbed children (subtle only)
Schema, Entity, Temporal, Eco, Meta — each has its own north star below.

## Schema (`/lenses/schema`)

**Status:** packed 2026-10-02  
**Current:** `17-schema-current.png`  
**Concept:** `18-schema-northstar-concept.jpg`

### Job of this lens
Show the shape of the data as a quiet ER of registered schemas.

### Keep
- Two or three tables with real fields from the schema registry
- Graph · Schema · Entities tabs

### Kill / hide by default
- Featured Actions wall (Validate / Apply / Conformance / Er Diagram / Evolve / Infer Schema)
- Workbench tab strip (Registry, Visual Editor, Sample Data, Migration, Diff, …)
- Stats row (in substrate / last 7 days / 46 actions)

### Empty state
Serif “The shape of the data, Ramaj” and `+ New schema`.

### Primary CTA / composer
`+ New schema`

## Entity (`/lenses/entity`)

**Status:** packed 2026-10-02  
**Current:** `19-entity-current.png`  
**Concept:** `20-entity-northstar-concept.jpg`

### Job of this lens
A short, honest list of entities in the graph.

### Keep
- Name, kind, live badge from the swarm/entity macros
- Graph · Schema · Entities tabs

### Kill / hide by default
- Registry / Graph / Wikidata / Agents nested desks
- Stat tiles (especially fabricated NaN relationship counts)
- Entity Activity Timeline sparkline wall, Agent FAB

### Empty state
Serif “Who is in the graph, Ramaj”.

### Primary CTA / composer
`+ Spawn entity`

## Temporal (`/lenses/temporal`)

**Status:** packed 2026-10-02  
**Current:** `21-temporal-current.png`  
**Concept:** `22-temporal-northstar-concept.jpg`

### Job of this lens
One imported series and its forecast. Prophet-quiet.

### Keep
- Chart of a user-imported series; dashed forecast from `temporal.*` macros
- Graph · Temporal · Ecosystem tabs

### Kill / hide by default
- Dual import form + empty workbench + “Prophet-grade” badge stack
- Tool desks until a series exists

### Empty state
Serif “What the series says, Ramaj” and `+ Import series`.

### Primary CTA / composer
`+ Import series`

## Eco (`/lenses/eco`)

**Status:** packed 2026-10-02  
**Current:** `23-eco-current.png`  
**Concept:** `24-eco-northstar-concept.jpg`

### Job of this lens
The air and ecology around the user — one honest reading from Open-Meteo / eco macros.

### Keep
- AQI (or weather) from the live feed; cite the source
- Graph · Temporal · Ecosystem tabs

### Kill / hide by default
- Overview / Weather / Air / Climate / Species / Sightings / Life list / Footprint / Challenges / Alerts / Solar / Org ESG tab wall
- Agent FAB, waiting bars, Ask about Eco

### Empty state
Serif “The air around you, Ramaj”. If the feed has no coordinate, say so — do not invent AQI.

### Primary CTA / composer
`+ Log a sighting`

## Meta (`/lenses/meta`)

**Status:** packed 2026-10-02  
**Current:** `25-meta-current.png`  
**Concept:** `26-meta-northstar-concept.jpg`

### Job of this lens
Three true numbers about the running system. Inventory, not a second IDE.

### Keep
- Wiring / orphan / last-pass facts from meta macros
- Graph · Ecosystem · Meta tabs

### Kill / hide by default
- Overview / System Health / Dev Portal / Components / Lenses / Orphans / Wiring Map / Search / Lens Infra tab wall
- Agent FAB, Ask about Meta

### Empty state
Serif “What the system is, Ramaj” while inventory loads; never fake counts.

### Primary CTA / composer
`Refresh inventory`

## Code (`/lenses/code`)

**Status:** packed 2026-10-02
**Current:** `27-code-current.png`
**Concept:** `28-code-northstar-concept.jpg`

### Job of this lens
One editor. A file, a cursor, Run.

### Keep
- The open buffer (live shot was `untitled.js`)
- Code · Debug · Database · Repos as a quiet pill

### Kill / hide by default
- Complexity / Dependency / Coverage / Change Risk cards
- Explorer-plus-DTU column, Ask about Code, Agent FAB, brain dots, wallet, Install banner

### Empty state
Serif “What are we building, Ramaj” over an empty buffer.

### Primary CTA / composer
`Run`

## Debug (`/lenses/debug`)

**Status:** packed 2026-10-02
**Current:** `29-debug-current.png`
**Concept:** `30-debug-northstar-concept.jpg`

### Job of this lens
One issue list. Live copy was “Waiting for debug data…”.

### Keep
- A single issue (or an honest empty)
- Code family tabs, Debug active

### Kill / hide by default
- Status / Issues / Traces / Metrics / Releases / Environment desk
- Service tiles (Database, Jobs, Memory), quick tour, Agent FAB

### Empty state
Serif “What broke, Ramaj” and “No open issue”.

### Primary CTA / composer
`Refresh`

## Database (`/lenses/database`)

**Status:** packed 2026-10-02
**Current:** `31-database-current.png`
**Concept:** `32-database-northstar-concept.jpg`

### Job of this lens
One query and its rows. The tour said schema-inspect covers 459 tables — that count can sit under the result, not as three server cards.

### Keep
- Query editor and a result table
- Code family tabs

### Kill / hide by default
- SQLite / PostgreSQL / Redis connection card row, DBeaver subtitle, Refresh All, quick tour, Agent FAB

### Empty state
Serif “Ask the data, Ramaj”.

### Primary CTA / composer
`Run query`

## Repos (`/lenses/repos`)

**Status:** packed 2026-10-02
**Current:** `33-repos-current.png`
**Concept:** `34-repos-northstar-concept.jpg`

### Job of this lens
The repo list. Live was honest: substrate 0 repos, “No repos yet.”

### Keep
- Empty state copy and `+ New repo`
- Code family tabs

### Kill / hide by default
- Your repos / Explore GitHub split, quick tour, Agent FAB, Install banner

### Empty state
Serif “Your repos, Ramaj”.

### Primary CTA / composer
`+ New repo`

## Studio (`/lenses/studio`)

**Status:** packed 2026-10-02
**Current:** `35-studio-current.png`
**Concept:** `36-studio-northstar-concept.jpg`

### Job of this lens
An arrangement. Tracks and a playhead, not a product brochure.

### Keep
- Transport and lanes once a session exists
- Studio family pill (Studio through Podcast). Fractal’s tab label on the live nav is Visuals.

### Kill / hide by default
- “Concord Studio / full DAW” hero, feature cards under it, Ask about Studio, Agent FAB, 1536 DTU chip

### Empty state
Serif “What are we making, Ramaj” over an untitled session.

### Primary CTA / composer
`Play`

## Music (`/lenses/music`)

**Status:** packed 2026-10-02
**Current:** `37-music-current.png`
**Concept:** `38-music-northstar-concept.jpg`

### Job of this lens
What is playing. Live library was all zeros (tracks, liked, playlists, following, plays, hours) plus a Pull feed.

### Keep
- Transport, and Pull feed as the way the empty library fills
- Studio family tabs

### Kill / hide by default
- Six zero stat tiles, New Releases / Now Playing / Radio / Stats / Pro desks, quick tour, Agent FAB

### Empty state
Serif “What are we hearing, Ramaj”. Do not invent tracks.

### Primary CTA / composer
`Pull feed`

## Art (`/lenses/art`)

**Status:** packed 2026-10-02
**Current:** `39-art-current.png`
**Concept:** `40-art-northstar-concept.jpg`

### Job of this lens
A canvas. Live tour: drop an image or generate; each artwork is a DTU.

### Keep
- The canvas
- Studio family tabs

### Kill / hide by default
- Studio / Gallery / Canvas / Market / My art numbered desks, prompt form stacked under a tour, Agent FAB

### Empty state
Serif “Make a mark, Ramaj”.

### Primary CTA / composer
`+ New canvas`

## Fractal (`/lenses/fractal`)

**Status:** packed 2026-10-02
**Current:** `41-fractal-current.png`
**Concept:** `42-fractal-northstar-concept.jpg`

### Job of this lens
One render and the knobs that change it. Live page was a 43-action featured wall (SIM_GRADE_A), tabbed as Visuals inside Studio.

### Keep
- The image and a few real parameters
- Studio family tabs with Visuals active

### Kill / hide by default
- Featured action grid (measure, delete/export/import preset, …), quick tour, Agent FAB

### Empty state
Serif “One image, Ramaj” until the first render. Do not fake a fractal bitmap as if it were a live render — the concept gradient is a stand-in for the surface, not a result.

### Primary CTA / composer
`Render`

## Game (`/lenses/game`)

**Status:** packed 2026-10-02
**Current:** `43-game-current.png`
**Concept:** `44-game-northstar-concept.jpg`

### Job of this lens
One quest. Live is a gamification cockpit: 0 XP, 0d streak, Lv 1, progress to level 2 at 0/1000, plus Habit Hub / Design Lab / Quests / Achievements.

### Keep
- The active quest, when one exists
- Studio family tabs

### Kill / hide by default
- XP / streak / level strip, the secondary desk row, quick tour, Agent FAB

### Empty state
Serif “What are you playing, Ramaj” and “No active quest”.

### Primary CTA / composer
`Start a quest`

## Sim (`/lenses/sim`)

**Status:** packed 2026-10-02
**Current:** `45-sim-current.png`
**Concept:** `46-sim-northstar-concept.jpg`

### Job of this lens
One scenario. Live console showed 0 simulations, 0s avg, 0% success, 0 runs.

### Keep
- Assumptions and a single run result when a scenario exists
- Studio family tabs

### Kill / hide by default
- Four zero tiles plus Runs / Convergence / Models, Sensitivity / Export toolbars, quick tour, Agent FAB

### Empty state
Serif “Run the scenario, Ramaj”.

### Primary CTA / composer
`+ New scenario`

## AR (`/lenses/ar`)

**Status:** packed 2026-10-02
**Current:** `47-ar-current.png`
**Concept:** `48-ar-northstar-concept.jpg`

### Job of this lens
Place an anchor. Live said no XR device and offered screen preview; image targets 0, models 0.

### Keep
- The preview frame and Start preview
- Honest “no device” copy
- Studio family tabs

### Kill / hide by default
- Stat tiles, quick tour, Agent FAB, density control as chrome

### Empty state
Serif “Place it in the room, Ramaj”.

### Primary CTA / composer
`Start preview`

## Podcast (`/lenses/podcast`)

**Status:** packed 2026-10-02
**Current:** `49-podcast-current.png`
**Concept:** `50-podcast-northstar-concept.jpg`

### Job of this lens
The show that is on. Live counts were all zero (subscribed, in progress, up next, downloads, playlists, hours).

### Keep
- Player and speed once a show is queued
- Studio family tabs

### Kill / hide by default
- Six zero tiles, Listen / Browse / Library as a second app, quick tour, Agent FAB

### Empty state
Serif “What's on, Ramaj”.

### Primary CTA / composer
`+ Add a show`

## World (`/lenses/world`)

**Status:** packed 2026-10-02
**Current:** `51-world-current.png`
**Concept:** `52-world-northstar-concept.jpg`

### Job of this lens
The world itself. Live was a Unity WebGL view (Hub figure, heart mark) squeezed beside the app sidebar, a hair/outfit customizer, Activity Timeline, and Agent · world.

### Keep
- The running client, full bleed
- A single place chip (Flower Law · Hub on this session)
- Thin core rail only

### Kill / hide by default
- App sidebar, brains, wallet, Ask about World Lens, customizer column, activity timeline, Agent FAB, right utility strip
- Any tab bar. World has no absorbed lenses.

### Empty state
The place chip is enough. Do not cover the view with a greeting.

### Primary CTA / composer
None on the glass. Entering the world is the action. The concept figure is a chrome sketch, not a replacement mesh.

## Finance (`/lenses/finance`)

**Status:** packed 2026-10-02
**Current:** `53-finance-current.png`
**Concept:** `54-finance-northstar-concept.jpg`

### Job of this lens
What you hold. Live terminal was still “loading live prices…” over skeleton cards, with Markets / Market / Wallet / Staking / Insurance / Billing / Ledger tabs and Overview through Bills.

### Keep
- One book: cash and positions, filled only when the feed answers
- A short Finance · Markets · Wallet pill

### Kill / hide by default
- The rest of the tab wall, density dropdown, snapshot toolbar, market-monitor grid, Agent FAB
- Do not paint indices while the feed is loading

### Empty state
Serif “What you hold, Ramaj” and an em dash.

### Primary CTA / composer
`Refresh`

## Accounting (`/lenses/accounting`)

**Status:** packed 2026-10-02
**Current:** `55-accounting-current.png`
**Concept:** `56-accounting-northstar-concept.jpg`

### Job of this lens
This period’s books. Live showed Cash / Revenue / Expenses / Net at $0, badge Simulated, and a “Concord warming up — retry” toast because the local API blipped.

### Keep
- One statement for the chosen period
- The Simulated badge when the engine says so

### Kill / hide by default
- Books / Banking / Bench plus Sales tree, Ask anything chips, Workbench card, Agent FAB, Install banner

### Empty state
Serif “The books, Ramaj”. Zeros only if the ledger returned zeros.

### Primary CTA / composer
`+ Entry`

## Healthcare (`/lenses/healthcare`)

**Status:** packed 2026-10-02
**Current:** `57-healthcare-current.png`
**Concept:** `58-healthcare-northstar-concept.jpg`

### Job of this lens
One chart. Live workbench: “EHR — open a patient record from the workbench below.” Clinical ops copy says organizational records, not a substitute for care. 111 DTUs. Tabs run Pharmacy, Mental Health, Fitness, Wellness, Veterinary, Org.

### Keep
- The open record, or the honest empty
- The not-a-substitute-for-care line
- Healthcare · Pharmacy only, as a pill

### Kill / hide by default
- The rest of that tab wall on this desk, Agent FAB, Install banner, sub-lens stack

### Empty state
Serif “Who is in front of you, Ramaj” and “No chart open”. Do not invent a patient.

### Primary CTA / composer
`Open a chart`

## Legal (`/lenses/legal`)

**Status:** packed 2026-10-02
**Current:** `59-legal-current.png`
**Concept:** `60-legal-northstar-concept.jpg`

### Job of this lens
The matter in front of you. Live disclaimer: organization and practice management, not legal advice.

### Keep
- That disclaimer, one document
- Legal · Law · Disputes pill

### Kill / hide by default
- Ethics / Audit / Privacy on this desk, Analyzer / Docket / Q&A toolbar, quick tour, Agent FAB

### Empty state
Serif “The matter in front of you, Ramaj” and “No matter open”.

### Primary CTA / composer
`+ New matter`

## Projects (`/lenses/projects`)

**Status:** packed 2026-10-02
**Current:** `61-projects-current.png`
**Concept:** `62-projects-northstar-concept.jpg`

### Job of this lens
What’s in flight. Live substrate count was 0, with a featured-actions wall (the tile said 125 actions) and tabs for Consulting, Careers, HR, Services, Supply Chain, Manufacturing.

### Keep
- A short project list when rows exist
- Projects · Timeline pill

### Kill / hide by default
- Featured actions grid, stat trio, the other destination tabs, quick tour, Agent FAB

### Empty state
Serif “What's in flight, Ramaj” and “Nothing in the substrate”.

### Primary CTA / composer
`+ New project`

## Analytics (`/lenses/analytics`)

**Status:** packed 2026-10-02
**Current:** `63-analytics-current.png`
**Concept:** `64-analytics-northstar-concept.jpg`

### Job of this lens
One chart from one DTU stream. Live was still spinning under Overview / Revenue / DTUs / Actions / Platform / Events, with Forecast, Inference, ML, Hypothesis, Attention above that.

### Keep
- The chart, once a stream is chosen
- Analytics · Forecast pill

### Kill / hide by default
- The double tab walls, quick tour, Agent FAB

### Empty state
Serif “The one chart, Ramaj”.

### Primary CTA / composer
`Choose a stream`

## Marketplace (`/lenses/marketplace`)

**Status:** packed 2026-10-02
**Current:** `65-marketplace-current.png`
**Concept:** `66-marketplace-northstar-concept.jpg`

### Job of this lens
Works for sale. Live tour: the grid is provenance, price, license. Activity was “Waiting for activity…”.

### Keep
- Listing tiles from the real catalog
- Marketplace · Auctions pill

### Kill / hide by default
- Browse / Sell / Cart / Purchases / Watchlist / Analytics plus All / Templates / Components / Artwork / Plugins, Seller Dashboard, Agent FAB, quick tour

### Empty state
Serif “What's for sale, Ramaj”.

### Primary CTA / composer
`+ List a work`

## Trades (`/lenses/trades`)

**Status:** packed 2026-10-02
**Current:** `67-trades-current.png`
**Concept:** `68-trades-northstar-concept.jpg`

### Job of this lens
The job on the dispatch board. Live was “Loading your data…” under Trades & Construction, with Carpentry, Plumbing, Electrical, HVAC, Welding, Masonry tabs. Tour: estimates use material + labor + permit tables.

### Keep
- One job card (trade, place, estimate) when dispatch returns one
- A short trade pill, not every craft at once

### Kill / hide by default
- The craft tab wall, quick tour, Agent FAB

### Empty state
Serif “The job on the board, Ramaj”.

### Primary CTA / composer
`+ New job`

## Creator (`/lenses/creator`)

**Status:** packed 2026-10-02
**Current:** `69-creator-current.png`
**Concept:** `70-creator-northstar-concept.jpg`

### Job of this lens
The piece and its royalty. Live: stats still loading, “No significant drift”, trending citations 0, badge Simulated.

### Keep
- The piece, the royalty line, the drift sentence when the engine returns one
- Creator · Gallery pill

### Kill / hide by default
- Fashion / Photography / Gallery / Photos tab wall, Home / Pipeline / Listings tree, influence chart as the body, Agent FAB

### Empty state
Serif “What you made, Ramaj”.

### Primary CTA / composer
`+ Publish`

## Crypto (`/lenses/crypto`)

**Status:** packed 2026-10-02
**Current:** `71-crypto-current.png`
**Concept:** `72-crypto-northstar-concept.jpg`

### Job of this lens
The wallet. Live portfolio was $0.00 and 0.00% over 24h, with Send / Receive / Swap as three equal buttons. 224 DTUs.

### Keep
- The balance the wallet actually returns
- One primary action

### Kill / hide by default
- The three-up Send/Receive/Swap wall (Receive stays as the single CTA), Agent FAB, quick tour

### Empty state
Serif “The wallet, Ramaj” and `$0.00` only when that is the balance.

### Primary CTA / composer
`Receive`

## Research (`/lenses/research`)

**Status:** packed 2026-10-02
**Current:** `73-research-current.png`
**Concept:** `74-research-northstar-concept.jpg`

### Job of this lens
What you are reading. Live library chip said 4,262 DTUs, with Search / Library / CrossRef / arXiv / Workbench and a vision-analyze button.

### Keep
- Search, then one open paper
- The real library count, quiet
- Research · Library · arXiv pill

### Kill / hide by default
- Paper / Science / Philosophy / Linguistics / History / Mentorship tab wall, quick tour, Agent FAB

### Empty state
Serif “What are you reading, Ramaj”.

### Primary CTA / composer
`Search`

## Lab (`/lenses/lab`)

**Status:** packed 2026-10-02
**Current:** `75-lab-current.png`
**Concept:** `76-lab-northstar-concept.jpg`

### Job of this lens
The experiment. Live was SIM_GRADE_A with 0 in substrate and 59 featured actions (calibration, constructs, experiment design, inventory).

### Keep
- Protocol and the run result
- Lab · Physics · Chem pill

### Kill / hide by default
- Quantum / Materials / Math / Engineering / Robotics tab wall, featured-action grid, Agent FAB

### Empty state
Serif “The experiment, Ramaj” and “No run”.

### Primary CTA / composer
`+ New experiment`

## Frontier (`/lenses/frontier`)

**Status:** packed 2026-10-02
**Current:** `77-frontier-current.png`
**Concept:** `78-frontier-northstar-concept.jpg`

### Job of this lens
One engineering case. Live form was a cantilever in ASTM A36, fatigue (Paris), span 0.5 m, section 50×10 mm, tip load 200 N, 300 cycles/year, under Degradation plus FSI, Safety Envelope, QEC, Model Checker, Consensus, and four more modes.

### Keep
- Those inputs when they are the open case, and Compute
- Degradation · Safety as the pill; other modes via the palette

### Kill / hide by default
- The numbered mode strip, Agent FAB, Install banner

### Empty state
Serif “The beam, Ramaj” with the open case, not a fake stress result.

### Primary CTA / composer
`Compute`

## Agents (`/lenses/agents`)

**Status:** packed 2026-10-02
**Current:** `79-agents-current.png`
**Concept:** `80-agents-northstar-concept.jpg`

### Job of this lens
Who is working. Live fleet tiles were zeros (including 0% success and nothing running). Tour: each agent has a brain slot, a role, and a tool whitelist.

### Keep
- One agent and the job it is on
- Agents · Personas pill

### Kill / hide by default
- Fleet / Roster / Forked-self desks, the zero tiles, the four-brain story as chrome, Agent FAB

### Empty state
Serif “Who is working, Ramaj” and “None running”.

### Primary CTA / composer
`+ New agent`

## Messages (`/lenses/message`)

**Status:** packed 2026-10-02
**Current:** `81-message-current.png`
**Concept:** `82-message-northstar-concept.jpg`

### Job of this lens
One thread. Live inbox count was 0, with Workbench / Labels / Connect numbered beside Inbox, plus a Mail tab.

### Keep
- Thread list and the open conversation
- Messages · Mail pill

### Kill / hide by default
- Workbench, Labels, Connect as peer desks, quick tour, Agent FAB

### Empty state
Serif “Who wrote, Ramaj”.

### Primary CTA / composer
`+ New message`

## Social (`/lenses/social`)

**Status:** packed 2026-10-02
**Current:** `83-social-current.png`
**Concept:** `84-social-northstar-concept.jpg`

### Job of this lens
One feed. Live had a Stories ring (“Your story”), Feed / For You / Reels / Spaces, and “Set up your profile”. 794 DTUs.

### Keep
- The composer and the next real post
- Feed as the only tab on the glass

### Kill / hide by default
- Stories, Reels, Spaces, day-streak chip, profile-setup wall, Agent FAB, quick tour

### Empty state
Serif “What's moving, Ramaj”. Do not invent posts.

### Primary CTA / composer
`Post`

## Council (`/lenses/council`)

**Status:** packed 2026-10-02
**Current:** `85-council-current.png`
**Concept:** `86-council-northstar-concept.jpg`

### Job of this lens
The question on the table. Live: 0 proposals, 0 active votes, 0% participation, 0 committees, and a green “Quorum Met” beside that emptiness. Also reached as a Chat absorbed tab (Governance).

### Keep
- One proposal and its ballot when one exists
- Council · Votes pill

### Kill / hide by default
- Start Debate / Call Vote / Export as a tile row, the zero stat grid, Quorum Met when there is no ballot, Chat’s Threads/Forum/Daily/Anon/Voice/Feed strip, Agent FAB

### Empty state
Serif “What's the question, Ramaj” and “No proposal on the table”.

### Primary CTA / composer
`Start a debate`

## Threads (`/lenses/thread`)

**Status:** packed 2026-10-02
**Current:** `87-thread-current.png`
**Concept:** `88-thread-northstar-concept.jpg`

### Job of this lens
One branching thread. Live desks were Map, Composer, Studio, Feed, Tree. 2 DTUs.

### Keep
- The open thread and its replies
- Chat · Threads · Forum · Daily pill (Governance is Council, already packed)

### Kill / hide by default
- The numbered desk row, Ask about Threads, Agent FAB, brain/wallet bar

### Empty state
Serif “Which branch, Ramaj”.

### Primary CTA / composer
`Reply`

## Forum (`/lenses/forum`)

**Status:** packed 2026-10-02
**Current:** `89-forum-current.png`
**Concept:** `90-forum-northstar-concept.jpg`

### Job of this lens
The board. Live counters under the tour were zeros (including saved and flags). Ranking (votes + recency + engagement) stays in the engine.

### Keep
- The post list when posts exist
- Chat family pill

### Kill / hide by default
- Discourse / Board / Chatter / Mod tools numbered desks, quick tour, Agent FAB

### Empty state
Serif “What's worth reading, Ramaj” and “No posts on the board”.

### Primary CTA / composer
`+ New post`

## Daily (`/lenses/daily`)

**Status:** packed 2026-10-02
**Current:** `91-daily-current.png`
**Concept:** `92-daily-northstar-concept.jpg`

### Job of this lens
Today’s page. Live date was Friday, October 2, 2026, production journal, 0 entries this week, a mood row, and Generate Digest.

### Keep
- The date and a blank page to type into
- Digest only after there is text to summarize

### Kill / hide by default
- Month calendar beside the entry, Studio / Inspiration desks, five mood faces as the body, Agent FAB, quick tour

### Empty state
The date in serif, and “0 entries” until one exists.

### Primary CTA / composer
`Write`

## Anonymous (`/lenses/anon`)

**Status:** packed 2026-10-02
**Current:** `93-anon-current.png`
**Concept:** `94-anon-northstar-concept.jpg`

### Job of this lens
Say it without a name. Live tour: post_anonymous strips identifying metadata before persist. 2 DTUs.

### Keep
- The composer and the strip-identity guarantee, stated in the UI
- Chat family pill

### Kill / hide by default
- Workspace chrome, quick tour, Agent FAB

### Empty state
Serif “Say it unnamed, Ramaj”.

### Primary CTA / composer
`Post`

## Voice (`/lenses/voice`)

**Status:** packed 2026-10-02
**Current:** `95-voice-current.png`
**Concept:** `96-voice-northstar-concept.jpg`

### Job of this lens
The booth. Live: built-in microphone, session timer, 0 takes, meter that auto-pauses on silence.

### Keep
- Record, the meter, the take count
- Chat family pill

### Kill / hide by default
- Booth / Transcripts / Meetings / Library / Analyze numbered desks, processing chain, Agent FAB, quick tour

### Empty state
Serif “Hold to talk, Ramaj” and “0 takes”.

### Primary CTA / composer
`Record`

## Feed (`/lenses/feed`)

**Status:** packed 2026-10-02
**Current:** `97-feed-current.png`
**Concept:** `98-feed-northstar-concept.jpg`

### Job of this lens
The next post. Live tour: posts can cite DTUs; ranking uses past interactions. Lens chip said 6,523 DTUs — that is the corpus, not a card count to invent.

### Keep
- One column of real posts
- Chat · Feed · News pill

### Kill / hide by default
- Ask about Feed, Agent FAB, quick tour, the rest of the Chat tab strip

### Empty state
Serif “The next thing, Ramaj” until the ranker returns a post. Do not fabricate cards.

### Primary CTA / composer
`Refresh`

## News (`/lenses/news`)

**Status:** packed 2026-10-02
**Current:** `99-news-current.png`
**Concept:** `100-news-northstar-concept.jpg`

### Job of this lens
What changed. Live desk was Fetching, with Headlines 0, Sources 0, Countries 0, In analysis 0, and a category chip row (Business through Entertainment). 870 DTUs.

### Keep
- The pull state, then the headlines the pull actually returns
- Chat · News · Feed pill

### Kill / hide by default
- Four zero tiles, the category chip wall, Live Desk / My Reader as a second app, Agent FAB, cookie and install banners

### Empty state
Serif “What changed, Ramaj” and “Fetching” until headlines exist. Do not invent stories.

### Primary CTA / composer
`Refresh`

## Per-lens stub template (copy for each new lens)

```md
## <Lens name> (`/lenses/<id>`)

**Status:** pending | concept-ready | approved YYYY-MM-DD  
**Current:** `<nn>-<id>-current.png`  
**Concept:** `<nn>-<id>-northstar-concept.jpg`

### Job of this lens
<one sentence>

### Keep
- …

### Kill / hide by default
- …

### Empty state
- …

### Primary CTA / composer
- …

### Absorbed children (subtle only)
- …
```

---

## Asset naming

- `NN-<lensId>-current.png` — live screenshot baseline  
- `NN-<lensId>-northstar-concept.jpg` — approved-direction concept  
- Update the tables in this file when assets land  
- Bump `STATUS.md` one-liners

---

## Workflow for Grok / Claude

1. Screenshot live current → `*-current.png`  
2. Generate concept aligned to Shared principles → `*-northstar-concept.*`  
3. Human approve  
4. Claude implements toward concept on `concord-web`  
5. Mark APPROVED in this file  

Do **not** cut live traffic blindly; Ramaj is iterating live UI on the open pod.


## Remaining routes (packed 2026-10-02)

Same Claude-clean family as Code and Studio: deep black, thin icon rail, serif greeting, one teal action. Empty state only — no invented prices, patients, headlines, balances, or quorum. Shared kill on the live chrome: app sidebar, brain dots, wallet chip, Ask-about, Agent control, Install banner, right strip.

| Lens | Path | Current | Concept | Greeting | CTA |
|---|---|---|---|---|---|
| Saved | `/lenses/saved` | `101-saved-current.png` | `102-saved-northstar-concept.jpg` | What's worth keeping, Ramaj | `Open saved` |
| Resonance | `/lenses/resonance` | `103-resonance-current.png` | `104-resonance-northstar-concept.jpg` | What still resonates, Ramaj | `Review` |
| Docs | `/lenses/docs` | `105-docs-current.png` | `106-docs-northstar-concept.jpg` | The document, Ramaj | `+ New doc` |
| Paper | `/lenses/paper` | `107-paper-current.png` | `108-paper-northstar-concept.jpg` | The paper in front of you, Ramaj | `Open a paper` |
| DTU Browser | `/lenses/dtus` | `109-dtus-current.png` | `110-dtus-northstar-concept.jpg` | One unit of thought, Ramaj | `Browse` |
| Literary | `/lenses/literary` | `111-literary-current.png` | `112-literary-northstar-concept.jpg` | The passage, Ramaj | `Open a text` |
| Understanding | `/lenses/understanding` | `113-understanding-current.png` | `114-understanding-northstar-concept.jpg` | What you understand, Ramaj | `Start from a DTU` |
| Classroom | `/lenses/classroom` | `115-classroom-current.png` | `116-classroom-northstar-concept.jpg` | The room, Ramaj | `Open a class` |
| Forecast | `/lenses/forecast` | `117-forecast-current.png` | `118-forecast-northstar-concept.jpg` | The next reading, Ramaj | `Choose a series` |
| Productivity | `/lenses/productivity` | `119-productivity-current.png` | `120-productivity-northstar-concept.jpg` | Today's short list, Ramaj | `+ Add` |
| The Answers | `/lenses/answers` | `121-answers-current.png` | `122-answers-northstar-concept.jpg` | The question, Ramaj | `Ask` |
| CRI | `/lenses/cri` | `123-cri-current.png` | `124-cri-northstar-concept.jpg` | The index, Ramaj | `Open the index` |
| History | `/lenses/history` | `125-history-current.png` | `126-history-northstar-concept.jpg` | The record, Ramaj | `Open a record` |
| Linguistics | `/lenses/linguistics` | `127-linguistics-current.png` | `128-linguistics-northstar-concept.jpg` | The utterance, Ramaj | `Open a text` |
| Codex | `/lenses/codex` | `129-codex-current.png` | `130-codex-northstar-concept.jpg` | The codex page, Ramaj | `Open a page` |
| Philosophy | `/lenses/philosophy` | `131-philosophy-current.png` | `132-philosophy-northstar-concept.jpg` | The question on the table, Ramaj | `Begin` |
| Crafting | `/lenses/crafting` | `133-crafting-current.png` | `134-crafting-northstar-concept.jpg` | The piece on the bench, Ramaj | `+ Start a piece` |
| Photos | `/lenses/photos` | `135-photos-current.png` | `136-photos-northstar-concept.jpg` | The frame, Ramaj | `Import` |
| Narrative trail | `/lenses/narrative-walk` | `137-narrative-walk-current.png` | `138-narrative-walk-northstar-concept.jpg` | The next step, Ramaj | `Begin the walk` |
| Gallery | `/lenses/gallery` | `139-gallery-current.png` | `140-gallery-northstar-concept.jpg` | The wall, Ramaj | `Hang a work` |
| Maker | `/lenses/maker` | `141-maker-current.png` | `142-maker-northstar-concept.jpg` | The make, Ramaj | `+ New make` |
| TheVault | `/lenses/vault` | `143-vault-current.png` | `144-vault-northstar-concept.jpg` | The vault, Ramaj | `Open the vault` |
| Animation | `/lenses/animation` | `145-animation-current.png` | `146-animation-northstar-concept.jpg` | The shot, Ramaj | `+ New shot` |
| Artistry | `/lenses/artistry` | `147-artistry-current.png` | `148-artistry-northstar-concept.jpg` | The study, Ramaj | `+ New study` |
| Creative Writing | `/lenses/creative-writing` | `149-creative-writing-current.png` | `150-creative-writing-northstar-concept.jpg` | The page, Ramaj | `+ New page` |
| Film Studios | `/lenses/film-studios` | `151-film-studios-current.png` | `152-film-studios-northstar-concept.jpg` | The production, Ramaj | `+ New production` |
| Game Design | `/lenses/game-design` | `153-game-design-current.png` | `154-game-design-northstar-concept.jpg` | The design, Ramaj | `+ New design` |
| Photography | `/lenses/photography` | `155-photography-current.png` | `156-photography-northstar-concept.jpg` | The roll, Ramaj | `Import a roll` |
| Poetry | `/lenses/poetry` | `157-poetry-current.png` | `158-poetry-northstar-concept.jpg` | The poem, Ramaj | `+ New poem` |
| Cognition | `/lenses/cognition` | `159-cognition-current.png` | `160-cognition-northstar-concept.jpg` | The trace, Ramaj | `Open a trace` |
| Cognitive Replay | `/lenses/cognitive-replay` | `161-cognitive-replay-current.png` | `162-cognitive-replay-northstar-concept.jpg` | Replay the moment, Ramaj | `Choose a moment` |
| Dreams | `/lenses/dreams` | `163-dreams-current.png` | `164-dreams-northstar-concept.jpg` | Last night's note, Ramaj | `Record a dream` |
| Expert Mode | `/lenses/expert-mode` | `165-expert-mode-current.png` | `166-expert-mode-northstar-concept.jpg` | The expert desk, Ramaj | `Ask the desk` |
| Forge | `/lenses/forge` | `167-forge-current.png` | `168-forge-northstar-concept.jpg` | What's in the forge, Ramaj | `+ Start` |
| Lattice | `/lenses/lattice` | `169-lattice-current.png` | `170-lattice-northstar-concept.jpg` | The lattice, Ramaj | `Open a cell` |
| Personas | `/lenses/personas` | `171-personas-current.png` | `172-personas-northstar-concept.jpg` | Who you're talking with, Ramaj | `+ New persona` |
| World Model | `/lenses/worldmodel` | `173-worldmodel-current.png` | `174-worldmodel-northstar-concept.jpg` | The model, Ramaj | `Open a model` |
| HLR Traces | `/lenses/reasoning/traces` | `175-reasoning-traces-current.png` | `176-reasoning-traces-northstar-concept.jpg` | The trace, Ramaj | `Open a trace` |
| Genesis | `/lenses/genesis` | `177-genesis-current.png` | `178-genesis-northstar-concept.jpg` | Where it starts, Ramaj | `Begin` |
| ML | `/lenses/ml` | `179-ml-current.png` | `180-ml-northstar-concept.jpg` | The run, Ramaj | `Choose a run` |
| Translation | `/lenses/translation` | `181-translation-current.png` | `182-translation-northstar-concept.jpg` | The line to translate, Ramaj | `Paste a line` |
| Reasoning | `/lenses/reasoning` | `183-reasoning-current.png` | `184-reasoning-northstar-concept.jpg` | The argument, Ramaj | `Begin` |
| Hypothesis | `/lenses/hypothesis` | `185-hypothesis-current.png` | `186-hypothesis-northstar-concept.jpg` | The hypothesis, Ramaj | `+ State one` |
| Inference | `/lenses/inference` | `187-inference-current.png` | `188-inference-northstar-concept.jpg` | What follows, Ramaj | `Choose premises` |
| Metacognition | `/lenses/metacognition` | `189-metacognition-current.png` | `190-metacognition-northstar-concept.jpg` | How you know, Ramaj | `Begin a review` |
| Metalearning | `/lenses/metalearning` | `191-metalearning-current.png` | `192-metalearning-northstar-concept.jpg` | What improved, Ramaj | `Review a skill` |
| Reflection | `/lenses/reflection` | `193-reflection-current.png` | `194-reflection-northstar-concept.jpg` | Sit with it, Ramaj | `Write` |
| Affect | `/lenses/affect` | `195-affect-current.png` | `196-affect-northstar-concept.jpg` | How it feels, Ramaj | `Note a feeling` |
| Attention | `/lenses/attention` | `197-attention-current.png` | `198-attention-northstar-concept.jpg` | Where attention went, Ramaj | `Review a session` |
| Commonsense | `/lenses/commonsense` | `199-commonsense-current.png` | `200-commonsense-northstar-concept.jpg` | The obvious check, Ramaj | `Ask` |
| Transfer | `/lenses/transfer` | `201-transfer-current.png` | `202-transfer-northstar-concept.jpg` | What carries over, Ramaj | `Choose a source` |
| Grounding | `/lenses/grounding` | `203-grounding-current.png` | `204-grounding-northstar-concept.jpg` | What it's tied to, Ramaj | `Ground a claim` |
| Experience | `/lenses/experience` | `205-experience-current.png` | `206-experience-northstar-concept.jpg` | The experience, Ramaj | `Log one` |
| Bio | `/lenses/bio` | `207-bio-current.png` | `208-bio-northstar-concept.jpg` | The specimen, Ramaj | `Open a record` |
| Chem | `/lenses/chem` | `209-chem-current.png` | `210-chem-northstar-concept.jpg` | The notebook, Ramaj | `Open a page` |
| Physics | `/lenses/physics` | `211-physics-current.png` | `212-physics-northstar-concept.jpg` | The system, Ramaj | `Set up a system` |
| Math | `/lenses/math` | `213-math-current.png` | `214-math-northstar-concept.jpg` | The expression, Ramaj | `+ New sheet` |
| Refusal Algebra | `/lenses/root` | `215-root-current.png` | `216-root-northstar-concept.jpg` | The refusal, Ramaj | `Inspect a field` |
| Quantum | `/lenses/quantum` | `217-quantum-current.png` | `218-quantum-northstar-concept.jpg` | The state, Ramaj | `Open a state` |
| Neuro | `/lenses/neuro` | `219-neuro-current.png` | `220-neuro-northstar-concept.jpg` | The signal, Ramaj | `Open a recording` |
| Astronomy | `/lenses/astronomy` | `221-astronomy-current.png` | `222-astronomy-northstar-concept.jpg` | The sky, Ramaj | `Point the chart` |
| Atlas | `/lenses/atlas` | `223-atlas-current.png` | `224-atlas-northstar-concept.jpg` | The map, Ramaj | `Choose a place` |
| Robotics | `/lenses/robotics` | `225-robotics-current.png` | `226-robotics-northstar-concept.jpg` | The rig, Ramaj | `Connect a rig` |
| Space | `/lenses/space` | `227-space-current.png` | `228-space-northstar-concept.jpg` | The mission, Ramaj | `Open a mission` |
| Federation | `/lenses/federation` | `229-federation-current.png` | `230-federation-northstar-concept.jpg` | The link, Ramaj | `Check the link` |
| Anomaly Review | `/lenses/world-creator/anomalies` | `231-world-creator-anomalies-current.png` | `232-world-creator-anomalies-northstar-concept.jpg` | The anomaly, Ramaj | `Review the queue` |
| Civic Bonds | `/lenses/civic-bonds` | `233-civic-bonds-current.png` | `234-civic-bonds-northstar-concept.jpg` | The bond, Ramaj | `Open a bond` |
| Crisis Ops | `/lenses/crisis-ops` | `235-crisis-ops-current.png` | `236-crisis-ops-northstar-concept.jpg` | The incident, Ramaj | `Open an incident` |
| Kingdoms | `/lenses/kingdoms` | `237-kingdoms-current.png` | `238-kingdoms-northstar-concept.jpg` | The realm, Ramaj | `Open a realm` |
| PsyOps | `/lenses/psyops` | `239-psyops-current.png` | `240-psyops-northstar-concept.jpg` | The brief, Ramaj | `Open a brief` |
| The Ledger | `/lenses/ledger` | `241-ledger-current.png` | `242-ledger-northstar-concept.jpg` | The ledger line, Ramaj | `+ Entry` |
| Market | `/lenses/market` | `243-market-current.png` | `244-market-northstar-concept.jpg` | The book, Ramaj | `Refresh` |
| Questmarket | `/lenses/questmarket` | `245-questmarket-current.png` | `246-questmarket-northstar-concept.jpg` | The board, Ramaj | `+ Post a quest` |
| Vote | `/lenses/vote` | `247-vote-current.png` | `248-vote-northstar-concept.jpg` | The ballot, Ramaj | `Open a ballot` |
| Ethics | `/lenses/ethics` | `249-ethics-current.png` | `250-ethics-northstar-concept.jpg` | The case, Ramaj | `Open a case` |
| Alliance | `/lenses/alliance` | `251-alliance-current.png` | `252-alliance-northstar-concept.jpg` | The pact, Ramaj | `Open a pact` |
| Billing | `/lenses/billing` | `253-billing-current.png` | `254-billing-northstar-concept.jpg` | The invoice, Ramaj | `+ New invoice` |
| Debate | `/lenses/debate` | `255-debate-current.png` | `256-debate-northstar-concept.jpg` | The motion, Ramaj | `Open a motion` |
| Mentorship | `/lenses/mentorship` | `257-mentorship-current.png` | `258-mentorship-northstar-concept.jpg` | The mentor, Ramaj | `Request` |
| Disputes | `/lenses/disputes` | `259-disputes-current.png` | `260-disputes-northstar-concept.jpg` | The dispute, Ramaj | `+ Open` |
| Privacy | `/lenses/privacy` | `261-privacy-current.png` | `262-privacy-northstar-concept.jpg` | Your controls, Ramaj | `Review` |
| Wallet | `/lenses/wallet` | `263-wallet-current.png` | `264-wallet-northstar-concept.jpg` | What you hold, Ramaj | `Refresh` |
| Command Center | `/lenses/command-center` | `265-command-center-current.png` | `266-command-center-northstar-concept.jpg` | The one alert, Ramaj | `Refresh` |
| Announcements | `/lenses/announcements` | `267-announcements-current.png` | `268-announcements-northstar-concept.jpg` | The notice, Ramaj | `+ Post` |
| UX Suite | `/lenses/ux-suite` | `269-ux-suite-current.png` | `270-ux-suite-northstar-concept.jpg` | Where the pieces live, Ramaj | `Open a surface` |
| API Keys | `/lenses/byo-keys` | `271-byo-keys-current.png` | `272-byo-keys-northstar-concept.jpg` | Your keys, Ramaj | `+ Add a key` |
| Code Quality | `/lenses/code-quality` | `273-code-quality-current.png` | `274-code-quality-northstar-concept.jpg` | The finding, Ramaj | `Run a check` |
| DX Platform | `/lenses/dx-platform` | `275-dx-platform-current.png` | `276-dx-platform-northstar-concept.jpg` | The platform desk, Ramaj | `Open a tool` |
| Mesh | `/lenses/mesh` | `277-mesh-current.png` | `278-mesh-northstar-concept.jpg` | The mesh, Ramaj | `Refresh` |
| Observe | `/lenses/observe` | `279-observe-current.png` | `280-observe-northstar-concept.jpg` | What's happening, Ramaj | `Choose a signal` |
| Ops | `/lenses/ops` | `281-ops-current.png` | `282-ops-northstar-concept.jpg` | The board, Ramaj | `Refresh` |
| Sandbox | `/lenses/sandbox` | `283-sandbox-current.png` | `284-sandbox-northstar-concept.jpg` | The sandbox, Ramaj | `+ New sandbox` |
| Sentinel | `/lenses/sentinel` | `285-sentinel-current.png` | `286-sentinel-northstar-concept.jpg` | The watch, Ramaj | `Refresh` |
| Sessions | `/lenses/sessions` | `287-sessions-current.png` | `288-sessions-northstar-concept.jpg` | This session, Ramaj | `Open a session` |
| Strategic Adds | `/lenses/strategic-adds` | `289-strategic-adds-current.png` | `290-strategic-adds-northstar-concept.jpg` | The add, Ramaj | `Review the list` |
| Sync | `/lenses/sync` | `291-sync-current.png` | `292-sync-northstar-concept.jpg` | What's in sync, Ramaj | `Sync now` |
| System | `/lenses/system` | `293-system-current.png` | `294-system-northstar-concept.jpg` | The system, Ramaj | `Refresh` |
| Tools | `/lenses/tools` | `295-tools-current.png` | `296-tools-northstar-concept.jpg` | The tool, Ramaj | `Open a tool` |
| Ops Telemetry | `/lenses/ops-telemetry` | `297-ops-telemetry-current.png` | `298-ops-telemetry-northstar-concept.jpg` | The heartbeat, Ramaj | `Refresh` |
| World Observatory | `/lenses/world-observatory` | `299-world-observatory-current.png` | `300-world-observatory-northstar-concept.jpg` | From above, Ramaj | `Choose a world` |
| Concord Link Frontier | `/lenses/concord-link-frontier` | `301-concord-link-frontier-current.png` | `302-concord-link-frontier-northstar-concept.jpg` | The frontier link, Ramaj | `Open the link` |
| Plugin Gallery | `/lenses/plugins` | `303-plugins-current.png` | `304-plugins-northstar-concept.jpg` | The plugin, Ramaj | `Browse` |
| Settings | `/lenses/settings` | `305-settings-current.png` | `306-settings-northstar-concept.jpg` | Your settings, Ramaj | `Review` |
| Platform | `/lenses/platform` | `307-platform-current.png` | `308-platform-northstar-concept.jpg` | The platform, Ramaj | `Refresh` |
| Admin | `/lenses/admin` | `309-admin-current.png` | `310-admin-northstar-concept.jpg` | The admin desk, Ramaj | `Refresh` |
| Audit | `/lenses/audit` | `311-audit-current.png` | `312-audit-northstar-concept.jpg` | The trail, Ramaj | `Refresh` |
| Integrations | `/lenses/integrations` | `313-integrations-current.png` | `314-integrations-northstar-concept.jpg` | The connection, Ramaj | `+ Connect` |
| Queue | `/lenses/queue` | `315-queue-current.png` | `316-queue-northstar-concept.jpg` | The queue, Ramaj | `Refresh` |
| Tick | `/lenses/tick` | `317-tick-current.png` | `318-tick-northstar-concept.jpg` | The tick, Ramaj | `Refresh` |
| Lock | `/lenses/lock` | `319-lock-current.png` | `320-lock-northstar-concept.jpg` | What's locked, Ramaj | `Review locks` |
| Offline | `/lenses/offline` | `321-offline-current.png` | `322-offline-northstar-concept.jpg` | The offline shelf, Ramaj | `Queue` |
| App Maker | `/lenses/app-maker` | `323-app-maker-current.png` | `324-app-maker-northstar-concept.jpg` | The app you're making, Ramaj | `+ New app` |
| Bridge | `/lenses/bridge` | `325-bridge-current.png` | `326-bridge-northstar-concept.jpg` | The bridge, Ramaj | `Open a bridge` |
| All DTUs | `/lenses/all` | `327-all-current.png` | `328-all-northstar-concept.jpg` | Everything you can reach, Ramaj | `Search` |
| Black Market | `/lenses/black-market` | `329-black-market-current.png` | `330-black-market-northstar-concept.jpg` | The listing, Ramaj | `Browse` |
| Collab | `/lenses/collab` | `331-collab-current.png` | `332-collab-northstar-concept.jpg` | The room, Ramaj | `Open a room` |
| Suffering | `/lenses/suffering` | `333-suffering-current.png` | `334-suffering-northstar-concept.jpg` | The signal, Ramaj | `Review` |
| Invariant | `/lenses/invariant` | `335-invariant-current.png` | `336-invariant-northstar-concept.jpg` | The invariant, Ramaj | `Open one` |
| Fork | `/lenses/fork` | `337-fork-current.png` | `338-fork-northstar-concept.jpg` | The fork, Ramaj | `Open a fork` |
| Law | `/lenses/law` | `339-law-current.png` | `340-law-northstar-concept.jpg` | The matter, Ramaj | `+ New matter` |
| Legacy | `/lenses/legacy` | `341-legacy-current.png` | `342-legacy-northstar-concept.jpg` | What you leave, Ramaj | `Open a record` |
| Organ | `/lenses/organ` | `343-organ-current.png` | `344-organ-northstar-concept.jpg` | The organ, Ramaj | `Open one` |
| Export | `/lenses/export` | `345-export-current.png` | `346-export-northstar-concept.jpg` | The export, Ramaj | `Export` |
| Import | `/lenses/import` | `347-import-current.png` | `348-import-northstar-concept.jpg` | The import, Ramaj | `Import` |
| Ingest | `/lenses/ingest` | `349-ingest-current.png` | `350-ingest-northstar-concept.jpg` | The intake, Ramaj | `Add a source` |
| Courtship | `/lenses/courtship` | `351-courtship-current.png` | `352-courtship-northstar-concept.jpg` | The person, Ramaj | `Open a bond` |
| Fishing | `/lenses/fishing` | `353-fishing-current.png` | `354-fishing-northstar-concept.jpg` | The cast, Ramaj | `Start a session` |
| Creatures | `/lenses/creatures` | `355-creatures-current.png` | `356-creatures-northstar-concept.jpg` | The creature, Ramaj | `Open a creature` |
| Garage | `/lenses/garage` | `357-garage-current.png` | `358-garage-northstar-concept.jpg` | The bay, Ramaj | `Open a bay` |
| Repair Telemetry | `/lenses/repair-telemetry` | `359-repair-telemetry-current.png` | `360-repair-telemetry-northstar-concept.jpg` | The fault, Ramaj | `Refresh` |
| Move Builder | `/lenses/move-builder` | `361-move-builder-current.png` | `362-move-builder-northstar-concept.jpg` | The move, Ramaj | `+ New move` |
| Custom | `/lenses/custom` | `363-custom-current.png` | `364-custom-northstar-concept.jpg` | Your layout, Ramaj | `Start` |
| Food | `/lenses/food` | `365-food-current.png` | `366-food-northstar-concept.jpg` | The meal, Ramaj | `+ Log a meal` |
| Retail | `/lenses/retail` | `367-retail-current.png` | `368-retail-northstar-concept.jpg` | The counter, Ramaj | `Open the till` |
| Household | `/lenses/household` | `369-household-current.png` | `370-household-northstar-concept.jpg` | The house, Ramaj | `Open a room` |
| Agriculture | `/lenses/agriculture` | `371-agriculture-current.png` | `372-agriculture-northstar-concept.jpg` | The field, Ramaj | `Open a plot` |
| Logistics | `/lenses/logistics` | `373-logistics-current.png` | `374-logistics-northstar-concept.jpg` | The shipment, Ramaj | `Track` |
| Education | `/lenses/education` | `375-education-current.png` | `376-education-northstar-concept.jpg` | The lesson, Ramaj | `Open a lesson` |
| Nonprofit | `/lenses/nonprofit` | `377-nonprofit-current.png` | `378-nonprofit-northstar-concept.jpg` | The program, Ramaj | `Open a program` |
| Real Estate | `/lenses/realestate` | `379-realestate-current.png` | `380-realestate-northstar-concept.jpg` | The property, Ramaj | `Open a listing` |
| Fitness | `/lenses/fitness` | `381-fitness-current.png` | `382-fitness-northstar-concept.jpg` | The session, Ramaj | `Start a session` |
| Creative Production | `/lenses/creative` | `383-creative-current.png` | `384-creative-northstar-concept.jpg` | The production, Ramaj | `+ New` |
| Manufacturing | `/lenses/manufacturing` | `385-manufacturing-current.png` | `386-manufacturing-northstar-concept.jpg` | The work order, Ramaj | `+ Work order` |
| Environment | `/lenses/environment` | `387-environment-current.png` | `388-environment-northstar-concept.jpg` | The reading, Ramaj | `Choose a station` |
| Government | `/lenses/government` | `389-government-current.png` | `390-government-northstar-concept.jpg` | The filing, Ramaj | `Open a filing` |
| Aviation | `/lenses/aviation` | `391-aviation-current.png` | `392-aviation-northstar-concept.jpg` | The flight, Ramaj | `Open a flight` |
| Events | `/lenses/events` | `393-events-current.png` | `394-events-northstar-concept.jpg` | The event, Ramaj | `+ New event` |
| Science | `/lenses/science` | `395-science-current.png` | `396-science-northstar-concept.jpg` | The experiment, Ramaj | `+ New experiment` |
| Security | `/lenses/security` | `397-security-current.png` | `398-security-northstar-concept.jpg` | The alert, Ramaj | `Refresh` |
| Services | `/lenses/services` | `399-services-current.png` | `400-services-northstar-concept.jpg` | The engagement, Ramaj | `+ New` |
| Insurance | `/lenses/insurance` | `401-insurance-current.png` | `402-insurance-northstar-concept.jpg` | The policy, Ramaj | `Open a policy` |
| Travel | `/lenses/travel` | `403-travel-current.png` | `404-travel-northstar-concept.jpg` | The trip, Ramaj | `+ Plan a trip` |
| Fashion | `/lenses/fashion` | `405-fashion-current.png` | `406-fashion-northstar-concept.jpg` | The look, Ramaj | `+ New look` |
| Cooking | `/lenses/cooking` | `407-cooking-current.png` | `408-cooking-northstar-concept.jpg` | The recipe, Ramaj | `+ New recipe` |
| Home Improvement | `/lenses/home-improvement` | `409-home-improvement-current.png` | `410-home-improvement-northstar-concept.jpg` | The job, Ramaj | `+ New job` |
| Parenting | `/lenses/parenting` | `411-parenting-current.png` | `412-parenting-northstar-concept.jpg` | The note, Ramaj | `+ Add a note` |
| Pets | `/lenses/pets` | `413-pets-current.png` | `414-pets-northstar-concept.jpg` | The animal, Ramaj | `Open a pet` |
| Sports | `/lenses/sports` | `415-sports-current.png` | `416-sports-northstar-concept.jpg` | The match, Ramaj | `Open a league` |
| DIY | `/lenses/diy` | `417-diy-current.png` | `418-diy-northstar-concept.jpg` | The project, Ramaj | `+ New project` |
| Automotive | `/lenses/automotive` | `419-automotive-current.png` | `420-automotive-northstar-concept.jpg` | The vehicle, Ramaj | `Open a vehicle` |
| Carpentry | `/lenses/carpentry` | `421-carpentry-current.png` | `422-carpentry-northstar-concept.jpg` | The job, Ramaj | `+ New job` |
| Construction | `/lenses/construction` | `423-construction-current.png` | `424-construction-northstar-concept.jpg` | The site, Ramaj | `Open a site` |
| Consulting | `/lenses/consulting` | `425-consulting-current.png` | `426-consulting-northstar-concept.jpg` | The engagement, Ramaj | `+ New` |
| Defense | `/lenses/defense` | `427-defense-current.png` | `428-defense-northstar-concept.jpg` | The brief, Ramaj | `Open a brief` |
| Electrical | `/lenses/electrical` | `429-electrical-current.png` | `430-electrical-northstar-concept.jpg` | The job, Ramaj | `+ New job` |
| Emergency Services | `/lenses/emergency-services` | `431-emergency-services-current.png` | `432-emergency-services-northstar-concept.jpg` | The call, Ramaj | `Open the board` |
| Energy | `/lenses/energy` | `433-energy-current.png` | `434-energy-northstar-concept.jpg` | The load, Ramaj | `Choose a meter` |
| Engineering | `/lenses/engineering` | `435-engineering-current.png` | `436-engineering-northstar-concept.jpg` | The model, Ramaj | `+ New model` |
| Forestry | `/lenses/forestry` | `437-forestry-current.png` | `438-forestry-northstar-concept.jpg` | The stand, Ramaj | `Open a stand` |
| Geology | `/lenses/geology` | `439-geology-current.png` | `440-geology-northstar-concept.jpg` | The sample, Ramaj | `Open a sample` |
| HR | `/lenses/hr` | `441-hr-current.png` | `442-hr-northstar-concept.jpg` | The file, Ramaj | `Open a file` |
| HVAC | `/lenses/hvac` | `443-hvac-current.png` | `444-hvac-northstar-concept.jpg` | The job, Ramaj | `+ New job` |
| Landscaping | `/lenses/landscaping` | `445-landscaping-current.png` | `446-landscaping-northstar-concept.jpg` | The site, Ramaj | `+ New site` |
| Law Enforcement | `/lenses/law-enforcement` | `447-law-enforcement-current.png` | `448-law-enforcement-northstar-concept.jpg` | The case, Ramaj | `Open a case` |
| Masonry | `/lenses/masonry` | `449-masonry-current.png` | `450-masonry-northstar-concept.jpg` | The job, Ramaj | `+ New job` |
| Materials | `/lenses/materials` | `451-materials-current.png` | `452-materials-northstar-concept.jpg` | The spec, Ramaj | `Open a spec` |
| Mining | `/lenses/mining` | `453-mining-current.png` | `454-mining-northstar-concept.jpg` | The claim, Ramaj | `Open a claim` |
| Ocean | `/lenses/ocean` | `455-ocean-current.png` | `456-ocean-northstar-concept.jpg` | The water, Ramaj | `Choose a station` |
| Pharmacy | `/lenses/pharmacy` | `457-pharmacy-current.png` | `458-pharmacy-northstar-concept.jpg` | The order, Ramaj | `Open the queue` |
| Plumbing | `/lenses/plumbing` | `459-plumbing-current.png` | `460-plumbing-northstar-concept.jpg` | The job, Ramaj | `+ New job` |
| Supply Chain | `/lenses/supplychain` | `461-supplychain-current.png` | `462-supplychain-northstar-concept.jpg` | The link, Ramaj | `Track a shipment` |
| Telecom | `/lenses/telecommunications` | `463-telecommunications-current.png` | `464-telecommunications-northstar-concept.jpg` | The circuit, Ramaj | `Open a circuit` |
| Urban Planning | `/lenses/urban-planning` | `465-urban-planning-current.png` | `466-urban-planning-northstar-concept.jpg` | The parcel, Ramaj | `Open the map` |
| Veterinary | `/lenses/veterinary` | `467-veterinary-current.png` | `468-veterinary-northstar-concept.jpg` | The patient, Ramaj | `Open a chart` |
| Welding | `/lenses/welding` | `469-welding-current.png` | `470-welding-northstar-concept.jpg` | The joint, Ramaj | `+ New job` |
| Desert | `/lenses/desert` | `471-desert-current.png` | `472-desert-northstar-concept.jpg` | The reach, Ramaj | `Open the map` |
| Marketing | `/lenses/marketing` | `473-marketing-current.png` | `474-marketing-northstar-concept.jpg` | The campaign, Ramaj | `+ New campaign` |
| Mental Health | `/lenses/mental-health` | `475-mental-health-current.png` | `476-mental-health-northstar-concept.jpg` | The note, Ramaj | `Open a note` |
