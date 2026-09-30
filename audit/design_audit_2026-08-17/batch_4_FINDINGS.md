# Batch 4 Design Audit Findings — entity → gallery (27 lenses)

Generated: 2026-08-17

---

## 1. entity

**LENS:** entity
**PURPOSE:** Create and manage swarm entities with terminal access, council-gated approval queues, knowledge graph workbench, qualia/cognitive inspection, and entity lifecycle visualization.

**CURRENT DESIGN:**
- Dark navy background, standard `LensShell` wrapper, emoji header (🤖)
- 4-stat grid at top (Entities/Relationships/Active/Workspaces) with lucide icons
- Entity cards in 2-column grid with gradient avatar circles, type badges, status dots
- Duplicate Council Approval Queue rendered twice (lines ~310 and ~510 — a copy-paste artifact)
- Terminal modal with green-on-black monospace output
- `EntityLifecycleViz` and `KnowledgeGraphWorkbench` bespoke components below
- `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel` at footer
- `framer-motion` stagger animation on entity cards

**WHAT WORKS VISUALLY:** The entity card grid with gradient avatars and type badges has genuine visual interest. The terminal modal's green-on-black aesthetic is domain-appropriate. Council approval queue with risk-level color coding is clear.

**WHAT FEELS UNFINISHED:** Duplicate council approval queue blocks. The 🤖 emoji header is weak for a technical systems lens. The stat grid at top is identical to every other lens's stat grid. The `EntityLifecycleViz` component renders below the fold with no visual connection to the entity cards above it.

**WHAT FEELS GENERIC:** The stat grid, the footer scaffold stack, the panel/chrome patterns are all stock. The lens looks like every other lens at a glance.

**WHAT FEELS CLUTTERED:** The page is long — stat grid → council queue → entity grid → duplicate council queue → stats (again) → entity grid. The second stat grid and second entity registry section near line 609 are redundant with the identical sections near line 288.

**DESIGN DIRECTION:**
This should read as a **systems control panel** — think Kubernetes dashboard or AWS ECS console. Dense, data-forward, with live status indicators that pulse. The visual language should communicate "these are autonomous agents doing real work" — status bars, activity graphs, last-action timestamps. The terminal is the signature interaction surface and should feel like an actual terminal, not a styled div.

**LAYOUT UPGRADE:**
- Header: replace 🤖 with an inline SVG of interconnected nodes/agent silhouettes; "ENTITY LENS" in monospace, uppercase
- Live status bar: horizontal strip showing entity count + active count + alerts count, with pulsing green dots for active entities
- Remove the duplicate council queue and duplicate stats/entity-grid sections
- Main workspace: entity cards in a denser grid (3-col on desktop), each card showing a mini activity sparkline + last-action timestamp
- Right sidebar: terminal console (persistent, not modal) + council queue
- Bottom: `KnowledgeGraphWorkbench` gets full width, `EntityLifecycleViz` integrated as a tab within entity detail, not a separate section

**COMPONENT-LEVEL CHANGES:**
- Current emoji header → monospace uppercase title with inline SVG agent-network icon
- Current 2-col entity card grid → 3-col denser grid with sparkline per card
- Current modal terminal → persistent right-sidebar terminal panel
- Current duplicate council queue sections → single queue in sidebar
- Current duplicate stat grids → single live-status bar at top
- Current `RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel` footer → remove (the workbench and terminal are the real interactions)

