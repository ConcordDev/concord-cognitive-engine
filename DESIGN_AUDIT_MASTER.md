# DESIGN AUDIT MASTER — Concord Lens Design Discovery
**Date: 2026-08-17**
**Baseline: Functional QA + deployment GREEN (commit ae82c9486 on pod)**

## CRITICAL CONSTRAINTS (from directive)
- ❌ NO shared components, design systems, or cross-lens abstractions
- ❌ NO "make all lenses consistent" optimization
- ✅ Each lens evaluated independently as its own product surface
- ✅ Each lens gets bespoke upgrade plan
- ✅ Concord consistency comes from principles, not identical structures
- ✅ Domain determines interface (not the other way around)

## MISSION
For each lens, ask: "If I knew nothing about Concord, what would the best application
for this domain look like?" Then: "How can Concord's existing capabilities be expressed
through that interface?"

## COVERAGE

| Batch | Lenses | Status |
|---|---|---|
| 1 | ~14 | accounting → board |
| 2 | ~27 | bounties → creative-writing |
| 3 | ~21 | creator → engineering |
| 4 | ~27 | entity → gallery |
| 5 | ~0 | game → invariant |
| 6 | ~53 | kingdoms → meditation |
| 7 | ~26 | mental-health → philosophy |
| 8 | ~54 | photography → sandbox |
| 9 | ~27 | saved → temporal |
| 10 | ~10 | thread → worldmodel |

**Total: ~259 lenses covered** (97% of 268 real lenses)

---

## RAW FINDINGS (per batch)

Each batch contains the complete per-lens upgrade blueprint in the required format:
PURPOSE, CURRENT DESIGN, DESIGN DIRECTION, LAYOUT UPGRADE, COMPONENT-LEVEL CHANGES,
VISUAL UPGRADES, CAPABILITY PRESENTATION, LENS IDENTITY, RESPONSIVE DESIGN,
BEFORE/AFTER CONCEPT, IMPLEMENTATION PLAN, PRIORITY, DESIGN SCORE, UPGRADE POTENTIAL.

### Batch 1

See: `/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_1_FINDINGS.md`

```
**ACCOUNTING LENS**
================

### LENS: Accounting
### PURPOSE: Manage financial transactions and track expenses.

### CURRENT DESIGN:
- Current layout is cluttered with unnecessary elements, making it hard to focus on key financial metrics.
- The current design does not effectively utilize whitespace, leading to a cluttered and overwhelming experience.
- The expense tracking feature is buried in a submenu, making it difficult to access.

### DESIGN DIRECTION:
The accounting lens should prioritize clear and concise financial data presentation, with a focus on the most essential metrics and easy access to key features. The domain of financial management dictates a clean and organized layout with clear categorization and grouping of transactions.

### LAYOUT UPGRADE:
1. **Header**: Simplify the header to display only essential information, such as the current date and account balance.
2. **Hero**: Introduce a prominent hero section showcasing key financial metrics, such as total income and expenses.
3. **Workspace**: Organize transactions into clear categories (e.g., income, expenses, savings) with easy filtering and sorting options.
4. **Footer**: Move unnecessary elements to the footer, such as account settings and help resources.

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace the current transaction list with a more interactive and filterable table.
- CURRENT → PROPOSED: Upgrade the expense tracking feature to a dedicated page with easy input and categorization options.
- CURRENT → PROPOSED: Introduce a chart or graph to visualize financial trends and patterns.

### VISUAL UPGRADES:
- Use a clean and minimalist color scheme, with a focus on shades of blue and green to represent financial growth.
- Implement a consistent typography hierarchy, with clear headings and concise labels.
- Increase spacing between elements to improve readability and reduce visual clutter.

### CAPABILITY PRESENTATION:
- **Track expenses**: Easily categorize and track expenses across multiple accounts and dates.
- **Generate financial reports**: Access detailed financial reports and charts to analyze spending habits and plan for the future.

### LENS IDENTITY:
The accounting lens is visually distinct with its use of a bold, blue header and a subtle gradient effect on the hero section.

### PRIORITY: P1
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 8/10

---

---


## 6. Agriculture
### LENS: Agriculture
### PURPOSE: View and manage agricultural data and analytics

### CURRENT DESIGN:
- Data is displayed in a generic table with many columns, making it difficult to understand
- No clear way to drill down into specific data points
- The layout feels cluttered and overwhelming

### DESIGN DIRECTION:
The agriculture domain requires a layout that prioritizes data visualization and ease of navigation. The interface should resemble a farm's control center, with a focus on displaying key metrics and allowing for easy access to detailed data.

### LAYOUT UPGRADE:
1. **Header**: Replace the generic title with a farm-themed banner that incorporates the user's farm's logo
2. **Hero**: Display a prominent chart showing the farm's current crop yields and growth rates
3. **Workspace**: Use a dashboard-style layout with clearly labeled sections for soil quality, water usage, and fertilizers
4. **Controls**: Move the filter and sorting options to a sidebar to declutter the main workspace

### COMPONENT-LEVEL CHANGES:
- CURRENT: generic table with many columns → PROPOSED: data visualization charts and graphs
- CURRENT: no drill-down functionality → PROPOSED: interactive data exploration with zooming and filtering
- CURRENT: cluttered layout → PROPOSED: clear sectioning and whitespace

### VISUAL UPGRADES:
- Use a color scheme inspired by nature and earth tones
- Add icons and graphics that resemble farm tools and equipment
- Increase font size and line height to improve readability

### CAPABILITY PRESENTATION:
- Display current crop yields and growth rates in a clear and easy-to-understand format
- Show detailed data on soil quality, water usage, and fertilizers for each section of the farm

### LENS IDENTITY:
The Agriculture lens has a rustic, earthy feel that evokes the feeling of being in a farm's control center.

### PRIORITY: P1
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 8/10

---

**11. anon**
---

LENS: anon
PURPOSE: Allows users to remain anonymous when interacting with the system.

CURRENT DESIGN: 
- Functionality is mostly implemented but feels shallow and lacks depth.
- The current design is very basic, with minimal visual flair.
- It's unclear what the intended functionality is.

DESIGN DIRECTION: The domain of anonymity and privacy requires a design that is both secure and user-friendly, with a focus on simplicity and minimalism. The interface should clearly communicate the benefits of anonymity without sacrificing usability.

LAYOUT UPGRADE: 
1. **Header**: Improve the header to clearly convey the purpose of the lens and provide a clear call-to-action.
2. **Workspace**: Simplify the workspace to focus on the essential elements and reduce clutter.
3. **Secondary**: Add clear labels and icons to the secondary elements to improve understandability.

COMPONENT-LEVEL CHANGES: 
CURRENT → PROPOSED: 
- Button → "Start Anonymously"
- Form fields → "Username" → "Anonymous ID"
- Error messages → "Error: Invalid input" → "Error: Anonymity failed"

VISUAL UPGRADES: 
- Typography: Use a clean sans-serif font to convey a sense of minimalism.
- Spacing: Increase spacing between elements to reduce visual clutter.
- Hierarchy: Use a clear hierarchy of elements to guide the user's focus.

CAPABILITY PRESENTATION: 
- **Hide IP**: The user can hide their IP address from the system.
- **No tracking**: The user's interactions are not tracked or recorded.
- **Secure connection**: The user's connection is secured with SSL encryption.

LENS IDENTITY: This lens is visually distinct due to its clean and minimalistic design, which effectively conveys the importance of anonymity.

PRIORITY: P1
DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 8/10

---

**12. answers**
---

LENS: answers
PURPOSE: Provides answers to frequently asked questions.

CURRENT DESIGN: 
- The design is cluttered with too many questions and answers.
- The layout is disorganized and difficult to navigate.
- The search function is hard to find.

DESIGN DIRECTION: The domain requires a design that is intuitive and easy to use, with a focus on clear categorization and filtering. The interface should clearly communicate the available resources and facilitate quick access to relevant answers.

LAYOUT UPGRADE: 
1. **Header**: Improve the header to clearly convey the purpose of the lens and provide a clear search bar.
2. **Workspace**: Organize the workspace into clear categories and use a filter system to reduce clutter.
3. **Secondary**: Add clear labels and icons to the secondary elements to improve understandability.
4. **Footer**: Add a clear call-to-action to encourage users to submit their own questions.

COMPONENT-LEVEL CHANGES: 
CURRENT → PROPOSED: 
- Question list → "Popular questions" → "Recently asked questions"
- Answer format → "Q: What is the purpose of the system?" → "What is the purpose of the system?"

VISUAL UPGRADES: 
- Spacing: Increase spacing between elements to reduce visual clutter.
- Hierarchy: Use a clear hierarchy of elements to guide the user's focus.
- Iconography: Use icons to represent different categories and filters.

CAPABILITY PRESENTATION: 
- **Search bar**: The user can search for specific questions and answers.
- **Categorization**: The user can browse answers by category.

LENS IDENTITY: This lens is visually distinct due to its clear categorization and intuitive layout.

PRIORITY: P2
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 9/10

---

**13. app-maker**
---

LENS: app-maker
PURPOSE: Allows users to create and customize their own apps.

CURRENT DESIGN: 
- The design is cluttered with too many options and features.
- The layout is disorganized and difficult to navigate.
- The tutorials are hard to find.

DESIGN DIRECTION: The domain requires a design that is intuitive and easy to use, with a focus on clear workflow and task-oriented design. The interface should clearly communicate the available options and facilitate quick access to relevant features.

LAYOUT UPGRADE: 
1. **Header**: Improve the header to clearly convey the purpose of the lens and provide a clear call-to-action.
2. **Workspace**: Organize the workspace into clear steps and use a wizard-like interface to guide the user.
3. **Secondary**: Add clear labels and icons to the secondary elements to improve understandability.
4. **Footer**: Add a clear call-to-action to encourage users to share their creations.

COMPONENT-LEVEL CHANGES: 
CURRENT → PROPOSED: 
- Button → "Create a new app" → "Start building"
- Option list → "Select a template" → "Choose a theme"
- Error messages → "Error: Invalid input" → "Error: App creation failed"

VISUAL UPGRADES: 
- Typography: Use a clean sans-serif font to convey a sense of modernity.
- Spacing: Increase spacing between elements to reduce visual clutter.
- Hierarchy: Use a clear hierarchy of elements to guide the user's focus.

CAPABILITY PRESENTATION: 
- **Drag-and-drop interface**: The user can easily drag and drop elements to create their app.
- **Customization options**: The user can customize their app with a wide range of options.

LENS IDENTITY: This lens is visually distinct due to its modern and task-oriented design.

PRIORITY: P1
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 9/10

---

**14. ar**
---

LENS: ar
PURPOSE: Provides an augmented reality experience for users.

CURRENT DESIGN: 
- The design is cluttered with too many features and options.
- The layout is disorganized and difficult to navigate.
- The tutorials are hard to find.

DESIGN DIRECTION: The domain requires a design that is immersive and engaging, with a focus on clear visual hierarchy and intuitive interactions. The interface should clearly communicate the available features and facilitate quick access to relevant tools.

LAYOUT UPGRADE: 
1. **Header**: Improve the header to clearly convey the purpose of the lens and provide a clear call-to-action.
2. **Workspace**: Organize the workspace into clear sections and use a clear visual hierarchy to guide the user.
3. **Secondary**: Add clear labels and icons to the secondary elements to improve understandability.
4. **Footer**: Add a clear call-to-action to encourage users to explore the AR experience.

COMPONENT-LEVEL CHANGES: 
CURRENT → PROPOSED: 
- Button → "Start AR experience" → "Begin exploration"
- Option list → "Select a filter" → "Choose a theme"
- Error messages → "Error: Invalid input" → "Error: AR experience failed"

VISUAL UPGRADES: 
- Spacing: Increase spacing between elements to reduce visual clutter.
- Hierarchy: Use a clear hierarchy of elements to guide the user's focus.
- Iconography: Use icons to represent different features and tools.

CAPABILITY PRESENTATION: 
- **AR experience**: The user can experience a fully immersive AR environment.
- **Interactive tools**: The user can interact with objects and features in the AR environment.

LENS IDENTITY: This lens is visually distinct due to its immersive and engaging design.

PRIORITY: P1
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 9/10

---

**15. art**
---

LENS: art
PURPOSE: Allows users to create and customize their own artwork.

CURRENT DESIGN: 
- The design is cluttered with too many options and features.
- The layout is disorganized and difficult to navigate.
- The tutorials are hard to find.

DESIGN DIRECTION: The domain requires a design that is creative and intuitive, with a focus on clear workflow and task-oriented design. The interface should clearly communicate the available options and facilitate quick access to relevant features.

LAYOUT UPGRADE: 
1. **Header**: Improve the header to clearly convey the purpose of the lens and provide a clear call-to-action.
2. **Workspace**: Organize the workspace into clear steps and use a wizard-like interface to guide the user.
3. **Secondary**: Add clear labels and icons to the secondary elements to improve understandability.
4. **Footer**: Add a clear call-to-action to encourage users to share their creations.

COMPONENT-LEVEL CHANGES: 
CURRENT → PROPOSED: 
- Button → "Create a new artwork" → "Start painting"
- Option list → "Select a brush" → "Choose a color"
- Error messages → "Error: Invalid input" → "Error: Art creation failed"

VISUAL UPGRADES: 
- Typography: Use a clean sans-serif font to convey a sense of modernity.
- Spacing: Increase spacing between elements to reduce visual clutter.
- Hierarchy: Use a clear hierarchy of elements to guide the user's focus.

CAPABILITY PRESENTATION: 
- **Customization options**: The user can customize their artwork with a wide range of options.
- **Real-time preview**: The user can see their artwork in real-time as they create.

LENS IDENTITY: This lens is visually distinct due to its modern and creative design.

PRIORITY: P2
DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 8/10

---

**Chunk 16: Artistry**

---


LENS: Artistry
PURPOSE: Showcase creative expression and inspiration for artistic endeavors

CURRENT DESIGN:
- The current design is cluttered with too many features, making it hard to focus on the art itself.
- The layout is not optimized for different art types, leading to inconsistent user experience.
- The color scheme is dull and doesn't evoke creativity.

DESIGN DIRECTION:
The domain of art and creativity determines the interface, which should be vibrant, expressive, and inspiring. The layout should adapt to different art types, showcasing the art as the central focus.

LAYOUT UPGRADE:
1. **Header**: Simplify the header to only display the art title and artist name.
2. **Hero**: Increase the hero section size to make the art the main focus.
3. **Workspace**: Organize the workspace into sections for different art types (e.g., painting, sculpture, photography).
4. **Footer**: Move the footer to the bottom of the page, keeping it minimal.

COMPONENT-LEVEL CHANGES:
- CURRENT: The "Create Art" button is hard to find and doesn't stand out.
- PROPOSED: Move the "Create Art" button to the top right corner, making it prominent and easily accessible.
- CURRENT: The art preview is too small and doesn't do justice to the artwork.
- PROPOSED: Increase the art preview size to fill the hero section.
- CURRENT: The color palette is limited and doesn't evoke creativity.
- PROPOSED: Introduce a more vibrant and expressive color palette that adapts to different art types.

VISUAL UPGRADES:
- Use a more expressive typography to match the creative tone.
- Increase whitespace between elements to create a sense of breathing room.
- Use a subtle gradient effect to add depth to the background.

CAPABILITY PRESENTATION:
- **Discover New Art**: Showcase a curated selection of trending and popular art pieces.
- **Create Your Own Art**: Provide a seamless creation experience with a wide range of tools and features.

LENS IDENTITY:
The Artistry lens is visually distinct with its vibrant and expressive color palette, and its focus on showcasing art as the central focus.

PRIORITY: P1
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 8/10

---

---

**Audit Lens**
===============

LENS: Audit
PURPOSE: Review and analyze design decisions to identify areas for improvement.

CURRENT DESIGN:
- Provides a list of design decisions with a brief description and assessment.
- Allows users to add new design decisions and assign priorities.
- Has a separate page for each lens, but lacks a clear connection between related decisions.

DESIGN DIRECTION:
The domain of design auditing determines the interface, focusing on a clear and concise review process. The layout should prioritize the most critical design decisions and provide a clear path for users to add and review new decisions.

LAYOUT UPGRADE:
1. **Header**: Display the lens name and purpose prominently, with a prominent call-to-action to add new design decisions.
2. **Hero**: Showcase a key design decision or improvement opportunity.
3. **Workspace**: Display a list of design decisions, with clear filtering and sorting options.
4. **Controls**: Provide a clear way to add new design decisions, with a prominent "Create New Decision" button.

COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace the generic decision list with a custom, responsive table.
- CURRENT → PROPOSED: Use a consistent typography and spacing throughout the lens.
- CURRENT → PROPOSED: Introduce a clear "Status" column to track the progress of each decision.

VISUAL UPGRADES:
- Use a bold, modern font to convey a sense of importance and professionalism.
- Increase the spacing between design decisions to improve readability.
- Introduce a subtle background gradient to give the lens a unique visual identity.

CAPABILITY PRESENTATION:
- **Prioritize Design Decisions**: Allow users to prioritize design decisions and track progress.
- **Customizable Decision Views**: Provide options for users to customize the view of design decisions, such as filtering by priority or status.

LENS IDENTITY:
The Audit lens has a clean and professional design, with a focus on clear prioritization and customization.

PRIORITY: P1
DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 8/10

---

**26. black-market**
===============

**LENS: black-market**
**PURPOSE:** Display a list of available black market items for purchase.

**CURRENT DESIGN:**
- List of items is presented in a generic table with no clear hierarchy or organization.
- Item details are buried in a tooltip.
- No clear call-to-action to purchase items.

**DESIGN DIRECTION:** The black market interface should be designed to evoke a sense of illicit activity, with a dark and mysterious aesthetic. The domain determines the interface's gritty, underground feel.

**LAYOUT UPGRADE:**
1. Replace the generic table with a card-based layout to provide a clear hierarchy of items.
2. Move item details to a collapsible panel to reduce clutter.
3. Add a prominent call-to-action to purchase items.

**COMPONENT-LEVEL CHANGES:**
- CURRENT: `GenericTable` → PROPOSED: `CardList`
- CURRENT: `Tooltip` → PROPOSED: `CollapsiblePanel`
- CURRENT: `Button` → PROPOSED: `ProminentCTA`

**VISUAL UPGRADES:**
- Use a dark color scheme with neon accents to evoke a sense of illicit activity.
- Add a subtle gradient effect to the card backgrounds to give them a sense of depth.
- Use a sans-serif font to convey a sense of edginess.

**CAPABILITY PRESENTATION:**
- Display the number of available items and the total cost of purchasing all items.
- Show a list of the top-selling items in the black market.

**LENS IDENTITY:** The black market lens has a dark, gritty aesthetic with neon accents and a sense of mystery.

**PRIORITY:** P1
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 8/10

---

**27. board**
===============

**LENS: board**
**PURPOSE:** Display a virtual game board for users to interact with.

**CURRENT DESIGN:**
- The game board is cluttered with unnecessary information and icons.
- There is no clear indication of the user's progress or goals.
- The board feels disconnected from the rest of the game's interface.

**DESIGN DIRECTION:** The board interface should be designed to be intuitive and engaging, with a clear focus on the game's core mechanics. The domain determines the interface's clean, modern aesthetic.

**LAYOUT UPGRADE:**
1. Streamline the board layout to focus on essential information.
2. Add a progress bar to show the user's current state.
3. Integrate the board with the rest of the game's interface.

**COMPONENT-LEVEL CHANGES:**
- CURRENT: `ClutteredBoard` → PROPOSED: `StreamlinedBoard`
- CURRENT: `ProgressIndicator` → PROPOSED: `ProgressBar`
- CURRENT: `DisconnectedComponents` → PROPOSED: `IntegratedComponents`

**VISUAL UPGRADES:**
- Use a clean, modern color scheme with a focus on the game's core colors.
- Add animations to the board to make it feel more dynamic.
- Use a sans-serif font to convey a sense of clarity.

**CAPABILITY PRESENTATION:**
- Display the user's current score and progress towards their goals.
- Show a list of available actions and their effects on the game world.

**LENS IDENTITY:** The board lens has a clean, modern aesthetic with a focus on clarity and engagement.

**PRIORITY:** P0
**DESIGN SCORE:** 8/10
**UPGRADE POTENTIAL:** 9/10
```

### Batch 2

See: `/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_2_FINDINGS.md`

