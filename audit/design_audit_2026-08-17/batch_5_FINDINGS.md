# Batch 5 Design Audit — 27 Lenses

Generated 2026-08-17 | 27 lenses audited

---

## LENS: game

**PURPOSE:** Platform-native gamification layer — daily quests, habit tracking, XP/streak progression, achievements, leaderboards, and a canvas mini-game. The platform's own daily-hook mechanism.

**CURRENT DESIGN:**
- 8-tab layout: Dashboard, Habits, Design Lab, Quests, Achievements, Leaderboard, XP History, Mini-Game
- Dark theme with neon-purple accent
- Tab bar uses icon+label buttons with cn() active state
- Dashboard shows stat row (Level, XP, Streak, Achievements) as small identical cards
- Mini-game is a full canvas-based 60fps game with targets, particles, combo system
- Quests show daily tasks as checklist rows
- Achievements rendered as grid of badge cards
- Keyboard shortcuts for all tabs (d/b/g/q/a/l/i/m)
- Macro button wall present

**What works:** The mini-game is a genuinely strong differentiator. Keyboard navigation is solid. Quests map to real DTU actions, not fabricated content. The streak/XP system is backed by real data.

**What feels unfinished:** The dashboard stat row is visually flat — Level/XP/Streak/Achievements rendered as identical small cards with no hierarchy. The XP progress visualization is a thin bar. The streak flame icon is generic. Overall Dashboard reads as a utility summary, not a celebration of progression.

**What feels generic:** Star/lightning/trophy/flame iconography — the same icons every gamification system uses. No distinct "meta-progression" visual identity.

**DESIGN DIRECTION:** This lens should feel like a game's own progression screen — Destiny 2's triumph page or PlayStation's trophy UI. Bold, celebratory, with the streak as a hero element and XP as a visual journey, not a thin bar. The dashboard should make the player feel like they're leveling up in something that matters.

**LAYOUT UPGRADE:**
- Header: Current thin tab bar → persistent progression strip above it showing Level badge + XP progress ring + streak flame with count
- Dashboard hero: Replace flat stat row with large central Level badge (circular, glowing, tier-colored) flanked by XP ring and streak flame
- Primary workspace: Tab content area stays; Dashboard tab gets "Today's Progress" section with active quests as checklist + "Recent Achievements" horizontal scroll
- Secondary: XP History gets a proper calendar heatmap instead of a list
- Controls: Active tab gets a filled pill background, not just underline

**COMPONENT-LEVEL CHANGES:**
- Stat row cards → Single hero progression strip (Level badge + XP ring + streak counter)
- Thin XP progress bar → Circular progress ring with level number inside, tier-colored gradient
- Flat achievement grid → Tiered badge display with glow effects for recently unlocked
- Quest checklist rows → Cards with checkbox + reward preview (XP amount, achievement progress)
- Activity history list → Calendar heatmap with hover details (GitHub-style contribution grid)

**VISUAL UPGRADES:**
- Typography: Level number as large display text (48px+), not inline
- Spacing: More generous padding around progression hero
- Hierarchy: Level is king, XP is second, streak is third — currently all equal
- Surfaces: Achievement cards need tier-colored borders (bronze/silver/gold/platinum)
- Motion: Floating "+25 XP" text that drifts up and fades on quest completion
- Iconography: Custom streak visual (series of filled/unfilled day slots, not a single flame)

**CAPABILITY PRESENTATION:**
- CAPABILITY: Daily quests → CURRENT: Checklist row → BETTER: Quest card with progress bar + reward icon + time remaining
- CAPABILITY: XP history → CURRENT: Text list → BETTER: Calendar heatmap showing daily XP earned
- CAPABILITY: Achievements → CURRENT: Equal grid of badges → BETTER: Tier-sorted display with glow on recently earned, locked as silhouettes
- CAPABILITY: Mini-game → CURRENT: Hidden behind 8th tab → BETTER: Accessible as a "Play" action from the dashboard

**LENS IDENTITY:** The progression hub — every other lens creates content, this lens celebrates the act of creating. Its identity is earned through repetition and mastery. The visual language should feel rewarding to open.

**RESPONSIVE:**
- Desktop: Full 8-tab layout with hero progression strip
- Tablet: Collapse to 5 tabs (merge History into Dashboard, Mini-Game into floating FAB)
- Mobile: Bottom tab bar (5 tabs), progression strip becomes compact header row

**BEFORE/AFTER:**
- Before: Flat row of identical stat cards, thin XP bar, generic icons — looks like a settings page
- After: Bold progression hub with glowing level badge, circular XP ring, streak calendar, achievement tiers — looks like a game's own profile screen

**IMPLEMENTATION PLAN:**
1. Create persistent ProgressionStrip component above the tab bar with Level badge + XP ring + streak
2. Replace Dashboard stat cards with the hero strip
3. Replace XP progress bar with circular progress ring component
4. Add tier-colored borders to achievement cards
5. Add floating XP animation on quest completion
6. Add calendar heatmap to XP History tab
7. Make quest items into cards with reward preview
8. Add "Play" action button to Dashboard for mini-game access

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 9/10

---

## LENS: game-design

**PURPOSE:** GDD authoring and level design workspace — Tiled + LDtk + Nuclino shape with 98-macro domain. Project creation, mechanics tracking, entity management.

**CURRENT DESIGN:**
- Clean shell composing GameDesignSection (12-tab workbench) + collapsible GameDevRepos
- Standard RecentMineCard, AutoActionStrip, CrossLensRecentsPanel
- Underlying GameDesignSection carries real depth (mechanics, loops, entities, playtest sessions)
- 6,390 LOC, 23 files, 98.4% bespoke ratio — highest in batch

**What works:** The underlying 12-tab workbench is genuinely deep. 98.4% bespoke ratio. The component architecture is clean with real structured GDD tracking.

**What feels unfinished:** Page shell still imports generic scaffold pieces alongside the deep workbench. Page-level layout doesn't communicate "professional design tool."

**DESIGN DIRECTION:** Should feel like Figma meets Notion — a professional design workspace where the GDD is the hero. Dense, structured, with document hierarchy always visible.

**LAYOUT UPGRADE:**
- Header: Tool-style title bar with project name + last-saved indicator
- Left sidebar: GDD section navigator (mechanics, loops, entities) as a tree — always visible, collapsible
- Primary workspace: Active GDD section as full-width editor
- Right sidebar: Context panel (properties, references, linked DTUs)
- Bottom: Activity bar with playtest sessions and recent changes

**COMPONENT-LEVEL CHANGES:**
- AutoActionStrip → Integrated action bar in header (New Section, Playtest, Export)
- RecentMineCard → Sidebar "Recent Projects" panel
- Tab-based section switching → Persistent sidebar navigation with content area

**VISUAL UPGRADES:**
- Typography: Monospace for code/mechanic definitions, serif for narrative sections
- Surfaces: Document-like background (slightly lighter than base dark)
- Hierarchy: GDD sections as tree, not flat tabs
- Borders: Subtle section dividers
- Iconography: File-type icons per section (gear for mechanics, loop for loops)

**CAPABILITY PRESENTATION:**
- CAPABILITY: 98 macros → CURRENT: Tab-based workbench → BETTER: Document-editor with section tree
- CAPABILITY: Playtest sessions → CURRENT: Tab within workbench → BETTER: Inline side-by-side with GDD section being tested

**LENS IDENTITY:** The professional game developer's workspace. Dense, structured, document-oriented. Think Figma's panel density or Unity's inspector.

**RESPONSIVE:**
- Desktop: 3-panel layout (sidebar + editor + context)
- Tablet: 2-panel (collapsible sidebar + editor)
- Mobile: Stacked sections with swipe navigation

**BEFORE/AFTER:**
- Before: Tab container with generic action strip
- After: Professional document editor with persistent section navigation

**IMPLEMENTATION PLAN:**
1. Add persistent left sidebar with GDD section tree
2. Move AutoActionStrip actions into header toolbar
3. Add document-like background to editor area
4. Replace RecentMineCard with sidebar project list
5. Add context panel for linked references

**PRIORITY:** P2 — polish

**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 7/10

---

## LENS: garage

**PURPOSE:** Concordia-world vehicle fleet manager — spawn, inspect, and manage vehicles (carts, boats, canal taxis).

**CURRENT DESIGN:**
- 2-tab layout: World Fleet / My Fleet
- DataTable with columns (kind, owner, capacity, fare, position)
- Spawn depot for cart/boat
- VehicleInspectorPanel for detail view
- Bridge notice: "Driving lives in the 3D world"
- 624 LOC, 2 files, 31.7% bespoke

**What works:** Honest bridge notice is exactly right. Spawn depot is functional. Data table is clear.

**What feels generic:** Small and visually thin. Data table is the same pattern as every fleet lens. Vehicle kind rendered as text, not visual silhouette.

**DESIGN DIRECTION:** Should feel like a vehicle showroom or depot — visual browsing, not just listing.

**LAYOUT UPGRADE:**
- Header: Fleet summary strip (Total Vehicles, Active, By Kind)
- Primary: Vehicle card grid replacing data table with kind-specific SVG silhouettes
- Spawn section: Sidebar or bottom panel
- Detail: VehicleInspectorPanel as slide-in overlay

**COMPONENT-LEVEL CHANGES:**
- DataTable → Vehicle card grid with kind-specific SVG silhouettes (cart/boat/canal-taxi)
- Text kind labels → Visual kind badges with silhouette icons
- Flat table rows → Cards with hover-reveal detail

**VISUAL UPGRADES:**
- Iconography: Custom vehicle silhouettes per kind
- Surfaces: Card-based layout with kind color coding
- Hierarchy: Total fleet count as hero stat
- Spacing: Generous card padding for showroom feel

**CAPABILITY PRESENTATION:**
- CAPABILITY: Vehicle spawn → CURRENT: Dropdown + button → BETTER: Visual depot with kind previews
- CAPABILITY: Fleet overview → CURRENT: Data table → BETTER: Card grid with silhouettes

**LENS IDENTITY:** The vehicle depot — a showroom for your fleet. Distinct from world lens (where you drive) by being the management surface.

**RESPONSIVE:**
- Desktop: Card grid (3 columns)
- Tablet: Card grid (2 columns)
- Mobile: Card list (single column)

**BEFORE/AFTER:**
- Before: Data table listing vehicles by row
- After: Card grid with vehicle silhouettes, kind badges, fleet summary

**IMPLEMENTATION PLAN:**
1. Create vehicle silhouette SVGs for cart/boat/canal-taxi
2. Replace DataTable with card grid component
3. Add fleet summary strip above grid
4. Add kind-specific color coding to cards
5. Make VehicleInspectorPanel a slide-in overlay

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 4/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: genesis

**PURPOSE:** Emergent-AI observatory — live feed of platform emergent activity (births, naming, artifacts, observations, communications, dreams) with roster explorer, lineage, and metrics.