**VISUAL UPGRADES:**
- Typography: monospace for entity IDs, terminal output, and stats; system font for labels
- Spacing: tighten padding from `p-6` to `p-4`; entity cards need less internal whitespace
- Hierarchy: entity name in bold white, workspace/type in muted gray, last-action in dim mono
- Surfaces: terminal panel with true black (#000) background and green phosphor text
- Icons: custom inline SVG for entity type (worker=gear, researcher=microscope, guardian=shield, architect=compass) instead of colored text badges

**CAPABILITY PRESENTATION:**
- ENTITY TERMINAL → currently modal-only → persistent sidebar panel with scrollback history
- COUNCIL QUEUE → currently duplicated → single panel with live vote progress bars
- KNOWLEDGE GRAPH → currently full-width below fold → tab within entity detail view
- ENTITY LIFECYCLE → currently a separate section → inline sparkline on each entity card

**LENS IDENTITY:** Systems operations console — dense, monospace-accented, live-status-pulsing, terminal-forward. Distinct from `admin` (which is metrics-focused) by being entity-lifecycle-focused.

**RESPONSIVE DESIGN:**
- Desktop: 3-col entity grid + right sidebar (terminal + council queue)
- Tablet: 2-col grid, terminal as expandable bottom panel
- Mobile: single-col cards with swipe-to-terminal gesture

**BEFORE/AFTER:**
Before: Long scroll of duplicate sections, generic stat grids, modal terminal, emoji header.
After: Dense control panel with a live status bar, 3-col entity grid with sparklines, persistent terminal sidebar, single council queue with vote progress bars.

**IMPLEMENTATION PLAN:**
1. Remove duplicate council queue and duplicate stat/entity sections
2. Replace emoji header with monospace title + inline SVG
3. Create a persistent terminal sidebar component (move from modal)
4. Add mini sparkline visualization to entity cards
5. Create live-status-bar component at top
6. Remove footer scaffold stack (RecentMineCard, AutoActionStrip, CrossLensRecentsPanel)
7. Add custom entity-type SVG icons

**PRIORITY:** P1
**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## 2. environment

**LENS:** environment
**PURPOSE:** Enterprise ESG compliance — Watershed/Persefoni-parity carbon accounting, site management, species surveys, sampling, trails, waste, compliance, resources, goals, map.

**CURRENT DESIGN:**
- Massive 3673-line page, 10 tabs (Sites/Species/Sampling/Trails/Waste/Compliance/Carbon/Resources/Goals/Map)
- 80+ lucide icons imported, 14 bespoke sub-components (EnviroPanel, EmissionsActivitiesPanel, EmissionFactorsLibrary, SuppliersPortal, TargetsTracker, ProjectsBacklog, RECsLedger, OffsetsLedger, EJScreenLookup, ReportsBuilder, CarbonFootprintDashboard, etc.)
- `ds` design-system primitives used (ds.panel, ds.grid2, ds.grid4)
- Tab bar at top with icon+label per tab
- Each tab renders a dedicated sub-panel
- MobileTabBar at bottom for mobile navigation

**WHAT WORKS VISUALLY:** The tab breadth is genuinely impressive — this is a real enterprise ESG tool with real depth. The EPA factors, suppliers, targets, and audit trail panels show genuine domain expertise. The ds design system gives consistent spacing.

**WHAT FEELS UNFINISHED:** The page is 3673 lines — too much inline logic. The Disconnected pill is a known bug. The tab bar with 10 tabs is overwhelming on mobile. Many panels render loading skeletons that may never resolve (per the existing audit finding about stuck Emissions + Footprint Dashboard fetches).

**WHAT FEELS GENERIC:** Tab chrome and card patterns are stock Concord. The tab bar treatment is identical to every other 10-tab lens.

**DESIGN DIRECTION:**
This should read as an **enterprise compliance dashboard** — think Watershed or Persefoni. Clean, data-dense, with clear regulatory-grade presentation. Carbon numbers should be large and prominent. Compliance status should use red/amber/green traffic-light coding. The visual language should communicate "auditable, professional, trustworthy" — not "generic dashboard."

**LAYOUT UPGRADE:**
- Header: "ENVIRONMENT" in clean sans-serif, subtitle "ESG Compliance & Sustainability", carbon total as a large hero metric
- Top strip: 3 key metrics (Total Emissions / Compliance Score / Active Sites) as large KPI cards
- Tab bar: reduce to 6 primary tabs (Sites/Carbon/Compliance/Resources/Map/Reports), nest remaining into sub-navigation
- Main area: full-width data panels per tab, each with its own internal visual hierarchy
- Map tab should be full-bleed (current MapView is cramped)

**COMPONENT-LEVEL CHANGES:**
- Current 10-tab flat bar → 6 primary tabs with dropdown sub-nav for secondary tabs
- Current generic stat cards → large KPI hero cards with trend arrows (↑/↓)
- Current tab-per-panel → tab with dedicated header area showing current-context metrics
- Current standard card chrome → clean white-on-dark cards with subtle left-border accent per category

**VISUAL UPGRADES:**
- Color: introduce a green/teal accent for environmental data, amber for compliance warnings, red for violations
- Typography: large bold numbers for emissions totals, tabular-nums for all metric figures
- Charts: dedicated emission-over-time line chart as the Carbon tab's hero element
- Hierarchy: compliance violations get red left-border treatment; good compliance gets green

**CAPABILITY PRESENTATION:**
- CARBON TRACKING → buried in a tab → hero KPI at top + dedicated carbon dashboard tab
- COMPLIANCE CHECK → currently a panel → traffic-light status cards with per-permit detail
- EMISSIONS → currently stuck loading → fix fetch, then present as a time-series chart
- MAP → currently small → full-bleed map with site markers and pollution overlays

**LENS IDENTITY:** Enterprise ESG compliance tool — professional, auditable, data-dense with regulatory-grade presentation. Distinct from `eco` (consumer-facing environmental) by being corporate/audit-oriented.

**RESPONSIVE DESIGN:**
- Desktop: full tab bar + wide panels, map can be half-width alongside data
- Tablet: collapsed tab bar with dropdown, single-column panels
- Mobile: bottom tab bar (already has MobileTabBar), scroll per-panel

**BEFORE/AFTER:**
Before: 10 overwhelming tabs, stuck-loading panels, generic card chrome, no hero metrics.
After: Clean enterprise dashboard with 3 large KPI metrics at top, 6 primary tabs, time-series emission charts, traffic-light compliance status, full-bleed map.

**IMPLEMENTATION PLAN:**
1. Fix stuck Emissions + Footprint Dashboard fetches (functional prerequisite)
2. Fix false-Disconnected pill
3. Reduce tab count from 10 to 6 primary, nest secondary
4. Add hero KPI strip at top (Total Emissions, Compliance Score, Active Sites)
5. Create time-series emission chart component for Carbon tab
6. Add traffic-light compliance indicators
7. Make Map tab full-bleed

**PRIORITY:** P1
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 8/10

---

## 3. error.tsx

**LENS:** error.tsx
**PURPOSE:** Global error boundary fallback — renders when any lens hits a render crash.

**CURRENT DESIGN:**
- Centered card with yellow warning icon, "Lens Error" title, error message in monospace
- Two action buttons: "Retry Lens" (cyan) and "Dashboard" (neutral)
- Helpful tips list at bottom (refresh, check backend, clear cache)
- Uses `bg-lattice-surface`, `border-sovereignty-warning`, `bg-lattice-deep`

**WHAT WORKS VISUALLY:** The error state is clear, actionable, and well-structured. The warning icon, error message box, and two-button layout are all correct. The tips section is genuinely helpful.

**WHAT FEELS UNFINISHED:** The tips use bare `*` bullets instead of proper list markers. The card is well-sized but could show more diagnostic information (which lens crashed, when, the error digest more prominently).

**DESIGN DIRECTION:**
An error boundary should feel like a **circuit breaker** — authoritative, calm, informative. It should give the user enough information to decide whether to retry or report. The current design is 90% correct. Minor polish only.

**LAYOUT UPGRADE:**
- Keep the centered card layout (correct for an error state)
- Add lens name identification at top ("entity" / "environment" / etc.)
- Make the error digest more prominent (move above the tips)
- Add a "Copy error" button for reporting

**COMPONENT-LEVEL CHANGES:**
- Current bare `*` bullets → proper `•` or styled list items
- Current error message box → add copy-to-clipboard button
- Current tips → make collapsible (most users won't read them)

**VISUAL UPGRADES:**
- The yellow warning treatment is correct — no color change needed
- Add subtle pulse animation to the warning icon to draw attention
- Error message font could be slightly larger for readability

**CAPABILITY PRESENTATION:** N/A — this is a system component, not a feature lens.

**LENS IDENTITY:** System circuit breaker — calm, informative, actionable. No distinct visual identity needed; it should feel like part of the platform infrastructure.

**RESPONSIVE DESIGN:** Already responsive (centered max-w-lg card). No changes needed.

**BEFORE/AFTER:**
Before: Working error state with minor UX gaps (bare bullets, no copy button, hidden digest).
After: Same layout with copy button, lens identification, collapsible tips, larger digest display.

**IMPLEMENTATION PLAN:**
1. Add lens name identification from router context
2. Add copy-to-clipboard button on error message
3. Replace bare `*` with styled list items
4. Make tips collapsible

**PRIORITY:** P3
**DESIGN SCORE:** 7/10
**UPGRADE POTENTIAL:** 3/10

---

## 4. ethics

**LENS:** ethics
**PURPOSE:** Multi-framework decision analysis, stakeholder equity mapping, bias auditing, ethics review, and peer-reviewed case library with philosophy Q&A.

**CURRENT DESIGN:**
- `LensPageShell` with Scale icon, title "Ethics", descriptive subtitle
- `DecisionToolkit` component renders all real tool tabs (Multi-Framework/Stakeholder Map/Decision Matrix/Bias Checklist/Ethics Review/Case Library)
- Collapsible Philosophy Q&A section at bottom (Stack Exchange integration)
- Standard `SessionRail`, `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel` footer
- Keyboard shortcuts per tab (discoverable via kbd chips)

**WHAT WORKS VISUALLY:** The `LensPageShell` gives a clean, structured header. The DecisionToolkit is the real substance and renders as a well-organized tabbed interface. Keyboard shortcuts per tab are excellent UX.

**WHAT FEELS UNFINISHED:** The collapsible Philosophy Q&A section at bottom feels tacked on — a Stack Exchange widget below a serious decision-analysis tool is tonally inconsistent. The Scale icon is generic.

**WHAT FEELS GENERIC:** The Scale icon is the same icon used by `debate`/`disputes`/`legal`. The footer scaffold stack is stock. The overall visual treatment is indistinguishable from any other tabbed lens.

**DESIGN DIRECTION:**
This should feel like a **deliberation workspace** — think a structured reasoning tool, not a dashboard. The visual language should communicate "careful analysis" — clean lines, structured layouts, clear hierarchy between frameworks. A muted, scholarly palette (warm grays, deep blues, subtle gold accents for the "justice" motif) would distinguish it from the neon-heavy tech lenses.

**LAYOUT UPGRADE:**
- Header: replace Scale with a custom SVG of interlocking circles (Venn-diagram-like, representing framework overlap), or a balanced-scales motif rendered as a clean line icon
- DecisionToolkit occupies the full page (it's the real content)
- Philosophy Q&A should be a tab within the toolkit, not a separate section below it
- Remove footer scaffold stack

**COMPONENT-LEVEL CHANGES:**
- Current Scale icon → custom deliberation/reasoning icon
- Current Philosophy Q&A collapsible below toolkit → tab within DecisionToolkit
- Current footer scaffold → remove (the toolkit IS the interaction)
- Current generic tab bar → warm-gray accent tabs with gold active indicator

**VISUAL UPGRADES:**
- Color: warm gray backgrounds (#1a1816), deep navy accents, gold for "justice/ethics" motif
- Typography: slightly more serif-influenced or bookish feel for section headers
- Borders: thin, precise lines (scholarly, not chunky rounded)
- Remove neon accents — this is a deliberation tool, not a tech console

**CAPABILITY PRESENTATION:**
- MULTI-FRAMEWORK ANALYSIS → already well-presented → ensure framework names are prominent (Utilitarian/Deontological/Virtue)
- STAKEHOLDER MAP → ensure it reads as a real influence/impact matrix, not a generic chart
- CASE LIBRARY → currently buried in a tab → could be a secondary entry point ("Browse Cases" from empty state)

**LENS IDENTITY:** Deliberation workspace — scholarly, structured, precise. Distinct from `legal`/`disputes` by being analytical (weighing frameworks) rather than adjudicative (resolving conflicts).

**RESPONSIVE DESIGN:**
- Desktop: full toolkit with sidebar context panel
- Tablet: tabs with stacked panels
- Mobile: accordion-style tab expansion

**BEFORE/AFTER:**
Before: Generic tabbed toolkit with Scale icon, tacked-on Stack Exchange widget, stock footer.
After: Warm-toned deliberation workspace with custom icon, Philosophy Q&A as a toolkit tab, scholarly visual language.

**IMPLEMENTATION PLAN:**
1. Replace Scale icon with custom deliberation SVG
2. Move Philosophy Q&A into DecisionToolkit as a tab
3. Apply warm-gray/gold color palette
4. Remove footer scaffold stack
5. Add framework names as prominent section headers

**PRIORITY:** P2
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 6/10

---

## 5. event-timeline

**LENS:** event-timeline
**PURPOSE:** Full substrate event firehose — combat, quests, NPCs, world-state, cross-world plots, cognition events with search, filter, date-range, export, and "On this day" personal callback.

**CURRENT DESIGN:**
- Two-mode display: vertical timeline (default) and list view
- Per-entity panels (NPCs, Quests, World) selectable via top tab bar
- Status color badges, event date, detail text per card
- `framer-motion` stagger animation on card entry
- Search/filter/date-range controls
- CSV/JSON export
- "On this day — your Concord history" panel
- Channel trends panel

**WHAT WORKS VISUALLY:** The timeline layout with stagger animation is genuinely engaging. The per-entity panel system organizes the firehose well. The "On this day" concept is excellent for daily engagement.

**WHAT FEELS UNFINISHED:** The Channel trends and "On this day" panels are stuck loading (per audit). The timeline cards are uniform in visual treatment — no visual distinction between combat events and quest events beyond text labels.

**DESIGN DIRECTION:**
This should feel like a **living history scroll** — think GitHub's contribution graph meets a narrative timeline. Events should feel like they have weight and chronology. Combat events should have a different visual treatment (red accent, impact icon) from quest events (gold accent, scroll icon) from NPC events (blue accent, person icon).

**LAYOUT UPGRADE:**
- Header: "EVENT TIMELINE" with a clock/history icon
- Top strip: search + filter controls in a compact toolbar
- Main area: vertical timeline with distinct event-type visual treatments
- "On this day" as a prominent sidebar card (not buried below)
- Channel trends as a compact horizontal bar chart in the header area

**COMPONENT-LEVEL CHANGES:**
- Current uniform card treatment → per-event-type color coding and iconography
- Current "On this day" panel (stuck loading) → fix fetch, then make prominent sidebar card
- Current Channel trends (stuck loading) → fix fetch, present as horizontal sparkline strip
- Current list/toggle → keep but add visual density option

**VISUAL UPGRADES:**
- Timeline: vertical line with colored dots per event type (red=combat, gold=quest, blue=NPC, green=world)
- Cards: left-border color matching event type, subtle icon in the border
- "On this day" panel: warm amber background to evoke nostalgia
- Motion: timeline cards animate in from left as you scroll

**CAPABILITY PRESENTATION:**
- ON THIS DAY → stuck loading → fix fetch, make the primary daily hook (nostalgia mechanic)
- CHANNEL TRENDS → stuck loading → fix fetch, present as horizontal sparkline
- EXPORT → currently buried → make a toolbar button, not a hidden action
- SEARCH/FILTER → keep, but make filter chips more visually prominent

**LENS IDENTITY:** Living history scroll — chronological, weighted, personal. Distinct from `events` (event management) by being a passive record, not an active planning tool.

**RESPONSIVE DESIGN:**
- Desktop: timeline with sidebar for "On this day" + trends
- Tablet: full-width timeline, "On this day" as a collapsible panel
- Mobile: simplified list view with event-type color indicators

**BEFORE/AFTER:**
Before: Uniform timeline cards, stuck-loading side panels, generic appearance.
After: Color-coded event timeline with per-type icons, prominent "On this day" nostalgia panel, horizontal trend sparklines.

**IMPLEMENTATION PLAN:**
1. Fix "On this day" fetch (functional prerequisite for the daily hook)
2. Fix Channel trends fetch
3. Add per-event-type color coding and icons to timeline cards
4. Create horizontal sparkline strip for channel trends
5. Make "On this day" a prominent sidebar card
6. Add timeline vertical line with colored dots

**PRIORITY:** P1
**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## 6. events

**LENS:** events
**PURPOSE:** Event management — Bizzabo/Cvent parity with venues, vendors, guests, run-of-show, budget, and tickets.

**CURRENT DESIGN:**
- Three-tab interface (Calendar/Operations/NASA Earth Events)
- Calendar view renders month grid
- Operations view has CRUD lists for venues/tickets/vendors
- Real ticket tiers, vendor assignments, run-of-show segments
- `ds.panel`, `ds.panelHover`, `ds.grid2`, `ds.grid4` design primitives
- Custom LoadingSkeleton, EmptyState, ErrorState components
- ProgressBar for capacity visualization

**WHAT WORKS VISUALLY:** The operations view is genuinely deep — real ticketing, vendor management, run-of-show timeline. The NASA Earth Events tab is a unique, distinctive feature. The ds design system provides consistent spacing.

**WHAT FEELS UNFINISHED:** The Calendar tab's month grid is basic. The overall visual treatment is functional but not premium. The NASA Earth Events tab feels disconnected from the event management purpose.

**DESIGN DIRECTION:**
This should feel like a **professional event production tool** — think a combined Eventbrite + StudioBinder dashboard. The visual language should communicate "everything is under control" — clean status indicators, timeline views, capacity gauges. A warm accent (amber/gold for "event energy") would distinguish it from tech-focused lenses.

**LAYOUT UPGRADE:**
- Header: event count + "next event" countdown as hero metrics
- Tab bar: Calendar / Production / Venues / NASA Events (reduce from 3 to 4, merge tickets into Production)
- Calendar: switch from basic grid to a visual timeline/calendar with event dots
- Production tab: run-of-show as a horizontal timeline, not a list

**COMPONENT-LEVEL CHANGES:**
- Current basic month grid → visual calendar with event dots and hover previews
- Current ticket list → inline capacity gauges with color-coded fill
- Current vendor list → card grid with vendor type icons
- Current NASA Events → keep as a distinct tab but add a "related to your events" connection

**VISUAL UPGRADES:**
- Color: warm amber/gold accent for events, green for confirmed, red for conflicts
- Capacity gauges: real circular or bar gauges, not just numbers
- Run-of-show: horizontal timeline with time markers and crew assignments
- Calendar: dots per event type, click-to-expand detail

**CAPABILITY PRESENTATION:**
- RUN OF SHOW → currently a list → horizontal production timeline
- TICKETS → currently a table → inline capacity gauges with tier color coding
- VENDORS → currently a list → card grid with type icons and status
- NASA EARTH EVENTS → keep as a unique, distinctive feature

**LENS IDENTITY:** Professional event production tool — organized, timeline-focused, capacity-aware. Distinct from `film-studios` (creative production) by being event/logistics-focused.

**RESPONSIVE DESIGN:**
- Desktop: full calendar + production timeline side-by-side
- Tablet: tabbed with calendar as default
- Mobile: single-column with event list and countdown

**BEFORE/AFTER:**
Before: Basic month grid, list-based operations, generic card chrome.
After: Visual calendar with event dots, horizontal run-of-show timeline, capacity gauges, warm event-production aesthetic.

**IMPLEMENTATION PLAN:**
1. Replace month grid with visual calendar component
2. Create horizontal run-of-show timeline
3. Add capacity gauges to ticket view
4. Create vendor card grid with type icons
5. Add "next event" countdown to header
6. Apply warm amber/gold color palette

**PRIORITY:** P1
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 7/10

---

## 7. expedition-journal

**LENS:** expedition-journal
**PURPOSE:** Server-backed expedition progress per canon world with XP quest stages, cross-world summary, and keyboard navigation.

**CURRENT DESIGN:**
- Tabbed by canon world name
- Per-world summary panel with bar chart (Stages by World)
- Vertical list of stage cards with XP values and completion status
- Keyboard shortcuts (`]` to cycle worlds, `S` to toggle summary)
- Progress bar for stage completion
- Skeleton shimmer loading, empty state with Map icon

**WHAT WORKS VISUALLY:** The per-world progression system is genuinely engaging — real XP values, real stage names, real completion tracking. The cross-world summary bar chart is a legitimate data visualization. Keyboard shortcuts are excellent.

**WHAT FEELS UNFINISHED:** The stage cards are plain — no visual distinction between completed/in-progress/locked stages beyond text. The world tabs are plain text without any visual identity per world.

**DESIGN DIRECTION:**
This should feel like an **adventure log** — think a travel journal or expedition notebook. The visual language should communicate "journey" and "discovery" — maps, compass motifs, aged-paper textures. Each world should have a distinct color/theme reflecting its identity.

**LAYOUT UPGRADE:**
- Header: "EXPEDITION JOURNAL" with compass/map icon, total XP as hero metric
- World tabs: each tab gets a world-specific color/motif (not just text)
- Stage cards: visual progress indicator (locked = gray, in-progress = amber pulse, completed = green check)
- Cross-world summary: keep the bar chart but add world-specific colors

**COMPONENT-LEVEL CHANGES:**
- Current plain text world tabs → tabs with world-specific color accent
- Current text-only stage cards → cards with visual progress indicators (checkmarks, lock icons, progress bars)
- Current basic progress bar → segmented progress with stage markers
- Current summary bar chart → keep, add world-specific colors to bars

**VISUAL UPGRADES:**
- Per-world color palette (e.g., concordia-hub = blue, tunya = green, sovereign-ruins = gray)
- Stage cards: left-border color indicating status (green=completed, amber=in-progress, gray=locked)
- XP values: larger, more prominent with a glow effect
- Completed stages: subtle checkmark overlay or strikethrough

**CAPABILITY PRESENTATION:**
- STAGE PROGRESS → currently text-only → visual progress with status indicators
- CROSS-WORLD SUMMARY → already good → add per-world colors to bar chart
- XP TRACKING → currently small numbers → hero metric in header

**LENS IDENTITY:** Adventure journal — journey-themed, world-colored, progression-focused. Distinct from `world` (the 3D simulator) by being a 2D progress tracker.

**RESPONSIVE DESIGN:**
- Desktop: world tabs + full stage list + summary sidebar
- Tablet: world tabs + stage list (summary collapsible)
- Mobile: world dropdown + simplified stage cards

**BEFORE/AFTER:**
Before: Plain text world tabs, text-only stage cards, generic progress bar.
After: Color-coded world tabs, visual stage progress with status indicators, prominent XP tracking.

**IMPLEMENTATION PLAN:**
1. Add per-world color accents to tabs
2. Add visual progress indicators to stage cards (lock/check/pulse)
3. Make XP values larger and more prominent in header
4. Add world-specific colors to summary bar chart
5. Add left-border status coloring to stage cards

**PRIORITY:** P2
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 6/10

---

## 8. experience

**LENS:** experience
**PURPOSE:** UX research suite + verifiable career portfolio with endorsements riding the DTU substrate.

**CURRENT DESIGN:**
- Five-tab interface (Research/Methods/Analysis/Portfolio/Settings)
- Research sessions, methodology library, analysis results, portfolio items
- All backed by `experience.*` macros
- Standard tab navigation with active-state underline
- 27 research macros + 4 analytical macros + 5 career portfolio macros

**WHAT WORKS VISUALLY:** The five-tab structure maps cleanly to distinct use cases. The portfolio concept (verifiable, DTU-backed) is genuinely novel.

**WHAT FEELS UNFINISHED:** The empty portfolio state is strong copy but needs a stronger visual treatment. The tab navigation is plain — no visual identity beyond the functional.

**DESIGN DIRECTION:**
This should feel like a **professional portfolio + research lab** — think a combination of LinkedIn portfolio and a UX research tool (Optimal Workshop/UserTesting). The visual language should communicate "verified, evidence-based" — clean, professional, with credential-like visual treatments for portfolio items.

**LAYOUT UPGRADE:**
- Header: "EXPERIENCE" with a badge/credential icon, subtitle emphasizing verification
- Portfolio tab: portfolio items as credential cards with DTU provenance chain visualized
- Research tab: clean research session cards with methodology tags
- Settings tab: keep minimal

**COMPONENT-LEVEL CHANGES:**
- Current plain portfolio cards → credential-style cards with verification badge and provenance chain
- Current tab navigation → clean professional tabs with subtle credential motif
- Current empty state → more prominent CTA with credential badge visual

**VISUAL UPGRADS:**
- Color: professional blue/navy palette with gold accents for verified credentials
- Portfolio items: seal/badge visual treatment with DTU hash displayed
- Typography: professional, resume-like hierarchy (name in large, role in medium, dates in small mono)
- Verification: green checkmark or seal icon on each portfolio item

**CAPABILITY PRESENTATION:**
- PORTFOLIO → currently plain cards → credential cards with verification badges
- RESEARCH → already well-structured → add methodology color tags
- ANALYSIS → ensure heatmaps and card-sort results render as real visualizations
- SETTINGS → keep minimal

**LENS IDENTITY:** Professional credential portfolio — verified, evidence-based, resume-quality. Distinct from `entity` (agent management) by being human-career-focused.

**RESPONSIVE DESIGN:**
- Desktop: full 5-tab layout
- Tablet: 3 primary tabs (Research/Portfolio/Methods), others in dropdown
- Mobile: simplified portfolio view with swipe between items

**BEFORE/AFTER:**
Before: Plain tabbed interface, generic cards, strong copy but weak visual treatment.
After: Professional credential portfolio with verification badges, DTU provenance chains, resume-quality typography.

**IMPLEMENTATION PLAN:**
1. Add verification badge/credential visual to portfolio items
2. Create DTU provenance chain visualization
3. Apply professional blue/navy palette with gold accents
4. Add methodology color tags to research sessions
5. Enhance empty portfolio state with credential badge visual

**PRIORITY:** P2
**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 7/10

---

## 9. expert-mode

**LENS:** expert-mode
**PURPOSE:** Perplexity-style expert search with cited answers, web search integration, focus mode selector (Academic/Writing/Math/Video), and threaded conversation.

**CURRENT DESIGN:**
- `LensVerticalHero` for large input field at top
- Threaded follow-up conversation below
- Focus mode selector (Academic/Writing/Math/Video)
- Sidebar with Pages, Spaces, file upload
- `BrainPoolStatus` for LLM health indicator
- Streaming response rendering with typing indicator

**WHAT WORKS VISUALLY:** The Perplexity-style layout is immediately recognizable and well-executed. The streaming response rendering is polished. The focus mode selector adds genuine utility.

**WHAT FEELS UNFINISHED:** Currently crashing (per audit). The sidebar could be more useful with recent searches or saved answers.

**DESIGN DIRECTION:**
This should feel like a **premium research assistant** — think Perplexity Pro meets Linear's clean interface. The visual language should communicate "intelligence" and "authority" — clean, spacious, with prominent source citations. The hero input should be the dominant visual element.

**LAYOUT UPGRADE:**
- Hero: full-width input field with focus mode selector inline
- Results: clean answer blocks with inline citation links
- Sidebar: recent searches + saved answers + file context
- Sources: visual source cards below each answer

**COMPONENT-LEVEL CHANGES:**
- Current basic input → larger hero input with subtle glow when focused
- Current citation links → source cards with favicon + title + snippet
- Current sidebar → recent + saved + context panel

**VISUAL UPGRADES:**
- Input field: large, centered, with a subtle border glow on focus
- Citations: inline superscript numbers linking to source cards below
- Source cards: favicon + domain + title + snippet, clickable
- Streaming: smooth word-by-word reveal with cursor animation

**CAPABILITY PRESENTATION:**
- SEARCH → already the hero → ensure citation quality is visible
- FOCUS MODES → ensure each mode has a distinct visual treatment
- THREADS → ensure thread continuity is visually clear

**LENS IDENTITY:** Premium research assistant — clean, authoritative, citation-forward. Distinct from `feed` (social) by being search-and-answer-focused.

**RESPONSIVE DESIGN:**
- Desktop: hero input + results + sidebar
- Tablet: hero input + results (sidebar collapsible)
- Mobile: full-width input + results, no sidebar

**BEFORE/AFTER:**
Before: Currently crashing — no functional assessment possible.
After: Clean Perplexity-style research surface with prominent citations and source cards.

**IMPLEMENTATION PLAN:**
1. Fix the render crash (functional prerequisite)
2. Create source card component for citations
3. Add focus mode visual treatment per mode
4. Enhance hero input with focus glow
5. Create recent searches / saved answers sidebar panel

**PRIORITY:** P0 (crash blocks all assessment)
**DESIGN SCORE:** N/A (crashed)
**UPGRADE POTENTIAL:** 8/10

---

## 10. export

**LENS:** export
**PURPOSE:** DTU export utility — JSON/CSV/Markdown/plain text export with package generation, validation, and diff.

**CURRENT DESIGN:**
- Three-panel layout: format gallery (left), export tools (center), vault export (right)
- `ConnectiveTissueBar` for cross-lens context
- `ExportFormatGallery`, `ExportToolkit`, `ObsidianVaultExport` bespoke components
- `framer-motion` transitions between formats
- Real export format options with card-based display
- Skeleton loading, empty state with Download icon

**WHAT WORKS VISUALLY:** The three-panel layout is clean and purposeful. The format cards are visually distinct. The Obsidian vault export is a genuinely unique feature. The `ConnectiveTissueBar` adds cross-lens composition context.

**WHAT FEELS UNFINISHED:** The vault export panel could be more visually integrated. The format cards are functional but not premium.

**DESIGN DIRECTION:**
This should feel like a **data portability console** — think macOS Finder export dialog meets a developer tool. The visual language should communicate "precise, reliable, complete" — monospace file format labels, size estimates, preview snippets.

**LAYOUT UPGRADE:**
- Keep the three-panel layout (it works)
- Format cards: add format icon (custom SVG for JSON/CSV/MD/TXT) and file extension badge
- Export tools: show preview of first few lines of export
- Vault export: integrate more visually as a "destination" panel

**COMPONENT-LEVEL CHANGES:**
- Current generic format cards → format cards with custom SVG file icons and extension badges
- Current export tools → add inline preview of export output
- Current vault export → style as a "destination" card with Obsidian icon

**VISUAL UPGRADES:**
- Custom SVG icons per format (JSON={...}, CSV=grid, MD=paragraph, TXT=lines)
- File extension badges: `.json`, `.csv`, `.md`, `.txt` in monospace
- Export preview: first 5 lines of output in a code block
- Size estimate: "≈ 2.3 MB" next to each format

**CAPABILITY PRESENTATION:**
- FORMAT SELECTION → already clear → add format-specific icons and previews
- VAULT EXPORT → currently right-panel → more visual integration as a destination
- EXPORT VALIDATION → keep, but add a "validation passed" green checkmark

**LENS IDENTITY:** Data portability console — precise, format-aware, developer-friendly. Distinct from `fork` (code divergence) by being data-export-focused.

**RESPONSIVE DESIGN:**
- Desktop: three-panel layout (format gallery / tools / vault)
- Tablet: two-panel (formats + tools), vault as modal
- Mobile: single-column format list with export button

**BEFORE/AFTER:**
Before: Clean three-panel layout with generic format cards.
After: Format cards with custom SVG icons, extension badges, export previews, and size estimates.

**IMPLEMENTATION PLAN:**
1. Create custom SVG icons for each export format
2. Add format extension badges (`.json`, `.csv`, etc.)
3. Add inline export preview (first 5 lines)
4. Add size estimate per format
5. Style vault export as a destination card

**PRIORITY:** P2
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 5/10

---

## 11. fashion

**LENS:** fashion
**PURPOSE:** Digital closet (Stylebook/Whering parity) with AI stylist, Met Museum costume archive integration, and feed.

**CURRENT DESIGN:**
- Two-column: closet section (left) and feed (right)
- `DensityToggle` for list/grid view switching
- Closet items with images, categories, tags
- External fashion feeds (Met Museum costume archive)
- AI Stylist tab with weather-aware outfit generation

**WHAT WORKS VISUALLY:** The density toggle is a nice UX touch. The AI Stylist with real weather integration is genuinely distinctive. The Met Museum costume archive adds cultural depth. The fashion-forward script-style logotype is noted in the audit.

**WHAT FEELS UNFINISHED:** The two-column layout could be more visually rich. Image cards need better treatment (hover effects, detail expansion).

**DESIGN DIRECTION:**
This should feel like a **premium fashion app** — think Whering or Stylebook with a Vogue editorial sensibility. The visual language should communicate "style" and "curation" — clean, image-forward, with editorial typography. Warm neutrals with fashion-forward accent colors.

**LAYOUT UPGRADE:**
- Keep the two-column layout but make image cards larger and more prominent
- Closet items: masonry grid layout with hover-to-reveal details
- AI Stylist: prominent hero card with weather visualization
- Feed: editorial card layout with large images

**COMPONENT-LEVEL CHANGES:**
- Current basic image cards → larger masonry grid cards with hover-to-reveal
- Current AI Stylist form → hero card with weather background
- Current feed cards → editorial image-forward cards

**VISUAL UPGRADES:**
- Typography: fashion-editorial (serif for titles, clean sans for details)
- Color: warm neutrals (cream, charcoal, muted rose)
- Image treatment: larger, full-bleed within cards, subtle shadow
- Tags: fashion-styled chips (rounded-full, thin borders)

**CAPABILITY PRESENTATION:**
- CLOSET → already image-rich → masonry grid with hover details
- AI STYLIST → already functional → hero card with weather visualization
- MET MUSEUM → already integrated → editorial browse layout

**LENS IDENTITY:** Premium fashion closet — editorial, image-forward, curated. Distinct from `gallery` (art) by being wardrobe-focused.

**RESPONSIVE DESIGN:**
- Desktop: two-column masonry grid + sidebar feed
- Tablet: single-column masonry with AI Stylist as a top card
- Mobile: full-width closet with bottom tab for AI Stylist

**BEFORE/AFTER:**
Before: Two-column layout with basic image cards, functional but not premium.
After: Masonry grid with editorial typography, weather-background AI Stylist hero, fashion-forward color palette.

**IMPLEMENTATION PLAN:**
1. Convert closet grid to masonry layout
2. Add hover-to-reveal detail on closet cards
3. Create AI Stylist hero card with weather background
4. Apply fashion-editorial typography (serif titles)
5. Apply warm-neutral color palette

**PRIORITY:** P2
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 6/10

---

## 12. federation

**LENS:** federation
**PURPOSE:** Federated peer manager — trust graph, peer discovery, sync, moderation, ActivityPub-style identity and actor keys.

**CURRENT DESIGN:**
- Four-tab interface (Network/Search/Peers/Sync)
- 12+ sub-panels (FediverseFeed, PeerPolicyPanel, ModerationQueuePanel, SyncPolicyPanel, etc.)
- Tab-based navigation with panel-per-tab
- Standard skeleton loading, empty states per tab
- Currently showing "Disabled" (honest — no peers configured)

**WHAT WORKS VISUALLY:** The tab breadth is genuinely impressive — 12+ sub-panels indicate deep functionality. The "Disabled" status is honest (not faked). The existing trust graph architecture is real.

**WHAT FEELS UNFINISHED:** The tab bar with 4 tabs but 12+ panels means some panels are nested deep. The "Disabled" state could be more visually informative about what federation would look like if enabled.

**DESIGN DIRECTION:**
This should feel like a **network operations center** — think a federation/peering dashboard for a decentralized system. The visual language should communicate "network" and "trust" — node-link diagrams, connection lines, trust scores. The visual identity should be distinct from `entity` (which is internal agents) by being external-peer-focused.

**LAYOUT UPGRADE:**
- Header: "FEDERATION" with a network/globe icon, peer count and sync status
- Network tab: visual trust graph (node-link diagram) as the hero element
- Peers tab: peer cards with trust scores, sync status, connection health
- Sync tab: sync timeline with data flow visualization
- Search tab: search input with results

**COMPONENT-LEVEL CHANGES:**
- Current tab bar → add peer count and sync status to header
- Current Network tab → visual trust graph as hero element
- Current Peers tab → peer cards with health indicators
- Current empty "Disabled" state → informative "Federation Ready" state with setup instructions

**VISUAL UPGRADES:**
- Network graph: node-link visualization with connection lines colored by trust level
- Trust scores: color-coded (green=high, amber=medium, red=low)
- Sync status: real-time data flow animation
- Peer cards: health indicators (green dot = connected, amber = syncing, red = error)

**CAPABILITY PRESENTATION:**
- TRUST GRAPH → currently empty → visual node-link diagram when peers exist
- PEERS → currently a list → health-indicator cards
- SYNC → currently a panel → data flow visualization
- MODERATION → keep as a panel within the relevant tab

**LENS IDENTITY:** Network operations center — peer-focused, trust-graph-visual, connection-health-aware. Distinct from `entity` (internal) and `social` (social graph) by being federation/peering-focused.

**RESPONSIVE DESIGN:**
- Desktop: full trust graph + peer sidebar
- Tablet: peer list with trust scores (graph deferred)
- Mobile: simplified peer list with status dots

**BEFORE/AFTER:**
Before: Generic tabbed panels with honest "Disabled" state.
After: Network operations center with trust graph visualization, peer health indicators, sync data flow animation.

**IMPLEMENTATION PLAN:**
1. Create trust graph visualization component (node-link diagram)
2. Add peer health indicators to peer cards
3. Create sync data flow visualization
4. Enhance "Disabled" state to "Federation Ready" with setup instructions
5. Add peer count and sync status to header

**PRIORITY:** P2
**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 7/10

---

## 13. feed

**LENS:** feed
**PURPOSE:** Social activity feed — HN/Twitter hybrid with real-time presence, inline social commerce, virtual scrolling, and post composer with vision analysis.

**CURRENT DESIGN:**
- Three-column: left sidebar (trending/bookmarks), main feed (virtuoso), right sidebar (search/trending/presence)
- `react-virtuoso` for virtualized infinite scroll
- `framer-motion` stagger on post entry
- Engagement bar with hover micro-interactions (scale-110, color transitions)
- `ProvenanceBadge` for DTU attribution
- `SocialCommerceTag` for inline commerce
- Real-time presence indicator
- Mobile responsive with `MobileTabBar`
- Day-streak indicator

**WHAT WORKS VISUALLY:** This is the most visually polished lens in the batch. The virtual scrolling, stagger animations, engagement micro-interactions, and three-column layout all feel premium. The social commerce integration and provenance badges are genuinely distinctive.

**WHAT FEELS UNFINISHED:** The left sidebar could use better visual hierarchy. The post composer area could be more prominent.

**DESIGN DIRECTION:**
This should feel like a **premium social platform** — the best of Twitter's timeline, Reddit's community, and Substack's reading experience. The visual language is already close to correct — just needs polish on hierarchy and density.

**LAYOUT UPGRADE:**
- Already well-designed — minor polish only
- Composer: make the "Analyze with Vision" button more visually prominent
- Left sidebar: add visual hierarchy (trending topics as numbered list, not flat list)
- Right sidebar: presence indicator could be more prominent

**COMPONENT-LEVEL CHANGES:**
- Current trending list → numbered list with rank badges
- Current composer → slightly larger with more prominent Vision button
- Current presence → avatar stack instead of just a count

**VISUAL UPGRADES:**
- Trending: numbered rank badges (1, 2, 3...) with fire icon for top 3
- Composer: subtle border glow when focused
- Presence: avatar stack with green online dots
- Engagement bar: keep existing micro-interactions (they're good)

**CAPABILITY PRESENTATION:**
- FEED → already excellent → minor hierarchy improvements
- COMPOSER → already functional → more prominent Vision button
- TRENDING → already present → numbered rank badges
- PRESENCE → already present → avatar stack treatment

**LENS IDENTITY:** Premium social platform — timeline-forward, engagement-rich, commerce-integrated. This IS the platform's social surface and should feel like one.

**RESPONSIVE DESIGN:**
- Already handles mobile with MobileTabBar — no major changes needed
- Desktop: three-column (already correct)
- Tablet: two-column (collapse left sidebar)

**BEFORE/AFTER:**
Before: Already well-designed with minor hierarchy gaps.
After: Numbered trending ranks, more prominent Vision button, avatar presence stack.

**IMPLEMENTATION PLAN:**
1. Add numbered rank badges to trending list
2. Make Vision Analyze button more prominent in composer
3. Add avatar stack to presence indicator
4. Add subtle glow to focused composer input

**PRIORITY:** P3
**DESIGN SCORE:** 8/10
**UPGRADE POTENTIAL:** 3/10

---

## 14. film-studios

**LENS:** film-studios
**PURPOSE:** StudioBinder + Resolve + Frame.io parity — film production management with production actions, watch parties, and analytics.

**CURRENT DESIGN:**
- Five-tab interface (Discover/My Films/Create/Analytics/Watch Parties)
- Real production actions (Breakdown/Schedule Shoot/Cast Analysis/Post Timeline)
- UniversalPlayer for video preview
- 893-line page with inline state management
- `framer-motion` AnimatePresence for modals
- Keyboard shortcuts (d/f/c/w/a/n)
- LiveIndicator, DTUExportButton, RealtimeDataPanel
- 7 generic scaffolds (RecentMineCard, AutoActionStrip, CrossLensRecentsPanel, FirstRunTour, DepthBadge, ManifestActionBar, RealtimeDataPanel)

**WHAT WORKS VISUALLY:** The keyboard shortcuts are excellent and domain-appropriate (Letterboxd/FCP idiom). The production actions are genuinely deep. The five-tab structure maps to real production workflows.

**WHAT FEELS UNFINISHED:** The false-Disconnected pill is a known bug. The visual treatment is generic despite the deep functionality. The page has too many generic scaffolds (7).

**DESIGN DIRECTION:**
This should feel like a **professional film production suite** — think StudioBinder meets Final Cut Pro's dark UI. The visual language should communicate "production" — dark surfaces, clapperboard motifs, timeline visualizations. A cinematic purple/neon accent is already present but underutilized.

**LAYOUT UPGRADE:**
- Header: "FILM STUDIOS" with custom clapperboard SVG, production status
- Tab bar: keep 5 tabs but with film-reel/production icons
- My Films: film cards with poster-style thumbnails and status badges
- Production Actions: action cards with crew-role icons and progress bars
- Remove 3+ generic scaffolds (AutoActionStrip, RecentMineCard, CrossLensRecentsPanel)

**COMPONENT-LEVEL CHANGES:**
- Current generic scaffold footer → remove
- Current plain tab icons → film-reel/production-themed icons
- Current text-heavy action results → visual result cards with progress bars
- Current Disconnected pill → fix (functional prerequisite)

**VISUAL UPGRADES:**
- Color: dark cinematic palette (near-black, deep purple accents, neon highlights)
- Typography: film-credit-style headers (uppercase, tracked-out)
- Film cards: poster-style with gradient overlay
- Production timeline: horizontal timeline with crew assignment nodes

**CAPABILITY PRESENTATION:**
- PRODUCTION ACTIONS → currently text results → visual result cards with crew icons and progress
- WATCH PARTIES → ensure this reads as a real social viewing feature
- ANALYTICS → ensure production metrics are visualized, not just listed

**LENS IDENTITY:** Professional film production suite — cinematic, dark, production-focused. Distinct from `creative` (general) and `events` (logistics) by being film/production-specific.

**RESPONSIVE DESIGN:**
- Desktop: full tab bar + wide panels
- Tablet: tab bar with fewer visible tabs, wider panels
- Mobile: bottom tab bar, single-column

**BEFORE/AFTER:**
Before: Generic tabbed interface with 7 scaffolds, false Disconnected pill, text-heavy action results.
After: Cinematic dark UI with film-reel icons, production timeline, visual action results, removed generic scaffolds.

**IMPLEMENTATION PLAN:**
1. Fix false-Disconnected pill (functional prerequisite)
2. Remove AutoActionStrip, RecentMineCard, CrossLensRecentsPanel
3. Create film-reel/production-themed tab icons
4. Create visual action result cards with crew icons
5. Apply dark cinematic color palette
6. Add production timeline visualization

**PRIORITY:** P1
**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 7/10

---

## 15. finance

**LENS:** finance
**PURPOSE:** Bloomberg Terminal parity — 8-tab financial management with Overview/Positions/Cash-flow/Accounts/Planning/Bills & Budget/Macro data/Assistant.

**CURRENT DESIGN:**
- 8 tabs with discoverable single-key shortcut chips
- Dense KPI strip: Net Worth/Cash/Investments/Buying Power/Budget Used/Accounts
- Market Monitor panel with honest "Market feed offline" message
- Net-Worth Trajectory panel with honest "No snapshots yet" message
- 25+ bespoke components (FinanceParityPanel, MarketMonitor, etc.)
- `font-mono`, `text-[11px]`, `tabular-nums` throughout
- Keyboard shortcuts: 1-8 tabs, r refresh, s snapshot
- Honest-by-construction design (explicit comments about not fabricating data)
- Zero generic scaffolds (AutoActionStrip, RecentMineCard, CrossLensRecentsPanel all retired)

**WHAT WORKS VISUALLY:** This is the platform's best-designed lens. The Bloomberg Terminal aesthetic is immediately recognizable and appropriate. The monospace figures, dense KPI strip, and honest zero-state copy ("Nothing here is simulated") are all excellent. Zero generic scaffolds is a major achievement.

**WHAT FEELS UNFINISHED:** The Market Monitor is offline (honest, but the gap between "honest offline" and "live data" is the real T2). The Net-Worth Trajectory needs first snapshot to be useful.

**DESIGN DIRECTION:**
This IS the reference design for what a lens should look like. Bloomberg Terminal aesthetic is correct. No major direction changes — just maintain and extend the existing identity.

**LAYOUT UPGRADE:**
- Already well-designed — maintain current layout
- Market Monitor: when live data exists, ensure real-time ticker-style updates
- Net-Worth Trajectory: add first-snapshot CTA that's more prominent
- Keep the dense KPI strip (it's the signature visual element)

**COMPONENT-LEVEL CHANGES:**
- Current honest-offline Market Monitor → keep honest messaging, add "Connect feed" CTA
- Current Net-Worth Trajectory → add prominent "Record your first snapshot" CTA with estimated time
- No scaffold removal needed (already clean)

**VISUAL UPGRADES:**
- Already has the strongest visual identity in the platform — minor polish only
- Ensure tabular-nums is on ALL numeric displays
- KPI strip: add subtle animation when values change

**CAPABILITY PRESENTATION:**
- Already well-presented — this is the reference for other lenses
- MARKET MONITOR → honest offline state is correct; add "Connect feed" CTA
- NET-WORTH → add prominent first-snapshot CTA
- PLANNING → ensure calculator/simulator is visually prominent

**LENS IDENTITY:** Bloomberg Terminal — monospace, dense, data-forward, honest. This IS the financial identity and should remain unchanged.

**RESPONSIVE DESIGN:**
- Desktop: full 8-tab layout with KPI strip
- Tablet: KPI strip + 4 primary tabs, others in dropdown
- Mobile: KPI strip + scrollable tab bar

**BEFORE/AFTER:**
Before: Already excellent — Bloomberg Terminal aesthetic, honest zero-states, zero scaffolds.
After: Minor polish — tabular-nums consistency, KPI animation, first-snapshot CTA.

**IMPLEMENTATION PLAN:**
1. Add prominent "Record first snapshot" CTA to Net-Worth Trajectory
2. Add "Connect market feed" CTA to Market Monitor
3. Ensure tabular-nums on all numeric displays
4. Add subtle value-change animation to KPI strip

**PRIORITY:** P3
**DESIGN SCORE:** 9/10
**UPGRADE POTENTIAL:** 2/10

---

## 16. fishing

**LENS:** fishing
**PURPOSE:** Fishing minigame — casting, reeling, species catalog across River/Lake/Ocean/Swamp biomes with catch log.

**CURRENT DESIGN:**
- Cast line button, species catalog (8 species), catch log
- Biome selector (River/Lake/Ocean/Swamp)
- Honest "0 catches logged" empty state
- Real species-catalog data with behavioral tags (dart/leap/pull/thrash)
- `ds` design-system tokens used
- Fixed CSRF bug (commit `c8bd64118`)

**WHAT WORKS VISUALLY:** The species catalog with behavioral tags is charming and domain-appropriate. The biome selector adds genuine variety. The honest empty state is correct.

**WHAT FEELS UNFINISHED:** The cast/reel interface is basic — just a button. The catch log needs visual treatment. The species cards could be more visually rich.

**DESIGN DIRECTION:**
This should feel like a **charming fishing app** — think Fishbrain or a relaxing nature game. The visual language should communicate "outdoors" and "nature" — earthy tones, water motifs, a calming palette. The species cards should feel like field-guide entries.

**LAYOUT UPGRADE:**
- Header: "FISHING" with a fish/water icon, catch count as hero metric
- Cast area: visual water surface with cast animation
- Species catalog: field-guide-style cards with behavioral tags as visual badges
- Catch log: timeline of catches with species illustrations

**COMPONENT-LEVEL CHANGES:**
- Current basic cast button → visual water surface with cast animation
- Current species list → field-guide-style cards with illustrations
- Current catch log → timeline with species images
- Current biome selector → visual biome cards (water color per biome)

**VISUAL UPGRADES:**
- Color: earthy aquatic palette (deep blue water, green river, sandy lake, murky swamp)
- Species cards: field-guide style with illustration placeholder, behavioral tag badges
- Cast animation: ripple effect on cast
- Catch log: timeline with species thumbnails

**CAPABILITY PRESENTATION:**
- CASTING → currently a button → visual water surface interaction
- SPECIES CATALOG → currently a list → field-guide-style cards
- CATCH LOG → currently text → visual timeline with species images
- BIOME SELECTOR → currently text buttons → visual biome cards

**LENS IDENTITY:** Charming nature app — aquatic palette, field-guide species, relaxing visual language. Distinct from `fitness` (active) by being leisure/nature-focused.

**RESPONSIVE DESIGN:**
- Desktop: cast area + species catalog side-by-side
- Tablet: cast area full-width, catalog below
- Mobile: full-width cast, species as swipeable cards

**BEFORE/AFTER:**
Before: Basic button interface, text species list, plain catch log.
After: Visual water surface, field-guide species cards, timeline catch log, aquatic color palette.

**IMPLEMENTATION PLAN:**
1. Create visual cast area with water surface and ripple animation
2. Convert species catalog to field-guide-style cards
3. Create visual catch timeline with species thumbnails
4. Convert biome selector to visual biome cards
5. Apply aquatic color palette

**PRIORITY:** P2
**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 7/10

---

## 17. fitness

**LENS:** fitness
**PURPOSE:** Strava + Garmin Connect parity — Training Hub with activities, GPS/heatmap, training, segments, goals/gear, wearables, plus Fitness & Wellness client management.

**CURRENT DESIGN:**
- 11 tabs (Clients/Programs/Workouts/Classes/Teams/Recruiting/Log/HRZones/Recovery/Activity/AIPlan)
- 9 bespoke components (FitnessFeed, RoutesPanel, FitnessStravaSection, WorkoutLogger, HeartRateZones, SleepRecovery, ActivityRings, WorkoutPlanner, WorkoutFinishPanel)
- 10 generic scaffolds (DraftedTextarea, RecentMineCard, AutoActionStrip, CrossLensRecentsPanel, FirstRunTour, DepthBadge, LensFeedButton, LiveIndicator, DTUExportButton, RealtimeDataPanel, LiveFeed)
- 2141-line page with extensive inline state and types
- Keyboard shortcuts (1-0, -)
- Honest "Not medical advice" disclaimer
- `ds` design-system tokens used

**WHAT WORKS VISUALLY:** The Training Hub with Strava parity is genuinely deep. The Activity Rings component is a good visual element. The 11-tab breadth covers real fitness use cases.

**WHAT FEELS UNFINISHED:** The page is 2141 lines — bloated with inline types and state. 10 generic scaffolds dilute the identity. The Training Hub and Fitness & Wellness panels are visually disconnected (one above the other). The Disconnected pill on the lower panel is a known bug.

**DESIGN DIRECTION:**
This should feel like a **premium fitness app** — think Strava meets Apple Fitness. The visual language should communicate "active" and "energy" — bold colors, activity rings, progress curves. The Training Hub and Fitness & Wellness should be visually unified.

**LAYOUT UPGRADE:**
- Header: "FITNESS" with activity rings icon, today's activity summary
- Top strip: Activity Rings (already a component) as the hero visual
- Tab bar: reduce from 11 to 6 primary (Hub/Training/Log/Wearables/Goals/Coaching), nest others
- Remove 5+ generic scaffolds
- Unify Training Hub and Fitness & Wellness into a single visual surface

**COMPONENT-LEVEL CHANGES:**
- Current 11-tab bar → 6 primary tabs with sub-navigation
- Current 10 generic scaffolds → remove AutoActionStrip, RecentMineCard, CrossLensRecentsPanel, FirstRunTour, DepthBadge (at minimum)
- Current text-heavy Training Hub → activity rings hero + summary cards
- Current disconnected Fitness & Wellness → integrate as a "Coaching" tab

**VISUAL UPGRADES:**
- Color: energetic palette (red/orange activity colors, dark background)
- Activity Rings: make the hero visual element at top
- Typography: bold, active-feeling (larger numbers, more whitespace)
- Progress: circular progress indicators for goals, not just bars

**CAPABILITY PRESENTATION:**
- ACTIVITY RINGS → currently a component → make the hero visual at top
- TRAINING → currently a tab → ensure workout cards are visual, not text
- HEART RATE ZONES → ensure zone visualization is a real chart
- SLEEP → ensure sleep data is visualized as a hypnogram

**LENS IDENTITY:** Premium fitness app — energetic, ring-focused, activity-forward. Distinct from `healthcare` (clinical) by being performance/lifestyle-focused.

**RESPONSIVE DESIGN:**
- Desktop: full tab bar + activity rings hero + panels
- Tablet: tab bar with fewer tabs, activity rings
- Mobile: activity rings at top, scrollable tab content

**BEFORE/AFTER:**
Before: 2141-line bloated page, 10 generic scaffolds, disconnected panels, generic appearance.
After: Activity rings hero, 6 primary tabs, removed generic scaffolds, energetic color palette, unified coaching surface.

**IMPLEMENTATION PLAN:**
1. Fix false-Disconnected pill (functional prerequisite)
2. Make Activity Rings the hero visual at top
3. Reduce tabs from 11 to 6 primary
4. Remove 5+ generic scaffolds
5. Integrate Fitness & Wellness as "Coaching" tab
6. Apply energetic color palette

**PRIORITY:** P1
**DESIGN SCORE:** 4/10
**UPGRADE POTENTIAL:** 8/10

---

## 18. food

**LENS:** food
**PURPOSE:** Restaurant ops + cooking — recipes, meal planning, shopping, nutrition, pantry, menu engineering, inventory, bookings, batches, shifts, cook mode, plate scan, recipe import/scaler.

**CURRENT DESIGN:**
- 16 tabs (recipes/mealplan/shopping/nutrition/pantry/menu/inventory/bookings/batches/shifts/cookmode/platescan/planner/pantry2/import/scaler)
- 13 bespoke components (FoodYelpSection, OpenFoodFactsSearch, BreweryPanel, UsdaFoodSearch, FoodActionPanel, FoodParityPanel, CookMode, PantryTracker, PlateScan, MealPlanner, RecipeImporter, RecipeScaler)
- 11 generic scaffolds
- 2921-line page — the largest in the batch
- USDA/Brewery "REAL data" badges
- MobileTabBar for mobile
- Currently crashing from USDA search field

**WHAT WORKS VISUALLY:** The USDA/Brewery "REAL data" badges are a strong honest-sourcing pattern. The 16-tab breadth is genuinely impressive. The cook mode and plate scan are distinctive features.

**WHAT FEELS UNFINISHED:** The page is 2921 lines — bloated. 11 generic scaffolds dilute identity. Currently crashing. 16 tabs is overwhelming. The visual treatment is generic despite the deep functionality.

**DESIGN DIRECTION:**
This should feel like a **premium restaurant management system** — think Toast POS meets a professional kitchen display. The visual language should communicate "kitchen energy" — warm tones, bold status indicators, efficient information density. The chef-hat icon and warm amber accent should be the visual anchor.

**LAYOUT UPGRADE:**
- Header: "FOOD" with chef-hat icon, today's special or next reservation as hero
- Reduce from 16 to 6-8 primary tabs (Recipes/Kitchen/Service/Planning/Data/Tools)
- Kitchen tab: floor plan with table status indicators (a la Toast POS)
- Recipes tab: visual recipe cards with ingredient photos
- Remove 5+ generic scaffolds

**COMPONENT-LEVEL CHANGES:**
- Current 16-tab bar → 6-8 primary tabs with sub-navigation
- Current 11 generic scaffolds → remove at minimum AutoActionStrip, RecentMineCard, CrossLensRecentsPanel
- Current text-heavy tabs → visual cards with status indicators
- Current crash state → fix (functional prerequisite)

**VISUAL UPGRADES:**
- Color: warm kitchen palette (amber, warm white, rich red for "86'd")
- Status: 86'd items in red, available in green, seasonal in amber
- Recipe cards: image-forward with prep/cook time badges
- Floor plan: visual table layout with status colors

**CAPABILITY PRESENTATION:**
- RECIPES → currently a tab → visual recipe cards with photos
- KIN FLOOR PLAN → currently tabs → visual table layout with status
- COOK MODE → ensure it reads as a real kitchen timer/display
- PLATE SCAN → ensure camera integration is prominent
- USDSA/BREWERY → already honest-sourced → keep badges prominent

**LENS IDENTITY:** Premium restaurant management — warm, kitchen-energy, status-aware, visually dense. Distinct from `cooking` (simpler recipe tool) by being full restaurant operations.

**RESPONSIVE DESIGN:**
- Desktop: full tab bar + wide panels
- Tablet: primary tabs + visual floor plan
- Mobile: bottom tab bar (already has MobileTabBar), simplified views

**BEFORE/AFTER:**
Before: 2921-line bloated page, 16 tabs, 11 scaffolds, crashing, generic appearance.
After: 6-8 primary tabs, visual floor plan, recipe cards with photos, warm kitchen palette, removed scaffolds.

**IMPLEMENTATION PLAN:**
1. Fix USDA search crash (functional prerequisite)
2. Reduce tabs from 16 to 6-8 primary
3. Remove 5+ generic scaffolds
4. Create visual table floor plan for Kitchen tab
5. Create visual recipe cards with photos
6. Apply warm kitchen color palette

**PRIORITY:** P0 (crash blocks all assessment)
**DESIGN SCORE:** 4/10 (inflated by breadth, deflated by bloat + crash)
**UPGRADE POTENTIAL:** 8/10

---

## 19. forecast

**LENS:** forecast
**PURPOSE:** Dual-substrate forecast — in-world "Tomorrow in Concordia" (forward-sim + drift + faction strategy) alongside real-world Open-Meteo weather.

**CURRENT DESIGN:**
- 7 tabs (24h/Multi-day/Hourly/Per-district/Accuracy/Archive/Alerts)
- Dual-axis confidence/temp chart
- Real-world Open-Meteo integration with live temperature
- In-world forecast composed from Layer 10/11/7 engines
- Keyboard shortcuts (1-7, c compose, r refresh)
- World ID input field
- Clean `max-w-3xl mx-auto` centered layout

**WHAT WORKS VISUALLY:** The dual-substrate concept is genuinely brilliant and unique. The dual-axis chart is a legitimate data visualization. The keyboard shortcuts are excellent. The centered layout is clean and focused.

**WHAT FEELS UNFINISHED:** The in-world 24h panel is stuck loading (per audit). The visual treatment is minimal — the "Tomorrow in Concordia" panel and the Open-Meteo panel share the same card chrome, making it hard to distinguish which is which.

**DESIGN DIRECTION:**
This should feel like a **weather station** — clean, data-focused, with two distinct visual zones: the "real world" weather and the "Concordia world" forecast. The visual language should communicate "atmosphere" and "prediction" — weather-appropriate color gradients, confidence visualizations.

**LAYOUT UPGRADE:**
- Keep the centered layout (correct for a focused tool)
- Distinct visual treatment for "Real World" (blue/weather) vs "Concordia" (amber/mystical) panels
- 24h panel: weather-icon-driven forecast with temperature as the hero number
- Multi-day: keep the dual-axis chart (it's good)

**COMPONENT-LEVEL CHANGES:**
- Current identical card chrome → distinct visual zones for real-world vs Concordia
- Current stuck 24h panel → fix fetch (functional prerequisite)
- Current world ID input → styled more like a location selector

**VISUAL UPGRADES:**
- Real-world panel: blue gradient background, weather icons, temperature in large font
- Concordia panel: amber/mystical gradient, faction strategy icons, drift indicators
- Confidence: visual confidence bars (not just numbers)
- Temperature: large hero number with °C/°F toggle

**CAPABILITY PRESENTATION:**
- 24H FORECAST → stuck loading → fix, then make weather-icon-driven hero
- MULTI-DAY → already good → keep dual-axis chart
- ALERTS → ensure alert subscriptions are visually clear
- COMPOSE → keep keyboard shortcut

**LENS IDENTITY:** Dual weather station — real-world meets fantasy-world forecasting. Distinct from `eco` (environmental metrics) by being prediction/atmosphere-focused.

**RESPONSIVE DESIGN:**
- Already centered layout, works at all sizes
- Desktop: full-width dual panels side by side
- Tablet: stacked dual panels
- Mobile: stacked with swipe between real-world and Concordia

**BEFORE/AFTER:**
Before: Same-card-chrome for both worlds, stuck 24h panel, minimal visual treatment.
After: Distinct real-world (blue) vs Concordia (amber) panels, weather icons, large temperature hero, visual confidence bars.

**IMPLEMENTATION PLAN:**
1. Fix stuck 24h panel fetch (functional prerequisite)
2. Create distinct visual zones for real-world vs Concordia panels
3. Add weather icon treatment to 24h panel
4. Make temperature the hero number
5. Add visual confidence bars

**PRIORITY:** P1
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 7/10

---

## 20. forestry

**LENS:** forestry
**PURPOSE:** Professional forestry tool — timber stands, harvest planning, fire management, growth & yield, pests, carbon credits, with InciWeb wildfire feed and USDA calculators.

**CURRENT DESIGN:**
- 7 tabs (Stands/Calculators/Fire Watch/Growth & Inventory/Pests & Replanting/Carbon Credits/Map & Wildlife)
- 10 bespoke sub-components
- InciWeb wildfire feed with working "Pull feed" action
- USDA workbench calculator with real species/weather inputs
- False Disconnected pill (known bug)
- `ds` design-system tokens

**WHAT WORKS VISUALLY:** The forestry-green identity is noted. The USDA/INCIWEB sourcing badges are a good honest-sourcing pattern. The workbench calculator is a genuine professional tool.

**WHAT FEELS UNFINISHED:** The Disconnected pill is a known bug. The bell/alert icon is less fitting than a tree-ring or canopy SVG would be. The tab bar treatment is generic.

**DESIGN DIRECTION:**
This should feel like a **professional forestry management tool** — think FVS (Forest Vegetation Simulator) meets a modern data tool. The visual language should communicate "nature management" — earthy greens, tree-ring motifs, topographic elements.

**LAYOUT UPGRADE:**
- Header: "FORESTRY" with tree-ring or canopy SVG icon
- Fire Watch tab: real-time wildfire map as hero element
- Stands: stand cards with species composition as mini pie charts
- Calculators: already good workbench — keep it
- Carbon Credits: carbon total as hero metric

**COMPONENT-LEVEL CHANGES:**
- Current generic bell icon → tree-ring or canopy SVG
- Current Disconnected pill → fix (functional prerequisite)
- Current tab bar → forestry-themed icons
- Current InciWeb feed → more prominent during fire season

**VISUAL UPGRADES:**
- Color: earthy forest palette (deep greens, browns, amber for fire warnings)
- Fire Watch: red/orange fire risk indicators
- Stands: mini pie charts showing species composition
- Carbon: large hero number with trend arrow

**CAPABILITY PRESENTATION:**
- FIRE WATCH → make the real-time wildfire map the hero element
- STANDS → visual stand cards with species composition
- CALCULATORS → already well-presented, keep workbench style
- CARBON → hero metric with trend

**LENS IDENTITY:** Professional forestry management — earthy, nature-oriented, fire-aware, data-dense. Distinct from `eco` (environmental metrics) by being timber/fire/forestry-specific.

**RESPONSIVE DESIGN:**
- Desktop: full tab bar + wide panels
- Tablet: primary tabs + map
- Mobile: Fire Watch as primary, other tabs in menu

**BEFORE/AFTER:**
Before: Generic tab bar, false Disconnected pill, standard card chrome.
After: Tree-ring SVG icon, earthy green palette, fire risk indicators, species composition charts.

**IMPLEMENTATION PLAN:**
1. Fix false-Disconnected pill (functional prerequisite)
2. Replace bell icon with tree-ring/canopy SVG
3. Apply earthy forest color palette
4. Add species composition mini-charts to stand cards
5. Make Fire Watch the prominent tab with fire risk indicators

**PRIORITY:** P2
**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 6/10

---

## 21. forge

**LENS:** forge
**PURPOSE:** Polyglot single-file app generator — the platform's own Forge Studio for building apps from Concord's systems.

**CURRENT DESIGN:**
- Thin orchestrator page (130 lines)
- Delegates to `FoundryWorldsPanel`, `FoundryCanvas` (dynamic import), `WorldBuilderRepos`, `BuilderStudio`
- `LensVerticalHero` with Boxes icon and "Beta" badge
- Sky/slate color palette
- Footer scaffold stack (RecentMineCard, AutoActionStrip, CrossLensRecentsPanel)

**WHAT WORKS VISUALLY:** The thin orchestrator pattern is architecturally correct. The sky/slate palette is distinct. The "Beta" badge is honest. The delegation to deep bespoke components is the right approach.

**WHAT FEELS UNFINISHED:** The page-level chrome is minimal — the real work is in child components. The macro name bug is now fixed but the visual treatment of the forge studio itself needs assessment (child component, not this page).

**DESIGN DIRECTION:**
This should feel like an **IDE/generator** — think Replit or a code playground. The visual language should communicate "creation" and "building" — code-editor dark theme, file-tree motifs, preview panels. The sky/slate palette is already a good fit.

**LAYOUT UPGRADE:**
- Keep the thin orchestrator pattern (it's correct)
- Ensure FoundryCanvas has a real IDE-like chrome (file tree + editor + preview)
- Remove footer scaffold stack (the canvas IS the interaction)

**COMPONENT-LEVEL CHANGES:**
- Current footer scaffolds → remove
- Current basic hero → keep but add a "recently built" strip
- FoundryCanvas → ensure IDE-like chrome (file tree, editor, preview)

**VISUAL UPGRADES:**
- Sky/slate palette is already correct for an IDE tool
- Canvas: dark editor chrome with syntax-highlighted code
- Preview: live preview panel alongside editor

**CAPABILITY PRESENTATION:**
- CANVAS → ensure IDE-like chrome with file tree + editor + preview
- WORLDS → ensure world list shows built-world thumbnails
- REPOS → keep GitHub integration

**LENS IDENTITY:** IDE/generator — code-focused, creation-oriented, dark editor chrome. Distinct from `code` (general coding) by being app-generation-focused.

**RESPONSIVE DESIGN:**
- Desktop: full IDE layout
- Tablet: editor + preview toggle
- Mobile: simplified builder with form inputs

**BEFORE/AFTER:**
Before: Thin orchestrator with minimal chrome, footer scaffolds.
After: Thin orchestrator with IDE-like canvas, removed footer scaffolds, "recently built" strip.

**IMPLEMENTATION PLAN:**
1. Remove footer scaffold stack
2. Ensure FoundryCanvas has IDE-like chrome
3. Add "recently built" strip below hero
4. Add world thumbnails to FoundryWorldsPanel

**PRIORITY:** P2
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 5/10

---

## 22. fork

**LENS:** fork
**PURPOSE:** Fork lens — visualize entity forks and workspace lineages with 3-way text diff, real Levenshtein divergence, and conflict regions.

**CURRENT DESIGN:**
- Tree/List toggle for visualization
- Divergence stat cards (files/conflicts/A-modified/B-modified)
- Real Levenshtein-based conflict detection
- Example loader with real base/Fork-A/Fork-B code snippets
- Clean, technical layout

**WHAT WORKS VISUALLY:** The divergence stat cards are clear and informative. The Tree/List toggle is a good UX choice. The real Levenshtein compute is confirmed working. The technical, code-oriented layout is appropriate.

**WHAT FEELS UNFINISHED:** The stat cards are plain — could use color coding for conflict severity. The diff visualization is text-based — a real side-by-side diff viewer would be stronger.

**DESIGN DIRECTION:**
This should feel like a **code diff tool** — think GitHub's diff view or VS Code's merge editor. The visual language should communicate "comparison" and "convergence" — side-by-side panels, color-coded diffs, connection lines between diverged points.

**LAYOUT UPGRADE:**
- Header: "FORK" with branch/diverge icon, divergence stats
- Main area: split-pane diff view (Fork A vs Fork B) with base reference
- Stats bar: divergence metrics with color-coded severity
- Tree view: node-link diagram showing fork lineage

**COMPONENT-LEVEL CHANGES:**
- Current stat cards → color-coded divergence severity (green=clean, amber=modified, red=conflict)
- Current text diff → side-by-side split-pane diff
- Current tree view → node-link diagram with connection lines

**VISUAL UPGRADS:**
- Diff: side-by-side panels with inline diff highlighting (green=added, red=removed, amber=modified)
- Conflicts: red-highlighted conflict regions with resolution UI
- Tree: node-link diagram with fork points and merge arrows
- Stats: color-coded severity badges

**CAPABILITY PRESENTATION:**
- DIFF VIEW → currently text → side-by-side split-pane
- CONFLICTS → currently text → red-highlighted with resolution UI
- TREE → currently toggle → node-link diagram
- STATS → currently plain → color-coded severity

**LENS IDENTITY:** Code diff tool — technical, precise, comparison-focused. Distinct from `code` (general coding) by being specifically for fork/divergence analysis.

**RESPONSIVE DESIGN:**
- Desktop: split-pane diff with tree sidebar
- Tablet: toggle between diff and tree view
- Mobile: simplified diff with conflict indicators

**BEFORE/AFTER:**
Before: Text diff with plain stat cards, basic tree toggle.
After: Side-by-side split-pane diff, color-coded conflict severity, node-link fork diagram.

**IMPLEMENTATION PLAN:**
1. Create side-by-side split-pane diff component
2. Add color-coded conflict severity to stat cards
3. Create node-link fork diagram for tree view
4. Add inline diff highlighting (green/red/amber)

**PRIORITY:** P2
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 7/10

---

## 23. forum

**LENS:** forum
**PURPOSE:** Discourse + Reddit parity — community forum with topics, communities, trending, inbox, categories, moderation, profile, threaded comments, voting, awards, flair.

**CURRENT DESIGN:**
- 1282-line page — fully bespoke Reddit/Forum clone
- Two-column layout: main feed + 320px sidebar
- Three view modes (feed/detail/profile) with animated transitions
- Sticky header with search, sort bar (Hot/New/Top/Rising)
- Post cards with vote column, flair badges, tag pills, comment counts, mod tools
- Recursive threaded comments (depth 3) with color-coded borders
- Community info sidebar with rules, community list
- Four modals (Create Post, Create Community, Give Award, Share)
- `framer-motion` animations throughout
- ForumChatter, ForumActionPanel, PostInsightsPanel bespoke components
- Community Analytics with 4 action buttons

**WHAT WORKS VISUALLY:** This is genuinely one of the most feature-complete lenses in the platform. The voting system, threaded comments, community CRUD, flair system, award system, and moderation tools are all real. The warm orange/amber accent is distinctive. The post card design is clean.

**WHAT FEELS UNFINISHED:** The footer scaffold stack (SessionRail, RecentMineCard, AutoActionStrip, CrossLensRecentsPanel) is present but the rest of the lens is so bespoke that these feel redundant. The 1282 lines could benefit from extraction into child components.

**DESIGN DIRECTION:**
This should feel like **Reddit meets Discourse** — the visual language is already correct (warm orange accent, card-based posts, vote column). Just needs polish, not a direction change.

**LAYOUT UPGRADE:**
- Already well-designed — maintain current layout
- Remove redundant footer scaffolds (the lens is fully bespoke)
- Consider extracting the analytics section into a collapsible sidebar panel
- Post cards could benefit from subtle hover elevation

**COMPONENT-LEVEL CHANGES:**
- Current footer scaffolds → remove (redundant with bespoke content)
- Current post cards → add subtle hover elevation
- Current analytics → collapsible sidebar panel

**VISUAL UPGRADES:**
- Post cards: subtle shadow on hover
- Vote column: larger, more prominent vote buttons
- Comments: slightly tighter spacing for better density
- Community sidebar: add community icons/avatars

**CAPABILITY PRESENTATION:**
- Already well-presented — this is one of the most complete lenses
- VOTING → already prominent → make vote buttons slightly larger
- COMMENTS → already threaded → tighten spacing
- ANALYTICS → make collapsible sidebar panel
- MODERATION → already present → keep mod tools accessible

**LENS IDENTITY:** Community forum — warm, social, discussion-focused. Distinct from `feed` (social timeline) by being discussion/thread-focused.

**RESPONSIVE DESIGN:**
- Already handles responsive with sidebar collapse
- Desktop: two-column (main + sidebar)
- Tablet: single-column with sidebar toggle
- Mobile: simplified post list

**BEFORE/AFTER:**
Before: Already well-designed with redundant footer scaffolds.
After: Removed scaffolds, subtle post hover effects, slightly larger vote buttons.

**IMPLEMENTATION PLAN:**
1. Remove footer scaffold stack
2. Add subtle hover elevation to post cards
3. Make vote buttons slightly larger
4. Make analytics section collapsible

**PRIORITY:** P3
**DESIGN SCORE:** 8/10
**UPGRADE POTENTIAL:** 3/10

---

## 24. foundry

**LENS:** foundry
**PURPOSE:** Build games from Concord's systems — compose terrain, NPCs, combat, economies into persistent cross-world games. No code, no infrastructure.

**CURRENT DESIGN:**
- 130-line thin orchestrator
- Delegates to `FoundryWorldsPanel`, `FoundryCanvas` (dynamic import), `WorldBuilderRepos`, `BuilderStudio`
- `LensVerticalHero` with Boxes icon and "Beta" badge
- Sky/slate color palette (consistent with forge)
- Footer scaffold stack
- Known bug: "Create world" fails under load with `service_overloaded`

**WHAT WORKS VISUALLY:** The thin orchestrator pattern is correct. The sky/slate palette distinguishes it from other lenses. The delegation to deep components is architecturally sound.

**WHAT FEELS UNFINISHED:** The "Create world" failure under load needs a retry/queue UX. The page-level chrome is minimal. The footer scaffolds are redundant with the deep child components.

**DESIGN DIRECTION:**
This should feel like a **game builder** — think Roblox Studio or Minecraft server admin. The visual language should communicate "creation" and "world-building" — terrain previews, hexagonal grid motifs, creative-tool chrome.

**LAYOUT UPGRADE:**
- Keep thin orchestrator (correct)
- Add world thumbnails/previews in FoundryWorldsPanel
- Add "Create world" queue/retry UX
- Remove footer scaffolds

**COMPONENT-LEVEL CHANGES:**
- Current footer scaffolds → remove
- Current basic world list → world cards with terrain thumbnails
- Current "Create world" button → queue/retry UX for LLM-bound operations

**VISUAL UPGRADES:**
- World cards: terrain preview thumbnails (procedural mini-maps)
- Create world: progress indicator with queue position
- Builder: IDE-like chrome (same as forge)

**CAPABILITY PRESENTATION:**
- WORLD LIST → basic → cards with terrain thumbnails
- CREATE WORLD → fails under load → queue/retry UX
- CANVAS → ensure real drag-drop builder with preview
- BUILDER STUDIO → ensure visual scripting is functional

**LENS IDENTITY:** Game builder — creative, world-building, terrain-focused. Distinct from `forge` (app generation) by being game/world-focused.

**RESPONSIVE DESIGN:**
- Desktop: full IDE layout with canvas
- Tablet: canvas with simplified controls
- Mobile: world list + basic controls

**BEFORE/AFTER:**
Before: Thin orchestrator, basic world list, failing Create world, footer scaffolds.
After: World cards with terrain thumbnails, queue/retry UX, removed scaffolds.

**IMPLEMENTATION PLAN:**
1. Add queue/retry UX for "Create world" (functional prerequisite)
2. Create world cards with terrain preview thumbnails
3. Remove footer scaffold stack
4. Ensure canvas has real drag-drop builder chrome

**PRIORITY:** P1 (Create world failure blocks primary use case)
**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 7/10

---

## 25. fractal

**LENS:** fractal
**PURPOSE:** SIM_GRADE_A fractal renderer — Mandelbrot/Julia/Burning-Ship/Tricorn/Multibrot, 3D Mandelbulb, orbit inspection, deep-zoom animation.

**CURRENT DESIGN:**
- 88-line thin orchestrator
- Delegates to `FractalRenderer` (the real component) and `FractalRepos`
- Uses `ds` design-system tokens
- Purple gradient icon for Sparkles
- `data-lens-theme="fractal"` attribute
- LiveIndicator, DTUExportButton, RealtimeDataPanel

**WHAT WORKS VISUALLY:** This is one of the cleanest pages in the codebase — 88 lines, pure delegation, uses design-system tokens. The purple gradient icon is distinctive. The fractal rendering is genuinely impressive (confirmed real WebGL render).

**WHAT FEELS UNFINISHED:** The page-level chrome is minimal — all visual interest comes from the FractalRenderer component. The two stray "Unable to connect" toasts from background fetches are noise.

**DESIGN DIRECTION:**
The fractal renderer IS the visual identity. The page should get out of its way — dark background, minimal chrome, the fractal as the full-screen hero. Think a creative tool's canvas mode.

**LAYOUT UPGRADE:**
- Already correct — thin orchestrator delegating to the renderer
- Suppress background fetch toasts that aren't related to the render
- The FractalRenderer should be full-bleed (if not already)

**COMPONENT-LEVEL CHANGES:**
- Current stray toasts → suppress non-render-related error toasts
- Current page chrome → minimal, let the renderer dominate

**VISUAL UPGRADES:**
- Already has correct visual treatment (the render IS the visual)
- Ensure renderer is full-bleed canvas
- Dark background (already correct)

**CAPABILITY PRESENTATION:**
- RENDERER → already the hero → ensure full-bleed
- PRESETS → when populated, surface as saved-views gallery
- EXPORT → keep PNG export functional

**LENS IDENTITY:** Creative fractal canvas — minimal chrome, full-bleed render, dark background. Distinct from `art` (static art) by being procedural/generative.

**RESPONSIVE DESIGN:**
- Full-bleed canvas at all sizes
- Controls overlay on hover/tap
- Mobile: simplified parameter controls

**BEFORE/AFTER:**
Before: Already clean — 88-line orchestrator with stray background toasts.
After: Suppress stray toasts, ensure full-bleed render.

**IMPLEMENTATION PLAN:**
1. Suppress non-render-related error toasts
2. Ensure FractalRenderer is full-bleed
3. Add controls overlay on hover (if not already present)

**PRIORITY:** P3
**DESIGN SCORE:** 8/10
**UPGRADE POTENTIAL:** 3/10

---

## 26. frontier

**LENS:** frontier
**PURPOSE:** Jupyter-notebook-shaped scientific compute suite — 10 engine panels (Degradation/FSI/Safety Envelope/QEC/Model Checker/Consensus/Equilibrium/Const-Time/Paillier/Spiking Net) with single-key shortcuts.

**CURRENT DESIGN:**
- 116-line thin orchestrator (cleanest in the batch)
- `FrontierEngineShell` provides Jupyter-like notebook chrome + tab strip
- 10 engine-specific panels + `UnbuiltEnginePanel` for unbuilt engines
- Digit-key shortcuts (1-9/0) with explicit shortcut legend
- Honest unbuilt state (no fabricated data)
- Uses `ds` design-system tokens
- Real compute confirmed (Paris-crack-growth fatigue, FEA solver)

**WHAT WORKS VISUALLY:** This is the architecturally cleanest page in the entire batch. The JupyterLab reference is correct and well-executed. The digit-key shortcuts with explicit legend are excellent UX. The "Honest boundary" epistemic notes are the platform's best example of honest-by-construction design.

**WHAT FEELS UNFINISHED:** Nothing significant — the page is functionally and visually excellent. The thin orchestrator pattern is correct.

**DESIGN DIRECTION:**
This IS the reference for what a scientific compute tool should look like. JupyterLab aesthetic is correct. The notebook-cell chrome (In [1]: Compute / tabular results / cited Note) is the right visual language. No direction changes needed.

**LAYOUT UPGRADE:**
- Already correct — maintain JupyterLab aesthetic
- The keyboard shortcut legend is excellent — keep it
- The honest boundary disclosures are the best feature — make them more visually prominent

**COMPONENT-LEVEL CHANGES:**
- No changes needed at page level — the shell and panels handle everything
- Consider: more prominent visual treatment for "Honest boundary" notes (currently just italic text)

**VISUAL UPGRADES:**
- Honest boundary notes: add a subtle background color or border to make them visually distinct from regular content
- Engine tabs: add a status indicator (built ✓ / unbuilt ○)

**CAPABILITY PRESENTATION:**
- Already excellently presented — this is a reference lens
- COMPUTE → already correct with notebook-cell format
- HONEST BOUNDARY → make more visually prominent
- KEYBOARD SHORTCUTS → already excellent with explicit legend

**LENS IDENTITY:** JupyterLab for engineering — notebook-cell chrome, honest boundaries, keyboard-first, compute-focused. Distinct from `code` (general coding) by being scientific/engineering compute.

**RESPONSIVE DESIGN:**
- Already correct at all sizes (shell handles responsive)

**BEFORE/AFTER:**
Before: Already excellent — cleanest architecture, honest boundaries, keyboard-first.
After: Minor polish — more prominent honest boundary visual treatment.

**IMPLEMENTATION PLAN:**
1. Add subtle background/border to honest boundary notes
2. Add status indicator (✓/○) to engine tabs

**PRIORITY:** P3
**DESIGN SCORE:** 9/10
**UPGRADE POTENTIAL:** 1/10

---

## 27. gallery

**LENS:** gallery
**PURPOSE:** Multi-museum browsing, deep-zoom, curated exhibits, visual search, virtual rooms, with real MET Museum + Cleveland Museum CC0 integrations and procedural DTU sigil art.

**CURRENT DESIGN:**
- 295-line page with 8 tabs (Browse/For You/Visual Search/Deep Zoom/Compare/Artists/Exhibits/Virtual Rooms)
- 11 bespoke components (MetMuseumPanel, CmaBrowser, SavedCollections, GalleryActionPanel, DeepZoomViewer, VisualSearch, CuratedExhibits, ArtworkCompare, ArtistPage, VirtualRooms, Recommendations)
- Inline SVG `SigilSvg` component — procedurally generated shapes from DTU compression seeds
- PipingProvider for cross-lens citation
- Proper loading/error/empty states
- Amber tab accent color

**WHAT WORKS VISUALLY:** The 8-tab breadth with real museum APIs is genuinely impressive. The inline SigilSvg is creative and distinctive. The Met Museum CC0 and Cleveland Museum integrations are real. The proper loading/error/empty states are excellent.

**WHAT FEELS UNFINISHED:** The RecentMineCard/AutoActionStrip/CrossLensRecentsPanel footer stack is the standard generic pattern and feels out of place in a gallery context. The Browse tab could be more image-forward.

**DESIGN DIRECTION:**
This should feel like a **museum gallery** — think Google Arts & Culture meets a museum's own website. The visual language should be image-forward, with generous whitespace, elegant typography, and minimal chrome. The amber accent is a good fit for a gallery context.

**LAYOUT UPGRADE:**
- Keep the 8 tabs (they map to real features)
- Browse tab: masonry grid layout for museum results (Cleveland already does this)
- Remove footer scaffold stack
- Sigil gallery: larger cards with more prominent procedural SVG

**COMPONENT-LEVEL CHANGES:**
- Current footer scaffolds → remove
- Current tab bar → keep amber accent
- Current museum panels → ensure masonry/image-forward layout
- Current Sigil gallery → larger, more prominent

**VISUAL UPGRADS:**
- Museum results: masonry grid with image-forward cards
- Sigil cards: larger with more detail (tier, element, date)
- Typography: elegant, gallery-appropriate (lighter weight, more whitespace)
- Tab accent: keep amber (it's a good gallery color)

**CAPABILITY PRESENTATION:**
- MUSEUM BROWSE → ensure masonry layout for both MET and Cleveland
- SIGIL GALLERY → make more prominent (it's unique to Concord)
- VISUAL SEARCH → ensure the search input is prominent
- DEEP ZOOM → ensure the viewer is full-bleed

**LENS IDENTITY:** Museum gallery — image-forward, elegant, curated. Distinct from `fashion` (wardrobe) and `art` (creation) by being about browsing and appreciating existing art.

**RESPONSIVE DESIGN:**
- Desktop: masonry grid with tabs
- Tablet: single-column masonry
- Mobile: swipeable image cards

**BEFORE/AFTER:**
Before: Well-designed with generic footer scaffolds, standard card layout.
After: Masonry image-forward layout, removed scaffolds, larger sigil cards, gallery-appropriate typography.

**IMPLEMENTATION PLAN:**
1. Remove footer scaffold stack
2. Ensure masonry layout for museum results
3. Make Sigil gallery cards larger and more prominent
4. Apply gallery-appropriate typography (lighter weight, more whitespace)

**PRIORITY:** P2
**DESIGN SCORE:** 7/10
**UPGRADE POTENTIAL:** 5/10

---

## SUMMARY RANKING

| Priority | Lenses | Count |
|----------|--------|-------|
| **P0** | expert-mode (crash), food (crash) | 2 |
| **P1** | entity, environment, event-timeline, events, finance (maintenance), film-studios, fitness, forecast, foundry | 9 |
| **P2** | ethics, expedition-journal, experience, federation, fishing, forestry, forge, fork, gallery | 9 |
| **P3** | error.tsx, feed, finance, fractal, forum, frontier | 6 |

### Design Score Distribution

| Score | Lenses |
|-------|--------|
| **9/10** | finance, frontier |
| **8/10** | feed, fractal, forum, gallery |
| **7/10** | error.tsx |
| **6/10** | environment, events, expedition-journal, ethics, export, experience, fashion, federation, finance (polish), forge, forecast, fork, forestry |
| **5/10** | entity, event-timeline, fishing, fitness, foundry, food |
| **4/10** | fitness, food |
| **N/A** | expert-mode (crashed) |

### Top Upgrade Opportunities (by potential score)

1. **entity** — 5→8 (+3) — systems control panel transformation
2. **environment** — 6→8 (+2) — enterprise compliance dashboard
3. **event-timeline** — 5→8 (+3) — living history scroll
4. **fitness** — 4→8 (+4) — premium fitness app (largest gain)
5. **food** — 4→8 (+4) — premium restaurant management (largest gain)
6. **film-studios** — 5→7 (+2) — cinematic production suite
7. **foundry** — 5→7 (+2) — game builder with terrain previews
8. **forecast** — 6→7 (+1) — dual weather station

### Key Findings

1. **Two P0 crashes block assessment:** `expert-mode` and `food` are currently non-functional. These must be fixed before design work can begin.

2. **Finance and Frontier are the gold standards:** Both score 9/10 and demonstrate what a well-designed Concord lens looks like. Finance shows how to build a distinctive domain identity (Bloomberg Terminal); Frontier shows how to build an architecturally clean compute surface (JupyterLab). Both should be cited as reference exemplars.

3. **Generic scaffold trinity persists:** AutoActionStrip + RecentMineCard + CrossLensRecentsPanel appears on 17 of 27 lenses in this batch. Finance and Fishing have fully retired it. Forum and Frontier don't use it at all. The remaining lenses should evaluate whether these scaffolds add value or dilute identity.

4. **The bloat-to-delegation ratio is the strongest predictor of design quality:** Frontier (116 lines, full delegation, 9/10), Finance (771 lines, 25+ bespoke, 9/10), and Forum (1282 lines, fully bespoke, 8/10) all score high. Food (2921 lines, 11 scaffolds, 4/10) and Fitness (2141 lines, 10 scaffolds, 4/10) score lowest. The pattern is clear: delegate to deep components, retire generic scaffolds, keep the page thin.

5. **Honest-by-construction design IS the strongest visual identity signal:** Finance's "Nothing here is simulated" and Frontier's "Honest boundary" disclosures aren't just ethically correct — they're the most distinctive visual elements in their respective lenses. Other lenses should find their own honest-by-construction visual treatments rather than copying a color palette.

6. **Domain-specific iconography matters more than color:** The audit consistently notes that custom SVG icons (gallery's SigilSvg, finance's monospace KPIs, frontier's notebook cells) create more visual distinction than any color palette change. Every P1 lens should invest in 1-2 custom domain-specific visual elements.