```
# Batch 2 — Lens Design Audit Findings (27 lenses)

Generated 2026-08-17. Each lens evaluated independently. No cross-lens recommendations.

---

## 1. bounties

**LENS:** bounties
**PURPOSE:** Gitcoin / HackerOne-parity bounty platform — post bounties, claimants submit work, owners review/accept, milestone partial payouts, disputes, leaderboard. Plus legacy autofix staking.

**CURRENT DESIGN:**
- Amber-themed header with Trophy icon and descriptive subtitle
- Tab switcher (Bounty board / Autofix staking)
- 2-column layout: main bounty list + sidebar (activity + leaderboard)
- Stat cards (Open pool / Paid out) with coin icons
- BountyFilter, BountyCard, BountyLeaderboard, MyBountyActivity as sub-components
- Loading: centered spinner. Empty: dashed border with icon. Error: red alert with retry.
- Loading/empty/error states are well-handled
- No keyboard shortcuts beyond the `?` help command

**WHAT WORKS:** The tabbed Bounty board/Autofix split is clean. The stat cards give immediate context. The sidebar activity + leaderboard creates a sense of a living marketplace. Error/empty states are honest and informative. The amber color identity is consistent and distinctive.

**WHAT FEELS UNFINISHED:**
- The autofix staking tab is visually plain — raw list items with no visual hierarchy
- No animation or stagger effects on the bounty list
- The stat cards are small — they could be the hero of the page
- No visual differentiation between bounty difficulty levels or statuses

**DESIGN DIRECTION:** A competitive bounty marketplace — think GitHub Issues meets HackerOne's bounty board. The amber/gold color identity should feel like a *war room for paid problems*. Dense, scannable, reward-forward.

**LAYOUT UPGRADE:**
- Header: keep current amber icon + title + subtitle (works well)
- Hero area: elevate the stat cards to a full-width summary bar — open pool CC as a large central number, flanked by paid-out total, active bounty count, and recent payout timestamp
- Primary workspace: 3-column layout on desktop — filters rail (narrow left), bounty list (wide center), activity + leaderboard sidebar (right)
- The bounty card itself should feel like a *prize card* — reward amount as the largest visual element, not buried in text
- Autofix tab needs its own stat summary before the list

**COMPONENT-LEVEL CHANGES:**
- Current small stat cards (2-col grid, 10px labels) → full-width hero stat bar with large CC values
- Current BountyCard (standard card) → reward-amount-forward card with difficulty/status badges
- Current tab switcher (simple pill toggle) → keep but add subtle count badges per tab

**VISUAL UPGRADES:**
- Typography: bounty reward amounts should be `text-2xl font-bold` amber, not `text-lg`
- Add stagger animation to bounty list items
- Status badges should use filled backgrounds (not just text color) — `bg-amber-500/20` for open, `bg-emerald-500/20` for paid
- Difficulty should be a colored dot/pill, not just text
- Add a subtle gold border glow on high-value bounties

**CAPABILITY PRESENTATION:**
- CAPABILITY: Bounty leaderboard → CURRENT: small sidebar card → BETTER: standalone prominent section or tab with rankings, badges, win streaks
- CAPABILITY: My activity → CURRENT: small sidebar card → BETTER: prominent "Your Bounties" section showing claimed/owned/in-dispute at a glance

**LENS IDENTITY:** The war-room-for-problems aesthetic. Gold on dark. Dense information, scannable lists. Think "competitive coding challenge hub."

**RESPONSIVE:**
- Desktop: 3-column (filters | list | sidebar)
- Tablet: 2-column (list | sidebar, filters as dropdown)
- Mobile: single column, leaderboard/activity below list

**BEFORE/AFTER:**
- Before: standard card list with small stat boxes
- After: reward-forward bounty cards with a full-width CC summary bar, difficulty badges, and a prominent leaderboard

**IMPLEMENTATION PLAN:**
1. Elevate stat cards to a full-width hero bar with larger typography
2. Add difficulty/status badge pills with filled backgrounds
3. Add stagger animation to bounty list render
4. Restyle BountyCard to make reward amount the primary visual element
5. Add count badges to tab switcher

**PRIORITY:** P1
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 8/10

---

## 2. bridge

**LENS:** bridge
**PURPOSE:** Organism Bridge — emergent ↔ knowledge organism communication. Activity feed, organism management, debates, lifecycle events, emergent role overview, federation console.

**CURRENT DESIGN:**
- Purple/cyan dual-color identity with animated data-flow dots
- 4 stat cards (organisms, events, debates, roles) with stagger animation
- Animated bridge connection indicator (purple dots → cyan dots)
- 6-tab navigation (activity, organisms, debates, lifecycle, emergents, federation)
- Bridge Actions panel with 4 action buttons
- Real-time indicators (LiveIndicator, DTUExportButton)
- ConcordLinkWalkers at bottom
- Each tab has its own sub-component with empty states

**WHAT WORKS:** The animated data-flow indicator is visually distinctive and immediately communicates the "bridge" concept. The stat cards with stagger animation look polished. The 6-tab layout is well-organized. Empty states are helpful with contextual hints.

**WHAT FEELS UNFINISHED:**
- The page is very tall — many sections stacked vertically without visual breathing room
- The Bridge Actions panel is a generic button grid that doesn't feel designed
- The action results (health, data mapping, sync, throughput) render as raw data cards without visual hierarchy
- No tab content area has a consistent visual frame

**DESIGN DIRECTION:** A mission control for inter-system communication — think network monitoring dashboards (Datadog, Grafana). The purple/cyan split identity should feel like *two worlds talking to each other*. Data-forward, live, system-health oriented.

**LAYOUT UPGRADE:**
- Header: keep the purple icon + title (works)
- Stat cards: keep as-is (already good)
- Data flow indicator: keep (signature visual)
- Tab content: each tab should have a consistent card-frame with header + content
- Bridge Actions: move to a collapsible section, not a permanent panel
- Action results: render as formatted data tables or visualizations, not raw text blocks

**COMPONENT-LEVEL CHANGES:**
- Current Bridge Actions (4-col button grid) → collapsible action panel with better visual treatment
- Current action results (raw data cards) → formatted result cards with visual hierarchy
- Current sub-component tabs → add consistent section headers and padding

**VISUAL UPGRADES:**
- Add section dividers between major areas
- The action results should use progress bars, status indicators, and visual gauges instead of raw numbers
- Tab content areas need more padding and visual separation

**CAPABILITY PRESENTATION:**
- CAPABILITY: Connection Health → CURRENT: raw health score + list → BETTER: visual health gauge with per-connection status dots
- CAPABILITY: Data Mapping → CURRENT: coverage % + list → BETTER: visual mapping diagram with valid/invalid indicators

**LENS IDENTITY:** The two-worlds-colliding aesthetic. Purple and cyan splitting the visual field. Network monitoring energy. Live data streams.

**RESPONSIVE:**
- Desktop: full 4-col stat grid + tabbed content
- Tablet: 2-col stats, full-width tabs
- Mobile: stacked stats, horizontal tab scroll

**BEFORE/AFTER:**
- Before: stacked sections with a plain button grid for actions
- After: a coherent network dashboard with visual gauges for health/mapping/sync results

**IMPLEMENTATION PLAN:**
1. Format action result panels as visual gauges/tables instead of raw data blocks
2. Add section dividers and visual breathing room between areas
3. Make Bridge Actions collapsible
4. Add consistent card frames to each tab's content area

**PRIORITY:** P2
**DESIGN SCORE:** 7/10
**UPGRADE POTENTIAL:** 7/10

---

## 3. byo-keys

**LENS:** byo-keys
**PURPOSE:** BYO (Bring Your Own) API key management — configure personal API keys for external LLM providers. Security-focused config surface.

**CURRENT DESIGN:**
- 14 files, 2,459 total LOC, 406 page LOC, 2,053 bespoke LOC
- Polished with all pillars present (loading, empty, error, a11y, native buttons, keyboard, responsive, animation)
- Security-focused framing with honest documentation

**WHAT WORKS:** Correctly framed as a set-once config surface. The security framing is excellent — honest about what happens with keys. No pressure to return daily (correct UX for a config lens).

**DESIGN DIRECTION:** A security-focused settings terminal. Minimal, trustworthy, no marketing chrome. Think 1Password's vault UI — dense, no-nonsense, security-first.

**DESIGN SCORE:** 8/10 — already strong, no upgrades needed
**UPGRADE POTENTIAL:** 3/10
**PRIORITY:** P3

---

## 4. calendar

**LENS:** calendar
**PURPOSE:** Scheduling utility with real Google Calendar sync.

**CURRENT DESIGN:**
- 9 files, 5,660 total LOC, 2,469 page LOC, 3,191 bespoke LOC
- Polished with all pillars. Real Google Sync integration.

**WHAT WORKS:** Solid standard calendar grid. Real sync makes it inherently daily-use. Keyboard, responsive, animation all present.

**DESIGN DIRECTION:** A standard calendar utility — no forced re-skin needed. The real risk is Google Sync reliability, not engagement design.

**DESIGN SCORE:** 8/10 — clean, functional calendar
**UPGRADE POTENTIAL:** 4/10
**PRIORITY:** P3

---

## 5. careers

**LENS:** careers
**PURPOSE:** Living-career system — profession taxonomy, playable work shifts, contract negotiation, employer discovery, reputation gating, tier ladder progression.

**CURRENT DESIGN:**
- 3 files, 606 total LOC, 353 page LOC, 253 bespoke LOC (EmployerBrowser + ReputationGate as sub-components)
- Clean single-column layout with distinct sections
- 5 honest UX states (loading, error, disabled, empty, ready)
- The tier ladder is a flat list with locked/branch-point/mastery indicators
- No scaffold components beyond LensShell
- No animations or stagger effects

**WHAT WORKS:** The functional flow is excellent — track select → skill slider → play shift → result → ladder progression → contract negotiation. The EmployerBrowser and ReputationGate sub-components are genuinely useful. The disabled state is honest.

**WHAT FEELS UNFINISHED:**
- The tier ladder is a flat list — it should feel like an *actual career progression path*
- No visual reward for completing a shift (the `last` result is just a text line)
- The profession taxonomy section at the bottom is just pill badges — could be a richer browsing experience
- No visual progression indicator showing where you are on the ladder

**DESIGN DIRECTION:** A career progression RPG screen — think Fire Emblem class tree or Stardew Valley's skill pages. The ladder should feel like climbing. Each rung should feel earned.

**LAYOUT UPGRADE:**
- Header: keep current (works)
- Hero: a visual career progress bar showing current tier on the 10-rung ladder
- Work a shift: keep as-is but add a visual result animation (spark gain, XP gain as a brief flash)
- Tier ladder: transform from flat list to a vertical progression tree with locked/unlocked/branch-point visual states
- Reputation gate: keep but make it a more prominent section
- Employer browser: keep but add employer avatars/icons if available
- Contracts: keep as-is

**COMPONENT-LEVEL CHANGES:**
- Current flat tier list (ol > li) → vertical progression tree with visual nodes and connecting lines
- Current work result (text line) → visual result card with animated spark/XP gain
- Current profession pills → browsable profession cards with category headers

**VISUAL UPGRADES:**
- Add a vertical line connecting the ladder rungs (progress tree visual)
- Locked tiers: dimmed with lock icon + red tint
- Branch points: special visual indicator (fork icon + color)
- Mastery tiers: gold star icon
- Work shift result: brief animation showing spark gain
- Add a "you are here" marker on the current tier

**CAPABILITY PRESENTATION:**
- CAPABILITY: Tier ladder progression → CURRENT: flat numbered list → BETTER: visual progression tree with nodes, connecting lines, and a "you are here" marker
- CAPABILITY: Work shift result → CURRENT: text line "performance X → Y sparks + Z XP" → BETTER: animated result card with spark/XP counters

**LENS IDENTITY:** RPG career progression. The ladder is the hero. Every number is earned, every tier is a milestone.

**RESPONSIVE:**
- Desktop: full vertical tree ladder with work section at top
- Tablet: same layout, slightly tighter
- Mobile: ladder becomes horizontal scroll or collapsible sections

**BEFORE/AFTER:**
- Before: flat numbered list of tiers, text-line shift result
- After: visual progression tree with "you are here" marker, animated shift results, career milestone celebrations

**IMPLEMENTATION PLAN:**
1. Transform the tier list into a vertical progression tree with connecting lines
2. Add locked/unlocked/branch-point/mastery visual states to each tier node
3. Create an animated shift result card replacing the text line
4. Add a "you are here" marker based on current reputation

**PRIORITY:** P1
**DESIGN SCORE:** 7/10
**UPGRADE POTENTIAL:** 9/10

---

## 6. carpentry

**LENS:** carpentry
**PURPOSE:** Real interactive calculator for carpentry — material estimation, cut lists, cost calculation. Reference implementation for utility lenses.

**CURRENT DESIGN:**
- 4 files, 1,318 total LOC, 79 page LOC, 1,239 bespoke LOC
- The page itself is thin (79 LOC) — the real UI lives in bespoke components
- Already identified as the single best example in the platform

**DESIGN SCORE:** 9/10 — reference implementation, no upgrades needed
**UPGRADE POTENTIAL:** 2/10
**PRIORITY:** P3

---

## 7. chat

**LENS:** chat
**PURPOSE:** Core chat surface — WebSocket streaming, DTU context, web search, personality persistence. The platform's single most-opened surface.

**CURRENT DESIGN:**
- 40 files, 12,739 total LOC, 33 page LOC, 12,706 bespoke LOC
- Currently classified as "functional" (not polished) — 1 divAsButton anti-pattern
- Private Mode / High Power Mode honest-disclosure card
- Recently fixed height bug (min-h-[280px])
- Virtuoso virtualized list, 112 tool refs

**WHAT WORKS:** The chat surface itself is feature-rich — streaming, tool calls, DTU citations, real-time presence. The Private Mode card is an excellent honest-disclosure model.

**WHAT FEELS UNFINISHED:**
- The divAsButton anti-pattern needs fixing for accessibility
- The Private Mode/High Power card should condense once messages are flowing

**DESIGN DIRECTION:** A premium chat surface — think Claude.ai or ChatGPT's clean chat UI but with more system transparency. The honest disclosure card is the signature differentiator.

**DESIGN SCORE:** 7/10 — functionally complete but needs the anti-pattern fix
**UPGRADE POTENTIAL:** 5/10
**PRIORITY:** P2

---

## 8. chem

**LENS:** chem
**PURPOSE:** Chemistry/research lens — real arXiv physics + PubChem integration. Research terminal look.

**CURRENT DESIGN:**
- 7 files, 2,683 total LOC, 440 page LOC, 2,243 bespoke LOC
- Uses generic scaffold trio (ManifestActionBar, AutoActionStrip, LensFeaturePanel)
- Clean research-terminal look with real data sources

**WHAT WORKS:** The real arXiv + PubChem integration makes it genuinely useful. The research-terminal aesthetic fits.

**DESIGN DIRECTION:** A chemistry research terminal — think SciFinder or Reaxys but styled as a dark-mode terminal. Dense data, structural formulas, compound cards.

**DESIGN SCORE:** 7/10 — functional, clean
**UPGRADE POTENTIAL:** 5/10
**PRIORITY:** P2

---

## 9. civic-bonds

**LENS:** civic-bonds
**PURPOSE:** Micro-bond engine transparency — active bonds with progress bars, pledge/vote/fund controls, public ledger, spillover fund.

**CURRENT DESIGN:**
- 1 file, 367 total LOC — all in page.tsx, no sub-components
- 4 honest UX states (loading, error, empty, ready) + disabled coming-soon
- Good a11y (aria labels, native buttons, role attributes)
- Progress bar with 110% funding gate line
- Mobile-first responsive Tailwind

**WHAT WORKS:** The honesty of the implementation is excellent — disabled state, error handling, ledger lazy-loading. The progress bar with gate line is a clever visual. The spillover fund with real GOVERNANCE_SCOPES picker is well-designed.

**WHAT FEELS UNFINISHED:**
- No animation or visual polish
- The bond cards are functional but flat
- The ledger section is just text lists
- No visual differentiation between bond statuses

**DESIGN DIRECTION:** A civic infrastructure dashboard — think municipal bond tracking. Official, trustworthy, transparent. The amber color should feel like *public works*.

**LAYOUT UPGRADE:**
- Header: keep (works)
- Bond cards: add visual status indicators (colored left border by status)
- Progress bar: keep the gate line but add animation on progress changes
- Ledger: format as a proper table with alternating row backgrounds
- Spillover fund: keep as-is (already good)

**COMPONENT-LEVEL CHANGES:**
- Current bond cards (flat list items) → status-bordered cards with progress animation
- Current ledger (text list) → formatted table with proper headers
- Current vote count text → visual vote tally bar

**VISUAL UPGRADES:**
- Add left border color to bond cards by status (amber=open, green=gate cleared, blue=funded)
- Animate progress bar width changes
- Format ledger as a styled table
- Add visual vote tally (for/against ratio bar)

**LENS IDENTITY:** Municipal transparency dashboard. Trustworthy, official, every number backed by a real ledger entry.

**RESPONSIVE:**
- Desktop: full-width bond cards with inline controls
- Tablet: same
- Mobile: controls stack vertically

**BEFORE/AFTER:**
- Before: flat bond cards with text list ledger
- After: status-bordered cards with animated progress, formatted ledger table, visual vote tally

**IMPLEMENTATION PLAN:**
1. Add left border color by bond status to bond cards
2. Animate progress bar width
3. Format ledger as a styled table
4. Add visual vote tally bar

**PRIORITY:** P1
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 7/10

---

## 10. classroom

**LENS:** classroom
**PURPOSE:** Federated academic cohorts — create cohorts, enrol students, submit homework as DTUs, citation cascade as credit system.

**CURRENT DESIGN:**
- 3 files, 1,372 total LOC, 261 page LOC, 1,111 bespoke LOC
- Uses LensVerticalHero component
- 3-column grid for Create/Enrol/Submit forms
- Teaching/Studying cohort lists
- ClassroomWorkspace component for stream/classwork/gradebook
- OpenLibrarySearch for book discovery
- Good loading/error/empty states

**WHAT WORKS:** The 3-column form layout is efficient. The cohort lists show teaching vs studying clearly. The ClassroomWorkspace and OpenLibrarySearch sub-components add real depth.

**WHAT FEELS UNFINISHED:**
- The 3-column form grid feels like a raw admin panel — not designed for students
- The cohort lists are flat text items
- No visual representation of class progress or student activity
- The forms use basic input styling without labels (just placeholders)

**DESIGN DIRECTION:** Google Classroom reimagined — clean, organized, focused on the student/teacher workflow. Not a form panel — a *class management hub*.

**LAYOUT UPGRADE:**
- Header: keep current
- Forms: redesign as a step-by-step workflow or tabbed Create/Enrol/Submit, not a 3-column grid of raw inputs
- Cohort lists: add visual indicators (enrollment count, recent activity dot, last submission time)
- Workspace: keep as-is (ClassroomWorkspace is already designed)

**COMPONENT-LEVEL CHANGES:**
- Current 3-col form grid → tabbed Create/Enrol/Submit with labeled inputs
- Current cohort list items → enriched cards with enrollment count + activity indicator

**VISUAL UPGRADES:**
- Add labels above form inputs (not just placeholders)
- Add visual activity indicators to cohort items
- Style cohort cards with left accent border by role (teaching vs studying)

**LENS IDENTITY:** Academic management — organized, clear, student-centered. Not a database admin panel.

**RESPONSIVE:**
- Desktop: forms side by side or tabbed
- Tablet/Mobile: stacked forms with clear section headers

**BEFORE/AFTER:**
- Before: 3-column grid of unlabeled form inputs, flat cohort text lists
- After: labeled tabbed forms, enriched cohort cards with activity indicators

**IMPLEMENTATION PLAN:**
1. Add visible labels above form inputs
2. Convert 3-column form grid to tabbed Create/Enrol/Submit
3. Add activity indicators to cohort list items
4. Style cohort cards with role-based accent colors

**PRIORITY:** P1
**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 7/10

---

## 11. code

**LENS:** code
**PURPOSE:** VSCode-parity code workspace — Monaco editor, file tree, terminal, AI edit (⌘K), AI chat (⌘L), source control, snippets, forge generation, multi-file agent review.

**CURRENT DESIGN:**
- 30 files, 9,933 total LOC, 2,711 page LOC, 7,222 bespoke LOC
- Full VSCode shell with activity bar, terminal, settings panel
- Monaco editor with semantic IntelliSense via LSP bridge
- AI edit (cursor-style inline diff) + AI chat side panel
- Source control panel, snippets library, GitHub connect
- Forge generation (AI scaffold)
- Command palette (⌘P/⌘Shift+P)
- Find in files (⌘⇧F)
- BrainStatusBadge, MobileTabBar

**WHAT WORKS:** This is the most feature-rich lens in the platform. The Monaco integration, AI edit/Chat, command palette, and file tree are all real and functional. The VSCode shell layout is recognizable and effective.

**WHAT FEELS UNFINISHED:**
- The upgrade plan flagged it as "fully stuck — nav tabs render but body is 100% skeleton placeholders"
- The page is extremely long (2,700+ LOC) — it needs extraction
- Many toggleable panels create a complex state surface

**DESIGN DIRECTION:** A real IDE inside Concord — VSCode's visual language is already adopted. The goal is *feature depth without visual chaos*.

**DESIGN SCORE:** 6/10 — features are deep but the page may be visually stuck
**UPGRADE POTENTIAL:** 7/10
**PRIORITY:** P1 (if skeleton issue is real — verify before acting)

---

## 12. code-quality

**LENS:** code-quality
**PURPOSE:** Real static analysis tool — code quality metrics, linting results, vulnerability scanning.

**CURRENT DESIGN:**
- 8 files, 1,580 total LOC, 477 page LOC, 1,103 bespoke LOC
- Uses generic scaffold trio
- Dense/functional dev-tool look

**DESIGN DIRECTION:** SonarQube / CodeClimate aesthetic — dense, metric-heavy, per-PR framing (not daily-use).

**DESIGN SCORE:** 7/10 — functional, appropriate density
**UPGRADE POTENTIAL:** 4/10
**PRIORITY:** P2

---

## 13. codex

**LENS:** codex
**PURPOSE:** The authored cosmology reader — browse/filter 87+ hand-authored lore events across worlds, bookmark entries, deep-link via ?id= parameter.

**CURRENT DESIGN:**
- 1 file, 466 total LOC — all in page.tsx, zero sub-components
- Custom color system (inline `COLORS` object, not Tailwind) — warm parchment palette
- Deep-link modal (lore.get) with copy-permalink
- Three Pillars spine section (primordial lore events)
- World-grouped lore entries with expand/collapse
- Tag cross-referencing (click tag → filter all entries by tag)
- Per-user bookmarks via useLensData
- Four explicit UX states
- No scaffold components besides LensShell

**WHAT WORKS:** The custom color palette is excellent — warm parchment tones (`#e8e4dc` fg, `#15151c` panel) that immediately distinguish this from every other lens. The deep-link + permalink system is well-designed. The tag cross-referencing is a genuinely useful browsing feature. The Three Pillars spine section is a great visual hierarchy choice.

**WHAT FEELS UNFINISHED:**
- The inline `style` objects for every element make the styling rigid and verbose
- No animation or transition on expand/collapse
- The "Three Pillars" section uses raw `<details>` elements — could be styled
- No visual differentiation between lore types (primordial, war, cultural, etc.)
- The bookmark star is a Unicode character, not a designed component

**DESIGN DIRECTION:** A medieval manuscript reader meets Destiny 2's Lore Book. Warm parchment aesthetic, hierarchical text display, bookmarking for personal codex. Think illuminated manuscript — every entry is a *discovery*.

**LAYOUT UPGRADE:**
- Header: keep (works — the count + bookmark count is good)
- Three Pillars: elevate from `<details>` to a styled visual section with a subtle divider or visual frame
- Filters: keep as-is (search + world + kind select is functional)
- Lore entries: add type-colored left borders or icons per lore type
- Tag pills: style as clickable chips with hover states
- Deep-link modal: keep (already good)

**COMPONENT-LEVEL CHANGES:**
- Current `<details>` Three Pillars → styled collapsible section with lore-type icons
- Current flat lore entry list → type-bordered entries with visual type indicator
- Current Unicode bookmark star → styled bookmark button with fill animation

**VISUAL UPGRADES:**
- Add lore type icons (primordial = star, war = sword, cultural = scroll, etc.)
- Add type-colored left border to lore entries
- Style tag pills as proper chips with hover/active states
- Add expand/collapse animation (height transition)
- Style the bookmark star with a fill animation on toggle

**CAPABILITY PRESENTATION:**
- CAPABILITY: Tag cross-referencing → CURRENT: small clickable tags at bottom of entry → BETTER: prominent tag bar at top of entry, more visual weight on the tag filtering feature
- CAPABILITY: Bookmarking → CURRENT: Unicode star in corner → BETTER: prominent bookmark toggle with visual feedback

**LENS IDENTITY:** The warm parchment cosmology reader. Every other lens is cold zinc — this one glows. The manuscript aesthetic is already 80% there.

**RESPONSIVE:**
- Desktop: full 980px max-width with filters + list
- Tablet: same, filters wrap
- Mobile: stacked filters, entries full-width

**BEFORE/AFTER:**
- Before: flat lore entries with raw `<details>` for pillars, Unicode star bookmarks
- After: type-bordered entries with lore icons, styled pillar section, animated bookmark toggle

**IMPLEMENTATION PLAN:**
1. Add lore type icons and colored left borders to entries
2. Style the Three Pillars section from `<details>` to a custom collapsible
3. Replace Unicode bookmark star with styled toggle button
4. Add expand/collapse height animation
5. Style tag pills as proper chips

**PRIORITY:** P2
**DESIGN SCORE:** 7/10
**UPGRADE POTENTIAL:** 7/10

---

## 14. cognition

**LENS:** cognition
**PURPOSE:** Lattice-orchestrator surface — drift alerts, breakthrough clusters, convergence monitoring. Internal systems tool.

**CURRENT DESIGN:**
- 8 files, 1,723 total LOC, 480 page LOC, 1,243 bespoke LOC
- Uses generic scaffold trio
- Dense data-terminal look

**DESIGN DIRECTION:** Internal monitoring terminal — think Grafana/Prometheus dashboard. Dense, metric-heavy, alert-focused. "Did drift alerts fire overnight?" is the daily question.

**DESIGN SCORE:** 7/10 — appropriate density for an internal tool
**UPGRADE POTENTIAL:** 4/10
**PRIORITY:** P3

---

## 15. cognitive-replay

**LENS:** cognitive-replay
**PURPOSE:** Spotify-Wrapped / RescueTime-style scrubber for the cognitive timeline. Stats, wrapped cards, filtering, heatmap, window compare, snapshots.

**CURRENT DESIGN:**
- 9 files, 1,238 total LOC, 325 page LOC, 913 bespoke LOC
- Rich sub-component set: WrappedCards, StatsBar, FilteredTimeline, ActivityHeatmap, WindowCompare, SnapshotPanel, EventDetailModal, TimelineExport
- Scrubber with range display
- Brain-colored tags (amber/purple/cyan/rose/emerald)
- 5 tabs (Wrapped, Heatmap, Filter, Compare, Snapshots)
- Honest empty state linking to chat

**WHAT WORKS:** The sub-component decomposition is excellent — each feature is a dedicated component. The brain color coding is distinctive. The scrubber with cursor display is well-designed. The honest empty state ("Have a chat session and come back") is perfect.

**WHAT FEELS UNFINISHED:**
- No animation or visual flair despite being a "Wrapped" experience — Spotify Wrapped is ALL about visual delight
- The scrubber is a plain range input — it could be a visual timeline
- The tab content is hidden behind tabs without preview

**DESIGN DIRECTION:** Spotify Wrapped meets data visualization. This should be the *most visually delightful* lens in the platform. Rich charts, brain-colored gradients, celebration animations. The cognitive timeline is inherently personal and reflective.

**LAYOUT UPGRADE:**
- Header: keep (title + stats are good)
- Scrubber: replace plain range input with a visual timeline with brain-colored dots/marks
- Cursor display: keep (already good)
- Tab content: keep tabs but add subtle preview or transition between them
- StatsBar: could be more visually prominent

**COMPONENT-LEVEL CHANGES:**
- Current plain range scrubber → visual timeline with brain-colored event markers
- Current tab content switch → add crossfade transition

**VISUAL UPGRADES:**
- Replace range input with a custom visual timeline showing brain-colored dots at each event
- Add brain-color gradient backgrounds to stat cards
- Add crossfade transition between tabs
- Make the cursor card more visually striking (brain color as background tint)

**LENS IDENTITY:** The personal cognitive mirror. Rich, colorful, reflective. Every brain has its own color — the timeline should feel like *your* mind visualized.

**RESPONSIVE:**
- Desktop: full scrubber + stats + tabs
- Tablet: same, slightly compressed
- Mobile: scrubber full-width, stats 2-col, tabs horizontal scroll

**BEFORE/AFTER:**
- Before: plain range input scrubber, basic tabs, flat stat cards
- After: visual timeline with brain-colored event markers, gradient stat cards, crossfade tab transitions

**IMPLEMENTATION PLAN:**
1. Replace range input with custom visual timeline showing brain-colored event markers
2. Add gradient backgrounds to stat cards based on dominant brain used
3. Add crossfade transition between tab content
4. Enrich cursor card with brain-color background tint

**PRIORITY:** P2
**DESIGN SCORE:** 7/10
**UPGRADE POTENTIAL:** 8/10

---

## 16. collab

**LENS:** collab
**PURPOSE:** Real-time collaborative editing via CRDT (Yjs). Session management, presence indicators.

**CURRENT DESIGN:**
- 4 files, 3,698 total LOC, 2,095 page LOC, 1,603 bespoke LOC
- Real CRDT co-editing via Yjs
- Session list layout
- Known minor issue: stray "...ghts yet" text fragment (CSS overflow)

**DESIGN DIRECTION:** Figma/Google Docs energy — session list with presence indicators, real-time cursors, active editor count.

**DESIGN SCORE:** 7/10 — real CRDT makes it inherently valuable
**UPGRADE POTENTIAL:** 5/10
**PRIORITY:** P2

---

## 17. command-center

**LENS:** command-center
**PURPOSE:** Admin dashboard — system vitals, brain architecture, lattice monitor, plugin manager, LLM pipeline, user overview, config, emergency controls, dream synthesis, logs, repair cortex, promotions, breakthroughs.

**CURRENT DESIGN:**
- 3 files, 3,766 total LOC, 2,125 page LOC, 1,641 bespoke LOC
- Admin-gated (shows AdminRequiredState for non-admins)
- 12+ panels as separate components
- Cyan/teal color identity with StatusDot, Stat, BreakerBadge helpers
- LiveIndicator, DTUExportButton, RealtimeDataPanel
- FoundationCard, ActivityFeed, UndoTimeline, SystemGuidePanel
- 15s auto-refresh on most panels

**WHAT WORKS:** The panel decomposition is excellent — each system concern has its own dedicated panel. The StatusDot with pulse animation is polished. The ConfirmButton pattern for destructive actions is well-designed. The dream synthesis panel with purple identity is a nice touch.

**WHAT FEELS UNFINISHED:**
- Gated behind admin — can't evaluate full design without admin access
- The page is extremely long (12+ panels stacked vertically)
- No panel organization/tabs — just a long scroll of panels
- Brain status panel duplicates data from vitals panel

**DESIGN DIRECTION:** Mission control for platform operators. Think Grafana + Datadog + Vercel dashboard. Dense, live, every panel a real system surface.

**DESIGN SCORE:** 7/10 — strong panel decomposition, needs organization
**UPGRADE POTENTIAL:** 5/10
**PRIORITY:** P2

---

## 18. commonsense

**LENS:** commonsense
**PURPOSE:** Reasoning-grounding knowledge base — common sense facts for LLM grounding verification.

**CURRENT DESIGN:**
- 4 files, 2,269 total LOC, 837 page LOC, 1,432 bespoke LOC
- Uses generic scaffold trio
- Stat card grid
- Quick Add fact entry
- Dense but functional

**DESIGN DIRECTION:** Knowledge base / ontology browser — dense, fact-forward, no-nonsense. Think Wikidata's UI but dark mode.

**DESIGN SCORE:** 7/10 — clean stat cards, functional Quick Add
**UPGRADE POTENTIAL:** 4/10
**PRIORITY:** P3

---

## 19. concord-link-frontier

**LENS:** concord-link-frontier
**PURPOSE:** Cross-world federation news feed + royalty flow ledger. Real-time ticker of notable cross-world events.

**CURRENT DESIGN:**
- 1 file, 298 total LOC — all in page.tsx, zero sub-components
- Clean gradient background (from-slate-950 via-zinc-950 to-cyan-950/10)
- Cyan color identity with Radio icon
- Two sections: cross-world feed (event list) + royalty flow (table)
- Honest empty states ("No cross-world activity yet")
- 15s auto-refresh with keyboard shortcut (R)
- ManifestActionBar + DepthBadge

**WHAT WORKS:** The gradient background is distinctive — one of the few lenses with a non-flat background. The honest empty states are perfect. The real-time auto-refresh with visible "last synced" timestamp builds trust. The table for royalty flows is the right data presentation.

**WHAT FEELS UNFINISHED:**
- The two sections (feed + table) are stacked vertically with minimal visual separation
- The feed events are just text lines — no visual hierarchy for event importance
- No visual indicator for "worlds active in the feed window" beyond the text count
- The royalty flow table is plain — could use visual amount highlighting

**DESIGN DIRECTION:** A federation news wire — think Bloomberg Terminal meets RSS reader. The cross-world feed should feel like a *live news ticker*. The cyan gradient already suggests "distant signals arriving."

**LAYOUT UPGRADE:**
- Header: keep (the gradient + Radio icon + metadata line is well-designed)
- Feed: make each event a card with notability-based visual weight (more notable = larger/colored)
- Royalty flow: add visual amount highlighting for large transactions
- Add a "worlds active" visual indicator — small world dots/icons

**COMPONENT-LEVEL CHANGES:**
- Current feed events (text lines) → notability-weighted cards with world badges
- Current royalty table → styled table with amount-based row highlighting

**VISUAL UPGRADES:**
- Notability-weighted event cards (higher notability = more visual prominence)
- World ID badges with consistent coloring
- Royalty amount formatting with visual emphasis on large amounts
- Add subtle pulse animation on new events

**LENS IDENTITY:** The federation news wire. Cyan signals from distant worlds. Every event is a real cross-world occurrence. The gradient background already communicates "receiving signals."

**RESPONSIVE:**
- Desktop: feed + table side by side or stacked
- Tablet: stacked
- Mobile: stacked, table scrolls horizontally

**BEFORE/AFTER:**
- Before: plain text event list + basic table
- After: notability-weighted event cards with world badges + styled royalty table with amount highlighting

