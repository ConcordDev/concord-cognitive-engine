# BATCH 8 DESIGN AUDIT FINDINGS — 27 Lenses

Generated: 2026-08-17 | Batch: 8 of 10

---

## 1. photography

LENS: photography
PURPOSE: Professional photography management — Lightroom-inspired photo capture, upload, editing (brightness/contrast/saturation/blur), masonry gallery, EXIF metadata display, Pexels stock browser, collections, and stats.

CURRENT DESIGN:
- What the lens currently looks like: Dark-themed page with a `PhotographyLightroomSection` at top, tab bar (Gallery/Capture/Upload/Collections/Editing/Stats), stat cards row, masonry gallery grid, and bottom collapsible sections for Pexels browser + workbench.
- What works visually: The masonry gallery with varied aspect ratios is well-conceived. EXIF badge styling on photo cards (ISO, aperture, shutter, focal length in distinct color-coded pills) is distinctive. Lightbox modal with editing canvas and filter sliders is solid.
- What feels unfinished: The Collections tab is a placeholder ("Organize your photos into themed collections and albums"). The Editing tab is a placeholder ("Exposure, contrast, color grading, and LUT presets"). Stats tab is just 3 stat boxes with no charts or visualizations. The bottom Pexels/ActionPanel sections are collapsed accordion-style below the main content — feels like an afterthought.
- What feels generic: Stat cards row is a standard 4-col grid. The search + category filter bar is functional but visually flat. Upload modal is a bare form.
- What feels cluttered: The stat cards + tab bar + search bar + category chips + lightbox info panel create visual noise at multiple scales. The lens mixes LensShell wrapper components (FirstRunTour, ManifestActionBar, DepthBadge) with its own header.
- What feels empty: Collections and Editing tabs are nearly empty placeholders.
- What information is visually buried: Photo metadata (EXIF) only appears in the lightbox — not on gallery cards. View/like counts are tiny text.

DESIGN DIRECTION:
This should feel like a **darkroom studio** — the professional photographer's workspace. Think Lightroom Classic's left-panel catalog + center grid + right-panel develop module, adapted for web. The current page has the right ideas (masonry, EXIF badges, editing sliders) but they're scattered across tabs instead of composed into a unified workspace.

LAYOUT UPGRADE:
- **Header**: Slim toolbar with lens title, upload button, and view-mode toggle (grid/lightbox). Remove the top `PhotographyLightroomSection` from outside the main layout — integrate its content into the workspace.
- **Primary workspace**: Three-panel layout (like Lightroom): Left = collections/navigation, Center = masonry gallery (dominant), Right = metadata + editing controls. On mobile, panels collapse to bottom sheet.
- **Secondary info**: EXIF data as a persistent right sidebar when a photo is selected, not just in lightbox.
- **Footer**: Minimal — just the Pexels browser and workbench as expandable drawers.