**CURRENT DESIGN:**
- Live WebSocket feed with event type filtering and live badge
- Roster explorer with saved-search support
- Origin explorer (Wikipedia cosmogony), identity timeline, lineage view, relationship graph, genesis metrics
- 1,509 LOC, 8 files, 67.5% bespoke with generic trio present

**What works:** Live feed is genuinely compelling. Roster explorer with saved searches is good. Origin explorer ties platform emergence to real cosmogony.

**What feels generic:** Generic trio imports dilute the observatory feel. Feed items could be more visually rich.

**DESIGN DIRECTION:** Should feel like a space observatory or biological lab's live monitoring feed — watching something emerge and evolve in real time. Dark, immersive, with live feed as centerpiece.

**LAYOUT UPGRADE:**
- Header: Live status bar with "X emergents active" + feed filter controls
- Primary: Full-width live feed with rich event cards (not just text rows)
- Right sidebar: Metrics panel + lineage graph (always visible)
- Bottom: Roster explorer as horizontal scrollable strip

**COMPONENT-LEVEL CHANGES:**
- AutoActionStrip → Inline filter controls above feed
- RecentMineCard → Roster explorer as persistent horizontal strip
- Feed text rows → Rich event cards with type-specific visuals

**VISUAL UPGRADES:**
- Iconography: Custom event-type icons (birth=sprout, naming=tag, artifact=gem, dream=cloud)
- Surfaces: Feed cards with event-type colored left borders
- Motion: Subtle entry animation for new feed items (slide-in from right)
- Hierarchy: Feed is king, metrics are ambient, roster is browsable

**CAPABILITY PRESENTATION:**
- CAPABILITY: Live emergent feed → CURRENT: Text list → BETTER: Rich event cards with type visuals
- CAPABILITY: Lineage graph → CURRENT: Hidden in tabs → BETTER: Always-visible sidebar
- CAPABILITY: Metrics → CURRENT: Tab view → BETTER: Ambient stat strip

**LENS IDENTITY:** The observatory — watching the platform's own AI layer come alive. Reflexive (the platform observing itself).

**RESPONSIVE:**
- Desktop: Feed + sidebar metrics/lineage
- Tablet: Feed full-width, metrics as collapsible panel
- Mobile: Feed only, metrics as swipe-up overlay

**BEFORE/AFTER:**
- Before: Text-based feed with generic scaffold
- After: Rich event cards with type visuals, persistent metrics sidebar, live status bar

**IMPLEMENTATION PLAN:**
1. Remove generic scaffold imports (RecentMineCard, AutoActionStrip)
2. Create rich event card component with event-type-specific styling
3. Add persistent metrics stat strip above feed
4. Make lineage graph a sidebar panel
5. Add entry animations for new feed items
6. Add event-type icons

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: geology

**PURPOSE:** Professional field-geology tool — rock/mineral identification, structural geology compass, stratigraphy, seismic hazard, USGS live quake feed, specimen collection.

**CURRENT DESIGN:**
- 6-tab layout: Field Log, Identify, Structure & Strat, Seismic, Map, Collection
- 12 component files covering all geological tools
- Dynamic MapView import, Wikipedia reference panel
- 90.7% bespoke ratio with generic trio present
- Honest service_overloaded + Retry pattern

**What works:** Component set is genuinely deep and professional. Structural compass, stratigraphic column, USGS quake feed are real field tools. Mountain/rock icon set fits earth sciences.

**What feels unfinished:** Geology map panel renders units with text and color swatches — needs proper visual map. Structural compass could be more visually striking (real compass visualization).

**DESIGN DIRECTION:** Should feel like a field geologist's actual toolkit — earth tones as accent (ochre, slate, granite), rugged typography, compass/stratigraphy as hero elements.

**LAYOUT UPGRADE:**
- Header: Location strip with GPS coordinates + weather context
- Primary: Active tool panel (compass, map, or stratigraphy depending on tab)
- Right sidebar: Field Log as scrolling notebook
- Bottom: Specimen collection grid (photo thumbnails)
- Map tab: Full-width interactive map with geologic overlay

**COMPONENT-LEVEL CHANGES:**
- Text-based compass data → Visual compass rose with strike/dip plotted
- Color swatches for map units → Actual map visualization with legend
- Tab-based tool switching → Tool palette (always accessible, like toolbar)