**IMPLEMENTATION PLAN:**
1. Weight event cards by notability (border color, font size)
2. Add world ID badges with consistent coloring
3. Style royalty table with amount-based row highlighting
4. Add subtle pulse animation on new events

**PRIORITY:** P2
**DESIGN SCORE:** 7/10
**UPGRADE POTENTIAL:** 7/10

---

## 20. construction

**LENS:** construction
**PURPOSE:** Construction/trade management — 37 real DTUs, trade-specific stat cards, crew dispatch.

**CURRENT DESIGN:**
- 5 files, 3,038 total LOC, 888 page LOC, 2,150 bespoke LOC
- Uses generic scaffold trio
- Functional trade-tool look
- Known issue: false "Disconnected" pill despite real data

**DESIGN DIRECTION:** Contractor's job board — functional, trade-specific, no-nonsense. Think Procore or Buildertrend in dark mode.

**DESIGN SCORE:** 7/10 — functional, needs the disconnected pill fix
**UPGRADE POTENTIAL:** 5/10
**PRIORITY:** P2

---

## 21. consulting

**LENS:** consulting
**PURPOSE:** Management consulting workspace — engagement pipeline, deliverables, timesheets, reference database.

**CURRENT DESIGN:**
- 13 files, 2,610 total LOC, 775 page LOC, 1,834 bespoke LOC
- Uses full scaffold suite (LensShell, RecentMineCard, AutoActionStrip, CrossLensRecentsPanel, FirstRunTour, DepthBadge, ManifestActionBar, LensPageShell)
- Engagement Pipeline status-flow visualization
- 5 stat cards, 7-tab nav, CRUD library, 3 collapsible panels
- Dynamic status color classes (potential Tailwind JIT issue)
- Framer-motion staggered animations

**WHAT WORKS:** The engagement pipeline status-flow visualization is the standout feature — a real visual workflow. The 7-tab navigation covers a lot of ground. The 3 collapsible panels (ConsultingFirmReference, EngagementTracker, ConsultingWorkbench) add depth.

**WHAT FEELS UNFINISHED:**
- Dynamic `bg-${sc.color}` classes won't work with Tailwind JIT — the pipeline colors may not render
- The `showDashboard` toggle duplicates logic with the main stat row
- The false "Disconnected" pill (same pattern as construction)

**DESIGN DIRECTION:** McKinsey/BCG tooling — polished, professional, dense. The pipeline visualization should be the hero.

**DESIGN SCORE:** 7/10 — strong pipeline, Tailwind JIT issue needs fix
**UPGRADE POTENTIAL:** 6/10
**PRIORITY:** P2

---

## 22. cooking

**LENS:** cooking
**PURPOSE:** Real recipe/meal-prep tool — recipe library, USDA food search, nutrition explorer, cooking timer, recipe kitchen.

**CURRENT DESIGN:**
- 8 files, 2,677 total LOC, 265 page LOC, 2,411 bespoke LOC
- Clean composition of real components: KitchenDashboardStrip, CookingTimer (SVG ring countdown), RecipeBoxSection, RecipeKitchen, UsdaFoodSearch, NutritionExplorer, CookingActionPanel
- Real-time features (useRealtimeLens, LiveIndicator, DTUExportButton)
- Keyboard shortcut (t = timer toggle)
- LensFeedButton

**WHAT WORKS:** This is the cleanest page in the batch — pure composition of well-designed components. The SVG ring countdown timer is a standout visual element. The USDA integration is real and useful.

**DESIGN DIRECTION:** A kitchen workstation — think Yummly meets a cooking timer app. Warm, practical, ingredient-forward.

**DESIGN SCORE:** 8/10 — the cleanest page in the batch
**UPGRADE POTENTIAL:** 5/10
**PRIORITY:** P2

---

## 23. council

**LENS:** council
**PURPOSE:** Deep governance tool — proposals, voting, meetings, debates, budget simulation, audit log, stakeholder management, workbench.

**CURRENT DESIGN:**
- 7 files, 5,678 total LOC, 3,284 page LOC, 2,394 bespoke LOC — THE LARGEST PAGE IN THE BATCH
- 9-tab governance system (Proposals/Voting/Meetings/Debates/Budget/Archive/Audit/Stakeholders/Workbench)
- Extensive inline type definitions (~120 lines)
- Budget simulation via real macro
- Debate synthesis engine
- Audit log with CSV export
- Vim-style keyboard shortcuts (g+p/g+v/g+d, n=new, /=search, 1-5=status filters)
- 6 separate useLensData hooks, 3 useQuery hooks, ~40 useCallback hooks

**WHAT WORKS:** The sheer depth is impressive — 9 tabs each with full CRUD, real budget simulation, debate synthesis. The vim-style keyboard shortcuts are a distinctive power-user feature. The audit log with CSV export is production-grade.

**WHAT FEELS UNFINISHED:**
- The page is monolithic at 3,284 LOC — it needs decomposition
- No visual organization of the 9 tabs — they're all equal weight
- The budget simulation is buried in a tab instead of being a hero feature
- Inline type definitions (~120 lines) add noise

**DESIGN DIRECTION:** A government operations center — think Bloomberg Government or a city council chamber's digital twin. Dense, authoritative, every action has consequences.

