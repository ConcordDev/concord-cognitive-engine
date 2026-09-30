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
