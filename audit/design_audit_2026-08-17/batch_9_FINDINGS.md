# Batch 9 Design Audit — 27 Lenses (saved → temporal)

**Scope:** Per-lens design audit and upgrade blueprint. Each lens evaluated independently.
**Constraint:** No shared component proposals, no cross-lens refactors, no "extract to a primitive" patterns.
**Priority system:** P0 = redesign immediately, P1 = major visual upgrade, P2 = polish, P3 = already strong.
**Output format:** Implementation-ready detail for a coding worker.

---

## 1. saved

**PURPOSE:** Cross-lens bookmarks and saved items browser with folders, tags, search, and export.

**CURRENT DESIGN:** Three-column layout: folders sidebar (left), saved items grid (center), item detail panel (right). Uses SavedItemCard, FoldersSidebar, SaveItemForm. Top bar has search input, filter dropdown, export button. Items show source lens, title, excerpt, tags, saved date. Dark theme with zinc/slate neutrals. No domain-specific visual identity.

**DESIGN DIRECTION:** Figma-style bookmark manager. Treat saved items as first-class knowledge artifacts, not a generic list. The saved lens is where cross-lens value crystallizes — every save is a user-curated knowledge graph node.

**LAYOUT UPGRADE:**
- Replace flat grid with a spatial card layout: source lens badge top-left, title as primary, excerpt as muted secondary, tags as colored chips bottom
- Folder sidebar should use collapsible tree with nested folders, drag-to-reorder
- Right detail panel: full DTU preview with source lens icon, citation chain, and "related saved" section
- Add a "source lens" filter bar above the grid (pill chips for each lens that has saved items)

**COMPONENT-LEVEL CHANGES:**
- SavedItemCard: add source lens icon/badge (not just text), hover state with quick actions (open, move, delete, share)
- FoldersSidebar: tree view with indent levels, folder item count, drag handle, context menu
- SaveItemForm: auto-suggest tags from existing tag pool, show source lens preview
- Search: real-time filter with debounce, highlight matched text in results
- Export: show format options (JSON, Markdown, plain text) before export

**VISUAL UPGRADES:**
- Source lens gets a colored accent pill (e.g., code = green, music = purple, finance = gold)
- Saved items show a subtle gradient border matching their source lens color
- Empty state: "Nothing saved yet — browse lenses and save items that matter"
- Tag chips use distinct pastel colors derived from tag name hash
- Folder tree uses indentation lines (like VS Code explorer)

**CAPABILITY PRESENTATION:**
- Surface "recently saved" prominently at top (last 5 items, horizontal scroll)
- Show total saved count and per-lens breakdown as stat tiles
- Export button should show format picker dropdown, not trigger immediately

**LENS IDENTITY:** "Knowledge vault" — the place where cross-lens curation happens. Visual language: organized, personal, curated. Think Figma bookmarks meets Notion database.

**RESPONSIVE DESIGN:**
- Mobile: collapse to single-column list with swipe actions (archive, move, delete)
- Tablet: two-column (list + detail)
- Desktop: full three-column

**BEFORE/AFTER CONCEPT:**
- BEFORE: Generic card grid with minimal visual hierarchy, no source lens differentiation
- AFTER: Spatial card layout with source-colored accents, tree folder navigation, real-time search with highlighting, rich DTU preview panel

**IMPLEMENTATION PLAN:**
1. Add source lens color mapping utility
2. Redesign SavedItemCard with badge, gradient border, hover actions
3. Replace FoldersSidebar with tree-view component
4. Add source filter pill bar
5. Build real-time search with highlight
6. Add export format picker
7. Mobile responsive pass

**PRIORITY:** P1 — major visual upgrade needed, core cross-lens value surface

**DESIGN SCORE:** 4/10 — functional but visually flat, no domain identity

**UPGRADE POTENTIAL:** 8/10 — high-impact, straightforward implementation

---

## 2. schema

**PURPOSE:** Schema workbench for data modeling, repository management, and realtime schema data.

**CURRENT DESIGN:** Vertical hero layout with "Schema Workbench" title, repository browser, realtime data panel. Uses LensShell, ManifestActionBar, AutoActionStrip, RecentMineCard, CrossLensRecentsPanel, RealtimeDataPanel, LiveIndicator, DTUExportButton. Purple/cyan accents on dark. Schema cards show name, version, field count, last modified.

**DESIGN DIRECTION:** Database IDE — think Prisma Studio or Hasura Console. Schema is a technical tool; treat it like one. The hero layout is wrong for a workbench — flatten it.

**LAYOUT UPGRADE:**
- Replace hero with persistent toolbar: repo selector dropdown, schema version toggle, sync status indicator, export button
- Main area: split view — schema tree (left 30%), field editor (right 70%)
- Bottom panel: query/preview console (collapsible)
- Remove CrossLensRecentsPanel (irrelevant for schema work)