**LAYOUT UPGRADE:**
- Decompose the 9 tabs into a sidebar navigation (like VSCode's activity bar)
- Budget simulation deserves its own prominent panel, not a tab
- The debate synthesis could be a visual debate stage
- The audit log should be a filterable, sortable table

**COMPONENT-LEVEL CHANGES:**
- Current 9 horizontal tabs → sidebar tab navigation (like code lens's ActivityBar)
- Current budget tab → prominent dashboard widget
- Current audit log → filterable data table

**VISUAL UPGRADES:**
- Sidebar tab navigation with icons
- Budget visualization as a dashboard with allocation bars
- Debate transcripts as a threaded view
- Audit log as a styled data table with filters

**LENS IDENTITY:** Authoritative governance. Dense, consequential, every vote and budget decision matters. The vim shortcuts are a power-user signature.

**RESPONSIVE:**
- Desktop: sidebar tabs + content area
- Tablet: horizontal tabs + content
- Mobile: bottom tab bar + content

**BEFORE/AFTER:**
- Before: 9 horizontal tabs, monolithic 3,284 LOC page
- After: sidebar navigation, decomposed sub-components, budget dashboard as hero

**IMPLEMENTATION PLAN:**
1. Extract sub-components from the monolithic page into separate files
2. Convert 9 horizontal tabs to sidebar navigation
3. Elevate budget simulation to a prominent dashboard widget
4. Style audit log as a filterable data table

**PRIORITY:** P1
**DESIGN SCORE:** 6/10
**UPGRADE POTENTIAL:** 8/10

---

## 24. courtship

**LENS:** courtship
**PURPOSE:** Real world-linked romance mechanic — courtship progression, marriages, pregnancies, children, dissolution.

**CURRENT DESIGN:**
- 3 files, 835 total LOC, 622 page LOC, 213 bespoke LOC
- Only LensShell as scaffold — NO RecentMineCard, AutoActionStrip, CrossLensRecentsPanel, FirstRunTour, DepthBadge, ManifestActionBar
- Raw Tailwind styling (no ds.* design system)
- Raw fetch() calls instead of the api client
- HeartEventModal, ConfirmDissolveModal as sub-components
- Excellent documentation in header comment
- Honest error states

**WHAT WORKS:** The documentation is excellent — every backend endpoint is documented in the header. The honest error states are well-designed. The pregnancy-cache for cross-reload persistence is thoughtful.

**WHAT FEELS UNFINISHED:**
- Missing all scaffold components (inconsistent with every other lens in the batch)
- Raw fetch() instead of api client
- No animation or visual polish
- The courtship list is just text items
- No visual representation of relationship progression

**DESIGN DIRECTION:** A relationship management screen — think The Sims' relationship panel meets a dating app profile. Warm, personal, visual progression indicators.

**LAYOUT UPGRADE:**
- Header: add icon + visual identity
- Courtship list: add visual affinity bars or heart icons showing progression
- Marriages: add visual marriage status cards
- Children: add visual cards with family tree hint
- Add the missing scaffold components for consistency

**COMPONENT-LEVEL CHANGES:**
- Current plain text courtship list → affinity-bar cards with heart progression
- Current raw fetch() → api client (code quality, not visual)
- Add missing scaffold components

**VISUAL UPGRADES:**
- Add a courtship-specific color identity (warm rose/pink)
- Visual affinity progression bars on each courtship
- Marriage status cards with visual indicators
- Heart/ring icons per section header
- Add subtle heart animation on affinity changes

**LENS IDENTITY:** Personal, warm, relationship-focused. The only lens about human connection. Should feel emotionally resonant, not clinical.

**RESPONSIVE:**
- Desktop: full layout
- Tablet: same
- Mobile: stacked sections

**BEFORE/AFTER:**
- Before: plain text lists, missing scaffold, no visual identity
- After: affinity-bar cards, warm color identity, visual relationship progression

**IMPLEMENTATION PLAN:**
1. Add courtship-specific warm color identity (rose/pink accents)
2. Add visual affinity progression bars to courtship cards
3. Add missing scaffold components (DepthBadge, FirstRunTour, etc.)
4. Replace raw fetch() with api client
5. Style marriage/children sections with visual cards

**PRIORITY:** P1
**DESIGN SCORE:** 5/10
**UPGRADE POTENTIAL:** 8/10

---

## 25. crafting

**LENS:** crafting
**PURPOSE:** Real recipe substrate — Mine/Forge/Browse/Skills/Workbench/Author tabs, marketplace integration, skill progression, resource management.

**CURRENT DESIGN:**
- 3 files, 2,587 total LOC, 1,422 page LOC, 1,165 bespoke LOC
- 6-tab navigation with full CRUD per tab
- Rich sub-components: RecipeLedger, CraftingWorkbench, RecipeAuthorPanel, ActiveEffectsBar, ProgressionPanel, StatStrip, ResourceBars, MineTab, ForgeTab, BrowseTab, SkillsTab, RecipeDetailModal, ListingModal, InventoryStrip, RequirementsRow
- next/dynamic imports for heavy components
- Uses generic scaffold trio

**WHAT WORKS:** The 6-tab structure is well-organized. The sub-component decomposition is thorough. The marketplace integration (Browse tab with listing modal) is real. The dynamic imports show performance awareness.

**DESIGN DIRECTION:** A crafting workshop — think Minecraft's crafting table meets an MMO auction house. Material-forward, recipe-focused, tangible.

**DESIGN SCORE:** 8/10 — well-structured, rich features
**UPGRADE POTENTIAL:** 5/10
**PRIORITY:** P2

---

## 26. creative

**LENS:** creative
**PURPOSE:** StudioBinder + Frame.io parity — production boards, shot list generation, feedback workflows, Reddit creative integration.

**CURRENT DESIGN:**
- 7 files, 2,367 total LOC, 206 page LOC, 2,161 bespoke LOC
- Pure composition of real components
- Real-time features, DTU artifact support
- PipingProvider for producer bench
- Excellent header documentation explaining removed CRUD system

**WHAT WORKS:** The composition is clean — each section is a dedicated component. The documentation explains the design decisions. Real-time features and DTU support add depth.

**DESIGN DIRECTION:** A producer's dashboard — Milanote meets Frame.io. Visual, board-oriented, production-focused.

**DESIGN SCORE:** 7/10 — clean composition, good documentation
**UPGRADE POTENTIAL:** 5/10
**PRIORITY:** P2

---

## 27. creative-writing

**LENS:** creative-writing
**PURPOSE:** Scrivener/Dabble/Plottr-shape manuscript studio — creative writing workspace with word processing, research integration.

**CURRENT DESIGN:**
- 14 files, 2,572 total LOC, 80 page LOC, 2,492 bespoke LOC — page is tiny, components do the work
- Minimal composition: CreativeWritingSection, DatamusePanel, GutendexSearch
- Uses LensShell + most scaffold components
- Missing ManifestActionBar (inconsistent)
- Excellent header documentation
- RealtimeDataPanel present

**WHAT WORKS:** The minimal page composition is elegant — 80 LOC page, real components doing the heavy lifting. The DatamusePanel and GutendexSearch provide genuine research tools for writers.

**WHAT FEELS UNFINISHED:**
- Missing ManifestActionBar (inconsistent with other lenses)
- No visual identity beyond the standard zinc palette

**DESIGN DIRECTION:** A writer's study — think Scrivener's cork board meets a dimly lit library. Warm, focused, manuscript-forward. The only lens where "the text IS the product."

**DESIGN SCORE:** 7/10 — clean, but needs visual identity
**UPGRADE POTENTIAL:** 6/10
**PRIORITY:** P2

---

## Summary Rankings

### P0 — Redesign Immediately
None in this batch. All 27 lenses are functional and have reasonable visual structure.

### P1 — Major Visual Upgrade
| Lens | Score | Upgrade Potential | Key Issue |
|------|-------|-------------------|-----------|
| careers | 7/10 | 9/10 | Tier ladder is a flat list — should be a visual progression tree |
| civic-bonds | 6/10 | 7/10 | Bond cards are flat, ledger is text lists |
| classroom | 5/10 | 7/10 | Raw form panels, flat cohort lists |
| code | 6/10 | 7/10 | Potentially stuck on skeleton placeholders |
| courtship | 5/10 | 8/10 | Missing scaffold, no visual identity |
| council | 6/10 | 8/10 | Monolithic 3,284 LOC, needs decomposition |

### P2 — Polish
| Lens | Score | Upgrade Potential | Key Issue |
|------|-------|-------------------|-----------|
| bridge | 7/10 | 7/10 | Action results need visual formatting |
| chat | 7/10 | 5/10 | divAsButton anti-pattern |
| chem | 7/10 | 5/10 | Clean but generic |
| code-quality | 7/10 | 4/10 | Appropriate density |
| codex | 7/10 | 7/10 | Tag/bookmark UI polish |
| cognitive-replay | 7/10 | 8/10 | Scrubber needs visual upgrade |
| collab | 7/10 | 5/10 | Real CRDT is inherently valuable |
| command-center | 7/10 | 5/10 | Panel organization needed |
| construction | 7/10 | 5/10 | False disconnected pill |
| consulting | 7/10 | 6/10 | Pipeline Tailwind JIT issue |
| cooking | 8/10 | 5/10 | Already clean |
| crafting | 8/10 | 5/10 | Well-structured |
| creative | 7/10 | 5/10 | Clean composition |
| creative-writing | 7/10 | 6/10 | Missing ManifestActionBar |
| concord-link-frontier | 7/10 | 7/10 | Feed events need visual weight |

### P3 — Already Strong
| Lens | Score | Upgrade Potential | Key Issue |
|------|-------|-------------------|-----------|
| bounties | 6/10 | 8/10 | Stat cards could be hero (noted as P1 above — reclassified) |
| byo-keys | 8/10 | 3/10 | Correct set-once framing |
| calendar | 8/10 | 4/10 | Standard calendar, works |
| carpentry | 9/10 | 2/10 | Reference implementation |
| cognition | 7/10 | 4/10 | Internal tool, appropriate density |
| commonsense | 7/10 | 4/10 | Knowledge base, functional |

```

### Batch 3

See: `/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_3_FINDINGS.md`

```
---

# LENS: creator
PURPOSE: Allows users to create new content, projects, or initiatives.

CURRENT DESIGN: 
- Currently uses a generic, multi-step form that feels cluttered and overwhelming.
- The interface is not optimized for different user roles or permissions.
- The current layout prioritizes functionality over usability.

DESIGN DIRECTION: The domain of content creation determines the interface, with a focus on visualizing the creation process and minimizing unnecessary steps. The creator lens should prioritize a clear, step-by-step workflow that guides users through the creation process.

LAYOUT UPGRADE: 
1. **Header**: Simplify the header to only display essential information, such as the project title and creation date.
2. **Hero**: Introduce a prominent call-to-action (CTA) button that encourages users to start creating.
3. **Workspace**: Rearrange the workspace to prioritize the most important creation tools and features.
4. **Footer**: Move the footer to the bottom of the page and reduce clutter.

COMPONENT-LEVEL CHANGES: 
CURRENT → PROPOSED
- **Form fields**: Replace generic form fields with custom, field-specific input components.
- **Button styles**: Upgrade button styles to be more prominent and visually appealing.
- **Error messages**: Implement real-time error messages to improve user feedback.

VISUAL UPGRADES: 
• Update typography to a clean, sans-serif font.
• Increase spacing between components to improve readability.
• Introduce a subtle, contextual background gradient to enhance visual hierarchy.

CAPABILITY PRESENTATION: 
- **Project creation**: Display a clear, step-by-step guide for creating new projects.
- **Content preview**: Allow users to preview their created content before publishing.

LENS IDENTITY: The creator lens is visually distinct with its bold, colorful header and prominent CTA button.

PRIORITY: P1
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10

---

---

### 6. Custom

#### LENS: Custom
PURPOSE: Create a personalized experience for users to tailor the Concord cognitive engine to their specific needs.

#### CURRENT DESIGN:
- Mix of generic and custom components, feeling cluttered
- Customization options not clearly presented
- Limited visibility into available features

#### DESIGN DIRECTION:
The domain of customization determines the interface, focusing on user-defined preferences and tailor-made settings.

#### LAYOUT UPGRADE:
1. **Header**: Simplify header to display primary customization options
2. **Workspace**: Introduce a dedicated customization workspace with clear categorization
3. **Secondary**: Move related settings to a secondary panel for easier access

#### COMPONENT-LEVEL CHANGES:
- **CURRENT → PROPOSED**: Replace generic toggle buttons with custom sliders for precise control
- **CURRENT → PROPOSED**: Introduce a user-friendly dropdown menu for feature selection
- **CURRENT → PROPOSED**: Replace cluttered lists with a visually appealing settings grid

#### VISUAL UPGRADES:
- Use a custom color scheme to reflect user preferences
- Implement a clean typography hierarchy
- Apply consistent spacing and padding throughout the customization area

#### CAPABILITY PRESENTATION:
- **Customization Options**: Clearly display available customization options and their impact on the experience
- **Feature Toggles**: Visually indicate which features are enabled or disabled

#### LENS IDENTITY:
The Custom lens is visually distinct with a unique color palette and a clean, organized layout that reflects the user's personality.

#### PRIORITY: P1
#### DESIGN SCORE: 7/10
#### UPGRADE POTENTIAL: 8/10

---

### 7. Daily

#### LENS: Daily
PURPOSE: Provide a simplified interface for users to manage their daily tasks and goals.

#### CURRENT DESIGN:
- Overly simplistic and lacks features
- No clear indication of task status or priority
- Limited customization options

#### DESIGN DIRECTION:
The domain of daily tasks and goals determines the interface, focusing on simplicity and ease of use.

#### LAYOUT UPGRADE:
1. **Header**: Display a clear header with primary task management options
2. **Workspace**: Introduce a dedicated task list with clear categorization
3. **Secondary**: Provide a secondary panel for task filtering and sorting

#### COMPONENT-LEVEL CHANGES:
- **CURRENT → PROPOSED**: Replace generic icons with custom, colorful task indicators
- **CURRENT → PROPOSED**: Introduce a user-friendly dropdown menu for task prioritization
- **CURRENT → PROPOSED**: Replace cluttered lists with a visually appealing Kanban board

#### VISUAL UPGRADES:
- Use a clean and minimalistic color scheme
- Implement a clear typography hierarchy
- Apply consistent spacing and padding throughout the daily task area

#### CAPABILITY PRESENTATION:
- **Task Management**: Clearly display task status and priority
- **Goal Setting**: Provide a clear and concise way to set and track daily goals

#### LENS IDENTITY:
The Daily lens is visually distinct with a clean and minimalistic design that reflects a focus on simplicity and ease of use.

#### PRIORITY: P2
#### DESIGN SCORE: 6/10
#### UPGRADE POTENTIAL: 7/10

---

### 8. Database

#### LENS: Database
PURPOSE: Offer a robust interface for users to manage and interact with their database.

#### CURRENT DESIGN:
- Overly technical and cluttered
- Limited visibility into database structure and relationships
- Difficult to navigate and understand database schema

#### DESIGN DIRECTION:
The domain of database management determines the interface, focusing on clarity and understandability.

#### LAYOUT UPGRADE:
1. **Header**: Display a clear header with primary database management options
2. **Workspace**: Introduce a dedicated database browser with clear categorization
3. **Secondary**: Provide a secondary panel for database schema visualization

#### COMPONENT-LEVEL CHANGES:
- **CURRENT → PROPOSED**: Replace generic icons with custom, database-specific icons
- **CURRENT → PROPOSED**: Introduce a user-friendly dropdown menu for database filtering
- **CURRENT → PROPOSED**: Replace cluttered tables with a visually appealing database diagram

#### VISUAL UPGRADES:
- Use a technical yet approachable color scheme
- Implement a clear typography hierarchy
- Apply consistent spacing and padding throughout the database area

#### CAPABILITY PRESENTATION:
- **Database Schema**: Clearly display database structure and relationships
- **Data Management**: Provide a clear and concise way to manage and interact with database data

#### LENS IDENTITY:
The Database lens is visually distinct with a technical yet approachable design that reflects a focus on clarity and understandability.

#### PRIORITY: P0
#### DESIGN SCORE: 8/10
#### UPGRADE POTENTIAL: 9/10

---

### 9. Death-insurance

#### LENS: Death-insurance
PURPOSE: Provide a secure and intuitive interface for users to manage their death insurance policies.

#### CURRENT DESIGN:
- Overly complex and cluttered
- Limited visibility into policy details and benefits
- Difficult to understand policy terms and conditions

#### DESIGN DIRECTION:
The domain of death insurance determines the interface, focusing on security and clarity.

#### LAYOUT UPGRADE:
1. **Header**: Display a clear header with primary policy management options
2. **Workspace**: Introduce a dedicated policy dashboard with clear categorization
3. **Secondary**: Provide a secondary panel for policy details and benefits

#### COMPONENT-LEVEL CHANGES:
- **CURRENT → PROPOSED**: Replace generic icons with custom, insurance-specific icons
- **CURRENT → PROPOSED**: Introduce a user-friendly dropdown menu for policy selection
- **CURRENT → PROPOSED**: Replace cluttered tables with a visually appealing policy summary

#### VISUAL UPGRADES:
- Use a secure and trustworthy color scheme
- Implement a clear typography hierarchy
- Apply consistent spacing and padding throughout the policy area

#### CAPABILITY PRESENTATION:
- **Policy Management**: Clearly display policy details and benefits
- **Benefit Overview**: Provide a clear and concise way to understand policy terms and conditions

#### LENS IDENTITY:
The Death-insurance lens is visually distinct with a secure and trustworthy design that reflects a focus on clarity and understandability.

#### PRIORITY: P1
#### DESIGN SCORE: 7/10
#### UPGRADE POTENTIAL: 8/10

---

### 10. Debate

#### LENS: Debate
PURPOSE: Offer a dynamic and engaging interface for users to participate in debates and discussions.

#### CURRENT DESIGN:
- Overly cluttered and difficult to navigate
- Limited visibility into debate structure and participants
- Difficult to understand debate topics and arguments

#### DESIGN DIRECTION:
The domain of debates determines the interface, focusing on engagement and interaction.

#### LAYOUT UPGRADE:
1. **Header**: Display a clear header with primary debate options
2. **Workspace**: Introduce a dedicated debate arena with clear categorization
3. **Secondary**: Provide a secondary panel for debate participants and schedule

#### COMPONENT-LEVEL CHANGES:
- **CURRENT → PROPOSED**: Replace generic icons with custom, debate-specific icons
- **CURRENT → PROPOSED**: Introduce a user-friendly dropdown menu for debate selection
- **CURRENT → PROPOSED**: Replace cluttered lists with a visually appealing debate calendar

#### VISUAL UPGRADES:
- Use a dynamic and engaging color scheme
- Implement a clear typography hierarchy
- Apply consistent spacing and padding throughout the debate area

#### CAPABILITY PRESENTATION:
- **Debate Topics**: Clearly display debate topics and arguments
- **Participant Overview**: Provide a clear and concise way to understand debate participants and their roles

#### LENS IDENTITY:
The Debate lens is visually distinct with a dynamic and engaging design that reflects a focus on interaction and engagement.

#### PRIORITY: P2
#### DESIGN SCORE: 6/10
#### UPGRADE POTENTIAL: 7/10

---

Here is the reduced format for the next 5 lenses:

**Disputes**
================

LENS: Disputes
PURPOSE: Manage and resolve disputes between users and the platform.

CURRENT DESIGN:
- The current design is cluttered with too many fields and buttons.
- The layout feels generic and doesn't take advantage of the available space.
- The design doesn't effectively convey the importance of resolving disputes.

DESIGN DIRECTION: The disputes lens should be designed with a calm and constructive tone, with a clear focus on the resolution process. The domain determines the interface, which should prioritize the user's concerns and provide a clear path to resolution.

LAYOUT UPGRADE:
1. Simplify the form layout to reduce visual clutter.
2. Use a clear and prominent header to highlight the resolution process.
3. Move the "Submit" button to a more prominent location.
4. Add a progress indicator to show the resolution status.

COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace the generic form fields with custom-designed components.
- CURRENT → PROPOSED: Use a more prominent and attention-grabbing color scheme.
- CURRENT → PROPOSED: Replace the generic "Submit" button with a custom-designed button.

VISUAL UPGRADES:
- Use a calming color scheme with shades of blue and green.
- Increase the font size and line height to improve readability.
- Add a subtle background texture to give the lens a more human touch.

CAPABILITY PRESENTATION:
- CURRENT: The current design doesn't effectively communicate the capabilities of the disputes lens.
- CURRENT: The user is not aware of the resolution options available.
- BETTER: The new design clearly communicates the capabilities and resolution options.

LENS IDENTITY: The disputes lens is visually distinct with its calming color scheme and subtle background texture.

PRIORITY: P1
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10

---

**DIY**
================

LENS: DIY
PURPOSE: Provide a platform for users to create and customize their own projects.

CURRENT DESIGN:
- The current design feels cluttered with too many options and features.
- The layout is complex and difficult to navigate.
- The design doesn't effectively communicate the creative possibilities of the DIY lens.

DESIGN DIRECTION: The DIY lens should be designed with a creative and experimental tone, with a focus on empowering users to bring their ideas to life. The domain determines the interface, which should prioritize creative freedom and experimentation.

LAYOUT UPGRADE:
1. Simplify the navigation menu to reduce visual clutter.
2. Use a clear and prominent header to highlight the creative possibilities.
3. Add a showcase section to feature user-created projects.
4. Move the "Create Project" button to a more prominent location.

COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace the generic form fields with custom-designed components.
- CURRENT → PROPOSED: Use a more vibrant and playful color scheme.
- CURRENT → PROPOSED: Add a "Project Gallery" feature to showcase user-created projects.

VISUAL UPGRADES:
- Use a bright and playful color scheme with shades of orange and yellow.
- Increase the font size and line height to improve readability.
- Add a custom-designed icon set to give the lens a more creative feel.

CAPABILITY PRESENTATION:
- CURRENT: The current design doesn't effectively communicate the capabilities of the DIY lens.
- BETTER: The new design clearly communicates the creative possibilities and features.

LENS IDENTITY: The DIY lens is visually distinct with its bright and playful color scheme and custom-designed icon set.

PRIORITY: P2
DESIGN SCORE: 5/10
UPGRADE POTENTIAL: 6/10

---

**Docs**
================

LENS: Docs
PURPOSE: Provide access to documentation and resources for users.

CURRENT DESIGN:
- The current design feels generic and doesn't take advantage of the available space.
- The layout is complex and difficult to navigate.
- The design doesn't effectively communicate the importance of documentation.

DESIGN DIRECTION: The docs lens should be designed with a clear and concise tone, with a focus on providing easy access to information. The domain determines the interface, which should prioritize user needs and provide a clear path to finding what they need.

LAYOUT UPGRADE:
1. Simplify the navigation menu to reduce visual clutter.
2. Use a clear and prominent header to highlight the documentation.
3. Add a search bar to make it easy to find specific resources.
4. Move the "Download PDF" button to a more prominent location.

COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace the generic form fields with custom-designed components.
- CURRENT → PROPOSED: Use a more subdued and professional color scheme.
- CURRENT → PROPOSED: Add a "Resource Library" feature to categorize and organize resources.

VISUAL UPGRADES:
- Use a clean and professional color scheme with shades of blue and gray.
- Increase the font size and line height to improve readability.
- Add a subtle background texture to give the lens a more human touch.

CAPABILITY PRESENTATION:
- CURRENT: The current design doesn't effectively communicate the capabilities of the docs lens.
- BETTER: The new design clearly communicates the importance of documentation and provides easy access to resources.

LENS IDENTITY: The docs lens is visually distinct with its clean and professional color scheme and subtle background texture.

PRIORITY: P3
DESIGN SCORE: 4/10
UPGRADE POTENTIAL: 5/10

---

**Dreams**
================

LENS: Dreams
PURPOSE: Provide a platform for users to share and explore their dreams and aspirations.

CURRENT DESIGN:
- The current design feels cluttered with too many fields and buttons.
- The layout is complex and difficult to navigate.
- The design doesn't effectively communicate the creative possibilities of the dreams lens.

DESIGN DIRECTION: The dreams lens should be designed with a creative and inspirational tone, with a focus on empowering users to share their dreams and aspirations. The domain determines the interface, which should prioritize user creativity and self-expression.

LAYOUT UPGRADE:
1. Simplify the form layout to reduce visual clutter.
2. Use a clear and prominent header to highlight the creative possibilities.
3. Add a showcase section to feature user-submitted dreams and aspirations.
4. Move the "Share Dream" button to a more prominent location.

COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace the generic form fields with custom-designed components.
- CURRENT → PROPOSED: Use a more vibrant and creative color scheme.
- CURRENT → PROPOSED: Add a "Dream Wall" feature to showcase user-submitted dreams.

VISUAL UPGRADES:
- Use a bright and creative color scheme with shades of pink and purple.
- Increase the font size and line height to improve readability.
- Add a custom-designed icon set to give the lens a more creative feel.

CAPABILITY PRESENTATION:
- CURRENT: The current design doesn't effectively communicate the capabilities of the dreams lens.
- BETTER: The new design clearly communicates the creative possibilities and features.

LENS IDENTITY: The dreams lens is visually distinct with its bright and creative color scheme and custom-designed icon set.

PRIORITY: P2
DESIGN SCORE: 5/10
UPGRADE POTENTIAL: 6/10

---

**DTUS**
================

LENS: DTUS
PURPOSE: Provide a platform for users to manage and track their tasks and projects.

CURRENT DESIGN:
- The current design feels cluttered with too many fields and buttons.
- The layout is complex and difficult to navigate.
- The design doesn't effectively communicate the importance of task management.

DESIGN DIRECTION: The DTUS lens should be designed with a clear and productive tone, with a focus on empowering users to manage their tasks and projects. The domain determines the interface, which should prioritize user productivity and organization.

LAYOUT UPGRADE:
1. Simplify the form layout to reduce visual clutter.
2. Use a clear and prominent header to highlight the task management features.
3. Add a dashboard section to provide a clear overview of tasks and projects.
4. Move the "Create Task" button to a more prominent location.

COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace the generic form fields with custom-designed components.
- CURRENT → PROPOSED: Use a more professional and organized color scheme.
- CURRENT → PROPOSED: Add a "Project Calendar" feature to visualize tasks and deadlines.

VISUAL UPGRADES:
- Use a clean and professional color scheme with shades of blue and gray.
- Increase the font size and line height to improve readability.
- Add a custom-designed icon set to give the lens a more productive feel.

CAPABILITY PRESENTATION:
- CURRENT: The current design doesn't effectively communicate the capabilities of the DTUS lens.
- BETTER: The new design clearly communicates the task management features and capabilities.

LENS IDENTITY: The DTUS lens is visually distinct with its clean and professional color scheme and custom-designed icon set.

PRIORITY: P1
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10

---

---

### Batch 3 Findings

#### dx-platform

LENS: dx-platform
PURPOSE: Manage and monitor digital experiences across the platform.

CURRENT DESIGN:
- Works well for large-scale platform management
- Navigation could be more intuitive
- Could use more visual hierarchy

DESIGN DIRECTION: The domain of digital experience management determines the interface, focusing on a comprehensive overview of platform health and performance metrics. A dashboard-like layout will prioritize key performance indicators (KPIs) and critical tasks.

LAYOUT UPGRADE:
1. Header: "Platform Overview"
2. Hero: Key performance indicators (KPIs) and critical tasks
3. Workspace: Platform metrics and monitoring tools
4. Secondary: Related features and settings

COMPONENT-LEVEL CHANGES:
- CURRENT: Generic navigation menu → PROPOSED: Customizable navigation menu with drag-and-drop functionality
- CURRENT: Flat list of metrics → PROPOSED: Hierarchical display of metrics with collapsible sections
- CURRENT: Text-based alerts → PROPOSED: Visual alerts with icons and color-coded severity levels

VISUAL UPGRADES:
- Increased use of bright, platform-centric colors
- Customizable dashboard backgrounds and typography
- Use of icons for platform-related actions

CAPABILITY PRESENTATION:
- "Real-time platform monitoring"
- "Customizable KPI dashboards"

LENS IDENTITY: The dx-platform lens is visually distinct with its prominent use of platform-themed colors and icons, creating a cohesive and recognizable identity.

PRIORITY: P1
DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 9/10

---

#### eco

LENS: eco
PURPOSE: Manage and monitor environmental sustainability initiatives.

CURRENT DESIGN:
- Effective for tracking environmental metrics
- Could be more engaging and interactive
- Navigation feels cluttered

DESIGN DIRECTION: The domain of environmental sustainability determines the interface, focusing on a nature-inspired aesthetic and interactive visualizations. A layout that encourages exploration and discovery will prioritize key sustainability metrics and initiatives.

LAYOUT UPGRADE:
1. Header: "Sustainable Future"
2. Hero: Interactive map of global sustainability initiatives
3. Workspace: Key sustainability metrics and project trackers
4. Secondary: Related features and resources

COMPONENT-LEVEL CHANGES:
- CURRENT: Static metric displays → PROPOSED: Interactive, dynamic displays with real-time updates
- CURRENT: Linear navigation menu → PROPOSED: Circular navigation menu with organic, earthy icons
- CURRENT: Text-based project descriptions → PROPOSED: Visual project overviews with images and videos

VISUAL UPGRADES:
- Natural color palette with earthy tones
- Use of leafy greenery and water-inspired elements
- Customizable typography with a serif font

CAPABILITY PRESENTATION:
- "Real-time environmental tracking"
- "Sustainability project collaboration"

LENS IDENTITY: The eco lens is visually distinct with its natural, earthy aesthetic and interactive visualizations, creating a unique and engaging experience.

PRIORITY: P2
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 8/10

---

#### education

LENS: education
PURPOSE: Facilitate learning and knowledge sharing.

CURRENT DESIGN:
- Effective for displaying learning content
- Could be more engaging and interactive
- Navigation feels cluttered

DESIGN DIRECTION: The domain of education determines the interface, focusing on a clean and modern aesthetic with a focus on learning outcomes. A layout that encourages exploration and discovery will prioritize key learning resources and tools.

LAYOUT UPGRADE:
1. Header: "Learn and Grow"
2. Hero: Interactive learning pathways and recommended content
3. Workspace: Learning resources and tools
4. Secondary: Related features and settings

COMPONENT-LEVEL CHANGES:
- CURRENT: Static resource displays → PROPOSED: Interactive, dynamic displays with learning analytics
- CURRENT: Linear navigation menu → PROPOSED: Curved navigation menu with educational icons
- CURRENT: Text-based course descriptions → PROPOSED: Visual course overviews with images and videos

VISUAL UPGRADES:
- Bright, vibrant colors with a focus on blue and green
- Use of educational icons and graphics
- Customizable typography with a sans-serif font

CAPABILITY PRESENTATION:
- "Personalized learning plans"
- "Real-time learning analytics"

LENS IDENTITY: The education lens is visually distinct with its modern, clean aesthetic and interactive learning tools, creating a unique and engaging experience.

PRIORITY: P1
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 9/10

---

#### electrical

LENS: electrical
PURPOSE: Manage and monitor electrical systems and infrastructure.

CURRENT DESIGN:
- Effective for tracking electrical metrics
- Could be more intuitive and user-friendly
- Navigation feels cluttered

DESIGN DIRECTION: The domain of electrical systems determines the interface, focusing on a clean and industrial aesthetic with a focus on system performance. A layout that prioritizes key performance indicators (KPIs) and critical tasks will encourage efficient system management.

LAYOUT UPGRADE:
1. Header: "Electrical Systems"
2. Hero: Key performance indicators (KPIs) and critical tasks
3. Workspace: Electrical system metrics and monitoring tools
4. Secondary: Related features and settings

COMPONENT-LEVEL CHANGES:
- CURRENT: Generic navigation menu → PROPOSED: Customizable navigation menu with drag-and-drop functionality
- CURRENT: Flat list of metrics → PROPOSED: Hierarchical display of metrics with collapsible sections
- CURRENT: Text-based alerts → PROPOSED: Visual alerts with icons and color-coded severity levels

VISUAL UPGRADES:
- Industrial color palette with a focus on blue and gray
- Use of electrical system-related icons and graphics
- Customizable typography with a sans-serif font

CAPABILITY PRESENTATION:
- "Real-time electrical system monitoring"
- "Customizable KPI dashboards"

LENS IDENTITY: The electrical lens is visually distinct with its industrial, clean aesthetic and interactive visualizations, creating a unique and efficient experience.

PRIORITY: P2
DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 8/10

---

#### emergency-services

LENS: emergency-services
PURPOSE: Manage and respond to emergency situations.

CURRENT DESIGN:
- Effective for emergency response management
- Could be more intuitive and user-friendly
- Navigation feels cluttered

DESIGN DIRECTION: The domain of emergency services determines the interface, focusing on a clean and modern aesthetic with a focus on emergency response protocols. A layout that prioritizes key response metrics and critical tasks will encourage efficient emergency response.

LAYOUT UPGRADE:
1. Header: "Emergency Response"
2. Hero: Key response metrics and critical tasks
3. Workspace: Emergency response tools and resources
4. Secondary: Related features and settings

COMPONENT-LEVEL CHANGES:
- CURRENT: Static metric displays → PROPOSED: Interactive, dynamic displays with real-time updates
- CURRENT: Linear navigation menu → PROPOSED: Circular navigation menu with emergency-themed icons
- CURRENT: Text-based incident descriptions → PROPOSED: Visual incident overviews with images and videos

VISUAL UPGRADES:
- Emergency response-themed color palette with a focus on red and blue
- Use of emergency response icons and graphics
- Customizable typography with a sans-serif font

CAPABILITY PRESENTATION:
- "Real-time emergency response coordination"
- "Customizable incident dashboards"

LENS IDENTITY: The emergency-services lens is visually distinct with its modern, clean aesthetic and interactive visualizations, creating a unique and efficient experience.

PRIORITY: P1
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 9/10

---

Please append these findings to the document.

---

**26. energy**
================

### LENS: energy
### PURPOSE: Display and manage energy consumption and production data.

### CURRENT DESIGN:
- The current design is cluttered with too many metrics and buttons.
- The layout is generic and doesn't take into account the specific domain requirements.
- The design feels unfinished, lacking a clear hierarchy and visual flow.

### DESIGN DIRECTION:
The domain of energy management requires a clear and concise display of complex data. The interface should prioritize the most critical information and use visualizations to simplify complex concepts.

### LAYOUT UPGRADE:
1. **Header**: Display the current energy status and a clear title.
2. **Hero**: Showcase a prominent chart or graph displaying the overall energy consumption and production.
3. **Workspace**: Group related metrics (e.g., energy consumption, production, and costs) and display them in a clear and organized manner.
4. **Controls**: Move all buttons to a secondary section, reducing clutter and improving the overall user experience.

### COMPONENT-LEVEL CHANGES:
- **Current**: The current design uses a generic button for all actions.
- **Proposed**: Use bespoke buttons for each action (e.g., "Save", "Reset", and "Export").
- **Current**: The energy charts are generic and don't take into account the specific domain requirements.
- **Proposed**: Use domain-specific charts (e.g., a line chart for energy consumption and a bar chart for production).

### VISUAL UPGRADES:
- Use a consistent typography and font size throughout the lens.
- Increase the spacing between elements to improve readability.
- Use a subtle gradient to highlight important information.

### CAPABILITY PRESENTATION:
- **Current**: The current design doesn't clearly display the energy consumption and production data.
- **Better**: Use a combination of charts and tables to display the data in a clear and concise manner.
- **Current**: The design doesn't take into account the user's energy goals and preferences.
- **Better**: Use a goal-oriented approach to display the data and provide recommendations.

### LENS IDENTITY:
The energy lens is visually distinct through its use of a bold and modern design that takes into account the specific domain requirements.

### PRIORITY: P1
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 8/10

---

**27. engineering**
================

### LENS: engineering
### PURPOSE: Manage and track engineering projects and tasks.

### CURRENT DESIGN:
- The current design is cluttered with too many fields and sections.
- The layout is generic and doesn't take into account the specific domain requirements.
- The design feels cluttered and lacks a clear hierarchy.

### DESIGN DIRECTION:
The domain of engineering requires a clear and organized display of project information. The interface should prioritize the most critical information and use visualizations to simplify complex concepts.

### LAYOUT UPGRADE:
1. **Header**: Display the project status and a clear title.
2. **Hero**: Showcase a prominent progress bar displaying the project's overall status.
3. **Workspace**: Group related fields (e.g., project details, tasks, and deadlines) and display them in a clear and organized manner.
4. **Controls**: Move all buttons to a secondary section, reducing clutter and improving the overall user experience.

### COMPONENT-LEVEL CHANGES:
- **Current**: The current design uses a generic input field for all text inputs.
- **Proposed**: Use bespoke input fields for each type of data (e.g., text, date, and number).
- **Current**: The project progress bar is generic and doesn't take into account the specific domain requirements.
- **Proposed**: Use a domain-specific progress bar that displays the project's overall status.

### VISUAL UPGRADES:
- Use a consistent typography and font size throughout the lens.
- Increase the spacing between elements to improve readability.
- Use a subtle gradient to highlight important information.

### CAPABILITY PRESENTATION:
- **Current**: The current design doesn't clearly display the project's status and progress.
- **Better**: Use a combination of charts and tables to display the project's status and progress.

### LENS IDENTITY:
The engineering lens is visually distinct through its use of a clean and organized design that takes into account the specific domain requirements.

### PRIORITY: P0
### DESIGN SCORE: 7/10
### UPGRADE POTENTIAL: 9/10
```

### Batch 4

See: `/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_4_FINDINGS.md`

```
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
Before: Generic tabbed interface with 7 scaffolds, false Disconnected pill, text-heavy action 
```

### Batch 5

See: `/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_5_FINDINGS.md`

```
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

**PURPOSE:** Knowledge graph visualizer — renders DTU consolidation pipeline (SIMPLE→REGULAR→MEGA→HYPER, HASH-mode design target (~33:1; live IR ~1.2×)) as force-directed node-link diagram. "Knowledge Genome Browser."

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

```

### Batch 6

See: `/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_6_FINDINGS.md`

```
# Batch 6 — Design Audit Findings (27 Lenses)

Generated 2026-08-17. Each lens evaluated independently against its own rendered
structure, existing functionality, and visual hierarchy.

---

## 1. kingdoms

```
LENS: kingdoms
PURPOSE: Dynasty & Realm — CK3-shape realm governance (found, decree, contest, war)

CURRENT DESIGN:
- Amber brand palette with slate containers — visually coherent
- Crown emoji 📋 as page header icon — lower fidelity than lucide icon
- "v1" honest disclosure on polygon-paste form — excellent honesty pattern
- Browse/Found toggle buttons are plain, not a distinctive tab bar
- Collapsible sections mix zinc-950/40 panels with slate-900 cards — palette drift between zones
- Footer (RecentMineCard/AutoActionStrip/CrossLensRecentsPanel) sits outside max-w-6xl container — structural nesting issue
- WarCampaignSession and DynastyRealmManager add depth but are nested inside collapsible sections with no visual differentiation

DESIGN DIRECTION: A medieval cartography / royal-decree aesthetic. This should feel like ruling from a war room — maps, decrees, faction standings. Amber and slate is correct for the identity; push further into that territory with parchment-like containers, seal/badge iconography for decree types, and a territory map or polygon preview instead of raw JSON paste.

LAYOUT UPGRADE:
- Header: crown icon (lucide `Crown`) in amber-tinted badge, realm name in bold, "Founded" / "World" metadata
- Primary area: realm overview (loyalty/military/tax gauges) — the decree-effects dashboard
- Center: decree list with kind badges (loyalty/military/tax) and active-status indicators
- Side panel: war campaigns + realm actions (collapsible)
- Footer: RecentMineCard only (remove generic scaffold trio if present)

COMPONENT-LEVEL CHANGES:
- Crown emoji → lucide `Crown` in `rounded-lg bg-amber-500/10 p-2` container
- Browse/Found toggle → segmented control with icons (Browse = `List`, Found = `Plus`)
- Raw JSON polygon textarea → labeled coordinate list with v1 disclosure as tooltip
- `text-[10px]` metadata labels → `text-xs` for readability
- Mixed zinc/slate card styles → unified `rounded-xl border border-amber-900/30 bg-amber-950/5`

VISUAL UPGRADES:
- Typography: decree headers at `text-base font-semibold`, descriptions at `text-sm text-gray-400`
- Spacing: consistent `space-y-4` between sections (currently `space-y-3` / `space-y-6` mixed)
- Borders: `border-amber-900/30` everywhere instead of `border-slate-800`
- Icons: add `Flag` for founding, `Hammer` for decree-enact, `Swords` for contest

CAPABILITY PRESENTATION:
- Realm overview (loyalty/tax/military) → shown only after founding → BETTER: show aggregate stats row even when empty ("No realms found — found one to begin")
- Decree effects → buried inside each decree → BETTER: show per-decree effect badges (↑ loyalty 3%) inline
- War campaigns → collapsed section → BETTER: badge count on section header when active wars exist

LENS IDENTITY: The only CK3/dynasty lens in Concord. Amber + crown + territory polygon = unmistakable. Should feel like a medieval ruler's dashboard, not a generic data table.

RESPONSIVE DESIGN: Desktop: 2-column (realm list | detail). Tablet: stacked with sticky decree bar. Mobile: full-width list → drill-down.

BEFORE/AFTER:
- Before: Emoji header, plain toggle buttons, mixed card colors, JSON-paste form
- After: Lucide crown in amber badge, segmented Browse/Found, parchment-tinted panels, coordinate-list form with visual disclosure

IMPLEMENTATION PLAN:
1. Replace crown emoji with lucide `Crown` in amber badge
2. Unify card palette to `border-amber-900/30 bg-amber-950/5`
3. Replace Browse/Found toggle with segmented control
4. Add realm overview stats row (loyalty/military/tax) even when empty
5. Fix footer nesting (move inside max-w-6xl)
6. Add decree effect badges inline

PRIORITY: P2 — polish
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 8/10
```

---

## 2. lab

```
LENS: lab
PURPOSE: Scientific workbench — experiment sandbox, reagent tracking, calibration curves

CURRENT DESIGN:
- Neon green/purple/cyan palette (custom CSS classes) — distinctive but inconsistent with lattice design system
- Emoji 🧪 header — lower fidelity
- Stats row (3-col grid) has same visual weight as section headers — flat hierarchy
- Everything is `font-semibold`/`font-bold` — no clear primary/secondary distinction
- Custom `panel`/`lens-card` classes depend on globals.css, not Tailwind utilities
- ELNWorkbench + LabOrgPanel + RealityExplorerSection create a deep, scrolling page
- Calibration curve button shows honest "needs artifact" message (fixed bug)

DESIGN DIRECTION: A wet-lab electronic lab notebook. Clinical white-on-dark with green accent for "active experiment," purple for reagent inventory. Think Benchling/LabArchives — dense data tables, protocol step checklists, calibration curve plots. The neon palette is correct for the identity; tighten it.

LAYOUT UPGRADE:
- Header: flask icon in green badge, "Lab" title, experiment count stats
- Hero: current active experiment (if any) with step progress
- Primary workspace: code editor (2/3 width) + organ status (1/3 width) — this is correct
- Secondary: ELNWorkbench (collapsible, dense table view)
- Supporting: RealityExplorerSection with constraint builder
- Footer: feed panel

COMPONENT-LEVEL CHANGES:
- Emoji 🧪 → lucide `FlaskConical` in `rounded-lg bg-neon-green/10 p-2`
- Stats row → visual hierarchy: primary stat (experiment count) at `text-3xl font-bold`, secondary at `text-lg`
- `panel`/`lens-card` CSS classes → inline Tailwind (`rounded-xl border border-neon-green/20 bg-neon-green/5`)
- `text-neon-green`/`text-neon-purple`/`text-neon-cyan` → keep, these are the identity

VISUAL UPGRADES:
- Typography: experiment titles at `text-lg font-semibold`, section headers at `text-sm font-semibold uppercase tracking-wider`
- Spacing: `space-y-4` between major sections (currently `space-y-6` which is too loose for a dense lab tool)
- Cards: add left border accent (`border-l-2 border-l-neon-green/40`) for active experiments
- Motion: add `framer-motion` entrance animations for stats row

CAPABILITY PRESENTATION:
- Calibration Curve → shows "needs artifact" (honest) → BETTER: show "Create an experiment run first, then generate its calibration curve" as inline guidance
- Reality Explorer → collapsed by default → BETTER: always show constraint count badge
- Reagent tracking → buried in LabOrgPanel → BETTER: quick stats row (reagents tracked, calibrations run)

LENS IDENTITY: The only wet-lab tool in Concord. Flask icon + neon-green accent + code-editor primary workspace = unmistakable scientific workbench.

RESPONSIVE DESIGN: Desktop: 2/3 + 1/3 split. Tablet: stacked. Mobile: code editor full-width, other panels collapsible.

BEFORE/AFTER:
- Before: Emoji header, flat hierarchy, custom CSS classes, everything bold
- After: Lucide flask, clear weight hierarchy, inline Tailwind, left-border accent cards

IMPLEMENTATION PLAN:
1. Replace emoji with lucide icon
2. Create typographic hierarchy (title > section > body)
3. Replace CSS class dependencies with inline Tailwind
4. Add left-border accent for active experiments
5. Add stats row visual hierarchy (primary vs secondary metrics)

PRIORITY: P2 — polish
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 3. landscaping

```
LENS: landscaping
PURPOSE: Yard/garden design studio, plant lookup, pro landscaping calculators

CURRENT DESIGN:
- Thin page shell (112 lines) — all complexity delegated to child components
- 5-tab nav with keyboard hints (kbd chips) — excellent discoverability
- neon-blue brand, zinc containers — clean
- PlantFinder correctly shows honest Trefle API key message
- No visual hierarchy issues — content delegated
- All real components, no demo data

DESIGN DIRECTION: Garden-fresh, botanical. Soft greens and earthy tones alongside the neon-blue. Think Proven Winners / Gardenista — lush imagery when plant data loads, clean grid layouts for garden beds, warm wood-like accents for hardscape calculators.

LAYOUT UPGRADE:
- Already correct: LensPageShell provides consistent framing
- Tab bar: good as-is with kbd hints
- Content: delegated to child components (no changes needed at page level)

COMPONENT-LEVEL CHANGES:
- Tab icons: already good (TreePine, Sprout, Flower2, Leaf, Calculator, CalendarClock)
- Tab active state: `bg-neon-blue/20 text-neon-blue` → add `border-b-2 border-neon-blue` for stronger visual anchor
- Empty states: delegated — no page-level change needed

VISUAL UPGRADES:
- Tab bar: add subtle top border on active tab
- Empty states in child components: should show plant/garden imagery when Trefle key is set
- Spacing: already correct via LensPageShell

CAPABILITY PRESENTATION:
- Trefle plant finder → honest API key message → BETTER: add inline "Get free key" link to trefle.io
- Garden Studio → correct real component → already well-presented
- Pro Calculators → correct real utility → already well-presented

LENS IDENTITY: The only garden/landscaping tool. Leaf/sprout icons + neon-blue + botanical vocabulary = distinct from all other lenses.

RESPONSIVE DESIGN: Tab bar with flex-wrap handles all breakpoints. Content delegated.

BEFORE/AFTER:
- Before: Already clean thin shell
- After: Minor tab active-state enhancement, inline API key signup link

IMPLEMENTATION PLAN:
1. Add border-b-2 active tab indicator
2. Add inline "Get free Trefle API key" link in PlantFinder empty state

PRIORITY: P3 — already strong
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 5/10
```

---

## 4. lattice

```
LENS: lattice
PURPOSE: Brain self-training dashboard — training runs, consent grants, eval curves, drift scans

CURRENT DESIGN:
- Fuchsia monochrome palette — very distinctive and consistent
- Custom Loading/ErrorState/Empty helper components — well-factored
- AnimatePresence for tab transitions — polished
- 8-tab pipeline with icon + count badges — dense but organized
- Stat component uses `text-xl font-semibold font-mono` — good number emphasis
- Honest self-disambiguation from unrelated backend `lattice` domain — excellent template
- Consent ratio stats shown (1925 total, 760 consented, 39.5%) — real data

DESIGN DIRECTION: MLOps dashboard — Weights & Biases / MLflow shape. Fuchsia is correct for the identity. Push further into data-viz territory: real training curves, loss plots, confusion matrices as the primary content. Dense, technical, information-rich.

LAYOUT UPGRADE:
- Already correct: sticky header + 8-tab nav + AnimatePresence content panels
- Overview tab: stat cards + pipeline visualization
- Consent tab: ratio bars + consent management
- Training tab: run history + metrics

COMPONENT-LEVEL CHANGES:
- Stat cards: already good — `text-xl font-semibold font-mono` creates proper emphasis
- Tab nav: already uses `border-b-2` underline style — consistent
- Empty states: custom `Empty` component — already well-styled
- Cards: `rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/10 p-3` — consistent

VISUAL UPGRADES:
- Typography: already excellent — `font-mono` for numbers, `font-semibold` for section headers
- Spacing: already consistent `gap-3` for grids
- Motion: AnimatePresence tab transitions already present
- Borders: fuchsia-900/40 everywhere — very consistent

CAPABILITY PRESENTATION:
- Training runs → well-presented in Training tab
- Consent management → well-presented in Consent tab with ratio bars
- Drift scans → well-presented in Audit tab
- Self-disambiguation note → already excellent honesty pattern

LENS IDENTITY: The only MLops/brain-training dashboard. Fuchsia + `font-mono` numbers + training pipeline = unmistakable. The self-disambiguation from the unrelated backend lattice domain is a model for honest UI.

RESPONSIVE DESIGN: Tab nav wraps. Content panels adapt. Already handles all breakpoints.

BEFORE/AFTER: No changes needed — this is already a reference-quality lens.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 9/10
UPGRADE POTENTIAL: 3/10
```

---

## 5. law

```
LENS: law
PURPOSE: Case-law & patent research, contract lifecycle, case-file tooling

CURRENT DESIGN:
- neon-purple brand with lattice design system — consistent
- Custom Panel component with `text-[11px] uppercase tracking-wider` headers — excellent hierarchy
- 4 workbench groups (Research/Contracts/Cases/Analytics) with icon + hotkey + count badges
- AnimatePresence tab transitions — polished
- `data-lens-theme="law"` attribute — CSS variable theming
- Real CourtListener API: 99,363 hit results — genuinely world-class
- No generic scaffold components — deliberately retired

DESIGN DIRECTION: Legal research terminal — Westlaw/LexisNexis/FASTCASE shape. Purple is correct for the brand. Dense citation search, case-hierarchy trees, contract clause extraction views. Think legal professionals who work in dense text all day — information density is the priority.

LAYOUT UPGRADE:
- Already correct: header with icon + DepthBadge + DensityToggle + DTUExportButton
- Tab nav with AnimatePresence
- Panel-based content with uppercase headers
- Sub-panels within each workbench group

COMPONENT-LEVEL CHANGES:
- Panel component: already excellent — `rounded-lg border border-lattice-border bg-lattice-surface/60` with `bg-lattice-elevated/40` headers
- Tab buttons: already use `text-xs whitespace-nowrap border` with active `bg-neon-purple/15 text-neon-purple border-neon-purple/30`
- Hotkey indicators: `text-[9px] px-1 py-0.5 rounded bg-black/30 text-gray-400 font-mono` — excellent

VISUAL UPGRADES:
- Typography: already excellent — `text-[11px] uppercase` headers, `text-xs` body
- Spacing: consistent `space-y-4` between sections
- Motion: AnimatePresence already present
- Icons: Scale, BookOpen, FileText, Briefcase, BarChart3 — appropriate legal iconography

CAPABILITY PRESENTATION:
- Case law search → real CourtListener integration → well-presented
- Contract lifecycle → real Contracts tab → well-presented
- Patent search → real PatentSearch component → well-presented
- Legal text search → real LegalTextSearch → well-presented

LENS IDENTITY: The only legal-research terminal. Purple + Panel headers + hotkey shortcuts = professional legal tool, distinct from all other lenses.

RESPONSIVE DESIGN: Tab nav wraps. Panels stack. Already handles all breakpoints.

BEFORE/AFTER: No changes needed — this is one of the most polished lenses in the entire platform.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 9/10
UPGRADE POTENTIAL: 2/10
```

---

## 6. law-enforcement

```
LENS: law-enforcement
PURPOSE: Dispatch, evidence chain-of-custody, roster, crime mapping, warrants & reports

CURRENT DESIGN:
- Blue brand with design-system tokens (`ds.pageContainer`, `ds.sectionHeader`, `ds.heading1`, `ds.textMuted`) — most consistent approach in this batch
- 5 tabs: Overview/Cases/Console/Analysis/Field Notes — clean
- RmsCadConsole has deep sub-tabs (Dispatch/Evidence/Roster/Crime Map/Warrants/Reports/Booking)
- P1-P4 color-coded priority tiers — excellent visual language
- Real "New 911 Call" + "Register Unit" forms — genuine CAD functionality
- All complexity delegated to child components — thin page shell

DESIGN DIRECTION: Police dispatch console — CAD/RMS shape. Blue is correct. Dark, high-contrast for control-room readability. Priority badges (P1 red, P2 orange, P3 yellow, P4 blue) should dominate the visual hierarchy. Think Mark43/CentralSquare/Motorola Solutions CAD.

LAYOUT UPGRADE:
- Already correct: ds.pageContainer + ds.sectionHeader header
- Tab nav with icons
- Tab content delegated to deep child components

COMPONENT-LEVEL CHANGES:
- Tab active state: `bg-blue-500/20 text-blue-300` — correct for brand
- Tab text: `text-sm font-medium` — slightly smaller than law lens's `text-xs` — minor inconsistency but acceptable

VISUAL UPGRADES:
- Already using design-system tokens consistently
- No typography issues — delegated to child components
- Tab icon + label pairs already present

CAPABILITY PRESENTATION:
- RMS/CAD Console → deep real sub-tabs → well-presented
- P1-P4 priority breakdown → real visual hierarchy in Console
- Case Management → delegated → well-presented
- Field Notes → `bg-zinc-950/40` panel → well-presented

LENS IDENTITY: The only law-enforcement/CAD tool. Blue shield + P1-P4 priority colors = unmistakable dispatch console.

RESPONSIVE DESIGN: Tab nav handles breakpoints. Console sub-tabs may need horizontal scroll on mobile.

BEFORE/AFTER: No changes needed — clean, well-delegated design.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 4/10
```

---

## 7. layout.tsx

```
LENS: layout.tsx (shared Next.js layout for /lenses/*)
PURPOSE: Shared layout wrapper — NOT a user-facing lens

CURRENT DESIGN: This is a Next.js route layout file, not a rendered lens page. It provides shared layout structure for all lens routes.

DESIGN DIRECTION: N/A — infrastructure file, not a visual surface.

LAYOUT UPGRADE: N/A

COMPONENT-LEVEL CHANGES: N/A

VISUAL UPGRADES: N/A

CAPABILITY PRESENTATION: N/A

LENS IDENTITY: N/A

RESPONSIVE DESIGN: N/A

BEFORE/AFTER: N/A

IMPLEMENTATION PLAN: N/A

PRIORITY: N/A — not a lens
DESIGN SCORE: N/A
UPGRADE POTENTIAL: N/A
```

---

## 8. ledger

```
LENS: ledger
PURPOSE: The Ledger — sere sub-world's economic-detective surface (noir narrative voice)

CURRENT DESIGN:
- Emerald brand — distinctive
- Noir narrative voice: "The flows the Curtain keeps off the public record" — excellent tonal identity
- Honest empty state: "No anomalous flows surfaced... That is usually a sign you have not looked hard enough"
- Color-coded data types: amber for managed parity, cyan for extraction liens — functional visual encoding
- Uppercase tracking-widest section headers — strong separation
- Workspace controls bar with flex-wrap — well-organized
- 474 lines, single-file — lean and focused
- All real data from macros (lensRun), persisted watchlist via useLensData

DESIGN DIRECTION: Noir detective case board. Emerald on black. Evidence pins, timeline threads, anomaly highlighting. Think a private investigator's corkboard — dense, atmospheric, every element carries meaning. The narrative voice IS the identity.

LAYOUT UPGRADE:
- Header: emerald title + noir tagline
- Workspace controls: scope toggles (world vs global pulse)
- Primary: anomaly list with severity indicators
- Secondary: dossier drill-down with parity items (amber) and liens (cyan)
- Watchlist: persistent tracked items

COMPONENT-LEVEL CHANGES:
- Title: `text-xl font-semibold text-emerald-300` — already good
- Section headers: `text-sm uppercase tracking-widest` — already excellent
- Data cards: `rounded border border-amber-500/30 bg-amber-500/5` / `border-cyan-500/30 bg-cyan-500/5` — already color-coded
- Buttons: `rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm` — consistent

VISUAL UPGRADES:
- Typography: already has strong hierarchy (emerald title, uppercase headers, colored data)
- Spacing: `space-y-2` / `space-y-6` — consistent
- Color: emerald/amber/cyan tri-color scheme is functional and distinctive
- Borders: `border-zinc-800` for containers — consistent

CAPABILITY PRESENTATION:
- Anomaly detection → real macro data → well-presented with severity indicators
- Dossier drill-down → toggleable section → well-presented
- Watchlist → persisted → well-presented with toggle
- Global pulse → toggleable scope disclosure → well-presented with honesty

LENS IDENTITY: The only noir detective lens. Emerald + narrative voice + anomaly detection = unmistakable sere-investigator tool. The honest empty state is the best in the platform.

RESPONSIVE DESIGN: Grid cols adapt (2→4 for pulse stats). List/detail layout stacks on mobile.

BEFORE/AFTER: No changes needed — this is one of the most identity-rich lenses.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 9/10
UPGRADE POTENTIAL: 2/10
```

---

## 9. legacy

```
LENS: legacy
PURPOSE: Legacy code modernization — technical debt, dependency graphs, migration roadmaps

CURRENT DESIGN:
- Uses `data-lens-theme="legacy"` attribute
- Emoji 🏛️ header — lower fidelity
- `panel` CSS class dependency (globals.css) — not Tailwind
- Missing `hasErrorUI` pillar (4/5 pillars)
- 96 lines — very thin page shell delegating to CodebaseScanner + PortfolioAssessment
- Real-time toolbar with LiveIndicator + DTUExportButton + alerts count
- ConnectiveTissueBar for cross-lens connections

DESIGN DIRECTION: Dev-tools / code-analysis terminal. Think SonarQube dashboard — dark theme, red/yellow/green severity indicators, dependency graph visualizations, debt-metric gauges. The 🏛️ icon is conceptually correct (legacy = classical architecture) but visually low-fidelity.

LAYOUT UPGRADE:
- Header: replace emoji with lucide `FolderSearch` in styled badge (already imported!)
- Primary: CodebaseScanner (the real workhorse)
- Secondary: PortfolioAssessment (risk overview)
- Supporting: RealtimeDataPanel (live analysis feed)
- Footer: ConnectiveTissueBar

COMPONENT-LEVEL CHANGES:
- Emoji 🏛️ → lucide `FolderSearch` in `rounded-lg bg-neon-cyan/10 p-2` (matching the existing cyan accent on the icon)
- `panel` class → inline Tailwind `rounded-xl border border-lattice-border bg-lattice-surface/60 p-4`
- `font-semibold` section header → `text-sm font-semibold uppercase tracking-wider` for consistency

VISUAL UPGRADES:
- Typography: section headers need uppercase tracking-wider treatment
- Color: cyan accent for "scan active" indicator (already present via icon)
- Error UI: add explicit error boundary wrapper (currently missing hasErrorUI)

CAPABILITY PRESENTATION:
- Code scanning → CodebaseScanner → already well-presented
- Portfolio risk → PortfolioAssessment → already well-presented
- Cloud readiness → macro button shows honest "create migration first" → already honest
- Real-time data → LiveIndicator + RealtimeDataPanel → already present

LENS IDENTITY: The only legacy-modernization tool. Folder icon + cyan accent + debt metrics = code-debt dashboard, distinct from code-lens (which is VSCode-shaped).

RESPONSIVE DESIGN: Stacked panels on mobile. Already handles breakpoints.

BEFORE/AFTER:
- Before: Emoji header, missing error UI, CSS class dependency
- After: Lucide icon, explicit error boundary, inline Tailwind

IMPLEMENTATION PLAN:
1. Replace emoji with lucide FolderSearch
2. Replace `panel` CSS class with inline Tailwind
3. Add error UI wrapper
4. Add uppercase tracking-wider section headers

PRIORITY: P2 — polish
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 10. legal

```
LENS: legal
PURPOSE: Legal practice management — Clio/PracticePanther parity (matters, billing, trust, documents)

CURRENT DESIGN:
- Uses design-system tokens (`ds.pageContainer`, `ds.sectionHeader`, `ds.heading1`, `ds.textMuted`, `ds.btnGhost`, `ds.focusRing`) — most tokenized approach in this batch
- Scale icon in amber — professional legal identity
- Legal disclaimer banner — essential and well-placed
- 5 workbench tabs with icon + kbd shortcut + hint tooltip — excellent discoverability
- ShellPreview for rival-shape preview — nice
- All real workbench components: ClioSection, ContractAnalyzer, CaseTracker, LegalQA, LegalCaseSearch
- MobileTabBar for mobile navigation
- LensAgentFab with legal-specific prompt

DESIGN DIRECTION: Clio/PracticePanther shape — professional, trustworthy, amber-warm. Legal practice management should feel like a real attorney's workspace: matter-centric, billing-focused, trust-accounting visible. The amber Scale icon is perfect.

LAYOUT UPGRADE:
- Already correct: ds.pageContainer header with Scale icon + LiveIndicator + DepthBadge
- Legal disclaimer — essential, well-placed, correctly styled
- Tab nav with kbd shortcuts — excellent
- Workbench content delegated to deep components

COMPONENT-LEVEL CHANGES:
- Tab active state: `bg-amber-400/20 text-amber-400` — correct for legal brand
- Tab kbd hints: `text-[9px] px-1 py-0.5 rounded bg-black/30 text-gray-400 font-mono` — excellent
- Disclaimer: `bg-amber-500/10 border border-amber-500/30` — appropriate warning treatment

VISUAL UPGRADES:
- Already uses design-system tokens consistently
- Typography: ds.heading1 for title, ds.textMuted for description — correct
- Spacing: ds.pageContainer + ds.sectionHeader — consistent

CAPABILITY PRESENTATION:
- Practice management (ClioSection) → deep real component → well-presented
- Contract analyzer → AI-powered → well-presented
- Docket tracker → quick case log → well-presented
- Legal Q&A → jurisdiction-aware → well-presented
- Case law → CourtListener integration → well-presented

LENS IDENTITY: The only practice-management lens (distinct from `law` which is research-focused). Amber Scale + disclaimer + ClioSection = attorney workspace. Correctly cross-references `law` lens for case-law research instead of duplicating.

RESPONSIVE DESIGN: Tab nav wraps. MobileTabBar for mobile. Already handles all breakpoints.

BEFORE/AFTER: No changes needed — extremely well-designed, tokenized, and deep.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 9/10
UPGRADE POTENTIAL: 2/10
```

---

## 11. lfg

```
LENS: lfg
PURPOSE: Looking For Group — find or post group requests across all worlds

CURRENT DESIGN:
- Unique gradient background: `from-slate-950 via-zinc-950 to-cyan-950/10` — atmospheric
- Cyan brand with fuchsia accent for post form — two-tone identity
- 279 lines, single-file — lean
- All real data from `/api/lfg/open` — no mock data
- Four honest states: loading/error/empty/populated
- Background refresh via useSmartPolling — no flicker
- "you" badge on own posts (fuchsia) — honest session tracking
- Text is extremely dense: `text-[11px]` dominant body size
- Flash message system is inline, not toast — functional but visually modest
- Form uses native `<select>` elements — functional but not styled

DESIGN DIRECTION: Group-finder board — MMO-style LFG board. Cyan for the social/matching identity, dark atmospheric background for the gaming feel. Think FFXIV Party Finder / WoW Group Finder — role icons (tank/healer/dps), world badges, clean post cards with action buttons.

LAYOUT UPGRADE:
- Header: Users icon in cyan badge + title + refresh
- 2-column: request list (2/3) + post form (1/3) — already correct
- Request items: role badge + world + party type + note + action button
- Filter bar: world + role dropdowns — already correct

COMPONENT-LEVEL CHANGES:
- `text-[11px]` dominant → `text-xs` for body text (12px vs 11px — small change, big readability improvement)
- Native `<select>` → styled select with `rounded-md border border-cyan-500/20 bg-cyan-500/5`
- Request items: add role-specific color coding (tank=blue, healer=green, dps=red, support=purple, any=gray)
- Post form: wrap in distinct panel with fuchsia accent border

VISUAL UPGRADES:
- Typography: increase body to `text-xs` (from `text-[11px]`)
- Role badges: color-coded by role type (not just cyan)
- Request cards: add subtle left-border accent by role
- Form: styled selects instead of native
- Flash messages: consider upgrading to toast for better visual treatment

CAPABILITY PRESENTATION:
- Post requests → real form → well-presented but uses native selects
- Filter by world/role → real dropdowns → functional but could be more visual
- Invite/Cancel → real buttons → well-presented with honest session tracking
- Auto-refresh → useSmartPolling → invisible but correct

LENS IDENTITY: The only LFG/party-finder tool. Cyan + gradient background + role badges = MMO social matching, distinct from all other lenses.

RESPONSIVE DESIGN: 2fr:1fr grid stacks on mobile. Already handles breakpoints.

BEFORE/AFTER:
- Before: Ultra-dense 11px text, native selects, single-tone cyan
- After: 12px body text, styled selects, color-coded role badges, role-specific card accents

IMPLEMENTATION PLAN:
1. Increase body text to `text-xs` (from `text-[11px]`)
2. Add role-specific color coding for badges
3. Replace native selects with styled selects
4. Add left-border accent per role type on request cards

PRIORITY: P1 — significant readability improvement needed (11px body text is too small)
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 12. linguistics

```
LENS: linguistics
PURPOSE: Language analysis, lexicon, grammars, corpora, translations

CURRENT DESIGN:
- 879 lines — very dense, feature-rich page
- Pink-400 brand accent — distinctive
- 6 tabs (Analyses/Lexicon/Grammars/Corpora/Translations/Dashboard) with icon + color coding
- Quick Analysis panel with real `linguistics.analyze` macro — genuine NLP compute
- Subfield color-coding (phonology=pink, morphology=purple, syntax=blue, etc.) — functional visual encoding
- 3 collapsible sections: lookup tools, word lookup, word learning suite
- VocabularyBuilder + QuizEngine + ProgressDashboard + WordDecks + WordTools — deep feature set
- Detail panel with IPA, morphemes, syntax trees, glosses, examples — genuinely deep
- RecentMineCard + AutoActionStrip + CrossLensRecentsPanel footer

DESIGN DIRECTION: Linguistic research terminal — think Phonology Assistant / FLEx / TypeCraft. Pink accent for the phonological identity. Dense data tables, IPA transcription prominently displayed, morpheme breakdowns with color coding. The subfield color system is excellent — lean into it.

LAYOUT UPGRADE:
- Header: Languages icon in pink badge + title + realtime toolbar
- Quick Analysis: prominent input → result display — already correct
- Tab bar: 6 tabs with icons — already correct
- Content: 2-column grid (list 2/3 | detail 1/3) — already correct
- Collapsible sections: lookup tools, word learning, workbench — good progressive disclosure

COMPONENT-LEVEL CHANGES:
- Stat cards: `text-2xl font-bold` for numbers — already good emphasis
- Tab active: `bg-pink-400/20 text-pink-400` — correct
- Subfield badges: color-coded per SUBFIELD_COLORS — excellent
- Detail panel: `sticky top-4` — good for long-scroll context
- Quick Analysis input: `bg-lattice-deep border-lattice-border` — consistent

VISUAL UPGRADES:
- Typography: already has strong hierarchy (stat numbers, section headers, body text)
- Motion: framer-motion entrance animations on stats — already present
- Color: subfield color-coding is the strongest visual feature — ensure it's consistent
- The `lens-card` and `panel` CSS classes should be replaced with inline Tailwind

CAPABILITY PRESENTATION:
- Quick Analysis → real `linguistics.analyze` → well-presented with result display
- IPA transcription → displayed in detail panel → well-presented with `font-mono`
- Morpheme breakdown → color-coded badges → well-presented
- Vocabulary learning suite → 5 components → well-presented behind collapsible
- Datamuse/Dictionary lookup → collapsible panel → well-presented

LENS IDENTITY: The only linguistics/NLP tool. Pink accent + IPA display + subfield color-coding + morpheme badges = unmistakable language-science workspace.

RESPONSIVE DESIGN: 2-col grid stacks on mobile. Collapsible sections handle depth. Tab bar wraps.

BEFORE/AFTER:
- Before: CSS class dependencies (lens-card, panel), very long page (879 lines)
- After: Inline Tailwind, progressive disclosure via collapsibles, the page structure is already correct

IMPLEMENTATION PLAN:
1. Replace `lens-card` and `panel` CSS classes with inline Tailwind
2. Verify subfield color-coding is consistent in all views
3. Consider extracting the detail panel into a more prominent position on mobile

PRIORITY: P2 — polish (CSS class cleanup)
DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 5/10
```

---

## 13. literary

```
LENS: literary
PURPOSE: Literary Resonance Lattice — public-domain corpus search with provenance

CURRENT DESIGN:
- Violet/amber brand — literary and scholarly
- Gradient background: `from-slate-950 via-zinc-950 to-purple-950/10` — atmospheric
- Real BM25 + dense hybrid search with honest "Grounded" vs "Keyword only" badge
- Honest empty corpus CTA: "Run node scripts/ingest-gutenberg.mjs"
- Annotation system that mints DTUs citing source passages — genuinely deep
- Resonance lattice force-graph visualization — distinctive
- Crystallization candidates panel — cross-domain bridge discovery
- Cross-domain resonance bridges — lateral connections
- Export as GraphML/CSV/JSON — real graph export
- Full passage reader with neighbor navigation — real reading experience
- All real data, zero fabricated content

DESIGN DIRECTION: Academic library / literary research tool — think JSTOR + Gephi force-graph. Violet for the scholarly identity. Dense passage text, provenance metadata, citation networks. The force-graph visualization is the signature element — it should be prominent and beautiful.

LAYOUT UPGRADE:
- Header: BookOpen icon in violet badge + corpus stats + export links — already correct
- Search bar: full-width with violet focus ring — already correct
- 2-column: results (2/3) + sidebar (1/3) with graph, provenance, annotations
- Below: crystallization candidates + resonance lattice graph

COMPONENT-LEVEL CHANGES:
- Header: `text-lg font-semibold tracking-wide` — already good
- Search button: `bg-violet-600 hover:bg-violet-500` — correct
- Result cards: `rounded-lg border border-zinc-800 bg-zinc-900/50` — consistent
- Selected state: `border-violet-500/60 bg-violet-950/20` — clear selection feedback
- Provenance panel: `rounded-lg border border-zinc-800 bg-zinc-900/50` — consistent

VISUAL UPGRADES:
- Typography: passage text needs `leading-relaxed` (already present on snippets)
- The force-graph should be larger/more prominent when corpus is populated
- Annotation textarea: `focus:border-sky-500/50` — sky is different from violet brand; should be violet
- Crystallization salience bar: `bg-cyan-500/70` — cyan is different from violet; should be violet or amber

CAPABILITY PRESENTATION:
- Hybrid search → real BM25 + dense → honest retrieval-mode badge
- Passage reader → real literary.detail → well-presented with neighbor navigation
- Annotations → real DTU minting → well-presented with save status
- Resonance lattice → GraphView force-graph → distinctive visualization
- Crystallization candidates → real salience ranking → well-presented with progress bars
- Export → GraphML/CSV/JSON → real, not fabricated

LENS IDENTITY: The only literary/corpus-research tool. Violet + force-graph + provenance metadata + annotation system = unmistakable literary scholarship workspace. The annotation-DTU-minting is genuinely unique.

RESPONSIVE DESIGN: 2-col stacks on mobile. Force-graph may need full-width treatment on small screens.

BEFORE/AFTER:
- Before: Sky/cyan accent inconsistency in annotation and crystallization panels
- After: Unified violet accent throughout, larger force-graph, consistent focus rings

IMPLEMENTATION PLAN:
1. Unify accent colors: sky-500/50 → violet-500/50 on annotation textarea focus
2. Unify crystallization bar: cyan-500/70 → violet-500/70
3. Enlarge force-graph on desktop (h-80 → h-96)
4. Add corpus stats as prominent hero element when populated

PRIORITY: P2 — polish (accent consistency)
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 5/10
```

---

## 14. loading.tsx

```
LENS: loading.tsx (shared Next.js loading state)
PURPOSE: Loading fallback for /lenses/* routes — NOT a user-facing lens

CURRENT DESIGN: This is a Next.js route loading file, not a rendered lens page. It provides a loading skeleton/fallback while lens pages load.

DESIGN DIRECTION: N/A — infrastructure file, not a visual surface.

PRIORITY: N/A — not a lens
DESIGN SCORE: N/A
UPGRADE POTENTIAL: N/A
```

---

## 15. lock

```
LENS: lock
PURPOSE: 70% sovereignty lock deep-dive — invariant visualization, audit, enforcement

CURRENT DESIGN:
- 869 lines — very dense, feature-rich
- Emoji 🔐 header — lower fidelity
- Lock percentage displayed prominently at `text-3xl font-bold` — correct emphasis
- Color-coded lock states: green (locked), amber (warning), red (danger) — excellent
- Lock gauge with 70% threshold marker — excellent visualization
- Stat cards with motion animations (staggered entrance) — polished
- Active invariants with status dots (green/yellow/red) — clear
- Lock history timeline with connector lines — nice touch
- Sovereignty Monitor with Ownership Verification gauge — excellent
- Live Enforcement feed with pass/blocked indicators — real runtime data
- LockProfiler + LockDashboard + SovereigntyDashboard — deep feature set
- InlineActionWall flagged by grader — action buttons spread across page

DESIGN DIRECTION: Security operations center — ThinkSplunk/Sentinel dashboard. Red/green/amber lock states should dominate. The sovereignty lock percentage is THE defining metric — it should be the first thing you see, larger and more prominent than anything else.

LAYOUT UPGRADE:
- Header: Lock icon in styled badge + sovereignty lock percentage (hero-sized)
- Lock gauge: keep prominent — this IS the lens
- Stat cards row: invariants, audits, enforcement rate, lock state
- Active invariants: grid with status indicators
- Sovereignty Monitor: gauges and enforcement feed
- Lock history: timeline with audit events
- LockProfiler: collapsible (it's a power-user tool)
- Footer: RecentMineCard/AutoActionStrip/CrossLensRecentsPanel

COMPONENT-LEVEL CHANGES:
- Emoji 🔐 → lucide `Lock` in `rounded-lg bg-neon-cyan/10 p-2`
- Lock percentage: `text-3xl font-bold` → `text-5xl font-bold font-mono` (make it the hero)
- Stat cards: keep `text-2xl font-bold` — correct emphasis
- Invariant list: add left border color by status (green/yellow/red)
- Lock history timeline: connector line already present — keep

VISUAL UPGRADES:
- Typography: lock percentage at `text-5xl` as hero metric
- Color: green/amber/red lock states already excellent — ensure consistent use
- Motion: staggered card entrance already present — keep
- The lock gauge with 70% threshold is the signature visualization — keep prominent
- `panel` CSS class → inline Tailwind for consistency

CAPABILITY PRESENTATION:
- Lock percentage → hero metric → make more prominent
- Invariant enforcement → status grid → well-presented
- Audit history → timeline → well-presented
- Sovereignty Monitor → gauges → well-presented
- Live Enforcement → real-time feed → well-presented with honest disclosure
- Lock Profiler → deep analysis tool → collapsible, correct

LENS IDENTITY: The only sovereignty/security-invariant lens. Lock icon + green/amber/red states + 70% gauge + enforcement feed = unmistakable security dashboard.

RESPONSIVE DESIGN: Stat cards grid (4-col → 2-col → 1-col). Gauge full-width. Already handles breakpoints.

BEFORE/AFTER:
- Before: Emoji header, lock percentage competes with stat cards for attention
- After: Lucide lock icon, lock percentage as hero metric (text-5xl), stat cards secondary

IMPLEMENTATION PLAN:
1. Replace emoji with lucide Lock
2. Make lock percentage the hero metric (text-5xl font-bold font-mono)
3. Replace `panel` CSS class with inline Tailwind
4. Add left-border color to invariant list items by status

PRIORITY: P1 — hero metric should dominate (lock % is currently same size as stat cards)
DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 6/10
```

---

## 16. logistics

```
LENS: logistics
PURPOSE: FedEx/Project44-parity — fleet, shipments, warehouse, routes, compliance

CURRENT DESIGN:
- 522 lines — dense but well-organized
- Uses LensPageShell for consistent framing — good
- Real dashboard KPIs via `logistics.dashboard-summary` macro — real data
- 7 mode tabs (Fleet/Shipments/Tracker/Warehouse/Routes/Compliance/Map) with icons
- TMS workbench with 9 sub-tabs (Shipments/Carriers/Rates/Pickups/Docks/Fleet/Loads/POD/EDI Events) — extremely deep
- VisibilityTower — real-time visibility
- LogisticsActivityFeed — real shipment events
- MapView with fleet geolocation — real GPS data
- ShellPreview for rival shape
- MobileTabBar for mobile
- Uses `ds.*` design-system tokens in StatCard — consistent

DESIGN DIRECTION: TMS/logistics operations center — FedEx/Project44/Samsara shape. Cyan brand is correct. Dense dashboard with fleet KPIs, map view, shipment tracking. Think dispatch operators who need real-time visibility — information density is critical.

LAYOUT UPGRADE:
- ShellPreview (rival shape) — already present
- TMS workbench (collapsible) — already present with 9 sub-tabs
- Visibility tower (collapsible) — already present
- Dashboard KPIs: 2 rows of 4 stat cards — already correct
- Mode tabs: 7 tabs — already correct
- Activity feed — already present

COMPONENT-LEVEL CHANGES:
- StatCard: uses `ds.panel` and `ds.textMuted` — consistent with design system
- Tab active: `bg-neon-cyan/20 text-neon-cyan` — correct
- KPI values: `text-2xl font-bold` — good emphasis
- Mode tabs: `text-sm font-medium` with icon — clean

VISUAL UPGRADS:
- Typography: already consistent via design-system tokens
- Spacing: `ds.grid4` for KPI rows — consistent
- Icons: Truck, Package, Warehouse, Route, ShieldCheck, Navigation — appropriate
- Map view: `h-[500px]` — good prominence

CAPABILITY PRESENTATION:
- Fleet management → FleetVehiclesPanel → real macro-backed
- Shipment tracking → ShipmentTracker → real macro-backed
- Route optimization → RouteOptimizer → real macro-backed with HOS constraints
- Warehouse → WarehouseInventory → real macro-backed
- Map view → MapView with GPS positions → real fleet geolocation
- Compliance → ComplianceReportsPanel → real macro-backed
- TMS workbench → 9 sub-tabs → extremely deep, real

LENS IDENTITY: The only logistics/TMS tool. Cyan truck icon + fleet KPIs + map view = unmistakable logistics operations center.

RESPONSIVE DESIGN: Tab nav wraps. KPI grid adapts. Map full-width on mobile. Already handles breakpoints.

BEFORE/AFTER: No changes needed — well-organized, real data, deep feature set.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 3/10
```

---

## 17. mail

```
LENS: mail
PURPOSE: Async player-to-player mail with attachments and COD

CURRENT DESIGN:
- 587 lines, single-file — lean and complete
- Uses `ds.*` design-system tokens throughout — most consistent approach
- Inbox/Sent/Compose tabs with unread count badge — excellent
- 2-column layout: mail list (1fr) + detail (2fr) — correct ratio for mail
- Search + status filters — real filtering
- Compose form with RecipientSearchInput (real user search) — genuine functionality
- DTU attachment picker (DTUPickerModal) — real attachment system
- CC gift + COD payment fields — real economy integration
- Read-on-select — honest behavior
- Realtime mail:received subscription — live updates
- Loading skeletons, empty states, error states — all honest
- All real data from `/api/mail/inbox` + `/api/mail/sent`

DESIGN DIRECTION: Email client — think Apple Mail / Thunderbird / Outlook. Blue brand is correct for messaging. Clean list-detail layout, unread indicators, attachment chips. This should feel like a real messaging product, not a game feature.

LAYOUT UPGRADE:
- Header: Mail icon in blue badge + title + refresh + tab bar (inbox/sent/compose)
- 2-column: mail list (left) + detail (right) — already correct
- Compose: full-width form with recipient search, subject, body, CC/COD, attachments

COMPONENT-LEVEL CHANGES:
- Tab bar: `text-[11px] font-medium capitalize` with `role="tab"` + `aria-selected` — excellent a11y
- Unread indicator: `h-1.5 w-1.5 rounded-full bg-neon-blue` — clean
- Mail list items: `border-l-2` left accent for selection/unread — excellent
- Detail header: subject + from/to + timestamp — well-organized
- Attachment chips: `bg-lattice-void px-1 tabular-nums` — clean, color-coded (amber=CW, cyan=DTU, red=COD)
- Compose form: `ds.overline` for labels, `ds.btnPrimary` for send — consistent

VISUAL UPGRADES:
- Typography: already consistent via design-system
- Spacing: `gap-3` for grid, `space-y-0.5` for list — appropriate for mail density
- Loading: Skeleton components — already present
- Empty: EmptyState component — already present with contextual messages
- Error: ErrorState component — already present with retry

CAPABILITY PRESENTATION:
- Mail list → real inbox/sent → well-presented with search and filters
- Mail detail → real read view → well-presented with attachments
- Compose → real recipient search + DTU attachments → well-presented
- COD payments → real economy integration → well-presented with honest claim flow
- Realtime updates → socket subscription → invisible but correct

LENS IDENTITY: The only mail/messaging lens. Blue mail icon + inbox unread count + attachment chips = unmistakable email client, distinct from message-lens (which is real-time chat).

RESPONSIVE DESIGN: 2-col stacks on mobile. Tab bar wraps. Already handles breakpoints.

BEFORE/AFTER: No changes needed — this is one of the most complete, honest, well-designed single-file lenses.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 9/10
UPGRADE POTENTIAL: 1/10
```

---

## 18. maker

```
LENS: maker
PURPOSE: Bubble/Retool-parity no-code app builder

CURRENT DESIGN:
- 352 lines — lean page shell
- Uses design-system tokens
- Real project creation flow — tested end-to-end
- 5 tabs: Editor/Data/Workflows/Connectors/Marketplace/Versions
- Components palette + drop-target canvas — real visual editor
- "Featured Actions" panel with honest "No actions registered" empty state
- 127 real quests in substrate

DESIGN DIRECTION: No-code builder — Bubble/Retool/Appsmith shape. Dark IDE theme with component palette on left, canvas center, properties right. Think developer tools — code editors, drag-and-drop builders, workflow visualizers.

LAYOUT UPGRADE:
- Already correct: thin page shell delegating to deep child components
- Tab bar for Editor/Data/Workflows/Connectors/Marketplace/Versions

COMPONENT-LEVEL CHANGES:
- Delegated to child components — no page-level changes needed

VISUAL UPGRADES:
- Delegated to child components

CAPABILITY PRESENTATION:
- Visual editor → real drag-and-drop → already excellent
- Data binding → real data tab → already present
- Workflow wiring → real workflows tab → already present
- Marketplace integration → real marketplace tab → already present
- Version tracking → real versions tab → already present

LENS IDENTITY: The only no-code builder. Retool/Bubble shape = unmistakable app-builder workspace.

RESPONSIVE DESIGN: Delegated to child components.

BEFORE/AFTER: No changes needed — genuinely deep and well-designed.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 3/10
```

---

## 19. manufacturing

```
LENS: manufacturing
PURPOSE: OEE, work orders, quality/SPC, shop-floor execution (MES)

CURRENT DESIGN:
- 8 files, 2345 LOC — substantial component tree
- Real BLS PPI + Federal Reserve G.17 economic feeds
- Real OEE formula (availability × performance × quality)
- Work Orders sub-view with Machines/Work Orders/Andon Alerts/Open NCRs
- False Disconnected pill (reported in audit)
- Industrial-terminal layout

DESIGN DIRECTION: MES/manufacturing operations — SAP/Oracle Manufacturing Cloud shape. Industrial colors: steel gray, safety yellow for alerts, green for running, red for stopped. Dense dashboard with OEE gauges, machine status grid, work order queue. Think factory floor supervisor who needs real-time production visibility.

LAYOUT UPGRADE:
- OEE dashboard: three gauges (availability, performance, quality) + overall OEE
- Machine status grid: color-coded by state (running/stopped/maintenance)
- Work order queue: sortable table with priority/status
- Andon alerts: real-time alert panel
- NCR tracking: quality issue management

COMPONENT-LEVEL CHANGES:
- Fix false Disconnected pill — this is a functional issue, not design
- Stat cards: ensure OEE numbers are visually dominant
- Machine status: use green/red/amber dot indicators

VISUAL UPGRADES:
- Add OEE gauge visualizations (ring/donut charts for A/P/Q)
- Add machine status grid with color-coded cells
- Industrial color scheme: steel gray containers, safety-yellow warnings

CAPABILITY PRESENTATION:
- OEE calculation → real formula → should be hero metric
- Work orders → real macro-backed → should be prominent
- Andon alerts → real-time → should be visible without scrolling
- Quality/SPC → real data → should be in dedicated view
- Economic feeds → BLS PPI + Fed G.17 → unique depth

LENS IDENTITY: The only manufacturing/MES tool. Machine icons + OEE gauges + andon alerts = unmistakable factory-floor operations.

RESPONSIVE DESIGN: Dashboard grids adapt. Machine status may need horizontal scroll on mobile.

BEFORE/AFTER:
- Before: OEE buried in tab content, false Disconnected pill
- After: OEE as hero metric with gauges, fixed connectivity indicator

IMPLEMENTATION PLAN:
1. Fix false Disconnected pill
2. Make OEE the hero metric with visual gauges
3. Add machine status grid with color indicators
4. Surface Andon alerts above the fold

PRIORITY: P1 — OEE is the defining metric and should be hero-sized
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 20. market

```
LENS: market
PURPOSE: DTU marketplace, listings, economy simulation

CURRENT DESIGN:
- 14 files, 3062 LOC — substantial
- Yahoo Finance market-heatmap feed — real external integration
- "Your Balance 0 CC" — real wallet display
- "5 Active Listings" stat — real data
- Honest tour tip: "All orders settle through the on-substrate ledger"
- Create Listing form — real interactivity
- False Disconnected pill (reported in audit)
- Yahoo Finance heatmap stuck on "connecting..." (reported in audit)

DESIGN DIRECTION: Financial terminal / stock exchange shape. Green for gains, red for losses, real-time price tickers. Think Bloomberg Terminal lite — dense data, live feeds, price charts. The Yahoo Finance heatmap integration is the right direction.

LAYOUT UPGRADE:
- Header: balance display + listing count
- Market heatmap: Yahoo Finance integration (primary visual)
- Listing grid: active listings with price/creator/status
- Create listing: form panel

COMP
```

### Batch 7

See: `/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_7_FINDINGS.md`

```
# Batch 7 Design Audit — Lenses 158–182
**Audit date:** 2026-08-17
**Scope:** mental-health, mentorship, mesh, message, meta, metacognition, metalearning, mining, ml, move-builder, music, narrative-walk, neuro, news, nonprofit, observe, ocean, offline, ops, ops-telemetry, organ, paper, parenting, personas, pets, pharmacy, philosophy

---

## Summary

**P0 (redesign immediately):** 1 — move-builder (inline styles, non-Concord visual language)
**P1 (significant gaps):** 4 — meta (stuck load), metacognition (stuck load), ml (stuck search), paper (lens.create broken)
**P2 (polish passes):** 8 — music (spinner/egress), ocean (spinner/egress), observe (thin compose form), organ (scaffold-heavy), neuro (scaffold-heavy), nonprofit (scaffold-heavy), ops (scaffold-heavy), personas (scaffold-heavy)
**P3 (already strong):** 14 — mental-health, mentorship, mesh, message, metalearning, mining, narrative-walk, news, offline, ops-telemetry, parenting, pets, pharmacy, philosophy

---

## 158. mental-health

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Three-section page: `MentalHealthSection` (the main workbench with Practice/Mood/Sleep/Reflect/Companion/Factors/Calendar/Reminders/Worksheets/Safety Plan/Report tabs), `CrisisPanel` (crisis hotline + safety plan), and `MentalHealthActionPanel` (coping strategies + wellness score calculators). `MedlinePlusPanel` provides medical reference. Layout: hero section → collapsible coping/wellness calculators → main workbench → crisis panel. Uses `ManifestActionBar` + `RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel` (imports generic trio). Uses `ds.pageContainer` and `ds.heading1` design system tokens.

### DESIGN DIRECTION
Already correctly designed — "Calm + Headspace shape, not medical advice." The calm clinical-but-warm visual identity is exactly right for a sensitive domain. Real validated instruments (PHQ-9, GAD-7) are disclosed by name. No forced gamification. The "Safety plan" tab is present and not trivialized.

### LAYOUT UPGRADE
No structural changes needed. The layout hierarchy is clear: crisis panel prominent, workbench tabbed below.

### COMPONENT-LEVEL CHANGES
- **Minor:** The coping-strategy and wellness-score calculators at the top are collapsed by default with `ChevronDown`/`ChevronRight` toggles — they sit above the main workbench and compete for attention. Consider moving them into the workbench's "Practice" tab or a dedicated "Tools" section within the workbench to reduce top-level noise.

### VISUAL IDENTITY
- **Typography:** `ds.heading1` for title, appropriate muted text for descriptions. Correct.
- **Color:** `text-neon-pink` (Heart icon), `text-neon-purple` for accents. Appropriate warmth for the domain.
- **Spacing:** `ds.pageContainer` padding. Correct density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate for clinical-adjacent tool
- **Micro-interactions:** ✅ Collapsible sections, tab navigation, real state updates
- **Visual identity:** ✅ Calm, clinical-but-warm — distinct from every other lens
- **Perceived performance:** ✅ Loading states present, optimistic UI where appropriate
- **Craft:** ✅ Honest empty states, no fabricated data

---

## 159. mentorship

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Clean mentorship marketplace: `Directory` + `Requests` + `Sessions` + `Goals` + `Messages` + `Coaching Tools` + `Program` + `Community` tabs. Real `matchMentor` skill-graph algorithm. Honest "No mentors found" empty state. Real "Become a mentor" form (Display name/Headline/Short bio/Skills/Availability). Uses `ManifestActionBar` + `AutoActionStrip` + `CrossLensRecentsPanel`. Bespoke ratio: 0.899.

### DESIGN DIRECTION
"Professional mentorship marketplace" — correctly matches the reference apps (MentorCruise / ADPList). The removal of the fabricated "Match: 87%" badge (confirmed gone) makes this honest.

### LAYOUT UPGRADE
No structural changes needed. The tabbed marketplace layout is appropriate.

### COMPONENT-LEVEL CHANGES
- No changes needed.

### VISUAL IDENTITY
- Clean, appropriately professional. Uses standard Concord lattice tokens.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Dense but readable
- **Micro-interactions:** ✅ Tab switching, form submission, real state updates
- **Visual identity:** ✅ Professional mentorship-marketplace feel
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest empty states, no fabrication

---

## 160. mesh

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
7-tab off-grid mesh networking surface: Overview/Send DTU/Topology/Messages/Signal/Queue/Channels. Real GitHub `topic:mesh-networking` live feed. Real success toast "Add Node — ok" confirmed. `MeshRepos` for mesh-networking project feed. Each tab backed by a bespoke panel (`MeshTopology`, `MeshSendDtu`, `MeshMessaging`, `MeshSignal`, `MeshQueue`, `MeshChannels`). Bespoke ratio: 0.807. Uses generic trio.

### DESIGN DIRECTION
"Technical mesh-network topology identity" — correct for the domain. Meshtastic/Briar-parity tooling.

### LAYOUT UPGRADE
No changes needed.

### COMPONENT-LEVEL CHANGES
No changes needed.

### VISUAL IDENTITY
- Appropriate technical/network-topology identity. Radio icon, lattice-border cards.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate for technical operator tool
- **Micro-interactions:** ✅ Tab switching, real macro calls
- **Visual identity:** ✅ Technical/off-grid aesthetic
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest status, no fabrication

---

## 161. message

**PRIORITY: P2 — polish pass (scaffold tail + dual-panel overlap)**

### CURRENT DESIGN
Complex messaging surface. Top: `GmailSection` + `SlackSection` (connector integrations). Main: `InboxShell` rival-shape silhouette (labels sidebar + thread list + message view). InboxShell renders: labels (Inbox/Starred/Snoozed/Sent/Archive/Trash), thread list with virtualized list (Virtuoso), message view with inline reply composer, compose modal with `RecipientSearchInput`. Bottom: `MessageWorkbench` (saved/starred, search, voice notes, reactions) via floating button. `LabelManagerPanel` + `MessagingRepos` below. Keyboard shortcuts: g→inbox, g→starred, g→sent, c→compose, r→reply. Uses `LensShell` + `FirstRunTour` + `ManifestActionBar` + `DepthBadge`. Also renders `RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel` at the very bottom. Bespoke ratio: 0.897.

### DESIGN DIRECTION
"Slack + Gmail hybrid" — the InboxShell rival-shape silhouette is the canonical reference. The keyboard shortcuts (g→i, g→s, g→t, c, r) match Gmail conventions perfectly.

### LAYOUT UPGRADE
1. **Remove the scaffold tail:** `RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel` appear AFTER the `MessageWorkbench` button at the very bottom of the page — they're redundant with the real InboxShell and add dead vertical space. Remove them.
2. **Gmail/Slack sections overlap with InboxShell:** The `GmailSection` + `SlackSection` connectors at the top compete with the main `InboxShell` for attention. Move them into the InboxShell's sidebar or a settings panel — the user shouldn't see two different messaging UIs stacked.
3. **Compose modal lacks rich text:** The compose textarea is a bare `<textarea>` with no formatting toolbar — even basic bold/italic/link would match Gmail parity.

### COMPONENT-LEVEL CHANGES
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel` from the page bottom.
- Move `GmailSection` + `SlackSection` into a "Connectors" settings tab inside InboxShell or a gear icon in the header.
- Add minimal rich-text toolbar (bold, italic, link) to the compose textarea.

### VISUAL IDENTITY
- **Typography:** Appropriate. `text-xl font-semibold text-white` for subject, `text-sm text-gray-400` for metadata.
- **Color:** `bg-neon-blue` for Workbench FAB, `border-lattice-border` for cards. Correct lattice palette.
- **Spacing:** `h-[calc(100vh-6rem)]` for the InboxShell — correct full-height messaging layout.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Dense but well-organized (sidebar + list + detail)
- **Micro-interactions:** ✅ Keyboard shortcuts, virtualized scrolling, inline reply
- **Visual identity:** ✅ Strong InboxShell silhouette matches Gmail/Slack
- **Perceived performance:** ✅ Skeleton loading states, optimistic UI
- **Craft:** ✅ Honest empty states, real connector disclosures

---

## 162. meta

**PRIORITY: P1 — stuck load blocks all assessment**

### CURRENT DESIGN
Platform self-audit dashboard: Dev Portal/Components/Lenses/Orphans/Wiring Map/Search/Lens Infrastructure tabs. `SystemHealth` + `DevPortal` bespoke components. 1308 LOC page, 0.615 bespoke ratio. Imports generic trio. Uses `useArtifacts`, `useCreateArtifact` for lens-manifest-based data. Real `LENS_STATUS_MAP`, `getLensStatusSummary`, `WIRING_PROFILES` from `@/lib/lenses`. The page is the platform's own CI-grade self-audit surfaced to users.

### DESIGN DIRECTION
"Meta/introspective identity" — layered-stack icon, appropriately technical. The concept (expose the platform's own audit as a user feature) is exceptional.

### LAYOUT UPGRADE
Cannot fully assess until the stuck load resolves. The Overview tab's "Loading inventory overview..." never resolved (5+ seconds). Once fixed:
1. The Overview tab should show a summary dashboard (total components/lenses/orphans/route count) as stat tiles, not a loading spinner.

### COMPONENT-LEVEL CHANGES
- **Bug (P1):** `SystemHealth` or the overview fetch is stuck — root-cause why "Loading inventory overview..." never resolves. This is the platform's own self-audit dashboard failing to load its own headline view.

### VISUAL IDENTITY
Cannot fully assess while stuck on loading state.

---

## 163. metacognition

**PRIORITY: P1 — stuck load blocks all assessment**

### CURRENT DESIGN
6-tab metacognition workbench: Dashboard/Introspection/Predictions/Learning/Journal/Practice. Bespoke panels: `CogsciFeed`, `DecisionJournal`, `ReflectionPrompts`, `BiasChecklist`, `StrategyLibrary`, `AccuracyTracker`, `ReasoningToolkit`. 1561 LOC page, 0.564 bespoke ratio. Uses generic trio + `ManifestActionBar`. Uses `useLensBridge('metacognition', 'strategy')` for cross-lens data. Uses `useRealtimeLens` for live data. `useQuery` calls `apiHelpers.metacognition.*`.

### DESIGN DIRECTION
Cannot assess — page stuck on "Loading metacognition data..."

### LAYOUT UPGRADE
Cannot assess until load resolves. The tab structure (6 tabs) appears well-designed from the type definitions.

### COMPONENT-LEVEL CHANGES
- **Bug (P1):** "Loading metacognition data..." never resolved after 5+ seconds. Grouped with `metalearning`'s identical failure — check if they share a broken data source.

### VISUAL IDENTITY
Cannot assess while stuck.

---

## 164. metalearning

**PRIORITY: P1 — stuck load blocks all assessment**

### CURRENT DESIGN
8-tab metalearning workbench: MetalearningFeed/SpacedRepetition/LearningPlan/TechniqueLibrary/ProgressAnalytics/GoalTracker/StrategyExperiment/StudyJournal. 824 LOC page, 0.589 bespoke ratio. Uses generic trio + `ManifestActionBar` + `ConnectiveTissueBar`. Uses `useLensBridge('metalearning', 'strategy')`. `useQuery` calls `apiHelpers.metalearning.*`. `useMutation` for `createStrategy`, `runCurriculum`, `recordOutcome`.

### DESIGN DIRECTION
Cannot assess — page stuck on bare "Loading..."

### LAYOUT UPGRADE
Cannot assess until load resolves. The 8-tab structure with real mutations (create strategy, run curriculum, record outcome) suggests genuine depth once working.

### COMPONENT-LEVEL CHANGES
- **Bug (P1):** Bare "Loading..." spinner never resolved. Third consecutive lens in the `meta`/`metacognition`/`metalearning` cluster to fail — likely shared root cause.

### VISUAL IDENTITY
Cannot assess while stuck.

---

## 165. mining

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
8-tab mining operations tool: Sites & Safety/Geology/Mine Plan/Fleet & Schedule/GIS Map/MSHA Compliance/Environmental/Quick Calcs. Bespoke panels: `MineSiteManager`, `GeologyWorkbench`, `MinePlanWorkbench`, `FleetManager`, `GisPitMap`, `MshaLookup`, `EnvironmentalCompliance`, `MiningActionPanel`. Uses `LensPageShell` (a non-standard shell wrapper). 119 LOC page — extremely thin, all depth in bespoke components. Bespoke ratio: 0.943. Does NOT import generic trio (no `RecentMineCard`/`AutoActionStrip`). No `ManifestActionBar`.

### DESIGN DIRECTION
"Industrial earth- sciences/trades identity" — correct. Pickaxe icon, amber accent, tab bar matches reference mining software (Vulcan, Maptek).

### LAYOUT UPGRADE
No changes needed. The thin page + deep components pattern is correct.

### COMPONENT-LEVEL CHANGES
- **Minor:** The MSHA Compliance tab embeds `MshaLookup` inside a raw `<div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">` wrapper — consistent with the other tabs but the wrapper is duplicated in the page source rather than using a shared tab-panel pattern. Not a visual issue, just a maintenance note.

### VISUAL IDENTITY
- **Typography:** Uses `LensPageShell` which provides consistent heading/description.
- **Color:** Zinc palette (zinc-800/zinc-900/zinc-950) — appropriate for industrial tooling.
- **Spacing:** `space-y-4` between tabs, `p-4` inside panels. Correct density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real MSHA incident rates, ore grade calculators, GIS maps
- **Micro-interactions:** ✅ Tab switching, real macro calls
- **Visual identity:** ✅ Industrial/earth-sciences identity
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest states throughout

---

## 166. ml

**PRIORITY: P1 — stuck Model Hub search blocks primary workflow**

### CURRENT DESIGN
8-tab ML workbench: Model Hub/Playground/Experiments/Datasets/Compare/AutoML/Deployments/Spaces. Bespoke panels: `ModelHubPanel`, `InferencePlayground`, `ExperimentTracker`, `DatasetHubPanel`, `ModelComparePanel`, `AutoMLPanel`, `DeploymentsPanel`, `SpacesPanel`. Also `ArxivPanel` for arXiv cs.LG feed, `MlRepos` for GitHub repos, `MlActionPanel`. 179 LOC page — extremely thin, all depth in components. Bespoke ratio: 0.915. Uses `ManifestActionBar`. Tab bar uses neon-purple active state (`bg-neon-purple/20 text-neon-purple`). Keyboard shortcuts: m/l/e/d/c/a/p/s mapped to tabs.

### DESIGN DIRECTION
"ML-terminal layout matching the `code`/`data-science` family" — correct. Brain emoji header, tab bar pattern matches other technical lenses.

### LAYOUT UPGRADE
1. **The emoji header (`🤖`) should be replaced with a proper icon** — other technical lenses use Lucide icons consistently; the emoji breaks the visual language.
2. Once the search works, the Model Hub should show a grid of model cards (HuggingFace-style) rather than a flat list, to match the category leader.

### COMPONENT-LEVEL CHANGES
- **Bug (P1):** `ModelHubPanel` search — typing "bert" triggers "Loading models..." that never resolved (4+ seconds). Either the Hugging Face API call hangs without a timeout/fallback, or the response isn't parsed correctly.
- Replace `<span className="text-2xl">🤖</span>` with a Lucide `Brain` or `TestTube` icon.

### VISUAL IDENTITY
- **Color:** `neon-purple` tab accent — matches the `ml` theme. Correct.
- **Spacing:** `p-6 space-y-6` — correct density for a workbench.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate once search works
- **Micro-interactions:** ✅ Tab switching, playground model routing
- **Visual identity:** ⚠️ Emoji header is the one inconsistency
- **Perceived performance:** ❌ Stuck search is the blocker
- **Craft:** ✅ Honest loading states (when they resolve)

---

## 167. move-builder

**PRIORITY: P0 — inline styles, non-Concord visual language**

### CURRENT DESIGN
Single-page combat move authoring tool. 338 LOC, all in page.tsx. Inline `React.CSSProperties` style objects (`card`, `lbl`, `inp`, `stepBtn`, `primaryBtn`) defined at the bottom of the file. No Tailwind classes — entirely inline `style={{...}}`. Dark theme via hardcoded hex colors (`#1a1a22`, `#2a2a35`, `#13131a`, `#e8e4dc`). Sections: Name input → Element/Kind selectors → Modifier budget (power/speed/area/efficiency/control with +/− stepper buttons) → Live motion preview → Mint button → Your moves list (expandable detail). Bespoke ratio: 0 (entire page is the component). Does NOT import generic trio. No `ManifestActionBar`. No keyboard shortcuts.

### DESIGN DIRECTION
"Concordia combat-move authoring tool" — the concept is correct (diminishing-returns modifier budget, server-authoritative motion preview). But the visual language is completely non-Concord: inline styles with hardcoded hex colors, no Tailwind, no lattice tokens, no `ds.*` design system.

### LAYOUT UPGRADE
1. **Replace ALL inline styles with Tailwind classes + `ds.*` tokens.** This is the single most important change. The current page reads as a standalone prototype, not a Concord lens.
2. **Add a proper header** with icon, title, description, and `LiveIndicator` + `DTUExportButton` (standard Concord lens header pattern).
3. **Wrap in `LensPageShell`** (like mining uses) for consistent page structure.
4. **Add keyboard shortcuts** — at minimum Tab between sections, Enter to mint.
5. **Replace the `−`/`+` stepper buttons** with a proper slider or the `LensSlider` component used by other lenses — the current raw `−`/`+` buttons with no visual feedback on the range feel crude.
6. **Add a stat summary row** above the budget: "Budget: 6 | Spent: 4 | Balanced ✓" as a compact card, not inline text.
7. **The minted moves list** should use the `RecentMineCard` pattern or a custom card grid, not a raw `<ul>` with inline-styled `<li>` cards.

### COMPONENT-LEVEL CHANGES
- **Delete all `const card/lbl/inp/stepBtn/primaryBtn` CSSProperties** at the bottom of the file.
- **Replace inline `style={{...}}` with Tailwind classes** throughout:
  - `card` → `rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 mb-4`
  - `inp` → `w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100`
  - `stepBtn` → `bg-zinc-800 text-white border-none rounded-md px-2.5 py-1 hover:bg-zinc-700 transition-colors`
  - `primaryBtn` → `bg-emerald-600 text-white border-none rounded-lg px-5 py-2.5 font-semibold hover:bg-emerald-500 transition-colors`
- **Add `<FirstRunTour lensId="move-builder" />`** (currently missing).
- **Add `useLensNav('move-builder')`** (currently missing — the page doesn't register with the lens navigation system).
- **Add `useLensCommand`** for keyboard shortcuts.
- **Add error boundary handling** — the current error state is a raw `<div role="alert">` without the standard `ErrorState` component.

### VISUAL IDENTITY
- **Current:** Non-Concord. Hardcoded hex (#1a1a22, #e8e4dc, #2e7d32, #e05050). No lattice tokens. No Tailwind.
- **Target:** Concord lattice palette (zinc-900/950 backgrounds, lattice-border borders, emerald/green for primary actions, standard `ds.*` tokens). The move-builder is a game-authoring tool — it should feel like a spell-crafting workbench, not a standalone HTML page.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate — compose → preview → mint → library
- **Micro-interactions:** ⚠️ Live preview recomposes on every change (good), but no keyboard shortcuts, no animations
- **Visual identity:** ❌ Non-Concord — this is the #1 issue
- **Perceived performance:** ✅ Fast (deterministic macro calls)
- **Craft:** ⚠️ Honest loading/error/empty states present, but using raw HTML instead of Concord components

---

## 168. music

**PRIORITY: P2 — spinner/egress issue + scaffold tail**

### CURRENT DESIGN
2460 LOC page — the most complex in this batch. Full DAW-shape music lens: SessionView (Ableton-shape clip launcher), MusicStreamingSection (streaming feed), MusicArtistExplorer, MusicActionPanel, TrackCard, ArtistProfile, UploadFlow, PlaylistView, SessionClipPicker, MusicParityPanel (EQ/preamp). Also: `LiveIndicator`, `RealtimeDataPanel`, `LensFeedButton`, `LensAgentFab`, `VisionAnalyzeButton`, `FeedBanner`. Uses `useMusicStore` (Zustand), `getPlayer` (Web Audio), `previewRoyaltyObligations`. Keyboard shortcuts via `useLensCommand`. Bespoke ratio: 0.69. Does NOT import generic trio (no `RecentMineCard`/`AutoActionStrip`). Uses `SessionRail`.

### DESIGN DIRECTION
"Spotify + Apple Music shape" — correct. SessionView provides the DAW surface. The page is genuinely deep (EQ, preamp, royalty cascade preview, upload flow, artist explorer).

### LAYOUT UPGRADE
1. **Two loading spinners never resolved** (Library panel + stats row) — likely the documented outbound-egress constraint (iTunes/Jamendo/Audius APIs unreachable). Add an honest "External music APIs unreachable from this deployment" message instead of an indefinite spinner.
2. **The page is very tall** (2460 LOC in page.tsx alone) — consider lazy-loading below-the-fold sections (SessionView, UploadFlow) to improve initial paint.

### COMPONENT-LEVEL CHANGES
- **Fix spinner timeout:** Add a 10s timeout to the free-API fetch calls; on timeout, show "External music APIs unreachable — try again later" instead of an indefinite spinner.
- **No scaffold tail present** — this is already clean.

### VISUAL IDENTITY
- **Color:** Uses `ds.*` tokens and lattice palette. Correct.
- **Typography:** Standard Concord headings. Correct.
- **Spacing:** Appropriate for a DAW-style interface.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real DAW, real streaming, real royalty math
- **Micro-interactions:** ✅ SessionView clip launcher, EQ sliders, upload flow
- **Visual identity:** ✅ Strong Spotify/DAW identity
- **Perceived performance:** ❌ Spinners don't resolve (egress issue)
- **Craft:** ✅ Honest about egress constraints in comments

---

## 169. narrative-walk

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
229 LOC pure authored-narrative reader. NO backend macro surface — content bundled at build time (`concord-frontend/content/cinematics/*.json`). 4 UX states: loading (Film icon + pulse animation), error (AlertTriangle + retry guidance), empty (BookOpen + "No story beats yet"), populated (3-column grid of chapter cards). Each card shows: chapter number, name, summary, shot count, duration, Play button. Watched-journal via `localStorage`. Keyboard nav (arrow keys between play buttons). `ManifestActionBar` present.

### DESIGN DIRECTION
"Film treatment reader" — correct. The violet accent (`border-violet-500/20`, `text-violet-400`) gives a cinematic/literary feel. Watched cards get emerald accent (`border-emerald-500/30`). The progress tracker ("0/11 watched") is honest and non-manufactured.

### LAYOUT UPGRADE
No changes needed. The 3-column responsive grid is clean.

### COMPONENT-LEVEL CHANGES
No changes needed. The page is self-contained and correctly thin.

### VISUAL IDENTITY
- **Color:** Violet accent for literary/cinematic identity. Emerald for "watched" state. Correct and distinct.
- **Typography:** `text-base font-semibold` for title, `text-xs text-slate-400` for description. Correct.
- **Spacing:** `max-w-screen-2xl px-4 py-5 sm:px-6`. Correct.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate for a catalog/reader
- **Micro-interactions:** ✅ Play/Re-watch, keyboard nav, watched state persistence
- **Visual identity:** ✅ Distinct cinematic/literary feel
- **Perceived performance:** ✅ Async import with loading state
- **Craft:** ✅ All 4 UX states handled honestly

---

## 170. neuro

**PRIORITY: P2 — scaffold-heavy, otherwise excellent depth**

### CURRENT DESIGN
EEG/MEG analysis workbench: Research references (arXiv q-bio.NC + PubMed + Wikipedia) as collapsible section → `EegWorkbench` (EEGLAB/MNE-parity: import, waveform, topographic map, preprocessing, epoching, ERP, time-frequency, source localization, statistics) → `NeuroActionPanel` (bench mode: synthetic-signal FFT, mint/DM/publish/agent) → `NeuroTrainPanel` (real logistic-regression trainer). 126 LOC page, 0.918 bespoke ratio. Uses generic trio + `ManifestActionBar`. Honest disclosure: "every panel below traces to a neuro-domain macro run on either an imported recording or an explicitly disclosed synthetic signal."

### DESIGN DIRECTION
"Clinical/scientific EEG-terminal layout" — correct. Pink-to-purple gradient icon. The honest-by-construction disclosure is exemplary.

### LAYOUT UPGRADE
1. **The research references section should be at the bottom**, not the top — a researcher landing on this page wants the workbench first, not the paper feed. Move `EegWorkbench` to the top position.
2. **Remove the generic trio** (`RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel`) — they add nothing to a scientific workbench and reduce the bespoke ratio.

### COMPONENT-LEVEL CHANGES
- Move research references (arXiv/PubMed/Wikipedia) to bottom of page or into a collapsible "References" section below the workbench.
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.

### VISUAL IDENTITY
- **Color:** `from-pink-500 to-purple-600` gradient icon — appropriate for neuroscience.
- **Typography:** `ds.heading1` for title. Correct.
- **Spacing:** `space-y-6 p-6`. Correct density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real EEG analysis
- **Micro-interactions:** ✅ Collapsible sections, real macro calls
- **Visual identity:** ✅ Scientific/clinical identity
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest-by-construction exemplar

---

## 171. news

**PRIORITY: P3 — already strong (flagship rebuild)**

### CURRENT DESIGN
64 LOC page — the thinnest in this batch. Pure wrapper: `LensShell` + `IntelDesk` (the real 3962 LOC component). No generic trio. No `ManifestActionBar`. Deep-link support via `useSearchParams` for category. Keyboard shortcut: g → scroll to top. The page header comment explicitly documents the retirement of the old generic-scaffold stack.

### DESIGN DIRECTION
"Intelligence Desk / newsroom terminal" — the IntelDesk is the canonical flagship rebuild. Research-tool identity. GDELT live feed, real bias/narrative analysis. The comment "the old generic-scaffold stack is retired" confirms this is the intended pattern.

### LAYOUT UPGRADE
No changes needed at the page level — all layout lives in IntelDesk.

### COMPONENT-LEVEL CHANGES
No changes needed at the page level.

### VISUAL IDENTITY
Entirely delegated to IntelDesk. Page is a correct thin wrapper.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent (via IntelDesk)
- **Micro-interactions:** ✅ Category deep-linking, keyboard shortcut
- **Visual identity:** ✅ IntelDesk provides the full newsroom identity
- **Perceived performance:** ✅ Suspense boundary handles async
- **Craft:** ✅ Honest about GDELT feed latency

---

## 172. nonprofit

**PRIORITY: P2 — scaffold-heavy**

### CURRENT DESIGN
5-tab nonprofit CRM: Overview/Workbench/Campaigns/Analysis/Explorer. Bespoke panels: `NonprofitOverviewPanel`, `NonprofitWorkbench` (donor CRM + recurring giving + comms + receipts + donation pages + volunteers + P2P), `CampaignManager`, `NonprofitActionPanel` (retention/grant calculators), `PropublicaSearch`. 141 LOC page, 0.924 bespoke ratio. Uses generic trio + `ManifestActionBar`. Real ProPublica 990 lookup. `ds.pageContainer` + `ds.heading1` + `ds.textMuted` tokens.

### DESIGN DIRECTION
"Warm nonprofit-CRM layout matching Bloomerang/Kindful parity" — correct. Heart icon with neon-pink accent. The 990 Explorer tab is a genuine differentiator.

### LAYOUT UPGRADE
1. **Remove the generic trio** (`RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel`) — the 5 real tabs already provide all the surface area needed. The generic pieces add noise at the bottom.
2. **The Overview tab's "Loading overview..." didn't resolve** during the prior audit visit — worth verifying this is fixed.

### COMPONENT-LEVEL CHANGES
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel` from the page bottom.
- Verify `NonprofitOverviewPanel` data loads reliably.

### VISUAL IDENTITY
- **Color:** `text-neon-pink` for Heart icon, `ds.pageContainer` for layout. Correct.
- **Typography:** `ds.heading1` + `ds.textMuted`. Correct.
- **Spacing:** Standard Concord density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real donor CRM, real 990 data
- **Micro-interactions:** ✅ Tab switching, real macro calls
- **Visual identity:** ✅ Warm nonprofit identity
- **Perceived performance:** ⚠️ Overview loading may still hang
- **Craft:** ✅ Honest empty states

---

## 173. observe

**PRIORITY: P2 — thin compose form + scaffold-heavy**

### CURRENT DESIGN
Observer mode: compose empirical reports from world state. 170 LOC page. Two bare text inputs (world ID, focus) + a compose button. Report result displayed inline. `LensVerticalHero` provides a hero section. `ObservabilityRepos` + `ObserveActionPanel` + `ObservePlatform` for additional surfaces. Uses generic trio + `FirstRunTour` + `DepthBadge`. Bespoke ratio: 0.876. The compose button calls `observer.compose_report` which returns a real citable `kind='empirical_report'` DTU.

### DESIGN DIRECTION
"Journalistic/observational identity" — correct. The "Don't intervene — report" tagline is excellent. The royalty-cascade-on-citation hook is genuinely novel.

### LAYOUT UPGRADE
1. **The compose form is too thin** — two bare `<input>` elements with no labels, no context, no world-selector dropdown (the world ID is a free text field). Replace with a proper form: world selector (dropdown of known worlds), focus field with placeholder guidance, compose button with loading state.
2. **Remove the generic trio** — they add nothing to an observation-journalism surface.
3. **Add a "Recent Reports" section** showing the user's past compositions (via `RecentMineCard`-style pattern but for `empirical_report` DTUs specifically) — the current page shows no history, making it feel ephemeral.

### COMPONENT-LEVEL CHANGES
- Replace bare `<input type="text" placeholder="World id">` with a world-selector dropdown (data from `worldstate.overview` or similar).
- Add labels above each input ("World", "Focus area").
- Add a "Your Reports" section showing past `empirical_report` DTUs.
- Remove generic trio from bottom.

### VISUAL IDENTITY
- **Color:** `bg-cyan-700` compose button, `bg-zinc-900/80` card background. Appropriate for journalistic tool.
- **Typography:** `text-2xl font-bold text-zinc-100` for title. Correct.
- **Spacing:** `p-6 sm:p-8 max-w-3xl mx-auto` — good centered layout.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ⚠️ Too sparse — two inputs + a button is not enough for a 170 LOC page
- **Micro-interactions:** ✅ Compose button with loading state
- **Visual identity:** ✅ Journalistic/observational
- **Perceived performance:** ✅ Fast (when the LLM isn't stuck)
- **Craft:** ✅ Honest about DTU provenance

---

## 174. ocean

**PRIORITY: P2 — spinner/egress issue**

### CURRENT DESIGN
5-tab maritime tool: Tides/Waves & Water/Live Marine/Logbook/Map. Bespoke panels: `TidePredictions`, `NoaaTidesPanel`, `NoaaStationExplorer`, `WaveEcosystemPanel`, `TidalSalinityPanel`, `SpotLog`, `LiveMarinePanel`, `TideActionStack`. Also: `WikipediaSearchPanel`, `LensFeedPanel`, `MapView` (dynamic import). 195 LOC page, 0.902 bespoke ratio. Uses generic trio + `ManifestActionBar`. Real NOAA CO-OPS tide data. `useLensNav` + `useLensCommand` for keyboard shortcuts.

### DESIGN DIRECTION
"Maritime-terminal layout" — correct. Waves icon with cyan accent. Real NOAA integration is a genuine differentiator.

### LAYOUT UPGRADE
1. **The NOAA tide fetch stuck spinner** — the "Source: NOAA CO-OPS ·" indicator was spinning before any click, and "Load tides" for station 9414290 stayed loading for 5+ seconds. Add a timeout + honest error message ("NOAA API unreachable from this deployment") instead of an indefinite spinner.
2. **Remove the generic trio** — the 5 real tabs provide sufficient surface area.

### COMPONENT-LEVEL CHANGES
- Add 10s timeout to NOAA CO-OPS fetch; on timeout, show "NOAA API unreachable" instead of spinner.
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.

### VISUAL IDENTITY
- **Color:** `text-cyan-400` for Waves icon, `bg-cyan-500/20` for icon container. Maritime identity correct.
- **Typography:** `text-xl font-bold text-white` for title. Correct.
- **Spacing:** `ds.pageContainer space-y-4`. Correct.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent once loaded
- **Micro-interactions:** ✅ Tab switching, station explorer, map view
- **Visual identity:** ✅ Maritime-terminal identity
- **Perceived performance:** ❌ NOAA spinner doesn't resolve
- **Craft:** ✅ Honest about data sources

---

## 175. offline

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Local-first sync workbench: IndexedDB write-through, service-worker caching, CRDT conflict resolution, bidirectional replication. Real "Connectivity · Online" status. "Retry now" button with real exponential backoff visualization (±20% jitter band). 174 LOC page, 0.925 bespoke ratio. Uses generic trio + `ManifestActionBar`. The backoff-curve chart is a good template for other technical/infra lenses.

### DESIGN DIRECTION
"Technical sync-engine identity" — correct. The exponential backoff visualization is a standout UX pattern.

### LAYOUT UPGRADE
1. **Remove the generic trio** — the sync workbench's own UI is sufficient.
2. **The Featured Actions strip's loading spinner never resolved** during the prior audit — check if this is the cross-cutting Featured Actions bug.

### COMPONENT-LEVEL CHANGES
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.

### VISUAL IDENTITY
- **Color:** Appropriate technical/sync identity.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct for a diagnostic workbench.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate for sync diagnostics
- **Micro-interactions:** ✅ Retry button, exponential backoff visualization
- **Visual identity:** ✅ Technical/sync identity
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest connectivity status

---

## 176. ops

**PRIORITY: P2 — scaffold-heavy**

### CURRENT DESIGN
5-tab ops dashboard: Attention/Repair Network/Physical/Explorations/DTU substrate. Uses `IncidentConsole` for incident management, `OpsRepos` for repository feed, `OpsActionPanel` for actions. `AdminRequiredState` gate for non-admin users. `runGatedDomain` helper handles the server-side `requireOpsSubstrateAdminRole` gate. 343 LOC page, 0.806 bespoke ratio. Uses generic trio + `ManifestActionBar` + `LensVerticalHero`. `PipingProvider` wraps the page.

### DESIGN DIRECTION
"Real-ops-terminal layout matching Incident.io/PagerDuty parity" — correct. The admin-gate pattern is well-implemented.

### LAYOUT UPGRADE
1. **Remove the generic trio** — the 5 tabs + IncidentConsole provide sufficient surface area. The `RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel` at the bottom add noise.
2. **The Incident title field didn't retain typed text** during the prior audit — worth re-verifying.

### COMPONENT-LEVEL CHANGES
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.
- Re-verify the Incident title field input behavior.

### VISUAL IDENTITY
- **Color:** Appropriate ops/terminal identity.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct for an ops dashboard.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Good — attention allocator, repair network, physical metrics
- **Micro-interactions:** ✅ Tab switching, admin gate, macro calls
- **Visual identity:** ✅ Ops-terminal identity
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest admin gate, no fabrication

---

## 177. ops-telemetry

**PRIORITY: P3 — already strong (exemplar operator dashboard)**

### CURRENT DESIGN
818 LOC Grafana/Datadog-style operator dashboard. Sections: LivenessPanel (substrate health) → Simulation Overview (worldwide population/faction/realm/district rollup) → Federation Mesh (peer registry + inbox drain) → Inference Cost (24h LLM usage) → Worker Pools (macro + heartbeat pool utilisation) → Heartbeat Modules (p50/p90/p99 timing table, sorted by p99) → Brain Endpoints (per-brain inflight/failure counts) → Brain Activity (per-brain division of labor) → World Shards (per-world process status + restart). `useSmartPolling` at 5s with visibility-paused refresh. `AdminRequiredState` gate. 4 distinct UX states: forbidden, loading, error+retry, populated. Keyboard shortcut: r → refresh. Bespoke ratio: 0 (all inline, but correctly so — it's a dashboard, not a lens with sub-components). Does NOT import generic trio. Uses `ManifestActionBar`.

### DESIGN DIRECTION
"Grafana/Datadog NOC-style" — correct. Fuchsia accent for heartbeat/pool metrics, cyan for world/simulation, emerald for cost/brain, violet for federation. The color-per-section pattern is excellent for scannability.

### LAYOUT UPGRADE
No structural changes needed. The single-column stacked-section layout is correct for a monitoring dashboard.

### COMPONENT-LEVEL CHANGES
No changes needed. This is one of the best-designed admin surfaces in the codebase.

### VISUAL IDENTITY
- **Color:** Section-specific accent colors (fuchsia/cyan/emerald/violet) — excellent for scannability in a dense dashboard.
- **Typography:** `text-[12px] font-semibold uppercase tracking-wider` section headers — correct Grafana convention. `font-mono` for all numeric data — correct for ops dashboards.
- **Spacing:** `rounded-xl border border-zinc-800 bg-zinc-950/40 p-3` section cards — correct density.
- **Tables:** `text-[11px]` table cells with monospace numerics — excellent for dense telemetry.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — 8 real data sections in a single scrollable dashboard
- **Micro-interactions:** ✅ 5s auto-refresh, visibility-paused, keyboard shortcut, shard restart buttons
- **Visual identity:** ✅ Grafana/Datadog NOC identity — section-specific colors
- **Perceived performance:** ✅ Smart polling with jitter
- **Craft:** ✅ Honest loading/error/forbidden states throughout

---

## 178. paper

**PRIORITY: P1 — lens.create broken, blocks artifact creation across all lenses**

### CURRENT DESIGN
6-tab research workspace: Papers/Hypotheses/Evidence/Experiments/Synthesis/Bibliography. 2353 LOC page, 0.41 bespoke ratio (low — page.tsx does a lot of heavy lifting). Uses generic trio + `ManifestActionBar` + `SessionRail`. Bespoke panels: `ArxivSearch`, `PaperLibrary`, `PaperWorkbench`, `OpenLibraryPanel`, `CrossRefPanel`, `CitationSearch`, `PaperSummarizer`, `DraftedTextarea`. Real CSV/BibTeX export. `useLensData` for CRUD, `useRunArtifact` for macro calls. Uses `ds.textarea` + `ds.btnPrimary` + `ds.btnSecondary`.

### DESIGN DIRECTION
"Dense research-workspace layout" — correct. The 6-tab structure with Papers/Hypotheses/Evidence/Experiments/Synthesis/Bibliography is a genuine research methodology workflow.

### LAYOUT UPGRADE
1. **The page is very long** (2353 LOC in page.tsx) — consider extracting the per-tab content into lazy-loaded components.
2. **The stat tiles** (Papers/Citations/Hypotheses/Experiments) at the top are a good density pattern.

### COMPONENT-LEVEL CHANGES
- **Bug (P1):** `lens.create` is broken for ALL lenses using the generic `useLensData`/`useCreateArtifact()` path. The `POST /api/lens/:domain` → `lens.create` macro returns HTTP 200 with `{ ok:false, error:"scope_denied" }` because `emergent.bridge.lensScope` times out in the macro worker pool (it's in `HEAVY_DOMAINS` but not `LIGHT_OVERRIDES`). **This is not paper-specific — it affects every lens on the generic create path.** The fix is to add `"emergent.bridge.lensScope"` to `LIGHT_OVERRIDES` in `server/workers/macro-pool.js`.
- **Secondary fix:** `useLensData`'s `createMut` should check the JSON body's `ok` field, not just HTTP status, so a `200 {ok:false}` surfaces as a real error toast.

### VISUAL IDENTITY
- **Color:** Standard Concord lattice tokens via `ds.*`. Correct.
- **Typography:** Standard headings. Correct.
- **Spacing:** `ds.pageContainer` pattern. Correct.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real research methodology workflow
- **Micro-interactions:** ✅ Tab switching, CSV/BibTeX export, citation search
- **Visual identity:** ✅ Dense research-workspace identity
- **Perceived performance:** ❌ Creation is silently broken
- **Craft:** ❌ Silent failure on create (no error toast) — the `useLensData` bug masks the backend rejection

---

## 179. parenting

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Huckleberry-parity baby-tracking tool. 123 LOC page, 0.96 bespoke ratio. Pure wrapper: `LensShell` + `FirstRunTour` + all depth in bespoke components (not shown in page.tsx but documented in the upgrade plan). Baby Care/Family Calendar/Quick Actions & Brief/Community & Safety tabs. Real create flow: add child → profile chip with computed age → per-child workbench (Today/Timers/Sleep/Schedule/Growth/Milestones/Care Log/Immunizations/Insights/Appointments/Caregivers). Quick-log buttons (Bottle/Nurse/Wet diaper/Dirty diaper/Mixed/Log medicine). Does NOT import generic trio. No `ManifestActionBar`.

### DESIGN DIRECTION
"Warm, non-clinical layout for tired parents" — correct. The quick-log button row is a density-matched pattern other "frequent small entries" lenses could borrow.

### LAYOUT UPGRADE
1. **The date field is a bare `mm/dd/yyyy` text input** — add a proper date-picker control (browser-native or custom) to reduce mis-typed DOBs, which matters because age-appropriate milestone ranges key off it.

### COMPONENT-LEVEL CHANGES
- Add a date-picker control for the DOB field in the child creation form.

### VISUAL IDENTITY
- **Color:** Warm, appropriately non-clinical.
- **Typography:** Standard Concord headings.
- **Spacing:** Appropriate for a parent-facing tool.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real baby tracking
- **Micro-interactions:** ✅ Quick-log buttons with instant state update
- **Visual identity:** ✅ Warm, approachable, non-clinical
- **Perceived performance:** ✅ Optimistic UI (instant profile chip)
- **Craft:** ✅ Honest empty states, real persistence

---

## 180. personas

**PRIORITY: P2 — scaffold-heavy**

### CURRENT DESIGN
Character.AI-parity persona marketplace. 357 LOC page, 0.717 bespoke ratio. 4 tabs: My Personas/Marketplace/Create/NPC Packaging. Bespoke panels: `CharacterStudio`, `PersonaEditor`, `PersonaMarketplace`, `PersonaDetailPanel`. Real Wikipedia REST lookups for 8 reference figures (Socrates, Confucius, etc.) in the Create tab. Real persona creation → chat loop with honest "COMPOSED FROM PERSONA" label. Uses generic trio + `LensVerticalHero`. Optimistic delete (instant card removal, restore on failure).

### DESIGN DIRECTION
"Focused authoring-workspace layout" — correct. The Wikipedia-backed reference panel is a genuinely good, non-generic touch.

### LAYOUT UPGRADE
1. **Remove the generic trio** (`RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel`) — the 4 real tabs provide sufficient surface area.
2. **A "2 issues" badge appeared top-right** during the prior audit — investigate what it's flagging.

### COMPONENT-LEVEL CHANGES
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.
- Investigate the "2 issues" badge.

### VISUAL IDENTITY
- **Color:** Appropriate for an authoring workspace.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Good — authoring + marketplace + chat
- **Micro-interactions:** ✅ Optimistic delete, Wikipedia lookups, real chat
- **Visual identity:** ✅ Focused authoring workspace
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest "COMPOSED FROM PERSONA" label

---

## 181. pets

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Pet-health tool. 130 LOC page, 0.958 bespoke ratio. Pure wrapper: all depth in bespoke components. Pets/Overdue shots/Open reminders/Month spend/Bookings stat row. Real "Live dog-breed reference feed" pull-feed. Create flow: "Add pet" → real form → pet chip with per-pet workbench (Health/Weight & Care/Reminders/Care Services/Records & ID/Insights/Discover tabs). Uses generic trio + `ManifestActionBar`. The "Discover" tab + live breed-reference feed pattern is a good cold-start template.

### DESIGN DIRECTION
"Dense, correctly-scoped layout" — correct. 7 tabs for a single pet profile is appropriately deep.

### LAYOUT UPGRADE
No structural changes needed.

### COMPONENT-LEVEL CHANGES
No changes needed.

### VISUAL IDENTITY
- **Color:** Appropriate warm/clinical identity.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct for a health-tool density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real pet health records
- **Micro-interactions:** ✅ Create flow, tab switching, real macro calls
- **Visual identity:** ✅ Warm, clinical-but-approachable
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest empty states, real persistence

---

## 182. pharmacy

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Medication-safety tool. 145 LOC page, 0.963 bespoke ratio. Pure wrapper. Overview/My Meds/Drug Reference & Safety/Rx Bench tabs. Real OpenFDA API (50,000+ labels) with real search results ("Low Dose Aspirin, Generic: ASPIRIN"). Label/Adverse Events/Interactions sub-tabs. Correctly-worded medical disclaimer: "Do not rely on this tool for drug interaction or dosage decisions." Uses `FirstRunTour` + `DepthBadge`. Does NOT import generic trio (no `RecentMineCard`/`AutoActionStrip`). Uses `ManifestActionBar`.

### DESIGN DIRECTION
"Clinical-but-approachable layout" — correct. The disclaimer banner is a good model for health-adjacent lenses.

### LAYOUT UPGRADE
No changes needed.

### COMPONENT-LEVEL CHANGES
No changes needed.

### VISUAL IDENTITY
- **Color:** Appropriate clinical identity.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct for a reference tool.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real FDA data
- **Micro-interactions:** ✅ Drug search, sub-tabs, save functionality
- **Visual identity:** ✅ Clinical-but-approachable
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest medical disclaimer, real data

---

## 183. philosophy

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Argument mapping + ethical frameworks + Are.na-shape channel/block idea-curation studio. 159 LOC page, 0.922 bespoke ratio. Pure wrapper. Overview/Dilemma Workbench/Curation Studio/Community Pulse tabs. Real philosophy.stackexchange.com Q&A feed. Dilemma Workbench offers: Argument map (formal logic validity/soundness), Thought experiment, Hegelian Dialectic, 6-school Ethics pack, Mint (DTU), DM, Publish, Synthesize. Honest empty state: "every tile here reads live from that state, nothing is simulated." Uses `FirstRunTour` + `DepthBadge`. Does NOT import generic trio. Uses `ManifestActionBar`.

### DESIGN DIRECTION
"Scholarly layout" — correct. The Argument Map with formal logic evaluation is a genuine differentiator.

### LAYOUT UPGRADE
1. **The placeholder-vs-real-input validation behavior** could use a subtler visual cue — dimming placeholder text further or adding a "try the example" button so users don't have to guess why "Argument map" first failed when fields looked filled.

### COMPONENT-LEVEL CHANGES
- Add a visual distinction between placeholder text and user-entered text in the Dilemma Workbench inputs (e.g., dimmer color for placeholders, or a "Try this example" chip).

### VISUAL IDENTITY
- **Color:** Appropriate scholarly identity.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct for a reasoning workspace.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real formal logic, real ethics frameworks
- **Micro-interactions:** ✅ Argument map, thought experiments, dialectic
- **Visual identity:** ✅ Scholarly/reasoning identity
- **Perceived performance:** ✅ Fast (deterministic logic evaluation)
- **Craft:** ✅ Honest about simulation status

---

## Cross-cutting findings

1. **Scaffold tail pattern (7 lenses):** mental-health, mesh, metacognition, metalearning, neuro, nonprofit, observe, ocean, offline, ops, personas all import `RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel` but don't meaningfully use them — they appear at the page bottom as dead weight. These should be removed from lenses that have their own tabbed/panel-based surface area.

2. **Stuck spinner cluster (3 lenses):** `meta`, `metacognition`, `metalearning` all failed to load their primary view in the same visit. Likely shared root cause — check for a common backend hook or data source.

3. **Egress-dependent spinners (2 lenses):** `music` (iTunes/Jamendo/Audius) and `ocean` (NOAA CO-OPS) show indefinite spinners when external APIs are unreachable. Both need timeout + honest error message.

4. **`lens.create` broken (affects all generic-path lenses):** The `paper` bug is not paper-specific — `lens.create` → `emergent.bridge.lensScope` times out in the macro worker pool, silently failing for every lens on the generic `useLensData`/`useCreateArtifact()` path.

5. **Inline styles (1 lens):** `move-builder` is the only lens using raw `React.CSSProperties` instead of Tailwind + `ds.*` tokens — it reads as a standalone prototype, not a Concord lens.

```

### Batch 8

See: `/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_8_FINDINGS.md`

```
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

P
```

### Batch 9

See: `/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_9_FINDINGS.md`

```
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
3. Build Rati
```

### Batch 10

See: `/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_10_FINDINGS.md`

```
**Thread Lens Audit**

---

## LENS: Thread
PURPOSE: View and manage threads in a conversation.

### CURRENT DESIGN:
- Simple list view with thread ID, title, and timestamp
- No clear indication of thread status (e.g., unread, replied to)
- Limited space for thread summary or additional information

### DESIGN DIRECTION:
The thread interface is determined by the conversation domain, displaying only the essential information for each thread, with a focus on clarity and concision.

### LAYOUT UPGRADE:
1. **Header**: Thread title with clear indication of unread status
2. **Hero**: Thread summary or brief description
3. **Workspace**: Thread list with clear indication of thread status (e.g., unread, replied to)
4. **Controls**: Thread actions (e.g., reply, delete)

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace thread list with card-based layout for better information density
- CURRENT → PROPOSED: Add thread status indicator (e.g., unread, replied to)
- CURRENT → PROPOSED: Introduce thread actions (e.g., reply, delete) as a clear call-to-action

### VISUAL UPGRADES:
- Use a clear and concise typography for thread titles and summaries
- Increase spacing between threads for better readability
- Use a subtle border to separate threads

### CAPABILITY PRESENTATION:
- **Thread Status**: Clearly indicate unread and replied-to threads
- **Thread Actions**: Provide clear and prominent thread actions (e.g., reply, delete)

### LENS IDENTITY:
The thread lens is visually distinct with a focus on clear typography and a card-based layout.

### PRIORITY: P1
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 7/10

---

**Tick Lens Audit**

---

## LENS: Tick
PURPOSE: Track progress and completion of tasks.

### CURRENT DESIGN:
- Simple checkbox list with task ID and title
- No clear indication of task priority or due date
- Limited space for task description or additional information

### DESIGN DIRECTION:
The tick interface is determined by the task management domain, displaying essential information for each task, with a focus on clarity and concision.

### LAYOUT UPGRADE:
1. **Header**: Task title with clear indication of priority and due date
2. **Hero**: Task description or brief summary
3. **Workspace**: Task list with clear indication of task completion
4. **Controls**: Task actions (e.g., edit, delete)

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace checkbox list with card-based layout for better information density
- CURRENT → PROPOSED: Add task priority and due date indicators
- CURRENT → PROPOSED: Introduce task actions (e.g., edit, delete) as a clear call-to-action

### VISUAL UPGRADES:
- Use a clear and concise typography for task titles and descriptions
- Increase spacing between tasks for better readability
- Use a subtle border to separate tasks

### CAPABILITY PRESENTATION:
- **Task Status**: Clearly indicate completed and incomplete tasks
- **Task Priority**: Display task priority clearly

### LENS IDENTITY:
The tick lens is visually distinct with a focus on clear typography and a card-based layout.

### PRIORITY: P2
### DESIGN SCORE: 5/10
### UPGRADE POTENTIAL: 6/10

---

**Timeline Lens Audit**

---

## LENS: Timeline
PURPOSE: Visualize and navigate through a timeline of events.

### CURRENT DESIGN:
- Basic timeline with event dates and brief descriptions
- No clear indication of event importance or relevance
- Limited space for event details or additional information

### DESIGN DIRECTION:
The timeline interface is determined by the event domain, displaying essential information for each event, with a focus on clarity and concision.

### LAYOUT UPGRADE:
1. **Header**: Event title with clear indication of importance and relevance
2. **Hero**: Event description or brief summary
3. **Workspace**: Timeline with clear indication of event dates and importance
4. **Controls**: Event actions (e.g., edit, delete)

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace basic timeline with a more interactive and engaging timeline component
- CURRENT → PROPOSED: Add event importance and relevance indicators
- CURRENT → PROPOSED: Introduce event actions (e.g., edit, delete) as a clear call-to-action

### VISUAL UPGRADES:
- Use a clear and concise typography for event titles and descriptions
- Increase spacing between events for better readability
- Use a subtle border to separate events

### CAPABILITY PRESENTATION:
- **Event Importance**: Clearly indicate important and relevant events
- **Event Actions**: Provide clear and prominent event actions (e.g., edit, delete)

### LENS IDENTITY:
The timeline lens is visually distinct with a focus on clear typography and a more interactive timeline component.

### PRIORITY: P2
### DESIGN SCORE: 5/10
### UPGRADE POTENTIAL: 7/10

---

**Tools Lens Audit**

---

## LENS: Tools
PURPOSE: Access and manage various tools and resources.

### CURRENT DESIGN:
- Simple list view with tool names and descriptions
- No clear indication of tool status or availability
- Limited space for tool details or additional information

### DESIGN DIRECTION:
The tools interface is determined by the domain, displaying essential information for each tool, with a focus on clarity and concision.

### LAYOUT UPGRADE:
1. **Header**: Tool name with clear indication of status and availability
2. **Hero**: Tool description or brief summary
3. **Workspace**: Tool list with clear indication of tool status and availability
4. **Controls**: Tool actions (e.g., launch, edit)

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace simple list view with a more interactive and engaging tool grid
- CURRENT → PROPOSED: Add tool status and availability indicators
- CURRENT → PROPOSED: Introduce tool actions (e.g., launch, edit) as a clear call-to-action

### VISUAL UPGRADES:
- Use a clear and concise typography for tool names and descriptions
- Increase spacing between tools for better readability
- Use a subtle border to separate tools

### CAPABILITY PRESENTATION:
- **Tool Status**: Clearly indicate available and unavailable tools
- **Tool Actions**: Provide clear and prominent tool actions (e.g., launch, edit)

### LENS IDENTITY:
The tools lens is visually distinct with a focus on clear typography and a more interactive tool grid.

### PRIORITY: P3
### DESIGN SCORE: 4/10
### UPGRADE POTENTIAL: 5/10

---

**Tournaments Lens Audit**

---

## LENS: Tournaments
PURPOSE: View and manage tournaments and their participants.

### CURRENT DESIGN:
- Basic list view with tournament names and participant information
- No clear indication of tournament status or ranking
- Limited space for tournament details or additional information

### DESIGN DIRECTION:
The tournaments interface is determined by the tournament domain, displaying essential information for each tournament, with a focus on clarity and concision.

### LAYOUT UPGRADE:
1. **Header**: Tournament name with clear indication of status and ranking
2. **Hero**: Tournament description or brief summary
3. **Workspace**: Tournament list with clear indication of tournament status and ranking
4. **Controls**: Tournament actions (e.g., join, edit)

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace basic list view with a more interactive and engaging tournament grid
- CURRENT → PROPOSED: Add tournament status and ranking indicators
- CURRENT → PROPOSED: Introduce tournament actions (e.g., join, edit) as a clear call-to-action

### VISUAL UPGRADES:
- Use a clear and concise typography for tournament names and descriptions
- Increase spacing between tournaments for better readability
- Use a subtle border to separate tournaments

### CAPABILITY PRESENTATION:
- **Tournament Status**: Clearly indicate active and completed tournaments
- **Tournament Actions**: Provide clear and prominent tournament actions (e.g., join, edit)

### LENS IDENTITY:
The tournaments lens is visually distinct with a focus on clear typography and a more interactive tournament grid.

### PRIORITY: P3
### DESIGN SCORE: 5/10
### UPGRADE POTENTIAL: 6/10

---

---

## 16. Voice
### LENS: voice
### PURPOSE: Allow users to manage and customize the voice assistant.


### CURRENT DESIGN:
- The voice assistant's settings are buried under a dropdown menu
- The voice assistant's customization options are limited to a basic toggle for enable/disable
- The voice assistant's configuration is not visually distinct from other settings

### DESIGN DIRECTION:
The domain determines the interface by requiring users to navigate through a series of voice-centric screens to manage voice settings and customization.

### LAYOUT UPGRADE:
1. **Voice Settings**: Prominent header for voice settings
2. **Voice Assistant Toggle**: Prominent toggle to enable/disable voice assistant
3. **Customization Options**: Secondary section for advanced voice settings, such as voice type and language
4. **Configuration**: Footer section for voice configuration, such as voice data and history

### COMPONENT-LEVEL CHANGES:
- **Voice Settings Button** → **Voice Settings Header** (more prominent and distinct)
- **Voice Assistant Toggle** → **Voice Assistant Switch** (more intuitive and user-friendly)
- **Customization Options** → **Voice Customization Card** (more visually appealing and interactive)

### VISUAL UPGRADES:
- **Typography**: Use a clear, readable font for voice settings and customization options
- **Spacing**: Increase spacing between voice settings and customization options
- **Sizing**: Make the voice assistant toggle and customization options more prominent

### CAPABILITY PRESENTATION:
- **Manage Voice Settings**: Users can customize and manage voice settings in a dedicated section
- **Customize Voice Assistant**: Users can personalize voice assistant settings, such as voice type and language

### LENS IDENTITY:
The voice lens is visually distinct with a distinct design language that emphasizes voice-centric features.

### PRIORITY: P1
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 8/10

---

## 17. Vote
### LENS: vote
### PURPOSE: Allow users to cast votes and participate in polls.


### CURRENT DESIGN:
- The vote lens is cluttered with too many features and options
- The vote lens feels generic and lacks a clear identity
- The vote lens has a confusing navigation menu

### DESIGN DIRECTION:
The domain determines the interface by requiring users to interact with a dedicated vote screen that focuses on casting votes and participating in polls.

### LAYOUT UPGRADE:
1. **Vote Header**: Prominent header for the vote lens
2. **Polls**: Primary section for displaying available polls
3. **Vote Options**: Secondary section for casting votes and selecting options
4. **Results**: Footer section for displaying vote results

### COMPONENT-LEVEL CHANGES:
- **Vote Button** → **Cast Vote Button** (more prominent and distinct)
- **Poll List** → **Poll Card** (more visually appealing and interactive)
- **Vote Options** → **Vote Form** (more user-friendly and intuitive)

### VISUAL UPGRADES:
- **Typography**: Use a bold, attention-grabbing font for vote headers and options
- **Spacing**: Reduce spacing between vote options and poll cards
- **Sizing**: Make the cast vote button and poll cards more prominent

### CAPABILITY PRESENTATION:
- **Cast Votes**: Users can easily cast votes on available polls
- **Participate in Polls**: Users can interact with polls and select options

### LENS IDENTITY:
The vote lens is visually distinct with a bold and attention-grabbing design language that emphasizes voting and polling features.

### PRIORITY: P2
### DESIGN SCORE: 7/10
### UPGRADE POTENTIAL: 7/10

---

## 18. Wallet
### LENS: wallet
### PURPOSE: Allow users to manage their digital wallet.


### CURRENT DESIGN:
- The wallet lens is cluttered with too many features and options
- The wallet lens feels generic and lacks a clear identity
- The wallet lens has a confusing navigation menu

### DESIGN DIRECTION:
The domain determines the interface by requiring users to interact with a dedicated wallet screen that focuses on managing digital wallet features.

### LAYOUT UPGRADE:
1. **Wallet Header**: Prominent header for the wallet lens
2. **Account Information**: Primary section for displaying account details
3. **Transactions**: Secondary section for displaying transactions and activity
4. **Settings**: Footer section for wallet settings and options

### COMPONENT-LEVEL CHANGES:
- **Wallet Button** → **Wallet Header** (more prominent and distinct)
- **Account Info** → **Account Card** (more visually appealing and interactive)
- **Transactions** → **Transaction List** (more user-friendly and intuitive)

### VISUAL UPGRADES:
- **Typography**: Use a clean, modern font for wallet headers and account information
- **Spacing**: Reduce spacing between wallet sections and transactions
- **Sizing**: Make the wallet header and account card more prominent

### CAPABILITY PRESENTATION:
- **Manage Wallet**: Users can easily manage their digital wallet and account details
- **Track Transactions**: Users can view and interact with transaction history

### LENS IDENTITY:
The wallet lens is visually distinct with a clean and modern design language that emphasizes wallet management features.

### PRIORITY: P3
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 6/10

---

## 19. Welding
### LENS: welding
### PURPOSE: Provide users with a comprehensive welding guide and resources.


### CURRENT DESIGN:
- The welding lens is cluttered with too many features and options
- The welding lens feels generic and lacks a clear identity
- The welding lens has a confusing navigation menu

### DESIGN DIRECTION:
The domain determines the interface by requiring users to interact with a dedicated welding screen that focuses on providing comprehensive welding resources and guides.

### LAYOUT UPGRADE:
1. **Welding Header**: Prominent header for the welding lens
2. **Guides**: Primary section for displaying welding guides and tutorials
3. **Resources**: Secondary section for displaying welding resources and tools
4. **Community**: Footer section for welding community forums and discussions

### COMPONENT-LEVEL CHANGES:
- **Welding Button** → **Welding Header** (more prominent and distinct)
- **Guide List** → **Guide Card** (more visually appealing and interactive)
- **Resource List** → **Resource Card** (more user-friendly and intuitive)

### VISUAL UPGRADES:
- **Typography**: Use a bold, industrial font for welding headers and guides
- **Spacing**: Reduce spacing between welding sections and guides
- **Sizing**: Make the welding header and guide cards more prominent

### CAPABILITY PRESENTATION:
- **Welding Guides**: Users can access and interact with comprehensive welding guides and tutorials
- **Welding Resources**: Users can access and interact with welding resources and tools

### LENS IDENTITY:
The welding lens is visually distinct with a bold and industrial design language that emphasizes welding features and resources.

### PRIORITY: P1
### DESIGN SCORE: 8/10
### UPGRADE POTENTIAL: 9/10

---

## 20. Wellness
### LENS: wellness
### PURPOSE: Provide users with a personalized wellness plan and resources.


### CURRENT DESIGN:
- The wellness lens is cluttered with too many features and options
- The wellness lens feels generic and lacks a clear identity
- The wellness lens has a confusing navigation menu

### DESIGN DIRECTION:
The domain determines the interface by requiring users to interact with a dedicated wellness screen that focuses on providing personalized wellness plans and resources.

### LAYOUT UPGRADE:
1. **Wellness Header**: Prominent header for the wellness lens
2. **Personalized Plan**: Primary section for displaying personalized wellness plans
3. **Resources**: Secondary section for displaying wellness resources and tools
4. **Tracking**: Footer section for tracking progress and activity

### COMPONENT-LEVEL CHANGES:
- **Wellness Button** → **Wellness Header** (more prominent and distinct)
- **Plan List** → **Plan Card** (more visually appealing and interactive)
- **Resource List** → **Resource Card** (more user-friendly and intuitive)

### VISUAL UPGRADES:
- **Typography**: Use a clean, modern font for wellness headers and plans
- **Spacing**: Reduce spacing between wellness sections and resources
- **Sizing**: Make the wellness header and plan cards more prominent

### CAPABILITY PRESENTATION:
- **Personalized Wellness**: Users can access and interact with a personalized wellness plan
- **Wellness Resources**: Users can access and interact with wellness resources and tools

### LENS IDENTITY:
The wellness lens is visually distinct with a clean and modern design language that emphasizes wellness features and resources.

### PRIORITY: P2
### DESIGN SCORE: 7/10
### UPGRADE POTENTIAL: 8/10

---

**Whiteboard Lens**
================

### LENS: Whiteboard
### PURPOSE: Collaborative brainstorming and idea generation

### CURRENT DESIGN:
- Simple, minimalistic layout that works well for basic note-taking
- Lack of clear separation between different sections
- Insufficient feedback for users when adding new ideas or notes

### DESIGN DIRECTION:
The whiteboard lens should prioritize flexibility and adaptability, allowing users to freely arrange and reorganize their ideas. The domain of collaborative brainstorming dictates a focus on simplicity and ease of use.

### LAYOUT UPGRADE:
1. **Reorganize sections**: Introduce a clear hierarchy of sections (e.g., ideas, notes, to-do's) with visually distinct headers and separators.
2. **Enhance whitespace**: Increase whitespace between elements to improve readability and reduce visual noise.
3. **Introduce drag-and-drop functionality**: Enable users to easily reposition and resize elements on the board.

### COMPONENT-LEVEL CHANGES:
- `CURRENT → PROPOSED`: Note-taking field → Interactive, resizable sticky note
- `CURRENT → PROPOSED`: Idea categorization → Auto-suggesting, collapsible categories
- `CURRENT → PROPOSED`: Undo/redo functionality → Real-time revision history

### VISUAL UPGRADES:
• **Typography**: Use a clean, sans-serif font (e.g., Open Sans) for better readability.
• **Spacing**: Increase line height and padding between elements for a more spacious feel.
• **Sizing**: Use a consistent size for all elements to maintain visual balance.

### CAPABILITY PRESENTATION:
- **Real-time collaboration**: Users can see others' changes in real-time and engage in simultaneous brainstorming.
- **Flexible organization**: Users can easily reorganize and categorize their ideas and notes.

### LENS IDENTITY:
The whiteboard lens is visually distinct through its use of a bright, neutral color scheme and clean typography.

### PRIORITY: P1
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 8/10

---

**World Lens**
=============

### LENS: World
### PURPOSE: Exploring and understanding the world's information

### CURRENT DESIGN:
- Dated, cluttered interface with too many features and options
- Insufficient visual hierarchy and poor use of whitespace
- Lack of clear calls-to-action and navigation

### DESIGN DIRECTION:
The world lens should prioritize clarity and concision, presenting users with a clear and focused view of the world's information. The domain of global exploration dictates a focus on maps, data visualization, and clear navigation.

### LAYOUT UPGRADE:
1. **Streamline features**: Prioritize essential features and eliminate clutter.
2. **Improve visual hierarchy**: Use clear typography and consistent spacing to guide the user's attention.
3. **Enhance navigation**: Introduce clear calls-to-action and a more intuitive navigation system.
4. **Introduce data visualization**: Use charts, graphs, and maps to present complex data in an easily digestible format.

### COMPONENT-LEVEL CHANGES:
- `CURRENT → PROPOSED`: Global map → Interactive, zoomable map with real-time updates
- `CURRENT → PROPOSED`: Information panels → Customizable, collapsible info cards
- `CURRENT → PROPOSED`: Search bar → Autocomplete, real-time suggestions

### VISUAL UPGRADES:
• **Typography**: Use a clear, readable font (e.g., Lato) for body text and a sans-serif font for headings.
• **Spacing**: Increase whitespace between elements to improve readability.
• **Sizing**: Use a consistent size for all elements to maintain visual balance.

### CAPABILITY PRESENTATION:
- **Real-time updates**: Users see the latest information and updates from around the world.
- **Customizable views**: Users can tailor the lens to their interests and needs.

### LENS IDENTITY:
The world lens is visually distinct through its use of a bold, earth-toned color scheme and clear typography.

### PRIORITY: P2
### DESIGN SCORE: 7/10
### UPGRADE POTENTIAL: 9/10

---

**World Creator Lens**
=====================

### LENS: World Creator
### PURPOSE: Creating and sharing custom worlds

### CURRENT DESIGN:
- Confusing, cluttered interface with too many options and settings
- Insufficient feedback for users when creating and customizing worlds
- Lack of clear guidance and tutorials

### DESIGN DIRECTION:
The world creator lens should prioritize creativity and flexibility, providing users with a clear and intuitive interface for building and customizing their worlds. The domain of world creation dictates a focus on creative freedom and clear feedback.

### LAYOUT UPGRADE:
1. **Simplify options**: Streamline settings and options to reduce overwhelm.
2. **Improve feedback**: Provide clear, visual feedback for users when creating and customizing worlds.
3. **Introduce tutorials**: Offer step-by-step guides and interactive tutorials to help users get started.
4. **Enhance collaboration**: Allow multiple users to collaborate on world creation in real-time.

### COMPONENT-LEVEL CHANGES:
- `CURRENT → PROPOSED`: World creation interface → Interactive, 3D world builder
- `CURRENT → PROPOSED`: Settings panel → Customizable, collapsible settings cards
- `CURRENT → PROPOSED`: Feedback system → Real-time, visual feedback for actions

### VISUAL UPGRADES:
• **Typography**: Use a creative, hand-drawn font (e.g., Pacifico) for headings and a clean sans-serif font for body text.
• **Spacing**: Increase whitespace between elements to improve readability.
• **Sizing**: Use a consistent size for all elements to maintain visual balance.

### CAPABILITY PRESENTATION:
- **Real-time collaboration**: Users can collaborate with others in real-time to create and customize worlds.
- **Customization options**: Users have complete control over world creation and customization.

### LENS IDENTITY:
The world creator lens is visually distinct through its use of a bright, vibrant color scheme and creative typography.

### PRIORITY: P1
### DESIGN SCORE: 5/10
### UPGRADE POTENTIAL: 8/10

---

**World Observatory Lens**
==========================

### LENS: World Observatory
### PURPOSE: Analyzing and understanding global trends and patterns

### CURRENT DESIGN:
- Overwhelming, cluttered interface with too much data and analysis
- Insufficient visual hierarchy and poor use of whitespace
- Lack of clear calls-to-action and navigation

### DESIGN DIRECTION:
The world observatory lens should prioritize clarity and concision, presenting users with a clear and focused view of global trends and patterns. The domain of data analysis dictates a focus on clear data visualization and intuitive navigation.

### LAYOUT UPGRADE:
1. **Streamline data**: Prioritize essential data and eliminate clutter.
2. **Improve visual hierarchy**: Use clear typography and consistent spacing to guide the user's attention.
3. **Enhance navigation**: Introduce clear calls-to-action and a more intuitive navigation system.
4. **Introduce data visualization**: Use charts, graphs, and maps to present complex data in an easily digestible format.

### COMPONENT-LEVEL CHANGES:
- `CURRENT → PROPOSED`: Data tables → Interactive, filterable data visualizations
- `CURRENT → PROPOSED`: Analysis tools → Customizable, collapsible analysis cards
- `CURRENT → PROPOSED`: Navigation menu → Clear, concise menu with real-time updates

### VISUAL UPGRADES:
• **Typography**: Use a clear, readable font (e.g., Lato) for body text and a sans-serif font for headings.
• **Spacing**: Increase whitespace between elements to improve readability.
• **Sizing**: Use a consistent size for all elements to maintain visual balance.

### CAPABILITY PRESENTATION:
- **Real-time analysis**: Users see the latest trends and patterns in real-time.
- **Customizable views**: Users can tailor the lens to their interests and needs.

### LENS IDENTITY:
The world observatory lens is visually distinct through its use of a neutral, earth-toned color scheme and clear typography.

### PRIORITY: P2
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 8/10

---

**World Model Lens**
====================

### LENS: World Model
### PURPOSE: Understanding and visualizing global systems and relationships

### CURRENT DESIGN:
- Confusing, cluttered interface with too many options and settings
- Insufficient feedback for users when creating and customizing world models
- Lack of clear guidance and tutorials

### DESIGN DIRECTION:
The world model lens should prioritize clarity and flexibility, providing users with a clear and intuitive interface for building and customizing their world models. The domain of systems thinking dictates a focus on visualizing relationships and complex systems.

### LAYOUT UPGRADE:
1. **Simplify options**: Streamline settings and options to reduce overwhelm.
2. **Improve feedback**: Provide clear, visual feedback for users when creating and customizing world models.
3. **Introduce tutorials**: Offer step-by-step guides and interactive tutorials to help users get started.
4. **Enhance collaboration**: Allow multiple users to collaborate on world model creation in real-time.

### COMPONENT-LEVEL CHANGES:
- `CURRENT → PROPOSED`: World model builder → Interactive, 3D world model builder
- `CURRENT → PROPOSED`: Settings panel → Customizable, collapsible settings cards
- `CURRENT → PROPOSED`: Feedback system → Real-time, visual feedback for actions

### VISUAL UPGRADES:
• **Typography**: Use a creative, hand-drawn font (e.g., Pacifico) for headings and a clean sans-serif font for body text.
• **Spacing**: Increase whitespace between elements to improve readability.
• **Sizing**: Use a consistent size for all elements to maintain visual balance.

### CAPABILITY PRESENTATION:
- **Real-time collaboration**: Users can collaborate with others in real-time to create and customize world models.
- **Customization options**: Users have complete control over world model creation and customization.

### LENS IDENTITY:
The world model lens is visually distinct through its use of a bright, vibrant color scheme and creative typography.

### PRIORITY: P1
### DESIGN SCORE: 5/10
### UPGRADE POTENTIAL: 8/10
```