**VISUAL UPGRADES:**
- Color palette: Earth tones — ochre (#C4A35A), slate (#708090), granite (#676767), basalt (#36454F)
- Typography: Monospace for measurements, serif for geological descriptions
- Surfaces: Notebook-texture background for field log
- Iconography: Rock/mineral-specific (crystal, stratum, compass needle)
- Maps: Full geologic map overlay with Macrostrat color scheme

**CAPABILITY PRESENTATION:**
- CAPABILITY: Structural compass → CURRENT: Data fields → BETTER: Visual compass rose with plotted measurements
- CAPABILITY: Stratigraphy → CURRENT: Text column → BETTER: Visual stratigraphic column with lithology patterns
- CAPABILITY: USGS quakes → CURRENT: List → BETTER: Map overlay with quake markers + magnitude sizing

**LENS IDENTITY:** The field geologist's toolkit — rugged, precise, earth-toned. The compass and stratigraphy visualizations should be instantly recognizable.

**RESPONSIVE:**
- Desktop: 3-panel (tool + field log + collection)
- Tablet: 2-panel (tool + field log as drawer)
- Mobile: Full-width tool with bottom sheet for log/collection

**BEFORE/AFTER:**
- Before: Text-based data fields for compass/stratigraphy
- After: Visual compass rose, colored stratigraphic column, interactive quake map

**IMPLEMENTATION PLAN:**
1. Create visual compass rose SVG component
2. Add lithology pattern fills to stratigraphic column
3. Replace quake list with map overlay markers
4. Add earth-tone color palette as CSS variables
5. Add notebook-texture background to field log
6. Make compass/stratigraphy visual heroes of their tabs

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: ghost-tracker

**PURPOSE:** Lattice drift-monitor reframed as ghost hunting — track spectral residues, investigate, confront, extinguish. Gamified observability for the platform's detection engine.

**CURRENT DESIGN:**
- 9 macros: residues, detail, progress, advance, confront, history, leaderboard, create, dossiers
- Residue list with filter/sort (drift type, severity, recent)
- Map visualization (ResidueMap), active hunts, hunter leaderboard
- Saved Spectral Dossiers (DTU-backed)
- Multi-stage hunt progression: track → investigate → confront
- Spectral-plane grid visual identity
- 70.8% bespoke with generic trio present

**What works:** Ghost-hunt framing is genuinely creative. Multi-stage progression is compelling. Spectral-plane grid identity is strong. Empty state ("No spectral residues match. The world reads true.") is perfect. Leaderboard adds social competition.

**What feels unfinished:** ConfrontHistory had a dispatch bug. Map visualization could be richer.

**DESIGN DIRECTION:** Should feel like a paranormal investigation tool — dark, atmospheric, with spectral grid as centerpiece. Think Ghostbusters' PKE meter UI crossed with horror game investigation screen.

**LAYOUT UPGRADE:**
- Header: Active hunt status bar with residue count + severity indicator
- Primary: Spectral residue map (full-width, atmospheric)
- Right sidebar: Active hunt progress tracker (stage indicators)
- Bottom: Dossier cards as horizontal scroll
- Controls: Filter chips styled as "sensor readings"

**COMPONENT-LEVEL CHANGES:**
- Flat residue list → Atmospheric residue cards with severity glow
- Basic map → Atmospheric map with spectral grid overlay and pulse effects
- Tab navigation → Investigation stage progression (track → investigate → confront → extinguish)

**VISUAL UPGRADES:**
- Color palette: Deep purple/black base, spectral green/cyan for residues, warning amber for severity
- Motion: Subtle pulse/glow on residue markers, scan-line effect on map
- Surfaces: Dark with slight noise texture for atmosphere
- Typography: Monospace for readings, serif for dossier descriptions
- Iconography: Ghost/spectral icons, PKE-meter-style gauge for severity

**CAPABILITY PRESENTATION:**
- CAPABILITY: Residue detection → CURRENT: Text list → BETTER: Spectral grid with pulsing markers
- CAPABILITY: Hunt progression → CURRENT: Text stages → BETTER: Visual pipeline with stage indicators
- CAPABILITY: Confrontation → CURRENT: Button → BETTER: Dramatic confrontation overlay

**LENS IDENTITY:** The paranormal investigation tool — dark, atmospheric, scientific-yet-eerie. Every visual element reinforces tracking something spectral.

**RESPONSIVE:**
- Desktop: Map + sidebar + dossiers
- Tablet: Map full-width, dossiers as bottom sheet
- Mobile: Map only, dossier as swipe-up

**BEFORE/AFTER:**
- Before: Text-based residue list with basic map
- After: Atmospheric spectral grid with pulsing markers, stage pipeline, dossier cards

**IMPLEMENTATION PLAN:**
1. Add spectral glow effects to residue map markers
2. Create visual stage pipeline component
3. Replace residue list with atmospheric residue cards
4. Add scan-line effect to map background
5. Style filter chips as sensor readings
6. Add confrontation overlay component

**PRIORITY:** P2 — polish (already strong identity)

**DESIGN SCORE:** 7/10
**UPGRADE POTENTIAL:** 7/10

---

## LENS: global

**PURPOSE:** World Bank macro-economic data explorer — GDP, development indicators, correlations, cross-domain search. The "Truth Lens."

**CURRENT DESIGN:**
- 4 tabs: Data Explorer, Development Index, Correlations, Search
- Real World Bank indicators (WB_COUNTRIES, WB_INDICATORS)
- Cross-domain search merging DTU corpus with World Bank catalog
- Stat cards with live data, AnimatePresence tab transitions
- 78.6% bespoke with generic trio present

**What works:** World Bank data integration is genuine and fast. Stat cards present indicators clearly. Cross-domain search is a good power-user feature.

**What feels generic:** Generic trio imports. Data presentation is text-heavy — economic data begs for visualization (charts, maps, trend lines). Country/indicator selection is a dropdown, not visual explorer.

**DESIGN DIRECTION:** Should feel like Bloomberg Terminal meets Our World in Data — authoritative, data-dense, visualization-forward.

**LAYOUT UPGRADE:**
- Header: Global indicator strip (World GDP, Population, Life Expectancy) as ambient context
- Primary: Large choropleth world map showing selected indicator
- Right sidebar: Indicator details + country comparison table
- Bottom: Trend chart for selected indicator over time
- Controls: Indicator picker as categorized grid, not dropdown

**COMPONENT-LEVEL CHANGES:**
- AutoActionStrip → Indicator picker grid above map
- RecentMineCard → Saved views as bookmarks in header
- Stat cards → Trend sparklines next to each stat
- Dropdown country selector → Interactive map click-to-select

**VISUAL UPGRADES:**
- Typography: Data-first — large numbers for key metrics, small labels
- Surfaces: Clean white-on-dark for data density (Bloomberg feel)
- Charts: Real trend lines and bar charts
- Maps: Choropleth coloring with legend
- Hierarchy: Map is hero, charts are supporting, tables are reference

**CAPABILITY PRESENTATION:**
- CAPABILITY: Country data → CURRENT: Dropdown + stat cards → BETTER: Map click + trend chart
- CAPABILITY: Correlations → CURRENT: Tab view → BETTER: Scatter plot with interactive brushing
- CAPABILITY: Cross-domain search → CURRENT: Search results → BETTER: Results with DTU snippet previews

**LENS IDENTITY:** The authoritative macro-economic lens — data-dense, visualization-forward, trustworthy. Purely analytical.

**RESPONSIVE:**
- Desktop: Map + sidebar + charts
- Tablet: Map full-width, charts below
- Mobile: Stat strip + scrollable chart gallery

**BEFORE/AFTER:**
- Before: Dropdown selectors with stat cards
- After: Interactive choropleth map with trend charts and indicator grid

**IMPLEMENTATION PLAN:**
1. Remove generic scaffold imports
2. Add choropleth world map component
3. Replace stat cards with trend sparklines
4. Add indicator picker grid (categorized)
5. Add scatter plot for correlations tab
6. Add country comparison table

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 9/10

---

## LENS: goals

**PURPOSE:** Personal OKR/goal-tracking workspace — create goals, track progress, challenges, milestones, analytics, dependencies.

**CURRENT DESIGN:**
- 3 tabs: Goals, Challenges, Milestones
- OKRWorkspace (7 sub-tabs: Alignment Tree, Check-ins, Team Goals, Templates, Progress Charts, Reminders, Dependencies)
- XP leveling with progress rings, weekly activity bars
- Category/priority/difficulty color mappings
- 1,088 LOC, 5 files, 61.6% bespoke with generic trio present

**What works:** OKR workspace is genuinely deep. XP leveling with progress rings is good. Color mappings provide clear hierarchy.

**What feels generic:** Generic trio imports. Goal list could be more visually engaging — goals as cards with progress rings. Analytics could be more chart-forward.

**DESIGN DIRECTION:** Should feel like a personal productivity command center — Notion's database view meets Linear's issue tracker. Structured, clean, with progress visualization as hero.

**LAYOUT UPGRADE:**
- Header: Personal stats strip (Active Goals, Completion Rate, Streak, XP Level)
- Primary: Goal cards in grid, each with progress ring + category badge + priority indicator
- Right sidebar: Quick-add goal form + upcoming milestones
- Bottom: Analytics charts (completion trend, category breakdown)
- Controls: Filter/sort bar above goal grid

**COMPONENT-LEVEL CHANGES:**
- Flat goal list → Goal cards with progress rings and category badges
- Tab-based analytics → Inline analytics strip above grid
- AutoActionStrip → Quick-add form in sidebar

**VISUAL UPGRADES:**
- Typography: Goal titles as bold headings, descriptions as muted body text
- Surfaces: Card-based layout with category-colored top borders
- Charts: Real line/bar charts for analytics
- Hierarchy: Progress ring is hero visual for each goal
- Motion: Progress ring animation on goal update

**CAPABILITY PRESENTATION:**
- CAPABILITY: Goal progress → CURRENT: Percentage text → BETTER: Circular progress ring
- CAPABILITY: Alignment tree → CURRENT: Tab within OKR → BETTER: Always-visible sidebar
- CAPABILITY: Analytics → CURRENT: Separate tab → BETTER: Inline charts above grid

**LENS IDENTITY:** The personal commitment tracker — structured, visual, motivating. "The things you said you'd do."

**RESPONSIVE:**
- Desktop: Grid of goal cards + sidebar
- Tablet: Grid (2 columns) + collapsible sidebar
- Mobile: Single-column goal list with swipe actions

**BEFORE/AFTER:**
- Before: Text-based goal list with tab analytics
- After: Card grid with progress rings, inline analytics, sidebar quick-add

**IMPLEMENTATION PLAN:**
1. Remove generic scaffold imports
2. Create goal card component with progress ring
3. Add personal stats strip above grid
4. Add inline analytics charts
5. Move quick-add to sidebar
6. Add category-colored card borders

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: goddess

**PURPOSE:** Concordia ambient dispatch feed — hourly broadcasts from the goddess, composed from ecosystem score, refusal-field strength, and drift events.

**CURRENT DESIGN:**
- 3 tabs: Feed (live + tone-filterable), Archive, Alerts (tone subscriptions)
- DispatchDetail for permalink detail view with commune + world-event correlation
- GoddessGallery section (Wikipedia summaries for 9 goddesses)
- Tone filter chips (Exalted/Warm/Neutral/Cold/Mourning)
- 60s polling, 231 lines, 71.2% bespoke

**What works:** Tone-filter chips are excellent — map to real ecosystem/refusal-field state. Hourly composition is unique. Gallery ties platform mythology to real world mythology. Empty states are honest.

**What feels unfinished:** Feed items could be more visually rich — each dispatch deserves presentation as a world-state artifact. Tone chips could be more visually expressive.

**DESIGN DIRECTION:** Should feel like ancient oracle's scrolls meets modern news feed — sacred text rendered with reverence. Parchment textures, calligraphic touches, tone through color temperature.

**LAYOUT UPGRADE:**
- Header: Current tone status strip (which tone RIGHT NOW from real ecosystem score)
- Primary: Feed with rich "scroll" cards — tone-colored border and atmospheric background
- Right sidebar: Goddess gallery as devotional panel
- Bottom: Archive as timeline of past dispatches
- Controls: Tone filter chips styled as oracle tokens

**COMPONENT-LEVEL CHANGES:**
- Plain feed items → "Scroll" cards with tone-colored borders and atmospheric styling
- Text tone chips → Styled oracle tokens with tone-specific color/texture
- Basic archive list → Timeline with tone markers

**VISUAL UPGRADES:**
- Color palette: Exalted=gold (#FFD700), Warm=amber (#FFBF00), Neutral=silver (#C0C0C0), Cold=ice blue (#A5F2F3), Mourning=deep indigo (#4B0082)
- Typography: Serif for dispatch text, sans-serif for metadata
- Surfaces: Slight parchment texture for dispatch cards
- Motion: Gentle fade-in for new dispatches
- Iconography: Oracle symbols (eye, flame, moon phase)

**CAPABILITY PRESENTATION:**
- CAPABILITY: Live dispatches → CURRENT: Text feed → BETTER: Scroll cards with tone-colored borders
- CAPABILITY: Tone filtering → CURRENT: Text chips → BETTER: Oracle token buttons with color
- CAPABILITY: Goddess gallery → CURRENT: Wikipedia cards → BETTER: Devotional panel with portraits

**LENS IDENTITY:** The oracle's voice — sacred, atmospheric, reverent. Every visual element reinforces you're reading something composed by an intelligence.

**RESPONSIVE:**
- Desktop: Feed + sidebar gallery
- Tablet: Feed full-width, gallery as collapsible panel
- Mobile: Feed only, gallery as swipe-up

**BEFORE/AFTER:**
- Before: Plain text feed with text tone chips
- After: Scroll cards with tone colors, oracle tokens, atmospheric typography

**IMPLEMENTATION PLAN:**
1. Create "scroll" card component with tone-colored borders
2. Style tone filter chips as oracle tokens with color
3. Add serif font for dispatch text
4. Add current-tone status strip above feed
5. Style gallery panel as devotional section
6. Add gentle fade-in animation for new dispatches
7. Add parchment texture to dispatch cards

**PRIORITY:** P2 — polish (already strong identity)

**DESIGN SCORE:** 7/10
**UPGRADE POTENTIAL:** 7/10

---

## LENS: government

**PURPOSE:** Full municipal government lens — permits, public works, code enforcement, emergency, records, court, reps, bills, civic alerts, FOIA, budget, civic workbench.

**CURRENT DESIGN:**
- 12 mode tabs with extensive type definitions
- 20+ purpose-built components for each government function
- CityGovShell with metric strip + 3-column layout
- 3,644 lines, 6,979 LOC, 25 files, 47.8% bespoke — lowest in batch

**What works:** The breadth is impressive — 12 real government functions. CityGovShell with 3-column layout is good. Component set covers real civic-tech needs.

**What feels unfinished:** 47.8% bespoke means over half are shared/generic. 12 tabs means each gets minimal visual attention. Budget visualizer and bill tracker could be much richer.

**DESIGN DIRECTION:** Should feel like a real city hall's digital services portal — authoritative, civic, trustworthy. Think USA.gov meets SeeClickFix. Blue/white accent, official typography, data-dense but accessible.

**LAYOUT UPGRADE:**
- Header: City services strip (Active Permits, Open Requests, Budget Status)
- Primary: Active tab content with persistent left sidebar for 12 tabs
- Right sidebar: Quick actions (Report Issue, Track Permit, Find Rep)
- Bottom: Recent activity feed across all functions

**COMPONENT-LEVEL CHANGES:**
- Flat tab bar → Persistent left sidebar with icons + labels
- Generic stat strips → Civic-styled metric cards
- Text-based lists → Card entries with status badges

**VISUAL UPGRADES:**
- Color palette: Civic blue (#1E3A5F), trust green (#2E7D32), alert amber (#F57F17), official red (#C62828)
- Typography: Official, readable — Inter for body, bold for headings
- Iconography: Government-specific (building, shield, document, gavel, ballot)
- Charts: Budget with bar/pie charts

**CAPABILITY PRESENTATION:**
- CAPABILITY: 311 service requests → CURRENT: List → BETTER: Map-based view with status pins
- CAPABILITY: Budget → CURRENT: Text breakdown → BETTER: Interactive treemap or sunburst
- CAPABILITY: Bill tracking → CURRENT: List → BETTER: Timeline with status stages

**LENS IDENTITY:** The city hall digital services portal — authoritative, civic, trustworthy. The only lens representing institutional authority.

**RESPONSIVE:**
- Desktop: 3-column (sidebar + content + actions)
- Tablet: 2-column (collapsible sidebar + content)
- Mobile: Bottom tab bar (6 primary), rest in "More"

**BEFORE/AFTER:**
- Before: 12 flat tabs with generic content
- After: City services portal with sidebar, civic metrics, map views

**IMPLEMENTATION PLAN:**
1. Convert tab bar to persistent left sidebar
2. Add civic-styled metric cards to header
3. Add map view for 311 service requests
4. Add budget treemap visualization
5. Add bill timeline component
6. Apply civic color palette

**PRIORITY:** P2 — polish

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 7/10

---

## LENS: graph

**PURPOSE:** Knowledge graph visualizer — renders DTU consolidation pipeline (SIMPLE→REGULAR→MEGA→HYPER, 33:1) as force-directed node-link diagram. "Knowledge Genome Browser."

**CURRENT DESIGN:**
- 8 view modes: default, heatmap, cluster, sample_tree, collab_network, interactive, 3d, fractal
- Force-directed canvas simulation with keyboard shortcuts (Obsidian/Roam idiom)
- Node types: regular, mega, hyper, shadow, track, artist, sample, release
- Edge types: parent, sibling, semantic, temporal, sampled_from, remixed_by, collaborated_with, released_on
- Canvas icon drawing (music note, user silhouette, waveform, disc)
- Path finder, connect mode, add node
- 2,042 LOC, 4 files, 34.2% bespoke

**What works:** Force-directed canvas is genuinely striking — renders real DTU consolidation as visual graph. 8 view modes provide analytical depth. Keyboard shortcuts follow graph-editor conventions. Node-type icons are distinctive.

**What feels unfinished:** Stat row (Nodes/Edges/Density/Avg Connections) reads 0 despite 246 DTUs — wired to different dataset. 3D and fractal views could be more polished.

**DESIGN DIRECTION:** Should feel like Obsidian graph view crossed with bioinformatics genome browser — dense, analytical, beautiful in complexity. The graph IS the lens.

**LAYOUT UPGRADE:**
- Header: View mode selector + graph stats (fix 0-values)
- Primary: Full-bleed canvas graph — fill as much screen as possible
- Left sidebar: Node/edge type filter (collapsible)
- Right sidebar: Selected node detail panel (appears on click)
- Bottom: Mini-map for orientation in large graphs

**COMPONENT-LEVEL CHANGES:**
- Small canvas → Full-bleed canvas filling viewport
- Tab-based view switching → Toolbar above canvas
- Text-based node detail → Rich detail panel with properties and connected edges

**VISUAL UPGRADES:**
- Canvas: Anti-aliased rendering, smooth zoom/pan, node glow on hover
- Typography: Small labels on nodes, larger in detail panel
- Edges: Curved edges with type-specific styling (dashed temporal, solid parent)
- Node sizing: Scale by importance/connection count
- Motion: Smooth force-directed animation

**CAPABILITY PRESENTATION:**
- CAPABILITY: Graph visualization → CURRENT: Small canvas → BETTER: Full-bleed viewport
- CAPABILITY: View modes → CURRENT: Tab bar → BETTER: Toolbar with icons
- CAPABILITY: Node inspection → CURRENT: Click → text → BETTER: Click → rich detail panel

**LENS IDENTITY:** The knowledge genome browser — dense, analytical, beautiful in complexity. The graph itself is the identity.

**RESPONSIVE:**
- Desktop: Full-bleed canvas + collapsible sidebars
- Tablet: Full-bleed canvas + bottom sheet for details
- Mobile: Touch-optimized graph with pinch-zoom, tap for detail

**BEFORE/AFTER:**
- Before: Canvas in bounded area with text controls
- After: Full-bleed viewport with graph as entire experience

**IMPLEMENTATION PLAN:**
1. Fix stat row wiring (Nodes/Edges/Density showing 0)
2. Make canvas full-bleed
3. Convert view mode tabs to toolbar icons
4. Add collapsible filter sidebar
5. Add rich node detail panel on click
6. Add mini-map for large graph orientation
7. Improve edge rendering (curves, type-specific styling)

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 7/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: grounding

**PURPOSE:** Fact-checking and reality-anchoring — Ground News parity (evidence aggregation, source bias, trending claims, audit trail) plus sensor journal and real-world pulse.

**CURRENT DESIGN:**
- Two-substrate: Fact-Check Workbench + Reality Anchor + Real-World Pulse
- 5 tabs: Evidence Aggregator, Source Bias, Trending Claims, Audit Trail, Rebuttals
- framer-motion AnimatePresence, ChartKit/TimelineView
- 7+ real grounding.* macros
- 133 lines, 1,948 LOC, 93.1% bespoke

**What works:** Ground News parity is genuinely strong. Two-substrate design is unique. 93.1% bespoke. Shield/verification iconography present.

**What feels unfinished:** Visual identity could be stronger — "verification" should feel authoritative. Shield iconography is present but understated.

**DESIGN DIRECTION:** Should feel like a forensic analysis workstation — precise, evidence-focused, trustworthy. Think Bellingcat's tools crossed with courtroom evidence board.

**LAYOUT UPGRADE:**
- Header: Trust score strip (Verified Claims, Pending, Debunked)
- Primary: Active tab with evidence cards as visual hero
- Right sidebar: Source bias visualization (political compass)
- Bottom: Audit trail as timeline
- Controls: Evidence strength as visual gauges

**COMPONENT-LEVEL CHANGES:**
- Text-based evidence list → Evidence cards with strength gauges
- Tab-based analysis → Side-by-side claim vs. evidence
- Basic bias display → Political compass visualization

**VISUAL UPGRADES:**
- Color palette: Verified=green (#2E7D32), Debunked=red (#C62828), Uncertain=amber (#F57F17)
- Typography: Bold for claims, body for evidence, small caps for source attribution
- Iconography: Shield with checkmark, magnifying glass for investigation
- Charts: Source bias as scatter plot (reliability vs. bias)
- Surfaces: Evidence-board feel with connecting lines

**CAPABILITY PRESENTATION:**
- CAPABILITY: Evidence aggregation → CURRENT: List → BETTER: Evidence board with connecting lines
- CAPABILITY: Source bias → CURRENT: Text labels → BETTER: Political compass visualization
- CAPABILITY: Trending claims → CURRENT: List → BETTER: Card grid with confidence bars

**LENS IDENTITY:** The forensic analysis workstation — precise, evidence-focused, trustworthy. "Show me the proof."

**RESPONSIVE:**
- Desktop: Evidence board + sidebar bias viz
- Tablet: Evidence board full-width, bias as bottom sheet
- Mobile: Evidence cards stacked, tap for detail

**BEFORE/AFTER:**
- Before: Text-based evidence and bias display
- After: Evidence board with connecting lines, bias compass, trust score strip

**IMPLEMENTATION PLAN:**
1. Add trust score strip above content
2. Create evidence card component with strength gauge
3. Add source bias compass visualization
4. Add evidence board layout with connecting lines
5. Add audit trail timeline
6. Apply verification color palette

**PRIORITY:** P2 — polish (already 93.1% bespoke)

**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 7/10

---

## LENS: healthcare

**PURPOSE:** Full Epic/Cerner-parity EHR — clinical sidebar, patient portal, pharmacy, lab, therapy, symptoms, appointments, medication tracking, provider directory, Rx price comparison.

**CURRENT DESIGN:**
- 13 mode tabs, 18 nav tabs within EpicSection
- Extensive type definitions for vitals, SOAP notes, medications, lab results
- Real clinical reference data (CBC, CMP, Lipid, Thyroid, HbA1c, Coag), vital sign ranges
- 4,014 lines, 10,284 LOC, 32 files, 61% bespoke
- Rival-shape: EHRShell
- 0 Loader2 usage (no skeleton loading states)

**What works:** EpicSection with 18 nav tabs is genuinely deep — real clinical workflow parity. Lab panels reference real medical data. Symptom checker and medication tracker functional. EHRShell rival shape is right.

**What feels unfinished:** 0 Loader2 usage — no skeleton loading states. Clinical data could be more visually organized — vitals as dashboard, not list. With 13+ tabs, loading experience matters.

**DESIGN DIRECTION:** Should feel like a real clinical terminal — precise, data-dense, medical-grade. Think Epic's hyperspace UI modernized. The clinical sidebar is the right pattern; data within needs clinical precision.

**LAYOUT UPGRADE:**
- Header: Patient context bar (name, MRN, DOB, allergies) — always visible when patient selected
- Primary: Clinical dashboard with vitals as horizontal strip (like real patient chart header)
- Left sidebar: Clinical navigation (18 tabs) — keep this, right pattern
- Right sidebar: Active alerts + unsigned notes count
- Bottom: Recent encounters timeline

**COMPONENT-LEVEL CHANGES:**
- Vitals as list → Vitals as horizontal dashboard strip (BP, HR, Temp, SpO2 as gauges)
- Basic lab results → Lab results with reference ranges and delta indicators
- Simple medication list → Medication cards with dosage, frequency, next-dose countdown

**VISUAL UPGRADES:**
- Color palette: Clinical blue (#1565C0), alert red (#D32F2F), normal green (#388E3C), warning amber (#F57F17)
- Typography: Monospace for measurements, sans-serif for notes
- Surfaces: Clean, clinical cold dark
- Charts: Vital sign trends as line charts with reference range bands
- Iconography: Medical-specific (heart, pill, syringe, stethoscope, clipboard)

**CAPABILITY PRESENTATION:**
- CAPABILITY: Patient vitals → CURRENT: Text list → BETTER: Dashboard strip with gauges and trends
- CAPABILITY: Lab results → CURRENT: Table → BETTER: Results with reference ranges and delta arrows
- CAPABILITY: Medications → CURRENT: List → BETTER: Cards with next-dose countdown
- CAPABILITY: Appointments → CURRENT: List → BETTER: Calendar view with patient photos

**LENS IDENTITY:** The clinical terminal — precise, data-dense, medical-grade. "Professional healthcare tool, not a wellness app." EHRShell foundation matches.

**RESPONSIVE:**
- Desktop: 3-panel (clinical nav + patient chart + alerts)
- Tablet: 2-panel (collapsible nav + chart)
- Mobile: Patient chart full-width with bottom tab navigation

**BEFORE/AFTER:**
- Before: Text-based clinical data across 13 tabs, no loading states
- After: Clinical dashboard with vitals gauges, lab reference ranges, medication countdowns, skeleton loaders

**IMPLEMENTATION PLAN:**
1. Add skeleton loading states (0 currently)
2. Create vitals dashboard strip component
3. Add reference range indicators to lab results
4. Add delta arrows (up/down/flat) to lab values
5. Create medication card with next-dose countdown
6. Add patient context bar above content
7. Apply clinical color palette
8. Add vital sign trend charts with reference bands

**PRIORITY:** P0 — major visual/UX deficiency (largest lens, 0 loading states, clinical data needs visual precision)

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 9/10

---

## LENS: history

**PURPOSE:** Wikipedia-grounded timeline research tool — create timelines, explore Wikipedia, analyze periods/causes/effects, maintain figures notebook.

**CURRENT DESIGN:**
- 4 groups: Timelines, Wikipedia Research, Analysis Tools, Figures Notebook
- TimelineBuilder (STATE-backed), WikipediaExplorer (real REST + On-This-Day)
- TimelineSourceTools + PeriodCauseEffectTools
- 94% bespoke ratio — very high
- Generic scaffold entirely retired

**What works:** Wikipedia integration is fast and genuine. Timeline builder is real. 94% bespoke. "On This Day" is a natural daily hook. Honest "Connection lost" banner.

**What feels unfinished:** Timeline visualization could be more visual — real interactive timeline strip (like TimelineJS) would transform experience. Figures notebook honestly labeled as personal notes.

**DESIGN DIRECTION:** Should feel like a historian's research desk — archival, structured, source-focused. Think TimelineJS crossed with research notebook. Sepia/cream tones for historical content.

**LAYOUT UPGRADE:**
- Header: "On This Day" strip as ambient context
- Primary: Interactive horizontal timeline strip with events as markers
- Right sidebar: Wikipedia research panel (search + article preview)
- Bottom: Analysis tools (cause/effect, source reliability)
- Figures notebook: Collapsible section at bottom

**COMPONENT-LEVEL CHANGES:**
- Tab-based timeline → Interactive horizontal timeline strip
- Wikipedia search results → Article preview cards with thumbnails
- Text-based analysis → Visual cause/effect flow diagram

**VISUAL UPGRADES:**
- Color palette: Archival sepia (#8B7355), parchment cream (#F5F0E6), ink black (#1A1A1A), source blue (#1565C0)
- Typography: Serif for historical content, sans-serif for UI
- Surfaces: Parchment-texture background for timeline area
- Iconography: Clock, scroll, quill, compass — archival icons
- Charts: Timeline as visual strip with event markers

**CAPABILITY PRESENTATION:**
- CAPABILITY: Timeline creation → CURRENT: Form-based → BETTER: Interactive visual timeline
- CAPABILITY: Wikipedia research → CURRENT: Search + list → BETTER: Search + article preview cards
- CAPABILITY: On This Day → CURRENT: Text list → BETTER: Visual card carousel with images

**LENS IDENTITY:** The historian's research desk — archival, structured, source-focused. "The past, organized and visualized."

**RESPONSIVE:**
- Desktop: Timeline strip + sidebar research
- Tablet: Timeline full-width, research as bottom sheet
- Mobile: Timeline cards stacked vertically

**BEFORE/AFTER:**
- Before: Form-based timeline creation with text Wikipedia results
- After: Interactive timeline strip with article preview cards and archival styling

**IMPLEMENTATION PLAN:**
1. Create interactive horizontal timeline component
2. Add Wikipedia article preview cards with thumbnails
3. Apply archival color palette
4. Add "On This Day" card carousel
5. Add cause/effect flow diagram component
6. Add parchment texture to timeline area
7. Convert Figures Notebook to collapsible section

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: home-improvement

**PURPOSE:** Renovation project management — projects, budget, Gantt timeline, gallery, ideas, contractors, shopping, inventory, maintenance. Plus calculators.

**CURRENT DESIGN:**
- 9 tabs: projects, budget, timeline, gallery, ideas, pros, shopping, inventory, maintenance
- Real macros for project CRUD, expense logging, dashboard
- Components: PhotoGallery, IdeaBoards, ContractorDirectory, ShoppingList, HomeInventory, ProjectGantt, MaintenanceReminders, ProductRecalls
- 61.3% bespoke with generic trio present

**What works:** Project management substrate is real — CRUD with Gantt, expense tracking, photo gallery. Calculators (ROI, permit check, color palette) are genuine. Maintenance reminders practical.

**What feels generic:** Generic trio imports dilute renovation-planning feel. Gallery could be richer (before/after comparisons). Gantt is text-based, not visual.

**DESIGN DIRECTION:** Should feel like renovation project management — Houzz meets Trello. Warm, visual, with gallery and before/after as hero elements. Photos should be prominent.

**LAYOUT UPGRADE:**
- Header: Active project strip (Project Name, Budget Status, Timeline Progress)
- Primary: Project photo gallery as visual hero (before/after slider)
- Right sidebar: Quick actions (Log Expense, Add Photo, Schedule Task)
- Bottom: Gantt timeline as visual horizontal bar chart
- Controls: Room-by-room filter

**COMPONENT-LEVEL CHANGES:**
- Generic scaffold → Project-specific header and sidebar
- Text gallery → Photo grid with before/after comparison
- Text Gantt → Visual Gantt bar chart

**VISUAL UPGRADES:**
- Color palette: Warm neutrals with status accents (green=complete, amber=in-progress, red=over budget)
- Typography: Bold for project names, clean body for details
- Iconography: Room-specific icons (kitchen, bathroom, bedroom, exterior)
- Charts: Gantt as visual bars, budget as donut chart

**CAPABILITY PRESENTATION:**
- CAPABILITY: Before/after photos → CURRENT: Photo gallery → BETTER: Before/after slider
- CAPABILITY: Budget tracking → CURRENT: Text list → BETTER: Donut chart with category breakdown
- CAPABILITY: Project timeline → CURRENT: Text Gantt → BETTER: Visual Gantt bar chart

**LENS IDENTITY:** The renovation project manager — visual, organized, practical. "Your home, improved."

**RESPONSIVE:**
- Desktop: Gallery hero + sidebar + Gantt
- Tablet: Gallery grid + collapsible sidebar
- Mobile: Photo-first layout with swipe

**BEFORE/AFTER:**
- Before: Tab-based project management with generic imports
- After: Photo-first dashboard with before/after slider, visual Gantt, budget donut

**IMPLEMENTATION PLAN:**
1. Remove generic scaffold imports
2. Create before/after photo comparison component
3. Add visual Gantt bar chart
4. Add budget donut chart
5. Create project header strip
6. Add room-specific icons
7. Style as modern renovation-app

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: household

**PURPOSE:** Family operations — dashboard, family, meals, chores, home, calendar, budget, emergency, pets. The family organizer.

**CURRENT DESIGN:**
- 9 mode tabs with 8 artifact types
- 14 custom components (ChoreRotation, ChoreBoard, FamilyCalendar, MealPlanner, AllowanceTracker, etc.)
- Keyboard shortcuts for each tab
- Derived data: grocery aggregation, overdue chores, maintenance, chore leaderboard
- 3,839 LOC, 12 files, 48.9% bespoke
- Macro button wall present, disconnected pill flagged

**What works:** Component set is genuinely comprehensive. Derived data (grocery aggregation, overdue chores) is practical. Chore points leaderboard adds gamification.

**What feels generic:** Macro button wall present. Disconnected pill. 48.9% bespoke. Dashboard could be warmer — families deserve warmer aesthetic than standard dark theme.

**DESIGN DIRECTION:** Should feel like family organizer app — Cozi crossed with Apple's Family Sharing. Warm, approachable, with family photos and personal touches. Warmer palette than standard dark.

**LAYOUT UPGRADE:**
- Header: Family status strip (Members Online, Today's Chores, Upcoming Meals) with family photos
- Primary: Dashboard with family activity cards (who's doing what today)
- Left sidebar: Family member avatars for quick navigation
- Bottom: Calendar strip showing upcoming events
- Controls: Family member filter for all views

**COMPONENT-LEVEL CHANGES:**
- Macro button wall → Integrated family dashboard with activity cards
- Generic stat strips → Family-member-specific status cards
- Text chore list → Chore board with assignee avatars and due dates

**VISUAL UPGRADES:**
- Color palette: Warm — soft blue (#5B9BD5), gentle green (#70AD47), warm amber (#ED7D31), family purple (#7030A0)
- Typography: Rounded, friendly fonts (not monospace)
- Surfaces: Slightly warmer dark theme (warmer gray tones)
- Iconography: Family-specific (house, heart, calendar, utensils, paw print)
- Motion: Gentle transitions

**CAPABILITY PRESENTATION:**
- CAPABILITY: Chore management → CURRENT: List → BETTER: Board with assignee avatars
- CAPABILITY: Meal planning → CURRENT: Text → BETTER: Weekly calendar with recipe cards
- CAPABILITY: Family budget → CURRENT: Text → BETTER: Category donut with member contributions

**LENS IDENTITY:** The family organizer — warm, approachable, personal. "Your family, organized."

**RESPONSIVE:**
- Desktop: Dashboard + sidebar family members + calendar
- Tablet: Dashboard full-width, calendar as bottom sheet
- Mobile: Family member-centric navigation

**BEFORE/AFTER:**
- Before: Standard dark tab container with generic components
- After: Warm, family-centric dashboard with avatars, chore board, meal calendar

**IMPLEMENTATION PLAN:**
1. Fix disconnected pill
2. Remove macro button wall
3. Create family status strip with member avatars
4. Add chore board with assignee avatars
5. Add weekly meal calendar
6. Apply warmer color palette
7. Add family member sidebar
8. Add calendar strip at bottom

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: housing

**PURPOSE:** Concordia player housing — manage owned houses, place furniture, lock rooms, toggle visibility, visit other players' homes.

**CURRENT DESIGN:**
- 2 tabs: My Houses / Visit
- Real API calls to housing endpoints
- Land claim → house claiming flow
- Furniture placement, room locking, visibility, visit toggling
- 570 LOC, 1 file, 0% bespoke — thinnest lens in batch

**What works:** Honest prerequisite messaging is exactly right. API integration is real.

**What feels unfinished:** 570 LOC, 0% bespoke — the thinnest lens. No furniture visual preview. House cards are text-based. Visit tab needs visual browsing.

**DESIGN DIRECTION:** Should feel like interior design tool — visual, spatial, with furniture previews and room layouts. Think The Sims build mode crossed with IKEA room planner.

**LAYOUT UPGRADE:**
- Header: House count + active world indicator
- Primary: House cards with building-type silhouette and room count
- Detail: Room grid with furniture placement preview (2D floor plan)
- Visit: Gallery of houses with screenshots/previews
- Controls: Furniture catalog sidebar for drag-and-drop

**COMPONENT-LEVEL CHANGES:**
- Text house list → House cards with building silhouettes
- No furniture preview → 2D floor plan with furniture icons
- Text visit list → Gallery grid with house previews

**VISUAL UPGRADES:**
- Iconography: Building-type silhouettes (house, cabin, tower, manor)
- Surfaces: Blueprint-style background for furniture placement
- Charts: 2D floor plan grid for room layout
- Color: Per-building-type accent colors

**CAPABILITY PRESENTATION:**
- CAPABILITY: House management → CURRENT: Text list → BETTER: Card grid with building silhouettes
- CAPABILITY: Furniture placement → CURRENT: Form → BETTER: 2D floor plan with furniture icons
- CAPABILITY: Visit homes → CURRENT: Text list → BETTER: Gallery grid with previews

**LENS IDENTITY:** The interior design tool — visual, spatial, creative. "Your home, your design."

**RESPONSIVE:**
- Desktop: House grid + floor plan editor
- Tablet: House grid, floor plan as full-screen overlay
- Mobile: House list, floor plan as landscape-locked editor

**BEFORE/AFTER:**
- Before: 570 LOC text list with 0% bespoke
- After: Visual house cards with floor plan editor and furniture catalog

**IMPLEMENTATION PLAN:**
1. Create house card component with building-type silhouette
2. Add 2D floor plan grid for furniture placement
3. Add furniture catalog sidebar
4. Create house gallery for Visit tab
5. Add blueprint-style background
6. Apply building-type color coding
7. Add room/furniture count badges

**PRIORITY:** P0 — major visual/UX deficiency (thinnest lens, 0% bespoke, needs complete visual identity)

**DESIGN SCORE:** 2/10
**UPGRADE POTENTIAL:** 9/10

---

## LENS: hr

**PURPOSE:** Full Workday/BambooHR-parity HRIS — People, Time Off, Payroll, Benefits, Time Clock, Performance, Training, Compliance, Recruiting, Analytics, Self-Service. Plus BLS wage data.

**CURRENT DESIGN:**
- 11-tab HRIS + people-ops calculators + BLS data
- framer-motion animated tab switching
- Stat strip with live data
- 3,472 LOC, 16 files, 96.9% bespoke — highest in batch
- Macro button wall present, disconnected pill flagged

**What works:** 96.9% bespoke ratio — highest in batch. 11-tab HRIS covers real HR functions. BLS wage data is genuine. framer-motion animations are nice.

**What feels generic:** Macro button wall present. Disconnected pill. "Simulated" badge reflects genuine gap. Stat strip could be richer — HR data begs for charts.

**DESIGN DIRECTION:** Should feel like Workday's modern UI — clean, professional, data-dense but accessible. BambooHR simplicity with Workday depth. People-centric — avatars, team structures, org charts.

**LAYOUT UPGRADE:**
- Header: Org health strip (Headcount, Open Positions, PTO Requests, Training Completion)
- Primary: Active tab content with data tables and forms
- Right sidebar: Quick actions (Add Employee, Approve PTO, Post Job)
- Bottom: People analytics charts (headcount trend, department breakdown)
- Controls: Department/location filter above all views

**COMPONENT-LEVEL CHANGES:**
- Generic stat strip → Org health dashboard with real charts
- Text people list → People cards with avatars and department badges
- Basic PTO view → Calendar-based PTO visualization

**VISUAL UPGRADES:**
- Color palette: Professional blue (#1565C0), success green (#2E7D32), warning amber (#F57F17), people purple (#7B1FA2)
- Typography: Clean, professional — Inter
- Charts: Real bar/line charts for HR analytics
- Iconography: People-specific (user, users, calendar, briefcase, graduation cap)

**CAPABILITY PRESENTATION:**
- CAPABILITY: People directory → CURRENT: Text list → BETTER: Card grid with avatars
- CAPABILITY: PTO management → CURRENT: Text list → BETTER: Calendar view with approval status
- CAPABILITY: Analytics → CURRENT: Text numbers → BETTER: Charts (headcount, turnover, department breakdown)

**LENS IDENTITY:** The professional HRIS — clean, authoritative, people-centric. "Your workforce, organized."

**RESPONSIVE:**
- Desktop: 3-panel (nav + content + actions)
- Tablet: 2-panel (collapsible nav + content)
- Mobile: Bottom tab navigation, people-first layout

**BEFORE/AFTER:**
- Before: Text-based HRIS with generic button wall
- After: Professional dashboard with people cards, org charts, analytics

**IMPLEMENTATION PLAN:**
1. Fix disconnected pill
2. Remove macro button wall
3. Create org health dashboard strip
4. Add people card component with avatars
5. Add PTO calendar view
6. Add HR analytics charts
7. Apply professional color palette
8. Add department/location filters

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: hvac

**PURPOSE:** HVAC trade management — jobs, estimates, code references, materials, CRM, invoices, inspections, certifications.

**CURRENT DESIGN:**
- 8 tabs: Jobs, Estimates, Codes, Materials, CRM, Invoices, Inspections, Certs
- Full CRUD editor for all HVAC fields
- HvacFeed (Reddit), ManualJCalc, FieldService components
- Material catalog (13 items), Cert catalog (EPA 608, NATE, HVAC Excellence)
- 71.5% bespoke with generic trio present

**What works:** Code reference search is genuine trade tool. Material catalog with 13 items is practical. Cert catalog is trade-specific. Status color coding provides clear hierarchy.

**What feels generic:** Generic trio imports dilute trade-tool feel. Disconnected pill flagged. Material catalog is text-based — HVAC parts should have visual representations. ManualJCalc could be more prominent.

**DESIGN DIRECTION:** Should feel like a field technician's mobile workstation — practical, efficient, built for the truck. Think ServiceTitan crossed with trade reference manual. Industrial colors, large touch targets, quick-access code references.

**LAYOUT UPGRADE:**
- Header: Active job strip (Job #, Customer, Status, Next Task)
- Primary: Job cards with customer info, status badge, quick actions
- Right sidebar: Code reference quick-search (always accessible)
- Bottom: Material catalog as visual grid with part images
- Controls: Status filter + date range

**COMPONENT-LEVEL CHANGES:**
- Generic scaffold → Job-specific header and sidebar
- Text code search → Quick-access reference panel with categories
- Text material list → Visual catalog grid with part images
- Basic cert display → Cert cards with expiration dates and renewal alerts

**VISUAL UPGRADES:**
- Color palette: Industrial — steel blue (#4682B4), caution yellow (#FFD700), safety orange (#FF6600)
- Typography: Large, readable for field use (14px minimum)
- Surfaces: High-contrast for outdoor visibility
- Iconography: HVAC-specific (thermometer, fan, snowflake, wrench, gauge)

**CAPABILITY PRESENTATION:**
- CAPABILITY: Code references → CURRENT: Text search → BETTER: Quick-access categorized panel
- CAPABILITY: Materials → CURRENT: Text list → BETTER: Visual catalog with part images
- CAPABILITY: Manual J calc → CURRENT: Form → BETTER: Visual load calculation

**LENS IDENTITY:** The field technician's workstation — practical, efficient, built for the truck. "The job, managed."

**RESPONSIVE:**
- Desktop: Job list + sidebar code reference
- Tablet: Job cards + collapsible sidebar
- Mobile: Single job view with swipe between sections

**BEFORE/AFTER:**
- Before: Text-based trade management with generic imports
- After: Industrial-styled job dashboard with visual materials catalog, quick code reference

**IMPLEMENTATION PLAN:**
1. Fix disconnected pill
2. Remove generic scaffold imports
3. Create job card component with status badge
4. Add code reference quick-access panel
5. Create visual materials catalog
6. Add cert expiration cards
7. Apply industrial color palette
8. Make ManualJCalc more prominent

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: hypothesis

**PURPOSE:** Scientific method — hypothesize, collect evidence, evaluate, experiment. Full hypothesis lifecycle with stats workbench.

**CURRENT DESIGN:**
- HypothesisLab: propose/evidence/test/predict/confirm lifecycle
- StatsWorkbench: t-tests, ANOVA, chi-square, regression
- Collapsible ArxivFeed
- 3-column grid: propose+list, detail+evidence, tests+predictions
- 94.3% bespoke with generic trio present

**What works:** Confidence bar + lifecycle-status chip are clean scientific visual language. Real macro-backed compute. Stats workbench is genuine (t-tests, ANOVA, chi-square). Previous broken version is now fixed.

**What feels generic:** Generic trio imports. The 3-column grid could be more visually structured — science has a natural visual hierarchy (hypothesis → evidence → conclusion).

**DESIGN DIRECTION:** Should feel like a research lab's digital notebook — precise, methodical, evidence-focused. Think lab notebook crossed with Jupyter. Monospace for data, clean hierarchy for the scientific method steps.

**LAYOUT UPGRADE:**
- Header: Active hypothesis strip with confidence bar and lifecycle stage
- Left: Hypothesis list with confidence indicators
- Center: Active hypothesis detail with evidence timeline
- Right: Tests and predictions panel
- Bottom: Stats workbench as a scientific calculator panel

**COMPONENT-LEVEL CHANGES:**
- 3-column grid → Scientific method pipeline (hypothesis → evidence → test → conclusion)
- Generic imports → Scientific-styled header and panels
- Text confidence → Confidence bar with visual gauge

**VISUAL UPGRADES:**
- Color palette: Lab blue (#1565C0), evidence green (#2E7D32), refutation red (#C62828), neutral gray
- Typography: Monospace for data and statistical results, serif for hypothesis text
- Surfaces: Clean, lab-notebook feel
- Iconography: Scientific (flask, microscope, chart, sigma)
- Charts: Real statistical visualizations (bell curves, scatter plots)

**CAPABILITY PRESENTATION:**
- CAPABILITY: Hypothesis lifecycle → CURRENT: 3-column grid → BETTER: Scientific method pipeline
- CAPABILITY: Statistics → CURRENT: Tab → BETTER: Scientific calculator panel with visual output
- CAPABILITY: Arxiv feed → CURRENT: Collapsible list → BETTER: Paper cards with abstract preview

**LENS IDENTITY:** The research lab notebook — precise, methodical, evidence-focused. "Test your ideas."

**RESPONSIVE:**
- Desktop: 3-column scientific pipeline
- Tablet: 2-column (list + detail)
- Mobile: Stacked: hypothesis → evidence → test

**BEFORE/AFTER:**
- Before: 3-column grid with generic imports
- After: Scientific method pipeline with confidence gauges, statistical visualizations, paper cards

**IMPLEMENTATION PLAN:**
1. Remove generic scaffold imports
2. Create scientific method pipeline layout
3. Add confidence gauge component
4. Add statistical visualization outputs
5. Style as lab notebook with monospace data
6. Add Arxiv paper cards with abstract preview

**PRIORITY:** P2 — polish (already 94.3% bespoke, strong functionality)

**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 7/10

---

## LENS: import

**PURPOSE:** Universal data import — CSV/JSON import pipeline with schema inference, field mapping, duplicate detection, transform preview.

**CURRENT DESIGN:**
- 4 analysis actions: validateImport, mapFields, detectDuplicates, transformPreview
- Schema inference via inferSchema macro
- Built-in CSV parser with double-quote escaping
- Import modes: merge/replace/skip_existing
- Components: UniversalImport, ImportParityWorkbench, RestoreDtuExport, ImportToolingGallery
- 1,193 lines, 2,850 LOC, 58.1% bespoke with generic trio present

**What works:** Real macro-backed analysis. Schema inference is genuine. CSV parser is built-in with proper escaping. Import modes with keyboard shortcuts are practical.

**What feels generic:** Generic trio imports. The import workflow could be more visually guided — a step-by-step wizard would improve the experience. The drop zone is functional but plain.

**DESIGN DIRECTION:** Should feel like a professional data import tool — think Airbyte or Fivetran's import UI. Clean, step-by-step, with clear progress through the import pipeline stages.

**LAYOUT UPGRADE:**
- Header: Import pipeline progress indicator (Upload → Schema → Map → Validate → Import)
- Primary: Active pipeline step with clear visual focus
- Right sidebar: Field mapping preview / schema inference results
- Bottom: Import history / recent imports
- Controls: Step-by-step wizard navigation

**COMPONENT-LEVEL CHANGES:**
- Flat workflow → Step-by-step pipeline with progress indicator
- Generic imports → Pipeline-specific header
- Basic drop zone → Enhanced drop zone with file type icons and drag feedback

**VISUAL UPGRADES:**
- Color palette: Data blue (#1565C0), success green (#2E7D32), error red (#C62828)
- Typography: Monospace for data preview, sans-serif for labels
- Surfaces: Clean, pipeline-step focused
- Iconography: Data-specific (database, table, arrow-right, check)
- Motion: Step transitions with slide animation

**CAPABILITY PRESENTATION:**
- CAPABILITY: Import pipeline → CURRENT: Flat actions → BETTER: Step-by-step wizard with progress
- CAPABILITY: Schema inference → CURRENT: Text output → BETTER: Visual schema diagram
- CAPABILITY: Field mapping → CURRENT: Form → BETTER: Drag-and-drop field mapper

**LENS IDENTITY:** The data import pipeline — systematic, visual, step-by-step. "Get your data in."

**RESPONSIVE:**
- Desktop: Full pipeline wizard
- Tablet: Pipeline steps as horizontal scroll
- Mobile: Stacked steps with swipe

**BEFORE/AFTER:**
- Before: Flat import actions with generic imports
- After: Step-by-step pipeline wizard with visual progress, schema diagrams

**IMPLEMENTATION PLAN:**
1. Remove generic scaffold imports
2. Create pipeline progress indicator
3. Add step-by-step wizard layout
4. Create field mapping visual component
5. Add schema diagram visualization
6. Enhance drop zone with file type icons
7. Add import history panel

**PRIORITY:** P2 — polish

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 7/10

---

## LENS: inference

**PURPOSE:** Logical inference engine — facts, rules, syllogisms, forward chaining. Prolog-style query and proof tree visualization.

**CURRENT DESIGN:**
- 5 tabs: Facts, Query, Syllogism, Forward Chain, Unify
- Prolog-style term parser for unify macro
- Real mutations with proper request shapes
- History tracking with latency measurement
- Components: InferenceFrameworks, RuleEngineWorkbench (Prolog/Drools-style)
- 739 lines, 1,582 LOC, 53.2% bespoke with generic trio present

**What works:** Real end-to-end compute with fact ID, confidence, latency logging. Prolog-style parser is genuine. Forward chaining and unification are real logic operations. Previous broken payloads are fixed.

**What feels generic:** Generic trio imports. The logic engine could be more visually structured — proofs and syllogisms have a natural tree/graph visualization. The fact/rule list could show relationships visually.

**DESIGN DIRECTION:** Should feel like a logic professor's digital chalkboard — precise, structured, with visual proof trees. Think Prolog IDE crossed with formal verification tool. Monospace for logic notation, tree visualizations for proofs.

**LAYOUT UPGRADE:**
- Header: Engine mode selector with active fact/rule counts
- Left: Fact/rule list with relationship indicators
- Center: Query workspace with proof tree visualization
- Right: Forward chain results / unification output
- Bottom: History log with latency measurements

**COMPONENT-LEVEL CHANGES:**
- 5 flat tabs → Split-panel logic workspace
- Generic imports → Logic-styled header
- Text proof output → Visual proof tree with node connections

**VISUAL UPGRADES:**
- Color palette: Logic blue (#1565C0), proof green (#2E7D32), refutation red (#C62828), variable purple (#7B1FA2)
- Typography: Monospace for logic notation (fact: "socrates is mortal")
- Surfaces: Clean, chalkboard-like dark
- Iconography: Logic-specific (tree, sigma, bracket, arrow)
- Charts: Proof tree as visual node-link diagram

**CAPABILITY PRESENTATION:**
- CAPABILITY: Fact/rule management → CURRENT: Text list → BETTER: Relationship graph
- CAPABILITY: Query/proof → CURRENT: Text output → BETTER: Visual proof tree
- CAPABILITY: Forward chain → CURRENT: Text results → BETTER: Step-by-step derivation chain

**LENS IDENTITY:** The logic professor's digital chalkboard — precise, structured, visual proofs. "Reason formally."

**RESPONSIVE:**
- Desktop: Split-panel logic workspace
- Tablet: Tab-based with visual proof outputs
- Mobile: Stacked: input → results

**BEFORE/AFTER:**
- Before: Text-based facts and proof output
- After: Visual proof tree, relationship graph, step-by-step derivation

**IMPLEMENTATION PLAN:**
1. Remove generic scaffold imports
2. Create visual proof tree component
3. Add fact/rule relationship graph
4. Add step-by-step derivation chain
5. Style with monospace logic notation
6. Add latency measurement display

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## LENS: ingest

**PURPOSE:** DTU-creation pipeline with vision brain integration — text/JSON/file ingestion with chunking, entity extraction, schema detection, batch processing.

**CURRENT DESIGN:**
- 6 analysis actions: parseDocument, extractEntities, validateSchema, detectSchema, batchStatus
- Batch file ingest (multi-file, text extraction, binary skip)
- Vision analysis integration (callVision/Qwen2.5-VL)
- Components: IngestionRepos, PipelinePanel (7-tab ELT pipeline), VisionAnalyzeButton
- 914 lines, 2,286 LOC, 60% bespoke with generic trio present

**What works:** Real vision brain integration via callVision. PipelinePanel is genuinely deep (7-tab ELT with connectors, schedules, transforms, sync runs). Schema detection is real.

**What feels generic:** Generic trio imports. The pipeline could be more visually structured — ELT pipelines have a natural flow diagram. The upload zone is functional but plain.

**DESIGN DIRECTION:** Should feel like a data engineering pipeline — Airbyte/Fivetran shape with visual flow diagrams. Clean, systematic, with the pipeline stages as visual connected nodes.

**LAYOUT UPGRADE:**
- Header: Pipeline status strip (Active Connections, Last Sync, Queue Depth)
- Primary: Visual pipeline flow diagram showing connected stages
- Right sidebar: Active transform rules / sync configuration
- Bottom: Recent sync runs with status
- Controls: Pipeline stage selector (Connectors → Transforms → Sync → Dedup)

**COMPONENT-LEVEL CHANGES:**
- Flat pipeline tabs → Visual flow diagram with connected stages
- Generic imports → Pipeline-specific header
- Basic upload zone → Enhanced drop zone with file type detection

**VISUAL UPGRADES:**
- Color palette: Pipeline green (#2E7D32), sync blue (#1565C0), error red (#C62828), idle gray
- Typography: Monospace for schema definitions, sans-serif for labels
- Surfaces: Clean, pipeline-dashboard feel
- Iconography: Data-pipeline (database, arrow, sync, filter, check)
- Motion: Sync progress animation

**CAPABILITY PRESENTATION:**
- CAPABILITY: Pipeline management → CURRENT: Tab-based → BETTER: Visual flow diagram
- CAPABILITY: Sync runs → CURRENT: Text list → BETTER: Timeline with status and duration
- CAPABILITY: Schema detection → CURRENT: Text output → BETTER: Visual schema diagram

**LENS IDENTITY:** The data engineering pipeline — systematic, visual, connected. "Get data flowing in."

**RESPONSIVE:**
- Desktop: Pipeline flow + sidebar
- Tablet: Pipeline flow full-width
- Mobile: Stacked pipeline stages

**BEFORE/AFTER:**
- Before: Tab-based pipeline management with generic imports
- After: Visual pipeline flow diagram with sync timeline, schema diagrams

**IMPLEMENTATION PLAN:**
1. Remove generic scaffold imports
2. Create visual pipeline flow diagram component
3. Add sync run timeline with status
4. Add schema diagram visualization
5. Enhance upload zone with file type detection
6. Apply pipeline color palette

**PRIORITY:** P2 — polish

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 7/10

---

## LENS: inheritance

**PURPOSE:** Estate planning + death-derivatives market — name beneficiaries, author wills, inventory assets, appoint executors, then trade heir-slot futures on the real CC economy.

**CURRENT DESIGN:**
- 9 tabs: Overview, Beneficiaries, Will & Directives, Asset Inventory, Executors, Probate Timeline, My Notices, Heir-Slot Market, Intestacy Reference
- Full CRUD for beneficiaries, wills, assets, executors
- Heir notification system, lock revocation/amendment
- Heir-Slot Market with real CC economy trading
- 906 lines, 977 LOC, 7.2% bespoke — very low

**What works:** The Heir-Slot Market is genuinely novel — trading heir-slot futures on the real economy. Honest prerequisite messaging. Real CRUD operations. Intestacy lookup with state coverage.

**What feels unfinished:** 7.2% bespoke ratio — very low. The estate planning form could be more visually structured. The Heir-Slot Market deserves a richer trading interface. The Overview tab needs visual depth.

**DESIGN DIRECTION:** Should feel like a formal estate planning office crossed with a trading terminal — serious, structured, with the market as the visual centerpiece. Legal document aesthetic for the planning side, financial terminal for the market.

**LAYOUT UPGRADE:**
- Header: Estate status strip (Total Assets, Beneficiaries Count, Market Value)
- Primary: Split between estate planning (left) and heir-slot market (right)
- Estate side: Beneficiary tree visualization with inheritance flow
- Market side: Heir-slot price chart with bid/ask display
- Bottom: Recent notices and probate timeline

**COMPONENT-LEVEL CHANGES:**
- Flat 9-tab → Split estate/market layout
- Low-bespoke components → Estate-specific cards and forms
- Basic market display → Trading terminal with price chart

**VISUAL UPGRADES:**
- Color palette: Estate gold (#C4A35A), legal navy (#1E3A5F), market green (#2E7D32), probate red (#C62828)
- Typography: Serif for legal documents, monospace for market data
- Surfaces: Formal, document-like for estate; terminal-like for market
- Iconography: Estate-specific (building, gavel, family, dollar, chart)
- Charts: Heir-slot price line chart, asset allocation pie chart

**CAPABILITY PRESENTATION:**
- CAPABILITY: Estate planning → CURRENT: Form-based → BETTER: Beneficiary tree with inheritance flow
- CAPABILITY: Heir-Slot Market → CURRENT: Text list → BETTER: Trading terminal with price chart
- CAPABILITY: Probate timeline → CURRENT: List → BETTER: Visual timeline with milestone markers

**LENS IDENTITY:** The estate office meets trading terminal — formal planning meets market speculation. "Plan your legacy, trade the future."

**RESPONSIVE:**
- Desktop: Split estate/market layout
- Tablet: Tab-based (estate tabs, market tabs)
- Mobile: Stacked with market as primary

**BEFORE/AFTER:**
- Before: 9-tab form-based layout with 7.2% bespoke
- After: Split estate/market layout with beneficiary tree, price charts, trading terminal

**IMPLEMENTATION PLAN:**
1. Create split estate/market layout
2. Add beneficiary tree visualization with inheritance flow
3. Create heir-slot price chart component
4. Add asset allocation visualization
5. Style estate side as formal documents
6. Style market side as trading terminal
7. Add probate timeline component

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 4/10
**UPGRADE POTENTIAL:** 9/10

---

## LENS: insurance

**PURPOSE:** Insurance Wallet — policies, claims, premiums, coverage, with real coverage-gap risk analysis and 373 DTUs.

**CURRENT DESIGN:**
- 5 tabs: Overview, Quotes, Gap Analysis, AMS, Mutual-Aid Pacts
- InsuranceWalletSection (policy/claim/agent/asset management)
- Components: InsuranceOverviewPanel, QuoteCompare, CoverageAnalyzer, AmsWorkbench, MutualAidPactsPanel
- Vision analysis for damage photos
- Realtime feed with FIO + NAIC live data
- 4,568 LOC, 17 files, 95.4% bespoke — very high

**What works:** Coverage-gap detection against actual policy data is genuinely strong. 95.4% bespoke. Vision analysis for damage photos is a good integration. FIO + NAIC live data is real.

**What feels unfinished:** The financial-services layout could be more visually rich — coverage gaps as visual risk meters, policy summaries as dashboard cards. The overview panel has stat cards but could show more trend data.

**DESIGN DIRECTION:** Should feel like a modern insurance dashboard — clear, risk-focused, with visual coverage indicators. Think Lemonade meets Bloomberg. Coverage gaps should be visually prominent (red/amber/green risk indicators).

**LAYOUT UPGRADE:**
- Header: Coverage health strip (Active Policies, Coverage Score, Next Premium Due)
- Primary: Policy cards with coverage indicators and gap highlights
- Right sidebar: Quick actions (File Claim, Get Quote, Review Coverage)
- Bottom: Premium timeline and payment history
- Controls: Policy type filter + coverage date range

**COMPONENT-LEVEL CHANGES:**
- Basic stat cards → Coverage health dashboard with risk indicators
- Text policy list → Policy cards with visual coverage bars
- Text gap analysis → Risk meter visualization

**VISUAL UPGRADES:**
- Color palette: Insurance blue (#1565C0), covered green (#2E7D32), gap red (#C62828), warning amber (#F57F17)
- Typography: Clean, financial — numbers prominent
- Surfaces: Clean, professional financial feel
- Iconography: Insurance-specific (shield, policy, claim, premium)
- Charts: Coverage bar charts, premium timeline, gap risk meters

**CAPABILITY PRESENTATION:**
- CAPABILITY: Coverage gaps → CURRENT: Text analysis → BETTER: Visual risk meters with severity
- CAPABILITY: Policy management → CURRENT: Text list → BETTER: Cards with coverage bars
- CAPABILITY: Claims → CURRENT: Form → BETTER: Claim status tracker with timeline

**LENS IDENTITY:** The insurance dashboard — clear, risk-focused, protective. "Your coverage, visualized."

**RESPONSIVE:**
- Desktop: Policy cards + sidebar + charts
- Tablet: Policy cards full-width
- Mobile: Policy list with swipe actions

**BEFORE/AFTER:**
- Before: Clean but text-heavy financial layout
- After: Coverage health dashboard with risk meters, policy cards with coverage bars

**IMPLEMENTATION PLAN:**
1. Add coverage health strip to header
2. Create policy card component with coverage bar
3. Add risk meter visualization for gaps
4. Add premium timeline chart
5. Add claim status tracker
6. Apply insurance color palette

**PRIORITY:** P2 — polish (already 95.4% bespoke, strong functionality)

**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 7/10

---

## LENS: integrations

**PURPOSE:** Zapier-style workflows, app connectors, webhooks, and integration analysis. Real OAuth-gated external integrations.

**CURRENT DESIGN:**
- 4 tabs: Workflows, Connectors, Webhooks, Analysis
- Real webhook CRUD with signature verification and retry
- Delivery log with backoff metadata
- ConnectorCatalog with OAuth2 cards (Slack, Gmail, GitHub)
- Components: WorkflowsPanel, ConnectorCatalog, AnalysisPanel, WebhookSignatureVerifier
- 2,326 LOC, 8 files, 76.3% bespoke

**What works:** Real OAuth2 connector cards with triggers/actions/scopes. Webhook test-fire with signature verification is genuine. Delivery log with backoff metadata is practical. The connector cards directly surface code-complete server domains.

**What feels unfinished:** The connector cards could be more visually rich — brand-colored borders for each service. The workflow visualization could be more visual (flow diagram, not just list).

**DESIGN DIRECTION:** Should feel like Zapier/Make.com — colorful, connector-focused, with visual workflow diagrams. Each connected app should feel like a branded integration.

**LAYOUT UPGRADE:**
- Header: Integration health strip (Connected Apps, Active Workflows, Webhook Status)
- Primary: Connector cards as a visual grid with brand-colored borders
- Right sidebar: Active workflows with visual flow indicators
- Bottom: Webhook delivery log with status timeline
- Controls: Search + category filter (already present)

**COMPONENT-LEVEL CHANGES:**
- Basic connector cards → Brand-colored cards with service logos
- Text workflow list → Visual workflow diagrams with connected nodes
- Text delivery log → Timeline with status indicators

**VISUAL UPGRADES:**
- Color palette: Service-specific brand colors for connector cards (Slack=#4A154B, Gmail=#EA4335, GitHub=#24292E)
- Typography: Clean, professional for labels; monospace for webhook payloads
- Surfaces: White cards on dark background for contrast
- Iconography: Service logos + integration-specific (webhook, flow, sync)
- Motion: Connector card hover effects, workflow execution animation

**CAPABILITY PRESENTATION:**
- CAPABILITY: Connector management → CURRENT: Text cards → BETTER: Brand-colored cards with service logos
- CAPABILITY: Workflows → CURRENT: List → BETTER: Visual flow diagram
- CAPABILITY: Webhook testing → CURRENT: Form → BETTER: Live test with response preview

**LENS IDENTITY:** The integration hub — connected, visual, branded. "Connect everything."

**RESPONSIVE:**
- Desktop: Connector grid + sidebar workflows
- Tablet: Connector grid full-width
- Mobile: Connector list with status badges

**BEFORE/AFTER:**
- Before: Clean connector cards with text details
- After: Brand-colored connector grid, visual workflow diagrams, delivery timeline

**IMPLEMENTATION PLAN:**
1. Add brand colors to connector cards
2. Create visual workflow diagram component
3. Add delivery log timeline
4. Add integration health strip
5. Add service logo integration
6. Add workflow execution animation

**PRIORITY:** P2 — polish

**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 7/10

---

## LENS: invariant

**PURPOSE:** Interactive ethos enforcer and capability tester — formal verification workbench with continuous monitoring, counterexamples, temporal logic, violation history, quantified logic.

**CURRENT DESIGN:**
- 6-tab workbench: Continuous Monitoring, Counterexamples, Library, Temporal Logic, Violation History, Quantified ForAll/Exists
- Real invariant.* macros wired end-to-end
- MonitorPanel with register/toggle/remove
- Action tester via real invariant.testAction macro
- Components: FormalVerificationRepos, FormalVerificationWorkbench
- 700 lines, 1,569 LOC, 55.3% bespoke with generic trio present

**What works:** The temporal logic and quantified logic labels are genuinely rigorous. Real macro-backed compute. The 6-tab workbench covers formal verification needs. Previous broken action tester is fixed.

**What feels generic:** Generic trio imports. The formal verification workbench could be more visually structured — monitors as visual status cards, violations as visual alerts. The temporal logic visualization could be a timeline.

**DESIGN DIRECTION:** Should feel like a formal verification IDE — precise, rigorous, with visual monitors and violation alerts. Think TLA+ Toolbox crossed with a CI dashboard. Red/green/yellow status indicators are essential.

**LAYOUT UPGRADE:**
- Header: Verification health strip (Active Monitors, Enforced Invariants, Violations Today)
- Primary: Monitor cards with visual status indicators (green=enforced, yellow=warning, red=violated)
- Right sidebar: Quick test panel (action tester)
- Bottom: Violation history timeline
- Controls: Status filter (enforced/warning/violated) — already present

**COMPONENT-LEVEL CHANGES:**
- Text monitor list → Monitor cards with visual status gauges
- Generic imports → Verification-styled header
- Basic violation display → Alert cards with severity and context

**VISUAL UPGRADES:**
- Color palette: Enforced green (#2E7D32), Warning amber (#F57F17), Violated red (#C62828), Neutral gray
- Typography: Monospace for invariant expressions, sans-serif for labels
- Surfaces: Clean, CI-dashboard feel
- Iconography: Verification-specific (shield, check, alert, times, sigma)
- Motion: Status change animations (green → red flash)

**CAPABILITY PRESENTATION:**
- CAPABILITY: Continuous monitoring → CURRENT: Text list → BETTER: Monitor cards with status gauges
- CAPABILITY: Violations → CURRENT: Text log → BETTER: Alert cards with severity and context
- CAPABILITY: Testing → CURRENT: Form → BETTER: Visual test runner with pass/fail indicators

**LENS IDENTITY:** The formal verification IDE — precise, rigorous, visual status. "Enforce your principles."

**RESPONSIVE:**
- Desktop: Monitor cards + sidebar test panel
- Tablet: Monitor cards full-width
- Mobile: Monitor list with status badges

**BEFORE/AFTER:**
- Before: Text-based monitors and violation display
- After: Visual monitor cards with status gauges, alert cards for violations

**IMPLEMENTATION PLAN:**
1. Remove generic scaffold imports
2. Create monitor card component with status gauge
3. Add verification health strip
4. Create violation alert card component
5. Add test runner with pass/fail indicators
6. Add status change animations
7. Apply verification color palette

**PRIORITY:** P1 — significant improvement

**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## RANKING SUMMARY

| Priority | Lenses | Count |
|----------|--------|-------|
| **P0** | healthcare, housing | 2 |
| **P1** | game, garage, genesis, geology, global, goals, graph, history, home-improvement, household, hr, hvac, inference, inheritance, invariant | 15 |
| **P2** | game-design, goddess, government, grounding, ghost-tracker, import, ingest, insurance, integrations | 9 |
| **P3** | (none — all lenses have upgrade potential) | 0 |

## SCORE DISTRIBUTION

| Score Range | Count | Lenses |
|-------------|-------|--------|
| 2/10 | 1 | housing |
| 4/10 | 1 | garage, inheritance |
| 5/10 | 14 | game, genesis, global, goals, government, healthcare, home-improvement, household, hr, hvac, hypothesis, import, inference, ingest, invariant |
| 6/10 | 8 | game-design, geology, grounding, history, insurance, integrations |
| 7/10 | 3 | ghost-tracker, goddess, graph |

## KEY FINDINGS

1. **Thinnest lenses need the most work:** housing (570 LOC, 0% bespoke) and inheritance (7.2% bespoke) are the most underserved visually
2. **Largest lenses need loading states:** healthcare (10,284 LOC) has 0 Loader2 usage — a critical gap for a clinical tool
3. **Generic trio imports appear in 13 of 27 lenses** — these are the strongest candidates for visual identity improvement
4. **Macro button walls appear in 19 of 27 lenses** — most lenses still rely on the generic action strip pattern
5. **8 lenses lack keyboard handlers** — genesis, geology, goals, goddess, hr, housing, ingest, integrations
6. **All 27 pass as "polished"** — the mechanical checks pass, but visual depth varies enormously
7. **Earth-toned lenses (geology, home-improvement, household)** would benefit most from warmer palettes instead of standard dark
8. **The most visually distinctive lenses** (ghost-tracker, goddess, graph) are already at P2/P3 — identity helps