**COMPONENT-LEVEL CHANGES:**
- SchemaCard: add field type icons (string = 📝, number = #, boolean = ✓, reference = 🔗), version badge, diff indicator
- SchemaTree: collapsible tree with type-colored nodes, search within schema
- FieldEditor: inline type picker, constraint toggles (required, unique, indexed), description textarea
- QueryConsole: syntax-highlighted input, result table, execution time display

**VISUAL UPGRADES:**
- Type colors: string = blue, number = green, boolean = amber, reference = purple, array = cyan, object = rose
- Schema tree uses indentation with connecting lines
- Version diff: show added/removed/changed fields with green/red highlighting
- Sync status: animated pulse when live, static dot when offline

**CAPABILITY PRESENTATION:**
- Surface "schema health" as a stat bar (fields count, validation errors, coverage %)
- Show recent schema changes as a timeline in the detail panel
- Quick actions: create field, create index, validate schema, export

**LENS IDENTITY:** "Data architect" — precise, technical, organized. Visual language: monospace fonts, type colors, tree structures. Think Prisma Studio meets VS Code schema viewer.

**RESPONSIVE DESIGN:**
- Mobile: stacked layout (schema list → tap to edit field)
- Tablet: two-column (tree + editor)
- Desktop: full three-panel workbench

**BEFORE/AFTER CONCEPT:**
- BEFORE: Hero title + card grid + action strip, generic dashboard feel
- AFTER: Persistent toolbar + split-pane workbench + collapsible console, IDE-like precision

**IMPLEMENTATION PLAN:**
1. Flatten hero into toolbar
2. Build SchemaTree component
3. Build FieldEditor with type picker
4. Add type color mapping utility
5. Build QueryConsole panel
6. Remove CrossLensRecentsPanel
7. Add version diff view
8. Mobile responsive pass

**PRIORITY:** P1 — needs structural redesign from dashboard to workbench

**DESIGN SCORE:** 5/10 — has custom components but wrong layout paradigm

**UPGRADE POTENTIAL:** 7/10 — clear reference apps (Prisma, Hasura) to guide design

---

## 3. science

**PURPOSE:** Scientific research workbench with experiments, arxiv integration, action panels, and piping.

**CURRENT DESIGN:** Complex lens with experiments list, arxiv search, action panels. Uses LensShell, ManifestActionBar, LiveIndicator, DTUExportButton, RealtimeDataPanel, PipingProvider. Framer-motion animations. Multi-section layout with experiment cards, arxiv results, action buttons. Blue/cyan scientific accents.

**DESIGN DIRECTION:** Lab notebook meets arxiv browser. Think Zotero + Obsidian research vault. The experiment tracking is the core value — arxiv is the input, experiments are the output.

**LAYOUT UPGRADE:**
- Three-tab layout: Experiments (active research), Arxiv (input discovery), Pipeline (DTU flow)
- Experiments tab: kanban-style columns (Planning → In Progress → Analyzing → Published)
- Arxiv tab: search + filter sidebar + results list with abstract preview
- Pipeline tab: visual DTU flow from input → analysis → output → citation

**COMPONENT-LEVEL CHANGES:**
- ExperimentCard: status badge (planning/active/complete), hypothesis preview, linked papers count, last activity timestamp
- ArxivResult: title, authors, abstract excerpt, relevance score, "add to experiment" button
- ActionPanel: quick actions (new experiment, import paper, run analysis, export results)
- PipelineView: connected nodes showing DTU flow with arrows

**VISUAL UPGRADES:**
- Experiment status colors: planning = slate, active = emerald, analyzing = amber, published = purple
- Arxiv results: paper-type badges (journal = gold, conference = silver, preprint = gray)
- Action buttons: use domain-appropriate icons (flask for experiments, search for arxiv, flowchart for pipeline)
- Animated transitions between tabs using framer-motion

**CAPABILITY PRESENTATION:**
- Surface "active experiments" count as primary stat
- Show "papers added this week" as secondary stat
- Pipeline health indicator (connected vs disconnected nodes)
- Quick actions: "New Experiment", "Search Arxiv", "Import Paper"

**LENS IDENTITY:** "Research lab" — organized, methodical, evidence-based. Visual language: lab notebook aesthetic, clean grids, status badges. Think Zotero meets Linear project board.

**RESPONSIVE DESIGN:**
- Mobile: stacked tabs, experiment cards as list items
- Tablet: two-column layout
- Desktop: full kanban + sidebar

**BEFORE/AFTER CONCEPT:**
- BEFORE: Mixed sections with action panels, unclear hierarchy
- AFTER: Clean tabbed workbench with kanban experiment tracking and integrated arxiv browser

**IMPLEMENTATION PLAN:**
1. Restructure into 3 tabs (Experiments, Arxiv, Pipeline)
2. Build ExperimentCard with status badges
3. Build ArxivResult with relevance scoring
4. Build kanban column layout for experiments
5. Add arxiv search with filter sidebar
6. Build PipelineView with connected nodes
7. Add stat tiles (active experiments, papers added)
8. Mobile responsive pass

**PRIORITY:** P1 — complex lens needs better organization and visual hierarchy

**DESIGN SCORE:** 5/10 — has depth but poor visual organization

**UPGRADE POTENTIAL:** 8/10 — clear design direction (lab notebook) with strong reference apps

---

## 4. security

**PURPOSE:** Threat and vulnerability management, SOC console, security advisories.

**CURRENT DESIGN:** Threat/vuln management with security advisories panel. Uses LensShell, ManifestActionBar. Dark theme with red/orange security accents. Threat cards show severity, status, affected systems. Advisories panel shows published advisories.

**DESIGN DIRECTION:** CrowdStrike/VirusTotal-style threat console. Security is high-stakes — the UI must convey urgency and precision. Every pixel should feel authoritative.

**LAYOUT UPGRADE:**
- Three-panel layout: Threat feed (left, scrollable), Threat detail (center), Action panel (right)
- Top bar: threat count by severity (critical/high/medium/low), filter by status, time range selector
- Bottom panel: activity log (recent actions taken)
- Remove generic action strip — security actions need dedicated UI (block, quarantine, investigate, escalate)

**COMPONENT-LEVEL CHANGES:**
- ThreatCard: severity color coding (critical = red pulse, high = orange, medium = yellow, low = blue), affected asset list, first/last seen timestamps
- ThreatDetail: timeline of events, affected systems graph, recommended actions, linked advisories
- AdvisoryCard: CVE badges, affected versions, fix version, publish date
- ActionPanel: contextual actions based on threat status (new → investigate, investigating → block/quarantine, resolved → close)

**VISUAL UPGRADES:**
- Severity colors: critical = red with subtle pulse animation, high = orange, medium = amber, low = slate
- Threat feed: real-time feel with timestamp-relative display ("2m ago", "1h ago")
- Status badges: investigating = spinning icon, blocked = shield icon, resolved = checkmark
- Activity log: chronological timeline with action icons
- Empty state: "No threats detected — all systems nominal" with green shield

**CAPABILITY PRESENTATION:**
- Surface "threats this week" as primary stat with trend arrow
- Show "mean time to resolution" as secondary stat
- Quick actions: "Block IP", "Quarantine Host", "Run Scan", "Escalate"
- Threat severity distribution as a mini bar chart

**LENS IDENTITY:** "Security operations center" — authoritative, precise, urgent. Visual language: dark theme with severity-coded accents, real-time timestamps, shield/lock iconography. Think CrowdStrike Falcon meets VirusTotal.

**RESPONSIVE DESIGN:**
- Mobile: stacked cards with swipe actions (investigate, block, resolve)
- Tablet: two-column (list + detail)
- Desktop: full three-panel SOC layout

**BEFORE/AFTER CONCEPT:**
- BEFORE: Generic card list with basic severity badges
- AFTER: Authoritative threat console with severity-pulse animations, timeline detail, contextual actions

**IMPLEMENTATION PLAN:**
1. Build severity color system with pulse animation
2. Redesign ThreatCard with timestamps and status icons
3. Build ThreatDetail with event timeline
4. Add contextual ActionPanel
5. Build AdvisoryCard with CVE badges
6. Add threat count stat bar
7. Build activity log panel
8. Mobile responsive pass

**PRIORITY:** P0 — security lens must convey authority and urgency, current design is too casual

**DESIGN SCORE:** 3/10 — functional but lacks the authoritative feel security demands

**UPGRADE POTENTIAL:** 9/10 — clear reference (CrowdStrike), high impact on perceived platform security

---

## 5. self

**PURPOSE:** Quantified-self dashboard with trends, correlations, goals, streaks, digest, and import.

**CURRENT DESIGN:** Overview tiles at top, then tabbed views (trends, correlations, goals, streaks, digest, import). Uses LensShell, ManifestActionBar. Dark theme with multi-color accent tiles. Stat tiles show key metrics. Tabs provide different data views.

**DESIGN DIRECTION:** Apple Health meets Exist.io — personal analytics that feel insightful, not clinical. The overview tiles are the right idea; refine them into a proper dashboard.

**LAYOUT UPGRADE:**
- Persistent dashboard header: 6 stat tiles (sleep, activity, mood, productivity, health, social) with trend arrows
- Tab bar below: Trends, Correlations, Goals, Streaks, Digest, Import
- Trends tab: line charts with time range selector
- Correlations tab: scatter plots with correlation coefficient display
- Goals tab: progress bars with milestone markers
- Streaks tab: calendar heatmap visualization

**COMPONENT-LEVEL CHANGES:**
- StatTile: sparkline mini-chart inside tile, trend arrow (up/down/flat), percentage change
- TrendChart: time range selector (7d, 30d, 90d, 1y), data point hover tooltip
- CorrelationCard: scatter plot preview, r-value display, "strong/weak" label
- GoalCard: progress bar with milestones, days remaining, projected completion date
- StreakCalendar: GitHub-style contribution heatmap

**VISUAL UPGRADES:**
- Stat tiles: subtle gradient backgrounds matching category (sleep = indigo, activity = green, mood = amber, etc.)
- Trend charts: smooth curves with gradient fill under line
- Correlation cards: color-coded by strength (strong = emerald, moderate = amber, weak = slate)
- Streak calendar: heat intensity from light to dark based on activity level

**CAPABILITY PRESENTATION:**
- Surface "today's summary" as primary view (what happened today, compared to average)
- Show "weekly trend" sparklines in each stat tile
- Quick actions: "Log Activity", "Set Goal", "Import Data", "Share Report"

**LENS IDENTITY:** "Personal analytics" — insightful, motivating, personal. Visual language: health-app aesthetics, gradient tiles, sparkline charts. Think Apple Health meets Strava.

**RESPONSIVE DESIGN:**
- Mobile: stacked stat tiles, tabbed content below
- Tablet: 2x3 stat tile grid, full chart width
- Desktop: 6-column stat tile row, side-by-side charts

**BEFORE/AFTER CONCEPT:**
- BEFORE: Flat stat tiles with basic numbers
- AFTER: Sparkline-embedded tiles with trend arrows, proper chart visualizations, calendar heatmaps

**IMPLEMENTATION PLAN:**
1. Add sparkline component for stat tiles
2. Add trend arrow indicators
3. Build TrendChart with time range selector
4. Build CorrelationCard with scatter plot
5. Build GoalCard with progress bar
6. Build StreakCalendar heatmap
7. Add "today's summary" header section
8. Mobile responsive pass

**PRIORITY:** P1 — needs visual refinement to match health-app quality bar

**DESIGN SCORE:** 5/10 — has the right structure but lacks visual polish

**UPGRADE POTENTIAL:** 8/10 — clear reference apps (Apple Health, Exist.io) with achievable improvements

---

## 6. sentinel

**PURPOSE:** Security threat console (CrowdStrike analog) with shield, triage, monitors, metrics, rules, and semantic tabs.

**CURRENT DESIGN:** 6-tab security console: Shield (overview), Triage (queue), Monitors (watches), Metrics (analytics), Rules (policies), Semantic (analysis). Uses LensShell, ManifestActionBar. Dark theme with red/orange security accents. Each tab has dedicated panel.

**DESIGN DIRECTION:** Already CrowdStrike-shaped — refine the visual authority. The 6-tab structure is correct; the execution needs to feel more like a real SOC tool.

**LAYOUT UPGRADE:**
- Persistent header: Shield status indicator (green/yellow/red), threat count, last scan time
- Tab bar: icon + label for each tab, active tab has colored underline
- Shield tab: 4 stat cards (threats blocked, active monitors, rules triggered, semantic findings) + recent activity feed
- Triage tab: sortable table with severity, status, assigned, age columns
- Monitors tab: grid of monitor cards with status indicators

**COMPONENT-LEVEL CHANGES:**
- ShieldStatus: large circular indicator with color (green = all clear, yellow = attention, red = active threats)
- ThreatTable: sortable columns, row hover highlight, bulk action checkbox
- MonitorCard: status dot (active/paused/error), last check timestamp, trigger count
- MetricChart: line/bar charts with time range, threshold lines
- RuleCard: rule name, conditions summary, action taken count, enabled toggle
- SemanticPanel: AI-generated threat summary with confidence score

**VISUAL UPGRADES:**
- Shield status: animated pulse when red, smooth gradient transition between states
- Tab icons: shield, list, eye, chart, cog, brain — consistent stroke style
- Table rows: alternating subtle background for readability
- Metric charts: area fill with gradient, threshold lines in dashed red

**CAPABILITY PRESENTATION:**
- Surface "threats blocked today" as primary stat on Shield tab
- Show "mean time to triage" on Metrics tab
- Quick actions: "Run Scan", "Create Rule", "Add Monitor", "Export Report"

**LENS IDENTITY:** "Threat intelligence" — already strong. Refine toward more authoritative typography and tighter spacing. Think CrowdStrike Falcon dashboard.

**RESPONSIVE DESIGN:**
- Mobile: tabs become horizontal scroll, tables become card lists
- Tablet: two-column on Shield tab
- Desktop: full dashboard layout

**BEFORE/AFTER CONCEPT:**
- BEFORE: Functional 6-tab console with basic styling
- AFTER: Authoritative SOC console with shield status indicator, sortable tables, metric charts, semantic AI summary

**IMPLEMENTATION PLAN:**
1. Build ShieldStatus circular indicator
2. Add tab icons and colored underline
3. Redesign ThreatTable with sorting and bulk actions
4. Build MonitorCard grid
5. Add MetricChart with threshold lines
6. Build SemanticPanel with AI summary
7. Add stat cards to Shield tab
8. Mobile responsive pass

**PRIORITY:** P2 — already has correct structure, needs visual polish not redesign

**DESIGN SCORE:** 6/10 — correct architecture, needs authority refinement

**UPGRADE POTENTIAL:** 6/10 — incremental improvements, not structural changes

---

## 7. services

**PURPOSE:** Service and subscription management with feed, revenue/retention analytics.

**CURRENT DESIGN:** Service feed with subscription cards, revenue/retention panel. Uses LensShell, ManifestActionBar, AutoActionStrip, RecentMineCard, CrossLensRecentsPanel. Dark theme with neutral accents. Service cards show name, status, billing cycle, cost.

**DESIGN DIRECTION:** Stripe Dashboard meets subscription tracker. Services are financial instruments — the UI should convey precision and trustworthiness.

**LAYOUT UPGRADE:**
- Dashboard header: total monthly cost, active services count, upcoming renewals, savings opportunities
- Two-column layout: Service list (left 60%), Analytics panel (right 40%)
- Service list: sortable by cost, status, renewal date; filter by category
- Analytics panel: cost trend chart, category breakdown pie, retention risk indicators

**COMPONENT-LEVEL CHANGES:**
- ServiceCard: logo/icon, name, cost, billing cycle, next renewal date, status badge (active/paused/cancelled)
- CostTrendChart: monthly cost over time with comparison to previous period
- CategoryBreakdown: pie/donut chart with category colors
- RenewalCalendar: upcoming renewals in calendar view
- SavingsCard: detected savings (unused services, cheaper alternatives)

**VISUAL UPGRADES:**
- Cost display: large bold number with currency symbol, monthly/annual toggle
- Status badges: active = emerald, paused = amber, cancelled = slate, trial = purple
- Category colors: entertainment = purple, productivity = blue, utilities = green, finance = gold
- Savings opportunities: highlighted in amber with "Save $X/mo" callout

**CAPABILITY PRESENTATION:**
- Surface "total monthly spend" as hero stat
- Show "upcoming renewals this week" as urgent card
- Quick actions: "Add Service", "Cancel Service", "Find Savings", "Export Report"

**LENS IDENTITY:** "Financial precision" — clean, trustworthy, data-driven. Think Stripe Dashboard meets Truebill.

**RESPONSIVE DESIGN:**
- Mobile: stacked cards, analytics below list
- Tablet: two-column
- Desktop: full dashboard with sidebar analytics

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic service cards with action strip
- AFTER: Financial dashboard with cost trends, category breakdown, savings detection

**IMPLEMENTATION PLAN:**
1. Build dashboard header with stat tiles
2. Redesign ServiceCard with cost/renewal focus
3. Build CostTrendChart
4. Build CategoryBreakdown pie chart
5. Add RenewalCalendar view
6. Build SavingsCard component
7. Add sorting and filtering to service list
8. Mobile responsive pass

**PRIORITY:** P1 — needs financial dashboard treatment, not generic card list

**DESIGN SCORE:** 4/10 — functional but doesn't convey financial precision

**UPGRADE POTENTIAL:** 7/10 — clear reference (Stripe, Truebill) with achievable improvements

---

## 8. sessions

**PURPOSE:** Multi-step workflow substrate with session management, status tracking, and bulk operations.

**CURRENT DESIGN:** Session list with detail modal, status filters, bulk operations. Uses LensShell, ManifestActionBar, AutoActionStrip, RecentMineCard. Dark theme. Session cards show name, status, progress, last modified. Modal shows session details and step list.

**DESIGN DIRECTION:** Linear project management — sessions are workflows, treat them like projects with stages and progress.

**LAYOUT UPGRADE:**
- Persistent header: session count by status (active/paused/completed/failed), filter bar
- Main area: kanban board with status columns (or list view toggle)
- Session detail: slide-out panel (not modal) with step list, timeline, actions
- Bulk actions: toolbar appears when items selected (move, archive, delete, export)

**COMPONENT-LEVEL CHANGES:**
- SessionCard: status badge, progress bar, step count, last activity timestamp, quick actions
- SessionDetail: step list with status indicators, timeline of events, linked DTUs, action buttons
- KanbanColumn: status header with count, drop zone for drag-to-reorder
- BulkToolbar: action buttons (move, archive, delete) with selection count
- StatusFilter: pill buttons with counts for each status

**VISUAL UPGRADES:**
- Status colors: active = emerald, paused = amber, completed = blue, failed = red
- Progress bar: filled portion matches status color
- Kanban columns: subtle background tint matching status
- Session cards: left border color matches status
- Timeline: vertical line with dot markers for each event

**CAPABILITY PRESENTATION:**
- Surface "active sessions" as primary stat
- Show "completion rate" as secondary stat
- Quick actions: "New Session", "Resume", "Archive", "Export"

**LENS IDENTITY:** "Workflow engine" — organized, progressive, actionable. Think Linear projects meets GitHub Actions.

**RESPONSIVE DESIGN:**
- Mobile: list view only, detail as full-screen modal
- Tablet: kanban with 2-3 columns visible
- Desktop: full kanban with all columns

**BEFORE/AFTER CONCEPT:**
- BEFORE: Flat card list with modal detail
- AFTER: Kanban board with slide-out detail panel and bulk operations toolbar

**IMPLEMENTATION PLAN:**
1. Build KanbanColumn component
2. Add list/kanban view toggle
3. Redesign SessionCard with status border and progress bar
4. Replace modal with slide-out detail panel
5. Build BulkToolbar component
6. Add StatusFilter pill bar
7. Add drag-to-reorder between columns
8. Mobile responsive pass

**PRIORITY:** P1 — needs visual upgrade from list to kanban for workflow visibility

**DESIGN SCORE:** 5/10 — functional but lacks workflow visualization

**UPGRADE POTENTIAL:** 7/10 — clear reference (Linear) with achievable kanban implementation

---

## 9. settings

**PURPOSE:** Platform settings with preferences, keybindings, snapshots, account, and system tabs.

**CURRENT DESIGN:** Tab-based settings (preferences, keybindings, snapshots, account, system). Uses LensShell, ManifestActionBar. Dark theme with neutral accents. Each tab has form inputs, toggles, and action buttons. Standard settings layout.

**DESIGN DIRECTION:** VS Code settings — dense, organized, searchable. Settings should feel like a power-user tool, not a consumer app. The current tab structure is correct; refine the density and search.

**LAYOUT UPGRADE:**
- Persistent search bar at top (filter settings across all tabs)
- Left sidebar: tab navigation with icons
- Right content: grouped settings sections with collapsible headers
- Bottom bar: save/cancel/reset buttons (sticky)

**COMPONENT-LEVEL CHANGES:**
- SettingGroup: collapsible header with group name, description
- SettingRow: label, control (toggle/input/select), description tooltip
- KeybindingRow: key combo display, edit button, conflict indicator
- SnapshotCard: timestamp, size, restore button, diff preview
- AccountSection: profile info, email, password change, 2FA status

**VISUAL UPGRADES:**
- Tab icons: palette (preferences), keyboard (keybindings), camera (snapshots), user (account), gear (system)
- Active tab: colored left border + bold text
- Setting groups: subtle background tint for grouped sections
- Toggles: use platform-native style (iOS toggle for web)
- Search results: highlight matched setting name and description

**CAPABILITY PRESENTATION:**
- Surface "settings changed this session" indicator (unsaved changes dot)
- Show "system health" summary on System tab
- Quick actions: "Reset All", "Export Settings", "Import Settings"

**LENS IDENTITY:** "Power user control" — dense, organized, searchable. Think VS Code settings meets Notion database.

**RESPONSIVE DESIGN:**
- Mobile: tabs become horizontal scroll, settings stack vertically
- Tablet: sidebar + content
- Desktop: full three-panel (search + sidebar + content)

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic tab layout with form inputs
- AFTER: Searchable settings with grouped sections, keybinding editor, snapshot management

**IMPLEMENTATION PLAN:**
1. Add global search bar
2. Build SettingGroup with collapsible headers
3. Add tab icons and active indicator
4. Build KeybindingRow with conflict detection
5. Build SnapshotCard with diff preview
6. Add sticky save/cancel bar
7. Add "unsaved changes" indicator
8. Mobile responsive pass

**PRIORITY:** P2 — already functional, needs density and search refinement

**DESIGN SCORE:** 6/10 — correct structure, needs power-user density

**UPGRADE POTENTIAL:** 5/10 — incremental improvements, not structural changes

---

## 10. sim

**PURPOSE:** Simulation workbench for scenario modeling, parameter exploration, and run comparison.

**CURRENT DESIGN:** 7 tabs (Scenarios, Parameters, Runs, Results, Comparison, Models, Studio), detail sidebar panel, scenario builder modal. Uses LensShell, RecentMineCard, AutoActionStrip, CrossLensRecentsPanel, MobileTabBar, RealtimeDataPanel, LiveIndicator, DTUExportButton, SimRepos. Framer-motion animations. Purple/cyan accents on dark.

**DESIGN DIRECTION:** AnyLogic/NetLogo-style simulation IDE. Simulations are complex technical tools — the UI must convey precision and analytical depth.

**LAYOUT UPGRADE:**
- Persistent toolbar: scenario selector, parameter presets, run controls (play/pause/stop), comparison mode toggle
- Main area: split view — scenario builder (left 60%), parameter explorer (right 40%)
- Bottom panel: run results with charts (collapsible)
- Right sidebar: model templates, recent runs
- Remove CrossLensRecentsPanel (irrelevant for sim work)

**COMPONENT-LEVEL CHANGES:**
- ScenarioCard: name, parameter count, run count, last run timestamp, status badge
- ParameterExplorer: parameter tree with sliders, ranges, presets
- RunChart: line/bar charts with multiple series, legend, zoom
- ComparisonView: side-by-side or overlay charts for multiple runs
- ModelTemplate: template card with description, parameters, use count

**VISUAL UPGRADES:**
- Scenario status: draft = slate, running = emerald pulse, completed = blue, failed = red
- Parameter sliders: colored by category (environment = green, agent = purple, system = cyan)
- Run charts: gradient fill under lines, smooth curves
- Comparison: distinct line colors with legend

**CAPABILITY PRESENTATION:**
- Surface "active simulations" count as primary stat
- Show "recent results" as quick-access cards
- Quick actions: "New Scenario", "Run Simulation", "Compare Results", "Export Data"

**LENS IDENTITY:** "Simulation IDE" — precise, analytical, technical. Think AnyLogic meets Jupyter notebooks.

**RESPONSIVE DESIGN:**
- Mobile: tabbed single-panel view
- Tablet: split view
- Desktop: full multi-panel workbench

**BEFORE/AFTER CONCEPT:**
- BEFORE: Tab-driven with basic cards
- AFTER: Persistent toolbar + split-pane workbench + chart results panel

**IMPLEMENTATION PLAN:**
1. Flatten tabs into persistent toolbar
2. Build ScenarioBuilder with parameter sliders
3. Build RunChart with multi-series support
4. Build ComparisonView
5. Add run controls (play/pause/stop)
6. Build ModelTemplate browser
7. Remove CrossLensRecentsPanel
8. Mobile responsive pass

**PRIORITY:** P1 — needs structural redesign from tabs to workbench

**DESIGN SCORE:** 5/10 — has depth but wrong layout paradigm

**UPGRADE POTENTIAL:** 7/10 — clear reference (AnyLogic, NetLogo) with achievable improvements

---

## 11. social

**PURPOSE:** Social hub with feed, stories, trending, DMs, and streak tracking.

**CURRENT DESIGN:** Instagram/Twitter-style feed grid, right sidebar (trending + who-to-follow + streak), stories rail at top, mobile tab bar. Uses LensShell, CrossLensRecentsPanel, MobileTabBar. Framer-motion likely. Pink/rose accents on dark. Post composer, post cards, trending sidebar, stories rail.

**DESIGN DIRECTION:** Instagram meets Twitter — visual-first social feed with strong content hierarchy. The stories rail + feed + sidebar structure is correct; refine the visual polish.

**LAYOUT UPGRADE:**
- Stories rail: horizontal scroll with avatar circles, active story ring (gradient border)
- Feed: single-column centered (like Instagram), post cards with full image support
- Right sidebar: trending topics (compact list), who-to-follow (avatar + name + follow button), streak counter
- Mobile: bottom tab bar (feed, search, create, notifications, profile)

**COMPONENT-LEVEL CHANGES:**
- PostCard: full-width image, avatar + username + timestamp header, like/comment/share actions, caption
- StoryCircle: avatar with gradient ring (viewed = gray ring), username below
- TrendingItem: topic name, post count, category badge
- WhoToFollow: avatar, name, mutual followers count, follow button
- StreakCounter: flame icon, streak count, "keep it going" message

**VISUAL UPGRADES:**
- Post images: full-bleed within card, rounded corners
- Story rings: gradient from pink to purple for unviewed, gray for viewed
- Like button: heart animation on tap (fill + scale)
- Trending: fire emoji for hot topics
- Streak: flame icon with glow effect

**CAPABILITY PRESENTATION:**
- Surface "new posts" count as notification badge
- Show "trending now" as real-time sidebar
- Quick actions: "New Post", "View Stories", "Messages", "Notifications"

**LENS IDENTITY:** "Social feed" — visual, engaging, personal. Think Instagram meets Twitter.

**RESPONSIVE DESIGN:**
- Mobile: full-width feed, bottom tab bar, stories as horizontal scroll
- Tablet: feed + sidebar
- Desktop: centered feed + right sidebar + stories rail

**BEFORE/AFTER CONCEPT:**
- BEFORE: Grid-based feed with basic cards
- AFTER: Single-column visual feed with stories rail, trending sidebar, engagement animations

**IMPLEMENTATION PLAN:**
1. Redesign feed as single-column centered
2. Build StoriesRail with gradient rings
3. Redesign PostCard with full-image support
4. Build TrendingSidebar
5. Add like animation
6. Build StreakCounter with flame icon
7. Add bottom tab bar for mobile
8. Mobile responsive pass

**PRIORITY:** P1 — needs visual upgrade to match social app quality bar

**DESIGN SCORE:** 5/10 — has structure but lacks visual engagement

**UPGRADE POTENTIAL:** 8/10 — clear reference (Instagram, Twitter) with high visual impact

---

## 12. society

**PURPOSE:** NPC society management with culture, economy, autonomy, conflict, teaching, and persona tabs.

**CURRENT DESIGN:** 6 tabs, each with its own macro-driven panel, dynamic imports. Uses LensShell, ManifestActionBar, AutoActionStrip, RecentMineCard. Framer-motion + AnimatePresence. Amber/gold accents on dark. Culture tab shows cultural metrics, economy tab shows NPC economic activity.

**DESIGN DIRECTION:** Civilization game advisor screen — the society is a living system, the UI should feel like monitoring a civilization. Each tab is a different lens into the same living world.

**LAYOUT UPGRADE:**
- Persistent header: society health overview (culture strength, economic vitality, social cohesion, conflict level)
- Tab bar: icon + label for each dimension (culture, economy, autonomy, conflict, teaching, persona)
- Each tab: dedicated visualization for that dimension
- Bottom panel: recent events feed (cross-cutting all dimensions)

**COMPONENT-LEVEL CHANGES:**
- SocietyHealthBar: horizontal bar with color-coded segments for each dimension
- CulturePanel: cultural artifacts list, tradition strength meters, festival calendar
- EconomyPanel: resource flow diagram, trade routes, NPC job distribution
- AutonomyPanel: NPC decision log, autonomy score, intervention history
- ConflictPanel: active conflicts map, tension meters, resolution status
- TeachingPanel: skill transfer network, mentor-mentee pairs, knowledge graph

**VISUAL UPGRADES:**
- Society health bar: gradient from red (struggling) to green (thriving) per dimension
- Culture: warm amber/gold palette, tradition icons
- Economy: blue/green palette, resource icons
- Conflict: red/orange palette, tension indicators
- Teaching: purple/blue palette, knowledge network visualization

**CAPABILITY PRESENTATION:**
- Surface "society health score" as primary stat (aggregate of all dimensions)
- Show "events this week" as activity feed
- Quick actions: "Intervene", "Boost Culture", "Resolve Conflict", "Assign Mentor"

**LENS IDENTITY:** "Civilization advisor" — analytical, holistic, strategic. Think Civilization game advisor meets governance dashboard.

**RESPONSIVE DESIGN:**
- Mobile: tabs become horizontal scroll, content stacks
- Tablet: two-column per tab
- Desktop: full dashboard with all dimensions visible

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic tab panels with macro outputs
- AFTER: Civilization advisor dashboard with dimension-specific visualizations and society health overview

**IMPLEMENTATION PLAN:**
1. Build SocietyHealthBar overview
2. Add tab icons and colored indicators
3. Build CulturePanel with tradition meters
4. Build EconomyPanel with resource flow
5. Build ConflictPanel with tension indicators
6. Add recent events feed
7. Add society health score calculation
8. Mobile responsive pass

**PRIORITY:** P1 — needs civilization advisor treatment, not generic tabs

**DESIGN SCORE:** 5/10 — has depth but lacks visual storytelling

**UPGRADE POTENTIAL:** 7/10 — clear design direction (civilization advisor) with achievable improvements

---

## 13. space

**PURPOSE:** Space and astronomy with launches, news, and observatory panels.

**CURRENT DESIGN:** 3-column grid (launches left, news center, observatory right), action bar. Uses LensShell, ManifestActionBar, LiveIndicator, DTUExportButton, RealtimeDataPanel, useRealtimeLens. Framer-motion. Blue/slate accents. SpaceflightNewsPanel, UpcomingLaunchesPanel, SpaceObservatory, MissionPlanningPanel.

**DESIGN DIRECTION:** NASA Mission Control meets Starlink dashboard — the vastness of space should be felt in the UI. Dark backgrounds with star-field accents.

**LAYOUT UPGRADE:**
- Full-width hero: next launch countdown with rocket visualization
- Three-column below: Launches (upcoming, with countdown timers), News (space news feed), Observatory (telescope data, star maps)
- Right sidebar: mission status, satellite tracking
- Bottom panel: launch history timeline

**COMPONENT-LEVEL CHANGES:**
- LaunchCard: rocket name, mission, launch site, countdown timer, status badge (scheduled/scrubbed/launched), live indicator
- NewsCard: headline, source, published date, image thumbnail, category badge
- ObservatoryPanel: star map preview, telescope status, latest observation
- MissionCard: mission name, status, crew, objective, timeline
- CountdownTimer: days:hours:minutes:seconds with animated digits

**VISUAL UPGRADES:**
- Launch countdown: large animated digits with glow effect
- Rocket visualization: simple SVG rocket icon that animates on launch
- News cards: image-heavy with source badge
- Observatory: star-field background with glowing dots
- Status badges: scheduled = blue, live = green pulse, launched = gold, scrubbed = red

**CAPABILITY PRESENTATION:**
- Surface "next launch" as hero element with countdown
- Show "launches this month" as stat tile
- Quick actions: "Watch Live", "Add to Calendar", "Share Launch", "View Mission Details"

**LENS IDENTITY:** "Mission control" — vast, precise, exciting. Think NASA JPL meets SpaceX mission control.

**RESPONSIVE DESIGN:**
- Mobile: stacked single-column, launch countdown as hero
- Tablet: two-column (launches + news)
- Desktop: full three-column with sidebar

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic 3-column grid with action bar
- AFTER: Mission control dashboard with countdown hero, star-field observatory, mission tracking

**IMPLEMENTATION PLAN:**
1. Build LaunchCountdown hero component
2. Add star-field background to observatory
3. Redesign LaunchCard with countdown timer
4. Build NewsCard with image support
5. Add MissionCard with status tracking
6. Build launch history timeline
7. Add animated rocket SVG
8. Mobile responsive pass

**PRIORITY:** P1 — needs visual excitement to match space theme

**DESIGN SCORE:** 5/10 — has components but lacks visual wonder

**UPGRADE POTENTIAL:** 8/10 — high visual impact with clear reference (NASA, SpaceX)

---

## 14. spectate

**PURPOSE:** Sub-world browser for spectating authored worlds.

**CURRENT DESIGN:** Grid of world cards with image/name/description, join button. Uses LensShell, ManifestActionBar. Very compact (~200 lines). AUTHORED_WORLDS constant defines available worlds. Dark neutral theme.

**DESIGN DIRECTION:** Roblox game browser — worlds are destinations, the UI should feel like a portal to different experiences. Each card should evoke the world's atmosphere.

**LAYOUT UPGRADE:**
- Hero: featured world with full-width background image and "Enter World" CTA
- Grid below: world cards with atmospheric images, name, description, player count, rating
- Filter bar: genre tags (fantasy, sci-fi, cyberpunk, etc.)
- Sort: by popularity, newest, rating

**COMPONENT-LEVEL CHANGES:**
- WorldCard: atmospheric background image, world name (large), description excerpt, player count badge, rating stars, "Enter" button
- FeaturedWorld: full-width hero with parallax background, world description, enter CTA
- GenreFilter: pill buttons for each genre
- PlayerCount: live indicator with count, "X players online"

**VISUAL UPGRADES:**
- World cards: full-bleed background images with gradient overlay for text readability
- Featured world: parallax scrolling effect on background
- Player count: green dot with "X online" text
- Rating: star icons with glow
- Enter button: gradient background matching world's theme color

**CAPABILITY PRESENTATION:**
- Surface "featured world" as hero element
- Show "worlds you've visited" as horizontal scroll below hero
- Quick actions: "Enter World", "Add to Favorites", "Share World"

**LENS IDENTITY:** "World portal" — atmospheric, inviting, diverse. Think Roblox game page meets Steam store.

**RESPONSIVE DESIGN:**
- Mobile: single-column cards, featured as full-width hero
- Tablet: 2-column grid
- Desktop: 3-column grid with featured hero

**BEFORE/AFTER CONCEPT:**
- BEFORE: Plain card grid with basic info
- AFTER: Atmospheric world browser with featured hero, genre filters, player counts

**IMPLEMENTATION PLAN:**
1. Build FeaturedWorld hero component
2. Add atmospheric background images to WorldCard
3. Build GenreFilter pill bar
4. Add player count indicator
5. Build rating display
6. Add parallax effect to featured world
7. Add "worlds you've visited" section
8. Mobile responsive pass

**PRIORITY:** P1 — needs atmospheric treatment to match world concept

**DESIGN SCORE:** 4/10 — too minimal for a world browser

**UPGRADE POTENTIAL:** 8/10 — high visual impact with clear reference (Roblox, Steam)

---

## 15. sponsorship

**PURPOSE:** Sponsorship and Patreon-style tier management with billing and creator tools.

**CURRENT DESIGN:** 5 tabs (Discover, Memberships, Billing, Inbox, Creator), each with dedicated panel. Uses LensShell, RecentMineCard, AutoActionStrip, CrossLensRecentsPanel. Orange/amber accents. DiscoverPanel, MySponsorships, BillingDashboard, SponsorInbox, CreatorHub, SponsorRepos.

**DESIGN DIRECTION:** Patreon meets Ko-fi — sponsorship is about relationship and support, the UI should feel warm and appreciative, not transactional.

**LAYOUT UPGRADE:**
- Discover tab: tier cards with creator avatars, benefits, pricing, supporter count
- Memberships tab: active sponsorships with status, next billing date, total contributed
- Billing tab: payment history, upcoming charges, payment method management
- Inbox tab: messages from creators, announcement feed
- Creator tab: patron analytics, revenue chart, tier management

**COMPONENT-LEVEL CHANGES:**
- TierCard: creator avatar, tier name, price, benefits list, supporter count, "Support" button
- MembershipCard: creator avatar, tier name, status, next billing, total contributed
- BillingRow: date, description, amount, status badge
- MessageCard: creator avatar, subject, preview, timestamp, unread indicator
- RevenueChart: monthly revenue line chart, patron count trend

**VISUAL UPGRADES:**
- Tier cards: gradient backgrounds matching creator's theme color
- Support button: warm gradient (orange to pink) with heart icon
- Membership status: active = green, paused = amber, cancelled = slate
- Unread messages: blue dot indicator
- Revenue chart: filled area with gradient

**CAPABILITY PRESENTATION:**
- Surface "active sponsorships" count as primary stat
- Show "total contributed" as secondary stat
- Quick actions: "Discover Creators", "Manage Memberships", "View Receipts", "Message Creator"

**LENS IDENTITY:** "Creator support" — warm, appreciative, community-focused. Think Patreon meets Ko-fi.

**RESPONSIVE DESIGN:**
- Mobile: stacked cards, tabs as horizontal scroll
- Tablet: two-column per tab
- Desktop: full dashboard layout

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic tab panels with card lists
- AFTER: Warm, creator-focused dashboard with tier cards, membership tracking, revenue analytics

**IMPLEMENTATION PLAN:**
1. Build TierCard with gradient backgrounds
2. Build MembershipCard with status tracking
3. Build BillingRow with payment history
4. Build MessageCard with unread indicator
5. Build RevenueChart for creator tab
6. Add warm color palette
7. Add "total contributed" stat
8. Mobile responsive pass

**PRIORITY:** P2 — already functional, needs warmth and visual polish

**DESIGN SCORE:** 5/10 — correct structure, lacks emotional warmth

**UPGRADE POTENTIAL:** 6/10 — incremental improvements, not structural changes

---

## 16. sports

**PURPOSE:** Sports fan hub with league standings, match simulator, and live updates.

**CURRENT DESIGN:** SportsFanSection with league standings, match simulator. Uses LensShell, ManifestActionBar, LiveIndicator, RealtimeDataPanel, useRealtimeLens, PipingProvider, LensFeedButton. Framer-motion + AnimatePresence. Green/emerald accents.

**DESIGN DIRECTION:** ESPN/Scoreboard — sports is about real-time excitement, the UI should feel alive with scores and updates.

**LAYOUT UPGRADE:**
- Top bar: live scores ticker (horizontal scroll of ongoing matches)
- Main area: two tabs — Standings, Simulator
- Standings tab: league table with position, team, played, won, drawn, lost, GD, points
- Simulator tab: match simulation controls, live match view, play-by-play
- Right sidebar: upcoming matches, recent results

**COMPONENT-LEVEL CHANGES:**
- LiveScoreTicker: horizontal scroll of match cards with live scores, pulsing indicator
- StandingsTable: sortable columns, position change arrows, form indicators (W/D/L)
- MatchCard: home/away teams, score, status (live/final/scheduled), time
- SimControls: play/pause/speed controls, team lineup, tactics selector
- PlayByPlay: chronological event list with timestamps

**VISUAL UPGRADES:**
- Live scores: pulsing green dot, real-time score updates
- Standings: position change arrows (green up, red down), form badges (W=green, D=amber, L=red)
- Match cards: team colors as accent, score in large bold
- Sim controls: transport bar style (play/pause/speed)
- Play-by-play: timestamp with event icon

**CAPABILITY PRESENTATION:**
- Surface "live matches" as primary stat
- Show "your team's next match" as featured card
- Quick actions: "Watch Sim", "View Standings", "Compare Teams", "Share Score"

**LENS IDENTITY:** "Sports center" — exciting, real-time, competitive. Think ESPN/Scoreboard meets FIFA.

**RESPONSIVE DESIGN:**
- Mobile: live ticker as horizontal scroll, standings as list
- Tablet: two-column (standings + matches)
- Desktop: full dashboard with ticker, standings, simulator

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic fan section with standings
- AFTER: Live sports center with score ticker, interactive standings, match simulator

**IMPLEMENTATION PLAN:**
1. Build LiveScoreTicker component
2. Redesign StandingsTable with form indicators
3. Build MatchCard with team colors
4. Add SimControls transport bar
5. Build PlayByPlay event list
6. Add live score pulsing animation
7. Add "your team" personalization
8. Mobile responsive pass

**PRIORITY:** P1 — needs visual excitement to match sports energy

**DESIGN SCORE:** 5/10 — has components but lacks live energy

**UPGRADE POTENTIAL:** 8/10 — high visual impact with clear reference (ESPN, Scoreboard)

---

## 17. srs

**PURPOSE:** Spaced repetition system for learning with review queue and deck management.

**CURRENT DESIGN:** Workbench layout with repo browser, DTU picker modal, live indicator. Uses LensShell, ManifestActionBar, LiveIndicator, RealtimeDataPanel, useRealtimeLens. Framer-motion. Cyan/blue accents. SrsRepos, SrsWorkbench, DTUPickerModal.

**DESIGN DIRECTION:** Anki meets Quizlet — spaced repetition is about efficient learning, the UI should feel focused and distraction-free during review.

**LAYOUT UPGRADE:**
- Two-mode layout: Review mode (fullscreen flashcard) and Browse mode (deck management)
- Review mode: single flashcard centered, progress bar, rating buttons (Again/Hard/Good/Easy)
- Browse mode: deck list with stats, card editor, import/export
- Top bar: deck selector, review stats (due today, reviewed, streak)

**COMPONENT-LEVEL CHANGES:**
- Flashcard: front/back with flip animation, hint button, audio button
- ReviewProgress: cards reviewed / total due, streak counter, next review time
- RatingButton: Again (red), Hard (orange), Good (green), Easy (blue) with keyboard shortcuts
- DeckCard: deck name, card count, due count, last reviewed, average retention
- CardEditor: front/back fields, tags, hints, media attachments

**VISUAL UPGRADS:**
- Flashcard: subtle shadow, flip animation (3D rotation), clean typography
- Rating buttons: color-coded with keyboard shortcut indicators
- Deck cards: retention percentage as circular progress indicator
- Review streak: flame icon with glow
- Progress bar: gradient from start to current position

**CAPABILITY PRESENTATION:**
- Surface "cards due today" as primary stat
- Show "review streak" as secondary stat
- Quick actions: "Start Review", "Add Card", "Import Deck", "Export Data"

**LENS IDENTITY:** "Learning tool" — focused, efficient, motivating. Think Anki meets Quizlet.

**RESPONSIVE DESIGN:**
- Mobile: fullscreen flashcard in review mode, list in browse mode
- Tablet: split view in browse mode
- Desktop: full workbench with deck browser and editor

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic workbench with repo browser
- AFTER: Focused learning tool with fullscreen review, deck stats, retention tracking

**IMPLEMENTATION PLAN:**
1. Build Review/Browse mode toggle
2. Build Flashcard with flip animation
3. Build RatingButton with keyboard shortcuts
4. Add ReviewProgress bar
5. Build DeckCard with retention stats
6. Add streak tracking
7. Build CardEditor
8. Mobile responsive pass

**PRIORITY:** P1 — needs focused learning experience, not generic workbench

**DESIGN SCORE:** 4/10 — too minimal for a learning tool

**UPGRADE POTENTIAL:** 8/10 — clear reference (Anki, Quizlet) with high impact

---

## 18. staking

**PURPOSE:** Crypto staking with markets, pools, positions, rewards, and earnings tracking.

**CURRENT DESIGN:** Full dashboard — StakingMarkets, StakingPools, RewardsEstimator, AprHistoryChart, StakePositions, EarningsLedger, ReceiptTokens, MaturityReminders. Uses LensShell, ManifestActionBar, AutoActionStrip, RecentMineCard, CrossLensRecentsPanel. Emerald/teal accents. 8 dedicated panels.

**DESIGN DIRECTION:** Lido/Rocket Pool dashboard — staking is financial, the UI should convey precision, trust, and real-time value. Already has 8 panels; organize them into a coherent dashboard.

**LAYOUT UPGRADE:**
- Dashboard header: TVL (total value locked), current APR, total staked, rewards earned
- Two-column layout: Markets/Pools (left 50%), Positions/Rewards (right 50%)
- Bottom panel: EarningsLedger as full-width table
- Right sidebar: MaturityReminders, ReceiptTokens

**COMPONENT-LEVEL CHANGES:**
- TVHLarge: large number display with USD value, 24h change percentage
- APRBadge: current APR with trend arrow, comparison to average
- PositionCard: staked amount, current value, rewards earned, maturity date
- RewardsCard: pending rewards, claim button, next reward time
- PoolCard: pool name, TVL, APR, your share, status

**VISUAL UPGRADES:**
- TVL: large bold number with gradient text
- APR: green for above average, red for below
- Position cards: subtle gradient border matching pool color
- Rewards: animated counter when claiming
- Charts: smooth curves with gradient fill

**CAPABILITY PRESENTATION:**
- Surface "total staked value" as hero stat
- Show "pending rewards" as urgent card
- Quick actions: "Stake", "Unstake", "Claim Rewards", "View History"

**LENS IDENTITY:** "DeFi dashboard" — precise, trustworthy, real-time. Think Lido meets Rocket Pool.

**RESPONSIVE DESIGN:**
- Mobile: stacked cards, dashboard as single column
- Tablet: two-column
- Desktop: full dashboard with sidebar

**BEFORE/AFTER CONCEPT:**
- BEFORE: 8 panels in flat layout
- AFTER: Organized dashboard with TVL hero, position cards, earnings ledger

**IMPLEMENTATION PLAN:**
1. Build TVHLarge hero stat
2. Build APRBadge with trend
3. Build PositionCard with maturity tracking
4. Build RewardsCard with claim animation
5. Redesign layout into two-column + sidebar
6. Add charts to APR history
7. Build full-width earnings ledger
8. Mobile responsive pass

**PRIORITY:** P2 — already has depth, needs layout organization and visual polish

**DESIGN SCORE:** 6/10 — has 8 panels but needs better organization

**UPGRADE POTENTIAL:** 6/10 — incremental improvements, not structural changes

---

## 19. strategic-adds

**PURPOSE:** Strategic tooling suite with API, burnout, learning, hazard, labor, misinfo, contacts, and go-live tabs.

**CURRENT DESIGN:** 8 tool tabs, each with dedicated panel. Uses LensShell, ManifestActionBar, RecentMineCard, AutoActionStrip, CrossLensRecentsPanel. Mixed accent colors per tab. DataControlsPanel, ConnectorCatalog, FocusToolkit, SrsWorkbench, SeismicHazardPanel, FireIncidents, BlsSeriesExplorer, BlsWageForecast, ClaimVerificationPanel, FactGroundingWorkbench, DevToolingPulse.

**DESIGN DIRECTION:** Swiss Army knife — each tab is a distinct tool, the UI should feel like a toolbox where each tool is well-crafted. The 8-tab structure is correct; each tab needs its own visual identity.

**LAYOUT UPGRADE:**
- Persistent toolbar: tab selector with icons, tool-specific actions
- Each tab: full-width dedicated layout for that tool
- Common elements: export, help, settings per tool
- Remove generic cross-lens recents (irrelevant for tool suite)

**COMPONENT-LEVEL CHANGES:**
- ToolTab: icon + label, active indicator
- Each tool panel: domain-specific layout (API = endpoint builder, Burnout = gauge dashboard, Learning = progress tracker, etc.)
- ToolHeader: tool name, description, quick actions
- ToolFooter: export, help, settings

**VISUAL UPGRADES:**
- Each tab gets its own accent color (API = green, Burnout = red, Learning = blue, Hazard = orange, Labor = yellow, Misinfo = purple, Contacts = cyan, Go-Live = emerald)
- Tab icons: distinctive per tool (code, flame, book, mountain, briefcase, shield, users, rocket)
- Tool panels: subtle background tint matching tab color
- Active tab: colored left border + bold text

**CAPABILITY PRESENTATION:**
- Surface "most used tools" as quick access
- Show "recent activity across tools" as unified feed
- Quick actions: tool-specific per tab

**LENS IDENTITY:** "Toolbox" — precise, versatile, well-crafted. Think VS Code extensions meets Figma plugins.

**RESPONSIVE DESIGN:**
- Mobile: tabs as horizontal scroll, tools stack vertically
- Tablet: full-width per tab
- Desktop: full workbench per tool

**BEFORE/AFTER CONCEPT:**
- BEFORE: 8 tabs with generic panels
- AFTER: Distinct tool identity per tab with domain-specific layouts and color coding

**IMPLEMENTATION PLAN:**
1. Add per-tab accent colors
2. Build ToolTab with icons
3. Redesign each tool panel with domain-specific layout
4. Add ToolHeader/ToolFooter common elements
5. Remove CrossLensRecentsPanel
6. Add "most used tools" section
7. Build unified activity feed
8. Mobile responsive pass

**PRIORITY:** P2 — already has 8 tools, needs per-tool visual identity

**DESIGN SCORE:** 5/10 — functional but visually uniform across tools

**UPGRADE POTENTIAL:** 6/10 — incremental improvements per tool

---

## 20. studio

**PURPOSE:** DAW / music production environment with full audio workstation capabilities.

**CURRENT DESIGN:** Extremely bespoke — transport bar, recording controls, beat pads strip, main content area with 11+ views (session, arrange, mixer, piano roll, drum machine, sampler, audio editor, automation, mastering, soundboard, instruments, effects, AI assistant, learn). Uses LensShell, LiveIndicator, DTUExportButton, RealtimeDataPanel, PipingProvider, MobileTabBar, FirstRunTour, DepthBadge, DTULibraryPanel, ShellPreview, DTUPickerModal. Framer-motion + AnimatePresence. Violet/neon cyan. 2,996 lines — most component-rich lens.

**DESIGN DIRECTION:** Ableton Live meets Logic Pro — this IS the product for music creators. The existing depth is exceptional; refine the visual polish to match professional DAW quality.

**LAYOUT UPGRADE:**
- Persistent transport bar at top: play/pause/stop, tempo, time signature, metronome, recording controls
- Left sidebar: track list with mute/solo/volume per track
- Center: main content area (11+ views, tabbed)
- Right sidebar: mixer or effects chain (context-dependent)
- Bottom: timeline/arrangement view (always visible)
- Keep MobileTabBar for view switching on mobile

**COMPONENT-LEVEL CHANGES:**
- TransportBar: LED-style time display, transport buttons with tactile feedback, tempo dial
- TrackList: track name, mute/solo/arm buttons, volume fader, pan knob, color indicator
- MixerChannel: fader, pan, mute/solo, effects sends, level meter
- PianoRoll: grid with notes, velocity editor, quantize controls
- DrumMachine: 16-pad grid with velocity, pattern selector
- EffectsChain: effect slots with parameter knobs, bypass toggle

**VISUAL UPGRADES:**
- Transport bar: brushed metal texture, LED-style digits
- Track list: color-coded tracks, waveform preview
- Mixer: animated level meters, fader caps
- Piano roll: note color by velocity, ghost notes
- Drum pads: velocity-sensitive color (harder = brighter)
- Effects: rack-style with parameter knobs

**CAPABILITY PRESENTATION:**
- Surface "active project" name and tempo prominently
- Show "track count" and "total duration" as stats
- Quick actions: "New Track", "Record", "Export", "Save"

**LENS IDENTITY:** "Professional DAW" — this is the flagship creative tool. Visual language: brushed metal, LED displays, fader caps. Think Ableton Live meets Logic Pro.

**RESPONSIVE DESIGN:**
- Mobile: simplified transport + view tabs
- Tablet: transport + mixer or main view
- Desktop: full DAW layout with all panels

**BEFORE/AFTER CONCEPT:**
- BEFORE: Exceptional depth with 11+ views but inconsistent visual polish
- AFTER: Professional DAW with brushed metal aesthetic, LED displays, tactile controls

**IMPLEMENTATION PLAN:**
1. Refine TransportBar with LED-style digits
2. Add brushed metal texture to transport
3. Build TrackList with color coding
4. Refine MixerChannel with animated meters
5. Add waveform preview to tracks
6. Refine PianoRoll with velocity colors
7. Add drum pad velocity color
8. Mobile responsive pass

**PRIORITY:** P2 — already exceptional depth, needs professional visual polish

**DESIGN SCORE:** 7/10 — most component-rich lens, needs DAW-quality aesthetics

**UPGRADE POTENTIAL:** 6/10 — incremental polish, not structural changes

---

## 21. sub-worlds

**PURPOSE:** Metaverse / sub-world management with world browser, settings, editor, and analytics.

**CURRENT DESIGN:** World cards with thumbnails, settings panel, editor panel, analytics panel, portal load screen. Uses LensShell, ManifestActionBar, AutoActionStrip, RecentMineCard. Dark theme with cyan/green accents. PortalLoadScreen, MetaverseRepos, WorldCard, WorldSettingsPanel, WorldEditorPanel, WorldAnalyticsPanel, useWorldTravel hook.

**DESIGN DIRECTION:** Roblox Studio meets Rec Room — sub-worlds are creative spaces, the UI should feel like a world builder's control panel.

**LAYOUT UPGRADE:**
- World browser: grid of world cards with thumbnails, status, player count
- World detail: tabbed view (Overview, Settings, Editor, Analytics)
- Overview: world stats, recent activity, quick actions
- Settings: world configuration, permissions, moderation
- Editor: visual world builder (if applicable)
- Analytics: player engagement, session stats, growth

**COMPONENT-LEVEL CHANGES:**
- WorldCard: thumbnail image, world name, status badge, player count, last active, "Enter" button
- WorldOverview: stats tiles (players, sessions, rating), activity feed
- WorldSettings: configuration form, permission toggles, moderation tools
- WorldEditor: canvas-based editor (or placeholder)
- WorldAnalytics: charts (players over time, session duration, retention)

**VISUAL UPGRADES:**
- World cards: full-bleed thumbnail with gradient overlay
- Status badges: active = green, offline = gray, private = lock icon
- Player count: live indicator with count
- Analytics charts: area charts with gradient fill
- Portal load screen: animated transition with world name

**CAPABILITY PRESENTATION:**
- Surface "your worlds" as primary section
- Show "worlds you've visited" as secondary
- Quick actions: "Create World", "Enter World", "Edit Settings", "View Analytics"

**LENS IDENTITY:** "World builder" — creative, spacious, powerful. Think Roblox Studio meets Rec Room.

**RESPONSIVE DESIGN:**
- Mobile: stacked world cards, detail as full-screen
- Tablet: 2-column grid
- Desktop: 3-column grid with detail panel

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic world cards with panels
- AFTER: World builder control panel with thumbnails, analytics, and portal transitions

**IMPLEMENTATION PLAN:**
1. Redesign WorldCard with full-bleed thumbnail
2. Build WorldOverview with stats tiles
3. Add tabbed detail view (Overview, Settings, Editor, Analytics)
4. Build WorldAnalytics charts
5. Refine PortalLoadScreen animation
6. Add player count live indicator
7. Build "worlds you've visited" section
8. Mobile responsive pass

**PRIORITY:** P1 — needs visual excitement to match metaverse concept

**DESIGN SCORE:** 5/10 — has components but lacks creative energy

**UPGRADE POTENTIAL:** 7/10 — clear reference (Roblox, Rec Room) with achievable improvements

---

## 22. suffering

**PURPOSE:** Pain and suffering tracker with matrix, themes, interventions, trends, root causes, and reports.

**CURRENT DESIGN:** Stat tiles at top, then tabbed views (matrix, themes, interventions, trends, root causes, feedback, reports). Uses LensShell, ManifestActionBar. Red/orange accents. PainBoard, PriorityMatrix, ThemeClusters, InterventionTracker, InterventionPlanner, TrendView, RootCausePanel, ReportExport, FeedbackAnalysis. Local UI imports (StatTile, StatTileGrid, Skeleton, EmptyState, ErrorState from `./ui/`).

**DESIGN DIRECTION:** Clinical pain management tool — suffering is serious, the UI should feel clinical and precise, not casual. The stat tiles + tabbed views structure is correct; refine the clinical aesthetic.

**LAYOUT UPGRADE:**
- Dashboard header: pain level (current/average/trend), active interventions count, theme clusters count
- Two-column layout: Priority Matrix (left 60%), Intervention Tracker (right 40%)
- Tab bar: Themes, Trends, Root Causes, Feedback, Reports
- Right sidebar: recent entries, quick log button

**COMPONENT-LEVEL CHANGES:**
- PainLevelGauge: circular gauge with current pain level (1-10), color gradient (green to red)
- PriorityMatrix: quadrant chart (urgency × impact), pain points plotted
- InterventionCard: name, status (active/completed/failed), effectiveness score, start date
- ThemeCluster: theme name, frequency count, trend arrow, related interventions
- TrendChart: pain level over time with intervention markers

**VISUAL UPGRADES:**
- Pain level: circular gauge with color gradient (1-3 green, 4-6 amber, 7-10 red)
- Priority matrix: quadrant colors (urgent+important = red, important = amber, urgent = yellow, neither = slate)
- Intervention status: active = emerald, completed = blue, failed = red
- Trend chart: line with intervention markers as vertical lines
- Theme clusters: size by frequency, color by category

**CAPABILITY PRESENTATION:**
- Surface "current pain level" as hero gauge
- Show "active interventions" as stat tile
- Quick actions: "Log Pain", "Add Intervention", "View Trends", "Export Report"

**LENS IDENTITY:** "Clinical tracker" — precise, serious, compassionate. Think pain management app meets clinical dashboard.

**RESPONSIVE DESIGN:**
- Mobile: stacked layout, priority matrix as list
- Tablet: two-column
- Desktop: full dashboard with matrix and tracker

**BEFORE/AFTER CONCEPT:**
- BEFORE: Stat tiles + basic tabs
- AFTER: Clinical dashboard with pain gauge, priority matrix, intervention tracking

**IMPLEMENTATION PLAN:**
1. Build PainLevelGauge circular component
2. Build PriorityMatrix quadrant chart
3. Redesign InterventionCard with status and effectiveness
4. Build ThemeCluster visualization
5. Add TrendChart with intervention markers
6. Refine color palette to clinical aesthetic
7. Add "log pain" quick action
8. Mobile responsive pass

**PRIORITY:** P1 — needs clinical precision to match serious subject matter

**DESIGN SCORE:** 5/10 — has depth but lacks clinical aesthetic

**UPGRADE POTENTIAL:** 7/10 — clear design direction (clinical tool) with achievable improvements

---

## 23. supplychain

**PURPOSE:** Supply chain management with overview, planner, and action panels.

**CURRENT DESIGN:** Overview panel, planner panel, action panel, feed panel. Uses LensShell, ManifestActionBar, AutoActionStrip, RecentMineCard. Blue/slate accents. SupplyChainOverview, SupplyChainPlanner, SupplyChainActionPanel, SupplyChainFeed.

**DESIGN DIRECTION:** SAP IBP meets Flexport — supply chain is about visibility and control, the UI should feel like a logistics command center.

**LAYOUT UPGRADE:**
- Dashboard header: inventory health, order status, supplier score, delivery performance
- Three-column layout: Inventory (left), Orders (center), Suppliers (right)
- Bottom panel: activity feed with recent events
- Right sidebar: alerts, quick actions

**COMPONENT-LEVEL CHANGES:**
- InventoryCard: SKU, quantity, location, status (in-stock/low/out), reorder point
- OrderCard: order number, supplier, status (pending/shipped/delivered), ETA
- SupplierCard: name, rating, lead time, last order, reliability score
- AlertCard: type (low stock, delay, quality issue), severity, action needed
- PerformanceTile: metric name, value, trend, target

**VISUAL UPGRADES:**
- Inventory status: in-stock = green, low = amber, out = red
- Order status: pending = slate, shipped = blue, delivered = green, delayed = red
- Supplier rating: star display with reliability percentage
- Performance tiles: progress bars with color coding
- Alert severity: critical = red, warning = amber, info = blue

**CAPABILITY PRESENTATION:**
- Surface "inventory health" as primary stat
- Show "pending orders" as secondary stat
- Quick actions: "Create Order", "Reorder Stock", "Contact Supplier", "View Analytics"

**LENS IDENTITY:** "Logistics command" — organized, precise, real-time. Think SAP IBP meets Flexport.

**RESPONSIVE DESIGN:**
- Mobile: stacked cards, orders as list
- Tablet: two-column
- Desktop: full three-column dashboard

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic panels with card lists
- AFTER: Logistics command center with inventory health, order tracking, supplier management

**IMPLEMENTATION PLAN:**
1. Build dashboard header with performance tiles
2. Redesign InventoryCard with status indicators
3. Build OrderCard with status tracking
4. Build SupplierCard with rating display
5. Build AlertCard for notifications
6. Add activity feed panel
7. Add "create order" quick action
8. Mobile responsive pass

**PRIORITY:** P1 — needs logistics command center treatment

**DESIGN SCORE:** 4/10 — too minimal for supply chain management

**UPGRADE POTENTIAL:** 7/10 — clear reference (SAP, Flexport) with achievable improvements

---

## 24. sync

**PURPOSE:** Syncthing-style file sync status and management.

**CURRENT DESIGN:** Very compact (~150 lines). 3 panels stacked (dashboard, releases, repos). Uses LensShell only. SyncDashboard, SyncthingReleases, SyncRepos. Neutral dark theme. Minimal UI.

**DESIGN DIRECTION:** Syncthing web UI — sync status should be at-a-glance, with clear indicators of sync health. The compact size is appropriate; refine the visual clarity.

**LAYOUT UPGRADE:**
- Persistent header: sync status (syncing/idle/error), last sync time, total synced files
- Three-panel stacked: Dashboard (sync health overview), Releases (version info), Repos (folder sync status)
- Dashboard: sync speed, conflict count, connected devices
- Repos: folder list with sync status, last modified, size

**COMPONENT-LEVEL CHANGES:**
- SyncStatusIndicator: large circular indicator (green = synced, yellow = syncing, red = error)
- SyncSpeed: current upload/download speed with animated graph
- RepoRow: folder name, path, sync status, last modified, size, devices
- DeviceList: device name, status (connected/disconnected), last seen
- ConflictBadge: count of sync conflicts, click to resolve

**VISUAL UPGRADES:**
- Sync status: animated pulse when syncing, static when idle
- Speed graph: real-time line graph with gradient fill
- Repo rows: status icon (checkmark for synced, spinner for syncing, warning for conflict)
- Device status: green dot for connected, gray for disconnected
- Conflict badge: red with count

**CAPABILITY PRESENTATION:**
- Surface "sync status" as hero indicator
- Show "connected devices" as stat tile
- Quick actions: "Force Sync", "Pause Sync", "View Conflicts", "Add Folder"

**LENS IDENTITY:** "Sync status" — clean, at-a-glance, trustworthy. Think Syncthing meets Resilio.

**RESPONSIVE DESIGN:**
- Mobile: stacked panels, status as hero
- Tablet: two-column
- Desktop: full dashboard

**BEFORE/AFTER CONCEPT:**
- BEFORE: Minimal stacked panels
- AFTER: At-a-glance sync status with speed graph, device list, conflict tracking

**IMPLEMENTATION PLAN:**
1. Build SyncStatusIndicator
2. Add SyncSpeed real-time graph
3. Redesign RepoRow with status icons
4. Build DeviceList
5. Add ConflictBadge
6. Add "force sync" and "pause" actions
7. Refine visual hierarchy
8. Mobile responsive pass

**PRIORITY:** P2 — compact is appropriate, needs visual clarity not expansion

**DESIGN SCORE:** 5/10 — too minimal, needs clarity

**UPGRADE POTENTIAL:** 6/10 — incremental improvements, not structural changes

---

## 25. system

**PURPOSE:** System health monitoring and operations dashboard.

**CURRENT DESIGN:** Health panel with dynamic imports for analytics. Uses LensShell, ManifestActionBar. Framer-motion + AnimatePresence. Neutral/gray accents. SystemHealthPanel, AnalyticsDashboard (lazy loaded).

**DESIGN DIRECTION:** Grafana/Datadog — system health is about real-time monitoring, the UI should feel like an operations dashboard with live metrics.

**LAYOUT UPGRADE:**
- Persistent header: system status (healthy/degraded/down), uptime, last check time
- Main area: metric cards grid (CPU, memory, disk, network, processes)
- Right sidebar: alerts, recent events
- Bottom panel: system log (scrollable)

**COMPONENT-LEVEL CHANGES:**
- SystemStatus: large indicator with status text, uptime counter
- MetricCard: metric name, current value, threshold indicator (green/yellow/red), trend sparkline
- AlertCard: severity, message, timestamp, acknowledge button
- EventRow: timestamp, event type, source, message
- LogLine: timestamp, level (info/warn/error), source, message

**VISUAL UPGRADES:**
- System status: large colored indicator (green = healthy, yellow = degraded, red = down)
- Metric cards: threshold colors (green = normal, yellow = warning, red = critical)
- Sparklines: mini charts inside metric cards
- Alerts: severity-colored left border
- Log: color-coded by level (info = blue, warn = amber, error = red)

**CAPABILITY PRESENTATION:**
- Surface "system status" as hero indicator
- Show "uptime" as stat tile
- Quick actions: "Run Diagnostics", "View Logs", "Acknowledge Alert", "Export Report"

**LENS IDENTITY:** "Operations center" — real-time, precise, authoritative. Think Grafana meets Datadog.

**RESPONSIVE DESIGN:**
- Mobile: stacked metric cards, alerts below
- Tablet: 2-column metric grid
- Desktop: full dashboard with sidebar

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic health panel with lazy analytics
- AFTER: Operations dashboard with live metrics, alerts, and system logs

**IMPLEMENTATION PLAN:**
1. Build SystemStatus hero indicator
2. Build MetricCard with sparklines
3. Add threshold color coding
4. Build AlertCard panel
5. Build EventRow and LogLine components
6. Add system log panel
7. Add "run diagnostics" action
8. Mobile responsive pass

**PRIORITY:** P1 — needs operations dashboard treatment

**DESIGN SCORE:** 5/10 — too minimal for system monitoring

**UPGRADE POTENTIAL:** 7/10 — clear reference (Grafana, Datadog) with achievable improvements

---

## 26. telecommunications

**PURPOSE:** Telco network management with RF planner, topology, and spectrum analysis.

**CURRENT DESIGN:** Workbench with RF planner, repos, action panel. Uses LensShell, ManifestActionBar, AutoActionStrip, PipingProvider, LensPageShell (unique import). Blue/indigo accents. TelcoRepos, TelecommunicationsActionPanel, RFPlanner.

**DESIGN DIRECTION:** Cisco DNA Center meets RF planning tool — telecommunications is about network visibility and optimization, the UI should feel like a network operations center.

**LAYOUT UPGRADE:**
- Persistent header: network health (online/offline sites), spectrum utilization, active alerts
- Main area: split view — Network Topology (left 60%), RF Planner (right 40%)
- Bottom panel: spectrum analysis charts
- Right sidebar: site list, equipment inventory

**COMPONENT-LEVEL CHANGES:**
- NetworkTopology: node graph visualization (sites, links, status)
- RFPlanner: coverage map overlay, signal strength heatmap, interference indicators
- SiteCard: site name, status, equipment count, last heartbeat
- SpectrumChart: frequency utilization bar chart, interference markers
- AlertCard: type (link down, interference, capacity), severity, affected sites

**VISUAL UPGRADES:**
- Network topology: node graph with status-colored nodes (green = online, red = offline, yellow = degraded)
- RF coverage: heatmap overlay with signal strength gradient (green = strong, red = weak)
- Spectrum chart: frequency bars with utilization color coding
- Site status: pulsing indicator for real-time heartbeat
- Alert severity: critical = red, warning = amber, info = blue

**CAPABILITY PRESENTATION:**
- Surface "network health" as hero indicator
- Show "sites online" as stat tile
- Quick actions: "Plan Coverage", "Run Diagnostics", "View Spectrum", "Export Report"

**LENS IDENTITY:** "Network operations" — technical, precise, real-time. Think Cisco DNA Center meets RF planner.

**RESPONSIVE DESIGN:**
- Mobile: stacked layout, topology as list
- Tablet: two-column
- Desktop: full workbench with topology and RF planner

**BEFORE/AFTER CONCEPT:**
- BEFORE: Basic workbench with RF planner
- AFTER: Network operations center with topology visualization, RF coverage map, spectrum analysis

**IMPLEMENTATION PLAN:**
1. Build NetworkTopology visualization
2. Add RF coverage heatmap overlay
3. Build SiteCard with status indicators
4. Build SpectrumChart
5. Add network health hero indicator
6. Build equipment inventory panel
7. Add "plan coverage" action
8. Mobile responsive pass

**PRIORITY:** P1 — needs network operations center treatment

**DESIGN SCORE:** 4/10 — too minimal for telecom management

**UPGRADE POTENTIAL:** 7/10 — clear reference (Cisco DNA Center) with achievable improvements

---

## 27. temporal

**PURPOSE:** Temporal forecasting and time-series analysis workbench.

**CURRENT DESIGN:** Single workbench layout with repos panel. Uses LensShell, ManifestActionBar, RecentMineCard. Dark neutral with subtle accents. ForecastWorkbench, TemporalRepos. Very compact (~300 lines).

**DESIGN DIRECTION:** Prophet/Forecastly — temporal forecasting is about data visualization, the UI should feel like a forecasting tool with clear chart focus.

**LAYOUT UPGRADE:**
- Persistent header: forecast model selector, time range, accuracy metrics
- Main area: forecast chart (full-width, dominant)
- Left sidebar: data source selector, model parameters
- Right sidebar: forecast results, accuracy metrics, confidence intervals
- Bottom panel: historical data table

**COMPONENT-LEVEL CHANGES:**
- ForecastChart: line chart with historical data, forecast line, confidence interval shading
- ModelSelector: dropdown with model types (ARIMA, Prophet, LSTM, etc.), accuracy comparison
- ParameterPanel: model-specific parameters with sliders
- AccuracyMetric: MAE, RMSE, MAPE values with trend indicators
- DataTable: sortable columns with historical values and actuals

**VISUAL UPGRADES:**
- Forecast chart: historical = solid line, forecast = dashed line, confidence = gradient shading
- Model selector: accuracy badge next to each model name
- Parameters: sliders with current value display
- Accuracy metrics: color-coded (green = good, yellow = fair, red = poor)
- Confidence intervals: semi-transparent gradient fill

**CAPABILITY PRESENTATION:**
- Surface "forecast accuracy" as hero metric
- Show "next predicted value" as prominent display
- Quick actions: "Run Forecast", "Compare Models", "Export Data", "View History"

**LENS IDENTITY:** "Forecasting tool" — precise, data-driven, analytical. Think Prophet meets Forecastly.

**RESPONSIVE DESIGN:**
- Mobile: stacked layout, chart full-width
- Tablet: two-column (chart + parameters)
- Desktop: full workbench with chart dominant

**BEFORE/AFTER CONCEPT:**
- BEFORE: Minimal workbench with repos
- AFTER: Forecast-focused tool with dominant chart, model selector, accuracy metrics

**IMPLEMENTATION PLAN:**
1. Build ForecastChart with confidence intervals
2. Build ModelSelector with accuracy badges
3. Build ParameterPanel with sliders
4. Add AccuracyMetric display
5. Build DataTable for historical data
6. Make chart the dominant visual element
7. Add "run forecast" action
8. Mobile responsive pass

**PRIORITY:** P1 — needs forecast chart focus, not minimal workbench

**DESIGN SCORE:** 4/10 — too minimal for forecasting tool

**UPGRADE POTENTIAL:** 7/10 — clear reference (Prophet, Forecastly) with achievable improvements

---

## Summary

| Lens | Priority | Score | Upgrade Potential |
|---|---|---|---|
| saved | P1 | 4/10 | 8/10 |
| schema | P1 | 5/10 | 7/10 |
| science | P1 | 5/10 | 8/10 |
| security | P0 | 3/10 | 9/10 |
| self | P1 | 5/10 | 8/10 |
| sentinel | P2 | 6/10 | 6/10 |
| services | P1 | 4/10 | 7/10 |
| sessions | P1 | 5/10 | 7/10 |
| settings | P2 | 6/10 | 5/10 |
| sim | P1 | 5/10 | 7/10 |
| social | P1 | 5/10 | 8/10 |
| society | P1 | 5/10 | 7/10 |
| space | P1 | 5/10 | 8/10 |
| spectate | P1 | 4/10 | 8/10 |
| sponsorship | P2 | 5/10 | 6/10 |
| sports | P1 | 5/10 | 8/10 |
| srs | P1 | 4/10 | 8/10 |
| staking | P2 | 6/10 | 6/10 |
| strategic-adds | P2 | 5/10 | 6/10 |
| studio | P2 | 7/10 | 6/10 |
| sub-worlds | P1 | 5/10 | 7/10 |
| suffering | P1 | 5/10 | 7/10 |
| supplychain | P1 | 4/10 | 7/10 |
| sync | P2 | 5/10 | 6/10 |
| system | P1 | 5/10 | 7/10 |
| telecommunications | P1 | 4/10 | 7/10 |
| temporal | P1 | 4/10 | 7/10 |

**Batch 9 Summary:**
- **P0 (redesign immediately):** 1 lens (security)
- **P1 (major visual upgrade):** 18 lenses
- **P2 (polish):** 8 lenses
- **P3 (already strong):** 0 lenses
- **Average design score:** 4.9/10
- **Average upgrade potential:** 7.1/10

**Key themes across Batch 9:**
1. **Security lenses (security, sentinel)** need authoritative, urgent visual treatment
2. **Data-heavy lenses (staking, supplychain, self)** need dashboard organization with stat tiles and charts
3. **Creative tools (studio, science, sim, sports)** need visual excitement matching their domain energy
4. **Learning tools (srs, temporal, suffering)** need focused, distraction-free interfaces
5. **Infrastructure lenses (sync, system, telecommunications)** need at-a-glance monitoring with live indicators
6. **Social/community lenses (social, society, sponsorship)** need warmth and engagement
7. **World/metaverse lenses (spectate, sub-worlds, space)** need atmospheric, portal-like experiences

**Batch 9 is complete.** All 27 lenses have been audited with implementation-ready detail for a coding worker.