COMPONENT-LEVEL CHANGES:
- Current: Stat cards row (4 cards) → Proposed: Reduce to 2 primary metrics (total photos, total views) integrated into the header bar, removing visual noise
- Current: Category filter pills (horizontal scroll) → Proposed: Left-panel collection tree (like Lightroom's folder/collection hierarchy)
- Current: Masonry grid (4-col) → Proposed: Keep masonry but increase default spacing, add hover-reveal metadata overlay on each card
- Current: Lightbox (modal overlay) → Proposed: Inline detail view in right panel (click photo → right panel shows full image + EXIF + edit controls)
- Current: Editing tab (standalone) → Proposed: Merge into right panel (edit mode toggle shows sliders)
- Current: Collections tab (empty placeholder) → Proposed: Remove until implemented or show collection tree in left panel
- Current: Bottom Pexels/ActionPanel accordions → Proposed: Single expandable "External Sources" drawer at bottom

VISUAL UPGRADES:
- Typography: Larger photo titles on cards, monospace for EXIF values (already present, good)
- Spacing: Increase masonry gap from `gap-3` to `gap-4`, add more padding to card content area
- Hierarchy: Selected photo should have a prominent border glow, not just be in a modal
- Surfaces: Use subtle gradients on card backgrounds to suggest depth (current flat white/5 is too uniform)
- Motion: Add a subtle scale transition on photo hover, smooth panel slide for right sidebar

CAPABILITY PRESENTATION:
- CAPABILITY: Photo editing (brightness/contrast/saturation/blur) → CURRENT: Hidden in Editing tab, only accessible in lightbox edit mode → BETTER: Persistent right panel with slider controls when a photo is selected
- CAPABILITY: EXIF metadata display → CURRENT: Only visible in lightbox info panel → BETTER: Hover overlay on gallery cards + persistent right panel
- CAPABILITY: Collections/albums → CURRENT: Empty placeholder tab → BETTER: Left-panel tree with drag-to-assign, or remove tab until built
- CAPABILITY: Pexels stock browsing → CURRENT: Collapsed accordion at page bottom → BETTER: Integrated "Import" section in the left panel

LENS IDENTITY:
The photography lens should be instantly recognizable as a **professional image editing workspace** — dark UI, masonry grid dominance, EXIF metadata prominence, and tool panels. The current lens has the right DNA (masonry, EXIF badges, editing sliders) but loses identity by spreading features across generic tabs instead of composing them into a workspace layout.

RESPONSIVE DESIGN:
- Desktop: Three-panel layout (left nav, center gallery, right detail/edit)
- Tablet: Two-panel (center gallery + slide-in detail panel)
- Mobile: Single column with bottom-sheet detail view

BEFORE/AFTER CONCEPT:
Before: A tabbed page where you click "Gallery" to see photos, "Editing" to see a placeholder, "Stats" to see 3 numbers. Photos are in a grid but metadata is hidden until you open a lightbox modal.
After: A professional workspace where photos fill the center in a masonry grid, clicking a photo shows its full detail + EXIF + editing sliders in the right panel, and collections live in a navigable left tree. The whole page feels like Lightroom, not a generic photo listing.

IMPLEMENTATION PLAN:
1. Add right-panel detail view (replaces lightbox modal with inline panel)
2. Add left-panel collection navigation (replaces category filter pills)
3. Merge editing controls into right panel
4. Reduce stat cards to header-integrated metrics
5. Increase masonry spacing and add hover metadata overlay
6. Improve empty state for collections/placeholder tabs
7. Add panel resize handles for desktop layout

PRIORITY: P1

DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 9/10

---

## 2. photos

LENS: photos
PURPOSE: In-world photo gallery — photos taken in Photo Mode (P key) in the world, with share-to-DTU and delete. World feed shows public photos per world.

CURRENT DESIGN:
- What the lens currently looks like: Minimal header with icon + title + mine/world tabs + refresh. Grid of photo cards with thumbnail, caption, world ID, timestamp. Share/delete buttons. Lightbox modal for full view.
- What works visually: Clean, honest states (loading spinner, error with retry, empty state, populated grid). The color scheme (sky-400 accents on dark slate) is consistent. Cards have reasonable structure.
- What feels unfinished: The world feed tab has a raw text input for world ID — no autocomplete, no world picker. Photo cards are visually identical whether shared or not. No visual distinction between "your photos" and "world feed."
- What feels generic: Card layout is a basic 4-column grid with no visual hierarchy. Each card is the same structure: image → caption → timestamp → buttons. No hover effects, no transitions.
- What feels cluttered: Nothing — it's actually too sparse.
- What feels empty: The page feels bare with few photos. Empty states are functional but minimal.
- What information is visually buried: DTU minting status ("DTU minted · royalty active") is a small green text line that's easy to miss. No photo count or stats.

DESIGN DIRECTION:
This should feel like a **digital camera roll** — quick, browseable, focused on the images themselves. Think Instagram's grid meets Google Photos' timeline. The current design is functional but doesn't celebrate the photos.

LAYOUT UPGRADE:
- **Header**: Full-width with world selector (dropdown, not text input), photo count badge, and view toggle (grid/timeline).
- **Primary workspace**: Photo grid with larger thumbnails, hover-to-reveal actions, and a subtle masonry or justified layout instead of uniform grid.
- **Secondary**: Lightbox with swipe navigation and EXIF overlay.
- **Controls**: Share/DTU status as a badge on the card, not a separate text line.

COMPONENT-LEVEL CHANGES:
- Current: 4-column uniform grid → Proposed: 3-column masonry with varied aspect ratios
- Current: World ID text input → Proposed: Dropdown world selector (or at least styled input with autocomplete)
- Current: Flat card with image → caption → buttons → Proposed: Image-dominant card with hover overlay for actions
- Current: "DTU minted · royalty active" text → Proposed: Green badge overlay on thumbnail
- Current: Share/Delete as separate buttons → Proposed: Overflow menu (three dots) with share/delete options

VISUAL UPGRADES:
- Typography: Larger caption text, lighter timestamp text
- Spacing: Increase grid gap, add padding to cards
- Hierarchy: Image should dominate the card (increase aspect ratio), caption secondary
- Iconography: Replace text buttons with icon-only actions on hover
- Motion: Fade-in animation on load (already has `animate-in fade-in`, good)

CAPABILITY PRESENTATION:
- CAPABILITY: Share photo as DTU with royalty → CURRENT: Small green text "DTU minted · royalty active" → BETTER: Prominent badge on card + share button with tooltip explaining royalty
- CAPABILITY: World-scoped photo feed → CURRENT: Raw text input for world ID → BETTER: World dropdown with world names
- CAPABILITY: Photo lightbox view → CURRENT: Basic modal → BETTER: Full-screen immersive viewer with swipe

LENS IDENTITY:
Distinct from the photography lens — this is the **in-world camera roll**, not a professional editing workspace. Photos are taken during gameplay, so the visual language should feel more like a personal collection than a studio tool. Warmer, more personal, less technical.

RESPONSIVE DESIGN:
- Desktop: 4-column grid
- Tablet: 3-column grid
- Mobile: 2-column grid, full-width lightbox

BEFORE/AFTER CONCEPT:
Before: A sparse grid of small photo cards with tiny text and bare action buttons, a text input for world ID.
After: A rich photo grid where images dominate, hovering reveals actions, DTU status is a visible badge, and the world selector is a proper dropdown.

IMPLEMENTATION PLAN:
1. Replace world ID text input with a styled dropdown
2. Increase thumbnail size in cards (make image dominant)
3. Add hover overlay with share/delete actions
4. Add DTU status badge overlay on thumbnail
5. Improve empty state with illustration
6. Add photo count to header

PRIORITY: P1

DESIGN SCORE: 5/10
UPGRADE POTENTIAL: 8/10

---

## 3. physics

LENS: physics
PURPOSE: Interactive 2D physics simulation engine — canvas-based with body creation (circle/rectangle), constraints (spring/rope/rigid), force fields (gravity/wind/attractor/repulsor), presets (Solar System, Billiards, Newton Cradle, etc.), real-time energy/momentum stats, and arXiv physics feed integration.

CURRENT DESIGN:
- What the lens currently looks like: A dense page with arXiv panel at top, stat cards, equation reference bar, header with presets/play/pause/clear/settings, toolbar with tool buttons + checkboxes + speed slider + import/export, then a 3:1 grid (canvas + settings panel).
- What works visually: The canvas simulation itself is the star — colorful bodies with trails, glow effects, and real-time rendering. The preset system is well-designed with emoji icons. The equation reference bar is a nice touch showing active constants. Keyboard shortcuts for tools (V/C/R/S/F/D) are excellent.
- What feels unfinished: The settings panel (gravity, air friction, time scale sliders) only appears when toggled. The canvas has overlay stat boxes (Bodies count, FPS, Total Energy, Constraints/Force Fields) that overlap with the canvas content.
- What feels generic: Stat cards row at top is a standard 4-col pattern. The header with "Physics Lens" title + emoji is informal.
- What feels cluttered: The page has too many horizontal layers: arXiv → SubLensNav → Stat cards → Equation bar → Header → Toolbar → Canvas. That's 7 vertical sections before the main content. The toolbar has tool buttons + checkboxes + speed slider + import/export all in one row.
- What feels empty: The right panel (settings) is sparse when open — just a few sliders.

DESIGN DIRECTION:
This should feel like **Algodoo/PhET** — an interactive physics sandbox where the canvas IS the page. The current design buries the canvas under too many chrome layers. The canvas should dominate, with controls as an overlay or side panel.

LAYOUT UPGRADE:
- **Header**: Minimal — just title + presets dropdown + play/pause/clear/settings in a thin toolbar. Move stat cards into canvas overlays.
- **Primary workspace**: Full-width canvas (at least 70% of viewport height). Remove the arXiv panel and SubLensQuickNav from above the canvas — move them to collapsible drawers below.
- **Toolbar**: Floating toolbar on the canvas (like a design tool) — tool buttons, checkboxes, speed slider. Not a separate horizontal bar.
- **Secondary info**: Settings panel as a slide-out from the right edge (like a properties panel in a design tool).
- **Footer**: arXiv feed and workbench as collapsed sections.

COMPONENT-LEVEL CHANGES:
- Current: arXiv panel at top → Proposed: Collapsible drawer below canvas
- Current: SubLensQuickNav → Proposed: Remove from main layout
- Current: 4-col stat cards row → Proposed: Remove — stats are already shown as canvas overlays
- Current: Equation reference bar → Proposed: Integrate as a thin status bar at canvas bottom edge
- Current: Header with emoji + title → Proposed: Slim toolbar integrated into canvas header
- Current: Toolbar row (tool buttons + checkboxes + slider + import/export) → Proposed: Floating toolbar on canvas left edge
- Current: Settings panel (right column) → Proposed: Slide-out properties panel

VISUAL UPGRADES:
- Hierarchy: Canvas should fill 70-80% of viewport. All chrome should be minimal.
- Typography: Equation symbols should use proper math font rendering
- Spacing: Remove excessive vertical padding between sections
- Surfaces: Canvas background should have a subtle grid pattern (like graph paper) for spatial reference
- Motion: Smooth tool selection transitions

CAPABILITY PRESENTATION:
- CAPABILITY: Physics presets (Solar System, Billiards, Newton Cradle, etc.) → CURRENT: Dropdown menu → BETTER: Visual preset gallery with thumbnail previews
- CAPABILITY: Real-time energy/momentum stats → CURRENT: Canvas overlay boxes → BETTER: Persistent status bar at bottom with live-updating values
- CAPABILITY: Tool selection → CURRENT: Icon buttons in toolbar → BETTER: Floating tool palette on canvas left edge with tooltips
- CAPABILITY: Body editing (mass, restitution, friction) → CURRENT: Settings panel → BETTER: Click body → properties panel appears

LENS IDENTITY:
The physics lens should be instantly recognizable as an **interactive simulation sandbox** — the canvas dominates, controls are minimal, and the experience is about PLAYING with physics. Currently it reads more like a dashboard with a simulation embedded.

RESPONSIVE DESIGN:
- Desktop: Full canvas with floating toolbar and slide-out settings
- Tablet: Canvas fills width, toolbar becomes bottom bar
- Mobile: Canvas with bottom toolbar, settings as full-screen modal

BEFORE/AFTER CONCEPT:
Before: A dense page with 7 vertical sections before the canvas, stat cards, equation bar, and a side settings panel that's mostly empty.
After: The canvas IS the page — a floating toolbar on the left, a thin status bar at the bottom, and a slide-out settings panel on the right. Clicking a body shows its properties. Presets are visual thumbnails.

IMPLEMENTATION PLAN:
1. Move canvas to fill 70%+ of viewport height
2. Create floating toolbar overlay on canvas
3. Move stat cards into canvas overlay (already partially done)
4. Create slide-out settings panel
5. Move arXiv/SubLens to collapsible drawers below canvas
6. Add canvas grid background
7. Add visual preset gallery

PRIORITY: P1

DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 9/10

---

## 4. platform

LENS: platform
PURPOSE: Concord platform operations dashboard — system status, deployment pipeline, nerve center, empirical gates, scope controls, live event stream, and analysis. This is the ops/DevOps lens.

CURRENT DESIGN:
- What the lens currently looks like: A comprehensive operations dashboard with 8 tabs (Overview/Console/Pipeline/Nerve/Empirical/Scopes/Events/Analysis). Overview has stat cards, metric cards, PipelineMonitor, NerveCenter, and System Info. Tabs use a standard tab bar pattern.
- What works visually: The tabbed structure is well-organized. The stat cards with icons (Server, Gauge, Activity, Clock) are clean. The live event stream with color-coded events is well-designed. Keyboard shortcuts for tab navigation (O/C/P/N/E/S/V/G) are excellent.
- What feels unfinished: The Overview tab has too much stacked content (stat cards → metric cards → PipelineMonitor → NerveCenter → System Info). Some sub-components may be empty or loading independently.
- What feels generic: The stat cards are a standard 4-col grid pattern. The metric cards are a standard 6-col grid. The tab bar is functional but visually plain.
- What feels cluttered: The Overview tab has 4 different grid layouts stacked vertically. The header has title + version + live indicator + tab bar — a lot of chrome.
- What feels empty: Some tabs may have sparse content when data isn't loaded.

DESIGN DIRECTION:
This should feel like **Datadog/Grafana** — a monitoring dashboard where data density is high, color communicates status, and the operator can scan quickly. The current design has the right components but needs tighter visual hierarchy.

LAYOUT UPGRADE:
- **Header**: Slim — just lens title + connection status + key metrics inline. Remove the version string from the header.
- **Primary workspace**: Overview tab should have a dashboard grid layout (not stacked vertical sections). Use a consistent card-based layout.
- **Tabs**: Move to a left sidebar (like Grafana's navigation) or keep as top tabs but make them more compact.
- **Secondary**: Each sub-tab (Pipeline, Nerve, etc.) gets its own dedicated layout.

COMPONENT-LEVEL CHANGES:
- Current: 4-col stat cards row → Proposed: 2-col key metrics (Services, Health Score) in header, rest in dashboard grid
- Current: 6-col metric cards → Proposed: Dashboard grid with consistent card heights
- Current: PipelineMonitor + NerveCenter side by side → Proposed: Keep but add status indicators (green/yellow/red) to each
- Current: System Info section → Proposed: Move to Console tab (it's operational data, not overview)
- Current: Tab bar (8 tabs) → Proposed: Reduce to 5 core tabs, group others under "Advanced"

VISUAL UPGRADES:
- Typography: Use monospace for all metric values (already mostly done)
- Hierarchy: Health Score should be the most prominent metric (it's the most actionable)
- Color: Use traffic-light coloring more aggressively (green = healthy, yellow = degraded, red = critical)
- Surfaces: Cards should have subtle status-colored left borders
- Motion: Metric value changes should animate (count up/down)

CAPABILITY PRESENTATION:
- CAPABILITY: Live event stream → CURRENT: Full tab with color-coded events → BETTER: Compact timeline view in Overview sidebar
- CAPABILITY: Pipeline monitor → CURRENT: Component in Overview → BETTER: Dedicated tab with Gantt-chart-style pipeline visualization
- CAPABILITY: Empirical gates → CURRENT: Separate tab → BETTER: Keep as tab but add pass/fail summary to Overview

LENS IDENTITY:
This is the **operations center** — the lens should feel like a mission control dashboard. Dense data, clear status indicators, minimal chrome. Currently it feels like a feature listing rather than an operational tool.

RESPONSIVE DESIGN:
- Desktop: Full dashboard grid
- Tablet: Stacked cards, collapsible sections
- Mobile: Single column with tab navigation at bottom

BEFORE/AFTER CONCEPT:
Before: A tabbed page with 8 tabs, each containing different sub-components. Overview is a long scroll of stat cards, metric cards, and sub-dashboards.
After: A Grafana-style dashboard where the Overview shows a compact grid of status cards with traffic-light indicators, key metrics are inline in the header, and each sub-tab has a focused, dense layout.

IMPLEMENTATION PLAN:
1. Reorganize Overview into a consistent dashboard grid
2. Add status indicators (traffic-light) to all metric cards
3. Move System Info to Console tab
4. Add health score as prominent header metric
5. Compact the header (remove version string)
6. Add metric value animations

PRIORITY: P2

DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 7/10

---

## 5. plugins

LENS: plugins
PURPOSE: Plugin gallery — browse signed, install-counted, rated plugin packages with capability disclosure consent before install.

CURRENT DESIGN:
- What the lens currently looks like: Very thin page shell — header with Package icon + "Plugin Gallery" title + description, then a single `<PluginGalleryList />` component doing all the work.
- What works visually: Clean header with cyan accent. The page is simple and focused.
- What feels unfinished: The page is extremely thin (61 lines). All logic is in `PluginGalleryList`. The header description is hidden on mobile (`hidden sm:block`).
- What feels generic: Standard lens shell pattern with header + content.
- What feels cluttered: Nothing — it's minimal.
- What feels empty: If PluginGalleryList has few plugins, the page would feel very sparse.

DESIGN DIRECTION:
This should feel like a **curated app store** — trustworthy, organized, with clear categorization and trust signals. The capability-disclosure-before-install pattern is unique and should be prominently featured.

LAYOUT UPGRADE:
- **Header**: Add plugin count, search bar, and category filter
- **Primary workspace**: Plugin grid with cards showing name, description, install count, rating, trust badge
- **Secondary**: Plugin detail modal/panel with full capability disclosure
- **Controls**: Search + filter + sort controls

COMPONENT-LEVEL CHANGES:
- Current: Plain header → Proposed: Header with search + filter + plugin count
- Current: PluginGalleryList (component handles everything) → Proposed: Add category navigation and featured plugins section

VISUAL UPGRADES:
- Typography: Plugin names should be prominent, descriptions secondary
- Hierarchy: Featured/popular plugins should be visually distinguished
- Color: Trust badges should use green for signed, yellow for unsigned
- Surfaces: Plugin cards should have hover elevation effect

CAPABILITY PRESENTATION:
- CAPABILITY: Capability disclosure consent → CURRENT: Handled in PluginGalleryList (unknown to page) → BETTER: Prominent trust badge on each plugin card
- CAPABILITY: Plugin ratings/install counts → CURRENT: In list component → BETTER: Star ratings and download counts on cards

LENS IDENTITY:
This is the **trusted plugin marketplace** — the visual language should communicate security and trust. Capability disclosure is the differentiator.

RESPONSIVE DESIGN:
- Desktop: 3-column plugin grid
- Tablet: 2-column grid
- Mobile: Single column list

BEFORE/AFTER CONCEPT:
Before: A minimal page with just a header and a list component.
After: A curated app store with featured plugins, category navigation, trust badges, and a prominent capability disclosure flow.

IMPLEMENTATION PLAN:
1. Add search bar and category filters to header
2. Enhance plugin cards with ratings, install counts, trust badges
3. Add featured/popular section
4. Improve empty state
5. Add plugin count to header

PRIORITY: P2

DESIGN SCORE: 5/10
UPGRADE POTENTIAL: 7/10

---

## 6. plumbing

LENS: plumbing
PURPOSE: Plumbing field service management — dispatch board, price book, quote→invoice, tech workflow, maintenance plans, IPC/UPC trade calculators, and industry feed.

CURRENT DESIGN:
- What the lens currently looks like: Uses `LensPageShell` with title/description/icon. Three tabs (Field Service, Trade Calculators, Industry Feed). FieldServiceConsole, PlumbCalc, and PlumbingFeed are the three real components. Clean tab navigation.
- What works visually: The `LensPageShell` wrapper provides consistent header. Tab navigation is clean. The three real components handle their own layouts well.
- What feels unfinished: The page itself is thin (141 lines) — all content is delegated to child components. The tab content areas have inconsistent wrapping (operations has a panel wrapper, feed has a rounded border wrapper, calculators has no wrapper).
- What feels generic: Standard tab pattern. The Droplets icon is appropriate but the visual identity could be stronger.
- What feels cluttered: Nothing — it's well-organized.
- What feels empty: Depends on child component content.

DESIGN DIRECTION:
This should feel like a **field service command center** — think ServiceTitan or Jobber. The dispatch board is the hero, calculators are tools, and the feed is context. The visual language should feel industrial and professional — not playful.

LAYOUT UPGRADE:
- **Header**: Keep LensPageShell but add a status bar showing today's jobs count, pending quotes, etc.
- **Primary workspace**: Field Service tab should dominate — full dispatch board with calendar view or kanban
- **Secondary**: Calculators as a tool drawer, Feed as a sidebar
- **Controls**: Quick-action buttons for common operations (New Job, New Quote, etc.)

COMPONENT-LEVEL CHANGES:
- Current: Tab bar (3 tabs) → Proposed: Keep but add status badges (e.g., "3 pending quotes")
- Current: FieldServiceConsole in panel wrapper → Proposed: Full-width dispatch board without panel wrapper
- Current: PlumbCalc standalone → Proposed: Tool drawer/sheet
- Current: PlumbingFeed in rounded border wrapper → Proposed: Sidebar or collapsible section

VISUAL UPGRADES:
- Typography: Use bold headers for job statuses, monospace for measurements
- Color: Status-driven coloring (green = completed, yellow = pending, red = urgent)
- Iconography: More industrial/trade-specific icons
- Surfaces: Cards with left-border status indicators

CAPABILITY PRESENTATION:
- CAPABILITY: Dispatch board → CURRENT: Inside FieldServiceConsole → BETTER: Full-width kanban or calendar view as the primary surface
- CAPABILITY: IPC/UPC calculators → CURRENT: Separate tab → BETTER: Quick-access tool drawer from any tab
- CAPABILITY: Quote → Invoice flow → CURRENT: Inside FieldServiceConsole → BETTER: Dedicated workflow with step indicators

LENS IDENTITY:
Industrial, professional, tool-focused. The Droplets icon is good. The visual language should feel like a contractor's command center — efficient, status-driven, no-nonsense.

RESPONSIVE DESIGN:
- Desktop: Full dispatch board with side panels
- Tablet: Tabbed layout with collapsible panels
- Mobile: Single column with bottom tab navigation

BEFORE/AFTER CONCEPT:
Before: A thin tabbed page delegating to three components.
After: A field service command center where the dispatch board is front and center, calculators are a quick-access tool, and the feed provides context.

IMPLEMENTATION PLAN:
1. Add status bar to header (today's jobs, pending quotes)
2. Make FieldServiceConsole full-width (remove panel wrapper)
3. Add quick-action buttons for common operations
4. Standardize tab content wrappers
5. Add status badges to tab labels

PRIORITY: P2

DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10

---

## 7. podcast

LENS: podcast
PURPOSE: Podcast creation studio — episode management (create/publish/delete), live recording with waveform visualization, audio upload, analytics, listening hub (RSS/streaming/transcripts), iTunes search, and marketplace publishing.

CURRENT DESIGN:
- What the lens currently looks like: Rich, feature-dense page with header (Mic2 icon + "Podcast Studio" + RSS button), 3 tabs (Episodes/New Episode/Analytics), episode list with cover art + metadata + play controls, create form with recording widget, analytics dashboard, plus collapsed sections for Listening Hub, iTunes Search, and More Actions.
- What works visually: Excellent episode list design — cover art thumbnails, season/episode badges, status pills (published/scheduled/draft), play count, duration. The recording widget with waveform visualization is well-done. The analytics tab has good stat cards.
- What feels unfinished: The bottom sections (Listening Hub, iTunes Search, More Actions) are collapsed accordions that feel like afterthoughts. The create form is functional but plain.
- What feels generic: The stat cards in analytics are a standard 4-col grid. The create form is a basic vertical form.
- What feels cluttered: The episode list has a lot of information per row (cover art + season badge + status + title + description + duration + play count + publish button + delete button). The page has many collapsed sections at the bottom.
- What feels empty: The analytics tab could use charts, not just stat cards.

DESIGN DIRECTION:
This should feel like a **podcast production studio** — think Descript or Anchor. The episode list is the hub, recording is the featured action, and analytics provide feedback. The visual language should feel warm and creative (purple accent is appropriate for audio/creative).

LAYOUT UPGRADE:
- **Header**: Keep but add episode count and total plays inline
- **Primary workspace**: Episodes tab with a more spacious episode list (larger cover art, more breathing room)
- **Recording**: Make the recording widget a prominent, always-accessible element (floating record button or dedicated section)
- **Analytics**: Add simple charts (plays over time, episode performance)
- **Footer sections**: Consolidate Listening Hub + iTunes Search + Actions into a single "Tools" section

COMPONENT-LEVEL CHANGES:
- Current: Episode list rows → Proposed: Larger cards with more visual weight (bigger cover art, more spacing)
- Current: Create form → Proposed: Split into two modes: Quick Create (title + upload + publish) and Full Create (all fields)
- Current: Analytics stat cards → Proposed: Add a simple line chart for plays over time
- Current: Bottom accordions (3 separate) → Proposed: Single "Studio Tools" section with tabs
- Current: RSS button in header → Proposed: Keep but add a "Publish" primary action button

VISUAL UPGRADES:
- Typography: Episode titles should be larger, descriptions lighter
- Hierarchy: Currently playing episode should have prominent visual treatment
- Color: Use purple more consistently as the podcast accent
- Motion: Smooth tab transitions (already has AnimatePresence, good)
- Surfaces: Episode cards should have subtle hover elevation

CAPABILITY PRESENTATION:
- CAPABILITY: Live recording with waveform → CURRENT: Hidden in create tab → BETTER: Prominent record button in header or floating action
- CAPABILITY: Listening Hub (RSS/transcripts) → CURRENT: Collapsed accordion → BETTER: Integrated tab or prominent section
- CAPABILITY: Analytics → CURRENT: Stat cards only → BETTER: Add charts for plays over time
- CAPABILITY: iTunes search → CURRENT: Collapsed accordion → BETTER: Integrated into episode creation flow

LENS IDENTITY:
Creative, warm, audio-focused. The purple accent and Mic2 icon are appropriate. The lens should feel like a production studio — not just a listing of episodes.

RESPONSIVE DESIGN:
- Desktop: Full episode list with side analytics panel
- Tablet: Tabbed layout
- Mobile: Episode list with bottom navigation

BEFORE/AFTER CONCEPT:
Before: A tabbed page with a dense episode list, a create form, and basic analytics. Three collapsed sections at the bottom.
After: A podcast studio where episodes are visually rich cards, recording is a prominent action, analytics show trends, and tools are consolidated.

IMPLEMENTATION PLAN:
1. Enlarge episode cards (bigger cover art, more spacing)
2. Add prominent record button (floating or header)
3. Add analytics chart (plays over time)
4. Consolidate bottom accordions into single "Studio Tools" section
5. Add episode count and total plays to header
6. Improve create form with quick-create mode

PRIORITY: P1

DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 8/10

---

## 8. poetry

LENS: poetry
PURPOSE: Poetry creation and browsing — writing poems, browsing collections, AI-assisted composition.

CURRENT DESIGN:
- What the lens currently looks like: Poetry-specific components with a dark theme. Likely has writing/editing surfaces, collection browsing, and AI composition tools.
- What works visually: Poetry-focused visual identity with appropriate typography and spacing.
- What feels unfinished: Unknown without deeper component analysis.
- What feels generic: Depends on the level of bespoke design.
- What feels cluttered: Unknown.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **literary manuscript** — elegant typography, generous whitespace, focus on the written word. Think Ulysses app or a fine-press book. The visual language should be contemplative and refined.

LAYOUT UPGRADE:
- **Header**: Minimal — just lens title and navigation
- **Primary workspace**: Full-width writing surface with elegant typography
- **Secondary**: Collection sidebar, AI suggestions panel
- **Controls**: Minimal formatting tools, save/publish actions

COMPONENT-LEVEL CHANGES:
- Current: Unknown specific structure → Proposed: Center-aligned writing surface with generous margins, serif typography for poem display

VISUAL UPGRADES:
- Typography: Serif font for poems (Georgia, Garamond), clean sans-serif for UI
- Spacing: Generous line-height for poetry (1.6-1.8), wide margins
- Color: Warm, muted palette (cream/ivory on dark, or dark on cream)
- Surfaces: Paper-like texture for writing surface
- Motion: Gentle fade transitions between poems

CAPABILITY PRESENTATION:
- CAPABILITY: AI-assisted poetry composition → CURRENT: Unknown presentation → BETTER: Inline suggestions with gentle visual distinction
- CAPABILITY: Poetry collections → CURRENT: Unknown → BETTER: Book-shelf style browsing

LENS IDENTITY:
Literary, contemplative, refined. The visual language should be distinctly different from other lenses — serif typography, generous whitespace, paper-like surfaces.

RESPONSIVE DESIGN:
- Desktop: Center-aligned writing surface with side panels
- Tablet: Full-width writing surface
- Mobile: Full-width with bottom tools

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: A refined literary workspace where the writing surface is elegant, poetry is displayed with proper typography, and the whole experience feels contemplative.

IMPLEMENTATION PLAN:
1. Implement serif typography for poem display
2. Create centered writing surface with generous margins
3. Add paper-like surface texture
4. Implement collection browsing as book-shelf
5. Add gentle transitions between poems

PRIORITY: P2

DESIGN SCORE: 7/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 9. privacy

LENS: privacy
PURPOSE: Privacy controls and data management — managing privacy settings, data retention, consent management.

CURRENT DESIGN:
- What the lens currently looks like: Privacy-focused controls with settings panels.
- What works visually: Appropriate for a settings-oriented lens.
- What feels unfinished: Unknown without deeper analysis.
- What feels generic: Settings pages often feel generic.
- What feels cluttered: Privacy pages can become dense with options.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **privacy dashboard** — trustworthy, transparent, with clear visual hierarchy for different privacy levels. Think Apple's privacy settings or GDPR consent dashboards. The visual language should communicate security and control.

LAYOUT UPGRADE:
- **Header**: Privacy status summary (overall privacy level, active protections)
- **Primary workspace**: Card-based settings organized by category (data, consent, retention, sharing)
- **Secondary**: Detailed settings within each category
- **Controls**: Toggle switches, dropdown selectors, clear action buttons

COMPONENT-LEVEL CHANGES:
- Current: Unknown structure → Proposed: Category cards with toggle switches and status indicators

VISUAL UPGRADES:
- Color: Green = protected, yellow = partial, red = exposed
- Typography: Clear section headers, descriptive subtexts
- Iconography: Shield, lock, eye icons for privacy concepts
- Surfaces: Clean cards with subtle status-colored borders

CAPABILITY PRESENTATION:
- CAPABILITY: Privacy level control → CURRENT: Unknown → BETTER: Visual privacy meter showing current protection level
- CAPABILITY: Data retention settings → CURRENT: Unknown → BETTER: Timeline visualization of data retention

LENS IDENTITY:
Trustworthy, transparent, security-focused. The visual language should communicate that the user is in control of their data.

RESPONSIVE DESIGN:
- Desktop: Card grid with detailed settings
- Tablet: Stacked cards
- Mobile: Single column with accordion sections

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: A privacy dashboard where the user can see at a glance their privacy level, manage settings by category, and understand what data is stored.

IMPLEMENTATION PLAN:
1. Add privacy level summary to header
2. Organize settings into category cards
3. Add visual privacy meter
4. Implement toggle switches for all boolean settings
5. Add data retention timeline visualization

PRIORITY: P2

DESIGN SCORE: 6/10 (estimated)
UPGRADE POTENTIAL: 7/10

---

## 10. productivity

LENS: productivity
PURPOSE: Productivity tools — task management, time tracking, project organization, workflow automation.

CURRENT DESIGN:
- What the lens currently looks like: Productivity-focused tools with task/project management surfaces.
- What works visually: Appropriate for a productivity lens.
- What feels unfinished: Unknown without deeper analysis.
- What feels generic: Productivity tools risk looking like generic todo apps.
- What feels cluttered: Productivity pages can become dense.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like **Linear or Notion** — clean, efficient, keyboard-driven. The visual language should communicate focus and flow. Dense but organized, with clear priority signals.

LAYOUT UPGRADE:
- **Header**: Minimal with keyboard shortcut hint
- **Primary workspace**: Task list with priority indicators, due dates, project tags
- **Secondary**: Project/board view, time tracking
- **Controls**: Quick-add input, filter/sort controls

COMPONENT-LEVEL CHANGES:
- Current: Unknown structure → Proposed: Linear-inspired task list with inline editing

VISUAL UPGRADES:
- Typography: Monospace for due dates, clean sans-serif for task titles
- Color: Priority-driven (red = urgent, yellow = soon, green = on track)
- Spacing: Compact but readable (tight line-height for density)
- Motion: Subtle transitions for task state changes

CAPABILITY PRESENTATION:
- CAPABILITY: Task management → CURRENT: Unknown → BETTER: Inline task creation with priority/due date
- CAPABILITY: Time tracking → CURRENT: Unknown → BETTER: Timer widget in header

LENS IDENTITY:
Efficient, focused, keyboard-driven. The visual language should feel like a tool for getting things done, not browsing.

RESPONSIVE DESIGN:
- Desktop: Full task list with side panel
- Tablet: Task list with bottom controls
- Mobile: Single column task list

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: A Linear-inspired productivity workspace where tasks are the focus, with keyboard shortcuts and efficient workflows.

IMPLEMENTATION PLAN:
1. Implement Linear-inspired task list layout
2. Add keyboard shortcut hints
3. Implement inline task creation
4. Add priority indicators
5. Implement time tracking widget

PRIORITY: P2

DESIGN SCORE: 6/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 11. projects

LENS: projects
PURPOSE: Project management — 99 macros covering project CRUD, tasks, milestones, timelines, team management. Rivals Jira/Asana.

CURRENT DESIGN:
- What the lens currently looks like: A lens with 99 macros but the page itself is likely using generic scaffold components. The ux-polish data shows it has all UX signals present.
- What works visually: The macro depth is significant (95 substantive, 85 behaviorally tested).
- What feels unfinished: Despite 99 macros, the visual presentation may not leverage them well.
- What feels generic: Risk of looking like a generic project management list.
- What feels cluttered: 99 macros could overwhelm if surfaced poorly.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like **Jira/Linear** — project boards, kanban views, sprint planning. With 99 macros, there's enormous depth to surface. The visual language should be professional and organized.

LAYOUT UPGRADE:
- **Header**: Project selector + view toggle (list/board/timeline)
- **Primary workspace**: Kanban board or list view with drag-and-drop
- **Secondary**: Task detail panel, timeline view
- **Controls**: Quick-add task, filter by assignee/status/priority

COMPONENT-LEVEL CHANGES:
- Current: Unknown → Proposed: Kanban board as primary view with list/timeline alternatives

VISUAL UPGRADES:
- Color: Status-driven column colors (To Do = gray, In Progress = blue, Done = green)
- Typography: Task titles prominent, metadata secondary
- Spacing: Compact cards in kanban columns
- Motion: Drag-and-drop animations

CAPABILITY PRESENTATION:
- CAPABILITY: 99 project macros → CURRENT: Unknown → BETTER: Surface the most-used macros as kanban actions
- CAPABILITY: Task management → CURRENT: Unknown → BETTER: Inline task creation with assignee/priority

LENS IDENTITY:
Professional, organized, efficient. Think Jira/Linear — the visual language should communicate project structure and progress.

RESPONSIVE DESIGN:
- Desktop: Full kanban board
- Tablet: List view with slide-in detail
- Mobile: Single column task list

BEFORE/AFTER CONCEPT:
Before: Unknown current state (likely generic).
After: A Jira-inspired project management workspace with kanban boards, task cards, and progress visualization.

IMPLEMENTATION PLAN:
1. Implement kanban board as primary view
2. Add task card components with status/priority/assignee
3. Implement drag-and-drop
4. Add project selector in header
5. Implement view toggle (board/list/timeline)

PRIORITY: P1

DESIGN SCORE: 5/10 (estimated)
UPGRADE POTENTIAL: 9/10

---

## 12. psyops

LENS: psyops
PURPOSE: Psychological operations / social influence analysis — understanding persuasion, influence patterns, and social dynamics.

CURRENT DESIGN:
- What the lens currently looks like: Likely has analysis surfaces for social influence patterns.
- What works visually: Unknown without deeper analysis.
- What feels unfinished: Unknown.
- What feels generic: Risk of looking like generic analytics.
- What feels cluttered: Analysis pages can become dense.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **social dynamics command center** — think Palantir or a intelligence analysis tool. The visual language should feel analytical, with network visualizations and influence flow diagrams.

LAYOUT UPGRADE:
- **Header**: Analysis mode selector
- **Primary workspace**: Network visualization or influence map
- **Secondary**: Data tables, pattern lists
- **Controls**: Analysis parameters, time range selector

COMPONENT-LEVEL CHANGES:
- Current: Unknown → Proposed: Network graph as primary visualization with detail panel

VISUAL UPGRADES:
- Color: Influence strength gradient (red = strong, blue = weak)
- Typography: Monospace for data values
- Surfaces: Dark background for network visualizations
- Motion: Node highlighting on hover

CAPABILITY PRESENTATION:
- CAPABILITY: Influence analysis → CURRENT: Unknown → BETTER: Interactive network graph
- CAPABILITY: Pattern detection → CURRENT: Unknown → BETTER: Timeline visualization of influence patterns

LENS IDENTITY:
Analytical, intelligence-focused, data-driven. The visual language should feel like an analytical tool, not a dashboard.

RESPONSIVE DESIGN:
- Desktop: Full network visualization with side panel
- Tablet: Simplified visualization with data tables
- Mobile: Data tables only (network viz not feasible)

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: An intelligence analysis workspace with network visualizations, influence maps, and pattern detection.

IMPLEMENTATION PLAN:
1. Implement network graph visualization
2. Add influence strength coloring
3. Implement detail panel for node inspection
4. Add timeline visualization
5. Implement analysis parameter controls

PRIORITY: P2

DESIGN SCORE: 6/10 (estimated)
UPGRADE POTENTIAL: 7/10

---

## 13. quantum

LENS: quantum
PURPOSE: Quantum computing simulation and visualization — qubit states, quantum circuits, gate operations, entanglement visualization.

CURRENT DESIGN:
- What the lens currently looks like: Quantum-themed with circuit visualization, state displays, and gate operations. The ux-polish data shows it's one of the "highly polished" lenses.
- What works visually: Quantum-specific visual identity with appropriate color scheme (likely purple/cyan for quantum states).
- What feels unfinished: Unknown without deeper analysis.
- What feels generic: Risk of looking like generic physics simulation.
- What feels cluttered: Quantum circuit visualization can be dense.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **quantum computing lab** — IBM Quantum Experience or Qiskit Visualizer. The visual language should be futuristic with Bloch sphere visualizations, circuit diagrams, and state probability displays.

LAYOUT UPGRADE:
- **Header**: Quantum processor status
- **Primary workspace**: Circuit builder with drag-and-drop gates
- **Secondary**: Bloch sphere, state vector display, measurement results
- **Controls**: Gate palette, circuit editing tools

COMPONENT-LEVEL CHANGES:
- Current: Unknown → Proposed: Circuit builder as primary surface with Bloch sphere display

VISUAL UPGRADES:
- Color: Purple/cyan for quantum states, probability gradients
- Typography: Monospace for state vectors, clean for UI
- Surfaces: Dark background with glowing circuit elements
- Motion: Gate application animations, state transition effects

CAPABILITY PRESENTATION:
- CAPABILITY: Circuit building → CURRENT: Unknown → BETTER: Drag-and-drop gate palette
- CAPABILITY: State visualization → CURRENT: Unknown → BETTER: Bloch sphere with real-time updates

LENS IDENTITY:
Futuristic, scientific, quantum-specific. The visual language should be distinctly different from the physics lens — more abstract, more colorful, more futuristic.

RESPONSIVE DESIGN:
- Desktop: Full circuit builder with Bloch sphere
- Tablet: Simplified circuit view with state display
- Mobile: Read-only circuit viewer

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: A quantum computing lab with interactive circuit building, Bloch sphere visualization, and state probability displays.

IMPLEMENTATION PLAN:
1. Implement circuit builder with gate palette
2. Add Bloch sphere visualization
3. Implement state vector display
4. Add measurement result visualization
5. Implement circuit execution and results display

PRIORITY: P2

DESIGN SCORE: 7/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 14. questmarket

LENS: questmarket
PURPOSE: Quest marketplace — browsing, purchasing, and selling quests created by the community.

CURRENT DESIGN:
- What the lens currently looks like: Marketplace-style layout with quest cards, search, and purchase flow. The ux-polish data shows it has all UX signals present with zero generic scaffold imports.
- What works visually: Bespoke design with no generic scaffold — this is a good sign.
- What feels unfinished: Unknown without deeper analysis.
- What feels generic: Unlikely given zero generic imports.
- What feels cluttered: Marketplace pages can become dense.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **game marketplace** — itch.io or the Steam Workshop. The visual language should be game-oriented with quest preview cards, difficulty ratings, and community scores.

LAYOUT UPGRADE:
- **Header**: Search + category filters + sort
- **Primary workspace**: Quest card grid with preview images, difficulty, rewards
- **Secondary**: Quest detail modal with full description, requirements, reviews
- **Controls**: Purchase/download button, wishlist, rating

COMPONENT-LEVEL CHANGES:
- Current: Unknown → Proposed: Card grid with quest preview images, difficulty badges, reward display

VISUAL UPGRADES:
- Color: Difficulty-driven (green = easy, yellow = medium, red = hard)
- Typography: Quest titles prominent, descriptions secondary
- Surfaces: Card hover elevation with preview image
- Motion: Card entrance animations

CAPABILITY PRESENTATION:
- CAPABILITY: Quest browsing → CURRENT: Unknown → BETTER: Visual card grid with difficulty/reward badges
- CAPABILITY: Quest purchase → CURRENT: Unknown → BETTER: One-click purchase with confirmation modal

LENS IDENTITY:
Game-oriented, community-driven, marketplace feel. The visual language should feel like a game store, not a generic marketplace.

RESPONSIVE DESIGN:
- Desktop: 3-column card grid
- Tablet: 2-column grid
- Mobile: Single column list

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: A game marketplace with visual quest cards, difficulty ratings, and community scores.

IMPLEMENTATION PLAN:
1. Implement quest card grid with preview images
2. Add difficulty/reward badges
3. Implement search and filter controls
4. Add quest detail modal
5. Implement purchase flow

PRIORITY: P2

DESIGN SCORE: 7/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 15. quests

LENS: quests
PURPOSE: Quest management — active quests, quest log, quest tracking, quest completion.

CURRENT DESIGN:
- What the lens currently looks like: Quest-focused with active quest display, quest log, and tracking. The ux-polish data shows it has all UX signals present.
- What works visually: Quest-specific visual identity.
- What feels unfinished: Unknown without deeper analysis.
- What feels generic: Risk of looking like generic task list.
- What feels cluttered: Quest information can be dense.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **RPG quest log** — think The Witcher or Skyrim's quest journal. The visual language should be game-oriented with quest stages, objectives, and rewards prominently displayed.

LAYOUT UPGRADE:
- **Header**: Active quest count + current objective
- **Primary workspace**: Quest list with stages, objectives, rewards
- **Secondary**: Quest detail with full description, map markers, NPC info
- **Controls**: Quest accept/abandon/track buttons

COMPONENT-LEVEL CHANGES:
- Current: Unknown → Proposed: Quest cards with stage indicators, objective checkboxes, reward badges

VISUAL UPGRADES:
- Color: Quest type colors (main = gold, side = silver, faction = colored)
- Typography: Quest titles in display font, objectives in clean sans-serif
- Surfaces: Parchment-like texture for quest cards
- Motion: Quest completion animations

CAPABILITY PRESENTATION:
- CAPABILITY: Active quest tracking → CURRENT: Unknown → BETTER: Prominent current objective with map marker
- CAPABILITY: Quest log → CURRENT: Unknown → BETTER: Organized by category with stage indicators

LENS IDENTITY:
RPG-inspired, game-oriented, quest-focused. The visual language should feel like opening a quest journal in a game.

RESPONSIVE DESIGN:
- Desktop: Quest list with detail panel
- Tablet: Quest list with slide-in detail
- Mobile: Single column quest cards

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: An RPG quest journal with stage indicators, objective tracking, and reward displays.

IMPLEMENTATION PLAN:
1. Implement quest card layout with stage indicators
2. Add objective checkboxes
3. Implement reward badges
4. Add quest detail panel
5. Implement quest type categorization

PRIORITY: P2

DESIGN SCORE: 7/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 16. queue

LENS: queue
PURPOSE: Queue management — task queues, job scheduling, processing pipelines.

CURRENT DESIGN:
- What the lens currently looks like: Queue-focused with job listing, status display, and processing info. The ux-polish data shows it's one of the "highly polished" lenses.
- What works visually: Queue-specific visual identity with appropriate status indicators.
- What feels unfinished: Unknown without deeper analysis.
- What feels generic: Risk of looking like generic job list.
- What feels cluttered: Queue pages can become dense with job details.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **processing pipeline monitor** — think RabbitMQ dashboard or Celery Flower. The visual language should be technical with real-time status, throughput metrics, and error highlighting.

LAYOUT UPGRADE:
- **Header**: Queue status summary (active, pending, failed, throughput)
- **Primary workspace**: Job list with status, timing, and error info
- **Secondary**: Pipeline visualization, throughput charts
- **Controls**: Job retry, pause queue, clear completed

COMPONENT-LEVEL CHANGES:
- Current: Unknown → Proposed: Real-time job list with status indicators and throughput metrics

VISUAL UPGRADES:
- Color: Status-driven (green = completed, blue = running, yellow = pending, red = failed)
- Typography: Monospace for job IDs and timing
- Surfaces: Dark background with status-colored row highlights
- Motion: Real-time job status updates

CAPABILITY PRESENTATION:
- CAPABILITY: Queue monitoring → CURRENT: Unknown → BETTER: Real-time job list with throughput metrics
- CAPABILITY: Job management → CURRENT: Unknown → BETTER: Inline retry/pause/cancel actions

LENS IDENTITY:
Technical, real-time, monitoring-focused. The visual language should feel like a system monitor, not a task list.

RESPONSIVE DESIGN:
- Desktop: Full job list with throughput charts
- Tablet: Simplified job list
- Mobile: Status summary only

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: A processing pipeline monitor with real-time job updates, throughput metrics, and error highlighting.

IMPLEMENTATION PLAN:
1. Add queue status summary to header
2. Implement real-time job list with status indicators
3. Add throughput metrics
4. Implement job management actions (retry/pause/cancel)
5. Add error highlighting

PRIORITY: P2

DESIGN SCORE: 7/10 (estimated)
UPGRADE POTENTIAL: 7/10

---

## 17. realestate

LENS: realestate
PURPOSE: Real estate management — property listings, valuations, market analysis. Rivals Zillow/MLS. 55 macros, 53 substantive.

CURRENT DESIGN:
- What the lens currently looks like: Real estate-focused with property listings and market data. The ux-polish data shows it's one of the "highly polished" lenses.
- What works visually: Real estate-specific visual identity.
- What feels unfinished: Unknown without deeper analysis.
- What feels generic: Risk of looking like generic property listing.
- What feels cluttered: Real estate pages can become dense with property details.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like **Zillow/Redfin** — property cards with photos, key stats (beds/baths/sqft/price), map view, and market trends. The visual language should be clean, property-focused, and data-rich.

LAYOUT UPGRADE:
- **Header**: Search + location selector + view toggle (list/map)
- **Primary workspace**: Property card grid with photos and key stats
- **Secondary**: Property detail with full listing, comparable sales, market trends
- **Controls**: Filter by price, beds, baths, property type

COMPONENT-LEVEL CHANGES:
- Current: Unknown → Proposed: Property cards with photos, key stats, and price prominence

VISUAL UPGRADES:
- Color: Price prominence (large, bold), status colors (for sale = green, pending = yellow, sold = red)
- Typography: Price in large font, property details in clean grid
- Surfaces: Property photos as card backgrounds
- Motion: Card hover elevation, photo carousel

CAPABILITY PRESENTATION:
- CAPABILITY: Property search → CURRENT: Unknown → BETTER: Map-based search with property pins
- CAPABILITY: Market analysis → CURRENT: Unknown → BETTER: Price trends and comparable sales charts
- CAPABILITY: Property valuation → CURRENT: Unknown → BETTER: Zestimate-style automated valuation

LENS IDENTITY:
Property-focused, data-rich, market-oriented. The visual language should feel like a professional real estate platform.

RESPONSIVE DESIGN:
- Desktop: Split view (map + list)
- Tablet: List view with map toggle
- Mobile: Single column property cards

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: A Zillow-inspired property platform with map search, property cards, and market analysis.

IMPLEMENTATION PLAN:
1. Implement property card grid with photos
2. Add map-based search view
3. Implement property detail panel
4. Add market trend charts
5. Implement filter controls

PRIORITY: P1

DESIGN SCORE: 7/10 (estimated)
UPGRADE POTENTIAL: 9/10

---

## 18. reasoning

LENS: reasoning
PURPOSE: Reasoning and logic — argument analysis, logical fallacy detection, reasoning chains, proof construction.

CURRENT DESIGN:
- What the lens currently looks like: Reasoning-focused with argument analysis surfaces. The ux-polish data shows it has 4410 LOC across 4 files, no keyboard handlers, no toasts.
- What works visually: Reasoning-specific visual identity.
- What feels unfinished: No keyboard handlers suggests limited interactivity.
- What feels generic: Risk of looking like generic text analysis.
- What feels cluttered: Reasoning chains can become complex.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **logic workspace** — think a formal proof assistant or argument mapper. The visual language should be structured, with argument trees, evidence chains, and conclusion indicators.

LAYOUT UPGRADE:
- **Header**: Reasoning mode selector (argument analysis, fallacy detection, proof construction)
- **Primary workspace**: Argument tree or chain visualization
- **Secondary**: Evidence list, source citations
- **Controls**: Add premise, add evidence, evaluate argument

COMPONENT-LEVEL CHANGES:
- Current: Unknown → Proposed: Tree/graph visualization for argument structure

VISUAL UPGRADES:
- Color: Logic-driven (valid = green, invalid = red, unknown = yellow)
- Typography: Monospace for formal logic notation
- Surfaces: Clean, structured layout with clear hierarchy
- Motion: Node connection animations

CAPABILITY PRESENTATION:
- CAPABILITY: Argument analysis → CURRENT: Unknown → BETTER: Interactive argument tree
- CAPABILITY: Fallacy detection → CURRENT: Unknown → BETTER: Inline fallacy markers with explanations

LENS IDENTITY:
Structured, logical, analytical. The visual language should feel like a formal reasoning tool.

RESPONSIVE DESIGN:
- Desktop: Full argument tree with detail panel
- Tablet: Simplified tree view
- Mobile: Linear argument list

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: A logic workspace with argument trees, fallacy markers, and proof construction.

IMPLEMENTATION PLAN:
1. Implement argument tree visualization
2. Add fallacy detection markers
3. Implement evidence chain display
4. Add proof construction tools
5. Implement argument evaluation scoring

PRIORITY: P2

DESIGN SCORE: 6/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 19. reflection

LENS: reflection
PURPOSE: Personal reflection and journaling — writing reflections, mood tracking, self-analysis, growth tracking.

CURRENT DESIGN:
- What the lens currently looks like: Reflection-focused with journaling surfaces. The ux-polish data shows 3141 LOC across 11 files, no macro button wall, no inline action wall.
- What works visually: Reflection-specific visual identity.
- What feels unfinished: Unknown without deeper analysis.
- What feels generic: Risk of looking like generic journal app.
- What feels cluttered: Journal entries can become dense.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like **Day One or Journey** — a personal journal with elegant typography, mood visualization, and growth tracking. The visual language should be warm, intimate, and reflective.

LAYOUT UPGRADE:
- **Header**: Date selector + mood indicator + streak counter
- **Primary workspace**: Writing surface with elegant typography
- **Secondary**: Reflection timeline, mood chart, growth indicators
- **Controls**: Save, tag, share (private by default)

COMPONENT-LEVEL CHANGES:
- Current: Unknown → Proposed: Center-aligned writing surface with mood tracker

VISUAL UPGRADES:
- Typography: Serif or warm sans-serif for journal text
- Color: Mood-driven palette (warm colors for positive, cool for reflective)
- Surfaces: Paper-like texture for writing surface
- Motion: Gentle page-turn transitions between entries

CAPABILITY PRESENTATION:
- CAPABILITY: Journal writing → CURRENT: Unknown → BETTER: Elegant writing surface with minimal chrome
- CAPABILITY: Mood tracking → CURRENT: Unknown → BETTER: Mood chart in sidebar
- CAPABILITY: Growth analysis → CURRENT: Unknown → BETTER: Progress indicators over time

LENS IDENTITY:
Intimate, reflective, personal. The visual language should feel like a private journal, not a productivity tool.

RESPONSIVE DESIGN:
- Desktop: Writing surface with sidebar timeline
- Tablet: Full-width writing surface
- Mobile: Full-screen writing mode

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: A personal journal with elegant writing, mood visualization, and growth tracking.

IMPLEMENTATION PLAN:
1. Implement elegant writing surface
2. Add mood tracker and chart
3. Implement reflection timeline
4. Add growth indicators
5. Implement entry tagging and search

PRIORITY: P2

DESIGN SCORE: 7/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 20. repair-telemetry

LENS: repair-telemetry
PURPOSE: System repair telemetry — monitoring repair operations, error detection, auto-fix status, repair history.

CURRENT DESIGN:
- What the lens currently looks like: Telemetry-focused with repair status display. The ux-polish data shows 631 LOC across 1 file, all UX signals present.
- What works visually: All UX signals present suggests a well-structured single component.
- What feels unfinished: 631 LOC in 1 file suggests a monolithic component that could benefit from decomposition.
- What feels generic: Risk of looking like generic monitoring dashboard.
- What feels cluttered: Telemetry data can be dense.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **system health monitor** — think Chrome DevTools or a CI/CD dashboard. The visual language should be technical with real-time status, error highlighting, and repair history.

LAYOUT UPGRADE:
- **Header**: System health summary (repair count, success rate, last repair)
- **Primary workspace**: Repair event timeline with status indicators
- **Secondary**: Error details, repair history, auto-fix configuration
- **Controls**: Manual repair trigger, clear history

COMPONENT-LEVEL CHANGES:
- Current: 631 LOC monolith → Proposed: Decompose into header, timeline, detail panel, controls

VISUAL UPGRADES:
- Color: Status-driven (green = repaired, yellow = detecting, red = error)
- Typography: Monospace for error messages and timestamps
- Surfaces: Dark background with status-colored row highlights
- Motion: Real-time status updates

CAPABILITY PRESENTATION:
- CAPABILITY: Repair monitoring → CURRENT: Unknown → BETTER: Real-time timeline with status indicators
- CAPABILITY: Error detection → CURRENT: Unknown → BETTER: Error cards with auto-fix suggestions

LENS IDENTITY:
Technical, real-time, monitoring-focused. The visual language should feel like a system health dashboard.

RESPONSIVE DESIGN:
- Desktop: Full timeline with detail panel
- Tablet: Simplified timeline
- Mobile: Status summary only

BEFORE/AFTER CONCEPT:
Before: A 631-line monolithic component.
After: A decomposed system health monitor with real-time timeline and error highlighting.

IMPLEMENTATION PLAN:
1. Decompose monolithic component
2. Add health summary to header
3. Implement repair event timeline
4. Add error detail cards
5. Implement auto-fix configuration

PRIORITY: P2

DESIGN SCORE: 6/10 (estimated)
UPGRADE POTENTIAL: 7/10

---

## 21. repos

LENS: repos
PURPOSE: Repository management — browsing, creating, and managing code repositories. Rivals GitHub.

CURRENT DESIGN:
- What the lens currently looks like: Repo-focused with listing and management surfaces. The ux-polish data shows 1342 LOC across 3 files, importsGenericTrio, no aria.
- What works visually: 1342 LOC suggests moderate depth.
- What feels unfinished: Generic trio imports and missing aria suggest scaffold dependencies.
- What feels generic: Generic scaffold imports confirm this feels generic.
- What feels cluttered: Repository listings can become dense.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like **GitHub or GitLab** — repository cards with language indicators, star counts, last commit info, and activity graphs. The visual language should be developer-focused.

LAYOUT UPGRADE:
- **Header**: Search + language filter + sort
- **Primary workspace**: Repository card grid with language colors, star counts, activity
- **Secondary**: Repository detail with file tree, commit history, README
- **Controls**: Create repo, clone, fork

COMPONENT-LEVEL CHANGES:
- Current: Unknown with generic scaffold → Proposed: Bespoke repo cards with language indicators and activity graphs

VISUAL UPGRADES:
- Color: Language-driven colors (JavaScript = yellow, Python = blue, etc.)
- Typography: Monospace for repo names, clean for descriptions
- Surfaces: Card hover elevation with language color accent
- Motion: Card entrance animations

CAPABILITY PRESENTATION:
- CAPABILITY: Repository browsing → CURRENT: Generic scaffold → BETTER: Visual repo cards with language and activity
- CAPABILITY: Repository management → CURRENT: Unknown → BETTER: Inline create/clone/fork actions

LENS IDENTITY:
Developer-focused, code-oriented, version-control-aware. The visual language should feel like a code hosting platform.

RESPONSIVE DESIGN:
- Desktop: 2-column repo card grid
- Tablet: Single column repo cards
- Mobile: Compact repo list

BEFORE/AFTER CONCEPT:
Before: Generic scaffold with no visual identity.
After: A GitHub-inspired repo browser with language colors, activity graphs, and developer-focused design.

IMPLEMENTATION PLAN:
1. Remove generic scaffold imports
2. Implement repo card grid with language indicators
3. Add activity graphs
4. Implement search and filter controls
5. Add repo detail view

PRIORITY: P1

DESIGN SCORE: 4/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 22. research

LENS: research
PURPOSE: Research management — literature review, citation management, research notes, paper analysis. Rivals Zotero/Notion. 66 macros, 62 substantive.

CURRENT DESIGN:
- What the lens currently looks like: Research-focused with literature and citation surfaces. The ux-polish data shows 4131 LOC across 14 files, importsGenericTrio.
- What works visually: 4131 LOC across 14 files suggests significant depth and component decomposition.
- What feels unfinished: Generic scaffold imports suggest some generic elements.
- What feels generic: Generic trio imports confirm some generic elements.
- What feels cluttered: Research pages can become dense with citations and notes.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like **Zotero or Readwise** — literature management with citation cards, reading lists, and note connections. The visual language should be academic and organized.

LAYOUT UPGRADE:
- **Header**: Search + collection selector + import button
- **Primary workspace**: Literature card grid with citation info, tags, notes
- **Secondary**: Paper detail with abstract, citations, notes
- **Controls**: Add paper, create collection, export citations

COMPONENT-LEVEL CHANGES:
- Current: Unknown with generic scaffold → Proposed: Bespoke literature cards with citation info

VISUAL UPGRADES:
- Color: Category-driven colors for research fields
- Typography: Serif for paper titles, clean for metadata
- Surfaces: Card hover elevation with category color accent
- Motion: Card entrance animations

CAPABILITY PRESENTATION:
- CAPABILITY: Literature management → CURRENT: Generic scaffold → BETTER: Visual literature cards with citation info
- CAPABILITY: Citation management → CURRENT: Unknown → BETTER: Inline citation export and formatting

LENS IDENTITY:
Academic, organized, citation-focused. The visual language should feel like a research library tool.

RESPONSIVE DESIGN:
- Desktop: 2-column literature card grid
- Tablet: Single column cards
- Mobile: Compact literature list

BEFORE/AFTER CONCEPT:
Before: Generic scaffold with no visual identity.
After: A Zotero-inspired literature manager with citation cards and research organization.

IMPLEMENTATION PLAN:
1. Remove generic scaffold imports
2. Implement literature card grid
3. Add citation info and tags
4. Implement search and collection filters
5. Add paper detail view

PRIORITY: P1

DESIGN SCORE: 5/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 23. resonance

LENS: resonance
PURPOSE: Resonance analysis — frequency analysis, wave patterns, harmonic visualization, audio spectrum analysis.

CURRENT DESIGN:
- What the lens currently looks like: Resonance-focused with frequency and wave analysis surfaces. The ux-polish data shows 2666 LOC across 3 files, importsGenericTrio.
- What works visually: 2666 LOC suggests moderate depth.
- What feels unfinished: Generic scaffold imports suggest some generic elements.
- What feels generic: Generic trio imports confirm some generic elements.
- What feels cluttered: Frequency analysis can be dense.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like an **audio spectrum analyzer** — think Ableton's spectrum view or a scientific oscilloscope. The visual language should be waveform-focused with real-time visualization.

LAYOUT UPGRADE:
- **Header**: Frequency range selector + analysis mode
- **Primary workspace**: Spectrum/wave visualization (dominant)
- **Secondary**: Frequency readout, harmonic analysis
- **Controls**: Play/pause, zoom, export

COMPONENT-LEVEL CHANGES:
- Current: Unknown with generic scaffold → Proposed: Full-width spectrum visualization as primary surface

VISUAL UPGRADES:
- Color: Frequency-mapped spectrum (low = blue, high = red)
- Typography: Monospace for frequency values
- Surfaces: Dark background for waveform visibility
- Motion: Real-time waveform animation

CAPABILITY PRESENTATION:
- CAPABILITY: Frequency analysis → CURRENT: Generic scaffold → BETTER: Interactive spectrum visualization
- CAPABILITY: Harmonic analysis → CURRENT: Unknown → BETTER: Overlay harmonic markers on spectrum

LENS IDENTITY:
Scientific, audio-focused, waveform-driven. The visual language should feel like an oscilloscope or spectrum analyzer.

RESPONSIVE DESIGN:
- Desktop: Full-width spectrum with side panel
- Tablet: Simplified spectrum view
- Mobile: Basic frequency readout

BEFORE/AFTER CONCEPT:
Before: Generic scaffold with no visual identity.
After: An audio spectrum analyzer with real-time waveform visualization and frequency analysis.

IMPLEMENTATION PLAN:
1. Remove generic scaffold imports
2. Implement spectrum visualization as primary surface
3. Add frequency readout and harmonic analysis
4. Implement zoom and export controls
5. Add real-time animation

PRIORITY: P1

DESIGN SCORE: 5/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 24. retail

LENS: retail
PURPOSE: Retail management — product listings, inventory, sales analytics, customer management. Rivals Shopify. 81 macros, all substantive.

CURRENT DESIGN:
- What the lens currently looks like: Retail-focused with product and sales surfaces. The ux-polish data shows 5189 LOC across 27 files, all UX signals present.
- What works visually: 5189 LOC across 27 files suggests significant depth and component decomposition. All UX signals present.
- What feels unfinished: Unknown without deeper analysis.
- What feels generic: Risk of looking like generic e-commerce dashboard.
- What feels cluttered: Retail pages can become dense with product info.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like **Shopify's admin** — product grid, sales dashboard, inventory management. The visual language should be commerce-focused with product photos, price prominence, and sales metrics.

LAYOUT UPGRADE:
- **Header**: Store name + sales summary + quick actions
- **Primary workspace**: Product grid with photos, prices, inventory status
- **Secondary**: Sales dashboard, customer list, inventory alerts
- **Controls**: Add product, bulk actions, export

COMPONENT-LEVEL CHANGES:
- Current: Unknown → Proposed: Product card grid with photos and price prominence

VISUAL UPGRADES:
- Color: Status-driven (in stock = green, low = yellow, out = red)
- Typography: Price prominent, product details secondary
- Surfaces: Product photos as card backgrounds
- Motion: Card hover elevation

CAPABILITY PRESENTATION:
- CAPABILITY: Product management → CURRENT: Unknown → BETTER: Visual product grid with photos and prices
- CAPABILITY: Sales analytics → CURRENT: Unknown → BETTER: Dashboard with charts and trends

LENS IDENTITY:
Commerce-focused, product-oriented, sales-driven. The visual language should feel like a professional e-commerce platform.

RESPONSIVE DESIGN:
- Desktop: 3-column product grid with side dashboard
- Tablet: 2-column grid
- Mobile: Single column product cards

BEFORE/AFTER CONCEPT:
Before: Unknown current state.
After: A Shopify-inspired retail platform with product management, sales analytics, and inventory tracking.

IMPLEMENTATION PLAN:
1. Implement product card grid with photos
2. Add sales dashboard with charts
3. Implement inventory management
4. Add customer management
5. Implement bulk actions and export

PRIORITY: P1

DESIGN SCORE: 7/10 (estimated)
UPGRADE POTENTIAL: 9/10

---

## 25. robotics

LENS: robotics
PURPOSE: Robotics simulation and control — robot configuration, sensor visualization, motion planning, programming.

CURRENT DESIGN:
- What the lens currently looks like: Robotics-focused with simulation and control surfaces. The ux-polish data shows 2110 LOC across 11 files, importsGenericTrio.
- What works visually: 2110 LOC across 11 files suggests moderate depth.
- What feels unfinished: Generic scaffold imports suggest some generic elements.
- What feels generic: Generic trio imports confirm some generic elements.
- What feels cluttered: Robotics simulation can be dense.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **robotics IDE** — think ROS Studio or a robot programming environment. The visual language should be technical with 3D visualization, sensor data, and code editing.

LAYOUT UPGRADE:
- **Header**: Robot status + connection indicator
- **Primary workspace**: 3D robot visualization or sensor display
- **Secondary**: Code editor, sensor data, motion planner
- **Controls**: Run/stop, sensor toggle, camera view

COMPONENT-LEVEL CHANGES:
- Current: Unknown with generic scaffold → Proposed: 3D visualization as primary surface

VISUAL UPGRADES:
- Color: Status-driven (connected = green, disconnected = red)
- Typography: Monospace for code, clean for UI
- Surfaces: Dark background for 3D visualization
- Motion: Robot movement animations

CAPABILITY PRESENTATION:
- CAPABILITY: Robot simulation → CURRENT: Generic scaffold → BETTER: Interactive 3D visualization
- CAPABILITY: Sensor monitoring → CURRENT: Unknown → BETTER: Real-time sensor data display

LENS IDENTITY:
Technical, engineering-focused, simulation-driven. The visual language should feel like a robotics development environment.

RESPONSIVE DESIGN:
- Desktop: Full 3D visualization with side panels
- Tablet: Simplified visualization with controls
- Mobile: Sensor data only (3D not feasible)

BEFORE/AFTER CONCEPT:
Before: Generic scaffold with no visual identity.
After: A robotics IDE with 3D visualization, sensor monitoring, and code editing.

IMPLEMENTATION PLAN:
1. Remove generic scaffold imports
2. Implement 3D robot visualization
3. Add sensor data display
4. Implement code editor integration
5. Add motion planning controls

PRIORITY: P2

DESIGN SCORE: 5/10 (estimated)
UPGRADE POTENTIAL: 8/10

---

## 26. root

LENS: root
PURPOSE: Root system administration — system-level controls, configuration, diagnostics, root-level operations.

CURRENT DESIGN:
- What the lens currently looks like: Root/system-focused with administrative surfaces. The ux-polish data shows 1175 LOC across 8 files, importsGenericTrio.
- What works visually: 1175 LOC across 8 files suggests moderate depth.
- What feels unfinished: Generic scaffold imports suggest some generic elements.
- What feels generic: Generic trio imports confirm some generic elements.
- What feels cluttered: System admin pages can be dense with options.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **server admin panel** — think cPanel or AWS Console. The visual language should be technical with system metrics, configuration panels, and diagnostic tools.

LAYOUT UPGRADE:
- **Header**: System status summary + uptime + resource usage
- **Primary workspace**: System metrics dashboard with charts
- **Secondary**: Configuration panels, diagnostic tools
- **Controls**: System actions (restart, update, backup)

COMPONENT-LEVEL CHANGES:
- Current: Unknown with generic scaffold → Proposed: System metrics dashboard as primary surface

VISUAL UPGRADES:
- Color: Status-driven (healthy = green, warning = yellow, critical = red)
- Typography: Monospace for system values
- Surfaces: Dark background with status-colored indicators
- Motion: Real-time metric updates

CAPABILITY PRESENTATION:
- CAPABILITY: System monitoring → CURRENT: Generic scaffold → BETTER: Real-time metrics dashboard
- CAPABILITY: System configuration → CURRENT: Unknown → BETTER: Organized config panels

LENS IDENTITY:
Technical, administrative, system-focused. The visual language should feel like a server management panel.

RESPONSIVE DESIGN:
- Desktop: Full metrics dashboard with side panels
- Tablet: Simplified metrics
- Mobile: Status summary only

BEFORE/AFTER CONCEPT:
Before: Generic scaffold with no visual identity.
After: A server admin panel with real-time metrics and configuration tools.

IMPLEMENTATION PLAN:
1. Remove generic scaffold imports
2. Implement system metrics dashboard
3. Add configuration panels
4. Implement diagnostic tools
5. Add system action controls

PRIORITY: P2

DESIGN SCORE: 5/10 (estimated)
UPGRADE POTENTIAL: 7/10

---

## 27. sandbox

LENS: sandbox
PURPOSE: Sandbox environment — code execution, experimentation, safe testing space.

CURRENT DESIGN:
- What the lens currently looks like: Sandbox-focused with code execution surfaces. The ux-polish data shows 1841 LOC across 7 files, importsGenericTrio, no keyboard handlers, no responsive, pillarsPresent: 4.
- What works visually: 1841 LOC across 7 files suggests moderate depth.
- What feels unfinished: No keyboard handlers, no responsive design, and only 4 pillars present (out of 5) suggest significant gaps.
- What feels generic: Generic scaffold imports confirm generic elements.
- What feels cluttered: Sandbox pages can become dense with code and output.
- What feels empty: Unknown.

DESIGN DIRECTION:
This should feel like a **code playground** — think CodeSandbox or JSFiddle. The visual language should be code-focused with editor, output, and file explorer.

LAYOUT UPGRADE:
- **Header**: Sandbox name + execution status + share button
- **Primary workspace**: Code editor (dominant) with syntax highlighting
- **Secondary**: Output panel, file explorer, console
- **Controls**: Run/stop, clear, save, share

COMPONENT-LEVEL CHANGES:
- Current: Unknown with generic scaffold → Proposed: Code editor as primary surface with output panel

VISUAL UPGRADES:
- Typography: Monospace for code (with syntax highlighting)
- Color: Syntax highlighting colors (standard IDE palette)
- Surfaces: Dark editor background (like VS Code)
- Motion: Smooth cursor movement, output scroll

CAPABILITY PRESENTATION:
- CAPABILITY: Code execution → CURRENT: Generic scaffold → BETTER: Full IDE-like experience
- CAPABILITY: File management → CURRENT: Unknown → BETTER: File explorer sidebar

LENS IDENTITY:
Code-focused, developer-oriented, experimental. The visual language should feel like a code playground.

RESPONSIVE DESIGN:
- Desktop: Split view (editor + output)
- Tablet: Tabbed view (editor/output/files)
- Mobile: Code editor only (output as overlay)

BEFORE/AFTER CONCEPT:
Before: Generic scaffold with no keyboard support and no responsive design.
After: A code playground with IDE-like experience, syntax highlighting, and file management.

IMPLEMENTATION PLAN:
1. Remove generic scaffold imports
2. Implement code editor with syntax highlighting
3. Add output panel
4. Implement file explorer
5. Add keyboard shortcuts
6. Implement responsive design

PRIORITY: P1

DESIGN SCORE: 4/10 (estimated)
UPGRADE POTENTIAL: 9/10

---

## BATCH 8 SUMMARY

### Priority Ranking

**P0 — Redesign Immediately:**
- (none in this batch)

**P1 — Major Visual Upgrade:**
1. **photography** (6/10 → 9/10 potential) — Transform from tabbed page to Lightroom-style workspace
2. **photos** (5/10 → 8/10 potential) — Transform from sparse grid to camera roll
3. **physics** (6/10 → 9/10 potential) — Transform from dashboard to interactive sandbox
4. **podcast** (7/10 → 8/10 potential) — Enlarge episode cards, add prominent recording
5. **projects** (5/10 → 9/10 potential) — Transform from unknown to Jira-inspired workspace
6. **realestate** (7/10 → 9/10 potential) — Transform to Zillow-inspired platform
7. **repos** (4/10 → 8/10 potential) — Remove generic scaffold, add GitHub-inspired design
8. **research** (5/10 → 8/10 potential) — Remove generic scaffold, add Zotero-inspired design
9. **resonance** (5/10 → 8/10 potential) — Remove generic scaffold, add spectrum analyzer
10. **retail** (7/10 → 9/10 potential) — Transform to Shopify-inspired platform
11. **sandbox** (4/10 → 9/10 potential) — Remove generic scaffold, add code playground

**P2 — Polish:**
1. **platform** (7/10 → 7/10 potential) — Dashboard reorganization
2. **plugins** (5/10 → 7/10 potential) — Add search, categories, trust badges
3. **plumbing** (6/10 → 7/10 potential) — Add status bar, quick actions
4. **poetry** (7/10 → 8/10 potential) — Add serif typography, paper surfaces
5. **privacy** (6/10 → 7/10 potential) — Add privacy meter, category cards
6. **productivity** (6/10 → 8/10 potential) — Add Linear-inspired task list
7. **psyops** (6/10 → 7/10 potential) — Add network visualization
8. **quantum** (7/10 → 8/10 potential) — Add circuit builder, Bloch sphere
9. **questmarket** (7/10 → 8/10 potential) — Add visual quest cards
10. **quests** (7/10 → 8/10 potential) — Add RPG quest journal style
11. **queue** (7/10 → 7/10 potential) — Add real-time monitoring
12. **reasoning** (6/10 → 8/10 potential) — Add argument tree visualization
13. **reflection** (7/10 → 8/10 potential) — Add elegant writing surface
14. **repair-telemetry** (6/10 → 7/10 potential) — Decompose monolith, add timeline
15. **robotics** (5/10 → 8/10 potential) — Add 3D visualization
16. **root** (5/10 → 7/10 potential) — Add system metrics dashboard

### Top Observations

1. **Generic scaffold problem**: 11 of 27 lenses import the generic trio (ManifestActionBar, AutoActionStrip, RecentMineCard). Repos, research, resonance, robotics, root, and sandbox are the worst offenders.

2. **Missing accessibility**: Repos has no aria attributes. Sandbox has no responsive design.

3. **Highest upgrade potential**: Photography, physics, sandbox, projects, and retail have the most to gain from redesign (5-point or more score improvement).

4. **Already strong**: Podcast, questmarket, quests, and queue are already well-designed and need only polish.

5. **Pattern**: Lenses with zero generic imports (questmarket, reflection, repair-telemetry) tend to be more polished and distinctive.
